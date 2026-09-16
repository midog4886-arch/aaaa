"""Permission-scoped, read-only actionable dashboard data."""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException

from .common import db, get_current_user
from utils.auth import resolve_branch_filter
from utils.tenant import DEFAULT_TENANT_SLUG, get_current_tenant_slug


router = APIRouter(prefix="/dashboard", tags=["dashboard"])
RIYADH_TZ = ZoneInfo("Asia/Riyadh")
ITEM_LIMIT = 20


def _as_iso(value) -> str:
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat()
    return str(value or "")


def _optional_string(value):
    return str(value) if value is not None else None


def _as_datetime(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)
    except (TypeError, ValueError):
        return None


def _date_text(value) -> str:
    """Return a concise display date without fabricating an invalid legacy date."""
    text = _as_iso(value)
    return text[:10] if len(text) >= 10 else (text or "تاريخ غير متاح")


async def _all_rows(collection, query: dict, projection: dict, *, sort=None) -> list:
    """Read every matching row. Counts in this endpoint must never be page based."""
    cursor = collection.find(query, projection)
    if sort:
        cursor = cursor.sort(*sort)
    return await cursor.to_list(None)


def _member_is_current(member: dict) -> bool:
    return str(member.get("status") or "active").lower() not in {
        "archived", "deleted", "inactive",
    }


def _same_activity(activity: dict, invoice_item: dict) -> bool:
    """Use IDs first; only use names for legacy rows which lack an ID."""
    activity_id = str(activity.get("activity_id") or "").strip()
    invoice_id = str(invoice_item.get("activity_id") or "").strip()
    if activity_id and invoice_id:
        return activity_id == invoice_id
    activity_name = " ".join(str(activity.get("activity_name") or "").split()).casefold()
    invoice_name = " ".join(str(invoice_item.get("activity_name") or "").split()).casefold()
    return bool(activity_name and invoice_name and activity_name == invoice_name)


def _paid_renewal_exists(
    member: dict, activity: dict, paid_items: list, today: str
) -> bool:
    """Whether a distinct, still-current paid period follows this activity."""
    current_end = str(activity.get("end_date") or "")
    member_id = member.get("id")
    if not member_id or not current_end:
        return False
    for invoice, item in paid_items:
        # A mismatched branch is never evidence of a renewal for this member.
        if member.get("branch_id") and invoice.get("branch_id") != member.get("branch_id"):
            continue
        if item.get("is_product"):
            continue
        item_member_id = item.get("member_id") or invoice.get("member_id")
        if item_member_id != member_id or not _same_activity(activity, item):
            continue
        start_date = str(item.get("start_date") or "")
        end_date = str(item.get("end_date") or "")
        # A longer original invoice is not renewal evidence: off-schedule
        # attendance can move a member's current end date backwards. Only a
        # distinct paid period that STARTS after this window, and has not
        # already ended, suppresses this actionable expiry.
        if start_date > current_end and end_date >= today:
            return True
    return False


async def _expiring_group(branch_id: Optional[str], today: str) -> dict:
    through = (datetime.strptime(today, "%Y-%m-%d").date() + timedelta(days=7)).isoformat()
    scope = {"branch_id": branch_id} if branch_id else {}
    members = await _all_rows(
        db.members,
        {
            **scope,
            "status": {"$nin": ["archived", "deleted", "inactive"]},
            "activities": {"$elemMatch": {
                "status": "active",
                "end_date": {"$gte": today, "$lte": through},
            }},
        },
        {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "branch_id": 1,
         "status": 1, "activities": 1},
    )
    member_ids = [member.get("id") for member in members if member.get("id")]
    if not member_ids:
        return _ready_group("expiring", [])
    # Limit paid-invoice work to the expiring candidates. The top-level member
    # ID covers legacy primary items; items.member_id covers multi-member rows.
    paid_invoices = await _all_rows(
        db.invoices,
        {
            **scope, "status": "paid",
            "$or": [
                {"member_id": {"$in": member_ids}},
                {"items.member_id": {"$in": member_ids}},
            ],
        },
        {"_id": 0, "id": 1, "member_id": 1, "branch_id": 1, "items": 1},
    )
    paid_items_by_member = {member_id: [] for member_id in member_ids}
    for invoice in paid_invoices:
        for item in invoice.get("items") or []:
            item_member_id = item.get("member_id") or invoice.get("member_id")
            if item_member_id in paid_items_by_member:
                paid_items_by_member[item_member_id].append((invoice, item))
    candidates = []
    for member in members:
        if not _member_is_current(member):
            continue
        for ordinal, activity in enumerate(member.get("activities") or []):
            end_date = str(activity.get("end_date") or "")
            if (
                str(activity.get("status") or "").lower() != "active"
                or not (today <= end_date <= through)
                or _paid_renewal_exists(
                    member, activity,
                    paid_items_by_member.get(member.get("id"), []), today,
                )
            ):
                continue
            candidates.append({
                "id": "{}:{}:{}".format(member.get("id") or "", activity.get("activity_id") or ordinal, end_date),
                "title": member.get("name_ar") or member.get("name") or "عضو",
                "detail": "ينتهي {} في {}".format(
                    activity.get("activity_name") or "الاشتراك", end_date),
                "kind": "member",
                "entity_id": _optional_string(member.get("id")),
                "branch_id": _optional_string(member.get("branch_id")),
                "_sort": end_date,
            })
    candidates.sort(key=lambda row: (row["_sort"], row["title"]))
    for row in candidates:
        row.pop("_sort", None)
    return _ready_group("expiring", candidates)


