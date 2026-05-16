"""Tenant context management for multi-tenant isolation.

Holds the current tenant in a ``ContextVar`` so that every database access
through the ``TenantDBProxy`` (see ``backend/database.py``) automatically
targets the right per-tenant MongoDB database without requiring any change
to existing route handlers.
"""
from contextvars import ContextVar
from typing import Optional, Dict, Any, Callable, Awaitable, List
import logging
import os

DEFAULT_TENANT_SLUG = "default"
DEFAULT_DB_NAME = os.environ.get("DB_NAME", "champions_academy")
TENANT_DB_PREFIX = os.environ.get("TENANT_DB_PREFIX", "champions_")
STRICT_TENANT_CONTEXT = os.environ.get("STRICT_TENANT_CONTEXT", "").lower() in ("1", "true", "yes")

logger = logging.getLogger("tenant_context")

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
        if STRICT_TENANT_CONTEXT:
            raise RuntimeError(
                "No tenant context set. Set STRICT_TENANT_CONTEXT=0 to allow the legacy "
                "fallback, or wrap the call in set_current_tenant()/for_each_active_tenant()."
            )
        return DEFAULT_DB_NAME
    return t.get("db_name") or slug_to_db_name(t.get("slug") or DEFAULT_TENANT_SLUG)


def get_current_tenant_slug() -> str:
    t = _current_tenant.get()
    if not t:
        return DEFAULT_TENANT_SLUG
    return t.get("slug") or DEFAULT_TENANT_SLUG


async def list_active_tenants() -> List[Dict[str, Any]]:
    """Return all tenants in the control DB whose status is treated as 'active'
    for background work (active or trial). Excludes deleted/suspended/pending.
    """
    from control_db import control_db
    cursor = control_db.tenants.find(
        {"status": {"$in": ["active", "trial", "trialing", None]}},
        {"_id": 0, "id": 1, "slug": 1, "name": 1, "db_name": 1, "status": 1},
    )
    out: List[Dict[str, Any]] = []
    async for t in cursor:
        slug = t.get("slug")
        if not slug:
            continue
        if not t.get("db_name"):
            t["db_name"] = slug_to_db_name(slug)
        out.append(t)
    return out


async def for_each_active_tenant(
    fn: Callable[[Dict[str, Any]], Awaitable[Any]],
    *,
    label: str = "task",
) -> Dict[str, Any]:
    """Run ``fn(tenant)`` for every active tenant, each in its own tenant context.

    Failures in one tenant are isolated and logged; the loop continues to the
    next. Returns a summary ``{processed, succeeded, failed, results, errors}``
    suitable for scheduler status persistence.
    """
    tenants = await list_active_tenants()
    summary: Dict[str, Any] = {
        "processed": 0,
        "succeeded": 0,
        "failed": 0,
        "results": {},
        "errors": {},
    }
    for tenant in tenants:
        slug = tenant.get("slug") or "?"
        summary["processed"] += 1
        token = set_current_tenant(tenant)
        try:
            res = await fn(tenant)
            summary["succeeded"] += 1
            summary["results"][slug] = res
        except Exception as e:
            summary["failed"] += 1
            summary["errors"][slug] = str(e)
            logger.exception("for_each_active_tenant: %s failed for tenant=%s", label, slug)
        finally:
            reset_current_tenant(token)
    return summary
