import asyncio
import logging
from datetime import datetime, timedelta, date
from typing import Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("whatsapp")

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

WA_SERVICE_URL = "http://localhost:3001"

DEFAULT_SETTINGS = {
    "enabled": False,
    "days_before": 3,
    "message_template": "مرحباً {name}،\nنذكركم بأن اشتراككم في نشاط {activity} سينتهي بعد {days} يوم/أيام.\nيرجى التواصل معنا للتجديد. 🏆",
    "send_hour": 9,
}

_db = None
_scheduler_started = False


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
    if _db is None:
        return
    settings = await _get_settings()
    if not settings.get("enabled"):
        return

    days_before = int(settings.get("days_before", 3))
    template = settings.get("message_template", DEFAULT_SETTINGS["message_template"])
    today = date.today()
    target_date = today + timedelta(days=days_before)
    target_str = target_date.strftime("%Y-%m-%d")

    members_coll = _db["members"]
    members = await members_coll.find({}).to_list(length=None)

    sent_count = 0
    for member in members:
        phone = member.get("phone", "")
        if not phone:
            continue
        activities = member.get("activities", [])
        for act in activities:
            if act.get("status") != "active":
                continue
            end_date = act.get("end_date", "")
            if end_date == target_str:
                name = member.get("name", "")
                activity_name = act.get("activity_name", "")
                message = template.replace("{name}", name).replace("{activity}", activity_name).replace("{days}", str(days_before))
                wa_phone = _format_phone(phone)
                if wa_phone:
                    success = await _send_wa_message(wa_phone, message)
                    if success:
                        sent_count += 1
                        logger.info(f"WhatsApp reminder sent to {name} ({phone})")
                    await asyncio.sleep(60)

    logger.info(f"WhatsApp daily reminders: sent {sent_count} messages")


async def _scheduler_loop():
    global _scheduler_started
    _scheduler_started = True
    logger.info("WhatsApp scheduler started")
    while True:
        try:
            now = datetime.now()
            settings = await _get_settings()
            send_hour = int(settings.get("send_hour", 9))
            next_run = now.replace(hour=send_hour, minute=0, second=0, microsecond=0)
            if next_run <= now:
                next_run += timedelta(days=1)
            wait_seconds = (next_run - now).total_seconds()
            logger.info(f"WhatsApp scheduler: next run in {wait_seconds:.0f}s at {next_run.strftime('%H:%M')}")
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
async def get_status():
    return await _get_wa_status()


@router.get("/settings")
async def get_settings():
    return await _get_settings()


class WhatsAppSettings(BaseModel):
    enabled: Optional[bool] = None
    days_before: Optional[int] = None
    message_template: Optional[str] = None
    send_hour: Optional[int] = None


@router.put("/settings")
async def update_settings(data: WhatsAppSettings):
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
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
async def send_test(data: SendTestRequest):
    settings = await _get_settings()
    message = data.message or f"رسالة تجريبية من نظام إدارة أكاديمية الأبطال 🏆\nالوقت: {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    wa_phone = _format_phone(data.phone)
    if not wa_phone:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    status = await _get_wa_status()
    if not status.get("connected"):
        raise HTTPException(status_code=400, detail="WhatsApp not connected. Please scan the QR code first.")
    success = await _send_wa_message(wa_phone, message)
    if success:
        return {"success": True, "message": "Message sent successfully"}
    raise HTTPException(status_code=500, detail="Failed to send message")


@router.post("/send-now")
async def send_reminders_now():
    status = await _get_wa_status()
    if not status.get("connected"):
        raise HTTPException(status_code=400, detail="WhatsApp not connected")
    asyncio.ensure_future(_run_daily_reminders())
    return {"success": True, "message": "Reminders are being sent in the background"}


@router.post("/disconnect")
async def disconnect():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(f"{WA_SERVICE_URL}/disconnect")
            return r.json()
    except Exception:
        raise HTTPException(status_code=503, detail="WhatsApp service not available")
