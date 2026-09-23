"""Durable, independently branch-paced automatic WhatsApp campaign delivery.

The Mongo gate is deliberately acquired immediately before each provider call.
An item is changed to ``dispatching`` before the call; if its worker disappears,
recovery marks it ``unknown`` rather than retrying a possibly delivered message.
"""
import asyncio
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from utils.tenant import for_each_active_tenant, get_current_tenant_slug

log = logging.getLogger("whatsapp.bulk_jobs")
_DATETIME_TYPE = datetime
MIN_INTERVAL_SECONDS = max(180, int(os.environ.get("WHATSAPP_CAMPAIGN_INTERVAL_SECONDS", "180")))
CLOSURE_NOTICE_INTERVAL_SECONDS = 60
LEASE_SECONDS = 600
BRANCH_PARALLELISM = max(
    1, int(os.environ.get("WHATSAPP_CAMPAIGN_BRANCH_WORKERS", "8"))
)
TERMINAL_ITEM_STATUSES = {"sent", "failed", "unknown", "cancelled"}
_started = False
_db = None
_handlers = {}
_inflight_branch_tasks = {}
RECEIPT_BUFFER_COLLECTION = "whatsapp_campaign_receipt_buffer"
# Webhooks can arrive before a provider returns its send response.  Keep that
# evidence long enough for a delayed response without retaining it indefinitely.
RECEIPT_BUFFER_TTL = timedelta(days=7)
RECEIPT_BUFFER_WRITE_RETRIES = 3


def configure(db, **handlers):
    global _db, _handlers
    _db, _handlers = db, handlers


def public_job(job):
    if not job:
        return None
    return {k: v for k, v in job.items() if k not in {"_id", "tenant_slug"}}


def _report_phone(value):
    """Return the provider-independent phone key used to group media items."""
    digits = re.sub(r"\D", "", str(value or "").split("@", 1)[0])
    return "966" + digits[1:] if len(digits) == 10 and digits.startswith("0") else digits


def _report_name(value):
    if value in (None, ""):
        return None
    name = str(value).strip()
    digits = re.sub(r"\D", "", name)
    if len(digits) >= 7:
        return None
    return name[:200] or None


def _receipt_status(value):
    status = str(value or "").strip().lower()
    if status in {"read", "played"}:
        return "read"
    if status in {"delivered", "device"}:
        return "delivered"
    if status in {"sent", "server", "accepted"}:
        return "accepted"
    if status in {"failed", "error"}:
        return "failed"
    return None


def _receipt_can_advance(current, incoming):
    """Return whether an incoming receipt may replace the stored receipt."""
    incoming = _receipt_status(incoming)
    current = _receipt_status(current)
    if not incoming:
        return False
    if not current:
        return True
    # Read is a verified terminal observation.  In particular a later provider
    # failure callback must never hide a verified read.  A failure is not
    # terminal here: providers can emit it before their accepted/delivered
    # callback, so a later positive receipt is stronger evidence.
    if current == "read":
        return False
    if current == "failed":
        return incoming in {"accepted", "delivered", "read"}
    if incoming == "failed":
        return current == "accepted"
    return {
        "accepted": 1,
        "delivered": 2,
        "read": 3,
    }.get(incoming, 0) > {
        "accepted": 1,
        "delivered": 2,
        "read": 3,
    }.get(current, 0)


def _receipt_tenant_slug(value=None):
    """Return an explicit tenant scope without making test DBs tenant-aware."""
    if value not in (None, ""):
        return str(value)
    try:
        return str(get_current_tenant_slug() or "")
    except Exception:
        return ""


def _receipt_ids(message_id, aliases=()):
    """De-duplicate literal provider identifiers; never derive one from a phone."""
    values = [message_id, *(aliases or ())]
    return list(dict.fromkeys(
        str(value).strip() for value in values
        if value not in (None, "") and str(value).strip()
    ))


def _receipt_values(status, timestamp, error=None):
    """Fields consumed by campaign report/projection readers."""
    normalized = _receipt_status(status)
    values = {
        "delivery_status": normalized,
        "receipt_status": normalized,
        "receipt_at": timestamp,
        "status_updated_at": timestamp,
    }
    if normalized == "accepted":
        values["accepted_at"] = timestamp
        # A positive provider acknowledgement supersedes an early failure.
        values["error"] = None
    elif normalized == "delivered":
        values["delivered_at"] = timestamp
        values["error"] = None
    elif normalized == "read":
        values["read_at"] = timestamp
        values["error"] = None
    elif normalized == "failed" and error:
        values["error"] = str(error)[:500]
    return values


async def _apply_receipt_to_item(branch_id, provider, message_id, status, timestamp,
                                 error=None):
    """Apply one exact provider receipt and return its matched-item count."""
    collection = _db["whatsapp_campaign_job_items"]
    query = {
        "branch_id": branch_id, "provider": provider,
        "provider_message_id": message_id,
    }
    existing = None
    if hasattr(collection, "find_one"):
        existing = await collection.find_one(query)
        if not existing:
            # WAHA can acknowledge the stanza ID while its send response gave
            # us the canonical full ID.  This is still an exact provider
            # alias saved with that response, never a phone/body lookup.
            existing = await collection.find_one({
                "branch_id": branch_id,
                "provider": provider,
                "provider_message_id_aliases": message_id,
            })
    if not existing:
        return 0
    # Always CAS the canonical ID stored by the campaign sender.  The received
    # alias above is only a lookup key and must not become a replacement ID.
    query["provider_message_id"] = existing.get("provider_message_id")
    current_field = None
    current = None
    for field in ("delivery_status", "receipt_status"):
        if _receipt_status(existing.get(field)):
            current_field = field
            current = existing.get(field)
            break
    if not current_field:
        for field in ("delivery_status", "receipt_status"):
            if field in existing:
                current_field = field
                current = existing.get(field)
                break
    if not _receipt_can_advance(current, status):
        return 0
    # This CAS makes duplicate/concurrent authenticated webhooks monotonic.
    if current_field:
        query[current_field] = current
    else:
        query["delivery_status"] = {"$exists": False}
        query["receipt_status"] = {"$exists": False}
    values = _receipt_values(status, timestamp, error)
    if hasattr(collection, "update_many"):
        result = await collection.update_many(query, {"$set": values})
    else:
        result = await collection.update_one(query, {"$set": values})
    return getattr(result, "matched_count", getattr(result, "modified_count", 0))


