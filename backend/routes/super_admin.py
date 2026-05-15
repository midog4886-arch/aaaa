"""Super-Admin routes — control plane for managing tenants (academies).

Lives outside the tenant middleware (paths under ``/super`` are bypassed by
``TenantMiddleware``). Authenticates via env-var credentials and a JWT with
``scope: "super"``. Operates on ``control_db`` directly.
"""
import os
import uuid
import secrets
import string
import logging
from datetime import datetime, timezone, timedelta
import base64
import re
from typing import Optional, List

import jwt
from fastapi import APIRouter, HTTPException, Depends, Body
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from database import JWT_SECRET, JWT_ALGORITHM, _raw_client
from control_db import control_db, auto_suspend_expired, send_trial_ending_emails, DEFAULT_TRIAL_DAYS, DEFAULT_BILLING_CYCLE
from utils.email_service import (
    get_email_settings,
    update_email_settings,
    list_email_log,
    send_email,
)
from utils.payment_service import (
    get_payment_settings,
    update_payment_settings,
)
from utils.tenant import slug_to_db_name, DEFAULT_TENANT_SLUG
from utils.auth import hash_password

logger = logging.getLogger("super_admin")

router = APIRouter(prefix="/super", tags=["super-admin"])
security = HTTPBearer(auto_error=False)

SUPER_ADMIN_USER = os.environ.get("SUPER_ADMIN_USER", "")
SUPER_ADMIN_PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "")
SUPER_TOKEN_HOURS = 24 * 30


