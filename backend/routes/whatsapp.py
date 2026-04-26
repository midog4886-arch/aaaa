import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
from typing import Optional, List
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from .common import get_current_user
from utils.auth import require_branch_scope, resolve_branch_filter

logger = logging.getLogger("whatsapp")


def _require_whatsapp_access(current_user: dict):
    if current_user.get("is_admin", False):
        return
    if "whatsapp" not in (current_user.get("permissions") or []):
        raise HTTPException(status_code=403, detail="WhatsApp access required")


def _require_renewals_or_whatsapp_access(current_user: dict):
    """Renewals page needs read/send without full WhatsApp settings access."""
    if current_user.get("is_admin", False):
        return
    perms = current_user.get("permissions") or []
    if "whatsapp" in perms or "renewals" in perms:
        return
    raise HTTPException(status_code=403, detail="Renewals or WhatsApp access required")

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3001")
RIYADH_TZ = ZoneInfo("Asia/Riyadh")

DEFAULT_SETTINGS = {
    "enabled": False,
    "days_before": 3,
    "days_before_2": 1,
    "reminder_2_enabled": True,
    # Multi-offset list: each item {days: int, enabled: bool}.
    # Includes T-0 (day of expiry) and longer offsets like T-7.
    "offsets": [
        {"days": 7, "enabled": True},
        {"days": 3, "enabled": True},
        {"days": 1, "enabled": True},
        {"days": 0, "enabled": True},
    ],
    "message_template": "مرحباً {name}،\nنذكركم بأن اشتراككم في نشاط {activity} سينتهي بعد {days} يوم/أيام.\nيرجى التواصل معنا للتجديد. 🏆",
    # Per-offset overrides keyed by stringified days; empty falls back to message_template
    "templates": {},
    "manual_reminder_template": "السلام عليكم {name}،\nنود تذكيركم بأن اشتراك ({activity}) في شركة اداء الابطال العالمية للرياضة قارب على الانتهاء بتاريخ {end_date}.\nنرجو التواصل معنا للتجديد.\nشكراً لكم 🏆",
    "send_hour": 9,
    "push_enabled": True,
    "portal_enabled": True,
    "push_title_template": "تنبيه: اشتراكك ينتهي قريباً 🔔",
    "push_body_template": "اشتراكك في {activity} ينتهي خلال {days} أيام ({end_date})",
}


def _normalize_offsets(settings: dict) -> List[dict]:
    """Return a deduplicated, validated list of {days, enabled} for the scheduler.

    If the stored doc has no `offsets` key at all, fall back to the legacy
    days_before/days_before_2/extra_offsets fields. An explicit empty list
    means "no offsets enabled" and is honoured as-is.
    """
    items: list = []
    if "offsets" in settings:
        raw = settings.get("offsets") or []
        if isinstance(raw, list):
            for o in raw:
                if isinstance(o, dict) and "days" in o:
                    try:
                        d = int(o["days"])
                    except Exception:
                        continue
                    if 0 <= d <= 60:
                        items.append({"days": d, "enabled": bool(o.get("enabled", True))})
    else:
        try:
            items.append({"days": int(settings.get("days_before", 3)), "enabled": True})
        except Exception:
            pass
        if settings.get("reminder_2_enabled", True):
            try:
                items.append({"days": int(settings.get("days_before_2", 1)), "enabled": True})
            except Exception:
                pass
        for d in settings.get("extra_offsets", []) or []:
            try:
                items.append({"days": int(d), "enabled": True})
            except Exception:
                continue
    seen: set = set()
    out: list = []
    for it in items:
        if it["days"] in seen:
            continue
        seen.add(it["days"])
        out.append(it)
    return out

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
        # Merge defaults but DO NOT inject the default `offsets` for legacy
        # docs that never stored that field — otherwise the legacy
        # days_before/days_before_2/extra_offsets fallback in
        # `_normalize_offsets` is silently overridden.
        defaults = DEFAULT_SETTINGS.copy()
        if "offsets" not in doc:
            defaults.pop("offsets", None)
        return {**defaults, **doc}
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
        fees = []
        for act in member.get("activities", []):
            if act.get("status") != "active":
                continue
            raw_end = act.get("end_date", "")
            end_date = str(raw_end)[:10] if raw_end else ""
            if end_date == target_str:
                expiring_activities.append(act.get("activity_name", ""))
                fee_val = act.get("fee") or act.get("amount") or 0
                try:
                    fees.append(float(fee_val))
                except Exception:
                    fees.append(0.0)
        if not expiring_activities:
            continue
        total_fee = sum(fees) if fees else 0.0
        # Show as int when no decimals (most fees are whole-number SAR)
        fee_str = str(int(total_fee)) if total_fee.is_integer() else f"{total_fee:.2f}"
        results.append({
            "member": member,
            "activity_name": "، ".join(filter(None, expiring_activities)),
            "expiring_activities": expiring_activities,
            "end_date_str": target_str,
            "end_date_fmt": target_fmt,
            "fee_str": fee_str,
        })
    return results


