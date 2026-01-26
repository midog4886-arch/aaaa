from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import io
import csv
import base64
import qrcode
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET_KEY', 'default_secret')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Stripe Config
STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY', '')

app = FastAPI(title="Champions Academy API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

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
    fee: float
    status: str = "active"  # active, expired, frozen
    coach_id: Optional[str] = ""

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
    activities: List[MemberActivity] = []
    branch_id: Optional[str] = None
    created_at: str

class InvoiceItem(BaseModel):
    activity_id: str
    activity_name: str
    fee: float
    period: str
    schedule: Optional[str] = ""  # جدول المواعيد
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

class ReportFilter(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    activity_id: Optional[str] = None
    coach_id: Optional[str] = None
    period: str = "monthly"  # daily, monthly, yearly

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

# ============ USERS MANAGEMENT ROUTES ============

@api_router.get("/users")
async def get_users(current_user: dict = Depends(get_current_user)):
    """Get all users - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    users = await db.users.find({}, {"_id": 0, "password": 0}).to_list(1000)
    
    # Add branch name to each user
    branches = await db.branches.find({}, {"_id": 0}).to_list(100)
    branch_map = {b["id"]: b for b in branches}
    
    for user in users:
        branch_id = user.get("branch_id")
        if branch_id and branch_id in branch_map:
            user["branch_name"] = branch_map[branch_id].get("name_ar", branch_map[branch_id].get("name", ""))
        else:
            user["branch_name"] = ""
    
    return users

@api_router.post("/users")
async def create_user(current_user: dict = Depends(get_current_user)):
    """Create a new user - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # This endpoint expects JSON body with user data
    return {"message": "Use /users/create endpoint"}

class UserCreateAdmin(BaseModel):
    username: str
    password: str
    name: str
    branch_id: Optional[str] = None
    is_admin: bool = False

@api_router.post("/users/create")
async def create_user_admin(user_data: UserCreateAdmin, current_user: dict = Depends(get_current_user)):
    """Create a new user - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Check if username exists
    existing = await db.users.find_one({"username": user_data.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "username": user_data.username,
        "password": hash_password(user_data.password),
        "name": user_data.name,
        "branch_id": user_data.branch_id,
        "is_admin": user_data.is_admin,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    # Return user without password and _id
    return {k: v for k, v in user_doc.items() if k not in ["password", "_id"]}

class UserUpdateAdmin(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    branch_id: Optional[str] = None
    is_admin: Optional[bool] = None
    password: Optional[str] = None

@api_router.put("/users/{user_id}")
async def update_user(user_id: str, user_data: UserUpdateAdmin, current_user: dict = Depends(get_current_user)):
    """Update a user - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    update_data = {}
    if user_data.username is not None:
        # Check if username is already taken by another user
        existing = await db.users.find_one({"username": user_data.username, "id": {"$ne": user_id}})
        if existing:
            raise HTTPException(status_code=400, detail="اسم المستخدم موجود مسبقاً")
        update_data["username"] = user_data.username
    if user_data.name is not None:
        update_data["name"] = user_data.name
    if user_data.branch_id is not None:
        update_data["branch_id"] = user_data.branch_id
    if user_data.is_admin is not None:
        update_data["is_admin"] = user_data.is_admin
    if user_data.password:
        update_data["password"] = hash_password(user_data.password)
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")
    
    result = await db.users.find_one_and_update(
        {"id": user_id},
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Return user without password
    return {k: v for k, v in result.items() if k not in ["_id", "password"]}

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a user - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Prevent deleting yourself
    if user_id == current_user.get("user_id"):
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted"}

# ============ BRANCHES ROUTES ============

@api_router.get("/branches")
async def get_branches(current_user: dict = Depends(get_current_user)):
    """Get all branches - admin sees all, others see only their branch"""
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    if is_admin:
        branches = await db.branches.find({}, {"_id": 0}).to_list(100)
    else:
        branches = await db.branches.find({"id": branch_id}, {"_id": 0}).to_list(100)
    return branches

@api_router.post("/branches")
async def create_branch(branch: BranchCreate, current_user: dict = Depends(get_current_user)):
    """Create a new branch - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    branch_id = str(uuid.uuid4())
    branch_doc = {
        "id": branch_id,
        **branch.model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.branches.insert_one(branch_doc)
    return {k: v for k, v in branch_doc.items() if k != "_id"}

@api_router.put("/branches/{branch_id}")
async def update_branch(branch_id: str, branch: BranchCreate, current_user: dict = Depends(get_current_user)):
    """Update a branch - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.branches.find_one_and_update(
        {"id": branch_id},
        {"$set": branch.model_dump()},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Branch not found")
    return {k: v for k, v in result.items() if k != "_id"}

@api_router.delete("/branches/{branch_id}")
async def delete_branch(branch_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a branch - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.branches.delete_one({"id": branch_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Branch not found")
    return {"message": "Branch deleted"}

@api_router.get("/branches/{branch_id}")
async def get_branch(branch_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single branch"""
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return branch

# ============ ACTIVITIES ROUTES ============

@api_router.get("/activities", response_model=List[Activity])
async def get_activities(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    if is_admin:
        if branch_filter and branch_filter != "all":
            activities = await db.activities.find(
                {"$or": [{"branch_id": branch_filter}, {"branch_id": None}, {"branch_id": {"$exists": False}}]},
                {"_id": 0}
            ).to_list(100)
        else:
            activities = await db.activities.find({}, {"_id": 0}).to_list(100)
    else:
        # Get activities for user's branch or shared activities
        activities = await db.activities.find(
            {"$or": [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": {"$exists": False}}]}, 
            {"_id": 0}
        ).to_list(100)
    return activities

@api_router.post("/activities", response_model=Activity)
async def create_activity(activity: ActivityCreate, current_user: dict = Depends(get_current_user)):
    activity_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)
    
    # Admin can specify branch, otherwise use user's branch
    if is_admin and activity.branch_id:
        final_branch_id = activity.branch_id if activity.branch_id != "all" else None
    else:
        final_branch_id = current_user.get("branch_id")
    
    activity_doc = {
        "id": activity_id,
        **activity.model_dump(),
        "branch_id": final_branch_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.activities.insert_one(activity_doc)
    return Activity(**{k: v for k, v in activity_doc.items() if k != "_id"})

@api_router.put("/activities/{activity_id}", response_model=Activity)
async def update_activity(activity_id: str, activity: ActivityCreate, current_user: dict = Depends(get_current_user)):
    result = await db.activities.find_one_and_update(
        {"id": activity_id},
        {"$set": activity.model_dump()},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Activity not found")
    return Activity(**{k: v for k, v in result.items() if k != "_id"})

@api_router.delete("/activities/{activity_id}")
async def delete_activity(activity_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.activities.delete_one({"id": activity_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Activity not found")
    return {"message": "Activity deleted"}

# ============ COACHES ROUTES ============

@api_router.get("/coaches", response_model=List[Coach])
async def get_coaches(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    if is_admin:
        if branch_filter and branch_filter != "all":
            coaches = await db.coaches.find(
                {"$or": [{"branch_id": branch_filter}, {"branch_id": None}, {"branch_id": {"$exists": False}}]},
                {"_id": 0}
            ).to_list(100)
        else:
            coaches = await db.coaches.find({}, {"_id": 0}).to_list(100)
    else:
        coaches = await db.coaches.find(
            {"$or": [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": {"$exists": False}}]}, 
            {"_id": 0}
        ).to_list(100)
    return coaches

@api_router.post("/coaches", response_model=Coach)
async def create_coach(coach: CoachCreate, current_user: dict = Depends(get_current_user)):
    coach_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)
    
    # Admin can specify branch, otherwise use user's branch
    if is_admin and coach.branch_id:
        final_branch_id = coach.branch_id if coach.branch_id != "all" else None
    else:
        final_branch_id = current_user.get("branch_id")
    
    coach_doc = {
        "id": coach_id,
        **coach.model_dump(),
        "branch_id": final_branch_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.coaches.insert_one(coach_doc)
    return Coach(**{k: v for k, v in coach_doc.items() if k != "_id"})

@api_router.put("/coaches/{coach_id}", response_model=Coach)
async def update_coach(coach_id: str, coach: CoachCreate, current_user: dict = Depends(get_current_user)):
    result = await db.coaches.find_one_and_update(
        {"id": coach_id},
        {"$set": coach.model_dump()},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Coach not found")
    return Coach(**{k: v for k, v in result.items() if k != "_id"})

@api_router.delete("/coaches/{coach_id}")
async def delete_coach(coach_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.coaches.delete_one({"id": coach_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Coach not found")
    return {"message": "Coach deleted"}

# ============ MEMBERS ROUTES ============

@api_router.get("/members", response_model=List[Member])
async def get_members(
    activity_id: Optional[str] = None,
    coach_id: Optional[str] = None,
    status: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    # Admin can filter by any branch
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    if activity_id:
        query["activities.activity_id"] = activity_id
    if coach_id:
        query["activities.coach_id"] = coach_id
    if status:
        query["activities.status"] = status
    
    members = await db.members.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return members

@api_router.get("/members/{member_id}", response_model=Member)
async def get_member(member_id: str, current_user: dict = Depends(get_current_user)):
    member = await db.members.find_one({"id": member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return member

@api_router.post("/members", response_model=Member)
async def create_member(member: MemberCreate, current_user: dict = Depends(get_current_user)):
    member_id = str(uuid.uuid4())
    branch_id = current_user.get("branch_id")
    member_doc = {
        "id": member_id,
        **member.model_dump(),
        "branch_id": branch_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.members.insert_one(member_doc)
    return Member(**{k: v for k, v in member_doc.items() if k != "_id"})

@api_router.put("/members/{member_id}", response_model=Member)
async def update_member(member_id: str, member: MemberUpdate, current_user: dict = Depends(get_current_user)):
    update_data = {k: v for k, v in member.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")
    
    result = await db.members.find_one_and_update(
        {"id": member_id},
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Member not found")
    return Member(**{k: v for k, v in result.items() if k != "_id"})

@api_router.delete("/members/{member_id}")
async def delete_member(member_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.members.delete_one({"id": member_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"message": "Member deleted"}

@api_router.post("/members/{member_id}/activities")
async def add_member_activity(member_id: str, activity: MemberActivity, current_user: dict = Depends(get_current_user)):
    result = await db.members.update_one(
        {"id": member_id},
        {"$push": {"activities": activity.model_dump()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"message": "Activity added"}

@api_router.put("/members/{member_id}/activities/{activity_id}")
async def update_member_activity(member_id: str, activity_id: str, activity: MemberActivity, current_user: dict = Depends(get_current_user)):
    result = await db.members.update_one(
        {"id": member_id, "activities.activity_id": activity_id},
        {"$set": {"activities.$": activity.model_dump()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Member or activity not found")
    return {"message": "Activity updated"}

# ============ INVOICES ROUTES ============

@api_router.get("/invoices", response_model=List[Invoice])
async def get_invoices(
    member_id: Optional[str] = None,
    status: Optional[str] = None,
    invoice_number: Optional[str] = None,
    phone: Optional[str] = None,
    activity_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    # Admin can filter by any branch
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    if member_id:
        query["member_id"] = member_id
    if status:
        query["status"] = status
    if invoice_number:
        query["id"] = {"$regex": invoice_number, "$options": "i"}
    if phone:
        query["customer_phone"] = {"$regex": phone}
    if activity_id:
        query["items.activity_id"] = activity_id
    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return invoices

# Search invoices with member name
@api_router.get("/invoices/search")
async def search_invoices(
    q: Optional[str] = None,
    status: Optional[str] = None,
    activity_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    # Admin can filter by any branch
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
    if q:
        query["$or"] = [
            {"id": {"$regex": q, "$options": "i"}},
            {"member_name": {"$regex": q, "$options": "i"}},
            {"customer_phone": {"$regex": q}},
            {"customer_name": {"$regex": q, "$options": "i"}},
            {"customer_name_ar": {"$regex": q}}
        ]
    if status:
        query["status"] = status
    if activity_id:
        query["items.activity_id"] = activity_id
    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return invoices
    return invoices

@api_router.get("/invoices/{invoice_id}", response_model=Invoice)
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice

@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(invoice: InvoiceCreate, current_user: dict = Depends(get_current_user)):
    member = None
    if invoice.member_id:
        member = await db.members.find_one({"id": invoice.member_id}, {"_id": 0})
    
    subtotal = sum(item.fee for item in invoice.items)
    after_discount = subtotal - invoice.discount
    vat_amount = round(after_discount * VAT_RATE, 2)
    total = round(after_discount + vat_amount, 2)
    
    # Use provided customer data or default to member data if available
    customer_name_ar = invoice.customer_name_ar or (member.get("name_ar", "") if member else "")
    customer_phone = invoice.customer_phone or (member.get("phone", "") if member else "")
    customer_address = invoice.customer_address or ""
    
    # Generate sequential invoice number starting from 202601
    last_invoice = await db.invoices.find_one(
        {"invoice_number": {"$exists": True}},
        sort=[("invoice_number", -1)]
    )
    if last_invoice and last_invoice.get("invoice_number"):
        next_number = int(last_invoice["invoice_number"]) + 1
    else:
        next_number = 202601
    
    invoice_id = str(uuid.uuid4())
    
    # Admin can specify branch, otherwise use user's branch
    is_admin = current_user.get("is_admin", False)
    if is_admin and invoice.branch_id and invoice.branch_id != "all":
        branch_id = invoice.branch_id
    else:
        branch_id = current_user.get("branch_id")
    
    invoice_doc = {
        "id": invoice_id,
        "invoice_number": str(next_number),
        "member_id": invoice.member_id,
        "member_name": customer_name_ar,
        "items": [item.model_dump() for item in invoice.items],
        "subtotal": subtotal,
        "discount": invoice.discount,
        "discount_code": invoice.discount_code,  # Store coupon code for usage tracking
        "vat_amount": vat_amount,
        "total": total,
        "status": "pending",
        "payment_method": invoice.payment_method,
        "notes": invoice.notes,
        "branch_id": branch_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "paid_at": None,
        # Customer data stored with invoice
        "customer_name_ar": customer_name_ar,
        "customer_phone": customer_phone,
        "customer_address": customer_address,
        # Company info
        "tax_number": COMPANY_TAX_NUMBER,
        "commercial_reg": COMPANY_COMMERCIAL_REG
    }
    await db.invoices.insert_one(invoice_doc)
    return Invoice(**{k: v for k, v in invoice_doc.items() if k != "_id"})

@api_router.put("/invoices/{invoice_id}/pay")
async def pay_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    # Deduct stock for product items
    for item in invoice.get("items", []):
        if item.get("is_product") and item.get("product_id"):
            product = await db.products.find_one({"id": item["product_id"]})
            if product:
                qty = item.get("quantity", 1)
                new_qty = product["quantity"] - qty
                if new_qty < 0:
                    raise HTTPException(status_code=400, detail=f"Insufficient stock for {item['activity_name']}")
                await db.products.update_one(
                    {"id": item["product_id"]},
                    {"$set": {"quantity": new_qty, "updated_at": datetime.now(timezone.utc).isoformat()}}
                )
    
    # Update discount usage if coupon was used
    if invoice.get("discount_code"):
        await db.discounts.update_one(
            {"code": invoice["discount_code"]},
            {"$inc": {"used_count": 1}}
        )
    
    # Update member activities from invoice items
    member_id = invoice.get("member_id")
    if member_id:
        member = await db.members.find_one({"id": member_id})
        if member:
            today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
            existing_activities = member.get("activities", [])
            
            for item in invoice.get("items", []):
                # Skip product items
                if item.get("is_product"):
                    continue
                
                # Parse dates from period or use item dates
                start_date = item.get("start_date", today)
                end_date = item.get("end_date", "")
                
                # If period exists, try to parse it
                if item.get("period") and " - " in item.get("period", ""):
                    period_parts = item["period"].split(" - ")
                    if len(period_parts) == 2:
                        start_date = period_parts[0].strip()
                        end_date = period_parts[1].strip()
                
                # Determine status based on end_date
                status = "active"
                if end_date:
                    try:
                        end_date_obj = datetime.strptime(end_date, '%Y-%m-%d')
                        today_obj = datetime.strptime(today, '%Y-%m-%d')
                        if end_date_obj < today_obj:
                            status = "expired"
                    except:
                        pass
                
                # Check if activity already exists for this member
                activity_exists = False
                for idx, existing_act in enumerate(existing_activities):
                    if existing_act.get("activity_id") == item.get("activity_id"):
                        # Update existing activity with new dates
                        existing_activities[idx] = {
                            "activity_id": item.get("activity_id"),
                            "activity_name": item.get("activity_name", ""),
                            "start_date": start_date,
                            "end_date": end_date,
                            "fee": item.get("fee", 0),
                            "status": status,
                            "coach_id": existing_act.get("coach_id", "")
                        }
                        activity_exists = True
                        break
                
                if not activity_exists:
                    # Add new activity
                    existing_activities.append({
                        "activity_id": item.get("activity_id"),
                        "activity_name": item.get("activity_name", ""),
                        "start_date": start_date,
                        "end_date": end_date,
                        "fee": item.get("fee", 0),
                        "status": status,
                        "coach_id": ""
                    })
            
            # Update member with new activities
            await db.members.update_one(
                {"id": member_id},
                {"$set": {"activities": existing_activities}}
            )
    
    result = await db.invoices.find_one_and_update(
        {"id": invoice_id},
        {"$set": {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()}},
        return_document=True
    )
    return {"message": "Invoice paid", "status": "paid"}

@api_router.put("/invoices/{invoice_id}/cancel")
async def cancel_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.invoices.find_one_and_update(
        {"id": invoice_id},
        {"$set": {"status": "cancelled"}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"message": "Invoice cancelled"}

@api_router.put("/invoices/{invoice_id}/restore")
async def restore_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Restore a cancelled invoice to pending status"""
    result = await db.invoices.find_one_and_update(
        {"id": invoice_id, "status": "cancelled"},
        {"$set": {"status": "pending"}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Invoice not found or not cancelled")
    return {"message": "Invoice restored"}

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Permanently delete an invoice - Admin only"""
    # Check if user is admin
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only action")
    result = await db.invoices.delete_one({"id": invoice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"message": "Invoice deleted"}

# ============ REFUND MODEL ============

class RefundRequest(BaseModel):
    amount: float
    reason: Optional[str] = ""
    refund_type: str = "full"  # full or partial

@api_router.post("/invoices/{invoice_id}/refund")
async def refund_invoice(invoice_id: str, refund: RefundRequest, current_user: dict = Depends(get_current_user)):
    """Process a refund for a paid invoice"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if invoice["status"] != "paid":
        raise HTTPException(status_code=400, detail="Can only refund paid invoices")
    
    if refund.amount <= 0 or refund.amount > invoice["total"]:
        raise HTTPException(status_code=400, detail="Invalid refund amount")
    
    # Create refund record
    refund_id = str(uuid.uuid4())
    refund_record = {
        "id": refund_id,
        "invoice_id": invoice_id,
        "amount": refund.amount,
        "reason": refund.reason,
        "refund_type": refund.refund_type,
        "refunded_by": current_user.get("username"),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.refunds.insert_one(refund_record)
    
    # Update invoice status based on refund type
    new_status = "refunded" if refund.refund_type == "full" else "partially_refunded"
    refund_info = {
        "refund_amount": refund.amount,
        "refund_reason": refund.reason,
        "refund_type": refund.refund_type,
        "refunded_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"status": new_status, **refund_info}}
    )
    
    return {"message": f"Refund of {refund.amount} SAR processed successfully", "refund_id": refund_id}

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
    del form_doc["_id"]
    return form_doc

@api_router.get("/registration-forms/{form_id}")
async def get_registration_form(form_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single registration form by ID"""
    form = await db.registration_forms.find_one({"id": form_id}, {"_id": 0})
    if not form:
        raise HTTPException(status_code=404, detail="Registration form not found")
    return form

@api_router.put("/registration-forms/{form_id}/convert")
async def convert_registration_form(form_id: str, current_user: dict = Depends(get_current_user)):
    """Convert registration form to invoice"""
    form = await db.registration_forms.find_one({"id": form_id}, {"_id": 0})
    if not form:
        raise HTTPException(status_code=404, detail="Registration form not found")
    
    if form["status"] == "converted":
        raise HTTPException(status_code=400, detail="Form already converted to invoice")
    
    # Create invoice from form
    count = await db.invoices.count_documents({})
    invoice_number = f"INV-{count + 1:05d}"
    
    invoice_doc = {
        "id": str(uuid.uuid4()),
        "invoice_number": invoice_number,
        "member_id": None,
        "customer_name_ar": form["customer_name"],
        "customer_phone": form["customer_phone"],
        "customer_address": "",
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
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.invoices.insert_one(invoice_doc)
    
    # Update form status
    await db.registration_forms.update_one(
        {"id": form_id},
        {"$set": {"status": "converted", "invoice_id": invoice_doc["id"]}}
    )
    
    del invoice_doc["_id"]
    return {"message": "Form converted to invoice", "invoice": invoice_doc}

@api_router.delete("/registration-forms/{form_id}")
async def delete_registration_form(form_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a registration form"""
    result = await db.registration_forms.delete_one({"id": form_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Registration form not found")
    return {"message": "Registration form deleted"}

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
    
    if start_date:
        query["paid_at"] = {"$gte": start_date}
    if end_date:
        if "paid_at" in query:
            query["paid_at"]["$lte"] = end_date
        else:
            query["paid_at"] = {"$lte": end_date}
    
    invoices = await db.invoices.find(query, {"_id": 0}).to_list(10000)
    
    # Also get refunded invoices for complete picture
    refunded_query = {"status": {"$in": ["refunded", "partially_refunded"]}}
    # Apply same branch filter
    if is_admin and branch_filter and branch_filter != "all":
        refunded_query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        refunded_query["branch_id"] = branch_id
    if start_date:
        refunded_query["refunded_at"] = {"$gte": start_date}
    if end_date:
        if "refunded_at" in refunded_query:
            refunded_query["refunded_at"]["$lte"] = end_date
        else:
            refunded_query["refunded_at"] = {"$lte": end_date}
    
    refunded_invoices = await db.invoices.find(refunded_query, {"_id": 0}).to_list(10000)
    
    total_revenue = sum(inv["total"] for inv in invoices)
    
    # Calculate refunds
    total_refunds = sum(inv.get("refund_amount", 0) for inv in refunded_invoices)
    full_refunds = [inv for inv in refunded_invoices if inv.get("refund_type") == "full"]
    partial_refunds = [inv for inv in refunded_invoices if inv.get("refund_type") == "partial"]
    
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
    
    # Refund details list
    refund_details = [{
        "invoice_id": inv["id"],
        "customer_name": inv.get("customer_name_ar") or inv.get("member_name", ""),
        "original_amount": inv["total"],
        "refund_amount": inv.get("refund_amount", 0),
        "refund_type": inv.get("refund_type", ""),
        "refund_reason": inv.get("refund_reason", ""),
        "refunded_at": inv.get("refunded_at", "")
    } for inv in refunded_invoices]
    
    return {
        "total_revenue": total_revenue,
        "total_refunds": total_refunds,
        "net_revenue": net_revenue,
        "invoice_count": len(invoices),
        "refund_count": len(refunded_invoices),
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
    
    return {
        "members_count": members_count,
        "activities_count": activities_count,
        "coaches_count": coaches_count,
        "active_subscriptions": active_subscriptions,
        "month_revenue": month_revenue,
        "expiring_count": expiring_count,
        "members_by_activity": [{"name": k, "count": v} for k, v in activity_counts.items()]
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

# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
