"""Members routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone

from .common import db, get_current_user

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
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    
    # Branch filtering
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
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

@router.get("/{member_id}", response_model=Member)
async def get_member(member_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single member by ID"""
    member = await db.members.find_one({"id": member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return member

@router.post("", response_model=Member)
async def create_member(member: MemberCreate, current_user: dict = Depends(get_current_user)):
    """Create a new member"""
    member_id = str(uuid.uuid4())
    branch_id = current_user.get("branch_id")
    
    # Generate sequential member code - use max numeric value for safety
    all_members = await db.members.find(
        {"member_code": {"$exists": True, "$ne": None}},
        {"member_code": 1, "_id": 0}
    ).to_list(length=None)
    max_code = 10000
    for m in all_members:
        try:
            code_num = int(m.get("member_code", "0"))
            if code_num > max_code:
                max_code = code_num
        except (ValueError, TypeError):
            continue
    new_code = str(max_code + 1)
    if int(new_code) < 10001:
        new_code = "10001"
    
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
        {"id": member_id},
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Member not found")
    return Member(**{k: v for k, v in result.items() if k != "_id"})

@router.delete("/{member_id}")
async def delete_member(member_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a member"""
    result = await db.members.delete_one({"id": member_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"message": "Member deleted"}

@router.post("/{member_id}/activities")
async def add_member_activity(member_id: str, activity: MemberActivity, current_user: dict = Depends(get_current_user)):
    """Add an activity to a member"""
    result = await db.members.update_one(
        {"id": member_id},
        {"$push": {"activities": activity.model_dump()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"message": "Activity added"}

@router.put("/{member_id}/activities/{activity_id}")
async def update_member_activity(member_id: str, activity_id: str, activity: MemberActivity, current_user: dict = Depends(get_current_user)):
    """Update a member's activity"""
    result = await db.members.update_one(
        {"id": member_id, "activities.activity_id": activity_id},
        {"$set": {"activities.$": activity.model_dump()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Member or activity not found")
    return {"message": "Activity updated"}
