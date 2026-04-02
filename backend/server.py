from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Request, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import io
import csv
import base64
import qrcode
import shutil
import subprocess
import zipfile
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
# Stripe integration disabled for external deployment
# from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest

# Import routers from routes package
from routes.users import router as users_router
from routes.levels import router as levels_router
from routes.branches import router as branches_router
from routes.activities import router as activities_router
from routes.coaches import router as coaches_router
from routes.member_portal import router as member_portal_router
from routes.members import router as members_router
from routes.invoices import router as invoices_router, set_loyalty_award_function as set_invoices_loyalty, set_loyalty_unfreeze_function as set_invoices_unfreeze
from routes.attendance import router as attendance_router, set_loyalty_award_function
from routes.notifications import router as notifications_router
from routes.bank_reports import router as bank_reports_router
from routes.advertisements import router as advertisements_router
from routes.daily_videos import router as daily_videos_router, set_loyalty_award_function as set_videos_loyalty, set_push_notify_function
from routes.loyalty import router as loyalty_router, set_database as set_loyalty_db, award_points as loyalty_award_points, unfreeze_member_points as loyalty_unfreeze_points
from routes.push_notifications import router as push_notifications_router, notify_new_video as push_notify_new_video

ROOT_DIR = Path(__file__).parent
UPLOADS_DIR = ROOT_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET_KEY', 'default_secret')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 365 * 100  # 100 years - permanent session

# Stripe Config
STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY', '')

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

# Set database for loyalty router
set_loyalty_db(db)

# Set loyalty award function for attendance router
set_loyalty_award_function(loyalty_award_points)

# Set loyalty award function for invoices router (subscription renewals)
set_invoices_loyalty(loyalty_award_points)

# Set loyalty unfreeze function for invoices router (subscription renewals)
set_invoices_unfreeze(loyalty_unfreeze_points)

# Set loyalty award function for daily videos router (video watch)
set_videos_loyalty(loyalty_award_points)

# Set push notification function for daily videos router
set_push_notify_function(push_notify_new_video)

# Member Portal router (mounted directly on app, not api_router)
app.include_router(member_portal_router)

