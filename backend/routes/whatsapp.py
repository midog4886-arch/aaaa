import asyncio
import logging
import os
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
    "message_template": "مرحباً {name}،\nنذكركم بأن اشتراككم في نشاط {activity} سينتهي بعد {days} يوم/أيام.\nيرجى التواصل معنا للتجديد. 🏆",
    "send_hour": 9,
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


async def _do_daily_reminders():
    if _db is None:
        return
    # Skip if WhatsApp is not connected
    wa_status = await _get_wa_status()
    if not wa_status.get("connected"):
        logger.info("WhatsApp not connected, skipping reminder batch")
        return
    settings = await _get_settings()
    if not settings.get("enabled"):
        return

    days_before = int(settings.get("days_before", 3))
    template = settings.get("message_template", DEFAULT_SETTINGS["message_template"])
    today = datetime.now(RIYADH_TZ).date()
    target_date = today + timedelta(days=days_before)
    target_str = target_date.strftime("%Y-%m-%d")

    members_coll = _db["members"]
    # Filter at DB level for members with at least one active activity ending on target date
    members = await members_coll.find({
        "activities": {
            "$elemMatch": {
                "status": "active",
                "end_date": {"$regex": f"^{target_str}"}
            }
        }
    }).to_list(length=None)

    sent_count = 0
    for member in members:
        phone = member.get("phone", "")
        if not phone:
            continue
        activities = member.get("activities", [])
        # Collect all expiring activities for this member (one message per member)
        expiring_activities = []
        for act in activities:
            if act.get("status") != "active":
                continue
            raw_end = act.get("end_date", "")
            # Normalize to YYYY-MM-DD (handles both date strings and ISO datetimes)
            end_date = str(raw_end)[:10] if raw_end else ""
            if end_date == target_str:
                expiring_activities.append(act.get("activity_name", ""))
        if not expiring_activities:
            continue
        name = member.get("name", "")
        # Use first activity name for template; if multiple, join them
        activity_name = "، ".join(filter(None, expiring_activities))
        message = template.replace("{name}", name).replace("{activity}", activity_name).replace("{days}", str(days_before))
        wa_phone = _format_phone(phone)
        if wa_phone:
            success = await _send_wa_message(wa_phone, message)
            log_entry = {
                "timestamp": datetime.now(RIYADH_TZ).isoformat(),
                "member_name": name,
                "phone": phone,
                "activities": activity_name,
                "success": success,
            }
            await _db["whatsapp_send_log"].insert_one(log_entry)
            if success:
                sent_count += 1
                logger.info(f"WhatsApp reminder sent to {name} ({phone}) for activities: {activity_name}")
            await asyncio.sleep(60)

    logger.info(f"WhatsApp daily reminders: sent {sent_count} messages")


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
    message_template: Optional[str] = None
    send_hour: Optional[int] = None


@router.put("/settings")
async def update_settings(data: WhatsAppSettings, current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    if data.days_before is not None and not (1 <= data.days_before <= 30):
        raise HTTPException(status_code=400, detail="days_before must be between 1 and 30")
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
    wa_status = await _get_wa_status()
    if not wa_status.get("connected"):
        raise HTTPException(status_code=400, detail="WhatsApp not connected")
    asyncio.ensure_future(_run_daily_reminders())
    return {"success": True, "message": "Reminders are being sent in the background"}


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
        return {"count": 0, "target_date": ""}
    settings = await _get_settings()
    days_before = int(settings.get("days_before", 3))
    today = datetime.now(RIYADH_TZ).date()
    target_date = today + timedelta(days=days_before)
    target_str = target_date.strftime("%Y-%m-%d")
    count = await _db["members"].count_documents({
        "activities": {
            "$elemMatch": {
                "status": "active",
                "end_date": {"$regex": f"^{target_str}"}
            }
        }
    })
    return {"count": count, "target_date": target_str}
