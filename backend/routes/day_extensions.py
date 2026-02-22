"""Day Extensions (ترحيل الأيام) routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user

router = APIRouter(prefix="/day-extensions", tags=["day-extensions"])

def require_admin(user: dict):
    if not user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")

class ClosureCreate(BaseModel):
    title_ar: str
    title_en: Optional[str] = ""
    reason: str
    start_date: str
    end_date: str
    notes: Optional[str] = ""
    scope: Optional[str] = "all"
    activity_id: Optional[str] = None
    activity_name: Optional[str] = None
    stop_type: Optional[str] = "full_day"
    stop_hours: Optional[float] = 0

class ExtensionApply(BaseModel):
    closure_id: str
    days: float
    branch_id: Optional[str] = None

class ManualExtension(BaseModel):
    member_id: str
    days: float
    reason: str
    activity_id: Optional[str] = None

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
    
    total_days_count = (end - start).days + 1

    if data.stop_type == "partial" and data.stop_hours and data.stop_hours > 0:
        extension_days = round((data.stop_hours / 24) * total_days_count, 1)
    else:
        extension_days = total_days_count

    closure = {
        "id": str(uuid.uuid4()),
        "title_ar": data.title_ar,
        "title_en": data.title_en,
        "reason": data.reason,
        "start_date": data.start_date,
        "end_date": data.end_date,
        "total_days_count": total_days_count,
        "days": extension_days,
        "notes": data.notes,
        "scope": data.scope or "all",
        "activity_id": data.activity_id,
        "activity_name": data.activity_name,
        "stop_type": data.stop_type or "full_day",
        "stop_hours": data.stop_hours or 0,
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

    scope = closure.get("scope", "all")
    activity_id = closure.get("activity_id")
    ext_days = int(data.days) if data.days == int(data.days) else data.days

    query = {"activities": {"$elemMatch": {"status": "active", "end_date": {"$exists": True, "$ne": ""}}}}
    if data.branch_id and data.branch_id != "all":
        query["branch_id"] = data.branch_id

    members = await db.members.find(query).to_list(10000)
    extended_count = 0
    extended_members = []

    for member in members:
        activities = member.get("activities", [])
        updated = False
        old_end_dates = {}
        new_end_dates = {}
        for act in activities:
            if act.get("status") != "active" or not act.get("end_date"):
                continue
            if scope == "specific" and activity_id:
                if act.get("activity_id") != activity_id:
                    continue
            try:
                end_date = datetime.strptime(act["end_date"], '%Y-%m-%d')
                act_name = act.get("activity_name", act.get("name", ""))
                old_end_dates[act_name] = act["end_date"]
                days_to_add = int(ext_days) if isinstance(ext_days, float) and ext_days == int(ext_days) else ext_days
                new_end = end_date + timedelta(days=int(round(days_to_add)))
                act["end_date"] = new_end.strftime('%Y-%m-%d')
                new_end_dates[act_name] = act["end_date"]
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

            sub_query = {"member_id": member["id"]}
            if scope == "specific" and activity_id:
                sub_query["activity_id"] = activity_id
            subs = await db.level_subscriptions.find(sub_query).to_list(100)
            for sub in subs:
                if sub.get("end_date"):
                    try:
                        sub_end = datetime.strptime(sub["end_date"], '%Y-%m-%d')
                        new_sub_end = sub_end + timedelta(days=int(round(ext_days)))
                        await db.level_subscriptions.update_one(
                            {"_id": sub["_id"]},
                            {"$set": {"end_date": new_sub_end.strftime('%Y-%m-%d')}}
                        )
                    except Exception:
                        pass

            extended_count += 1
            member_info = {
                "name": member.get("name_ar", member.get("name", "")),
                "phone": member.get("phone", ""),
                "member_id": member.get("id", ""),
            }
            details = []
            for act_name in new_end_dates:
                details.append({
                    "activity": act_name,
                    "old_end": old_end_dates.get(act_name, ""),
                    "new_end": new_end_dates.get(act_name, "")
                })
            member_info["details"] = details
            extended_members.append(member_info)

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
        "scope": scope,
        "activity_name": closure.get("activity_name", ""),
        "stop_type": closure.get("stop_type", "full_day"),
        "stop_hours": closure.get("stop_hours", 0),
        "applied_by": user.get("username", ""),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.extension_logs.insert_one(log_entry)

    return {
        "message": f"Extended {extended_count} members by {data.days} days",
        "extended_count": extended_count,
        "extended_members": extended_members
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
        if act.get("status") != "active" or not act.get("end_date"):
            continue
        if data.activity_id and act.get("activity_id") != data.activity_id:
            continue
        try:
            end_date = datetime.strptime(act["end_date"], '%Y-%m-%d')
            new_end = end_date + timedelta(days=int(round(data.days)))
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

        sub_query = {"member_id": data.member_id}
        if data.activity_id:
            sub_query["activity_id"] = data.activity_id
        subs = await db.level_subscriptions.find(sub_query).to_list(100)
        for sub in subs:
            if sub.get("end_date"):
                try:
                    sub_end = datetime.strptime(sub["end_date"], '%Y-%m-%d')
                    new_sub_end = sub_end + timedelta(days=int(round(data.days)))
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
        "activity_id": data.activity_id,
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
