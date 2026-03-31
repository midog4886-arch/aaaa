from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user

router = APIRouter(prefix="/freezes", tags=["freezes"])


class FreezeCreate(BaseModel):
    member_id: str
    start_date: str
    end_date: str
    reason: str


@router.post("")
async def create_freeze(freeze: FreezeCreate, current_user: dict = Depends(get_current_user)):
    if freeze.reason not in ("travel", "medical", "personal", "other"):
        raise HTTPException(status_code=400, detail="Invalid reason. Must be travel, medical, personal, or other")

    try:
        start_dt = datetime.strptime(freeze.start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(freeze.end_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    if end_dt < start_dt:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    duration_days = (end_dt - start_dt).days + 1

    member = await db.members.find_one({"id": freeze.member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    overlapping = await db.member_freezes.find_one({
        "member_id": freeze.member_id,
        "status": "active",
        "$or": [
            {"start_date": {"$lte": freeze.end_date}, "end_date": {"$gte": freeze.start_date}}
        ]
    })
    if overlapping:
        raise HTTPException(status_code=400, detail="Overlapping freeze exists for this member")

    year_start = f"{start_dt.year}-01-01"
    year_end = f"{start_dt.year}-12-31"
    year_freezes = await db.member_freezes.find({
        "member_id": freeze.member_id,
        "start_date": {"$gte": year_start, "$lte": year_end}
    }, {"_id": 0}).to_list(100)

    total_frozen_days = sum(f.get("duration_days", 0) for f in year_freezes if f.get("status") != "cancelled")
    if total_frozen_days + duration_days > 30:
        remaining = 30 - total_frozen_days
        raise HTTPException(
            status_code=400,
            detail=f"Exceeds max 30 days per year. Used: {total_frozen_days}, Remaining: {remaining}, Requested: {duration_days}"
        )

    activities = member.get("activities", [])
    for i, act in enumerate(activities):
        act_end = act.get("end_date", "")
        if act_end:
            try:
                act_end_dt = datetime.strptime(act_end, "%Y-%m-%d")
                new_end_dt = act_end_dt + timedelta(days=duration_days)
                activities[i]["end_date"] = new_end_dt.strftime("%Y-%m-%d")
            except ValueError:
                pass

    await db.members.update_one(
        {"id": freeze.member_id},
        {"$set": {"activities": activities}}
    )

    freeze_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    freeze_doc = {
        "id": freeze_id,
        "member_id": freeze.member_id,
        "start_date": freeze.start_date,
        "end_date": freeze.end_date,
        "reason": freeze.reason,
        "duration_days": duration_days,
        "status": "active",
        "created_by": current_user.get("username", current_user.get("name", "")),
        "created_at": now
    }

    await db.member_freezes.insert_one(freeze_doc)

    member_name = member.get("name_ar", member.get("name", ""))
    notification = {
        "id": str(uuid.uuid4()),
        "member_id": freeze.member_id,
        "type": "freeze",
        "title_ar": "تجميد العضوية",
        "message_ar": f"تم تجميد عضويتك من {freeze.start_date} إلى {freeze.end_date} ({duration_days} يوم)",
        "title_en": "Membership Frozen",
        "message_en": f"Your membership has been frozen from {freeze.start_date} to {freeze.end_date} ({duration_days} days)",
        "read": False,
        "created_at": now
    }
    await db.member_notifications.insert_one(notification)

    return {k: v for k, v in freeze_doc.items() if k != "_id"}


@router.post("/{freeze_id}/cancel")
async def cancel_freeze(freeze_id: str, current_user: dict = Depends(get_current_user)):
    freeze_doc = await db.member_freezes.find_one({"id": freeze_id}, {"_id": 0})
    if not freeze_doc:
        raise HTTPException(status_code=404, detail="Freeze not found")

    if freeze_doc.get("status") != "active":
        raise HTTPException(status_code=400, detail="Freeze is not active")

    now = datetime.now(timezone.utc)
    now_str = now.isoformat()
    today_str = now.strftime("%Y-%m-%d")

    try:
        end_dt = datetime.strptime(freeze_doc["end_date"], "%Y-%m-%d")
        start_dt = datetime.strptime(freeze_doc["start_date"], "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=500, detail="Invalid freeze dates")

    if today_str < freeze_doc["start_date"]:
        # Freeze hasn't started yet — restore full duration
        restore_days = freeze_doc["duration_days"]
    elif today_str <= freeze_doc["end_date"]:
        # Freeze is currently active — restore remaining days only
        today_dt = datetime.strptime(today_str, "%Y-%m-%d")
        restore_days = (end_dt - today_dt).days + 1
    else:
        # Freeze already ended — still restore full duration (undo original extension)
        restore_days = freeze_doc["duration_days"]

    if restore_days > 0:
        member = await db.members.find_one({"id": freeze_doc["member_id"]}, {"_id": 0})
        if member:
            activities = member.get("activities", [])
            for i, act in enumerate(activities):
                act_end = act.get("end_date", "")
                if act_end:
                    try:
                        act_end_dt = datetime.strptime(act_end, "%Y-%m-%d")
                        new_end_dt = act_end_dt - timedelta(days=restore_days)
                        activities[i]["end_date"] = new_end_dt.strftime("%Y-%m-%d")
                    except ValueError:
                        pass
            await db.members.update_one(
                {"id": freeze_doc["member_id"]},
                {"$set": {"activities": activities}}
            )

    await db.member_freezes.update_one(
        {"id": freeze_id},
        {"$set": {"status": "cancelled", "cancelled_at": now_str}}
    )

    notification = {
        "id": str(uuid.uuid4()),
        "member_id": freeze_doc["member_id"],
        "type": "freeze",
        "title_ar": "إلغاء تجميد العضوية",
        "message_ar": f"تم إلغاء تجميد عضويتك الذي كان من {freeze_doc['start_date']} إلى {freeze_doc['end_date']}",
        "title_en": "Freeze Cancelled",
        "message_en": f"Your membership freeze from {freeze_doc['start_date']} to {freeze_doc['end_date']} has been cancelled",
        "read": False,
        "created_at": now_str
    }
    await db.member_notifications.insert_one(notification)

    freeze_doc["status"] = "cancelled"
    freeze_doc["cancelled_at"] = now_str
    return freeze_doc


@router.get("/member/{member_id}")
async def get_member_freezes(member_id: str, current_user: dict = Depends(get_current_user)):
    freezes = await db.member_freezes.find(
        {"member_id": member_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return freezes


@router.get("/active")
async def get_active_freezes(current_user: dict = Depends(get_current_user)):
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    freezes = await db.member_freezes.find({
        "status": "active",
        "start_date": {"$lte": today_str},
        "end_date": {"$gte": today_str}
    }, {"_id": 0}).to_list(500)
    return freezes


@router.get("/member/{member_id}/stats")
async def get_member_freeze_stats(member_id: str, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    year_start = f"{now.year}-01-01"
    year_end = f"{now.year}-12-31"
    today_str = now.strftime("%Y-%m-%d")

    year_freezes = await db.member_freezes.find({
        "member_id": member_id,
        "start_date": {"$gte": year_start, "$lte": year_end}
    }, {"_id": 0}).to_list(100)

    total_days = sum(f.get("duration_days", 0) for f in year_freezes if f.get("status") != "cancelled")

    active_freeze = None
    for f in year_freezes:
        if f.get("status") == "active" and f.get("start_date", "") <= today_str <= f.get("end_date", ""):
            active_freeze = f
            break

    return {
        "member_id": member_id,
        "year": now.year,
        "total_days_frozen": total_days,
        "remaining_days": max(0, 30 - total_days),
        "active_freeze": active_freeze,
        "freezes_count": len(year_freezes)
    }
