from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from datetime import datetime, timezone, timedelta
from typing import Optional
import jwt
import bcrypt

from database import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRATION_HOURS

security = HTTPBearer()
# Optional bearer used by export endpoints which also accept ?token= in the query
# (browser file downloads can't easily set Authorization headers).
security_optional = HTTPBearer(auto_error=False)

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_token(user_id: str, username: str, branch_id: str = None, is_admin: bool = False, tenant_slug: Optional[str] = None) -> str:
    from utils.tenant import get_current_tenant_slug, DEFAULT_TENANT_SLUG
    payload = {
        "user_id": user_id,
        "username": username,
        "branch_id": branch_id,
        "is_admin": is_admin,
        "tenant_slug": tenant_slug or get_current_tenant_slug() or DEFAULT_TENANT_SLUG,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _enforce_tenant_match(payload: dict):
    from utils.tenant import get_current_tenant_slug, DEFAULT_TENANT_SLUG
    if payload.get("scope") == "super":
        raise HTTPException(status_code=403, detail="Invalid token scope")
    if not payload.get("user_id") or not payload.get("username"):
        raise HTTPException(status_code=401, detail="Invalid token")
    token_tenant = payload.get("tenant_slug")
    if not token_tenant:
        raise HTTPException(status_code=401, detail="Token missing tenant — please log in again")
    current_tenant = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    if token_tenant != current_tenant:
        raise HTTPException(status_code=403, detail="Tenant mismatch")


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    _enforce_tenant_match(payload)
    return payload

async def get_current_user_from_token(token: Optional[str] = None, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional)):
    """Support both Bearer token and query parameter token for exports"""
    actual_token = token
    if not actual_token and credentials:
        actual_token = credentials.credentials
    if not actual_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(actual_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    _enforce_tenant_match(payload)
    return payload

def require_admin(current_user: dict):
    """Check if current user is admin"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")


async def require_permission(current_user: dict, permission_key: str):
    """Verify the authenticated user has the given permission key.

    Admins bypass the check. Non-admins must have ``permission_key`` listed
    on their user document. Fails closed with HTTP 403 otherwise.
    """
    if current_user.get("is_admin", False):
        return
    from database import db
    user_doc = await db.users.find_one({"id": current_user.get("user_id")}, {"_id": 0, "permissions": 1})
    perms = (user_doc or {}).get("permissions") or []
    if permission_key not in perms:
        raise HTTPException(status_code=403, detail=f"الصلاحية '{permission_key}' مطلوبة")
    return current_user


def require_branch_scope(current_user: dict) -> Optional[str]:
    """Return the caller's effective branch_id, enforcing branch isolation.

    Centralizes the rule that non-admin users MUST be scoped to a branch.
    Without this check, a non-admin user whose ``branch_id`` is missing or
    empty would silently bypass branch filters (``not is_admin and branch_id``
    evaluates to ``False``), leaking cross-branch data.

    Behavior:
      - Admins → returns ``None`` (caller may query across all branches).
      - Non-admins with a ``branch_id`` → returns that branch id.
      - Non-admins WITHOUT a ``branch_id`` → fail-closed with HTTP 403.
    """
    if current_user.get("is_admin", False):
        return None
    branch_id = current_user.get("branch_id")
    if not branch_id:
        raise HTTPException(status_code=403, detail="No branch assigned")
    return branch_id


def resolve_branch_filter(
    current_user: dict, branch_filter: Optional[str] = None
) -> Optional[str]:
    """Resolve the effective branch_id used to filter list/aggregate queries.

    Encodes the standard rule used across the app:
      - Admins may pass ``branch_filter`` to target a specific branch
        (``None`` or ``"all"`` means "no branch restriction").
      - Non-admins ignore ``branch_filter`` and are always pinned to their own
        ``branch_id``. Fail-closed with HTTP 403 if they don't have one
        assigned (otherwise they would silently see every branch's data).

    Returns the branch_id to filter by, or ``None`` to skip branch filtering.
    """
    if current_user.get("is_admin", False):
        if branch_filter and branch_filter != "all":
            return branch_filter
        return None
    branch_id = current_user.get("branch_id")
    if not branch_id:
        raise HTTPException(status_code=403, detail="No branch assigned")
    return branch_id
