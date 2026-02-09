"""
Levels API Routes
Handles member skill levels management
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from database import db
from utils.auth import get_current_user

router = APIRouter(prefix="/levels", tags=["Levels"])

# ============ MODELS ============

class LevelMember(BaseModel):
    member_id: str
    member_name: Optional[str] = ""
    phone: Optional[str] = ""

class LevelCreate(BaseModel):
    level_number: int  # 1, 2, 3, 4, 5, 6
    activity_name: str  # Manual activity name
    description: Optional[str] = ""
    members: List[str] = []  # List of member IDs
    branch_id: Optional[str] = None

class Level(BaseModel):
    id: str
    level_number: int
    activity_name: str
    description: Optional[str] = ""
    members: List[str] = []
    members_details: List[LevelMember] = []
    branch_id: Optional[str] = None
    created_at: str

# ============ ROUTES ============

@router.get("")
async def get_levels(
    branch_filter: Optional[str] = None,
    activity_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    if is_admin:
        if branch_filter and branch_filter != "all":
            query["$or"] = [{"branch_id": branch_filter}, {"branch_id": None}, {"branch_id": {"$exists": False}}]
    else:
        query["$or"] = [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": {"$exists": False}}]
    
    if activity_id:
        query["activity_id"] = activity_id
    
    levels = await db.levels.find(query, {"_id": 0}).sort("level_number", 1).to_list(100)
    
    # Populate members details
    for level in levels:
        if level.get("members"):
            members_details = []
            for member_id in level["members"]:
                member = await db.members.find_one({"id": member_id}, {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "phone": 1})
                if member:
                    members_details.append({
                        "member_id": member["id"],
                        "member_name": member.get("name_ar") or member.get("name", ""),
                        "phone": member.get("phone", "")
                    })
            level["members_details"] = members_details
    
    return levels


@router.post("")
async def create_level(level: LevelCreate, current_user: dict = Depends(get_current_user)):
    level_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)
    
    # Check if level already exists for this activity name
    existing = await db.levels.find_one({
        "level_number": level.level_number,
        "activity_name": level.activity_name
    })
    if existing:
        raise HTTPException(status_code=400, detail="هذا المستوى موجود مسبقاً لهذا النشاط")
    
    if is_admin and level.branch_id:
        final_branch_id = level.branch_id if level.branch_id != "all" else None
    else:
        final_branch_id = current_user.get("branch_id")
    
    level_doc = {
        "id": level_id,
        "level_number": level.level_number,
        "activity_name": level.activity_name,
        "description": level.description,
        "members": level.members,
        "branch_id": final_branch_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.levels.insert_one(level_doc)
    
    return {k: v for k, v in level_doc.items() if k != "_id"}


@router.put("/{level_id}")
async def update_level(level_id: str, level: LevelCreate, current_user: dict = Depends(get_current_user)):
    update_data = {
        "level_number": level.level_number,
        "activity_name": level.activity_name,
        "description": level.description,
        "members": level.members
    }
    
    result = await db.levels.find_one_and_update(
        {"id": level_id},
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Level not found")
    return {k: v for k, v in result.items() if k != "_id"}


@router.delete("/{level_id}")
async def delete_level(level_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.levels.delete_one({"id": level_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Level not found")
    return {"message": "Level deleted"}


@router.post("/{level_id}/members/{member_id}")
async def add_member_to_level(level_id: str, member_id: str, current_user: dict = Depends(get_current_user)):
    """Add a member to a level"""
    level = await db.levels.find_one({"id": level_id})
    if not level:
        raise HTTPException(status_code=404, detail="Level not found")
    
    if member_id in level.get("members", []):
        raise HTTPException(status_code=400, detail="العضو موجود مسبقاً في هذا المستوى")
    
    await db.levels.update_one(
        {"id": level_id},
        {"$addToSet": {"members": member_id}}
    )
    return {"message": "Member added to level"}


@router.delete("/{level_id}/members/{member_id}")
async def remove_member_from_level(level_id: str, member_id: str, current_user: dict = Depends(get_current_user)):
    """Remove a member from a level"""
    result = await db.levels.update_one(
        {"id": level_id},
        {"$pull": {"members": member_id}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Member not found in level")
    return {"message": "Member removed from level"}


@router.get("/{level_id}/count")
async def get_level_member_count(level_id: str, current_user: dict = Depends(get_current_user)):
    """Get the count of members in a level"""
    level = await db.levels.find_one({"id": level_id}, {"_id": 0, "members": 1, "level_number": 1, "activity_name": 1})
    if not level:
        raise HTTPException(status_code=404, detail="Level not found")
    
    member_count = len(level.get("members", []))
    return {
        "level_id": level_id,
        "level_number": level.get("level_number"),
        "activity_name": level.get("activity_name"),
        "member_count": member_count,
        "is_full": member_count >= 7,
        "max_capacity": 7
    }