def _require_super(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("scope") != "super":
        raise HTTPException(status_code=403, detail="Super-admin scope required")
    return payload


class LoginIn(BaseModel):
    username: str
    password: str


class TenantCreate(BaseModel):
    slug: str = Field(..., min_length=2, max_length=40, pattern=r"^[a-z0-9_]+$")
    name: str
    plan: Optional[str] = "starter"
    max_branches: Optional[int] = 1
    max_members: Optional[int] = 100
    features: Optional[List[str]] = []
    owner_email: Optional[str] = ""
    admin_username: Optional[str] = "admin"
    admin_password: Optional[str] = ""
    branch_name: Optional[str] = "الفرع الرئيسي"
    billing_cycle: Optional[str] = None
    trial_days: Optional[int] = None
    auto_suspend_on_expiry: Optional[bool] = True


class TenantRenew(BaseModel):
    months: Optional[int] = None
    days: Optional[int] = None
    extend_from: Optional[str] = "current_end"
    note: Optional[str] = ""
    amount: Optional[float] = None
    currency: Optional[str] = "SAR"
    method: Optional[str] = "manual"


class TenantPaymentFailure(BaseModel):
    reason: str = Field(..., min_length=1, max_length=500)
    amount: Optional[float] = None
    currency: Optional[str] = "SAR"
    provider: Optional[str] = ""
    provider_ref: Optional[str] = ""


VALID_BILLING_CYCLES = {"monthly", "quarterly", "yearly"}
MAX_RENEWAL_MONTHS = 120
MAX_RENEWAL_DAYS = 3650


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _expiry_info(tenant: dict) -> dict:
    end = _parse_iso(tenant.get("subscription_end_at"))
    if not end:
        return {"days_until_expiry": None, "expiry_state": "unknown", "subscription_end_at": None}
    delta = end - datetime.now(timezone.utc)
    days = int(delta.total_seconds() // 86400)
    if days < 0:
        state = "expired"
    elif days <= 7:
        state = "expiring_soon"
    elif days <= 30:
        state = "expiring_month"
    else:
        state = "active"
    return {
        "days_until_expiry": days,
        "expiry_state": state,
        "subscription_end_at": tenant.get("subscription_end_at"),
        "subscription_start_at": tenant.get("subscription_start_at"),
        "billing_cycle": tenant.get("billing_cycle"),
        "auto_suspend_on_expiry": bool(tenant.get("auto_suspend_on_expiry", True)),
    }


def _generate_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def _seed_new_tenant_db(
    db_name: str,
    tenant_name: str,
    admin_username: str,
    admin_password: str,
    branch_name: str,
) -> dict:
    tdb = _raw_client[db_name]
    now = datetime.now(timezone.utc).isoformat()
    seeded = {"branch": False, "user": False, "loyalty": False}

    existing_branch_count = await tdb.branches.count_documents({})
    if existing_branch_count == 0:
        branch_doc = {
            "id": str(uuid.uuid4()),
            "name": branch_name,
            "name_ar": branch_name,
            "phone": "",
            "manager_name": "",
            "manager_name_ar": "",
            "address": "",
            "address_ar": "",
            "is_active": True,
            "created_at": now,
        }
        await tdb.branches.insert_one(branch_doc)
        seeded["branch"] = True
        branch_id = branch_doc["id"]
    else:
        first = await tdb.branches.find_one({}, {"_id": 0, "id": 1})
        branch_id = (first or {}).get("id")

    existing_user = await tdb.users.find_one({"username": admin_username}, {"_id": 0})
    if not existing_user:
        user_doc = {
            "id": str(uuid.uuid4()),
            "username": admin_username,
            "password": hash_password(admin_password),
            "name": f"مدير {tenant_name}",
            "branch_id": branch_id,
            "is_admin": True,
            "created_at": now,
        }
        await tdb.users.insert_one(user_doc)
        seeded["user"] = True

    loyalty_existing = await tdb.loyalty_settings.find_one({"type": "points"}, {"_id": 0})
    if not loyalty_existing:
        await tdb.loyalty_settings.insert_one({
            "type": "points",
            "points_per_invoice": 1,
            "points_per_attendance": 1,
            "points_per_referral": 10,
            "created_at": now,
        })
        seeded["loyalty"] = True

    return seeded


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    plan: Optional[str] = None
    max_branches: Optional[int] = None
    max_members: Optional[int] = None
    features: Optional[List[str]] = None
    owner_email: Optional[str] = None
    status: Optional[str] = None
    billing_cycle: Optional[str] = None
    subscription_end_at: Optional[str] = None
    auto_suspend_on_expiry: Optional[bool] = None
    logo_base64: Optional[str] = None
    primary_color: Optional[str] = None


MAX_LOGO_DECODED_BYTES = 500 * 1024
ALLOWED_LOGO_MIME = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"}
_LOGO_DATAURI_RE = re.compile(r"^data:(image/(?:png|jpeg|jpg|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$")


def _validate_logo_base64(value):
    if value is None:
        return None
    raw = (value or "").strip()
    if raw == "":
        return ""
    m = _LOGO_DATAURI_RE.match(raw)
    if not m:
        raise HTTPException(status_code=400, detail="logo_base64 must be a base64 data URI for PNG/JPEG/WebP/SVG")
    mime, b64 = m.group(1).lower(), m.group(2)
    if mime not in ALLOWED_LOGO_MIME:
        raise HTTPException(status_code=400, detail="Unsupported logo image type")
    try:
        decoded = base64.b64decode(b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="logo_base64 is not valid base64")
    if len(decoded) > MAX_LOGO_DECODED_BYTES:
        raise HTTPException(status_code=400, detail=f"Logo size exceeds limit ({MAX_LOGO_DECODED_BYTES // 1024}KB)")
    if len(decoded) < 32:
        raise HTTPException(status_code=400, detail="Logo image is too small")
    cleaned_b64 = "".join(b64.split())
    return f"data:{mime};base64,{cleaned_b64}"

_HEX_COLOR_RE = re.compile(r"^#([0-9a-fA-F]{6})$")


def _validate_primary_color(value):
    if value is None:
        return None
    raw = (value or "").strip()
    if raw == "":
        return ""
    if not _HEX_COLOR_RE.match(raw):
        raise HTTPException(status_code=400, detail="primary_color must be a hex like #f97316")
    return raw.lower()



@router.post("/login")
async def super_login(payload: LoginIn):
    if not SUPER_ADMIN_USER or not SUPER_ADMIN_PASSWORD:
        raise HTTPException(status_code=503, detail="Super-admin credentials not configured")
    if payload.username != SUPER_ADMIN_USER or payload.password != SUPER_ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = jwt.encode(
        {
            "scope": "super",
            "sub": payload.username,
            "exp": datetime.now(timezone.utc) + timedelta(hours=SUPER_TOKEN_HOURS),
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    return {"token": token, "username": payload.username}


@router.get("/me")
async def super_me(_=Depends(_require_super)):
    return {"ok": True}


@router.get("/tenants")
async def list_tenants(_=Depends(_require_super)):
    rows = await control_db.tenants.find({}, {"_id": 0}).to_list(1000)
    rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return rows


@router.post("/tenants")
async def create_tenant(payload: TenantCreate, _=Depends(_require_super)):
    slug = payload.slug.lower()
    if slug == DEFAULT_TENANT_SLUG:
        raise HTTPException(status_code=400, detail="Slug 'default' is reserved")
    existing = await control_db.tenants.find_one({"slug": slug}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Tenant slug already exists")
    cycle = (payload.billing_cycle or DEFAULT_BILLING_CYCLE).lower()
    if cycle not in VALID_BILLING_CYCLES:
        raise HTTPException(status_code=400, detail=f"Invalid billing_cycle (allowed: {sorted(VALID_BILLING_CYCLES)})")
    now = datetime.now(timezone.utc)
    trial_days = int(payload.trial_days) if payload.trial_days is not None else DEFAULT_TRIAL_DAYS
    if trial_days < 1 or trial_days > MAX_RENEWAL_DAYS:
        raise HTTPException(status_code=400, detail="trial_days must be between 1 and 3650")
    end_at = now + timedelta(days=trial_days)
    max_branches = int(payload.max_branches) if payload.max_branches is not None else 1
    max_members = int(payload.max_members) if payload.max_members is not None else 100
    if max_branches < 0 or max_members < 0:
        raise HTTPException(status_code=400, detail="Limits must be >= 0")
    doc = {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "name": payload.name,
        "db_name": slug_to_db_name(slug),
        "status": "active",
        "plan": payload.plan or "starter",
        "max_branches": max_branches,
        "max_members": max_members,
        "features": payload.features or [],
        "owner_email": payload.owner_email or "",
        "created_at": now.isoformat(),
        "billing_cycle": cycle,
        "subscription_start_at": now.isoformat(),
        "subscription_end_at": end_at.isoformat(),
        "auto_suspend_on_expiry": bool(payload.auto_suspend_on_expiry if payload.auto_suspend_on_expiry is not None else True),
        "renewal_history": [],
        "onboarding_completed_at": None,
    }
    await control_db.tenants.insert_one(doc)

    admin_username = (payload.admin_username or "admin").strip() or "admin"
    provided_password = (payload.admin_password or "").strip()
    generated_password = "" if provided_password else _generate_password()
    admin_password = provided_password or generated_password
    branch_name = (payload.branch_name or "الفرع الرئيسي").strip() or "الفرع الرئيسي"

    seed_result: dict = {}
    seed_error: str = ""
    try:
        seed_result = await _seed_new_tenant_db(
            db_name=doc["db_name"],
            tenant_name=doc["name"],
            admin_username=admin_username,
            admin_password=admin_password,
            branch_name=branch_name,
        )
    except Exception as e:
        seed_error = str(e)
        logger.exception("Failed to seed tenant %s", slug)

    response = {k: v for k, v in doc.items() if k != "_id"}
    response["seed"] = {
        "ok": not seed_error,
        "error": seed_error or None,
        "created": seed_result,
        "admin_username": admin_username,
        "admin_password": generated_password or None,
    }
    return response


@router.patch("/tenants/{tenant_id}")
async def update_tenant(tenant_id: str, payload: TenantUpdate, _=Depends(_require_super)):
    existing = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tenant not found")
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        return existing
    if "status" in update and update["status"] not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="Invalid status")
    if "billing_cycle" in update:
        cyc = str(update["billing_cycle"]).lower()
        if cyc not in VALID_BILLING_CYCLES:
            raise HTTPException(status_code=400, detail=f"Invalid billing_cycle (allowed: {sorted(VALID_BILLING_CYCLES)})")
        update["billing_cycle"] = cyc
    if "subscription_end_at" in update:
        parsed = _parse_iso(update["subscription_end_at"])
        if not parsed:
            raise HTTPException(status_code=400, detail="Invalid subscription_end_at (must be ISO 8601 datetime)")
        update["subscription_end_at"] = parsed.isoformat()
    if "max_branches" in update and int(update["max_branches"]) < 0:
        raise HTTPException(status_code=400, detail="max_branches must be >= 0")
    if "max_members" in update and int(update["max_members"]) < 0:
        raise HTTPException(status_code=400, detail="max_members must be >= 0")
    if "logo_base64" in update:
        update["logo_base64"] = _validate_logo_base64(update["logo_base64"])
    if "primary_color" in update:
        update["primary_color"] = _validate_primary_color(update["primary_color"])
    await control_db.tenants.update_one({"id": tenant_id}, {"$set": update})
    refreshed = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})

    # Email on manual suspended (only when status actually flipped active→suspended).
    try:
        if (
            update.get("status") == "suspended"
            and existing.get("status") != "suspended"
            and (refreshed or {}).get("owner_email")
        ):
            await send_email(
                kind="suspended",
                to=refreshed["owner_email"],
                tenant_slug=refreshed.get("slug"),
                ctx={"academy_name": refreshed.get("name", ""), "reason": "manual"},
            )
    except Exception:
        logger.exception("manual-suspended email failed for %s", (refreshed or {}).get("slug"))

    return refreshed


async def apply_renewal(
    *,
    tenant: dict,
    months: int = 0,
    days: int = 0,
    extend_from: str = "current_end",
    amount: Optional[float] = None,
    currency: str = "SAR",
    method: str = "manual",
    provider_ref: str = "",
    note: str = "",
) -> dict:
    """Extend a tenant's subscription, log a paid renewal, and email the owner.

    Shared by the manual super-admin endpoint (``POST /super/tenants/{id}/renew``)
    and the payment-provider webhook (``POST /api/billing/webhook/{provider}``)
    so both code paths produce identical state and notifications.

    Returns ``{"tenant", "renewal", "email"}``. Raises ``ValueError`` for
    invalid inputs (the caller maps these to HTTP 400).
    """
    if not tenant or not tenant.get("id"):
        raise ValueError("tenant with id is required")
    months = int(months or 0)
    days = int(days or 0)
    if months < 0 or days < 0:
        raise ValueError("months/days must be non-negative")
    if months <= 0 and days <= 0:
        raise ValueError("Provide months or days to extend")
    if months > MAX_RENEWAL_MONTHS or days > MAX_RENEWAL_DAYS:
        raise ValueError(f"Renewal too large (max {MAX_RENEWAL_MONTHS} months / {MAX_RENEWAL_DAYS} days)")
    add_days = months * 30 + days
    now = datetime.now(timezone.utc)
    base = now
    if (extend_from or "current_end") == "current_end":
        cur_end = _parse_iso(tenant.get("subscription_end_at"))
        if cur_end and cur_end > now:
            base = cur_end
    new_end = base + timedelta(days=add_days)
    amount_val = float(amount) if amount is not None else None
    currency_val = (currency or "SAR").upper()
    method_val = (method or "manual").lower()
    history_entry = {
        "id": f"renew-{uuid.uuid4()}",
        "renewed_at": now.isoformat(),
        "previous_end": tenant.get("subscription_end_at"),
        "new_end": new_end.isoformat(),
        "months": months,
        "days": days,
        "note": (note or "").strip()[:500],
        "status": "paid",
        "amount": amount_val,
        "currency": currency_val,
        "method": method_val,
        "provider_ref": (provider_ref or "").strip()[:200],
    }
    set_ops = {
        "subscription_end_at": new_end.isoformat(),
        "last_renewed_at": now.isoformat(),
    }
    if tenant.get("status") == "suspended" and tenant.get("suspended_reason") == "expired":
        set_ops["status"] = "active"
        set_ops["suspended_at"] = None
        set_ops["suspended_reason"] = None
    await control_db.tenants.update_one(
        {"id": tenant["id"]},
        {"$set": set_ops,
         "$push": {"renewal_history": history_entry},
         "$unset": {"trial_emails_sent": ""}},
    )
    refreshed = await control_db.tenants.find_one({"id": tenant["id"]}, {"_id": 0}) or tenant

    email_result = {"status": "skipped", "error": "no owner_email"}
    try:
        owner_email = ((refreshed or {}).get("billing_email") or "").strip() \
            or ((refreshed or {}).get("owner_email") or "").strip()
        if owner_email:
            email_result = await send_email(
                kind="payment_success",
                to=owner_email,
                tenant_slug=(refreshed or {}).get("slug"),
                ctx={
                    "academy_name": (refreshed or {}).get("name", ""),
                    "amount": amount_val if amount_val is not None else "—",
                    "currency": currency_val,
                    "subscription_end_at": (refreshed or {}).get("subscription_end_at", ""),
                    "months": months,
                    "days": days,
                },
            )
    except Exception as e:
        logger.exception("payment_success email failed for %s", (refreshed or {}).get("slug"))
        email_result = {"status": "failed", "error": str(e)}

    return {"tenant": refreshed, "renewal": history_entry, "email": email_result}


@router.post("/tenants/{tenant_id}/renew")
async def renew_tenant(tenant_id: str, payload: TenantRenew, _=Depends(_require_super)):
    existing = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tenant not found")
    try:
        result = await apply_renewal(
            tenant=existing,
            months=int(payload.months or 0),
            days=int(payload.days or 0),
            extend_from=payload.extend_from or "current_end",
            amount=payload.amount,
            currency=payload.currency or "SAR",
            method=payload.method or "manual",
            note=payload.note or "",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"tenant": result["tenant"], "renewal": result["renewal"]}


@router.post("/tenants/{tenant_id}/payment-failure")
async def record_payment_failure(
    tenant_id: str,
    payload: TenantPaymentFailure,
    _=Depends(_require_super),
):
    """Record a failed renewal payment attempt and email the tenant.

    Called either by a payment-provider webhook (Phase 2) or manually by a
    super-admin when a charge bounces. Appends a status='failed' entry to
    ``renewal_history`` so failures are auditable alongside successes, then
    fires the ``payment_failed`` email.
    """
    existing = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tenant not found")
    from routes.billing import apply_payment_failure
    return await apply_payment_failure(
        tenant=existing,
        reason=payload.reason or "",
        amount=payload.amount,
        currency=payload.currency or "SAR",
        provider=payload.provider or "manual",
        provider_ref=payload.provider_ref or "",
    )


@router.post("/check_expired")
async def check_expired(_=Depends(_require_super)):
    n = await auto_suspend_expired()
    return {"suspended": n}


_GRACE_PERIOD_DAYS = 7


@router.post("/tenants/{tenant_id}/schedule-delete")
async def schedule_tenant_delete(
    tenant_id: str,
    payload: Optional[dict] = Body(default=None),
    _=Depends(_require_super),
):
    """Soft-delete: marks the tenant for permanent deletion in 7 days.

    Body (optional): ``{"confirm_slug": "<tenant_slug>", "reason": "..."}``.
    The slug confirmation is required to avoid wrong-tenant disasters.
    """
    payload = payload or {}
    existing = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if existing.get("slug") == DEFAULT_TENANT_SLUG:
        raise HTTPException(status_code=400, detail="Cannot delete default tenant")
    confirm = (payload.get("confirm_slug") or "").strip().lower()
    if confirm != (existing.get("slug") or "").lower():
        raise HTTPException(
            status_code=400,
            detail="confirm_slug must match the tenant slug exactly",
        )
    purge_at = datetime.now(timezone.utc) + timedelta(days=_GRACE_PERIOD_DAYS)
    await control_db.tenants.update_one(
        {"id": tenant_id},
        {"$set": {
            "status": "pending_delete",
            "deletion_scheduled_at": datetime.now(timezone.utc).isoformat(),
            "deletion_purge_at": purge_at.isoformat(),
            "deletion_reason": (payload.get("reason") or "")[:500],
         },
         # Reset per-cycle warning state so the auto-purge scheduler will
         # always emit a fresh "final warning" alert before dropping this
         # tenant on a subsequent cycle.
         "$unset": {
            "final_purge_alert_sent_at": "",
            "deletion_last_error": "",
            "deletion_last_error_at": "",
         }},
    )
    refreshed = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})

    try:
        owner_email = (refreshed or {}).get("owner_email") or ""
        if owner_email:
            await send_email(
                kind="cancelled",
                to=owner_email,
                tenant_slug=(refreshed or {}).get("slug"),
                ctx={
                    "academy_name": (refreshed or {}).get("name", ""),
                    "purge_at": purge_at.isoformat(),
                },
            )
    except Exception:
        logger.exception("cancelled email failed for %s", (refreshed or {}).get("slug"))

    return {"ok": True, "tenant": refreshed, "purge_at": purge_at.isoformat()}


