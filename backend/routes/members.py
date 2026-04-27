"""Members routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone

from .common import db, get_current_user
from utils.auth import require_branch_scope, resolve_branch_filter
from utils.sequences import get_branch_seq_start

router = APIRouter(prefix="/members", tags=["members"])

# ============ MODELS ============

class MemberActivity(BaseModel):
    activity_id: str
    activity_name: str
    start_date: str
    end_date: str
    fee: Optional[float] = 0
    status: str = "active"
    coach_id: Optional[str] = ""
    level_id: Optional[str] = ""
    schedule: Optional[str] = ""
    training_days: Optional[List[str]] = []
    training_time: Optional[str] = ""
    source: Optional[str] = ""
    source_id: Optional[str] = ""

class MemberCreate(BaseModel):
    name: str = ""
    name_ar: str
    phone: str
    email: Optional[str] = ""
    date_of_birth: Optional[str] = ""
    age: Optional[int] = 0
    gender: Optional[str] = ""
    address: Optional[str] = ""
    guardian_name: Optional[str] = ""
    guardian_name_ar: Optional[str] = ""
    guardian_phone: Optional[str] = ""
    activities: List[MemberActivity] = []
    notes: Optional[str] = ""

class MemberUpdate(BaseModel):
    name: Optional[str] = None
    name_ar: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    date_of_birth: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    guardian_name: Optional[str] = None
    guardian_name_ar: Optional[str] = None
    guardian_phone: Optional[str] = None
    activities: Optional[List[MemberActivity]] = None
    notes: Optional[str] = None
    marked: Optional[bool] = None

class Member(BaseModel):
    id: str = ""
    member_code: Optional[str] = ""
    name: str = ""
    name_ar: str = ""
    phone: str = ""
    email: Optional[str] = ""
    date_of_birth: Optional[str] = ""
    age: Optional[int] = 0
    gender: Optional[str] = ""
    address: Optional[str] = ""
    guardian_name: Optional[str] = ""
    guardian_name_ar: Optional[str] = ""
    guardian_phone: Optional[str] = ""
    activities: List[MemberActivity] = []
    notes: Optional[str] = ""
    marked: bool = False
    status: str = "active"
    branch_id: Optional[str] = None
    created_at: str = ""

# ============ ROUTES ============

@router.get("", response_model=List[Member])
async def get_members(
    activity_id: Optional[str] = None,
    coach_id: Optional[str] = None,
    status: Optional[str] = None,
    branch_filter: Optional[str] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all members with optional filters"""
    query = {}

    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch
    
    # Activity filter - only show members with active (non-expired) subscriptions
    if activity_id:
        from datetime import datetime, timezone
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        elem_match = {"activity_id": activity_id, "end_date": {"$gte": today_str}}
        if status:
            elem_match["status"] = status
        query["activities"] = {"$elemMatch": elem_match}
    elif status:
        query["activities.status"] = status
    
    # Coach filter
    if coach_id:
        query["activities.coach_id"] = coach_id
    
    # Search filter
    if search:
        query["$or"] = [
            {"name_ar": {"$regex": search, "$options": "i"}},
            {"name": {"$regex": search, "$options": "i"}},
            {"phone": {"$regex": search, "$options": "i"}},
            {"member_code": {"$regex": search, "$options": "i"}}
        ]
    
    members = await db.members.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    # Ensure all required fields exist with defaults
    for member in members:
        member.setdefault("age", 0)
        member.setdefault("guardian_name", "")
        member.setdefault("guardian_name_ar", "")
        member.setdefault("guardian_phone", "")
        member.setdefault("email", "")
        member.setdefault("date_of_birth", "")
        member.setdefault("gender", "")
        member.setdefault("address", "")
        member.setdefault("activities", [])
        member.setdefault("status", "active")
    
    return members

def _scoped_member_query(member_id: str, current_user: dict) -> dict:
    """Build a member-id query scoped to the caller's branch for non-admins.

    Fail-closed via ``resolve_branch_filter`` — a non-admin without a
    branch_id receives 403 instead of being able to look up members from
    other branches by ID (IDOR-style cross-branch exposure).
    """
    query = {"id": member_id}
    effective_branch = resolve_branch_filter(current_user, None)
    if effective_branch:
        query["branch_id"] = effective_branch
    return query