def _render_template(template: str, *, name: str, activity: str, days, end_date: str, fee: str = "") -> str:
    """Interpolate the standard reminder placeholders, including {fee}."""
    return (
        (template or "")
        .replace("{name}", name or "")
        .replace("{activity}", activity or "")
        .replace("{days}", str(days) if days is not None else "")
        .replace("{end_date}", end_date or "")
        .replace("{fee}", fee or "")
    )


async def _record_renewal_reminder(
    member_id: str,
    activity_name: str,
    channel: str,
    days_before: Optional[int],
    manual: bool,
    success: bool,
    sent_by: Optional[dict] = None,
):
    """Insert an audit row into renewal_reminder_log for last-reminder tracking.

    `sent_by` is the actor that triggered the reminder (admin user dict for
    manual sends, or None/{"system": True} for the daily scheduler).
    """
    if _db is None or not member_id:
        return
    try:
        actor = None
        if sent_by:
            actor = {
                "id": sent_by.get("id") or sent_by.get("_id"),
                "username": sent_by.get("username"),
                "name": sent_by.get("name") or sent_by.get("full_name"),
            }
        elif not manual:
            actor = {"system": True}
        await _db["renewal_reminder_log"].insert_one({
            "member_id": member_id,
            "activity_name": activity_name or "",
            "channel": channel,
            "days_before": days_before,
            "manual": bool(manual),
            "success": bool(success),
            "sent_by": actor,
            "timestamp": datetime.now(RIYADH_TZ).isoformat(),
        })
    except Exception as e:
        logger.error(f"Failed to record reminder log: {e}")


async def _send_wa_for_members(members_data: list, days_before: int, template: str, manual: bool = False) -> int:
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
        message = _render_template(
            template,
            name=name,
            activity=activity_name,
            days=days_before,
            end_date=end_date_fmt,
            fee=item.get("fee_str", ""),
        )
        wa_phone = _format_phone(phone)
        if wa_phone:
            success = await _send_wa_message(wa_phone, message)
            log_entry = {
                "timestamp": datetime.now(RIYADH_TZ).isoformat(),
                "member_id": member.get("id", ""),
                "member_name": name,
                "phone": phone,
                "activities": activity_name,
                "success": success,
                "days_before": days_before,
                "manual": manual,
                "type": "renewal_reminder",
            }
            await _db["whatsapp_send_log"].insert_one(log_entry)
            # Log per-individual-activity so the Renewals page can match
            # last-reminder badges by (member_id, activity_name) precisely.
            for act_name in (item.get("expiring_activities") or [activity_name]):
                await _record_renewal_reminder(
                    member_id=member.get("id", ""),
                    activity_name=act_name,
                    channel="whatsapp",
                    days_before=days_before,
                    manual=manual,
                    success=success,
                )
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

        fee_str = item.get("fee_str", "")
        title = _render_template(push_title_tmpl, name=name, activity=activity_name,
                                 days=days_before, end_date=end_date_fmt, fee=fee_str)
        body = _render_template(push_body_tmpl, name=name, activity=activity_name,
                                days=days_before, end_date=end_date_fmt, fee=fee_str)

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

        any_ok = False
        for sub in subscriptions:
            try:
                ok = await send_push_notification(sub, payload)
                if ok:
                    sent_count += 1
                    any_ok = True
            except Exception as e:
                logger.error(f"Push expiry reminder failed for {name}: {e}")
        if subscriptions:
            for act_name in (item.get("expiring_activities") or [activity_name]):
                await _record_renewal_reminder(
                    member_id=member_id,
                    activity_name=act_name,
                    channel="push",
                    days_before=days_before,
                    manual=settings.get("_manual_run", False),
                    success=any_ok,
                )
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
        for act_name in (item.get("expiring_activities") or [activity_name]):
            await _record_renewal_reminder(
                member_id=member_id,
                activity_name=act_name,
                channel="portal",
                days_before=days_before,
                manual=settings.get("_manual_run", False),
                success=True,
            )
        inserted_count += 1
    return inserted_count


