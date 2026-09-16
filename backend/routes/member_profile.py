"""Read-only, permission-scoped data used by the unified member dialog.

This router intentionally does not reuse the inbox thread endpoint: opening a
thread marks member messages read, whereas a profile dialog must be safe to
open without causing a state change.
"""
from __future__ import annotations

import asyncio
import re
from datetime import date, datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query

from .common import db, get_current_user
from .members import _scoped_member_query
from utils.auth import require_permission


router = APIRouter(prefix="/members", tags=["member-profile"])


def _timestamp(value: Any) -> Tuple[str, datetime]:
    """Normalize BSON datetimes, ISO timestamps, and legacy date strings.

    The first value is safe for the API; the second is only used for a stable
    cross-source sort.  A malformed legacy timestamp is deliberately sorted
    last rather than being replaced with the current time.
    """
    if isinstance(value, datetime):
        parsed = value.replace(tzinfo=value.tzinfo or timezone.utc)
    elif isinstance(value, date):
        parsed = datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    else:
        text = str(value or "").strip()
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            parsed = parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)
        except (TypeError, ValueError):
            return text, datetime.min.replace(tzinfo=timezone.utc)
    return parsed.isoformat(), parsed.astimezone(timezone.utc)


def _text(value: Any) -> str:
    """Return only scalar display text; never serialize an arbitrary document."""
    return value.strip() if isinstance(value, str) else (str(value) if value is not None else "")


def _event(
    event_id: str,
    event_type: str,
    occurred_at: Any,
    title_ar: str,
    title_en: str,
    detail_ar: str = "",
    detail_en: str = "",
    target_tab: str = "overview",
    entity_id: Any = "",
    actor: Optional[Any] = None,
) -> Dict[str, Any]:
    occurred_text, sort_time = _timestamp(occurred_at)
    item = {
        "id": event_id,
        "type": event_type,
        "occurred_at": occurred_text,
        "title_ar": title_ar,
        "title_en": title_en,
        "detail_ar": detail_ar,
        "detail_en": detail_en,
        "target_tab": target_tab,
        "entity_id": _text(entity_id),
        "_sort_time": sort_time,
    }
    if actor:
        item["actor"] = _text(actor)
    return item


def _history_page(items: List[Dict[str, Any]], total: int, offset: int, limit: int, errors: List[str]) -> dict:
    # Sort id as a deterministic tie-breaker.  The implementation never relies
    # on ObjectId ordering, which differs for legacy/imported records.
    items.sort(key=lambda item: (item["_sort_time"], item["id"]), reverse=True)
    page = items[offset:offset + limit]
    for item in page:
        item.pop("_sort_time", None)
    return {
        "items": page,
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(page) < total,
        "errors": errors,
    }


async def _source_rows(
    collection: Any,
    query: dict,
    projection: dict,
    sort: List[Tuple[str, int]],
    candidate_limit: int,
    fallback_field: Optional[str] = None,
) -> Tuple[int, List[dict]]:
    """Count independently and page after server-side timestamp normalization."""
    timestamp_field = sort[0][0]
    source_value: Any = "$" + timestamp_field
    if fallback_field:
        source_value = {"$ifNull": [source_value, "$" + fallback_field]}
    normalized = {
        "$convert": {
            "input": source_value,
            "to": "date",
            # A legacy malformed/missing timestamp belongs after dated records,
            # never at "now".  This is a fixed instant, not a fabricated event.
            "onError": datetime(1970, 1, 1, tzinfo=timezone.utc),
            "onNull": datetime(1970, 1, 1, tzinfo=timezone.utc),
        }
    }
    pipeline = [
        {"$match": query},
        {"$addFields": {"_profile_sort_at": normalized}},
        {"$sort": {"_profile_sort_at": -1, "id": -1}},
        {"$limit": candidate_limit},
        {"$project": projection},
    ]
    total_task = collection.count_documents(query)
    rows_task = collection.aggregate(pipeline).to_list(candidate_limit)
    total, rows = await asyncio.gather(total_task, rows_task)
    return int(total), rows


