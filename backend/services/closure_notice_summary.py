"""Read-only recipient summaries; the caller supplies a tenant-scoped DB."""
import re
from services.whatsapp_bulk_jobs import _recipient_status, _receipt_status


def notice_key(closure_id):
    return re.sub(r"[^A-Za-z0-9_-]", "", f"closure_notice_{closure_id}")[:100]


def recipient_state(row):
    items = row.get("items") or [{"status": status} for status in row.get("statuses") or []]
    statuses = {str(item.get("status") or "unknown").lower() for item in items}
    if statuses - {"initializing", "pending", "processing", "dispatching",
                   "claimed", "quota_reserving", "sent", "failed", "cancelled"}:
        return "unknown"
    if statuses & {"initializing", "pending", "processing", "dispatching", "claimed", "quota_reserving"}:
        return "pending"
    # A verified negative receipt must remain visible even where the historical
    # report helper prioritizes local provider acceptance over delivery failure.
    if any(item.get("provider_message_id") and
           _receipt_status(item.get("delivery_status") or item.get("receipt_status")) == "failed"
           for item in items):
        return "failed"
    status, _ = _recipient_status(items)
    return {"accepted": "sent", "delivered": "sent", "read": "sent",
            "failed": "failed", "cancelled": "cancelled"}.get(status, "unknown")


async def summaries(db, closures, allowed_branches=None):
    if not closures:
        return {}
    keys = {notice_key(c["id"]): c for c in closures}
    query = {"idempotency_key": {"$in": list(keys)}}
    if allowed_branches is not None:
        query["branch_id"] = {"$in": allowed_branches}
    jobs = await db.whatsapp_campaign_jobs.find(query, {
        "_id": 0, "id": 1, "branch_id": 1, "idempotency_key": 1,
        "status": 1, "recipient_count": 1, "total": 1,
    }).to_list(None)
    # Discard inconsistent legacy records rather than widen a closure's scope.
    jobs = [j for j in jobs if keys[j["idempotency_key"]].get("branch_id") in
            (None, "", "all", j["branch_id"])]
    by_id = {j["id"]: j for j in jobs}
    result = {c["id"]: {"jobs": [], "sent": 0, "pending": 0, "failed": 0,
              "unknown": 0, "cancelled": 0, "delivered": 0, "total": 0}
              for c in closures}
    counts = {j["id"]: dict(sent=0, pending=0, failed=0, unknown=0,
              cancelled=0, delivered=0, total=0) for j in jobs}
    identities = {j["id"]: {} for j in jobs}
    legacy = set()
    if jobs:
        # Group in Mongo: never return message bodies or phones. Multiple media
        # items for the same recipient must not inflate the number of people.
        match = {"job_id": {"$in": list(by_id)},
                 "branch_id": {"$in": list({j["branch_id"] for j in jobs})}}
        rows = db.whatsapp_campaign_job_items.aggregate([
            {"$match": match},
            {"$group": {
                "_id": {"job": "$job_id", "branch": "$branch_id",
                        "recipient": {"$ifNull": ["$recipient_id", {"$ifNull": ["$phone", "$recipient_index"]}]}},
                "items": {"$addToSet": {
                    "status": "$status",
                    "provider_message_id": "$provider_message_id",
                    "delivery_status": "$delivery_status",
                    "receipt_status": "$receipt_status",
                }},
                "member_id": {"$first": "$recipient_id"},
            }},
        ])
        async for row in rows:
            job = by_id.get(row["_id"]["job"])
            if not job or job["branch_id"] != row["_id"]["branch"]:
                continue
            count = counts[job["id"]]
            count["total"] += 1
            state = recipient_state(row)
            count[state] += 1
            if row.get("member_id"):
                identities[job["id"]][row["member_id"]] = state
            else:
                legacy.add(job["id"])
            if _recipient_status(row.get("items") or [])[0] in {"delivered", "read"}:
                count["delivered"] += 1
    for job in jobs:
        count = counts[job["id"]]
        # An initializing/interrupted job can have no items yet. Fail closed:
        # it remains enqueued, never "not sent, safe to retry".
        missing = max(0, (job.get("recipient_count", job.get("total", 0)) or 0) - count["total"])
        count["pending" if job["status"] == "initializing" else "unknown"] += missing
        count["total"] += missing
        summary = result[keys[job["idempotency_key"]]["id"]]
        summary["jobs"].append({**job, **count,
                               "recipient_states": identities[job["id"]],
                               "legacy_recipient_identity": job["id"] in legacy or bool(missing)})
        for field in count:
            summary[field] += count[field]
    for summary in result.values():
        summary["state"] = (
            "not_queued" if not summary["jobs"] else
            "unknown" if summary["unknown"] else
            "pending" if summary["pending"] else
            "completed_with_failures" if summary["failed"] or summary["cancelled"] else
            "zero_recipients" if not summary["total"] else "completed"
        )
    return result