async def _absence_group(branch_id: Optional[str], today: str) -> dict:
    start = (datetime.strptime(today, "%Y-%m-%d").date() - timedelta(days=29)).isoformat()
    scope = {"branch_id": branch_id} if branch_id else {}
    records_task = _all_rows(
        db.attendance,
        {**scope, "status": "absent", "date": {"$gte": start, "$lte": today}},
        {"_id": 0, "id": 1, "member_id": 1, "member_name": 1, "branch_id": 1,
         "date": 1, "status": 1},
    )
    members_task = _all_rows(
        db.members, scope,
        {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "status": 1, "branch_id": 1},
    )
    records, members = await asyncio.gather(records_task, members_task)
    current_members = {m.get("id"): m for m in members if m.get("id") and _member_is_current(m)}
    absent_by_member = {}
    for record in records:
        if str(record.get("status") or "").lower() != "absent":
            continue
        member_id = record.get("member_id")
        if member_id not in current_members:
            continue
        absent_by_member.setdefault(member_id, []).append(record)
    items = []
    for member_id, rows in absent_by_member.items():
        if len(rows) < 3:
            continue
        member = current_members[member_id]
        latest = max(str(r.get("date") or "") for r in rows)
        items.append({
            "id": "absence:{}".format(member_id),
            "title": member.get("name_ar") or member.get("name") or rows[0].get("member_name") or "عضو",
            "detail": "{} غيابات مسجلة خلال 30 يوماً، آخرها {}".format(len(rows), latest),
            "kind": "attendance",
            "entity_id": _optional_string(member_id),
            "branch_id": _optional_string(member.get("branch_id") or rows[0].get("branch_id")),
            "_sort": latest,
        })
    items.sort(key=lambda row: (row["_sort"], row["title"]), reverse=True)
    for row in items:
        row.pop("_sort", None)
    return _ready_group("absence", items)


async def _registrations_group(branch_id: Optional[str]) -> dict:
    # Import the existing read-only normalization rather than recreating its
    # invoice-link semantics (including legacy processed-without-invoice rows).
    from .registration_requests import _normalize_registration_request_rows

    scope = {"branch_id": branch_id} if branch_id else {}
    rows = await _all_rows(
        db.registration_requests, {**scope, "status": {"$in": ["pending", "processed"]}},
        {"_id": 0},
    )
    rows = await _normalize_registration_request_rows(rows)
    items = []
    for request in rows:
        if request.get("status") != "pending":
            continue
        created = _as_iso(request.get("created_at"))
        items.append({
            "id": str(request.get("id") or ""),
            "title": request.get("customer_name") or "طلب تسجيل",
            "detail": "طلب تسجيل قيد المراجعة{}".format(
                " — " + _date_text(created) if created else ""),
            "kind": "registration_request",
            "entity_id": _optional_string(request.get("id")),
            "branch_id": _optional_string(request.get("branch_id")),
            "_sort": created,
        })
    items.sort(key=lambda row: row["_sort"], reverse=True)
    for row in items:
        row.pop("_sort", None)
    return _ready_group("registrations", items)


def _safe_conversation_title(row: dict) -> str:
    # contact_name is often the phone number. Never return a phone from this
    # summary, even when a caller is otherwise entitled to the messages page.
    name = str(row.get("contact_name") or "").strip()
    digits = sum(char.isdigit() for char in name)
    if not name or (digits >= 7 and digits * 2 >= len(name)):
        return "محادثة واردة"
    return name[:200]


