"""Read-only inbox projection of campaign items; never dispatches or retries."""
from datetime import datetime, timezone


# A conversation preview must be copied as one unit: each value describes the
# same selected final message, rather than a mixture of stored/campaign rows.
PREVIEW_FIELDS = (
    "last_message", "last_message_at", "last_direction",
    "last_source", "last_status", "last_queue_status",
    "last_queued_at", "last_sent_at", "last_delivered_at", "last_read_at",
    "last_failed_at", "last_cancelled_at", "last_timestamp_kind",
)


def iso(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat()
    return value or ""


def _receipt_status(value):
    """Normalize provider receipt vocabulary without inferring a receipt."""
    status = str(value or "").strip().lower()
    if status in {"read", "played"}:
        return "read"
    if status in {"delivered", "device"}:
        return "delivered"
    if status in {"accepted", "sent", "server"}:
        return "accepted"
    if status in {"failed", "error"}:
        return "failed"
    return None


def _queue_display_status(value):
    status = str(value or "").strip().lower()
    if status in {
        "initializing", "pending", "claimed", "quota_reserving",
        "dispatching", "processing",
    }:
        return "pending"
    if status == "sent":
        return "sent"
    if status in {"failed", "error"}:
        return "failed"
    if status == "cancelled":
        return "cancelled"
    return "unknown"


def _display_fields(status, *, queued_at, sent_at=None, delivered_at=None,
                    read_at=None, failed_at=None, cancelled_at=None):
    """Select a timestamp only for the event that has actually occurred."""
    candidates = {
        "read": ((read_at, "read"), (delivered_at, "delivered"),
                 (sent_at, "sent"), (queued_at, "queued")),
        "delivered": ((delivered_at, "delivered"), (sent_at, "sent"),
                      (queued_at, "queued")),
        "sent": ((sent_at, "sent"), (queued_at, "queued")),
        "failed": ((failed_at, "failed"), (queued_at, "queued")),
        "cancelled": ((cancelled_at, "cancelled"), (queued_at, "queued")),
    }
    for timestamp, kind in candidates.get(status, ((queued_at, "queued"),)):
        if timestamp:
            return timestamp, kind
    return "", "unknown"


def as_message(item):
    attachment = item.get("attachment") or {}
    phone = str(item["phone"]).split("@")[0]
    queue_status = str(item.get("status") or "unknown")
    queue_display = _queue_display_status(queue_status)
    provider_message_id = item.get("provider_message_id")
    receipt = _receipt_status(
        item.get("delivery_status") or item.get("receipt_status")
    )
    # Delivery/read events are trustworthy only when their durable provider
    # correlation is present.  A local queue state is not a delivery receipt.
    if receipt in {"delivered", "read"} and not provider_message_id:
        receipt = None

    if receipt == "read":
        status = "read"
    elif receipt == "delivered":
        status = "delivered"
    elif receipt == "accepted":
        status = "sent"
    elif receipt == "failed":
        status = "failed"
    else:
        status = queue_display

    queued_at = iso(item.get("created_at"))
    actual_sent = status in {"sent", "delivered", "read"}
    # ``completed_at`` records completion of an item, not proof that an
    # enqueued/unknown/failed item reached the provider.
    sent_at = ""
    if actual_sent:
        sent_at = iso(item.get("accepted_at") or item.get("sent_at"))
        if not sent_at and queue_display == "sent":
            sent_at = iso(item.get("completed_at"))

    delivered_at = (
        iso(item.get("delivered_at"))
        if provider_message_id and receipt in {"delivered", "read"} else ""
    )
    read_at = (
        iso(item.get("read_at"))
        if provider_message_id and receipt == "read" else ""
    )
    failed_at = (
        iso(item.get("failed_at") or item.get("completed_at"))
        if status == "failed" else ""
    )
    cancelled_at = (
        iso(item.get("cancelled_at") or item.get("completed_at"))
        if status == "cancelled" else ""
    )
    display_at, timestamp_kind = _display_fields(
        status, queued_at=queued_at, sent_at=sent_at,
        delivered_at=delivered_at, read_at=read_at,
        failed_at=failed_at, cancelled_at=cancelled_at,
    )
    return {
        "id": f"campaign:{item['id']}",
        "conversation_id": f"{item['branch_id']}:{phone}",
        "branch_id": item["branch_id"], "provider": item["provider"],
        "provider_message_id": provider_message_id,
        "phone": phone, "direction": "outbound", "source": "campaign",
        "type": attachment.get("media_type") or "text",
        "body": item.get("message", "") if not attachment or item.get("media_index", 0) == 0 or item["provider"] == "meta_cloud" else "",
        # created_at deliberately remains queue chronology; display_at is the
        # evidence-backed presentation timestamp.
        "status": status, "queue_status": queue_status,
        "delivery_status": receipt,
        "created_at": queued_at, "queued_at": queued_at, "sent_at": sent_at,
        "delivered_at": delivered_at, "read_at": read_at,
        "failed_at": failed_at, "cancelled_at": cancelled_at,
        "timestamp_kind": timestamp_kind, "display_at": display_at,
        "media_id": f"campaign:{item['id']}" if attachment else None,
        "mime_type": attachment.get("mime_type"), "filename": attachment.get("filename"),
    }


async def conversations(db, query):
    pipeline = [
        {"$match": {**query, "status": {"$ne": "initializing"}}},
        {"$addFields": {
            # Queue creation is stable chronology.  Completion is not proof
            # that an item was sent, and must not reorder queued projections.
            "_inbox_at": {"$ifNull": ["$created_at", "$completed_at"]},
            "_inbox_phone": {"$arrayElemAt": [{"$split": ["$phone", "@"]}, 0]},
        }},
        {"$sort": {"_inbox_at": -1}},
        {"$group": {"_id": {"branch": "$branch_id", "phone": "$_inbox_phone"},
                     "item": {"$first": "$$ROOT"}}},
        {"$sort": {"item._inbox_at": -1}}, {"$limit": 200},
    ]
    grouped = await db["whatsapp_campaign_job_items"].aggregate(pipeline).to_list(200)
    result = []
    for group in grouped:
        item = group["item"]
        message = as_message(item)
        preview = {
            "id": message["conversation_id"], "branch_id": item["branch_id"],
            "provider": item["provider"], "phone": message["phone"],
            "contact_name": message["phone"], "unread_count": 0,
            "last_message": message["body"] or message["filename"] or "[message]",
            "last_message_at": message["display_at"], "last_direction": "outbound",
            "last_source": message["source"], "last_status": message["status"],
            "last_queue_status": message["queue_status"],
            "last_queued_at": message["queued_at"],
            "last_sent_at": message["sent_at"],
            "last_delivered_at": message["delivered_at"],
            "last_read_at": message["read_at"],
            "last_failed_at": message["failed_at"],
            "last_cancelled_at": message["cancelled_at"],
            "last_timestamp_kind": message["timestamp_kind"],
        }
        result.append(preview)
    return result


async def thread(db, branch_id, phone):
    rows = await db["whatsapp_campaign_job_items"].find({
        "branch_id": branch_id,
        "phone": {"$in": [phone, f"{phone}@s.whatsapp.net", f"{phone}@c.us"]},
        "status": {"$ne": "initializing"},
    }, {"_id": 0}).sort("created_at", -1).limit(500).to_list(500)
    return [as_message(item) for item in rows]


def merge_messages(stored, projected):
    by_provider = {
        (m.get("provider"), m["provider_message_id"]): m
        for m in stored if m.get("provider_message_id")
    }
    result = list(stored)
    for message in projected:
        existing = by_provider.get((message["provider"], message.get("provider_message_id")))
        if existing:
            existing["source"] = "campaign"
            # The projected queue record is authoritative for campaign
            # identity/queue chronology, while an exact-ID provider echo is
            # authoritative for receipts.  Keep the strongest observed state.
            existing["queue_status"] = message["queue_status"]
            existing["queued_at"] = message["queued_at"]
            existing["created_at"] = message["created_at"]
            existing["delivery_status"] = _winning_delivery_status(
                existing, message
            )
            existing["status"] = _winning_status(
                existing.get("status"), message.get("status")
            )
            for key in ("sent_at", "delivered_at", "read_at"):
                existing[key] = existing.get(key) or message.get(key) or ""
            if existing["status"] not in {"sent", "delivered", "read"}:
                # A terminal failure/cancellation is not evidence that the
                # provider accepted the message, even if a stale echo carried
                # an old local sent timestamp.
                existing["sent_at"] = ""
            display_at, timestamp_kind = _display_fields(
                existing["status"],
                queued_at=existing.get("queued_at") or existing.get("created_at"),
                sent_at=existing.get("sent_at"),
                delivered_at=existing.get("delivered_at"),
                read_at=existing.get("read_at"),
                failed_at=existing.get("failed_at") or (
                    message.get("display_at")
                    if message.get("timestamp_kind") == "failed" else ""
                ),
                cancelled_at=existing.get("cancelled_at"),
            )
            existing["display_at"] = display_at
            existing["timestamp_kind"] = timestamp_kind
            if message.get("media_id"):
                # Provider echoes may omit URLs (or contain encrypted media).
                # Keep the authenticated local attachment while retaining receipts.
                existing.update({key: message[key] for key in (
                    "id", "media_id", "mime_type", "filename", "type",
                )})
                if not existing.get("body"):
                    existing["body"] = message["body"]
        else:
            result.append(message)
    return sorted(result, key=lambda m: iso(m.get("created_at")))[-500:]


def _winning_status(current, incoming):
    """Monotonic receipt state: delayed queue echoes cannot regress receipts."""
    def normalized(value):
        value = str(value or "").lower()
        return value if value in {
            "pending", "sent", "delivered", "read", "failed", "cancelled",
            "unknown",
        } else ({
            "accepted": "sent",
            "server": "sent",
            "error": "failed",
        }.get(value) or _queue_display_status(value))

    current = normalized(current)
    incoming = normalized(incoming)
    rank = {
        "unknown": 0, "pending": 1, "sent": 2, "failed": 3,
        "cancelled": 3, "delivered": 4, "read": 5,
    }
    return incoming if rank[incoming] > rank[current] else current


def _winning_delivery_status(existing, message):
    """Keep the strongest exact-ID receipt without treating local sent as one."""
    candidates = (
        _receipt_status(existing.get("delivery_status")),
        _receipt_status(existing.get("receipt_status")),
        _receipt_status(existing.get("status")),
        _receipt_status(message.get("delivery_status")),
    )
    candidates = [value for value in candidates if value]
    winner = _winning_status(existing.get("status"), message.get("status"))
    if winner in {"read", "delivered"}:
        return winner
    if winner == "failed":
        return "failed" if "failed" in candidates else None
    if winner == "sent":
        return "accepted" if "accepted" in candidates else None
    return None