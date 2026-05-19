import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from utils.tenant import get_current_tenant, get_current_tenant_slug, DEFAULT_TENANT_SLUG
from utils.auth import get_current_user
from middleware.tenant import _slug_from_host
from control_db import control_db
from database import db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenant", tags=["branding"])

MAX_TERMS_COUNT = 20
MAX_TERM_LENGTH = 300


def _sanitize_terms(value):
    if value is None:
        return None
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        if not isinstance(item, str):
            continue
        s = item.strip()
        if not s:
            continue
        if len(s) > MAX_TERM_LENGTH:
            s = s[:MAX_TERM_LENGTH]
        out.append(s)
        if len(out) >= MAX_TERMS_COUNT:
            break
    return out


def _read_terms(tenant, key):
    if not tenant:
        return []
    raw = tenant.get(key)
    if not isinstance(raw, list):
        return []
    out = []
    for x in raw:
        if not isinstance(x, str):
            continue
        s = x.strip()
        if not s:
            continue
        if len(s) > MAX_TERM_LENGTH:
            s = s[:MAX_TERM_LENGTH]
        out.append(s)
        if len(out) >= MAX_TERMS_COUNT:
            break
    return out


def _safe_logo(value):
    s = (value or "").strip()
    if not s.startswith("data:image/") or ";base64," not in s:
        return ""
    if len(s) > 800 * 1024:
        return ""
    return s


def _safe_color(value):
    pc = (value or "").strip().lower()
    if pc and not (len(pc) == 7 and pc[0] == "#" and all(c in "0123456789abcdef" for c in pc[1:])):
        return ""
    return pc