async def _normalized_message_rows(query: dict, projection: dict, offset: int, limit: int) -> List[dict]:
    """Use the same date conversion before message pagination/skip."""
    pipeline = [
        {"$match": query},
        {"$addFields": {
            "_profile_sort_at": {
                "$convert": {
                    "input": "$created_at",
                    "to": "date",
                    "onError": datetime(1970, 1, 1, tzinfo=timezone.utc),
                    "onNull": datetime(1970, 1, 1, tzinfo=timezone.utc),
                }
            }
        }},
        {"$sort": {"_profile_sort_at": -1, "id": -1}},
        {"$skip": offset},
        {"$limit": limit},
        {"$project": projection},
    ]
    return await db.messages.aggregate(pipeline).to_list(limit)


async def _safe_source(source_key: str, loader: Callable[[], Any]) -> Tuple[str, int, List[dict], Optional[str]]:
    try:
        total, rows = await loader()
        return source_key, total, rows, None
    except Exception:
        # Do not present a failed source as an empty source.  The compact key
        # lets the UI show a retry/error state without exposing database internals.
        return source_key, 0, [], source_key


async def _authoritative_permissions(current_user: dict) -> Tuple[bool, set]:
    """Read grants from the tenant user record, never from client state."""
    user_doc = await db.users.find_one(
        {"id": current_user.get("user_id")},
        {"_id": 0, "permissions": 1},
    )
    permissions = set((user_doc or {}).get("permissions") or [])
    # Existing authentication semantics treat a signed admin token as an admin
    # bypass.  Non-admin grants, including phone visibility, are always loaded
    # from the database above.
    return bool(current_user.get("is_admin", False)), permissions


def _owned_invoice_items(invoice: dict, member_id: str) -> List[dict]:
    """Return just this member's items from a potentially family-wide invoice.

    An item without ``member_id`` belongs to the top-level member on old
    invoices.  Explicit sibling items never fall through to that legacy rule.
    """
    owned = []
    for item in invoice.get("items") or []:
        if not isinstance(item, dict):
            continue
        item_member_id = item.get("member_id")
        if item_member_id == member_id or (not item_member_id and invoice.get("member_id") == member_id):
            owned.append(item)
    return owned


def _invoice_item_names(items: List[dict]) -> str:
    names = [_text(item.get("activity_name")) for item in items if _text(item.get("activity_name"))]
    return "، ".join(names[:4])


def _invoice_query(member_id: str) -> dict:
    # This is deliberately narrower than a simple top-level member_id query:
    # multi-member invoices can have an explicit item for a sibling.  The
    # second clause admits old, unannotated primary-member items only.
    return {
        "$or": [
            {"items.member_id": member_id},
            {
                "member_id": member_id,
                "items.member_id": {"$exists": False},
            },
        ]
    }


def _map_profile_request_changes(message: dict, can_view_phones: bool) -> Optional[dict]:
    """Map the known request shape; no generic message metadata is exposed."""
    if message.get("kind") != "profile_change_request":
        return None
    raw = message.get("change_request")
    if not isinstance(raw, dict):
        return None
    field = raw.get("field")
    labels = {
        "name": ("الاسم", "Name"),
        "phone": ("رقم الجوال", "Phone"),
        "date_of_birth": ("تاريخ الميلاد", "Date of birth"),
    }
    if field not in labels:
        return None
    label_ar, label_en = labels[field]
    changes = {
        "field": field,
        "label_ar": _text(raw.get("field_label_ar")) or label_ar,
        "label_en": _text(raw.get("field_label_en")) or label_en,
    }
    # The original subject/body are authorized communication content, but
    # structured values are also used by UI controls and must obey the stricter
    # member-phone grant.
    if field != "phone" or can_view_phones:
        changes["current_value"] = _text(raw.get("current_value"))
        changes["new_value"] = _text(raw.get("new_value"))
    if isinstance(raw.get("reason"), str) and (field != "phone" or can_view_phones):
        changes["reason"] = raw["reason"]
    return changes