async def _do_daily_reminders():
    if _db is None:
        return
    settings = await _get_settings()
    if not settings.get("enabled"):
        return

    template = settings.get("message_template", DEFAULT_SETTINGS["message_template"])
    per_offset_templates = settings.get("templates") or {}

    wa_status = await _get_wa_status()
    wa_connected = wa_status.get("connected", False)
    push_enabled = settings.get("push_enabled", True)
    portal_enabled = settings.get("portal_enabled", True)

    if not wa_connected:
        logger.info("WhatsApp not connected — skipping WhatsApp channel (push/portal still active)")

    # Iterate every enabled offset (includes T-0 day-of-expiry)
    days_set = [it["days"] for it in _normalize_offsets(settings) if it.get("enabled")]

    total_wa = 0
    total_push = 0
    total_portal = 0

    for days in days_set:
        members_data = await _get_expiring_members(days)
        if not members_data:
            continue

        if wa_connected:
            # Per-offset override falls back to the shared template.
            tpl_for_offset = per_offset_templates.get(str(days)) or template
            total_wa += await _send_wa_for_members(members_data, days, tpl_for_offset)

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
    # New offsets model: list of {days: 0..60, enabled: bool}.
    offsets: Optional[List[dict]] = None
    message_template: Optional[str] = None
    # Per-offset overrides: {"<days>": "<template>"} — empty/missing falls
    # back to the shared `message_template`.
    templates: Optional[dict] = None
    manual_reminder_template: Optional[str] = None
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
    if data.manual_reminder_template is not None and len(data.manual_reminder_template) > 1000:
        raise HTTPException(status_code=400, detail="manual_reminder_template must not exceed 1000 characters")
    if data.templates is not None:
        cleaned_tpl: dict = {}
        for k, v in data.templates.items():
            try:
                kd = int(k)
            except Exception:
                raise HTTPException(status_code=400, detail="templates keys must be integer offset days")
            if not (0 <= kd <= 60):
                raise HTTPException(status_code=400, detail="templates keys must be between 0 and 60")
            if v is None or v == "":
                continue  # Empty/missing -> falls back to shared template
            if not isinstance(v, str):
                raise HTTPException(status_code=400, detail="templates values must be strings")
            if len(v) > 1000:
                raise HTTPException(status_code=400, detail="templates entry must not exceed 1000 characters")
            cleaned_tpl[str(kd)] = v
        data.templates = cleaned_tpl
    if data.offsets is not None:
        cleaned: list = []
        seen: set = set()
        for o in data.offsets:
            if not isinstance(o, dict) or "days" not in o:
                continue
            try:
                di = int(o["days"])
            except Exception:
                continue
            if not (0 <= di <= 60):
                raise HTTPException(status_code=400, detail="offsets.days must be between 0 and 60")
            if di in seen:
                continue
            seen.add(di)
            cleaned.append({"days": di, "enabled": bool(o.get("enabled", True))})
        # Sort descending so longer offsets fire first (T-7, T-3, T-1, T-0)
        cleaned.sort(key=lambda x: -x["days"])
        data.offsets = cleaned[:10]  # cap at 10 offsets
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
    today = datetime.now(RIYADH_TZ).date()
    today_str = today.strftime("%Y-%m-%d")

    enabled_offsets = sorted({
        int(it["days"]) for it in _normalize_offsets(settings) if it.get("enabled")
    })
    if not enabled_offsets:
        enabled_offsets = [int(settings.get("days_before", 3))]

    offset_dates = {d: (today + timedelta(days=d)).strftime("%Y-%m-%d") for d in enabled_offsets}

    all_members = await _db["members"].find(
        {"activities": {"$elemMatch": {"status": "active"}}}
    ).to_list(length=10000)

    per_offset_today: dict = {d: 0 for d in enabled_offsets}
    max_days = max(enabled_offsets)
    max_date = (today + timedelta(days=max_days)).strftime("%Y-%m-%d")
    count_within = 0
    count_today_any = 0

    for m in all_members:
        matched_window = False
        matched_today = False
        per_offset_matched: dict = {d: False for d in enabled_offsets}
        for a in m.get("activities", []):
            if a.get("status") != "active":
                continue
            ed = a.get("end_date", "")
            if not ed:
                continue
            if not matched_window and today_str <= ed <= max_date:
                count_within += 1
                matched_window = True
            for d, target_str_d in offset_dates.items():
                if not per_offset_matched[d] and ed.startswith(target_str_d):
                    per_offset_today[d] += 1
                    per_offset_matched[d] = True
                    if not matched_today:
                        count_today_any += 1
                        matched_today = True

    offsets_breakdown = [
        {"days": d, "target_date": offset_dates[d], "count_today": per_offset_today[d]}
        for d in enabled_offsets
    ]

    # Backward-compat: legacy fields use first/second enabled offset.
    primary = enabled_offsets[0]
    secondary = enabled_offsets[1] if len(enabled_offsets) > 1 else None
    target_str = offset_dates[primary]
    count_today_primary = per_offset_today[primary]
    if secondary is not None:
        target_str_2 = offset_dates[secondary]
        count_today_2 = per_offset_today[secondary]
        reminder_2_enabled = True
    else:
        target_str_2 = ""
        count_today_2 = 0
        reminder_2_enabled = False

    return {
        "count": count_within,
        "count_today": count_today_primary,
        "count_today_any": count_today_any,
        "target_date": target_str,
        "count_2": count_today_2,
        "count_today_2": count_today_2,
        "target_date_2": target_str_2,
        "reminder_2_enabled": reminder_2_enabled,
        "offsets": offsets_breakdown,
    }


