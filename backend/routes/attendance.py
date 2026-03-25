"""Attendance routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
import math
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user


async def send_attendance_push(member_id: str, member_name: str, activity_name: str, check_in_time: str):
    """Send push notification to member when attendance is recorded"""
    try:
        from .push_notifications import send_push_notification, NotificationPayload
        sub = await db.push_subscriptions.find_one({"member_id": member_id, "is_active": True})
        if not sub:
            return
        title = "✅ تم تسجيل حضورك"
        body = f"{activity_name} - {check_in_time}" if activity_name else f"وقت الدخول: {check_in_time}"
        payload = NotificationPayload(
            title=title,
            body=body,
            url="/",
            tag=f"attendance-{member_id}",
            data={"type": "attendance"}
        )
        await send_push_notification(sub, payload)
    except Exception as e:
        print(f"send_attendance_push error: {e}")

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
    
    # Check if member has active freeze
    record_date_check = attendance.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    active_freeze = await db.member_freezes.find_one({
        "member_id": attendance.member_id,
        "status": "active",
        "start_date": {"$lte": record_date_check},
        "end_date": {"$gte": record_date_check}
    })
    if active_freeze:
        raise HTTPException(status_code=400, detail=f"عضوية مجمّدة حتى {active_freeze['end_date']} - لا يمكن تسجيل الحضور")
    
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
    
    # Send push notification to member
    try:
        await send_attendance_push(attendance.member_id, record["member_name"], activity_name, check_in_time)
    except Exception as e:
        print(f"Attendance push error: {e}")
    
    return {"message": "Attendance recorded", "record": {k: v for k, v in record.items() if k != "_id"}}

ARABIC_DAY_MAP = {
    "الأحد": "sunday", "الاحد": "sunday", "أحد": "sunday", "احد": "sunday",
    "الإثنين": "monday", "الاثنين": "monday", "إثنين": "monday", "اثنين": "monday",
    "الثلاثاء": "tuesday", "ثلاثاء": "tuesday",
    "الأربعاء": "wednesday", "الاربعاء": "wednesday", "أربعاء": "wednesday", "اربعاء": "wednesday",
    "الخميس": "thursday", "خميس": "thursday",
    "الجمعة": "friday", "جمعة": "friday",
    "السبت": "saturday", "سبت": "saturday"
}

ENGLISH_TO_ARABIC_DAY = {
    "sunday": "الأحد",
    "monday": "الإثنين",
    "tuesday": "الثلاثاء",
    "wednesday": "الأربعاء",
    "thursday": "الخميس",
    "friday": "الجمعة",
    "saturday": "السبت"
}

import re

def parse_schedule_days(schedule_text: str) -> list:
    if not schedule_text:
        return []
    days_found = []
    text = schedule_text.strip()
    for arabic, english in ARABIC_DAY_MAP.items():
        if arabic in text:
            if english not in days_found:
                days_found.append(english)
    eng_days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    for d in eng_days:
        if re.search(r'\b' + d + r'\b', text, re.IGNORECASE):
            if d not in days_found:
                days_found.append(d)
    return days_found

async def get_member_schedule_days(member_id: str, activity_id: str) -> list:
    invoices = await db.invoices.find(
        {"member_id": member_id, "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
    all_days = []
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("activity_id") == activity_id:
                end_date = item.get("end_date", "")
                if end_date and end_date < today_str:
                    continue
                schedule_text = item.get("schedule", "")
                days = parse_schedule_days(schedule_text)
                for d in days:
                    if d not in all_days:
                        all_days.append(d)
    return all_days

async def check_member_session_quota(member_id: str, activity_id: str = None):
    """Check if member has used all their allowed sessions based on subscription days per week"""
    saudi_tz = timezone(timedelta(hours=3))
    today_str = datetime.now(saudi_tz).strftime("%Y-%m-%d")
    
    invoices = await db.invoices.find(
        {"member_id": member_id, "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
    results = []
    
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("is_product"):
                continue
            item_activity_id = item.get("activity_id", "")
            if activity_id and item_activity_id != activity_id:
                continue
            
            start_date = item.get("start_date", "")
            end_date = item.get("end_date", "")
            schedule_text = item.get("schedule", "")
            
            if not end_date or not schedule_text:
                continue
            if end_date < today_str:
                continue
            
            days = parse_schedule_days(schedule_text)
            days_per_week = len(days)
            if days_per_week == 0:
                continue
            
            if not start_date:
                start_date = inv.get("created_at", "")[:10]
            
            try:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d")
                end_dt = datetime.strptime(end_date, "%Y-%m-%d")
                total_weeks = max(1, math.ceil((end_dt - start_dt).days / 7))
                total_allowed_sessions = total_weeks * days_per_week
            except Exception:
                continue
            
            attendance_count = await db.attendance.count_documents({
                "member_id": member_id,
                "activity_id": item_activity_id,
                "date": {"$gte": start_date, "$lte": end_date}
            })
            
            results.append({
                "activity_id": item_activity_id,
                "activity_name": item.get("activity_name", ""),
                "days_per_week": days_per_week,
                "schedule_days": [ENGLISH_TO_ARABIC_DAY.get(d, d) for d in days],
                "total_allowed": total_allowed_sessions,
                "used_sessions": attendance_count,
                "remaining": max(0, total_allowed_sessions - attendance_count),
                "exceeded": attendance_count >= total_allowed_sessions,
                "start_date": start_date,
                "end_date": end_date,
                "invoice_number": inv.get("invoice_number", "")
            })
    
    return results


@router.get("/session-quota/{member_id}")
async def get_member_session_quota(
    member_id: str,
    activity_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    results = await check_member_session_quota(member_id, activity_id)
    return results


@router.get("/session-quota-alerts")
async def get_session_quota_alerts(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all members who have used up their session quota"""
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
    members = await db.members.find(query, {"_id": 0}).to_list(5000)
    
    alerts = []
    for member in members:
        mid = member.get("id")
        activities = member.get("activities", [])
        active_activities = [a for a in activities if a.get("status") == "active"]
        
        for act in active_activities:
            act_id = act.get("activity_id", "")
            if not act_id:
                continue
            quotas = await check_member_session_quota(mid, act_id)
            for q in quotas:
                if q["exceeded"]:
                    alerts.append({
                        "member_id": mid,
                        "member_name": member.get("name_ar", member.get("name", "")),
                        "member_code": member.get("member_code", ""),
                        "phone": member.get("phone", ""),
                        **q
                    })
    
    return alerts


