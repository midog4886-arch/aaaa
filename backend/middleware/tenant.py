"""ASGI middleware that resolves the current tenant for every HTTP request.

Resolution order:
  1. Subdomain  (e.g. ``academy1.app.com`` → slug ``academy1``)
  2. ``X-Tenant-Slug`` header
  3. Fallback to ``default`` tenant

Bypassed for: ``/super/*`` (control plane), ``/health``, ``/uploads``,
and any non-HTTP scope (websocket, lifespan).

Sets the tenant in a ContextVar that ``TenantDBProxy`` reads to route every
DB call to the correct per-tenant MongoDB database.
"""
import logging
from typing import Optional

from utils.tenant import (
    set_current_tenant,
    reset_current_tenant,
    DEFAULT_TENANT_SLUG,
    slug_to_db_name,
)

logger = logging.getLogger("tenant_middleware")

BYPASS_PREFIXES = ("/super", "/health", "/uploads")
COMMON_HOSTS_IGNORE = {"localhost", "127.0.0.1", "0.0.0.0", "app", "www", "api"}


def _slug_from_host(host: str) -> Optional[str]:
    if not host:
        return None
    host = host.split(":", 1)[0].lower().strip()
    if not host or host in COMMON_HOSTS_IGNORE:
        return None
    parts = host.split(".")
    if len(parts) < 3:
        return None
    sub = parts[0]
    if sub in COMMON_HOSTS_IGNORE:
        return None
    if "replit" in host or "pike" in host:
        return None
    return sub


def _slug_from_headers(headers) -> Optional[str]:
    for k, v in headers:
        if k == b"x-tenant-slug":
            try:
                s = v.decode("latin1").strip().lower()
                return s or None
            except Exception:
                return None
    return None


def _host_from_headers(headers) -> str:
    for k, v in headers:
        if k == b"host":
            try:
                return v.decode("latin1")
            except Exception:
                return ""
    return ""


class TenantMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if any(path.startswith(p) for p in BYPASS_PREFIXES):
            await self.app(scope, receive, send)
            return

        headers = scope.get("headers") or []
        slug = _slug_from_host(_host_from_headers(headers)) or _slug_from_headers(headers) or DEFAULT_TENANT_SLUG

        from control_db import get_tenant_by_slug
        tenant = await get_tenant_by_slug(slug)
        if not tenant:
            tenant = await get_tenant_by_slug(DEFAULT_TENANT_SLUG)
        if not tenant:
            tenant = {"slug": DEFAULT_TENANT_SLUG, "db_name": slug_to_db_name(DEFAULT_TENANT_SLUG), "status": "active"}

        if tenant.get("status") == "suspended":
            body = b'{"detail":"Tenant suspended"}'
            await send({
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            })
            await send({"type": "http.response.body", "body": body})
            return

        token = set_current_tenant(tenant)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_current_tenant(token)