# ===================== Renewal-reminder log endpoints =====================

class BulkReminderItem(BaseModel):
    member_id: str
    activity_name: Optional[str] = ""
    end_date: Optional[str] = ""
    days_remaining: Optional[int] = None
    fee: Optional[float] = None


class LastReminderFilterItem(BaseModel):
    member_id: str
    activity_name: Optional[str] = ""


class LastReminderFilterRequest(BaseModel):
    items: List[LastReminderFilterItem] = []


class BulkReminderRequest(BaseModel):
    items: List[BulkReminderItem]


async def _aggregate_last_renewal_reminders(
    current_user: dict,
    filter_pairs: Optional[List[LastReminderFilterItem]] = None,
):
    """Shared aggregation used by both GET and POST variants."""
    # Renewals page admins (with `renewals` permission) need this badge data
    # without being granted full WhatsApp settings access.
    _require_renewals_or_whatsapp_access(current_user)
    if _db is None:
        return []

    # Branch scoping: non-admins only see reminders for their branch's members.
    # Fail-closed via resolve_branch_filter: a non-admin without a branch_id
    # is denied entirely (HTTP 403).
    effective_branch_id = resolve_branch_filter(current_user, None)
    allowed_member_ids: Optional[set] = None
    if effective_branch_id:
        try:
            cursor_m = _db["members"].find({"branch_id": effective_branch_id}, {"id": 1, "_id": 0})
            allowed_member_ids = {row["id"] async for row in cursor_m if row.get("id")}
        except Exception as e:
            logger.error(f"Branch scoping query failed: {e}")
            allowed_member_ids = set()

    try:
        match_stage: dict = {}
        if allowed_member_ids is not None:
            if not allowed_member_ids:
                return []
            match_stage["member_id"] = {"$in": list(allowed_member_ids)}

        # Optional explicit pair filter — narrows the aggregation to just the
        # cards visible on the Renewals page (cheaper than the global scan).
        if filter_pairs:
            pair_or = []
            requested_member_ids = set()
            for it in filter_pairs:
                if not it.member_id:
                    continue
                # Re-enforce branch scoping per-pair when applicable.
                if allowed_member_ids is not None and it.member_id not in allowed_member_ids:
                    continue
                requested_member_ids.add(it.member_id)
                pair_or.append({
                    "member_id": it.member_id,
                    "activity_name": it.activity_name or "",
                })
            if not pair_or:
                return []
            # Use $or on full pairs so we only fetch rows we'll actually return.
            match_stage = {"$and": [match_stage, {"$or": pair_or}]} if match_stage else {"$or": pair_or}

        pipeline = []
        if match_stage:
            pipeline.append({"$match": match_stage})
        pipeline.extend([
            {"$sort": {"timestamp": -1}},
            {
                "$group": {
                    "_id": {"member_id": "$member_id", "activity_name": "$activity_name"},
                    # `last_*` fields capture the most recent reminder event
                    # exactly, while `channels` aggregates the set of channels
                    # ever used so the tooltip can list "via WhatsApp + push".
                    "last_sent": {"$first": "$timestamp"},
                    "last_channel": {"$first": "$channel"},
                    "channels": {"$addToSet": "$channel"},
                    "manual": {"$first": "$manual"},
                    "days_before": {"$first": "$days_before"},
                    "sent_by": {"$first": "$sent_by"},
                }
            },
            # Promote the composite _id back to top-level fields. The Atlas
            # HTTP Data API does not include `_id` in aggregate results, so
            # we project the grouped keys explicitly to remain driver-agnostic.
            {
                "$project": {
                    "_id": 0,
                    "member_id": "$_id.member_id",
                    "activity_name": "$_id.activity_name",
                    "last_sent": 1,
                    "last_channel": 1,
                    "channels": 1,
                    "manual": 1,
                    "days_before": 1,
                    "sent_by": 1,
                }
            },
            {"$limit": 5000},
        ])
        cursor = _db["renewal_reminder_log"].aggregate(pipeline)
        results = []
        async for row in cursor:
            results.append({
                "member_id": row.get("member_id"),
                "activity_name": row.get("activity_name"),
                "last_sent": row.get("last_sent"),
                "last_channel": row.get("last_channel"),
                "channels": row.get("channels", []),
                "manual": row.get("manual"),
                "days_before": row.get("days_before"),
                "sent_by": row.get("sent_by"),
            })
        return results
    except Exception as e:
        logger.error(f"Failed to aggregate renewal reminder log: {e}")
        return []


