import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, date, timezone
from zoneinfo import ZoneInfo
from typing import Optional, List
from urllib.parse import urlparse
import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError
from .common import get_current_user
from utils.auth import require_branch_scope, resolve_branch_filter
from utils.tenant import get_current_tenant_slug, set_current_tenant, reset_current_tenant

logger = logging.getLogger("whatsapp")
_bulk_media_branch_locks: dict[str, asyncio.Lock] = {}


def _require_whatsapp_access(current_user: dict):
    if current_user.get("is_admin", False):
        return
    if "whatsapp" not in (current_user.get("permissions") or []):
        raise HTTPException(status_code=403, detail="WhatsApp access required")


def _require_bulk_whatsapp_access(current_user: dict):
    if current_user.get("is_admin", False):
        return
    permissions = current_user.get("permissions") or []
    if "messages" not in permissions and "whatsapp" not in permissions:
        raise HTTPException(status_code=403, detail="Messages access required")


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
    # Forward NEW admin bell notifications (رسائل الأعضاء، تنبيهات التجديد…)
    # to the manager's WhatsApp. Checked every minute by _admin_alert_loop.
    "admin_alert_enabled": False,
    "admin_alert_phone": "",
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
    # Used instead of manual_reminder_template when the subscription end date
    # has already passed (past-tense wording: "انتهى" not "قارب على الانتهاء").
    "manual_reminder_expired_template": "السلام عليكم {name}،\nنود إعلامكم بأن اشتراك ({activity}) في شركة اداء الابطال العالمية للرياضة قد انتهى بتاريخ {end_date}.\nنرجو التواصل معنا للتجديد.\nشكراً لكم 🏆",
    # Welcome message for NEW members (first subscription) — sent manually via the
    # Members page WhatsApp button. Empty per-branch override falls back to this.
    "welcome_template": "أهلاً وسهلاً {name} 🎉\nيسعدنا انضمامك إلى شركة اداء الابطال العالمية للرياضة في نشاط ({activity}).\nنتمنى لك تجربة رياضية ممتعة ومفيدة. 🏆",
    "send_hour": 9,
    "push_enabled": True,
    "portal_enabled": True,
    "push_title_template": "تنبيه: اشتراكك ينتهي قريباً 🔔",
    "push_body_template": "اشتراكك في {activity} ينتهي خلال {days} أيام ({end_date})",
    # English copies of the renewal-reminder push templates. send_push_notification
    # swaps these in for recipients whose saved language is 'en'. Admins can
    # override either language via the WhatsApp settings panel.
    "push_title_template_en": "Reminder: your subscription expires soon 🔔",
    "push_body_template_en": "Your {activity} subscription expires in {days} days ({end_date})",
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
        # Legacy fallback fields: clamp to the same 0..60 range as the offsets
        # model so a malformed doc can never schedule post-expiry auto-reminders.
        try:
            d1 = int(settings.get("days_before", 3))
            if 0 <= d1 <= 60:
                items.append({"days": d1, "enabled": True})
        except Exception:
            pass
        if settings.get("reminder_2_enabled", True):
            try:
                d2 = int(settings.get("days_before_2", 1))
                if 0 <= d2 <= 60:
                    items.append({"days": d2, "enabled": True})
            except Exception:
                pass
        for d in settings.get("extra_offsets", []) or []:
            try:
                dv = int(d)
                if 0 <= dv <= 60:
                    items.append({"days": dv, "enabled": True})
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


def _format_cloud_phone(phone: str) -> str:
    """Normalize local Saudi/Egyptian input without corrupting E.164 numbers."""
    if not phone:
        return ""
    normalized = str(phone).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    digits = "".join(filter(str.isdigit, normalized))
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("05") and len(digits) == 10:
        digits = "966" + digits[1:]
    elif digits.startswith("5") and len(digits) == 9:
        digits = "966" + digits
    elif digits.startswith("01") and len(digits) == 11:
        digits = "20" + digits[1:]
    if not (9 <= len(digits) <= 15) or digits.startswith("0"):
        return ""
    return digits + "@s.whatsapp.net"


async def _get_wa_status() -> dict:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{WA_SERVICE_URL}/status")
            return r.json()
    except Exception:
        return {"connected": False, "qr": None, "error": "WhatsApp service not running"}


async def _send_wa_message(phone: str, message: str) -> bool:
    return await _send_wa_message_for_branch(phone, message, None)


def _token_cipher():
    secret = os.environ.get("SESSION_SECRET", "")
    if not secret:
        raise RuntimeError("SESSION_SECRET is required for WhatsApp token encryption")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


def _encrypt_access_token(token: str) -> str:
    return _token_cipher().encrypt(token.encode("utf-8")).decode("ascii")


def _decrypt_access_token(encrypted: str) -> str:
    try:
        return _token_cipher().decrypt(encrypted.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Stored WhatsApp access token cannot be decrypted") from exc


def _webhook_verify_token(tenant_slug: str) -> str:
    secret = os.environ.get("SESSION_SECRET", "")
    if not secret:
        raise RuntimeError("SESSION_SECRET is required")
    return hmac.new(
        secret.encode("utf-8"),
        f"meta-webhook:{tenant_slug}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:40]


async def _get_branch_cloud_config(branch_id: Optional[str]) -> Optional[dict]:
    if _db is None or not branch_id:
        return None
    return await _db["whatsapp_branch_configs"].find_one(
        {"branch_id": branch_id}, {"_id": 0}
    )


async def _has_enabled_cloud_config() -> bool:
    if _db is None:
        return False
    return bool(await _db["whatsapp_branch_configs"].find_one(
        {"enabled": True, "access_token_encrypted": {"$exists": True, "$ne": ""}},
        {"_id": 1},
    ))


async def _send_meta_cloud_message_result(
    phone: str, message: str, config: dict
) -> tuple[bool, Optional[str], Optional[str]]:
    digits = "".join(filter(str.isdigit, phone or ""))
    if not digits:
        return False, None, "invalid_phone"
    try:
        token = _decrypt_access_token(config["access_token_encrypted"])
        version = (config.get("graph_api_version") or "v23.0").strip()
        url = f"https://graph.facebook.com/{version}/{config['phone_number_id']}/messages"
        template_name = (config.get("message_template_name") or "").strip()
        if template_name:
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": digits,
                "type": "template",
                "template": {
                    "name": template_name,
                    "language": {
                        "code": (config.get("template_language") or "ar").strip()
                    },
                    "components": [{
                        "type": "body",
                        "parameters": [{"type": "text", "text": message}],
                    }],
                },
            }
        else:
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": digits,
                "type": "text",
                "text": {"preview_url": False, "body": message},
            }
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
            )
        if 200 <= response.status_code < 300:
            try:
                response_data = response.json()
                message_id = ((response_data.get("messages") or [{}])[0]).get("id")
            except Exception:
                message_id = None
            return True, message_id, None
        logger.error(
            "Meta WhatsApp send failed for branch %s: HTTP %s",
            config.get("branch_id"),
            response.status_code,
        )
        return False, None, f"http_{response.status_code}"
    except Exception as exc:
        logger.error(
            "Meta WhatsApp send failed for branch %s: %s",
            config.get("branch_id"),
            type(exc).__name__,
        )
        return False, None, type(exc).__name__


