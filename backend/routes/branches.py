from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid

from database import db
from models.branch import BranchCreate
from utils.auth import get_current_user

router = APIRouter(prefix="/branches", tags=["Branches"])

@router.get("")
async def get_branches(current_user: dict = Depends(get_current_user)):
    """Get all branches - admin sees all, others see only their branch"""
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    if is_admin:
        branches = await db.branches.find({}, {"_id": 0}).to_list(100)
    else:
        branches = await db.branches.find({"id": branch_id}, {"_id": 0}).to_list(100)
    return branches

@router.post("")
async def create_branch(branch: BranchCreate, current_user: dict = Depends(get_current_user)):
    """Create a new branch - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    branch_id = str(uuid.uuid4())
    branch_doc = {
        "id": branch_id,
        **branch.model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.branches.insert_one(branch_doc)
    return {k: v for k, v in branch_doc.items() if k != "_id"}

@router.put("/{branch_id}")
async def update_branch(branch_id: str, branch: BranchCreate, current_user: dict = Depends(get_current_user)):
    """Update a branch - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.branches.find_one_and_update(
        {"id": branch_id},
        {"$set": branch.model_dump()},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Branch not found")
    return {k: v for k, v in result.items() if k != "_id"}

@router.delete("/{branch_id}")
async def delete_branch(branch_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a branch - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.branches.delete_one({"id": branch_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Branch not found")
    return {"message": "Branch deleted"}

@router.get("/{branch_id}")
async def get_branch(branch_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single branch"""
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return branch