@router.get("/renewal-reminders/last")
async def get_last_renewal_reminders(current_user: dict = Depends(get_current_user)):
    """Return the most-recent reminder timestamp per (member_id, activity_name)."""
    return await _aggregate_last_renewal_reminders(current_user)


@router.post("/renewal-reminders/last")
async def post_last_renewal_reminders(
    payload: LastReminderFilterRequest,
    current_user: dict = Depends(get_current_user),
):
    """Filtered variant — returns only the (member_id, activity_name) pairs sent.

    Lets the Renewals page request just the badges it actually needs to render,
    avoiding a global scan of renewal_reminder_log on large deployments.
    """
    return await _aggregate_last_renewal_reminders(current_user, payload.items)


@router.get("/renewal-reminders/template")
async def get_renewal_reminder_template(current_user: dict = Depends(get_current_user)):
    """Return only the manual reminder template + per-offset overrides.

    Renewals admins (with `renewals` permission) can read the manual template
    used by the per-card "Remind" buttons without being granted full
    WhatsApp settings access (which exposes WA tokens). Sensitive auto/push
    configuration is intentionally NOT included in the response.
    """
    _require_renewals_or_whatsapp_access(current_user)
    settings = await _get_settings()
    return {
        "manual_reminder_template": settings.get(
            "manual_reminder_template",
            DEFAULT_SETTINGS["manual_reminder_template"],
        ),
        "message_template": settings.get(
            "message_template", DEFAULT_SETTINGS["message_template"]
        ),
        "templates": settings.get("templates") or {},
    }


