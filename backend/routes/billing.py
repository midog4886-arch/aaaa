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
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr, Field

from utils.tenant import get_current_tenant_slug, DEFAULT_TENANT_SLUG
from utils.auth import get_current_user
from utils.email_service import send_email, list_email_log
from utils.payment_service import (
    DELIVERY_FAILURE_STREAK_THRESHOLD,
    SIGNATURE_FAILURE_ALERT_COOLDOWN_SECONDS,
    SIGNATURE_FAILURE_THRESHOLD,
    SIGNATURE_FAILURE_WINDOW_SECONDS,
    claim_event,
    confirm_event,
    extract_event_id,
    get_payment_settings,
    parse_failure_event,
    parse_success_event,
    record_signature_failure,
    record_webhook_event,
    release_event,
    reset_signature_failures,
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
        recipient = ((refreshed or {}).get("billing_email") or "").strip() \
            or ((refreshed or {}).get("owner_email") or "").strip()
        if recipient:
            email_result = await send_email(
                kind="payment_failed",
                to=recipient,
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


async def _alert_super_admin_signature_failures(
    *, provider: str, count: int, secret_env: str,
) -> None:
    """Email the super-admin when webhook signature failures cross the
    rolling-window threshold. No-op when ``SUPER_ADMIN_ALERT_EMAIL`` is unset
    so dev environments stay quiet.
    """
    recipient = (os.environ.get("SUPER_ADMIN_ALERT_EMAIL") or "").strip()
    if not recipient:
        logger.warning(
            "payment webhook: signature failures crossed threshold for %s "
            "(count=%s) but SUPER_ADMIN_ALERT_EMAIL is not set; skipping alert",
            provider, count,
        )
        return
    try:
        await send_email(
            kind="super_admin_signature_failures",
            to=recipient,
            tenant_slug=None,
            ctx={
                "provider": provider,
                "count": count,
                "threshold": SIGNATURE_FAILURE_THRESHOLD,
                "window_minutes": SIGNATURE_FAILURE_WINDOW_SECONDS // 60,
                "secret_env": secret_env,
            },
        )
    except Exception:
        logger.exception(
            "payment webhook: super-admin signature-failure alert email failed",
        )


async def _alert_super_admin_delivery_failures(
    *, provider: str, delivery: dict, secret_env: str,
) -> None:
    """Email the super-admin when consecutive webhook delivery failures
    cross the streak threshold. No-op when ``SUPER_ADMIN_ALERT_EMAIL`` is
    unset so dev environments stay quiet.
    """
    recipient = (os.environ.get("SUPER_ADMIN_ALERT_EMAIL") or "").strip()
    if not recipient:
        logger.warning(
            "payment webhook: delivery failures crossed streak threshold for "
            "%s (streak=%s) but SUPER_ADMIN_ALERT_EMAIL is not set; "
            "skipping alert", provider, delivery.get("streak"),
        )
        return
    try:
        await send_email(
            kind="super_admin_delivery_failures",
            to=recipient,
            tenant_slug=None,
            ctx={
                "provider": provider,
                "streak": int(delivery.get("streak") or 0),
                "threshold": DELIVERY_FAILURE_STREAK_THRESHOLD,
                "last_status": delivery.get("last_status") or "",
                "last_reason": delivery.get("last_reason") or "",
                "last_tenant_slug": delivery.get("last_tenant_slug") or "",
                "since": delivery.get("since") or "",
                "secret_env": secret_env,
            },
        )
    except Exception:
        logger.exception(
            "payment webhook: super-admin delivery-failure alert email failed",
        )


async def _maybe_alert_delivery(record_result, *, provider: str, secret_env: str) -> None:
    """Inspect a ``record_webhook_event`` return value and email the
    super-admin when the consecutive-failure streak just crossed the
    threshold. Tolerates a None / non-dict result so existing call sites
    that ignore the return value remain safe.
    """
    if not isinstance(record_result, dict):
        return
    delivery = record_result.get("delivery") or {}
    if delivery.get("should_alert"):
        await _alert_super_admin_delivery_failures(
            provider=provider, delivery=delivery, secret_env=secret_env,
        )


# Map a provider to the canonical name of its signature header. Stored on
# every webhook diagnostic row (name only — never the value) so a super-admin
# can confirm the provider is sending the header we expect.
_SIGNATURE_HEADER_BY_PROVIDER = {
    "stripe": "Stripe-Signature",
    "moyasar": "X-Moyasar-Signature",
    "tap": "Tap-Signature",
}


def _signature_header_name(provider: str) -> str:
    return _SIGNATURE_HEADER_BY_PROVIDER.get((provider or "").lower(), "X-Webhook-Signature")


async def _resolve_tenant(tenant_id: Optional[str], tenant_slug: Optional[str]) -> Optional[dict]:
    if tenant_id:
        doc = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
        if doc:
            return doc
    if tenant_slug:
        return await control_db.tenants.find_one({"slug": tenant_slug.lower()}, {"_id": 0})
    return None


_WEBHOOK_RATE_LIMIT = 240  # requests per IP per window
_WEBHOOK_RATE_WINDOW_SECONDS = 60
_WEBHOOK_RATE_SCOPE = "payment_webhook"


@router.post("/webhook/{provider}")
async def payment_webhook(provider: str, request: Request):
    """Receive a payment-provider webhook (Stripe / Moyasar / Tap).

    Auth is via the provider's own signature scheme (HMAC-SHA256 of the raw
    body using the secret in the env var configured at
    ``/super/payment/settings``). Tenant middleware is bypassed here in
    practice because the tenant is resolved from the event's ``metadata``
    rather than the request host.

    Per-IP rate-limited via the shared MongoDB limiter *before* signature
    verification so an attacker can't flood the endpoint with bogus
    signatures (each verify is HMAC-SHA256 + a write to ``webhook_events``).
    The cap is generous (240/min) so legitimate provider retries from a
    single source IP never trip it.
    """
    from utils.rate_limit import check_rate_limit
    client_ip = (request.client.host if request.client else "") or "unknown"
    if not await check_rate_limit(
        _WEBHOOK_RATE_SCOPE,
        client_ip,
        limit=_WEBHOOK_RATE_LIMIT,
        window_seconds=_WEBHOOK_RATE_WINDOW_SECONDS,
    ):
        raise HTTPException(status_code=429, detail="rate limit exceeded")
    settings = await get_payment_settings()
    cfg_provider = (settings.get("provider") or "").lower()
    incoming_provider = (provider or "").lower()
    sig_header_name = _signature_header_name(cfg_provider or incoming_provider)
    if not settings.get("enabled") or not cfg_provider:
        await record_webhook_event(
            provider=incoming_provider,
            status="provider_disabled",
            reason="payment provider not configured",
            signature_header=_signature_header_name(incoming_provider),
            http_status=503,
        )
        raise HTTPException(status_code=503, detail="payment provider not configured")
    if incoming_provider != cfg_provider:
        await record_webhook_event(
            provider=incoming_provider,
            status="provider_disabled",
            reason=f"provider '{incoming_provider}' not enabled (configured: {cfg_provider})",
            signature_header=_signature_header_name(incoming_provider),
            http_status=404,
        )
        raise HTTPException(status_code=404, detail="provider not enabled")

    secret_env = settings.get("secret_env") or "PAYMENT_WEBHOOK_SECRET"
    secret = os.environ.get(secret_env, "")
    if not secret:
        logger.error("payment webhook: secret env %s is empty", secret_env)
        await record_webhook_event(
            provider=cfg_provider,
            status="secret_missing",
            reason=f"env var {secret_env} is empty",
            signature_header=sig_header_name,
            http_status=503,
        )
        raise HTTPException(status_code=503, detail="webhook secret not set")

    body = await request.body()
    if not verify_signature(cfg_provider, body, request.headers.raw, secret):
        # Track repeated failures so a misconfigured/rotated secret surfaces
        # to the super-admin instead of silently 401'ing every retry.
        failure_state = await record_signature_failure(cfg_provider)
        # Try to keep a redacted snapshot even though the signature failed —
        # without it the super-admin has nothing to compare against the
        # provider dashboard. Body may not be valid JSON; in that case keep
        # only metadata (length / unparsed flag) so we never persist a raw
        # body that could contain card numbers or signing secrets. Even when
        # JSON parses, the snapshot helper still scrubs sensitive keys.
        try:
            invalid_sig_payload = await request.json()
        except Exception:
            invalid_sig_payload = {"_unparsed": True, "body_length": len(body or b"")}
        rec = await record_webhook_event(
            provider=cfg_provider,
            status="signature_invalid",
            reason=(
                f"HMAC signature verification failed "
                f"(count={failure_state.get('count', 0)})"
            ),
            payload=invalid_sig_payload,
            signature_header=sig_header_name,
            http_status=401,
        )
        if failure_state.get("should_alert"):
            await _alert_super_admin_signature_failures(
                provider=cfg_provider,
                count=int(failure_state.get("count") or 0),
                secret_env=secret_env,
            )
        await _maybe_alert_delivery(rec, provider=cfg_provider, secret_env=secret_env)
        raise HTTPException(status_code=401, detail="invalid signature")

    # Successful verification clears the rolling failure window so the next
    # burst of bad signatures starts from zero (and can alert again).
    await reset_signature_failures(cfg_provider)

    try:
        payload = await request.json()
    except Exception:
        await record_webhook_event(
            provider=cfg_provider,
            status="invalid_payload",
            reason="body is not valid JSON",
            payload={"_unparsed": True, "body_length": len(body or b"")},
            signature_header=sig_header_name,
            http_status=400,
        )
        raise HTTPException(status_code=400, detail="invalid json body")

    # Dedupe: providers (Stripe especially) retry the same event many times
    # until they receive a 2xx. Without this guard, every retry would append
    # another renewal_history row and re-send the customer email.
    #
    # Two-phase: claim first, do the work, then confirm. If the work raises
    # before confirmation, release the claim so the *next* provider retry
    # can reprocess — we never want to suppress retries for events whose
    # side effects didn't actually commit.
    event_id = extract_event_id(cfg_provider, payload)
    claim_state = "new"
    if event_id:
        claim_state = await claim_event(cfg_provider, event_id)
        if claim_state != "new":
            logger.info(
                "payment webhook: short-circuiting %s event id=%s (claim=%s)",
                cfg_provider, event_id, claim_state,
            )
            await record_webhook_event(
                provider=cfg_provider,
                status="duplicate",
                reason=f"already {claim_state}",
                event_id=event_id,
                payload=payload,
                signature_header=sig_header_name,
                http_status=200,
            )
            return {
                "status": "duplicate",
                "event_id": event_id,
                "claim": claim_state,
            }

    try:
        failure = parse_failure_event(cfg_provider, payload)
        if failure:
            tenant = await _resolve_tenant(failure.get("tenant_id"), failure.get("tenant_slug"))
            if not tenant:
                logger.warning("payment webhook: tenant not found for ref=%s", failure.get("provider_ref"))
                rec = await record_webhook_event(
                    provider=cfg_provider,
                    status="tenant_not_found",
                    reason=f"failure event ref={failure.get('provider_ref') or ''}",
                    tenant_id=failure.get("tenant_id"),
                    tenant_slug=failure.get("tenant_slug"),
                    event_id=event_id,
                    payload=payload,
                    signature_header=sig_header_name,
                    http_status=404,
                )
                await _maybe_alert_delivery(rec, provider=cfg_provider, secret_env=secret_env)
                raise HTTPException(status_code=404, detail="tenant not found in event metadata")
            result = await apply_payment_failure(
                tenant=tenant,
                reason=failure["reason"],
                amount=failure.get("amount"),
                currency=failure.get("currency") or "SAR",
                provider=cfg_provider,
                provider_ref=failure.get("provider_ref") or "",
            )
            if event_id:
                await confirm_event(cfg_provider, event_id)
            await record_webhook_event(
                provider=cfg_provider,
                status="recorded",
                reason=failure.get("reason") or "",
                tenant_id=(result.get("tenant") or {}).get("id"),
                tenant_slug=(result.get("tenant") or {}).get("slug"),
                event_id=event_id,
                payload=payload,
                signature_header=sig_header_name,
                http_status=200,
            )
            return {
                "status": "recorded",
                "tenant_slug": (result.get("tenant") or {}).get("slug"),
                "failure_id": (result.get("failure") or {}).get("id"),
                "email": result.get("email"),
            }

        success = parse_success_event(cfg_provider, payload)
        if success:
            tenant = await _resolve_tenant(success.get("tenant_id"), success.get("tenant_slug"))
            if not tenant:
                logger.warning("payment webhook: tenant not found for ref=%s", success.get("provider_ref"))
                rec = await record_webhook_event(
                    provider=cfg_provider,
                    status="tenant_not_found",
                    reason=f"success event ref={success.get('provider_ref') or ''}",
                    tenant_id=success.get("tenant_id"),
                    tenant_slug=success.get("tenant_slug"),
                    event_id=event_id,
                    payload=payload,
                    signature_header=sig_header_name,
                    http_status=404,
                )
                await _maybe_alert_delivery(rec, provider=cfg_provider, secret_env=secret_env)
                raise HTTPException(status_code=404, detail="tenant not found in event metadata")
            months = success.get("months") or 0
            days = success.get("days") or 0
            if not months and not days:
                cycle = (success.get("cycle") or tenant.get("billing_cycle") or "monthly").lower()
                if cycle == "yearly":
                    months = 12
                elif cycle == "quarterly":
                    months = 3
                else:
                    months = 1
            from routes.super_admin import apply_renewal
            try:
                result = await apply_renewal(
                    tenant=tenant,
                    months=int(months or 0),
                    days=int(days or 0),
                    amount=success.get("amount"),
                    currency=success.get("currency") or "SAR",
                    method=cfg_provider,
                    provider_ref=success.get("provider_ref") or "",
                    note="auto-renewed via payment webhook",
                )
            except ValueError as e:
                logger.error("payment webhook renewal rejected: %s", e)
                rec = await record_webhook_event(
                    provider=cfg_provider,
                    status="error",
                    reason=f"renewal rejected: {e}",
                    tenant_id=tenant.get("id"),
                    tenant_slug=tenant.get("slug"),
                    event_id=event_id,
                    payload=payload,
                    signature_header=sig_header_name,
                    http_status=400,
                )
                await _maybe_alert_delivery(rec, provider=cfg_provider, secret_env=secret_env)
                raise HTTPException(status_code=400, detail=str(e))
            if event_id:
                await confirm_event(cfg_provider, event_id)
            await record_webhook_event(
                provider=cfg_provider,
                status="renewed",
                reason=f"+{months}m/+{days}d",
                tenant_id=(result.get("tenant") or {}).get("id"),
                tenant_slug=(result.get("tenant") or {}).get("slug"),
                event_id=event_id,
                payload=payload,
                signature_header=sig_header_name,
                http_status=200,
            )
            return {
                "status": "renewed",
                "tenant_slug": (result.get("tenant") or {}).get("slug"),
                "renewal_id": (result.get("renewal") or {}).get("id"),
                "email": result.get("email"),
            }

        # Unrecognized event types are still "handled" (we deliberately
        # ignore them) — confirm the claim so retries don't keep re-claiming.
        if event_id:
            await confirm_event(cfg_provider, event_id)
        await record_webhook_event(
            provider=cfg_provider,
            status="ignored",
            reason=f"unrecognized event type: {(payload.get('type') or payload.get('event') or '')[:120]}",
            event_id=event_id,
            payload=payload,
            signature_header=sig_header_name,
            http_status=200,
        )
        return {"status": "ignored", "reason": "unrecognized event"}
    except HTTPException:
        # Tenant-not-found / renewal-rejected: release so the provider
        # retry can succeed once the tenant metadata is corrected.
        if event_id:
            await release_event(cfg_provider, event_id)
        raise
    except Exception as e:
        if event_id:
            await release_event(cfg_provider, event_id)
        rec = await record_webhook_event(
            provider=cfg_provider,
            status="error",
            reason=str(e)[:500],
            event_id=event_id,
            payload=payload,
            signature_header=sig_header_name,
            http_status=500,
        )
        await _maybe_alert_delivery(rec, provider=cfg_provider, secret_env=secret_env)
        raise


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


def _parse_iso_utc(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


_PAYMENT_FAILURE_BANNER_DAYS = 30


def _recent_payment_failure(tenant: dict) -> Optional[dict]:
    """Return failure info for the billing banner, or None.

    Shows only when ``last_payment_failure_at`` is within the last 30 days
    AND no successful renewal has landed at/after the failure (a successful
    renewal clears the warning).
    """
    failed_at = _parse_iso_utc(tenant.get("last_payment_failure_at"))
    if not failed_at:
        return None
    now = datetime.now(timezone.utc)
    if (now - failed_at) > timedelta(days=_PAYMENT_FAILURE_BANNER_DAYS):
        return None
    reason = ""
    for h in (tenant.get("renewal_history") or []):
        renewed = _parse_iso_utc(h.get("renewed_at") or h.get("date"))
        if not renewed or renewed < failed_at:
            continue
        if (h.get("status") or "paid") == "failed":
            # remember the most recent failure reason at/after the stamp
            reason = h.get("reason") or reason
            continue
        # successful renewal after the failure clears the banner
        return None
    return {
        "failed_at": tenant.get("last_payment_failure_at"),
        "reason": reason,
    }


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
        "billing_email": tenant.get("billing_email", ""),
        "pending_owner_email": tenant.get("pending_owner_email", ""),
        "pending_owner_email_expires_at": tenant.get("pending_owner_email_expires_at", ""),
        "pending_billing_email": tenant.get("pending_billing_email", ""),
        "pending_billing_email_expires_at": tenant.get("pending_billing_email_expires_at", ""),
        "owner_phone": tenant.get("owner_phone", ""),
        "max_branches": tenant.get("max_branches", 0),
        "max_members": tenant.get("max_members", 0),
        "available_plans": plans,
        "deletion_scheduled_at": tenant.get("deletion_scheduled_at", ""),
        "deletion_purge_at": tenant.get("deletion_purge_at", ""),
        "payment_failure": _recent_payment_failure(tenant),
    }


@router.post("/cancel-delete")
async def cancel_pending_deletion(current_user: dict = Depends(get_current_user)):
    """Self-service: let an academy admin cancel a pending deletion of
    their own tenant from inside the admin app, without needing the
    emailed cancel link or a super-admin. Reuses the same shared worker
    as the super-admin and email-link flows so audit + side effects stay
    consistent.
    """
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")
    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    tenant = await control_db.tenants.find_one({"slug": slug}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if tenant.get("status") != "pending_delete":
        raise HTTPException(status_code=400, detail="Tenant is not pending deletion")
    from routes.super_admin import _apply_cancel_tenant_delete
    actor = {
        "user_id": current_user.get("id") or current_user.get("user_id") or "",
        "username": current_user.get("username", ""),
        "is_admin": True,
    }
    refreshed = await _apply_cancel_tenant_delete(
        tenant["id"],
        actor=actor,
        source="tenant_admin",
    )
    return {"ok": True, "tenant": refreshed}


EMAIL_CONFIRM_TTL_HOURS = 24


def _confirm_url(request: Request, token: str) -> str:
    base = (os.environ.get("APP_BASE_URL") or "").strip().rstrip("/")
    if not base:
        # Fall back to the request's own origin so dev environments work.
        base = str(request.base_url).rstrip("/")
    return f"{base}/api/billing/confirm-email?token={token}"


async def _send_confirmation(
    *,
    request: Request,
    tenant: dict,
    role: str,  # "owner" or "billing"
    new_email: str,
) -> dict:
    """Persist a pending email + token on the tenant and email the link.

    Always overwrites any prior pending request for that role.
    """
    slug = tenant.get("slug", "")
    token = f"{role}-{secrets.token_urlsafe(32)}"
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=EMAIL_CONFIRM_TTL_HOURS)
    field_email = f"pending_{role}_email"
    field_token = f"pending_{role}_email_token"
    field_exp = f"pending_{role}_email_expires_at"
    field_req = f"pending_{role}_email_requested_at"
    field_notified = f"pending_{role}_email_expired_notified_at"
    await control_db.tenants.update_one(
        {"slug": slug},
        {"$set": {
            field_email: new_email,
            field_token: token,
            field_exp: expires_at.isoformat(),
            field_req: now.isoformat(),
        },
         "$unset": {field_notified: ""}},
    )
    try:
        result = await send_email(
            kind="email_confirmation",
            to=new_email,
            tenant_slug=slug,
            ctx={
                "academy_name": tenant.get("name", ""),
                "confirm_url": _confirm_url(request, token),
                "role": role,
                "expires_hours": EMAIL_CONFIRM_TTL_HOURS,
            },
        )
    except Exception as e:
        logger.exception("email_confirmation send failed for %s (%s)", slug, role)
        result = {"status": "failed", "error": str(e)}
    return {"sent": result, "expires_at": expires_at.isoformat()}


def _confirmation_html(title_ar: str, body_ar: str, title_en: str, body_en: str, ok: bool) -> str:
    color = "#16a34a" if ok else "#dc2626"
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{title_en}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:48px auto;padding:24px;text-align:center;color:#111;">
<h2 style="color:{color};">{title_en}</h2>
<p>{body_en}</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
<div dir="rtl">
<h2 style="color:{color};">{title_ar}</h2>
<p>{body_ar}</p>
</div>
</body></html>"""


class BillingContactUpdate(BaseModel):
    owner_email: EmailStr
    billing_email: Optional[str] = Field(default="", max_length=320)


@router.patch("/contact")
async def update_billing_contact(
    payload: BillingContactUpdate,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Request a change to the academy's notification + billing emails.

    Behaviour change (task #248): the new ``owner_email`` and any newly added
    ``billing_email`` are NOT applied immediately. They are stored as
    ``pending_{role}_email`` along with a single-use token, and a confirmation
    link is emailed to the new address. The active values only flip to the
    new address after the recipient clicks the link (see
    ``GET /billing/confirm-email``). This prevents typos from silently
    redirecting all transactional notifications away from the owner.

    Clearing ``billing_email`` (sending an empty string) is applied immediately
    since it only removes a delegated address — falling back to the already-
    confirmed owner address.
    """
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")

    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    tenant = await control_db.tenants.find_one({"slug": slug}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="tenant not found")

    new_owner = str(payload.owner_email).strip().lower()
    raw_billing = (payload.billing_email or "").strip().lower()
    if raw_billing:
        try:
            BillingContactUpdate(owner_email=raw_billing, billing_email="")
        except Exception:
            raise HTTPException(status_code=422, detail="billing_email غير صالح")
    new_billing = raw_billing

    prev_owner = (tenant.get("owner_email") or "").strip().lower()
    prev_billing = (tenant.get("billing_email") or "").strip().lower()
    owner_changed = new_owner != prev_owner
    billing_changed = new_billing != prev_billing

    set_fields = {"billing_contact_updated_at": datetime.now(timezone.utc).isoformat()}
    unset_fields: dict = {}

    # Clearing billing_email is applied immediately (no confirmation needed —
    # we're removing a delegated recipient, not adding one).
    if billing_changed and not new_billing:
        set_fields["billing_email"] = ""
        unset_fields.update({
            "pending_billing_email": "",
            "pending_billing_email_token": "",
            "pending_billing_email_expires_at": "",
            "pending_billing_email_requested_at": "",
            "pending_billing_email_expired_notified_at": "",
        })

    update_doc: dict = {"$set": set_fields}
    if unset_fields:
        update_doc["$unset"] = unset_fields
    await control_db.tenants.update_one({"slug": slug}, update_doc)

    refreshed = await control_db.tenants.find_one({"slug": slug}, {"_id": 0}) or tenant

    owner_confirmation = {"status": "skipped", "error": "owner_email unchanged"}
    billing_confirmation = {"status": "skipped", "error": "billing_email unchanged"}

    if owner_changed:
        result = await _send_confirmation(
            request=request, tenant=refreshed, role="owner", new_email=new_owner,
        )
        owner_confirmation = result["sent"]

    if billing_changed and new_billing:
        result = await _send_confirmation(
            request=request, tenant=refreshed, role="billing", new_email=new_billing,
        )
        billing_confirmation = result["sent"]

    refreshed = await control_db.tenants.find_one({"slug": slug}, {"_id": 0}) or refreshed
    if owner_changed or billing_changed:
        try:
            from utils.audit import log_audit
            tracked = (
                "owner_email", "billing_email",
                "pending_owner_email", "pending_billing_email",
            )
            await log_audit(
                actor=current_user,
                action="settings.billing_contact.update",
                entity_type="tenant",
                entity_id=refreshed.get("id", ""),
                entity_name=refreshed.get("name", ""),
                before={k: tenant.get(k) for k in tracked},
                after={k: refreshed.get(k) for k in tracked},
                extra={
                    "owner_email_changed": owner_changed,
                    "billing_email_changed": billing_changed,
                },
            )
        except Exception:
            pass
    return {
        "ok": True,
        "owner_email": refreshed.get("owner_email", ""),
        "billing_email": refreshed.get("billing_email", ""),
        "pending_owner_email": refreshed.get("pending_owner_email", ""),
        "pending_owner_email_expires_at": refreshed.get("pending_owner_email_expires_at", ""),
        "pending_billing_email": refreshed.get("pending_billing_email", ""),
        "pending_billing_email_expires_at": refreshed.get("pending_billing_email_expires_at", ""),
        "owner_email_changed": owner_changed,
        "billing_email_changed": billing_changed,
        "owner_confirmation_email": owner_confirmation,
        "billing_confirmation_email": billing_confirmation,
        # Back-compat key for older clients.
        "confirmation_email": owner_confirmation,
    }


class ResendConfirmationPayload(BaseModel):
    role: str = Field(default="owner")  # "owner" or "billing"


@router.post("/contact/resend")
async def resend_email_confirmation(
    payload: ResendConfirmationPayload,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Re-issue a confirmation link for an already-pending email change."""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")
    role = (payload.role or "owner").lower()
    if role not in {"owner", "billing"}:
        raise HTTPException(status_code=422, detail="role يجب أن يكون owner أو billing")

    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    tenant = await control_db.tenants.find_one({"slug": slug}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="tenant not found")

    pending = (tenant.get(f"pending_{role}_email") or "").strip()
    if not pending:
        raise HTTPException(status_code=404, detail="لا يوجد بريد قيد التأكيد")

    result = await _send_confirmation(
        request=request, tenant=tenant, role=role, new_email=pending,
    )
    return {
        "ok": True,
        "role": role,
        "pending_email": pending,
        "expires_at": result["expires_at"],
        "confirmation_email": result["sent"],
    }


@router.delete("/contact/pending")
async def cancel_pending_email_change(
    role: str = "owner",
    current_user: dict = Depends(get_current_user),
):
    """Cancel an in-flight email change so the field reverts to the confirmed value."""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")
    role = (role or "owner").lower()
    if role not in {"owner", "billing"}:
        raise HTTPException(status_code=422, detail="role يجب أن يكون owner أو billing")

    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    tenant = await control_db.tenants.find_one({"slug": slug}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="tenant not found")

    pending = (tenant.get(f"pending_{role}_email") or "").strip()
    if not pending:
        raise HTTPException(status_code=404, detail="لا يوجد بريد قيد التأكيد")

    unset_fields = {
        f"pending_{role}_email": "",
        f"pending_{role}_email_token": "",
        f"pending_{role}_email_expires_at": "",
        f"pending_{role}_email_requested_at": "",
        f"pending_{role}_email_expired_notified_at": "",
    }
    await control_db.tenants.update_one(
        {"id": tenant.get("id")},
        {"$unset": unset_fields},
    )
    return {"ok": True, "role": role, "cancelled_email": pending}


_CONFIRM_EMAIL_RATE_LIMIT = 20  # requests
_CONFIRM_EMAIL_RATE_WINDOW_SECONDS = 60
_CONFIRM_EMAIL_RATE_SCOPE = "confirm_email_public"


@router.get("/confirm-email", response_class=HTMLResponse)
async def confirm_email_change(token: str, request: Request):
    """Public endpoint hit from the confirmation email link.

    The token format is ``{role}-{random}`` so we know which role to apply
    without leaking the tenant slug in the URL. We look up the tenant by the
    token field directly, so possession of the token is the only proof
    required.

    Rate-limited per client IP via the shared MongoDB limiter so the cap
    holds across Gunicorn workers / replicas (an in-process counter would
    let an attacker brute-force tokens at N× the limit on multi-worker
    deploys).
    """
    from utils.rate_limit import check_rate_limit
    client_ip = (request.client.host if request.client else "") or "unknown"
    if not await check_rate_limit(
        _CONFIRM_EMAIL_RATE_SCOPE,
        client_ip,
        limit=_CONFIRM_EMAIL_RATE_LIMIT,
        window_seconds=_CONFIRM_EMAIL_RATE_WINDOW_SECONDS,
    ):
        return HTMLResponse(
            _confirmation_html(
                "محاولات كثيرة جداً",
                "تم تجاوز الحد المسموح به من المحاولات. يرجى المحاولة بعد قليل.",
                "Too many attempts",
                "You've exceeded the allowed number of attempts. Please try again shortly.",
                ok=False,
            ),
            status_code=429,
        )
    if not token or "-" not in token:
        return HTMLResponse(
            _confirmation_html(
                "رابط غير صالح", "الرابط غير مكتمل أو تم تعديله.",
                "Invalid link", "The confirmation link is malformed.", ok=False),
            status_code=400,
        )
    role = token.split("-", 1)[0]
    if role not in {"owner", "billing"}:
        return HTMLResponse(
            _confirmation_html(
                "رابط غير صالح", "نوع الرابط غير معروف.",
                "Invalid link", "Unknown link type.", ok=False),
            status_code=400,
        )

    field_token = f"pending_{role}_email_token"
    field_email = f"pending_{role}_email"
    field_exp = f"pending_{role}_email_expires_at"
    tenant = await control_db.tenants.find_one({field_token: token}, {"_id": 0})
    if not tenant:
        return HTMLResponse(
            _confirmation_html(
                "انتهى الرابط", "هذا الرابط مستخدم مسبقاً أو تم إلغاؤه.",
                "Link unavailable", "This link has already been used or was cancelled.",
                ok=False),
            status_code=410,
        )

    expires_at_iso = tenant.get(field_exp) or ""
    try:
        expires_at = datetime.fromisoformat(expires_at_iso.replace("Z", "+00:00"))
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        expired = datetime.now(timezone.utc) > expires_at
    except Exception:
        expired = True
    if expired:
        # Clear the stale token so a "Resend" produces a fresh one.
        await control_db.tenants.update_one(
            {"id": tenant.get("id")},
            {"$unset": {field_token: ""}},
        )
        return HTMLResponse(
            _confirmation_html(
                "انتهت صلاحية الرابط",
                "اطلب رابطاً جديداً من صفحة الفوترة في إعدادات الأكاديمية.",
                "Link expired",
                "Open the academy billing page and request a new confirmation link.",
                ok=False),
            status_code=410,
        )

    new_email = (tenant.get(field_email) or "").strip().lower()
    if not new_email:
        return HTMLResponse(
            _confirmation_html(
                "لا يوجد طلب", "لم يعد هناك بريد قيد التأكيد.",
                "Nothing to confirm", "There is no pending email change for this link.",
                ok=False),
            status_code=410,
        )

    set_fields = {
        f"{role}_email": new_email,
        f"{role}_email_confirmed_at": datetime.now(timezone.utc).isoformat(),
        "billing_contact_updated_at": datetime.now(timezone.utc).isoformat(),
    }
    unset_fields = {
        field_email: "",
        field_token: "",
        field_exp: "",
        f"pending_{role}_email_requested_at": "",
        f"pending_{role}_email_expired_notified_at": "",
    }
    await control_db.tenants.update_one(
        {"id": tenant.get("id")},
        {"$set": set_fields, "$unset": unset_fields},
    )

    role_ar = "بريد المالك" if role == "owner" else "بريد الفوترة"
    role_en = "owner email" if role == "owner" else "billing email"
    return HTMLResponse(
        _confirmation_html(
            "تم التأكيد",
            f"تم تحديث {role_ar} إلى <b>{new_email}</b> بنجاح. يمكنك إغلاق هذه الصفحة.",
            "Confirmed",
            f"Your {role_en} has been updated to <b>{new_email}</b>. You can close this tab.",
            ok=True),
    )


@router.get("/email-log")
async def get_billing_email_log(
    current_user: dict = Depends(get_current_user),
    status: str = "",
    kind: str = "",
    q: str = "",
    limit: int = 20,
):
    """Return recent transactional emails for the current academy.

    Scoped by ``tenant_slug`` so academy owners can see whether
    reminder/renewal/payment emails actually went out without needing
    super-admin access to the platform-wide log.

    Optional filters:
    - ``status``: restrict to ``sent`` / ``failed`` / ``skipped``
    - ``kind``: restrict to a single email kind (e.g. ``welcome``)
    - ``q``: case-insensitive substring search on the recipient address
    - ``limit``: number of rows to return (default 20, capped at 200)
    """
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")
    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    try:
        capped_limit = max(1, min(int(limit or 20), 200))
    except (TypeError, ValueError):
        capped_limit = 20
    rows = await list_email_log(
        limit=capped_limit,
        tenant_slug=slug,
        status=(status or "").strip(),
        kind=(kind or "").strip(),
        q=(q or "").strip(),
    )
    items = [
        {
            "id": r.get("id", ""),
            "kind": r.get("kind", ""),
            "to": r.get("to", ""),
            "subject": r.get("subject", ""),
            "status": r.get("status", ""),
            "error": r.get("error", ""),
            "sent_at": r.get("sent_at", ""),
        }
        for r in rows
    ]
    return {"items": items}


@router.post("/email-log/{log_id}/resend")
async def resend_email_log_entry(
    log_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Re-send a previously logged email (typically one that failed).

    Uses the persisted ``kind``, ``to`` and ``ctx`` so the rendered content
    matches the original attempt. Scoped to the current academy so admins
    can only resend entries that belong to their tenant.
    """
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")
    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    row = await control_db.email_log.find_one({"id": log_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="سجل البريد غير موجود")
    if (row.get("tenant_slug") or "") != slug:
        raise HTTPException(status_code=404, detail="سجل البريد غير موجود")
    kind = row.get("kind") or ""
    to = row.get("to") or ""
    if not kind or not to:
        raise HTTPException(status_code=400, detail="السجل لا يحتوي على بيانات كافية لإعادة الإرسال")
    ctx = row.get("ctx") or {}
    result = await send_email(kind=kind, to=to, tenant_slug=slug, ctx=ctx)
    return {"to": to, "kind": kind, "result": result}


@router.get("/payment-events")
async def list_payment_events(
    current_user: dict = Depends(get_current_user),
    limit: int = 20,
):
    """Return recent payment webhook events for the current academy.

    Scoped strictly to the current tenant by ``tenant_slug`` so academy admins
    can see whether their own renewal payments succeeded or failed — and why —
    without needing super-admin access or contacting support.

    Only safe display fields are returned (status, reason, amount, timestamp,
    provider). Payload snapshots, signature diagnostics, and other tenants'
    data are never exposed.
    """
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")
    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    try:
        capped_limit = max(1, min(int(limit or 20), 50))
    except (TypeError, ValueError):
        capped_limit = 20
    from utils.payment_service import _derive_outcome
    try:
        cursor = control_db.webhook_events.find(
            {"tenant_slug": slug},
            {"_id": 0, "status": 1, "reason": 1, "received_at": 1, "provider": 1},
        ).sort("received_at", -1).limit(capped_limit)
        rows = []
        async for r in cursor:
            recv = r.get("received_at")
            if isinstance(recv, datetime):
                recv = recv.isoformat()
            rows.append({
                "status": r.get("status", ""),
                "reason": r.get("reason", ""),
                "received_at": recv or "",
                "provider": r.get("provider", ""),
                "outcome": _derive_outcome(r.get("status", "")),
            })
    except Exception:
        logger.exception("list_payment_events failed for slug=%s", slug)
        rows = []
    return {"items": rows, "tenant_slug": slug}


@router.post("/email-log/test-welcome")
async def send_test_welcome_email(current_user: dict = Depends(get_current_user)):
    """Send a one-off welcome email to the academy owner address.

    Used from Settings → Billing as a quick reachability check: it goes through
    the same provider + template + log pipeline as production sends, so a
    success here proves the whole stack is wired correctly.
    """
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")
    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    tenant = await control_db.tenants.find_one({"slug": slug}, {"_id": 0}) or {}
    recipient = ((tenant.get("owner_email") or "").strip()
                 or (tenant.get("billing_email") or "").strip())
    if not recipient:
        raise HTTPException(status_code=400, detail="لا يوجد بريد إلكتروني محفوظ للأكاديمية")
    result = await send_email(
        kind="welcome",
        to=recipient,
        tenant_slug=slug,
        ctx={
            "academy_name": tenant.get("name", ""),
            "slug": slug,
            "trial_days": int(tenant.get("trial_days") or 0),
            "subscription_end_at": tenant.get("subscription_end_at", ""),
        },
    )
    return {"to": recipient, "result": result}
