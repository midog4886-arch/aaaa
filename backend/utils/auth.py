from fastapi import Depends, HTTPException, Request
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

def create_token(user_id: str, username: str, branch_id: str = None, is_admin: bool = False, tenant_slug: Optional[str] = None, branch_ids: Optional[list] = None) -> str:
    from utils.tenant import get_current_tenant_slug, DEFAULT_TENANT_SLUG
    payload = {
        "user_id": user_id,
        "username": username,
        "branch_id": branch_id,
        "branch_ids": branch_ids or [],
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


def _active_branch_from_request(request: Optional[Request]) -> Optional[str]:
    """The branch the client is currently viewing (sent as ``X-Branch-Id``).

    Only consulted for multi-branch users and always validated against their
    allowed set, so an untrusted header value can never widen access.
    """
    if request is None:
        return None
    return request.headers.get("X-Branch-Id") or None


async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    _enforce_tenant_match(payload)
    payload["_active_branch"] = _active_branch_from_request(request)
    apply_active_branch(payload)
    return payload

async def get_current_user_from_token(request: Request, token: Optional[str] = None, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional)):
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
    payload["_active_branch"] = _active_branch_from_request(request)
    apply_active_branch(payload)
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


def get_allowed_branch_ids(current_user: dict) -> list:
    """Return the list of branch ids a non-admin user is scoped to.

    Supports multi-branch users via ``branch_ids``; falls back to the single
    ``branch_id`` for legacy/single-branch accounts. Admins are not branch
    scoped and must be handled by the caller before calling this.
    """
    raw = current_user.get("branch_ids")
    bids = [b for b in raw if b] if isinstance(raw, list) else []
    if not bids:
        single = current_user.get("branch_id")
        return [single] if single else []
    seen = []
    for b in bids:
        if b not in seen:
            seen.append(b)
    return seen


def _resolve_multi_branch(current_user: dict, requested: Optional[str], allowed: list) -> str:
    """Pick the active branch for a multi-branch user, validated ``∈ allowed``.

    ``requested`` comes from an explicit filter/target or the ``X-Branch-Id``
    header (``current_user['_active_branch']``). Anything outside the allowed
    set (missing, ``"all"``, or spoofed) falls back to the first allowed branch
    so a multi-branch user can never escape their assigned branches.
    """
    if not requested or requested == "all":
        requested = current_user.get("_active_branch")
    if requested and requested in allowed:
        return requested
    return allowed[0]


def apply_active_branch(payload: dict) -> None:
    """Pin a multi-branch non-admin's working ``branch_id`` to the validated
    active branch (from the ``X-Branch-Id`` header / ``_active_branch``).

    This is what makes "switch branches one at a time" work everywhere: the
    full allowed set stays in ``branch_ids`` (used by ``resolve_branch_filter``
    / ``require_branch_scope``), while every legacy consumer that reads
    ``current_user['branch_id']`` directly transparently sees the currently
    selected branch. Admins and single-branch users are left untouched, so
    their behavior is identical to before.
    """
    if payload.get("is_admin", False):
        return
    allowed = get_allowed_branch_ids(payload)
    if len(allowed) > 1:
        payload["branch_id"] = _resolve_multi_branch(payload, None, allowed)


def require_branch_scope(current_user: dict, target_branch: Optional[str] = None) -> Optional[str]:
    """Return the caller's effective branch_id for a write/detail operation.

    Centralizes the rule that non-admin users MUST be scoped to a branch.
    Without this check, a non-admin user whose branch is missing/empty would
    silently bypass branch filters, leaking cross-branch data.

    Behavior:
      - Admins → ``None`` (caller may operate across all branches).
      - Single-branch non-admins → their branch id.
      - Multi-branch non-admins → the active branch (from ``target_branch`` or
        the ``X-Branch-Id`` header), validated against their allowed set.
      - Non-admins WITHOUT any branch → fail-closed with HTTP 403.
    """
    if current_user.get("is_admin", False):
        return None
    allowed = get_allowed_branch_ids(current_user)
    if not allowed:
        raise HTTPException(status_code=403, detail="No branch assigned")
    if len(allowed) == 1:
        return allowed[0]
    return _resolve_multi_branch(current_user, target_branch, allowed)


def resolve_branch_filter(
    current_user: dict, branch_filter: Optional[str] = None
) -> Optional[str]:
    """Resolve the effective branch_id used to filter list/aggregate queries.

    Encodes the standard rule used across the app:
      - Admins may pass ``branch_filter`` to target a specific branch
        (``None`` or ``"all"`` means "no branch restriction").
      - Single-branch non-admins are always pinned to their own branch.
      - Multi-branch non-admins resolve to their active branch (from
        ``branch_filter`` or the ``X-Branch-Id`` header), validated against
        their allowed set so they only ever see one of their own branches at a
        time.
      - Non-admins without any branch → fail-closed with HTTP 403.

    Returns the branch_id to filter by, or ``None`` to skip branch filtering.
    """
    if current_user.get("is_admin", False):
        if branch_filter and branch_filter != "all":
            return branch_filter
        return None
    allowed = get_allowed_branch_ids(current_user)
    if not allowed:
        raise HTTPException(status_code=403, detail="No branch assigned")
    if len(allowed) == 1:
        return allowed[0]
    return _resolve_multi_branch(current_user, branch_filter, allowed)
