"""Notifications routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Any, List, Optional
import uuid
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user
from utils.auth import resolve_branch_filter

router = APIRouter(prefix="/notifications", tags=["notifications"])


# ── Daily-checks scheduler settings ────────────────────────────────────────
# Singleton document in ``db.notifications_settings`` (key=``daily_checks``)
# holding the hour-of-day (and optional minute) in Asia/Riyadh that the
# daily renewal & ad-expiry checks should run at. Falls back to 07:00 when
# nothing is stored. Stored docs that pre-date the minute field are treated
# as ``minute=0`` for backwards compatibility.
_DAILY_CHECKS_DEFAULT_HOUR = 7
_DAILY_CHECKS_DEFAULT_MINUTE = 0
_DAILY_CHECKS_SETTINGS_KEY = "daily_checks"
# Days the scheduler is allowed to run on. Stored as 3-letter abbreviations
# (Sun..Sat). Default is every day so behaviour is unchanged for academies
# that never opted in. We resolved a rebase conflict with an alternative
# integer-based (0..6) implementation by standardizing on strings.
_DAILY_CHECKS_VALID_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
_DAILY_CHECKS_DEFAULT_DAYS = list(_DAILY_CHECKS_VALID_DAYS)


def _coerce_days(raw) -> list:
    """Return a deduped, canonical subset of valid day abbreviations.

    Accepts case-insensitive 3-letter abbreviations *and* legacy integer
    encodings (0=Sun..6=Sat) to stay compatible with any docs written by
    an earlier integer-based implementation that briefly landed on main.
    Anything outside those forms is dropped silently. May return an empty
    list — callers decide whether to treat that as "fall back to default"
    (read path) or as a validation error (write path).
    """
    if not raw or not isinstance(raw, (list, tuple)):
        return []
    canon = {d.lower(): d for d in _DAILY_CHECKS_VALID_DAYS}
    seen = set()
    out = []
    for item in raw:
        key = None
        if isinstance(item, str):
            key = item.strip().lower()[:3]
        elif isinstance(item, bool):
            # bools are ints in Python — guard against True/False creeping in
            continue
        elif isinstance(item, int):
            if 0 <= item <= 6:
                # Legacy integer encoding: 0=Sun..6=Sat
                key = _DAILY_CHECKS_VALID_DAYS[item].lower()
        if key in canon and key not in seen:
            seen.add(key)
            out.append(canon[key])
    # Preserve canonical Sun..Sat ordering for stable display
    return [d for d in _DAILY_CHECKS_VALID_DAYS if d in out]


def _normalize_days(raw) -> list:
    """Read-path helper: coerce ``raw`` and fall back to all 7 days.

    Used when reading settings from the DB so docs that pre-date the
    field — or contain only invalid entries — keep the original "every
    day" behaviour. Write paths should call :func:`_coerce_days` directly
    and reject empty results instead.
    """
    coerced = _coerce_days(raw)
    return coerced or list(_DAILY_CHECKS_DEFAULT_DAYS)


async def get_daily_checks_hour() -> int:
    """Return the configured hour-of-day (0-23) for daily renewal/ad checks.

    Kept for backwards compatibility with any external caller; new code
    should prefer :func:`get_daily_checks_time` which also returns the
    minute. Falls back to the default on any error.
    """
    hour, _minute = await get_daily_checks_time()
    return hour


async def get_daily_checks_time() -> tuple:
    """Return ``(hour, minute)`` for the daily renewal/ad checks.

    Reads from ``db.notifications_settings`` (singleton keyed by ``key``).
    Returns the defaults (07:00) when no setting is stored or the values
    are invalid. Never raises — failures fall back to the defaults so the
    scheduler keeps working even if the DB is briefly unreachable. Docs
    written before the minute field existed are treated as ``minute=0``.
    """
    try:
        doc = await db.notifications_settings.find_one(
            {"key": _DAILY_CHECKS_SETTINGS_KEY}, {"_id": 0}
        )
    except Exception:
        return _DAILY_CHECKS_DEFAULT_HOUR, _DAILY_CHECKS_DEFAULT_MINUTE
    if not doc:
        return _DAILY_CHECKS_DEFAULT_HOUR, _DAILY_CHECKS_DEFAULT_MINUTE
    try:
        hour = int(doc.get("hour"))
    except (TypeError, ValueError):
        hour = _DAILY_CHECKS_DEFAULT_HOUR
    if not (0 <= hour <= 23):
        hour = _DAILY_CHECKS_DEFAULT_HOUR
    raw_minute = doc.get("minute", _DAILY_CHECKS_DEFAULT_MINUTE)
    try:
        minute = int(raw_minute)
    except (TypeError, ValueError):
        minute = _DAILY_CHECKS_DEFAULT_MINUTE
    if not (0 <= minute <= 59):
        minute = _DAILY_CHECKS_DEFAULT_MINUTE
    return hour, minute


async def get_daily_checks_days() -> list:
    """Return the configured run days (subset of Sun..Sat).

    Falls back to all 7 days if the setting is missing, the DB lookup
    fails, or the stored value is invalid — preserving backwards
    compatibility with docs that pre-date the ``days_of_week`` field.
    """
    try:
        doc = await db.notifications_settings.find_one(
            {"key": _DAILY_CHECKS_SETTINGS_KEY}, {"_id": 0}
        )
    except Exception:
        return list(_DAILY_CHECKS_DEFAULT_DAYS)
    if not doc or "days_of_week" not in doc:
        return list(_DAILY_CHECKS_DEFAULT_DAYS)
    return _normalize_days(doc.get("days_of_week"))


class DailyChecksSettings(BaseModel):
    hour: int
    minute: Optional[int] = 0
    # Accept either string abbreviations (preferred) or legacy ints (0..6).
    # Validation/coercion happens in the endpoint via ``_coerce_days``.
    days_of_week: Optional[List[Any]] = None


@router.get("/daily-checks-settings")
async def get_daily_checks_settings(current_user: dict = Depends(get_current_user)):
    """Return the configured daily-checks hour, minute & run days (Asia/Riyadh)."""
    hour, minute = await get_daily_checks_time()
    days = await get_daily_checks_days()
    return {
        "hour": hour,
        "minute": minute,
        "days_of_week": days,
        "default_hour": _DAILY_CHECKS_DEFAULT_HOUR,
        "default_minute": _DAILY_CHECKS_DEFAULT_MINUTE,
        "default_days_of_week": list(_DAILY_CHECKS_DEFAULT_DAYS),
        "valid_days_of_week": list(_DAILY_CHECKS_VALID_DAYS),
        "timezone": "Asia/Riyadh",
    }


@router.put("/daily-checks-settings")
async def update_daily_checks_settings(
    payload: DailyChecksSettings,
    current_user: dict = Depends(get_current_user),
):
    """Admin-only: update the hour (0-23), minute (0-59) and the days of
    the week (subset of Sun..Sat) the daily renewal & ad-expiry checks run
    on. Takes effect on the next scheduler tick (within ~24 hours, or
    immediately on next restart). Omitting ``days_of_week`` keeps the
    previously stored value (or the default of all 7 days)."""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    hour = payload.hour
    if not isinstance(hour, int) or hour < 0 or hour > 23:
        raise HTTPException(status_code=400, detail="hour must be an integer between 0 and 23")
    minute = payload.minute if payload.minute is not None else 0
    if not isinstance(minute, int) or minute < 0 or minute > 59:
        raise HTTPException(status_code=400, detail="minute must be an integer between 0 and 59")
    update_doc = {
        "hour": hour,
        "minute": minute,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    days_payload = payload.days_of_week
    if days_payload is not None:
        # Strict write-path validation: drop unknown entries via _coerce_days
        # but reject the result when nothing valid remains, so an explicit
        # but malformed payload never silently falls back to "every day".
        # ``_coerce_days`` accepts both string abbreviations and legacy
        # integer encodings (0=Sun..6=Sat) for compatibility.
        coerced = _coerce_days(days_payload)
        if not coerced:
            raise HTTPException(
                status_code=400,
                detail="days_of_week must contain at least one of: " + ", ".join(_DAILY_CHECKS_VALID_DAYS),
            )
        update_doc["days_of_week"] = coerced
    before_doc = await db.notifications_settings.find_one(
        {"key": _DAILY_CHECKS_SETTINGS_KEY}, {"_id": 0}
    )
    await db.notifications_settings.update_one(
        {"key": _DAILY_CHECKS_SETTINGS_KEY},
        {"$set": update_doc},
        upsert=True,
    )
    days_after = await get_daily_checks_days()
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="settings.daily_checks.update",
            entity_type="settings",
            entity_id=_DAILY_CHECKS_SETTINGS_KEY,
            before=before_doc,
            after={**(before_doc or {}), **update_doc, "days_of_week": days_after},
        )
    except Exception:
        pass
    return {
        "hour": hour,
        "minute": minute,
        "days_of_week": days_after,
        "default_hour": _DAILY_CHECKS_DEFAULT_HOUR,
        "default_minute": _DAILY_CHECKS_DEFAULT_MINUTE,
        "default_days_of_week": list(_DAILY_CHECKS_DEFAULT_DAYS),
        "valid_days_of_week": list(_DAILY_CHECKS_VALID_DAYS),
        "timezone": "Asia/Riyadh",
    }


@router.get("/daily-checks-status")
async def get_daily_checks_status(current_user: dict = Depends(get_current_user)):
    """Admin-only: return the last-run status of the daily checks scheduler.

    Returns ``{has_run: false}`` when the scheduler has never persisted a
    status doc (e.g. fresh deployment, or it has not yet fired since the
    feature was added). Otherwise returns the persisted fields:
    ``last_run_at``, ``success``, ``renewals_created``, ``ads_flagged``,
    ``error_count``, ``errors`` (capped), ``trigger``, ``duration_seconds``.
    """
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        doc = await db.notifications_settings.find_one(
            {"key": "daily_checks_status"}, {"_id": 0, "key": 0}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read status: {e}")
    if not doc:
        return {"has_run": False}
    return {"has_run": True, **doc}


_OPS_ALERTS_DELIVERY_KEY = "ops_alerts_delivery"


class OpsAlertsDeliverySettings(BaseModel):
    email_enabled: Optional[bool] = None
    whatsapp_enabled: Optional[bool] = None


@router.get("/ops-alerts-settings")
async def get_ops_alerts_settings(current_user: dict = Depends(get_current_user)):
    """Admin-only: per-tenant opt-in/out toggle for ops-alert outbound
    transports (email + WhatsApp). Defaults to both enabled so deployments
    that already configured the env vars keep their current behaviour.
    """
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        doc = await db.notifications_settings.find_one(
            {"key": _OPS_ALERTS_DELIVERY_KEY}, {"_id": 0, "key": 0}
        ) or {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read settings: {e}")
    return {
        "email_enabled": bool(doc.get("email_enabled", True)),
        "whatsapp_enabled": bool(doc.get("whatsapp_enabled", True)),
        "updated_at": doc.get("updated_at"),
    }


@router.put("/ops-alerts-settings")
async def update_ops_alerts_settings(
    payload: OpsAlertsDeliverySettings,
    current_user: dict = Depends(get_current_user),
):
    """Admin-only: enable/disable individual outbound channels for ops
    alerts. Omitted fields keep their previously stored value (defaulting
    to enabled). Only affects future delivery attempts — previously queued
    alerts are re-evaluated against the new toggle on the worker's next
    tick, so disabling a channel mid-retry stops further attempts on it.
    """
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    before = await db.notifications_settings.find_one(
        {"key": _OPS_ALERTS_DELIVERY_KEY}, {"_id": 0}
    ) or {}
    update_doc = {
        "key": _OPS_ALERTS_DELIVERY_KEY,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.email_enabled is not None:
        update_doc["email_enabled"] = bool(payload.email_enabled)
    if payload.whatsapp_enabled is not None:
        update_doc["whatsapp_enabled"] = bool(payload.whatsapp_enabled)
    await db.notifications_settings.update_one(
        {"key": _OPS_ALERTS_DELIVERY_KEY},
        {"$set": update_doc},
        upsert=True,
    )
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="settings.ops_alerts.update",
            entity_type="settings",
            entity_id=_OPS_ALERTS_DELIVERY_KEY,
            before=before,
            after={**before, **update_doc},
        )
    except Exception:
        pass
    merged = {**before, **update_doc}
    return {
        "email_enabled": bool(merged.get("email_enabled", True)),
        "whatsapp_enabled": bool(merged.get("whatsapp_enabled", True)),
        "updated_at": merged.get("updated_at"),
    }


_OPS_ALERTS_VALID_STATUSES = {"pending", "retrying", "delivered", "exhausted"}


@router.get("/ops-alerts")
async def list_ops_alerts(
    delivery_status: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
):
    """Admin-only: return the most recent ops_alerts rows with their
    per-channel delivery state. Optional ``delivery_status`` filter
    accepts ``pending``, ``retrying``, ``delivered``, or ``exhausted``.
    """
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        cap = max(1, min(int(limit), 200))
    except (TypeError, ValueError):
        cap = 50
    query: dict = {}
    if delivery_status:
        if delivery_status not in _OPS_ALERTS_VALID_STATUSES:
            raise HTTPException(
                status_code=400,
                detail="delivery_status must be one of: " + ", ".join(sorted(_OPS_ALERTS_VALID_STATUSES)),
            )
        query["delivery_status"] = delivery_status
    try:
        rows = await db.ops_alerts.find(query, {"_id": 0}).sort("created_at", -1).to_list(cap)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read ops_alerts: {e}")
    # Normalise legacy rows that pre-date the delivery-bookkeeping fields
    # so the UI can render them without per-row defensive defaults.
    for r in rows:
        r.setdefault("attempts", 0)
        r.setdefault("delivered_email", False)
        r.setdefault("delivered_whatsapp", False)
        r.setdefault("last_error", "")
        r.setdefault("delivery_status", "delivered" if r.get("acknowledged") else "pending")
        r.setdefault("next_attempt_at", None)
        r.setdefault("last_attempt_at", None)
    return {"items": rows, "count": len(rows)}


@router.post("/ops-alerts/{alert_id}/retry")
async def retry_ops_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    """Admin-only: re-queue an ops_alerts row so the delivery worker
    picks it up on its next tick. Resets ``acknowledged``, ``attempts``,
    ``last_error`` and sets ``next_attempt_at`` to now.
    """
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        result = await db.ops_alerts.update_one(
            {"id": alert_id},
            {"$set": {
                "acknowledged": False,
                "attempts": 0,
                "next_attempt_at": now_iso,
                "last_error": "",
                "delivery_status": "pending",
                # Re-attempt every channel regardless of prior delivery so
                # transient failures the admin is investigating get retried.
                "delivered_email": False,
                "delivered_whatsapp": False,
            }, "$unset": {"acknowledged_at": ""}},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retry alert: {e}")
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ops alert not found")
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="ops_alerts.retry",
            entity_type="ops_alert",
            entity_id=alert_id,
        )
    except Exception:
        pass
    return {"ok": True, "id": alert_id, "next_attempt_at": now_iso}


@router.post("/ops-alerts/clear-delivered")
async def clear_delivered_ops_alerts(
    older_than_days: int = 7,
    current_user: dict = Depends(get_current_user),
):
    """Admin-only: delete ops_alerts rows whose ``delivery_status`` is
    ``delivered`` and whose ``created_at`` is older than ``older_than_days``
    days ago. Returns the count of removed rows. Audit-logged.
    """
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        days = int(older_than_days)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="older_than_days must be an integer")
    if days < 0 or days > 3650:
        raise HTTPException(status_code=400, detail="older_than_days must be between 0 and 3650")
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_iso = cutoff.isoformat()
    try:
        result = await db.ops_alerts.delete_many({
            "delivery_status": "delivered",
            "created_at": {"$lt": cutoff_iso},
        })
        deleted = int(result.deleted_count or 0)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear ops_alerts: {e}")
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="ops_alerts.clear_delivered",
            entity_type="ops_alert",
            entity_id="bulk",
            after={"older_than_days": days, "cutoff": cutoff_iso, "deleted": deleted},
        )
    except Exception:
        pass
    return {"ok": True, "deleted": deleted, "older_than_days": days, "cutoff": cutoff_iso}


@router.delete("/ops-alerts/{alert_id}")
async def delete_ops_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    """Admin-only: delete a single ops_alerts row (e.g. an exhausted alert
    the admin has investigated). Audit-logged.
    """
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        existing = await db.ops_alerts.find_one({"id": alert_id}, {"_id": 0})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read ops_alert: {e}")
    if not existing:
        raise HTTPException(status_code=404, detail="Ops alert not found")
    try:
        await db.ops_alerts.delete_one({"id": alert_id})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete ops_alert: {e}")
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="ops_alerts.delete",
            entity_type="ops_alert",
            entity_id=alert_id,
            before=existing,
        )
    except Exception:
        pass
    return {"ok": True, "id": alert_id}


@router.post("/daily-checks-run")
async def run_daily_checks_now(current_user: dict = Depends(get_current_user)):
    """Admin-only: trigger the daily renewal & ad-expiry checks on demand.

    Runs synchronously and returns the same summary dict that gets persisted
    to the status doc. The underlying check endpoints already dedupe per-day
    so triggering this multiple times is safe.
    """
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    # Lazy import to avoid a top-level circular import (server.py imports
    # this module).
    from server import _run_daily_renewal_and_ads_checks
    summary = await _run_daily_renewal_and_ads_checks(trigger="manual")
    return summary


async def send_to_coach(
    coach_id: str,
    title: str,
    message: str,
    notif_type: str = "info",
    link: Optional[str] = None,
    branch_id: Optional[str] = None,
    tag: Optional[str] = None,
    title_en: Optional[str] = None,
    message_en: Optional[str] = None,
) -> dict:
    """Notify a coach via in-app notification + push (FCM/Web Push).

    Stores a record in ``db.notifications`` (with ``coach_id``) and best-effort
    sends a push notification to any active ``push_subscriptions`` registered
    for ``member_id == coach_id`` (coaches reuse the member subscription
    channel keyed by their id).

    Failures are swallowed so the caller's main operation cannot fail because
    of notification delivery problems. Returns a small dict describing what
    happened (useful for tests / debugging).
    """
    import logging
    logger = logging.getLogger(__name__)
    result = {"in_app": False, "push_sent": 0, "push_failed": 0}

    try:
        # Persist both Arabic (default ``title``/``message`` args) and the
        # optional English variants so the admin notification bell can render
        # the alert in the viewer's chosen language. Layout falls back to the
        # legacy ``title``/``message`` keys when the bilingual ones are absent.
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "title": title,
            "message": message,
            "title_ar": title,
            "message_ar": message,
            "title_en": title_en or title,
            "message_en": message_en or message,
            "type": notif_type,
            "link": link,
            "coach_id": coach_id,
            "branch_id": branch_id,
            "is_read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        result["in_app"] = True
    except Exception as exc:
        logger.error(f"send_to_coach: failed to insert notification: {exc}")

    try:
        from .push_notifications import send_push_notification, NotificationPayload
        payload = NotificationPayload(
            title=title,
            body=message,
            title_en=title_en or title,
            body_en=message_en or message,
            url=link or "/",
            tag=tag or f"coach-{coach_id}-{uuid.uuid4()}",
            data={"type": notif_type, "coach_id": coach_id},
        )
        subs = await db.push_subscriptions.find(
            {"member_id": coach_id, "is_active": True}, {"_id": 0}
        ).to_list(50)
        for sub in subs:
            try:
                ok = await send_push_notification(sub, payload)
                if ok:
                    result["push_sent"] += 1
                else:
                    result["push_failed"] += 1
            except Exception as exc:
                result["push_failed"] += 1
                logger.error(f"send_to_coach: push send failed: {exc}")
    except Exception as exc:
        logger.error(f"send_to_coach: push pipeline error: {exc}")

    return result

# ============ MODELS ============

class NotificationCreate(BaseModel):
    title: str
    message: str
    type: str = "info"  # info, warning, success, error
    link: Optional[str] = None

class Notification(BaseModel):
    id: str
    title: str
    message: str
    type: str
    link: Optional[str] = None
    is_read: bool = False
    branch_id: Optional[str] = None
    created_at: str

# ============ ROUTES ============

@router.get("")
async def get_notifications(
    is_read: Optional[bool] = None,
    tag: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get notifications for the current user's branch"""
    effective_branch = resolve_branch_filter(current_user, None)

    query = {}
    if effective_branch:
        query["branch_id"] = effective_branch
    if is_read is not None:
        query["is_read"] = is_read
    if tag:
        query["tag"] = tag

    notifications = await db.notifications.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return notifications

