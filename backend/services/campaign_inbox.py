"""Read-only inbox projection of campaign items; never dispatches or retries."""
from datetime import datetime, timezone


def iso(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat()
    return value or ""


def as_message(item):
    attachment = item.get("attachment") or {}
    phone = str(item["phone"]).split("@")[0]
    return {
        "id": f"campaign:{item['id']}",
        "conversation_id": f"{item['branch_id']}:{phone}",
        "branch_id": item["branch_id"], "provider": item["provider"],
        "provider_message_id": item.get("provider_message_id"),
        "phone": phone, "direction": "outbound", "source": "campaign",
        "type": attachment.get("media_type") or "text",
        "body": item.get("message", "") if not attachment or item.get("media_index", 0) == 0 or item["provider"] == "meta_cloud" else "",
        "status": item["status"],
        "created_at": iso(item.get("completed_at") or item.get("created_at")),
        "media_id": f"campaign:{item['id']}" if attachment else None,
        "mime_type": attachment.get("mime_type"), "filename": attachment.get("filename"),
    }


async def conversations(db, query):
    pipeline = [
        {"$match": {**query, "status": {"$ne": "initializing"}}},
        {"$addFields": {
            "_inbox_at": {"$ifNull": ["$completed_at", "$created_at"]},
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
        result.append({
            "id": message["conversation_id"], "branch_id": item["branch_id"],
            "provider": item["provider"], "phone": message["phone"],
            "contact_name": message["phone"], "unread_count": 0,
            "last_message": message["body"] or message["filename"] or "[message]",
            "last_message_at": message["created_at"], "last_direction": "outbound",
        })
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