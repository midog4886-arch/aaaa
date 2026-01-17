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
    pass

class Activity(ActivityBase):
    id: str
    created_at: str

class CoachBase(BaseModel):
    name: str
    name_ar: str
    phone: str
    email: Optional[str] = ""
    activities: List[str] = []
    notes: Optional[str] = ""

class CoachCreate(CoachBase):
    pass

class Coach(CoachBase):
    id: str
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

class Member(MemberBase):
    id: str
    activities: List[MemberActivity] = []
    created_at: str

class InvoiceItem(BaseModel):
    activity_id: str
    activity_name: str
    fee: float
    period: str

# Company registration info
COMPANY_TAX_NUMBER = "312655637900003"
COMPANY_COMMERCIAL_REG = "7043630230"
VAT_RATE = 0.15  # 15% VAT

class InvoiceCreate(BaseModel):
    member_id: Optional[str] = None  # Optional - can create invoice without existing member
    items: List[InvoiceItem]
    discount: float = 0
    notes: Optional[str] = ""
    payment_method: str = "cash"  # cash, card, transfer, stripe
    # Customer data fields
    customer_name_ar: Optional[str] = ""
    customer_phone: Optional[str] = ""
    customer_address: Optional[str] = ""

class Invoice(BaseModel):
    id: str
    member_id: Optional[str] = None
    member_name: str
    items: List[InvoiceItem]
    subtotal: float
    discount: float
    vat_amount: float = 0
    total: float
    status: str = "pending"  # pending, paid, cancelled
    payment_method: str
    notes: Optional[str] = ""
    created_at: str
    paid_at: Optional[str] = None
    # Customer data stored with invoice
    customer_name_ar: Optional[str] = ""
    customer_phone: Optional[str] = ""
    customer_address: Optional[str] = ""
    # Company info
    tax_number: str = COMPANY_TAX_NUMBER
    commercial_reg: str = COMPANY_COMMERCIAL_REG

class MessageCreate(BaseModel):
    recipients: List[str]  # member IDs
    message: str
    message_type: str = "custom"  # payment_reminder, expiry_alert, promotion, custom

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

