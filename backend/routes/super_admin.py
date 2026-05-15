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
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from database import JWT_SECRET, JWT_ALGORITHM, _raw_client
from control_db import control_db, auto_suspend_expired, DEFAULT_TRIAL_DAYS, DEFAULT_BILLING_CYCLE
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
    return refreshed


@router.post("/tenants/{tenant_id}/renew")
async def renew_tenant(tenant_id: str, payload: TenantRenew, _=Depends(_require_super)):
    existing = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tenant not found")
    months = int(payload.months or 0)
    days = int(payload.days or 0)
    if months < 0 or days < 0:
        raise HTTPException(status_code=400, detail="months/days must be non-negative")
    if months <= 0 and days <= 0:
        raise HTTPException(status_code=400, detail="Provide months or days to extend")
    if months > MAX_RENEWAL_MONTHS or days > MAX_RENEWAL_DAYS:
        raise HTTPException(status_code=400, detail=f"Renewal too large (max {MAX_RENEWAL_MONTHS} months / {MAX_RENEWAL_DAYS} days)")
    add_days = months * 30 + days
    now = datetime.now(timezone.utc)
    base = now
    if (payload.extend_from or "current_end") == "current_end":
        cur_end = _parse_iso(existing.get("subscription_end_at"))
        if cur_end and cur_end > now:
            base = cur_end
    new_end = base + timedelta(days=add_days)
    history_entry = {
        "renewed_at": now.isoformat(),
        "previous_end": existing.get("subscription_end_at"),
        "new_end": new_end.isoformat(),
        "months": months,
        "days": days,
        "note": (payload.note or "").strip(),
    }
    set_ops = {
        "subscription_end_at": new_end.isoformat(),
        "last_renewed_at": now.isoformat(),
    }
    if existing.get("status") in ("suspended",) and existing.get("suspended_reason") == "expired":
        set_ops["status"] = "active"
        set_ops["suspended_at"] = None
        set_ops["suspended_reason"] = None
    await control_db.tenants.update_one(
        {"id": tenant_id},
        {"$set": set_ops, "$push": {"renewal_history": history_entry}},
    )
    refreshed = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    return {"tenant": refreshed, "renewal": history_entry}


@router.post("/check_expired")
async def check_expired(_=Depends(_require_super)):
    n = await auto_suspend_expired()
    return {"suspended": n}


@router.delete("/tenants/{tenant_id}")
async def delete_tenant(tenant_id: str, _=Depends(_require_super)):
    existing = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if existing.get("slug") == DEFAULT_TENANT_SLUG:
        raise HTTPException(status_code=400, detail="Cannot delete default tenant")
    await control_db.tenants.update_one({"id": tenant_id}, {"$set": {"status": "deleted"}})
    return {"ok": True}


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
