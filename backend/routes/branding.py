from datetime import datetime, timezone
from fastapi import APIRouter, Request
from utils.tenant import get_current_tenant
from middleware.tenant import _slug_from_host
from control_db import control_db

router = APIRouter(prefix="/tenant", tags=["branding"])


def _safe_logo(value):
    s = (value or "").strip()
    if not s.startswith("data:image/") or ";base64," not in s:
        return ""
    if len(s) > 800 * 1024:
        return ""
    return s


def _safe_color(value):
    pc = (value or "").strip().lower()
    if pc and not (len(pc) == 7 and pc[0] == "#" and all(c in "0123456789abcdef" for c in pc[1:])):
        return ""
    return pc


def _days_remaining(end_at_iso):
    if not end_at_iso:
        return None
    try:
        end = datetime.fromisoformat(end_at_iso.replace("Z", "+00:00"))
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        delta = end - now
        return int(delta.total_seconds() // 86400)
    except Exception:
        return None


@router.get("/branding")
async def get_branding(request: Request):
    host = request.headers.get("host", "")
    host_slug = _slug_from_host(host)
    tenant = None
    if host_slug:
        try:
            tenant = await control_db.tenants.find_one({"slug": host_slug}, {"_id": 0})
        except Exception:
            tenant = None
    if not tenant:
        tenant = get_current_tenant() or {}
    end_at = tenant.get("subscription_end_at", "") if tenant else ""
    return {
        "name": tenant.get("name", "") if tenant else "",
        "slug": tenant.get("slug", "") if tenant else "",
        "logo_base64": _safe_logo(tenant.get("logo_base64", "") if tenant else ""),
        "primary_color": _safe_color(tenant.get("primary_color", "") if tenant else ""),
        "status": tenant.get("status", "") if tenant else "",
        "subscription_end_at": end_at,
        "days_remaining": _days_remaining(end_at),
        "auto_suspend_on_expiry": bool(tenant.get("auto_suspend_on_expiry", False)) if tenant else False,
    }