async def _buffer_receipt(tenant_slug, branch_id, provider, message_id, status,
                          timestamp, error=None):
    """Durably retain an unmatched authenticated receipt for later ID mapping."""
    collection = _db[RECEIPT_BUFFER_COLLECTION]
    scope = {
        "tenant_slug": tenant_slug,
        "branch_id": branch_id,
        "provider": provider,
        "provider_message_id": message_id,
    }
    try:
        # These are non-destructive maintenance indexes.  The TTL index keeps
        # an unavailable/unknown send from growing the receipt store forever.
        if hasattr(collection, "create_index"):
            await collection.create_index(
                [("tenant_slug", 1), ("branch_id", 1), ("provider", 1),
                 ("provider_message_id", 1)],
                unique=True,
            )
            await collection.create_index("expires_at", expireAfterSeconds=0)
        if not hasattr(collection, "update_one"):
            return None
        # Write before attempting an item update.  A response can save its ID
        # in the tiny interval between an old lookup and an upsert; write-first
        # ensures either this call or the sender's reconciliation observes it.
        for _ in range(RECEIPT_BUFFER_WRITE_RETRIES):
            existing = (
                await collection.find_one(scope)
                if hasattr(collection, "find_one") else None
            )
            current = (
                (existing or {}).get("delivery_status")
                or (existing or {}).get("receipt_status")
            )
            if existing and not _receipt_can_advance(current, status):
                return existing
            now = datetime.now(timezone.utc)
            values = {
                **_receipt_values(status, timestamp, error),
                "buffer_token": str(uuid.uuid4()),
                "updated_at": now,
                "expires_at": now + RECEIPT_BUFFER_TTL,
            }
            try:
                if existing:
                    result = await collection.update_one(
                        {**scope, "buffer_token": existing.get("buffer_token")},
                        {"$set": values},
                    )
                else:
                    result = await collection.update_one(
                        scope,
                        {
                            "$set": values,
                            "$setOnInsert": {"created_at": now},
                        },
                        upsert=True,
                    )
            except DuplicateKeyError:
                # Another receipt created this unique scope. Re-read it and
                # monotonically apply this event instead of losing either.
                continue
            if getattr(result, "matched_count", 0) or getattr(
                result, "upserted_id", None
            ) is not None or not existing:
                return {**scope, **values}
        log.warning("Could not atomically retain campaign receipt evidence")
    except Exception as exc:
        # An unavailable evidence buffer must not make a verified webhook fail.
        log.warning("Could not buffer unmatched campaign receipt: %s", type(exc).__name__)
    return None


def _iso(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat()
    return value


def _utc_datetime(value):
    """Normalize Mongo/Python datetimes before comparing queue timestamps."""
    if isinstance(value, _DATETIME_TYPE):
        return value.replace(tzinfo=value.tzinfo or timezone.utc)
    return value


def _report_error(value, phone_visible=True):
    if value in (None, ""):
        return None
    if not phone_visible:
        return "Provider error"
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value)).strip()
    text = re.sub(r"https?://\S+", "[link]", text, flags=re.IGNORECASE)
    return text[:500] or None


def _recipient_status(items):
    """Collapse one recipient's text/media items into one report row.

    A campaign with multiple attachments has one item per attachment.  Receipt
    state is deliberately read from the item that has the exact provider
    message id; the local ``sent`` state alone is only provider acceptance.
    """
    def item_receipt(item):
        # A delivery/read value is evidence only when tied to the exact
        # provider message ID that produced the receipt.
        if not item.get("provider_message_id"):
            return None
        return _receipt_status(item.get("delivery_status") or item.get("receipt_status"))

    states = [str(item.get("status") or "unknown").lower() for item in items]
    receipts = [item_receipt(item) for item in items]
    receipts = [value for value in receipts if value]
    effective_states = []
    for item, state in zip(items, states):
        effective_states.append(
            item_receipt(item)
            or ("accepted" if state == "sent" else state)
        )
    mixed = len(set(effective_states)) > 1
    active = any(value in {"initializing", "pending", "claimed",
                           "quota_reserving", "dispatching", "processing"}
                 for value in states)
    terminal = set(states) - {
        "initializing", "pending", "claimed", "quota_reserving",
        "dispatching", "processing",
    }
    receipt = max(
        receipts,
        key={"failed": 0, "accepted": 1, "delivered": 2, "read": 3}.get,
        default=None,
    )
    if active:
        status = "partial" if terminal or receipt else "pending"
    elif mixed:
        status = "partial"
    elif receipt in {"read", "delivered"}:
        status = receipt
    elif receipt == "accepted" or "sent" in terminal:
        status = "accepted"
    elif receipt == "failed" or "failed" in terminal:
        status = "failed"
    elif "unknown" in terminal:
        status = "unknown"
    elif terminal and terminal <= {"cancelled"}:
        status = "cancelled"
    else:
        status = "unknown"

    # A partial group is useful to callers even though it is not one of the
    # historical item counters.  The summary includes this extension.
    if status == "partial":
        delivery_status = receipt or (
            "failed" if "failed" in terminal else "unconfirmed"
        )
    elif status == "accepted":
        delivery_status = "accepted" if receipt == "accepted" else "unconfirmed"
    elif status in {"pending", "unknown"}:
        delivery_status = "pending" if status == "pending" else "unconfirmed"
    else:
        delivery_status = status
    return status, delivery_status