@router.post("/qr-checkin")
async def qr_checkin(
    member_code: str,
    activity_id: Optional[str] = None,
    force: bool = False,
    current_user: dict = Depends(get_current_user)
):
    """Quick check-in via QR code scan with schedule validation"""
    branch_id = current_user.get("branch_id")
    user_name = current_user.get("name", current_user.get("username", ""))
    
    member = await db.members.find_one(
        {"$or": [{"member_code": member_code}, {"phone": member_code}]},
        {"_id": 0}
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    check_in_time = datetime.now(timezone.utc).strftime("%H:%M")
    
    # Check if member has active freeze
    active_freeze = await db.member_freezes.find_one({
        "member_id": member["id"],
        "status": "active",
        "start_date": {"$lte": today},
        "end_date": {"$gte": today}
    })
    if active_freeze:
        return {
            "status": "frozen",
            "message": f"عضوية مجمّدة حتى {active_freeze['end_date']}",
            "member": {
                "name": member.get("name_ar", member.get("name", "")),
                "member_code": member.get("member_code", ""),
                "phone": member.get("phone", "")
            },
            "freeze_end_date": active_freeze["end_date"]
        }
    
    target_activity_id = activity_id
    activity_name = ""
    
    if not target_activity_id:
        activities = member.get("activities", [])
        active_activities = [a for a in activities if a.get("status") == "active"]
        if active_activities:
            target_activity_id = active_activities[0].get("activity_id")
            activity_name = active_activities[0].get("activity_name", "")
    
    if not target_activity_id:
        raise HTTPException(status_code=400, detail="No active activity found for member")
    
    if not activity_name:
        activity = await db.activities.find_one({"id": target_activity_id}, {"_id": 0})
        activity_name = activity.get("name_ar", "") if activity else ""
    
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
    
    schedule_days = await get_member_schedule_days(member["id"], target_activity_id)
    
    saudi_tz = timezone(timedelta(hours=3))
    today_day_name = datetime.now(saudi_tz).strftime("%A").lower()
    
    is_scheduled_day = True
    schedule_days_arabic = []
    
    if schedule_days:
        is_scheduled_day = today_day_name in schedule_days
        schedule_days_arabic = [ENGLISH_TO_ARABIC_DAY.get(d, d) for d in schedule_days]
    
    if not is_scheduled_day and not force:
        return {
            "message": f"هذا ليس موعدك اليوم! مواعيدك: {' - '.join(schedule_days_arabic)}",
            "status": "wrong_day",
            "schedule_days": schedule_days_arabic,
            "today": ENGLISH_TO_ARABIC_DAY.get(today_day_name, today_day_name),
            "member": {
                "name": member.get("name_ar", member.get("name", "")),
                "member_code": member.get("member_code", ""),
                "activity": activity_name
            }
        }
    
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
        "status": "present",
        "check_in_time": check_in_time,
        "notes": "QR Check-in (خارج الموعد)" if (schedule_days and not is_scheduled_day) else "QR Check-in",
        "branch_id": branch_id,
        "recorded_by": user_name,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.attendance.insert_one(record)
    
    if loyalty_award_points:
        try:
            await award_attendance_points(member["id"])
        except Exception as e:
            print(f"Error awarding loyalty points: {e}")
    
    # Send push notification to member
    try:
        await send_attendance_push(member["id"], record["member_name"], activity_name, check_in_time)
    except Exception as e:
        print(f"QR Attendance push error: {e}")
    
    session_quota_warning = None
    try:
        quotas = await check_member_session_quota(member["id"], target_activity_id)
        for q in quotas:
            if q["exceeded"]:
                session_quota_warning = {
                    "message": f"⚠️ استنفد حصصه! ({q['used_sessions']}/{q['total_allowed']})",
                    "used": q["used_sessions"],
                    "total": q["total_allowed"],
                    "activity": q["activity_name"]
                }
                break
            elif q["remaining"] <= 2:
                session_quota_warning = {
                    "message": f"⚠️ متبقي {q['remaining']} حصص فقط ({q['used_sessions']}/{q['total_allowed']})",
                    "used": q["used_sessions"],
                    "total": q["total_allowed"],
                    "remaining": q["remaining"],
                    "activity": q["activity_name"]
                }
                break
    except Exception as e:
        print(f"Error checking session quota: {e}")
    
    response = {
        "message": "Check-in successful",
        "status": "success",
        "member": {
            "name": member.get("name_ar", member.get("name", "")),
            "member_code": member.get("member_code", ""),
            "activity": activity_name
        }
    }
    if session_quota_warning:
        response["session_quota_warning"] = session_quota_warning
    
    return response

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
