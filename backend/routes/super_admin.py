"""Super-Admin routes — control plane for managing tenants (academies).

Lives outside the tenant middleware (paths under ``/super`` are bypassed by
``TenantMiddleware``). Authenticates via env-var credentials and a JWT with
``scope: "super"``. Operates on ``control_db`` directly.
"""
import os
import uuid
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
    return {k: v for k, v in doc.items() if k != "_id"}


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
