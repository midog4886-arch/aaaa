"""Durable, globally paced automatic WhatsApp campaign delivery.

The Mongo gate is deliberately acquired immediately before each provider call.
An item is changed to ``dispatching`` before the call; if its worker disappears,
recovery marks it ``unknown`` rather than retrying a possibly delivered message.
"""
import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from utils.tenant import for_each_active_tenant

log = logging.getLogger("whatsapp.bulk_jobs")
MIN_INTERVAL_SECONDS = max(60, int(os.environ.get("WHATSAPP_CAMPAIGN_INTERVAL_SECONDS", "60")))
LEASE_SECONDS = 600
_started = False
_db = None
_handlers = {}


def configure(db, **handlers):
    global _db, _handlers
    _db, _handlers = db, handlers


def public_job(job):
    if not job:
        return None
    return {k: v for k, v in job.items() if k not in {"_id", "tenant_slug"}}


async def enqueue(branch_id, provider, recipients, idempotency_key, attachments=None):
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
        "status": "initializing", "created_at": now, "updated_at": now,
        "total": total, "pending": total, "sent": 0, "failed": 0, "unknown": 0,
        "cancelled": 0, "attachment_count": len(attachment_list),
    }
    try:
        await jobs.insert_one(job)
    except DuplicateKeyError:
        return public_job(await jobs.find_one(scope)), False
    items = []
    for recipient_index, recipient in enumerate(recipients):
        media = attachment_list or [None]
        for media_index, attachment in enumerate(media):
            items.append({
                "id": str(uuid.uuid4()), "job_id": job["id"], "branch_id": branch_id,
                "provider": provider, "recipient_index": recipient_index,
                "media_index": media_index, "phone": recipient["phone"],
                "message": recipient["message"], "attachment": attachment,
                "status": "initializing", "created_at": now,
            })
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
    await _db["whatsapp_campaign_jobs"].update_one({"id": job_id}, {"$set": {
        **{k: counts[k] for k in ("sent", "failed", "unknown", "cancelled")},
        "pending": pending, "status": status, "updated_at": datetime.now(timezone.utc)}})


async def _acquire_gate(branch_id, provider, now):
    gates = _db["whatsapp_campaign_rate_gates"]
    # One branch-wide gate covers every automatic provider. A configuration
    # switch must not create a fresh lane and bypass the one-minute interval.
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
        {"$set": {"next_allowed_at": completed_at + timedelta(seconds=MIN_INTERVAL_SECONDS),
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


async def process_one():
    now = datetime.now(timezone.utc)
    await _recover_crashed(now)
    # Claim briefly only to select work. If the gate is busy, put it back; no
    # future slots are reserved, preventing delayed workers from bunching up.
    claim_token = str(uuid.uuid4())
    item = await _db["whatsapp_campaign_job_items"].find_one_and_update(
        {"status": "pending", "$or": [
            {"next_attempt_at": {"$exists": False}}, {"next_attempt_at": {"$lte": now}}]},
        {"$set": {"status": "claimed", "claim_token": claim_token,
                  "claim_until": now + timedelta(seconds=LEASE_SECONDS)}},
        sort=[("created_at", 1), ("recipient_index", 1), ("media_index", 1)],
        return_document=ReturnDocument.AFTER)
    if not item:
        return False
    parent = await _db["whatsapp_campaign_jobs"].find_one({"id": item["job_id"]})
    if not parent or parent.get("status") not in {"pending", "processing", "paused"}:
        await _db["whatsapp_campaign_job_items"].update_one(
            {"id": item["id"], "status": "claimed", "claim_token": claim_token},
            {"$set": {"status": "initializing"},
             "$unset": {"claim_token": "", "claim_until": ""}})
        return False
    if parent.get("cancel_requested"):
        await _cancel_owned_item(item, now)
        return False
    gate, lane_token = await _acquire_gate(
        item["branch_id"], item["provider"], datetime.now(timezone.utc))
    if not gate:
        gate_doc = await _db["whatsapp_campaign_rate_gates"].find_one(
            {"_id": item["branch_id"]})
        await _db["whatsapp_campaign_job_items"].update_one(
            {"id": item["id"], "status": "claimed", "claim_token": claim_token}, {"$set": {
                "status": "pending",
                "next_attempt_at": (gate_doc or {}).get(
                    "next_allowed_at", now + timedelta(seconds=MIN_INTERVAL_SECONDS))}})
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
        return False
    reservation = None
    try:
        if item["provider"] in {"waha", "whatsflow"} and not item.get("quota_reservation_id"):
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
    job = await _db["whatsapp_campaign_jobs"].find_one({"id": item["job_id"]})
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
    try:
        async def assert_fence():
            lane = await _db["whatsapp_campaign_rate_gates"].find_one({
                "_id": item["branch_id"], "lease_token": lane_token, "frozen": {"$ne": True}})
            owned_item = await _db["whatsapp_campaign_job_items"].find_one({
                "id": item["id"], "status": "dispatching", "claim_token": claim_token})
            if not lane or not owned_item:
                raise RuntimeError("dispatch_fence_lost")
        success = await _handlers["send"](item, config, assert_fence)
    except Exception as exc:
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
    return True


async def _tenant_tick(_tenant):
    # More than one process may run this; Mongo claims and gates serialize them.
    await process_one()


async def worker_loop():
    while True:
        try:
            await for_each_active_tenant(_tenant_tick, label="whatsapp-bulk-jobs")
            await asyncio.sleep(1)
        except asyncio.CancelledError:
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