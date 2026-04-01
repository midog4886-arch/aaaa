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
import os
import jwt
import uuid

router = APIRouter(prefix="/api/member-portal", tags=["Member Portal"])
security = HTTPBearer()

# Use centralized database connection
from database import db

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
    """Get all subscriptions from member's activities data"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    # Get member's activities directly from member data
    activities = member.get("activities", [])
    
    active_subscriptions = []
    expired_subscriptions = []
    
    for activity in activities:
        end_date = activity.get("end_date", "")
        start_date = activity.get("start_date", "")
        
        # Get activity details for schedule
        activity_data = await db.activities.find_one(
            {"id": activity.get("activity_id")},
            {"_id": 0, "schedule": 1, "coach_id": 1}
        )
        
        # Get coach name if available
        coach_name = ""
        coach_id = activity.get("coach_id") or (activity_data.get("coach_id") if activity_data else "")
        if coach_id:
            coach = await db.coaches.find_one({"id": coach_id}, {"_id": 0, "name_ar": 1, "name": 1})
            if coach:
                coach_name = coach.get("name_ar") or coach.get("name")
        
        subscription = {
            "activity_id": activity.get("activity_id"),
            "activity_name": activity.get("activity_name"),
            "start_date": start_date,
            "end_date": end_date,
            "schedule": activity.get("schedule") or (activity_data.get("schedule") if activity_data else ""),
            "fee": activity.get("fee", 0),
            "coach_name": coach_name,
            "status": activity.get("status", "")
        }
        
        # Check if active or expired
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
                start_date = item.get("start_date", "")
                if not end_date and item.get("period"):
                    period = item.get("period", "")
                    if " - " in period:
                        parts = period.split(" - ")
                        if len(parts) == 2:
                            start_date = start_date or parts[0].strip()
                            end_date = parts[1].strip()
                
                if end_date and end_date >= today:
                    active_activities.append({
                        "activity_name": item.get("activity_name"),
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
            "created_at": notif.get("created_at"),
            "is_read": notif.get("is_read", False)
        })
    
    # Get member-specific notifications (videos, loyalty, etc.)
    member_notifs = await db.member_notifications.find(
        {"member_id": member["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    
    for notif in member_notifs:
        notifications.append({
            "id": notif.get("id", str(notif.get("_id", ""))),
            "type": notif.get("type", "info"),
            "title": notif.get("title_ar", notif.get("title", "")),
            "title_ar": notif.get("title_ar", notif.get("title", "")),
            "title_en": notif.get("title", notif.get("title_en", "")),
            "message": notif.get("message_ar", notif.get("message", "")),
            "message_ar": notif.get("message_ar", notif.get("message", "")),
            "message_en": notif.get("message", notif.get("message_en", "")),
            "priority": "info",
            "link": notif.get("link"),
            "created_at": notif.get("created_at"),
            "is_read": notif.get("is_read", False)
        })
    
    # Sort by priority and date (ensure created_at is string)
    priority_order = {"danger": 0, "warning": 1, "info": 2}
    
    def get_sort_key(x):
        created_at = x.get("created_at", "")
        if hasattr(created_at, 'isoformat'):
            created_at = created_at.isoformat()
        return (priority_order.get(x.get("priority"), 3), str(created_at))
    
    notifications.sort(key=get_sort_key, reverse=True)
    
    return {
        "notifications": notifications,
        "unread_count": len([n for n in notifications if n.get("priority") in ["danger", "warning"]])
    }


# ============ TRAINING REMINDERS ============

@router.get("/training-reminders")
async def get_training_reminders(member: dict = Depends(get_current_member)):
    """Get today's training reminders based on active subscriptions and schedules"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    now = datetime.now(timezone.utc)
    
    day_names_ar = {
        0: 'الاثنين', 1: 'الثلاثاء', 2: 'الأربعاء',
        3: 'الخميس', 4: 'الجمعة', 5: 'السبت', 6: 'الأحد'
    }
    day_names_en = {
        0: 'Monday', 1: 'Tuesday', 2: 'Wednesday',
        3: 'Thursday', 4: 'Friday', 5: 'Saturday', 6: 'Sunday'
    }
    today_day_num = now.weekday()
    today_day_ar = day_names_ar.get(today_day_num, '')
    today_day_en = day_names_en.get(today_day_num, '')
    
    reminders = []
    seen_activities = set()
    
    member_activities = member.get("activities", [])
    for act in member_activities:
        activity_id = act.get("activity_id")
        if not activity_id or activity_id in seen_activities:
            continue
        end_date = act.get("end_date", "")
        if not end_date:
            continue
        try:
            if isinstance(end_date, str):
                end_date_parsed = datetime.strptime(end_date[:10], '%Y-%m-%d').date()
            elif isinstance(end_date, datetime):
                end_date_parsed = end_date.date()
            else:
                continue
            if end_date_parsed < now.date():
                continue
        except (ValueError, TypeError):
            continue
        seen_activities.add(activity_id)
        
        schedule_text = act.get("schedule", "")
        activity_data = await db.activities.find_one(
            {"id": activity_id}, {"_id": 0, "schedule": 1, "name": 1, "name_ar": 1}
        )
        if not schedule_text and activity_data:
            schedule_text = activity_data.get("schedule", "")
        
        is_today = False
        if schedule_text:
            schedule_lower = schedule_text.lower()
            if today_day_ar in schedule_text or today_day_en.lower() in schedule_lower:
                is_today = True
            for day_ar in day_names_ar.values():
                if day_ar in schedule_text:
                    break
            else:
                if schedule_text.strip():
                    is_today = True
        
        if is_today:
            import re
            time_patterns = re.findall(r'(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|ص|م)?)', schedule_text)
            reminders.append({
                "id": str(uuid.uuid4()),
                "activity_id": activity_id,
                "activity_name": act.get("activity_name", ""),
                "schedule": schedule_text,
                "time": time_patterns[0] if time_patterns else "",
                "end_date": str(end_date),
                "type": "training_reminder"
            })
    
    invoices = await db.invoices.find(
        {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
    for inv in invoices:
        for item in inv.get("items", []):
            if not item.get("activity_id"):
                continue
            
            activity_id = item.get("activity_id")
            if activity_id in seen_activities:
                continue
                
            end_date = item.get("end_date", "")
            if not end_date and item.get("period"):
                period = item.get("period", "")
                if " - " in period:
                    parts = period.split(" - ")
                    if len(parts) == 2:
                        end_date = parts[1].strip()
            
            if not end_date:
                continue
            try:
                if isinstance(end_date, str):
                    end_date_parsed = datetime.strptime(end_date[:10], '%Y-%m-%d').date()
                elif isinstance(end_date, datetime):
                    end_date_parsed = end_date.date()
                else:
                    continue
                if end_date_parsed < now.date():
                    continue
            except (ValueError, TypeError):
                continue
            
            seen_activities.add(activity_id)
            
            schedule_text = item.get("schedule", "")
            activity_data = await db.activities.find_one(
                {"id": activity_id}, {"_id": 0, "schedule": 1, "name": 1, "name_ar": 1}
            )
            if not schedule_text and activity_data:
                schedule_text = activity_data.get("schedule", "")
            
            is_today = False
            if schedule_text:
                schedule_lower = schedule_text.lower()
                if today_day_ar in schedule_text or today_day_en.lower() in schedule_lower:
                    is_today = True
                for day_ar in day_names_ar.values():
                    if day_ar in schedule_text:
                        break
                else:
                    if schedule_text.strip():
                        is_today = True
            
            if is_today:
                time_match = ""
                import re
                time_patterns = re.findall(r'(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|ص|م)?)', schedule_text)
                if time_patterns:
                    time_match = time_patterns[0]
                
                reminders.append({
                    "id": str(uuid.uuid4()),
                    "activity_id": activity_id,
                    "activity_name": item.get("activity_name", ""),
                    "schedule": schedule_text,
                    "time": time_match,
                    "end_date": end_date,
                    "type": "training_reminder"
                })
    
    today_attendance = await db.attendance.find(
        {"member_id": member["id"], "date": today},
        {"_id": 0}
    ).to_list(10)
    
    attended_activities = {a.get("activity_id") for a in today_attendance}
    
    for reminder in reminders:
        reminder["already_attended"] = reminder["activity_id"] in attended_activities
    
    return {
        "reminders": reminders,
        "today": today,
        "day_name_ar": today_day_ar,
        "day_name_en": today_day_en,
        "total": len(reminders)
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


# ============ ATTENDANCE STATS ============

@router.get("/attendance-stats")
async def get_member_attendance_stats(member: dict = Depends(get_current_member)):
    """Get attendance statistics for the member"""
    from datetime import datetime, timedelta
    
    # Get current month dates
    today = datetime.now(timezone.utc)
    first_day_of_month = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    first_day_str = first_day_of_month.strftime('%Y-%m-%d')
    today_str = today.strftime('%Y-%m-%d')
    
    # Get last month dates
    last_month = first_day_of_month - timedelta(days=1)
    first_day_last_month = last_month.replace(day=1)
    first_day_last_month_str = first_day_last_month.strftime('%Y-%m-%d')
    last_day_last_month_str = last_month.strftime('%Y-%m-%d')
    
    # Get attendance for this month
    this_month_attendance = await db.attendance.find(
        {
            "member_id": member["id"],
            "date": {"$gte": first_day_str, "$lte": today_str}
        },
        {"_id": 0}
    ).to_list(100)
    
    # Get attendance for last month
    last_month_attendance = await db.attendance.find(
        {
            "member_id": member["id"],
            "date": {"$gte": first_day_last_month_str, "$lte": last_day_last_month_str}
        },
        {"_id": 0}
    ).to_list(100)
    
    # Get all-time attendance
    total_attendance = await db.attendance.count_documents({"member_id": member["id"]})
    
    # Group by activity for this month
    activities_count = {}
    for att in this_month_attendance:
        activity_name = att.get("activity_name", "غير محدد")
        activities_count[activity_name] = activities_count.get(activity_name, 0) + 1
    
    # Recent attendance (last 10)
    recent_attendance = await db.attendance.find(
        {"member_id": member["id"]},
        {"_id": 0}
    ).sort("date", -1).to_list(10)
    
    return {
        "this_month": {
            "count": len(this_month_attendance),
            "month_name": today.strftime('%B %Y'),
            "activities": activities_count
        },
        "last_month": {
            "count": len(last_month_attendance),
            "month_name": last_month.strftime('%B %Y')
        },
        "total": total_attendance,
        "recent": recent_attendance
    }


# ============ COACH RATINGS ============

class CoachRatingCreate(BaseModel):
    coach_id: Optional[str] = None
    coach_name: Optional[str] = None  # For manual entry
    activity_id: Optional[str] = None
    activity_name: Optional[str] = None  # For manual entry
    rating: int  # 1-5 stars
    comment: Optional[str] = None

@router.get("/coaches-to-rate")
async def get_coaches_to_rate(member: dict = Depends(get_current_member)):
    """Get list of coaches the member can rate based on their subscriptions"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    # Get active subscriptions
    invoices = await db.invoices.find(
        {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
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
                
                # Include both active and recently expired (last 30 days)
                if end_date:
                    activity_ids.add(item.get("activity_id"))
    
    # Get coaches for these activities
    coaches = []
    if activity_ids:
        activities = await db.activities.find(
            {"id": {"$in": list(activity_ids)}},
            {"_id": 0}
        ).to_list(100)
        
        coach_ids = set()
        for act in activities:
            if act.get("coach_id"):
                coach_ids.add(act.get("coach_id"))
        
        if coach_ids:
            coaches_data = await db.coaches.find(
                {"id": {"$in": list(coach_ids)}},
                {"_id": 0}
            ).to_list(50)
            
            for coach in coaches_data:
                # Get existing rating from this member
                existing_rating = await db.coach_ratings.find_one(
                    {"member_id": member["id"], "coach_id": coach["id"]},
                    {"_id": 0}
                )
                
                # Get coach's activities
                coach_activities = [a for a in activities if a.get("coach_id") == coach["id"]]
                
                coaches.append({
                    "id": coach["id"],
                    "name": coach.get("name"),
                    "name_ar": coach.get("name_ar"),
                    "specialization": coach.get("specialization"),
                    "activities": [{"id": a["id"], "name": a.get("name_ar") or a.get("name")} for a in coach_activities],
                    "my_rating": existing_rating
                })
    
    return {"coaches": coaches}


@router.get("/all-coaches")
async def get_all_coaches_for_rating(member: dict = Depends(get_current_member)):
    """Get all coaches for manual rating selection"""
    coaches = await db.coaches.find({}, {"_id": 0}).to_list(100)
    
    # Get all activities
    activities = await db.activities.find({}, {"_id": 0}).to_list(100)
    
    result = []
    for coach in coaches:
        # Get existing rating from this member
        existing_rating = await db.coach_ratings.find_one(
            {"member_id": member["id"], "coach_id": coach["id"]},
            {"_id": 0}
        )
        
        # Get coach's activities
        coach_activities = [a for a in activities if a.get("coach_id") == coach["id"]]
        
        result.append({
            "id": coach["id"],
            "name": coach.get("name"),
            "name_ar": coach.get("name_ar"),
            "specialization": coach.get("specialization"),
            "activities": [{"id": a["id"], "name": a.get("name_ar") or a.get("name")} for a in coach_activities],
            "my_rating": existing_rating
        })
    
    return {"coaches": result}


@router.get("/all-activities")
async def get_all_activities_for_rating(member: dict = Depends(get_current_member)):
    """Get all activities for manual rating selection"""
    activities = await db.activities.find({}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1}).to_list(100)
    return {"activities": activities}


@router.post("/rate-coach")
async def rate_coach(data: CoachRatingCreate, member: dict = Depends(get_current_member)):
    """Submit or update coach rating"""
    if data.rating < 1 or data.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    
    # Get coach name if coach_id provided
    coach_name = data.coach_name
    if data.coach_id:
        coach = await db.coaches.find_one({"id": data.coach_id}, {"_id": 0, "name": 1, "name_ar": 1})
        if coach:
            coach_name = coach.get("name_ar") or coach.get("name")
    
    # Get activity name if activity_id provided
    activity_name = data.activity_name
    if data.activity_id:
        activity = await db.activities.find_one({"id": data.activity_id}, {"_id": 0, "name": 1, "name_ar": 1})
        if activity:
            activity_name = activity.get("name_ar") or activity.get("name")
    
    rating_data = {
        "member_id": member["id"],
        "member_name": member.get("name_ar") or member.get("name"),
        "member_phone": member.get("phone"),
        "coach_id": data.coach_id,
        "coach_name": coach_name,
        "activity_id": data.activity_id,
        "activity_name": activity_name,
        "rating": data.rating,
        "comment": data.comment,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Check if rating exists (by coach_id or coach_name for manual entries)
    existing = None
    if data.coach_id:
        existing = await db.coach_ratings.find_one({
            "member_id": member["id"],
            "coach_id": data.coach_id
        })
    
    if existing:
        await db.coach_ratings.update_one(
            {"member_id": member["id"], "coach_id": data.coach_id},
            {"$set": rating_data}
        )
        message = "تم تحديث التقييم بنجاح"
    else:
        rating_data["id"] = str(uuid.uuid4())
        rating_data["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.coach_ratings.insert_one(rating_data)
        message = "تم إرسال التقييم بنجاح"
    
    return {"message": message}


@router.get("/my-ratings")
async def get_my_ratings(member: dict = Depends(get_current_member)):
    """Get all ratings submitted by this member"""
    ratings = await db.coach_ratings.find(
        {"member_id": member["id"]},
        {"_id": 0}
    ).to_list(50)
    
    # Enrich with coach names
    for rating in ratings:
        coach = await db.coaches.find_one({"id": rating["coach_id"]}, {"_id": 0, "name": 1, "name_ar": 1})
        if coach:
            rating["coach_name"] = coach.get("name_ar") or coach.get("name")
    
    return {"ratings": ratings}


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


class MemberMessageReply(BaseModel):
    body: str


@router.get("/member/messages")
async def get_member_messages(member: dict = Depends(get_current_member)):
    messages = await db.messages.find(
        {"recipient_member_id": member["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(500)

    await db.messages.update_many(
        {"recipient_member_id": member["id"], "sender_type": "admin", "read_by_member": False},
        {"$set": {"read_by_member": True}}
    )

    return {"messages": messages}


@router.post("/member/messages/reply")
async def member_reply(data: MemberMessageReply, member: dict = Depends(get_current_member)):
    import uuid

    last_msg = await db.messages.find_one(
        {"recipient_member_id": member["id"]},
        {"_id": 0, "subject": 1},
        sort=[("created_at", -1)]
    )

    msg_id = str(uuid.uuid4())
    message = {
        "id": msg_id,
        "thread_id": member["id"],
        "sender_type": "member",
        "sender_id": member["id"],
        "sender_name": member.get("name_ar", member.get("name", "")),
        "recipient_member_id": member["id"],
        "recipient_name": "الإدارة",
        "subject": last_msg.get("subject", "رسالة من عضو") if last_msg else "رسالة من عضو",
        "body": data.body,
        "is_broadcast": False,
        "read_by_member": True,
        "read_by_admin": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    await db.messages.insert_one(message)
    return {"message": "تم إرسال الرسالة", "id": msg_id}


@router.get("/member/messages/unread-count")
async def get_member_unread_count(member: dict = Depends(get_current_member)):
    count = await db.messages.count_documents({
        "recipient_member_id": member["id"],
        "sender_type": "admin",
        "read_by_member": False
    })
    return {"unread_count": count}

