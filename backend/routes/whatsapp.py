import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
from typing import Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from .common import get_current_user

logger = logging.getLogger("whatsapp")


def _require_whatsapp_access(current_user: dict):
    if current_user.get("is_admin", False):
        return
    if "whatsapp" not in (current_user.get("permissions") or []):
        raise HTTPException(status_code=403, detail="WhatsApp access required")

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3001")
RIYADH_TZ = ZoneInfo("Asia/Riyadh")

DEFAULT_SETTINGS = {
    "enabled": False,
    "days_before": 3,
    "days_before_2": 1,
    "reminder_2_enabled": True,
    "message_template": "مرحباً {name}،\nنذكركم بأن اشتراككم في نشاط {activity} سينتهي بعد {days} يوم/أيام.\nيرجى التواصل معنا للتجديد. 🏆",
    "send_hour": 9,
    "push_enabled": True,
    "portal_enabled": True,
    "push_title_template": "تنبيه: اشتراكك ينتهي قريباً 🔔",
    "push_body_template": "اشتراكك في {activity} ينتهي خلال {days} أيام ({end_date})",
}

_db = None
_scheduler_started = False
_reminders_running = False


def set_database(db):
    global _db
    _db = db


def _format_phone(phone: str) -> str:
    if not phone:
        return ""
    digits = "".join(filter(str.isdigit, phone))
    if digits.startswith("0"):
        digits = "966" + digits[1:]
    elif not digits.startswith("966"):
        digits = "966" + digits
    return digits + "@s.whatsapp.net"


async def _get_wa_status() -> dict:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{WA_SERVICE_URL}/status")
            return r.json()
    except Exception:
        return {"connected": False, "qr": None, "error": "WhatsApp service not running"}


