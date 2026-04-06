"""
Coach Attendance API Routes
Handles coach/trainer attendance tracking (check-in, check-out, reports)
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import uuid

from database import db
from utils.auth import get_current_user

router = APIRouter(prefix="/coach-attendance", tags=["Coach Attendance"])

SAUDI_OFFSET = timedelta(hours=3)

def get_saudi_now():
    return datetime.now(timezone.utc) + SAUDI_OFFSET

class CheckInRequest(BaseModel):
    coach_id: str
    date: Optional[str] = None
    check_in_time: Optional[str] = None
    notes: Optional[str] = ""

class CheckOutRequest(BaseModel):
    check_out_time: Optional[str] = None

class MarkAbsentRequest(BaseModel):
    coach_id: str
    date: Optional[str] = None
    status: str = "absent"
    reason: Optional[str] = ""

class UpdateRecordRequest(BaseModel):
    check_in_time: Optional[str] = None
    check_out_time: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    reason: Optional[str] = None


@router.get("")
async def get_coach_attendance(
    date: Optional[str] = None,
    coach_id: Optional[str] = None,
    month: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}

    if date:
        query["date"] = date
    elif month:
        query["date"] = {"$regex": f"^{month}"}
    else:
        query["date"] = get_saudi_now().strftime("%Y-%m-%d")

    if coach_id:
        query["coach_id"] = coach_id

    if branch_filter and branch_filter != "all":
        query["$or"] = [
            {"branch_id": branch_filter},
            {"branch_id": None},
            {"branch_id": {"$exists": False}}
        ]

    records = await db.coach_attendance.find(query, {"_id": 0}).sort("check_in_time", 1).to_list(500)
    return records


@router.post("/check-in")
async def check_in_coach(
    req: CheckInRequest,
    current_user: dict = Depends(get_current_user)
):
    now = get_saudi_now()
    date = req.date or now.strftime("%Y-%m-%d")
    check_in_time = req.check_in_time or now.strftime("%H:%M")

    coach = await db.coaches.find_one({"id": req.coach_id}, {"_id": 0})
    if not coach:
        raise HTTPException(status_code=404, detail="Coach not found")

    existing = await db.coach_attendance.find_one({
        "coach_id": req.coach_id,
        "date": date,
        "status": {"$in": ["present", "checked_out"]}
    })
    if existing:
        raise HTTPException(status_code=400, detail="Coach already checked in for this date")

    await db.coach_attendance.delete_many({
        "coach_id": req.coach_id,
        "date": date,
        "status": {"$in": ["absent", "leave"]}
    })

    record = {
        "id": str(uuid.uuid4()),
        "coach_id": req.coach_id,
        "coach_name": coach.get("name_ar", coach.get("name", "")),
        "coach_phone": coach.get("phone", ""),
        "date": date,
        "check_in_time": check_in_time,
        "check_out_time": None,
        "total_hours": None,
        "status": "present",
        "notes": req.notes or "",
        "reason": "",
        "branch_id": coach.get("branch_id"),
        "recorded_by": current_user.get("name", current_user.get("username", "")),
        "created_at": now.isoformat()
    }

    await db.coach_attendance.insert_one(record)
    record.pop("_id", None)
    return record


@router.post("/{record_id}/check-out")
async def check_out_coach(
    record_id: str,
    req: CheckOutRequest,
    current_user: dict = Depends(get_current_user)
):
    now = get_saudi_now()
    check_out_time = req.check_out_time or now.strftime("%H:%M")

    record = await db.coach_attendance.find_one({"id": record_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    if record.get("status") == "checked_out":
        raise HTTPException(status_code=400, detail="Coach already checked out")

    total_hours = None
    if record.get("check_in_time"):
        try:
            cin = datetime.strptime(record["check_in_time"], "%H:%M")
            cout = datetime.strptime(check_out_time, "%H:%M")
            diff = (cout - cin).total_seconds() / 3600
            if diff < 0:
                diff += 24
            total_hours = round(diff, 2)
        except:
            pass

    await db.coach_attendance.update_one(
        {"id": record_id},
        {"$set": {
            "check_out_time": check_out_time,
            "total_hours": total_hours,
            "status": "checked_out"
        }}
    )

    return {
        "message": "Check-out recorded",
        "check_out_time": check_out_time,
        "total_hours": total_hours
    }


@router.post("/mark-absent")
async def mark_absent(
    req: MarkAbsentRequest,
    current_user: dict = Depends(get_current_user)
):
    now = get_saudi_now()
    date = req.date or now.strftime("%Y-%m-%d")

    coach = await db.coaches.find_one({"id": req.coach_id}, {"_id": 0})
    if not coach:
        raise HTTPException(status_code=404, detail="Coach not found")

    existing = await db.coach_attendance.find_one({
        "coach_id": req.coach_id,
        "date": date,
        "status": {"$in": ["present", "checked_out"]}
    })
    if existing:
        raise HTTPException(status_code=400, detail="Coach already has attendance for this date")

    await db.coach_attendance.delete_many({
        "coach_id": req.coach_id,
        "date": date,
        "status": {"$in": ["absent", "leave"]}
    })

    record = {
        "id": str(uuid.uuid4()),
        "coach_id": req.coach_id,
        "coach_name": coach.get("name_ar", coach.get("name", "")),
        "coach_phone": coach.get("phone", ""),
        "date": date,
        "check_in_time": None,
        "check_out_time": None,
        "total_hours": None,
        "status": req.status,
        "notes": "",
        "reason": req.reason or "",
        "branch_id": coach.get("branch_id"),
        "recorded_by": current_user.get("name", current_user.get("username", "")),
        "created_at": now.isoformat()
    }

    await db.coach_attendance.insert_one(record)
    record.pop("_id", None)
    return record


@router.put("/{record_id}")
async def update_record(
    record_id: str,
    req: UpdateRecordRequest,
    current_user: dict = Depends(get_current_user)
):
    record = await db.coach_attendance.find_one({"id": record_id})
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    updates = {}
    if req.check_in_time is not None:
        updates["check_in_time"] = req.check_in_time
    if req.check_out_time is not None:
        updates["check_out_time"] = req.check_out_time
    if req.notes is not None:
        updates["notes"] = req.notes
    if req.status is not None:
        updates["status"] = req.status
    if req.reason is not None:
        updates["reason"] = req.reason

    cin = req.check_in_time or record.get("check_in_time")
    cout = req.check_out_time or record.get("check_out_time")
    if cin and cout:
        try:
            c1 = datetime.strptime(cin, "%H:%M")
            c2 = datetime.strptime(cout, "%H:%M")
            diff = (c2 - c1).total_seconds() / 3600
            if diff < 0:
                diff += 24
            updates["total_hours"] = round(diff, 2)
        except:
            pass

    if updates:
        await db.coach_attendance.update_one({"id": record_id}, {"$set": updates})

    updated = await db.coach_attendance.find_one({"id": record_id}, {"_id": 0})
    return updated


@router.delete("/{record_id}")
async def delete_record(
    record_id: str,
    current_user: dict = Depends(get_current_user)
):
    result = await db.coach_attendance.delete_one({"id": record_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Record not found")
    return {"message": "Record deleted"}


@router.get("/monthly-report")
async def monthly_report(
    month: str,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {"date": {"$regex": f"^{month}"}}
    if branch_filter and branch_filter != "all":
        query["$or"] = [
            {"branch_id": branch_filter},
            {"branch_id": None},
            {"branch_id": {"$exists": False}}
        ]

    records = await db.coach_attendance.find(query, {"_id": 0}).to_list(5000)

    coach_query = {}
    if branch_filter and branch_filter != "all":
        coach_query = {"$or": [
            {"branch_id": branch_filter},
            {"branch_id": None},
            {"branch_id": {"$exists": False}}
        ]}
    coaches = await db.coaches.find(coach_query, {"_id": 0}).to_list(100)

    report = {}
    for coach in coaches:
        cid = coach["id"]
        coach_records = [r for r in records if r.get("coach_id") == cid]
        present_days = len([r for r in coach_records if r.get("status") in ("present", "checked_out")])
        absent_days = len([r for r in coach_records if r.get("status") == "absent"])
        leave_days = len([r for r in coach_records if r.get("status") == "leave"])
        total_hours = sum(r.get("total_hours", 0) or 0 for r in coach_records)

        report[cid] = {
            "coach_id": cid,
            "coach_name": coach.get("name_ar", coach.get("name", "")),
            "present_days": present_days,
            "absent_days": absent_days,
            "leave_days": leave_days,
            "total_hours": round(total_hours, 2),
            "records": coach_records
        }

    return {"month": month, "report": list(report.values())}


# ══════════════════════════════════════════════════════
#  PUBLIC QR CHECK-IN / CHECK-OUT  (no auth required)
# ══════════════════════════════════════════════════════

@router.get("/qr-status/{coach_id}")
async def get_coach_qr_status(coach_id: str):
    """Public endpoint: returns coach name + today's attendance status for QR scan page."""
    coach = await db.coaches.find_one({"id": coach_id}, {"_id": 0})
    if not coach:
        raise HTTPException(status_code=404, detail="المدرب غير موجود")

    today = get_saudi_now().strftime("%Y-%m-%d")
    record = await db.coach_attendance.find_one(
        {"coach_id": coach_id, "date": today},
        {"_id": 0}
    )

    return {
        "coach_id": coach_id,
        "coach_name": coach.get("name_ar", coach.get("name", "")),
        "coach_phone": coach.get("phone", ""),
        "today": today,
        "status": record.get("status") if record else None,
        "check_in_time": record.get("check_in_time") if record else None,
        "check_out_time": record.get("check_out_time") if record else None,
        "total_hours": record.get("total_hours") if record else None,
        "record_id": record.get("id") if record else None,
    }


