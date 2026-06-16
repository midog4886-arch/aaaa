"""
Activities API Routes
Handles sports activities management (Swimming, Football, Karate, Gymnastics)
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from database import db
from utils.auth import get_current_user, require_branch_scope, resolve_branch_filter
from utils.cache import cache_get, cache_set, cache_invalidate

router = APIRouter(prefix="/activities", tags=["Activities"])

# ============ MODELS ============

class ActivityBase(BaseModel):
    name: str
    name_ar: str
    description: Optional[str] = ""
    description_ar: Optional[str] = ""
    monthly_fee: float
    color: str
    coach_id: Optional[str] = None

class ActivityCreate(ActivityBase):
    branch_id: Optional[str] = None

class Activity(ActivityBase):
    id: str
    branch_id: Optional[str] = None
    created_at: str

# ============ ROUTES ============

@router.get("", response_model=List[Activity])
async def get_activities(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    # Branch filtering — fail-closed for non-admins without a branch_id.
    # Activities without a branch (shared/legacy) are visible to everyone, hence the $or.
    effective_branch = resolve_branch_filter(current_user, branch_filter)

    cache_key = f"activities:{'admin' if is_admin else 'user'}:{effective_branch or 'all'}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    if effective_branch:
        activities = await db.activities.find(
            {"$or": [{"branch_id": effective_branch}, {"branch_id": None}, {"branch_id": {"$exists": False}}]},
            {"_id": 0}
        ).to_list(100)
    else:
        activities = await db.activities.find({}, {"_id": 0}).to_list(100)
    cache_set(cache_key, activities, ttl=600)
    return activities


@router.post("", response_model=Activity)
async def create_activity(activity: ActivityCreate, current_user: dict = Depends(get_current_user)):
    activity_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)

    # Admin can specify branch, otherwise non-admin is locked to their own
    # branch (require_branch_scope rejects non-admins without a branch_id).
    if is_admin and activity.branch_id:
        final_branch_id = activity.branch_id if activity.branch_id != "all" else None
    else:
        final_branch_id = require_branch_scope(current_user)
    
    activity_doc = {
        "id": activity_id,
        **activity.model_dump(),
        "branch_id": final_branch_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.activities.insert_one(activity_doc)
    cache_invalidate("activities:")
    return Activity(**{k: v for k, v in activity_doc.items() if k != "_id"})


@router.put("/{activity_id}", response_model=Activity)
async def update_activity(activity_id: str, activity: ActivityCreate, current_user: dict = Depends(get_current_user)):
    result = await db.activities.find_one_and_update(
        {"id": activity_id},
        {"$set": activity.model_dump()},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Activity not found")
    cache_invalidate("activities:")
    return Activity(**{k: v for k, v in result.items() if k != "_id"})


@router.get("/member-counts")
async def get_activity_member_counts(current_user: dict = Depends(get_current_user)):
    activities = await db.activities.find({}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1}).to_list(100)
    counts = {}
    for act in activities:
        name = act.get("name_ar") or act.get("name", "")
        count = await db.members.count_documents({
            "$or": [
                {"activities.activity_name": name},
                {"activities.activity_name": act.get("name", "")},
            ]
        })
        counts[act["id"]] = count
    return counts


@router.get("/{activity_id}/members")
async def get_activity_members(activity_id: str, current_user: dict = Depends(get_current_user)):
    """List members subscribed to an activity.

    Matches the same activity_name logic used by ``/member-counts`` so the
    returned list lines up with the count shown on the activity card. For
    non-admins the result is scoped to their branch (fail-closed) to avoid
    leaking members from other branches.
    """
    activity = await db.activities.find_one({"id": activity_id}, {"_id": 0})
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    name_ar = activity.get("name_ar") or activity.get("name", "")
    name_en = activity.get("name", "")
    or_clauses = [{"activities.activity_name": name_ar}]
    if name_en and name_en != name_ar:
        or_clauses.append({"activities.activity_name": name_en})
    query = {"$or": or_clauses}

    effective_branch = resolve_branch_filter(current_user, None)
    if effective_branch:
        query["branch_id"] = effective_branch

    members = await db.members.find(
        query,
        {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "member_code": 1,
         "phone": 1, "branch_id": 1, "photo": 1, "status": 1, "activities": 1}
    ).sort("name_ar", 1).to_list(2000)

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    result = []
    for m in members:
        entry = None
        for a in (m.get("activities") or []):
            if a.get("activity_id") == activity_id or a.get("activity_name") in (name_ar, name_en):
                entry = a
                break
        end_date = (entry or {}).get("end_date") or ""
        result.append({
            "id": m.get("id"),
            "name_ar": m.get("name_ar") or m.get("name") or "",
            "name": m.get("name") or "",
            "member_code": m.get("member_code") or "",
            "phone": m.get("phone") or "",
            "photo": m.get("photo") or "",
            "branch_id": m.get("branch_id") or "",
            "start_date": (entry or {}).get("start_date") or "",
            "end_date": end_date,
            "active": bool(end_date and end_date >= today_str),
        })
    return result


@router.delete("/{activity_id}")
async def delete_activity(activity_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.activities.delete_one({"id": activity_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Activity not found")
    cache_invalidate("activities:")
    return {"message": "Activity deleted"}