def create_token(user_id: str, username: str) -> str:
    payload = {
        "user_id": user_id,
        "username": username,
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
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    token = create_token(user_id, user.username)
    return TokenResponse(
        access_token=token,
        user={"id": user_id, "username": user.username, "name": user.name}
    )

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    user = await db.users.find_one({"username": credentials.username}, {"_id": 0})
    if not user or not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(user["id"], user["username"])
    return TokenResponse(
        access_token=token,
        user={"id": user["id"], "username": user["username"], "name": user["name"]}
    )

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

# ============ ACTIVITIES ROUTES ============

@api_router.get("/activities", response_model=List[Activity])
async def get_activities(current_user: dict = Depends(get_current_user)):
    activities = await db.activities.find({}, {"_id": 0}).to_list(100)
    return activities

@api_router.post("/activities", response_model=Activity)
async def create_activity(activity: ActivityCreate, current_user: dict = Depends(get_current_user)):
    activity_id = str(uuid.uuid4())
    activity_doc = {
        "id": activity_id,
        **activity.model_dump(),
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
async def get_coaches(current_user: dict = Depends(get_current_user)):
    coaches = await db.coaches.find({}, {"_id": 0}).to_list(100)
    return coaches

@api_router.post("/coaches", response_model=Coach)
async def create_coach(coach: CoachCreate, current_user: dict = Depends(get_current_user)):
    coach_id = str(uuid.uuid4())
    coach_doc = {
        "id": coach_id,
        **coach.model_dump(),
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
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if activity_id:
        query["activities.activity_id"] = activity_id
    if coach_id:
        query["activities.coach_id"] = coach_id
    if status:
        query["activities.status"] = status
    
    members = await db.members.find(query, {"_id": 0}).to_list(1000)
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
    member_doc = {
        "id": member_id,
        **member.model_dump(),
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
    current_user: dict = Depends(get_current_user)
):
    query = {}
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
    current_user: dict = Depends(get_current_user)
):
    query = {}
    
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
    
    invoice_id = str(uuid.uuid4())
    invoice_doc = {
        "id": invoice_id,
        "member_id": invoice.member_id,
        "member_name": customer_name_ar,
        "items": [item.model_dump() for item in invoice.items],
        "subtotal": subtotal,
        "discount": invoice.discount,
        "vat_amount": vat_amount,
        "total": total,
        "status": "pending",
        "payment_method": invoice.payment_method,
        "notes": invoice.notes,
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
    result = await db.invoices.find_one_and_update(
        {"id": invoice_id},
        {"$set": {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"message": "Invoice paid"}

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
    """Permanently delete an invoice"""
    result = await db.invoices.delete_one({"id": invoice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"message": "Invoice deleted"}

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

@api_router.get("/reports/financial")
async def get_financial_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    activity_id: Optional[str] = None,
    coach_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {"status": "paid"}
    
    if start_date:
        query["paid_at"] = {"$gte": start_date}
    if end_date:
        if "paid_at" in query:
            query["paid_at"]["$lte"] = end_date
        else:
            query["paid_at"] = {"$lte": end_date}
    
    invoices = await db.invoices.find(query, {"_id": 0}).to_list(10000)
    
    total_revenue = sum(inv["total"] for inv in invoices)
    
    # Group by activity
    revenue_by_activity = {}
    for inv in invoices:
        for item in inv["items"]:
            act_id = item["activity_id"]
            if act_id not in revenue_by_activity:
                revenue_by_activity[act_id] = {"name": item["activity_name"], "total": 0, "count": 0}
            revenue_by_activity[act_id]["total"] += item["fee"]
            revenue_by_activity[act_id]["count"] += 1
    
    return {
        "total_revenue": total_revenue,
        "invoice_count": len(invoices),
        "revenue_by_activity": list(revenue_by_activity.values()),
        "invoices": invoices[:50]  # Return last 50 invoices
    }

@api_router.get("/reports/expiring-subscriptions")
async def get_expiring_subscriptions(days: int = 7, current_user: dict = Depends(get_current_user)):
    threshold_date = (datetime.now(timezone.utc) + timedelta(days=days)).strftime('%Y-%m-%d')
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    members = await db.members.find({}, {"_id": 0}).to_list(10000)
    
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
        "name_ar": "أكاديمية أداء الأبطال العالمية",
        "name_en": "Global Champions Sports Performance",
        "tax_number": COMPANY_TAX_NUMBER,
        "commercial_reg": COMPANY_COMMERCIAL_REG,
        "vat_rate": VAT_RATE * 100,  # Return as percentage
        "currency": "SAR"
    }

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(current_user: dict = Depends(get_current_user)):
    # Get counts
    members_count = await db.members.count_documents({})
    activities_count = await db.activities.count_documents({})
    coaches_count = await db.coaches.count_documents({})
    
    # Get active subscriptions count
    members = await db.members.find({}, {"_id": 0}).to_list(10000)
    active_subscriptions = sum(
        1 for m in members 
        for a in m.get("activities", []) 
        if a.get("status") == "active"
    )
    
    # Get this month's revenue
    start_of_month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    month_invoices = await db.invoices.find(
        {"status": "paid", "paid_at": {"$gte": start_of_month}},
        {"_id": 0}
    ).to_list(10000)
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
    
    # Seed coaches
    coaches = [
        {"id": str(uuid.uuid4()), "name": "Ahmed Ali", "name_ar": "أحمد علي", "phone": "0501234567", "email": "ahmed@academy.com", "activities": [activities[0]["id"], activities[3]["id"]], "notes": "", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": str(uuid.uuid4()), "name": "Mohamed Hassan", "name_ar": "محمد حسن", "phone": "0507654321", "email": "mohamed@academy.com", "activities": [activities[1]["id"]], "notes": "", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": str(uuid.uuid4()), "name": "Sara Ahmed", "name_ar": "سارة أحمد", "phone": "0509876543", "email": "sara@academy.com", "activities": [activities[2]["id"]], "notes": "", "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    await db.coaches.insert_many(coaches)
    
    # Seed default admin user
    admin_user = {
        "id": str(uuid.uuid4()),
        "username": "admin",
        "password": hash_password("admin123"),
        "name": "مدير النظام",
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
        
        ws_summary.cell(row=1, column=1, value="التقرير المالي - أكاديمية أداء الأبطال العالمية").font = title_font
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
        writer.writerow(["التقرير المالي - أكاديمية أداء الأبطال العالمية"])
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
    """Generate QR code for invoice (ZATCA compliant)"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    # ZATCA TLV format for QR code
    def tlv_encode(tag, value):
        value_bytes = value.encode('utf-8')
        return bytes([tag, len(value_bytes)]) + value_bytes
    
    # Build ZATCA-compliant data
    seller_name = "أكاديمية أداء الأبطال العالمية"
    vat_number = COMPANY_TAX_NUMBER
    timestamp = invoice.get("created_at", datetime.now(timezone.utc).isoformat())
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
