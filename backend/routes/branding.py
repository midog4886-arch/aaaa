from fastapi import APIRouter, Request
from utils.tenant import get_current_tenant, slug_to_db_name
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
    pc = (tenant.get("primary_color", "") if tenant else "") or ""
    pc = pc.strip().lower()
    if pc and not (len(pc) == 7 and pc[0] == "#" and all(c in "0123456789abcdef" for c in pc[1:])):
        pc = ""
    return {
        "name": tenant.get("name", "") if tenant else "",
        "slug": tenant.get("slug", "") if tenant else "",
        "logo_base64": _safe_logo(tenant.get("logo_base64", "") if tenant else ""),
        "primary_color": pc,
    }
