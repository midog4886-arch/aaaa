"""Public lookup endpoint to identify a member's academy by member_code + phone.

Used by the white-label mobile app's first-launch "choose your academy"
screen: the member enters their member code and phone number, and the
server scans all active tenants to find a match. Returns a small public
profile (academy name, logo, member display name, branch name) so the
app can save the tenant slug and continue.

Privacy: rate-limited per IP. Only returns matches when BOTH member_code
and a normalized phone match in the same member document. Excludes test
tenants and inactive tenants.
"""
import re
import os
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from database import _raw_client
from control_db import control_db
from utils.tenant import slug_to_db_name

logger = logging.getLogger("tenant_lookup")

router = APIRouter(prefix="/public", tags=["public-lookup"])

_LOOKUP_HITS: dict = {}
_LOOKUP_WINDOW_SEC = 60
_LOOKUP_MAX_PER_IP = 5

_TEST_SLUG_PREFIXES = ("seedtest_", "test_", "demo_")
_TEST_SLUG_EXACT = {"bluewave1"}


def _check_rate(ip: str) -> bool:
    now_ts = datetime.now(timezone.utc).timestamp()
    bucket = [t for t in _LOOKUP_HITS.get(ip, []) if now_ts - t < _LOOKUP_WINDOW_SEC]
    if len(bucket) >= _LOOKUP_MAX_PER_IP:
        _LOOKUP_HITS[ip] = bucket
        return False
    bucket.append(now_ts)
    _LOOKUP_HITS[ip] = bucket
    return True


def _phone_variants(phone: str) -> List[str]:
    if not phone:
        return []
    digits = re.sub(r"\D", "", phone)
    if not digits:
        return []
    variants = {digits}
    if digits.startswith("00966"):
        digits = digits[2:]
        variants.add(digits)
    if digits.startswith("966"):
        local9 = digits[3:]
        variants.update({digits, "0" + local9, local9, "+966" + local9, "00966" + local9})
    elif digits.startswith("0") and len(digits) >= 10:
        local9 = digits[1:]
        variants.update({digits, local9, "966" + local9, "+966" + local9, "00966" + local9})
    else:
        variants.update({digits, "0" + digits, "966" + digits, "+966" + digits})
    return [v for v in variants if v]


def _is_test_tenant(slug: str) -> bool:
    s = (slug or "").lower()
    if s in _TEST_SLUG_EXACT:
        return True
    return any(s.startswith(p) for p in _TEST_SLUG_PREFIXES)


class LookupRequest(BaseModel):
    member_code: str = Field(..., min_length=1, max_length=64)
    phone: str = Field(..., min_length=4, max_length=32)


class LookupMatch(BaseModel):
    tenant_slug: str
    academy_name: str
    academy_logo: Optional[str] = ""
    member_name: str
    branch_name: Optional[str] = ""


class LookupResponse(BaseModel):
    matches: List[LookupMatch]


@router.post("/lookup-academy", response_model=LookupResponse)
async def lookup_academy(payload: LookupRequest, request: Request):
    ip = (request.client.host if request.client else "") or "unknown"
    if not _check_rate(ip):
        raise HTTPException(status_code=429, detail="عدد محاولات كبير، حاول بعد دقيقة")

    code = (payload.member_code or "").strip()
    phones = _phone_variants(payload.phone)
    if not code or not phones:
        return LookupResponse(matches=[])

    tenants_cursor = control_db.tenants.find(
        {"status": "active"},
        {"_id": 0, "slug": 1, "name": 1, "db_name": 1},
    )
    tenants = await tenants_cursor.to_list(500)

    matches: List[LookupMatch] = []
    for t in tenants:
        slug = (t.get("slug") or "").strip().lower()
        if not slug or _is_test_tenant(slug):
            continue
        db_name = t.get("db_name") or slug_to_db_name(slug)
        try:
            db = _raw_client[db_name]
            member = await db.members.find_one(
                {
                    "member_code": {"$regex": f"^{re.escape(code)}$", "$options": "i"},
                    "phone": {"$in": phones},
                },
                {"_id": 0, "name_ar": 1, "name": 1, "branch_id": 1},
            )
            if not member:
                continue
            academy_name = t.get("name") or slug
            logo = ""
            branch_name = ""
            try:
                branding = await db.branding.find_one({}, {"_id": 0, "logo_url": 1, "academy_name_ar": 1, "academy_name": 1})
                if branding:
                    logo = branding.get("logo_url") or ""
                    academy_name = branding.get("academy_name_ar") or branding.get("academy_name") or academy_name
            except Exception:
                pass
            try:
                br_id = member.get("branch_id") or ""
                if br_id:
                    br = await db.branches.find_one({"id": br_id}, {"_id": 0, "name_ar": 1, "name": 1})
                    if br:
                        branch_name = br.get("name_ar") or br.get("name") or ""
            except Exception:
                pass
            matches.append(LookupMatch(
                tenant_slug=slug,
                academy_name=academy_name,
                academy_logo=logo,
                member_name=member.get("name_ar") or member.get("name") or "",
                branch_name=branch_name,
            ))
        except Exception as e:
            logger.warning(f"lookup-academy: tenant {slug} scan failed: {e}")
            continue

    return LookupResponse(matches=matches)
