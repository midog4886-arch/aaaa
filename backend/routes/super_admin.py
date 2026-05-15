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
from typing import Optional, List

import jwt
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from database import JWT_SECRET, JWT_ALGORITHM, _raw_client
from control_db import control_db
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
    doc = {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "name": payload.name,
        "db_name": slug_to_db_name(slug),
        "status": "active",
        "plan": payload.plan or "starter",
        "max_branches": int(payload.max_branches or 1),
        "max_members": int(payload.max_members or 100),
        "features": payload.features or [],
        "owner_email": payload.owner_email or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
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
    await control_db.tenants.update_one({"id": tenant_id}, {"$set": update})
    refreshed = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    return refreshed


@router.delete("/tenants/{tenant_id}")
async def delete_tenant(tenant_id: str, _=Depends(_require_super)):
    existing = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if existing.get("slug") == DEFAULT_TENANT_SLUG:
        raise HTTPException(status_code=400, detail="Cannot delete default tenant")
    await control_db.tenants.update_one({"id": tenant_id}, {"$set": {"status": "deleted"}})
    return {"ok": True}


@router.get("/tenants/{tenant_id}/stats")
async def tenant_stats(tenant_id: str, _=Depends(_require_super)):
    existing = await control_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tenant not found")
    db_name = existing.get("db_name") or slug_to_db_name(existing.get("slug", ""))
    tdb = _raw_client[db_name]
    stats = {}
    for coll in ("members", "branches", "users", "invoices", "activities"):
        try:
            stats[coll] = await tdb[coll].count_documents({})
        except Exception:
            stats[coll] = 0
    return {"tenant": existing, "counts": stats}
