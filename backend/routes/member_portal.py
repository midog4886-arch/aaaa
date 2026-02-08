"""
Member Portal API Routes
- Login with phone number
- View subscriptions, schedule, invoices
- Download QR card
- Notifications
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
import os
import jwt
import uuid

router = APIRouter(prefix="/api/member-portal", tags=["Member Portal"])
security = HTTPBearer()

# Database connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'champions_academy')]

# JWT Config for members
MEMBER_JWT_SECRET = os.environ.get('JWT_SECRET_KEY', 'default_secret') + "_member"
JWT_ALGORITHM = "HS256"
MEMBER_JWT_EXPIRATION_DAYS = 365 * 100  # Permanent


class MemberLogin(BaseModel):
    phone: str


class MemberTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    member: Dict[str, Any]


def create_member_token(member_id: str, phone: str) -> str:
    """Create JWT token for member"""
    payload = {
        "member_id": member_id,
        "phone": phone,
        "type": "member",
        "exp": datetime.now(timezone.utc) + timedelta(days=MEMBER_JWT_EXPIRATION_DAYS)
    }
    return jwt.encode(payload, MEMBER_JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_member(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify member JWT token"""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, MEMBER_JWT_SECRET, algorithms=[JWT_ALGORITHM])
        
        if payload.get("type") != "member":
            raise HTTPException(status_code=401, detail="Invalid token type")
        
        member_id = payload.get("member_id")
        member = await db.members.find_one({"id": member_id}, {"_id": 0})
        
        if not member:
            raise HTTPException(status_code=401, detail="Member not found")
        
        return member
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ============ AUTH ============

@router.post("/login", response_model=MemberTokenResponse)
async def member_login(data: MemberLogin):
    """Login with phone number only"""
    phone = data.phone.strip()
    
    # Find member by phone
    member = await db.members.find_one({"phone": phone}, {"_id": 0})
    
    if not member:
        raise HTTPException(status_code=404, detail="رقم الجوال غير مسجل")
    
    # Create token
    token = create_member_token(member["id"], phone)
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "member": {
            "id": member["id"],
            "name": member.get("name"),
            "name_ar": member.get("name_ar"),
            "phone": member.get("phone"),
            "member_code": member.get("member_code"),
            "email": member.get("email")
        }
    }


# ============ PROFILE ============

@router.get("/profile")
async def get_member_profile(member: dict = Depends(get_current_member)):
    """Get member profile"""
    return {
        "id": member["id"],
        "name": member.get("name"),
        "name_ar": member.get("name_ar"),
        "phone": member.get("phone"),
        "email": member.get("email"),
        "member_code": member.get("member_code"),
        "date_of_birth": member.get("date_of_birth"),
        "gender": member.get("gender"),
        "address": member.get("address"),
        "emergency_contact": member.get("emergency_contact"),
        "created_at": member.get("created_at")
    }


# ============ SUBSCRIPTIONS ============