async def _send_wa_message(phone: str, message: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(f"{WA_SERVICE_URL}/send", json={"phone": phone, "message": message})
            return r.status_code == 200 and r.json().get("success", False)
    except Exception as e:
        logger.error(f"Failed to send WhatsApp message: {e}")
        return False


async def _get_settings() -> dict:
    if _db is None:
        return DEFAULT_SETTINGS.copy()
    coll = _db["whatsapp_settings"]
    doc = await coll.find_one({})
    if doc:
        doc.pop("_id", None)
        return {**DEFAULT_SETTINGS, **doc}
    return DEFAULT_SETTINGS.copy()


async def _run_daily_reminders():
    global _reminders_running
    if _reminders_running:
        logger.info("WhatsApp reminders already running, skipping duplicate run")
        return
    _reminders_running = True
    try:
        await _do_daily_reminders()
    finally:
        _reminders_running = False


async def _get_expiring_members(days_before: int) -> list:
    """Return list of dicts {member, activity_name, end_date_str, end_date_fmt} for members expiring in exactly days_before days."""
    today = datetime.now(RIYADH_TZ).date()
    target_date = today + timedelta(days=days_before)
    target_str = target_date.strftime("%Y-%m-%d")
    target_fmt = target_date.strftime("%Y/%m/%d")

    members_coll = _db["members"]
    members = await members_coll.find({
        "activities": {
            "$elemMatch": {
                "status": "active",
                "end_date": {"$regex": f"^{target_str}"}
            }
        }
    }).to_list(length=None)

    results = []
    for member in members:
        expiring_activities = []
        for act in member.get("activities", []):
            if act.get("status") != "active":
                continue
            raw_end = act.get("end_date", "")
            end_date = str(raw_end)[:10] if raw_end else ""
            if end_date == target_str:
                expiring_activities.append(act.get("activity_name", ""))
        if not expiring_activities:
            continue
        results.append({
            "member": member,
            "activity_name": "، ".join(filter(None, expiring_activities)),
            "end_date_str": target_str,
            "end_date_fmt": target_fmt,
        })
    return results


async def _send_wa_for_members(members_data: list, days_before: int, template: str) -> int:
    """Send WhatsApp reminder messages. Returns count of successful sends."""
    sent_count = 0
    for item in members_data:
        member = item["member"]
        phone = member.get("phone", "")
        if not phone:
            continue
        name = member.get("name", "")
        activity_name = item["activity_name"]
        end_date_fmt = item["end_date_fmt"]
        message = (template
                   .replace("{name}", name)
                   .replace("{activity}", activity_name)
                   .replace("{days}", str(days_before))
                   .replace("{end_date}", end_date_fmt))
        wa_phone = _format_phone(phone)
        if wa_phone:
            success = await _send_wa_message(wa_phone, message)
            log_entry = {
                "timestamp": datetime.now(RIYADH_TZ).isoformat(),
                "member_name": name,
                "phone": phone,
                "activities": activity_name,
                "success": success,
                "days_before": days_before,
            }
            await _db["whatsapp_send_log"].insert_one(log_entry)
            if success:
                sent_count += 1
                logger.info(f"WhatsApp reminder ({days_before}d) sent to {name} ({phone})")
            await asyncio.sleep(60)
    return sent_count


async def _send_push_for_members(members_data: list, days_before: int, settings: dict) -> int:
    """Send push notifications to members with expiring subscriptions. Returns count of successful sends."""
    from .push_notifications import send_push_notification, NotificationPayload

    push_title_tmpl = settings.get("push_title_template", DEFAULT_SETTINGS["push_title_template"])
    push_body_tmpl = settings.get("push_body_template", DEFAULT_SETTINGS["push_body_template"])

    sent_count = 0
    for item in members_data:
        member = item["member"]
        member_id = member.get("id", "")
        if not member_id:
            continue
        name = member.get("name", "")
        activity_name = item["activity_name"]
        end_date_fmt = item["end_date_fmt"]

        title = (push_title_tmpl
                 .replace("{name}", name)
                 .replace("{activity}", activity_name)
                 .replace("{days}", str(days_before))
                 .replace("{end_date}", end_date_fmt))
        body = (push_body_tmpl
                .replace("{name}", name)
                .replace("{activity}", activity_name)
                .replace("{days}", str(days_before))
                .replace("{end_date}", end_date_fmt))

        payload = NotificationPayload(
            title=title,
            body=body,
            url="/portal/notifications",
            tag=f"expiry-{member_id}-{item['end_date_str']}",
        )

        subscriptions = await _db["push_subscriptions"].find(
            {"member_id": member_id, "is_active": True},
            {"_id": 0}
        ).to_list(20)

        for sub in subscriptions:
            try:
                ok = await send_push_notification(sub, payload)
                if ok:
                    sent_count += 1
            except Exception as e:
                logger.error(f"Push expiry reminder failed for {name}: {e}")
    return sent_count


async def _send_portal_for_members(members_data: list, days_before: int, settings: dict) -> int:
    """Insert portal (member_notifications) entries for expiring members. Returns count inserted."""
    inserted_count = 0
    for item in members_data:
        member = item["member"]
        member_id = member.get("id", "")
        if not member_id:
            continue
        name = member.get("name", "")
        activity_name = item["activity_name"]
        end_date_str = item["end_date_str"]

        dedup_key = f"expiry-{member_id}-{end_date_str}-{days_before}"
        existing = await _db["member_notifications"].find_one({"dedup_key": dedup_key})
        if existing:
            continue

        if days_before == 0:
            title_ar = "⚠️ اشتراكك ينتهي اليوم!"
        elif days_before == 1:
            title_ar = "🔴 اشتراكك ينتهي غداً!"
        else:
            title_ar = f"🔔 اشتراكك ينتهي خلال {days_before} أيام"

        notification = {
            "id": str(uuid.uuid4()),
            "member_id": member_id,
            "type": "expiry_reminder",
            "title_ar": title_ar,
            "title": title_ar,
            "message_ar": f"اشتراكك في {activity_name} سينتهي في {end_date_str}",
            "message": f"اشتراكك في {activity_name} سينتهي في {end_date_str}",
            "priority": "warning",
            "dedup_key": dedup_key,
            "is_read": False,
            "created_at": datetime.now(RIYADH_TZ).isoformat(),
        }
        await _db["member_notifications"].insert_one(notification)
        inserted_count += 1
    return inserted_count


async def _do_daily_reminders():
    if _db is None:
        return
    settings = await _get_settings()
    if not settings.get("enabled"):
        return

    days_before = int(settings.get("days_before", 3))
    days_before_2 = int(settings.get("days_before_2", 1))
    reminder_2_enabled = settings.get("reminder_2_enabled", True)
    template = settings.get("message_template", DEFAULT_SETTINGS["message_template"])

    wa_status = await _get_wa_status()
    wa_connected = wa_status.get("connected", False)
    push_enabled = settings.get("push_enabled", True)
    portal_enabled = settings.get("portal_enabled", True)

    if not wa_connected:
        logger.info("WhatsApp not connected — skipping WhatsApp channel (push/portal still active)")

    days_set = [days_before]
    if reminder_2_enabled and days_before_2 != days_before:
        days_set.append(days_before_2)

    total_wa = 0
    total_push = 0
    total_portal = 0

    for days in days_set:
        members_data = await _get_expiring_members(days)
        if not members_data:
            continue

        if wa_connected:
            total_wa += await _send_wa_for_members(members_data, days, template)

        if push_enabled:
            try:
                total_push += await _send_push_for_members(members_data, days, settings)
            except Exception as e:
                logger.error(f"Push expiry reminders error (days={days}): {e}")

        if portal_enabled:
            try:
                total_portal += await _send_portal_for_members(members_data, days, settings)
            except Exception as e:
                logger.error(f"Portal expiry reminders error (days={days}): {e}")

    logger.info(f"Daily reminders done — WhatsApp={total_wa}, Push={total_push}, Portal={total_portal}")


async def _scheduler_loop():
    global _scheduler_started
    _scheduler_started = True
    logger.info("WhatsApp scheduler started (timezone: Asia/Riyadh)")
    while True:
        try:
            now = datetime.now(RIYADH_TZ)
            settings = await _get_settings()
            send_hour = int(settings.get("send_hour", 9))
            next_run = now.replace(hour=send_hour, minute=0, second=0, microsecond=0)
            if next_run <= now:
                next_run += timedelta(days=1)
            wait_seconds = (next_run - now).total_seconds()
            logger.info(f"WhatsApp scheduler: next run in {wait_seconds:.0f}s at {next_run.strftime('%H:%M')} Riyadh time")
            await asyncio.sleep(wait_seconds)
            await _run_daily_reminders()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"WhatsApp scheduler error: {e}")
            await asyncio.sleep(3600)


