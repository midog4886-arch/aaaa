"""
Users API Routes
Handles user management operations (admin only)
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from database import db
from utils.auth import get_current_user, hash_password

router = APIRouter(prefix="/users", tags=["Users"])

# ============ MODELS ============

class UserCreateAdmin(BaseModel):
    username: str
    password: str
    name: str
    branch_id: Optional[str] = None
    is_admin: bool = False
    permissions: Optional[List[str]] = None

class UserUpdateAdmin(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    branch_id: Optional[str] = None
    is_admin: Optional[bool] = None
    password: Optional[str] = None
    permissions: Optional[List[str]] = None

ALL_PERMISSIONS = [
    'dashboard', 'members', 'invoices', 'activities', 'levels', 'schedule', 'attendance',
    'coach-ratings', 'advertisements', 'daily-videos', 'loyalty',
    'store', 'accounting', 'reports', 'messages', 'branches', 'users', 'settings'
]

# ============ ROUTES ============

@router.get("")
async def get_users(current_user: dict = Depends(get_current_user)):
    """Get all users - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    users = await db.users.find({}, {"_id": 0, "password": 0}).to_list(1000)
    
    # Add branch name to each user
    branches = await db.branches.find({}, {"_id": 0}).to_list(100)
    branch_map = {b["id"]: b for b in branches}
    
    for user in users:
        branch_id = user.get("branch_id")
        if branch_id and branch_id in branch_map:
            user["branch_name"] = branch_map[branch_id].get("name_ar", branch_map[branch_id].get("name", ""))
        else:
            user["branch_name"] = ""
    
    return users


@router.post("")
async def create_user_placeholder(current_user: dict = Depends(get_current_user)):
    """Placeholder - Use /users/create endpoint"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    return {"message": "Use /users/create endpoint"}


@router.post("/create")
async def create_user(user_data: UserCreateAdmin, current_user: dict = Depends(get_current_user)):
    """Create a new user - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Check if username exists
    existing = await db.users.find_one({"username": user_data.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    user_id = str(uuid.uuid4())
    # Default permissions for non-admin users
    permissions = user_data.permissions if user_data.permissions else []
    # Admin users get all permissions
    if user_data.is_admin:
        permissions = ALL_PERMISSIONS.copy()
    
    user_doc = {
        "id": user_id,
        "username": user_data.username,
        "password": hash_password(user_data.password),
        "name": user_data.name,
        "branch_id": user_data.branch_id,
        "is_admin": user_data.is_admin,
        "permissions": permissions,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    # Return user without password and _id
    return {k: v for k, v in user_doc.items() if k not in ["password", "_id"]}


@router.put("/{user_id}")
async def update_user(user_id: str, user_data: UserUpdateAdmin, current_user: dict = Depends(get_current_user)):
    """Update a user - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    update_data = {}
    if user_data.username is not None:
        # Check if username is already taken by another user
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
        # If making admin, grant all permissions
        if user_data.is_admin:
            update_data["permissions"] = ALL_PERMISSIONS.copy()
    if user_data.password:
        update_data["password"] = hash_password(user_data.password)
    if user_data.permissions is not None:
        update_data["permissions"] = user_data.permissions
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")
    
    result = await db.users.find_one_and_update(
        {"id": user_id},
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Return user without password
    return {k: v for k, v in result.items() if k not in ["_id", "password"]}


@router.delete("/{user_id}")
async def delete_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a user - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Prevent deleting yourself
    if user_id == current_user.get("user_id"):
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted"}