async def _send_meta_cloud_message(phone: str, message: str, config: dict) -> bool:
    success, _, _ = await _send_meta_cloud_message_result(phone, message, config)
    return success


async def _send_wa_message_for_branch(
    phone: str, message: str, branch_id: Optional[str]
) -> bool:
    cloud_config = await _get_branch_cloud_config(branch_id)
    if cloud_config and cloud_config.get("enabled"):
        return await _send_meta_cloud_message(phone, message, cloud_config)
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


async def _get_branch_templates() -> dict:
    """Load per-branch WhatsApp template overrides keyed by branch id.

    Returns {branch_id: {"renewal": str, "manual": str}} containing only
    non-empty overrides. Branches without an override (or members without a
    branch) fall back to the shared global templates at send time.
    """
    if _db is None:
        return {}
    out: dict = {}
    try:
        async for b in _db["branches"].find(
            {}, {"_id": 0, "id": 1, "whatsapp_renewal_template": 1, "whatsapp_manual_template": 1, "whatsapp_manual_expired_template": 1}
        ):
            bid = b.get("id")
            if not bid:
                continue
            entry = {}
            renewal = (b.get("whatsapp_renewal_template") or "").strip()
            manual = (b.get("whatsapp_manual_template") or "").strip()
            manual_expired = (b.get("whatsapp_manual_expired_template") or "").strip()
            if renewal:
                entry["renewal"] = renewal
            if manual:
                entry["manual"] = manual
            if manual_expired:
                entry["manual_expired"] = manual_expired
            if entry:
                out[bid] = entry
    except Exception as e:
        logger.error(f"Failed to load branch WhatsApp templates: {e}")
    return out


def _resolve_branch_template(branch_templates: dict, branch_id, kind: str, fallback: str) -> str:
    """Pick a branch's override for `kind` ('renewal'|'manual'), else fallback."""
    return ((branch_templates or {}).get(branch_id) or {}).get(kind) or fallback


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