@router.post("/qr-checkin/{coach_id}")
async def qr_checkin_coach(coach_id: str):
    """Public endpoint: check in (if not yet) or check out (if present) via QR scan."""
    now = get_saudi_now()
    today = now.strftime("%Y-%m-%d")
    current_time = now.strftime("%H:%M")

    coach = await db.coaches.find_one({"id": coach_id}, {"_id": 0})
    if not coach:
        raise HTTPException(status_code=404, detail="المدرب غير موجود")

    coach_name = coach.get("name_ar", coach.get("name", ""))

    # Look for today's record
    record = await db.coach_attendance.find_one({"coach_id": coach_id, "date": today})

    # ── Already checked out ──────────────────────────────
    if record and record.get("status") == "checked_out":
        return {
            "action": "already_out",
            "coach_name": coach_name,
            "check_in_time": record.get("check_in_time"),
            "check_out_time": record.get("check_out_time"),
            "total_hours": record.get("total_hours"),
            "message": f"تم تسجيل انصرافك مسبقاً في {record.get('check_out_time', '')}"
        }

    # ── Present → Check out ──────────────────────────────
    if record and record.get("status") == "present":
        total_hours = None
        try:
            cin = datetime.strptime(record["check_in_time"], "%H:%M")
            cout = datetime.strptime(current_time, "%H:%M")
            diff = (cout - cin).total_seconds() / 3600
            if diff < 0:
                diff += 24
            total_hours = round(diff, 2)
        except Exception:
            pass

        await db.coach_attendance.update_one(
            {"id": record["id"]},
            {"$set": {
                "check_out_time": current_time,
                "total_hours": total_hours,
                "status": "checked_out"
            }}
        )
        return {
            "action": "checked_out",
            "coach_name": coach_name,
            "check_in_time": record.get("check_in_time"),
            "check_out_time": current_time,
            "total_hours": total_hours,
            "message": f"تم تسجيل انصرافك بنجاح — {current_time}"
        }

    # ── Not present → Check in ───────────────────────────
    # Remove any absent/leave records for today first
    await db.coach_attendance.delete_many({
        "coach_id": coach_id,
        "date": today,
        "status": {"$in": ["absent", "leave"]}
    })

    new_record = {
        "id": str(uuid.uuid4()),
        "coach_id": coach_id,
        "coach_name": coach_name,
        "coach_phone": coach.get("phone", ""),
        "date": today,
        "check_in_time": current_time,
        "check_out_time": None,
        "total_hours": None,
        "status": "present",
        "notes": "تسجيل عبر QR",
        "reason": "",
        "branch_id": coach.get("branch_id"),
        "recorded_by": "QR",
        "created_at": now.isoformat()
    }
    await db.coach_attendance.insert_one(new_record)
    new_record.pop("_id", None)

    return {
        "action": "checked_in",
        "coach_name": coach_name,
        "check_in_time": current_time,
        "check_out_time": None,
        "total_hours": None,
        "message": f"تم تسجيل حضورك بنجاح — {current_time}"
    }
