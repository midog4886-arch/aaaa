"""ASGI middleware that resolves the current tenant for every HTTP request.

Resolution order:
  1. Subdomain  (e.g. ``acme.champions.app`` → slug ``acme``)
  2. ``X-Tenant-Slug`` header
  3. Fallback to ``default`` tenant

Subdomain detection:
  - If env var ``TENANT_BASE_DOMAIN`` is set (recommended for production,
    e.g. ``champions.app``), any host of the form ``<slug>.{BASE_DOMAIN}``
    is treated as tenant ``<slug>``. The base domain itself and ``www``
    map to no slug (i.e. fall through to header / default).
  - If ``TENANT_BASE_DOMAIN`` is not set, falls back to a generic heuristic
    that takes the first label of any 3+ label hostname, while ignoring
    Replit dev/preview hosts and a small list of common reserved labels.

Bypassed for: ``/super/*`` (control plane), ``/health``, ``/uploads``,
and any non-HTTP scope (websocket, lifespan).

Sets the tenant in a ContextVar that ``TenantDBProxy`` reads to route every
DB call to the correct per-tenant MongoDB database.
"""
import logging
import os
from typing import Optional

from utils.tenant import (
    set_current_tenant,
    reset_current_tenant,
    set_bypass_strict,
    reset_bypass_strict,
    DEFAULT_TENANT_SLUG,
    slug_to_db_name,
)

logger = logging.getLogger("tenant_middleware")

BYPASS_PREFIXES = ("/super", "/health", "/uploads")
COMMON_HOSTS_IGNORE = {"localhost", "127.0.0.1", "0.0.0.0", "app", "www", "api"}
TENANT_BASE_DOMAIN = (os.environ.get("TENANT_BASE_DOMAIN") or "").lower().strip().lstrip(".")


def _slug_from_host(host: str) -> Optional[str]:
    if not host:
        return None
    host = host.split(":", 1)[0].lower().strip()
    if not host or host in COMMON_HOSTS_IGNORE:
        return None

    if TENANT_BASE_DOMAIN:
        if host == TENANT_BASE_DOMAIN or host == f"www.{TENANT_BASE_DOMAIN}":
            return None
        suffix = "." + TENANT_BASE_DOMAIN
        if host.endswith(suffix):
            sub_part = host[: -len(suffix)]
            if "." in sub_part:
                return None
            if sub_part in COMMON_HOSTS_IGNORE:
                return None
            return sub_part or None
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
            bypass_token = set_bypass_strict(True)
            try:
                await self.app(scope, receive, send)
            finally:
                reset_bypass_strict(bypass_token)
            return

        headers = scope.get("headers") or []
        host_slug = _slug_from_host(_host_from_headers(headers))
        header_slug = _slug_from_headers(headers)
        explicit_slug = host_slug or header_slug
        slug = explicit_slug or DEFAULT_TENANT_SLUG

        tenant = None
        try:
            from control_db import get_tenant_by_slug
            tenant = await get_tenant_by_slug(slug)
        except Exception as e:
            logger.warning(f"Tenant lookup failed for slug={slug}: {e}")
            if not explicit_slug:
                tenant = {"slug": DEFAULT_TENANT_SLUG, "db_name": slug_to_db_name(DEFAULT_TENANT_SLUG), "status": "active"}

        if not tenant:
            if explicit_slug:
                body = b'{"detail":"Tenant not found"}'
                await send({
                    "type": "http.response.start",
                    "status": 404,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                })
                await send({"type": "http.response.body", "body": body})
                return
            tenant = {"slug": DEFAULT_TENANT_SLUG, "db_name": slug_to_db_name(DEFAULT_TENANT_SLUG), "status": "active"}

        status_val = tenant.get("status")
        if status_val in ("suspended", "deleted", "inactive", "pending_approval", "rejected"):
            if status_val == "pending_approval":
                detail = "حساب الأكاديمية بانتظار موافقة الإدارة قبل التفعيل"
            elif status_val == "rejected":
                detail = "تم رفض طلب تفعيل هذه الأكاديمية. الرجاء التواصل مع الدعم"
            else:
                detail = f"Tenant {status_val}"
            body = ('{"detail":"' + detail + '","tenant_status":"' + status_val + '"}').encode("utf-8")
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
