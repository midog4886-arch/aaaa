"""
Coaches API Routes
Handles coaches/trainers management
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, field_validator
from typing import Optional, List, Literal
from datetime import datetime, timezone
import uuid

from database import db
from utils.auth import get_current_user, require_branch_scope, resolve_branch_filter
from utils.cache import cache_get, cache_set, cache_invalidate
from utils.member_photos import (
    store_entity_photo,
    delete_entity_photo,
    is_entity_photo_url,
    is_own_entity_photo_url,
)
from utils.tenant import get_current_tenant_slug

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
    base_salary: Optional[float] = 0
    daily_deduction_rate: Optional[float] = 0
    late_minute_rate: Optional[float] = 0
    contract_type: Optional[Literal["full_time", "part_time"]] = "full_time"
    monthly_work_days: Optional[int] = 30
    clothing_size: Optional[str] = ""        # مقاس ملابس المدرب (e.g. S/M/L/XL)
    clothing_received: Optional[bool] = False  # هل استلم طقم الملابس

    @field_validator("monthly_work_days", mode="before")
    @classmethod
    def clamp_work_days(cls, v):
        try:
            v = int(v) if v is not None else 30
        except (ValueError, TypeError):
            return 30
        return max(1, min(v, 31))

class CoachCreate(CoachBase):
    branch_id: Optional[str] = None

class Coach(CoachBase):
    id: str
    employee_id: Optional[str] = None
    branch_id: Optional[str] = None
    created_at: str
    # Lifecycle fields — managed only by dedicated endpoints (not normal edit)
    status: Optional[str] = "active"          # "active" | "terminated"
    termination_date: Optional[str] = None
    termination_reason: Optional[str] = None
    transfers: Optional[List[dict]] = []


class TerminateRequest(BaseModel):
    termination_date: Optional[str] = None
    termination_reason: Optional[str] = ""


class TransferRequest(BaseModel):
    new_branch_id: str
    transfer_date: Optional[str] = None


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
    include_terminated: bool = False,
    only_terminated: bool = False,
    exclude_photo: bool = False,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    # Branch filtering — fail-closed for non-admins without a branch_id.
    # Coaches without a branch (shared/legacy) are visible to everyone, hence the $or.
    effective_branch = resolve_branch_filter(current_user, branch_filter)

    # Status scope: active-only (default), all, or terminated-only (archive view).
    if only_terminated:
        status_scope = "term"
    elif include_terminated:
        status_scope = "all"
    else:
        status_scope = "active"

    cache_key = f"coaches:{'admin' if is_admin else 'user'}:{effective_branch or 'all'}:{status_scope}:{'nophoto' if exclude_photo else 'full'}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    if only_terminated:
        status_filter = {"status": "terminated"}
    elif include_terminated:
        status_filter = {}
    else:
        # Treat missing/null status as active (legacy docs predate the field).
        status_filter = {"status": {"$ne": "terminated"}}

    if effective_branch:
        branch_clause = {"$or": [{"branch_id": effective_branch}, {"branch_id": None}, {"branch_id": {"$exists": False}}]}
        query = {**status_filter, **branch_clause} if status_filter else branch_clause
    else:
        query = status_filter

    projection = {"_id": 0, "photo": 0} if exclude_photo else {"_id": 0}
    coaches = await db.coaches.find(query, projection).to_list(100)
    cache_set(cache_key, coaches, ttl=600)
    return coaches


MAX_PHOTO_BYTES = 3 * 1024 * 1024  # ~2MB actual file after base64 overhead (~33%), matches frontend 2MB file check

def _validate_photo(photo: Optional[str]) -> None:
    if not photo:
        return
    if is_entity_photo_url(photo):
        # Already-stored photo URL echoed back by the edit form — pass through.
        return
    if not photo.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="نوع الملف غير مدعوم، يجب أن تكون صورة")
    if len(photo.encode()) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="حجم الصورة كبير جداً، الحد الأقصى 2 ميجابايت")


async def _resolve_photo_field(coach_id: str, photo: Optional[str]) -> Optional[str]:
    """Turn an incoming photo value into what the coach doc should store.

    - data URL  -> compress into the coach_photos store, return the signed URL
    - stored URL -> keep as-is (unchanged photo echoed back by the edit form)
    - empty/None -> remove the stored photo, return None
    """
    if photo and photo.startswith("data:image/"):
        url = await store_entity_photo(db, "coach", get_current_tenant_slug(), coach_id, photo)
        if not url:
            raise HTTPException(status_code=400, detail="تعذر معالجة الصورة — يرجى اختيار صورة أخرى")
        return url
    if photo and is_entity_photo_url(photo):
        # URL echo is ONLY valid when it is this exact coach's own signed URL —
        # a member/supervisor/foreign URL grafted in via the API is rejected.
        if not is_own_entity_photo_url("coach", get_current_tenant_slug(), coach_id, photo):
            raise HTTPException(status_code=400, detail="رابط الصورة غير صالح")
        return photo
    await delete_entity_photo(db, "coach", coach_id)
    return None


@router.post("", response_model=Coach)
async def create_coach(coach: CoachCreate, current_user: dict = Depends(get_current_user)):
    _validate_photo(coach.photo)
    coach_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)

    if is_admin:
        if not coach.branch_id or coach.branch_id == "all":
            raise HTTPException(status_code=400, detail="يجب اختيار فرع للمدرّب — لا يمكن إنشاء مدرّب بدون فرع")
        final_branch_id = coach.branch_id
    else:
        final_branch_id = require_branch_scope(current_user)
    branch_exists = await db.branches.find_one({"id": final_branch_id}, {"_id": 1})
    if not branch_exists:
        raise HTTPException(status_code=400, detail="الفرع المحدد غير موجود")
    
    employee_id = await get_next_employee_id()
    
    coach_doc = {
        "id": coach_id,
        "employee_id": employee_id,
        **coach.model_dump(),
        "photo": await _resolve_photo_field(coach_id, coach.photo),
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
    # Existence check BEFORE photo side effects, so a bad id can't leave an
    # orphan coach_photos doc (or delete a photo) without a coach update.
    exists = await db.coaches.find_one({"id": coach_id}, {"_id": 1})
    if not exists:
        raise HTTPException(status_code=404, detail="Coach not found")
    update_doc = coach.model_dump()
    update_doc["photo"] = await _resolve_photo_field(coach_id, coach.photo)
    result = await db.coaches.find_one_and_update(
        {"id": coach_id},
        {"$set": update_doc},
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
    await delete_entity_photo(db, "coach", coach_id)
    cache_invalidate("coaches:")
    return {"message": "Coach deleted"}


async def _get_coach_scoped(coach_id: str, current_user: dict) -> dict:
    """Fetch a coach, enforcing branch scope for non-admins.
    Coaches with no branch_id (legacy/shared) remain accessible to any branch."""
    coach = await db.coaches.find_one({"id": coach_id}, {"_id": 0})
    if not coach:
        raise HTTPException(status_code=404, detail="Coach not found")
    if not current_user.get("is_admin", False):
        user_branch = require_branch_scope(current_user)
        coach_branch = coach.get("branch_id")
        if coach_branch is not None and coach_branch != user_branch:
            raise HTTPException(status_code=404, detail="Coach not found")
    return coach


@router.post("/{coach_id}/terminate")
async def terminate_coach(
    coach_id: str,
    req: TerminateRequest,
    current_user: dict = Depends(get_current_user)
):
    """End a coach's contract (archive). Keeps all history; hides the coach from
    the default active list. Reversible via /reactivate."""
    await _get_coach_scoped(coach_id, current_user)
    term_date = (req.termination_date or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.coaches.update_one(
        {"id": coach_id},
        {"$set": {
            "status": "terminated",
            "termination_date": term_date,
            "termination_reason": (req.termination_reason or "").strip(),
        }}
    )
    cache_invalidate("coaches:")
    return {"message": "تم إنهاء تعاقد المدرب", "status": "terminated", "termination_date": term_date}


@router.post("/{coach_id}/reactivate")
async def reactivate_coach(coach_id: str, current_user: dict = Depends(get_current_user)):
    """Re-activate a previously terminated coach."""
    await _get_coach_scoped(coach_id, current_user)
    await db.coaches.update_one(
        {"id": coach_id},
        {
            "$set": {"status": "active"},
            "$unset": {"termination_date": "", "termination_reason": ""},
        }
    )
    cache_invalidate("coaches:")
    return {"message": "تمت إعادة تفعيل المدرب", "status": "active"}


@router.post("/{coach_id}/transfer")
async def transfer_coach(
    coach_id: str,
    req: TransferRequest,
    current_user: dict = Depends(get_current_user)
):
    """Transfer a coach to another branch. The current month's attendance and any
    non-disbursed salary draft move to the new branch (current-month salary →
    new branch); earlier months stay with the old branch for history integrity."""
    coach = await _get_coach_scoped(coach_id, current_user)
    new_branch = (req.new_branch_id or "").strip()
    if not new_branch or new_branch == "all":
        raise HTTPException(status_code=400, detail="يجب اختيار الفرع الجديد")
    old_branch = coach.get("branch_id")
    if new_branch == old_branch:
        raise HTTPException(status_code=400, detail="المدرب موجود بالفعل في هذا الفرع")
    branch_exists = await db.branches.find_one({"id": new_branch}, {"_id": 1})
    if not branch_exists:
        raise HTTPException(status_code=400, detail="الفرع الجديد غير موجود")

    transfer_date = (req.transfer_date or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    month = transfer_date[:7]  # YYYY-MM

    transfer_entry = {
        "from_branch_id": old_branch,
        "to_branch_id": new_branch,
        "transfer_date": transfer_date,
        "by": current_user.get("username") or current_user.get("id"),
        "at": datetime.now(timezone.utc).isoformat(),
    }
    await db.coaches.update_one(
        {"id": coach_id},
        {"$set": {"branch_id": new_branch}, "$push": {"transfers": transfer_entry}}
    )

    # Move the current month entirely to the new branch.
    await db.coach_attendance.update_many(
        {"coach_id": coach_id, "date": {"$regex": f"^{month}"}},
        {"$set": {"branch_id": new_branch}}
    )
    await db.coach_salaries.update_many(
        {"coach_id": coach_id, "year_month": month, "status": {"$ne": "disbursed"}},
        {"$set": {"branch_id": new_branch}}
    )

    cache_invalidate("coaches:")
    return {
        "message": "تم نقل المدرب للفرع الجديد",
        "new_branch_id": new_branch,
        "transfer_date": transfer_date,
    }


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
