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


@router.delete("/{activity_id}")
async def delete_activity(activity_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.activities.delete_one({"id": activity_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Activity not found")
    cache_invalidate("activities:")
    return {"message": "Activity deleted"}