async def get_report(job_id, branch_id, *, phone_visible=True, names_by_phone=None):
    """Build a read-only recipient report for one branch-owned job.

    This function intentionally performs no writes (including no receipt
    reconciliation).  ``names_by_phone`` is an exact, branch-scoped lookup
    supplied by the route; no fuzzy or family-name matching is performed.
    """
    job = await _db["whatsapp_campaign_jobs"].find_one(
        {"id": job_id, "branch_id": branch_id}, {"_id": 0}
    )
    if not job:
        return None
    cursor = _db["whatsapp_campaign_job_items"].find(
        {"job_id": job_id, "branch_id": branch_id}, {"_id": 0}
    )
    if hasattr(cursor, "to_list"):
        items = await cursor.to_list(length=10000)
    else:
        items = [row async for row in cursor]

    # Older receipts were recorded on the unified cloud-message projection
    # before campaign items carried delivery fields.  Read them by exact
    # provider ID as a backwards-compatible evidence source; this remains
    # strictly read-only.
    messages = _db["whatsapp_cloud_messages"]
    if hasattr(messages, "find_one"):
        checked = set()
        for item in items:
            provider_id = str(item.get("provider_message_id") or "").strip()
            provider = item.get("provider")
            if not provider_id or (provider, provider_id) in checked:
                continue
            checked.add((provider, provider_id))
            key = {
                "meta_cloud": "meta_message_id",
                "waha": "waha_message_id",
                "whatsflow": "provider_message_id",
            }.get(provider, "provider_message_id")
            query = {"branch_id": branch_id, key: provider_id}
            if provider != "meta_cloud":
                query["provider"] = provider
            receipt = await messages.find_one(
                query,
                {"_id": 0, "status": 1, "status_updated_at": 1,
                 "delivered_at": 1, "read_at": 1, "error": 1},
            )
            if not receipt:
                continue
            value = _receipt_status(receipt.get("status"))
            if not value:
                continue
            for candidate in items:
                if (
                    candidate.get("provider") == provider
                    and candidate.get("provider_message_id") == provider_id
                ):
                    if not _receipt_can_advance(
                        candidate.get("delivery_status")
                        or candidate.get("receipt_status"),
                        value,
                    ):
                        continue
                    candidate["delivery_status"] = value
                    candidate["receipt_status"] = value
                    timestamp = (
                        receipt.get("status_updated_at")
                        or receipt.get("delivered_at")
                        or receipt.get("read_at")
                    )
                    if value == "delivered" and timestamp:
                        candidate["delivered_at"] = timestamp
                    elif value == "read" and timestamp:
                        candidate["read_at"] = timestamp
                    if value == "failed" and receipt.get("error"):
                        candidate["error"] = receipt["error"]

    groups = {}
    for ordinal, item in enumerate(items):
        # recipient_index is authoritative for newly-created jobs.  The phone
        # fallback keeps old jobs readable while still coalescing attachments.
        index = item.get("recipient_index")
        key = ("index", index) if index is not None else (
            "phone", _report_phone(item.get("phone"))
        )
        groups.setdefault(key, []).append(item)

    recipients = []
    missing_metadata = False
    for ordinal, grouped in enumerate(groups.values()):
        first = grouped[0]
        phone = _report_phone(first.get("phone"))
        recipient_id = first.get("recipient_id")
        if not recipient_id:
            source_metadata = first.get("source_metadata") or {}
            recipient_id = source_metadata.get("recipient_id") or source_metadata.get("member_id")
        if not phone_visible and len(re.sub(r"\D", "", str(recipient_id or ""))) >= 7:
            recipient_id = None
        name = _report_name(first.get("recipient_name") or first.get("name"))
        if not name and names_by_phone:
            name = _report_name(names_by_phone.get(phone))
        if not recipient_id or not name:
            missing_metadata = True
        status, delivery_status = _recipient_status(grouped)
        sent_values = [item.get("sent_at") for item in grouped if item.get("sent_at")]
        delivered_values = [
            item.get("delivered_at") for item in grouped if item.get("delivered_at")
        ]
        read_values = [item.get("read_at") for item in grouped if item.get("read_at")]
        errors = [
            _report_error(item.get("error"), phone_visible=phone_visible)
            for item in grouped if item.get("error")
        ]
        recipients.append({
            "id": recipient_id,
            "name": name or None,
            "phone": phone if phone_visible else "********",
            "status": status,
            "delivery_status": delivery_status,
            "sent_at": min((_iso(value) for value in sent_values), default=None),
            "delivered_at": min((_iso(value) for value in delivered_values), default=None),
            "read_at": min((_iso(value) for value in read_values), default=None),
            "error": errors[0] if errors else None,
        })

    summary = {
        "total": len(recipients),
        "pending": 0,
        "accepted": 0,
        "delivered": 0,
        "read": 0,
        "failed": 0,
        "unknown": 0,
        "cancelled": 0,
        "partial": 0,
    }
    for recipient in recipients:
        status = recipient["status"]
        if status in summary:
            summary[status] += 1
        elif status == "partial":
            summary["partial"] += 1

    notes = []
    if job.get("total") and not items:
        notes.append(
            "Recipient item details were unavailable for this historical job; the empty table is not a claim that no recipients were queued."
        )
    if missing_metadata:
        notes.append(
            "Some historical recipient IDs or names were not stored; unavailable values are null."
        )
    if any(row["status"] in {"accepted", "partial", "unknown"} for row in recipients):
        notes.append(
            "Accepted and unknown messages have no confirmed delivery unless an exact provider receipt ID was recorded; unconfirmed delivery is shown explicitly."
        )
    if any(row["status"] == "partial" for row in recipients):
        notes.append(
            "Partial indicates mixed outcomes across attachment items for one recipient; attachments are grouped as one recipient."
        )
    if "started_at" not in job or "completed_at" not in job:
        notes.append(
            "Historical start or completion timestamps were unavailable and are shown as null."
        )
    return {
        "job": public_job(job),
        "summary": summary,
        "recipients": recipients,
        "notes": notes,
    }


async def record_receipt(
    branch_id, provider, provider_message_id, status, *,
    timestamp=None, error=None, tenant_slug=None, aliases=(),
):
    """Record authenticated receipt evidence by literal provider message ID.

    A send response and its webhook are independent requests: when the receipt
    wins that race, retain it in a tenant/branch/provider-scoped buffer.  We
    intentionally never use the recipient phone or body as a fallback key.
    """
    if _db is None:
        return 0
    normalized = _receipt_status(status)
    message_ids = _receipt_ids(provider_message_id, aliases)
    if not branch_id or not provider or not message_ids or not normalized:
        return 0
    timestamp = timestamp or datetime.now(timezone.utc)
    # Persist first, then reconcile.  Reversing this order loses the receipt
    # when a send response writes the ID between an item lookup and buffer
    # insertion.
    for message_id in message_ids:
        await _buffer_receipt(
            _receipt_tenant_slug(tenant_slug), branch_id, provider,
            message_id, normalized, timestamp, error,
        )
    matched = await reconcile_receipt(
        branch_id, provider, message_ids[0],
        tenant_slug=tenant_slug, aliases=message_ids[1:],
    )
    if matched:
        return matched
    # This covers lightweight test stores without a receipt collection and
    # also narrows the response-save race once more.  The durable buffer above
    # remains authoritative if no mapping exists yet.
    for message_id in message_ids:
        matched += await _apply_receipt_to_item(
            branch_id, provider, message_id, normalized, timestamp, error
        )
    return matched