@router.get("/{member_id}/profile-history")
async def get_member_profile_history(
    member_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Return persisted timeline events the caller is allowed to inspect."""
    await require_permission(current_user, "members")
    member = await db.members.find_one(
        _scoped_member_query(member_id, current_user),
        {"_id": 0, "id": 1, "created_at": 1},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    is_admin, permissions = await _authoritative_permissions(current_user)
    candidate_limit = offset + limit
    tasks = []
    source_access = {
        # These are the existing focused-dialog view grants.  Keep their
        # absence distinct from a failed source (not included in errors).
        # ``*-view`` is used by the focused dialog; the older tenant role
        # definitions use the corresponding module grant.  Either is an
        # existing, server-stored grant rather than a client supplied flag.
        "attendance": is_admin or bool({"attendance-view", "attendance"} & permissions),
        "invoices": is_admin or bool({"invoices-view", "invoices"} & permissions),
        # There is no separate freezes grant in the current permission model;
        # access is governed by the required members grant above.
        "freezes": True,
        "subscription_audit": is_admin,
    }

    if source_access["attendance"]:
        tasks.append(_safe_source(
            "attendance",
            lambda: _source_rows(
                db.attendance,
                {"member_id": member_id},
                {"_id": 0, "id": 1, "member_id": 1, "activity_name": 1, "date": 1, "status": 1, "created_at": 1},
                [("created_at", -1), ("id", -1)],
                candidate_limit,
                "date",
            ),
        ))
    if source_access["freezes"]:
        tasks.append(_safe_source(
            "freezes",
            lambda: _source_rows(
                db.member_freezes,
                {"member_id": member_id},
                {"_id": 0, "id": 1, "member_id": 1, "start_date": 1, "end_date": 1, "reason": 1, "duration_days": 1, "status": 1, "created_at": 1},
                [("created_at", -1), ("id", -1)],
                candidate_limit,
                "start_date",
            ),
        ))
    if source_access["invoices"]:
        invoice_projection = {
            "_id": 0, "id": 1, "member_id": 1, "invoice_number": 1, "status": 1,
            "created_at": 1, "paid_at": 1, "has_refund": 1, "refunded_at": 1,
            "credit_note_number": 1, "items.member_id": 1, "items.activity_name": 1,
        }
        base_invoice_query = _invoice_query(member_id)
        tasks.extend([
            _safe_source("invoices", lambda: _source_rows(
                db.invoices, base_invoice_query, invoice_projection,
                [("created_at", -1), ("id", -1)], candidate_limit, "created_at",
            )),
            _safe_source("payments", lambda: _source_rows(
                db.invoices,
                {"$and": [
                    base_invoice_query,
                    {"$or": [
                        {"paid_at": {"$exists": True, "$ne": None}},
                        {"status": {"$in": ["paid", "partial", "refunded", "partially_refunded"]}},
                    ]},
                ]},
                invoice_projection, [("paid_at", -1), ("id", -1)], candidate_limit, "created_at",
            )),
            _safe_source("refunds", lambda: _source_rows(
                db.invoices,
                {"$and": [base_invoice_query, {"has_refund": True}, {"refunded_at": {"$exists": True, "$ne": None}}]},
                invoice_projection, [("refunded_at", -1), ("id", -1)], candidate_limit, "created_at",
            )),
        ])
    if source_access["subscription_audit"]:
        audit_member_clause = {
            "$or": [
                {"member_id": member_id},
                {"entity_id": member_id},
                {"entity_id": {"$regex": "^" + re.escape(member_id) + ":"}},
            ]
        }
        tasks.append(_safe_source(
            "subscription_audit",
            lambda: _source_rows(
                db.audit_logs,
                {
                    "$and": [
                        audit_member_clause,
                        {"action": {"$regex": "^(subscription\\.|member\\.update|member\\.transfer|day_extension\\.)"}},
                    ]
                },
                {"_id": 0, "id": 1, "action": 1, "entity_id": 1, "entity_name": 1, "actor_username": 1, "created_at": 1},
                [("created_at", -1), ("id", -1)],
                candidate_limit,
                "created_at",
            ),
        ))

    results = await asyncio.gather(*tasks) if tasks else []
    errors = [error for _, _, _, error in results if error]
    source_rows = {key: rows for key, _, rows, error in results if not error}
    total = sum(count for _, count, _, error in results if not error)
    events: List[Dict[str, Any]] = []

    # A member record itself is the only trustworthy registration event.  Do
    # not manufacture subscription events from mutable member.activities.
    if member.get("created_at"):
        total += 1
        events.append(_event(
            "member:" + member_id, "member_created", member["created_at"],
            "تم إنشاء ملف العضو", "Member profile created",
            target_tab="overview", entity_id=member_id,
        ))

    for row in source_rows.get("attendance", []):
        status = _text(row.get("status")).lower() or "present"
        is_present = status == "present"
        activity = _text(row.get("activity_name"))
        day = _text(row.get("date"))
        events.append(_event(
            "attendance:" + _text(row.get("id")), "attendance",
            row.get("created_at") or row.get("date"),
            "تسجيل حضور" if is_present else "تسجيل غياب",
            "Attendance recorded" if is_present else "Absence recorded",
            (activity + (" — " if activity and day else "") + day),
            (activity + (" — " if activity and day else "") + day),
            "attendance", row.get("id"),
        ))
    for row in source_rows.get("freezes", []):
        start, end = _text(row.get("start_date")), _text(row.get("end_date"))
        reason = _text(row.get("reason"))
        range_text = " إلى ".join(value for value in (start, end) if value)
        detail = " — ".join(value for value in (range_text, reason) if value)
        events.append(_event(
            "freeze:" + _text(row.get("id")), "freeze",
            row.get("created_at") or row.get("start_date"),
            "تجميد العضوية" if row.get("status") != "cancelled" else "إلغاء تجميد العضوية",
            "Membership freeze" if row.get("status") != "cancelled" else "Membership freeze cancelled",
            detail, detail, "freeze", row.get("id"),
        ))
    for row in source_rows.get("invoices", []):
        own_items = _owned_invoice_items(row, member_id)
        if not own_items:
            continue
        number = _text(row.get("invoice_number")) or _text(row.get("id"))
        names = _invoice_item_names(own_items)
        detail = " — ".join(value for value in (number, names) if value)
        events.append(_event(
            "invoice:" + _text(row.get("id")), "invoice", row.get("created_at"),
            "إنشاء فاتورة", "Invoice created", detail, detail, "invoices", row.get("id"),
        ))
    for row in source_rows.get("payments", []):
        own_items = _owned_invoice_items(row, member_id)
        if not own_items:
            continue
        number = _text(row.get("invoice_number")) or _text(row.get("id"))
        events.append(_event(
            "payment:" + _text(row.get("id")), "payment", row.get("paid_at") or row.get("created_at"),
            "سداد فاتورة", "Invoice paid", number, number, "invoices", row.get("id"),
        ))
    for row in source_rows.get("refunds", []):
        own_items = _owned_invoice_items(row, member_id)
        if not own_items:
            continue
        number = _text(row.get("credit_note_number")) or _text(row.get("invoice_number")) or _text(row.get("id"))
        events.append(_event(
            "refund:" + _text(row.get("id")), "refund", row.get("refunded_at"),
            "استرداد فاتورة", "Invoice refunded", number, number, "invoices", row.get("id"),
        ))
    for row in source_rows.get("subscription_audit", []):
        action = _text(row.get("action"))
        name = _text(row.get("entity_name"))
        events.append(_event(
            "audit:" + _text(row.get("id")), "subscription_audit", row.get("created_at"),
            "تحديث الاشتراك", "Subscription updated",
            name or action, name or action, "activities", row.get("entity_id") or row.get("id"),
            row.get("actor_username"),
        ))

    return _history_page(events, total, offset, limit, errors)


async def _owned_paid_invoice_count(member_id: str) -> int:
    """Count paid invoices after filtering array items to this exact member."""
    pipeline = [
        {"$match": {"$and": [_invoice_query(member_id), {"status": "paid"}]}},
        {"$project": {
            "_id": 0,
            "owned_items": {
                "$filter": {
                    "input": {"$ifNull": ["$items", []]},
                    "as": "item",
                    "cond": {
                        "$or": [
                            {"$eq": ["$$item.member_id", member_id]},
                            {"$and": [
                                {"$eq": [{"$ifNull": ["$$item.member_id", None]}, None]},
                                {"$eq": ["$member_id", member_id]},
                            ]},
                        ]
                    },
                }
            },
        }},
        {"$match": {"owned_items.0": {"$exists": True}}},
        {"$count": "total"},
    ]
    result = await db.invoices.aggregate(pipeline).to_list(1)
    return int((result[0] if result else {}).get("total") or 0)


@router.get("/{member_id}/profile-summary")
async def get_member_profile_summary(
    member_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return lazy overview counts without leaking shared family invoice totals."""
    await require_permission(current_user, "members")
    member = await db.members.find_one(
        _scoped_member_query(member_id, current_user),
        {"_id": 0, "id": 1},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    is_admin, permissions = await _authoritative_permissions(current_user)
    if not (is_admin or {"invoices-view", "invoices"} & permissions):
        return {"paid_invoice_count": None, "errors": []}
    try:
        paid_count = await _owned_paid_invoice_count(member_id)
    except Exception:
        return {"paid_invoice_count": None, "errors": ["invoices"]}
    return {"paid_invoice_count": paid_count, "errors": []}


@router.get("/{member_id}/profile-messages")
async def get_member_profile_messages(
    member_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Read a member's messages without read receipts, pushes, or joins."""
    await require_permission(current_user, "members")
    member = await db.members.find_one(
        _scoped_member_query(member_id, current_user),
        {"_id": 0, "id": 1},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    await require_permission(current_user, "messages")

    is_admin, permissions = await _authoritative_permissions(current_user)
    can_view_phones = is_admin or "member-phones" in permissions
    query = {"recipient_member_id": member_id}
    total = await db.messages.count_documents(query)
    rows = await _normalized_message_rows(
        query,
        {
            "_id": 0, "id": 1, "subject": 1, "body": 1, "sender_type": 1,
            "created_at": 1, "kind": 1, "change_request_status": 1,
            "change_request.field": 1, "change_request.field_label_ar": 1,
            "change_request.field_label_en": 1, "change_request.current_value": 1,
            "change_request.new_value": 1, "change_request.reason": 1,
        },
        offset,
        limit,
    )

    items = []
    for row in rows:
        is_request = row.get("kind") == "profile_change_request"
        request_status = _text(row.get("change_request_status")).lower()
        status = request_status if request_status in {"applied", "rejected"} else ("pending" if is_request else "")
        created_at, _ = _timestamp(row.get("created_at"))
        is_hidden_phone_request = (
            is_request
            and isinstance(row.get("change_request"), dict)
            and row["change_request"].get("field") == "phone"
            and not can_view_phones
        )
        item = {
            "id": _text(row.get("id")),
            # The producer writes the old/new number into both the Arabic
            # body and (in practice) the subject.  A generic replacement also
            # prevents a phone placed in the free-text reason from escaping.
            "subject": "طلب تعديل رقم الجوال" if is_hidden_phone_request else _text(row.get("subject")),
            "body": (
                "تم إخفاء تفاصيل طلب تعديل رقم الجوال لعدم توفر صلاحية عرض أرقام الجوال."
                if is_hidden_phone_request else _text(row.get("body"))
            ),
            "sender_type": _text(row.get("sender_type")),
            "created_at": created_at,
            "kind": _text(row.get("kind")),
            "status": status,
        }
        changes = _map_profile_request_changes(row, can_view_phones)
        if changes is not None:
            item["changes"] = changes
        items.append(item)
    return {
        "items": items,
        "total": int(total),
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(items) < int(total),
    }