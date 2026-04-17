"""
Supervisors API Routes
Handles supervisors (مشرفون) management — separate entity from coaches.
Each supervisor has just a name and an optional photo (base64).
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from database import db
from utils.auth import get_current_user

router = APIRouter(prefix="/supervisors", tags=["Supervisors"])

MAX_PHOTO_BYTES = 3 * 1024 * 1024  # ~2MB after base64 overhead, matches frontend 2MB file check


def _validate_photo(photo: Optional[str]) -> None:
    if not photo:
        return
    if not photo.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="نوع الملف غير مدعوم، يجب أن تكون صورة")
    if len(photo.encode()) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="حجم الصورة كبير جداً، الحد الأقصى 2 ميجابايت")


def _require_admin(current_user: dict) -> None:
    """Server-side authorization: only admins may mutate supervisors."""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="غير مصرح لك بهذه العملية")


class SupervisorBase(BaseModel):
    name: str
    photo: Optional[str] = None  # base64-encoded image string


class SupervisorCreate(SupervisorBase):
    pass


class Supervisor(SupervisorBase):
    id: str
    created_at: Optional[str] = None


@router.get("", response_model=List[Supervisor])
async def list_supervisors(current_user: dict = Depends(get_current_user)):
    """List all supervisors. Admin-only. Members use /api/member-portal/supervisors-to-rate."""
    _require_admin(current_user)
    supervisors = await db.supervisors.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for sup in supervisors:
        sup.setdefault("created_at", None)
    return supervisors


@router.post("", response_model=Supervisor)
async def create_supervisor(
    payload: SupervisorCreate,
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)
    _validate_photo(payload.photo)
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="الاسم مطلوب")
    doc = {
        "id": str(uuid.uuid4()),
        "name": name,
        "photo": payload.photo or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.supervisors.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/{supervisor_id}", response_model=Supervisor)
async def update_supervisor(
    supervisor_id: str,
    payload: SupervisorCreate,
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)
    _validate_photo(payload.photo)
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="الاسم مطلوب")
    existing = await db.supervisors.find_one({"id": supervisor_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="المشرف غير موجود")
    update_doc = {"name": name, "photo": payload.photo or None}
    await db.supervisors.update_one({"id": supervisor_id}, {"$set": update_doc})
    existing.update(update_doc)
    existing.setdefault("created_at", None)
    return existing


@router.delete("/{supervisor_id}")
async def delete_supervisor(
    supervisor_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)
    result = await db.supervisors.delete_one({"id": supervisor_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="المشرف غير موجود")
    return {"message": "deleted"}
