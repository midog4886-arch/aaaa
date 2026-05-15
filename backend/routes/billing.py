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


def _build_invoices(tenant: dict, plans: list) -> list:
    history = tenant.get("renewal_history") or []
    fallback_plan_id = tenant.get("plan", "starter")
    fallback_cycle = tenant.get("billing_cycle", "monthly")
    plans_by_id = {p.get("id"): p for p in plans if p.get("id")}
    items = []
    for idx, h in enumerate(history):
        rec_plan_id = h.get("plan_id") or fallback_plan_id
        rec_cycle = h.get("cycle") or fallback_cycle
        rec_plan = plans_by_id.get(rec_plan_id) or {}
        amount = h.get("amount")
        if amount is None:
            amount = rec_plan.get("price_yearly") if rec_cycle == "yearly" else rec_plan.get("price_monthly")
        items.append({
            "id": h.get("id") or f"renewal-{idx + 1}",
            "issued_at": h.get("renewed_at") or h.get("date") or "",
            "period_start": h.get("period_start", ""),
            "period_end": h.get("period_end", ""),
            "plan_id": rec_plan_id,
            "plan_name_ar": h.get("plan_name_ar") or rec_plan.get("name_ar", rec_plan_id),
            "plan_name_en": h.get("plan_name_en") or rec_plan.get("name_en", rec_plan_id),
            "cycle": rec_cycle,
            "amount": amount,
            "currency": "SAR",
            "status": h.get("status", "paid"),
            "method": h.get("method", "manual"),
        })
    items.sort(key=lambda x: x.get("issued_at") or "", reverse=True)
    return items


@router.get("/invoices")
async def list_invoices(current_user: dict = Depends(get_current_user)):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")
    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    tenant = await control_db.tenants.find_one({"slug": slug}, {"_id": 0}) or {}
    plans = await _load_plans()
    return {"items": _build_invoices(tenant, plans)}


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
