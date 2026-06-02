from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Request, UploadFile, File, Form, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
import os
import asyncio
import logging
import io
from io import BytesIO
import csv
import base64
import shutil
import json


def _get_reportlab():
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image as RLImage
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    # Wrap plain functions in staticmethod so they aren't bound when accessed
    # as attributes on the dummy class instance returned below.
    return type('RL', (), {
        'colors': colors, 'A4': A4, 'landscape': landscape,
        'SimpleDocTemplate': SimpleDocTemplate, 'Table': Table,
        'TableStyle': TableStyle, 'Paragraph': Paragraph, 'Spacer': Spacer,
        'Image': RLImage,
        'getSampleStyleSheet': staticmethod(getSampleStyleSheet),
        'ParagraphStyle': ParagraphStyle,
        'mm': mm, 'pdfmetrics': pdfmetrics, 'TTFont': TTFont,
    })()


def _get_openpyxl():
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
    from openpyxl.drawing.image import Image as XLImage
    return type('XL', (), {
        'Workbook': Workbook, 'Font': Font, 'Alignment': Alignment,
        'Border': Border, 'Side': Side, 'PatternFill': PatternFill,
        'Image': XLImage,
    })()


def _decode_photo_data_url(photo):
    """Decode a base64 data URL (e.g. 'data:image/png;base64,...') into raw bytes.

    Returns ``None`` when the input is empty, malformed, or not a data URL.
    """
    if not photo or not isinstance(photo, str):
        return None
    if not photo.startswith("data:image/"):
        return None
    try:
        _, b64 = photo.split(",", 1)
        return base64.b64decode(b64)
    except Exception:
        return None


def _get_qrcode():
    import qrcode
    return qrcode


from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import jwt
import bcrypt
# Stripe integration disabled for external deployment
# from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest# Import routers from routes package
from routes.users import router as users_router
from routes.levels import router as levels_router
from routes.branches import router as branches_router
from routes.activities import router as activities_router
from routes.coaches import router as coaches_router
from routes.member_portal import router as member_portal_router
from routes.members import router as members_router
from routes.invoices import router as invoices_router, set_loyalty_award_function as set_invoices_loyalty
from routes.attendance import router as attendance_router, set_loyalty_award_function
from routes.notifications import router as notifications_router
from routes.bank_reports import router as bank_reports_router
from routes.advertisements import router as advertisements_router
from routes.daily_videos import router as daily_videos_router, set_loyalty_award_function as set_videos_loyalty, set_push_notify_function
from routes.loyalty import router as loyalty_router, set_database as set_loyalty_db, award_points as loyalty_award_points
from routes.push_notifications import router as push_notifications_router, notify_new_video as push_notify_new_video
from routes.messages import router as messages_router
from routes.daily_ledger import router as daily_ledger_router
from routes.day_extensions import router as day_extensions_router
from routes.freezes import router as freezes_router
from routes.coach_attendance import router as coach_attendance_router
from routes.supervisors import router as supervisors_router
from routes.payment_vouchers import router as payment_vouchers_router
from routes.coach_advances import router as coach_advances_router
from routes.coach_salaries import router as coach_salaries_router
from routes.whatsapp import router as whatsapp_router, set_database as set_whatsapp_db, start_scheduler as start_whatsapp_scheduler
from routes.tournaments import router as tournaments_router
from routes.operation_passwords import router as operation_passwords_router
from routes.social_publisher import router as social_publisher_router
from routes.super_admin import router as super_admin_router
from middleware.tenant import TenantMiddleware

ROOT_DIR = Path(__file__).parent
UPLOADS_DIR = ROOT_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
load_dotenv(ROOT_DIR / '.env')

# Use centralized database connection (supports both Motor and Atlas HTTP proxy)
from database import db

# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET_KEY', 'default_secret')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 365 * 100  # 100 years - permanent session

# Stripe Config
STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY', '')

# ── Sentry SDK (optional) ───────────────────────────────────────────────────
# Enabled only if SENTRY_DSN is set. We import lazily so the dependency is
# truly optional — the app boots fine without sentry-sdk installed.
SENTRY_DSN = os.environ.get("SENTRY_DSN", "").strip()
if SENTRY_DSN:
    try:
        import sentry_sdk  # type: ignore
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=os.environ.get("SENTRY_ENVIRONMENT", "production"),
            release=os.environ.get("SENTRY_RELEASE") or None,
            traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.05")),
            send_default_pii=False,
        )
        logging.getLogger("sentry").info("Sentry SDK initialised")
    except Exception as _e:  # pragma: no cover
        logging.getLogger("sentry").warning("Sentry init failed: %s", _e)

app = FastAPI(title="Champions Academy API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

# Include routers
api_router.include_router(users_router)
api_router.include_router(levels_router)
api_router.include_router(branches_router)
api_router.include_router(activities_router)
api_router.include_router(coaches_router)
api_router.include_router(members_router)
api_router.include_router(invoices_router)
api_router.include_router(attendance_router)
api_router.include_router(notifications_router)
api_router.include_router(bank_reports_router)
api_router.include_router(advertisements_router)
api_router.include_router(daily_videos_router)
api_router.include_router(loyalty_router)
api_router.include_router(push_notifications_router)
api_router.include_router(messages_router)
api_router.include_router(daily_ledger_router)
api_router.include_router(day_extensions_router)
api_router.include_router(freezes_router)
api_router.include_router(coach_attendance_router)
api_router.include_router(supervisors_router)
api_router.include_router(payment_vouchers_router)
api_router.include_router(coach_advances_router)
api_router.include_router(coach_salaries_router)
api_router.include_router(whatsapp_router)
api_router.include_router(tournaments_router)
api_router.include_router(operation_passwords_router)
api_router.include_router(social_publisher_router)

from routes.branding import router as branding_router
api_router.include_router(branding_router)

from routes.public_signup import router as public_signup_router
api_router.include_router(public_signup_router)

from routes.tenant_lookup import router as tenant_lookup_router
api_router.include_router(tenant_lookup_router)

from routes.billing import router as billing_router
api_router.include_router(billing_router)

from routes.contact import router as contact_router, super_router as contact_super_router
api_router.include_router(contact_router)
app.include_router(contact_super_router)

from routes.audit import router as audit_router
api_router.include_router(audit_router)

from routes.data_export import router as data_export_router
api_router.include_router(data_export_router)

from routes.global_search import router as global_search_router
api_router.include_router(global_search_router)

app.include_router(super_admin_router)

# Set database for loyalty router
set_loyalty_db(db)

# Set loyalty award function for attendance router
set_loyalty_award_function(loyalty_award_points)

# Set database for WhatsApp router
set_whatsapp_db(db)

# Set loyalty award function for invoices router (subscription renewals)
set_invoices_loyalty(loyalty_award_points)

# Set loyalty award function for daily videos router (video watch)
set_videos_loyalty(loyalty_award_points)

# Set push notification function for daily videos router
set_push_notify_function(push_notify_new_video)

# Member Portal router (mounted directly on app, not api_router)
app.include_router(member_portal_router)

# Mount uploads directory for serving images (disk-only, no /api prefix)
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Health check endpoints (required for Kubernetes deployment + UptimeRobot).
# ``/health`` stays a tiny string-only check that never touches the DB so a
# slow Mongo cluster can't take the liveness probe down. ``/api/health``
# additionally pings the database with a low timeout and reports degraded
# state, which is what UptimeRobot / monitoring should call.
_APP_BOOT_AT = datetime.now(timezone.utc)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/api/health")
async def api_health_check():
    """Deeper health check used by UptimeRobot and dashboards."""
    started = datetime.now(timezone.utc)
    db_ok = True
    db_error = None
    try:
        # Lightweight ping — listing collections via a count on a tiny one
        # works on both Motor and the AtlasClient HTTP shim.
        await asyncio.wait_for(db.users.count_documents({}, limit=1), timeout=4.0)
    except Exception as e:
        db_ok = False
        db_error = str(e)[:200]

    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    status_code = 200 if db_ok else 503
    body = {
        "status": "ok" if db_ok else "degraded",
        "db": "ok" if db_ok else "down",
        "db_latency_ms": duration_ms,
        "uptime_seconds": int((datetime.now(timezone.utc) - _APP_BOOT_AT).total_seconds()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if db_error:
        body["db_error"] = db_error
    return JSONResponse(content=body, status_code=status_code)

@app.get("/")
async def root():
    index_file = ROOT_DIR / "static" / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file), headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
    return JSONResponse(content={"status": "ok"}, status_code=200)

# ============ AD IMAGES - serve from disk or MongoDB fallback ============

@api_router.get("/uploads/ads/{filename}")
async def serve_ad_image(filename: str):
    """Serve ad banner images. Falls back to MongoDB if file is missing from disk."""
    import base64
    from fastapi.responses import Response as FastAPIResponse
    ads_dir = ROOT_DIR / "uploads" / "ads"
    file_path = ads_dir / filename
    if file_path.exists():
        from fastapi.responses import FileResponse as FR
        return FR(str(file_path))
    # Fallback: retrieve from MongoDB ad_images collection
    doc = await db.ad_images.find_one({"filename": filename})
    if doc and doc.get("data"):
        image_bytes = base64.b64decode(doc["data"])
        content_type = doc.get("content_type", "image/jpeg")
        # Write back to disk for subsequent requests
        try:
            ads_dir.mkdir(parents=True, exist_ok=True)
            with open(file_path, "wb") as f:
                f.write(image_bytes)
        except Exception:
            pass
        return FastAPIResponse(content=image_bytes, media_type=content_type)
    raise HTTPException(status_code=404, detail="Image not found")


# ============ PUBLIC API - Member Card ============

@api_router.get("/public/member-card/{search_term}")
async def get_member_card_public(search_term: str, branch_id: Optional[str] = None):
    """Public API to get member card info by member_code or phone.

    Optional ``branch_id`` disambiguates printed-card QRs that only encode the
    numeric suffix (e.g. ``0027``) when the same suffix exists in multiple
    branches after a global renumber. The scanner page passes the active
    branch so a B5 reader maps ``0027`` to ``DEFA-B5-0027`` automatically.
    """
    from utils.text import normalize_digits, dearabize_keyboard
    # Hardware barcode scanners type via the OS keyboard layout, so on an
    # Arabic layout the scanned digits arrive as Arabic-Indic numerals that
    # never match ASCII-stored member codes. Normalize before lookup.
    search_term = normalize_digits(search_term).strip()
    # Search by id (deterministic), member_code, or phone first
    member = await db.members.find_one(
        {"$or": [
            {"id": search_term},
            {"member_code": search_term},
            {"phone": search_term}
        ]},
        {"_id": 0}
    )

    if not member and search_term.isdigit():
        import re as _re
        matches = await db.members.find(
            {"member_code": {"$regex": f"-{_re.escape(search_term)}[^0-9]*$"}},
            {"_id": 0}
        ).to_list(20)
        if len(matches) == 1:
            member = matches[0]
        elif len(matches) > 1:
            # Try to disambiguate using the scanner's branch context
            if branch_id:
                scoped = [m for m in matches if m.get("branch_id") == branch_id]
                if len(scoped) == 1:
                    member = scoped[0]
            if not member:
                raise HTTPException(
                    status_code=409,
                    detail="رقم العضوية مكرر بين فروع مختلفة — استخدم الرقم الكامل"
                )

    if not member:
        # Hardware scanner on an Arabic keyboard layout mangles the WHOLE code
        # (letters become Arabic letters/brackets, not just digits). Recover the
        # Latin code and retry an exact member_code/phone match before any name
        # search, so a mangled code never falls through to fuzzy name matching.
        alt = dearabize_keyboard(search_term)
        if alt and alt != search_term:
            import re as _re_kb
            member = await db.members.find_one(
                {"$or": [
                    {"member_code": {"$regex": f"^{_re_kb.escape(alt)}$", "$options": "i"}},
                    {"phone": alt},
                ]},
                {"_id": 0}
            )

    if not member:
        # Search by name. May match MULTIPLE members (e.g. same first/last
        # name), so match each typed word against the name — "سعد مطلق" finds
        # "سعد عبدالله مطلق" — and return the candidate list for the caller to
        # choose from. A single match falls through to the card builder below.
        import re as _re_name
        name_tokens = [t for t in search_term.split() if t]
        if name_tokens:
            name_query = {"$and": [
                {"$or": [
                    {"name_ar": {"$regex": _re_name.escape(tok), "$options": "i"}},
                    {"name": {"$regex": _re_name.escape(tok), "$options": "i"}},
                ]}
                for tok in name_tokens
            ]}
        else:
            name_query = {"name_ar": {"$regex": _re_name.escape(search_term), "$options": "i"}}
        name_matches = await db.members.find(
            name_query,
            {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "member_code": 1, "phone": 1}
        ).limit(25).to_list(25)
        if len(name_matches) == 1:
            member = await db.members.find_one({"id": name_matches[0]["id"]}, {"_id": 0})
        elif len(name_matches) > 1:
            return {
                "multiple": True,
                "matches": [
                    {
                        "id": m.get("id"),
                        "name": m.get("name_ar") or m.get("name") or "",
                        "member_code": m.get("member_code") or "",
                        "phone": m.get("phone") or "",
                    }
                    for m in name_matches
                ],
            }
    
    if not member:
        raise HTTPException(status_code=404, detail="العضو غير موجود")
    
    # Get member activities from member's activities list first
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    activities = []
    
    # Build a map of schedule from invoices
    schedule_map = {}
    invoices = await db.invoices.find(
        {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
        {"_id": 0, "items": 1}
    ).to_list(100)
    
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("activity_id") and item.get("schedule"):
                schedule_map[item.get("activity_id")] = item.get("schedule")
    
    # First, get activities from member document
    member_activities = member.get("activities", [])
    member_activity_ids = list({a.get("activity_id") for a in member_activities if a.get("activity_id")})
    activities_en_map = {}
    if member_activity_ids:
        act_docs = await db.activities.find({"id": {"$in": member_activity_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        activities_en_map = {a["id"]: a.get("name") or "" for a in act_docs}
    for act in member_activities:
        end_date = act.get("end_date", "")
        start_date = act.get("start_date", "")
        status = "expired"
        if end_date:
            status = "active" if end_date >= today else "expired"
        
        # Get schedule from member activity or from invoice
        schedule = act.get("schedule", "") or schedule_map.get(act.get("activity_id"), "")
        
        activities.append({
            "activity_id": act.get("activity_id"),
            "activity_name": act.get("activity_name"),
            "activity_name_en": activities_en_map.get(act.get("activity_id")) or "",
            "status": status,
            "start_date": start_date,
            "end_date": end_date,
            "schedule": schedule
        })
    
    # Also check invoices if no activities found
    if not activities:
        invoices = await db.invoices.find(
            {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
            {"_id": 0}
        ).to_list(100)
        
        for inv in invoices:
            for item in inv.get("items", []):
                if item.get("activity_id"):
                    end_date = item.get("end_date", "")
                    start_date = item.get("start_date", "")
                    
                    if not end_date and item.get("period"):
                        period = item.get("period", "")
                        if " - " in period:
                            parts = period.split(" - ")
                            if len(parts) == 2:
                                start_date = parts[0].strip()
                                end_date = parts[1].strip()
                    
                    status = "expired"
                    if end_date:
                        status = "active" if end_date >= today else "expired"
                    
                    activities.append({
                        "activity_id": item.get("activity_id"),
                        "activity_name": item.get("activity_name"),
                        "status": status,
                        "start_date": start_date,
                        "end_date": end_date,
                        "schedule": item.get("schedule", "")
                    })
    
    # Also check registration forms
    if not activities:
        reg_forms = await db.registration_forms.find({
            "$or": [
                {"customer_phone": member.get("phone", "")},
            ],
            "status": {"$in": ["pending", "converted"]}
        }, {"_id": 0}).to_list(100)
        
        for form in reg_forms:
            for item in form.get("items", []):
                if item.get("activity_id"):
                    end_date = item.get("end_date", "")
                    start_date = item.get("start_date", "")
                    status = "expired"
                    if end_date:
                        status = "active" if end_date >= today else "expired"
                    
                    activities.append({
                        "activity_id": item.get("activity_id"),
                        "activity_name": item.get("activity_name"),
                        "status": status,
                        "start_date": start_date,
                        "end_date": end_date,
                        "schedule": item.get("schedule", "")
                    })
    
    branch_phone = ""
    member_branch_id = member.get("branch_id")
    if member_branch_id:
        _branch = await db.branches.find_one({"id": member_branch_id}, {"_id": 0, "phone": 1})
        if _branch:
            branch_phone = _branch.get("phone") or ""

    return {
        "id": member["id"],
        "name": member.get("name"),
        "name_ar": member.get("name_ar"),
        "member_code": member.get("member_code"),
        "phone": member.get("phone"),
        "photo": member.get("photo", ""),
        "branch_id": member_branch_id,
        "branch_phone": branch_phone,
        "notes": member.get("notes") or "",
        "activities": activities,
        "active_activities": [a for a in activities if a.get("status") == "active"],
        "qr_data": {
            "type": "WCPA_MEMBER",
            "code": member.get("member_code"),
            "id": member["id"],
            "phone": member.get("phone"),
            "name": member.get("name_ar") or member.get("name")
        }
    }

@api_router.get("/public/members-for-print")
async def get_members_for_print(limit: int = 6):
    """Public API to get members for test printing (limited info)"""
    members_cursor = db.members.find(
        {},
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "member_code": 1, "phone": 1}
    ).limit(limit)
    
    members = await members_cursor.to_list(limit)
    
    # Get activities for each member
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    result = []
    
    for member in members:
        invoices = await db.invoices.find(
            {"member_id": member.get("id"), "status": {"$in": ["paid", "partial"]}},
            {"_id": 0}
        ).to_list(100)
        
        activities = []
        for inv in invoices:
            for item in inv.get("items", []):
                if item.get("activity_id"):
                    end_date = item.get("end_date", "")
                    if not end_date and item.get("period"):
                        period = item.get("period", "")
                        if " - " in period:
                            parts = period.split(" - ")
                            if len(parts) == 2:
                                end_date = parts[1].strip()
                    
                    status = "active" if end_date and end_date >= today else "expired"
                    activities.append({
                        "activity_name": item.get("activity_name"),
                        "status": status
                    })
        
        result.append({
            "id": member.get("id"),
            "name": member.get("name"),
            "name_ar": member.get("name_ar"),
            "member_code": member.get("member_code"),
            "phone": member.get("phone"),
            "activities": activities
        })
    
    return {"members": result}

# ============ MODELS ============

class UserCreate(BaseModel):
    username: str
    password: str
    name: str

class UserLogin(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]

class ActivityBase(BaseModel):
    name: str
    name_ar: str
    description: Optional[str] = ""
    description_ar: Optional[str] = ""
    monthly_fee: float
    color: str

class ActivityCreate(ActivityBase):
    branch_id: Optional[str] = None

class Activity(ActivityBase):
    id: str
    branch_id: Optional[str] = None
    created_at: str

class CoachBase(BaseModel):
    name: str
    name_ar: str
    phone: str
    email: Optional[str] = ""
    activities: List[str] = []
    notes: Optional[str] = ""

class CoachCreate(CoachBase):
    branch_id: Optional[str] = None

class Coach(CoachBase):
    id: str
    branch_id: Optional[str] = None
    created_at: str

class MemberActivity(BaseModel):
    activity_id: str
    activity_name: Optional[str] = ""
    start_date: str
    end_date: str
    fee: Optional[float] = 0
    status: str = "active"  # active, expired, frozen
    coach_id: Optional[str] = ""
    level_id: Optional[str] = ""
    schedule: Optional[str] = ""
    source: Optional[str] = ""
    source_id: Optional[str] = ""

class MemberBase(BaseModel):
    name: str
    name_ar: str
    age: int
    guardian_name: str
    guardian_name_ar: str
    phone: str
    email: Optional[str] = ""
    notes: Optional[str] = ""
    preferred_language: Optional[str] = "ar"

class MemberCreate(MemberBase):
    activities: List[MemberActivity] = []

class MemberUpdate(BaseModel):
    name: Optional[str] = None
    name_ar: Optional[str] = None
    age: Optional[int] = None
    guardian_name: Optional[str] = None
    guardian_name_ar: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    activities: Optional[List[MemberActivity]] = None
    branch_id: Optional[str] = None
    preferred_language: Optional[str] = None

class Member(MemberBase):
    id: str
    member_code: Optional[str] = None  # كود العضو التسلسلي
    activities: List[MemberActivity] = []
    branch_id: Optional[str] = None
    created_at: str

class InvoiceItem(BaseModel):
    activity_id: str
    activity_name: str
    fee: float
    period: str
    schedule: Optional[str] = ""  # جدول المواعيد
    level_id: Optional[str] = ""  # المستوى
    level_name: Optional[str] = ""
    start_date: Optional[str] = ""  # تاريخ البداية
    end_date: Optional[str] = ""  # تاريخ النهاية
    training_days: Optional[List[str]] = []
    training_time: Optional[str] = ""
    training_time_hour: Optional[str] = ""
    # Product fields for store items
    is_product: Optional[bool] = False
    product_id: Optional[str] = None
    quantity: Optional[int] = 1

# Company registration info
COMPANY_TAX_NUMBER = "312655637900003"
COMPANY_COMMERCIAL_REG = "7043630230"
VAT_RATE = 0.15  # 15% VAT

class InvoiceCreate(BaseModel):
    member_id: Optional[str] = None  # Optional - can create invoice without existing member
    items: List[InvoiceItem]
    discount: float = 0
    discount_code: Optional[str] = None  # Coupon code for tracking usage
    notes: Optional[str] = ""
    payment_method: str = "cash"  # cash, card, transfer, stripe
    # Customer data fields
    customer_name_ar: Optional[str] = ""
    customer_phone: Optional[str] = ""
    customer_address: Optional[str] = ""
    branch_id: Optional[str] = None  # Admin can specify branch

class Invoice(BaseModel):
    id: str
    invoice_number: Optional[str] = None
    member_id: Optional[str] = None
    member_name: Optional[str] = ""
    member_code: Optional[str] = ""
    items: List[InvoiceItem]
    subtotal: float
    discount: float
    vat_amount: float = 0
    total: float
    status: str = "pending"  # pending, paid, cancelled
    payment_method: str
    notes: Optional[str] = ""
    branch_id: Optional[str] = None
    created_at: str
    paid_at: Optional[str] = None
    # Customer data stored with invoice
    customer_name_ar: Optional[str] = ""
    customer_phone: Optional[str] = ""
    customer_address: Optional[str] = ""
    # Supervisor/Employee who created the invoice
    supervisor_name: Optional[str] = ""
    # Company info
    tax_number: str = COMPANY_TAX_NUMBER
    commercial_reg: str = COMPANY_COMMERCIAL_REG
    # Registration form reference
    registration_form_id: Optional[str] = None

class MessageCreate(BaseModel):
    recipients: List[str]  # member IDs
    message: str
    message_type: str = "custom"  # payment_reminder, expiry_alert, promotion, custom

# ============ STORE/INVENTORY MODELS ============

class ProductCreate(BaseModel):
    name_ar: str
    name: Optional[str] = ""
    category: str = "swimming"  # swimming, sports, accessories
    sku: Optional[str] = ""
    price: float
    cost: float = 0
    quantity: int = 0
    min_quantity: int = 5
    description: Optional[str] = ""

class Product(BaseModel):
    id: str
    name_ar: str
    name: Optional[str] = ""
    category: str
    sku: str
    price: float
    cost: float
    quantity: int
    min_quantity: int
    description: Optional[str] = ""
    branch_id: Optional[str] = None
    created_at: str
    updated_at: str

# ============ DISCOUNT/COUPON MODELS ============

class DiscountCreate(BaseModel):
    code: str
    name_ar: str
    name: Optional[str] = ""
    discount_type: str = "percentage"  # percentage or fixed
    value: float  # percentage (0-100) or fixed amount
    min_purchase: float = 0
    max_uses: int = 0  # 0 = unlimited
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    is_active: bool = True
    branch_id: Optional[str] = None  # Admin can specify branch for coupon

class Discount(BaseModel):
    id: str
    code: str
    name_ar: str
    name: Optional[str] = ""
    discount_type: str
    value: float
    min_purchase: float
    max_uses: int
    used_count: int = 0
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    is_active: bool
    branch_id: Optional[str] = None
    created_at: str

# ============ BRANCH MODELS ============

class BranchBase(BaseModel):
    name: str
    name_ar: str
    phone: str
    manager_name: Optional[str] = ""
    manager_name_ar: Optional[str] = ""
    address: Optional[str] = ""
    address_ar: Optional[str] = ""
    is_active: bool = True
    whatsapp_group_url: Optional[str] = ""

class BranchCreate(BranchBase):
    pass

class Branch(BranchBase):
    id: str
    created_at: str

# ============ REGISTRATION FORM MODELS ============

class RegistrationFormItem(BaseModel):
    activity_id: Optional[str] = ""
    product_id: Optional[str] = ""
    activity_name: str
    fee: float
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    period: Optional[str] = ""
    schedule: Optional[str] = ""
    level_id: Optional[str] = ""
    level_name: Optional[str] = ""
    training_days: Optional[List[str]] = []
    training_time: Optional[str] = ""
    training_time_hour: Optional[str] = ""
    is_product: bool = False
    quantity: int = 1

class RegFormAdditionalMember(BaseModel):
    member_id: str
    member_name: Optional[str] = ""
    member_code: Optional[str] = ""
    items: List[RegistrationFormItem]

class RegistrationFormCreate(BaseModel):
    customer_name: str
    customer_phone: str
    items: List[RegistrationFormItem]
    subtotal: float
    discount: float = 0
    discount_code: Optional[str] = ""
    vat_amount: float
    total: float
    payment_method: str = "cash"
    notes: Optional[str] = ""
    branch_id: Optional[str] = None
    additional_members: Optional[List[RegFormAdditionalMember]] = None

class RegistrationForm(BaseModel):
    id: str
    form_number: str
    customer_name: str
    customer_phone: str
    items: List[RegistrationFormItem]
    subtotal: float
    discount: float
    discount_code: Optional[str] = ""
    vat_amount: float
    total: float
    payment_method: str
    notes: Optional[str] = ""
    branch_id: Optional[str] = None
    created_at: str
    status: str = "pending"  # pending, converted, cancelled
    is_checked: Optional[bool] = False

# ============ LEVELS MODELS ============

class LevelMember(BaseModel):
    member_id: str
    member_name: Optional[str] = ""
    phone: Optional[str] = ""

class LevelCreate(BaseModel):
    level_number: int  # 1, 2, 3, 4, 5, 6
    activity_name: str  # Manual activity name
    description: Optional[str] = ""
    members: List[str] = []  # List of member IDs
    branch_id: Optional[str] = None

class Level(BaseModel):
    id: str
    level_number: int
    activity_name: str
    description: Optional[str] = ""
    members: List[str] = []
    members_details: List[LevelMember] = []
    branch_id: Optional[str] = None
    created_at: str

class ReportFilter(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    activity_id: Optional[str] = None
    coach_id: Optional[str] = None
    period: str = "monthly"  # daily, monthly, yearly

# ============ CREDIT NOTE (REFUND INVOICE) MODELS ============

class CreditNoteItem(BaseModel):
    activity_id: Optional[str] = ""
    product_id: Optional[str] = ""
    activity_name: str
    fee: float
    quantity: int = 1
    period: Optional[str] = ""
    schedule: Optional[str] = ""
    is_product: bool = False

class CreditNoteCreate(BaseModel):
    original_invoice_id: str
    original_invoice_number: str
    items: List[CreditNoteItem]
    refund_amount: float
    reason: Optional[str] = ""
    notes: Optional[str] = ""

class CreditNote(BaseModel):
    id: str
    credit_note_number: str
    original_invoice_id: str
    original_invoice_number: str
    customer_name_ar: str
    customer_phone: str
    items: List[CreditNoteItem]
    subtotal: float
    vat_amount: float
    refund_amount: float
    reason: Optional[str] = ""
    notes: Optional[str] = ""
    branch_id: Optional[str] = None
    created_by: Optional[str] = ""
    created_at: str

# ============ AUTH HELPERS ============

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_token(user_id: str, username: str, branch_id: str = None, is_admin: bool = False, tenant_slug: Optional[str] = None) -> str:
    from utils.tenant import get_current_tenant_slug, DEFAULT_TENANT_SLUG
    payload = {
        "user_id": user_id,
        "username": username,
        "branch_id": branch_id,
        "is_admin": is_admin,
        "tenant_slug": tenant_slug or get_current_tenant_slug() or DEFAULT_TENANT_SLUG,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _enforce_tenant_match_local(payload: dict):
    from utils.tenant import get_current_tenant_slug, DEFAULT_TENANT_SLUG
    if payload.get("scope") == "super":
        raise HTTPException(status_code=403, detail="Invalid token scope")
    if not payload.get("user_id") or not payload.get("username"):
        raise HTTPException(status_code=401, detail="Invalid token")
    token_tenant = payload.get("tenant_slug")
    if not token_tenant:
        raise HTTPException(status_code=401, detail="Token missing tenant — please log in again")
    current_tenant = get_current_tenant_slug() or DEFAULT_TENANT_SLUG
    if token_tenant != current_tenant:
        raise HTTPException(status_code=403, detail="Tenant mismatch")


def _require_export_admin_token(token: Optional[str]):
    """Validate a query-string JWT for export endpoints and require admin.

    Supervisors (is_admin=False) are blocked from data exports — only the
    Daily Ledger (which exports client-side) remains accessible to them.
    """
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    _enforce_tenant_match_local(payload)
    if not payload.get("is_admin"):
        raise HTTPException(
            status_code=403,
            detail="غير مصرح: التصدير متاح للمدير فقط",
        )
    return payload


def _require_admin_export_user(current_user: dict):
    """Same guard for routes using Depends(get_current_user[_from_token])."""
    if not current_user or not current_user.get("is_admin"):
        raise HTTPException(
            status_code=403,
            detail="غير مصرح: التصدير متاح للمدير فقط",
        )


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    _enforce_tenant_match_local(payload)
    return payload

async def get_current_user_from_token(token: Optional[str] = None, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Support both Bearer token and query parameter token for exports"""
    actual_token = token
    if not actual_token and credentials:
        actual_token = credentials.credentials
    if not actual_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(actual_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    _enforce_tenant_match_local(payload)
    return payload

# ============ AUTH ROUTES ============

@api_router.post("/auth/register", response_model=TokenResponse)
async def register(user: UserCreate):
    existing = await db.users.find_one({"username": user.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "username": user.username,
        "password": hash_password(user.password),
        "name": user.name,
        "branch_id": None,  # Will be assigned later
        "is_admin": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    token = create_token(user_id, user.username, None, False)
    return TokenResponse(
        access_token=token,
        user={"id": user_id, "username": user.username, "name": user.name, "branch_id": None, "is_admin": False}
    )

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    from utils.audit import log_login
    try:
        user = await db.users.find_one({"username": credentials.username}, {"_id": 0})
        if not user:
            await log_login(username=credentials.username, success=False)
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        stored_password = user.get("password", "")
        # Handle both bytes and str stored passwords
        if isinstance(stored_password, bytes):
            pass  # already bytes
        else:
            stored_password = stored_password.encode("utf-8")
        
        try:
            password_ok = bcrypt.checkpw(credentials.password.encode("utf-8"), stored_password)
        except Exception as e:
            print(f"Password verification error for user {credentials.username}: {e}")
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        if not password_ok:
            await log_login(username=credentials.username, success=False)
            raise HTTPException(status_code=401, detail="Invalid credentials")

        branch_id = user.get("branch_id")
        is_admin = user.get("is_admin", False)

        await log_login(username=credentials.username, success=True, user=user)
        token = create_token(user["id"], user["username"], branch_id, is_admin)
        return TokenResponse(
            access_token=token,
            user={"id": user["id"], "username": user["username"], "name": user.get("name", user["username"]), "branch_id": branch_id, "is_admin": is_admin}
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Login error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"Login error: {str(e)}")

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@api_router.post("/auth/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    """Record an audit entry when a user signs out.

    Tokens are stateless JWTs, so the client is responsible for discarding
    them. This endpoint exists purely so reviewers can see when a session
    ended in the audit timeline.
    """
    from utils.audit import log_audit
    await log_audit(
        actor=current_user,
        action="auth.logout",
        entity_type="user",
        entity_id=current_user.get("user_id", ""),
        entity_name=current_user.get("username", ""),
    )
    return {"message": "Logged out"}

# ============ ROUTES MOVED TO /routes/ DIRECTORY ============
# - Users: routes/users.py
# - Branches: routes/branches.py
# - Activities: routes/activities.py
# - Coaches: routes/coaches.py
# - Levels: routes/levels.py
# - Members: routes/members.py
# - Invoices (basic CRUD): routes/invoices.py
# - Attendance: routes/attendance.py
# - Notifications: routes/notifications.py

# ============ ADDITIONAL INVOICES ROUTES (Extended functionality beyond routes/invoices.py) ============

# Invoice branch update
@api_router.put("/invoices/{invoice_id}/branch")
async def update_invoice_branch(invoice_id: str, branch_id: str, current_user: dict = Depends(get_current_user)):
    """Update invoice branch"""
    invoice = await db.invoices.find_one({"id": invoice_id})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    # Verify branch exists
    if branch_id and branch_id != "all":
        branch = await db.branches.find_one({"id": branch_id})
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found")
    
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"branch_id": branch_id if branch_id != "all" else None}}
    )
    return {"message": "Invoice branch updated", "branch_id": branch_id}

# ============ INVOICE/REG FORM CHECK TOGGLE ============

@api_router.post("/invoices/{invoice_id}/toggle-check")
async def toggle_invoice_check(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    new_val = not invoice.get("is_checked", False)
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"is_checked": new_val}})
    return {"is_checked": new_val}

@api_router.post("/registration-forms/{form_id}/toggle-check")
async def toggle_reg_form_check(form_id: str, current_user: dict = Depends(get_current_user)):
    form = await db.registration_forms.find_one({"id": form_id})
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    new_val = not form.get("is_checked", False)
    await db.registration_forms.update_one({"id": form_id}, {"$set": {"is_checked": new_val}})
    return {"is_checked": new_val}

# ============ CREDIT NOTES (REFUND INVOICES) ROUTES ============

class RefundRequest(BaseModel):
    amount: float
    reason: Optional[str] = ""
    refund_type: str = "full"  # full or partial
    items: Optional[List[dict]] = None  # Items to refund (for partial)

@api_router.get("/credit-notes", response_model=List[CreditNote])
async def get_credit_notes(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all credit notes (refund invoices)"""
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
    credit_notes = await db.credit_notes.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return credit_notes

@api_router.get("/credit-notes/{credit_note_id}", response_model=CreditNote)
async def get_credit_note(credit_note_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single credit note"""
    credit_note = await db.credit_notes.find_one({"id": credit_note_id}, {"_id": 0})
    if not credit_note:
        raise HTTPException(status_code=404, detail="Credit note not found")
    return credit_note

@api_router.post("/invoices/{invoice_id}/refund")
async def refund_invoice(invoice_id: str, refund: RefundRequest, current_user: dict = Depends(get_current_user)):
    """Process a refund for a paid invoice - Creates a Credit Note"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if invoice["status"] != "paid":
        raise HTTPException(status_code=400, detail="Can only refund paid invoices")
    
    if refund.amount <= 0 or refund.amount > invoice["total"]:
        raise HTTPException(status_code=400, detail="Invalid refund amount")
    
    # Generate credit note number
    last_cn = await db.credit_notes.find_one(
        {"credit_note_number": {"$exists": True}},
        sort=[("created_at", -1)]
    )
    if last_cn and last_cn.get("credit_note_number"):
        cn_num = last_cn["credit_note_number"]
        try:
            num_part = int(cn_num.replace("CN-", ""))
            next_cn_number = f"CN-{num_part + 1:05d}"
        except ValueError:
            next_cn_number = "CN-00001"
    else:
        next_cn_number = "CN-00001"
    
    # Determine items to refund
    refund_items = []
    if refund.refund_type == "full":
        # Full refund - include all items
        for item in invoice.get("items", []):
            refund_items.append({
                "activity_id": item.get("activity_id", ""),
                "product_id": item.get("product_id", ""),
                "activity_name": item.get("activity_name", ""),
                "fee": item.get("fee", 0),
                "quantity": item.get("quantity", 1),
                "period": item.get("period", ""),
                "schedule": item.get("schedule", ""),
                "is_product": item.get("is_product", False)
            })
    elif refund.items:
        # Partial refund with specific items
        refund_items = refund.items
    else:
        # Partial refund without items - create a general refund item
        refund_items = [{
            "activity_id": "",
            "product_id": "",
            "activity_name": "مرتجع جزئي" if refund.refund_type == "partial" else "مرتجع",
            "fee": refund.amount,
            "quantity": 1,
            "period": "",
            "schedule": "",
            "is_product": False
        }]
    
    # Calculate VAT for refund (15%)
    subtotal = refund.amount / 1.15
    vat_amount = refund.amount - subtotal
    
    # Get supervisor name
    user_doc = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    created_by = user_doc.get("name", current_user.get("username", "")) if user_doc else current_user.get("username", "")
    
    # Create Credit Note
    credit_note_id = str(uuid.uuid4())
    credit_note = {
        "id": credit_note_id,
        "credit_note_number": next_cn_number,
        "original_invoice_id": invoice_id,
        "original_invoice_number": invoice.get("invoice_number", ""),
        "customer_name_ar": invoice.get("customer_name_ar") or invoice.get("member_name", ""),
        "customer_phone": invoice.get("customer_phone", ""),
        "items": refund_items,
        "subtotal": round(subtotal, 2),
        "vat_amount": round(vat_amount, 2),
        "refund_amount": refund.amount,
        "reason": refund.reason,
        "notes": f"مرتجع {'كامل' if refund.refund_type == 'full' else 'جزئي'} للفاتورة رقم {invoice.get('invoice_number', '')}",
        "branch_id": invoice.get("branch_id"),
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.credit_notes.insert_one(credit_note)
    
    # Update invoice with refund reference (but don't change original data)
    refund_info = {
        "has_refund": True,
        "refund_type": refund.refund_type,
        "credit_note_id": credit_note_id,
        "credit_note_number": next_cn_number,
        "refund_amount": refund.amount,
        "refunded_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Only update status if full refund
    update_data = {**refund_info}
    if refund.refund_type == "full":
        update_data["status"] = "refunded"
    else:
        update_data["status"] = "partially_refunded"
    
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": update_data}
    )
    
    # On full refund: remove member activities and related data
    if refund.refund_type == "full":
        member_id = invoice.get("member_id")
        registration_form_id = invoice.get("registration_form_id")
        
        if member_id:
            # Collect source_ids to remove from member activities
            source_ids_to_remove = {invoice_id}
            if registration_form_id:
                source_ids_to_remove.add(registration_form_id)
            
            # Fetch member and filter out refunded activities
            member_doc = await db.members.find_one({"id": member_id}, {"_id": 0, "activities": 1})
            if member_doc:
                kept = [
                    act for act in member_doc.get("activities", [])
                    if act.get("source_id") not in source_ids_to_remove
                ]
                await db.members.update_one(
                    {"id": member_id},
                    {"$set": {"activities": kept}}
                )
                # Delete attendance records for refunded activity IDs
                refunded_activity_ids = [
                    item.get("activity_id") for item in invoice.get("items", [])
                    if item.get("activity_id")
                ]
                if refunded_activity_ids:
                    await db.attendance.delete_many({
                        "member_id": member_id,
                        "activity_id": {"$in": refunded_activity_ids}
                    })
        
        # Delete the linked registration form if present
        if registration_form_id:
            await db.registration_forms.delete_one({"id": registration_form_id})
    
    # Remove _id before returning
    if "_id" in credit_note:
        del credit_note["_id"]
    
    return {
        "message": f"تم إنشاء إشعار دائن بمبلغ {refund.amount} ر.س",
        "credit_note": credit_note
    }

@api_router.delete("/credit-notes/{credit_note_id}")
async def delete_credit_note(credit_note_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a credit note (admin only)"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    credit_note = await db.credit_notes.find_one({"id": credit_note_id}, {"_id": 0})
    if not credit_note:
        raise HTTPException(status_code=404, detail="Credit note not found")
    
    # Remove refund reference from original invoice
    await db.invoices.update_one(
        {"id": credit_note["original_invoice_id"]},
        {"$unset": {"has_refund": "", "refund_type": "", "credit_note_id": "", "credit_note_number": "", "refund_amount": "", "refunded_at": ""},
         "$set": {"status": "paid"}}
    )
    
    result = await db.credit_notes.delete_one({"id": credit_note_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Credit note not found")
    
    return {"message": "Credit note deleted"}

# ============ REGISTRATION FORMS ROUTES ============

@api_router.get("/registration-forms")
async def get_registration_forms(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all registration forms, optionally filtered by branch"""
    query = {}
    
    # Filter by branch
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not current_user.get("is_admin") and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
    forms = await db.registration_forms.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return forms

@api_router.post("/registration-forms")
async def create_registration_form(
    form: RegistrationFormCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a new registration form"""
    # Look up existing member by phone first so we can use their branch
    existing_member_for_branch = None
    if form.customer_phone:
        existing_member_for_branch = await db.members.find_one(
            {"phone": form.customer_phone}, {"_id": 0, "branch_id": 1}
        )

    # Determine branch: explicit choice > member's branch > current user's branch
    is_admin = current_user.get("is_admin", False)
    if is_admin and form.branch_id and form.branch_id != "all":
        branch_id = form.branch_id
    elif existing_member_for_branch and existing_member_for_branch.get("branch_id"):
        branch_id = existing_member_for_branch["branch_id"]
    elif not is_admin:
        branch_id = current_user.get("branch_id")
    else:
        branch_id = form.branch_id or current_user.get("branch_id")

    # Generate form number per branch – unique across branches
    reg_seq_start = await _get_branch_seq_start(branch_id, "reg")
    branch_reg_filter = {"branch_id": branch_id} if branch_id else {}
    all_regs = await db.registration_forms.find(
        {"form_number": {"$exists": True}, **branch_reg_filter},
        {"form_number": 1, "_id": 0}
    ).to_list(10000)
    max_reg = reg_seq_start - 1
    for r in all_regs:
        try:
            num = int(r["form_number"].replace("REG-", ""))
            if num > max_reg:
                max_reg = num
        except (ValueError, KeyError):
            continue
    next_reg = max(max_reg + 1, reg_seq_start)
    form_number = f"REG-{next_reg:05d}"
    
    form_doc = {
        "id": str(uuid.uuid4()),
        "form_number": form_number,
        "customer_name": form.customer_name,
        "customer_phone": form.customer_phone,
        "items": [item.dict() for item in form.items],
        "subtotal": form.subtotal,
        "discount": form.discount,
        "discount_code": form.discount_code,
        "vat_amount": form.vat_amount,
        "total": form.total,
        "payment_method": form.payment_method,
        "notes": form.notes,
        "branch_id": branch_id,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.registration_forms.insert_one(form_doc)
    
    # Find or create member by phone and add to levels if specified
    member_id = None
    member_code = None
    if form.customer_phone:
        member = await db.members.find_one({"phone": form.customer_phone}, {"_id": 0, "id": 1, "member_code": 1, "branch_id": 1})
        if member:
            member_id = member["id"]
            member_code = member.get("member_code")
            # If existing member has no branch, assign the form's branch
            if branch_id and not member.get("branch_id"):
                await db.members.update_one(
                    {"id": member_id},
                    {"$set": {"branch_id": branch_id}}
                )
        else:
            # Create new member from registration form data
            # Generate per-branch member code in {PREFIX}-NNN format
            from utils.member_code import generate_member_code
            next_member_code = await generate_member_code(branch_id)
            member_id = str(uuid.uuid4())
            member_code = next_member_code
            
            new_member = {
                "id": member_id,
                "member_code": next_member_code,
                "name_ar": form.customer_name,
                "name": form.customer_name,
                "phone": form.customer_phone,
                "email": "",
                "date_of_birth": "",
                "age": 0,
                "gender": "",
                "address": "",
                "guardian_name": "",
                "guardian_name_ar": "",
                "guardian_phone": "",
                "activities": [],
                "status": "active",
                "branch_id": branch_id,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            await db.members.insert_one(new_member)
    
    # Update the registration form with member_id and member_code
    if member_id:
        await db.registration_forms.update_one(
            {"id": form_doc["id"]},
            {"$set": {"member_id": member_id, "member_code": member_code}}
        )
        form_doc["member_id"] = member_id
        form_doc["member_code"] = member_code
    
    # Add activities to member and add member to levels
    if member_id:
        activities_to_add = []
        for item in form.items:
            item_dict = item.dict() if hasattr(item, 'dict') else item
            activity_id = item_dict.get("activity_id")
            level_id = item_dict.get("level_id")
            start_date = item_dict.get("start_date", "")
            end_date = item_dict.get("end_date", "")
            schedule = item_dict.get("schedule", "")
            fee = item_dict.get("fee", 0)
            
            # Add activity to member's activities list
            if activity_id:
                activity = await db.activities.find_one({"id": activity_id}, {"_id": 0, "name_ar": 1, "name": 1})
                if activity:
                    activity_entry = {
                        "activity_id": activity_id,
                        "activity_name": activity.get("name_ar") or activity.get("name", ""),
                        "level_id": level_id,
                        "start_date": start_date,
                        "end_date": end_date,
                        "fee": fee,
                        "schedule": schedule,
                        "status": "active",
                        "source": "registration_form",
                        "source_id": form_doc["id"]
                    }
                    activities_to_add.append(activity_entry)
            
            # Add member to level if specified
            if level_id:
                await db.levels.update_one(
                    {"id": level_id},
                    {"$addToSet": {"members": member_id}}
                )
                # Store end_date for auto-removal
                if end_date:
                    await db.level_subscriptions.update_one(
                        {"member_id": member_id, "level_id": level_id},
                        {"$set": {"end_date": end_date, "member_id": member_id, "level_id": level_id}},
                        upsert=True
                    )
        
        # Update member with activities
        if activities_to_add:
            await db.members.update_one(
                {"id": member_id},
                {"$push": {"activities": {"$each": activities_to_add}}}
            )
    
    # Process additional members (siblings)
    if form.additional_members:
        additional_members_data = []
        for am in form.additional_members:
            am_member = await db.members.find_one({"id": am.member_id}, {"_id": 0})
            if not am_member:
                continue
            
            am_name = am.member_name or am_member.get("name_ar", am_member.get("name", ""))
            am_code = am.member_code or am_member.get("member_code", "")
            additional_members_data.append({
                "member_id": am.member_id,
                "member_name": am_name,
                "member_code": am_code,
                "items": [item.dict() for item in am.items]
            })
            
            am_activities_to_add = []
            for item in am.items:
                item_dict = item.dict() if hasattr(item, 'dict') else item
                activity_id = item_dict.get("activity_id")
                level_id = item_dict.get("level_id")
                start_date = item_dict.get("start_date", "")
                end_date = item_dict.get("end_date", "")
                schedule = item_dict.get("schedule", "")
                fee = item_dict.get("fee", 0)
                
                if activity_id:
                    activity = await db.activities.find_one({"id": activity_id}, {"_id": 0, "name_ar": 1, "name": 1})
                    if activity:
                        am_activities_to_add.append({
                            "activity_id": activity_id,
                            "activity_name": activity.get("name_ar") or activity.get("name", ""),
                            "level_id": level_id,
                            "start_date": start_date,
                            "end_date": end_date,
                            "fee": fee,
                            "schedule": schedule,
                            "status": "active",
                            "source": "registration_form",
                            "source_id": form_doc["id"]
                        })
                
                if level_id:
                    await db.levels.update_one(
                        {"id": level_id},
                        {"$addToSet": {"members": am.member_id}}
                    )
                    if end_date:
                        await db.level_subscriptions.update_one(
                            {"member_id": am.member_id, "level_id": level_id},
                            {"$set": {"end_date": end_date, "member_id": am.member_id, "level_id": level_id}},
                            upsert=True
                        )
            
            if am_activities_to_add:
                await db.members.update_one(
                    {"id": am.member_id},
                    {"$push": {"activities": {"$each": am_activities_to_add}}}
                )
        
        if additional_members_data:
            await db.registration_forms.update_one(
                {"id": form_doc["id"]},
                {"$set": {"additional_members": additional_members_data}}
            )
            form_doc["additional_members"] = additional_members_data
    
    # Add member_id to form response
    if "_id" in form_doc:
        del form_doc["_id"]
    return form_doc

@api_router.get("/registration-forms/{form_id}")
async def get_registration_form(form_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single registration form by ID"""
    form = await db.registration_forms.find_one({"id": form_id}, {"_id": 0})
    if not form:
        raise HTTPException(status_code=404, detail="Registration form not found")
    return form

@api_router.put("/registration-forms/{form_id}")
async def update_registration_form(form_id: str, form_data: RegistrationFormCreate, current_user: dict = Depends(get_current_user)):
    """Update a registration form"""
    existing = await db.registration_forms.find_one({"id": form_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Registration form not found")
    
    if existing["status"] == "converted":
        raise HTTPException(status_code=400, detail="Cannot edit converted form")
    
    update_data = {
        "customer_name": form_data.customer_name,
        "customer_phone": form_data.customer_phone,
        "items": [item.model_dump() for item in form_data.items],
        "subtotal": form_data.subtotal,
        "discount": form_data.discount,
        "discount_code": form_data.discount_code,
        "vat_amount": form_data.vat_amount,
        "total": form_data.total,
        "payment_method": form_data.payment_method,
        "notes": form_data.notes,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.registration_forms.update_one(
        {"id": form_id},
        {"$set": update_data}
    )
    
    updated = await db.registration_forms.find_one({"id": form_id}, {"_id": 0})
    return updated

@api_router.put("/registration-forms/{form_id}/convert")
async def convert_registration_form(form_id: str, current_user: dict = Depends(get_current_user)):
    """Convert registration form to invoice and delete the form"""
    form = await db.registration_forms.find_one({"id": form_id}, {"_id": 0})
    if not form:
        raise HTTPException(status_code=404, detail="Registration form not found")
    
    if form["status"] == "converted":
        raise HTTPException(status_code=400, detail="Form already converted to invoice")
    
    # Create invoice from form – unique per branch
    form_branch_id = form.get("branch_id")
    inv_seq_start = await _get_branch_seq_start(form_branch_id, "invoice")
    branch_inv_filter = {"branch_id": form_branch_id} if form_branch_id else {}
    all_invs = await db.invoices.find(
        {"invoice_number": {"$exists": True}, **branch_inv_filter},
        {"invoice_number": 1, "_id": 0}
    ).to_list(100000)
    max_inv = inv_seq_start - 1
    for inv in all_invs:
        inv_num = inv.get("invoice_number", "")
        try:
            num = int(inv_num.replace("INV-", "")) if inv_num.startswith("INV-") else int(inv_num)
            if num > max_inv:
                max_inv = num
        except (ValueError, AttributeError):
            continue
    next_inv = max(max_inv + 1, inv_seq_start)
    invoice_number = f"INV-{next_inv:05d}"
    
    # Get supervisor name from current user
    user_doc = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    supervisor_name = user_doc.get("name", current_user.get("username", "")) if user_doc else current_user.get("username", "")
    
    invoice_doc = {
        "id": str(uuid.uuid4()),
        "invoice_number": invoice_number,
        "member_id": None,
        "customer_name_ar": form["customer_name"],
        "customer_phone": form["customer_phone"],
        "customer_address": "",
        "member_name": form["customer_name"],  # Use customer_name as member_name
        "items": form["items"],
        "subtotal": form["subtotal"],
        "discount": form["discount"],
        "discount_code": form.get("discount_code", ""),
        "vat_amount": form["vat_amount"],
        "total": form["total"],
        "payment_method": form["payment_method"],
        "notes": form.get("notes", "") + f"\n(من استمارة: {form['form_number']})",
        "status": "pending",
        "branch_id": form.get("branch_id"),
        "registration_form_id": form_id,
        "supervisor_name": supervisor_name,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.invoices.insert_one(invoice_doc)
    
    # Delete the registration form after conversion
    await db.registration_forms.delete_one({"id": form_id})
    
    del invoice_doc["_id"]
    return {"message": "Form converted to invoice and deleted", "invoice": invoice_doc}

@api_router.delete("/registration-forms/{form_id}")
async def delete_registration_form(form_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a registration form"""
    result = await db.registration_forms.delete_one({"id": form_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Registration form not found")
    return {"message": "Registration form deleted"}

@api_router.put("/registration-forms/{form_id}/branch")
async def update_registration_form_branch(form_id: str, branch_id: str, current_user: dict = Depends(get_current_user)):
    """Update registration form branch"""
    form = await db.registration_forms.find_one({"id": form_id})
    if not form:
        raise HTTPException(status_code=404, detail="Registration form not found")
    
    # Verify branch exists
    if branch_id and branch_id != "all":
        branch = await db.branches.find_one({"id": branch_id})
        if not branch:
            raise HTTPException(status_code=404, detail="Branch not found")
    
    await db.registration_forms.update_one(
        {"id": form_id},
        {"$set": {"branch_id": branch_id if branch_id != "all" else None}}
    )
    return {"message": "Registration form branch updated", "branch_id": branch_id}

@api_router.post("/registration-forms/migrate-member-codes")
async def migrate_registration_forms_member_codes(current_user: dict = Depends(get_current_user)):
    """Migrate existing registration forms to add member_code from members collection"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get all forms without member_code
    forms = await db.registration_forms.find(
        {"$or": [{"member_code": {"$exists": False}}, {"member_code": None}]},
        {"_id": 0}
    ).to_list(1000)
    
    updated_count = 0
    for form in forms:
        phone = form.get("customer_phone")
        if phone:
            # Find member by phone
            member = await db.members.find_one({"phone": phone}, {"_id": 0, "id": 1, "member_code": 1})
            if member:
                await db.registration_forms.update_one(
                    {"id": form["id"]},
                    {"$set": {"member_id": member["id"], "member_code": member.get("member_code")}}
                )
                updated_count += 1
    
    return {"message": f"Updated {updated_count} registration forms with member codes"}

# ============ STRIPE PAYMENT ROUTES ============

@api_router.post("/payments/checkout")
async def create_checkout_session(
    request: Request,
    invoice_id: str,
    current_user: dict = Depends(get_current_user)
):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if invoice["status"] == "paid":
        raise HTTPException(status_code=400, detail="Invoice already paid")
    
    host_url = str(request.base_url).rstrip('/')
    webhook_url = f"{host_url}/api/webhook/stripe"
    
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    
    frontend_url = request.headers.get("origin", host_url)
    success_url = f"{frontend_url}/invoices?session_id={{CHECKOUT_SESSION_ID}}&invoice_id={invoice_id}"
    cancel_url = f"{frontend_url}/invoices"
    
    checkout_request = CheckoutSessionRequest(
        amount=float(invoice["total"]),
        currency="sar",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "invoice_id": invoice_id,
            "member_id": invoice["member_id"]
        }
    )
    
    session = await stripe_checkout.create_checkout_session(checkout_request)
    
    # Create payment transaction record
    transaction_doc = {
        "id": str(uuid.uuid4()),
        "session_id": session.session_id,
        "invoice_id": invoice_id,
        "amount": invoice["total"],
        "currency": "SAR",
        "status": "pending",
        "payment_status": "initiated",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.payment_transactions.insert_one(transaction_doc)
    
    return {"url": session.url, "session_id": session.session_id}

@api_router.get("/payments/status/{session_id}")
async def get_payment_status(session_id: str, current_user: dict = Depends(get_current_user)):
    transaction = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    host_url = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")
    webhook_url = f"{host_url}/api/webhook/stripe"
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    
    checkout_status = await stripe_checkout.get_checkout_status(session_id)
    
    # Update transaction status
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {
            "status": checkout_status.status,
            "payment_status": checkout_status.payment_status
        }}
    )
    
    # If payment is successful, update invoice
    if checkout_status.payment_status == "paid":
        await db.invoices.update_one(
            {"id": transaction["invoice_id"]},
            {"$set": {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat(), "payment_method": "stripe"}}
        )
    
    return {
        "status": checkout_status.status,
        "payment_status": checkout_status.payment_status,
        "invoice_id": transaction["invoice_id"]
    }

@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("Stripe-Signature")
    
    host_url = str(request.base_url).rstrip('/')
    webhook_url = f"{host_url}/api/webhook/stripe"
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    
    try:
        webhook_response = await stripe_checkout.handle_webhook(body, signature)
        
        if webhook_response.payment_status == "paid":
            invoice_id = webhook_response.metadata.get("invoice_id")
            if invoice_id:
                await db.invoices.update_one(
                    {"id": invoice_id},
                    {"$set": {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat(), "payment_method": "stripe"}}
                )
                await db.payment_transactions.update_one(
                    {"session_id": webhook_response.session_id},
                    {"$set": {"status": "complete", "payment_status": "paid"}}
                )
        
        return {"received": True}
    except Exception as e:
        logger.error(f"Webhook error: {str(e)}")
        return {"received": True}

# ============ REPORTS ROUTES ============

# ============ STORE/INVENTORY ROUTES ============

@api_router.get("/products")
async def get_products(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all products"""
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    # Admin can filter by any branch
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
    products = await db.products.find(query, {"_id": 0}).to_list(1000)
    return products

@api_router.post("/products")
async def create_product(product: ProductCreate, current_user: dict = Depends(get_current_user)):
    """Create a new product"""
    product_id = str(uuid.uuid4())
    sku = product.sku or f"SKU-{product_id[:8].upper()}"
    
    product_doc = {
        "id": product_id,
        "name_ar": product.name_ar,
        "name": product.name,
        "category": product.category,
        "sku": sku,
        "price": product.price,
        "cost": product.cost,
        "quantity": product.quantity,
        "min_quantity": product.min_quantity,
        "description": product.description,
        "branch_id": current_user.get("branch_id"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.products.insert_one(product_doc)
    product_doc.pop("_id", None)
    return product_doc

@api_router.put("/products/{product_id}")
async def update_product(product_id: str, product: ProductCreate, current_user: dict = Depends(get_current_user)):
    """Update a product"""
    update_data = {
        "name_ar": product.name_ar,
        "name": product.name,
        "category": product.category,
        "price": product.price,
        "cost": product.cost,
        "quantity": product.quantity,
        "min_quantity": product.min_quantity,
        "description": product.description,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    if product.sku:
        update_data["sku"] = product.sku
    
    result = await db.products.find_one_and_update(
        {"id": product_id},
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Product not found")
    
    result.pop("_id", None)
    return result

@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a product"""
    result = await db.products.delete_one({"id": product_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"message": "Product deleted"}

@api_router.put("/products/{product_id}/stock")
async def update_stock(product_id: str, quantity_change: int, current_user: dict = Depends(get_current_user)):
    """Update product stock (add or remove)"""
    product = await db.products.find_one({"id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    new_quantity = product["quantity"] + quantity_change
    if new_quantity < 0:
        raise HTTPException(status_code=400, detail="Insufficient stock")
    
    await db.products.update_one(
        {"id": product_id},
        {"$set": {"quantity": new_quantity, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"product_id": product_id, "new_quantity": new_quantity}

@api_router.get("/products/low-stock")
async def get_low_stock_products(current_user: dict = Depends(get_current_user)):
    """Get products with low stock"""
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    pipeline = [
        {"$match": {"$expr": {"$lte": ["$quantity", "$min_quantity"]}}},
    ]
    if not is_admin and branch_id:
        pipeline.insert(0, {"$match": {"branch_id": branch_id}})
    
    products = await db.products.aggregate(pipeline).to_list(100)
    for p in products:
        p.pop("_id", None)
    return products

# ============ DISCOUNT/COUPON ROUTES ============

@api_router.get("/discounts")
async def get_discounts(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all discounts"""
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    # Admin can filter by any branch
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
    discounts = await db.discounts.find(query, {"_id": 0}).to_list(1000)
    return discounts

@api_router.post("/discounts")
async def create_discount(discount: DiscountCreate, current_user: dict = Depends(get_current_user)):
    """Create a new discount coupon"""
    # Check if code already exists
    existing = await db.discounts.find_one({"code": discount.code.upper()})
    if existing:
        raise HTTPException(status_code=400, detail="Discount code already exists")
    
    is_admin = current_user.get("is_admin", False)
    
    # Determine branch_id: admin can specify, otherwise use user's branch
    if is_admin and discount.branch_id:
        final_branch_id = discount.branch_id if discount.branch_id != "all" else None
    else:
        final_branch_id = current_user.get("branch_id")
    
    discount_id = str(uuid.uuid4())
    discount_doc = {
        "id": discount_id,
        "code": discount.code.upper(),
        "name_ar": discount.name_ar,
        "name": discount.name,
        "discount_type": discount.discount_type,
        "value": discount.value,
        "min_purchase": discount.min_purchase,
        "max_uses": discount.max_uses,
        "used_count": 0,
        "valid_from": discount.valid_from,
        "valid_until": discount.valid_until,
        "is_active": discount.is_active,
        "branch_id": final_branch_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.discounts.insert_one(discount_doc)
    discount_doc.pop("_id", None)
    return discount_doc

@api_router.put("/discounts/{discount_id}")
async def update_discount(discount_id: str, discount: DiscountCreate, current_user: dict = Depends(get_current_user)):
    """Update a discount"""
    is_admin = current_user.get("is_admin", False)
    
    update_data = {
        "code": discount.code.upper(),
        "name_ar": discount.name_ar,
        "name": discount.name,
        "discount_type": discount.discount_type,
        "value": discount.value,
        "min_purchase": discount.min_purchase,
        "max_uses": discount.max_uses,
        "valid_from": discount.valid_from,
        "valid_until": discount.valid_until,
        "is_active": discount.is_active
    }
    
    # Admin can update branch_id
    if is_admin and discount.branch_id is not None:
        update_data["branch_id"] = discount.branch_id if discount.branch_id != "all" else None
    
    result = await db.discounts.find_one_and_update(
        {"id": discount_id},
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Discount not found")
    
    result.pop("_id", None)
    return result

@api_router.delete("/discounts/{discount_id}")
async def delete_discount(discount_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a discount"""
    result = await db.discounts.delete_one({"id": discount_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Discount not found")
    return {"message": "Discount deleted"}

@api_router.post("/discounts/validate")
async def validate_discount(code: str, subtotal: float, current_user: dict = Depends(get_current_user)):
    """Validate a discount code and return discount amount"""
    discount = await db.discounts.find_one({"code": code.upper(), "is_active": True}, {"_id": 0})
    if not discount:
        raise HTTPException(status_code=404, detail="Invalid discount code")
    
    # Check validity dates
    now = datetime.now(timezone.utc).isoformat()
    if discount.get("valid_from") and now < discount["valid_from"]:
        raise HTTPException(status_code=400, detail="Discount not yet active")
    if discount.get("valid_until") and now > discount["valid_until"]:
        raise HTTPException(status_code=400, detail="Discount has expired")
    
    # Check usage limit
    if discount["max_uses"] > 0 and discount["used_count"] >= discount["max_uses"]:
        raise HTTPException(status_code=400, detail="Discount usage limit reached")
    
    # Check minimum purchase
    if subtotal < discount["min_purchase"]:
        raise HTTPException(status_code=400, detail=f"Minimum purchase of {discount['min_purchase']} SAR required")
    
    # Calculate discount amount
    if discount["discount_type"] == "percentage":
        discount_amount = round(subtotal * (discount["value"] / 100), 2)
    else:
        discount_amount = min(discount["value"], subtotal)
    
    return {
        "valid": True,
        "discount": discount,
        "discount_amount": discount_amount
    }

# ============ INVOICE UPDATE ROUTE ============

@api_router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, invoice: InvoiceCreate, current_user: dict = Depends(get_current_user)):
    """Update a pending invoice"""
    existing = await db.invoices.find_one({"id": invoice_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if existing["status"] != "pending":
        raise HTTPException(status_code=400, detail="Can only edit pending invoices")
    
    # Calculate totals
    subtotal = sum(item.fee for item in invoice.items)
    discount = invoice.discount
    subtotal_after_discount = subtotal - discount
    vat_amount = round(subtotal_after_discount * VAT_RATE, 2)
    total = round(subtotal_after_discount + vat_amount, 2)
    
    update_data = {
        "items": [item.dict() for item in invoice.items],
        "subtotal": subtotal,
        "discount": discount,
        "vat_amount": vat_amount,
        "total": total,
        "notes": invoice.notes,
        "payment_method": invoice.payment_method,
        "customer_name_ar": invoice.customer_name_ar,
        "customer_phone": invoice.customer_phone,
        "customer_address": invoice.customer_address,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = await db.invoices.find_one_and_update(
        {"id": invoice_id},
        {"$set": update_data},
        return_document=True
    )
    result.pop("_id", None)
    return result

@api_router.get("/reports/financial")
async def get_financial_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    activity_id: Optional[str] = None,
    coach_id: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    # Query for paid invoices
    query = {"status": "paid"}
    # Admin can filter by any branch
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
    end_date_full = (end_date + "T23:59:59.999999") if end_date and "T" not in end_date else end_date
    start_date_full = (start_date + "T00:00:00") if start_date and "T" not in start_date else start_date

    if start_date_full:
        query["paid_at"] = {"$gte": start_date_full}
    if end_date_full:
        if "paid_at" in query:
            query["paid_at"]["$lte"] = end_date_full
        else:
            query["paid_at"] = {"$lte": end_date_full}
    
    invoices = await db.invoices.find(query, {"_id": 0}).to_list(10000)
    
    # Get credit notes (refunds) from the new collection
    credit_note_query = {}
    if is_admin and branch_filter and branch_filter != "all":
        credit_note_query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        credit_note_query["branch_id"] = branch_id
    if start_date_full:
        credit_note_query["created_at"] = {"$gte": start_date_full}
    if end_date_full:
        if "created_at" in credit_note_query:
            credit_note_query["created_at"]["$lte"] = end_date_full
        else:
            credit_note_query["created_at"] = {"$lte": end_date_full}
    
    credit_notes = await db.credit_notes.find(credit_note_query, {"_id": 0}).to_list(10000)
    
    total_revenue = sum(inv["total"] for inv in invoices)
    
    # Calculate refunds from credit notes
    total_refunds = sum(cn.get("refund_amount", 0) for cn in credit_notes)
    full_refunds = [cn for cn in credit_notes if "كامل" in cn.get("notes", "")]
    partial_refunds = [cn for cn in credit_notes if "جزئي" in cn.get("notes", "")]
    
    # Net revenue (after refunds)
    net_revenue = total_revenue - total_refunds
    
    # Group by activity
    revenue_by_activity = {}
    for inv in invoices:
        for item in inv["items"]:
            act_id = item["activity_id"]
            if act_id not in revenue_by_activity:
                revenue_by_activity[act_id] = {"name": item["activity_name"], "total": 0, "count": 0}
            revenue_by_activity[act_id]["total"] += item["fee"]
            revenue_by_activity[act_id]["count"] += 1
    
    # Credit note details for report
    refund_details = [{
        "credit_note_id": cn["id"],
        "credit_note_number": cn.get("credit_note_number", ""),
        "original_invoice_number": cn.get("original_invoice_number", ""),
        "customer_name": cn.get("customer_name_ar", ""),
        "refund_amount": cn.get("refund_amount", 0),
        "reason": cn.get("reason", ""),
        "created_by": cn.get("created_by", ""),
        "created_at": cn.get("created_at", "")
    } for cn in credit_notes]
    
    return {
        "total_revenue": total_revenue,
        "total_refunds": total_refunds,
        "net_revenue": net_revenue,
        "invoice_count": len(invoices),
        "refund_count": len(credit_notes),
        "full_refund_count": len(full_refunds),
        "partial_refund_count": len(partial_refunds),
        "revenue_by_activity": list(revenue_by_activity.values()),
        "refund_details": refund_details,
        "invoices": invoices[:50]  # Return last 50 invoices
    }

@api_router.get("/reports/expiring-subscriptions")
async def get_expiring_subscriptions(
    days: int = 7,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    threshold_date = (datetime.now(timezone.utc) + timedelta(days=days)).strftime('%Y-%m-%d')
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    query = {}
    # Admin can filter by any branch
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
    members = await db.members.find(query, {"_id": 0}).to_list(10000)
    
    expiring = []
    for member in members:
        for activity in member.get("activities", []):
            if activity.get("status") == "active":
                end_date = activity.get("end_date", "")
                if end_date and today <= end_date <= threshold_date:
                    try:
                        end_date_obj = datetime.strptime(end_date, '%Y-%m-%d')
                        today_obj = datetime.strptime(today, '%Y-%m-%d')
                        days_remaining = (end_date_obj - today_obj).days
                    except:
                        days_remaining = 0
                    expiring.append({
                        "member_id": member["id"],
                        "member_code": member.get("member_code", ""),
                        "member_name": member.get("name_ar", member.get("name", "")),
                        "member_photo": member.get("photo", ""),
                        "phone": member.get("phone", ""),
                        "branch_id": member.get("branch_id", ""),
                        "activity_name": activity.get("activity_name", ""),
                        "activity_id": activity.get("activity_id", ""),
                        "end_date": end_date,
                        "days_remaining": days_remaining
                    })
    
    return sorted(expiring, key=lambda x: x["end_date"])

@api_router.get("/company-info")
async def get_company_info():
    """Get company registration info for invoices"""
    return {
        "name_ar": "شركة اداء الابطال العالمية للرياضة",
        "name_en": "Global Champions Sports Performance",
        "tax_number": COMPANY_TAX_NUMBER,
        "commercial_reg": COMPANY_COMMERCIAL_REG,
        "vat_rate": VAT_RATE * 100,  # Return as percentage
        "currency": "SAR"
    }

@api_router.get("/global-search")
async def global_search(
    q: str = "",
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if not q or len(q.strip()) < 2:
        return {"members": [], "invoices": [], "activities": []}

    query = q.strip()
    regex_pattern = {"$regex": re.escape(query), "$options": "i"}

    is_admin = current_user.get("is_admin", False)
    user_branch = current_user.get("branch_id")
    if is_admin:
        effective_branch = branch_filter if (branch_filter and branch_filter != "all") else None
    else:
        effective_branch = user_branch
        if not effective_branch:
            return {"members": [], "invoices": [], "activities": []}

    scoped_filter = {"branch_id": effective_branch} if effective_branch else {}
    activity_branch_filter = (
        {"$or": [{"branch_id": effective_branch}, {"branch_id": None}, {"branch_id": {"$exists": False}}]}
        if effective_branch else {}
    )

    members_or = {"$or": [
        {"name": regex_pattern},
        {"name_ar": regex_pattern},
        {"phone": regex_pattern},
        {"guardian_name": regex_pattern},
        {"guardian_name_ar": regex_pattern},
        {"guardian_phone": regex_pattern},
        {"member_id": regex_pattern},
        {"member_code": regex_pattern},
    ]}
    members_query = {"$and": [members_or, scoped_filter]} if scoped_filter else members_or
    members_cursor = db.members.find(members_query, {"_id": 0}).limit(10)
    members = await members_cursor.to_list(10)
    members_results = [{
        "id": m.get("id", ""),
        "name": m.get("name_ar") or m.get("name", ""),
        "phone": m.get("phone", ""),
        "member_id": m.get("member_id", ""),
        "activities_count": len(m.get("activities", [])),
    } for m in members]

    invoices_or = {"$or": [
        {"invoice_number": regex_pattern},
        {"member_name": regex_pattern},
        {"member_phone": regex_pattern},
    ]}
    invoices_query = {"$and": [invoices_or, scoped_filter]} if scoped_filter else invoices_or
    invoices_cursor = db.invoices.find(invoices_query, {"_id": 0}).sort("created_at", -1).limit(10)
    invoices = await invoices_cursor.to_list(10)
    invoices_results = [{
        "id": inv.get("id", ""),
        "invoice_number": inv.get("invoice_number", ""),
        "member_name": inv.get("member_name", ""),
        "total": inv.get("total", 0),
        "status": inv.get("status", ""),
        "created_at": inv.get("created_at", ""),
    } for inv in invoices]

    activities_or = {"$or": [
        {"name": regex_pattern},
        {"name_ar": regex_pattern},
    ]}
    activities_query = {"$and": [activities_or, activity_branch_filter]} if activity_branch_filter else activities_or
    activities_cursor = db.activities.find(activities_query, {"_id": 0}).limit(10)
    activities = await activities_cursor.to_list(10)
    activities_results = [{
        "id": a.get("id", ""),
        "name": a.get("name_ar") or a.get("name", ""),
        "monthly_fee": a.get("monthly_fee", 0),
    } for a in activities]
    
    return {
        "members": members_results,
        "invoices": invoices_results,
        "activities": activities_results,
    }

@api_router.get("/dashboard/settings")
async def get_dashboard_settings(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("id", "")
    settings = await db.dashboard_settings.find_one({"user_id": user_id}, {"_id": 0})
    if not settings:
        return {"widgets": [], "user_id": user_id}
    return settings

@api_router.put("/dashboard/settings")
async def save_dashboard_settings(
    data: dict,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user.get("id", "")
    data["user_id"] = user_id
    await db.dashboard_settings.update_one(
        {"user_id": user_id},
        {"$set": data},
        upsert=True
    )
    return {"message": "Settings saved"}

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    # Admin can filter by any branch, non-admin uses their assigned branch
    if is_admin and branch_filter and branch_filter != "all":
        branch_query = {"branch_id": branch_filter}
    elif is_admin:
        branch_query = {}
    else:
        branch_query = {"branch_id": branch_id} if branch_id else {}
    
    # Get counts
    members_count = await db.members.count_documents(branch_query)
    activities_count = await db.activities.count_documents(branch_query if branch_query else {})
    coaches_count = await db.coaches.count_documents(branch_query if branch_query else {})
    
    # Get active subscriptions count
    members = await db.members.find(branch_query, {"_id": 0}).to_list(10000)
    active_subscriptions = sum(
        1 for m in members 
        for a in m.get("activities", []) 
        if a.get("status") == "active"
    )
    
    # Get this month's revenue
    start_of_month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    invoice_query = {"status": "paid", "paid_at": {"$gte": start_of_month}}
    # Apply branch filter for invoices (admin with filter or non-admin)
    if is_admin and branch_filter and branch_filter != "all":
        invoice_query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        invoice_query["branch_id"] = branch_id
    month_invoices = await db.invoices.find(invoice_query, {"_id": 0}).to_list(10000)
    month_revenue = sum(inv["total"] for inv in month_invoices)
    
    # Get expiring subscriptions (next 7 days)
    threshold_date = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    today = datetime.now(timezone.utc).isoformat()
    expiring_count = 0
    for member in members:
        for activity in member.get("activities", []):
            if activity.get("status") == "active":
                end_date = activity.get("end_date", "")
                if end_date and today <= end_date <= threshold_date:
                    expiring_count += 1
    
    # Get members by activity
    activity_counts = {}
    for member in members:
        for activity in member.get("activities", []):
            if activity.get("status") == "active":
                act_name = activity.get("activity_name", "Unknown")
                activity_counts[act_name] = activity_counts.get(act_name, 0) + 1
    
    # Get pending registration forms total
    forms_query = {"status": "pending"}
    if is_admin and branch_filter and branch_filter != "all":
        forms_query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        forms_query["branch_id"] = branch_id
    pending_forms = await db.registration_forms.find(forms_query, {"_id": 0}).to_list(10000)
    pending_forms_total = sum(form.get("total", 0) for form in pending_forms)
    pending_forms_count = len(pending_forms)
    
    return {
        "members_count": members_count,
        "activities_count": activities_count,
        "coaches_count": coaches_count,
        "active_subscriptions": active_subscriptions,
        "month_revenue": month_revenue,
        "expiring_count": expiring_count,
        "members_by_activity": [{"name": k, "count": v} for k, v in activity_counts.items()],
        "pending_forms_total": pending_forms_total,
        "pending_forms_count": pending_forms_count
    }

# ============ SEED DATA ============

@api_router.post("/seed")
async def seed_data():
    # Check if already seeded
    existing_activities = await db.activities.count_documents({})
    if existing_activities > 0:
        return {"message": "Data already seeded"}
    
    # Seed activities
    activities = [
        {"id": str(uuid.uuid4()), "name": "Swimming", "name_ar": "السباحة", "description": "Learn swimming techniques", "description_ar": "تعلم تقنيات السباحة", "monthly_fee": 300.0, "color": "#0EA5E9", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": str(uuid.uuid4()), "name": "Football", "name_ar": "كرة القدم", "description": "Football training", "description_ar": "تدريب كرة القدم", "monthly_fee": 250.0, "color": "#22C55E", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": str(uuid.uuid4()), "name": "Karate", "name_ar": "الكاراتيه", "description": "Karate martial arts", "description_ar": "فنون الكاراتيه القتالية", "monthly_fee": 350.0, "color": "#EF4444", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": str(uuid.uuid4()), "name": "Gymnastics", "name_ar": "الجمباز", "description": "Gymnastics training", "description_ar": "تدريب الجمباز", "monthly_fee": 400.0, "color": "#8B5CF6", "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    await db.activities.insert_many(activities)
    
    # Seed default branch
    default_branch = {
        "id": str(uuid.uuid4()),
        "name": "Main Branch",
        "name_ar": "الفرع الرئيسي",
        "phone": "0500000000",
        "manager_name": "Admin",
        "manager_name_ar": "المدير",
        "address": "",
        "address_ar": "",
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.branches.insert_one(default_branch)
    
    # Seed coaches
    coaches = [
        {"id": str(uuid.uuid4()), "name": "Ahmed Ali", "name_ar": "أحمد علي", "phone": "0501234567", "email": "ahmed@academy.com", "activities": [activities[0]["id"], activities[3]["id"]], "notes": "", "branch_id": default_branch["id"], "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": str(uuid.uuid4()), "name": "Mohamed Hassan", "name_ar": "محمد حسن", "phone": "0507654321", "email": "mohamed@academy.com", "activities": [activities[1]["id"]], "notes": "", "branch_id": default_branch["id"], "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": str(uuid.uuid4()), "name": "Sara Ahmed", "name_ar": "سارة أحمد", "phone": "0509876543", "email": "sara@academy.com", "activities": [activities[2]["id"]], "notes": "", "branch_id": default_branch["id"], "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    await db.coaches.insert_many(coaches)
    
    # Seed default admin user (has access to all branches)
    admin_user = {
        "id": str(uuid.uuid4()),
        "username": "admin",
        "password": hash_password("admin123"),
        "name": "مدير النظام",
        "branch_id": default_branch["id"],
        "is_admin": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(admin_user)
    
    return {"message": "Data seeded successfully", "admin_credentials": {"username": "admin", "password": "admin123"}}

# ============ EXPORT ROUTES ============

@api_router.get("/export/members")
async def export_members(
    activity_id: Optional[str] = None,
    status: Optional[str] = None,
    format: str = "xlsx",
    token: Optional[str] = None
):
    """Export members to Excel/CSV"""
    _require_export_admin_token(token)
    
    query = {}
    if activity_id:
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        elem_match = {"activity_id": activity_id, "end_date": {"$gte": today_str}}
        if status:
            elem_match["status"] = status
        query["activities"] = {"$elemMatch": elem_match}
    elif status:
        query["activities.status"] = status
    
    members = await db.members.find(query, {"_id": 0}).to_list(10000)
    
    if format == "xlsx":
        # Create Excel file
        xl = _get_openpyxl()
        Workbook = xl.Workbook; Font = xl.Font; PatternFill = xl.PatternFill; Border = xl.Border; Side = xl.Side; Alignment = xl.Alignment
        wb = Workbook()
        ws = wb.active
        ws.title = "الأعضاء"
        
        # Header styling
        header_fill = PatternFill(start_color="F97316", end_color="F97316", fill_type="solid")
        header_font = Font(bold=True, color="FFFFFF")
        thin_border = Border(
            left=Side(style='thin'), right=Side(style='thin'),
            top=Side(style='thin'), bottom=Side(style='thin')
        )
        
        headers = ["م", "الاسم", "العمر", "ولي الأمر", "الجوال", "البريد", "الأنشطة", "حالة الاشتراك", "تاريخ البداية", "تاريخ النهاية"]
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='center')
        
        for row_num, member in enumerate(members, 2):
            activities = member.get("activities", [])
            activities_names = ", ".join([a.get("activity_name", "") for a in activities])
            statuses = ", ".join(["نشط" if a.get("status") == "active" else "منتهي" for a in activities])
            start_dates = ", ".join([a.get("start_date", "") for a in activities])
            end_dates = ", ".join([a.get("end_date", "") for a in activities])
            
            row_data = [
                row_num - 1,
                member.get("name_ar", ""),
                member.get("age", ""),
                member.get("guardian_name_ar", ""),
                member.get("phone", ""),
                member.get("email", ""),
                activities_names,
                statuses,
                start_dates,
                end_dates
            ]
            for col, value in enumerate(row_data, 1):
                cell = ws.cell(row=row_num, column=col, value=value)
                cell.border = thin_border
                cell.alignment = Alignment(horizontal='right' if col > 1 else 'center')
        
        # Adjust column widths
        ws.column_dimensions['A'].width = 5
        ws.column_dimensions['B'].width = 20
        ws.column_dimensions['C'].width = 8
        ws.column_dimensions['D'].width = 20
        ws.column_dimensions['E'].width = 15
        ws.column_dimensions['F'].width = 25
        ws.column_dimensions['G'].width = 25
        ws.column_dimensions['H'].width = 15
        ws.column_dimensions['I'].width = 15
        ws.column_dimensions['J'].width = 15
        
        # Save to bytes
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=members_{datetime.now().strftime('%Y%m%d')}.xlsx"}
        )
    else:
        # Create CSV
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["م", "الاسم", "العمر", "ولي الأمر", "الجوال", "البريد", "الأنشطة", "حالة الاشتراك"])
        
        for idx, member in enumerate(members, 1):
            activities_list = ", ".join([a.get("activity_name", "") for a in member.get("activities", [])])
            statuses = ", ".join(["نشط" if a.get("status") == "active" else "منتهي" for a in member.get("activities", [])])
            writer.writerow([idx, member.get("name_ar", ""), member.get("age", ""), member.get("guardian_name_ar", ""), member.get("phone", ""), member.get("email", ""), activities_list, statuses])
        
        output.seek(0)
        response_content = '\ufeff' + output.getvalue()
        
        return StreamingResponse(
            iter([response_content]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=members_{datetime.now().strftime('%Y%m%d')}.csv"}
        )


@api_router.get("/export/invoices")
async def export_invoices(
    status: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    format: str = "xlsx",
    token: Optional[str] = None
):
    """Export invoices to Excel/CSV"""
    _require_export_admin_token(token)
    
    query = {}
    if status:
        query["status"] = status
    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    
    if format == "xlsx":
        # Create Excel file
        xl = _get_openpyxl()
        Workbook = xl.Workbook; Font = xl.Font; PatternFill = xl.PatternFill; Border = xl.Border; Side = xl.Side; Alignment = xl.Alignment
        wb = Workbook()
        ws = wb.active
        ws.title = "الفواتير"
        
        # Header styling
        header_fill = PatternFill(start_color="F97316", end_color="F97316", fill_type="solid")
        header_font = Font(bold=True, color="FFFFFF")
        thin_border = Border(
            left=Side(style='thin'), right=Side(style='thin'),
            top=Side(style='thin'), bottom=Side(style='thin')
        )
        
        headers = ["م", "رقم الفاتورة", "اسم العميل", "الجوال", "الأنشطة", "المجموع الفرعي", "الضريبة", "الإجمالي", "الحالة", "طريقة الدفع", "التاريخ"]
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='center')
        
        for row_num, invoice in enumerate(invoices, 2):
            activities_list = ", ".join([f"{item.get('activity_name', '')} ({item.get('fee', 0)})" for item in invoice.get("items", [])])
            status_ar = {"paid": "مدفوعة", "pending": "غير مدفوعة", "cancelled": "ملغاة"}.get(invoice.get("status", ""), invoice.get("status", ""))
            
            row_data = [
                row_num - 1,
                invoice.get("id", "")[:8],
                invoice.get("customer_name_ar", invoice.get("member_name", "")),
                invoice.get("customer_phone", ""),
                activities_list,
                invoice.get("subtotal", 0),
                invoice.get("vat_amount", 0),
                invoice.get("total", 0),
                status_ar,
                invoice.get("payment_method", ""),
                invoice.get("created_at", "")[:10]
            ]
            for col, value in enumerate(row_data, 1):
                cell = ws.cell(row=row_num, column=col, value=value)
                cell.border = thin_border
                cell.alignment = Alignment(horizontal='right' if col > 1 else 'center')
        
        # Adjust column widths
        ws.column_dimensions['A'].width = 5
        ws.column_dimensions['B'].width = 12
        ws.column_dimensions['C'].width = 20
        ws.column_dimensions['D'].width = 15
        ws.column_dimensions['E'].width = 30
        ws.column_dimensions['F'].width = 12
        ws.column_dimensions['G'].width = 10
        ws.column_dimensions['H'].width = 12
        ws.column_dimensions['I'].width = 12
        ws.column_dimensions['J'].width = 12
        ws.column_dimensions['K'].width = 12
        
        # Save to bytes
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=invoices_{datetime.now().strftime('%Y%m%d')}.xlsx"}
        )
    else:
        # Create CSV
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["م", "رقم الفاتورة", "اسم العميل", "الجوال", "الأنشطة", "المجموع الفرعي", "الضريبة", "الإجمالي", "الحالة", "التاريخ"])
        
        for idx, invoice in enumerate(invoices, 1):
            activities_list = ", ".join([f"{item.get('activity_name', '')}" for item in invoice.get("items", [])])
            status_ar = {"paid": "مدفوعة", "pending": "غير مدفوعة", "cancelled": "ملغاة"}.get(invoice.get("status", ""), invoice.get("status", ""))
            writer.writerow([idx, invoice.get("id", "")[:8], invoice.get("customer_name_ar", ""), invoice.get("customer_phone", ""), activities_list, invoice.get("subtotal", 0), invoice.get("vat_amount", 0), invoice.get("total", 0), status_ar, invoice.get("created_at", "")[:10]])
        
        output.seek(0)
        response_content = '\ufeff' + output.getvalue()
        
        return StreamingResponse(
            iter([response_content]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=invoices_{datetime.now().strftime('%Y%m%d')}.csv"}
        )


@api_router.get("/export/members-pdf")
async def export_members_pdf(
    activity_id: Optional[str] = None,
    status: Optional[str] = None,
    token: Optional[str] = None
):
    _require_export_admin_token(token)

    query = {}
    if activity_id:
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        elem_match = {"activity_id": activity_id, "end_date": {"$gte": today_str}}
        if status:
            elem_match["status"] = status
        query["activities"] = {"$elemMatch": elem_match}
    elif status:
        query["activities.status"] = status

    members = await db.members.find(query, {"_id": 0}).to_list(10000)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), topMargin=20*mm, bottomMargin=20*mm, leftMargin=15*mm, rightMargin=15*mm)

    styles = getSampleStyleSheet()
    try:
        font_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
            "/nix/store/dejavu-fonts/share/fonts/truetype/DejaVuSans.ttf",
        ]
        font_registered = False
        for fp in font_paths:
            if Path(fp).exists():
                pdfmetrics.registerFont(TTFont('ArabicFont', fp))
                font_registered = True
                break
        if not font_registered:
            import subprocess
            result = subprocess.run(['find', '/nix/store', '-name', 'DejaVuSans.ttf', '-type', 'f'], capture_output=True, text=True, timeout=5)
            if result.stdout.strip():
                found_path = result.stdout.strip().split('\n')[0]
                pdfmetrics.registerFont(TTFont('ArabicFont', found_path))
                font_registered = True
    except:
        font_registered = False

    cell_font = 'ArabicFont' if font_registered else 'Helvetica'

    title_style = ParagraphStyle('Title', parent=styles['Title'], fontName=cell_font, fontSize=16)
    cell_style = ParagraphStyle('Cell', fontName=cell_font, fontSize=8, leading=10)
    header_style = ParagraphStyle('Header', fontName=cell_font, fontSize=9, leading=11, textColor=colors.white)

    elements = []
    elements.append(Paragraph("Champions Academy - Members Report", title_style))
    elements.append(Spacer(1, 10*mm))

    headers = ["#", "Name", "Phone", "Activities", "Status", "Start Date", "End Date"]
    header_row = [Paragraph(h, header_style) for h in headers]

    data = [header_row]
    for idx, member in enumerate(members, 1):
        activities = member.get("activities", [])
        activities_names = ", ".join([a.get("activity_name", "") for a in activities])
        statuses = ", ".join(["Active" if a.get("status") == "active" else "Expired" for a in activities])
        start_dates = ", ".join([a.get("start_date", "") for a in activities])
        end_dates = ", ".join([a.get("end_date", "") for a in activities])

        row = [
            Paragraph(str(idx), cell_style),
            Paragraph(member.get("name_ar", member.get("name", "")), cell_style),
            Paragraph(member.get("phone", ""), cell_style),
            Paragraph(activities_names, cell_style),
            Paragraph(statuses, cell_style),
            Paragraph(start_dates, cell_style),
            Paragraph(end_dates, cell_style),
        ]
        data.append(row)

    col_widths = [30, 120, 80, 150, 80, 80, 80]
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F97316')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#FFF7ED')]),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
    ]))
    elements.append(table)

    doc.build(elements)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=members_{datetime.now().strftime('%Y%m%d')}.pdf"}
    )


@api_router.get("/export/invoices-pdf")
async def export_invoices_pdf(
    status: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    token: Optional[str] = None
):
    _require_export_admin_token(token)

    query = {}
    if status:
        query["status"] = status
    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}

    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), topMargin=20*mm, bottomMargin=20*mm, leftMargin=15*mm, rightMargin=15*mm)

    styles = getSampleStyleSheet()
    try:
        font_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
        ]
        font_registered = False
        for fp in font_paths:
            if Path(fp).exists():
                if 'ArabicFont' not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont('ArabicFont', fp))
                font_registered = True
                break
        if not font_registered and 'ArabicFont' in pdfmetrics.getRegisteredFontNames():
            font_registered = True
        if not font_registered:
            import subprocess
            result = subprocess.run(['find', '/nix/store', '-name', 'DejaVuSans.ttf', '-type', 'f'], capture_output=True, text=True, timeout=5)
            if result.stdout.strip():
                found_path = result.stdout.strip().split('\n')[0]
                if 'ArabicFont' not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont('ArabicFont', found_path))
                font_registered = True
    except:
        font_registered = False
        if 'ArabicFont' in pdfmetrics.getRegisteredFontNames():
            font_registered = True

    cell_font = 'ArabicFont' if font_registered else 'Helvetica'

    title_style = ParagraphStyle('InvTitle', parent=styles['Title'], fontName=cell_font, fontSize=16)
    cell_style = ParagraphStyle('InvCell', fontName=cell_font, fontSize=8, leading=10)
    header_style = ParagraphStyle('InvHeader', fontName=cell_font, fontSize=9, leading=11, textColor=colors.white)

    elements = []
    elements.append(Paragraph("Champions Academy - Invoices Report", title_style))
    elements.append(Spacer(1, 10*mm))

    headers = ["#", "Invoice No", "Customer", "Phone", "Items", "Subtotal", "VAT", "Total", "Status", "Date"]
    header_row = [Paragraph(h, header_style) for h in headers]

    data = [header_row]
    for idx, invoice in enumerate(invoices, 1):
        items_text = ", ".join([f"{item.get('activity_name', '')} ({item.get('fee', 0)})" for item in invoice.get("items", [])])
        status_text = {"paid": "Paid", "pending": "Pending", "cancelled": "Cancelled"}.get(invoice.get("status", ""), invoice.get("status", ""))

        row = [
            Paragraph(str(idx), cell_style),
            Paragraph(str(invoice.get("invoice_number", invoice.get("id", "")[:8])), cell_style),
            Paragraph(invoice.get("customer_name_ar", invoice.get("member_name", "")), cell_style),
            Paragraph(invoice.get("customer_phone", ""), cell_style),
            Paragraph(items_text, cell_style),
            Paragraph(str(invoice.get("subtotal", 0)), cell_style),
            Paragraph(str(invoice.get("vat_amount", 0)), cell_style),
            Paragraph(str(invoice.get("total", 0)), cell_style),
            Paragraph(status_text, cell_style),
            Paragraph(invoice.get("created_at", "")[:10], cell_style),
        ]
        data.append(row)

    col_widths = [25, 60, 100, 70, 150, 55, 45, 55, 55, 65]
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F97316')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#FFF7ED')]),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
    ]))
    elements.append(table)

    doc.build(elements)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=invoices_{datetime.now().strftime('%Y%m%d')}.pdf"}
    )


BACKUPS_DIR = ROOT_DIR / "backups"
BACKUPS_DIR.mkdir(exist_ok=True)

_RIYADH_TZ = ZoneInfo("Asia/Riyadh")
_backup_scheduler_started = False

# ── Branch Sequence Blocks ──────────────────────────────────────────────────
# Each branch gets an exclusive block of SEQ_BLOCK_SIZE numbers.
# Branch index 0 (first branch): starts at base
# Branch index 1: starts at base + BLOCK_SIZE, etc.
_SEQ_BLOCK_SIZE = 100_000   # 100 000 numbers per branch – plenty for any branch
_SEQ_BASES = {"member": 10_001, "invoice": 30_001, "reg": 10_001}


async def _get_branch_seq_start(branch_id: str, seq_type: str) -> int:
    """Return the exclusive start number for this branch+type.
    Initialises and persists the value on first call so the block never changes."""
    base = _SEQ_BASES.get(seq_type, 10_001)
    if not branch_id:
        return base

    field = f"{seq_type}_seq_start"
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        return base

    if branch.get(field):
        return int(branch[field])

    # First time – assign block based on the branch's creation order
    all_branches = await db.branches.find(
        {}, {"id": 1, "created_at": 1, "_id": 0}
    ).to_list(500)
    all_branches.sort(key=lambda b: b.get("created_at", ""))
    idx = next((i for i, b in enumerate(all_branches) if b["id"] == branch_id), 0)
    seq_start = base + idx * _SEQ_BLOCK_SIZE
    await db.branches.update_one({"id": branch_id}, {"$set": {field: seq_start}})
    return seq_start

# All known collection names (Atlas HTTP client doesn't support list_collection_names)
_ALL_COLLECTIONS = [
    "accounts", "activities", "activity_notes", "ad_images", "advertisements",
    "attendance", "bank_reports", "branches", "closures", "coach_attendance",
    "coaches", "coach_ratings", "counters", "credit_notes", "daily_videos",
    "dashboard_settings", "discounts", "expenses", "extension_logs",
    "internal_expense_payments", "internal_expenses", "invoices",
    "journal_entries", "levels", "level_subscriptions", "loyalty_rewards",
    "loyalty_settings", "member_freezes", "member_notifications", "member_points",
    "members", "messages", "notifications", "payment_transactions",
    "payment_vouchers", "points_history", "product_invoices", "products",
    "purchase_invoices", "push_subscriptions", "redemption_requests",
    "registration_forms", "supplier_payments", "suppliers", "users",
    "video_views", "whatsapp_settings", "whatsapp_send_log",
]


async def _send_ops_email(subject: str, body: str) -> None:
    """Best-effort SMTP send for ops alerts. No-op unless ``SMTP_HOST``,
    ``OPS_ALERT_EMAIL_TO``, and ``SMTP_FROM`` are configured. Runs sync send
    in a worker thread so it never blocks the event loop.
    """
    host = os.environ.get("SMTP_HOST")
    to_addr = os.environ.get("OPS_ALERT_EMAIL_TO")
    sender = os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USER")
    if not host or not to_addr or not sender:
        return
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER")
    pwd = os.environ.get("SMTP_PASSWORD")
    use_tls = os.environ.get("SMTP_TLS", "true").lower() != "false"

    def _send_sync():
        import smtplib, ssl
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = sender
        msg["To"] = to_addr
        msg.set_content(body)
        ctx = ssl.create_default_context()
        with smtplib.SMTP(host, port, timeout=10) as s:
            if use_tls:
                s.starttls(context=ctx)
            if user and pwd:
                s.login(user, pwd)
            s.send_message(msg)

    # Raises on send failure so the delivery worker can retry. Callers that
    # want fire-and-forget semantics must wrap in their own try/except.
    await asyncio.to_thread(_send_sync)


async def _send_ops_whatsapp(body: str) -> None:
    """WhatsApp send via the local Baileys side-car. Raises on failure so
    the ops-alerts delivery worker can retry with backoff.

    No-op (returns without raising) unless ``OPS_ALERT_WHATSAPP_TO`` is
    set. The side-car listens on 127.0.0.1:3001 and exposes ``POST /send``
    (``{phone, message}``). A non-2xx response is treated as failure.
    """
    to_phone = os.environ.get("OPS_ALERT_WHATSAPP_TO")
    if not to_phone:
        return
    url = os.environ.get("WHATSAPP_SERVICE_URL", "http://127.0.0.1:3001") + "/send"
    import httpx
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.post(url, json={"phone": to_phone, "message": body})
        resp.raise_for_status()


_OPS_ALERTS_SETTINGS_KEY = "ops_alerts_delivery"
# Backoff schedule (seconds) between delivery attempts. Each entry is the
# wait time *before* the next retry, so all entries are actually used: a
# failed first attempt waits ``[0]`` then retries, and so on. After the
# final retry fails the alert is marked acknowledged with
# ``delivery_status="exhausted"`` so the worker stops cycling it.
# Roughly: 1m → 5m → 30m → 2h → 6h. Total of 6 attempts before exhaustion.
_OPS_ALERTS_BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600]
_OPS_ALERTS_MAX_ATTEMPTS = len(_OPS_ALERTS_BACKOFF_SECONDS) + 1


async def _get_ops_alerts_delivery_settings() -> dict:
    """Per-tenant opt-in/out toggle for the outbound transports.

    Stored in ``db.notifications_settings`` (singleton, key=``ops_alerts_delivery``).
    Defaults to enabled for both channels so behaviour is unchanged for
    deployments that already configured ``OPS_ALERT_EMAIL_TO`` /
    ``OPS_ALERT_WHATSAPP_TO`` env vars before this toggle existed. Tenants
    can flip individual channels off without unsetting the env vars.
    Never raises — falls back to "both enabled" on DB errors.
    """
    try:
        doc = await db.notifications_settings.find_one(
            {"key": _OPS_ALERTS_SETTINGS_KEY}, {"_id": 0, "key": 0}
        ) or {}
    except Exception:
        doc = {}
    return {
        "email_enabled": bool(doc.get("email_enabled", True)),
        "whatsapp_enabled": bool(doc.get("whatsapp_enabled", True)),
        "updated_at": doc.get("updated_at"),
    }


async def _emit_ops_alert(*, kind: str, title: str, body: str, severity: str = "error") -> None:
    """Record a critical-failure alert and queue it for outbound delivery.

    Persists to ``db.ops_alerts`` (machine-readable, picked up by the
    delivery worker) and ``db.notifications`` (in-app dropdown for every
    admin in the current tenant). Outbound email/WhatsApp delivery is
    handled asynchronously by :func:`ops_alerts_delivery_loop` so that a
    transient SMTP/WhatsApp failure cannot drop the alert — the worker
    retries with exponential backoff until either the alert is delivered
    or the backoff schedule is exhausted.
    """
    try:
        ts = datetime.now(timezone.utc).isoformat()
        await db.ops_alerts.insert_one({
            "id": str(uuid.uuid4()),
            "kind": kind,
            "title": title,
            "body": body,
            "severity": severity,
            "created_at": ts,
            "acknowledged": False,
            # Delivery bookkeeping — populated/updated by the worker. Setting
            # ``next_attempt_at`` to created_at means the worker picks the row
            # up on its next tick without an extra query.
            "attempts": 0,
            "next_attempt_at": ts,
            "delivered_email": False,
            "delivered_whatsapp": False,
            "last_error": "",
            "delivery_status": "pending",
        })
        admins = await db.users.find({"is_admin": True}, {"id": 1, "_id": 0}).to_list(50)
        for u in admins:
            try:
                await db.notifications.insert_one({
                    "id": str(uuid.uuid4()),
                    "user_id": u.get("id"),
                    "type": f"ops_alert.{kind}",
                    "title": title,
                    "message": body,
                    "severity": severity,
                    "is_read": False,
                    "created_at": ts,
                })
            except Exception:
                pass
        print(f"OPS ALERT [{kind}]: {title} — {body}")
    except Exception as e:  # pragma: no cover — best-effort
        print(f"_emit_ops_alert failed: {e}")


_ops_alerts_worker_started = False


async def _try_deliver_ops_alert(alert: dict) -> dict:
    """Attempt the outbound transports for a single ops alert.

    Returns a dict with the post-attempt state of each channel and the
    last error, if any. A channel that is disabled (per-tenant toggle) or
    unconfigured (missing env var) is treated as "delivered" so the alert
    can be marked acknowledged once every required channel has resolved.
    """
    settings = await _get_ops_alerts_delivery_settings()
    kind = alert.get("kind", "")
    title = alert.get("title", "")
    body = alert.get("body", "")
    severity = alert.get("severity", "error")
    created_at = alert.get("created_at", "")

    delivered_email = bool(alert.get("delivered_email"))
    delivered_whatsapp = bool(alert.get("delivered_whatsapp"))
    last_error = ""

    email_to = os.environ.get("OPS_ALERT_EMAIL_TO")
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_from = os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USER")
    email_configured = bool(email_to and smtp_host and smtp_from)
    if not delivered_email:
        if not settings["email_enabled"] or not email_configured:
            delivered_email = True  # nothing to do for this channel
        else:
            try:
                await _send_ops_email(
                    f"[Champions Academy] {title}",
                    f"{body}\n\nKind: {kind}\nSeverity: {severity}\nAt: {created_at}",
                )
                delivered_email = True
            except Exception as e:
                last_error = f"email: {e}"

    whatsapp_to = os.environ.get("OPS_ALERT_WHATSAPP_TO")
    if not delivered_whatsapp:
        if not settings["whatsapp_enabled"] or not whatsapp_to:
            delivered_whatsapp = True
        else:
            try:
                await _send_ops_whatsapp(f"⚠ {title}\n{body}")
                delivered_whatsapp = True
            except Exception as e:
                last_error = (last_error + " | " if last_error else "") + f"whatsapp: {e}"

    return {
        "delivered_email": delivered_email,
        "delivered_whatsapp": delivered_whatsapp,
        "last_error": last_error[:500],
    }


async def _process_pending_ops_alerts() -> int:
    """Single tick of the delivery worker. Returns number of alerts processed."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    processed = 0
    try:
        # Include legacy rows (written before the delivery-bookkeeping
        # fields existed) by also matching docs with missing/null
        # ``next_attempt_at``. Without this, alerts created by the older
        # _emit_ops_alert would never be picked up.
        cursor = db.ops_alerts.find(
            {
                "acknowledged": False,
                "$or": [
                    {"next_attempt_at": {"$lte": now_iso}},
                    {"next_attempt_at": {"$exists": False}},
                    {"next_attempt_at": None},
                ],
            },
            {"_id": 0},
        ).limit(50)
        rows = await cursor.to_list(50)
    except Exception as e:
        print(f"ops_alerts worker: query failed: {e}")
        return 0

    for alert in rows:
        alert_id = alert.get("id")
        if not alert_id:
            continue
        # Normalise legacy rows so they enter the same retry state machine
        # as freshly-emitted ones.
        alert.setdefault("attempts", 0)
        alert.setdefault("delivered_email", False)
        alert.setdefault("delivered_whatsapp", False)
        alert.setdefault("last_error", "")
        alert.setdefault("delivery_status", "pending")
        result = await _try_deliver_ops_alert(alert)
        attempts = int(alert.get("attempts", 0)) + 1
        all_delivered = result["delivered_email"] and result["delivered_whatsapp"]

        update = {
            "attempts": attempts,
            "delivered_email": result["delivered_email"],
            "delivered_whatsapp": result["delivered_whatsapp"],
            "last_error": result["last_error"],
            "last_attempt_at": now_iso,
        }
        if all_delivered:
            update["acknowledged"] = True
            update["delivery_status"] = "delivered"
            update["acknowledged_at"] = now_iso
        elif attempts >= _OPS_ALERTS_MAX_ATTEMPTS:
            # Give up and stop retrying; the in-app notification + ops_alerts
            # row remain so an admin can investigate manually.
            update["acknowledged"] = True
            update["delivery_status"] = "exhausted"
            update["acknowledged_at"] = now_iso
            print(
                f"ops_alerts worker: giving up on {alert_id} after "
                f"{attempts} attempts: {result['last_error']}"
            )
        else:
            backoff = _OPS_ALERTS_BACKOFF_SECONDS[min(attempts, _OPS_ALERTS_MAX_ATTEMPTS) - 1]
            update["delivery_status"] = "retrying"
            update["next_attempt_at"] = (now + timedelta(seconds=backoff)).isoformat()

        try:
            await db.ops_alerts.update_one({"id": alert_id}, {"$set": update})
        except Exception as e:
            print(f"ops_alerts worker: update failed for {alert_id}: {e}")
        processed += 1
    return processed


async def ops_alerts_delivery_loop():
    """Background worker that drains ``db.ops_alerts`` for unacknowledged
    rows and attempts the outbound transports with exponential backoff.

    Runs every 30 seconds. Never raises — any unexpected error sleeps a
    minute and retries so a single bad row can't take down the worker.
    """
    print("Ops alerts delivery worker started (interval: 30s)")
    while True:
        try:
            await _process_pending_ops_alerts()
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"ops_alerts worker error: {e}")
            await asyncio.sleep(60)


def start_ops_alerts_worker():
    """Idempotent start. Flips the started flag *before* scheduling the
    coroutine so two near-simultaneous startup calls can never schedule
    duplicate loops (the previous version flipped the flag inside the
    loop, leaving a small race window)."""
    global _ops_alerts_worker_started
    if _ops_alerts_worker_started:
        return
    _ops_alerts_worker_started = True
    asyncio.ensure_future(ops_alerts_delivery_loop())


async def _send_backup_to_telegram(filepath, filename):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return
    try:
        size_mb = filepath.stat().st_size / (1024 * 1024)
        if size_mb > 49:
            print(f"Telegram backup skipped: file {filename} is {size_mb:.1f}MB (limit 50MB)")
            return
        import httpx
        url = f"https://api.telegram.org/bot{token}/sendDocument"
        caption = f"Champions Academy backup\n{filename}\n{datetime.now(_RIYADH_TZ).strftime('%Y-%m-%d %H:%M %Z')}"
        with open(filepath, "rb") as f:
            files = {"document": (filename, f, "application/json")}
            data = {"chat_id": chat_id, "caption": caption}
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(url, data=data, files=files)
        if resp.status_code == 200 and resp.json().get("ok"):
            print(f"Telegram backup sent: {filename}")
        else:
            print(f"Telegram backup failed: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"Telegram backup error: {e}")


async def _backup_one_tenant(tenant: dict) -> dict:
    import json as _json
    slug = (tenant.get("slug") or "default").replace("/", "_")
    timestamp = datetime.now(_RIYADH_TZ).strftime('%Y%m%d')
    filename = f"auto_backup_{slug}_{timestamp}.json"
    filepath = BACKUPS_DIR / filename

    backup_data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "tenant": {"slug": slug, "name": tenant.get("name"), "db_name": tenant.get("db_name")},
        "collections": {},
    }
    skipped: list = []
    for col_name in _ALL_COLLECTIONS:
        try:
            documents = await db[col_name].find({}, {"_id": 0}).to_list(100000)
            if documents:
                backup_data["collections"][col_name] = documents
        except Exception as e:
            skipped.append(f"{col_name}: {e}")

    with open(filepath, 'w', encoding='utf-8') as f:
        _json.dump(backup_data, f, ensure_ascii=False, default=str)

    cols = len(backup_data["collections"])
    size_mb = filepath.stat().st_size / (1024 * 1024)
    print(f"Auto backup created for tenant '{slug}': {filename} ({cols} collections, {size_mb:.2f}MB)")

    await _send_backup_to_telegram(filepath, filename)

    return {"file": filename, "collections": cols, "size_mb": round(size_mb, 2), "skipped": len(skipped)}


async def _create_auto_backup():
    from utils.tenant import for_each_active_tenant
    summary = await for_each_active_tenant(_backup_one_tenant, label="daily-backup")
    print(f"Auto backup summary: processed={summary['processed']} succeeded={summary['succeeded']} failed={summary['failed']}")

    auto_backups = sorted(BACKUPS_DIR.glob("auto_backup_*.json"), key=lambda x: x.stat().st_mtime)
    tenants_count = max(1, summary.get("processed", 1))
    keep = tenants_count * 7
    while len(auto_backups) > keep:
        oldest = auto_backups.pop(0)
        try:
            oldest.unlink()
            print(f"Auto backup deleted (retention limit): {oldest.name}")
        except Exception:
            pass

    if summary.get("failed", 0) > 0:
        await _emit_ops_alert(
            kind="backup.partial_failure",
            title="Backup completed with errors",
            body=f"{summary['failed']}/{summary['processed']} tenants failed during the daily backup. Errors: {summary.get('errors', {})}",
            severity="warning",
        )


async def backup_scheduler_loop():
    global _backup_scheduler_started
    _backup_scheduler_started = True
    print("Backup scheduler started (timezone: Asia/Riyadh, runs at midnight)")

    try:
        await asyncio.sleep(30)
        today_str = datetime.now(_RIYADH_TZ).strftime('%Y%m%d')
        from utils.tenant import list_active_tenants as _list_active_tenants
        try:
            tenants = await _list_active_tenants()
        except Exception as e:
            tenants = []
            print(f"Backup scheduler: could not list tenants for catch-up check: {e}")
        missing = []
        for t in tenants:
            slug = (t.get("slug") or "default").replace("/", "_")
            if not (BACKUPS_DIR / f"auto_backup_{slug}_{today_str}.json").exists():
                missing.append(slug)
        if missing or not tenants:
            print(f"Backup scheduler: catch-up needed for {len(missing) or 'all'} tenant(s) ({today_str})")
            try:
                await _create_auto_backup()
            except Exception as e:
                print(f"Backup scheduler: catch-up failed: {e}")
        else:
            print(f"Backup scheduler: all {len(tenants)} tenants already have today's backup, skipping catch-up")
    except Exception as e:
        print(f"Backup scheduler: startup catch-up error: {e}")

    while True:
        try:
            now = datetime.now(_RIYADH_TZ)
            next_midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            wait_seconds = (next_midnight - now).total_seconds()
            print(f"Backup scheduler: next run in {wait_seconds:.0f}s at midnight Riyadh time")
            await asyncio.sleep(wait_seconds)
            try:
                await _create_auto_backup()
            except Exception as e:
                print(f"Auto backup failed: {e}")
                await _emit_ops_alert(
                    kind="backup.failure",
                    title="Daily backup FAILED",
                    body=f"The nightly auto-backup raised an exception: {e}",
                    severity="error",
                )
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Backup scheduler error: {e}")
            await asyncio.sleep(3600)


def start_backup_scheduler():
    global _backup_scheduler_started
    if not _backup_scheduler_started:
        asyncio.ensure_future(backup_scheduler_loop())


# ── Daily renewal & ad-expiry checks ────────────────────────────────────────
# Runs once per day so admins get push/in-app alerts without anyone manually
# hitting the /notifications/check-renewals or /check-ads-expiry endpoints.
# Idempotency is preserved by the existing dedup checks inside each endpoint.
_daily_checks_scheduler_started = False
# Default to 7am Riyadh time — early enough that admins see notifications
# when they start their day, late enough that overnight DB load is past.
# Admins can override this hour via the notifications settings panel
# (see ``routes/notifications.get_daily_checks_hour``).
_DAILY_CHECKS_HOUR_RIYADH = 7


async def _run_daily_renewal_and_ads_checks(trigger: str = "scheduler") -> dict:
    """Execute renewal-reminder and ad-expiry checks for every branch.

    Each individual check runs inside its own try/except so a failure in one
    branch (or one check) cannot prevent the others from running. The
    underlying endpoints already dedupe via their own ``find_one`` lookups
    keyed on type + entity + today, so calling this multiple times in a day
    is safe.

    Returns a small dict summarising the run (renewals_created, ads_flagged,
    errors[], success). The same dict is also persisted to
    ``db.notifications_settings`` (key=``daily_checks_status``) so admins can
    see when the scheduler last ran and whether it succeeded.
    """
    print(f"Daily checks scheduler: running renewal & ad-expiry checks (trigger={trigger})")

    started_at = datetime.now(timezone.utc)
    renewals_created = 0
    ads_flagged = 0
    errors: list[str] = []
    tenants_processed = 0
    tenants_failed = 0
    tenant_results: dict = {}
    tenant_errors: dict = {}

    def _count(result) -> int:
        if isinstance(result, dict):
            for key in ("count", "notifications_created", "created"):
                n = result.get(key)
                if isinstance(n, int):
                    return n
        return 0

    try:
        from routes.notifications import (
            check_subscription_renewals as notif_check_renewals,
            check_ads_expiry as notif_check_ads_expiry,
        )
    except Exception as e:
        msg = f"failed to import notifications routes: {e}"
        errors.append(msg)
        print(f"Daily checks: {msg}")
        await _persist_daily_checks_status(
            started_at=started_at,
            success=False,
            renewals_created=renewals_created,
            ads_flagged=ads_flagged,
            errors=errors,
            trigger=trigger,
            tenants_processed=tenants_processed,
            tenants_failed=tenants_failed,
            tenant_results=tenant_results,
            tenant_errors=tenant_errors,
        )
        return {
            "success": False,
            "renewals_created": renewals_created,
            "ads_flagged": ads_flagged,
            "errors": errors,
            "tenants_processed": tenants_processed,
            "tenants_failed": tenants_failed,
        }

    # Per-tenant local errors collected inside _per_tenant_checks so we can
    # treat a tenant as "failed" even when the callback didn't crash (i.e.
    # some per-branch check raised but we swallowed it to keep going).
    per_tenant_local_errors: dict[str, list[str]] = {}

    async def _per_tenant_checks(tenant: dict) -> dict:
        nonlocal renewals_created, ads_flagged
        slug = tenant.get("slug") or "?"
        tenant_renewals = 0
        tenant_ads = 0
        local_errors: list[str] = []

        def _record(msg: str) -> None:
            errors.append(msg)
            local_errors.append(msg)

        try:
            admin_user = {"is_admin": True, "branch_id": None}
            result = await check_subscription_renewals(current_user=admin_user)
            tenant_renewals += _count(result)
        except Exception as e:
            _record(f"[{slug}] global renewals failed: {e}")

        branch_ids: list[str] = []
        try:
            async for b in db.branches.find({}, {"id": 1, "_id": 0}):
                bid = b.get("id")
                if bid:
                    branch_ids.append(bid)
        except Exception as e:
            _record(f"[{slug}] failed to list branches: {e}")

        for branch_id in branch_ids:
            scoped_user = {"is_admin": False, "branch_id": branch_id}
            try:
                r = await notif_check_renewals(current_user=scoped_user)
                tenant_renewals += _count(r)
            except Exception as e:
                _record(f"[{slug}] renewals failed for branch {branch_id}: {e}")
            try:
                r = await notif_check_ads_expiry(current_user=scoped_user)
                tenant_ads += _count(r)
            except Exception as e:
                _record(f"[{slug}] ads-expiry failed for branch {branch_id}: {e}")

        try:
            admin_user = {"is_admin": True, "branch_id": None}
            r = await notif_check_ads_expiry(current_user=admin_user)
            tenant_ads += _count(r)
        except Exception as e:
            _record(f"[{slug}] global ads-expiry failed: {e}")

        renewals_created += tenant_renewals
        ads_flagged += tenant_ads
        if local_errors:
            per_tenant_local_errors[slug] = local_errors
        print(f"Daily checks [{slug}]: renewals={tenant_renewals} ads={tenant_ads} errors={len(local_errors)}")
        return {"renewals": tenant_renewals, "ads": tenant_ads}

    try:
        from utils.tenant import for_each_active_tenant
        per_tenant_summary = await for_each_active_tenant(_per_tenant_checks, label="renewal_ads")
        tenants_processed = per_tenant_summary.get("processed", 0)
        tenant_results = per_tenant_summary.get("results") or {}
        # Start from callback-level failures (callback raised) and merge in
        # tenants where individual checks errored but the callback completed,
        # so "failed" means "this tenant had at least one check error".
        tenant_errors = dict(per_tenant_summary.get("errors") or {})
        if per_tenant_summary.get("failed"):
            for slug, err in list(tenant_errors.items()):
                errors.append(f"[{slug}] tenant scope failed: {err}")
        for slug, local_errs in per_tenant_local_errors.items():
            if slug in tenant_errors or not local_errs:
                continue
            # Summarise: first error verbatim plus a "(+N more)" suffix.
            head = local_errs[0]
            extra = len(local_errs) - 1
            tenant_errors[slug] = head if extra <= 0 else f"{head} (+{extra} more)"
        tenants_failed = len(tenant_errors)
    except Exception as e:
        msg = f"per-tenant iteration failed: {e}"
        errors.append(msg)
        print(f"Daily checks: {msg}")

    # 4) Trial-ending emails to tenant owners (7/3/1 days before expiry).
    # Independent of in-app notifications above; runs control-plane wide.
    try:
        from control_db import send_trial_ending_emails
        em = await send_trial_ending_emails()
        print(f"Daily checks: trial-ending emails → {em}")
        for e in em.get("errors") or []:
            errors.append(f"trial_ending email: {e}")
    except Exception as e:
        msg = f"trial-ending emails failed: {e}"
        errors.append(msg)
        print(f"Daily checks: {msg}")

    # 5) Auto-suspend any tenants whose subscription ended (also sends the
    # ``suspended`` email). Safe / idempotent.
    try:
        from control_db import auto_suspend_expired
        n = await auto_suspend_expired()
        if n:
            print(f"Daily checks: auto-suspended {n} expired tenants")
    except Exception as e:
        msg = f"auto-suspend failed: {e}"
        errors.append(msg)
        print(f"Daily checks: {msg}")

    # 6) Notify owners whose pending email confirmation links expired without
    # being clicked (so they don't only learn about it from the billing page).
    try:
        from control_db import notify_expired_email_confirmations
        ec = await notify_expired_email_confirmations()
        print(f"Daily checks: expired-confirmation reminders → {ec}")
        for e in ec.get("errors") or []:
            errors.append(f"email_confirmation_expired: {e}")
    except Exception as e:
        msg = f"expired-confirmation reminders failed: {e}"
        errors.append(msg)
        print(f"Daily checks: {msg}")

    # 7) Daily digest of any ops_alerts that ended in delivery_status=exhausted
    # in the last 24h, so admins are proactively notified about outages even
    # if they never visit /admin/ops-alerts.
    digest_sent = False
    digest_count = 0
    try:
        digest_sent, digest_count = await _send_ops_alerts_daily_digest()
        if digest_sent:
            print(f"Daily checks: ops-alerts digest emailed ({digest_count} exhausted alert(s))")
        elif digest_count == 0:
            print("Daily checks: ops-alerts digest skipped (no exhausted alerts in last 24h)")
        else:
            print(
                f"Daily checks: ops-alerts digest skipped (smtp not configured; "
                f"{digest_count} exhausted alert(s) would have been included)"
            )
    except Exception as e:
        msg = f"ops-alerts digest failed: {e}"
        errors.append(msg)
        print(f"Daily checks: {msg}")

    # 8) Cross-tenant push-subscription cleanup: deactivate stale duplicate
    # sign-ups left on shared browsers/devices where the same endpoint/FCM
    # token is active under a more-recently-updated row in another academy.
    # Runs once globally (it needs a cross-tenant view), not per-tenant.
    try:
        from routes.push_notifications import cleanup_superseded_subscriptions
        push_cleanup = await cleanup_superseded_subscriptions()
        print(
            f"Daily checks: push-subscription cleanup → "
            f"deactivated={push_cleanup.get('deactivated', 0)} "
            f"dup_devices={push_cleanup.get('duplicate_devices', 0)}"
        )
        for e in push_cleanup.get("errors") or []:
            errors.append(f"push_cleanup: {e}")
    except Exception as e:
        msg = f"push-subscription cleanup failed: {e}"
        errors.append(msg)
        print(f"Daily checks: {msg}")

    # 9) Prune very old, switched-off push sign-ups: the cleanup above only flips
    # duplicate/stale rows to inactive, never deletes them, so the
    # push_subscriptions collection grows with dead rows in every academy DB.
    # Permanently delete rows that have been inactive past the retention window
    # (default ~90 days). Runs per active tenant; best-effort.
    try:
        from routes.push_notifications import prune_inactive_subscriptions
        push_prune = await prune_inactive_subscriptions()
        print(
            f"Daily checks: push-subscription prune → "
            f"deleted={push_prune.get('deleted', 0)} "
            f"(retention_days={push_prune.get('retention_days')}, "
            f"scanned={push_prune.get('scanned_inactive', 0)})"
        )
        for e in push_prune.get("errors") or []:
            errors.append(f"push_prune: {e}")
    except Exception as e:
        msg = f"push-subscription prune failed: {e}"
        errors.append(msg)
        print(f"Daily checks: {msg}")

    success = len(errors) == 0
    await _persist_daily_checks_status(
        started_at=started_at,
        success=success,
        renewals_created=renewals_created,
        ads_flagged=ads_flagged,
        errors=errors,
        trigger=trigger,
        tenants_processed=tenants_processed,
        tenants_failed=tenants_failed,
        tenant_results=tenant_results,
        tenant_errors=tenant_errors,
    )
    print(
        f"Daily checks scheduler: finished (success={success}, "
        f"renewals={renewals_created}, ads={ads_flagged}, errors={len(errors)})"
    )
    if not success:
        try:
            await _emit_ops_alert(
                kind="daily_checks.failure",
                title="Daily renewal/ads check FAILED",
                body=(
                    f"{len(errors)} error(s) during daily check (trigger={trigger}). "
                    f"First: {errors[0] if errors else ''}"
                )[:1000],
                severity="error",
            )
        except Exception:
            pass
    return {
        "success": success,
        "renewals_created": renewals_created,
        "ads_flagged": ads_flagged,
        "errors": errors,
        "tenants_processed": tenants_processed,
        "tenants_failed": tenants_failed,
        "tenant_results": tenant_results,
        "tenant_errors": tenant_errors,
        "ops_alerts_digest_sent": digest_sent,
        "ops_alerts_digest_count": digest_count,
    }


_OPS_ALERTS_DIGEST_DISPLAY_CAP = 100


async def _send_ops_alerts_daily_digest() -> tuple:
    """Email admins a once-a-day summary of ops_alerts that **ended** in
    ``delivery_status="exhausted"`` in the last 24h, so admins are
    proactively notified about delivery outages even when they don't
    visit /admin/ops-alerts.

    Selection uses ``acknowledged_at`` (set by the delivery worker when
    it gives up) rather than ``created_at`` so an alert created earlier
    that only exhausted recently is still included. Returns
    ``(sent, count)`` where ``count`` is the *true* total of exhausted
    alerts in the window (not capped) so the caller can log accurately.

    Skip semantics:
      * ``(False, 0)`` — nothing to report.
      * ``(False, n)`` with ``n > 0`` — there were exhausted alerts but
        SMTP is not configured (``SMTP_HOST`` / ``OPS_ALERT_EMAIL_TO`` /
        ``SMTP_FROM`` missing), so no email could be sent. Caller logs
        a "skipped (smtp not configured)" line.
      * ``(True, n)`` — SMTP attempt was made (``_send_ops_email``
        completed without raising).

    Raises on SMTP send failure so the caller records the error in the
    daily-checks status doc and the existing ``daily_checks.failure``
    ops-alert path fires.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    query = {
        "delivery_status": "exhausted",
        "acknowledged_at": {"$gte": cutoff},
    }
    try:
        total = await db.ops_alerts.count_documents(query)
    except Exception as e:
        raise RuntimeError(f"failed to count exhausted ops_alerts: {e}")
    if total == 0:
        return False, 0

    # Short-circuit when SMTP isn't configured: ``_send_ops_email`` would
    # silently no-op, which would mislead the caller into reporting the
    # digest as "sent". Mirror its env-var checks here so the return value
    # accurately reflects whether an SMTP attempt actually happened.
    if not (
        os.environ.get("SMTP_HOST")
        and os.environ.get("OPS_ALERT_EMAIL_TO")
        and (os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USER"))
    ):
        return False, total

    try:
        rows = await db.ops_alerts.find(
            query,
            {"_id": 0, "id": 1, "kind": 1, "title": 1, "body": 1,
             "severity": 1, "created_at": 1, "acknowledged_at": 1,
             "attempts": 1, "last_error": 1},
        ).sort("acknowledged_at", -1).to_list(_OPS_ALERTS_DIGEST_DISPLAY_CAP)
    except Exception as e:
        raise RuntimeError(f"failed to query exhausted ops_alerts: {e}")

    base = (os.environ.get("APP_BASE_URL") or "").strip().rstrip("/")
    link = f"{base}/admin/ops-alerts" if base else "/admin/ops-alerts"

    truncated = total > len(rows)
    header = (
        f"{total} ops alert(s) stopped retrying in the last 24h "
        f"(delivery_status=exhausted)."
    )
    lines = [header, "", f"Review them: {link}", ""]
    if truncated:
        lines.append(
            f"Showing the {len(rows)} most recent below; "
            f"{total - len(rows)} additional exhausted alert(s) omitted "
            "for brevity — see the link above for the full list."
        )
        lines.append("")
    lines.append("Details:")
    for r in rows:
        title = (r.get("title") or r.get("kind") or "ops_alert").strip()
        kind = (r.get("kind") or "").strip()
        sev = (r.get("severity") or "error").strip()
        created = (r.get("created_at") or "").strip()
        exhausted_at = (r.get("acknowledged_at") or "").strip()
        attempts = r.get("attempts", 0)
        last_err = (r.get("last_error") or "").strip()
        body = (r.get("body") or "").strip()
        lines.append(f"  • [{sev}] {title}")
        if kind and kind != title:
            lines.append(f"      kind: {kind}")
        if created:
            lines.append(f"      created_at: {created}")
        if exhausted_at:
            lines.append(f"      exhausted_at: {exhausted_at}")
        lines.append(f"      attempts: {attempts}")
        if body:
            lines.append(f"      body: {body[:300]}")
        if last_err:
            lines.append(f"      last_error: {last_err[:300]}")
        lines.append("")

    subject_suffix = f" (showing {len(rows)})" if truncated else ""
    subject = (
        f"[Ops Alerts] Daily digest — {total} failed alert(s) "
        f"in last 24h{subject_suffix}"
    )
    await _send_ops_email(subject, "\n".join(lines))
    return True, total


async def _persist_daily_checks_status(
    *,
    started_at: datetime,
    success: bool,
    renewals_created: int,
    ads_flagged: int,
    errors: list,
    trigger: str,
    tenants_processed: int = 0,
    tenants_failed: int = 0,
    tenant_results: dict | None = None,
    tenant_errors: dict | None = None,
) -> None:
    """Best-effort write of the run status doc. Never raises."""
    try:
        finished_at = datetime.now(timezone.utc)
        # Cap stored errors so a runaway loop can't blow up the doc size.
        capped_errors = [str(e)[:500] for e in errors[:20]]
        # Per-tenant breakdown: keep it bounded the same way as errors so the
        # status doc stays small even when many tenants are active.
        results_in = tenant_results or {}
        errors_in = tenant_errors or {}
        capped_tenant_results: dict = {}
        for slug, res in list(results_in.items())[:50]:
            if isinstance(res, dict):
                capped_tenant_results[str(slug)[:100]] = {
                    "renewals": int(res.get("renewals") or 0),
                    "ads": int(res.get("ads") or 0),
                }
        capped_failed_tenants = [
            {"slug": str(slug)[:100], "error": str(err)[:500]}
            for slug, err in list(errors_in.items())[:20]
        ]
        await db.notifications_settings.update_one(
            {"key": "daily_checks_status"},
            {"$set": {
                "key": "daily_checks_status",
                "last_run_at": finished_at.isoformat(),
                "started_at": started_at.isoformat(),
                "duration_seconds": (finished_at - started_at).total_seconds(),
                "success": success,
                "renewals_created": renewals_created,
                "ads_flagged": ads_flagged,
                "errors": capped_errors,
                "error_count": len(errors),
                "trigger": trigger,
                "tenants_processed": tenants_processed,
                "tenants_failed": tenants_failed,
                "tenant_results": capped_tenant_results,
                "failed_tenants": capped_failed_tenants,
            }},
            upsert=True,
        )
    except Exception as e:
        print(f"Daily checks: failed to persist status: {e}")


async def _resolve_daily_checks_time() -> tuple:
    """Read the admin-configured ``(hour, minute)`` for daily checks.

    Falls back to ``(_DAILY_CHECKS_HOUR_RIYADH, 0)`` on any error or when
    no setting is stored, so the scheduler keeps working even if the DB
    lookup fails.
    """
    try:
        from routes.notifications import get_daily_checks_time
        return await get_daily_checks_time()
    except Exception as e:
        print(f"Daily checks scheduler: failed to read configured time ({e}), using default")
        return _DAILY_CHECKS_HOUR_RIYADH, 0


async def _resolve_daily_checks_days() -> list:
    """Read the admin-configured run days (subset of Sun..Sat).

    Falls back to all 7 days on any error so a transient DB failure can't
    silently disable the scheduler. Returns string abbreviations
    ("Sun".."Sat") to match the canonical encoding in
    ``routes/notifications.py``.
    """
    try:
        from routes.notifications import get_daily_checks_days
        return await get_daily_checks_days()
    except Exception as e:
        print(f"Daily checks scheduler: failed to read configured days ({e}), using all 7")
        return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


async def daily_checks_scheduler_loop():
    global _daily_checks_scheduler_started
    _daily_checks_scheduler_started = True
    print(
        "Daily checks scheduler started "
        f"(timezone: Asia/Riyadh, default time: {_DAILY_CHECKS_HOUR_RIYADH:02d}:00, "
        "configurable via notifications settings)"
    )
    while True:
        try:
            # Re-read the configured time on every tick so an admin changing
            # the setting takes effect on the next scheduled run without a
            # restart.
            hour, minute = await _resolve_daily_checks_time()
            allowed_days = await _resolve_daily_checks_days()
            # Canonical Sun..Sat strings — match notifications.py encoding.
            _ALL_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            allowed_set = set(allowed_days) if allowed_days else set(_ALL_DAYS)
            # weekday(): Monday=0..Sunday=6 — locale-independent mapping.
            _WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            now = datetime.now(_RIYADH_TZ)
            next_run = now.replace(
                hour=hour, minute=minute, second=0, microsecond=0
            )
            if next_run <= now:
                next_run += timedelta(days=1)
            # Pre-advance across excluded days so we don't wake up just to
            # immediately skip — keeps log noise down and is more accurate.
            for _ in range(7):
                if _WEEKDAY_ABBR[next_run.weekday()] in allowed_set:
                    break
                next_run += timedelta(days=1)
            wait_seconds = (next_run - now).total_seconds()
            print(
                f"Daily checks scheduler: next run in {wait_seconds:.0f}s "
                f"at {next_run.isoformat()} (time={hour:02d}:{minute:02d}, "
                f"days={sorted(allowed_set)})"
            )
            await asyncio.sleep(wait_seconds)
            # Re-check the day-of-week filter at fire time so admins who
            # disabled today's run after the previous tick still get the
            # skip applied. _WEEKDAY_ABBR is already in scope from the
            # pre-advance block above (locale-independent, weekday() index).
            allowed_days = await _resolve_daily_checks_days()
            today_abbr = _WEEKDAY_ABBR[datetime.now(_RIYADH_TZ).weekday()]
            if today_abbr not in allowed_days:
                print(
                    f"Daily checks scheduler: skipping run, {today_abbr} is "
                    f"not in configured days {allowed_days}"
                )
                continue
            await _run_daily_renewal_and_ads_checks()
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Daily checks scheduler error: {e}")
            await asyncio.sleep(3600)


def start_daily_checks_scheduler():
    global _daily_checks_scheduler_started
    if not _daily_checks_scheduler_started:
        asyncio.ensure_future(daily_checks_scheduler_loop())


# ── Tenant auto-purge scheduler ─────────────────────────────────────────────
# Runs once per day. For every tenant in ``pending_delete`` whose
# ``deletion_purge_at`` is in the past:
#   1. On first detection, emit a ``tenant.auto_purge_pending`` ops alert and
#      stamp ``final_purge_alert_sent_at``. The actual drop is deferred until
#      the NEXT scheduler tick (~24h), giving super-admins one last chance to
#      cancel via ``POST /super/tenants/{id}/cancel-delete``.
#   2. On the following tick, drop the per-tenant Mongo DB and mark the
#      tenant ``status: deleted``. Failures are logged + raised as
#      ``tenant.auto_purge_failed`` ops alerts; the tenant stays
#      ``pending_delete`` so the next tick retries.
_tenant_purge_scheduler_started = False
# Run at 02:00 Riyadh — after nightly backup (00:00) and before the daily
# renewal/ad checks (default 07:00) so the three jobs don't pile up.
_TENANT_PURGE_HOUR_RIYADH = 2


async def _run_tenant_auto_purge() -> dict:
    """Scan ``control_db.tenants`` and purge any whose grace period has elapsed.

    Returns a summary dict ``{warned, purged, failed, skipped}`` for logging
    and tests.
    """
    from control_db import control_db as _control_db
    from database import _raw_client as _client
    from utils.tenant import slug_to_db_name as _slug_to_db_name, DEFAULT_TENANT_SLUG as _DEFAULT_SLUG

    now = datetime.now(timezone.utc)
    summary = {"warned": 0, "purged": 0, "failed": 0, "skipped": 0}
    try:
        candidates = await _control_db.tenants.find(
            {"status": "pending_delete"}, {"_id": 0}
        ).to_list(1000)
    except Exception as e:
        print(f"Tenant purge scheduler: failed to list tenants: {e}")
        return summary

    for tenant in candidates:
        tid = tenant.get("id")
        slug = tenant.get("slug") or ""
        if slug == _DEFAULT_SLUG:
            summary["skipped"] += 1
            continue
        purge_at_str = tenant.get("deletion_purge_at")
        if not purge_at_str:
            summary["skipped"] += 1
            continue
        try:
            purge_at = datetime.fromisoformat(str(purge_at_str).replace("Z", "+00:00"))
        except Exception:
            summary["skipped"] += 1
            continue
        if now < purge_at:
            # Grace period not yet elapsed — nothing to do.
            summary["skipped"] += 1
            continue

        warned_at = tenant.get("final_purge_alert_sent_at")
        if not warned_at:
            # First detection: emit final warning and defer the drop one tick.
            try:
                await _emit_ops_alert(
                    kind="tenant.auto_purge_pending",
                    title=f"Tenant '{slug}' will be auto-purged on next run",
                    body=(
                        f"Tenant '{slug}' (id={tid}) reached its 7-day deletion "
                        f"grace period on {purge_at.isoformat()}. The next "
                        "scheduler tick (~24h) will permanently drop its "
                        "MongoDB database. To cancel, call "
                        f"POST /super/tenants/{tid}/cancel-delete now."
                    ),
                    severity="warning",
                )
            except Exception as e:
                print(f"Tenant purge scheduler: ops alert emit failed for {slug}: {e}")
            try:
                await _control_db.tenants.update_one(
                    {"id": tid},
                    {"$set": {"final_purge_alert_sent_at": now.isoformat()}},
                )
            except Exception as e:
                print(f"Tenant purge scheduler: failed to stamp warning for {slug}: {e}")
            # Best-effort: also email the academy owner so the actual customer
            # (not just super-admins) gets a final chance to object before the
            # next tick irreversibly drops their database. Failures here must
            # never block the purge flow.
            owner_email = (tenant.get("owner_email") or "").strip()
            if owner_email:
                try:
                    from utils.email_service import send_email as _send_email
                    from routes.super_admin import build_cancel_delete_url as _build_cancel_url
                    try:
                        cancel_url = _build_cancel_url(tid)
                    except Exception:
                        cancel_url = ""
                    result = await _send_email(
                        kind="final_purge_warning",
                        to=owner_email,
                        tenant_slug=slug,
                        ctx={
                            "academy_name": tenant.get("name", "") or slug,
                            "purge_at": purge_at.isoformat(),
                            "cancel_url": cancel_url,
                        },
                    )
                    print(
                        f"Tenant purge scheduler: final_purge_warning email to "
                        f"{owner_email} for {slug}: {result.get('status')}"
                    )
                except Exception as e:
                    print(
                        f"Tenant purge scheduler: final_purge_warning email "
                        f"failed for {slug} ({owner_email}): {e}"
                    )
            else:
                print(
                    f"Tenant purge scheduler: no owner_email for {slug}; "
                    "skipping final warning email"
                )
            summary["warned"] += 1
            continue

        # Second detection: actually drop the database.
        # Re-fetch immediately before the irreversible drop so a super-admin
        # who calls cancel-delete during the scan window can still abort.
        # cancel-delete unsets ``deletion_purge_at`` and flips ``status`` to
        # ``active``, both of which we re-validate here.
        fresh = None
        try:
            fresh = await _control_db.tenants.find_one({"id": tid}, {"_id": 0})
        except Exception as e:
            print(f"Tenant purge scheduler: pre-drop refetch failed for {slug}: {e}")
            summary["skipped"] += 1
            continue
        if not fresh or fresh.get("status") != "pending_delete":
            print(
                f"Tenant purge scheduler: skipping {slug} — status changed "
                f"to {fresh.get('status') if fresh else 'missing'} since scan"
            )
            summary["skipped"] += 1
            continue
        fresh_purge_at_str = fresh.get("deletion_purge_at")
        if not fresh_purge_at_str:
            print(f"Tenant purge scheduler: skipping {slug} — deletion_purge_at cleared since scan")
            summary["skipped"] += 1
            continue
        try:
            fresh_purge_at = datetime.fromisoformat(
                str(fresh_purge_at_str).replace("Z", "+00:00")
            )
        except Exception:
            summary["skipped"] += 1
            continue
        if datetime.now(timezone.utc) < fresh_purge_at:
            print(f"Tenant purge scheduler: skipping {slug} — deletion_purge_at moved to future")
            summary["skipped"] += 1
            continue

        db_name = fresh.get("db_name") or _slug_to_db_name(slug)
        try:
            await _client.drop_database(db_name)
        except Exception as e:
            err = str(e) or e.__class__.__name__
            print(f"Tenant purge scheduler: drop_database({db_name}) failed: {err}")
            try:
                await _control_db.tenants.update_one(
                    {"id": tid},
                    {"$set": {
                        "deletion_last_error": err,
                        "deletion_last_error_at": now.isoformat(),
                    }},
                )
            except Exception:
                pass
            try:
                await _emit_ops_alert(
                    kind="tenant.auto_purge_failed",
                    title=f"Tenant '{slug}' auto-purge FAILED",
                    body=(
                        f"Could not drop MongoDB database '{db_name}' for "
                        f"tenant '{slug}' (id={tid}): {err}. Tenant remains "
                        "pending_delete; next scheduler tick will retry."
                    ),
                    severity="error",
                )
            except Exception:
                pass
            summary["failed"] += 1
            continue

        deleted_at_iso = datetime.now(timezone.utc).isoformat()
        bookkeeping_ok = False
        try:
            await _control_db.tenants.update_one(
                {"id": tid},
                {"$set": {
                    "status": "deleted",
                    "deleted_at": deleted_at_iso,
                    "db_dropped": True,
                    "deleted_by": "auto_purge_scheduler",
                },
                 "$unset": {"deletion_last_error": "", "deletion_last_error_at": ""}},
            )
            bookkeeping_ok = True
        except Exception as e:
            print(f"Tenant purge scheduler: failed to mark {slug} deleted: {e}")
        print(f"Tenant purge scheduler: purged tenant '{slug}' (db={db_name})")
        summary["purged"] += 1

        # Best-effort: email the academy owner to confirm the irreversible
        # deletion happened. Only send if the bookkeeping update succeeded so
        # we don't tell the owner "deleted" while the tenant doc still claims
        # otherwise. Failures here must never disturb the purge flow.
        if not bookkeeping_ok:
            print(
                f"Tenant purge scheduler: skipping purge_completed email for "
                f"{slug} — tenant status update failed"
            )
            continue
        owner_email = (fresh.get("owner_email") or tenant.get("owner_email") or "").strip()
        if owner_email:
            try:
                from utils.email_service import send_email as _send_email
                result = await _send_email(
                    kind="purge_completed",
                    to=owner_email,
                    tenant_slug=slug,
                    ctx={
                        "academy_name": fresh.get("name") or tenant.get("name", "") or slug,
                        "deleted_at": deleted_at_iso,
                    },
                )
                print(
                    f"Tenant purge scheduler: purge_completed email to "
                    f"{owner_email} for {slug}: {result.get('status')}"
                )
            except Exception as e:
                print(
                    f"Tenant purge scheduler: purge_completed email "
                    f"failed for {slug} ({owner_email}): {e}"
                )
        else:
            print(
                f"Tenant purge scheduler: no owner_email for {slug}; "
                "skipping purge_completed email"
            )

    return summary


async def tenant_purge_scheduler_loop():
    global _tenant_purge_scheduler_started
    _tenant_purge_scheduler_started = True
    print(
        "Tenant auto-purge scheduler started "
        f"(timezone: Asia/Riyadh, runs daily at {_TENANT_PURGE_HOUR_RIYADH:02d}:00)"
    )
    while True:
        try:
            now = datetime.now(_RIYADH_TZ)
            next_run = now.replace(
                hour=_TENANT_PURGE_HOUR_RIYADH, minute=0, second=0, microsecond=0
            )
            if next_run <= now:
                next_run += timedelta(days=1)
            wait_seconds = (next_run - now).total_seconds()
            print(
                f"Tenant purge scheduler: next run in {wait_seconds:.0f}s "
                f"at {next_run.isoformat()}"
            )
            await asyncio.sleep(wait_seconds)
            try:
                summary = await _run_tenant_auto_purge()
                print(f"Tenant purge scheduler: finished {summary}")
            except Exception as e:
                print(f"Tenant purge scheduler run failed: {e}")
                await _emit_ops_alert(
                    kind="tenant.auto_purge_failed",
                    title="Tenant auto-purge scheduler raised an exception",
                    body=f"The daily tenant auto-purge run failed: {e}",
                    severity="error",
                )
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Tenant purge scheduler error: {e}")
            await asyncio.sleep(3600)


def start_tenant_purge_scheduler():
    global _tenant_purge_scheduler_started
    if not _tenant_purge_scheduler_started:
        asyncio.ensure_future(tenant_purge_scheduler_loop())


# ── Tenant auto-purge daily digest ──────────────────────────────────────────
# Runs once per day, ahead of the actual purge tick, and emails super-admins
# a short summary of every tenant whose ``deletion_purge_at`` falls inside
# the next ``_TENANT_PURGE_DIGEST_WINDOW_HOURS``. The digest goes out via
# ``_emit_ops_alert`` so it reuses the existing email/WhatsApp/in-app
# delivery pipeline (recipient: ``OPS_ALERT_EMAIL_TO``). On days where no
# tenant is pending in the window, no email is sent.
_tenant_purge_digest_started = False
# Defaults: run at 07:30 Riyadh — a few hours before the 02:00 purge tick of
# the next day, so super-admins have a working window to react before any
# drop. These can be overridden per-deployment by super-admins through the
# control_db.platform_settings document with key="tenant_purge_digest"; the
# scheduler reloads them on every loop iteration.
_TENANT_PURGE_DIGEST_HOUR_RIYADH = 7
_TENANT_PURGE_DIGEST_MINUTE_RIYADH = 30
_TENANT_PURGE_DIGEST_WINDOW_HOURS = 72


def _coerce_digest_int(value, *, default: int, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    if n < lo or n > hi:
        return default
    return n


async def get_tenant_purge_digest_settings() -> dict:
    """Read scheduler config from ``control_db.platform_settings``.

    Always returns valid defaults so the loop never breaks if the document
    is missing or contains junk values.
    """
    from control_db import control_db as _control_db
    try:
        doc = await _control_db.platform_settings.find_one(
            {"key": "tenant_purge_digest"}, {"_id": 0}
        ) or {}
    except Exception as e:
        print(f"Tenant purge digest: failed to load settings: {e}")
        doc = {}
    return {
        "hour": _coerce_digest_int(
            doc.get("hour"),
            default=_TENANT_PURGE_DIGEST_HOUR_RIYADH, lo=0, hi=23,
        ),
        "minute": _coerce_digest_int(
            doc.get("minute"),
            default=_TENANT_PURGE_DIGEST_MINUTE_RIYADH, lo=0, hi=59,
        ),
        "window_hours": _coerce_digest_int(
            doc.get("window_hours"),
            default=_TENANT_PURGE_DIGEST_WINDOW_HOURS, lo=1, hi=720,
        ),
        "updated_at": doc.get("updated_at"),
    }


async def update_tenant_purge_digest_settings(
    *, hour: int, minute: int, window_hours: int, actor: Optional[dict] = None
) -> dict:
    from control_db import control_db as _control_db
    h = _coerce_digest_int(
        hour, default=-1, lo=0, hi=23,
    )
    m = _coerce_digest_int(
        minute, default=-1, lo=0, hi=59,
    )
    w = _coerce_digest_int(
        window_hours, default=-1, lo=1, hi=720,
    )
    if h < 0:
        raise ValueError("hour must be 0–23")
    if m < 0:
        raise ValueError("minute must be 0–59")
    if w < 0:
        raise ValueError("window_hours must be 1–720")
    before = await get_tenant_purge_digest_settings()
    now_iso = datetime.now(timezone.utc).isoformat()
    await _control_db.platform_settings.update_one(
        {"key": "tenant_purge_digest"},
        {"$set": {
            "key": "tenant_purge_digest",
            "hour": h,
            "minute": m,
            "window_hours": w,
            "updated_at": now_iso,
        }},
        upsert=True,
    )
    after = await get_tenant_purge_digest_settings()
    try:
        from utils.audit import log_audit
        actor_doc = actor or {"user_id": "system", "username": "system", "is_admin": False}
        await log_audit(
            actor=actor_doc,
            action="settings.tenant_purge_digest.update",
            entity_type="settings",
            entity_id="tenant_purge_digest",
            entity_name="tenant_purge_digest_settings",
            before=before,
            after=after,
        )
    except Exception:
        pass
    return after


def _format_purge_remaining(delta: timedelta) -> str:
    total_seconds = int(delta.total_seconds())
    if total_seconds <= 0:
        return "OVERDUE — will purge on next scheduler tick"
    total_hours, _ = divmod(total_seconds, 3600)
    days, hours = divmod(total_hours, 24)
    if days > 0:
        return f"{days}d {hours}h remaining"
    if hours > 0:
        return f"{hours}h remaining"
    minutes = max(1, total_seconds // 60)
    return f"{minutes}m remaining"


async def _run_tenant_purge_digest() -> dict:
    """Scan ``control_db.tenants`` and emit one ops alert summarising every
    tenant whose grace period ends within the next
    ``_TENANT_PURGE_DIGEST_WINDOW_HOURS``.

    Returns ``{"sent": bool, "tenants": int}`` for logging and tests.
    Skips emitting entirely (and returns ``sent=False``) when the window
    is empty so super-admins do not get a noisy "nothing to do" email.
    """
    from control_db import control_db as _control_db
    from utils.tenant import DEFAULT_TENANT_SLUG as _DEFAULT_SLUG

    summary = {"sent": False, "tenants": 0}
    now = datetime.now(timezone.utc)
    cfg = await get_tenant_purge_digest_settings()
    window_hours = cfg["window_hours"]
    horizon = now + timedelta(hours=window_hours)

    try:
        candidates = await _control_db.tenants.find(
            {"status": "pending_delete"}, {"_id": 0}
        ).to_list(1000)
    except Exception as e:
        print(f"Tenant purge digest: failed to list tenants: {e}")
        return summary

    upcoming: list[tuple[dict, datetime]] = []
    for tenant in candidates:
        slug = tenant.get("slug") or ""
        if slug == _DEFAULT_SLUG:
            continue
        purge_at_str = tenant.get("deletion_purge_at")
        if not purge_at_str:
            continue
        try:
            purge_at = datetime.fromisoformat(str(purge_at_str).replace("Z", "+00:00"))
        except Exception:
            continue
        if purge_at <= horizon:
            upcoming.append((tenant, purge_at))

    if not upcoming:
        print(
            "Tenant purge digest: no tenants pending auto-purge in next "
            f"{window_hours}h; skipping email"
        )
        return summary

    upcoming.sort(key=lambda pair: pair[1])
    lines = []
    for tenant, purge_at in upcoming:
        slug = tenant.get("slug") or "(no-slug)"
        tid = tenant.get("id") or ""
        remaining = _format_purge_remaining(purge_at - now)
        lines.append(
            f"- {slug} (id={tid}): purge_at={purge_at.isoformat()}  →  {remaining}"
        )

    body = (
        f"The following {len(upcoming)} tenant(s) are scheduled for "
        f"permanent auto-purge within the next "
        f"{window_hours} hours.\n\n"
        + "\n".join(lines)
        + "\n\nTo cancel a deletion, call "
        "POST /super/tenants/{id}/cancel-delete before its purge_at "
        "timestamp."
    )

    try:
        await _emit_ops_alert(
            kind="tenant.auto_purge_digest",
            title=f"Daily digest: {len(upcoming)} tenant(s) pending auto-purge",
            body=body,
            severity="warning",
        )
        summary["sent"] = True
    except Exception as e:
        print(f"Tenant purge digest: emit failed: {e}")

    summary["tenants"] = len(upcoming)
    return summary


async def tenant_purge_digest_loop():
    global _tenant_purge_digest_started
    _tenant_purge_digest_started = True
    print(
        "Tenant purge digest scheduler started "
        "(timezone: Asia/Riyadh; schedule loaded from control_db on each tick)"
    )
    while True:
        try:
            cfg = await get_tenant_purge_digest_settings()
            now = datetime.now(_RIYADH_TZ)
            next_run = now.replace(
                hour=cfg["hour"],
                minute=cfg["minute"],
                second=0,
                microsecond=0,
            )
            if next_run <= now:
                next_run += timedelta(days=1)
            wait_seconds = (next_run - now).total_seconds()
            print(
                f"Tenant purge digest: next run in {wait_seconds:.0f}s "
                f"at {next_run.isoformat()}"
            )
            await asyncio.sleep(wait_seconds)
            try:
                summary = await _run_tenant_purge_digest()
                print(f"Tenant purge digest: finished {summary}")
            except Exception as e:
                print(f"Tenant purge digest run failed: {e}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Tenant purge digest error: {e}")
            await asyncio.sleep(3600)


def start_tenant_purge_digest_scheduler():
    global _tenant_purge_digest_started
    if not _tenant_purge_digest_started:
        asyncio.ensure_future(tenant_purge_digest_loop())


@api_router.post("/backup/create")
async def create_backup(token: Optional[str] = None):
    _require_export_admin_token(token)

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"backup_{timestamp}.json"
    filepath = BACKUPS_DIR / filename

    backup_data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "collections": {}
    }

    for col_name in _ALL_COLLECTIONS:
        try:
            collection = db[col_name]
            documents = await collection.find({}, {"_id": 0}).to_list(100000)
            if documents:
                backup_data["collections"][col_name] = documents
        except Exception as e:
            pass  # Skip empty or inaccessible collections

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(backup_data, f, ensure_ascii=False, default=str)

    file_size = filepath.stat().st_size
    saved_collections = list(backup_data["collections"].keys())

    await _send_backup_to_telegram(filepath, filename)

    return {
        "success": True,
        "filename": filename,
        "size": file_size,
        "size_mb": round(file_size / (1024 * 1024), 2),
        "collections_count": len(saved_collections),
        "collections": saved_collections,
        "timestamp": backup_data["timestamp"]
    }


@api_router.get("/backup/list")
async def list_backups(token: Optional[str] = None):
    _require_export_admin_token(token)

    backups = []
    if BACKUPS_DIR.exists():
        all_files = list(BACKUPS_DIR.glob("backup_*.json")) + list(BACKUPS_DIR.glob("auto_backup_*.json"))
        for f in sorted(all_files, key=lambda x: x.stat().st_mtime, reverse=True):
            stat = f.stat()
            backups.append({
                "filename": f.name,
                "size": stat.st_size,
                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "is_auto": f.name.startswith("auto_backup_")
            })

    return {"backups": backups, "count": len(backups)}


@api_router.get("/backup/download/{filename}")
async def download_backup(filename: str, token: Optional[str] = None):
    _require_export_admin_token(token)

    filepath = BACKUPS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(status_code=404, detail="Backup file not found")

    return FileResponse(
        path=str(filepath),
        filename=filename,
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@api_router.post("/backup/restore/{filename}")
async def restore_backup(filename: str, token: Optional[str] = None):
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        actor_payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        _enforce_tenant_match_local(actor_payload)
    except:
        raise HTTPException(status_code=401, detail="Invalid token")

    filepath = BACKUPS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(status_code=404, detail="Backup file not found")

    with open(filepath, 'r', encoding='utf-8') as f:
        backup_data = json.load(f)

    collections = backup_data.get("collections", {})
    restored = {}

    for col_name, documents in collections.items():
        collection = db[col_name]
        await collection.delete_many({})
        if documents:
            await collection.insert_many(documents)
        restored[col_name] = len(documents)

    try:
        from utils.audit import log_audit
        await log_audit(
            actor=actor_payload,
            action="backup.restore",
            entity_type="backup",
            entity_id=filename,
            entity_name=filename,
            after={
                "filename": filename,
                "total_collections": len(restored),
                "backup_timestamp": backup_data.get("timestamp", ""),
                "restored_collections": restored,
            },
        )
    except Exception:
        pass

    return {
        "success": True,
        "message": "Backup restored successfully",
        "restored_collections": restored,
        "total_collections": len(restored),
        "backup_timestamp": backup_data.get("timestamp", "")
    }


@api_router.post("/backup/upload")
async def upload_backup(file: UploadFile = File(...), token: Optional[str] = Query(None)):
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        actor_payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        _enforce_tenant_match_local(actor_payload)
    except:
        raise HTTPException(status_code=401, detail="Invalid token")

    if not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="يجب أن يكون الملف بصيغة JSON")

    filename = file.filename
    if not filename.startswith("backup_"):
        filename = f"backup_{filename}"

    filepath = BACKUPS_DIR / filename
    content = await file.read()

    try:
        json.loads(content)
    except Exception:
        raise HTTPException(status_code=400, detail="الملف ليس JSON صحيحاً")

    with open(filepath, 'wb') as f:
        f.write(content)

    try:
        from utils.audit import log_audit
        await log_audit(
            actor=actor_payload,
            action="backup.upload",
            entity_type="backup",
            entity_id=filename,
            entity_name=filename,
            after={"filename": filename, "size": len(content)},
        )
    except Exception:
        pass

    return {
        "success": True,
        "filename": filename,
        "size": len(content),
        "message": "تم رفع النسخة الاحتياطية بنجاح"
    }


@api_router.delete("/backup/{filename}")
async def delete_backup(filename: str, token: Optional[str] = None):
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        actor_payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        _enforce_tenant_match_local(actor_payload)
    except:
        raise HTTPException(status_code=401, detail="Invalid token")

    filepath = BACKUPS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(status_code=404, detail="Backup file not found")

    file_size = filepath.stat().st_size
    filepath.unlink()

    try:
        from utils.audit import log_audit
        await log_audit(
            actor=actor_payload,
            action="backup.delete",
            entity_type="backup",
            entity_id=filename,
            entity_name=filename,
            before={"filename": filename, "size": file_size},
        )
    except Exception:
        pass

    return {"success": True, "message": f"Backup {filename} deleted successfully"}


@api_router.get("/export/reports")
async def export_financial_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    format: str = "xlsx",
    token: Optional[str] = None
):
    """Export financial report to Excel/CSV"""
    _require_export_admin_token(token)
    
    query = {"status": "paid"}

    end_date_full = (end_date + "T23:59:59.999999") if end_date and "T" not in end_date else end_date
    start_date_full = (start_date + "T00:00:00") if start_date and "T" not in start_date else start_date

    if start_date_full:
        query["paid_at"] = {"$gte": start_date_full}
    if end_date_full:
        if "paid_at" in query:
            query["paid_at"]["$lte"] = end_date_full
        else:
            query["paid_at"] = {"$lte": end_date_full}
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("paid_at", -1).to_list(10000)
    activities_data = await db.activities.find({}, {"_id": 0}).to_list(100)
    
    # Calculate summary
    total_revenue = sum(inv["total"] for inv in invoices)
    total_vat = sum(inv.get("vat_amount", 0) for inv in invoices)
    
    # Revenue by activity
    revenue_by_activity = {}
    for inv in invoices:
        for item in inv.get("items", []):
            act_name = item.get("activity_name", "غير محدد")
            revenue_by_activity[act_name] = revenue_by_activity.get(act_name, 0) + item.get("fee", 0)
    
    if format == "xlsx":
        xl = _get_openpyxl()
        Workbook = xl.Workbook; Font = xl.Font; PatternFill = xl.PatternFill; Border = xl.Border; Side = xl.Side; Alignment = xl.Alignment
        wb = Workbook()
        
        # Summary Sheet
        ws_summary = wb.active
        ws_summary.title = "ملخص التقرير"
        
        header_fill = PatternFill(start_color="F97316", end_color="F97316", fill_type="solid")
        header_font = Font(bold=True, color="FFFFFF")
        title_font = Font(bold=True, size=14)
        thin_border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
        
        ws_summary.cell(row=1, column=1, value="التقرير المالي - شركة اداء الابطال العالمية للرياضة").font = title_font
        ws_summary.cell(row=2, column=1, value=f"الفترة: {start_date or 'الكل'} إلى {end_date or 'الآن'}")
        ws_summary.cell(row=4, column=1, value="إجمالي الإيرادات:").font = Font(bold=True)
        ws_summary.cell(row=4, column=2, value=f"{total_revenue} ر.س")
        ws_summary.cell(row=5, column=1, value="إجمالي الضريبة:").font = Font(bold=True)
        ws_summary.cell(row=5, column=2, value=f"{total_vat} ر.س")
        ws_summary.cell(row=6, column=1, value="عدد الفواتير:").font = Font(bold=True)
        ws_summary.cell(row=6, column=2, value=len(invoices))
        
        # Revenue by activity section
        ws_summary.cell(row=8, column=1, value="الإيرادات حسب النشاط").font = title_font
        ws_summary.cell(row=9, column=1, value="النشاط").fill = header_fill
        ws_summary.cell(row=9, column=1).font = header_font
        ws_summary.cell(row=9, column=2, value="الإيرادات").fill = header_fill
        ws_summary.cell(row=9, column=2).font = header_font
        
        row = 10
        for act_name, revenue in revenue_by_activity.items():
            ws_summary.cell(row=row, column=1, value=act_name).border = thin_border
            ws_summary.cell(row=row, column=2, value=f"{revenue} ر.س").border = thin_border
            row += 1
        
        ws_summary.column_dimensions['A'].width = 25
        ws_summary.column_dimensions['B'].width = 20
        
        # Invoices Detail Sheet
        ws_invoices = wb.create_sheet("تفاصيل الفواتير")
        headers = ["م", "رقم الفاتورة", "اسم العميل", "الأنشطة", "الإجمالي", "تاريخ الدفع"]
        for col, header in enumerate(headers, 1):
            cell = ws_invoices.cell(row=1, column=col, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.border = thin_border
        
        for row_num, invoice in enumerate(invoices, 2):
            activities_list = ", ".join([item.get('activity_name', '') for item in invoice.get("items", [])])
            row_data = [row_num - 1, invoice.get("id", "")[:8], invoice.get("customer_name_ar", invoice.get("member_name", "")), activities_list, invoice.get("total", 0), (invoice.get("paid_at", "") or "")[:10]]
            for col, value in enumerate(row_data, 1):
                cell = ws_invoices.cell(row=row_num, column=col, value=value)
                cell.border = thin_border
        
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=financial_report_{datetime.now().strftime('%Y%m%d')}.xlsx"}
        )
    else:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["التقرير المالي - شركة اداء الابطال العالمية للرياضة"])
        writer.writerow([f"الفترة: {start_date or 'الكل'} إلى {end_date or 'الآن'}"])
        writer.writerow([f"إجمالي الإيرادات: {total_revenue} ر.س"])
        writer.writerow([f"عدد الفواتير: {len(invoices)}"])
        writer.writerow([])
        writer.writerow(["م", "رقم الفاتورة", "اسم العميل", "الأنشطة", "الإجمالي", "تاريخ الدفع"])
        
        for idx, invoice in enumerate(invoices, 1):
            activities_list = ", ".join([item.get('activity_name', '') for item in invoice.get("items", [])])
            writer.writerow([idx, invoice.get("id", "")[:8], invoice.get("member_name", ""), activities_list, invoice.get("total", 0), (invoice.get("paid_at", "") or "")[:10]])
        
        output.seek(0)
        response_content = '\ufeff' + output.getvalue()
        
        return StreamingResponse(
            iter([response_content]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=financial_report_{datetime.now().strftime('%Y%m%d')}.csv"}
        )

@api_router.get("/export/all-data")
async def export_all_data(token: Optional[str] = None):
    """Export all data (members, invoices, activities, coaches) to Excel"""
    _require_export_admin_token(token)
    
    # Fetch all data
    members = await db.members.find({}, {"_id": 0}).to_list(10000)
    invoices = await db.invoices.find({}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    activities_data = await db.activities.find({}, {"_id": 0}).to_list(100)
    coaches = await db.coaches.find({}, {"_id": 0}).to_list(100)
    
    # Create workbook
    xl = _get_openpyxl()
    Workbook = xl.Workbook; Font = xl.Font; PatternFill = xl.PatternFill; Border = xl.Border; Side = xl.Side; Alignment = xl.Alignment
    wb = Workbook()
    
    # Style definitions
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="F97316", end_color="F97316", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )
    
    # Members Sheet
    ws_members = wb.active
    ws_members.title = "الأعضاء"
    member_headers = ["م", "الاسم", "العمر", "ولي الأمر", "الجوال", "الأنشطة", "الحالة", "تاريخ التسجيل"]
    ws_members.append(member_headers)
    for col, header in enumerate(member_headers, 1):
        cell = ws_members.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border
    
    for idx, member in enumerate(members, 1):
        activities_list = ", ".join([a.get("activity_name", "") for a in member.get("activities", [])])
        statuses = ", ".join(set([a.get("status", "") for a in member.get("activities", [])]))
        ws_members.append([
            idx, member.get("name_ar", ""), member.get("age", ""),
            member.get("guardian_name_ar", ""), member.get("phone", ""),
            activities_list, statuses, member.get("created_at", "")[:10]
        ])
    
    # Invoices Sheet
    ws_invoices = wb.create_sheet("الفواتير")
    invoice_headers = ["م", "رقم الفاتورة", "العميل", "الجوال", "الأنشطة", "المجموع", "الضريبة", "الإجمالي", "الحالة", "التاريخ"]
    ws_invoices.append(invoice_headers)
    for col, header in enumerate(invoice_headers, 1):
        cell = ws_invoices.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
    
    for idx, inv in enumerate(invoices, 1):
        activities_list = ", ".join([item.get("activity_name", "") for item in inv.get("items", [])])
        ws_invoices.append([
            idx, inv.get("id", "")[:8], inv.get("customer_name_ar", inv.get("member_name", "")),
            inv.get("customer_phone", ""), activities_list, inv.get("subtotal", 0),
            inv.get("vat_amount", 0), inv.get("total", 0), inv.get("status", ""),
            inv.get("created_at", "")[:10]
        ])
    
    # Activities Sheet
    ws_activities = wb.create_sheet("الأنشطة")
    activity_headers = ["م", "النشاط", "الوصف", "الرسوم الشهرية"]
    ws_activities.append(activity_headers)
    for col, header in enumerate(activity_headers, 1):
        cell = ws_activities.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
    
    for idx, act in enumerate(activities_data, 1):
        ws_activities.append([idx, act.get("name_ar", ""), act.get("description_ar", ""), act.get("monthly_fee", 0)])
    
    # Coaches Sheet
    ws_coaches = wb.create_sheet("المدربين")
    coach_headers = ["م", "الاسم", "الجوال", "البريد", "الأنشطة"]
    ws_coaches.append(coach_headers)
    for col, header in enumerate(coach_headers, 1):
        cell = ws_coaches.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
    
    for idx, coach in enumerate(coaches, 1):
        ws_coaches.append([idx, coach.get("name_ar", ""), coach.get("phone", ""), coach.get("email", ""), len(coach.get("activities", []))])
    
    # Adjust column widths
    for ws in [ws_members, ws_invoices, ws_activities, ws_coaches]:
        for column in ws.columns:
            max_length = max(len(str(cell.value or "")) for cell in column)
            ws.column_dimensions[column[0].column_letter].width = min(max_length + 2, 50)
    
    # Save to buffer
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=academy_data_{datetime.now().strftime('%Y%m%d')}.xlsx"}
    )

@api_router.get("/invoices/{invoice_id}/qr")
async def get_invoice_qr(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Generate QR code for invoice (ZATCA compliant) - Only for paid invoices"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    # Only generate QR for paid invoices
    if invoice.get("status") != "paid":
        raise HTTPException(status_code=400, detail="QR code is only available for paid invoices")
    
    # ZATCA TLV format for QR code
    def tlv_encode(tag, value):
        value_bytes = value.encode('utf-8')
        return bytes([tag, len(value_bytes)]) + value_bytes
    
    # Build ZATCA-compliant data
    seller_name = "شركة اداء الابطال العالمية للرياضة"
    vat_number = COMPANY_TAX_NUMBER
    timestamp = invoice.get("paid_at", invoice.get("created_at", datetime.now(timezone.utc).isoformat()))
    total_with_vat = str(invoice.get("total", 0))
    vat_amount = str(invoice.get("vat_amount", 0))
    
    # Create TLV encoded data
    tlv_data = (
        tlv_encode(1, seller_name) +
        tlv_encode(2, vat_number) +
        tlv_encode(3, timestamp) +
        tlv_encode(4, total_with_vat) +
        tlv_encode(5, vat_amount)
    )
    
    # Base64 encode for QR
    qr_data = base64.b64encode(tlv_data).decode('utf-8')
    
    # Generate QR code
    qrcode = _get_qrcode()
    qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=10, border=4)
    qr.add_data(qr_data)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    
    # Save to buffer
    img_buffer = io.BytesIO()
    img.save(img_buffer, format='PNG')
    img_buffer.seek(0)
    
    # Return as base64 for embedding
    img_base64 = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
    
    return {
        "qr_image": f"data:image/png;base64,{img_base64}",
        "qr_data": qr_data,
        "invoice_id": invoice_id
    }

@api_router.get("/credit-notes/{credit_note_id}/qr")
async def get_credit_note_qr(credit_note_id: str, current_user: dict = Depends(get_current_user)):
    """Generate QR code for credit note (ZATCA compliant)"""
    credit_note = await db.credit_notes.find_one({"id": credit_note_id}, {"_id": 0})
    if not credit_note:
        raise HTTPException(status_code=404, detail="Credit note not found")
    
    # ZATCA TLV format for QR code
    def tlv_encode(tag, value):
        value_bytes = value.encode('utf-8')
        return bytes([tag, len(value_bytes)]) + value_bytes
    
    # Build ZATCA-compliant data for credit note
    seller_name = "شركة اداء الابطال العالمية للرياضة"
    vat_number = COMPANY_TAX_NUMBER
    timestamp = credit_note.get("created_at", datetime.now(timezone.utc).isoformat())
    # Negative amounts for refund
    total_with_vat = f"-{credit_note.get('refund_amount', 0)}"
    vat_amount = f"-{credit_note.get('vat_amount', 0)}"
    
    # Create TLV encoded data
    tlv_data = (
        tlv_encode(1, seller_name) +
        tlv_encode(2, vat_number) +
        tlv_encode(3, timestamp) +
        tlv_encode(4, total_with_vat) +
        tlv_encode(5, vat_amount)
    )
    
    # Base64 encode for QR
    qr_data = base64.b64encode(tlv_data).decode('utf-8')
    
    # Generate QR code with red color for credit note
    qrcode = _get_qrcode()
    qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=10, border=4)
    qr.add_data(qr_data)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="#dc2626", back_color="white")
    
    # Save to buffer
    img_buffer = io.BytesIO()
    img.save(img_buffer, format='PNG')
    img_buffer.seek(0)
    
    # Return as base64 for embedding
    img_base64 = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
    
    return {
        "qr_image": f"data:image/png;base64,{img_base64}",
        "qr_data": qr_data,
        "credit_note_id": credit_note_id
    }

# ============ PRODUCT INVOICES (Store Sales) ============

class ProductInvoiceItem(BaseModel):
    product_id: str
    name: str
    price: float
    quantity: int
    total: float

class ProductInvoiceCreate(BaseModel):
    customer_name: str
    customer_phone: Optional[str] = ""
    member_id: Optional[str] = None
    payment_method: str = "cash"
    items: List[ProductInvoiceItem]
    status: str = "draft"  # draft or paid
    branch_id: Optional[str] = None  # Admin can specify branch

class ProductInvoice(BaseModel):
    id: str
    invoice_number: str
    customer_name: str
    customer_phone: Optional[str] = ""
    member_id: Optional[str] = None
    payment_method: str
    items: List[ProductInvoiceItem]
    subtotal: float
    vat_amount: float
    vat_rate: float = 15.0
    total: float
    status: str
    created_at: str
    updated_at: Optional[str] = None
    paid_at: Optional[str] = None
    branch_id: Optional[str] = None

@api_router.get("/product-invoices")
async def get_product_invoices(
    branch_filter: Optional[str] = None,
    member_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all product invoices"""
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    if member_id:
        query["member_id"] = member_id
    # Admin can filter by any branch
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
    invoices = await db.product_invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return invoices

@api_router.post("/product-invoices")
async def create_product_invoice(invoice: ProductInvoiceCreate, current_user: dict = Depends(get_current_user)):
    """Create a new product invoice"""
    subtotal = sum(item.total for item in invoice.items)
    vat_rate = 15.0
    vat_amount = round(subtotal * (vat_rate / 100), 2)
    total = round(subtotal + vat_amount, 2)
    
    # Generate invoice number
    last_invoice = await db.product_invoices.find_one(
        {"invoice_number": {"$exists": True}},
        sort=[("invoice_number", -1)]
    )
    if last_invoice and last_invoice.get("invoice_number"):
        try:
            last_num = int(last_invoice["invoice_number"].replace("P", ""))
            next_num = last_num + 1
        except:
            next_num = 202601001
    else:
        next_num = 202601001
    
    invoice_doc = {
        "id": str(uuid.uuid4()),
        "invoice_number": f"P{next_num}",
        "customer_name": invoice.customer_name,
        "customer_phone": invoice.customer_phone,
        "member_id": invoice.member_id,
        "payment_method": invoice.payment_method,
        "items": [item.model_dump() for item in invoice.items],
        "subtotal": subtotal,
        "vat_amount": vat_amount,
        "vat_rate": vat_rate,
        "total": total,
        "status": invoice.status,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "paid_at": datetime.now(timezone.utc).isoformat() if invoice.status == "paid" else None,
        "branch_id": invoice.branch_id if current_user.get("is_admin") and invoice.branch_id and invoice.branch_id != "all" else current_user.get("branch_id")
    }
    
    # If status is paid, deduct stock
    if invoice.status == "paid":
        for item in invoice.items:
            await db.products.update_one(
                {"id": item.product_id},
                {"$inc": {"quantity": -item.quantity}}
            )
    
    await db.product_invoices.insert_one(invoice_doc)
    invoice_doc.pop("_id", None)
    return invoice_doc

@api_router.put("/product-invoices/{invoice_id}")
async def update_product_invoice(invoice_id: str, invoice: ProductInvoiceCreate, current_user: dict = Depends(get_current_user)):
    """Update a product invoice (only drafts can be updated)"""
    existing = await db.product_invoices.find_one({"id": invoice_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if existing.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Cannot update paid invoice")
    
    subtotal = sum(item.total for item in invoice.items)
    vat_rate = 15.0
    vat_amount = round(subtotal * (vat_rate / 100), 2)
    total = round(subtotal + vat_amount, 2)
    
    update_data = {
        "customer_name": invoice.customer_name,
        "customer_phone": invoice.customer_phone,
        "member_id": invoice.member_id,
        "payment_method": invoice.payment_method,
        "items": [item.model_dump() for item in invoice.items],
        "subtotal": subtotal,
        "vat_amount": vat_amount,
        "total": total,
        "status": invoice.status,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    # If changing to paid, deduct stock and set paid_at
    if invoice.status == "paid" and existing.get("status") != "paid":
        update_data["paid_at"] = datetime.now(timezone.utc).isoformat()
        for item in invoice.items:
            await db.products.update_one(
                {"id": item.product_id},
                {"$inc": {"quantity": -item.quantity}}
            )
    
    result = await db.product_invoices.find_one_and_update(
        {"id": invoice_id},
        {"$set": update_data},
        return_document=True
    )
    result.pop("_id", None)
    return result

@api_router.delete("/product-invoices/{invoice_id}")
async def delete_product_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a product invoice (only drafts can be deleted)"""
    existing = await db.product_invoices.find_one({"id": invoice_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if existing.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Cannot delete paid invoice")
    
    await db.product_invoices.delete_one({"id": invoice_id})
    return {"message": "Invoice deleted"}

# ============ ACCOUNTING SYSTEM MODELS ============

# Chart of Accounts Model
class AccountCreate(BaseModel):
    code: str  # رقم الحساب
    name_ar: str  # اسم الحساب بالعربي
    name: Optional[str] = ""  # اسم الحساب بالإنجليزي
    account_type: str  # assets, liabilities, equity, revenue, expenses
    parent_id: Optional[str] = None  # الحساب الرئيسي
    is_parent: bool = False  # هل هو حساب رئيسي
    description: Optional[str] = ""
    is_active: bool = True
    branch_id: Optional[str] = None

class Account(BaseModel):
    id: str
    code: str
    name_ar: str
    name: Optional[str] = ""
    account_type: str
    parent_id: Optional[str] = None
    is_parent: bool = False
    description: Optional[str] = ""
    is_active: bool = True
    branch_id: Optional[str] = None
    balance: float = 0
    created_at: str

# Supplier Model
class SupplierCreate(BaseModel):
    name_ar: str
    name: Optional[str] = ""
    phone: str
    email: Optional[str] = ""
    address: Optional[str] = ""
    tax_number: Optional[str] = ""  # الرقم الضريبي
    commercial_reg: Optional[str] = ""  # السجل التجاري
    contact_person: Optional[str] = ""
    notes: Optional[str] = ""
    credit_limit: float = 0  # حد الائتمان
    payment_terms: int = 30  # عدد أيام السداد
    branch_id: Optional[str] = None

class Supplier(BaseModel):
    id: str
    name_ar: str
    name: Optional[str] = ""
    phone: str
    email: Optional[str] = ""
    address: Optional[str] = ""
    tax_number: Optional[str] = ""
    commercial_reg: Optional[str] = ""
    contact_person: Optional[str] = ""
    notes: Optional[str] = ""
    credit_limit: float = 0
    payment_terms: int = 30
    total_purchases: float = 0  # إجمالي المشتريات
    total_paid: float = 0  # إجمالي المدفوع
    balance: float = 0  # الرصيد المستحق
    branch_id: Optional[str] = None
    created_at: str

# Purchase Invoice Item Model
class PurchaseInvoiceItem(BaseModel):
    product_id: Optional[str] = None
    description: str
    quantity: int = 1
    unit_price: float
    tax_rate: float = 15  # نسبة الضريبة %
    total: float = 0

# Purchase Invoice Model
class PurchaseInvoiceCreate(BaseModel):
    supplier_id: str
    supplier_invoice_number: Optional[str] = ""  # رقم فاتورة المورد
    invoice_date: str
    due_date: Optional[str] = ""  # تاريخ الاستحقاق
    items: List[PurchaseInvoiceItem]
    payment_method: str = "credit"  # cash, credit, transfer
    notes: Optional[str] = ""
    branch_id: Optional[str] = None

class PurchaseInvoice(BaseModel):
    id: str
    invoice_number: str  # رقم فاتورة المشتريات الداخلي
    supplier_id: str
    supplier_name: str
    supplier_invoice_number: Optional[str] = ""
    invoice_date: str
    due_date: Optional[str] = ""
    items: List[PurchaseInvoiceItem]
    subtotal: float
    tax_amount: float
    total: float
    paid_amount: float = 0
    remaining_amount: float = 0
    status: str = "pending"  # pending, partial, paid
    payment_method: str = "credit"
    notes: Optional[str] = ""
    journal_entry_id: Optional[str] = None  # ربط بالقيد المحاسبي
    branch_id: Optional[str] = None
    created_by: Optional[str] = ""
    created_at: str

# Journal Entry Model
class JournalEntryLine(BaseModel):
    account_id: str
    account_code: str
    account_name: str
    debit: float = 0  # مدين
    credit: float = 0  # دائن
    description: Optional[str] = ""
    party_type: Optional[str] = ""  # supplier, customer
    party_id: Optional[str] = ""
    party_name: Optional[str] = ""

class JournalEntryCreate(BaseModel):
    entry_date: str
    journal_type: str  # purchases, sales, general, payment, receipt
    reference_type: Optional[str] = ""  # purchase_invoice, sales_invoice, etc
    reference_id: Optional[str] = ""
    reference_number: Optional[str] = ""
    lines: List[JournalEntryLine]
    notes: Optional[str] = ""
    branch_id: Optional[str] = None

class JournalEntry(BaseModel):
    id: str
    entry_number: str  # رقم القيد
    entry_date: str
    journal_type: str
    reference_type: Optional[str] = ""
    reference_id: Optional[str] = ""
    reference_number: Optional[str] = ""
    lines: List[JournalEntryLine]
    total_debit: float
    total_credit: float
    is_balanced: bool = True
    notes: Optional[str] = ""
    branch_id: Optional[str] = None
    created_by: Optional[str] = ""
    created_at: str
    status: str = "posted"  # draft, posted, cancelled

# ============ CHART OF ACCOUNTS ROUTES ============

@api_router.get("/accounts")
async def get_accounts(
    account_type: Optional[str] = None,
    is_parent: Optional[bool] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all accounts from chart of accounts"""
    query = {}
    
    if account_type:
        query["account_type"] = account_type
    if is_parent is not None:
        query["is_parent"] = is_parent
    if branch_filter and branch_filter != "all":
        query["$or"] = [{"branch_id": branch_filter}, {"branch_id": None}, {"branch_id": {"$exists": False}}]
    
    accounts = await db.accounts.find(query, {"_id": 0}).sort("code", 1).to_list(1000)
    return accounts

@api_router.post("/accounts")
async def create_account(account: AccountCreate, current_user: dict = Depends(get_current_user)):
    """Create a new account in chart of accounts"""
    # Check if code exists
    existing = await db.accounts.find_one({"code": account.code})
    if existing:
        raise HTTPException(status_code=400, detail="رقم الحساب موجود مسبقاً")
    
    account_id = str(uuid.uuid4())
    branch_id = account.branch_id if current_user.get("is_admin") else current_user.get("branch_id")
    
    account_doc = {
        "id": account_id,
        **account.model_dump(),
        "branch_id": branch_id,
        "balance": 0,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.accounts.insert_one(account_doc)
    return {k: v for k, v in account_doc.items() if k != "_id"}

@api_router.put("/accounts/{account_id}")
async def update_account(account_id: str, account: AccountCreate, current_user: dict = Depends(get_current_user)):
    """Update an account"""
    result = await db.accounts.find_one_and_update(
        {"id": account_id},
        {"$set": account.model_dump()},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Account not found")
    return {k: v for k, v in result.items() if k != "_id"}

@api_router.delete("/accounts/{account_id}")
async def delete_account(account_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an account (only if no transactions)"""
    # Check if account has journal entries
    entry = await db.journal_entries.find_one({"lines.account_id": account_id})
    if entry:
        raise HTTPException(status_code=400, detail="لا يمكن حذف حساب له قيود محاسبية")
    
    result = await db.accounts.delete_one({"id": account_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"message": "تم حذف الحساب"}

@api_router.post("/accounts/seed-default")
async def seed_default_accounts(current_user: dict = Depends(get_current_user)):
    """Create default chart of accounts for sports academy"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Check if accounts already exist
    count = await db.accounts.count_documents({})
    if count > 0:
        raise HTTPException(status_code=400, detail="شجرة الحسابات موجودة مسبقاً")
    
    default_accounts = [
        # الأصول - Assets (1xxx)
        {"code": "1000", "name_ar": "الأصول", "name": "Assets", "account_type": "assets", "is_parent": True},
        {"code": "1100", "name_ar": "الأصول المتداولة", "name": "Current Assets", "account_type": "assets", "is_parent": True, "parent_id": "1000"},
        {"code": "1110", "name_ar": "الصندوق", "name": "Cash", "account_type": "assets", "parent_id": "1100"},
        {"code": "1120", "name_ar": "البنك", "name": "Bank", "account_type": "assets", "parent_id": "1100"},
        {"code": "1130", "name_ar": "حسابات العملاء", "name": "Accounts Receivable", "account_type": "assets", "parent_id": "1100"},
        {"code": "1140", "name_ar": "المخزون", "name": "Inventory", "account_type": "assets", "parent_id": "1100"},
        {"code": "1150", "name_ar": "ضريبة المدخلات", "name": "Input VAT", "account_type": "assets", "parent_id": "1100"},
        {"code": "1200", "name_ar": "الأصول الثابتة", "name": "Fixed Assets", "account_type": "assets", "is_parent": True, "parent_id": "1000"},
        {"code": "1210", "name_ar": "معدات رياضية", "name": "Sports Equipment", "account_type": "assets", "parent_id": "1200"},
        {"code": "1220", "name_ar": "أثاث ومفروشات", "name": "Furniture", "account_type": "assets", "parent_id": "1200"},
        {"code": "1230", "name_ar": "أجهزة وحاسبات", "name": "Computers & Equipment", "account_type": "assets", "parent_id": "1200"},
        
        # الخصوم - Liabilities (2xxx)
        {"code": "2000", "name_ar": "الخصوم", "name": "Liabilities", "account_type": "liabilities", "is_parent": True},
        {"code": "2100", "name_ar": "الخصوم المتداولة", "name": "Current Liabilities", "account_type": "liabilities", "is_parent": True, "parent_id": "2000"},
        {"code": "2110", "name_ar": "حسابات الموردين", "name": "Accounts Payable", "account_type": "liabilities", "parent_id": "2100"},
        {"code": "2120", "name_ar": "ضريبة المخرجات", "name": "Output VAT", "account_type": "liabilities", "parent_id": "2100"},
        {"code": "2130", "name_ar": "إيرادات مؤجلة", "name": "Deferred Revenue", "account_type": "liabilities", "parent_id": "2100"},
        {"code": "2140", "name_ar": "مستحقات الموظفين", "name": "Employee Payables", "account_type": "liabilities", "parent_id": "2100"},
        
        # حقوق الملكية - Equity (3xxx)
        {"code": "3000", "name_ar": "حقوق الملكية", "name": "Equity", "account_type": "equity", "is_parent": True},
        {"code": "3100", "name_ar": "رأس المال", "name": "Capital", "account_type": "equity", "parent_id": "3000"},
        {"code": "3200", "name_ar": "الأرباح المحتجزة", "name": "Retained Earnings", "account_type": "equity", "parent_id": "3000"},
        
        # الإيرادات - Revenue (4xxx)
        {"code": "4000", "name_ar": "الإيرادات", "name": "Revenue", "account_type": "revenue", "is_parent": True},
        {"code": "4100", "name_ar": "إيرادات الاشتراكات", "name": "Subscription Revenue", "account_type": "revenue", "is_parent": True, "parent_id": "4000"},
        {"code": "4110", "name_ar": "إيرادات السباحة", "name": "Swimming Revenue", "account_type": "revenue", "parent_id": "4100"},
        {"code": "4120", "name_ar": "إيرادات كرة القدم", "name": "Football Revenue", "account_type": "revenue", "parent_id": "4100"},
        {"code": "4130", "name_ar": "إيرادات الكاراتيه", "name": "Karate Revenue", "account_type": "revenue", "parent_id": "4100"},
        {"code": "4140", "name_ar": "إيرادات الجمباز", "name": "Gymnastics Revenue", "account_type": "revenue", "parent_id": "4100"},
        {"code": "4200", "name_ar": "إيرادات المبيعات", "name": "Sales Revenue", "account_type": "revenue", "parent_id": "4000"},
        {"code": "4300", "name_ar": "إيرادات أخرى", "name": "Other Revenue", "account_type": "revenue", "parent_id": "4000"},
        
        # المصروفات - Expenses (5xxx)
        {"code": "5000", "name_ar": "المصروفات", "name": "Expenses", "account_type": "expenses", "is_parent": True},
        {"code": "5100", "name_ar": "تكلفة المبيعات", "name": "Cost of Sales", "account_type": "expenses", "parent_id": "5000"},
        {"code": "5200", "name_ar": "المشتريات", "name": "Purchases", "account_type": "expenses", "is_parent": True, "parent_id": "5000"},
        {"code": "5210", "name_ar": "مشتريات معدات سباحة", "name": "Swimming Equipment Purchases", "account_type": "expenses", "parent_id": "5200"},
        {"code": "5220", "name_ar": "مشتريات أدوات رياضية", "name": "Sports Supplies Purchases", "account_type": "expenses", "parent_id": "5200"},
        {"code": "5230", "name_ar": "مشتريات عامة", "name": "General Purchases", "account_type": "expenses", "parent_id": "5200"},
        {"code": "5300", "name_ar": "رواتب وأجور", "name": "Salaries & Wages", "account_type": "expenses", "parent_id": "5000"},
        {"code": "5400", "name_ar": "إيجارات", "name": "Rent", "account_type": "expenses", "parent_id": "5000"},
        {"code": "5500", "name_ar": "مصاريف كهرباء ومياه", "name": "Utilities", "account_type": "expenses", "parent_id": "5000"},
        {"code": "5600", "name_ar": "صيانة وإصلاحات", "name": "Maintenance", "account_type": "expenses", "parent_id": "5000"},
        {"code": "5700", "name_ar": "مصاريف تسويق", "name": "Marketing", "account_type": "expenses", "parent_id": "5000"},
        {"code": "5800", "name_ar": "مصاريف إدارية", "name": "Administrative", "account_type": "expenses", "parent_id": "5000"},
        {"code": "5900", "name_ar": "مصاريف أخرى", "name": "Other Expenses", "account_type": "expenses", "parent_id": "5000"},
    ]
    
    for acc in default_accounts:
        acc["id"] = str(uuid.uuid4())
        acc["is_active"] = True
        acc["description"] = ""
        acc["balance"] = 0
        acc["branch_id"] = None
        acc["is_parent"] = acc.get("is_parent", False)
        acc["parent_id"] = acc.get("parent_id")
        acc["created_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.accounts.insert_many(default_accounts)
    return {"message": "تم إنشاء شجرة الحسابات الافتراضية", "count": len(default_accounts)}

# ============ SUPPLIERS ROUTES ============

@api_router.get("/suppliers")
async def get_suppliers(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all suppliers"""
    query = {}
    is_admin = current_user.get("is_admin", False)
    
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
    suppliers = await db.suppliers.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return suppliers

@api_router.get("/suppliers/{supplier_id}")
async def get_supplier(supplier_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single supplier"""
    supplier = await db.suppliers.find_one({"id": supplier_id}, {"_id": 0})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier

@api_router.post("/suppliers")
async def create_supplier(supplier: SupplierCreate, current_user: dict = Depends(get_current_user)):
    """Create a new supplier"""
    supplier_id = str(uuid.uuid4())
    branch_id = supplier.branch_id if current_user.get("is_admin") else current_user.get("branch_id")
    
    supplier_doc = {
        "id": supplier_id,
        **supplier.model_dump(),
        "branch_id": branch_id,
        "total_purchases": 0,
        "total_paid": 0,
        "balance": 0,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.suppliers.insert_one(supplier_doc)
    return {k: v for k, v in supplier_doc.items() if k != "_id"}

@api_router.put("/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, supplier: SupplierCreate, current_user: dict = Depends(get_current_user)):
    """Update a supplier"""
    result = await db.suppliers.find_one_and_update(
        {"id": supplier_id},
        {"$set": supplier.model_dump()},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return {k: v for k, v in result.items() if k != "_id"}

@api_router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a supplier (only if no transactions)"""
    # Check if supplier has purchase invoices
    invoice = await db.purchase_invoices.find_one({"supplier_id": supplier_id})
    if invoice:
        raise HTTPException(status_code=400, detail="لا يمكن حذف مورد له فواتير مشتريات")
    
    result = await db.suppliers.delete_one({"id": supplier_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return {"message": "تم حذف المورد"}

@api_router.get("/suppliers/{supplier_id}/statement")
async def get_supplier_statement(
    supplier_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get supplier account statement"""
    supplier = await db.suppliers.find_one({"id": supplier_id}, {"_id": 0})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    
    query = {"supplier_id": supplier_id}
    if start_date:
        query["invoice_date"] = {"$gte": start_date}
    if end_date:
        if "invoice_date" in query:
            query["invoice_date"]["$lte"] = end_date
        else:
            query["invoice_date"] = {"$lte": end_date}
    
    invoices = await db.purchase_invoices.find(query, {"_id": 0}).sort("invoice_date", 1).to_list(1000)
    payments = await db.supplier_payments.find({"supplier_id": supplier_id}, {"_id": 0}).sort("payment_date", 1).to_list(1000)
    
    # Build statement
    statement = []
    balance = 0
    
    for inv in invoices:
        balance += inv["total"]
        statement.append({
            "date": inv["invoice_date"],
            "type": "invoice",
            "reference": inv["invoice_number"],
            "description": f"فاتورة مشتريات رقم {inv['invoice_number']}",
            "debit": 0,
            "credit": inv["total"],
            "balance": balance
        })
    
    for pmt in payments:
        balance -= pmt["amount"]
        statement.append({
            "date": pmt["payment_date"],
            "type": "payment",
            "reference": pmt.get("reference", ""),
            "description": f"سداد - {pmt.get('payment_method', '')}",
            "debit": pmt["amount"],
            "credit": 0,
            "balance": balance
        })
    
    # Sort by date
    statement.sort(key=lambda x: x["date"])
    
    return {
        "supplier": supplier,
        "statement": statement,
        "opening_balance": 0,
        "total_invoices": sum(inv["total"] for inv in invoices),
        "total_payments": sum(pmt["amount"] for pmt in payments),
        "closing_balance": balance
    }

# ============ PURCHASE INVOICES ROUTES ============

@api_router.get("/purchase-invoices")
async def get_purchase_invoices(
    supplier_id: Optional[str] = None,
    status: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all purchase invoices"""
    query = {}
    is_admin = current_user.get("is_admin", False)
    
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
    if supplier_id:
        query["supplier_id"] = supplier_id
    if status:
        query["status"] = status
    if start_date:
        query["invoice_date"] = {"$gte": start_date}
    if end_date:
        if "invoice_date" in query:
            query["invoice_date"]["$lte"] = end_date
        else:
            query["invoice_date"] = {"$lte": end_date}
    
    invoices = await db.purchase_invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return invoices

@api_router.get("/purchase-invoices/{invoice_id}")
async def get_purchase_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single purchase invoice"""
    invoice = await db.purchase_invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice

@api_router.post("/purchase-invoices")
async def create_purchase_invoice(invoice: PurchaseInvoiceCreate, current_user: dict = Depends(get_current_user)):
    """Create a new purchase invoice and auto-generate journal entry"""
    # Get supplier
    supplier = await db.suppliers.find_one({"id": invoice.supplier_id}, {"_id": 0})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    
    # Calculate totals
    subtotal = 0
    tax_amount = 0
    items_with_totals = []
    
    for item in invoice.items:
        item_subtotal = item.quantity * item.unit_price
        item_tax = round(item_subtotal * (item.tax_rate / 100), 2)
        item_total = item_subtotal + item_tax
        
        items_with_totals.append({
            **item.model_dump(),
            "total": item_total
        })
        
        subtotal += item_subtotal
        tax_amount += item_tax
    
    total = round(subtotal + tax_amount, 2)
    
    # Generate invoice number - max-based to avoid conflicts with old data
    all_purs = await db.purchase_invoices.find(
        {"invoice_number": {"$exists": True}},
        {"invoice_number": 1, "_id": 0}
    ).to_list(100000)
    max_pur = 0
    for pur in all_purs:
        pur_num = pur.get("invoice_number", "")
        try:
            num = int(pur_num.replace("PUR-", "")) if pur_num.startswith("PUR-") else int(pur_num)
            if num > max_pur:
                max_pur = num
        except (ValueError, AttributeError):
            continue
    next_pur = max_pur + 1
    if next_pur < 10001:
        next_pur = 10001
    invoice_number = f"PUR-{next_pur:05d}"
    
    # Get user info
    user_doc = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    created_by = user_doc.get("name", current_user.get("username", "")) if user_doc else ""
    
    branch_id = invoice.branch_id if current_user.get("is_admin") else current_user.get("branch_id")
    
    invoice_id = str(uuid.uuid4())
    
    invoice_doc = {
        "id": invoice_id,
        "invoice_number": invoice_number,
        "supplier_id": invoice.supplier_id,
        "supplier_name": supplier["name_ar"],
        "supplier_invoice_number": invoice.supplier_invoice_number,
        "invoice_date": invoice.invoice_date,
        "due_date": invoice.due_date,
        "items": items_with_totals,
        "subtotal": round(subtotal, 2),
        "tax_amount": round(tax_amount, 2),
        "total": total,
        "paid_amount": 0,
        "remaining_amount": total,
        "status": "pending",
        "payment_method": invoice.payment_method,
        "notes": invoice.notes,
        "branch_id": branch_id,
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Create journal entry
    # Get accounts
    purchases_account = await db.accounts.find_one({"code": "5200"}, {"_id": 0})
    input_vat_account = await db.accounts.find_one({"code": "1150"}, {"_id": 0})
    supplier_account = await db.accounts.find_one({"code": "2110"}, {"_id": 0})
    
    if purchases_account and supplier_account:
        journal_entry_id = str(uuid.uuid4())
        last_je = await db.journal_entries.find_one(
            {"entry_number": {"$exists": True}}, sort=[("created_at", -1)]
        )
        if last_je and last_je.get("entry_number"):
            try:
                je_last = int(last_je["entry_number"].replace("JE-", ""))
                je_next = je_last + 1
            except:
                je_next = 10001
        else:
            je_next = 10001
        if je_next < 10001:
            je_next = 10001
        entry_number = f"JE-{je_next:05d}"
        
        lines = [
            {
                "account_id": purchases_account["id"],
                "account_code": purchases_account["code"],
                "account_name": purchases_account["name_ar"],
                "debit": round(subtotal, 2),
                "credit": 0,
                "description": f"مشتريات - فاتورة رقم {invoice_number}",
                "party_type": "supplier",
                "party_id": invoice.supplier_id,
                "party_name": supplier["name_ar"]
            }
        ]
        
        # Add VAT line if exists
        if input_vat_account and tax_amount > 0:
            lines.append({
                "account_id": input_vat_account["id"],
                "account_code": input_vat_account["code"],
                "account_name": input_vat_account["name_ar"],
                "debit": round(tax_amount, 2),
                "credit": 0,
                "description": f"ضريبة مدخلات - فاتورة {invoice_number}",
                "party_type": "",
                "party_id": "",
                "party_name": ""
            })
        
        # Supplier credit line
        lines.append({
            "account_id": supplier_account["id"],
            "account_code": supplier_account["code"],
            "account_name": supplier_account["name_ar"],
            "debit": 0,
            "credit": total,
            "description": f"مستحق للمورد {supplier['name_ar']}",
            "party_type": "supplier",
            "party_id": invoice.supplier_id,
            "party_name": supplier["name_ar"]
        })
        
        journal_entry = {
            "id": journal_entry_id,
            "entry_number": entry_number,
            "entry_date": invoice.invoice_date,
            "journal_type": "purchases",
            "reference_type": "purchase_invoice",
            "reference_id": invoice_id,
            "reference_number": invoice_number,
            "lines": lines,
            "total_debit": total,
            "total_credit": total,
            "is_balanced": True,
            "notes": f"قيد تلقائي - فاتورة مشتريات {invoice_number}",
            "branch_id": branch_id,
            "created_by": created_by,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "posted"
        }
        
        await db.journal_entries.insert_one(journal_entry)
        invoice_doc["journal_entry_id"] = journal_entry_id
    
    await db.purchase_invoices.insert_one(invoice_doc)
    
    # Update supplier balance
    await db.suppliers.update_one(
        {"id": invoice.supplier_id},
        {"$inc": {"total_purchases": total, "balance": total}}
    )
    
    # Update inventory if product_id exists
    for item in items_with_totals:
        if item.get("product_id"):
            await db.products.update_one(
                {"id": item["product_id"]},
                {"$inc": {"quantity": item["quantity"]}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
            )
    
    return {k: v for k, v in invoice_doc.items() if k != "_id"}

@api_router.put("/purchase-invoices/{invoice_id}")
async def update_purchase_invoice(invoice_id: str, invoice: PurchaseInvoiceCreate, current_user: dict = Depends(get_current_user)):
    """Update a purchase invoice"""
    existing = await db.purchase_invoices.find_one({"id": invoice_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if existing.get("status") == "paid":
        raise HTTPException(status_code=400, detail="لا يمكن تعديل فاتورة مدفوعة")
    
    # Recalculate totals
    subtotal = 0
    tax_amount = 0
    items_with_totals = []
    
    for item in invoice.items:
        item_subtotal = item.quantity * item.unit_price
        item_tax = round(item_subtotal * (item.tax_rate / 100), 2)
        item_total = item_subtotal + item_tax
        
        items_with_totals.append({
            **item.model_dump(),
            "total": item_total
        })
        
        subtotal += item_subtotal
        tax_amount += item_tax
    
    total = round(subtotal + tax_amount, 2)
    
    # Update supplier balance (subtract old, add new)
    old_total = existing.get("total", 0)
    diff = total - old_total
    await db.suppliers.update_one(
        {"id": invoice.supplier_id},
        {"$inc": {"total_purchases": diff, "balance": diff}}
    )
    
    update_data = {
        "supplier_id": invoice.supplier_id,
        "supplier_invoice_number": invoice.supplier_invoice_number,
        "invoice_date": invoice.invoice_date,
        "due_date": invoice.due_date,
        "items": items_with_totals,
        "subtotal": round(subtotal, 2),
        "tax_amount": round(tax_amount, 2),
        "total": total,
        "remaining_amount": total - existing.get("paid_amount", 0),
        "payment_method": invoice.payment_method,
        "notes": invoice.notes,
        "branch_id": invoice.branch_id if current_user.get("is_admin") else existing.get("branch_id"),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = await db.purchase_invoices.find_one_and_update(
        {"id": invoice_id},
        {"$set": update_data},
        return_document=True
    )
    return {k: v for k, v in result.items() if k != "_id"}

@api_router.delete("/purchase-invoices/{invoice_id}")
async def delete_purchase_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a purchase invoice (only if pending)"""
    existing = await db.purchase_invoices.find_one({"id": invoice_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if existing.get("status") != "pending":
        raise HTTPException(status_code=400, detail="لا يمكن حذف فاتورة غير معلقة")
    
    # Update supplier balance
    await db.suppliers.update_one(
        {"id": existing["supplier_id"]},
        {"$inc": {"total_purchases": -existing["total"], "balance": -existing["total"]}}
    )
    
    # Delete journal entry
    if existing.get("journal_entry_id"):
        await db.journal_entries.delete_one({"id": existing["journal_entry_id"]})
    
    await db.purchase_invoices.delete_one({"id": invoice_id})
    return {"message": "تم حذف فاتورة المشتريات"}

# Supplier Payment Model
class SupplierPaymentCreate(BaseModel):
    supplier_id: str
    purchase_invoice_id: Optional[str] = None  # Optional - can be general payment
    amount: float
    payment_date: str
    payment_method: str = "cash"  # cash, bank_transfer, check
    reference: Optional[str] = ""
    notes: Optional[str] = ""

@api_router.post("/supplier-payments")
async def create_supplier_payment(payment: SupplierPaymentCreate, current_user: dict = Depends(get_current_user)):
    """Record a payment to a supplier"""
    supplier = await db.suppliers.find_one({"id": payment.supplier_id}, {"_id": 0})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    
    payment_id = str(uuid.uuid4())
    
    # Get user info
    user_doc = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    created_by = user_doc.get("name", current_user.get("username", "")) if user_doc else ""
    
    payment_doc = {
        "id": payment_id,
        "supplier_id": payment.supplier_id,
        "purchase_invoice_id": payment.purchase_invoice_id,
        "amount": payment.amount,
        "payment_date": payment.payment_date,
        "payment_method": payment.payment_method,
        "reference": payment.reference,
        "notes": payment.notes,
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.supplier_payments.insert_one(payment_doc)
    
    # Update supplier balance
    await db.suppliers.update_one(
        {"id": payment.supplier_id},
        {"$inc": {"total_paid": payment.amount, "balance": -payment.amount}}
    )
    
    # Update purchase invoice if specified
    if payment.purchase_invoice_id:
        invoice = await db.purchase_invoices.find_one({"id": payment.purchase_invoice_id})
        if invoice:
            new_paid = invoice.get("paid_amount", 0) + payment.amount
            new_remaining = invoice["total"] - new_paid
            new_status = "paid" if new_remaining <= 0 else "partial"
            
            await db.purchase_invoices.update_one(
                {"id": payment.purchase_invoice_id},
                {"$set": {
                    "paid_amount": new_paid,
                    "remaining_amount": max(0, new_remaining),
                    "status": new_status
                }}
            )
    
    # Create journal entry for payment
    cash_account = await db.accounts.find_one({"code": "1110" if payment.payment_method == "cash" else "1120"}, {"_id": 0})
    supplier_account = await db.accounts.find_one({"code": "2110"}, {"_id": 0})
    
    if cash_account and supplier_account:
        je_id = str(uuid.uuid4())
        last_je2 = await db.journal_entries.find_one(
            {"entry_number": {"$exists": True}}, sort=[("created_at", -1)]
        )
        if last_je2 and last_je2.get("entry_number"):
            try:
                je2_last = int(last_je2["entry_number"].replace("JE-", ""))
                je2_next = je2_last + 1
            except:
                je2_next = 10001
        else:
            je2_next = 10001
        if je2_next < 10001:
            je2_next = 10001
        entry_number = f"JE-{je2_next:05d}"
        
        journal_entry = {
            "id": je_id,
            "entry_number": entry_number,
            "entry_date": payment.payment_date,
            "journal_type": "payment",
            "reference_type": "supplier_payment",
            "reference_id": payment_id,
            "reference_number": payment.reference or "",
            "lines": [
                {
                    "account_id": supplier_account["id"],
                    "account_code": supplier_account["code"],
                    "account_name": supplier_account["name_ar"],
                    "debit": payment.amount,
                    "credit": 0,
                    "description": f"سداد للمورد {supplier['name_ar']}",
                    "party_type": "supplier",
                    "party_id": payment.supplier_id,
                    "party_name": supplier["name_ar"]
                },
                {
                    "account_id": cash_account["id"],
                    "account_code": cash_account["code"],
                    "account_name": cash_account["name_ar"],
                    "debit": 0,
                    "credit": payment.amount,
                    "description": f"سداد مورد - {payment.payment_method}",
                    "party_type": "",
                    "party_id": "",
                    "party_name": ""
                }
            ],
            "total_debit": payment.amount,
            "total_credit": payment.amount,
            "is_balanced": True,
            "notes": f"سداد للمورد {supplier['name_ar']}",
            "branch_id": current_user.get("branch_id"),
            "created_by": created_by,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "posted"
        }
        
        await db.journal_entries.insert_one(journal_entry)
    
    return {k: v for k, v in payment_doc.items() if k != "_id"}

@api_router.get("/supplier-payments")
async def get_supplier_payments(
    supplier_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all supplier payments"""
    query = {}
    if supplier_id:
        query["supplier_id"] = supplier_id
    if start_date:
        query["payment_date"] = {"$gte": start_date}
    if end_date:
        if "payment_date" in query:
            query["payment_date"]["$lte"] = end_date
        else:
            query["payment_date"] = {"$lte": end_date}
    
    payments = await db.supplier_payments.find(query, {"_id": 0}).sort("payment_date", -1).to_list(1000)
    return payments

# ============ ACTIVITY SCHEDULE/TIMETABLE SYSTEM ============

@api_router.get("/schedules")
async def get_activity_schedules(
    branch_id: str = None,
    activity_id: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Get activity schedules from invoices - extracts schedule info from invoice items"""
    
    # Build query for invoices
    invoice_query = {"status": {"$in": ["paid", "partial"]}}
    if branch_id:
        invoice_query["branch_id"] = branch_id
    elif current_user.get("role") != "admin" and current_user.get("branch_id"):
        invoice_query["branch_id"] = current_user["branch_id"]
    
    # Get recent invoices with schedule data
    invoices = await db.invoices.find(invoice_query, {"_id": 0}).sort("created_at", -1).to_list(500)
    
    # Extract unique schedules by activity
    schedules_map = {}
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("schedule") and item.get("activity_id"):
                act_id = item["activity_id"]
                if activity_id and act_id != activity_id:
                    continue
                
                key = f"{act_id}_{item.get('schedule', '')}"
                if key not in schedules_map:
                    schedules_map[key] = {
                        "activity_id": act_id,
                        "activity_name": item.get("activity_name", ""),
                        "schedule": item.get("schedule", ""),
                        "member_count": 0,
                        "members": []
                    }
                
                # Add member info
                member_info = {
                    "member_id": inv.get("member_id"),
                    "member_name": inv.get("member_name", ""),
                    "invoice_number": inv.get("invoice_number")
                }
                if member_info not in schedules_map[key]["members"]:
                    schedules_map[key]["members"].append(member_info)
                    schedules_map[key]["member_count"] += 1
    
    return list(schedules_map.values())

@api_router.get("/schedules/weekly")
async def get_weekly_schedule(
    branch_id: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Get weekly schedule organized by day"""
    
    # Arabic day names mapping
    day_keywords = {
        "الأحد": "sunday", "الاحد": "sunday", "أحد": "sunday", "احد": "sunday",
        "الإثنين": "monday", "الاثنين": "monday", "إثنين": "monday", "اثنين": "monday",
        "الثلاثاء": "tuesday", "ثلاثاء": "tuesday",
        "الأربعاء": "wednesday", "الاربعاء": "wednesday", "أربعاء": "wednesday", "اربعاء": "wednesday",
        "الخميس": "thursday", "خميس": "thursday",
        "الجمعة": "friday", "جمعة": "friday",
        "السبت": "saturday", "سبت": "saturday"
    }
    
    # Build query
    invoice_query = {"status": {"$in": ["paid", "partial"]}}
    if branch_id:
        invoice_query["branch_id"] = branch_id
    elif current_user.get("role") != "admin" and current_user.get("branch_id"):
        invoice_query["branch_id"] = current_user["branch_id"]
    
    invoices = await db.invoices.find(invoice_query, {"_id": 0}).sort("created_at", -1).to_list(500)
    
    # Initialize weekly schedule
    weekly = {
        "sunday": [],
        "monday": [],
        "tuesday": [],
        "wednesday": [],
        "thursday": [],
        "friday": [],
        "saturday": []
    }
    
    # Track unique entries to avoid duplicates
    seen_entries = set()
    
    for inv in invoices:
        for item in inv.get("items", []):
            schedule_text = item.get("schedule", "")
            if not schedule_text:
                continue
            
            activity_name = item.get("activity_name", "")
            activity_id = item.get("activity_id", "")
            
            # Extract time from schedule (look for patterns like "الساعة 4" or "4:00")
            import re
            time_match = re.search(r'الساع[ةه]\s*(\d+(?::\d+)?)', schedule_text)
            time_str = time_match.group(1) if time_match else ""
            if time_str and ":" not in time_str:
                time_str = f"{time_str}:00"
            
            # Find which days this schedule applies to
            for ar_day, en_day in day_keywords.items():
                if ar_day in schedule_text:
                    entry_key = f"{activity_id}_{en_day}_{time_str}"
                    if entry_key not in seen_entries:
                        seen_entries.add(entry_key)
                        weekly[en_day].append({
                            "activity_id": activity_id,
                            "activity_name": activity_name,
                            "time": time_str,
                            "schedule_text": schedule_text
                        })
    
    # Sort each day by time
    for day in weekly:
        weekly[day] = sorted(weekly[day], key=lambda x: x.get("time", ""))
    
    return weekly

@api_router.get("/schedules/activities-with-members")
async def get_activities_schedule_with_members(
    branch_id: str = None,
    day: str = None,
    date: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Get activities organized by activity -> time -> members for the schedule view.
    When date is provided, only returns members whose:
    1. Subscription is active on that date (start_date <= date <= end_date)
    2. Schedule includes the day of week matching the given date
    """
    
    import re
    
    day_keywords = {
        "الأحد": "sunday", "الاحد": "sunday", "أحد": "sunday", "احد": "sunday",
        "الإثنين": "monday", "الاثنين": "monday", "إثنين": "monday", "اثنين": "monday",
        "الثلاثاء": "tuesday", "ثلاثاء": "tuesday",
        "الأربعاء": "wednesday", "الاربعاء": "wednesday", "أربعاء": "wednesday", "اربعاء": "wednesday",
        "الخميس": "thursday", "خميس": "thursday",
        "الجمعة": "friday", "جمعة": "friday",
        "السبت": "saturday", "سبت": "saturday"
    }
    
    reverse_day_keywords = {}
    for ar_day, en_day in day_keywords.items():
        if en_day not in reverse_day_keywords:
            reverse_day_keywords[en_day] = []
        reverse_day_keywords[en_day].append(ar_day)
    
    target_date = date or datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    target_day_index = datetime.strptime(target_date, '%Y-%m-%d').weekday()
    day_keys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    target_day_en = day_keys[target_day_index]
    target_day_ar_variants = reverse_day_keywords.get(target_day_en, [])
    
    invoice_query = {"status": {"$in": ["paid", "partial"]}}
    if branch_id:
        invoice_query["branch_id"] = branch_id
    elif current_user.get("role") != "admin" and current_user.get("branch_id"):
        invoice_query["branch_id"] = current_user["branch_id"]
    
    invoices = await db.invoices.find(invoice_query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    activities_data = {}
    
    for inv in invoices:
        member_id = inv.get("member_id", "")
        member_name = inv.get("member_name", "")
        member_phone = inv.get("member_phone", "")
        
        for item in inv.get("items", []):
            schedule_text = item.get("schedule", "")
            if not schedule_text:
                continue
            
            activity_id = item.get("activity_id", "")
            activity_name = item.get("activity_name", "")
            
            if not activity_id:
                continue
            
            end_date = item.get("end_date", "")
            start_date = item.get("start_date", "")
            
            if not end_date or end_date < target_date:
                continue
            
            if start_date and start_date > target_date:
                continue
            
            schedule_matches_day = False
            for ar_variant in target_day_ar_variants:
                if ar_variant in schedule_text:
                    schedule_matches_day = True
                    break
            
            if not schedule_matches_day:
                has_any_day = False
                for ar_day_name in day_keywords.keys():
                    if ar_day_name in schedule_text:
                        has_any_day = True
                        break
                if has_any_day:
                    continue
            
            if activity_id not in activities_data:
                activities_data[activity_id] = {
                    "activity_id": activity_id,
                    "activity_name": activity_name,
                    "times": {}
                }
            
            time_match = re.search(r'الساع[ةه]\s*(\d+(?::\d+)?)', schedule_text)
            time_str = time_match.group(1) if time_match else "غير محدد"
            if time_str != "غير محدد" and ":" not in time_str:
                time_str = f"{time_str}:00"
            
            if time_str not in activities_data[activity_id]["times"]:
                activities_data[activity_id]["times"][time_str] = {
                    "sunday": [], "monday": [], "tuesday": [], "wednesday": [],
                    "thursday": [], "friday": [], "saturday": []
                }
            
            existing_members = [m["member_id"] for m in activities_data[activity_id]["times"][time_str][target_day_en]]
            if member_id not in existing_members:
                activities_data[activity_id]["times"][time_str][target_day_en].append({
                    "member_id": member_id,
                    "member_name": member_name,
                    "phone": member_phone
                })
    
    result = list(activities_data.values())
    result.sort(key=lambda x: x["activity_name"])
    
    return result

@api_router.get("/schedules/by-activity/{activity_id}")
async def get_schedule_by_activity(
    activity_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get all schedule entries for a specific activity"""
    
    invoice_query = {
        "status": {"$in": ["paid", "partial"]},
        "items.activity_id": activity_id
    }
    
    invoices = await db.invoices.find(invoice_query, {"_id": 0}).to_list(500)
    
    schedules = []
    seen = set()
    
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("activity_id") == activity_id and item.get("schedule"):
                schedule_text = item["schedule"]
                if schedule_text not in seen:
                    seen.add(schedule_text)
                    schedules.append({
                        "schedule": schedule_text,
                        "activity_name": item.get("activity_name", "")
                    })
    
    # Get activity details
    activity = await db.activities.find_one({"id": activity_id}, {"_id": 0})
    
    return {
        "activity": activity,
        "schedules": schedules
    }

# ============ ACTIVITY NOTES SYSTEM ============

class ActivityNoteCreate(BaseModel):
    activity_id: str
    activity_name: str = ""
    note_text: str

class ActivityNote(BaseModel):
    id: str = ""
    activity_id: str
    activity_name: str = ""
    note_text: str
    date: str = ""  # YYYY-MM-DD
    created_by: str = ""
    created_by_name: str = ""
    created_at: str = ""

@api_router.post("/activity-notes")
async def create_activity_note(
    note_data: ActivityNoteCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a new note for an activity"""
    
    # Get user info
    user_doc = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    user_name = user_doc.get("name", current_user.get("username", "")) if user_doc else ""
    
    note_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    note_doc = {
        "id": note_id,
        "activity_id": note_data.activity_id,
        "activity_name": note_data.activity_name,
        "note_text": note_data.note_text,
        "date": today,
        "created_by": current_user["user_id"],
        "created_by_name": user_name,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.activity_notes.insert_one(note_doc)
    
    # Create notification for new note. The note text itself is admin-typed
    # free-form content (not auto-translatable), but the wrapping title is
    # generated by the system, so persist both Arabic and English variants of
    # the title and mirror the message under the bilingual keys so the admin
    # bell renders in the viewer's chosen language.
    note_preview = note_data.note_text[:100] + "..." if len(note_data.note_text) > 100 else note_data.note_text
    title_ar = f"ملاحظة جديدة - {note_data.activity_name}"
    title_en = f"New note - {note_data.activity_name}"
    notification_doc = {
        "id": str(uuid.uuid4()),
        "type": "activity_note",
        "title": title_ar,
        "message": note_preview,
        "title_ar": title_ar,
        "message_ar": note_preview,
        "title_en": title_en,
        "message_en": note_preview,
        "activity_id": note_data.activity_id,
        "activity_name": note_data.activity_name,
        "note_id": note_id,
        "created_by": current_user["user_id"],
        "created_by_name": user_name,
        "is_read": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.notifications.insert_one(notification_doc)
    
    return {k: v for k, v in note_doc.items() if k != "_id"}

@api_router.get("/activity-notes/counts/all")
async def get_all_activity_notes_counts(
    current_user: dict = Depends(get_current_user)
):
    """Get notes count for all activities"""
    
    # Aggregate to get count per activity_id
    pipeline = [
        {
            "$group": {
                "_id": "$activity_id",
                "count": {"$sum": 1},
                "latest_date": {"$max": "$created_at"}
            }
        }
    ]
    
    results = await db.activity_notes.aggregate(pipeline).to_list(1000)
    
    # Convert to dict for easy lookup
    counts = {}
    for item in results:
        counts[item["_id"]] = {
            "count": item["count"],
            "latest_date": item["latest_date"]
        }
    
    return counts

@api_router.get("/activity-notes/recent")
async def get_recent_notes(
    limit: int = 10,
    current_user: dict = Depends(get_current_user)
):
    """Get most recent notes across all activities"""
    
    notes = await db.activity_notes.find(
        {},
        {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    
    return notes

@api_router.get("/activity-notes/{activity_id}")
async def get_activity_notes(
    activity_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get all notes for a specific activity, sorted by date descending"""
    
    notes = await db.activity_notes.find(
        {"activity_id": activity_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return notes

@api_router.delete("/activity-notes/{note_id}")
async def delete_activity_note(
    note_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete an activity note"""
    
    result = await db.activity_notes.delete_one({"id": note_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    
    return {"message": "Note deleted successfully"}

# ============ ATTENDANCE TRACKING SYSTEM ============

class AttendanceRecord(BaseModel):
    id: str = ""
    member_id: str
    member_name: str = ""
    activity_id: str
    activity_name: str = ""
    branch_id: str = ""
    date: str  # YYYY-MM-DD
    status: str = "present"  # present, absent
    check_in_time: str = ""  # HH:MM
    notes: str = ""
    recorded_by: str = ""
    created_at: str = ""

class BulkAttendanceRequest(BaseModel):
    activity_id: str
    date: str
    records: List[dict]  # [{member_id, status, notes}]

@api_router.get("/attendance")
async def get_attendance(
    date: str = None,
    activity_id: str = None,
    member_id: str = None,
    branch_id: str = None,
    start_date: str = None,
    end_date: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Get attendance records with filters"""
    query = {}
    
    # Branch filter
    if branch_id:
        query["branch_id"] = branch_id
    elif current_user.get("role") != "admin" and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
    if date:
        query["date"] = date
    if activity_id:
        query["activity_id"] = activity_id
    if member_id:
        query["member_id"] = member_id
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = end_date
        else:
            query["date"] = {"$lte": end_date}
    
    records = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(5000)
    return records

@api_router.get("/attendance/by-activity/{activity_id}")
async def get_attendance_by_activity(
    activity_id: str,
    date: str,
    current_user: dict = Depends(get_current_user)
):
    """Get attendance for a specific activity on a specific date - filtered by schedule day and closures"""
    # Get activity details
    activity = await db.activities.find_one({"id": activity_id}, {"_id": 0})
    if not activity:
        raise HTTPException(status_code=404, detail="النشاط غير موجود")
    
    # Check if this date falls within a closure period for this activity
    closures = await db.closures.find({
        "start_date": {"$lte": date},
        "end_date": {"$gte": date}
    }, {"_id": 0}).to_list(100)
    
    for closure in closures:
        closure_scope = closure.get("scope", "all")
        closure_activity_ids = closure.get("activity_ids", [])
        closure_activity_id = closure.get("activity_id", "")
        closure_stop_type = closure.get("stop_type", "full_day")
        
        is_activity_affected = (
            closure_scope == "all" or
            activity_id in closure_activity_ids or
            activity_id == closure_activity_id
        )
        
        if is_activity_affected and closure_stop_type == "full_day":
            return {
                "activity": activity,
                "date": date,
                "members": [],
                "total_members": 0,
                "present_count": 0,
                "absent_count": 0,
                "closure": {
                    "title": closure.get("title_ar", "توقف"),
                    "reason": closure.get("reason", ""),
                    "start_date": closure.get("start_date"),
                    "end_date": closure.get("end_date")
                }
            }
    
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    # Determine the day of week for the requested date
    try:
        req_date = datetime.strptime(date, "%Y-%m-%d")
    except Exception:
        req_date = datetime.now(timezone(timedelta(hours=3)))
    
    english_to_arabic_days = {
        "saturday": ["السبت", "سبت"],
        "sunday": ["الأحد", "الاحد", "أحد", "احد"],
        "monday": ["الإثنين", "الاثنين", "إثنين", "اثنين"],
        "tuesday": ["الثلاثاء", "ثلاثاء"],
        "wednesday": ["الأربعاء", "الاربعاء", "أربعاء", "اربعاء"],
        "thursday": ["الخميس", "خميس"],
        "friday": ["الجمعة", "جمعة"]
    }
    req_day_en = req_date.strftime("%A").lower()
    req_day_arabic_variants = english_to_arabic_days.get(req_day_en, [])
    
    members_query = {
        "activities": {
            "$elemMatch": {
                "activity_id": activity_id,
                "status": "active",
                "end_date": {"$gte": today_str}
            }
        }
    }
    if current_user.get("role") != "admin" and current_user.get("branch_id"):
        members_query["branch_id"] = current_user["branch_id"]
    
    members = await db.members.find(members_query, {"_id": 0}).to_list(500)
    
    # Get latest paid invoices for these members to check schedule
    member_ids = [m["id"] for m in members]
    invoices = await db.invoices.find({
        "member_id": {"$in": member_ids},
        "status": {"$in": ["paid", "partial"]},
        "items": {"$elemMatch": {"activity_id": activity_id}}
    }, {"_id": 0, "member_id": 1, "items": 1, "created_at": 1}).sort("created_at", -1).to_list(2000)
    
    # Build schedule map: member_id -> schedule text for this activity
    member_schedule_map = {}
    for inv in invoices:
        mid = inv.get("member_id")
        if mid in member_schedule_map:
            continue
        for item in inv.get("items", []):
            if item.get("activity_id") == activity_id and item.get("schedule"):
                member_schedule_map[mid] = item["schedule"]
                break
    
    def member_has_schedule_on_day(member):
        member_id = member["id"]
        # Check schedule from member activities first
        member_activity = next((a for a in member.get("activities", []) if a["activity_id"] == activity_id), None)
        schedule_text = ""
        if member_activity:
            schedule_text = member_activity.get("schedule", "")
        # Fallback to invoice schedule
        if not schedule_text:
            schedule_text = member_schedule_map.get(member_id, "")
        # If no schedule info at all, include the member (don't filter out)
        if not schedule_text:
            return True
        # Check if any Arabic variant of the requested day is in the schedule
        for day_variant in req_day_arabic_variants:
            if day_variant in schedule_text:
                return True
        return False
    
    # Get existing attendance records for this date
    existing_records = await db.attendance.find({
        "activity_id": activity_id,
        "date": date
    }, {"_id": 0}).to_list(500)
    
    existing_map = {r["member_id"]: r for r in existing_records}
    
    # Build response with member info and attendance status
    result = []
    for member in members:
        member_activity = next((a for a in member.get("activities", []) if a["activity_id"] == activity_id), None)
        if member_activity:
            # Filter by scheduled day
            if not member_has_schedule_on_day(member):
                # Exception: if already has attendance record for this date, still show
                if member["id"] not in existing_map:
                    continue
            
            attendance_record = existing_map.get(member["id"])
            result.append({
                "member_id": member["id"],
                "member_code": member.get("member_code", ""),
                "member_name": member.get("name_ar") or member.get("name", ""),
                "member_photo": member.get("photo", ""),
                "phone": member.get("phone", ""),
                "activity_id": activity_id,
                "activity_name": activity.get("name_ar") or activity.get("name", ""),
                "subscription_status": member_activity.get("status", "active"),
                "status": attendance_record["status"] if attendance_record else None,
                "check_in_time": attendance_record.get("check_in_time", "") if attendance_record else "",
                "notes": attendance_record.get("notes", "") if attendance_record else "",
                "recorded": attendance_record is not None
            })
    
    return {
        "activity": activity,
        "date": date,
        "members": result,
        "total_members": len(result),
        "present_count": sum(1 for r in result if r["status"] == "present"),
        "absent_count": sum(1 for r in result if r["status"] == "absent")
    }

@api_router.get("/attendance/quick-search/{search_term}")
async def quick_search_member(
    search_term: str,
    current_user: dict = Depends(get_current_user)
):
    """Search member by member_code or name for quick attendance"""
    import re as _rk1
    from utils.text import normalize_digits, dearabize_keyboard
    search_term = normalize_digits(search_term).strip()
    # First try to find by member_code
    member = await db.members.find_one({"member_code": search_term}, {"_id": 0})

    if not member:
        # Recover a code mangled by an Arabic keyboard layout (hardware scanner)
        # BEFORE the fuzzy name search, so a mangled code never matches a name.
        alt = dearabize_keyboard(search_term)
        if alt and alt != search_term:
            member = await db.members.find_one(
                {"member_code": {"$regex": f"^{_rk1.escape(alt)}$", "$options": "i"}},
                {"_id": 0}
            )

    # If still not found, search by name
    if not member:
        # Search in name_ar or name (case insensitive for English)
        name_rx = _rk1.escape(search_term)
        member = await db.members.find_one({
            "$or": [
                {"name_ar": {"$regex": name_rx, "$options": "i"}},
                {"name": {"$regex": name_rx, "$options": "i"}}
            ]
        }, {"_id": 0})

    if not member:
        raise HTTPException(status_code=404, detail="لم يتم العثور على العضو")
    
    # Get today's date
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    # Check if already recorded today
    today_records = await db.attendance.find(
        {"member_id": member["id"], "date": today},
        {"_id": 0}
    ).to_list(10)
    
    # Get product IDs to filter them out from attendance activities
    product_ids = set()
    products_cursor = db.products.find({}, {"_id": 0, "id": 1})
    async for p in products_cursor:
        if p.get("id"):
            product_ids.add(p["id"])
    
    # Get activities from invoices
    activities_from_invoices = []
    invoices = await db.invoices.find({
        "member_id": member["id"],
        "status": {"$in": ["paid", "partial"]}
    }, {"_id": 0}).to_list(100)
    
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("activity_id") and item.get("activity_id") not in product_ids:
                end_date = item.get("end_date", "")
                is_active = end_date >= today if end_date else False
                activities_from_invoices.append({
                    "activity_id": item.get("activity_id"),
                    "activity_name": item.get("activity_name"),
                    "start_date": item.get("start_date", ""),
                    "end_date": end_date,
                    "status": "active" if is_active else "expired",
                    "source": "invoice"
                })
    
    # Get activities from registration forms
    activities_from_reg_forms = []
    reg_forms = await db.registration_forms.find({
        "$or": [
            {"customer_phone": member.get("phone", "")},
            {"customer_name": member.get("name_ar", "")}
        ],
        "status": {"$in": ["pending", "converted"]}
    }, {"_id": 0}).to_list(100)
    
    for form in reg_forms:
        for item in form.get("items", []):
            act_id = item.get("activity_id", "")
            if (act_id or item.get("activity_name")) and act_id not in product_ids:
                end_date = item.get("end_date", "")
                is_active = end_date >= today if end_date else False
                activities_from_reg_forms.append({
                    "activity_id": act_id,
                    "activity_name": item.get("activity_name"),
                    "start_date": item.get("start_date", ""),
                    "end_date": end_date,
                    "status": "active" if is_active else "expired",
                    "source": "registration_form"
                })
    
    # Combine activities (remove duplicates by activity_id)
    all_activities = activities_from_invoices + activities_from_reg_forms
    seen_activities = set()
    unique_activities = []
    for act in all_activities:
        key = act.get("activity_id") or act.get("activity_name")
        if key and key not in seen_activities:
            seen_activities.add(key)
            unique_activities.append(act)
    
    return {
        "member_id": member["id"],
        "member_code": member.get("member_code", ""),
        "name": member.get("name", ""),
        "name_ar": member.get("name_ar", ""),
        "phone": member.get("phone", ""),
        "photo": member.get("photo", ""),
        "activities": unique_activities,
        "today_attendance": today_records
    }

@api_router.get("/attendance/quick-search-multi/{search_term}")
async def quick_search_members_multi(
    search_term: str,
    current_user: dict = Depends(get_current_user)
):
    """Search multiple members by member_code or name for quick attendance"""
    import re as _rk2
    from utils.text import normalize_digits, dearabize_keyboard
    search_term = normalize_digits(search_term).strip()
    # Search by member_code or name (escape user input so mangled codes
    # containing regex metacharacters like [ ] don't break the query).
    term_rx = _rk2.escape(search_term)
    members = await db.members.find({
        "$or": [
            {"member_code": {"$regex": term_rx, "$options": "i"}},
            {"name_ar": {"$regex": term_rx, "$options": "i"}},
            {"name": {"$regex": term_rx, "$options": "i"}}
        ]
    }, {"_id": 0}).limit(10).to_list(10)

    if not members:
        # Recover a code mangled by an Arabic keyboard layout (hardware scanner).
        alt = dearabize_keyboard(search_term)
        if alt and alt != search_term:
            members = await db.members.find(
                {"member_code": {"$regex": f"^{_rk2.escape(alt)}$", "$options": "i"}},
                {"_id": 0}
            ).limit(10).to_list(10)

    if not members:
        return []
    
    # Get today's date
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    product_ids = set()
    products_cursor = db.products.find({}, {"_id": 0, "id": 1})
    async for p in products_cursor:
        if p.get("id"):
            product_ids.add(p["id"])
    
    results = []
    for member in members:
        # Check if already recorded today
        today_records = await db.attendance.find(
            {"member_id": member["id"], "date": today},
            {"_id": 0}
        ).to_list(10)
        
        member_activities = [
            a for a in member.get("activities", [])
            if a.get("activity_id") not in product_ids
        ]
        
        results.append({
            "member_id": member["id"],
            "member_code": member.get("member_code", ""),
            "name": member.get("name", ""),
            "name_ar": member.get("name_ar", ""),
            "phone": member.get("phone", ""),
            "photo": member.get("photo", ""),
            "activities": member_activities,
            "today_attendance": today_records
        })
    
    return results

@api_router.post("/attendance/quick")
async def quick_attendance(
    member_code: str,
    activity_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Quick attendance registration by member code"""
    from utils.text import normalize_digits
    member_code = normalize_digits(member_code).strip()
    member = await db.members.find_one({"member_code": member_code}, {"_id": 0})
    if not member:
        # Recover a code mangled by an Arabic keyboard layout (hardware scanner).
        from utils.text import dearabize_keyboard
        alt = dearabize_keyboard(member_code)
        if alt and alt != member_code:
            import re as _rk3
            member = await db.members.find_one(
                {"member_code": {"$regex": f"^{_rk3.escape(alt)}$", "$options": "i"}},
                {"_id": 0}
            )
    if not member:
        raise HTTPException(status_code=404, detail="رقم العضوية غير موجود")
    
    activity = await db.activities.find_one({"id": activity_id}, {"_id": 0})
    if not activity:
        raise HTTPException(status_code=404, detail="النشاط غير موجود")
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now_time = datetime.now(timezone.utc).strftime("%H:%M")
    
    has_active_subscription = False
    subscription_end_date = None
    
    # FIRST: Check member's direct activities (added from Members page)
    member_activities = member.get("activities", [])
    for act in member_activities:
        # Match by activity_id or activity_name
        activity_name_lower = (activity.get("name_ar", "") or activity.get("name", "")).lower()
        member_activity_name_lower = (act.get("activity_name", "")).lower()
        
        if act.get("activity_id") == activity_id or \
           member_activity_name_lower in activity_name_lower or \
           activity_name_lower in member_activity_name_lower or \
           any(word in activity_name_lower for word in member_activity_name_lower.split() if len(word) > 2):
            # Check if subscription is active
            end_date = act.get("end_date", "")
            if end_date:
                if end_date >= today:
                    has_active_subscription = True
                    subscription_end_date = end_date
                    break
                else:
                    # Keep track of expired subscription
                    if not subscription_end_date or end_date > subscription_end_date:
                        subscription_end_date = end_date
            else:
                # No end date means active subscription
                has_active_subscription = True
                break
    
    # SECOND: Check if member has active subscription for this activity from INVOICES
    if not has_active_subscription:
        invoices = await db.invoices.find({
            "member_id": member["id"],
            "status": {"$in": ["paid", "partial"]}
        }, {"_id": 0}).to_list(100)
        
        for inv in invoices:
            for item in inv.get("items", []):
                if item.get("activity_id") == activity_id:
                    end_date = item.get("end_date", "")
                    if end_date >= today:
                        has_active_subscription = True
                        subscription_end_date = end_date
                        break
                    else:
                        # Keep track of expired subscription
                        subscription_end_date = end_date
            if has_active_subscription:
                break
    
    # If not found in invoices, check REGISTRATION FORMS
    if not has_active_subscription:
        reg_forms = await db.registration_forms.find({
            "$or": [
                {"customer_phone": member.get("phone", "")},
                {"customer_name": member.get("name_ar", "")}
            ],
            "status": {"$in": ["pending", "converted"]}
        }, {"_id": 0}).to_list(100)
        
        for form in reg_forms:
            for item in form.get("items", []):
                if item.get("activity_id") == activity_id or item.get("activity_name", "").lower() in activity.get("name_ar", "").lower() or activity.get("name_ar", "").lower() in item.get("activity_name", "").lower():
                    end_date = item.get("end_date", "")
                    if end_date and end_date >= today:
                        has_active_subscription = True
                        subscription_end_date = end_date
                        break
                    elif end_date:
                        # Keep track of expired subscription
                        if not subscription_end_date or end_date > subscription_end_date:
                            subscription_end_date = end_date
            if has_active_subscription:
                break
    
    # If subscription expired, return error
    if not has_active_subscription:
        if subscription_end_date:
            raise HTTPException(
                status_code=400, 
                detail=f"⚠️ الاشتراك منتهي بتاريخ {subscription_end_date} - يرجى تجديد الاشتراك"
            )
        else:
            raise HTTPException(
                status_code=400, 
                detail="⚠️ العضو غير مسجل في هذا النشاط"
            )
    
    # Check if already recorded today for THIS specific activity
    existing = await db.attendance.find_one({
        "member_id": member["id"],
        "activity_id": activity_id,
        "date": today
    })
    
    if existing:
        return {
            "message": f"تم تسجيل الحضور مسبقاً اليوم في نشاط: {existing.get('activity_name', '')}",
            "already_recorded": True,
            "member_name": member.get("name_ar") or member.get("name", ""),
            "member_photo": member.get("photo", ""),
            "record": {k: v for k, v in existing.items() if k != "_id"}
        }
    
    # Record attendance
    record_id = str(uuid.uuid4())
    record_doc = {
        "id": record_id,
        "member_id": member["id"],
        "member_code": member.get("member_code", ""),
        "member_name": member.get("name_ar") or member.get("name", ""),
        "member_photo": member.get("photo", ""),
        "activity_id": activity_id,
        "activity_name": activity.get("name_ar") or activity.get("name", ""),
        "date": today,
        "status": "present",
        "check_in_time": now_time,
        "notes": "تسجيل سريع",
        "recorded_by": current_user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.attendance.insert_one(record_doc)
    
    return {
        "message": "تم تسجيل الحضور بنجاح ✓",
        "already_recorded": False,
        "member_name": member.get("name_ar") or member.get("name", ""),
        "member_photo": member.get("photo", ""),
        "record": {k: v for k, v in record_doc.items() if k != "_id"}
    }

@api_router.post("/attendance")
async def record_attendance(
    record: AttendanceRecord,
    current_user: dict = Depends(get_current_user)
):
    """Record single attendance - once per day for all activities"""
    # Get member and activity info
    member = await db.members.find_one({"id": record.member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="العضو غير موجود")
    
    activity = await db.activities.find_one({"id": record.activity_id}, {"_id": 0})
    if not activity:
        raise HTTPException(status_code=404, detail="النشاط غير موجود")
    
    # Check if member already has attendance today (any activity)
    existing_today = await db.attendance.find_one({
        "member_id": record.member_id,
        "date": record.date
    })
    
    if existing_today:
        raise HTTPException(
            status_code=400, 
            detail=f"تم تسجيل حضور هذا العضو مسبقاً اليوم في نشاط: {existing_today.get('activity_name', '')}"
        )
    
    now = datetime.now(timezone.utc).isoformat()
    
    # Create new record
    record_doc = {
        "id": str(uuid.uuid4()),
        "member_id": record.member_id,
        "member_name": member["name"],
        "activity_id": record.activity_id,
        "activity_name": activity["name"],
        "branch_id": member.get("branch_id", ""),
        "date": record.date,
        "status": record.status,
        "check_in_time": record.check_in_time or datetime.now().strftime("%H:%M"),
        "notes": record.notes,
        "recorded_by": current_user.get("username", ""),
        "created_at": now
    }
    await db.attendance.insert_one(record_doc)
    del record_doc["_id"]
    
    try:
        attendance_notif = {
            "id": str(uuid.uuid4()),
            "member_id": record.member_id,
            "type": "attendance_recorded",
            "title_ar": "تم تسجيل حضورك",
            "title": "Attendance Recorded",
            "message_ar": f"تم تسجيل حضورك في {activity['name']} بنجاح - {record.date}",
            "message": f"Your attendance for {activity.get('name', '')} has been recorded - {record.date}",
            "link": "/member-attendance",
            "is_read": False,
            "created_at": now
        }
        await db.member_notifications.insert_one(attendance_notif)
    except Exception:
        pass
    
    return record_doc

@api_router.post("/attendance/bulk")
async def record_bulk_attendance(
    request: BulkAttendanceRequest,
    current_user: dict = Depends(get_current_user)
):
    """Record attendance for multiple members at once"""
    activity = await db.activities.find_one({"id": request.activity_id}, {"_id": 0})
    if not activity:
        raise HTTPException(status_code=404, detail="النشاط غير موجود")
    
    now = datetime.now(timezone.utc).isoformat()
    current_time = datetime.now().strftime("%H:%M")
    recorded_count = 0
    
    for rec in request.records:
        member = await db.members.find_one({"id": rec["member_id"]}, {"_id": 0})
        if not member:
            continue
        
        # Check if exists
        existing = await db.attendance.find_one({
            "member_id": rec["member_id"],
            "activity_id": request.activity_id,
            "date": request.date
        })
        
        if existing:
            await db.attendance.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "status": rec.get("status", "present"),
                    "check_in_time": rec.get("check_in_time", current_time),
                    "notes": rec.get("notes", ""),
                    "recorded_by": current_user.get("username", "")
                }}
            )
        else:
            record_doc = {
                "id": str(uuid.uuid4()),
                "member_id": rec["member_id"],
                "member_name": member["name"],
                "activity_id": request.activity_id,
                "activity_name": activity["name"],
                "branch_id": member.get("branch_id", ""),
                "date": request.date,
                "status": rec.get("status", "present"),
                "check_in_time": rec.get("check_in_time", current_time),
                "notes": rec.get("notes", ""),
                "recorded_by": current_user.get("username", ""),
                "created_at": now
            }
            await db.attendance.insert_one(record_doc)
        
        try:
            attendance_notif = {
                "id": str(uuid.uuid4()),
                "member_id": rec["member_id"],
                "type": "attendance_recorded",
                "title_ar": "تم تسجيل حضورك",
                "title": "Attendance Recorded",
                "message_ar": f"تم تسجيل حضورك في {activity['name']} بنجاح - {request.date}",
                "message": f"Your attendance for {activity.get('name', '')} has been recorded - {request.date}",
                "link": "/member-attendance",
                "is_read": False,
                "created_at": now
            }
            await db.member_notifications.insert_one(attendance_notif)
        except Exception:
            pass
        
        recorded_count += 1
    
    return {"message": f"تم تسجيل حضور {recorded_count} عضو", "count": recorded_count}

@api_router.post("/attendance/qr-checkin")
async def qr_checkin(
    member_id: str = Form(...),
    activity_id: str = Form(...),
    current_user: dict = Depends(get_current_user)
):
    """Quick check-in via QR code scan"""
    member = await db.members.find_one({"id": member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="العضو غير موجود")
    
    activity = await db.activities.find_one({"id": activity_id}, {"_id": 0})
    if not activity:
        raise HTTPException(status_code=404, detail="النشاط غير موجود")
    
    # Check if member is enrolled in this activity
    member_activity = next((a for a in member.get("activities", []) if a["activity_id"] == activity_id), None)
    if not member_activity:
        raise HTTPException(status_code=400, detail="العضو غير مسجل في هذا النشاط")
    
    today = datetime.now().strftime("%Y-%m-%d")
    current_time = datetime.now().strftime("%H:%M")
    now = datetime.now(timezone.utc).isoformat()
    
    # Check if already checked in today
    existing = await db.attendance.find_one({
        "member_id": member_id,
        "activity_id": activity_id,
        "date": today
    })
    
    if existing:
        return {
            "message": "تم تسجيل الحضور مسبقاً",
            "member_name": member["name"],
            "activity_name": activity["name"],
            "check_in_time": existing.get("check_in_time", ""),
            "already_checked_in": True
        }
    
    record_doc = {
        "id": str(uuid.uuid4()),
        "member_id": member_id,
        "member_name": member["name"],
        "activity_id": activity_id,
        "activity_name": activity["name"],
        "branch_id": member.get("branch_id", ""),
        "date": today,
        "status": "present",
        "check_in_time": current_time,
        "notes": "تسجيل عبر QR",
        "recorded_by": current_user.get("username", ""),
        "created_at": now
    }
    await db.attendance.insert_one(record_doc)
    
    try:
        attendance_notif = {
            "id": str(uuid.uuid4()),
            "member_id": member_id,
            "type": "attendance_recorded",
            "title_ar": "تم تسجيل حضورك",
            "title": "Attendance Recorded",
            "message_ar": f"تم تسجيل حضورك في {activity['name']} بنجاح - {today}",
            "message": f"Your attendance for {activity.get('name', '')} has been recorded - {today}",
            "link": "/member-attendance",
            "is_read": False,
            "created_at": now
        }
        await db.member_notifications.insert_one(attendance_notif)
    except Exception:
        pass
    
    return {
        "message": "تم تسجيل الحضور بنجاح",
        "member_name": member["name"],
        "activity_name": activity["name"],
        "check_in_time": current_time,
        "already_checked_in": False
    }

@api_router.get("/attendance/member/{member_id}/report")
async def get_member_attendance_report(
    member_id: str,
    activity_id: str = None,
    start_date: str = None,
    end_date: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Get attendance report for a specific member"""
    member = await db.members.find_one({"id": member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="العضو غير موجود")
    
    query = {"member_id": member_id}
    if activity_id:
        query["activity_id"] = activity_id
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = end_date
        else:
            query["date"] = {"$lte": end_date}
    
    records = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    
    present_count = sum(1 for r in records if r.get("status") == "present")
    absent_count = sum(1 for r in records if r.get("status") == "absent")
    total = len(records)
    
    return {
        "member": member,
        "records": records,
        "summary": {
            "total_records": total,
            "present_count": present_count,
            "absent_count": absent_count,
            "attendance_rate": round((present_count / total * 100), 1) if total > 0 else 0
        }
    }

@api_router.get("/attendance/activity/{activity_id}/report")
async def get_activity_attendance_report(
    activity_id: str,
    start_date: str = None,
    end_date: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Get attendance report for a specific activity"""
    activity = await db.activities.find_one({"id": activity_id}, {"_id": 0})
    if not activity:
        raise HTTPException(status_code=404, detail="النشاط غير موجود")
    
    query = {"activity_id": activity_id}
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = end_date
        else:
            query["date"] = {"$lte": end_date}
    
    records = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(5000)
    
    # Get member codes and photos
    member_ids = list(set(r["member_id"] for r in records))
    members_data = await db.members.find(
        {"id": {"$in": member_ids}}, 
        {"_id": 0, "id": 1, "member_code": 1, "photo": 1}
    ).to_list(1000)
    member_codes = {m["id"]: m.get("member_code", "") for m in members_data}
    member_photos = {m["id"]: m.get("photo", "") for m in members_data}
    
    # Group by member
    member_stats = {}
    for r in records:
        mid = r["member_id"]
        if mid not in member_stats:
            member_stats[mid] = {
                "member_id": mid,
                "member_code": member_codes.get(mid, ""),
                "member_name": r["member_name"],
                "member_photo": member_photos.get(mid, "") or r.get("member_photo", ""),
                "present": 0,
                "absent": 0,
                "total": 0
            }
        member_stats[mid]["total"] += 1
        if r["status"] == "present":
            member_stats[mid]["present"] += 1
        else:
            member_stats[mid]["absent"] += 1
    
    # Calculate rates
    for mid, stats in member_stats.items():
        stats["attendance_rate"] = round((stats["present"] / stats["total"] * 100), 1) if stats["total"] > 0 else 0
    
    # Group by date
    date_stats = {}
    for r in records:
        d = r["date"]
        if d not in date_stats:
            date_stats[d] = {"date": d, "present": 0, "absent": 0}
        if r["status"] == "present":
            date_stats[d]["present"] += 1
        else:
            date_stats[d]["absent"] += 1
    
    return {
        "activity": activity,
        "total_records": len(records),
        "total_present": sum(1 for r in records if r["status"] == "present"),
        "total_absent": sum(1 for r in records if r["status"] == "absent"),
        "member_stats": list(member_stats.values()),
        "date_stats": sorted(date_stats.values(), key=lambda x: x["date"], reverse=True)
    }

@api_router.delete("/attendance/{record_id}")
async def delete_attendance(
    record_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete an attendance record"""
    result = await db.attendance.delete_one({"id": record_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="السجل غير موجود")
    return {"message": "تم حذف السجل"}

@api_router.get("/export/attendance")
async def export_attendance_excel(
    activity_id: str = None,
    level_id: str = None,
    start_date: str = None,
    end_date: str = None,
    branch_id: str = None,
    format: str = "xlsx",
    token: str = None
):
    """Export attendance summary to Excel or PDF (one row per member with session count)"""
    _require_export_admin_token(token)

    # Build date query
    date_query = {}
    if start_date and end_date:
        date_query = {"$gte": start_date, "$lte": end_date}
    elif start_date:
        date_query = {"$gte": start_date}
    elif end_date:
        date_query = {"$lte": end_date}

    query = {}
    if activity_id:
        query["activity_id"] = activity_id
    if branch_id:
        query["branch_id"] = branch_id
    if date_query:
        query["date"] = date_query

    # If level_id is given, restrict to members in that level
    level_doc = None
    level_display_name = ""
    activity_label = ""
    if level_id:
        level_doc = await db.levels.find_one({"id": level_id}, {"_id": 0})
        if level_doc:
            custom = (level_doc.get("custom_name") or "").strip()
            level_display_name = custom if custom else f"المستوى {level_doc.get('level_number', '')}"
            activity_label = level_doc.get("activity_name", "")
            # Override activity_id from level doc if not already set
            if not activity_id and level_doc.get("activity_id"):
                query["activity_id"] = level_doc["activity_id"]
            level_member_ids = level_doc.get("members", [])
            if level_member_ids:
                query["member_id"] = {"$in": level_member_ids}
            else:
                # Level is empty — guarantee zero results
                query["member_id"] = {"$in": ["__no_match__"]}

    records = await db.attendance.find(query, {"_id": 0}).sort("date", 1).to_list(20000)

    # Build per-member level name map (for when no level_id filter is applied)
    member_level_map = {}
    if not level_id:
        lookup_aid = activity_id or (level_doc.get("activity_id") if level_doc else None)
        lvl_query = {"activity_id": lookup_aid} if lookup_aid else {}
        all_lvls = await db.levels.find(lvl_query, {"_id": 0}).to_list(200)
        for lvl in all_lvls:
            cn = (lvl.get("custom_name") or "").strip()
            lname = cn if cn else f"المستوى {lvl.get('level_number', '')}"
            for mid in lvl.get("members", []):
                member_level_map[mid] = lname

    # Aggregate: one row per member
    from collections import defaultdict
    member_map = defaultdict(lambda: {
        "member_name": "", "member_code": "", "activity_name": "",
        "member_photo": "",
        "dates": [], "session_count": 0
    })
    for r in records:
        mid = r.get("member_id", "")
        if not mid:
            continue
        entry = member_map[mid]
        if not entry["member_name"]:
            entry["member_name"] = r.get("member_name", "")
        if not entry["member_code"]:
            entry["member_code"] = r.get("member_code", "")
        if not entry["activity_name"]:
            entry["activity_name"] = r.get("activity_name", "")
        if not entry["member_photo"] and r.get("member_photo"):
            entry["member_photo"] = r.get("member_photo", "")
        d = r.get("date", "")
        if d:
            entry["dates"].append(d)
        entry["session_count"] += 1

    # Fill in any missing photos from members collection (records may pre-date photo enrichment)
    member_ids_for_photo = [mid for mid, e in member_map.items() if not e["member_photo"]]
    if member_ids_for_photo:
        photo_docs = await db.members.find(
            {"id": {"$in": member_ids_for_photo}},
            {"_id": 0, "id": 1, "photo": 1}
        ).to_list(len(member_ids_for_photo))
        for d in photo_docs:
            mid = d.get("id")
            if mid in member_map:
                member_map[mid]["member_photo"] = d.get("photo", "") or ""

    rows = []
    for idx, (mid, entry) in enumerate(sorted(member_map.items(), key=lambda x: x[1]["member_name"]), 1):
        dates = sorted(entry["dates"])
        per_member_level = level_display_name if level_display_name else member_level_map.get(mid, "")
        rows.append({
            "idx": idx,
            "member_code": entry["member_code"],
            "member_name": entry["member_name"],
            "member_photo": entry["member_photo"],
            "activity_name": entry["activity_name"],
            "level_name": per_member_level,
            "session_count": entry["session_count"],
            "first_date": dates[0] if dates else "",
            "last_date": dates[-1] if dates else "",
        })

    # Fetch activity label if not already set from level_doc
    if not activity_label and activity_id:
        act_doc = await db.activities.find_one({"id": activity_id}, {"_id": 0, "name_ar": 1, "name": 1})
        if act_doc:
            activity_label = act_doc.get("name_ar") or act_doc.get("name", "")

    export_date = datetime.now().strftime("%Y-%m-%d")
    date_range_label = ""
    if start_date and end_date:
        date_range_label = f"{start_date} → {end_date}"
    elif start_date:
        date_range_label = f"من {start_date}"
    elif end_date:
        date_range_label = f"حتى {end_date}"

    if format == "pdf":
        rl = _get_reportlab()
        colors = rl.colors; A4 = rl.A4; SimpleDocTemplate = rl.SimpleDocTemplate
        Table = rl.Table; TableStyle = rl.TableStyle; Paragraph = rl.Paragraph
        Spacer = rl.Spacer; getSampleStyleSheet = rl.getSampleStyleSheet
        ParagraphStyle = rl.ParagraphStyle; mm = rl.mm
        pdfmetrics = rl.pdfmetrics; TTFont = rl.TTFont
        RLImage = rl.Image

        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4,
                                topMargin=15*mm, bottomMargin=15*mm,
                                leftMargin=15*mm, rightMargin=15*mm)

        # Register Arabic font — deterministic paths only, no subprocess
        font_name = "Helvetica"
        font_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
            "/nix/store/dejavu-fonts/share/fonts/truetype/DejaVuSans.ttf",
        ]
        for fp in font_paths:
            try:
                if Path(fp).exists():
                    pdfmetrics.registerFont(TTFont('ArabicFont', fp))
                    font_name = 'ArabicFont'
                    break
            except Exception:
                continue

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle('T', fontName=font_name, fontSize=14, leading=20, alignment=2)
        sub_style = ParagraphStyle('S', fontName=font_name, fontSize=9, leading=13, textColor=colors.HexColor('#555555'), alignment=2)
        cell_style = ParagraphStyle('C', fontName=font_name, fontSize=8, leading=11, alignment=1)
        hdr_style = ParagraphStyle('H', fontName=font_name, fontSize=8, leading=11, textColor=colors.white, alignment=1)

        elements = []
        elements.append(Paragraph("شركة اداء الابطال العالمية للرياضة", title_style))
        elements.append(Paragraph("كشف الحضور", title_style))
        subtitle_parts = []
        if activity_label:
            subtitle_parts.append(f"النشاط: {activity_label}")
        if level_display_name:
            subtitle_parts.append(f"المستوى: {level_display_name}")
        if date_range_label:
            subtitle_parts.append(date_range_label)
        subtitle_parts.append(f"تاريخ التصدير: {export_date}")
        elements.append(Paragraph("  |  ".join(subtitle_parts), sub_style))
        elements.append(Spacer(1, 5*mm))

        def _photo_cell(photo_data_url):
            """Build a small Image flowable from a base64 data URL, or return empty Paragraph."""
            raw = _decode_photo_data_url(photo_data_url)
            if not raw:
                return Paragraph("", cell_style)
            try:
                img = RLImage(BytesIO(raw), width=10*mm, height=10*mm)
                return img
            except Exception:
                return Paragraph("", cell_style)

        headers_pdf = ["آخر حضور", "أول حضور", "الجلسات", "المستوى", "النشاط", "الاسم", "صورة", "رقم العضوية", "م"]
        header_row = [Paragraph(h, hdr_style) for h in headers_pdf]
        data = [header_row]
        for r in rows:
            data.append([
                Paragraph(r["last_date"], cell_style),
                Paragraph(r["first_date"], cell_style),
                Paragraph(str(r["session_count"]), cell_style),
                Paragraph(r["level_name"], cell_style),
                Paragraph(r["activity_name"], cell_style),
                Paragraph(r["member_name"], cell_style),
                _photo_cell(r.get("member_photo", "")),
                Paragraph(str(r["member_code"]), cell_style),
                Paragraph(str(r["idx"]), cell_style),
            ])

        col_widths = [22*mm, 22*mm, 14*mm, 24*mm, 30*mm, 36*mm, 14*mm, 16*mm, 8*mm]
        table = Table(data, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F97316')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#DDDDDD')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#FFF7ED')]),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        elements.append(table)
        elements.append(Spacer(1, 5*mm))
        elements.append(Paragraph(f"إجمالي الأعضاء: {len(rows)}", sub_style))

        doc.build(elements)
        buffer.seek(0)
        filename_pdf = f"attendance_report_{datetime.now().strftime('%Y%m%d')}.pdf"
        return StreamingResponse(buffer, media_type="application/pdf",
                                 headers={"Content-Disposition": f"attachment; filename={filename_pdf}"})

    # --- Excel (default) ---
    xl = _get_openpyxl()
    Workbook = xl.Workbook; Font = xl.Font; PatternFill = xl.PatternFill
    Border = xl.Border; Side = xl.Side; Alignment = xl.Alignment
    XLImage = xl.Image
    wb = Workbook()
    ws = wb.active
    ws.title = "كشف الحضور"

    orange_fill = PatternFill("solid", fgColor="F97316")
    white_on_orange = Font(bold=True, color="FFFFFF")
    alt_fill = PatternFill("solid", fgColor="FFF7ED")
    border = Border(
        left=Side(style='thin', color='DDDDDD'),
        right=Side(style='thin', color='DDDDDD'),
        top=Side(style='thin', color='DDDDDD'),
        bottom=Side(style='thin', color='DDDDDD'),
    )
    center = Alignment(horizontal='center', vertical='center', wrap_text=True)

    # Title rows
    ws.append(["شركة اداء الابطال العالمية للرياضة"])
    ws.append(["كشف الحضور"])
    info_parts = []
    if activity_label:
        info_parts.append(f"النشاط: {activity_label}")
    if level_display_name:
        info_parts.append(f"المستوى: {level_display_name}")
    if date_range_label:
        info_parts.append(date_range_label)
    info_parts.append(f"تاريخ التصدير: {export_date}")
    ws.append(["  |  ".join(info_parts)])
    ws.append([])

    headers_xl = ["م", "صورة", "رقم العضوية", "الاسم", "النشاط", "المستوى", "عدد الجلسات", "أول حضور", "آخر حضور"]
    ws.append(headers_xl)
    hdr_row = ws.max_row
    for col_idx, cell in enumerate(ws[hdr_row], 1):
        cell.fill = orange_fill
        cell.font = white_on_orange
        cell.alignment = center
        cell.border = border

    col_widths_xl = [6, 8, 14, 25, 22, 18, 14, 14, 14]
    for i, w in enumerate(col_widths_xl, 1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w

    PHOTO_COL_LETTER = ws.cell(row=1, column=2).column_letter  # "صورة" column
    for r_idx, r in enumerate(rows):
        ws.append([
            r["idx"], "", r["member_code"], r["member_name"],
            r["activity_name"], r["level_name"], r["session_count"],
            r["first_date"], r["last_date"],
        ])
        row_num = ws.max_row
        fill = alt_fill if r_idx % 2 == 1 else None
        for cell in ws[row_num]:
            cell.alignment = center
            cell.border = border
            if fill:
                cell.fill = fill

        # Embed the member photo thumbnail in the photo column
        raw_photo = _decode_photo_data_url(r.get("member_photo", ""))
        if raw_photo:
            try:
                img = XLImage(BytesIO(raw_photo))
                img.width = 36
                img.height = 36
                ws.row_dimensions[row_num].height = 30
                ws.add_image(img, f"{PHOTO_COL_LETTER}{row_num}")
            except Exception:
                # Fallback silently if the image format is unsupported
                pass

    # Summary row
    ws.append([])
    ws.append([f"إجمالي الأعضاء: {len(rows)}"])
    ws[ws.max_row][0].font = Font(bold=True)

    output = BytesIO()
    wb.save(output)
    output.seek(0)
    filename_xl = f"attendance_report_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename_xl}"}
    )

# ============ INTERNAL EXPENSES (PETTY CASH) SYSTEM ============

# Expense types
EXPENSE_TYPES = [
    {"value": "hospitality", "label": "ضيافة"},
    {"value": "transportation", "label": "مواصلات"},
    {"value": "maintenance", "label": "صيانة بسيطة"},
    {"value": "office_supplies", "label": "أدوات مكتبية"},
    {"value": "cleaning", "label": "نظافة"},
    {"value": "utilities", "label": "مرافق"},
    {"value": "equipment", "label": "معدات"},
    {"value": "marketing", "label": "تسويق"},
    {"value": "training", "label": "تدريب"},
    {"value": "coach_salary", "label": "رواتب المدربين"},
    {"value": "coach_advance", "label": "سُلف المدربين"},
    {"value": "other", "label": "أخرى"}
]

class InternalExpenseCreate(BaseModel):
    expense_date: str
    expense_type: str
    cost_center: Optional[str] = None  # branch_id or activity_id
    description: str
    amount: float
    payment_method: str = "cash"  # cash, card, transfer
    executor_name: str  # الشخص المنفذ
    notes: Optional[str] = None

async def _load_user_permissions(user: dict) -> list:
    perms = user.get("permissions")
    if isinstance(perms, list):
        return perms
    uid = user.get("user_id")
    if not uid:
        return []
    doc = await db.users.find_one({"id": uid}, {"_id": 0, "permissions": 1})
    perms = (doc or {}).get("permissions") or []
    user["permissions"] = perms
    return perms


async def _can_approve_internal_expenses(user: dict) -> bool:
    if user.get("is_admin", False):
        return True
    perms = await _load_user_permissions(user)
    return ("accounting" in perms) or ("internal-expenses-approve" in perms)


async def _can_create_internal_expenses(user: dict) -> bool:
    if await _can_approve_internal_expenses(user):
        return True
    perms = await _load_user_permissions(user)
    return "internal-expenses-create" in perms


@api_router.get("/internal-expenses")
async def get_internal_expenses(
    status_filter: Optional[str] = None,
    expense_type: Optional[str] = None,
    branch_filter: Optional[str] = None,
    executor: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    mine_only: Optional[bool] = False,
    current_user: dict = Depends(get_current_user)
):
    """Get all internal expenses with filters"""
    if not await _can_create_internal_expenses(current_user):
        raise HTTPException(status_code=403, detail="الصلاحية مطلوبة للوصول للمصروفات الداخلية")
    query = {}
    
    is_admin = current_user.get("is_admin", False)
    if not is_admin and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    elif is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    
    if not await _can_approve_internal_expenses(current_user):
        query["created_by"] = current_user.get("username")
    elif mine_only:
        query["created_by"] = current_user.get("username")
    
    if status_filter and status_filter != "all":
        query["status"] = status_filter
    if expense_type and expense_type != "all":
        query["expense_type"] = expense_type
    if executor:
        query["executor_name"] = {"$regex": executor, "$options": "i"}
    if start_date:
        query["expense_date"] = {"$gte": start_date}
    if end_date:
        if "expense_date" in query:
            query["expense_date"]["$lte"] = end_date
        else:
            query["expense_date"] = {"$lte": end_date}
    
    expenses = await db.internal_expenses.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    return expenses

@api_router.get("/internal-expenses/summary")
async def get_expenses_summary(
    branch_filter: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get summary of internal expenses"""
    if not await _can_create_internal_expenses(current_user):
        raise HTTPException(status_code=403, detail="الصلاحية مطلوبة")
    query = {}
    
    is_admin = current_user.get("is_admin", False)
    if not is_admin and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    elif is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    
    if not await _can_approve_internal_expenses(current_user):
        query["created_by"] = current_user.get("username")
    
    if start_date:
        query["expense_date"] = {"$gte": start_date}
    if end_date:
        if "expense_date" in query:
            query["expense_date"]["$lte"] = end_date
        else:
            query["expense_date"] = {"$lte": end_date}
    
    expenses = await db.internal_expenses.find(query, {"_id": 0}).to_list(10000)
    
    # Calculate summary
    total_amount = sum(e.get("amount", 0) for e in expenses)
    by_status = {}
    by_type = {}
    by_executor = {}
    
    for exp in expenses:
        # By status
        status = exp.get("status", "pending")
        if status not in by_status:
            by_status[status] = {"count": 0, "total": 0}
        by_status[status]["count"] += 1
        by_status[status]["total"] += exp.get("amount", 0)
        
        # By type
        exp_type = exp.get("expense_type", "other")
        if exp_type not in by_type:
            by_type[exp_type] = {"count": 0, "total": 0}
        by_type[exp_type]["count"] += 1
        by_type[exp_type]["total"] += exp.get("amount", 0)
        
        # By executor
        executor = exp.get("executor_name", "غير محدد")
        if executor not in by_executor:
            by_executor[executor] = {"count": 0, "total": 0}
        by_executor[executor]["count"] += 1
        by_executor[executor]["total"] += exp.get("amount", 0)
    
    return {
        "total_count": len(expenses),
        "total_amount": round(total_amount, 2),
        "by_status": by_status,
        "by_type": by_type,
        "by_executor": by_executor
    }

@api_router.post("/internal-expenses")
async def create_internal_expense(
    expense_date: str = Form(...),
    expense_type: str = Form(...),
    description: str = Form(...),
    amount: float = Form(...),
    payment_method: str = Form("cash"),
    executor_name: str = Form(...),
    cost_center: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    branch_id: Optional[str] = Form(None),
    receipt_image: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """Create a new internal expense with optional receipt image"""
    if not await _can_create_internal_expenses(current_user):
        raise HTTPException(status_code=403, detail="الصلاحية مطلوبة لإضافة مصروف")
    
    last_expense = await db.internal_expenses.find_one(
        {"expense_number": {"$exists": True}},
        sort=[("created_at", -1)]
    )
    if last_expense and last_expense.get("expense_number"):
        try:
            last_num = int(last_expense["expense_number"].replace("EXP-", ""))
            next_num = last_num + 1
        except:
            next_num = 10001
    else:
        next_num = 10001
    if next_num < 10001:
        next_num = 10001
    expense_number = f"EXP-{next_num:05d}"
    
    # Handle image upload
    receipt_url = None
    if receipt_image and receipt_image.filename:
        # Create unique filename
        file_ext = receipt_image.filename.split(".")[-1] if "." in receipt_image.filename else "jpg"
        unique_filename = f"{uuid.uuid4()}.{file_ext}"
        file_path = UPLOADS_DIR / unique_filename
        
        # Save file
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(receipt_image.file, buffer)
        
        receipt_url = f"/uploads/{unique_filename}"
    
    # Determine branch_id
    final_branch_id = branch_id if current_user.get("is_admin") else current_user.get("branch_id")
    
    expense_data = {
        "id": str(uuid.uuid4()),
        "expense_number": expense_number,
        "expense_date": expense_date,
        "expense_type": expense_type,
        "cost_center": cost_center,
        "description": description,
        "amount": amount,
        "payment_method": payment_method,
        "executor_name": executor_name,
        "notes": notes,
        "receipt_url": receipt_url,
        "status": "pending",
        "branch_id": final_branch_id,
        "created_by": current_user.get("username"),
        "created_by_id": current_user.get("user_id"),
        "created_by_name": current_user.get("name") or current_user.get("username"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "journal_entry_id": None
    }
    
    await db.internal_expenses.insert_one(expense_data)
    expense_data.pop("_id", None)
    
    if not await _can_approve_internal_expenses(current_user):
        try:
            from routes.push_notifications import send_push_to_admins, NotificationPayload
            submitter = expense_data["created_by_name"]
            title_ar = "طلب مصروف جديد بانتظار الاعتماد"
            body_ar = f"{submitter} قدّم مصروف {expense_data['expense_number']} بقيمة {amount}"
            title_en = "New expense pending approval"
            body_en = f"{submitter} submitted expense {expense_data['expense_number']} for {amount}"
            await send_push_to_admins(
                NotificationPayload(
                    title=title_ar,
                    body=body_ar,
                    title_en=title_en,
                    body_en=body_en,
                    url="/admin/accounting?tab=expenses&status=pending",
                    tag=f"expense-pending-{expense_data['id']}",
                    data={
                        "type": "internal_expense_pending",
                        "expense_id": expense_data["id"],
                        "expense_number": expense_data["expense_number"],
                        "amount": amount,
                    },
                ),
                branch_id=final_branch_id,
            )
        except Exception as exc:
            logger.error(f"create_internal_expense: admin push failed: {exc}")
    
    return expense_data

@api_router.put("/internal-expenses/{expense_id}")
async def update_internal_expense(
    expense_id: str,
    expense_date: str = Form(...),
    expense_type: str = Form(...),
    description: str = Form(...),
    amount: float = Form(...),
    payment_method: str = Form("cash"),
    executor_name: str = Form(...),
    cost_center: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    receipt_image: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """Update an internal expense"""
    existing = await db.internal_expenses.find_one({"id": expense_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")
    
    if existing.get("status") == "posted":
        raise HTTPException(status_code=400, detail="لا يمكن تعديل مصروف مرحّل للمحاسبة")
    
    if not current_user.get("is_admin", False):
        user_branch = current_user.get("branch_id")
        if not user_branch or existing.get("branch_id") != user_branch:
            raise HTTPException(status_code=403, detail="هذا المصروف يخص فرعاً آخر")
    if not await _can_approve_internal_expenses(current_user):
        if not await _can_create_internal_expenses(current_user):
            raise HTTPException(status_code=403, detail="الصلاحية مطلوبة")
        if existing.get("created_by") != current_user.get("username"):
            raise HTTPException(status_code=403, detail="لا يمكنك تعديل مصروف ليس من إنشائك")
        if existing.get("status") != "pending":
            raise HTTPException(status_code=400, detail="لا يمكن تعديل مصروف بعد اعتماده")
    
    # Handle image upload
    receipt_url = existing.get("receipt_url")
    if receipt_image and receipt_image.filename:
        # Delete old image if exists
        if receipt_url:
            old_file = UPLOADS_DIR / receipt_url.replace("/uploads/", "")
            if old_file.exists():
                old_file.unlink()
        
        # Save new image
        file_ext = receipt_image.filename.split(".")[-1] if "." in receipt_image.filename else "jpg"
        unique_filename = f"{uuid.uuid4()}.{file_ext}"
        file_path = UPLOADS_DIR / unique_filename
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(receipt_image.file, buffer)
        
        receipt_url = f"/uploads/{unique_filename}"
    
    update_data = {
        "expense_date": expense_date,
        "expense_type": expense_type,
        "cost_center": cost_center,
        "description": description,
        "amount": amount,
        "payment_method": payment_method,
        "executor_name": executor_name,
        "notes": notes,
        "receipt_url": receipt_url,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.internal_expenses.update_one({"id": expense_id}, {"$set": update_data})
    
    updated = await db.internal_expenses.find_one({"id": expense_id}, {"_id": 0})
    return updated

@api_router.put("/internal-expenses/{expense_id}/status")
async def update_expense_status(
    expense_id: str,
    status: str,
    current_user: dict = Depends(get_current_user)
):
    """Update expense status (approve/reject)"""
    if not await _can_approve_internal_expenses(current_user):
        raise HTTPException(status_code=403, detail="الصلاحية مطلوبة لاعتماد المصروفات")
    if status not in ["pending", "approved", "rejected"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    existing = await db.internal_expenses.find_one({"id": expense_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")
    
    if existing.get("status") == "posted":
        raise HTTPException(status_code=400, detail="لا يمكن تعديل مصروف مرحّل للمحاسبة")
    
    if not current_user.get("is_admin", False):
        user_branch = current_user.get("branch_id")
        if not user_branch or existing.get("branch_id") != user_branch:
            raise HTTPException(status_code=403, detail="هذا المصروف يخص فرعاً آخر")
    
    await db.internal_expenses.update_one(
        {"id": expense_id},
        {"$set": {
            "status": status,
            "status_updated_by": current_user.get("username"),
            "status_updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    return {"message": f"تم تحديث الحالة إلى {status}"}

@api_router.post("/internal-expenses/post-to-accounting")
async def post_expenses_to_accounting(
    expense_ids: List[str],
    debit_account_id: str,
    credit_account_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Post multiple approved expenses to accounting as a journal entry"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get expenses
    expenses = await db.internal_expenses.find({
        "id": {"$in": expense_ids},
        "status": "approved"
    }, {"_id": 0}).to_list(1000)
    
    if len(expenses) != len(expense_ids):
        raise HTTPException(status_code=400, detail="بعض المصروفات غير موجودة أو غير معتمدة")
    
    # Calculate total
    total_amount = sum(e.get("amount", 0) for e in expenses)
    
    # Get accounts info
    debit_account = await db.accounts.find_one({"id": debit_account_id}, {"_id": 0})
    credit_account = await db.accounts.find_one({"id": credit_account_id}, {"_id": 0})
    
    if not debit_account or not credit_account:
        raise HTTPException(status_code=400, detail="الحسابات غير موجودة")
    
    # Generate journal entry number
    last_entry = await db.journal_entries.find_one(
        {"entry_number": {"$exists": True}},
        sort=[("created_at", -1)]
    )
    if last_entry:
        try:
            last_num = int(last_entry["entry_number"].replace("JE-", ""))
            next_num = last_num + 1
        except:
            next_num = 10001
    else:
        next_num = 10001
    if next_num < 10001:
        next_num = 10001
    entry_number = f"JE-{next_num:05d}"
    
    # Create description
    expense_nums = ", ".join([e["expense_number"] for e in expenses])
    description = f"ترحيل مصروفات داخلية: {expense_nums}"
    
    # Create journal entry
    journal_entry = {
        "id": str(uuid.uuid4()),
        "entry_number": entry_number,
        "entry_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "description": description,
        "reference_number": expense_nums,
        "journal_type": "expenses",
        "lines": [
            {
                "account_id": debit_account_id,
                "account_code": debit_account.get("code", ""),
                "account_name": debit_account.get("name_ar", ""),
                "debit": round(total_amount, 2),
                "credit": 0,
                "description": "مصروفات داخلية"
            },
            {
                "account_id": credit_account_id,
                "account_code": credit_account.get("code", ""),
                "account_name": credit_account.get("name_ar", ""),
                "debit": 0,
                "credit": round(total_amount, 2),
                "description": "سداد مصروفات داخلية"
            }
        ],
        "total_debit": round(total_amount, 2),
        "total_credit": round(total_amount, 2),
        "reference_type": "internal_expenses",
        "reference_id": ",".join(expense_ids),
        "branch_id": expenses[0].get("branch_id") if expenses else None,
        "created_by": current_user.get("username"),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.journal_entries.insert_one(journal_entry)
    
    # Update expenses status
    await db.internal_expenses.update_many(
        {"id": {"$in": expense_ids}},
        {"$set": {
            "status": "posted",
            "journal_entry_id": journal_entry["id"],
            "posted_at": datetime.now(timezone.utc).isoformat(),
            "posted_by": current_user.get("username")
        }}
    )
    
    return {
        "message": f"تم ترحيل {len(expenses)} مصروف إلى القيد المحاسبي {entry_number}",
        "journal_entry_id": journal_entry["id"],
        "total_amount": total_amount
    }

@api_router.delete("/internal-expenses/{expense_id}")
async def delete_internal_expense(expense_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an internal expense"""
    existing = await db.internal_expenses.find_one({"id": expense_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")
    
    if existing.get("status") == "posted":
        raise HTTPException(status_code=400, detail="لا يمكن حذف مصروف مرحّل للمحاسبة")
    
    if not current_user.get("is_admin", False):
        user_branch = current_user.get("branch_id")
        if not user_branch or existing.get("branch_id") != user_branch:
            raise HTTPException(status_code=403, detail="هذا المصروف يخص فرعاً آخر")
    if not await _can_approve_internal_expenses(current_user):
        if not await _can_create_internal_expenses(current_user):
            raise HTTPException(status_code=403, detail="الصلاحية مطلوبة")
        if existing.get("created_by") != current_user.get("username"):
            raise HTTPException(status_code=403, detail="لا يمكنك حذف مصروف ليس من إنشائك")
        if existing.get("status") != "pending":
            raise HTTPException(status_code=400, detail="لا يمكن حذف مصروف بعد اعتماده")
    
    # Delete receipt image if exists
    if existing.get("receipt_url"):
        file_path = UPLOADS_DIR / existing["receipt_url"].replace("/uploads/", "")
        if file_path.exists():
            file_path.unlink()
    
    await db.internal_expenses.delete_one({"id": expense_id})
    return {"message": "تم حذف المصروف"}

@api_router.get("/internal-expenses/types")
async def get_expense_types():
    """Get list of expense types"""
    return EXPENSE_TYPES


@api_router.get("/internal-expenses/pending-count")
async def get_internal_expenses_pending_count(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Count of pending internal expenses for the badge in the sidebar."""
    if not await _can_approve_internal_expenses(current_user):
        return {"count": 0}
    query = {"status": "pending"}
    is_admin = current_user.get("is_admin", False)
    if not is_admin and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    elif is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    count = await db.internal_expenses.count_documents(query)
    return {"count": count}


# ──────────────────────────────────────────────────────────────────────────
# Internal Expense Payments  (مدفوعات المصروفات الداخلية)
# ──────────────────────────────────────────────────────────────────────────

PAYMENT_METHOD_LABELS = {"cash": "نقداً", "transfer": "تحويل بنكي", "check": "شيك"}

@api_router.get("/internal-expense-payments/summary")
async def get_expense_payments_summary(
    branch_filter: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Summary of expense payments: total_amount, count, last_payment_date"""
    query = {}
    is_admin = current_user.get("is_admin", False)
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    if start_date:
        query.setdefault("payment_date", {})["$gte"] = start_date
    if end_date:
        query.setdefault("payment_date", {})["$lte"] = end_date

    payments = await db.internal_expense_payments.find(query, {"_id": 0}).to_list(100000)
    total = sum(p.get("amount", 0) for p in payments)
    last = max((p.get("payment_date", "") for p in payments), default=None)
    return {"total_amount": total, "count": len(payments), "last_payment_date": last}


@api_router.get("/internal-expense-payments")
async def list_expense_payments(
    branch_filter: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """List expense payments, newest payment_date first"""
    query = {}
    is_admin = current_user.get("is_admin", False)
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    if start_date:
        query.setdefault("payment_date", {})["$gte"] = start_date
    if end_date:
        query.setdefault("payment_date", {})["$lte"] = end_date

    payments = await db.internal_expense_payments.find(query, {"_id": 0}).sort("payment_date", -1).to_list(10000)
    return payments


@api_router.post("/internal-expense-payments")
async def create_expense_payment(
    payment_date: str = Form(...),
    amount: float = Form(...),
    payment_method: str = Form("cash"),
    description: str = Form(""),
    reference: str = Form(""),
    notes: str = Form(""),
    branch_id: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """Create a new expense payment (admin only)"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="غير مصرح")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="المبلغ يجب أن يكون أكبر من صفر")
    if payment_method not in PAYMENT_METHOD_LABELS:
        raise HTTPException(status_code=400, detail="طريقة دفع غير صحيحة")

    year = datetime.now().year
    # Admin can pass an explicit branch_id; non-admin always uses their own branch
    is_admin = current_user.get("is_admin", False)
    if is_admin and branch_id and branch_id != "all":
        branch_id = branch_id
    else:
        branch_id = current_user.get("branch_id")
    number_query = {"payment_number": {"$regex": f"^PAY-{year}-"}}
    if branch_id:
        number_query["branch_id"] = branch_id
    last = await db.internal_expense_payments.find_one(number_query, sort=[("payment_number", -1)])
    if last and last.get("payment_number"):
        try:
            seq = int(last["payment_number"].split("-")[-1]) + 1
        except Exception:
            seq = 1
    else:
        seq = 1
    payment_number = f"PAY-{year}-{seq:03d}"

    payment_data = {
        "id": str(uuid.uuid4()),
        "payment_number": payment_number,
        "payment_date": payment_date,
        "amount": amount,
        "payment_method": payment_method,
        "payment_method_ar": PAYMENT_METHOD_LABELS.get(payment_method, payment_method),
        "description": description,
        "reference": reference,
        "notes": notes,
        "branch_id": branch_id,
        "created_by": current_user.get("username"),
        "created_at": datetime.utcnow().isoformat(),
    }
    await db.internal_expense_payments.insert_one(payment_data)
    payment_data.pop("_id", None)
    return payment_data


@api_router.put("/internal-expense-payments/{payment_id}")
async def update_expense_payment(
    payment_id: str,
    payment_date: Optional[str] = Form(None),
    amount: Optional[float] = Form(None),
    payment_method: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    reference: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """Update an expense payment (admin only)"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="غير مصرح")
    existing = await db.internal_expense_payments.find_one({"id": payment_id})
    if not existing:
        raise HTTPException(status_code=404, detail="الدفعة غير موجودة")

    update_data = {}
    if payment_date is not None:
        update_data["payment_date"] = payment_date
    if amount is not None:
        if amount <= 0:
            raise HTTPException(status_code=400, detail="المبلغ يجب أن يكون أكبر من صفر")
        update_data["amount"] = amount
    if payment_method is not None:
        if payment_method not in PAYMENT_METHOD_LABELS:
            raise HTTPException(status_code=400, detail="طريقة دفع غير صحيحة")
        update_data["payment_method"] = payment_method
        update_data["payment_method_ar"] = PAYMENT_METHOD_LABELS[payment_method]
    if description is not None:
        update_data["description"] = description
    if reference is not None:
        update_data["reference"] = reference
    if notes is not None:
        update_data["notes"] = notes

    if update_data:
        await db.internal_expense_payments.update_one({"id": payment_id}, {"$set": update_data})
    updated = await db.internal_expense_payments.find_one({"id": payment_id}, {"_id": 0})
    return updated


@api_router.delete("/internal-expense-payments/{payment_id}")
async def delete_expense_payment(payment_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an expense payment (admin only)"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="غير مصرح")
    existing = await db.internal_expense_payments.find_one({"id": payment_id})
    if not existing:
        raise HTTPException(status_code=404, detail="الدفعة غير موجودة")
    await db.internal_expense_payments.delete_one({"id": payment_id})
    return {"message": "تم حذف الدفعة"}


@api_router.get("/export/internal-expenses")
async def export_internal_expenses(
    status_filter: Optional[str] = None,
    expense_type: Optional[str] = None,
    branch_filter: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Export internal expenses to Excel"""
    _require_admin_export_user(current_user)
    query = {}
    
    is_admin = current_user.get("is_admin", False)
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
    if status_filter and status_filter != "all":
        query["status"] = status_filter
    if expense_type and expense_type != "all":
        query["expense_type"] = expense_type
    if start_date:
        query["expense_date"] = {"$gte": start_date}
    if end_date:
        if "expense_date" in query:
            query["expense_date"]["$lte"] = end_date
        else:
            query["expense_date"] = {"$lte": end_date}
    
    expenses = await db.internal_expenses.find(query, {"_id": 0}).sort("expense_date", -1).to_list(10000)
    
    # Create Excel workbook
    xl = _get_openpyxl()
    Workbook = xl.Workbook; Font = xl.Font; PatternFill = xl.PatternFill; Border = xl.Border; Side = xl.Side; Alignment = xl.Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = "المصروفات الداخلية"
    
    # Header styling
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1e3a8a", end_color="1e3a8a", fill_type="solid")
    
    headers = ["رقم العملية", "التاريخ", "نوع المصروف", "البيان", "المبلغ", "طريقة الدفع", "المنفذ", "الحالة"]
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
    
    # Type labels map
    type_labels = {t["value"]: t["label"] for t in EXPENSE_TYPES}
    status_labels = {"pending": "تحت المراجعة", "approved": "مقبول", "rejected": "مرفوض", "posted": "مرحّل"}
    payment_labels = {"cash": "نقدي", "card": "بطاقة", "transfer": "تحويل"}
    
    # Data rows
    for row, exp in enumerate(expenses, 2):
        ws.cell(row=row, column=1, value=exp.get("expense_number", ""))
        ws.cell(row=row, column=2, value=exp.get("expense_date", ""))
        ws.cell(row=row, column=3, value=type_labels.get(exp.get("expense_type"), exp.get("expense_type", "")))
        ws.cell(row=row, column=4, value=exp.get("description", ""))
        ws.cell(row=row, column=5, value=exp.get("amount", 0))
        ws.cell(row=row, column=6, value=payment_labels.get(exp.get("payment_method"), exp.get("payment_method", "")))
        ws.cell(row=row, column=7, value=exp.get("executor_name", ""))
        ws.cell(row=row, column=8, value=status_labels.get(exp.get("status"), exp.get("status", "")))
    
    # Auto-width columns
    for col in ws.columns:
        max_length = max(len(str(cell.value or "")) for cell in col)
        ws.column_dimensions[col[0].column_letter].width = max_length + 2
    
    # Save to buffer
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    
    filename = f"internal_expenses_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# ============ NOTIFICATIONS SYSTEM ============

class NotificationCreate(BaseModel):
    title: str
    message: str
    notification_type: str = "renewal_reminder"  # renewal_reminder, payment_due, general
    target_type: str = "member"  # member, user, all
    target_id: Optional[str] = None
    related_entity_type: Optional[str] = None  # member, invoice, activity
    related_entity_id: Optional[str] = None
    action_url: Optional[str] = None

@api_router.get("/notifications")
async def get_notifications(
    is_read: Optional[bool] = None,
    notification_type: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get notifications for the current user"""
    query = {}
    
    # Filter by user's branch if not admin
    is_admin = current_user.get("is_admin", False)
    if not is_admin and current_user.get("branch_id"):
        query["$or"] = [
            {"branch_id": current_user["branch_id"]},
            {"branch_id": None},
            {"branch_id": ""}
        ]
    
    if is_read is not None:
        query["is_read"] = is_read
    if notification_type:
        query["notification_type"] = notification_type
    
    notifications = await db.notifications.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return notifications

@api_router.get("/notifications/unread-count")
async def get_unread_count(current_user: dict = Depends(get_current_user)):
    """Get count of unread notifications"""
    query = {"is_read": False}
    
    is_admin = current_user.get("is_admin", False)
    if not is_admin and current_user.get("branch_id"):
        query["$or"] = [
            {"branch_id": current_user["branch_id"]},
            {"branch_id": None},
            {"branch_id": ""}
        ]
    
    count = await db.notifications.count_documents(query)
    return {"count": count}

@api_router.put("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Mark a notification as read"""
    result = await db.notifications.update_one(
        {"id": notification_id},
        {"$set": {"is_read": True, "read_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "تم تحديث الإشعار"}

@api_router.put("/notifications/mark-all-read")
async def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
    """Mark all notifications as read"""
    query = {"is_read": False}
    
    is_admin = current_user.get("is_admin", False)
    if not is_admin and current_user.get("branch_id"):
        query["$or"] = [
            {"branch_id": current_user["branch_id"]},
            {"branch_id": None},
            {"branch_id": ""}
        ]
    
    result = await db.notifications.update_many(
        query,
        {"$set": {"is_read": True, "read_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": f"تم تحديث {result.modified_count} إشعار"}

@api_router.delete("/notifications/{notification_id}")
async def delete_notification(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a notification"""
    result = await db.notifications.delete_one({"id": notification_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "تم حذف الإشعار"}

@api_router.post("/notifications/check-renewals")
async def check_subscription_renewals(current_user: dict = Depends(get_current_user)):
    """Check for subscriptions expiring soon and create notifications"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    today = datetime.now(timezone.utc).date()
    
    members = await db.members.find({}, {"_id": 0}).to_list(10000)
    
    notifications_created = 0
    
    for member in members:
        for activity in member.get("activities", []):
            if not activity.get("end_date"):
                continue
            
            try:
                end_date = datetime.strptime(activity["end_date"], "%Y-%m-%d").date()
            except:
                continue
            
            days_until_expiry = (end_date - today).days
            
            # Create notification for subscriptions expiring within 7 days
            if days_until_expiry <= 7 and days_until_expiry >= 0:
                # Check if notification already exists for this activity and date
                existing = await db.notifications.find_one({
                    "related_entity_type": "activity",
                    "related_entity_id": f"{member['id']}_{activity['activity_id']}_{activity['end_date']}",
                })
                
                if existing:
                    continue
                
                # Create notification — persist Arabic and English variants
                # so the admin bell can render in the viewer's chosen language.
                member_name_ar = member.get('name_ar', member.get('name', ''))
                member_name_en = member.get('name', member.get('name_ar', ''))
                activity_name = activity['activity_name']
                if days_until_expiry == 0:
                    title = "⚠️ اشتراك منتهي اليوم!"
                    title_en = "⚠️ Subscription expires today!"
                    message = f"اشتراك {member_name_ar} في {activity_name} ينتهي اليوم"
                    message_en = f"{member_name_en}'s subscription in {activity_name} expires today"
                elif days_until_expiry == 1:
                    title = "🔴 تنبيه: اشتراك ينتهي غداً!"
                    title_en = "🔴 Subscription expires tomorrow!"
                    message = f"اشتراك {member_name_ar} في {activity_name} ينتهي غداً"
                    message_en = f"{member_name_en}'s subscription in {activity_name} expires tomorrow"
                elif days_until_expiry <= 3:
                    title = "🟠 تنبيه: اشتراك ينتهي قريباً!"
                    title_en = "🟠 Subscription expiring soon!"
                    message = f"اشتراك {member_name_ar} في {activity_name} ينتهي خلال {days_until_expiry} أيام ({activity['end_date']})"
                    day_word = "day" if days_until_expiry == 1 else "days"
                    message_en = f"{member_name_en}'s subscription in {activity_name} expires in {days_until_expiry} {day_word} ({activity['end_date']})"
                else:
                    title = "🔔 تذكير بتجديد الاشتراك"
                    title_en = "🔔 Subscription renewal reminder"
                    message = f"اشتراك {member_name_ar} في {activity_name} ينتهي خلال {days_until_expiry} أيام ({activity['end_date']})"
                    day_word = "day" if days_until_expiry == 1 else "days"
                    message_en = f"{member_name_en}'s subscription in {activity_name} expires in {days_until_expiry} {day_word} ({activity['end_date']})"

                notification = {
                    "id": str(uuid.uuid4()),
                    "title": title,
                    "message": message,
                    "title_ar": title,
                    "message_ar": message,
                    "title_en": title_en,
                    "message_en": message_en,
                    "notification_type": "renewal_reminder",
                    "target_type": "user",
                    "target_id": None,
                    "related_entity_type": "activity",
                    "related_entity_id": f"{member['id']}_{activity['activity_id']}_{activity['end_date']}",
                    "member_id": member["id"],
                    "member_name": member.get("name_ar", member.get("name", "")),
                    "member_phone": member.get("phone", ""),
                    "activity_name": activity["activity_name"],
                    "end_date": activity["end_date"],
                    "days_before_expiry": days_until_expiry,
                    "action_url": f"/members?search={member.get('name_ar', '')}",
                    "is_read": False,
                    "branch_id": member.get("branch_id"),
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                
                await db.notifications.insert_one(notification)
                notifications_created += 1

                try:
                    from routes.push_notifications import send_push_to_admins, NotificationPayload
                    await send_push_to_admins(
                        NotificationPayload(
                            title=title,
                            body=message,
                            title_en=title_en,
                            body_en=message_en,
                            url=notification["action_url"],
                            tag=f"renewal-{member['id']}-{activity['activity_id']}-{activity['end_date']}",
                            data={
                                "type": "renewal_reminder",
                                "member_id": member["id"],
                                "activity_id": activity.get("activity_id"),
                                "end_date": activity["end_date"],
                                "days_before_expiry": days_until_expiry,
                            },
                        ),
                        branch_id=member.get("branch_id"),
                    )
                except Exception as exc:
                    logger.error(f"check_subscription_renewals: admin push failed: {exc}")

    return {"message": f"تم إنشاء {notifications_created} إشعار جديد", "count": notifications_created}


# ============ MEMBER PORTAL NOTIFICATIONS ============

class MemberNotificationCreate(BaseModel):
    title: str
    message: str
    title_en: Optional[str] = None
    message_en: Optional[str] = None
    title_ar: Optional[str] = None
    message_ar: Optional[str] = None
    target: str = "all_members"  # all_members, specific_member, activity_members
    target_member_id: Optional[str] = None
    target_member_ids: Optional[List[str]] = None  # direct list — bypasses level/activity resolution
    target_activity_id: Optional[str] = None    # legacy
    target_activity_name: Optional[str] = None  # preferred: matches activity_name stored in levels
    target_level_id: Optional[str] = None
    priority: str = "info"  # info, warning, danger
    notification_type: str = "announcement"  # announcement, offer, reminder

@api_router.post("/member-notifications")
async def create_member_notification(data: MemberNotificationCreate, current_user: dict = Depends(get_current_user)):
    """Create a notification for member portal"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    # Resolve target_members list
    target_members = []
    if data.target_member_ids:
        # Direct list provided — use as-is (bypasses level/activity resolution)
        target_members = data.target_member_ids
    elif data.target == "specific_member" and data.target_member_id:
        target_members = [data.target_member_id]
    elif data.target == "activity_members":
        if data.target_level_id:
            level = await db.levels.find_one({"id": data.target_level_id}, {"_id": 0, "members": 1})
            target_members = level.get("members", []) if level else []
        elif data.target_activity_name:
            # Filter by activity_name (how levels are actually stored in db.levels)
            levels = await db.levels.find(
                {"activity_name": data.target_activity_name}, {"_id": 0, "members": 1}
            ).to_list(500)
            seen = set()
            for lvl in levels:
                for mid in lvl.get("members", []):
                    if mid not in seen:
                        seen.add(mid)
                        target_members.append(mid)
        elif data.target_activity_id:
            # Legacy: filter by activity_id
            levels = await db.levels.find(
                {"activity_id": data.target_activity_id}, {"_id": 0, "members": 1}
            ).to_list(500)
            seen = set()
            for lvl in levels:
                for mid in lvl.get("members", []):
                    if mid not in seen:
                        seen.add(mid)
                        target_members.append(mid)

    # Persist Arabic and English variants of the broadcast so the admin
    # notification bell renders in the viewer's chosen language. The legacy
    # ``title``/``message`` fields are kept populated for back-compat with any
    # consumer that hasn't been updated to read the bilingual keys. When the
    # admin only supplies one language, mirror it into the other so the
    # Layout fallback chain still finds something to display.
    title_ar = data.title_ar or data.title
    message_ar = data.message_ar or data.message
    title_en = data.title_en or data.title
    message_en = data.message_en or data.message
    notification = {
        "id": str(uuid.uuid4()),
        "title": data.title,
        "message": data.message,
        "title_ar": title_ar,
        "message_ar": message_ar,
        "title_en": title_en,
        "message_en": message_en,
        "target": data.target,
        "target_members": target_members,
        "priority": data.priority,
        "type": data.notification_type,
        "target_activity_id": data.target_activity_id,
        "target_activity_name": data.target_activity_name,
        "target_level_id": data.target_level_id,
        "created_by": current_user.get("id"),
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    await db.notifications.insert_one(notification)

    # Best-effort push notification to the targeted members so they hear about
    # the alert on their device — localized per recipient via the saved push
    # subscription language. Failures are swallowed; the in-app bell entry
    # already provides the bilingual fallback.
    try:
        from routes.push_notifications import send_push_to_members, NotificationPayload
        recipients = target_members if target_members else None
        if recipients:
            await send_push_to_members(
                NotificationPayload(
                    title=title_ar,
                    body=message_ar,
                    title_en=title_en,
                    body_en=message_en,
                    url="/portal/notifications",
                    tag=f"member-notif-{notification['id']}",
                    data={"type": data.notification_type, "notification_id": notification["id"]},
                ),
                recipients,
            )
        elif data.target == "all_members":
            from routes.push_notifications import send_notification_to_all_members
            await send_notification_to_all_members(
                NotificationPayload(
                    title=title_ar,
                    body=message_ar,
                    title_en=title_en,
                    body_en=message_en,
                    url="/portal/notifications",
                    tag=f"member-notif-{notification['id']}",
                    data={"type": data.notification_type, "notification_id": notification["id"]},
                )
            )
    except Exception:
        import logging
        logging.getLogger(__name__).exception("member-notification push failed")

    return {
        "message": "تم إرسال الإشعار بنجاح",
        "notification_id": notification["id"],
        "target_count": len(target_members)
    }

class MemberActiveCheckRequest(BaseModel):
    member_ids: List[str]

@api_router.post("/members/active-status")
async def get_members_active_status(
    data: MemberActiveCheckRequest,
    current_user: dict = Depends(get_current_user)
):
    """Return details + active-subscription status for a given list of member_ids."""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    from datetime import date
    today = date.today().isoformat()

    if not data.member_ids:
        return []

    members = await db.members.find(
        {"id": {"$in": data.member_ids}},
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "phone": 1, "activities": 1}
    ).to_list(1000)

    result = []
    for m in members:
        activities = m.get("activities") or []
        is_active = any(
            (a.get("end_date") or "") >= today
            for a in activities
        )
        result.append({
            "member_id": m["id"],
            "name": m.get("name_ar") or m.get("name", ""),
            "phone": m.get("phone", ""),
            "is_active": is_active,
        })

    # Preserve original ordering
    order = {mid: i for i, mid in enumerate(data.member_ids)}
    result.sort(key=lambda x: order.get(x["member_id"], 9999))
    return result


@api_router.get("/member-notifications")
async def get_member_notifications(current_user: dict = Depends(get_current_user)):
    """Get all member portal notifications"""
    notifications = await db.notifications.find(
        {"target": {"$in": ["all_members", "specific_member"]}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return notifications

@api_router.delete("/member-notifications/{notification_id}")
async def delete_member_notification(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a member portal notification"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.notifications.delete_one({"id": notification_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "تم حذف الإشعار"}


@api_router.get("/notifications/expiring-subscriptions")
async def get_expiring_subscriptions(
    days: int = 7,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get list of subscriptions expiring within specified days"""
    today = datetime.now(timezone.utc).date()
    target_date = today + timedelta(days=days)
    
    members = await db.members.find({}, {"_id": 0}).to_list(10000)
    
    expiring = []
    
    for member in members:
        # Filter by branch if specified
        if branch_filter and branch_filter != "all" and member.get("branch_id") != branch_filter:
            continue
        
        for activity in member.get("activities", []):
            if not activity.get("end_date"):
                continue
            
            try:
                end_date = datetime.strptime(activity["end_date"], "%Y-%m-%d").date()
            except:
                continue
            
            days_until_expiry = (end_date - today).days
            
            if 0 <= days_until_expiry <= days:
                schedule = activity.get("schedule", "")
                if not schedule and activity.get("training_days"):
                    days_str = " و ".join(activity["training_days"])
                    time_str = activity.get("training_time", "")
                    schedule = f"{days_str} - {time_str}" if time_str else days_str
                expiring.append({
                    "member_id": member["id"],
                    "member_name": member.get("name_ar", member.get("name", "")),
                    "member_phone": member.get("phone", ""),
                    "activity_id": activity.get("activity_id"),
                    "activity_name": activity.get("activity_name"),
                    "start_date": activity.get("start_date"),
                    "end_date": activity.get("end_date"),
                    "days_remaining": days_until_expiry,
                    "fee": activity.get("fee", 0),
                    "branch_id": member.get("branch_id"),
                    "schedule": schedule,
                    "status": "expired" if days_until_expiry <= 0 else "expiring_soon"
                })
    
    # Sort by days remaining
    expiring.sort(key=lambda x: x["days_remaining"])
    
    return {
        "total": len(expiring),
        "subscriptions": expiring
    }

# ============ JOURNAL ENTRIES ROUTES ============

@api_router.get("/journal-entries")
async def get_journal_entries(
    journal_type: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    account_id: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all journal entries with filters"""
    query = {}
    is_admin = current_user.get("is_admin", False)
    
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
    if journal_type:
        query["journal_type"] = journal_type
    if start_date:
        query["entry_date"] = {"$gte": start_date}
    if end_date:
        if "entry_date" in query:
            query["entry_date"]["$lte"] = end_date
        else:
            query["entry_date"] = {"$lte": end_date}
    if account_id:
        query["lines.account_id"] = account_id
    
    entries = await db.journal_entries.find(query, {"_id": 0}).sort("entry_date", -1).to_list(1000)
    return entries

@api_router.get("/journal-entries/{entry_id}")
async def get_journal_entry(entry_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single journal entry"""
    entry = await db.journal_entries.find_one({"id": entry_id}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return entry

@api_router.post("/journal-entries")
async def create_journal_entry(entry: JournalEntryCreate, current_user: dict = Depends(get_current_user)):
    """Create a manual journal entry"""
    # Validate balance
    total_debit = sum(line.debit for line in entry.lines)
    total_credit = sum(line.credit for line in entry.lines)
    
    if round(total_debit, 2) != round(total_credit, 2):
        raise HTTPException(status_code=400, detail=f"القيد غير متوازن: المدين {total_debit} ≠ الدائن {total_credit}")
    
    entry_id = str(uuid.uuid4())
    last_je_manual = await db.journal_entries.find_one(
        {"entry_number": {"$exists": True}}, sort=[("created_at", -1)]
    )
    if last_je_manual and last_je_manual.get("entry_number"):
        try:
            je_m_last = int(last_je_manual["entry_number"].replace("JE-", ""))
            je_m_next = je_m_last + 1
        except:
            je_m_next = 10001
    else:
        je_m_next = 10001
    if je_m_next < 10001:
        je_m_next = 10001
    entry_number = f"JE-{je_m_next:05d}"
    
    user_doc = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    created_by = user_doc.get("name", current_user.get("username", "")) if user_doc else ""
    
    branch_id = entry.branch_id if current_user.get("is_admin") else current_user.get("branch_id")
    
    entry_doc = {
        "id": entry_id,
        "entry_number": entry_number,
        "entry_date": entry.entry_date,
        "journal_type": entry.journal_type,
        "reference_type": entry.reference_type,
        "reference_id": entry.reference_id,
        "reference_number": entry.reference_number,
        "lines": [line.model_dump() for line in entry.lines],
        "total_debit": round(total_debit, 2),
        "total_credit": round(total_credit, 2),
        "is_balanced": True,
        "notes": entry.notes,
        "branch_id": branch_id,
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "posted"
    }
    
    await db.journal_entries.insert_one(entry_doc)
    return {k: v for k, v in entry_doc.items() if k != "_id"}

@api_router.delete("/journal-entries/{entry_id}")
async def delete_journal_entry(entry_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a journal entry (admin only, and only if not linked to transactions)"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    entry = await db.journal_entries.find_one({"id": entry_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    
    # Check if linked to a transaction
    if entry.get("reference_type") and entry.get("reference_id"):
        raise HTTPException(status_code=400, detail="لا يمكن حذف قيد مرتبط بعملية")
    
    await db.journal_entries.delete_one({"id": entry_id})
    return {"message": "تم حذف القيد المحاسبي"}

@api_router.put("/journal-entries/{entry_id}")
async def update_journal_entry(entry_id: str, entry: JournalEntryCreate, current_user: dict = Depends(get_current_user)):
    """Update a journal entry (only manual entries can be edited)"""
    existing = await db.journal_entries.find_one({"id": entry_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    
    # Check if linked to automatic transactions (cannot edit auto-generated entries)
    if existing.get("reference_type") and existing.get("reference_id"):
        raise HTTPException(status_code=400, detail="لا يمكن تعديل قيد مرتبط بعملية آلية")
    
    # Validate debit = credit
    total_debit = sum(line.debit for line in entry.lines)
    total_credit = sum(line.credit for line in entry.lines)
    if abs(total_debit - total_credit) > 0.01:
        raise HTTPException(status_code=400, detail="القيد غير متوازن - المدين يجب أن يساوي الدائن")
    
    branch_id = entry.branch_id if current_user.get("is_admin") else current_user.get("branch_id")
    
    # Prepare lines with account info
    lines_data = []
    for line in entry.lines:
        account = await db.accounts.find_one({"id": line.account_id}, {"_id": 0})
        if account:
            lines_data.append({
                "account_id": line.account_id,
                "account_code": account.get("code", ""),
                "account_name": account.get("name_ar", ""),
                "debit": line.debit,
                "credit": line.credit,
                "description": line.description
            })
    
    update_data = {
        "entry_date": entry.entry_date,
        "description": entry.description,
        "reference_number": entry.reference_number,
        "journal_type": entry.journal_type,
        "lines": lines_data,
        "total_debit": round(total_debit, 2),
        "total_credit": round(total_credit, 2),
        "branch_id": branch_id,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.journal_entries.update_one({"id": entry_id}, {"$set": update_data})
    
    updated = await db.journal_entries.find_one({"id": entry_id}, {"_id": 0})
    return updated

# ============ ACCOUNTING REPORTS ============

@api_router.get("/reports/journal-entries")
async def get_journal_entries_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    journal_type: Optional[str] = None,
    account_id: Optional[str] = None,
    supplier_id: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get journal entries report with totals"""
    query = {"status": "posted"}
    
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not current_user.get("is_admin") and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
    if start_date:
        query["entry_date"] = {"$gte": start_date}
    if end_date:
        if "entry_date" in query:
            query["entry_date"]["$lte"] = end_date
        else:
            query["entry_date"] = {"$lte": end_date}
    if journal_type:
        query["journal_type"] = journal_type
    if account_id:
        query["lines.account_id"] = account_id
    if supplier_id:
        query["lines.party_id"] = supplier_id
    
    entries = await db.journal_entries.find(query, {"_id": 0}).sort("entry_date", 1).to_list(1000)
    
    total_debit = sum(e["total_debit"] for e in entries)
    total_credit = sum(e["total_credit"] for e in entries)
    
    return {
        "entries": entries,
        "summary": {
            "total_debit": round(total_debit, 2),
            "total_credit": round(total_credit, 2),
            "entries_count": len(entries),
            "is_balanced": round(total_debit, 2) == round(total_credit, 2)
        }
    }

@api_router.get("/reports/suppliers-balance")
async def get_suppliers_balance_report(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get suppliers balance report"""
    query = {}
    
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not current_user.get("is_admin") and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
    suppliers = await db.suppliers.find(query, {"_id": 0}).to_list(1000)
    
    total_purchases = sum(s.get("total_purchases", 0) for s in suppliers)
    total_paid = sum(s.get("total_paid", 0) for s in suppliers)
    total_balance = sum(s.get("balance", 0) for s in suppliers)
    
    return {
        "suppliers": suppliers,
        "summary": {
            "total_purchases": round(total_purchases, 2),
            "total_paid": round(total_paid, 2),
            "total_balance": round(total_balance, 2),
            "suppliers_count": len(suppliers)
        }
    }

@api_router.get("/reports/purchases")
async def get_purchases_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    supplier_id: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get purchases report"""
    query = {}
    
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not current_user.get("is_admin") and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
    if start_date:
        query["invoice_date"] = {"$gte": start_date}
    if end_date:
        if "invoice_date" in query:
            query["invoice_date"]["$lte"] = end_date
        else:
            query["invoice_date"] = {"$lte": end_date}
    if supplier_id:
        query["supplier_id"] = supplier_id
    
    invoices = await db.purchase_invoices.find(query, {"_id": 0}).sort("invoice_date", -1).to_list(1000)
    
    total_subtotal = sum(inv.get("subtotal", 0) for inv in invoices)
    total_tax = sum(inv.get("tax_amount", 0) for inv in invoices)
    total_amount = sum(inv.get("total", 0) for inv in invoices)
    total_paid = sum(inv.get("paid_amount", 0) for inv in invoices)
    total_remaining = sum(inv.get("remaining_amount", 0) for inv in invoices)
    
    return {
        "invoices": invoices,
        "summary": {
            "total_subtotal": round(total_subtotal, 2),
            "total_tax": round(total_tax, 2),
            "total_amount": round(total_amount, 2),
            "total_paid": round(total_paid, 2),
            "total_remaining": round(total_remaining, 2),
            "invoices_count": len(invoices)
        }
    }

# ============ VAT REPORT ============

@api_router.get("/reports/vat")
async def get_vat_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get VAT declaration report - إقرار ضريبة القيمة المضافة"""
    query_sales = {"status": "paid"}
    query_purchases = {}
    
    if branch_filter and branch_filter != "all":
        query_sales["branch_id"] = branch_filter
        query_purchases["branch_id"] = branch_filter
    elif not current_user.get("is_admin") and current_user.get("branch_id"):
        query_sales["branch_id"] = current_user["branch_id"]
        query_purchases["branch_id"] = current_user["branch_id"]
    
    if start_date:
        query_sales["paid_at"] = {"$gte": start_date}
        query_purchases["invoice_date"] = {"$gte": start_date}
    if end_date:
        if "paid_at" in query_sales:
            query_sales["paid_at"]["$lte"] = end_date
        else:
            query_sales["paid_at"] = {"$lte": end_date}
        if "invoice_date" in query_purchases:
            query_purchases["invoice_date"]["$lte"] = end_date
        else:
            query_purchases["invoice_date"] = {"$lte": end_date}
    
    # Get sales invoices (فواتير المبيعات)
    sales_invoices = await db.invoices.find(query_sales, {"_id": 0}).to_list(10000)
    
    # Get purchase invoices (فواتير المشتريات)
    purchase_invoices = await db.purchase_invoices.find(query_purchases, {"_id": 0}).to_list(10000)
    
    # Calculate sales VAT (ضريبة المخرجات)
    sales_subtotal = sum(inv.get("subtotal", 0) for inv in sales_invoices)
    output_vat = sum(inv.get("vat_amount", 0) for inv in sales_invoices)
    
    # Calculate purchases VAT (ضريبة المدخلات)
    purchases_subtotal = sum(inv.get("subtotal", 0) for inv in purchase_invoices)
    input_vat = sum(inv.get("tax_amount", 0) for inv in purchase_invoices)
    
    # Net VAT (صافي الضريبة المستحقة)
    net_vat = output_vat - input_vat
    
    return {
        "period": {
            "start_date": start_date or "الكل",
            "end_date": end_date or "الآن"
        },
        "sales": {
            "subtotal": round(sales_subtotal, 2),
            "vat_amount": round(output_vat, 2),
            "total": round(sales_subtotal + output_vat, 2),
            "invoices_count": len(sales_invoices)
        },
        "purchases": {
            "subtotal": round(purchases_subtotal, 2),
            "vat_amount": round(input_vat, 2),
            "total": round(purchases_subtotal + input_vat, 2),
            "invoices_count": len(purchase_invoices)
        },
        "vat_summary": {
            "output_vat": round(output_vat, 2),  # ضريبة المخرجات (على المبيعات)
            "input_vat": round(input_vat, 2),    # ضريبة المدخلات (على المشتريات)
            "net_vat": round(net_vat, 2),        # صافي الضريبة المستحقة
            "vat_status": "مستحقة للهيئة" if net_vat > 0 else "مستحقة للمنشأة" if net_vat < 0 else "صفر"
        },
        "company_info": {
            "name": "شركة اداء الابطال العالمية للرياضة",
            "tax_number": COMPANY_TAX_NUMBER,
            "commercial_reg": COMPANY_COMMERCIAL_REG
        }
    }

# ============ SALES REPORT ============

@api_router.get("/reports/sales")
async def get_sales_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    activity_id: Optional[str] = None,
    payment_method: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get sales report - تقرير فواتير المبيعات"""
    query = {"status": "paid"}
    
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not current_user.get("is_admin") and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
    if start_date:
        query["paid_at"] = {"$gte": start_date}
    if end_date:
        if "paid_at" in query:
            query["paid_at"]["$lte"] = end_date
        else:
            query["paid_at"] = {"$lte": end_date}
    if activity_id:
        query["items.activity_id"] = activity_id
    if payment_method:
        query["payment_method"] = payment_method
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("paid_at", -1).to_list(10000)
    
    # Calculate totals
    total_subtotal = sum(inv.get("subtotal", 0) for inv in invoices)
    total_discount = sum(inv.get("discount", 0) for inv in invoices)
    total_vat = sum(inv.get("vat_amount", 0) for inv in invoices)
    total_amount = sum(inv.get("total", 0) for inv in invoices)
    
    # Group by payment method
    by_payment_method = {}
    for inv in invoices:
        pm = inv.get("payment_method", "غير محدد")
        if pm not in by_payment_method:
            by_payment_method[pm] = {"count": 0, "total": 0}
        by_payment_method[pm]["count"] += 1
        by_payment_method[pm]["total"] += inv.get("total", 0)
    
    # Group by activity
    by_activity = {}
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("is_product"):
                continue
            act_name = item.get("activity_name", "غير محدد")
            if act_name not in by_activity:
                by_activity[act_name] = {"count": 0, "total": 0}
            by_activity[act_name]["count"] += 1
            by_activity[act_name]["total"] += item.get("fee", 0)
    
    return {
        "invoices": invoices,
        "summary": {
            "total_subtotal": round(total_subtotal, 2),
            "total_discount": round(total_discount, 2),
            "total_vat": round(total_vat, 2),
            "total_amount": round(total_amount, 2),
            "invoices_count": len(invoices)
        },
        "by_payment_method": by_payment_method,
        "by_activity": by_activity
    }

# ============ EXPORT ACCOUNTING REPORTS ============

@api_router.get("/export/sales")
async def export_sales_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    format: str = "xlsx",
    token: Optional[str] = None
):
    """Export sales report to Excel"""
    _require_export_admin_token(token)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        _enforce_tenant_match_local(jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM]))
    except:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    query = {"status": "paid"}
    if start_date:
        query["paid_at"] = {"$gte": start_date}
    if end_date:
        if "paid_at" in query:
            query["paid_at"]["$lte"] = end_date
        else:
            query["paid_at"] = {"$lte": end_date}
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("paid_at", -1).to_list(10000)
    
    xl = _get_openpyxl()
    Workbook = xl.Workbook; Font = xl.Font; PatternFill = xl.PatternFill; Border = xl.Border; Side = xl.Side; Alignment = xl.Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = "تقرير المبيعات"
    
    header_fill = PatternFill(start_color="10B981", end_color="10B981", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    title_font = Font(bold=True, size=14)
    thin_border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
    
    # Title
    ws.merge_cells('A1:H1')
    ws.cell(row=1, column=1, value="تقرير فواتير المبيعات - شركة اداء الابطال العالمية للرياضة").font = title_font
    ws.cell(row=2, column=1, value=f"الفترة: {start_date or 'الكل'} إلى {end_date or 'الآن'}")
    
    # Summary
    total_subtotal = sum(inv.get("subtotal", 0) for inv in invoices)
    total_vat = sum(inv.get("vat_amount", 0) for inv in invoices)
    total_amount = sum(inv.get("total", 0) for inv in invoices)
    
    ws.cell(row=4, column=1, value="ملخص التقرير").font = Font(bold=True, size=12)
    ws.cell(row=5, column=1, value="عدد الفواتير:")
    ws.cell(row=5, column=2, value=len(invoices))
    ws.cell(row=6, column=1, value="المجموع الفرعي:")
    ws.cell(row=6, column=2, value=f"{total_subtotal:,.2f} ر.س")
    ws.cell(row=7, column=1, value="ضريبة القيمة المضافة:")
    ws.cell(row=7, column=2, value=f"{total_vat:,.2f} ر.س")
    ws.cell(row=8, column=1, value="الإجمالي:").font = Font(bold=True)
    ws.cell(row=8, column=2, value=f"{total_amount:,.2f} ر.س").font = Font(bold=True)
    
    # Headers
    headers = ["م", "رقم الفاتورة", "اسم العميل", "الجوال", "المجموع الفرعي", "الضريبة", "الإجمالي", "طريقة الدفع", "التاريخ"]
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=10, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.border = thin_border
        cell.alignment = Alignment(horizontal='center')
    
    # Data
    for idx, inv in enumerate(invoices, 1):
        row = 10 + idx
        ws.cell(row=row, column=1, value=idx).border = thin_border
        ws.cell(row=row, column=2, value=inv.get("invoice_number", "")).border = thin_border
        ws.cell(row=row, column=3, value=inv.get("customer_name_ar") or inv.get("member_name", "")).border = thin_border
        ws.cell(row=row, column=4, value=inv.get("customer_phone", "")).border = thin_border
        ws.cell(row=row, column=5, value=inv.get("subtotal", 0)).border = thin_border
        ws.cell(row=row, column=6, value=inv.get("vat_amount", 0)).border = thin_border
        ws.cell(row=row, column=7, value=inv.get("total", 0)).border = thin_border
        ws.cell(row=row, column=8, value=inv.get("payment_method", "")).border = thin_border
        ws.cell(row=row, column=9, value=inv.get("paid_at", "")[:10] if inv.get("paid_at") else "").border = thin_border
    
    # Adjust column widths
    ws.column_dimensions['A'].width = 6
    ws.column_dimensions['B'].width = 15
    ws.column_dimensions['C'].width = 25
    ws.column_dimensions['D'].width = 15
    ws.column_dimensions['E'].width = 15
    ws.column_dimensions['F'].width = 12
    ws.column_dimensions['G'].width = 15
    ws.column_dimensions['H'].width = 15
    ws.column_dimensions['I'].width = 12
    
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"sales_report_{start_date or 'all'}_{end_date or 'now'}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@api_router.get("/export/purchases")
async def export_purchases_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    format: str = "xlsx",
    token: Optional[str] = None
):
    """Export purchases report to Excel"""
    _require_export_admin_token(token)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        _enforce_tenant_match_local(jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM]))
    except:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    query = {}
    if start_date:
        query["invoice_date"] = {"$gte": start_date}
    if end_date:
        if "invoice_date" in query:
            query["invoice_date"]["$lte"] = end_date
        else:
            query["invoice_date"] = {"$lte": end_date}
    
    invoices = await db.purchase_invoices.find(query, {"_id": 0}).sort("invoice_date", -1).to_list(10000)
    
    xl = _get_openpyxl()
    Workbook = xl.Workbook; Font = xl.Font; PatternFill = xl.PatternFill; Border = xl.Border; Side = xl.Side; Alignment = xl.Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = "تقرير المشتريات"
    
    header_fill = PatternFill(start_color="3B82F6", end_color="3B82F6", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    title_font = Font(bold=True, size=14)
    thin_border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
    
    # Title
    ws.merge_cells('A1:I1')
    ws.cell(row=1, column=1, value="تقرير فواتير المشتريات - شركة اداء الابطال العالمية للرياضة").font = title_font
    ws.cell(row=2, column=1, value=f"الفترة: {start_date or 'الكل'} إلى {end_date or 'الآن'}")
    
    # Summary
    total_subtotal = sum(inv.get("subtotal", 0) for inv in invoices)
    total_tax = sum(inv.get("tax_amount", 0) for inv in invoices)
    total_amount = sum(inv.get("total", 0) for inv in invoices)
    total_paid = sum(inv.get("paid_amount", 0) for inv in invoices)
    total_remaining = sum(inv.get("remaining_amount", 0) for inv in invoices)
    
    ws.cell(row=4, column=1, value="ملخص التقرير").font = Font(bold=True, size=12)
    ws.cell(row=5, column=1, value="عدد الفواتير:")
    ws.cell(row=5, column=2, value=len(invoices))
    ws.cell(row=6, column=1, value="المجموع الفرعي:")
    ws.cell(row=6, column=2, value=f"{total_subtotal:,.2f} ر.س")
    ws.cell(row=7, column=1, value="ضريبة القيمة المضافة:")
    ws.cell(row=7, column=2, value=f"{total_tax:,.2f} ر.س")
    ws.cell(row=8, column=1, value="الإجمالي:").font = Font(bold=True)
    ws.cell(row=8, column=2, value=f"{total_amount:,.2f} ر.س").font = Font(bold=True)
    ws.cell(row=9, column=1, value="المدفوع:")
    ws.cell(row=9, column=2, value=f"{total_paid:,.2f} ر.س")
    ws.cell(row=10, column=1, value="المستحق:").font = Font(bold=True, color="FF0000")
    ws.cell(row=10, column=2, value=f"{total_remaining:,.2f} ر.س").font = Font(bold=True, color="FF0000")
    
    # Headers
    headers = ["م", "رقم الفاتورة", "المورد", "رقم فاتورة المورد", "المجموع الفرعي", "الضريبة", "الإجمالي", "المدفوع", "المستحق", "الحالة", "التاريخ"]
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=12, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.border = thin_border
        cell.alignment = Alignment(horizontal='center')
    
    # Data
    status_map = {"pending": "معلقة", "partial": "جزئي", "paid": "مدفوعة"}
    for idx, inv in enumerate(invoices, 1):
        row = 12 + idx
        ws.cell(row=row, column=1, value=idx).border = thin_border
        ws.cell(row=row, column=2, value=inv.get("invoice_number", "")).border = thin_border
        ws.cell(row=row, column=3, value=inv.get("supplier_name", "")).border = thin_border
        ws.cell(row=row, column=4, value=inv.get("supplier_invoice_number", "")).border = thin_border
        ws.cell(row=row, column=5, value=inv.get("subtotal", 0)).border = thin_border
        ws.cell(row=row, column=6, value=inv.get("tax_amount", 0)).border = thin_border
        ws.cell(row=row, column=7, value=inv.get("total", 0)).border = thin_border
        ws.cell(row=row, column=8, value=inv.get("paid_amount", 0)).border = thin_border
        ws.cell(row=row, column=9, value=inv.get("remaining_amount", 0)).border = thin_border
        ws.cell(row=row, column=10, value=status_map.get(inv.get("status", ""), inv.get("status", ""))).border = thin_border
        ws.cell(row=row, column=11, value=inv.get("invoice_date", "")).border = thin_border
    
    # Adjust column widths
    for col in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']:
        ws.column_dimensions[col].width = 15
    ws.column_dimensions['A'].width = 6
    ws.column_dimensions['C'].width = 25
    
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"purchases_report_{start_date or 'all'}_{end_date or 'now'}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@api_router.get("/export/vat")
async def export_vat_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    format: str = "xlsx",
    token: Optional[str] = None
):
    """Export VAT declaration report to Excel"""
    _require_export_admin_token(token)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        _enforce_tenant_match_local(jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM]))
    except:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    query_sales = {"status": "paid"}
    query_purchases = {}
    
    if start_date:
        query_sales["paid_at"] = {"$gte": start_date}
        query_purchases["invoice_date"] = {"$gte": start_date}
    if end_date:
        if "paid_at" in query_sales:
            query_sales["paid_at"]["$lte"] = end_date
        else:
            query_sales["paid_at"] = {"$lte": end_date}
        if "invoice_date" in query_purchases:
            query_purchases["invoice_date"]["$lte"] = end_date
        else:
            query_purchases["invoice_date"] = {"$lte": end_date}
    
    sales_invoices = await db.invoices.find(query_sales, {"_id": 0}).to_list(10000)
    purchase_invoices = await db.purchase_invoices.find(query_purchases, {"_id": 0}).to_list(10000)
    
    # Calculate
    sales_subtotal = sum(inv.get("subtotal", 0) for inv in sales_invoices)
    output_vat = sum(inv.get("vat_amount", 0) for inv in sales_invoices)
    purchases_subtotal = sum(inv.get("subtotal", 0) for inv in purchase_invoices)
    input_vat = sum(inv.get("tax_amount", 0) for inv in purchase_invoices)
    net_vat = output_vat - input_vat
    
    xl = _get_openpyxl()
    Workbook = xl.Workbook; Font = xl.Font; PatternFill = xl.PatternFill; Border = xl.Border; Side = xl.Side; Alignment = xl.Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = "إقرار الضريبة"
    
    header_fill = PatternFill(start_color="7C3AED", end_color="7C3AED", fill_type="solid")
    green_fill = PatternFill(start_color="10B981", end_color="10B981", fill_type="solid")
    blue_fill = PatternFill(start_color="3B82F6", end_color="3B82F6", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    title_font = Font(bold=True, size=16)
    subtitle_font = Font(bold=True, size=12)
    thin_border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
    
    # Title
    ws.merge_cells('A1:D1')
    ws.cell(row=1, column=1, value="إقرار ضريبة القيمة المضافة").font = title_font
    ws.cell(row=2, column=1, value="شركة اداء الابطال العالمية للرياضة")
    ws.cell(row=3, column=1, value=f"الرقم الضريبي: {COMPANY_TAX_NUMBER}")
    ws.cell(row=4, column=1, value=f"الفترة: {start_date or 'الكل'} إلى {end_date or 'الآن'}")
    
    # Sales Section
    ws.merge_cells('A6:D6')
    cell = ws.cell(row=6, column=1, value="المبيعات (ضريبة المخرجات)")
    cell.fill = green_fill
    cell.font = header_font
    
    ws.cell(row=7, column=1, value="البيان").font = Font(bold=True)
    ws.cell(row=7, column=2, value="المبلغ (ر.س)").font = Font(bold=True)
    
    ws.cell(row=8, column=1, value="إجمالي المبيعات (قبل الضريبة):")
    ws.cell(row=8, column=2, value=f"{sales_subtotal:,.2f}")
    ws.cell(row=9, column=1, value="ضريبة المخرجات (15%):")
    ws.cell(row=9, column=2, value=f"{output_vat:,.2f}")
    ws.cell(row=10, column=1, value="عدد الفواتير:")
    ws.cell(row=10, column=2, value=len(sales_invoices))
    
    # Purchases Section
    ws.merge_cells('A12:D12')
    cell = ws.cell(row=12, column=1, value="المشتريات (ضريبة المدخلات)")
    cell.fill = blue_fill
    cell.font = header_font
    
    ws.cell(row=13, column=1, value="البيان").font = Font(bold=True)
    ws.cell(row=13, column=2, value="المبلغ (ر.س)").font = Font(bold=True)
    
    ws.cell(row=14, column=1, value="إجمالي المشتريات (قبل الضريبة):")
    ws.cell(row=14, column=2, value=f"{purchases_subtotal:,.2f}")
    ws.cell(row=15, column=1, value="ضريبة المدخلات (15%):")
    ws.cell(row=15, column=2, value=f"{input_vat:,.2f}")
    ws.cell(row=16, column=1, value="عدد الفواتير:")
    ws.cell(row=16, column=2, value=len(purchase_invoices))
    
    # Summary Section
    ws.merge_cells('A18:D18')
    cell = ws.cell(row=18, column=1, value="ملخص الإقرار الضريبي")
    cell.fill = header_fill
    cell.font = header_font
    
    ws.cell(row=19, column=1, value="ضريبة المخرجات (على المبيعات):").font = Font(bold=True)
    ws.cell(row=19, column=2, value=f"{output_vat:,.2f}")
    ws.cell(row=20, column=1, value="ضريبة المدخلات (على المشتريات):").font = Font(bold=True)
    ws.cell(row=20, column=2, value=f"({input_vat:,.2f})")
    
    ws.cell(row=22, column=1, value="صافي الضريبة المستحقة:").font = Font(bold=True, size=14)
    ws.cell(row=22, column=2, value=f"{net_vat:,.2f} ر.س").font = Font(bold=True, size=14, color="FF0000" if net_vat > 0 else "10B981")
    
    status_text = "مستحقة للهيئة (يجب السداد)" if net_vat > 0 else "رصيد لصالح المنشأة" if net_vat < 0 else "صفر"
    ws.cell(row=23, column=1, value="الحالة:")
    ws.cell(row=23, column=2, value=status_text)
    
    # Column widths
    ws.column_dimensions['A'].width = 35
    ws.column_dimensions['B'].width = 20
    ws.column_dimensions['C'].width = 15
    ws.column_dimensions['D'].width = 15
    
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"vat_report_{start_date or 'all'}_{end_date or 'now'}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# ============ COACH RATINGS (ADMIN) ============

@api_router.get("/coach-ratings")
async def get_all_coach_ratings(
    coach_id: Optional[str] = None,
    _: dict = Depends(get_current_user)
):
    """Get all coach ratings for admin dashboard"""
    query = {}
    if coach_id:
        query["coach_id"] = coach_id
    
    ratings = await db.coach_ratings.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)

    # Collect unique IDs for bulk lookups
    coach_ids = {r.get("coach_id") for r in ratings if r.get("coach_id")}
    activity_ids = {r.get("activity_id") for r in ratings if r.get("activity_id")}
    member_ids = {r.get("member_id") for r in ratings if r.get("member_id")}

    # Bulk fetch
    coaches_map = {
        c["id"]: c
        async for c in db.coaches.find(
            {"id": {"$in": list(coach_ids)}}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1}
        )
    } if coach_ids else {}
    activities_map = {
        a["id"]: a
        async for a in db.activities.find(
            {"id": {"$in": list(activity_ids)}}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1}
        )
    } if activity_ids else {}
    members_map = {
        m["id"]: m
        async for m in db.members.find(
            {"id": {"$in": list(member_ids)}}, {"_id": 0, "id": 1, "photo": 1}
        )
    } if member_ids else {}

    # Enrich with coach, activity names, and member photo
    for rating in ratings:
        coach = coaches_map.get(rating.get("coach_id"))
        if coach:
            rating["coach_name"] = coach.get("name_ar") or coach.get("name")

        activity = activities_map.get(rating.get("activity_id"))
        if activity:
            rating["activity_name"] = activity.get("name_ar") or activity.get("name")

        member = members_map.get(rating.get("member_id"))
        if member:
            rating["member_photo"] = member.get("photo", "")

    return {"ratings": ratings}


@api_router.get("/coach-ratings/stats")
async def get_coach_ratings_stats(_: dict = Depends(get_current_user)):
    """Get coach ratings statistics"""
    ratings = await db.coach_ratings.find({}, {"_id": 0}).to_list(1000)
    
    # Calculate stats per coach
    coach_stats = {}
    for rating in ratings:
        coach_id = rating.get("coach_id")
        if coach_id not in coach_stats:
            coach_stats[coach_id] = {
                "total_ratings": 0,
                "sum_ratings": 0,
                "comments_count": 0
            }
        coach_stats[coach_id]["total_ratings"] += 1
        coach_stats[coach_id]["sum_ratings"] += rating.get("rating", 0)
        if rating.get("comment"):
            coach_stats[coach_id]["comments_count"] += 1
    
    # Calculate averages and enrich with coach names
    result = []
    for coach_id, stats in coach_stats.items():
        coach = await db.coaches.find_one({"id": coach_id}, {"_id": 0, "name": 1, "name_ar": 1})
        if coach:
            avg = stats["sum_ratings"] / stats["total_ratings"] if stats["total_ratings"] > 0 else 0
            result.append({
                "coach_id": coach_id,
                "coach_name": coach.get("name_ar") or coach.get("name"),
                "total_ratings": stats["total_ratings"],
                "average_rating": round(avg, 1),
                "comments_count": stats["comments_count"]
            })
    
    # Sort by average rating descending
    result.sort(key=lambda x: x["average_rating"], reverse=True)
    
    return {
        "coaches": result,
        "total_ratings": len(ratings)
    }


@api_router.delete("/coach-ratings/{rating_id}")
async def delete_coach_rating(rating_id: str, _: dict = Depends(get_current_user)):
    """Delete a coach rating"""
    result = await db.coach_ratings.delete_one({"id": rating_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rating not found")
    return {"message": "تم حذف التقييم بنجاح"}


@api_router.post("/admin/fix-member-branches")
async def fix_member_branches(current_user: dict = Depends(get_current_user)):
    """Fix: assign branch_id to members based on their registration forms (overwrites mismatched branches)"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admins only")
    fixed = 0
    skipped = 0
    forms = []
    details = []
    try:
        forms = await db.registration_forms.find(
            {"branch_id": {"$exists": True}, "member_id": {"$exists": True}},
            {"_id": 0, "branch_id": 1, "member_id": 1, "form_number": 1, "member_code": 1}
        ).to_list(10000)
        for frm in forms:
            bid = frm.get("branch_id")
            mid = frm.get("member_id")
            if not bid or not mid:
                skipped += 1
                continue
            member = await db.members.find_one({"id": mid}, {"_id": 0, "branch_id": 1, "name_ar": 1, "member_code": 1})
            if not member:
                skipped += 1
                continue
            current_branch = member.get("branch_id", "")
            if current_branch != bid:
                await db.members.update_one({"id": mid}, {"$set": {"branch_id": bid}})
                fixed += 1
                details.append({"form": frm.get("form_number"), "member_code": member.get("member_code"), "old_branch": current_branch, "new_branch": bid})
            else:
                skipped += 1
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"fixed": fixed, "skipped": skipped, "total_forms": len(forms), "details": details}


# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# GZip compression for JSON responses (compresses 70-85% on large payloads
# such as members/invoices lists). minimum_size avoids overhead on tiny responses.
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(TenantMiddleware)

# Serve React static files in production
STATIC_DIR = ROOT_DIR / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR / "static")), name="static_assets")

    @app.get("/api/download-apk")
    async def download_android_project():
        # Try latest version first, then fall back to older files
        for fname in ["android_v1.0.11.zip", "android-project.zip"]:
            zip_path = STATIC_DIR / fname
            if zip_path.exists():
                return FileResponse(
                    str(zip_path),
                    media_type="application/zip",
                    filename=fname,
                    headers={"Content-Disposition": f"attachment; filename={fname}"}
                )
        return {"error": "File not found"}


    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            if full_path.endswith('.zip'):
                return FileResponse(file_path, media_type="application/zip", filename=file_path.name)
            return FileResponse(file_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

@app.on_event("startup")
async def create_default_admin():
    import asyncio
    async def _init():
        try:
            from control_db import ensure_default_tenant, backfill_billing_fields, backfill_onboarding_completed, auto_suspend_expired
            await ensure_default_tenant()
            await backfill_billing_fields()
            await backfill_onboarding_completed()
            n = await auto_suspend_expired()
            if n:
                print(f"Auto-suspended {n} expired tenants on startup")
        except Exception as e:
            print(f"Tenant seed error: {str(e)}")

        async def _expiry_scanner():
            while True:
                try:
                    await asyncio.sleep(3600)
                    from control_db import auto_suspend_expired as _a
                    n2 = await _a()
                    if n2:
                        print(f"Auto-suspended {n2} expired tenants (scheduler)")
                except Exception as ex:
                    print(f"Expiry scanner error: {ex}")
        asyncio.create_task(_expiry_scanner())
        try:
            from db_indexes import ensure_indexes
            await ensure_indexes()
        except Exception as e:
            print(f"Index creation error: {str(e)}")
        try:
            from control_db import control_db as _ctrl
            from utils.prefix_gen import (
                pick_unique_academy_prefix,
                pick_unique_branch_prefix,
                update_with_unique_prefix,
            )
            from utils.tenant import set_current_tenant, reset_current_tenant, list_active_tenants
            tenants = await list_active_tenants()
            filled_acad = 0
            filled_branch = 0
            for t in tenants:
                full = await _ctrl.tenants.find_one({"id": t.get("id")}, {"_id": 0})
                if not full:
                    continue
                if not (full.get("academy_prefix") or "").strip():
                    slug_v = full.get("slug") or ""
                    name_v = full.get("name") or ""
                    new_acad = await update_with_unique_prefix(
                        _ctrl.tenants,
                        {"id": full["id"]},
                        "academy_prefix",
                        lambda s=slug_v, n=name_v: pick_unique_academy_prefix(slug=s, name=n),
                    )
                    full["academy_prefix"] = new_acad
                    filled_acad += 1
                token = set_current_tenant(full)
                try:
                    try:
                        await db.branches.create_index(
                            "code_prefix",
                            unique=True,
                            partialFilterExpression={"code_prefix": {"$type": "string", "$gt": ""}},
                            name="uniq_code_prefix",
                            background=True,
                        )
                    except Exception:
                        pass
                    cursor = db.branches.find(
                        {"$or": [{"code_prefix": {"$exists": False}}, {"code_prefix": ""}, {"code_prefix": None}]},
                        {"_id": 0, "id": 1, "name": 1, "name_ar": 1},
                    )
                    async for br in cursor:
                        br_id = br.get("id")
                        nl = br.get("name") or ""
                        na = br.get("name_ar") or ""
                        await update_with_unique_prefix(
                            db.branches,
                            {"id": br_id},
                            "code_prefix",
                            lambda l=nl, a=na, eid=br_id: pick_unique_branch_prefix(
                                name_latin=l, name_ar=a, exclude_id=eid,
                            ),
                        )
                        filled_branch += 1
                finally:
                    reset_current_tenant(token)
            if filled_acad or filled_branch:
                print(f"Prefix backfill: {filled_acad} academies, {filled_branch} branches updated")
        except Exception as e:
            print(f"Prefix backfill error: {str(e)}")
        try:
            users_count = await db.users.count_documents({})
            if users_count == 0:
                hashed_password = bcrypt.hashpw("123456".encode('utf-8'), bcrypt.gensalt())
                admin_user = {
                    "id": str(uuid.uuid4()),
                    "username": "admin",
                    "password": hashed_password.decode('utf-8'),
                    "name": "مدير النظام",
                    "name_en": "System Admin", 
                    "role": "admin",
                    "is_admin": True,
                    "branch_id": None,
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                await db.users.insert_one(admin_user)
                print("Admin created: admin / 123456")
        except Exception as e:
            print(f"Startup DB check: {str(e)}")
        # Fix attendance records missing the status field
        try:
            result = await db.attendance.update_many(
                {"status": {"$exists": False}},
                {"$set": {"status": "present"}}
            )
            if result.modified_count:
                print(f"Migration: fixed {result.modified_count} attendance records missing status field")
        except Exception as e:
            print(f"Attendance migration error: {str(e)}")
        # Fix members with no branch: assign branch from their registration form
        try:
            forms_with_branch = await db.registration_forms.find(
                {"branch_id": {"$exists": True, "$ne": None, "$ne": ""}, "member_id": {"$exists": True, "$ne": None}},
                {"_id": 0, "branch_id": 1, "member_id": 1}
            ).to_list(10000)
            fixed_count = 0
            for frm in forms_with_branch:
                result2 = await db.members.update_one(
                    {"id": frm["member_id"], "$or": [{"branch_id": {"$exists": False}}, {"branch_id": None}, {"branch_id": ""}]},
                    {"$set": {"branch_id": frm["branch_id"]}}
                )
                if result2.modified_count:
                    fixed_count += 1
            if fixed_count:
                print(f"Migration: assigned branch to {fixed_count} members from their registration forms")
        except Exception as e:
            print(f"Member branch migration error: {str(e)}")
        # Backup ad images from disk to MongoDB (so they survive restarts)
        try:
            import base64
            ads_dir = ROOT_DIR / "uploads" / "ads"
            if ads_dir.exists():
                backed_up = 0
                for img_file in ads_dir.iterdir():
                    if img_file.is_file():
                        existing = await db.ad_images.find_one({"filename": img_file.name})
                        if not existing:
                            ext = img_file.suffix.lower()
                            ct = "image/png" if ext == ".png" else ("image/gif" if ext == ".gif" else "image/jpeg")
                            data = base64.b64encode(img_file.read_bytes()).decode("utf-8")
                            await db.ad_images.insert_one({
                                "filename": img_file.name,
                                "data": data,
                                "content_type": ct,
                                "created_at": datetime.now(timezone.utc).isoformat()
                            })
                            backed_up += 1
                if backed_up:
                    print(f"Migration: backed up {backed_up} ad images to MongoDB")
        except Exception as e:
            print(f"Ad images backup error: {str(e)}")
        # Ensure payment vouchers unique index on voucher_number
        try:
            from routes.payment_vouchers import ensure_voucher_indexes
            await ensure_voucher_indexes()
        except Exception as e:
            print(f"Payment vouchers index setup error: {str(e)}")
    asyncio.create_task(_init())
    # Start WhatsApp scheduler
    start_whatsapp_scheduler()
    # Keep proxy alive (prevent Render free tier from sleeping)
    async def _keep_proxy_alive():
        import httpx as _httpx
        proxy_url = os.environ.get("ATLAS_BASE_URL", "").rstrip("/")
        if not proxy_url:
            return
        while True:
            await asyncio.sleep(8 * 60)  # every 8 minutes
            try:
                async with _httpx.AsyncClient(timeout=10) as c:
                    await c.get(f"{proxy_url}/health")
                    print(f"Keep-alive ping OK → {proxy_url}")
            except Exception as e:
                print(f"Keep-alive ping failed: {e}")
    asyncio.create_task(_keep_proxy_alive())
    # Start auto backup scheduler (daily at midnight Riyadh time)
    start_backup_scheduler()
    # Start ops-alerts delivery worker (drains db.ops_alerts → email/WhatsApp)
    try:
        start_ops_alerts_worker()
    except Exception as e:
        print(f"Ops alerts worker start failed: {e}")
    # Start daily renewal & ad-expiry checks scheduler
    try:
        start_daily_checks_scheduler()
    except Exception as e:
        print(f"Daily checks scheduler start failed: {e}")
    # Start tenant auto-purge scheduler (drops Mongo DB once 7-day grace ends)
    try:
        start_tenant_purge_scheduler()
    except Exception as e:
        print(f"Tenant purge scheduler start failed: {e}")
    # Start tenant auto-purge daily digest (emails super-admins ahead of drops)
    try:
        start_tenant_purge_digest_scheduler()
    except Exception as e:
        print(f"Tenant purge digest scheduler start failed: {e}")
    # Start social-insights auto-refresh scheduler (configurable from UI)
    try:
        from routes.social_publisher import start_insights_scheduler
        start_insights_scheduler()
    except Exception as e:
        print(f"Insights scheduler start failed: {e}")
    # Start daily cleanup of old social uploads (processed videos / custom logos)
    try:
        from routes.social_publisher import start_uploads_cleanup_scheduler
        start_uploads_cleanup_scheduler()
    except Exception as e:
        print(f"Social uploads cleanup scheduler start failed: {e}")

    async def _backfill_freeze_extensions_one_tenant(tenant: dict):
        from routes.day_extensions import extend_freezes_for_closure
        from database import db as tdb
        cursor = tdb.closures.find({
            "applied": True,
            "$or": [{"freezes_extended": {"$exists": False}}, {"freezes_extended": False}],
        })
        total = 0
        async for cl in cursor:
            cl.pop("_id", None)
            affected = cl.get("affected_members") or []
            member_ids = [a.get("member_id", "") for a in affected if a.get("member_id")]
            if not member_ids:
                await tdb.closures.update_one(
                    {"id": cl.get("id")},
                    {"$set": {"freezes_extended": True, "freezes_extended_count": 0}}
                )
                continue
            try:
                res = await extend_freezes_for_closure(cl, member_ids, "system_backfill")
                total += int(res.get("extended", 0))
                await tdb.closures.update_one(
                    {"id": cl.get("id")},
                    {"$set": {"freezes_extended": True, "freezes_extended_count": int(res.get("extended", 0))}}
                )
            except Exception as _e:
                print(f"Freeze backfill failed for closure {cl.get('id')}: {_e}")
        return {"extended": total}

    async def _run_freeze_backfill_once():
        try:
            await asyncio.sleep(30)
            from utils.tenant import for_each_active_tenant
            summary = await for_each_active_tenant(
                _backfill_freeze_extensions_one_tenant,
                label="freeze-extensions-backfill",
            )
            print(f"Freeze extensions backfill: {summary.get('processed', 0)} tenants, results={summary.get('results', {})}")
        except Exception as e:
            print(f"Freeze backfill scheduler failed: {e}")

    try:
        asyncio.create_task(_run_freeze_backfill_once())
    except Exception as e:
        print(f"Freeze backfill task start failed: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    try:
        from database import _raw_client
        if _raw_client is not None and hasattr(_raw_client, "close"):
            _raw_client.close()
    except Exception as e:
        print(f"Shutdown close failed: {e}")
