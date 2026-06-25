"""Common dependencies and utilities for routes"""
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os
import jwt

# Use centralized database connection
from database import db

# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET_KEY', 'default_secret')
JWT_ALGORITHM = "HS256"

security = HTTPBearer()

async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get current authenticated user from JWT token"""
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    from utils.tenant import get_current_tenant_slug, DEFAULT_TENANT_SLUG
    if payload.get("scope") == "super":
        raise HTTPException(status_code=403, detail="Invalid token scope")
    if not payload.get("user_id") or not payload.get("username"):
        raise HTTPException(status_code=401, detail="Invalid token")
    token_tenant = payload.get("tenant_slug")
    if not token_tenant:
        raise HTTPException(status_code=401, detail="Token missing tenant — please log in again")
    if token_tenant != (get_current_tenant_slug() or DEFAULT_TENANT_SLUG):
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    # Branch the client is currently viewing (X-Branch-Id). Only used for
    # multi-branch users and always validated against their allowed set.
    payload["_active_branch"] = request.headers.get("X-Branch-Id") or None
    from utils.auth import apply_active_branch
    apply_active_branch(payload)
    return payload
