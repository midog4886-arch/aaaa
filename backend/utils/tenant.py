"""Tenant context management for multi-tenant isolation.

Holds the current tenant in a ``ContextVar`` so that every database access
through the ``TenantDBProxy`` (see ``backend/database.py``) automatically
targets the right per-tenant MongoDB database without requiring any change
to existing route handlers.
"""
from contextvars import ContextVar
from typing import Optional, Dict, Any
import os

DEFAULT_TENANT_SLUG = "default"
DEFAULT_DB_NAME = os.environ.get("DB_NAME", "champions_academy")
TENANT_DB_PREFIX = os.environ.get("TENANT_DB_PREFIX", "champions_")

_current_tenant: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "current_tenant", default=None
)


def set_current_tenant(tenant: Optional[Dict[str, Any]]):
    return _current_tenant.set(tenant)


def reset_current_tenant(token) -> None:
    _current_tenant.reset(token)


def get_current_tenant() -> Optional[Dict[str, Any]]:
    return _current_tenant.get()


def slug_to_db_name(slug: str) -> str:
    if slug == DEFAULT_TENANT_SLUG:
        return DEFAULT_DB_NAME
    safe = "".join(c for c in slug.lower() if c.isalnum() or c == "_")
    return f"{TENANT_DB_PREFIX}{safe}"


def get_current_tenant_db_name() -> str:
    t = _current_tenant.get()
    if not t:
        return DEFAULT_DB_NAME
    return t.get("db_name") or slug_to_db_name(t.get("slug") or DEFAULT_TENANT_SLUG)


def get_current_tenant_slug() -> str:
    t = _current_tenant.get()
    if not t:
        return DEFAULT_TENANT_SLUG
    return t.get("slug") or DEFAULT_TENANT_SLUG
