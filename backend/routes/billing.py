"""Per-tenant billing view (admin only).

Read-only summary of the tenant's current plan + trial / subscription state
that the admin sees inside Settings → Subscription & Billing. Real upgrade
flow (Stripe / Moyasar / Tap) is deferred to Phase 2; for now the UI shows
a "Contact sales" CTA.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException

from utils.tenant import get_current_tenant_slug, DEFAULT_TENANT_SLUG
from utils.auth import get_current_user
from control_db import control_db
from routes.public_signup import _load_plans

router = APIRouter(prefix="/billing", tags=["billing"])


def _days_remaining(end_at_iso):
    if not end_at_iso:
        return None
    try:
        end = datetime.fromisoformat(end_at_iso.replace("Z", "+00:00"))
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        delta = end - datetime.now(timezone.utc)
        return int(delta.total_seconds() // 86400)
    except Exception:
        return None


@router.get("")
async def get_billing(current_user: dict = Depends(get_current_user)):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")
    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    tenant = await control_db.tenants.find_one({"slug": slug}, {"_id": 0}) or {}
    plans = await _load_plans()
    plan_id = tenant.get("plan", "starter")
    current_plan = next((p for p in plans if p.get("id") == plan_id), None)
    end_at = tenant.get("subscription_end_at", "")
    days = _days_remaining(end_at)
    is_trial = (tenant.get("signup_source") == "public") and not tenant.get("renewal_history")
    return {
        "slug": slug,
        "name": tenant.get("name", ""),
        "status": tenant.get("status", ""),
        "plan": plan_id,
        "plan_id": plan_id,
        "plan_name_ar": (current_plan or {}).get("name_ar", plan_id),
        "plan_name_en": (current_plan or {}).get("name_en", plan_id),
        "current_plan": current_plan,
        "billing_cycle": tenant.get("billing_cycle", "monthly"),
        "subscription_start_at": tenant.get("subscription_start_at", ""),
        "subscription_end_at": end_at,
        "end_at": end_at,
        "days_remaining": days,
        "auto_suspend_on_expiry": bool(tenant.get("auto_suspend_on_expiry", True)),
        "is_trial": bool(is_trial),
        "trial_days": int(tenant.get("trial_days") or 0),
        "owner_email": tenant.get("owner_email", ""),
        "owner_phone": tenant.get("owner_phone", ""),
        "max_branches": tenant.get("max_branches", 0),
        "max_members": tenant.get("max_members", 0),
        "available_plans": plans,
    }
