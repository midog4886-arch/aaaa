from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from datetime import datetime, timezone, timedelta
from typing import Optional
import jwt
import bcrypt

from database import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRATION_HOURS

security = HTTPBearer()

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_token(user_id: str, username: str, branch_id: str = None, is_admin: bool = False) -> str:
    payload = {
        "user_id": user_id,
        "username": username,
        "branch_id": branch_id,
        "is_admin": is_admin,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user_from_token(token: Optional[str] = None, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Support both Bearer token and query parameter token for exports"""
    actual_token = token
    if not actual_token and credentials:
        actual_token = credentials.credentials
    if not actual_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(actual_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_admin(current_user: dict):
    """Check if current user is admin"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
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
