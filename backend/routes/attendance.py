"""Attendance routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user

router = APIRouter(prefix="/attendance", tags=["attendance"])

# Loyalty points helper function (will be set from server.py)
loyalty_award_points = None

def set_loyalty_award_function(func):
    global loyalty_award_points
    loyalty_award_points = func

async def award_attendance_points(member_id: str):
    """Award points for attendance and check for streaks"""
    if not loyalty_award_points:
        return
    
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)
    
    # Get member points record
    member_points = await db.member_points.find_one({"member_id": member_id})
    
    current_streak = 1
    if member_points:
        last_date = member_points.get('last_attendance_date')
        if last_date:
            try:
                last_date = datetime.fromisoformat(last_date.replace('Z', '+00:00')).date()
                if last_date == yesterday:
                    # Consecutive day, increase streak
                    current_streak = member_points.get('attendance_streak', 0) + 1
                elif last_date == today:
                    # Already awarded today
                    return
            except Exception:
                pass
    
    # Update streak and last attendance date
    await db.member_points.update_one(
        {"member_id": member_id},
        {
            "$set": {
                "attendance_streak": current_streak,
                "last_attendance_date": today.isoformat()
            }
        },
        upsert=True
    )
    
    # Award attendance points
    await loyalty_award_points(
        member_id,
        "attendance",
        "نقاط الحضور اليومي",
        "Daily attendance points"
    )
    
    # Check for streak bonuses
    if current_streak == 5:
        await loyalty_award_points(
            member_id,
            "streak_5",
            "مكافأة 5 أيام حضور متتالية! 🔥",
            "5-day attendance streak bonus! 🔥"
        )
    elif current_streak == 10:
        await loyalty_award_points(
            member_id,
            "streak_10",
            "مكافأة 10 أيام حضور متتالية! 🔥🔥",
            "10-day attendance streak bonus! 🔥🔥"
        )
    elif current_streak == 20:
        await loyalty_award_points(
            member_id,
            "streak_10",
            "مكافأة 20 يوم حضور متتالي! 🏆",
            "20-day attendance streak bonus! 🏆",
            150  # Custom points for 20 days
        )

# ============ MODELS ============

class AttendanceCreate(BaseModel):
    member_id: str
    activity_id: str
    date: Optional[str] = None
    check_in_time: Optional[str] = None
    notes: Optional[str] = ""

class AttendanceRecord(BaseModel):
    id: str
    member_id: str
    member_name: Optional[str] = ""
    member_code: Optional[str] = ""
    phone: Optional[str] = ""
    activity_id: str
    activity_name: Optional[str] = ""
    date: str
    check_in_time: str
    notes: Optional[str] = ""
    branch_id: Optional[str] = None
    recorded_by: Optional[str] = ""
    created_at: str

# ============ ROUTES ============

@router.get("")
async def get_attendance(
    date: Optional[str] = None,
    activity_id: Optional[str] = None,
    member_id: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get attendance records with optional filters"""
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    
    # Branch filtering
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
    if date:
        query["date"] = date
    if activity_id:
        query["activity_id"] = activity_id
    if member_id:
        query["member_id"] = member_id
    
    records = await db.attendance.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return records