@router.get("/unread-count")
async def get_unread_count(current_user: dict = Depends(get_current_user)):
    """Get count of unread notifications"""
    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch = resolve_branch_filter(current_user, None)

    query = {"is_read": False}
    if effective_branch:
        query["branch_id"] = effective_branch

    count = await db.notifications.count_documents(query)
    return {"unread_count": count}

@router.put("/{notification_id}/read")
async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Mark a notification as read (scoped to the user's branch)"""
    effective_branch = resolve_branch_filter(current_user, None)
    query = {"id": notification_id}
    if effective_branch:
        query["$or"] = [{"branch_id": effective_branch}, {"branch_id": None}]
    result = await db.notifications.update_one(query, {"$set": {"is_read": True}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Notification marked as read"}

@router.put("/mark-all-read")
async def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
    """Mark all notifications as read for the current branch"""
    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch = resolve_branch_filter(current_user, None)

    query = {}
    if effective_branch:
        query["branch_id"] = effective_branch

    result = await db.notifications.update_many(
        query,
        {"$set": {"is_read": True}}
    )
    return {"message": f"Marked {result.modified_count} notifications as read"}

@router.delete("/{notification_id}")
async def delete_notification(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a notification (scoped to the user's branch)"""
    effective_branch = resolve_branch_filter(current_user, None)
    query = {"id": notification_id}
    if effective_branch:
        query["$or"] = [{"branch_id": effective_branch}, {"branch_id": None}]
    result = await db.notifications.delete_one(query)
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Notification deleted"}

@router.post("/check-renewals")
async def check_subscription_renewals(current_user: dict = Depends(get_current_user)):
    """Check for expiring subscriptions and create notifications"""
    # Branch filtering — fail-closed for non-admins without a branch_id.
    # Notifications written below carry this branch_id, so admins running
    # this check without an associated branch get global-scoped notifications.
    effective_branch = resolve_branch_filter(current_user, None)
    branch_id = effective_branch
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Find members with activities expiring in the next 7 days
    week_later = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")

    query = {
        "activities": {
            "$elemMatch": {
                "status": "active",
                "end_date": {"$gte": today, "$lte": week_later}
            }
        }
    }
    if branch_id:
        query["branch_id"] = branch_id
    
    members = await db.members.find(query, {"_id": 0}).to_list(1000)
    
    notifications_created = 0
    for member in members:
        for activity in member.get("activities", []):
            if activity.get("status") == "active":
                end_date = activity.get("end_date", "")
                if today <= end_date <= week_later:
                    # Check if notification already exists
                    existing = await db.notifications.find_one({
                        "type": "renewal_reminder",
                        "member_id": member["id"],
                        "activity_id": activity.get("activity_id"),
                        "created_at": {"$gte": today}
                    })
                    
                    if not existing:
                        notification_id = str(uuid.uuid4())
                        member_name = member.get('name_ar', '') or member.get('name', '')
                        member_name_en = member.get('name', '') or member.get('name_ar', '')
                        activity_name = activity.get('activity_name', '')
                        title_ar = "تنبيه تجديد اشتراك"
                        title_en = "Subscription Renewal Reminder"
                        message_ar = f"اشتراك {member_name} في {activity_name} ينتهي بتاريخ {end_date}"
                        message_en = f"{member_name_en}'s subscription in {activity_name} expires on {end_date}"
                        await db.notifications.insert_one({
                            "id": notification_id,
                            "title": title_ar,
                            "title_ar": title_ar,
                            "title_en": title_en,
                            "message": message_ar,
                            "message_ar": message_ar,
                            "message_en": message_en,
                            "type": "renewal_reminder",
                            "member_id": member["id"],
                            "activity_id": activity.get("activity_id"),
                            "is_read": False,
                            "branch_id": branch_id,
                            "created_at": datetime.now(timezone.utc).isoformat()
                        })
                        notifications_created += 1
                        # Best-effort push to admins so they hear about the
                        # expiring subscription on their device, in their saved
                        # language. Failures are swallowed so a push hiccup
                        # doesn't break the in-app notification creation.
                        try:
                            from .push_notifications import send_push_to_admins, NotificationPayload
                            await send_push_to_admins(
                                NotificationPayload(
                                    title=title_ar, body=message_ar,
                                    title_en=title_en, body_en=message_en,
                                    url=f"/admin/members?search={member.get('name_ar', '')}",
                                    tag=f"renewal-{member['id']}-{activity.get('activity_id')}-{end_date}",
                                    data={
                                        "type": "renewal_reminder",
                                        "member_id": member["id"],
                                        "activity_id": activity.get("activity_id"),
                                        "end_date": end_date,
                                    },
                                ),
                                branch_id=branch_id,
                            )
                        except Exception:
                            import logging
                            logging.getLogger(__name__).exception("renewal-reminder push failed")
    
    return {
        "message": f"Created {notifications_created} renewal notifications",
        "count": notifications_created,
        "notifications_created": notifications_created,
    }

@router.get("/expiring-subscriptions")
async def get_expiring_subscriptions(
    days: int = 7,
    branch_filter: Optional[str] = None,
    include_expired: bool = True,
    current_user: dict = Depends(get_current_user)
):
    """Get list of subscriptions expiring within specified days.

    Also includes already-expired subscriptions (negative days_remaining) so the
    Renewals page can display both tabs from a single request. Each item is
    enriched with last_attendance_date (used to compute renewal-likelihood
    badges client-side), activity_id, fee, and branch_id.
    """
    user_branch_id = current_user.get("branch_id")
    is_admin = current_user.get("is_admin", False)
    today_dt = datetime.now(timezone.utc).replace(tzinfo=None)
    today = today_dt.strftime("%Y-%m-%d")
    future_date = (today_dt + timedelta(days=days)).strftime("%Y-%m-%d")
    # Look back up to 90 days for already-expired subscriptions when requested
    past_date = (today_dt - timedelta(days=90)).strftime("%Y-%m-%d")
    lower_bound = past_date if include_expired else today

    query = {
        "activities": {
            "$elemMatch": {
                "status": "active",
                "end_date": {"$gte": lower_bound, "$lte": future_date},
            }
        }
    }
    # Branch scoping centralized via ``resolve_branch_filter``:
    # - Non-admins are always locked to their own branch (branch_filter is ignored).
    #   A non-admin without a branch_id is denied entirely (fail-closed).
    # - Admins may use branch_filter to target a specific branch, or "all" to span branches.
    # - Special legacy behavior: an admin without an explicit branch_filter falls
    #   back to their own assigned branch (if any) so a branch-attached admin
    #   keeps seeing their branch by default.
    if is_admin and not (branch_filter and branch_filter != "all") and user_branch_id:
        query["branch_id"] = user_branch_id
    else:
        effective_branch = resolve_branch_filter(current_user, branch_filter)
        if effective_branch:
            query["branch_id"] = effective_branch

    members = await db.members.find(query, {"_id": 0}).to_list(2000)

    member_ids = [m["id"] for m in members if m.get("id")]

    # Bulk-fetch each member's latest attendance date in one aggregation
    last_attendance_map: dict = {}
    if member_ids:
        try:
            cursor = db.attendance.aggregate([
                {"$match": {"member_id": {"$in": member_ids}}},
                {"$group": {"_id": "$member_id", "last": {"$max": "$date"}}},
            ])
            async for row in cursor:
                if row.get("_id"):
                    last_attendance_map[row["_id"]] = row.get("last")
        except Exception:
            last_attendance_map = {}

    expiring = []
    for member in members:
        for activity in member.get("activities", []):
            if activity.get("status") != "active":
                continue
            end_date = activity.get("end_date", "")
            if not end_date or not (lower_bound <= end_date <= future_date):
                continue
            try:
                days_remaining = (datetime.strptime(end_date[:10], "%Y-%m-%d") - today_dt).days
            except Exception:
                days_remaining = 0
            expiring.append({
                "member_id": member["id"],
                "member_name": member.get("name_ar", member.get("name", "")),
                "member_code": member.get("member_code", ""),
                "phone": member.get("phone", ""),
                "branch_id": member.get("branch_id"),
                "activity_id": activity.get("activity_id", ""),
                "activity_name": activity.get("activity_name", ""),
                "fee": activity.get("fee", 0),
                "coach_id": activity.get("coach_id", ""),
                "end_date": end_date,
                "days_remaining": days_remaining,
                "last_attendance_date": last_attendance_map.get(member["id"]),
            })

    # Sort by days remaining (ascending: most urgent first)
    expiring.sort(key=lambda x: x.get("days_remaining", 999))

    return expiring


@router.post("/check-ads-expiry")
async def check_ads_expiry(current_user: dict = Depends(get_current_user)):
    """Check for expiring and expired advertisements and create notifications"""
    # Branch filtering — fail-closed for non-admins without a branch_id.
    # Ads without a branch (shared/legacy) are visible to everyone, hence the $or.
    effective_branch = resolve_branch_filter(current_user, None)
    branch_id = effective_branch  # used below when stamping new notifications
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Date 3 days from now
    three_days_later = (datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%d")

    query = {"is_active": True}
    if effective_branch:
        query["$or"] = [{"branch_id": effective_branch}, {"branch_id": None}, {"branch_id": ""}]
    
    ads = await db.advertisements.find(query, {"_id": 0}).to_list(1000)
    
    notifications_created = 0
    
    for ad in ads:
        end_date = ad.get("end_date", "")
        if not end_date:
            continue
        
        ad_id = ad.get("id")
        ad_title = ad.get("title_ar", ad.get("title", "إعلان"))
        ad_title_en = ad.get("title_en") or ad.get("title") or ad_title
        
        # Check if ad is expired
        if end_date < today:
            # Check if notification already exists for today
            existing = await db.notifications.find_one({
                "type": "ad_expired",
                "ad_id": ad_id,
                "created_at": {"$regex": f"^{today}"}
            })
            
            if not existing:
                notification_id = str(uuid.uuid4())
                title_ar = "⚠️ إعلان منتهي"
                title_en = "⚠️ Advertisement Expired"
                message_ar = f"انتهى الإعلان \"{ad_title}\" بتاريخ {end_date}"
                message_en = f"The advertisement \"{ad_title_en}\" expired on {end_date}"
                await db.notifications.insert_one({
                    "id": notification_id,
                    "title": title_ar,
                    "title_ar": title_ar,
                    "title_en": title_en,
                    "message": message_ar,
                    "message_ar": message_ar,
                    "message_en": message_en,
                    "type": "ad_expired",
                    "ad_id": ad_id,
                    "link": "/advertisements",
                    "is_read": False,
                    "branch_id": branch_id,
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
                notifications_created += 1
                # Best-effort push to admins in the same language they prefer.
                try:
                    from .push_notifications import send_push_to_admins, NotificationPayload
                    await send_push_to_admins(
                        NotificationPayload(
                            title=title_ar, body=message_ar,
                            title_en=title_en, body_en=message_en,
                            url="/advertisements", tag=f"ad-expired-{ad_id}",
                            data={"type": "ad_expired", "ad_id": ad_id},
                        ),
                        branch_id=branch_id,
                    )
                except Exception:
                    import logging
                    logging.getLogger(__name__).exception("ad-expired push failed")
        
        # Check if ad expires within 3 days
        elif today <= end_date <= three_days_later:
            days_remaining = (datetime.strptime(end_date, "%Y-%m-%d") - datetime.now(timezone.utc).replace(tzinfo=None)).days
            
            # Check if notification already exists for today
            existing = await db.notifications.find_one({
                "type": "ad_expiring_soon",
                "ad_id": ad_id,
                "created_at": {"$regex": f"^{today}"}
            })
            
            if not existing:
                notification_id = str(uuid.uuid4())
                title_ar = "🔔 إعلان ينتهي قريباً"
                title_en = "🔔 Advertisement Expiring Soon"
                message_ar = f"الإعلان \"{ad_title}\" سينتهي خلال {days_remaining} أيام ({end_date})"
                day_word = "day" if days_remaining == 1 else "days"
                message_en = f"The advertisement \"{ad_title_en}\" will expire in {days_remaining} {day_word} ({end_date})"
                await db.notifications.insert_one({
                    "id": notification_id,
                    "title": title_ar,
                    "title_ar": title_ar,
                    "title_en": title_en,
                    "message": message_ar,
                    "message_ar": message_ar,
                    "message_en": message_en,
                    "type": "ad_expiring_soon",
                    "ad_id": ad_id,
                    "link": "/advertisements",
                    "is_read": False,
                    "branch_id": branch_id,
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
                notifications_created += 1
                # Best-effort push to admins, localized per recipient.
                try:
                    from .push_notifications import send_push_to_admins, NotificationPayload
                    await send_push_to_admins(
                        NotificationPayload(
                            title=title_ar, body=message_ar,
                            title_en=title_en, body_en=message_en,
                            url="/advertisements", tag=f"ad-expiring-{ad_id}",
                            data={"type": "ad_expiring_soon", "ad_id": ad_id},
                        ),
                        branch_id=branch_id,
                    )
                except Exception:
                    import logging
                    logging.getLogger(__name__).exception("ad-expiring push failed")
    
    return {"message": f"تم إنشاء {notifications_created} إشعار للإعلانات", "notifications_created": notifications_created}


@router.get("/ads-status")
async def get_ads_status(current_user: dict = Depends(get_current_user)):
    """Get status of all advertisements (expiring soon, expired, active)"""
    # Branch filtering — fail-closed for non-admins without a branch_id.
    # Ads without a branch (shared/legacy) are visible to everyone, hence the $or.
    effective_branch = resolve_branch_filter(current_user, None)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    three_days_later = (datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%d")

    query = {}
    if effective_branch:
        query["$or"] = [{"branch_id": effective_branch}, {"branch_id": None}, {"branch_id": ""}]
    
    ads = await db.advertisements.find(query, {"_id": 0}).to_list(1000)
    
    expired = []
    expiring_soon = []
    active = []
    no_end_date = []
    
    for ad in ads:
        end_date = ad.get("end_date", "")
        ad_info = {
            "id": ad.get("id"),
            "title_ar": ad.get("title_ar", ""),
            "title": ad.get("title", ""),
            "ad_type": ad.get("ad_type", ""),
            "position": ad.get("position", ""),
            "end_date": end_date,
            "is_active": ad.get("is_active", False),
            "views_count": ad.get("views_count", 0),
            "clicks_count": ad.get("clicks_count", 0)
        }
        
        if not end_date:
            no_end_date.append(ad_info)
        elif end_date < today:
            ad_info["days_expired"] = (datetime.now(timezone.utc).replace(tzinfo=None) - datetime.strptime(end_date, "%Y-%m-%d")).days
            expired.append(ad_info)
        elif today <= end_date <= three_days_later:
            ad_info["days_remaining"] = (datetime.strptime(end_date, "%Y-%m-%d") - datetime.now(timezone.utc).replace(tzinfo=None)).days
            expiring_soon.append(ad_info)
        else:
            ad_info["days_remaining"] = (datetime.strptime(end_date, "%Y-%m-%d") - datetime.now(timezone.utc).replace(tzinfo=None)).days
            active.append(ad_info)
    
    return {
        "expired": expired,
        "expiring_soon": expiring_soon,
        "active": active,
        "no_end_date": no_end_date,
        "summary": {
            "total": len(ads),
            "expired_count": len(expired),
            "expiring_soon_count": len(expiring_soon),
            "active_count": len(active),
            "no_end_date_count": len(no_end_date)
        }
    }