async def reconcile_receipt(
    branch_id, provider, provider_message_id, *,
    tenant_slug=None, aliases=(),
):
    """Apply receipts buffered before the exact campaign ID was persisted."""
    if _db is None:
        return 0
    message_ids = _receipt_ids(provider_message_id, aliases)
    if not branch_id or not provider or not message_ids:
        return 0
    collection = _db[RECEIPT_BUFFER_COLLECTION]
    items = _db["whatsapp_campaign_job_items"]
    tenant = _receipt_tenant_slug(tenant_slug)
    matched = 0
    for message_id in message_ids:
        scope = {
            "tenant_slug": tenant,
            "branch_id": branch_id,
            "provider": provider,
            "provider_message_id": message_id,
        }
        try:
            receipt = await collection.find_one(scope) if hasattr(collection, "find_one") else None
        except Exception as exc:
            log.warning("Could not reconcile campaign receipt evidence: %s", type(exc).__name__)
            continue
        if not receipt:
            continue
        status = _receipt_status(
            receipt.get("delivery_status") or receipt.get("receipt_status")
        )
        if not status:
            continue
        # Retain receipt evidence until an item has an exact primary ID (or a
        # literal persisted WAHA alias).  In particular, do not delete it just
        # because this is the webhook-before-send-response race.
        mapped_item = None
        if hasattr(items, "find_one"):
            mapped_item = await items.find_one({
                "branch_id": branch_id,
                "provider": provider,
                "provider_message_id": message_ids[0],
            })
            if not mapped_item:
                mapped_item = await items.find_one({
                    "branch_id": branch_id,
                    "provider": provider,
                    "provider_message_id_aliases": message_id,
                })
        if not mapped_item:
            continue
        # The item deliberately stores its exact send-response ID.  A WAHA
        # receipt may have arrived under an explicit stanza alias, so always
        # apply its evidence to that just-saved primary ID.
        count = await _apply_receipt_to_item(
            branch_id, provider, mapped_item.get("provider_message_id"), status,
            receipt.get("receipt_at") or receipt.get("updated_at")
            or datetime.now(timezone.utc),
            receipt.get("error"),
        )
        matched += count
        # Do not delete a later receipt that arrived after the read above.
        # The per-write token makes this a compare-and-delete; if it changed,
        # the sender/next webhook reconciliation will process the newer record.
        if hasattr(collection, "delete_one"):
            try:
                await collection.delete_one({
                    **scope,
                    "buffer_token": receipt.get("buffer_token"),
                })
            except Exception as exc:
                log.warning("Could not clear reconciled campaign receipt: %s", type(exc).__name__)
    return matched


async def enqueue(branch_id, provider, recipients, idempotency_key, attachments=None,
                  kind="marketing", source="campaign", metadata=None):
    jobs = _db["whatsapp_campaign_jobs"]
    await jobs.create_index([("branch_id", 1), ("idempotency_key", 1)], unique=True)
    scope = {"branch_id": branch_id, "idempotency_key": idempotency_key}
    old = await jobs.find_one(scope)
    if old:
        return public_job(old), False
    now = datetime.now(timezone.utc)
    attachment_list = attachments or []
    total = len(recipients) * max(1, len(attachment_list))
    job = {
        "id": str(uuid.uuid4()), **scope, "provider": provider,
        "communication_kind": kind, "source": source,
        "status": "initializing", "created_at": now, "updated_at": now,
        "total": total, "pending": total, "sent": 0, "failed": 0, "unknown": 0,
        "cancelled": 0, "attachment_count": len(attachment_list),
        "recipient_count": len(recipients),
    }
    # Keep optional enqueue-time campaign metadata for future reports.  Do not
    # copy message bodies or phone numbers into the parent job.
    for key in (
        "campaign_title", "campaign_name", "campaign_id", "branch_name"
    ):
        value = (metadata or {}).get(key)
        if value not in (None, ""):
            job[key] = value
    try:
        await jobs.insert_one(job)
    except DuplicateKeyError:
        return public_job(await jobs.find_one(scope)), False
    items = []
    for recipient_index, recipient in enumerate(recipients):
        media = attachment_list or [None]
        for media_index, attachment in enumerate(media):
            item = {
                "id": str(uuid.uuid4()), "job_id": job["id"], "branch_id": branch_id,
                "provider": provider, "recipient_index": recipient_index,
                "media_index": media_index, "phone": recipient["phone"],
                "message": recipient["message"], "attachment": attachment,
                "status": "initializing", "created_at": now,
                "communication_kind": recipient.get("communication_kind", kind),
                "source": recipient.get("source", source),
                "source_metadata": recipient.get("source_metadata") or {},
            }
            recipient_id = (
                recipient.get("recipient_id")
                or recipient.get("id")
                or recipient.get("member_id")
                or (recipient.get("source_metadata") or {}).get("recipient_id")
                or (recipient.get("source_metadata") or {}).get("member_id")
            )
            recipient_name = (
                recipient.get("recipient_name")
                or recipient.get("name")
                or recipient.get("member_name")
            )
            if recipient_id:
                item["recipient_id"] = str(recipient_id)
            if recipient_name:
                item["recipient_name"] = str(recipient_name)[:200]
            if recipient.get("next_attempt_at"):
                item["next_attempt_at"] = recipient["next_attempt_at"]
            items.append(item)
    try:
        await _db["whatsapp_campaign_job_items"].insert_many(items)
    except Exception:
        # Keep the idempotency key authoritative and fail closed. A retry
        # returns this failed initialization instead of creating another job.
        await jobs.update_one({"id": job["id"]}, {"$set": {
            "status": "initialization_failed", "pending": 0,
            "updated_at": datetime.now(timezone.utc)}})
        raise
    await _db["whatsapp_campaign_job_items"].update_many(
        {"job_id": job["id"], "status": "initializing"}, {"$set": {"status": "pending"}})
    await jobs.update_one({"id": job["id"], "status": "initializing"}, {"$set": {
        "status": "pending", "updated_at": datetime.now(timezone.utc)}})
    job["status"] = "pending"
    return public_job(job), True


async def get_job(job_id, branch_id):
    return public_job(await _db["whatsapp_campaign_jobs"].find_one(
        {"id": job_id, "branch_id": branch_id}))


async def get_job_by_key(branch_id, idempotency_key):
    return public_job(await _db["whatsapp_campaign_jobs"].find_one(
        {"branch_id": branch_id, "idempotency_key": idempotency_key}))


async def list_jobs(branch_id, limit=20):
    cursor = _db["whatsapp_campaign_jobs"].find(
        {"branch_id": branch_id}, {"_id": 0, "tenant_slug": 0}
    ).sort("created_at", -1).limit(min(50, max(1, limit)))
    rows = await cursor.to_list(length=50)
    lane = await _db["whatsapp_campaign_rate_gates"].find_one({"_id": branch_id}) or {}
    if lane.get("frozen") and rows:
        rows[0]["lane_frozen"] = True
        rows[0]["lane_freeze_reason"] = lane.get("freeze_reason")
    return rows


