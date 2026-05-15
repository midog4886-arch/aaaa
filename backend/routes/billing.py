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
    claim_event,
    confirm_event,
    extract_event_id,
    get_payment_settings,
    parse_failure_event,
    parse_success_event,
    release_event,
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
                raise HTTPException(status_code=400, detail=str(e))
            if event_id:
                await confirm_event(cfg_provider, event_id)
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
        return {"status": "ignored", "reason": "unrecognized event"}
    except HTTPException:
        # Tenant-not-found / renewal-rejected: release so the provider
        # retry can succeed once the tenant metadata is corrected.
        if event_id:
            await release_event(cfg_provider, event_id)
        raise
    except Exception:
        if event_id:
            await release_event(cfg_provider, event_id)
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
    }


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
    await control_db.tenants.update_one(
        {"slug": slug},
        {"$set": {
            field_email: new_email,
            field_token: token,
            field_exp: expires_at.isoformat(),
            field_req: now.isoformat(),
        }},
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


@router.get("/confirm-email", response_class=HTMLResponse)
async def confirm_email_change(token: str):
    """Public endpoint hit from the confirmation email link.

    The token format is ``{role}-{random}`` so we know which role to apply
    without leaking the tenant slug in the URL. We look up the tenant by the
    token field directly, so possession of the token is the only proof
    required.
    """
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
async def get_billing_email_log(current_user: dict = Depends(get_current_user)):
    """Return the most recent transactional emails for the current academy.

    Limited to the last 20 entries scoped by ``tenant_slug`` so academy owners
    can see whether reminder/renewal/payment emails actually went out without
    needing super-admin access to the platform-wide log.
    """
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية مسؤول الأكاديمية مطلوبة")
    slug = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    rows = await list_email_log(limit=20, tenant_slug=slug)
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
