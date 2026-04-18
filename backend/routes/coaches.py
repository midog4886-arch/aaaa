"""
Coaches API Routes
Handles coaches/trainers management
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from database import db
from utils.auth import get_current_user
from utils.cache import cache_get, cache_set, cache_invalidate

router = APIRouter(prefix="/coaches", tags=["Coaches"])

# ============ MODELS ============

class CoachBase(BaseModel):
    name: str
    name_ar: str
    phone: str
    email: Optional[str] = ""
    activities: List[str] = []
    specialization: Optional[str] = None
    notes: Optional[str] = ""
    expected_checkin_time: Optional[str] = None  # e.g. "09:00", per-coach late threshold
    photo: Optional[str] = None  # base64 encoded image string

class CoachCreate(CoachBase):
    branch_id: Optional[str] = None

class Coach(CoachBase):
    id: str
    employee_id: Optional[str] = None
    branch_id: Optional[str] = None
    created_at: str


async def get_next_employee_id() -> str:
    """Generate next sequential employee_id starting from 5001."""
    coaches = await db.coaches.find(
        {"employee_id": {"$exists": True, "$ne": None}},
        {"employee_id": 1, "_id": 0}
    ).to_list(500)
    max_id = 5000
    for c in coaches:
        try:
            val = int(c.get("employee_id", "0"))
            if val > max_id:
                max_id = val
        except (ValueError, TypeError):
            pass
    return str(max_id + 1)

# ============ ROUTES ============

@router.get("", response_model=List[Coach])
async def get_coaches(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")

    cache_key = f"coaches:{'admin' if is_admin else 'user'}:{branch_filter or branch_id or 'all'}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    if is_admin:
        if branch_filter and branch_filter != "all":
            coaches = await db.coaches.find(
                {"$or": [{"branch_id": branch_filter}, {"branch_id": None}, {"branch_id": {"$exists": False}}]},
                {"_id": 0}
            ).to_list(100)
        else:
            coaches = await db.coaches.find({}, {"_id": 0}).to_list(100)
    else:
        coaches = await db.coaches.find(
            {"$or": [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": {"$exists": False}}]}, 
            {"_id": 0}
        ).to_list(100)
    cache_set(cache_key, coaches, ttl=600)
    return coaches


MAX_PHOTO_BYTES = 3 * 1024 * 1024  # ~2MB actual file after base64 overhead (~33%), matches frontend 2MB file check

def _validate_photo(photo: Optional[str]) -> None:
    if not photo:
        return
    if not photo.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="نوع الملف غير مدعوم، يجب أن تكون صورة")
    if len(photo.encode()) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="حجم الصورة كبير جداً، الحد الأقصى 2 ميجابايت")


@router.post("", response_model=Coach)
async def create_coach(coach: CoachCreate, current_user: dict = Depends(get_current_user)):
    _validate_photo(coach.photo)
    coach_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)
    
    # Admin can specify branch, otherwise use user's branch
    if is_admin and coach.branch_id:
        final_branch_id = coach.branch_id if coach.branch_id != "all" else None
    else:
        final_branch_id = current_user.get("branch_id")
    
    employee_id = await get_next_employee_id()
    
    coach_doc = {
        "id": coach_id,
        "employee_id": employee_id,
        **coach.model_dump(),
        "branch_id": final_branch_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.coaches.insert_one(coach_doc)
    cache_invalidate("coaches:")
    return Coach(**{k: v for k, v in coach_doc.items() if k != "_id"})


@router.post("/assign-employee-ids")
async def assign_employee_ids(current_user: dict = Depends(get_current_user)):
    """Assign employee_id to coaches that don't have one yet."""
    coaches = await db.coaches.find(
        {"$or": [{"employee_id": {"$exists": False}}, {"employee_id": None}]},
        {"_id": 0}
    ).to_list(500)
    
    count = 0
    for coach in coaches:
        new_id = await get_next_employee_id()
        await db.coaches.update_one(
            {"id": coach["id"]},
            {"$set": {"employee_id": new_id}}
        )
        count += 1
    
    return {"assigned": count, "message": f"تم تعيين رقم الموظف لـ {count} مدرب"}


@router.put("/{coach_id}", response_model=Coach)
async def update_coach(coach_id: str, coach: CoachCreate, current_user: dict = Depends(get_current_user)):
    _validate_photo(coach.photo)
    result = await db.coaches.find_one_and_update(
        {"id": coach_id},
        {"$set": coach.model_dump()},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Coach not found")
    cache_invalidate("coaches:")
    return Coach(**{k: v for k, v in result.items() if k != "_id"})


@router.delete("/{coach_id}")
async def delete_coach(coach_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.coaches.delete_one({"id": coach_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Coach not found")
    cache_invalidate("coaches:")
    return {"message": "Coach deleted"}


@router.post("/migrate-activities-to-specialization")
async def migrate_activities_to_specialization(current_user: dict = Depends(get_current_user)):
    """
    One-time migration: for any coach that has a non-empty `activities` list
    but an empty/missing `specialization`, copy the activities joined as a
    comma-separated string into the `specialization` field.
    Safe to run multiple times — only updates coaches that still need it.
    """
    migrated = 0
    migrated_ids = []

    cursor = db.coaches.find(
        {},
        {"_id": 0, "id": 1, "activities": 1, "specialization": 1}
    )
    async for coach in cursor:
        activities = coach.get("activities") or []
        specialization = coach.get("specialization") or ""
        if activities and not specialization.strip():
            joined = ", ".join(str(a) for a in activities if a)
            if joined:
                await db.coaches.update_one(
                    {"id": coach["id"]},
                    {"$set": {"specialization": joined}}
                )
                migrated += 1
                migrated_ids.append(coach["id"])

    return {
        "migrated": migrated,
        "migrated_ids": migrated_ids,
        "message": f"تم ترحيل {migrated} مدرب — تم نسخ قائمة الأنشطة إلى حقل التخصص"
    }