@router.get("/renewal-reminders/history")
async def get_renewal_reminder_history(
    member_id: Optional[str] = None,
    activity_name: Optional[str] = None,
    channel: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    manual: Optional[str] = None,
    branch_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """Paginated audit log of every renewal reminder. Used by the history page."""
    eff_limit = max(1, min(int(limit), 500))
    eff_offset = max(0, int(offset))
    rows, total = await _query_reminder_history(
        current_user=current_user,
        member_id=member_id,
        activity_name=activity_name,
        channel=channel,
        start_date=start_date,
        end_date=end_date,
        manual=manual,
        branch_id=branch_id,
        limit=eff_limit,
        offset=eff_offset,
    )
    return {"rows": rows, "total": total, "limit": eff_limit, "offset": eff_offset}


@router.get("/renewal-reminders/history/export")
async def export_renewal_reminder_history(
    member_id: Optional[str] = None,
    activity_name: Optional[str] = None,
    channel: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    manual: Optional[str] = None,
    branch_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Excel export of the same filtered history list (no pagination)."""
    from io import BytesIO
    from fastapi.responses import StreamingResponse

    rows, _ = await _query_reminder_history(
        current_user=current_user,
        member_id=member_id,
        activity_name=activity_name,
        channel=channel,
        start_date=start_date,
        end_date=end_date,
        manual=manual,
        branch_id=branch_id,
        limit=10000,
        offset=0,
    )

    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill

    def _safe_excel_cell(value):
        """Defuse Excel/CSV formula injection on string cells.

        If a cell starts with `=`, `+`, `-`, `@`, tab or CR/LF, prefix with `'`
        so spreadsheet apps treat it as text. Non-strings are returned as-is.
        """
        if not isinstance(value, str) or not value:
            return value
        if value[0] in ("=", "+", "-", "@", "\t", "\r", "\n"):
            return "'" + value
        return value

    wb = Workbook()
    ws = wb.active
    ws.title = "Renewal Reminders"

    headers = [
        "التاريخ والوقت", "اسم العضو", "النشاط", "القناة",
        "أيام قبل الانتهاء", "يدوي/تلقائي", "ناجح", "أُرسل بواسطة",
    ]
    ws.append(headers)
    header_fill = PatternFill("solid", fgColor="F97316")
    header_font = Font(bold=True, color="FFFFFF")
    center = Alignment(horizontal='center', vertical='center', wrap_text=True)
    for col_idx in range(1, len(headers) + 1):
        c = ws.cell(row=1, column=col_idx)
        c.fill = header_fill
        c.font = header_font
        c.alignment = center

    for r in rows:
        sent_by = r.get("sent_by") or {}
        if isinstance(sent_by, dict) and sent_by.get("system"):
            sender = "النظام"
        else:
            sender = (sent_by.get("name") or sent_by.get("username") or "") if isinstance(sent_by, dict) else ""
        ws.append([
            _safe_excel_cell(r.get("timestamp", "")),
            _safe_excel_cell(r.get("member_name", "")),
            _safe_excel_cell(r.get("activity_name", "")),
            _safe_excel_cell(r.get("channel", "")),
            r.get("days_before") if r.get("days_before") is not None else "",
            "يدوي" if r.get("manual") else "تلقائي",
            "نعم" if r.get("success") else "لا",
            _safe_excel_cell(sender),
        ])

    for letter, width in zip(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], [22, 26, 22, 14, 16, 12, 8, 24]):
        ws.column_dimensions[letter].width = width

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"renewal_reminders_{datetime.now(RIYADH_TZ).strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


async def _query_reminder_history(
    current_user: dict,
    member_id: Optional[str],
    activity_name: Optional[str],
    channel: Optional[str],
    start_date: Optional[str],
    end_date: Optional[str],
    manual: Optional[str],
    branch_id: Optional[str],
    limit: int,
    offset: int,
):
    """Shared query/enrichment used by both JSON and Excel history endpoints."""
    _require_renewals_or_whatsapp_access(current_user)
    if _db is None:
        return [], 0

    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch_id = resolve_branch_filter(current_user, branch_id)

    allowed_member_ids: Optional[set] = None
    if effective_branch_id:
        try:
            cursor_m = _db["members"].find(
                {"branch_id": effective_branch_id}, {"id": 1, "_id": 0}
            )
            allowed_member_ids = {row["id"] async for row in cursor_m if row.get("id")}
        except Exception as e:
            logger.error(f"Branch scoping query failed: {e}")
            allowed_member_ids = set()
        if not allowed_member_ids:
            return [], 0

    match: dict = {}
    if allowed_member_ids is not None:
        match["member_id"] = {"$in": list(allowed_member_ids)}
    if member_id:
        if allowed_member_ids is not None and member_id not in allowed_member_ids:
            return [], 0
        match["member_id"] = member_id
    if activity_name:
        match["activity_name"] = activity_name
    if channel:
        match["channel"] = channel
    if manual in ("true", "True", "1"):
        match["manual"] = True
    elif manual in ("false", "False", "0"):
        match["manual"] = False
    ts_clause: dict = {}
    if start_date:
        ts_clause["$gte"] = start_date
    if end_date:
        ts_clause["$lte"] = end_date + "T23:59:59"
    if ts_clause:
        match["timestamp"] = ts_clause

    coll = _db["renewal_reminder_log"]
    try:
        total = await coll.count_documents(match)
        cursor = coll.find(match, {"_id": 0}).sort("timestamp", -1).skip(offset).limit(limit)
        rows = await cursor.to_list(length=limit)
    except Exception as e:
        logger.error(f"Reminder history query failed: {e}")
        return [], 0

    member_ids = list({r.get("member_id") for r in rows if r.get("member_id")})
    name_by_id: dict = {}
    if member_ids:
        try:
            cursor_n = _db["members"].find(
                {"id": {"$in": member_ids}},
                {"id": 1, "name": 1, "name_ar": 1, "_id": 0},
            )
            async for m in cursor_n:
                name_by_id[m["id"]] = m.get("name_ar") or m.get("name") or ""
        except Exception as e:
            logger.error(f"Member name lookup failed: {e}")

    for r in rows:
        r["member_name"] = name_by_id.get(r.get("member_id"), "")

    return rows, total


@router.post("/renewal-reminders/send")
async def send_bulk_renewal_reminders(
    payload: BulkReminderRequest,
    log_only: bool = False,
    current_user: dict = Depends(get_current_user),
):
    """Send manual renewal reminders for an explicit list of (member, activity) pairs.

    Sends WhatsApp (if connected), push (if enabled), and creates portal
    notifications (if enabled). Always logs into renewal_reminder_log so the
    Renewals page can update its "last reminder" indicator.

    Set ``log_only=true`` to skip all dispatch (WhatsApp/push/portal) and only
    record reminder log entries — used by the per-card "Remind" button which
    opens wa.me directly in the browser to avoid double sends.
    """
    # Renewals page admins (with `renewals` permission) need to dispatch
    # reminders without holding full WhatsApp settings access.
    _require_renewals_or_whatsapp_access(current_user)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    if not payload.items:
        raise HTTPException(status_code=400, detail="No items provided")

    settings = await _get_settings()
    settings = {**settings, "_manual_run": True}
    template = settings.get("manual_reminder_template", DEFAULT_SETTINGS["manual_reminder_template"])
    push_enabled = settings.get("push_enabled", True)
    portal_enabled = settings.get("portal_enabled", True)

    wa_status = await _get_wa_status()
    wa_connected = wa_status.get("connected", False) and not log_only

    # Branch scoping: non-admins can only target members in their own branch.
    # Fail-closed via require_branch_scope: a non-admin without a branch_id
    # is denied entirely (HTTP 403).
    is_admin = current_user.get("is_admin", False)
    user_branch_id = require_branch_scope(current_user)

    # Build per-member groups so we send one WhatsApp message per phone covering
    # all selected activities (less spammy).
    member_ids = list({i.member_id for i in payload.items if i.member_id})
    members_by_id: dict = {}
    if member_ids:
        async for m in _db["members"].find({"id": {"$in": member_ids}}):
            members_by_id[m["id"]] = m

    # Hard-reject cross-branch member IDs for non-admin callers (no silent drops).
    if not is_admin:
        offenders = [
            mid for mid, m in members_by_id.items()
            if m.get("branch_id") != user_branch_id
        ]
        # Also flag any requested ids that don't exist (treated as forbidden too)
        missing = [mid for mid in member_ids if mid not in members_by_id]
        if offenders or missing:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Cross-branch member IDs not allowed",
                    "out_of_branch": offenders,
                    "missing": missing,
                },
            )

    today = datetime.now(RIYADH_TZ).date()
    wa_sent = 0
    push_sent = 0
    portal_inserted = 0
    skipped = 0

    # Group by member_id for WhatsApp
    groups: dict = {}
    for it in payload.items:
        groups.setdefault(it.member_id, []).append(it)

    for mid, items in groups.items():
        member = members_by_id.get(mid)
        if not member:
            skipped += len(items)
            continue
        member_logged = False
        name = member.get("name_ar") or member.get("name") or ""
        phone = member.get("phone", "")
        activities_text = "، ".join(filter(None, [i.activity_name for i in items]))
        # Use earliest end date for display
        end_dates = sorted([i.end_date for i in items if i.end_date])
        end_date_raw = end_dates[0] if end_dates else ""
        end_date_fmt = end_date_raw.replace("-", "/") if end_date_raw else ""
        # Compute days remaining for placeholder
        try:
            days_calc = (datetime.strptime(end_date_raw[:10], "%Y-%m-%d").date() - today).days
        except Exception:
            days_calc = items[0].days_remaining if items[0].days_remaining is not None else 0

        # Compute total fee for {fee} placeholder (sum of selected items' fees)
        total_fee = 0.0
        for it in items:
            try:
                if it.fee is not None:
                    total_fee += float(it.fee)
            except Exception:
                pass
        fee_str = str(int(total_fee)) if float(total_fee).is_integer() else f"{total_fee:.2f}"

        # ── WhatsApp ──
        if wa_connected and phone:
            wa_phone = _format_phone(phone)
            if wa_phone:
                message = _render_template(
                    template,
                    name=name,
                    activity=activities_text,
                    days=days_calc,
                    end_date=end_date_fmt,
                    fee=fee_str,
                )
                ok = await _send_wa_message(wa_phone, message)
                await _db["whatsapp_send_log"].insert_one({
                    "timestamp": datetime.now(RIYADH_TZ).isoformat(),
                    "member_id": mid,
                    "member_name": name,
                    "phone": phone,
                    "activities": activities_text,
                    "success": ok,
                    "days_before": days_calc,
                    "manual": True,
                    "type": "renewal_reminder",
                })
                for it in items:
                    await _record_renewal_reminder(
                        member_id=mid,
                        activity_name=it.activity_name or "",
                        channel="whatsapp",
                        days_before=days_calc,
                        manual=True,
                        success=ok,
                        sent_by=current_user,
                    )
                member_logged = True
                if ok:
                    wa_sent += 1
                # Match scheduler's 60s pacing to avoid account flagging.
                await asyncio.sleep(60)
        elif log_only and phone:
            # In log-only mode the browser opens wa.me directly. We still record
            # the manual reminder so the "Last reminder" badge updates.
            for it in items:
                await _record_renewal_reminder(
                    member_id=mid,
                    activity_name=it.activity_name or "",
                    channel="whatsapp",
                    days_before=days_calc,
                    manual=True,
                    success=True,
                    sent_by=current_user,
                )
            member_logged = True

        # ── Push ──
        if push_enabled and not log_only:
            try:
                from .push_notifications import send_push_notification, NotificationPayload
                push_title_tmpl = settings.get("push_title_template", DEFAULT_SETTINGS["push_title_template"])
                push_body_tmpl = settings.get("push_body_template", DEFAULT_SETTINGS["push_body_template"])
                title = _render_template(push_title_tmpl, name=name, activity=activities_text,
                                         days=days_calc, end_date=end_date_fmt, fee=fee_str)
                body = _render_template(push_body_tmpl, name=name, activity=activities_text,
                                        days=days_calc, end_date=end_date_fmt, fee=fee_str)
                payload_obj = NotificationPayload(
                    title=title,
                    body=body,
                    url="/portal/notifications",
                    tag=f"manual-renewal-{mid}-{end_date_raw}",
                )
                subs = await _db["push_subscriptions"].find(
                    {"member_id": mid, "is_active": True}, {"_id": 0}
                ).to_list(20)
                any_ok = False
                for sub in subs:
                    try:
                        if await send_push_notification(sub, payload_obj):
                            push_sent += 1
                            any_ok = True
                    except Exception as e:
                        logger.error(f"Manual push reminder failed for {name}: {e}")
                if subs:
                    for it in items:
                        await _record_renewal_reminder(
                            member_id=mid,
                            activity_name=it.activity_name or "",
                            channel="push",
                            days_before=days_calc,
                            manual=True,
                            success=any_ok,
                            sent_by=current_user,
                        )
                    member_logged = True
            except Exception as e:
                logger.error(f"Manual push reminder error for {name}: {e}")

        # ── Portal (member_notifications) ──
        if portal_enabled and not log_only:
            try:
                title_ar = "🔔 تذكير بتجديد الاشتراك"
                msg_ar = f"اشتراكك في {activities_text} سينتهي بتاريخ {end_date_raw}. نرجو التواصل معنا للتجديد."
                dedup_key = f"manual-renewal-{mid}-{end_date_raw}-{datetime.now(RIYADH_TZ).strftime('%Y%m%d%H%M')}"
                await _db["member_notifications"].insert_one({
                    "id": str(uuid.uuid4()),
                    "member_id": mid,
                    "type": "expiry_reminder",
                    "title_ar": title_ar,
                    "title": title_ar,
                    "message_ar": msg_ar,
                    "message": msg_ar,
                    "priority": "warning",
                    "dedup_key": dedup_key,
                    "is_read": False,
                    "created_at": datetime.now(RIYADH_TZ).isoformat(),
                })
                portal_inserted += 1
                for it in items:
                    await _record_renewal_reminder(
                        member_id=mid,
                        activity_name=it.activity_name or "",
                        channel="portal",
                        days_before=days_calc,
                        manual=True,
                        success=True,
                        sent_by=current_user,
                    )
                member_logged = True
            except Exception as e:
                logger.error(f"Manual portal reminder error for {name}: {e}")

        # Record bulk-remind intent if no channel logged (so the badge updates).
        if not member_logged:
            for it in items:
                await _record_renewal_reminder(
                    member_id=mid,
                    activity_name=it.activity_name or "",
                    channel="intent",
                    days_before=days_calc,
                    manual=True,
                    success=False,
                    sent_by=current_user,
                )

    return {
        "success": True,
        "wa_sent": wa_sent,
        "push_sent": push_sent,
        "portal_inserted": portal_inserted,
        "skipped": skipped,
        "wa_connected": wa_connected,
        "groups_processed": len(groups),
    }
