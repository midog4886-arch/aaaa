"""New-registration WhatsApp follow-ups.

Enrollment is explicit on newly-created documents.  This module deliberately
never derives enrollment from ``created_at`` so legacy registration requests
cannot be contacted by a migration or scheduler scan.
"""
import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pymongo.errors import DuplicateKeyError

from services import whatsapp_bulk_jobs
from utils.tenant import for_each_active_tenant

log = logging.getLogger("whatsapp.registration_followups")
RIYADH = ZoneInfo("Asia/Riyadh")
_db = None
_get_config = None
_started = False

STOP_STATUSES = {"processed", "rejected", "archived", "deleted"}
STAFF_CONTACT_REASONS = {"contacted", "staff_contacted"}
PRESERVE_ON_REQUEST_CLOSE = {
    "contacted", "staff_contacted", "opted_out", "customer_replied", "replied",
}
RETRYABLE_BLOCK_REASONS = {
    "provider_unavailable",
    "compatible_provider_unavailable",
    "branch_send_lane_frozen",
}
OPTOUT_WORDS = {
    "stop", "unsubscribe", "optout", "opt out", "cancel", "الغاء", "إلغاء",
    "قف", "توقف", "لا ترسل", "عدم التواصل",
}


def normalize_phone(phone: str) -> str:
    value = str(phone or "").translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    digits = "".join(c for c in value if c.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("05") and len(digits) == 10:
        digits = "966" + digits[1:]
    elif digits.startswith("5") and len(digits) == 9:
        digits = "966" + digits
    elif digits.startswith("01") and len(digits) == 11:
        digits = "20" + digits[1:]
    return digits if 9 <= len(digits) <= 15 and not digits.startswith("0") else ""


def enrollment_fields(now=None) -> dict:
    """Fields placed only on a public request at its original insert."""
    now = now or datetime.now(timezone.utc)
    return {
        "followup_enrolled": True,
        "followup_status": "scheduled",
        "followup_stop_reason": None,
        "followup_sent_count": 0,
        "followup_enrolled_at": now.isoformat(),
    }


async def enrollment_fields_for_new(branch_id: str, phone: str, now=None) -> dict:
    """Enroll a brand-new submission without restarting an existing phone sequence."""
    fields = enrollment_fields(now)
    normalized = normalize_phone(phone)
    fields["followup_normalized_phone"] = normalized
    if not normalized:
        fields.update(followup_status="blocked", followup_stop_reason="invalid_phone")
        return fields
    stop = await _db["registration_followup_stops"].find_one(
        {"phone": normalized}) if _db is not None else None
    if stop:
        fields.update(followup_status="stopped",
                      followup_stop_reason=stop.get("reason") or "stopped")
        return fields
    existing = await _db["registration_requests"].find(
        {"followup_enrolled": True, "followup_normalized_phone": normalized},
        {"_id": 0, "followup_sent_count": 1, "followup_status": 1,
         "followup_stop_reason": 1},
    ).to_list(length=200) if _db is not None else []
    sent = max((int(row.get("followup_sent_count") or 0) for row in existing), default=0)
    if sent >= 2 or any(row.get("followup_status") == "completed" for row in existing):
        fields.update(followup_status="completed", followup_sent_count=2)
    elif sent == 1:
        fields.update(followup_status="first_sent", followup_sent_count=1)
    elif any(row.get("followup_status") == "unknown" for row in existing):
        fields.update(followup_status="unknown",
                      followup_stop_reason="provider_outcome_unknown")
    return fields


def configure(db, get_config):
    global _db, _get_config
    _db, _get_config = db, get_config


def _parse(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _quiet_adjust(moment: datetime) -> datetime:
    local = moment.astimezone(RIYADH)
    if local.hour < 10:
        local = local.replace(hour=10, minute=0, second=0, microsecond=0)
    elif local.hour >= 20:
        local = (local + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    return local.astimezone(timezone.utc)


def _message(rows: list, sequence: int) -> str:
    names = []
    activities = []
    for row in rows:
        name = (row.get("customer_name") or "").strip()
        activity = (row.get("activity_name") or "").strip()
        if name and name not in names:
            names.append(name)
        if activity and activity not in activities:
            activities.append(activity)
    who = "، ".join(names)
    acts = "، ".join(activities)
    if sequence == 1:
        ar = f"أهلاً وسهلاً{(' ' + who) if who else ''} 👋\nشكراً لاهتمامكم بالتسجيل"
        en = f"Hello{(' ' + who) if who else ''} 👋\nThank you for your registration interest"
        if acts:
            ar += f" في: {acts}"
            en += f" in: {acts}"
        return ar + ". يسعد فريقنا مساعدتكم في الخطوة التالية.\n\n— English —\n" + en + ". Our team will be happy to help with the next step."
    ar = f"مرحباً{(' ' + who) if who else ''}، هذه متابعتنا الأخيرة بخصوص طلب التسجيل"
    en = f"Hello{(' ' + who) if who else ''}, this is our final follow-up about your registration request"
    if acts:
        ar += f" في: {acts}"
        en += f" for: {acts}"
    return ar + ". إذا رغبتم بالمتابعة فنحن هنا لمساعدتكم 🌟\n\n— English —\n" + en + ". If you would like to continue, we are here to help 🌟"


async def _live_rows(branch_id: str, phone: str) -> list:
    rows = await _db["registration_requests"].find({
        "branch_id": branch_id,
        "followup_enrolled": True,
        "followup_status": {"$in": ["scheduled", "first_sent", "blocked"]},
        "status": {"$nin": list(STOP_STATUSES)},
    }, {"_id": 0}).to_list(length=2000)
    return [
        r for r in rows
        if normalize_phone(r.get("customer_phone")) == phone
        and (
            r.get("followup_status") != "blocked"
            or r.get("followup_stop_reason") in RETRYABLE_BLOCK_REASONS
        )
    ]


async def _canonical_branch(phone: str):
    rows = await _db["registration_requests"].find(
        {"followup_enrolled": True, "followup_normalized_phone": phone},
        {"_id": 0, "branch_id": 1, "created_at": 1},
    ).to_list(length=2000)
    if not rows:
        return None
    rows.sort(key=lambda r: _parse(r.get("created_at")) or datetime.max.replace(tzinfo=timezone.utc))
    return rows[0].get("branch_id")


async def stop_phone(branch_id: str, phone: str, reason: str, *, persistent=False):
    if _db is None:
        return
    phone = normalize_phone(phone)
    if not phone:
        return
    now = datetime.now(timezone.utc)
    effective_reason = reason
    # A staff contact is durable evidence for the history tab.  Processing or
    # archiving the request afterwards must not erase that evidence by
    # replacing it with the generic request_closed reason.
    if reason == "request_closed":
        existing_stop = await _db["registration_followup_stops"].find_one(
            {"phone": phone}
        )
        contacted_request = await _db["registration_requests"].find_one(
            {
                "followup_enrolled": True,
                "followup_normalized_phone": phone,
                "followup_staff_contacted_at": {"$exists": True},
            },
            {"_id": 1},
        )
        existing_reason = (existing_stop or {}).get("reason")
        if existing_reason in PRESERVE_ON_REQUEST_CLOSE:
            effective_reason = existing_reason
        elif contacted_request:
            effective_reason = "staff_contacted"
    effective_persistent = bool(
        persistent
        or (existing_stop or {}).get("persistent", False)
        or effective_reason == "opted_out"
    ) if reason == "request_closed" else bool(persistent)
    await _db["registration_followup_stops"].update_one(
        {"phone": phone},
        {"$set": {"reason": effective_reason, "persistent": effective_persistent, "updated_at": now},
         "$setOnInsert": {"created_at": now, "origin_branch_id": branch_id}},
        upsert=True,
    )
    values = {
        "followup_status": "stopped",
        "followup_stop_reason": effective_reason,
        "followup_stopped_at": now.isoformat(),
    }
    if reason in STAFF_CONTACT_REASONS:
        values["followup_staff_contacted_at"] = now.isoformat()
    await _db["registration_requests"].update_many(
        {"followup_enrolled": True, "followup_normalized_phone": phone,
         "followup_status": {"$in": ["scheduled", "first_sent", "blocked"]}},
        {"$set": values},
    )


async def stop_request(request: dict, reason: str):
    phone = normalize_phone(request.get("customer_phone"))
    # Explicitly stopping a legacy row is allowed and prevents future enrollment
    # logic from ever contacting this phone.
    await stop_phone(request.get("branch_id"), phone, reason, persistent=reason == "opted_out")
    effective_reason = reason
    if reason == "request_closed":
        refreshed = await _db["registration_requests"].find_one(
            {"id": request["id"]},
            {"_id": 0, "followup_stop_reason": 1, "followup_staff_contacted_at": 1},
        )
        if (
            (refreshed or {}).get("followup_stop_reason") in PRESERVE_ON_REQUEST_CLOSE
            or (refreshed or {}).get("followup_staff_contacted_at")
        ):
            effective_reason = (
                (refreshed or {}).get("followup_stop_reason")
                or "staff_contacted"
            )
    now = datetime.now(timezone.utc).isoformat()
    values = {
        "followup_status": "stopped",
        "followup_stop_reason": effective_reason,
        "followup_stopped_at": now,
    }
    if reason in STAFF_CONTACT_REASONS:
        values["followup_staff_contacted_at"] = now
    await _db["registration_requests"].update_one(
        {"id": request["id"]},
        {"$set": values},
    )


async def note_customer_message(branch_id: str, phone: str, body: str = ""):
    lowered = " ".join((body or "").strip().lower().split())
    opted_out = any(word in lowered for word in OPTOUT_WORDS)
    await stop_phone(branch_id, phone, "opted_out" if opted_out else "customer_replied",
                     persistent=opted_out)


async def is_system_outbound(branch_id: str, phone: str, provider_message_id: str,
                             provider: str = "") -> bool:
    if _db is None:
        return False
    phone = normalize_phone(phone)
    if not provider_message_id:
        return False
    query = {
        "communication_kind": "registration_followup",
        "provider_message_id": provider_message_id,
    }
    if provider:
        query["provider"] = provider
    return bool(await _db["whatsapp_campaign_job_items"].find_one(query, {"_id": 1}))


async def _has_inflight_system_send(phone: str, provider: str = "") -> bool:
    query = {
        "phone": normalize_phone(phone),
        "communication_kind": "registration_followup",
        "status": "dispatching",
    }
    if provider:
        query["provider"] = provider
    return bool(await _db["whatsapp_campaign_job_items"].find_one(query, {"_id": 1}))


async def _has_unresolved_outbound(phone: str) -> bool:
    return bool(await _db["registration_followup_outbound_observations"].find_one({
        "phone": normalize_phone(phone), "status": "unresolved",
    }, {"_id": 1}))


async def note_outbound(branch_id: str, phone: str, provider_message_id: str = "",
                        provider: str = ""):
    """Classify a linked-phone outbound echo without guessing across races.

    A provider webhook can beat persistence of the provider ID returned by the
    send call. While a relevant dispatch is in flight, retain that observation
    durably and let completion reconcile exact IDs. A mismatching observation
    is then genuine staff contact. With no in-flight dispatch, it is staff
    contact immediately.
    """
    phone = normalize_phone(phone)
    if await is_system_outbound(branch_id, phone, provider_message_id, provider):
        return
    if provider_message_id and await _has_inflight_system_send(phone, provider):
        observations = _db["registration_followup_outbound_observations"]
        await observations.create_index(
            [("provider", 1), ("provider_message_id", 1)], unique=True
        )
        try:
            await observations.insert_one({
                "id": str(uuid.uuid4()), "phone": phone,
                "origin_branch_id": branch_id, "provider": provider,
                "provider_message_id": provider_message_id,
                "status": "unresolved", "created_at": datetime.now(timezone.utc),
            })
        except DuplicateKeyError:
            pass
        return
    await stop_phone(branch_id, phone, "staff_contacted")


async def _reconcile_outbound_observations(item: dict, outcome: str) -> bool:
    """Return True when a durable observation proves/conservatively implies staff contact."""
    phone = normalize_phone(item.get("phone"))
    observations = _db["registration_followup_outbound_observations"]
    rows = await observations.find(
        {"phone": phone, "status": "unresolved"}, {"_id": 0}
    ).to_list(length=200)
    if not rows:
        return False
    known_id = str(item.get("provider_message_id") or "")
    provider = item.get("provider") or ""
    staff_seen = False
    now = datetime.now(timezone.utc)
    for row in rows:
        exact = bool(
            known_id
            and row.get("provider_message_id") == known_id
            and (not provider or row.get("provider") == provider)
        )
        resolution = "system" if exact else "staff_contact"
        # Unknown/no-ID outcomes can never safely bless an observation as the
        # app's own send. A known exact ID is safe even during crash recovery.
        if outcome == "unknown" and not exact:
            resolution = "staff_contact"
        await observations.update_one(
            {"id": row["id"], "status": "unresolved"},
            {"$set": {"status": resolution, "resolved_at": now}},
        )
        staff_seen = staff_seen or resolution == "staff_contact"
    if staff_seen:
        await stop_phone(item.get("branch_id"), phone, "staff_contacted")
    return staff_seen


async def schedule_due():
    rows = await _db["registration_requests"].find({
        "followup_enrolled": True,
        "followup_status": {"$in": ["scheduled", "first_sent", "blocked"]},
    }, {"_id": 0}).to_list(length=5000)
    grouped = {}
    for row in rows:
        phone = normalize_phone(row.get("customer_phone"))
        if not phone:
            await _db["registration_requests"].update_one(
                {"id": row["id"]}, {"$set": {"followup_status": "blocked",
                                              "followup_stop_reason": "invalid_phone"}})
            continue
        if row.get("followup_normalized_phone") != phone:
            await _db["registration_requests"].update_one(
                {"id": row["id"]}, {"$set": {"followup_normalized_phone": phone}})
        grouped.setdefault(phone, []).append(row)
    now = datetime.now(timezone.utc)
    for phone, group in grouped.items():
        group.sort(key=lambda r: _parse(r.get("created_at")) or datetime.max.replace(tzinfo=timezone.utc))
        branch_id = group[0].get("branch_id")
        # The oldest explicitly enrolled request owns the sender branch. Payload
        # facts stay inside that branch even though safety state is tenant-wide.
        live = [
            r for r in group
            if r.get("branch_id") == branch_id
            and r.get("status") not in STOP_STATUSES
            and (
                r.get("followup_status") != "blocked"
                or r.get("followup_stop_reason") in RETRYABLE_BLOCK_REASONS
            )
        ]
        if not live:
            canonical_active = [
                r for r in group
                if r.get("branch_id") == branch_id
                and r.get("status") not in STOP_STATUSES
            ]
            if canonical_active:
                # Terminal blocked outcomes (provider rejection, invalid phone,
                # etc.) stay visible and are never silently converted/retried.
                continue
            await stop_phone(branch_id, phone, "request_closed")
            continue
        stop = await _db["registration_followup_stops"].find_one(
            {"phone": phone})
        if stop:
            await stop_phone(branch_id, phone, stop.get("reason") or "stopped",
                             persistent=stop.get("persistent", False))
            continue
        created = min(filter(None, (_parse(r.get("created_at")) for r in live)), default=None)
        if not created:
            # Explicitly enrolled malformed rows are visible, never guessed.
            await _set_group(branch_id, phone, "blocked", "missing_creation_time")
            continue
        sent_count = max(int(r.get("followup_sent_count") or 0) for r in live)
        sequence = 2 if sent_count else 1
        target = created + (timedelta(days=3) if sequence == 2 else timedelta(hours=24))
        if sequence == 2:
            first_sent_values = [
                _parse(r.get("followup_first_sent_at")) for r in live
                if r.get("followup_first_sent_at")
            ]
            first_sent = max(filter(None, first_sent_values), default=None)
            if first_sent:
                first_local = first_sent.astimezone(RIYADH)
                next_calendar_day = (first_local + timedelta(days=1)).replace(
                    hour=10, minute=0, second=0, microsecond=0
                ).astimezone(timezone.utc)
                target = max(target, next_calendar_day)
        due = _quiet_adjust(target)
        config = await _get_config(branch_id)
        provider = (config or {}).get("provider")
        if provider not in {"waha", "whatsflow"}:
            await _set_group(branch_id, phone, "blocked", "compatible_provider_unavailable")
            continue
        lane = await _db["whatsapp_campaign_rate_gates"].find_one({"_id": branch_id})
        if lane and lane.get("frozen"):
            await _set_group(branch_id, phone, "blocked", "branch_send_lane_frozen")
            continue
        recipient = {
            "phone": phone, "message": _message(live, sequence),
            "communication_kind": "registration_followup",
            "source": "new_registration_followup",
            "source_metadata": {"sequence": sequence, "request_ids": [r["id"] for r in live]},
            "next_attempt_at": due,
        }
        await whatsapp_bulk_jobs.enqueue(
            branch_id, provider, [recipient],
            f"registration-followup-{branch_id}-{phone}-{sequence}",
            kind="registration_followup", source="new_registration_followup",
        )


async def _set_group(branch_id, phone, status, reason=None, sent_count=None):
    update = {"followup_status": status, "followup_stop_reason": reason}
    if sent_count is not None:
        update["followup_sent_count"] = sent_count
    await _db["registration_requests"].update_many(
        {"followup_enrolled": True, "followup_normalized_phone": phone},
        {"$set": update},
    )


async def authorize_dispatch(item: dict):
    """Called while the branch pacing lease is held."""
    kind = item.get("communication_kind") or "marketing"
    phone = normalize_phone(item.get("phone"))
    now = datetime.now(timezone.utc)
    local = now.astimezone(RIYADH)
    if kind == "registration_followup":
        if await _canonical_branch(phone) != item["branch_id"]:
            return {"action": "cancel", "reason": "duplicate_noncanonical_branch"}
        rows = await _live_rows(item["branch_id"], phone)
        if not rows:
            return {"action": "cancel", "reason": "registration_followup_stopped"}
        stop = await _db["registration_followup_stops"].find_one(
            {"phone": phone})
        if stop:
            return {"action": "cancel", "reason": stop.get("reason") or "stopped"}
        if not 10 <= local.hour < 20:
            next_open = (local if local.hour < 10 else local + timedelta(days=1)).replace(
                hour=10, minute=0, second=0, microsecond=0)
            return {"action": "defer", "until": next_open.astimezone(timezone.utc)}
        sequence = int((item.get("source_metadata") or {}).get("sequence") or 1)
        created = min(filter(None, (_parse(r.get("created_at")) for r in rows)), default=None)
        item["message"] = _message(rows, sequence)
    day = local.date().isoformat()
    ledger = _db["whatsapp_contact_days"]
    await ledger.create_index([("phone", 1), ("day", 1)], unique=True)
    existing = await ledger.find_one({"phone": phone, "day": day})
    if existing and existing.get("kind") != kind:
        tomorrow = (local + timedelta(days=1)).replace(
            hour=10, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        if kind == "registration_followup":
            # A marketing contact already consumed this phone's day. Preserve
            # the reminder rather than sending twice or permanently cancelling.
            return {"action": "defer", "until": tomorrow}
        return {"action": "defer", "until": tomorrow}
    if kind == "registration_followup" and existing:
        return {"action": "cancel", "reason": "daily_phone_limit"}
    if not existing:
        try:
            await ledger.insert_one({
                "id": str(uuid.uuid4()), "branch_id": item["branch_id"], "phone": phone,
                "day": day, "kind": kind, "job_id": item["job_id"], "created_at": now,
            })
        except DuplicateKeyError:
            return {"action": "defer", "until": (local + timedelta(days=1)).replace(
                hour=10, minute=0, second=0, microsecond=0).astimezone(timezone.utc)}
    return {"action": "send"}


async def recheck_dispatch(item: dict) -> bool:
    if (item.get("communication_kind") or "marketing") != "registration_followup":
        return True
    phone = normalize_phone(item.get("phone"))
    if await _canonical_branch(phone) != item["branch_id"]:
        return False
    if await _has_unresolved_outbound(phone):
        return False
    return bool(await _live_rows(item["branch_id"], phone)) and not bool(
        await _db["registration_followup_stops"].find_one(
            {"phone": phone}))


async def completed(item: dict, status: str):
    if item.get("communication_kind") != "registration_followup":
        return
    phone = normalize_phone(item.get("phone"))
    await _reconcile_outbound_observations(item, status)
    stop = await _db["registration_followup_stops"].find_one({"phone": phone})
    if stop:
        # A reply/contact may race the provider response. Never resurrect a
        # phone after the stop flag was durably written.
        await _set_group(
            item["branch_id"], phone, "stopped", stop.get("reason") or "stopped"
        )
        return
    sequence = int((item.get("source_metadata") or {}).get("sequence") or 1)
    if status == "sent":
        await _set_group(item["branch_id"], phone,
                         "first_sent" if sequence == 1 else "completed", None, sequence)
        if sequence == 1:
            await _db["registration_requests"].update_many(
                {"followup_enrolled": True, "followup_normalized_phone": phone},
                {"$set": {"followup_first_sent_at": datetime.now(timezone.utc).isoformat()}},
            )
    elif status == "unknown":
        await _set_group(item["branch_id"], phone, "unknown", "provider_outcome_unknown")
    elif status == "failed":
        await _set_group(item["branch_id"], phone, "blocked", "provider_rejected")
    elif status == "blocked":
        await _set_group(item["branch_id"], phone, "blocked", "provider_unavailable")


async def _tick(_tenant):
    await schedule_due()


async def _loop():
    while True:
        try:
            await for_each_active_tenant(_tick, label="registration-followups")
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            return
        except Exception as exc:
            log.error("Registration follow-up scheduler error: %s", type(exc).__name__)
            await asyncio.sleep(60)


def start_worker():
    global _started
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("ENVIRONMENT", "").lower() == "test":
        return
    if not _started:
        _started = True
        asyncio.ensure_future(_loop())