@router.post("")
async def create_attendance(
    attendance: AttendanceCreate,
    current_user: dict = Depends(get_current_user)
):
    """Record attendance for a member"""
    branch_id = current_user.get("branch_id")
    user_name = current_user.get("name", current_user.get("username", ""))
    
    # Get member info
    member = await db.members.find_one({"id": attendance.member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    
    # Get activity info
    activity = await db.activities.find_one({"id": attendance.activity_id}, {"_id": 0})
    activity_name = activity.get("name_ar", "") if activity else ""
    
    # Use provided date or today
    record_date = attendance.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    check_in_time = attendance.check_in_time or datetime.now(timezone.utc).strftime("%H:%M")
    
    # Check if already checked in today for this activity
    existing = await db.attendance.find_one({
        "member_id": attendance.member_id,
        "activity_id": attendance.activity_id,
        "date": record_date
    })
    if existing:
        raise HTTPException(status_code=400, detail="Already checked in for this activity today")
    
    record_id = str(uuid.uuid4())
    record = {
        "id": record_id,
        "member_id": attendance.member_id,
        "member_name": member.get("name_ar", member.get("name", "")),
        "member_code": member.get("member_code", ""),
        "phone": member.get("phone", ""),
        "activity_id": attendance.activity_id,
        "activity_name": activity_name,
        "date": record_date,
        "check_in_time": check_in_time,
        "notes": attendance.notes,
        "branch_id": branch_id,
        "recorded_by": user_name,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.attendance.insert_one(record)
    
    # Award loyalty points for attendance
    if loyalty_award_points:
        try:
            await award_attendance_points(attendance.member_id)
        except Exception as e:
            print(f"Error awarding loyalty points: {e}")
    
    return {"message": "Attendance recorded", "record": {k: v for k, v in record.items() if k != "_id"}}

@router.post("/qr-checkin")
async def qr_checkin(
    member_code: str,
    activity_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Quick check-in via QR code scan"""
    branch_id = current_user.get("branch_id")
    user_name = current_user.get("name", current_user.get("username", ""))
    
    # Find member by code or phone
    member = await db.members.find_one(
        {"$or": [{"member_code": member_code}, {"phone": member_code}]},
        {"_id": 0}
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    check_in_time = datetime.now(timezone.utc).strftime("%H:%M")
    
    # Determine which activity to check in for
    target_activity_id = activity_id
    activity_name = ""
    
    if not target_activity_id:
        # Use first active activity
        activities = member.get("activities", [])
        active_activities = [a for a in activities if a.get("status") == "active"]
        if active_activities:
            target_activity_id = active_activities[0].get("activity_id")
            activity_name = active_activities[0].get("activity_name", "")
    
    if not target_activity_id:
        raise HTTPException(status_code=400, detail="No active activity found for member")
    
    # Get activity name if not already set
    if not activity_name:
        activity = await db.activities.find_one({"id": target_activity_id}, {"_id": 0})
        activity_name = activity.get("name_ar", "") if activity else ""
    
    # Check if already checked in today
    existing = await db.attendance.find_one({
        "member_id": member["id"],
        "activity_id": target_activity_id,
        "date": today
    })
    if existing:
        return {
            "message": "Already checked in today",
            "status": "already_checked_in",
            "member": {
                "name": member.get("name_ar", member.get("name", "")),
                "member_code": member.get("member_code", ""),
                "activity": activity_name
            }
        }
    
    # Create attendance record
    record_id = str(uuid.uuid4())
    record = {
        "id": record_id,
        "member_id": member["id"],
        "member_name": member.get("name_ar", member.get("name", "")),
        "member_code": member.get("member_code", ""),
        "phone": member.get("phone", ""),
        "activity_id": target_activity_id,
        "activity_name": activity_name,
        "date": today,
        "check_in_time": check_in_time,
        "notes": "QR Check-in",
        "branch_id": branch_id,
        "recorded_by": user_name,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.attendance.insert_one(record)
    
    # Award loyalty points for attendance
    if loyalty_award_points:
        try:
            await award_attendance_points(member["id"])
        except Exception as e:
            print(f"Error awarding loyalty points: {e}")
    
    return {
        "message": "Check-in successful",
        "status": "success",
        "member": {
            "name": member.get("name_ar", member.get("name", "")),
            "member_code": member.get("member_code", ""),
            "activity": activity_name
        }
    }

@router.delete("/{record_id}")
async def delete_attendance(
    record_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete an attendance record"""
    result = await db.attendance.delete_one({"id": record_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Attendance record not found")
    return {"message": "Attendance record deleted"}

@router.get("/member/{member_id}/report")
async def get_member_attendance_report(
    member_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get attendance report for a specific member"""
    query = {"member_id": member_id}
    
    if date_from:
        query["date"] = {"$gte": date_from}
    if date_to:
        if "date" in query:
            query["date"]["$lte"] = date_to
        else:
            query["date"] = {"$lte": date_to}
    
    records = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    
    # Calculate summary
    total_days = len(records)
    activities_count = {}
    for record in records:
        act_name = record.get("activity_name", "Unknown")
        activities_count[act_name] = activities_count.get(act_name, 0) + 1
    
    return {
        "member_id": member_id,
        "total_attendance": total_days,
        "by_activity": activities_count,
        "records": records
    }

@router.get("/activity/{activity_id}/report")
async def get_activity_attendance_report(
    activity_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get attendance report for a specific activity"""
    query = {"activity_id": activity_id}
    
    if date_from:
        query["date"] = {"$gte": date_from}
    if date_to:
        if "date" in query:
            query["date"]["$lte"] = date_to
        else:
            query["date"] = {"$lte": date_to}
    
    records = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    
    # Group by date
    by_date = {}
    for record in records:
        date = record.get("date", "")
        if date not in by_date:
            by_date[date] = []
        by_date[date].append(record)
    
    return {
        "activity_id": activity_id,
        "total_attendance": len(records),
        "unique_members": len(set(r.get("member_id") for r in records)),
        "by_date": by_date,
        "records": records
    }
