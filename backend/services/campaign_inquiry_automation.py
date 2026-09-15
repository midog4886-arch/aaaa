"""Explicit WhatsApp automation for campaign-inquiry CRM records.

Campaign inquiries are intentionally not registration requests.  Importing an
inquiry only creates a manual CRM record; this module is entered only by the
preview/confirmation API.  Once confirmed, all provider work is handed to the
shared ``whatsapp_bulk_jobs`` queue so its branch-wide pacing, delivery
accounting, and conservative unknown-outcome handling remain authoritative.
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from pymongo.errors import DuplicateKeyError

from services import whatsapp_bulk_jobs
from utils.phone import normalize_phone
from utils.tenant import for_each_active_tenant, get_current_tenant_slug


log = logging.getLogger("whatsapp.campaign_inquiry_automation")
RIYADH = ZoneInfo("Asia/Riyadh")

DEFAULT_START_HOUR = 9
DEFAULT_END_HOUR = 21
DEFAULT_TIMEZONE = "Asia/Riyadh"
PREVIEW_TTL_SECONDS = 300
MAX_MESSAGE_LENGTH = 2000
MAX_RECIPIENTS = 100

KIND = "campaign_inquiry_automation"
SOURCE = "campaign_inquiry_automation"
CRM_STOP_STATUSES = {
    "visit",
    "invoiced",
    "paid",
    "not_interested",
    "do_not_contact",
}
TERMINAL_AUTOMATION_STATUSES = {
    "completed",
    "stopped",
    "unknown",
    "failed",
    "cancelled",
}
ACTIVE_AUTOMATION_STATUSES = {
    "scheduled",
    "first_queued",
    "first_sent",
    "second_queued",
    "direct_queued",
}

_db = None
_get_config = None
_started = False


def configure(db, get_config=None):
    """Configure the tenant-local database and branch provider resolver."""
    global _db, _get_config
    _db = db
    if get_config is not None:
        _get_config = get_config


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _tenant() -> str:
    return get_current_tenant_slug() or "default"


async def _to_list(cursor, limit: int):
    """Read Motor and the small positional-argument test cursors alike."""
    try:
        return await cursor.to_list(length=limit)
    except TypeError:
        return await cursor.to_list(limit)


async def _config(branch_id: str) -> dict:
    if _get_config is None:
        return {}
    return (await _get_config(branch_id)) or {}


def _provider_available(config: dict) -> tuple[bool, str]:
    if not config or config.get("provider") != "whatsflow":
        return False, "Whatsflow is not configured"
    if not config.get("enabled"):
        return False, "Whatsflow is disabled"
    if not config.get("whatsflow_instance") or not config.get(
        "whatsflow_api_key_encrypted"
    ):
        return False, "Whatsflow is not configured"
    if str(config.get("whatsflow_state") or "").lower() != "open":
        return False, "Whatsflow is not connected"
    return True, ""


def _settings_values(doc: Optional[dict]) -> dict:
    doc = doc or {}
    return {
        "paused": bool(doc.get("paused", False)),
        "start_hour": int(doc.get("start_hour", DEFAULT_START_HOUR)),
        "end_hour": int(doc.get("end_hour", DEFAULT_END_HOUR)),
        "timezone": DEFAULT_TIMEZONE,
    }


def _settings_scope(branch_id: str) -> dict:
    # Tenant databases are isolated by the proxy.  The tenant is nevertheless
    # stored on every durable token/settings row to make accidental test/proxy
    # misbinding fail closed.
    return {"tenant_slug": _tenant(), "branch_id": branch_id}


async def get_settings(branch_id: str) -> dict:
    doc = await _db["campaign_inquiry_automation_settings"].find_one(
        _settings_scope(branch_id), {"_id": 0}
    )
    settings = _settings_values(doc)
    config = await _config(branch_id)
    available, reason = _provider_available(config)
    result = {
        "available": available,
        "enabled": available,
        **settings,
    }
    if reason:
        result["reason"] = reason
    elif settings["paused"]:
        result["reason"] = "Automation is paused for this branch"
    return result


def validate_hours(start_hour, end_hour) -> tuple[int, int]:
    try:
        start = int(start_hour)
        end = int(end_hour)
    except (TypeError, ValueError):
        raise ValueError("Sending hours must be whole hours")
    # A single bounded daytime window is deliberate.  Supporting an overnight
    # interval would make an accidental 21→9 configuration send overnight.
    if not (0 <= start <= 23 and 1 <= end <= 24 and start < end):
        raise ValueError("Sending hours must be a bounded window with start before end")
    return start, end


async def update_settings(
    branch_id: str,
    *,
    paused=None,
    start_hour=None,
    end_hour=None,
) -> dict:
    existing = await _db["campaign_inquiry_automation_settings"].find_one(
        _settings_scope(branch_id), {"_id": 0}
    )
    current = _settings_values(existing)
    start = current["start_hour"] if start_hour is None else start_hour
    end = current["end_hour"] if end_hour is None else end_hour
    try:
        start, end = validate_hours(start, end)
    except ValueError as exc:
        # Routes translate this stable exception into a bounded 400 response.
        raise ValueError(str(exc)) from exc
    values = {
        **_settings_scope(branch_id),
        "paused": current["paused"] if paused is None else bool(paused),
        "start_hour": start,
        "end_hour": end,
        "timezone": DEFAULT_TIMEZONE,
        "updated_at": _now(),
    }
    await _db["campaign_inquiry_automation_settings"].update_one(
        _settings_scope(branch_id),
        {"$set": values, "$setOnInsert": {"created_at": _now()}},
        upsert=True,
    )
    return await get_settings(branch_id)


def _is_open(moment: datetime, settings: dict) -> bool:
    local = moment.astimezone(RIYADH)
    hour = local.hour + (local.minute / 60)
    return settings["start_hour"] <= hour < settings["end_hour"]


def next_open(moment: datetime, settings: dict) -> datetime:
    local = moment.astimezone(RIYADH)
    if local.hour + (local.minute / 60) < settings["start_hour"]:
        target = local.replace(
            hour=settings["start_hour"], minute=0, second=0, microsecond=0
        )
    else:
        target = (local + timedelta(days=1)).replace(
            hour=settings["start_hour"], minute=0, second=0, microsecond=0
        )
    return target.astimezone(timezone.utc)


def due_within_hours(moment: datetime, settings: dict) -> datetime:
    return moment if _is_open(moment, settings) else next_open(moment, settings)


def _reason(row: dict, *, mode: str, available: bool, paused: bool) -> Optional[str]:
    if not available:
        return "whatsflow_unavailable"
    if paused:
        return "branch_paused"
    if _is_archived(row):
        return "archived"
    phone = normalize_phone(row.get("phone"))
    if not phone:
        return "invalid_phone"
    status = str(row.get("status") or "new").strip().lower()
    if status in CRM_STOP_STATUSES:
        return "crm_status"
    automation_status = str(row.get("automation_status") or "")
    if automation_status == "unknown" or row.get("automation_stop_reason") == "provider_outcome_unknown":
        return "provider_outcome_unknown"
    if mode == "followup" and row.get("automation_enrolled"):
        return "already_enrolled"
    if mode == "direct" and row.get("automation_direct_confirmation_id"):
        return "already_confirmed"
    if automation_status in ACTIVE_AUTOMATION_STATUSES:
        return "already_enrolled"
    return None


async def _rows_by_ids(branch_id: str, inquiry_ids: list[str]) -> list[dict]:
    rows = []
    for inquiry_id in inquiry_ids:
        row = await _db["campaign_inquiries"].find_one(
            {"id": inquiry_id, "branch_id": branch_id}, {"_id": 0}
        )
        rows.append(row)
    return rows


def _clean_message(value, field: str, *, required=True) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise ValueError(f"{field} is required")
    if len(text) > MAX_MESSAGE_LENGTH:
        raise ValueError(f"{field} must be 2000 characters or fewer")
    return text


def _render_message(text: str, name: str) -> str:
    """Apply the sole supported recipient placeholder without HTML templating."""
    return str(text or "").replace("{name}", str(name or "").strip())


def _preview_snapshot(
    *,
    branch_id: str,
    mode: str,
    message: str,
    first_message: str,
    second_message: str,
    recipients: list[dict],
    settings: dict,
    config: dict,
    first_due_at: Optional[str],
    second_due_at: Optional[str],
) -> dict:
    return {
        "tenant_slug": _tenant(),
        "branch_id": branch_id,
        "mode": mode,
        "message": message,
        "first_message": first_message,
        "second_message": second_message,
        "recipients": [
            {
                "id": (row.get("_row") or row)["id"],
                "name": (row.get("_row") or row).get("name") or "",
                "phone": normalize_phone((row.get("_row") or row).get("phone")),
                "status": (row.get("_row") or row).get("status") or "new",
                "automation_status": (row.get("_row") or row).get("automation_status") or "",
                "automation_enrolled": bool(
                    (row.get("_row") or row).get("automation_enrolled")
                ),
            }
            for row in recipients
        ],
        "settings_snapshot": {
            "paused": settings["paused"],
            "start_hour": settings["start_hour"],
            "end_hour": settings["end_hour"],
            "timezone": DEFAULT_TIMEZONE,
        },
        "provider_snapshot": {
            "provider": config.get("provider"),
            "enabled": bool(config.get("enabled")),
            "instance": config.get("whatsflow_instance"),
            "state": config.get("whatsflow_state"),
            # Presence/identity is enough to invalidate config changes without
            # persisting the encrypted credential itself.
            "credential_present": bool(config.get("whatsflow_api_key_encrypted")),
        },
        "first_due_at": first_due_at,
        "second_due_at": second_due_at,
    }


def _identity_matches_snapshot(row: dict) -> bool:
    """Return whether a claimed inquiry still has its approved identity."""
    snapshot_phone = row.get("automation_phone_snapshot")
    snapshot_name = row.get("automation_name_snapshot")
    if not snapshot_phone and snapshot_name is None:
        return True
    return (
        normalize_phone(row.get("phone")) == normalize_phone(snapshot_phone)
        and (row.get("name") or "") == (snapshot_name or "")
    )


def _is_archived(row: dict) -> bool:
    return bool(row.get("archived") or row.get("archived_at") or row.get("deleted_at"))


async def _hard_stop_row(row: dict, branch_id: str, reason: str) -> None:
    """Persist a stop before any queued item can reach a provider."""
    if row.get("automation_status") in TERMINAL_AUTOMATION_STATUSES:
        return
    await _update_inquiry(
        row.get("id"),
        branch_id,
        {
            "automation_status": "stopped",
            "automation_stop_reason": reason,
            "automation_next_due_at": None,
        },
    )


async def _verify_claimed_identity(row: dict, branch_id: str) -> bool:
    if _is_archived(row):
        await _hard_stop_row(row, branch_id, "archived")
        return False
    if (
        row.get("automation_claim_id")
        or row.get("automation_enrolled")
        or row.get("automation_status") in ACTIVE_AUTOMATION_STATUSES
    ) and not row.get("automation_phone_snapshot"):
        await _hard_stop_row(row, branch_id, "identity_snapshot_missing")
        return False
    if not _identity_matches_snapshot(row):
        await _hard_stop_row(row, branch_id, "identity_changed")
        return False
    return True


async def preview(
    branch_id: str,
    inquiry_ids: list[str],
    *,
    mode: str,
    message: str = "",
    first_message: str = "",
    second_message: str = "",
) -> dict:
    if mode not in {"direct", "followup"}:
        raise ValueError("mode must be direct or followup")
    ids = list(dict.fromkeys(str(value).strip() for value in (inquiry_ids or []) if str(value).strip()))
    if not ids or len(ids) > MAX_RECIPIENTS:
        raise ValueError("Select 1-100 inquiries")
    if mode == "direct" and len(ids) != 1:
        raise ValueError("Direct mode accepts exactly one inquiry")
    message = _clean_message(message, "message", required=mode == "direct")
    first_message = _clean_message(first_message, "first_message", required=mode == "followup")
    second_message = _clean_message(second_message, "second_message", required=mode == "followup")

    settings = await get_settings(branch_id)
    config = await _config(branch_id)
    available = bool(settings["available"])
    rows = await _rows_by_ids(branch_id, ids)
    recipients = []
    for row, inquiry_id in zip(rows, ids):
        if not row or row.get("id") != inquiry_id or row.get("branch_id") != branch_id:
            row = {
                "id": inquiry_id,
                "branch_id": branch_id,
                "name": "",
                "phone": "",
                "status": "new",
            }
            reason = "not_found"
        else:
            reason = _reason(
                row,
                mode=mode,
                available=available,
                paused=settings["paused"],
            )
        phone = normalize_phone(row.get("phone"))
        recipients.append(
            {
                "id": inquiry_id,
                "name": row.get("name") or "",
                "phone": phone,
                "eligible": reason is None,
                "reason": reason,
                "_row": row,
            }
        )
    eligible = [row for row in recipients if row["eligible"]]
    now = _now()
    first_due = None
    second_due = None
    if eligible:
        if mode == "direct":
            first_due = due_within_hours(now, settings)
        else:
            first_due = due_within_hours(now + timedelta(hours=24), settings)
            second_due = due_within_hours(now + timedelta(days=3), settings)
    public_recipients = [
        {key: value for key, value in row.items() if key != "_row"}
        for row in recipients
    ]
    preview_id = str(uuid.uuid4())
    expires_at = now + timedelta(seconds=PREVIEW_TTL_SECONDS)
    snapshot = _preview_snapshot(
        branch_id=branch_id,
        mode=mode,
        message=message,
        first_message=first_message,
        second_message=second_message,
        recipients=recipients,
        settings=settings,
        config=config,
        first_due_at=_iso(first_due),
        second_due_at=_iso(second_due),
    )
    await _db["campaign_inquiry_automation_previews"].insert_one(
        {
            "_id": preview_id,
            "preview_id": preview_id,
            **snapshot,
            "expires_at": expires_at,
            "created_at": now,
        }
    )
    return {
        "preview_id": preview_id,
        "expires_at": _iso(expires_at),
        "recipients": public_recipients,
        "eligible_count": len(eligible),
        "first_due_at": _iso(first_due),
        "second_due_at": _iso(second_due),
        "message": message,
        "first_message": first_message,
        "second_message": second_message,
    }


def _same_provider_snapshot(snapshot: dict, config: dict) -> bool:
    expected = snapshot or {}
    return expected == {
        "provider": config.get("provider"),
        "enabled": bool(config.get("enabled")),
        "instance": config.get("whatsflow_instance"),
        "state": config.get("whatsflow_state"),
        "credential_present": bool(config.get("whatsflow_api_key_encrypted")),
    }


async def _confirm_is_stale(preview_doc: dict, settings: dict, config: dict) -> bool:
    expected_settings = preview_doc.get("settings_snapshot") or {}
    current_settings = {
        "paused": settings["paused"],
        "start_hour": settings["start_hour"],
        "end_hour": settings["end_hour"],
        "timezone": DEFAULT_TIMEZONE,
    }
    if expected_settings != current_settings:
        return True
    return not _same_provider_snapshot(preview_doc.get("provider_snapshot"), config)


async def _live_snapshot_matches(preview_doc: dict) -> bool:
    branch_id = preview_doc.get("branch_id")
    for expected in preview_doc.get("recipients") or []:
        row = await _db["campaign_inquiries"].find_one(
            {"id": expected.get("id"), "branch_id": branch_id}, {"_id": 0}
        )
        if not row:
            return False
        if (
            normalize_phone(row.get("phone")) != expected.get("phone")
            or (row.get("name") or "") != expected.get("name", "")
            or (row.get("status") or "new") != expected.get("status", "new")
        ):
            return False
    return True


async def _update_inquiry(inquiry_id: str, branch_id: str, update: dict):
    update = {**update, "updated_at": _now()}
    return await _db["campaign_inquiries"].update_one(
        {"id": inquiry_id, "branch_id": branch_id}, {"$set": update}
    )


async def confirm(branch_id: str, preview_id: str) -> dict:
    preview_doc = await _db["campaign_inquiry_automation_previews"].find_one(
        {
            "preview_id": preview_id,
            "tenant_slug": _tenant(),
            "branch_id": branch_id,
        },
        {"_id": 0},
    )
    if not preview_doc:
        raise LookupError("Preview not found")
    if preview_doc.get("confirmation_result") is not None:
        return preview_doc["confirmation_result"]
    expires = _parse(preview_doc.get("expires_at"))
    if not expires or expires < _now():
        raise TimeoutError("Preview expired")
    config = await _config(branch_id)
    settings = await get_settings(branch_id)
    available, _reason_text = _provider_available(config)
    if not available or not settings["available"]:
        raise ValueError("Whatsflow is unavailable for this branch")
    if await _confirm_is_stale(preview_doc, settings, config):
        raise RuntimeError("Preview is stale; create a new preview")
    if not await _live_snapshot_matches(preview_doc):
        raise RuntimeError("Preview is stale; inquiry data changed")

    mode = preview_doc.get("mode")
    accepted = []
    skipped = []
    now = _now()
    first_due = (
        due_within_hours(now, settings)
        if mode == "direct"
        else due_within_hours(now + timedelta(hours=24), settings)
    )
    second_due = (
        None
        if mode == "direct"
        else due_within_hours(now + timedelta(days=3), settings)
    )
    rows = await _rows_by_ids(
        branch_id,
        [item.get("id") for item in preview_doc.get("recipients") or []],
    )
    recipient_by_id = {
        item.get("id"): item for item in preview_doc.get("recipients") or []
    }
    # Claim each inquiry with a compare-and-set before any queue side effect.
    # Distinct previews therefore resolve to one durable owner rather than
    # racing two provider jobs.
    for item, row in zip(preview_doc.get("recipients") or [], rows):
        if row and row.get("automation_claim_id") == preview_id:
            accepted.append(item.get("id"))
            continue
        reason = _reason(
            row,
            mode=mode,
            available=True,
            paused=settings["paused"],
        )
        if reason:
            skipped.append(item.get("id"))
            continue
        inquiry_id = item.get("id")
        rendered_first = _render_message(
            preview_doc.get("first_message") or "", item.get("name")
        )
        rendered_second = _render_message(
            preview_doc.get("second_message") or "", item.get("name")
        )
        if mode == "direct":
            claim_values = {
                "automation_claim_id": preview_id,
                "automation_claim_mode": "direct",
                "automation_confirmation_id": preview_id,
                "automation_direct_confirmation_id": preview_id,
                "automation_status": "direct_queued",
                "automation_confirmed_at": now,
                "automation_phone_snapshot": item.get("phone"),
                "automation_name_snapshot": item.get("name") or "",
                "automation_message_snapshot": _render_message(
                    preview_doc.get("message") or "", item.get("name")
                ),
                "automation_snapshot_confirmation_id": preview_id,
                "automation_next_due_at": _iso(first_due),
                "automation_stop_reason": None,
            }
        else:
            claim_values = {
                "automation_claim_id": preview_id,
                "automation_claim_mode": "followup",
                "automation_confirmation_id": preview_id,
                "automation_enrolled": True,
                "automation_mode": "followup",
                "automation_status": "scheduled",
                "automation_stop_reason": None,
                "automation_enrolled_at": now,
                "automation_confirmed_at": now,
                "automation_first_due_at": _iso(first_due),
                "automation_second_due_at": _iso(second_due),
                "automation_first_message": rendered_first,
                "automation_second_message": rendered_second,
                "automation_first_message_snapshot": rendered_first,
                "automation_second_message_snapshot": rendered_second,
                "automation_phone_snapshot": item.get("phone"),
                "automation_name_snapshot": item.get("name") or "",
                "automation_snapshot_confirmation_id": preview_id,
                "automation_sent_count": 0,
                "automation_next_due_at": _iso(first_due),
            }
        claim_query = {
            "id": inquiry_id,
            "branch_id": branch_id,
            "phone": row.get("phone"),
            "name": row.get("name") or "",
            "status": row.get("status") or "new",
            "archived": {"$ne": True},
            "archived_at": {"$exists": False},
            "automation_claim_id": {"$exists": False},
            "automation_direct_confirmation_id": {"$exists": False},
            "automation_enrolled": {"$ne": True},
            "automation_status": {
                "$nin": list(ACTIVE_AUTOMATION_STATUSES | TERMINAL_AUTOMATION_STATUSES)
            },
        }
        claimed = await _db["campaign_inquiries"].update_one(
            claim_query,
            {"$set": claim_values},
        )
        if getattr(claimed, "matched_count", 1) == 1:
            accepted.append(inquiry_id)
        else:
            skipped.append(inquiry_id)

    result = {"accepted": len(accepted), "skipped": len(skipped)}
    # Persist the result before direct queue work.  If enqueue crashes after
    # this point, deterministic scheduler recovery can finish it and replaying
    # confirmation remains stable.
    try:
        stored = await _db["campaign_inquiry_automation_previews"].update_one(
            {
                "preview_id": preview_id,
                "tenant_slug": _tenant(),
                "branch_id": branch_id,
                "confirmation_result": {"$exists": False},
            },
            {
                "$set": {
                    "confirmation_result": result,
                    "confirmed_at": now,
                    "accepted_ids": accepted,
                    "skipped_ids": skipped,
                    "confirmation_first_due_at": _iso(first_due),
                    "confirmation_second_due_at": _iso(second_due),
                }
            },
        )
        if getattr(stored, "matched_count", 1) == 0:
            existing = await _db["campaign_inquiry_automation_previews"].find_one(
                {"preview_id": preview_id, "branch_id": branch_id},
                {"_id": 0, "confirmation_result": 1},
            )
            if existing and existing.get("confirmation_result") is not None:
                return existing["confirmation_result"]
    except DuplicateKeyError:
        existing = await _db["campaign_inquiry_automation_previews"].find_one(
            {"preview_id": preview_id, "branch_id": branch_id},
            {"_id": 0, "confirmation_result": 1},
        )
        if existing and existing.get("confirmation_result") is not None:
            return existing["confirmation_result"]
        raise
    if mode == "direct" and accepted:
        inquiry_id = accepted[0]
        recipient = recipient_by_id[inquiry_id]
        claimed_row = await _db["campaign_inquiries"].find_one(
            {"id": inquiry_id, "branch_id": branch_id}, {"_id": 0}
        )
        if not claimed_row or not await _verify_claimed_identity(claimed_row, branch_id):
            return result
        idempotency = f"campaign-inquiry-{branch_id}-{inquiry_id}-direct"
        try:
            job, _created = await whatsapp_bulk_jobs.enqueue(
                branch_id,
                "whatsflow",
                [
                    {
                        "phone": recipient["phone"],
                        "message": _render_message(
                            preview_doc.get("message") or "", recipient.get("name")
                        ),
                        "communication_kind": KIND,
                        "source": SOURCE,
                        "source_metadata": {
                            "inquiry_id": inquiry_id,
                            "sequence": 0,
                            "confirmation_id": preview_id,
                        },
                        "recipient_id": inquiry_id,
                        "recipient_name": recipient.get("name") or "",
                        "next_attempt_at": first_due,
                    }
                ],
                idempotency,
                kind=KIND,
                source=SOURCE,
            )
            await _update_inquiry(
                inquiry_id,
                branch_id,
                {"automation_last_job_id": (job or {}).get("id")},
            )
        except Exception as exc:
            log.error(
                "Campaign direct enqueue deferred for inquiry %s: %s",
                inquiry_id,
                type(exc).__name__,
            )
    return result


async def stop_phone(branch_id: str, phone: str, reason: str = "manual_stop"):
    """Stop active automation for one normalized person in one branch."""
    if _db is None:
        return
    normalized = normalize_phone(phone)
    if not normalized:
        return
    rows = await _to_list(
        _db["campaign_inquiries"].find({"branch_id": branch_id}, {"_id": 0}),
        5000,
    )
    for row in rows:
        if normalize_phone(row.get("phone")) != normalized:
            continue
        if row.get("automation_enrolled") or row.get("automation_status") in ACTIVE_AUTOMATION_STATUSES:
            await _update_inquiry(
                row.get("id"),
                branch_id,
                {
                    "automation_status": "stopped",
                    "automation_stop_reason": reason,
                    "automation_next_due_at": None,
                },
            )


async def note_customer_message(branch_id: str, phone: str, body: str = ""):
    lowered = " ".join(str(body or "").strip().lower().split())
    opted_out = any(
        term in lowered
        for term in (
            "stop",
            "unsubscribe",
            "opt out",
            "optout",
            "cancel",
            "إلغاء",
            "الغاء",
            "عدم التواصل",
        )
    )
    await stop_phone(
        branch_id,
        phone,
        "opted_out" if opted_out else "customer_replied",
    )


async def note_outbound(
    branch_id: str,
    phone: str,
    provider_message_id: str = "",
    provider: str = "",
):
    """Stop only when the outbound echo is reliably human.

    Exact campaign IDs and an in-flight campaign dispatch are automation
    evidence.  Neither is treated as staff contact; all other authenticated
    phone echoes are reliable human contact for this branch.
    """
    normalized = normalize_phone(phone)
    if not normalized or _db is None:
        return
    jobs = _db["whatsapp_campaign_job_items"]
    if provider_message_id:
        exact = await jobs.find_one(
            {
                "branch_id": branch_id,
                "provider": provider or "whatsflow",
                "provider_message_id": provider_message_id,
                "communication_kind": KIND,
            },
            {"_id": 1},
        )
        if exact:
            return
    pending = await _to_list(
        jobs.find(
            {
                "branch_id": branch_id,
                "communication_kind": KIND,
                "status": "dispatching",
            },
            {"_id": 0, "phone": 1},
        ),
        1000,
    )
    if any(normalize_phone(row.get("phone")) == normalized for row in pending):
        return
    await stop_phone(branch_id, normalized, "staff_contacted")


async def note_crm_status(branch_id: str, phone: str, status: str):
    if str(status or "").strip().lower() in CRM_STOP_STATUSES:
        await stop_phone(branch_id, phone, "crm_status")


async def stop_inquiry(branch_id: str, inquiry_id: str, reason: str = "manual_stop"):
    if _db is None:
        return
    row = await _db["campaign_inquiries"].find_one(
        {"id": inquiry_id, "branch_id": branch_id}, {"_id": 0}
    )
    if row:
        await _hard_stop_row(row, branch_id, reason)


async def note_identity_edit(branch_id: str, inquiry_id: str):
    """Archive/stop an approved sequence when its identity is edited."""
    if _db is None:
        return
    row = await _db["campaign_inquiries"].find_one(
        {"id": inquiry_id, "branch_id": branch_id}, {"_id": 0}
    )
    if row and row.get("automation_status") in ACTIVE_AUTOMATION_STATUSES:
        await _verify_claimed_identity(row, branch_id)


async def _find_item(item: dict) -> Optional[dict]:
    inquiry_id = (item.get("source_metadata") or {}).get("inquiry_id")
    if not inquiry_id:
        return None
    return await _db["campaign_inquiries"].find_one(
        {"id": inquiry_id, "branch_id": item.get("branch_id")}, {"_id": 0}
    )


async def authorize_dispatch(item: dict) -> dict:
    if item.get("communication_kind") != KIND:
        return {"action": "send"}
    row = await _find_item(item)
    if not row:
        return {"action": "cancel", "reason": "inquiry_not_found"}
    if not await _verify_claimed_identity(row, item.get("branch_id")):
        return {"action": "cancel", "reason": "automation_stopped"}
    snapshot_phone = normalize_phone(row.get("automation_phone_snapshot"))
    if snapshot_phone and snapshot_phone != normalize_phone(item.get("phone")):
        await _hard_stop_row(row, item.get("branch_id"), "identity_changed")
        return {"action": "cancel", "reason": "identity_changed"}
    status = row.get("automation_status")
    if str(row.get("status") or "").strip().lower() in CRM_STOP_STATUSES:
        return {"action": "cancel", "reason": "crm_status"}
    if (
        status in TERMINAL_AUTOMATION_STATUSES
        or row.get("automation_stop_reason")
        or (
            status == "first_sent"
            and int((item.get("source_metadata") or {}).get("sequence") or 0) != 2
        )
    ):
        return {"action": "cancel", "reason": row.get("automation_stop_reason") or "automation_stopped"}
    settings = await get_settings(item.get("branch_id"))
    if not settings["available"]:
        return {"action": "defer", "until": _now() + timedelta(minutes=5)}
    if settings["paused"]:
        return {"action": "defer", "until": _now() + timedelta(minutes=1)}
    now = _now()
    if not _is_open(now, settings):
        return {"action": "defer", "until": next_open(now, settings)}
    return {"action": "send"}


async def recheck_dispatch(item: dict) -> bool:
    if item.get("communication_kind") != KIND:
        return True
    row = await _find_item(item)
    if not row:
        return False
    if not await _verify_claimed_identity(row, item.get("branch_id")):
        return False
    snapshot_phone = normalize_phone(row.get("automation_phone_snapshot"))
    if snapshot_phone and snapshot_phone != normalize_phone(item.get("phone")):
        await _hard_stop_row(row, item.get("branch_id"), "identity_changed")
        return False
    if (
        row.get("automation_stop_reason")
        or row.get("automation_status") in TERMINAL_AUTOMATION_STATUSES
        or str(row.get("status") or "").strip().lower() in CRM_STOP_STATUSES
    ):
        return False
    if not row.get("automation_enrolled") and int(
        (item.get("source_metadata") or {}).get("sequence") or 0
    ) != 0:
        return False
    settings = await get_settings(item.get("branch_id"))
    if not settings["available"] or settings["paused"] or not _is_open(_now(), settings):
        return False
    return True


async def completed(item: dict, status: str):
    if item.get("communication_kind") != KIND:
        return
    row = await _find_item(item)
    if not row:
        return
    if not await _verify_claimed_identity(row, item.get("branch_id")):
        return
    snapshot_phone = normalize_phone(row.get("automation_phone_snapshot"))
    if snapshot_phone and snapshot_phone != normalize_phone(item.get("phone")):
        await _hard_stop_row(row, item.get("branch_id"), "identity_changed")
        return
    metadata = item.get("source_metadata") or {}
    sequence = int(metadata.get("sequence") or 0)
    if status == "sent":
        # A person reply/manual contact may win the race after the provider
        # accepted the request but before the completion callback runs.  Keep
        # the durable stop marker authoritative and never resurrect follow-up.
        if row.get("automation_stop_reason") or row.get("automation_status") == "stopped":
            return
        if sequence == 0:
            await _update_inquiry(
                row["id"],
                item["branch_id"],
                {
                    "automation_status": "completed",
                    "automation_stop_reason": None,
                    "automation_next_due_at": None,
                    "automation_direct_sent_at": _now(),
                    "automation_sent_count": 1,
                },
            )
        elif sequence == 1:
            await _update_inquiry(
                row["id"],
                item["branch_id"],
                {
                    "automation_status": "first_sent",
                    "automation_sent_count": 1,
                    "automation_first_sent_at": _now(),
                    "automation_next_due_at": row.get("automation_second_due_at"),
                },
            )
        elif sequence == 2:
            await _update_inquiry(
                row["id"],
                item["branch_id"],
                {
                    "automation_status": "completed",
                    "automation_sent_count": 2,
                    "automation_second_sent_at": _now(),
                    "automation_next_due_at": None,
                },
            )
    elif status == "unknown":
        if row.get("automation_stop_reason") or row.get("automation_status") == "stopped":
            return
        await _update_inquiry(
            row["id"],
            item["branch_id"],
            {
                "automation_status": "unknown",
                "automation_stop_reason": "provider_outcome_unknown",
                "automation_next_due_at": None,
            },
        )
    elif status == "blocked":
        # whatsapp_bulk_jobs keeps the item pending when provider configuration
        # is unavailable.  Preserve explicit work rather than turning a
        # temporary branch outage into a provider failure.
        if row.get("automation_stop_reason") or row.get("automation_status") == "stopped":
            return
        if sequence == 0:
            values = {
                "automation_status": "direct_queued",
                "automation_next_due_at": None,
            }
        elif sequence == 1:
            values = {
                "automation_status": "scheduled",
                "automation_next_due_at": row.get("automation_first_due_at"),
            }
        else:
            values = {
                "automation_status": "first_sent",
                "automation_next_due_at": row.get("automation_second_due_at"),
            }
        await _update_inquiry(row["id"], item["branch_id"], values)
    elif status in {"failed", "cancelled"}:
        # Failed provider acceptance is not a reason to silently continue a
        # sequence.  A branch/provider can be fixed and a new explicit preview
        # can authorize a fresh attempt.
        if row.get("automation_stop_reason") or row.get("automation_status") == "stopped":
            return
        await _update_inquiry(
            row["id"],
            item["branch_id"],
            {
                "automation_status": "stopped" if status == "cancelled" else "failed",
                "automation_stop_reason": (
                    "crm_status"
                    if str(row.get("status") or "").strip().lower() in CRM_STOP_STATUSES
                    else (
                        "automation_stopped"
                        if status == "cancelled"
                        else "provider_rejected"
                    )
                ),
                "automation_next_due_at": None,
            },
        )


async def schedule_due():
    """Enqueue immutable, explicitly enrolled work through the shared queue."""
    if _db is None:
        return
    rows = await _to_list(
        _db["campaign_inquiries"].find(
            {
                "$or": [
                    {"automation_enrolled": True},
                    {"automation_status": "direct_queued"},
                ]
            },
            {"_id": 0},
        ),
        5000,
    )
    now = _now()
    for row in rows:
        status = row.get("automation_status")
        if status in TERMINAL_AUTOMATION_STATUSES or row.get("automation_stop_reason"):
            continue
        branch_id = row.get("branch_id")
        if not await _verify_claimed_identity(row, branch_id):
            continue
        config = await _config(branch_id)
        available, _reason_text = _provider_available(config)
        if not available:
            # Keep an explicit enrollment visible without manufacturing jobs
            # while a branch is unavailable.  It can be reviewed manually.
            continue
        settings = await get_settings(branch_id)
        if settings["paused"]:
            continue
        if (
            status == "direct_queued"
            and row.get("automation_direct_confirmation_id")
            and not row.get("automation_last_job_id")
            and (_parse(row.get("automation_next_due_at")) or now) <= now
        ):
            sequence = 0
            message = row.get("automation_message_snapshot") or ""
            target_field = "automation_last_job_id"
            next_status = "direct_queued"
        elif status == "scheduled" and (_parse(row.get("automation_first_due_at")) or now) <= now:
            sequence = 1
            message = row.get("automation_first_message_snapshot") or row.get(
                "automation_first_message"
            ) or ""
            target_field = "automation_first_job_id"
            next_status = "first_queued"
        elif status == "first_sent" and (_parse(row.get("automation_second_due_at")) or now) <= now:
            sequence = 2
            message = row.get("automation_second_message_snapshot") or row.get(
                "automation_second_message"
            ) or ""
            target_field = "automation_second_job_id"
            next_status = "second_queued"
        else:
            continue
        if row.get(target_field):
            continue
        inquiry_id = row.get("id")
        confirmation_id = row.get("automation_confirmation_id") or "enrolled"
        if sequence == 0:
            idempotency = f"campaign-inquiry-{branch_id}-{inquiry_id}-direct"
        else:
            idempotency = f"campaign-inquiry-{inquiry_id}-{confirmation_id}-s{sequence}"
        recipient = {
            "phone": normalize_phone(row.get("automation_phone_snapshot")),
            "message": message,
            "communication_kind": KIND,
            "source": SOURCE,
            "source_metadata": {
                "inquiry_id": inquiry_id,
                "sequence": sequence,
                "confirmation_id": confirmation_id,
            },
            "recipient_id": inquiry_id,
            "recipient_name": row.get("automation_name_snapshot") or "",
        }
        job, _created = await whatsapp_bulk_jobs.enqueue(
            branch_id,
            "whatsflow",
            [recipient],
            idempotency,
            kind=KIND,
            source=SOURCE,
        )
        await _update_inquiry(
            inquiry_id,
            branch_id,
            {
                target_field: (job or {}).get("id"),
                "automation_status": next_status,
                "automation_next_due_at": (
                    row.get("automation_second_due_at") if sequence == 1 else None
                ),
            },
        )


async def _tenant_tick(_tenant):
    await schedule_due()


async def _loop():
    while True:
        try:
            await for_each_active_tenant(_tenant_tick, label="campaign-inquiry-automation")
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            return
        except Exception as exc:
            log.error("Campaign inquiry automation scheduler error: %s", type(exc).__name__)
            await asyncio.sleep(60)


def start_worker():
    global _started
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("ENVIRONMENT", "").lower() == "test":
        return
    if not _started:
        _started = True
        asyncio.ensure_future(_loop())