# Mount uploads directory for serving images
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
# Also mount under /api for ingress routing
app.mount("/api/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="api_uploads")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Health check endpoint (required for Kubernetes deployment)
@app.get("/health")
async def health_check():
    """Health check endpoint for Kubernetes liveness/readiness probes"""
    return {"status": "healthy", "service": "champions-academy-api"}

@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Champions Academy API", "status": "running"}

# Download backup endpoint (legacy)
@app.get("/api/download-backup")
async def download_backup():
    """Download backup file"""
    backup_path = UPLOADS_DIR / "gcsp-academy-backup.zip"
    if backup_path.exists():
        return FileResponse(
            path=str(backup_path),
            filename="gcsp-academy-backup.zip",
            media_type="application/zip"
        )
    raise HTTPException(status_code=404, detail="Backup file not found")

# ============ BACKUP API ============

@api_router.get("/backup/code")
async def download_code_backup():
    """Download code backup (Frontend + Backend)"""
    try:
        # Create backup directory
        backup_dir = Path("/tmp/code-backup")
        if backup_dir.exists():
            shutil.rmtree(backup_dir)
        backup_dir.mkdir(parents=True)
        
        # Copy frontend (exclude node_modules and build)
        frontend_src = Path(__file__).parent.parent / "frontend"
        frontend_dst = backup_dir / "frontend"
        if frontend_src.exists():
            shutil.copytree(
                frontend_src, 
                frontend_dst,
                ignore=shutil.ignore_patterns('node_modules', 'build', '.git', '__pycache__')
            )
        
        # Copy backend (exclude __pycache__)
        backend_src = Path(__file__).parent
        backend_dst = backup_dir / "backend"
        shutil.copytree(
            backend_src, 
            backend_dst,
            ignore=shutil.ignore_patterns('__pycache__', '.git', 'uploads')
        )
        
        # Copy Docker files if they exist
        docker_files = ['Dockerfile', 'docker-compose.yml', 'railway.json']
        for f in docker_files:
            src = Path(__file__).parent.parent / f
            if src.exists():
                shutil.copy(src, backup_dir / f)
        
        # Create zip file
        zip_path = Path("/tmp/gcsp-academy-code-backup.zip")
        if zip_path.exists():
            zip_path.unlink()
            
        shutil.make_archive(
            str(zip_path).replace('.zip', ''),
            'zip',
            backup_dir
        )
        
        # Clean up
        shutil.rmtree(backup_dir)
        
        return FileResponse(
            path=str(zip_path),
            filename=f"gcsp-academy-code-backup-{datetime.now().strftime('%Y%m%d')}.zip",
            media_type="application/zip"
        )
    except Exception as e:
        logger.error(f"Code backup error: {e}")
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")

@api_router.get("/backup/database")
async def download_database_backup():
    """Download MongoDB database backup"""
    try:
        # Get MongoDB connection info
        mongo_url = os.environ.get('MONGO_URL')
        db_name = os.environ.get('DB_NAME', 'champions_academy')
        
        # Create backup directory
        backup_dir = Path("/tmp/mongodb-backup")
        if backup_dir.exists():
            shutil.rmtree(backup_dir)
        backup_dir.mkdir(parents=True)
        
        # Run mongodump
        result = subprocess.run(
            ['mongodump', '--uri', mongo_url, '--db', db_name, '--out', str(backup_dir)],
            capture_output=True,
            text=True,
            timeout=120
        )
        
        if result.returncode != 0:
            logger.error(f"mongodump error: {result.stderr}")
            raise HTTPException(status_code=500, detail="Database backup failed")
        
        # Create zip file
        zip_path = Path("/tmp/gcsp-academy-database-backup.zip")
        if zip_path.exists():
            zip_path.unlink()
            
        shutil.make_archive(
            str(zip_path).replace('.zip', ''),
            'zip',
            backup_dir
        )
        
        # Clean up
        shutil.rmtree(backup_dir)
        
        return FileResponse(
            path=str(zip_path),
            filename=f"gcsp-academy-database-backup-{datetime.now().strftime('%Y%m%d')}.zip",
            media_type="application/zip"
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Database backup timed out")
    except Exception as e:
        logger.error(f"Database backup error: {e}")
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")

@api_router.get("/backup/full")
async def download_full_backup():
    """Download full backup (Code + Database)"""
    try:
        # Create backup directory
        backup_dir = Path("/tmp/full-backup")
        if backup_dir.exists():
            shutil.rmtree(backup_dir)
        backup_dir.mkdir(parents=True)
        
        # ========== CODE BACKUP ==========
        code_dir = backup_dir / "code"
        code_dir.mkdir(parents=True)
        
        # Copy frontend (exclude node_modules and build)
        frontend_src = Path(__file__).parent.parent / "frontend"
        frontend_dst = code_dir / "frontend"
        if frontend_src.exists():
            shutil.copytree(
                frontend_src, 
                frontend_dst,
                ignore=shutil.ignore_patterns('node_modules', 'build', '.git', '__pycache__')
            )
        
        # Copy backend (exclude __pycache__)
        backend_src = Path(__file__).parent
        backend_dst = code_dir / "backend"
        shutil.copytree(
            backend_src, 
            backend_dst,
            ignore=shutil.ignore_patterns('__pycache__', '.git', 'uploads')
        )
        
        # Copy Docker files if they exist
        docker_files = ['Dockerfile', 'docker-compose.yml', 'railway.json']
        for f in docker_files:
            src = Path(__file__).parent.parent / f
            if src.exists():
                shutil.copy(src, code_dir / f)
        
        # ========== DATABASE BACKUP ==========
        db_dir = backup_dir / "database"
        db_dir.mkdir(parents=True)
        
        # Get MongoDB connection info
        mongo_url = os.environ.get('MONGO_URL')
        db_name = os.environ.get('DB_NAME', 'champions_academy')
        
        # Run mongodump
        result = subprocess.run(
            ['mongodump', '--uri', mongo_url, '--db', db_name, '--out', str(db_dir)],
            capture_output=True,
            text=True,
            timeout=120
        )
        
        if result.returncode != 0:
            logger.warning(f"mongodump warning: {result.stderr}")
        
        # ========== CREATE ZIP ==========
        zip_path = Path("/tmp/gcsp-academy-full-backup.zip")
        if zip_path.exists():
            zip_path.unlink()
            
        shutil.make_archive(
            str(zip_path).replace('.zip', ''),
            'zip',
            backup_dir
        )
        
        # Clean up
        shutil.rmtree(backup_dir)
        
        return FileResponse(
            path=str(zip_path),
            filename=f"gcsp-academy-full-backup-{datetime.now().strftime('%Y%m%d')}.zip",
            media_type="application/zip"
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Backup timed out")
    except Exception as e:
        logger.error(f"Full backup error: {e}")
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")

@api_router.get("/backup/json")
async def download_json_backup():
    """Download complete database backup as JSON file"""
    import json
    from bson import ObjectId
    
    def serialize_doc(doc):
        """Convert MongoDB document to JSON-serializable format"""
        if doc is None:
            return None
        if isinstance(doc, dict):
            return {k: serialize_doc(v) for k, v in doc.items()}
        if isinstance(doc, list):
            return [serialize_doc(item) for item in doc]
        if isinstance(doc, ObjectId):
            return str(doc)
        if isinstance(doc, datetime):
            return doc.isoformat()
        return doc
    
    try:
        # Get all collections
        collections = await db.list_collection_names()
        
        backup_data = {
            "backup_info": {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "database": os.environ.get('DB_NAME', 'champions_academy'),
                "version": "1.0"
            },
            "collections": {}
        }
        
        # Export each collection
        for collection_name in collections:
            collection = db[collection_name]
            documents = await collection.find({}).to_list(length=None)
            backup_data["collections"][collection_name] = [serialize_doc(doc) for doc in documents]
        
        # Create JSON file
        json_content = json.dumps(backup_data, ensure_ascii=False, indent=2)
        
        # Create response
        filename = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        return StreamingResponse(
            io.BytesIO(json_content.encode('utf-8')),
            media_type="application/json",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )
    except Exception as e:
        logger.error(f"JSON backup error: {e}")
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")

# ============ PUBLIC API - Member Card ============

@api_router.get("/public/member-card/{search_term}")
async def get_member_card_public(search_term: str):
    """Public API to get member card info by member_code or phone"""
    # Search by member_code first
    member = await db.members.find_one(
        {"$or": [
            {"member_code": search_term},
            {"phone": search_term}
        ]},
        {"_id": 0}
    )
    
    if not member:
        # Try to search by name
        member = await db.members.find_one(
            {"$or": [
                {"name_ar": {"$regex": search_term, "$options": "i"}},
                {"name": {"$regex": search_term, "$options": "i"}}
            ]},
            {"_id": 0}
        )
    
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
    
    return {
        "id": member["id"],
        "name": member.get("name"),
        "name_ar": member.get("name_ar"),
        "member_code": member.get("member_code"),
        "phone": member.get("phone"),
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
    is_product: bool = False
    quantity: int = 1

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

def create_token(user_id: str, username: str, branch_id: str = None, is_admin: bool = False) -> str:
    payload = {
        "user_id": user_id,
        "username": username,
        "branch_id": branch_id,
        "is_admin": is_admin,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user_from_token(token: Optional[str] = None, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Support both Bearer token and query parameter token for exports"""
    actual_token = token
    if not actual_token and credentials:
        actual_token = credentials.credentials
    if not actual_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(actual_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

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
    user = await db.users.find_one({"username": credentials.username}, {"_id": 0})
    if not user or not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    branch_id = user.get("branch_id")
    is_admin = user.get("is_admin", False)
    
    token = create_token(user["id"], user["username"], branch_id, is_admin)
    return TokenResponse(
        access_token=token,
        user={"id": user["id"], "username": user["username"], "name": user["name"], "branch_id": branch_id, "is_admin": is_admin}
    )

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

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
    # Generate form number
    count = await db.registration_forms.count_documents({})
    form_number = f"REG-{count + 1:05d}"
    
    # Determine branch_id
    branch_id = form.branch_id
    if not current_user.get("is_admin"):
        branch_id = current_user.get("branch_id")
    
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
        member = await db.members.find_one({"phone": form.customer_phone}, {"_id": 0, "id": 1, "member_code": 1})
        if member:
            member_id = member["id"]
            member_code = member.get("member_code")
        else:
            # Create new member from registration form data
            # Generate sequential member number
            all_members = await db.members.find(
                {"member_code": {"$exists": True, "$ne": ""}},
                {"member_code": 1, "_id": 0}
            ).to_list(10000)
            
            max_number = 0
            for m in all_members:
                code = m.get("member_code", "")
                try:
                    num = int(code)
                    if num > max_number:
                        max_number = num
                except ValueError:
                    continue
            
            next_member_code = str(max_number + 1)
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
    
    # Create invoice from form
    count = await db.invoices.count_documents({})
    invoice_number = f"INV-{count + 1:05d}"
    
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
# Disabled for external deployment - requires emergentintegrations

@api_router.post("/payments/checkout")
async def create_checkout_session(
    request: Request,
    invoice_id: str,
    current_user: dict = Depends(get_current_user)
):
    raise HTTPException(status_code=503, detail="Online payments are disabled in this deployment")

@api_router.get("/payments/status/{session_id}")
async def get_payment_status(session_id: str, current_user: dict = Depends(get_current_user)):
    raise HTTPException(status_code=503, detail="Online payments are disabled in this deployment")

@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    raise HTTPException(status_code=503, detail="Online payments are disabled in this deployment")

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
    
    if start_date:
        query["paid_at"] = {"$gte": start_date}
    if end_date:
        if "paid_at" in query:
            query["paid_at"]["$lte"] = end_date
        else:
            query["paid_at"] = {"$lte": end_date}
    
    invoices = await db.invoices.find(query, {"_id": 0}).to_list(10000)
    
    # Get credit notes (refunds) from the new collection
    credit_note_query = {}
    if is_admin and branch_filter and branch_filter != "all":
        credit_note_query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        credit_note_query["branch_id"] = branch_id
    if start_date:
        credit_note_query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in credit_note_query:
            credit_note_query["created_at"]["$lte"] = end_date
        else:
            credit_note_query["created_at"] = {"$lte": end_date}
    
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
                        "member_name": member.get("name_ar", member.get("name", "")),
                        "phone": member.get("phone", ""),
                        "activity_name": activity.get("activity_name", ""),
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
    # Verify token
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    query = {}
    if activity_id:
        query["activities.activity_id"] = activity_id
    if status:
        query["activities.status"] = status
    
    members = await db.members.find(query, {"_id": 0}).to_list(10000)
    
    if format == "xlsx":
        # Create Excel file
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
    # Verify token
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except:
        raise HTTPException(status_code=401, detail="Invalid token")
    
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

@api_router.get("/export/reports")
async def export_financial_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    format: str = "xlsx",
    token: Optional[str] = None
):
    """Export financial report to Excel/CSV"""
    # Verify token
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
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
    # Verify token
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    # Fetch all data
    members = await db.members.find({}, {"_id": 0}).to_list(10000)
    invoices = await db.invoices.find({}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    activities_data = await db.activities.find({}, {"_id": 0}).to_list(100)
    coaches = await db.coaches.find({}, {"_id": 0}).to_list(100)
    
    # Create workbook
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
    payment_method: str = "cash"
    items: List[ProductInvoiceItem]
    status: str = "draft"  # draft or paid
    branch_id: Optional[str] = None  # Admin can specify branch

class ProductInvoice(BaseModel):
    id: str
    invoice_number: str
    customer_name: str
    customer_phone: Optional[str] = ""
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
    current_user: dict = Depends(get_current_user)
):
    """Get all product invoices"""
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
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
    
    # Generate invoice number
    count = await db.purchase_invoices.count_documents({})
    invoice_number = f"PUR-{count + 1:05d}"
    
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
        je_count = await db.journal_entries.count_documents({})
        entry_number = f"JE-{je_count + 1:05d}"
        
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
        je_count = await db.journal_entries.count_documents({})
        entry_number = f"JE-{je_count + 1:05d}"
        
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
    current_user: dict = Depends(get_current_user)
):
    """Get activities organized by activity -> time -> members for the schedule view"""
    
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
    
    invoices = await db.invoices.find(invoice_query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    # Structure: { activity_id: { name, times: { time: { day: [members] } } } }
    activities_data = {}
    
    import re
    
    # Get today's date for subscription status check
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
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
            
            # Check if subscription is still active (end_date >= today)
            end_date = item.get("end_date", "")
            if end_date and end_date < today:
                # Subscription expired, skip this member for this activity
                continue
            
            # Initialize activity if not exists
            if activity_id not in activities_data:
                activities_data[activity_id] = {
                    "activity_id": activity_id,
                    "activity_name": activity_name,
                    "times": {}
                }
            
            # Extract time
            time_match = re.search(r'الساع[ةه]\s*(\d+(?::\d+)?)', schedule_text)
            time_str = time_match.group(1) if time_match else "غير محدد"
            if time_str != "غير محدد" and ":" not in time_str:
                time_str = f"{time_str}:00"
            
            # Initialize time slot if not exists
            if time_str not in activities_data[activity_id]["times"]:
                activities_data[activity_id]["times"][time_str] = {
                    "sunday": [], "monday": [], "tuesday": [], "wednesday": [],
                    "thursday": [], "friday": [], "saturday": []
                }
            
            # Find which days and add member
            for ar_day, en_day in day_keywords.items():
                if ar_day in schedule_text:
                    # Check if member already added for this day/time
                    existing_members = [m["member_id"] for m in activities_data[activity_id]["times"][time_str][en_day]]
                    if member_id not in existing_members:
                        activities_data[activity_id]["times"][time_str][en_day].append({
                            "member_id": member_id,
                            "member_name": member_name,
                            "phone": member_phone
                        })
    
    # Convert to list and sort
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
    
    # Create notification for new note
    notification_doc = {
        "id": str(uuid.uuid4()),
        "type": "activity_note",
        "title": f"ملاحظة جديدة - {note_data.activity_name}",
        "message": note_data.note_text[:100] + "..." if len(note_data.note_text) > 100 else note_data.note_text,
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
    """Get attendance for a specific activity on a specific date"""
    # Get activity details
    activity = await db.activities.find_one({"id": activity_id}, {"_id": 0})
    if not activity:
        raise HTTPException(status_code=404, detail="النشاط غير موجود")
    
    # Get all members enrolled in this activity with active subscription
    members_query = {"activities.activity_id": activity_id}
    if current_user.get("role") != "admin" and current_user.get("branch_id"):
        members_query["branch_id"] = current_user["branch_id"]
    
    members = await db.members.find(members_query, {"_id": 0}).to_list(500)
    
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
            attendance_record = existing_map.get(member["id"])
            result.append({
                "member_id": member["id"],
                "member_code": member.get("member_code", ""),
                "member_name": member.get("name_ar") or member.get("name", ""),
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
    # First try to find by member_code
    member = await db.members.find_one({"member_code": search_term}, {"_id": 0})
    
    # If not found, search by name
    if not member:
        # Search in name_ar or name (case insensitive for English)
        member = await db.members.find_one({
            "$or": [
                {"name_ar": {"$regex": search_term, "$options": "i"}},
                {"name": {"$regex": search_term, "$options": "i"}}
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
    
    # Get activities from invoices
    activities_from_invoices = []
    invoices = await db.invoices.find({
        "member_id": member["id"],
        "status": {"$in": ["paid", "partial"]}
    }, {"_id": 0}).to_list(100)
    
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("activity_id"):
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
            if item.get("activity_id") or item.get("activity_name"):
                end_date = item.get("end_date", "")
                is_active = end_date >= today if end_date else False
                activities_from_reg_forms.append({
                    "activity_id": item.get("activity_id", ""),
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
        "activities": unique_activities,
        "today_attendance": today_records
    }

@api_router.get("/attendance/quick-search-multi/{search_term}")
async def quick_search_members_multi(
    search_term: str,
    current_user: dict = Depends(get_current_user)
):
    """Search multiple members by member_code or name for quick attendance"""
    # Search by member_code or name
    members = await db.members.find({
        "$or": [
            {"member_code": {"$regex": search_term, "$options": "i"}},
            {"name_ar": {"$regex": search_term, "$options": "i"}},
            {"name": {"$regex": search_term, "$options": "i"}}
        ]
    }, {"_id": 0}).limit(10).to_list(10)
    
    if not members:
        return []
    
    # Get today's date
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    results = []
    for member in members:
        # Check if already recorded today
        today_records = await db.attendance.find(
            {"member_id": member["id"], "date": today},
            {"_id": 0}
        ).to_list(10)
        
        results.append({
            "member_id": member["id"],
            "member_code": member.get("member_code", ""),
            "name": member.get("name", ""),
            "name_ar": member.get("name_ar", ""),
            "phone": member.get("phone", ""),
            "activities": member.get("activities", []),
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
    member = await db.members.find_one({"member_code": member_code}, {"_id": 0})
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
    
    # Check if already recorded today (any activity)
    existing = await db.attendance.find_one({
        "member_id": member["id"],
        "date": today
    })
    
    if existing:
        return {
            "message": f"تم تسجيل الحضور مسبقاً اليوم في نشاط: {existing.get('activity_name', '')}",
            "already_recorded": True,
            "member_name": member.get("name_ar") or member.get("name", ""),
            "record": {k: v for k, v in existing.items() if k != "_id"}
        }
    
    # Record attendance
    record_id = str(uuid.uuid4())
    record_doc = {
        "id": record_id,
        "member_id": member["id"],
        "member_code": member.get("member_code", ""),
        "member_name": member.get("name_ar") or member.get("name", ""),
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
    
    present_count = sum(1 for r in records if r["status"] == "present")
    absent_count = sum(1 for r in records if r["status"] == "absent")
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
    
    # Get member codes
    member_ids = list(set(r["member_id"] for r in records))
    members_data = await db.members.find(
        {"id": {"$in": member_ids}}, 
        {"_id": 0, "id": 1, "member_code": 1}
    ).to_list(1000)
    member_codes = {m["id"]: m.get("member_code", "") for m in members_data}
    
    # Group by member
    member_stats = {}
    for r in records:
        mid = r["member_id"]
        if mid not in member_stats:
            member_stats[mid] = {
                "member_id": mid,
                "member_code": member_codes.get(mid, ""),
                "member_name": r["member_name"],
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
    start_date: str = None,
    end_date: str = None,
    branch_id: str = None,
    token: str = None
):
    """Export attendance to Excel"""
    if token:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        except:
            raise HTTPException(status_code=401, detail="Invalid token")
    
    query = {}
    if activity_id:
        query["activity_id"] = activity_id
    if branch_id:
        query["branch_id"] = branch_id
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = end_date
        else:
            query["date"] = {"$lte": end_date}
    
    records = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(10000)
    
    wb = Workbook()
    ws = wb.active
    ws.title = "سجل الحضور"
    
    headers = ["التاريخ", "النشاط", "اسم العضو", "الحالة", "وقت الحضور", "ملاحظات", "المسجل"]
    ws.append(headers)
    
    for r in records:
        ws.append([
            r.get("date", ""),
            r.get("activity_name", ""),
            r.get("member_name", ""),
            "حاضر" if r.get("status") == "present" else "غائب",
            r.get("check_in_time", ""),
            r.get("notes", ""),
            r.get("recorded_by", "")
        ])
    
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"attendance_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
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

@api_router.get("/internal-expenses")
async def get_internal_expenses(
    status_filter: Optional[str] = None,
    expense_type: Optional[str] = None,
    branch_filter: Optional[str] = None,
    executor: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all internal expenses with filters"""
    query = {}
    
    # Branch filter
    is_admin = current_user.get("is_admin", False)
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
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
    query = {}
    
    is_admin = current_user.get("is_admin", False)
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and current_user.get("branch_id"):
        query["branch_id"] = current_user["branch_id"]
    
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
    
    # Generate expense number
    last_expense = await db.internal_expenses.find_one(
        {"expense_number": {"$exists": True}},
        sort=[("created_at", -1)]
    )
    if last_expense and last_expense.get("expense_number"):
        try:
            last_num = int(last_expense["expense_number"].replace("EXP-", ""))
            next_num = last_num + 1
        except:
            next_num = 1
    else:
        next_num = 1
    
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
        "status": "pending",  # pending, approved, rejected, posted
        "branch_id": final_branch_id,
        "created_by": current_user.get("username"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "journal_entry_id": None  # Will be set when posted to accounting
    }
    
    await db.internal_expenses.insert_one(expense_data)
    del expense_data["_id"]
    
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
    if status not in ["pending", "approved", "rejected"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    existing = await db.internal_expenses.find_one({"id": expense_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")
    
    if existing.get("status") == "posted":
        raise HTTPException(status_code=400, detail="لا يمكن تعديل مصروف مرحّل للمحاسبة")
    
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
            next_num = 1
    else:
        next_num = 1
    
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
                
                # Create notification
                if days_until_expiry == 0:
                    title = f"⚠️ اشتراك منتهي اليوم!"
                    message = f"اشتراك {member.get('name_ar', member.get('name', ''))} في {activity['activity_name']} ينتهي اليوم"
                elif days_until_expiry == 1:
                    title = f"🔴 تنبيه: اشتراك ينتهي غداً!"
                    message = f"اشتراك {member.get('name_ar', member.get('name', ''))} في {activity['activity_name']} ينتهي غداً"
                elif days_until_expiry <= 3:
                    title = f"🟠 تنبيه: اشتراك ينتهي قريباً!"
                    message = f"اشتراك {member.get('name_ar', member.get('name', ''))} في {activity['activity_name']} ينتهي خلال {days_until_expiry} أيام ({activity['end_date']})"
                else:
                    title = f"🔔 تذكير بتجديد الاشتراك"
                    message = f"اشتراك {member.get('name_ar', member.get('name', ''))} في {activity['activity_name']} ينتهي خلال {days_until_expiry} أيام ({activity['end_date']})"
                
                notification = {
                    "id": str(uuid.uuid4()),
                    "title": title,
                    "message": message,
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
    
    return {"message": f"تم إنشاء {notifications_created} إشعار جديد", "count": notifications_created}


# ============ MEMBER PORTAL NOTIFICATIONS ============

class MemberNotificationCreate(BaseModel):
    title: str
    message: str
    target: str = "all_members"  # all_members, specific_member
    target_member_id: Optional[str] = None
    priority: str = "info"  # info, warning, danger
    notification_type: str = "announcement"  # announcement, offer, reminder

@api_router.post("/member-notifications")
async def create_member_notification(data: MemberNotificationCreate, current_user: dict = Depends(get_current_user)):
    """Create a notification for member portal"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    notification = {
        "id": str(uuid.uuid4()),
        "title": data.title,
        "message": data.message,
        "target": data.target,
        "target_members": [data.target_member_id] if data.target == "specific_member" and data.target_member_id else [],
        "priority": data.priority,
        "type": data.notification_type,
        "created_by": current_user.get("id"),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.notifications.insert_one(notification)
    
    return {"message": "تم إرسال الإشعار بنجاح", "notification_id": notification["id"]}

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
    count = await db.journal_entries.count_documents({})
    entry_number = f"JE-{count + 1:05d}"
    
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
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
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
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
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
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
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
    
    # Enrich with coach and activity names
    for rating in ratings:
        coach = await db.coaches.find_one({"id": rating.get("coach_id")}, {"_id": 0, "name": 1, "name_ar": 1})
        if coach:
            rating["coach_name"] = coach.get("name_ar") or coach.get("name")
        
        activity = await db.activities.find_one({"id": rating.get("activity_id")}, {"_id": 0, "name": 1, "name_ar": 1})
        if activity:
            rating["activity_name"] = activity.get("name_ar") or activity.get("name")
    
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


# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve React static files in production
STATIC_DIR = ROOT_DIR / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR / "static")), name="static_assets")
    
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        """Serve React app for all non-API routes"""
        # Check if it's a file request
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        # Return index.html for all other routes (React Router)
        return FileResponse(STATIC_DIR / "index.html")

# ============ AUTO CREATE ADMIN USER ON STARTUP ============
@app.on_event("startup")
async def create_default_admin():
    """Create default admin user if no users exist"""
    try:
        users_count = await db.users.count_documents({})
        if users_count == 0:
            # Create default admin user
            hashed_password = bcrypt.hashpw("242456".encode('utf-8'), bcrypt.gensalt())
            admin_user = {
                "id": str(uuid.uuid4()),
                "username": "242456",
                "password": hashed_password.decode('utf-8'),
                "name": "مدير النظام",
                "name_en": "System Admin",
                "role": "admin",
                "is_admin": True,
                "branch_id": None,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            await db.users.insert_one(admin_user)
            logger.info("✅ Default admin user created: 242456")
        else:
            logger.info(f"ℹ️ Users exist ({users_count}), skipping admin creation")
    except Exception as e:
        logger.error(f"❌ Error creating default admin: {str(e)}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