async def _send_wa_for_members(members_data: list, days_before: int, template: str, manual: bool = False, branch_templates: dict = None) -> int:
    """Send WhatsApp reminder messages. Returns count of successful sends.

    `branch_templates` (from `_get_branch_templates`) lets each member's branch
    override the renewal text; members without an override use `template`.
    """
    sent_count = 0
    for item in members_data:
        member = item["member"]
        phone = member.get("phone", "")
        if not phone:
            continue
        name = member.get("name", "")
        activity_name = item["activity_name"]
        end_date_fmt = item["end_date_fmt"]
        member_template = _resolve_branch_template(
            branch_templates, member.get("branch_id"), "renewal", template
        )
        message = _render_template(
            member_template,
            name=name,
            activity=activity_name,
            days=days_before,
            end_date=end_date_fmt,
            fee=item.get("fee_str", ""),
        )
        wa_phone = _format_phone(phone)
        if wa_phone:
            branch_id = member.get("branch_id")
            success = await _send_wa_message_for_branch(wa_phone, message, branch_id)
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
                "branch_id": branch_id,
                "transport": "meta_cloud" if await _get_branch_cloud_config(branch_id) else "legacy",
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
    push_title_tmpl_en = settings.get("push_title_template_en", DEFAULT_SETTINGS["push_title_template_en"])
    push_body_tmpl_en = settings.get("push_body_template_en", DEFAULT_SETTINGS["push_body_template_en"])

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
        # Render English variants too — send_push_notification swaps them in
        # for subscribers whose saved language is 'en'. Falls back to the
        # Arabic copy when the recipient's language is unknown.
        title_en = _render_template(push_title_tmpl_en, name=name, activity=activity_name,
                                    days=days_before, end_date=end_date_fmt, fee=fee_str)
        body_en = _render_template(push_body_tmpl_en, name=name, activity=activity_name,
                                   days=days_before, end_date=end_date_fmt, fee=fee_str)

        payload = NotificationPayload(
            title=title,
            body=body,
            title_en=title_en,
            body_en=body_en,
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
    branch_templates = await _get_branch_templates()

    wa_status = await _get_wa_status()
    wa_connected = wa_status.get("connected", False) or await _has_enabled_cloud_config()
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
            total_wa += await _send_wa_for_members(members_data, days, tpl_for_offset, branch_templates=branch_templates)

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


_admin_alert_started = False

# Max notifications forwarded to the manager per tenant per cycle; anything
# older in the same batch is dropped (cursor advances past it) so a backlog
# can never flood the manager's WhatsApp.
ADMIN_ALERT_BATCH_LIMIT = 5


async def _forward_admin_alerts_for_current_tenant():
    """Forward NEW admin bell notifications to the manager's WhatsApp.

    Cursor (`admin_alert_last_ts` on the whatsapp_settings doc) tracks the
    last forwarded notification's created_at. First run initializes it to now
    so history is never replayed. When WhatsApp is disconnected nothing is
    sent and the cursor doesn't move; on reconnect only the newest
    ADMIN_ALERT_BATCH_LIMIT items go out and the cursor jumps past the rest.
    """
    settings = await _get_settings()
    if not settings.get("admin_alert_enabled"):
        return
    phone = (settings.get("admin_alert_phone") or "").strip()
    if not phone:
        return

    coll = _db["whatsapp_settings"]
    last_ts = settings.get("admin_alert_last_ts")
    now_iso = datetime.now(timezone.utc).isoformat()
    if not last_ts:
        await coll.update_one({}, {"$set": {"admin_alert_last_ts": now_iso}}, upsert=True)
        return

    fresh = await _db["notifications"].find(
        {"created_at": {"$gt": last_ts}},
        {"_id": 0, "title_ar": 1, "title": 1, "message_ar": 1, "message": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(200)
    if not fresh:
        return

    wa_status = await _get_wa_status()
    if not wa_status.get("connected", False):
        return  # keep cursor; retry when the bot reconnects

    newest_ts = max(str(n.get("created_at") or "") for n in fresh)
    to_send = fresh[-ADMIN_ALERT_BATCH_LIMIT:]
    dropped = len(fresh) - len(to_send)

    wa_phone = _format_phone(phone)
    sent = 0
    for n in to_send:
        title = n.get("title_ar") or n.get("title") or "إشعار جديد"
        body = n.get("message_ar") or n.get("message") or ""
        message = f"🔔 {title}\n{body}".strip()
        if await _send_wa_message(wa_phone, message):
            sent += 1
            # Advance cursor per success so a mid-batch failure retries the
            # rest. $max keeps advancement monotonic (ISO strings compare
            # lexicographically) even if another writer raced us.
            await coll.update_one(
                {}, {"$max": {"admin_alert_last_ts": str(n.get("created_at") or now_iso)}}, upsert=True
            )
        else:
            logger.error("Admin WA alert send failed — will retry next cycle")
            return
    if dropped:
        await coll.update_one({}, {"$max": {"admin_alert_last_ts": newest_ts}}, upsert=True)
        logger.info(f"Admin WA alerts: sent {sent}, skipped {dropped} older backlog items")


async def _admin_alert_loop():
    global _admin_alert_started
    _admin_alert_started = True
    logger.info("WhatsApp admin-alert forwarder started (every 60s)")
    from utils.tenant import list_active_tenants, set_current_tenant, reset_current_tenant
    while True:
        try:
            await asyncio.sleep(60)
            tenants = await list_active_tenants()
            for tenant in tenants:
                token = set_current_tenant(tenant)
                try:
                    await _forward_admin_alerts_for_current_tenant()
                except Exception as e:
                    logger.error(f"Admin WA alert tenant={tenant.get('slug')} error: {e}")
                finally:
                    reset_current_tenant(token)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Admin WA alert loop error: {e}")
            await asyncio.sleep(300)


def start_scheduler():
    global _scheduler_started
    if not _scheduler_started:
        asyncio.ensure_future(_scheduler_loop())
    if not _admin_alert_started:
        asyncio.ensure_future(_admin_alert_loop())


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
    manual_reminder_expired_template: Optional[str] = None
    welcome_template: Optional[str] = None
    send_hour: Optional[int] = None
    push_enabled: Optional[bool] = None
    portal_enabled: Optional[bool] = None
    push_title_template: Optional[str] = None
    push_body_template: Optional[str] = None
    admin_alert_enabled: Optional[bool] = None
    admin_alert_phone: Optional[str] = None


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
    if data.manual_reminder_expired_template is not None and len(data.manual_reminder_expired_template) > 1000:
        raise HTTPException(status_code=400, detail="manual_reminder_expired_template must not exceed 1000 characters")
    if data.welcome_template is not None and len(data.welcome_template) > 1000:
        raise HTTPException(status_code=400, detail="welcome_template must not exceed 1000 characters")
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
    # Manager-alert destination is sensitive (receives every bell notification,
    # incl. member messages) — only academy admins may change it. Non-admin
    # saves that merely echo the stored values back (the settings form sends
    # the whole object) are allowed; actual changes are rejected.
    if not current_user.get("is_admin") and (
        data.admin_alert_enabled is not None or data.admin_alert_phone is not None
    ):
        stored = await _get_settings()
        changed = (
            (data.admin_alert_enabled is not None
             and bool(data.admin_alert_enabled) != bool(stored.get("admin_alert_enabled")))
            or (data.admin_alert_phone is not None
                and data.admin_alert_phone.strip() != (stored.get("admin_alert_phone") or "").strip())
        )
        if changed:
            raise HTTPException(status_code=403, detail="تغيير تنبيهات المدير متاح للمدير فقط")
        data.admin_alert_enabled = None
        data.admin_alert_phone = None
    coll = _db["whatsapp_settings"]
    update = {k: v for k, v in data.dict().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    if data.admin_alert_enabled:
        # Baseline at enable time: forward only notifications created from now
        # on; never replay history produced before/while the feature was off.
        update["admin_alert_last_ts"] = datetime.now(timezone.utc).isoformat()
    await coll.update_one({}, {"$set": update}, upsert=True)
    return await _get_settings()


class SendTestRequest(BaseModel):
    phone: str
    message: Optional[str] = None
    branch_id: Optional[str] = None


class BranchCloudConfigUpdate(BaseModel):
    enabled: bool = True
    phone_number_id: str
    whatsapp_business_account_id: Optional[str] = ""
    access_token: Optional[str] = None
    graph_api_version: str = "v23.0"
    message_template_name: Optional[str] = ""
    template_language: str = "ar"
    single_variable_template_confirmed: bool = False
    app_secret: Optional[str] = None
    inbox_enabled: bool = False
    image_template_name: Optional[str] = ""
    document_template_name: Optional[str] = ""
    media_templates_confirmed: bool = False


def _require_admin(current_user: dict):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")


@router.get("/branch-cloud/{branch_id}")
async def get_branch_cloud_config(
    branch_id: str, current_user: dict = Depends(get_current_user)
):
    _require_admin(current_user)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    branch = await _db["branches"].find_one({"id": branch_id}, {"_id": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    config = await _get_branch_cloud_config(branch_id)
    if not config:
        return {
            "branch_id": branch_id,
            "enabled": False,
            "phone_number_id": "",
            "whatsapp_business_account_id": "",
            "graph_api_version": "v23.0",
            "message_template_name": "",
            "template_language": "ar",
            "single_variable_template_confirmed": False,
            "app_secret_configured": False,
            "inbox_enabled": False,
            "image_template_name": "",
            "document_template_name": "",
            "media_templates_confirmed": False,
            "token_configured": False,
        }
    return {
        "branch_id": branch_id,
        "enabled": bool(config.get("enabled")),
        "phone_number_id": config.get("phone_number_id") or "",
        "whatsapp_business_account_id": config.get("whatsapp_business_account_id") or "",
        "graph_api_version": config.get("graph_api_version") or "v23.0",
        "message_template_name": config.get("message_template_name") or "",
        "template_language": config.get("template_language") or "ar",
        "single_variable_template_confirmed": bool(
            config.get("single_variable_template_confirmed")
        ),
        "app_secret_configured": bool(config.get("app_secret_encrypted")),
        "inbox_enabled": bool(config.get("inbox_enabled")),
        "image_template_name": config.get("image_template_name") or "",
        "document_template_name": config.get("document_template_name") or "",
        "media_templates_confirmed": bool(config.get("media_templates_confirmed")),
        "token_configured": bool(config.get("access_token_encrypted")),
        "updated_at": config.get("updated_at"),
    }


@router.put("/branch-cloud/{branch_id}")
async def update_branch_cloud_config(
    branch_id: str,
    data: BranchCloudConfigUpdate,
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    branch = await _db["branches"].find_one({"id": branch_id}, {"_id": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    phone_number_id = "".join(filter(str.isdigit, data.phone_number_id or ""))
    waba_id = "".join(filter(str.isdigit, data.whatsapp_business_account_id or ""))
    version = (data.graph_api_version or "v23.0").strip()
    if not phone_number_id:
        raise HTTPException(status_code=400, detail="Phone Number ID is required")
    if not version.startswith("v") or not version[1:].replace(".", "").isdigit():
        raise HTTPException(status_code=400, detail="Invalid Graph API version")
    existing = await _get_branch_cloud_config(branch_id) or {}
    update = {
        "branch_id": branch_id,
        "enabled": bool(data.enabled),
        "phone_number_id": phone_number_id,
        "whatsapp_business_account_id": waba_id,
        "graph_api_version": version,
        "message_template_name": (data.message_template_name or "").strip(),
        "template_language": (data.template_language or "ar").strip(),
        "single_variable_template_confirmed": bool(
            data.single_variable_template_confirmed
        ),
        "inbox_enabled": bool(data.inbox_enabled),
        "image_template_name": (data.image_template_name or "").strip(),
        "document_template_name": (data.document_template_name or "").strip(),
        "media_templates_confirmed": bool(data.media_templates_confirmed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": current_user.get("user_id") or current_user.get("id"),
    }
    if data.access_token and data.access_token.strip():
        update["access_token_encrypted"] = _encrypt_access_token(data.access_token.strip())
    elif existing.get("access_token_encrypted"):
        update["access_token_encrypted"] = existing["access_token_encrypted"]
    elif data.enabled:
        raise HTTPException(status_code=400, detail="Access Token is required")
    if data.app_secret and data.app_secret.strip():
        update["app_secret_encrypted"] = _encrypt_access_token(data.app_secret.strip())
    elif existing.get("app_secret_encrypted"):
        update["app_secret_encrypted"] = existing["app_secret_encrypted"]
    elif data.inbox_enabled:
        raise HTTPException(
            status_code=400,
            detail="Meta App Secret is required to enable the inbox",
        )
    await _db["whatsapp_branch_configs"].update_one(
        {"branch_id": branch_id}, {"$set": update}, upsert=True
    )
    return await get_branch_cloud_config(branch_id, current_user)


@router.get("/meta-webhook-info")
async def get_meta_webhook_info(
    request: Request, current_user: dict = Depends(get_current_user)
):
    _require_admin(current_user)
    slug = get_current_tenant_slug()
    return {
        "callback_url": str(request.base_url).rstrip("/") + f"/api/whatsapp/meta-webhook/{slug}",
        "verify_token": _webhook_verify_token(slug),
    }


async def _with_webhook_tenant(tenant_slug: str):
    from control_db import get_tenant_by_slug
    tenant = await get_tenant_by_slug(tenant_slug)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return set_current_tenant(tenant)


@router.get("/meta-webhook/{tenant_slug}")
async def verify_meta_webhook(
    tenant_slug: str,
    hub_mode: Optional[str] = Query(None, alias="hub.mode"),
    hub_verify_token: Optional[str] = Query(None, alias="hub.verify_token"),
    hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
):
    if (
        hub_mode != "subscribe"
        or not hmac.compare_digest(
            hub_verify_token or "", _webhook_verify_token(tenant_slug)
        )
    ):
        raise HTTPException(status_code=403, detail="Webhook verification failed")
    return Response(content=hub_challenge or "", media_type="text/plain")


@router.post("/meta-webhook/{tenant_slug}")
async def receive_meta_webhook(tenant_slug: str, request: Request):
    raw = await request.body()
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    token = await _with_webhook_tenant(tenant_slug)
    try:
        await _db["whatsapp_cloud_messages"].create_index(
            "meta_message_id", unique=True, sparse=True
        )
        await _db["whatsapp_cloud_conversations"].create_index("id", unique=True)
        values = [
            change.get("value") or {}
            for entry in payload.get("entry") or []
            for change in entry.get("changes") or []
            if change.get("field") == "messages"
        ]
        if len(values) > 100:
            raise HTTPException(status_code=413, detail="Webhook batch is too large")
        phone_ids = {
            str(value.get("metadata", {}).get("phone_number_id") or "")
            for value in values
        } - {""}
        if not phone_ids:
            raise HTTPException(status_code=400, detail="Missing Phone Number ID")
        configs_by_phone_id = {}
        app_secrets = set()
        for phone_number_id in phone_ids:
            config = await _db["whatsapp_branch_configs"].find_one(
                {
                    "phone_number_id": phone_number_id,
                    "enabled": True,
                    "inbox_enabled": True,
                    "app_secret_encrypted": {"$exists": True, "$ne": ""},
                },
                {"_id": 0},
            )
            if not config:
                raise HTTPException(status_code=403, detail="Webhook branch not configured")
            configs_by_phone_id[phone_number_id] = config
            app_secrets.add(_decrypt_access_token(config["app_secret_encrypted"]))
        if len(app_secrets) != 1:
            raise HTTPException(
                status_code=403,
                detail="Webhook batch contains phone numbers from different Meta apps",
            )
        app_secret = next(iter(app_secrets))
        expected = "sha256=" + hmac.new(
            app_secret.encode("utf-8"), raw, hashlib.sha256
        ).hexdigest()
        supplied = request.headers.get("x-hub-signature-256") or ""
        if not hmac.compare_digest(supplied, expected):
            raise HTTPException(status_code=403, detail="Invalid webhook signature")

        received_at = datetime.now(timezone.utc)
        now = received_at.isoformat()
        for value in values:
            phone_number_id = str(
                value.get("metadata", {}).get("phone_number_id") or ""
            )
            config = configs_by_phone_id[phone_number_id]
            contacts = {
                str(contact.get("wa_id")): (contact.get("profile") or {}).get("name")
                for contact in value.get("contacts") or []
            }
            for message in value.get("messages") or []:
                meta_id = str(message.get("id") or "")
                if not meta_id or await _db["whatsapp_cloud_messages"].find_one(
                    {"meta_message_id": meta_id}, {"_id": 1}
                ):
                    continue
                phone = str(message.get("from") or "")
                conversation_id = f"{config['branch_id']}:{phone}"
                try:
                    event_dt = datetime.fromtimestamp(
                        int(message.get("timestamp")), tz=timezone.utc
                    )
                    if event_dt > received_at + timedelta(minutes=5):
                        raise ValueError("future timestamp")
                except Exception:
                    event_dt = None
                event_at = event_dt.isoformat() if event_dt else now
                message_type = message.get("type") or "unknown"
                body = ""
                if message_type == "text":
                    body = (message.get("text") or {}).get("body") or ""
                elif message_type == "button":
                    body = (message.get("button") or {}).get("text") or ""
                elif message_type == "interactive":
                    interactive = message.get("interactive") or {}
                    body = (
                        (interactive.get("button_reply") or {}).get("title")
                        or (interactive.get("list_reply") or {}).get("title")
                        or ""
                    )
                media = message.get(message_type) or {}
                try:
                    await _db["whatsapp_cloud_messages"].insert_one({
                        "id": str(uuid.uuid4()),
                        "conversation_id": conversation_id,
                        "branch_id": config["branch_id"],
                        "meta_message_id": meta_id,
                        "direction": "inbound",
                        "phone": phone,
                        "type": message_type,
                        "body": body,
                        "media_id": media.get("id") if isinstance(media, dict) else None,
                        "mime_type": media.get("mime_type") if isinstance(media, dict) else None,
                        "status": "received",
                        "created_at": event_at,
                        "received_at": now,
                        "meta_timestamp": message.get("timestamp"),
                    })
                except DuplicateKeyError:
                    continue
                await _db["whatsapp_cloud_conversations"].update_one(
                    {"id": conversation_id},
                    {
                        "$set": {
                            "id": conversation_id,
                            "branch_id": config["branch_id"],
                            "phone": phone,
                            "contact_name": contacts.get(phone) or phone,
                            "last_message": body or f"[{message_type}]",
                            "last_message_at": event_at,
                            "last_inbound_at": event_dt.isoformat() if event_dt else None,
                            "last_direction": "inbound",
                        },
                        "$inc": {"unread_count": 1},
                        "$setOnInsert": {"created_at": now},
                    },
                    upsert=True,
                )
            for status in value.get("statuses") or []:
                meta_id = str(status.get("id") or "")
                if not meta_id:
                    continue
                status_name = status.get("status") or "unknown"
                errors = status.get("errors") or []
                await _db["whatsapp_cloud_messages"].update_one(
                    {"meta_message_id": meta_id},
                    {"$set": {
                        "status": status_name,
                        "status_updated_at": now,
                        "error": errors[0].get("title") if errors else None,
                    }},
                )
        return {"received": True}
    finally:
        reset_current_tenant(token)


class CloudInboxReplyRequest(BaseModel):
    body: str


@router.get("/cloud-inbox/conversations")
async def list_cloud_inbox_conversations(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    query = {"branch_id": effective_branch} if effective_branch else {}
    rows = await (
        _db["whatsapp_cloud_conversations"]
        .find(query, {"_id": 0})
        .sort("last_message_at", -1)
        .limit(200)
        .to_list(length=200)
    )
    branch_cache = {}
    for row in rows:
        branch_id = row.get("branch_id")
        if branch_id not in branch_cache:
            branch = await _db["branches"].find_one(
                {"id": branch_id}, {"_id": 0, "name": 1}
            )
            branch_cache[branch_id] = (branch or {}).get("name") or branch_id
        row["branch_name"] = branch_cache[branch_id]
    return {
        "conversations": rows,
        "unread_count": sum(int(row.get("unread_count") or 0) for row in rows),
    }


@router.get("/cloud-inbox/conversations/{conversation_id}")
async def get_cloud_inbox_thread(
    conversation_id: str, current_user: dict = Depends(get_current_user)
):
    _require_bulk_whatsapp_access(current_user)
    conversation = await _db["whatsapp_cloud_conversations"].find_one(
        {"id": conversation_id}, {"_id": 0}
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    _assert_branch_access(current_user, conversation.get("branch_id"))
    messages = await (
        _db["whatsapp_cloud_messages"]
        .find({"conversation_id": conversation_id}, {"_id": 0})
        .sort("created_at", 1)
        .limit(500)
        .to_list(length=500)
    )
    await _db["whatsapp_cloud_conversations"].update_one(
        {"id": conversation_id}, {"$set": {"unread_count": 0}}
    )
    branch = await _db["branches"].find_one(
        {"id": conversation.get("branch_id")}, {"_id": 0, "name": 1}
    )
    conversation["branch_name"] = (branch or {}).get("name")
    return {"conversation": conversation, "messages": messages}


@router.get("/cloud-inbox/media/{message_id}")
async def get_cloud_inbox_media(
    message_id: str, current_user: dict = Depends(get_current_user)
):
    _require_bulk_whatsapp_access(current_user)
    message = await _db["whatsapp_cloud_messages"].find_one(
        {"id": message_id}, {"_id": 0}
    )
    if not message or not message.get("media_id"):
        raise HTTPException(status_code=404, detail="Media not found")
    _assert_branch_access(current_user, message.get("branch_id"))
    config = await _get_branch_cloud_config(message.get("branch_id"))
    if not config or not config.get("access_token_encrypted"):
        raise HTTPException(status_code=400, detail="Branch Meta API is not configured")
    token = _decrypt_access_token(config["access_token_encrypted"])
    version = (config.get("graph_api_version") or "v23.0").strip()
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            metadata_response = await client.get(
                f"https://graph.facebook.com/{version}/{message['media_id']}",
                headers=headers,
            )
            if metadata_response.status_code >= 300:
                raise HTTPException(status_code=502, detail="Could not retrieve Meta media")
            media_url = metadata_response.json().get("url")
            if not media_url:
                raise HTTPException(status_code=502, detail="Meta media URL is missing")
            parsed = urlparse(media_url)
            hostname = (parsed.hostname or "").lower()
            allowed_host = (
                hostname == "lookaside.fbsbx.com"
                or hostname.endswith(".fbcdn.net")
                or hostname.endswith(".fbsbx.com")
            )
            if parsed.scheme != "https" or not allowed_host:
                raise HTTPException(status_code=502, detail="Unexpected Meta media host")
            media_response = await client.get(media_url, headers=headers)
            if media_response.status_code >= 300:
                raise HTTPException(status_code=502, detail="Could not download Meta media")
            content = media_response.content
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Could not download Meta media")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Media exceeds 20 MB")
    content_type = (
        message.get("mime_type")
        or media_response.headers.get("content-type")
        or "application/octet-stream"
    )
    return StreamingResponse(
        iter([content]),
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post("/cloud-inbox/conversations/{conversation_id}/reply")
async def reply_to_cloud_inbox_thread(
    conversation_id: str,
    data: CloudInboxReplyRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    body = (data.body or "").strip()
    if not body or len(body) > 4096:
        raise HTTPException(status_code=400, detail="Message must be 1-4096 characters")
    conversation = await _db["whatsapp_cloud_conversations"].find_one(
        {"id": conversation_id}, {"_id": 0}
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    branch_id = conversation.get("branch_id")
    _assert_branch_access(current_user, branch_id)
    config = await _get_branch_cloud_config(branch_id)
    if not (
        config
        and config.get("enabled")
        and config.get("phone_number_id")
        and config.get("access_token_encrypted")
    ):
        raise HTTPException(status_code=400, detail="Branch Meta API is not configured")

    now_dt = datetime.now(timezone.utc)
    try:
        last_inbound = datetime.fromisoformat(
            str(conversation.get("last_inbound_at") or "").replace("Z", "+00:00")
        )
        if last_inbound.tzinfo is None:
            last_inbound = last_inbound.replace(tzinfo=timezone.utc)
        inside_service_window = now_dt - last_inbound <= timedelta(hours=24)
    except Exception:
        inside_service_window = False

    send_config = dict(config)
    if inside_service_window:
        send_config["message_template_name"] = ""
    elif not (
        config.get("message_template_name")
        and config.get("single_variable_template_confirmed")
    ):
        raise HTTPException(
            status_code=400,
            detail="The 24-hour window ended; configure an approved Meta template",
        )

    success, meta_message_id, error = await _send_meta_cloud_message_result(
        conversation.get("phone"), body, send_config
    )
    if not success:
        raise HTTPException(status_code=502, detail=f"Meta send failed ({error or 'unknown'})")
    now = now_dt.isoformat()
    message = {
        "id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "branch_id": branch_id,
        "meta_message_id": meta_message_id,
        "direction": "outbound",
        "phone": conversation.get("phone"),
        "type": "template" if not inside_service_window else "text",
        "body": body,
        "status": "sent",
        "created_at": now,
        "sent_by": current_user.get("user_id") or current_user.get("id"),
    }
    await _db["whatsapp_cloud_messages"].insert_one(message)
    await _db["whatsapp_cloud_conversations"].update_one(
        {"id": conversation_id},
        {"$set": {
            "last_message": body,
            "last_message_at": now,
            "last_direction": "outbound",
        }},
    )
    return {"success": True, "message": message, "used_template": not inside_service_window}


class BranchCloudTestRequest(BaseModel):
    phone: str
    message: Optional[str] = None


class BulkCloudRecipient(BaseModel):
    phone: str
    message: str


class BulkCloudSendRequest(BaseModel):
    branch_id: str
    recipients: List[BulkCloudRecipient]


def _assert_branch_access(current_user: dict, branch_id: str):
    if current_user.get("is_admin", False):
        return
    effective_branch = require_branch_scope(current_user, branch_id)
    if effective_branch != branch_id:
        raise HTTPException(status_code=403, detail="Branch access denied")


@router.get("/branch-cloud/{branch_id}/availability")
async def get_branch_cloud_availability(
    branch_id: str, current_user: dict = Depends(get_current_user)
):
    _require_bulk_whatsapp_access(current_user)
    _assert_branch_access(current_user, branch_id)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    branch = await _db["branches"].find_one({"id": branch_id}, {"_id": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    config = await _get_branch_cloud_config(branch_id)
    return {
        "enabled": bool(
            config
            and config.get("enabled")
            and config.get("phone_number_id")
            and config.get("access_token_encrypted")
        ),
        "template_configured": bool(
            config
            and config.get("message_template_name")
            and config.get("single_variable_template_confirmed")
        ),
        "image_template_configured": bool(
            config and config.get("image_template_name")
            and config.get("media_templates_confirmed")
        ),
        "document_template_configured": bool(
            config and config.get("document_template_name")
            and config.get("media_templates_confirmed")
        ),
    }


@router.post("/branch-cloud/send-bulk")
async def send_branch_cloud_bulk(
    data: BulkCloudSendRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    _assert_branch_access(current_user, data.branch_id)
    if not data.recipients:
        raise HTTPException(status_code=400, detail="No recipients supplied")
    if len(data.recipients) > 200:
        raise HTTPException(status_code=400, detail="Maximum 200 recipients per batch")
    config = await _get_branch_cloud_config(data.branch_id)
    if not (
        config
        and config.get("enabled")
        and config.get("phone_number_id")
        and config.get("access_token_encrypted")
    ):
        raise HTTPException(status_code=400, detail="Meta WhatsApp is not configured for this branch")
    if not (
        config.get("message_template_name")
        and config.get("single_variable_template_confirmed")
    ):
        raise HTTPException(
            status_code=400,
            detail="Confirm an approved Meta template with exactly one body variable",
        )

    semaphore = asyncio.Semaphore(5)

    async def send_one(index: int, recipient: BulkCloudRecipient):
        wa_phone = _format_cloud_phone(recipient.phone)
        message = (recipient.message or "").strip()
        if not wa_phone or not message or len(message) > 4096:
            return index, False
        async with semaphore:
            success = await _send_meta_cloud_message(wa_phone, message, config)
        try:
            await _db["whatsapp_send_log"].insert_one({
                "phone": wa_phone.split("@")[0],
                "message": message,
                "success": success,
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "manual": True,
                "type": "bulk_cloud",
                "branch_id": data.branch_id,
                "transport": "meta_cloud",
            })
        except Exception as exc:
            logger.warning("Could not save bulk WhatsApp log: %s", type(exc).__name__)
        return index, success

    results = await asyncio.gather(*[
        send_one(index, recipient)
        for index, recipient in enumerate(data.recipients)
    ])
    failed_indices = [index for index, success in results if not success]
    sent = len(results) - len(failed_indices)
    return {
        "success": sent > 0,
        "total": len(results),
        "sent": sent,
        "failed": len(failed_indices),
        "failed_indices": failed_indices,
    }


async def _upload_meta_bulk_media(
    content: bytes, filename: str, mime_type: str, config: dict
) -> str:
    token = _decrypt_access_token(config["access_token_encrypted"])
    version = (config.get("graph_api_version") or "v23.0").strip()
    url = (
        f"https://graph.facebook.com/{version}/"
        f"{config['phone_number_id']}/media"
    )
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}"},
            data={"messaging_product": "whatsapp"},
            files={"file": (filename, content, mime_type)},
        )
    if response.status_code >= 300:
        logger.error("Meta media upload failed: HTTP %s", response.status_code)
        raise HTTPException(status_code=502, detail="Meta media upload failed")
    media_id = response.json().get("id")
    if not media_id:
        raise HTTPException(status_code=502, detail="Meta did not return a media ID")
    return media_id


async def _send_meta_media_template(
    phone: str,
    message: str,
    media_id: str,
    media_type: str,
    filename: str,
    config: dict,
) -> bool:
    wa_phone = _format_cloud_phone(phone)
    if not wa_phone:
        return False
    template_name = (
        config.get("image_template_name")
        if media_type == "image"
        else config.get("document_template_name")
    )
    media_parameter = {"id": media_id}
    if media_type == "document":
        media_parameter["filename"] = filename
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": wa_phone.split("@")[0],
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": config.get("template_language") or "ar"},
            "components": [
                {
                    "type": "header",
                    "parameters": [{
                        "type": media_type,
                        media_type: media_parameter,
                    }],
                },
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": message}],
                },
            ],
        },
    }
    token = _decrypt_access_token(config["access_token_encrypted"])
    version = (config.get("graph_api_version") or "v23.0").strip()
    url = (
        f"https://graph.facebook.com/{version}/"
        f"{config['phone_number_id']}/messages"
    )
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if 200 <= response.status_code < 300:
            return True
        logger.error("Meta media template send failed: HTTP %s", response.status_code)
    except Exception as exc:
        logger.error("Meta media template send failed: %s", type(exc).__name__)
    return False


@router.post("/branch-cloud/send-bulk-media")
async def send_branch_cloud_bulk_media(
    branch_id: str = Form(...),
    recipients_json: str = Form(...),
    idempotency_key: str = Form(...),
    attachment: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    _assert_branch_access(current_user, branch_id)
    try:
        raw_recipients = json.loads(recipients_json)
        recipients = [BulkCloudRecipient(**item) for item in raw_recipients]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid recipients")
    if not recipients or len(recipients) > 200:
        raise HTTPException(status_code=400, detail="Supply 1-200 recipients")
    config = await _get_branch_cloud_config(branch_id)
    if not (
        config and config.get("enabled") and config.get("phone_number_id")
        and config.get("access_token_encrypted")
    ):
        raise HTTPException(status_code=400, detail="Meta WhatsApp is not configured")

    mime_type = (attachment.content_type or "").lower()
    if mime_type in {"image/jpeg", "image/png"}:
        media_type = "image"
        template_name = config.get("image_template_name")
        max_size = 5 * 1024 * 1024
        extension = ".jpg" if mime_type == "image/jpeg" else ".png"
    elif mime_type == "application/pdf":
        media_type = "document"
        template_name = config.get("document_template_name")
        max_size = 20 * 1024 * 1024
        extension = ".pdf"
    else:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, and PDF are supported")

    content_buffer = bytearray()
    while True:
        chunk = await attachment.read(1024 * 1024)
        if not chunk:
            break
        content_buffer.extend(chunk)
        if len(content_buffer) > max_size:
            raise HTTPException(status_code=400, detail="Attachment is too large")
    content = bytes(content_buffer)
    valid_signature = (
        content.startswith(b"\xff\xd8\xff")
        if mime_type == "image/jpeg"
        else content.startswith(b"\x89PNG\r\n\x1a\n")
        if mime_type == "image/png"
        else content.startswith(b"%PDF-")
    )
    if not content or not valid_signature:
        raise HTTPException(status_code=400, detail="Invalid or oversized attachment")
    raw_name = os.path.basename(
        (attachment.filename or f"attachment{extension}").replace("\\", "_")
    )
    safe_stem = re.sub(
        r"[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]+", "", raw_name
    )
    safe_stem = re.sub(r"[^A-Za-z0-9._ -]+", "_", safe_stem)
    safe_stem = os.path.splitext(safe_stem)[0].strip(" ._")[:100] or "attachment"
    filename = safe_stem + extension
    if not template_name or not config.get("media_templates_confirmed"):
        raise HTTPException(
            status_code=400,
            detail=f"Configure the approved Meta {media_type} template for this branch",
        )
    if any(
        not (recipient.message or "").strip()
        or len(recipient.message.strip()) > 1024
        for recipient in recipients
    ):
        raise HTTPException(status_code=400, detail="Message text must be 1-1024 characters")
    idempotency_key = re.sub(r"[^A-Za-z0-9_-]", "", idempotency_key or "")[:100]
    if len(idempotency_key) < 12:
        raise HTTPException(status_code=400, detail="Invalid idempotency key")

    lock = _bulk_media_branch_locks.setdefault(branch_id, asyncio.Lock())
    async with lock:
        batches = _db["whatsapp_bulk_media_batches"]
        await batches.create_index(
            [("branch_id", 1), ("idempotency_key", 1)], unique=True
        )
        existing = await batches.find_one(
            {"branch_id": branch_id, "idempotency_key": idempotency_key},
            {"_id": 0},
        )
        if existing:
            if existing.get("result"):
                return existing["result"]
            raise HTTPException(status_code=409, detail="This batch is already being sent")
        try:
            await batches.insert_one({
                "branch_id": branch_id,
                "idempotency_key": idempotency_key,
                "status": "processing",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except DuplicateKeyError:
            raise HTTPException(status_code=409, detail="This batch is already being sent")

        media_id = await _upload_meta_bulk_media(
            content, filename, mime_type, config
        )
        semaphore = asyncio.Semaphore(5)

        async def send_one(index: int, recipient: BulkCloudRecipient):
            async with semaphore:
                success = await _send_meta_media_template(
                    recipient.phone,
                    recipient.message.strip(),
                    media_id,
                    media_type,
                    filename,
                    config,
                )
            try:
                await _db["whatsapp_send_log"].insert_one({
                    "phone": _format_cloud_phone(recipient.phone).split("@")[0],
                    "message": recipient.message.strip(),
                    "success": success,
                    "sent_at": datetime.now(timezone.utc).isoformat(),
                    "manual": True,
                    "type": f"bulk_cloud_{media_type}",
                    "branch_id": branch_id,
                    "transport": "meta_cloud",
                    "filename": filename,
                })
            except Exception as exc:
                logger.warning("Could not save bulk media WhatsApp log: %s", type(exc).__name__)
            return index, success

        results = await asyncio.gather(*[
            send_one(index, recipient)
            for index, recipient in enumerate(recipients)
        ])
        failed_indices = [index for index, success in results if not success]
        sent = len(results) - len(failed_indices)
        result = {
            "success": sent > 0,
            "media_type": media_type,
            "total": len(results),
            "sent": sent,
            "failed": len(failed_indices),
            "failed_indices": failed_indices,
        }
        await batches.update_one(
            {"branch_id": branch_id, "idempotency_key": idempotency_key},
            {"$set": {
                "status": "completed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "result": result,
            }},
        )
        return result


@router.post("/branch-cloud/{branch_id}/test")
async def test_branch_cloud_config(
    branch_id: str,
    data: BranchCloudTestRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)
    config = await _get_branch_cloud_config(branch_id)
    if not config or not config.get("enabled") or not config.get("access_token_encrypted"):
        raise HTTPException(status_code=400, detail="Meta WhatsApp is not configured for this branch")
    message = data.message or "رسالة تجريبية من نظام إدارة الأكاديمية"
    wa_phone = _format_cloud_phone(data.phone)
    if not wa_phone:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    if await _send_meta_cloud_message(wa_phone, message, config):
        return {"success": True}
    raise HTTPException(status_code=502, detail="Meta WhatsApp test failed")


@router.post("/test")
async def send_test(data: SendTestRequest, current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    now_riyadh = datetime.now(RIYADH_TZ)
    message = data.message or f"رسالة تجريبية من نظام إدارة أكاديمية الأبطال 🏆\nالوقت: {now_riyadh.strftime('%Y-%m-%d %H:%M')}"
    wa_phone = _format_phone(data.phone)
    if not wa_phone:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    if data.branch_id:
        if not current_user.get("is_admin"):
            require_branch_scope(current_user, data.branch_id)
        success = await _send_wa_message_for_branch(wa_phone, message, data.branch_id)
    else:
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
        "manual_reminder_expired_template": settings.get(
            "manual_reminder_expired_template",
            DEFAULT_SETTINGS["manual_reminder_expired_template"],
        ),
        "message_template": settings.get(
            "message_template", DEFAULT_SETTINGS["message_template"]
        ),
        "templates": settings.get("templates") or {},
    }


@router.get("/welcome-template")
async def get_welcome_template(current_user: dict = Depends(get_current_user)):
    """Return only the global welcome template (for new members).

    Used by the Members page manual welcome button. Any authenticated staff
    member can read it — it contains no tokens or sensitive WhatsApp config.
    Per-branch overrides live on the branch document and are resolved client-side.
    """
    settings = await _get_settings()
    return {
        "welcome_template": settings.get(
            "welcome_template", DEFAULT_SETTINGS["welcome_template"]
        ),
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
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="غير مصرح: التصدير متاح للمدير فقط")
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
    expired_template = settings.get(
        "manual_reminder_expired_template",
        DEFAULT_SETTINGS["manual_reminder_expired_template"],
    )
    branch_templates = await _get_branch_templates()
    push_enabled = settings.get("push_enabled", True)
    portal_enabled = settings.get("portal_enabled", True)

    wa_status = await _get_wa_status()
    wa_connected = (
        wa_status.get("connected", False) or await _has_enabled_cloud_config()
    ) and not log_only

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

        # Reminders sent AFTER the end date use the past-tense "expired"
        # wording (الاشتراك انتهى بتاريخ...) instead of "قارب على الانتهاء".
        # Decided by the same (earliest) end date shown in the message.
        is_expired_reminder = days_calc < 0

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
                if is_expired_reminder:
                    member_template = _resolve_branch_template(
                        branch_templates, member.get("branch_id"), "manual_expired", expired_template
                    )
                else:
                    member_template = _resolve_branch_template(
                        branch_templates, member.get("branch_id"), "manual", template
                    )
                message = _render_template(
                    member_template,
                    name=name,
                    activity=activities_text,
                    days=days_calc,
                    end_date=end_date_fmt,
                    fee=fee_str,
                )
                branch_id = member.get("branch_id")
                ok = await _send_wa_message_for_branch(wa_phone, message, branch_id)
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
                    "branch_id": branch_id,
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
                push_title_tmpl_en = settings.get("push_title_template_en", DEFAULT_SETTINGS["push_title_template_en"])
                push_body_tmpl_en = settings.get("push_body_template_en", DEFAULT_SETTINGS["push_body_template_en"])
                title = _render_template(push_title_tmpl, name=name, activity=activities_text,
                                         days=days_calc, end_date=end_date_fmt, fee=fee_str)
                body = _render_template(push_body_tmpl, name=name, activity=activities_text,
                                        days=days_calc, end_date=end_date_fmt, fee=fee_str)
                # English variants used when the recipient's saved push
                # language is 'en'. Arabic remains the fallback otherwise.
                title_en = _render_template(push_title_tmpl_en, name=name, activity=activities_text,
                                            days=days_calc, end_date=end_date_fmt, fee=fee_str)
                body_en = _render_template(push_body_tmpl_en, name=name, activity=activities_text,
                                           days=days_calc, end_date=end_date_fmt, fee=fee_str)
                payload_obj = NotificationPayload(
                    title=title,
                    body=body,
                    title_en=title_en,
                    body_en=body_en,
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
                if is_expired_reminder:
                    msg_ar = f"اشتراكك في {activities_text} انتهى بتاريخ {end_date_raw}. نرجو التواصل معنا للتجديد."
                else:
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