async def _conversations_group(branch_id: Optional[str]) -> dict:
    scope = {"branch_id": branch_id} if branch_id else {}
    query = {**scope, "last_direction": "inbound"}
    total_task = db["whatsapp_cloud_conversations"].count_documents(query)
    # This is intentionally a complete count query plus a 21-row display
    # query, not the cloud inbox route's 200-conversation UI pagination.
    rows_task = (
        db["whatsapp_cloud_conversations"]
        .find(query, {"_id": 0, "id": 1, "contact_name": 1, "last_message_at": 1, "branch_id": 1})
        .sort("last_message_at", -1).limit(ITEM_LIMIT + 1).to_list(length=ITEM_LIMIT + 1)
    )
    total, rows = await asyncio.gather(total_task, rows_task)
    items = [{
        "id": str(row.get("id") or ""),
        "title": _safe_conversation_title(row),
        "detail": "آخر رسالة واردة{}".format(
            " — " + _date_text(row.get("last_message_at")) if row.get("last_message_at") else ""),
        "kind": "whatsapp",
        "entity_id": _optional_string(row.get("id")),
        "branch_id": _optional_string(row.get("branch_id")),
    } for row in rows[:ITEM_LIMIT]]
    return {
        "key": "conversations", "count": int(total), "status": "ready",
        "items": items, "has_more": int(total) > len(items),
    }


def _send_time(row: dict):
    for field in (
        "status_updated_at", "completed_at", "updated_at", "delivered_at",
        "read_at", "created_at",
    ):
        value = _as_datetime(row.get(field))
        if value:
            return value
    return None


def _delivery_state(row: dict) -> str:
    return str(
        row.get("delivery_status") or row.get("receipt_status") or row.get("status") or ""
    ).lower()


def _failure_identity(row: dict, source: str) -> str:
    provider_id = row.get("provider_message_id") or row.get("waha_message_id") or row.get("meta_message_id")
    if provider_id:
        # Campaign records and cloud-inbox webhook echoes are two projections
        # of the same provider message. Their identity must deliberately span
        # both collections, while still separating branches/providers.
        return "provider:{}:{}:{}".format(
            row.get("branch_id") or "", row.get("provider") or "", provider_id
        )
    if row.get("job_id") and row.get("recipient_index") is not None:
        return "{}:recipient:{}:{}".format(source, row["job_id"], row["recipient_index"])
    return "{}:id:{}".format(source, row.get("id") or "")


def _confirmed_send_failures(rows: list, since: datetime) -> list:
    """Keep only durable failed outcomes not superseded by delivery evidence."""
    observed = [(source, row, _send_time(row)) for source, row in rows]
    observed = [(source, row, at) for source, row, at in observed if at]
    delivered = set()
    delivered_retries = set()
    for source, row, _ in observed:
        if _delivery_state(row) in {"delivered", "read"}:
            delivered.add(_failure_identity(row, source))
            for field in ("retry_of", "retry_of_id", "supersedes_id", "replaces_id"):
                if row.get(field):
                    delivered_retries.add(str(row[field]))
    by_identity = {}
    for source, row, at in observed:
        if at < since:
            continue
        state = _delivery_state(row)
        # Unknown, pending, and provider-accepted states are deliberately not
        # failures. A durable failed status/receipt is the only evidence used.
        if state != "failed":
            continue
        identity = _failure_identity(row, source)
        if identity in delivered or str(row.get("id") or "") in delivered_retries:
            continue
        # A provider message can exist in both campaign and cloud collections.
        # Return it once, preferring the most recently updated projection.
        previous = by_identity.get(identity)
        if previous is None or at > previous[2]:
            by_identity[identity] = (source, row, at)
    return list(by_identity.values())


def _recent_time_query(since: datetime) -> dict:
    """Mongo predicate for both BSON datetime and legacy ISO-string timestamps."""
    since_iso = since.isoformat()
    variants = []
    for field in (
        "status_updated_at", "completed_at", "updated_at", "delivered_at",
        "read_at", "created_at",
    ):
        variants.extend([
            {"$and": [
                {field: {"$type": "date"}},
                {field: {"$gte": since}},
            ]},
            {"$and": [
                {field: {"$type": "string"}},
                {field: {"$gte": since_iso}},
            ]},
        ])
    return {"$or": variants}


def _provider_message_ids(rows: list) -> list:
    return list({
        str(row.get(field))
        for _, row in rows
        for field in ("provider_message_id", "waha_message_id", "meta_message_id")
        if row.get(field) not in (None, "")
    })