@router.get("/subscriptions")
async def get_member_subscriptions(member: dict = Depends(get_current_member)):
    """Get all subscriptions (active and expired)"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    # Get all paid invoices for this member
    invoices = await db.invoices.find(
        {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
    active_subscriptions = []
    expired_subscriptions = []
    
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("activity_id"):
                # Parse dates from period field
                end_date = item.get("end_date", "")
                start_date = item.get("start_date", "")
                
                if not end_date and item.get("period"):
                    period = item.get("period", "")
                    if " - " in period:
                        parts = period.split(" - ")
                        if len(parts) == 2:
                            start_date = parts[0].strip()
                            end_date = parts[1].strip()
                
                subscription = {
                    "invoice_id": inv.get("id"),
                    "invoice_number": inv.get("invoice_number"),
                    "activity_id": item.get("activity_id"),
                    "activity_name": item.get("activity_name"),
                    "start_date": start_date,
                    "end_date": end_date,
                    "schedule": item.get("schedule", ""),
                    "fee": item.get("fee", 0),
                    "created_at": inv.get("created_at")
                }
                
                if end_date and end_date >= today:
                    subscription["status"] = "active"
                    active_subscriptions.append(subscription)
                else:
                    subscription["status"] = "expired"
                    expired_subscriptions.append(subscription)
    
    return {
        "active": active_subscriptions,
        "expired": expired_subscriptions,
        "total_active": len(active_subscriptions),
        "total_expired": len(expired_subscriptions)
    }


# ============ SCHEDULE ============

@router.get("/schedule")
async def get_member_schedule(member: dict = Depends(get_current_member)):
    """Get member's training schedule based on active subscriptions"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    # Get active subscriptions
    invoices = await db.invoices.find(
        {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
    schedules = []
    activity_ids = set()
    
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
                
                # Only include active subscriptions
                if end_date and end_date >= today:
                    activity_ids.add(item.get("activity_id"))
                    schedules.append({
                        "activity_id": item.get("activity_id"),
                        "activity_name": item.get("activity_name"),
                        "schedule": item.get("schedule", ""),
                        "end_date": end_date
                    })
    
    # Get activity notes for these activities
    activity_notes = []
    if activity_ids:
        notes = await db.activity_notes.find(
            {"activity_id": {"$in": list(activity_ids)}},
            {"_id": 0}
        ).sort("date", -1).to_list(50)
        activity_notes = notes
    
    return {
        "schedules": schedules,
        "activity_notes": activity_notes
    }


# ============ INVOICES ============

@router.get("/invoices")
async def get_member_invoices(member: dict = Depends(get_current_member)):
    """Get all invoices for the member"""
    invoices = await db.invoices.find(
        {"member_id": member["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return {"invoices": invoices}


@router.get("/invoices/{invoice_id}")
async def get_invoice_details(invoice_id: str, member: dict = Depends(get_current_member)):
    """Get single invoice details"""
    invoice = await db.invoices.find_one(
        {"id": invoice_id, "member_id": member["id"]},
        {"_id": 0}
    )
    
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    return invoice


# ============ QR CARD ============

@router.get("/qr-card")
async def get_qr_card_data(member: dict = Depends(get_current_member)):
    """Get QR card data for the member"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    # Get active subscriptions
    invoices = await db.invoices.find(
        {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
    active_activities = []
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
                
                if end_date and end_date >= today:
                    active_activities.append({
                        "activity_name": item.get("activity_name"),
                        "end_date": end_date
                    })
    
    return {
        "id": member["id"],
        "name": member.get("name"),
        "name_ar": member.get("name_ar"),
        "member_code": member.get("member_code"),
        "phone": member.get("phone"),
        "active_activities": active_activities,
        "qr_data": {
            "type": "WCPA_MEMBER",
            "id": member["id"],
            "code": member.get("member_code"),
            "name": member.get("name_ar")
        }
    }


# ============ NOTIFICATIONS ============

@router.get("/notifications")
async def get_member_notifications(member: dict = Depends(get_current_member)):
    """Get notifications for the member"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    notifications = []
    
    # Check for expiring subscriptions (within 7 days)
    invoices = await db.invoices.find(
        {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
    seven_days_later = (datetime.now(timezone.utc) + timedelta(days=7)).strftime('%Y-%m-%d')
    
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
                
                if end_date:
                    # Expiring soon (within 7 days)
                    if today <= end_date <= seven_days_later:
                        notifications.append({
                            "id": str(uuid.uuid4()),
                            "type": "expiring_soon",
                            "title": "اشتراك على وشك الانتهاء",
                            "message": f"اشتراك {item.get('activity_name')} سينتهي في {end_date}",
                            "activity_name": item.get("activity_name"),
                            "end_date": end_date,
                            "priority": "warning",
                            "created_at": datetime.now(timezone.utc).isoformat()
                        })
                    # Already expired
                    elif end_date < today:
                        notifications.append({
                            "id": str(uuid.uuid4()),
                            "type": "expired",
                            "title": "اشتراك منتهي",
                            "message": f"انتهى اشتراك {item.get('activity_name')} في {end_date}",
                            "activity_name": item.get("activity_name"),
                            "end_date": end_date,
                            "priority": "danger",
                            "created_at": datetime.now(timezone.utc).isoformat()
                        })
    
    # Get general notifications/offers
    general_notifications = await db.notifications.find(
        {"$or": [
            {"target": "all_members"},
            {"target_members": member["id"]}
        ]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20)
    
    for notif in general_notifications:
        notifications.append({
            "id": notif.get("id"),
            "type": notif.get("type", "info"),
            "title": notif.get("title"),
            "message": notif.get("message"),
            "priority": notif.get("priority", "info"),
            "created_at": notif.get("created_at")
        })
    
    # Sort by priority and date
    priority_order = {"danger": 0, "warning": 1, "info": 2}
    notifications.sort(key=lambda x: (priority_order.get(x.get("priority"), 3), x.get("created_at", "")), reverse=True)
    
    return {
        "notifications": notifications,
        "unread_count": len([n for n in notifications if n.get("priority") in ["danger", "warning"]])
    }


# ============ ATTENDANCE HISTORY ============

@router.get("/attendance")
async def get_member_attendance(member: dict = Depends(get_current_member)):
    """Get attendance history for the member"""
    attendance = await db.attendance.find(
        {"member_id": member["id"]},
        {"_id": 0}
    ).sort("date", -1).to_list(100)
    
    return {"attendance": attendance}


# ============ REGISTRATION FORMS ============

@router.get("/registration-forms")
async def get_member_registration_forms(member: dict = Depends(get_current_member)):
    """Get registration forms for the member"""
    phone = member.get("phone")
    
    # Find registration forms by phone number
    forms = await db.registration_forms.find(
        {"customer_phone": phone},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    
    return {"forms": forms}


@router.get("/registration-forms/{form_id}")
async def get_registration_form_details(form_id: str, member: dict = Depends(get_current_member)):
    """Get single registration form details"""
    phone = member.get("phone")
    
    form = await db.registration_forms.find_one(
        {"id": form_id, "customer_phone": phone},
        {"_id": 0}
    )
    
    if not form:
        raise HTTPException(status_code=404, detail="Registration form not found")
    
    return form


@router.get("/my-schedule")
async def get_member_full_schedule(member: dict = Depends(get_current_member)):
    """Get complete training schedule from registration forms and invoices"""
    phone = member.get("phone")
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    schedules = []
    
    # Get from registration forms
    forms = await db.registration_forms.find(
        {"customer_phone": phone},
        {"_id": 0}
    ).to_list(50)
    
    for form in forms:
        for item in form.get("items", []):
            if item.get("activity_id") and item.get("schedule"):
                end_date = item.get("end_date", "")
                start_date = item.get("start_date", "")
                
                if not end_date and item.get("period"):
                    period = item.get("period", "")
                    if " - " in period:
                        parts = period.split(" - ")
                        if len(parts) == 2:
                            start_date = parts[0].strip()
                            end_date = parts[1].strip()
                
                status = "active" if end_date and end_date >= today else "expired"
                
                schedules.append({
                    "source": "registration_form",
                    "form_number": form.get("form_number"),
                    "activity_name": item.get("activity_name"),
                    "schedule": item.get("schedule"),
                    "start_date": start_date,
                    "end_date": end_date,
                    "status": status
                })
    
    # Get from invoices (for items with schedule)
    invoices = await db.invoices.find(
        {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("activity_id") and item.get("schedule"):
                end_date = item.get("end_date", "")
                start_date = item.get("start_date", "")
                
                if not end_date and item.get("period"):
                    period = item.get("period", "")
                    if " - " in period:
                        parts = period.split(" - ")
                        if len(parts) == 2:
                            start_date = parts[0].strip()
                            end_date = parts[1].strip()
                
                status = "active" if end_date and end_date >= today else "expired"
                
                # Check if not already added from registration form
                already_exists = any(
                    s.get("activity_name") == item.get("activity_name") and 
                    s.get("start_date") == start_date 
                    for s in schedules
                )
                
                if not already_exists:
                    schedules.append({
                        "source": "invoice",
                        "invoice_number": inv.get("invoice_number"),
                        "activity_name": item.get("activity_name"),
                        "schedule": item.get("schedule"),
                        "start_date": start_date,
                        "end_date": end_date,
                        "status": status
                    })
    
    # Sort by status (active first) then by end_date
    schedules.sort(key=lambda x: (0 if x.get("status") == "active" else 1, x.get("end_date", "")), reverse=True)
    
    return {
        "schedules": schedules,
        "active_count": len([s for s in schedules if s.get("status") == "active"]),
        "expired_count": len([s for s in schedules if s.get("status") == "expired"])
    }