async def cancel(job_id, branch_id):
    job = await _db["whatsapp_campaign_jobs"].find_one({"id": job_id, "branch_id": branch_id})
    if not job:
        return None
    await _db["whatsapp_campaign_jobs"].update_one(
        {"id": job_id, "branch_id": branch_id},
        {"$set": {"cancel_requested": True, "updated_at": datetime.now(timezone.utc)}})
    # Claimed work remains owned: its worker (or lease recovery) observes the
    # durable intent and releases its lane/quota. Mutating it here would race
    # the owner's dispatch CAS.
    await _db["whatsapp_campaign_job_items"].update_many(
        {"job_id": job_id, "branch_id": branch_id,
         "status": "pending", "quota_reservation_id": {"$exists": False}},
        {"$set": {"status": "cancelled", "completed_at": datetime.now(timezone.utc)}})
    await _refresh_job(job_id)
    return await get_job(job_id, branch_id)


async def reconcile_lane(branch_id, confirmed_no_dispatch_risk=False):
    """Operator acknowledgement for a conservatively frozen branch lane."""
    if not confirmed_no_dispatch_risk:
        return False
    now = datetime.now(timezone.utc)
    result = await _db["whatsapp_campaign_rate_gates"].update_one(
        {"_id": branch_id, "frozen": True},
        {"$set": {"frozen": False, "reconciled_at": now,
                  "next_allowed_at": now + timedelta(seconds=MIN_INTERVAL_SECONDS),
                  "updated_at": now},
         "$unset": {"lease_token": "", "lease_until": "", "freeze_reason": ""}})
    return getattr(result, "matched_count", 0) == 1


async def _refresh_job(job_id):
    counts = {"pending": 0, "claimed": 0, "quota_reserving": 0,
              "dispatching": 0, "sent": 0, "failed": 0,
              "unknown": 0, "cancelled": 0}
    async for row in _db["whatsapp_campaign_job_items"].aggregate([
        {"$match": {"job_id": job_id}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}
    ]):
        counts[row["_id"]] = row["n"]
    pending = sum(counts[key] for key in ("pending", "claimed", "quota_reserving", "dispatching"))
    status = "processing" if counts["dispatching"] else "pending"
    if not pending:
        status = "cancelled" if counts["cancelled"] and not (
            counts["sent"] or counts["failed"] or counts["unknown"]) else "completed"
    current = await _db["whatsapp_campaign_jobs"].find_one({"id": job_id}) or {}
    values = {
        **{k: counts[k] for k in ("sent", "failed", "unknown", "cancelled")},
        "pending": pending, "status": status, "updated_at": datetime.now(timezone.utc)}
    if not pending and not current.get("completed_at"):
        values["completed_at"] = datetime.now(timezone.utc)
    await _db["whatsapp_campaign_jobs"].update_one({"id": job_id}, {"$set": values})


def _item_interval_seconds(item):
    return (CLOSURE_NOTICE_INTERVAL_SECONDS
            if item.get("source") == "closure_notice" else MIN_INTERVAL_SECONDS)


async def _acquire_gate(branch_id, provider, now, interval_seconds=MIN_INTERVAL_SECONDS):
    gates = _db["whatsapp_campaign_rate_gates"]
    # One branch-wide gate covers every automatic provider. A configuration
    # switch must not create a fresh lane and bypass the applicable interval.
    key = branch_id
    try:
        await gates.update_one({"_id": key}, {"$setOnInsert": {
            "branch_id": branch_id, "provider": provider,
            "next_allowed_at": datetime(1970, 1, 1, tzinfo=timezone.utc)}}, upsert=True)
    except DuplicateKeyError:
        pass  # another process created the same gate
    token = str(uuid.uuid4())
    doc = await gates.find_one_and_update(
        {"_id": key, "frozen": {"$ne": True},
         "next_allowed_at": {"$lte": now},
         "$or": [{"last_completed_at": {"$exists": False}},
                 {"last_completed_at": {"$lte": now - timedelta(seconds=interval_seconds)}}],
         "lease_until": {"$exists": False}},
        {"$set": {"lease_token": token, "lease_until": now + timedelta(seconds=LEASE_SECONDS),
                  "updated_at": now}},
        return_document=ReturnDocument.AFTER)
    return (doc, token) if doc else (None, None)


async def _freeze_lane(item, reason, now):
    await _db["whatsapp_campaign_rate_gates"].update_one(
        {"_id": item["branch_id"]},
        {"$set": {"frozen": True, "freeze_reason": reason, "updated_at": now}})


async def _release_lane(item, lane_token, completed_at):
    result = await _db["whatsapp_campaign_rate_gates"].update_one(
        {"_id": item["branch_id"], "lease_token": lane_token},
        {"$set": {"next_allowed_at": completed_at + timedelta(seconds=_item_interval_seconds(item)),
                  "last_completed_at": completed_at,
                  "updated_at": completed_at},
         "$unset": {"lease_token": "", "lease_until": ""}})
    return getattr(result, "matched_count", 1) == 1


async def _refund_item_quota(item):
    reservation_id = item.get("quota_reservation_id")
    if not reservation_id or item.get("quota_released_at"):
        return
    await _handlers["release_quota"](reservation_id, 1, item["id"])
    await _db["whatsapp_campaign_job_items"].update_one(
        {"id": item["id"], "quota_reservation_id": reservation_id,
         "quota_released_at": {"$exists": False}},
        {"$set": {"quota_released_at": datetime.now(timezone.utc)}})


async def _cancel_owned_item(item, now):
    await _refund_item_quota(item)
    changed = await _db["whatsapp_campaign_job_items"].update_one(
        {"id": item["id"], "status": "claimed", "claim_token": item.get("claim_token")},
        {"$set": {"status": "cancelled", "completed_at": now}})
    if item.get("lane_token"):
        await _release_lane(item, item["lane_token"], now)
    await _refresh_job(item["job_id"])
    return getattr(changed, "matched_count", 1) == 1


async def _notify_completed(item, status):
    callback = _handlers.get("completed")
    if callback:
        await callback(item, status)