async def _failures_group(branch_id: Optional[str], include_payments: bool) -> dict:
    scope = {"branch_id": branch_id} if branch_id else {}
    since = datetime.now(timezone.utc) - timedelta(days=7)
    # Both sources are durable send records. We intentionally exclude generic
    # send logs: they lack a stable delivery/retry relationship, so including
    # them could report an already-delivered retry as failed.
    campaign_task = _all_rows(
        db["whatsapp_campaign_job_items"], {**scope, "$and": [_recent_time_query(since)]},
        {"_id": 0, "id": 1, "job_id": 1, "recipient_index": 1, "recipient_id": 1,
         "recipient_name": 1, "branch_id": 1, "provider": 1, "provider_message_id": 1,
         "status": 1, "delivery_status": 1, "receipt_status": 1, "error": 1,
         "created_at": 1, "updated_at": 1, "completed_at": 1, "status_updated_at": 1,
         "delivered_at": 1, "read_at": 1,
         "retry_of": 1, "retry_of_id": 1, "supersedes_id": 1, "replaces_id": 1},
    )
    cloud_task = _all_rows(
        db["whatsapp_cloud_messages"],
        {**scope, "direction": "outbound", "$and": [_recent_time_query(since)]},
        {"_id": 0, "id": 1, "conversation_id": 1, "contact_name": 1, "branch_id": 1,
         "provider": 1, "provider_message_id": 1, "waha_message_id": 1,
         "meta_message_id": 1, "status": 1, "delivery_status": 1, "receipt_status": 1,
         "error": 1, "created_at": 1, "updated_at": 1, "completed_at": 1,
         "status_updated_at": 1, "delivered_at": 1, "read_at": 1,
         "retry_of": 1, "retry_of_id": 1,
         "supersedes_id": 1, "replaces_id": 1},
    )
    payment_task = None
    if include_payments:
        from control_db import control_db
        slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
        # Payment events have no branch dimension. This remains deliberately
        # tenant-wide even when the dashboard's branch filter is selected.
        payment_task = control_db.tenants.find_one(
            {"slug": slug}, {"_id": 0, "renewal_history": 1}
        )
    results = await asyncio.gather(
        campaign_task, cloud_task, *([payment_task] if payment_task else [])
    )
    campaign, cloud = results[:2]
    initial_rows = [("campaign", row) for row in campaign] + [("cloud", row) for row in cloud]
    provider_ids = _provider_message_ids(initial_rows)
    if provider_ids:
        # The recent query finds the failed attempt without a lifetime scan.
        # Fetch only its exact provider-ID counterparts so a current delivered
        # webhook echo in the other collection suppresses it as well.
        provider_query = {
            **scope,
            "$or": [
                {"provider_message_id": {"$in": provider_ids}},
                {"waha_message_id": {"$in": provider_ids}},
                {"meta_message_id": {"$in": provider_ids}},
            ],
        }
        campaign_counterparts, cloud_counterparts = await asyncio.gather(
            _all_rows(
                db["whatsapp_campaign_job_items"], provider_query,
                {"_id": 0, "id": 1, "job_id": 1, "recipient_index": 1, "recipient_id": 1,
                 "recipient_name": 1, "branch_id": 1, "provider": 1, "provider_message_id": 1,
                 "status": 1, "delivery_status": 1, "receipt_status": 1, "error": 1,
                 "created_at": 1, "updated_at": 1, "completed_at": 1, "status_updated_at": 1,
                 "delivered_at": 1, "read_at": 1, "retry_of": 1, "retry_of_id": 1,
                 "supersedes_id": 1, "replaces_id": 1},
            ),
            _all_rows(
                db["whatsapp_cloud_messages"],
                {**provider_query, "direction": "outbound"},
                {"_id": 0, "id": 1, "conversation_id": 1, "contact_name": 1, "branch_id": 1,
                 "provider": 1, "provider_message_id": 1, "waha_message_id": 1,
                 "meta_message_id": 1, "status": 1, "delivery_status": 1, "receipt_status": 1,
                 "error": 1, "created_at": 1, "updated_at": 1, "completed_at": 1,
                 "status_updated_at": 1, "delivered_at": 1, "read_at": 1, "retry_of": 1,
                 "retry_of_id": 1, "supersedes_id": 1, "replaces_id": 1},
            ),
        )
        initial_rows.extend(
            [("campaign", row) for row in campaign_counterparts]
            + [("cloud", row) for row in cloud_counterparts]
        )
    failures = _confirmed_send_failures(
        initial_rows, since)
    items = []
    for source, row, at in failures:
        items.append({
            "id": "send:{}".format(row.get("id") or ""),
            "title": _safe_conversation_title({
                "contact_name": row.get("recipient_name")
            }) if row.get("recipient_name") else "إرسال واتساب فاشل",
            "detail": "فشل إرسال مؤكد — {}".format(_date_text(at)),
            "kind": "failed_send",
            "entity_id": _optional_string(row.get("id")),
            "branch_id": _optional_string(row.get("branch_id")),
            "_sort": at,
        })

    note = "تشمل سجلات الإرسال المؤكدة فقط؛ الحالات المعلقة وغير المؤكدة مستبعدة."
    if include_payments:
        tenant = results[2]
        history = list((tenant or {}).get("renewal_history") or [])
        successful_at = [
            _as_datetime(entry.get("renewed_at") or entry.get("date"))
            for entry in history
            if str(entry.get("status") or "paid").lower() in {"paid", "succeeded", "success", "renewed"}
        ]
        for ordinal, entry in enumerate(history):
            at = _as_datetime(entry.get("renewed_at") or entry.get("date"))
            if str(entry.get("status") or "").lower() != "failed" or not at or at < since:
                continue
            # Billing has no branch and a later successful renewal is the
            # authoritative resolution used by the existing billing banner.
            if any(success and success >= at for success in successful_at):
                continue
            reason = str(entry.get("reason") or "").strip()[:160]
            items.append({
                "id": "payment:{}".format(entry.get("id") or ordinal),
                "title": "دفعة اشتراك فاشلة",
                "detail": "فشل دفع اشتراك الأكاديمية — {}{}".format(
                    _date_text(at), " — " + reason if reason else ""),
                "kind": "failed_payment",
                "entity_id": _optional_string(entry.get("id")),
                "branch_id": None,
                "_sort": at,
            })
        note += " تشمل مدفوعات اشتراك الأكاديمية على مستوى كل الفروع."

    items.sort(key=lambda row: row["_sort"], reverse=True)
    total = len(items)
    for row in items:
        row.pop("_sort", None)
    return {
        "key": "failures", "count": total, "status": "ready",
        "items": items[:ITEM_LIMIT], "has_more": total > ITEM_LIMIT, "note": note,
    }


