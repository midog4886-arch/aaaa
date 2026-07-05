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
from utils.audit import log_audit

router = APIRouter(prefix="/users", tags=["Users"])

# ============ MODELS ============

class UserCreateAdmin(BaseModel):
    username: str
    password: str
    name: str
    branch_id: Optional[str] = None
    branch_ids: Optional[List[str]] = None
    is_admin: bool = False
    permissions: Optional[List[str]] = None

class UserUpdateAdmin(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    branch_id: Optional[str] = None
    branch_ids: Optional[List[str]] = None
    is_admin: Optional[bool] = None
    password: Optional[str] = None
    permissions: Optional[List[str]] = None


def _normalize_branch_ids(branch_ids, branch_id):
    """Build the canonical (deduped, order-preserving) list of branch ids for a
    user from the multi-select ``branch_ids`` (preferred) or the legacy single
    ``branch_id``. ``"all"`` and empties are dropped."""
    out = []
    source = branch_ids if branch_ids is not None else ([branch_id] if branch_id else [])
    for b in (source or []):
        if b and b != "all" and b not in out:
            out.append(b)
    return out

ALL_PERMISSIONS = [
    'dashboard', 'members', 'members-create', 'invoices', 'activities', 'levels', 'schedule', 'attendance',
    'coach-ratings', 'coach-attendance', 'coaches', 'advertisements', 'daily-videos',
    'loyalty', 'store', 'accounting', 'reports', 'messages', 'branches', 'users',
    'settings', 'tournaments', 'social-publisher', 'renewals', 'daily-ledger',
    'day-extensions', 'backup', 'push-notifications', 'member-card', 'salaries',
    'internal-expenses-create', 'internal-expenses-approve', 'scanner-station',
    'marketers', 'rentals'
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
        bids = user.get("branch_ids")
        if not bids:
            single = user.get("branch_id")
            bids = [single] if single else []
        names = [
            branch_map[b].get("name_ar", branch_map[b].get("name", ""))
            for b in bids if b in branch_map
        ]
        user["branch_names"] = names
        user["branch_name"] = names[0] if names else ""
    
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
    
    branch_ids = _normalize_branch_ids(user_data.branch_ids, user_data.branch_id)
    primary_branch = branch_ids[0] if branch_ids else None
    user_doc = {
        "id": user_id,
        "username": user_data.username,
        "password": hash_password(user_data.password),
        "name": user_data.name,
        "branch_id": primary_branch,
        "branch_ids": branch_ids,
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
    fields_set = user_data.model_fields_set
    if "branch_ids" in fields_set or "branch_id" in fields_set:
        branch_ids = _normalize_branch_ids(
            user_data.branch_ids if "branch_ids" in fields_set else None,
            user_data.branch_id,
        )
        update_data["branch_ids"] = branch_ids
        update_data["branch_id"] = branch_ids[0] if branch_ids else None
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
    
    before = await db.users.find_one({"id": user_id}, {"_id": 0})
    result = await db.users.find_one_and_update(
        {"id": user_id},
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="User not found")

    # Distinguish permission/admin changes from generic updates so the
    # audit timeline highlights privilege escalations clearly.
    perms_or_admin_changed = (
        "permissions" in update_data or "is_admin" in update_data
    )
    await log_audit(
        actor=current_user,
        action="user.permissions.update" if perms_or_admin_changed else "user.update",
        entity_type="user",
        entity_id=user_id,
        entity_name=result.get("username", ""),
        before=before,
        after=result,
    )

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
    
    before = await db.users.find_one({"id": user_id}, {"_id": 0})
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await log_audit(
        actor=current_user,
        action="user.delete",
        entity_type="user",
        entity_id=user_id,
        entity_name=(before or {}).get("username", ""),
        before=before,
    )
    return {"message": "User deleted"}
