from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid

from database import db
from models.user import UserCreateAdmin, UserUpdateAdmin
from utils.auth import hash_password, get_current_user

router = APIRouter(prefix="/users", tags=["Users Management"])

@router.get("")
async def get_users(current_user: dict = Depends(get_current_user)):
    """Get all users - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    users = await db.users.find({}, {"_id": 0, "password": 0}).to_list(1000)
    
    branches = await db.branches.find({}, {"_id": 0}).to_list(100)
    branch_map = {b["id"]: b for b in branches}
    
    for user in users:
        branch_id = user.get("branch_id")
        if branch_id and branch_id in branch_map:
            user["branch_name"] = branch_map[branch_id].get("name_ar", branch_map[branch_id].get("name", ""))
        else:
            user["branch_name"] = ""
    
    return users

@router.post("/create")
async def create_user_admin(user_data: UserCreateAdmin, current_user: dict = Depends(get_current_user)):
    """Create a new user - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    existing = await db.users.find_one({"username": user_data.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "username": user_data.username,
        "password": hash_password(user_data.password),
        "name": user_data.name,
        "branch_id": user_data.branch_id,
        "is_admin": user_data.is_admin,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    return {k: v for k, v in user_doc.items() if k not in ["password", "_id"]}

@router.put("/{user_id}")
async def update_user(user_id: str, user_data: UserUpdateAdmin, current_user: dict = Depends(get_current_user)):
    """Update a user - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    update_data = {}
    if user_data.username is not None:
        existing = await db.users.find_one({"username": user_data.username, "id": {"$ne": user_id}})
        if existing:
            raise HTTPException(status_code=400, detail="اسم المستخدم موجود مسبقاً")
        update_data["username"] = user_data.username
    if user_data.name is not None:
        update_data["name"] = user_data.name
    if user_data.branch_id is not None:
        update_data["branch_id"] = user_data.branch_id
    if user_data.is_admin is not None:
        update_data["is_admin"] = user_data.is_admin
    if user_data.password:
        update_data["password"] = hash_password(user_data.password)
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")
    
    result = await db.users.find_one_and_update(
        {"id": user_id},
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {k: v for k, v in result.items() if k not in ["_id", "password"]}

@router.delete("/{user_id}")
async def delete_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a user - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if user_id == current_user.get("user_id"):
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted"}