def _ready_group(key: str, items: list) -> dict:
    return {
        "key": key, "count": len(items), "status": "ready",
        "items": items[:ITEM_LIMIT], "has_more": len(items) > ITEM_LIMIT,
    }


async def _safe_group(key: str, loader) -> dict:
    try:
        return await loader()
    except Exception:
        # A failed collection must never be represented as an empty successful
        # result. Details intentionally remain non-sensitive.
        return {
            "key": key, "count": None, "status": "error", "items": [],
            "has_more": False, "note": "تعذر تحميل هذه المجموعة حالياً.",
        }


@router.get("/actions")
async def get_dashboard_actions(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Return only action groups the caller may open in the existing UI."""
    if current_user.get("is_admin", False):
        permissions = None
    else:
        user = await db.users.find_one(
            {"id": current_user.get("user_id")}, {"_id": 0, "permissions": 1}
        )
        permissions = set((user or {}).get("permissions") or [])
        if "dashboard" not in permissions:
            raise HTTPException(status_code=403, detail="الصلاحية 'dashboard' مطلوبة")

    branch_id = resolve_branch_filter(current_user, branch_filter)
    riyadh_now = datetime.now(RIYADH_TZ)
    today = riyadh_now.date().isoformat()
    allowed = lambda permission: permissions is None or permission in permissions

    jobs = []
    # Permission keys exactly match the protected UI routes: Renewals,
    # Attendance, Registration Requests (Invoices), and WhatsApp (Messages).
    if allowed("renewals"):
        jobs.append(("expiring", lambda: _expiring_group(branch_id, today)))
    if allowed("attendance"):
        jobs.append(("absence", lambda: _absence_group(branch_id, today)))
    if allowed("invoices"):
        jobs.append(("registrations", lambda: _registrations_group(branch_id)))
    if allowed("messages"):
        jobs.append(("conversations", lambda: _conversations_group(branch_id)))
    if allowed("messages") or permissions is None:
        # Admins always bypass UI permissions and additionally get the
        # academy-wide billing payment failures.
        jobs.append(("failures", lambda: _failures_group(
            branch_id, permissions is None
        )))

    groups = await asyncio.gather(*[_safe_group(key, loader) for key, loader in jobs])
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "date": today,
        "groups": groups,
    }