@router.get("/{member_id}", response_model=Member)
async def get_member(member_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single member by ID (branch-scoped for non-admins)"""
    member = await db.members.find_one(_scoped_member_query(member_id, current_user), {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return member

@router.post("", response_model=Member)
async def create_member(member: MemberCreate, current_user: dict = Depends(get_current_user)):
    """Create a new member"""
    member_id = str(uuid.uuid4())
    # For non-admins, require a branch (fail-closed). Admins may create
    # branch-less members (returns None).
    branch_id = require_branch_scope(current_user) or current_user.get("branch_id")
    
    # Generate sequential member code – unique per branch (each branch owns a block)
    seq_start = await get_branch_seq_start(branch_id, "member")
    branch_filter = {"branch_id": branch_id} if branch_id else {}
    all_members = await db.members.find(
        {"member_code": {"$exists": True, "$ne": None}, **branch_filter},
        {"member_code": 1, "_id": 0}
    ).to_list(length=None)
    max_code = seq_start - 1
    for m in all_members:
        try:
            code_num = int(m.get("member_code", "0"))
            if code_num > max_code:
                max_code = code_num
        except (ValueError, TypeError):
            continue
    new_code = str(max(max_code + 1, seq_start))
    
    member_doc = {
        "id": member_id,
        "member_code": new_code,
        **member.model_dump(),
        "branch_id": branch_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.members.insert_one(member_doc)
    return Member(**{k: v for k, v in member_doc.items() if k != "_id"})

@router.put("/{member_id}", response_model=Member)
async def update_member(member_id: str, member: MemberUpdate, current_user: dict = Depends(get_current_user)):
    """Update an existing member"""
    update_data = {k: v for k, v in member.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")
    
    result = await db.members.find_one_and_update(
        _scoped_member_query(member_id, current_user),
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Member not found")
    return Member(**{k: v for k, v in result.items() if k != "_id"})

@router.patch("/{member_id}/marked")
async def set_member_marked(member_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    """Set the manual `marked` flag for a member (used as a free-form admin tag)."""
    marked = bool(payload.get("marked", False))
    result = await db.members.find_one_and_update(
        _scoped_member_query(member_id, current_user),
        {"$set": {"marked": marked}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"id": member_id, "marked": marked}

@router.delete("/{member_id}")
async def delete_member(member_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a member"""
    result = await db.members.delete_one(_scoped_member_query(member_id, current_user))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"message": "Member deleted"}

@router.post("/{member_id}/activities")
async def add_member_activity(member_id: str, activity: MemberActivity, current_user: dict = Depends(get_current_user)):
    """Add an activity to a member"""
    result = await db.members.update_one(
        _scoped_member_query(member_id, current_user),
        {"$push": {"activities": activity.model_dump()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"message": "Activity added"}

_PROFILE_CHANGE_FIELD_MAP = {
    "name": "name_ar",
    "phone": "phone",
    "date_of_birth": "date_of_birth",
}


@router.post("/{member_id}/apply-change-request/{message_id}")
async def apply_profile_change_request(
    member_id: str,
    message_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Apply a member's pending profile change request and mark the source
    message resolved.

    The request is created by `POST /member-portal/profile/change-request`
    and stored as a regular admin-inbox message tagged with
    ``kind="profile_change_request"`` plus a structured ``change_request``
    payload (field, current_value, new_value, reason). This endpoint lets an
    admin apply the requested value to the member record in one click and
    records that the request has been resolved so it stops appearing as
    pending in the inbox and on the member's profile page.
    """
    msg = await db.messages.find_one(
        {"id": message_id, "kind": "profile_change_request"},
        {"_id": 0},
    )
    if not msg:
        raise HTTPException(status_code=404, detail="طلب التعديل غير موجود")
    # Validate the message belongs to the targeted member (defends against
    # sending an arbitrary message_id that points at a different member).
    if msg.get("recipient_member_id") != member_id and msg.get("sender_id") != member_id:
        raise HTTPException(status_code=400, detail="طلب التعديل لا يخص هذا العضو")
    if msg.get("change_request_status") == "applied":
        raise HTTPException(status_code=400, detail="تم تطبيق هذا الطلب من قبل")

    cr = msg.get("change_request") or {}
    field = cr.get("field")
    new_value = (cr.get("new_value") or "").strip()
    if field not in _PROFILE_CHANGE_FIELD_MAP or not new_value:
        raise HTTPException(status_code=400, detail="بيانات الطلب غير صالحة")

    target_field = _PROFILE_CHANGE_FIELD_MAP[field]
    member_result = await db.members.find_one_and_update(
        _scoped_member_query(member_id, current_user),
        {"$set": {target_field: new_value}},
        return_document=True,
    )
    if not member_result:
        raise HTTPException(status_code=404, detail="Member not found")

    now = datetime.now(timezone.utc).isoformat()
    applied_by = current_user.get("user_id", current_user.get("sub", ""))
    await db.messages.update_one(
        {"id": message_id},
        {"$set": {
            "change_request_status": "applied",
            "change_request_applied_at": now,
            "change_request_applied_by": applied_by,
            "read_by_admin": True,
        }},
    )

    return {
        "success": True,
        "message_id": message_id,
        "field": field,
        "target_field": target_field,
        "new_value": new_value,
        "applied_at": now,
        "member": Member(**{k: v for k, v in member_result.items() if k != "_id"}),
    }


@router.put("/{member_id}/activities/{activity_id}")
async def update_member_activity(member_id: str, activity_id: str, activity: MemberActivity, current_user: dict = Depends(get_current_user)):
    """Update a member's activity"""
    scoped = _scoped_member_query(member_id, current_user)
    scoped["activities.activity_id"] = activity_id
    result = await db.members.update_one(
        scoped,
        {"$set": {"activities.$": activity.model_dump()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Member or activity not found")
    return {"message": "Activity updated"}