@router.post("/tenants/{tenant_id}/cancel-delete")
async def cancel_tenant_delete(tenant_id: str, _=Depends(_require_super)):
    existing = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tenant not found")
    await control_db.tenants.update_one(
        {"id": tenant_id},
        {"$set": {"status": "active"},
         "$unset": {
            "deletion_scheduled_at": "",
            "deletion_purge_at": "",
            "deletion_reason": "",
            # Clear per-cycle warning state so a future schedule-delete
            # always re-warns before the auto-purge scheduler drops this
            # tenant.
            "final_purge_alert_sent_at": "",
            "deletion_last_error": "",
            "deletion_last_error_at": "",
         }},
    )
    refreshed = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    return {"ok": True, "tenant": refreshed}


@router.delete("/tenants/{tenant_id}")
async def delete_tenant(
    tenant_id: str,
    confirm_slug: Optional[str] = None,
    force: bool = False,
    _=Depends(_require_super),
):
    """Permanently delete a tenant.

    Refuses unless either:
      * the tenant was previously scheduled for deletion and the 7-day grace
        period has elapsed, OR
      * ``force=true`` is passed alongside a matching ``confirm_slug``.

    On success the per-tenant MongoDB database is dropped.
    """
    existing = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if existing.get("slug") == DEFAULT_TENANT_SLUG:
        raise HTTPException(status_code=400, detail="Cannot delete default tenant")

    confirm = (confirm_slug or "").strip().lower()
    if confirm != (existing.get("slug") or "").lower():
        raise HTTPException(
            status_code=400,
            detail="confirm_slug query parameter must match tenant slug exactly",
        )

    purge_at_str = existing.get("deletion_purge_at")
    grace_elapsed = False
    if purge_at_str:
        try:
            purge_at = datetime.fromisoformat(purge_at_str.replace("Z", "+00:00"))
            grace_elapsed = datetime.now(timezone.utc) >= purge_at
        except Exception:
            grace_elapsed = False

    if not force and not grace_elapsed:
        raise HTTPException(
            status_code=400,
            detail=(
                "Tenant must be in pending_delete state with the 7-day grace "
                "period elapsed, or pass force=true to override."
            ),
        )

    db_name = existing.get("db_name") or slug_to_db_name(existing.get("slug", ""))
    drop_error: str = ""
    try:
        await _raw_client.drop_database(db_name)
    except Exception as e:
        logger.exception("Failed to drop tenant database %s: %s", db_name, e)
        drop_error = str(e) or e.__class__.__name__

    if drop_error:
        # Fail closed: do NOT mark the tenant as `deleted` if the underlying
        # data wasn't actually dropped — that would let us "lose" a tenant
        # while their data lingers (compliance / GDPR risk).
        await control_db.tenants.update_one(
            {"id": tenant_id},
            {"$set": {
                "deletion_last_error": drop_error,
                "deletion_last_error_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        raise HTTPException(
            status_code=500,
            detail=(
                f"Tenant database '{db_name}' could not be dropped: {drop_error}. "
                "Tenant remains pending_delete. Please retry after fixing the "
                "underlying issue."
            ),
        )

    await control_db.tenants.update_one(
        {"id": tenant_id},
        {"$set": {
            "status": "deleted",
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "db_dropped": True,
        },
         "$unset": {"deletion_last_error": "", "deletion_last_error_at": ""}},
    )
    return {"ok": True, "db_dropped": True, "force": force}


async def _compute_tenant_stats(tenant: dict) -> dict:
    db_name = tenant.get("db_name") or slug_to_db_name(tenant.get("slug", ""))
    tdb = _raw_client[db_name]

    counts: dict = {}
    for coll in ("members", "branches", "users", "invoices", "activities", "attendance"):
        try:
            counts[coll] = await tdb[coll].count_documents({})
        except Exception:
            counts[coll] = 0

    cutoff_30d = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    recent: dict = {"members": 0, "invoices": 0, "attendance": 0}
    for coll in recent.keys():
        try:
            recent[coll] = await tdb[coll].count_documents({"created_at": {"$gte": cutoff_30d}})
        except Exception:
            recent[coll] = 0

    last_activity: Optional[str] = None
    for coll in ("attendance", "invoices", "members", "branches"):
        try:
            doc = await tdb[coll].find_one({}, sort=[("created_at", -1)], projection={"_id": 0, "created_at": 1})
            ts = (doc or {}).get("created_at")
            if ts and (last_activity is None or ts > last_activity):
                last_activity = ts
        except Exception:
            pass

    max_members = int(tenant.get("max_members") or 0)
    max_branches = int(tenant.get("max_branches") or 0)
    usage = {
        "members_pct": round(counts["members"] * 100 / max_members, 1) if max_members > 0 else None,
        "branches_pct": round(counts["branches"] * 100 / max_branches, 1) if max_branches > 0 else None,
    }

    return {
        "counts": counts,
        "recent_30d": recent,
        "last_activity_at": last_activity,
        "usage": usage,
    }


@router.get("/tenants/{tenant_id}/stats")
async def tenant_stats(tenant_id: str, _=Depends(_require_super)):
    existing = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tenant not found")
    data = await _compute_tenant_stats(existing)
    return {"tenant": existing, **data, "billing": _expiry_info(existing)}


@router.get("/overview")
async def super_overview(_=Depends(_require_super)):
    suspended_count = 0
    try:
        suspended_count = await auto_suspend_expired()
    except Exception:
        logger.exception("auto_suspend_expired failed in overview")

    tenants = await control_db.tenants.find({}, {"_id": 0}).to_list(1000)
    tenants.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    rows = []
    totals = {"members": 0, "branches": 0, "invoices": 0, "users": 0, "activities": 0, "attendance": 0}
    expiring_soon = 0
    expired = 0
    for t in tenants:
        billing = _expiry_info(t)
        state = billing.get("expiry_state")
        if t.get("status") != "deleted":
            if state == "expired":
                expired += 1
            elif state == "expiring_soon":
                expiring_soon += 1
        if t.get("status") == "deleted":
            rows.append({
                "tenant": t,
                "counts": {},
                "recent_30d": {},
                "last_activity_at": None,
                "usage": {"members_pct": None, "branches_pct": None},
                "billing": billing,
            })
            continue
        try:
            data = await _compute_tenant_stats(t)
        except Exception as e:
            logger.exception("overview failed for %s", t.get("slug"))
            data = {"counts": {}, "recent_30d": {}, "last_activity_at": None, "usage": {"members_pct": None, "branches_pct": None}, "error": str(e)}
        for k in totals.keys():
            totals[k] += int((data.get("counts") or {}).get(k) or 0)
        rows.append({"tenant": t, **data, "billing": billing})
    return {
        "tenants": rows,
        "totals": totals,
        "tenant_count": len(tenants),
        "alerts": {
            "expiring_soon": expiring_soon,
            "expired": expired,
            "auto_suspended_now": suspended_count,
        },
    }


# ── Email management (transactional emails to tenant owners) ────────────

class EmailSettingsIn(BaseModel):
    provider: str = Field("", description="'resend', 'sendgrid', or '' to disable")
    from_email: Optional[str] = ""
    from_name: Optional[str] = ""
    enabled: Optional[bool] = True


class EmailTestIn(BaseModel):
    to: str
    kind: Optional[str] = "welcome"


@router.get("/email/settings")
async def email_settings_get(_=Depends(_require_super)):
    return await get_email_settings()


@router.put("/email/settings")
async def email_settings_put(payload: EmailSettingsIn, _=Depends(_require_super)):
    try:
        return await update_email_settings(
            provider=payload.provider or "",
            from_email=payload.from_email or "",
            from_name=payload.from_name or "",
            enabled=bool(payload.enabled if payload.enabled is not None else True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/email/log")
async def email_log_list(
    limit: int = 100,
    kind: str = "",
    status: str = "",
    tenant_slug: str = "",
    _=Depends(_require_super),
):
    rows = await list_email_log(limit=limit, kind=kind, status=status, tenant_slug=tenant_slug)
    return {"items": rows}


@router.post("/email/test")
async def email_test_send(payload: EmailTestIn, _=Depends(_require_super)):
    kind = (payload.kind or "welcome").strip()
    ctx = {
        "academy_name": "Test Academy",
        "slug": "test",
        "trial_days": DEFAULT_TRIAL_DAYS,
        "subscription_end_at": (datetime.now(timezone.utc) + timedelta(days=DEFAULT_TRIAL_DAYS)).isoformat(),
        "days_remaining": 3,
        "amount": "299",
        "currency": "SAR",
        "months": 1,
        "days": 0,
        "reason": "test",
        "purge_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    }
    res = await send_email(kind=kind, to=payload.to, tenant_slug="", ctx=ctx)
    return res


@router.post("/email/run-trial-checks")
async def email_run_trial_checks(_=Depends(_require_super)):
    """Manually trigger the daily trial-ending email sweep (also runs on schedule)."""
    return await send_trial_ending_emails()


# ── Payment provider (Stripe / Moyasar / Tap) webhook config ────────────

class PaymentSettingsIn(BaseModel):
    provider: str = Field("", description="'stripe', 'moyasar', 'tap', or '' to disable")
    enabled: Optional[bool] = False
    secret_env: Optional[str] = "PAYMENT_WEBHOOK_SECRET"


@router.get("/payment/settings")
async def payment_settings_get(_=Depends(_require_super)):
    return await get_payment_settings()


@router.put("/payment/settings")
async def payment_settings_put(payload: PaymentSettingsIn, _=Depends(_require_super)):
    try:
        return await update_payment_settings(
            provider=payload.provider or "",
            enabled=bool(payload.enabled),
            secret_env=payload.secret_env or "PAYMENT_WEBHOOK_SECRET",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
