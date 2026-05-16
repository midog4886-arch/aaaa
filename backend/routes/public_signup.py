"""Public self-signup endpoints for new academies (no super-admin auth).

Lets a visitor on the marketing site create a new tenant + admin user with
a 30-day free trial, then auto-login. Operates on ``control_db`` and on
the freshly-created tenant database directly so it does NOT require an
existing tenant context.
"""
import re
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, EmailStr

from database import JWT_SECRET, JWT_ALGORITHM, _raw_client
from control_db import control_db, DEFAULT_TRIAL_DAYS, DEFAULT_BILLING_CYCLE
from utils.tenant import slug_to_db_name, DEFAULT_TENANT_SLUG
from routes.super_admin import _seed_new_tenant_db

logger = logging.getLogger("public_signup")

router = APIRouter(prefix="/public", tags=["public-signup"])

SLUG_RE = re.compile(r"^[a-z0-9_]{2,40}$")
_SIGNUP_HITS: dict = {}
_SIGNUP_WINDOW_SEC = 3600
_SIGNUP_MAX_PER_IP = 5


def _check_signup_rate(ip: str) -> bool:
    now_ts = datetime.now(timezone.utc).timestamp()
    bucket = [t for t in _SIGNUP_HITS.get(ip, []) if now_ts - t < _SIGNUP_WINDOW_SEC]
    if len(bucket) >= _SIGNUP_MAX_PER_IP:
        _SIGNUP_HITS[ip] = bucket
        return False
    bucket.append(now_ts)
    _SIGNUP_HITS[ip] = bucket
    if len(_SIGNUP_HITS) > 5000:
        for k in list(_SIGNUP_HITS.keys())[:1000]:
            _SIGNUP_HITS.pop(k, None)
    return True


RESERVED_SLUGS = {
    "default", "admin", "api", "www", "app", "super", "static",
    "assets", "uploads", "health", "signup", "login", "register",
    "public", "test", "demo", "support", "billing", "checkout",
    "privacy", "terms", "refund", "contact", "pricing", "about",
}

DEFAULT_PLANS = [
    {
        "id": "starter",
        "name_ar": "البداية",
        "name_en": "Starter",
        "tagline_ar": "للأكاديميات الناشئة",
        "tagline_en": "For new academies",
        "price_monthly": None,
        "price_yearly": None,
        "currency": "SAR",
        "max_branches": 1,
        "max_members": 200,
        "features_ar": [
            "فرع واحد",
            "حتى 200 عضو",
            "إدارة الأنشطة والجدول",
            "فواتير وتقارير أساسية",
            "تطبيق الجوال للأعضاء",
        ],
        "features_en": [
            "1 branch",
            "Up to 200 members",
            "Activities & schedule",
            "Basic invoicing & reports",
            "Member mobile app",
        ],
        "cta_ar": "ابدأ تجربتك المجانية",
        "cta_en": "Start free trial",
    },
    {
        "id": "pro",
        "name_ar": "المحترف",
        "name_en": "Pro",
        "tagline_ar": "الأكثر طلباً",
        "tagline_en": "Most popular",
        "price_monthly": None,
        "price_yearly": None,
        "currency": "SAR",
        "max_branches": 3,
        "max_members": 1000,
        "features_ar": [
            "حتى 3 فروع",
            "حتى 1000 عضو",
            "كل مزايا البداية",
            "حضور المدربين والرواتب",
            "إشعارات WhatsApp و Push",
            "النشر على وسائل التواصل",
        ],
        "features_en": [
            "Up to 3 branches",
            "Up to 1000 members",
            "Everything in Starter",
            "Coach attendance & payroll",
            "WhatsApp & push notifications",
            "Social media publisher",
        ],
        "cta_ar": "ابدأ تجربتك المجانية",
        "cta_en": "Start free trial",
        "popular": True,
    },
    {
        "id": "enterprise",
        "name_ar": "المؤسسات",
        "name_en": "Enterprise",
        "tagline_ar": "للأكاديميات الكبيرة",
        "tagline_en": "For large academies",
        "price_monthly": None,
        "price_yearly": None,
        "currency": "SAR",
        "max_branches": 0,
        "max_members": 0,
        "features_ar": [
            "فروع وأعضاء بلا حد",
            "كل مزايا المحترف",
            "بطولات ومسابقات",
            "نطاق فرعي مخصص",
            "دعم فني مخصص",
        ],
        "features_en": [
            "Unlimited branches & members",
            "Everything in Pro",
            "Tournaments",
            "Custom subdomain",
            "Priority support",
        ],
        "cta_ar": "تواصل معنا",
        "cta_en": "Contact sales",
        "contact_only": True,
    },
]


async def _load_plans() -> List[dict]:
    try:
        doc = await control_db.platform_settings.find_one({"key": "plans"}, {"_id": 0})
        if doc and isinstance(doc.get("plans"), list) and doc["plans"]:
            return doc["plans"]
    except Exception:
        logger.exception("Failed to load plans from control_db")
    return DEFAULT_PLANS


@router.get("/plans")
async def list_plans():
    plans = await _load_plans()
    return {
        "plans": plans,
        "trial_days": DEFAULT_TRIAL_DAYS,
        "vat_percent": 15,
    }


@router.get("/check-slug/{slug}")
async def check_slug(slug: str):
    s = (slug or "").lower().strip()
    if not SLUG_RE.match(s):
        return {"available": False, "reason": "format"}
    if s in RESERVED_SLUGS:
        return {"available": False, "reason": "reserved"}
    existing = await control_db.tenants.find_one({"slug": s}, {"_id": 0, "slug": 1})
    if existing:
        return {"available": False, "reason": "taken"}
    return {"available": True}