async def _recover_crashed(now):
    claimed = _db["whatsapp_campaign_job_items"].find({
        "status": {"$in": ["claimed", "quota_reserving"]}, "claim_until": {"$lt": now}})
    async for item in claimed:
        if item["status"] == "quota_reserving":
            await _db["whatsapp_campaign_job_items"].update_one(
                {"id": item["id"], "status": "quota_reserving",
                 "claim_token": item.get("claim_token")},
                {"$set": {"status": "unknown", "completed_at": now,
                          "error": "Worker stopped while quota reservation outcome was uncertain"}})
            await _freeze_lane(item, "uncertain quota reservation", now)
            await _refresh_job(item["job_id"])
            await _notify_completed(item, "unknown")
        else:
            job = await _db["whatsapp_campaign_jobs"].find_one({"id": item["job_id"]})
            if job and job.get("cancel_requested"):
                await _cancel_owned_item(item, now)
                continue
            await _db["whatsapp_campaign_job_items"].update_one(
                {"id": item["id"], "status": "claimed",
                 "claim_token": item.get("claim_token")},
                {"$set": {"status": "pending"},
                 "$unset": {"claim_token": "", "claim_until": ""}})
            if item.get("lane_token"):
                await _release_lane(item, item["lane_token"], now)
    cursor = _db["whatsapp_campaign_job_items"].find({
        "status": "dispatching", "lease_until": {"$lt": now}})
    async for item in cursor:
        await _db["whatsapp_campaign_job_items"].update_one(
            {"id": item["id"], "status": "dispatching",
             "claim_token": item.get("claim_token")},
            {"$set": {"status": "unknown", "completed_at": now,
                      "error": "Worker stopped after dispatch began; delivery outcome is unknown"}})
        await _freeze_lane(item, "uncertain provider dispatch", now)
        await _refresh_job(item["job_id"])
        await _notify_completed(item, "unknown")


def _pending_item_sort():
    # created_at is the queue order across jobs.  Mongo's generated _id is a
    # stable insertion-order tie breaker when two jobs share a timestamp; the
    # recipient/media indexes make legacy documents deterministic too.
    return [
        ("created_at", 1), ("_id", 1), ("recipient_index", 1), ("media_index", 1)
    ]


async def _oldest_branch_item(branch_id):
    # Include claimed/dispatching heads in the peek.  A second worker must
    # not skip an in-flight head and claim a later pending item for the same
    # branch.
    cursor = _db["whatsapp_campaign_job_items"].find({
        "branch_id": branch_id,
        "status": {"$nin": list(TERMINAL_ITEM_STATUSES)},
    }).sort(_pending_item_sort())
    if hasattr(cursor, "to_list"):
        rows = await cursor.to_list(length=1)
        return rows[0] if rows else None
    async for row in cursor:
        return row
    return None


async def _pending_branch_ids():
    """Return each branch with pending work, ordered by its queue head.

    This is intentionally a read-only discovery query.  The actual claim is
    still a Mongo find-and-update CAS in ``_claim_next_for_branch``.  Keeping
    discovery separate means one frozen or rate-limited branch cannot consume
    the global oldest-item slot while other branches wait behind it.
    """
    cursor = _db["whatsapp_campaign_job_items"].aggregate([
        {"$match": {"status": "pending"}},
        {"$sort": {
            "created_at": 1,
            "_id": 1,
        }},
        {"$group": {
            "_id": "$branch_id",
            "head_created_at": {"$first": "$created_at"},
            "head_id": {"$first": "$_id"},
        }},
        {"$sort": {"head_created_at": 1, "head_id": 1}},
        {"$project": {"_id": 0, "branch_id": "$_id"}},
    ])
    if hasattr(cursor, "to_list"):
        rows = await cursor.to_list(length=None)
    else:
        rows = [row async for row in cursor]
    branches = []
    seen = set()
    for row in rows:
        branch_id = row.get("branch_id")
        if branch_id is None or branch_id in seen:
            continue
        seen.add(branch_id)
        branches.append(branch_id)
    return branches


async def _claim_next_for_branch(branch_id, now):
    """Atomically claim the FIFO head for one branch.

    Looking up the head before the CAS is important: a query containing only
    ``next_attempt_at <= now`` would skip a deferred head and send a later
    item, violating FIFO.  The second query prevents two workers from owning
    the same head after the read.
    """
    candidate = await _oldest_branch_item(branch_id)
    if not candidate or candidate.get("status") != "pending":
        return None
    next_attempt_at = _utc_datetime(candidate.get("next_attempt_at"))
    if next_attempt_at is not None and next_attempt_at > now:
        return None
    claim_token = str(uuid.uuid4())
    return await _db["whatsapp_campaign_job_items"].find_one_and_update(
        {"id": candidate["id"], "branch_id": branch_id, "status": "pending",
         "$or": [
             {"next_attempt_at": {"$exists": False}},
             {"next_attempt_at": None},
             {"next_attempt_at": {"$lte": now}},
         ]},
        {"$set": {"status": "claimed", "claim_token": claim_token,
                  "claim_until": now + timedelta(seconds=LEASE_SECONDS)}},
        return_document=ReturnDocument.AFTER,
    )


async def _tick_branch_ids(now, limit=None):
    """Select runnable branch heads for one worker tick.

    Frozen and future-deferred heads are omitted before applying the worker
    bound.  Thus a large backlog of blocked branches cannot fill every worker
    slot and starve a branch that can send now.  The caller applies the global
    task bound after accounting for every tenant's in-flight registry.
    """
    selected = []
    for branch_id in await _pending_branch_ids():
        item = await _oldest_branch_item(branch_id)
        if not item or item.get("status") != "pending":
            continue
        next_attempt_at = _utc_datetime(item.get("next_attempt_at"))
        if next_attempt_at is not None and next_attempt_at > now:
            continue
        gate = await _db["whatsapp_campaign_rate_gates"].find_one({"_id": branch_id})
        if gate:
            if gate.get("frozen"):
                continue
            next_allowed_at = _utc_datetime(gate.get("next_allowed_at"))
            lease_until = _utc_datetime(gate.get("lease_until"))
            if next_allowed_at and next_allowed_at > now:
                continue
            if lease_until and lease_until > now:
                continue
        selected.append(branch_id)
        if limit is not None and len(selected) >= limit:
            break
    return selected


