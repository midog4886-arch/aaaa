"""Day Extensions (ترحيل الأيام) routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user

router = APIRouter(prefix="/api/day-extensions", tags=["day-extensions"])

def require_admin(user: dict):
    if not user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")

class ClosureCreate(BaseModel):
    title_ar: str
    title_en: Optional[str] = ""
    reason: str  # holiday, maintenance, emergency, other
    start_date: str  # YYYY-MM-DD
    end_date: str  # YYYY-MM-DD
    notes: Optional[str] = ""

class ExtensionApply(BaseModel):
    closure_id: str
    days: int
    branch_id: Optional[str] = None

class ManualExtension(BaseModel):
    member_id: str
    days: int
    reason: str

@router.get("/closures")
async def get_closures(user=Depends(get_current_user)):
    closures = await db.closures.find().sort("created_at", -1).to_list(500)
    for c in closures:
        c.pop("_id", None)
    return closures

@router.post("/closures")
async def create_closure(data: ClosureCreate, user=Depends(get_current_user)):
    require_admin(user)
    try:
        start = datetime.strptime(data.start_date, '%Y-%m-%d')
        end = datetime.strptime(data.end_date, '%Y-%m-%d')
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    if end < start:
        raise HTTPException(status_code=400, detail="End date must be after start date")
    days = (end - start).days + 1

    closure = {
        "id": str(uuid.uuid4()),
        "title_ar": data.title_ar,
        "title_en": data.title_en,
        "reason": data.reason,
        "start_date": data.start_date,
        "end_date": data.end_date,
        "days": days,
        "notes": data.notes,
        "applied": False,
        "applied_count": 0,
        "created_by": user.get("username", ""),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.closures.insert_one(closure)
    closure.pop("_id", None)
    return closure

@router.delete("/closures/{closure_id}")
async def delete_closure(closure_id: str, user=Depends(get_current_user)):
    require_admin(user)
    closure = await db.closures.find_one({"id": closure_id})
    if not closure:
        raise HTTPException(status_code=404, detail="Closure not found")
    if closure.get("applied"):
        raise HTTPException(status_code=400, detail="Cannot delete applied closure")
    await db.closures.delete_one({"id": closure_id})
    return {"message": "Deleted"}

@router.post("/apply")
async def apply_extension(data: ExtensionApply, user=Depends(get_current_user)):
    require_admin(user)
    if data.days <= 0:
        raise HTTPException(status_code=400, detail="Days must be positive")
    closure = await db.closures.find_one({"id": data.closure_id})
    if not closure:
        raise HTTPException(status_code=404, detail="Closure not found")

    query = {"status": "active"}
    if data.branch_id and data.branch_id != "all":
        query["branch_id"] = data.branch_id

    members = await db.members.find(query).to_list(10000)
    extended_count = 0
    extension_records = []

    for member in members:
        activities = member.get("activities", [])
        updated = False
        for act in activities:
            if act.get("status") == "active" and act.get("end_date"):
                try:
                    end_date = datetime.strptime(act["end_date"], '%Y-%m-%d')
                    new_end = end_date + timedelta(days=data.days)
                    act["end_date"] = new_end.strftime('%Y-%m-%d')
                    if act.get("period") and " - " in act["period"]:
                        parts = act["period"].split(" - ")
                        act["period"] = f"{parts[0]} - {new_end.strftime('%Y-%m-%d')}"
                    updated = True
                except Exception:
                    pass

        if updated:
            await db.members.update_one(
                {"id": member["id"]},
                {"$set": {"activities": activities}}
            )

            subs = await db.level_subscriptions.find({"member_id": member["id"]}).to_list(100)
            for sub in subs:
                if sub.get("end_date"):
                    try:
                        sub_end = datetime.strptime(sub["end_date"], '%Y-%m-%d')
                        new_sub_end = sub_end + timedelta(days=data.days)
                        await db.level_subscriptions.update_one(
                            {"_id": sub["_id"]},
                            {"$set": {"end_date": new_sub_end.strftime('%Y-%m-%d')}}
                        )
                    except Exception:
                        pass

            extended_count += 1
            extension_records.append({
                "member_id": member["id"],
                "member_name": member.get("name_ar", member.get("name", "")),
                "days": data.days
            })

    await db.closures.update_one(
        {"id": data.closure_id},
        {"$set": {
            "applied": True,
            "applied_count": extended_count,
            "applied_at": datetime.now(timezone.utc).isoformat(),
            "applied_by": user.get("username", "")
        }}
    )

    log_entry = {
        "id": str(uuid.uuid4()),
        "type": "closure",
        "closure_id": data.closure_id,
        "closure_title": closure.get("title_ar", ""),
        "days": data.days,
        "members_count": extended_count,
        "branch_id": data.branch_id,
        "applied_by": user.get("username", ""),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.extension_logs.insert_one(log_entry)

    return {
        "message": f"Extended {extended_count} members by {data.days} days",
        "extended_count": extended_count
    }

@router.post("/manual")
async def manual_extension(data: ManualExtension, user=Depends(get_current_user)):
    require_admin(user)
    if data.days <= 0:
        raise HTTPException(status_code=400, detail="Days must be positive")
    member = await db.members.find_one({"id": data.member_id})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    activities = member.get("activities", [])
    updated = False
    for act in activities:
        if act.get("status") == "active" and act.get("end_date"):
            try:
                end_date = datetime.strptime(act["end_date"], '%Y-%m-%d')
                new_end = end_date + timedelta(days=data.days)
                act["end_date"] = new_end.strftime('%Y-%m-%d')
                if act.get("period") and " - " in act["period"]:
                    parts = act["period"].split(" - ")
                    act["period"] = f"{parts[0]} - {new_end.strftime('%Y-%m-%d')}"
                updated = True
            except Exception:
                pass

    if updated:
        await db.members.update_one(
            {"id": data.member_id},
            {"$set": {"activities": activities}}
        )

        subs = await db.level_subscriptions.find({"member_id": data.member_id}).to_list(100)
        for sub in subs:
            if sub.get("end_date"):
                try:
                    sub_end = datetime.strptime(sub["end_date"], '%Y-%m-%d')
                    new_sub_end = sub_end + timedelta(days=data.days)
                    await db.level_subscriptions.update_one(
                        {"_id": sub["_id"]},
                        {"$set": {"end_date": new_sub_end.strftime('%Y-%m-%d')}}
                    )
                except Exception:
                    pass

    log_entry = {
        "id": str(uuid.uuid4()),
        "type": "manual",
        "member_id": data.member_id,
        "member_name": member.get("name_ar", member.get("name", "")),
        "days": data.days,
        "reason": data.reason,
        "applied_by": user.get("username", ""),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.extension_logs.insert_one(log_entry)

    return {"message": f"Extended {member.get('name_ar', '')} by {data.days} days"}

@router.get("/logs")
async def get_extension_logs(user=Depends(get_current_user)):
    logs = await db.extension_logs.find().sort("created_at", -1).to_list(500)
    for l in logs:
        l.pop("_id", None)
    return logs
