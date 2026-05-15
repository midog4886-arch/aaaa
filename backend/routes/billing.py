"""Per-tenant billing view (admin only) + payment-provider webhook.

Read-only summary of the tenant's current plan + trial / subscription state
that the admin sees inside Settings → Subscription & Billing.

Phase 2: when a payment provider (Stripe / Moyasar / Tap) is connected via
``/super/payment/settings``, it pushes events to ``POST /api/billing/webhook/
{provider}``. Failure events are signature-verified, recorded in
``tenant.renewal_history`` with status='failed', and trigger the
``payment_failed`` transactional email — without requiring any super-admin
JWT.
"""
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from utils.tenant import get_current_tenant_slug, DEFAULT_TENANT_SLUG
from utils.auth import get_current_user
from utils.email_service import send_email
from utils.payment_service import (
    get_payment_settings,
    parse_failure_event,
    verify_signature,
)
from control_db import control_db
from routes.public_signup import _load_plans

logger = logging.getLogger("billing")

router = APIRouter(prefix="/billing", tags=["billing"])


async def apply_payment_failure(
    *,
    tenant: dict,
    reason: str,
    amount: Optional[float],
    currency: str,
    provider: str,
    provider_ref: str,
) -> dict:
    """Record a failed renewal payment + fire the ``payment_failed`` email.

    Shared by the manual super-admin endpoint and the provider webhook.
    Returns ``{"tenant", "failure", "email"}``.
    """
    if not tenant or not tenant.get("id"):
        raise ValueError("tenant with id is required")
    now = datetime.now(timezone.utc)
    history_entry = {
        "id": f"fail-{uuid.uuid4()}",
        "renewed_at": now.isoformat(),
        "status": "failed",
        "reason": (reason or "").strip()[:500] or "unknown",
        "amount": amount,
        "currency": (currency or "SAR").upper(),
        "method": (provider or "manual").lower(),
        "provider_ref": (provider_ref or "").strip()[:200],
    }
    await control_db.tenants.update_one(
        {"id": tenant["id"]},
        {"$set": {"last_payment_failure_at": now.isoformat()},
         "$push": {"renewal_history": history_entry}},
    )
    refreshed = await control_db.tenants.find_one({"id": tenant["id"]}, {"_id": 0}) or tenant

    email_result = {"status": "skipped", "error": "no owner_email"}
    try:
        owner_email = (refreshed or {}).get("owner_email") or ""
        if owner_email:
            email_result = await send_email(
                kind="payment_failed",
                to=owner_email,
                tenant_slug=(refreshed or {}).get("slug"),
                ctx={
                    "academy_name": (refreshed or {}).get("name", ""),
                    "reason": history_entry["reason"],
                    "amount": amount,
                    "currency": history_entry["currency"],
                },
            )
    except Exception as e:
        logger.exception("payment_failed email failed for %s", (refreshed or {}).get("slug"))
        email_result = {"status": "failed", "error": str(e)}

    return {"tenant": refreshed, "failure": history_entry, "email": email_result}


async def _resolve_tenant(tenant_id: Optional[str], tenant_slug: Optional[str]) -> Optional[dict]:
    if tenant_id:
        doc = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
        if doc:
            return doc
    if tenant_slug:
        return await control_db.tenants.find_one({"slug": tenant_slug.lower()}, {"_id": 0})
    return None


@router.post("/webhook/{provider}")
async def payment_webhook(provider: str, request: Request):
    """Receive a payment-provider webhook (Stripe / Moyasar / Tap).

    Auth is via the provider's own signature scheme (HMAC-SHA256 of the raw
    body using the secret in the env var configured at
    ``/super/payment/settings``). Tenant middleware is bypassed here in
    practice because the tenant is resolved from the event's ``metadata``
    rather than the request host.
    """
    settings = await get_payment_settings()
    cfg_provider = (settings.get("provider") or "").lower()
    if not settings.get("enabled") or not cfg_provider:
        raise HTTPException(status_code=503, detail="payment provider not configured")
    if (provider or "").lower() != cfg_provider:
        raise HTTPException(status_code=404, detail="provider not enabled")

    secret_env = settings.get("secret_env") or "PAYMENT_WEBHOOK_SECRET"
    secret = os.environ.get(secret_env, "")
    if not secret:
        logger.error("payment webhook: secret env %s is empty", secret_env)
        raise HTTPException(status_code=503, detail="webhook secret not set")

    body = await request.body()
    if not verify_signature(cfg_provider, body, request.headers.raw, secret):
        raise HTTPException(status_code=401, detail="invalid signature")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json body")

    failure = parse_failure_event(cfg_provider, payload)
    if not failure:
        # Non-failure events (e.g. payment_succeeded) are accepted but ignored
        # here; success-side handling is owned by ``renew_tenant``.
        return {"status": "ignored", "reason": "not a failure event"}

    tenant = await _resolve_tenant(failure.get("tenant_id"), failure.get("tenant_slug"))
    if not tenant:
        logger.warning("payment webhook: tenant not found for ref=%s", failure.get("provider_ref"))
        raise HTTPException(status_code=404, detail="tenant not found in event metadata")

    result = await apply_payment_failure(
        tenant=tenant,
        reason=failure["reason"],
        amount=failure.get("amount"),
        currency=failure.get("currency") or "SAR",
        provider=cfg_provider,
        provider_ref=failure.get("provider_ref") or "",
    )
    return {
        "status": "recorded",
        "tenant_slug": (result.get("tenant") or {}).get("slug"),
        "failure_id": (result.get("failure") or {}).get("id"),
        "email": result.get("email"),
    }


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