async def _process_one_for_branch(branch_id):
    now = datetime.now(timezone.utc)
    # Claim briefly only to select work. Claiming is branch-scoped so a
    # blocked branch cannot prevent an independent branch from progressing.
    item = await _claim_next_for_branch(branch_id, now)
    if not item:
        return False
    claim_token = item["claim_token"]
    parent = await _db["whatsapp_campaign_jobs"].find_one(
        {"id": item["job_id"], "branch_id": item["branch_id"]}
    )
    if not parent or parent.get("status") not in {"pending", "processing", "paused"}:
        await _db["whatsapp_campaign_job_items"].update_one(
            {"id": item["id"], "status": "claimed", "claim_token": claim_token},
            {"$set": {"status": "initializing"},
             "$unset": {"claim_token": "", "claim_until": ""}})
        return False
    if parent.get("cancel_requested"):
        await _cancel_owned_item(item, now)
        return False
    # Older closure jobs predate the explicit source. Recognize their existing
    # server-generated key without rewriting queue records or shortening a
    # cooldown already stored on the shared gate.
    if str(parent.get("idempotency_key") or "").startswith("closure_notice_"):
        item = {**item, "source": "closure_notice"}
    gate, lane_token = await _acquire_gate(
        item["branch_id"], item["provider"], datetime.now(timezone.utc),
        _item_interval_seconds(item))
    if not gate:
        gate_doc = await _db["whatsapp_campaign_rate_gates"].find_one(
            {"_id": item["branch_id"]})
        values = {"status": "pending"}
        # A frozen gate may have a stale/past next_allowed_at.  Persisting
        # that value made the old global claimant select this same item on
        # every tick.  Frozen heads stay ordinary pending work until explicit
        # reconciliation; another branch is free to run in the meantime.
        next_allowed_at = _utc_datetime((gate_doc or {}).get("next_allowed_at"))
        if not (gate_doc or {}).get("frozen") and next_allowed_at and next_allowed_at > now:
            values["next_attempt_at"] = next_allowed_at
        await _db["whatsapp_campaign_job_items"].update_one(
            {"id": item["id"], "status": "claimed", "claim_token": claim_token},
            {"$set": values})
        return False
    owned = await _db["whatsapp_campaign_job_items"].update_one(
        {"id": item["id"], "status": "claimed", "claim_token": claim_token},
        {"$set": {"lane_token": lane_token}})
    if getattr(owned, "matched_count", 1) != 1:
        await _release_lane(item, lane_token, datetime.now(timezone.utc))
        return False
    # Configuration and connectivity are checked at execution, after pacing.
    config = await _handlers["get_config"](item["branch_id"])
    reason = _handlers["validate_config"](item["provider"], config)
    if reason:
        await _db["whatsapp_campaign_job_items"].update_one(
            {"id": item["id"], "status": "claimed", "claim_token": claim_token},
            {"$set": {"status": "pending",
                      "next_attempt_at": now + timedelta(minutes=5)}})
        await _db["whatsapp_campaign_jobs"].update_one({"id": item["job_id"]}, {"$set": {
            "status": "paused", "pause_reason": reason, "updated_at": now}})
        await _release_lane(item, lane_token, datetime.now(timezone.utc))
        await _notify_completed(item, "blocked")
        return False
    authorize = _handlers.get("authorize_dispatch")
    if authorize:
        decision = await authorize(item)
        action = (decision or {}).get("action", "send")
        if action != "send":
            state = "cancelled" if action == "cancel" else "pending"
            values = {"status": state}
            if decision.get("reason"):
                values["error"] = decision["reason"]
            if action == "defer":
                values["next_attempt_at"] = decision["until"]
            else:
                values["completed_at"] = datetime.now(timezone.utc)
            await _db["whatsapp_campaign_job_items"].update_one(
                {"id": item["id"], "status": "claimed", "claim_token": claim_token},
                {"$set": values})
            await _release_lane(item, lane_token, datetime.now(timezone.utc))
            await _refresh_job(item["job_id"])
            return False
    reservation = None
    try:
        if (item["provider"] in {"waha", "whatsflow"}
                and item.get("communication_kind") != "registration_followup"
                and not item.get("quota_reservation_id")):
            changed = await _db["whatsapp_campaign_job_items"].update_one(
                {"id": item["id"], "status": "claimed", "claim_token": claim_token},
                {"$set": {"status": "quota_reserving"}})
            if getattr(changed, "matched_count", 1) != 1:
                await _release_lane(item, lane_token, datetime.now(timezone.utc))
                return False
            reservation = await _handlers["reserve_quota"](
                item["branch_id"], int(config.get("waha_daily_limit") or 30), 1)
            changed = await _db["whatsapp_campaign_job_items"].update_one(
                {"id": item["id"], "status": "quota_reserving", "claim_token": claim_token},
                {"$set": {"status": "claimed", "quota_reservation_id": reservation["_id"],
                          "quota_reserved_at": datetime.now(timezone.utc)}})
            if getattr(changed, "matched_count", 1) != 1:
                await _freeze_lane(item, "quota reservation ownership lost", now)
                return False
        elif item.get("quota_reservation_id"):
            reservation = {"_id": item["quota_reservation_id"]}
    except Exception as exc:
        if reservation:
            await _db["whatsapp_campaign_job_items"].update_one(
                {"id": item["id"], "claim_token": claim_token},
                {"$set": {"status": "unknown", "completed_at": datetime.now(timezone.utc),
                          "error": "Quota was reserved but persistence outcome is uncertain"}})
            await _freeze_lane(item, "uncertain quota persistence", datetime.now(timezone.utc))
            await _refresh_job(item["job_id"])
            return False
        await _db["whatsapp_campaign_job_items"].update_one(
            {"id": item["id"], "status": {"$in": ["claimed", "quota_reserving"]},
             "claim_token": claim_token}, {"$set": {
                "status": "pending", "next_attempt_at": now + timedelta(minutes=5)}})
        await _db["whatsapp_campaign_jobs"].update_one({"id": item["job_id"]}, {"$set": {
            "status": "paused", "pause_reason": str(exc), "updated_at": now}})
        await _release_lane(item, lane_token, datetime.now(timezone.utc))
        return False
    # A reservation from a previous day is never carried into a new day's
    # send. It is definitely unsent, so refund idempotently, then freeze for
    # explicit operator review rather than silently moving quota days.
    if item.get("quota_reserved_at") and item["quota_reserved_at"].date() != datetime.now(timezone.utc).date():
        await _refund_item_quota(item)
        await _db["whatsapp_campaign_job_items"].update_one(
            {"id": item["id"], "status": "claimed", "claim_token": claim_token},
            {"$set": {"status": "unknown", "completed_at": datetime.now(timezone.utc),
                      "error": "Prior-day quota reservation was not dispatched"}})
        await _freeze_lane(item, "prior-day quota reservation", datetime.now(timezone.utc))
        await _refresh_job(item["job_id"])
        return False
    job = await _db["whatsapp_campaign_jobs"].find_one(
        {"id": item["job_id"], "branch_id": item["branch_id"]}
    )
    if job and job.get("cancel_requested"):
        item["lane_token"] = lane_token
        item["quota_reservation_id"] = (reservation or {}).get("_id") or item.get("quota_reservation_id")
        await _cancel_owned_item(item, datetime.now(timezone.utc))
        return False
    changed = await _db["whatsapp_campaign_job_items"].update_one(
        {"id": item["id"], "status": "claimed", "claim_token": claim_token},
        {"$set": {"status": "dispatching", "lease_until": now + timedelta(seconds=LEASE_SECONDS)}})
    if getattr(changed, "matched_count", 1) != 1:
        await _release_lane(item, lane_token, datetime.now(timezone.utc))
        await _refresh_job(item["job_id"])
        return False
    # ``started_at`` is the first real provider dispatch, not enqueue time.
    await _db["whatsapp_campaign_jobs"].update_one(
        {"id": item["job_id"], "started_at": {"$exists": False}},
        {"$set": {"started_at": datetime.now(timezone.utc)}},
    )
    try:
        async def assert_fence():
            lane = await _db["whatsapp_campaign_rate_gates"].find_one({
                "_id": item["branch_id"], "lease_token": lane_token, "frozen": {"$ne": True}})
            owned_item = await _db["whatsapp_campaign_job_items"].find_one({
                "id": item["id"], "status": "dispatching", "claim_token": claim_token})
            if not lane or not owned_item:
                raise RuntimeError("dispatch_fence_lost")
            recheck = _handlers.get("recheck_dispatch")
            if recheck and not await recheck(item):
                raise RuntimeError("dispatch_cancelled_by_live_recheck")
        success = await _handlers["send"](item, config, assert_fence)
    except Exception as exc:
        if str(exc) == "dispatch_cancelled_by_live_recheck":
            completed = await _db["whatsapp_campaign_job_items"].update_one({
                "id": item["id"], "status": "dispatching", "claim_token": claim_token}, {"$set": {
                "status": "cancelled", "completed_at": datetime.now(timezone.utc),
                "error": "registration_followup_stopped"}})
            if reservation:
                await _handlers["release_quota"](reservation["_id"], 1, item["id"])
            await _release_lane(item, lane_token, datetime.now(timezone.utc))
            await _refresh_job(item["job_id"])
            cancelled_item = await _db["whatsapp_campaign_job_items"].find_one(
                {"id": item["id"]}
            )
            await _notify_completed(cancelled_item or item, "cancelled")
            return False
        # Ambiguous transport exceptions are never retried and quota remains used.
        completed = await _db["whatsapp_campaign_job_items"].update_one({
            "id": item["id"], "status": "dispatching", "claim_token": claim_token}, {"$set": {
            "status": "unknown", "completed_at": datetime.now(timezone.utc),
            "error": type(exc).__name__}})
        reason = ("uncertain provider outcome" if getattr(completed, "matched_count", 1) == 1
                  else "dispatch completion ownership lost")
        await _freeze_lane(item, reason, datetime.now(timezone.utc))
    else:
        state = "sent" if success else "failed"
        if not success and reservation:
            await _handlers["release_quota"](reservation["_id"], 1, item["id"])
        completed_at = datetime.now(timezone.utc)
        completed = await _db["whatsapp_campaign_job_items"].update_one({
            "id": item["id"], "status": "dispatching", "claim_token": claim_token}, {"$set": {
            "status": state, "completed_at": completed_at}})
        if getattr(completed, "matched_count", 1) != 1:
            await _freeze_lane(item, "dispatch completion ownership lost", completed_at)
        elif not await _release_lane(item, lane_token, completed_at):
            await _freeze_lane(item, "lane token ownership lost after dispatch", completed_at)
    await _refresh_job(item["job_id"])
    final_item = await _db["whatsapp_campaign_job_items"].find_one({"id": item["id"]})
    await _notify_completed(final_item or item, (final_item or {}).get("status", "unknown"))
    return True