def _days_remaining(end_at_iso):
    if not end_at_iso:
        return None
    try:
        end = datetime.fromisoformat(end_at_iso.replace("Z", "+00:00"))
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        delta = end - now
        return int(delta.total_seconds() // 86400)
    except Exception:
        return None


@router.get("/features")
async def get_tenant_features(request: Request):
    host = request.headers.get("host", "")
    host_slug = _slug_from_host(host)
    tenant = None
    if host_slug:
        try:
            tenant = await control_db.tenants.find_one({"slug": host_slug}, {"_id": 0, "disabled_features": 1})
        except Exception:
            tenant = None
    if not tenant:
        tenant = get_current_tenant() or {}
    raw = tenant.get("disabled_features") if isinstance(tenant, dict) else None
    disabled = [str(x) for x in raw if isinstance(x, str)] if isinstance(raw, list) else []
    return {"disabled_features": disabled}


@router.get("/branding")
async def get_branding(request: Request):
    host = request.headers.get("host", "")
    host_slug = _slug_from_host(host)
    tenant = None
    if host_slug:
        try:
            tenant = await control_db.tenants.find_one({"slug": host_slug}, {"_id": 0})
        except Exception:
            tenant = None
    if not tenant:
        tenant = get_current_tenant() or {}
    end_at = tenant.get("subscription_end_at", "") if tenant else ""
    return {
        "name": tenant.get("name", "") if tenant else "",
        "slug": tenant.get("slug", "") if tenant else "",
        "logo_base64": _safe_logo(tenant.get("logo_base64", "") if tenant else ""),
        "primary_color": _safe_color(tenant.get("primary_color", "") if tenant else ""),
        "tax_number": (tenant.get("tax_number", "") if tenant else "") or "",
        "commercial_reg": (tenant.get("commercial_reg", "") if tenant else "") or "",
        "invoice_terms_ar": _read_terms(tenant, "invoice_terms_ar"),
        "invoice_terms_en": _read_terms(tenant, "invoice_terms_en"),
        "status": tenant.get("status", "") if tenant else "",
        "subscription_end_at": end_at,
        "days_remaining": _days_remaining(end_at),
        "auto_suspend_on_expiry": bool(tenant.get("auto_suspend_on_expiry", False)) if tenant else False,
    }


def _require_tenant_admin(current_user: dict):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")
    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    if slug == DEFAULT_TENANT_SLUG:
        raise HTTPException(status_code=400, detail="لا تتوفر هذه العملية للأكاديمية الافتراضية")
    return slug


class BrandingUpdate(BaseModel):
    name: Optional[str] = None
    logo_base64: Optional[str] = None
    primary_color: Optional[str] = None
    tax_number: Optional[str] = None
    commercial_reg: Optional[str] = None
    invoice_terms_ar: Optional[List[str]] = None
    invoice_terms_en: Optional[List[str]] = None


@router.patch("/branding")
async def update_branding(payload: BrandingUpdate, current_user: dict = Depends(get_current_user)):
    slug = _require_tenant_admin(current_user)
    update = {}
    if payload.name is not None:
        nm = payload.name.strip()
        if not nm or len(nm) > 120:
            raise HTTPException(status_code=400, detail="اسم الأكاديمية مطلوب (حتى 120 حرفاً)")
        update["name"] = nm
    if payload.logo_base64 is not None:
        if payload.logo_base64 == "":
            update["logo_base64"] = ""
        else:
            cleaned = _safe_logo(payload.logo_base64)
            if not cleaned:
                raise HTTPException(status_code=400, detail="صيغة الشعار غير مدعومة أو حجمه أكبر من المسموح")
            update["logo_base64"] = cleaned
    if payload.primary_color is not None:
        if payload.primary_color == "":
            update["primary_color"] = ""
        else:
            cleaned = _safe_color(payload.primary_color)
            if not cleaned:
                raise HTTPException(status_code=400, detail="صيغة اللون غير صحيحة (#RRGGBB)")
            update["primary_color"] = cleaned
    if payload.tax_number is not None:
        tn = (payload.tax_number or "").strip()
        if len(tn) > 50:
            raise HTTPException(status_code=400, detail="الرقم الضريبي طويل جداً (حتى 50 حرفاً)")
        update["tax_number"] = tn
    if payload.commercial_reg is not None:
        cr = (payload.commercial_reg or "").strip()
        if len(cr) > 50:
            raise HTTPException(status_code=400, detail="رقم السجل التجاري طويل جداً (حتى 50 حرفاً)")
        update["commercial_reg"] = cr
    if payload.invoice_terms_ar is not None:
        update["invoice_terms_ar"] = _sanitize_terms(payload.invoice_terms_ar) or []
    if payload.invoice_terms_en is not None:
        update["invoice_terms_en"] = _sanitize_terms(payload.invoice_terms_en) or []
    before = await control_db.tenants.find_one({"slug": slug}, {"_id": 0}) or {}
    if update:
        await control_db.tenants.update_one({"slug": slug}, {"$set": update})
    refreshed = await control_db.tenants.find_one({"slug": slug}, {"_id": 0}) or {}
    if update:
        try:
            from utils.audit import log_audit
            await log_audit(
                actor=current_user,
                action="settings.branding.update",
                entity_type="tenant",
                entity_id=refreshed.get("id", "") or before.get("id", ""),
                entity_name=refreshed.get("name", "") or before.get("name", ""),
                before={k: before.get(k) for k in update.keys()},
                after={k: refreshed.get(k) for k in update.keys()},
            )
        except Exception:
            pass
    return {
        "name": refreshed.get("name", ""),
        "logo_base64": _safe_logo(refreshed.get("logo_base64", "")),
        "primary_color": _safe_color(refreshed.get("primary_color", "")),
        "tax_number": refreshed.get("tax_number", "") or "",
        "commercial_reg": refreshed.get("commercial_reg", "") or "",
        "invoice_terms_ar": _read_terms(refreshed, "invoice_terms_ar"),
        "invoice_terms_en": _read_terms(refreshed, "invoice_terms_en"),
    }


@router.get("/onboarding-status")
async def onboarding_status(current_user: dict = Depends(get_current_user)):
    slug = _require_tenant_admin(current_user)
    tenant = await control_db.tenants.find_one({"slug": slug}, {"_id": 0}) or {}
    completed_at = tenant.get("onboarding_completed_at")
    return {
        "completed": bool(completed_at),
        "completed_at": completed_at,
        "tenant_name": tenant.get("name", ""),
        "plan": tenant.get("plan", ""),
        "logo_base64": _safe_logo(tenant.get("logo_base64", "")),
        "primary_color": _safe_color(tenant.get("primary_color", "")),
        "tax_number": tenant.get("tax_number", "") or "",
        "commercial_reg": tenant.get("commercial_reg", "") or "",
    }


@router.post("/onboarding-complete")
async def onboarding_complete(current_user: dict = Depends(get_current_user)):
    slug = _require_tenant_admin(current_user)
    now_iso = datetime.now(timezone.utc).isoformat()
    # Atomic claim: only the caller that flips onboarding_completed_at from
    # empty -> now gets a non-None result back. This guarantees the welcome
    # notification fires at most once per tenant even under concurrent calls.
    result = await control_db.tenants.find_one_and_update(
        {"slug": slug, "onboarding_completed_at": {"$in": [None, ""]}},
        {"$set": {"onboarding_completed_at": now_iso}},
        return_document=True,
    )
    if result:
        try:
            await _send_onboarding_welcome_notification(current_user, result.get("name", ""))
        except Exception:
            logger.exception("Failed to send onboarding welcome notification")
        try:
            from utils.audit import log_audit
            await log_audit(
                actor=current_user,
                action="settings.onboarding.complete",
                entity_type="tenant",
                entity_id=result.get("id", ""),
                entity_name=result.get("name", ""),
                before={"onboarding_completed_at": None},
                after={"onboarding_completed_at": now_iso},
            )
        except Exception:
            pass
        return {"completed": True, "completed_at": now_iso}
    tenant = await control_db.tenants.find_one({"slug": slug}, {"_id": 0}) or {}
    return {
        "completed": True,
        "completed_at": tenant.get("onboarding_completed_at") or now_iso,
    }


async def _send_onboarding_welcome_notification(current_user: dict, tenant_name: str) -> None:
    """Insert an in-app welcome notification for the academy admin and best-effort push.

    The notification suggests the next actions a freshly onboarded admin can
    take (add members, schedule activities, invite staff) with a deep link to
    the most important first step.
    """
    branch_id = current_user.get("branch_id")
    name_part = (tenant_name or "").strip()
    title_ar = f"أهلاً بك في {name_part}!" if name_part else "أهلاً بك في أكاديميتك!"
    title_en = f"Welcome to {name_part}!" if name_part else "Welcome to your academy!"
    message_ar = (
        "اكتمل إعداد أكاديميتك. الخطوات التالية المقترحة: "
        "1) إضافة أول الأعضاء، "
        "2) ضبط الأنشطة وجدول التدريب، "
        "3) دعوة الطاقم وإنشاء حسابات المستخدمين."
    )
    message_en = (
        "Your academy setup is complete. Suggested next steps: "
        "1) add your first members, "
        "2) configure activities and the training schedule, "
        "3) invite staff and create user accounts."
    )
    notification_id = str(uuid.uuid4())
    # Persist both languages so the bell can render in the admin's chosen
    # language (notifications are stored once and read by many UI sessions
    # which may have different language preferences). Legacy ``title``/
    # ``message`` keys are kept populated (Arabic) for backward compatibility
    # with any consumer that hasn't been updated yet.
    await db.notifications.insert_one({
        "id": notification_id,
        "title": title_ar,
        "message": message_ar,
        "title_ar": title_ar,
        "title_en": title_en,
        "message_ar": message_ar,
        "message_en": message_en,
        "type": "success",
        "link": "/admin/members",
        "branch_id": branch_id,
        "is_read": False,
        "tag": "onboarding_welcome",
        "actions": [
            {"label_ar": "إضافة أعضاء", "label_en": "Add members", "link": "/admin/members"},
            {"label_ar": "إعداد الأنشطة", "label_en": "Set up activities", "link": "/admin/activities"},
            {"label_ar": "دعوة المستخدمين", "label_en": "Invite users", "link": "/admin/users"},
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    # Best-effort push notification to the admin (reuses member push channel keyed by user id)
    try:
        from .push_notifications import send_push_notification, NotificationPayload
        payload = NotificationPayload(
            title=title_ar,
            body=message_ar,
            title_en=title_en,
            body_en=message_en,
            url="/admin/members",
            tag=f"onboarding-welcome-{notification_id}",
            data={"type": "onboarding_welcome"},
        )
        user_id = current_user.get("id") or current_user.get("user_id")
        if user_id:
            subs = await db.push_subscriptions.find(
                {"member_id": user_id, "is_active": True}, {"_id": 0}
            ).to_list(20)
            for sub in subs:
                try:
                    await send_push_notification(sub, payload)
                except Exception:
                    pass
    except Exception:
        pass


@router.post("/onboarding-reset")
async def onboarding_reset(current_user: dict = Depends(get_current_user)):
    slug = _require_tenant_admin(current_user)
    before = await control_db.tenants.find_one({"slug": slug}, {"_id": 0}) or {}
    await control_db.tenants.update_one(
        {"slug": slug}, {"$set": {"onboarding_completed_at": None}}
    )
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="settings.onboarding.reset",
            entity_type="tenant",
            entity_id=before.get("id", ""),
            entity_name=before.get("name", ""),
            before={"onboarding_completed_at": before.get("onboarding_completed_at")},
            after={"onboarding_completed_at": None},
        )
    except Exception:
        pass
    return {"completed": False}