class PublicSignupIn(BaseModel):
    academy_name: str = Field(..., min_length=2, max_length=120)
    slug: str = Field(..., min_length=2, max_length=40)
    owner_name: str = Field(..., min_length=2, max_length=120)
    owner_email: EmailStr
    owner_phone: Optional[str] = ""
    admin_username: str = Field(..., min_length=3, max_length=40)
    admin_password: str = Field(..., min_length=6, max_length=200)
    plan: Optional[str] = "starter"
    billing_cycle: Optional[str] = "monthly"


@router.post("/signup")
async def public_signup(payload: PublicSignupIn, request: Request):
    fwd = request.headers.get("x-forwarded-for", "")
    client_ip = (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")) or "unknown"
    if not _check_signup_rate(client_ip):
        raise HTTPException(status_code=429, detail="عدد كبير من المحاولات، حاول لاحقاً")

    slug = payload.slug.lower().strip()
    if not SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="النطاق الفرعي يقبل حروفاً إنجليزية صغيرة وأرقاماً وشرطة سفلية فقط")
    if slug in RESERVED_SLUGS:
        raise HTTPException(status_code=400, detail="هذا النطاق محجوز، اختر اسماً آخر")
    existing = await control_db.tenants.find_one({"slug": slug}, {"_id": 0, "slug": 1})
    if existing:
        raise HTTPException(status_code=409, detail="النطاق الفرعي مستخدم، اختر اسماً آخر")

    username = (payload.admin_username or "").strip().lower()
    if not re.match(r"^[a-z0-9_.-]{3,40}$", username):
        raise HTTPException(status_code=400, detail="اسم المستخدم يجب أن يكون 3-40 حرفاً ويحتوي حروفاً وأرقاماً فقط")

    plans = await _load_plans()
    plan_ids = [p.get("id") for p in plans]
    plan_id = (payload.plan or "starter").lower()
    if plan_id not in plan_ids:
        plan_id = "starter"
    plan_doc = next((p for p in plans if p.get("id") == plan_id), plans[0])
    if plan_doc.get("contact_only"):
        raise HTTPException(status_code=400, detail="هذه الخطة تتطلب التواصل مع المبيعات، الرجاء اختيار خطة أخرى أو التواصل معنا")

    cycle = (payload.billing_cycle or "monthly").lower()
    if cycle not in {"monthly", "yearly"}:
        cycle = "monthly"

    now = datetime.now(timezone.utc)
    trial_end = now + timedelta(days=DEFAULT_TRIAL_DAYS)
    tenant_doc = {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "name": payload.academy_name.strip(),
        "db_name": slug_to_db_name(slug),
        "status": "pending_approval",
        "approval_status": "pending",
        "approval_requested_at": now.isoformat(),
        "plan": plan_id,
        "max_branches": int(plan_doc.get("max_branches") or 0),
        "max_members": int(plan_doc.get("max_members") or 0),
        "features": [],
        "owner_name": payload.owner_name.strip(),
        "owner_email": str(payload.owner_email).lower(),
        "owner_phone": (payload.owner_phone or "").strip(),
        "created_at": now.isoformat(),
        "billing_cycle": cycle,
        "subscription_start_at": now.isoformat(),
        "subscription_end_at": trial_end.isoformat(),
        "auto_suspend_on_expiry": True,
        "renewal_history": [],
        "onboarding_completed_at": None,
        "signup_source": "public",
        "trial_days": DEFAULT_TRIAL_DAYS,
    }

    try:
        await control_db.tenants.insert_one(tenant_doc)
    except Exception as e:
        logger.exception("insert tenant failed for %s", slug)
        raise HTTPException(status_code=500, detail="تعذر إنشاء الأكاديمية، حاول مجدداً")

    seed_error = ""
    try:
        await _seed_new_tenant_db(
            db_name=tenant_doc["db_name"],
            tenant_name=tenant_doc["name"],
            admin_username=username,
            admin_password=payload.admin_password,
            branch_name="الفرع الرئيسي",
        )
    except Exception as e:
        seed_error = str(e)
        logger.exception("seed tenant failed for %s", slug)
        try:
            await control_db.tenants.delete_one({"slug": slug})
        except Exception:
            pass
        try:
            await _raw_client.drop_database(tenant_doc["db_name"])
        except Exception:
            logger.exception("drop tenant db failed for %s", tenant_doc["db_name"])
        raise HTTPException(status_code=500, detail="تعذر تجهيز قاعدة بيانات الأكاديمية، حاول مجدداً")

    tdb = _raw_client[tenant_doc["db_name"]]
    user_doc = await tdb.users.find_one({"username": username}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=500, detail="تعذر إنشاء حساب المسؤول")

    try:
        from utils.email_service import send_email
        await send_email(
            kind="welcome",
            to=str(payload.owner_email).lower(),
            tenant_slug=slug,
            ctx={
                "academy_name": tenant_doc["name"],
                "slug": slug,
                "trial_days": DEFAULT_TRIAL_DAYS,
                "subscription_end_at": tenant_doc["subscription_end_at"],
                "pending_approval": True,
            },
        )
    except Exception:
        logger.exception("welcome email failed for %s", slug)

    return {
        "ok": True,
        "pending_approval": True,
        "tenant": {
            "slug": slug,
            "name": tenant_doc["name"],
            "plan": plan_id,
            "subscription_end_at": tenant_doc["subscription_end_at"],
            "trial_days": DEFAULT_TRIAL_DAYS,
            "approval_status": "pending",
        },
        "access_token": None,
        "user": {
            "id": user_doc["id"],
            "username": user_doc["username"],
            "name": user_doc.get("name", ""),
            "is_admin": True,
            "branch_id": user_doc.get("branch_id"),
            "permissions": [],
        },
    }