def start_scheduler():
    global _scheduler_started
    if not _scheduler_started:
        asyncio.ensure_future(_scheduler_loop())


@router.get("/status")
async def get_status(current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    return await _get_wa_status()


@router.get("/settings")
async def get_settings_endpoint(current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    return await _get_settings()


class WhatsAppSettings(BaseModel):
    enabled: Optional[bool] = None
    days_before: Optional[int] = None
    days_before_2: Optional[int] = None
    reminder_2_enabled: Optional[bool] = None
    message_template: Optional[str] = None
    send_hour: Optional[int] = None
    push_enabled: Optional[bool] = None
    portal_enabled: Optional[bool] = None
    push_title_template: Optional[str] = None
    push_body_template: Optional[str] = None


@router.put("/settings")
async def update_settings(data: WhatsAppSettings, current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    if data.days_before is not None and not (1 <= data.days_before <= 30):
        raise HTTPException(status_code=400, detail="days_before must be between 1 and 30")
    if data.days_before_2 is not None and not (1 <= data.days_before_2 <= 30):
        raise HTTPException(status_code=400, detail="days_before_2 must be between 1 and 30")
    if data.send_hour is not None and not (0 <= data.send_hour <= 23):
        raise HTTPException(status_code=400, detail="send_hour must be between 0 and 23")
    if data.message_template is not None and len(data.message_template) > 1000:
        raise HTTPException(status_code=400, detail="message_template must not exceed 1000 characters")
    coll = _db["whatsapp_settings"]
    update = {k: v for k, v in data.dict().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    await coll.update_one({}, {"$set": update}, upsert=True)
    return await _get_settings()


class SendTestRequest(BaseModel):
    phone: str
    message: Optional[str] = None


@router.post("/test")
async def send_test(data: SendTestRequest, current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    now_riyadh = datetime.now(RIYADH_TZ)
    message = data.message or f"رسالة تجريبية من نظام إدارة أكاديمية الأبطال 🏆\nالوقت: {now_riyadh.strftime('%Y-%m-%d %H:%M')}"
    wa_phone = _format_phone(data.phone)
    if not wa_phone:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    wa_status = await _get_wa_status()
    if not wa_status.get("connected"):
        raise HTTPException(status_code=400, detail="WhatsApp not connected. Please scan the QR code first.")
    success = await _send_wa_message(wa_phone, message)
    if success:
        return {"success": True, "message": "Message sent successfully"}
    raise HTTPException(status_code=500, detail="Failed to send message")


@router.post("/send-now")
async def send_reminders_now(current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    asyncio.ensure_future(_run_daily_reminders())
    return {"success": True, "message": "Reminders are being sent in the background (WhatsApp + Push + Portal)"}


@router.post("/disconnect")
async def disconnect(current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(f"{WA_SERVICE_URL}/disconnect")
            return r.json()
    except Exception:
        raise HTTPException(status_code=503, detail="WhatsApp service not available")


@router.get("/logs")
async def get_send_logs(limit: int = 50, current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    if _db is None:
        return []
    logs = await _db["whatsapp_send_log"].find(
        {}, {"_id": 0}
    ).sort("timestamp", -1).limit(limit).to_list(length=limit)
    return logs


@router.get("/target-count")
async def get_target_count(current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    if _db is None:
        return {"count": 0, "count_today": 0, "target_date": "", "count_2": 0, "count_today_2": 0, "target_date_2": ""}
    settings = await _get_settings()
    days_before = int(settings.get("days_before", 3))
    days_before_2 = int(settings.get("days_before_2", 1))
    reminder_2_enabled = settings.get("reminder_2_enabled", True)
    today = datetime.now(RIYADH_TZ).date()
    today_str = today.strftime("%Y-%m-%d")
    target_date = today + timedelta(days=days_before)
    target_str = target_date.strftime("%Y-%m-%d")
    target_date_2 = today + timedelta(days=days_before_2)
    target_str_2 = target_date_2.strftime("%Y-%m-%d")

    # Count members expiring within relevant windows
    max_days = max(days_before, days_before_2)
    max_date = (today + timedelta(days=max_days)).strftime("%Y-%m-%d")
    all_members = await _db["members"].find(
        {"activities": {"$elemMatch": {"status": "active"}}}
    ).to_list(length=10000)

    count_within = 0
    count_today = 0
    count_within_2 = 0
    count_today_2 = 0

    for m in all_members:
        matched_1 = False
        matched_2 = False
        for a in m.get("activities", []):
            if a.get("status") != "active":
                continue
            ed = a.get("end_date", "")
            if not ed:
                continue
            if not matched_1 and today_str <= ed <= target_str:
                count_within += 1
                if ed.startswith(target_str):
                    count_today += 1
                matched_1 = True
            if reminder_2_enabled and not matched_2 and ed.startswith(target_str_2):
                count_within_2 += 1
                count_today_2 += 1
                matched_2 = True

    return {
        "count": count_within, "count_today": count_today, "target_date": target_str,
        "count_2": count_within_2, "count_today_2": count_today_2, "target_date_2": target_str_2,
        "reminder_2_enabled": reminder_2_enabled,
    }