async def process_one(branch_id=None):
    """Process one item, optionally constrained to one branch.

    The optional branch argument is used by the parallel tenant tick.  Calls
    without it retain the historical one-item API while trying each pending
    branch until one can make progress, so a frozen head does not starve the
    rest of the queue.
    """
    now = datetime.now(timezone.utc)
    await _recover_crashed(now)
    if branch_id is not None:
        return await _process_one_for_branch(branch_id)
    for candidate_branch in await _pending_branch_ids():
        if await _process_one_for_branch(candidate_branch):
            return True
    return False


def _tenant_task_key(tenant):
    if isinstance(tenant, dict):
        tenant_id = (
            tenant.get("slug")
            or tenant.get("db_name")
            or tenant.get("id")
            or "default"
        )
    else:
        tenant_id = tenant or "default"
    return str(tenant_id)


async def _run_branch_task(task_key, branch_id):
    try:
        await _process_one_for_branch(branch_id)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        # A branch task must not become an unobserved task exception or stop
        # later tenants from getting their own queue tick.
        log.error("Bulk campaign branch task error: %s", type(exc).__name__)
    finally:
        task = asyncio.current_task()
        if _inflight_branch_tasks.get(task_key) is task:
            _inflight_branch_tasks.pop(task_key, None)


def _reap_branch_tasks():
    for task_key, task in list(_inflight_branch_tasks.items()):
        if not task.done():
            continue
        try:
            task.result()
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            log.error("Bulk campaign branch task reap error: %s", type(exc).__name__)
        if _inflight_branch_tasks.get(task_key) is task:
            _inflight_branch_tasks.pop(task_key, None)


async def _shutdown_branch_tasks():
    tasks = list(_inflight_branch_tasks.values())
    for task in tasks:
        if not task.done():
            task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    _inflight_branch_tasks.clear()


async def stop_worker():
    """Cancel and await detached branch tasks during worker shutdown."""
    await _shutdown_branch_tasks()


async def _tenant_tick(_tenant):
    # More than one process may run this; Mongo claims and gates serialize
    # them.  Branch tasks are deliberately detached from this short tenant
    # tick: a slow provider must not hold up later ticks or later tenants.
    now = datetime.now(timezone.utc)
    await _recover_crashed(now)
    _reap_branch_tasks()
    capacity = BRANCH_PARALLELISM - len(_inflight_branch_tasks)
    if capacity <= 0:
        return False
    branch_ids = await _tick_branch_ids(now)
    created = 0
    tenant_key = _tenant_task_key(_tenant)
    for branch_id in branch_ids:
        task_key = (tenant_key, branch_id)
        if task_key in _inflight_branch_tasks:
            continue
        if created >= capacity:
            break
        task = asyncio.create_task(_run_branch_task(task_key, branch_id))
        _inflight_branch_tasks[task_key] = task
        created += 1
    return bool(created)


async def worker_loop():
    while True:
        try:
            await for_each_active_tenant(_tenant_tick, label="whatsapp-bulk-jobs")
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            await _shutdown_branch_tasks()
            return
        except Exception as exc:
            log.error("Bulk campaign worker error: %s", type(exc).__name__)
            await asyncio.sleep(10)


def start_worker():
    global _started
    # Unit/integration test startup must never create an unsolicited sender;
    # tests exercise process_one explicitly with mocked providers.
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("ENVIRONMENT", "").lower() == "test":
        return
    if _started:
        return
    _started = True
    asyncio.ensure_future(worker_loop())