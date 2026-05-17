"""
Branches API Routes
Handles branch/location management
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import uuid

from database import db
from utils.auth import get_current_user, resolve_branch_filter
from utils.sequences import assign_seq_starts_for_new_branch
from utils.cache import cache_get, cache_set, cache_invalidate

router = APIRouter(prefix="/branches", tags=["Branches"])

# ============ MODELS ============

class BranchBase(BaseModel):
    name: str
    name_ar: str
    address: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    manager_name: Optional[str] = ""
    is_active: bool = True
    code_prefix: Optional[str] = ""

class BranchCreate(BranchBase):
    pass

class Branch(BranchBase):
    id: str
    created_at: str

# ============ ROUTES ============

@router.get("")
async def get_branches(current_user: dict = Depends(get_current_user)):
    """Get all branches - admin sees all, others see only their own branch.

    Branch isolation centralized via ``resolve_branch_filter`` — a non-admin
    without a branch_id is rejected with HTTP 403 (fail-closed). Without
    this guard the legacy ``find({"id": None})`` would silently return an
    empty list, masking a broken account.
    """
    effective_branch = resolve_branch_filter(current_user, None)

    cache_key = "branches:all" if effective_branch is None else f"branches:one:{effective_branch}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    if effective_branch:
        branches = await db.branches.find({"id": effective_branch}, {"_id": 0}).to_list(100)
    else:
        branches = await db.branches.find({}, {"_id": 0}).to_list(100)
    cache_set(cache_key, branches, ttl=600)  # 10 min
    return branches


@router.post("")
async def create_branch(branch: BranchCreate, current_user: dict = Depends(get_current_user)):
    """Create a new branch - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")

    from utils.tenant import get_current_tenant
    tenant = get_current_tenant() or {}
    max_branches = int(tenant.get("max_branches") or 0)
    if max_branches > 0:
        current_count = await db.branches.count_documents({})
        if current_count >= max_branches:
            raise HTTPException(
                status_code=402,
                detail=f"تم بلوغ الحد الأقصى للفروع ({max_branches}) في خطة اشتراكك"
            )

    branch_id = str(uuid.uuid4())
    data = branch.model_dump()
    from utils.member_code import sanitize_prefix
    data["code_prefix"] = sanitize_prefix(data.get("code_prefix") or "")
    user_supplied_prefix = bool(data["code_prefix"])
    if user_supplied_prefix:
        dupe = await db.branches.find_one(
            {"code_prefix": data["code_prefix"]},
            {"_id": 0, "id": 1, "name_ar": 1, "name": 1},
        )
        if dupe:
            raise HTTPException(
                status_code=409,
                detail=f"البادئة '{data['code_prefix']}' مستخدمة بالفعل في فرع آخر"
            )
    branch_doc = {
        "id": branch_id,
        **data,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    if user_supplied_prefix:
        try:
            from pymongo.errors import DuplicateKeyError
            await db.branches.insert_one(branch_doc)
        except DuplicateKeyError:
            raise HTTPException(
                status_code=409,
                detail=f"البادئة '{data['code_prefix']}' مستخدمة بالفعل في فرع آخر"
            )
    else:
        from utils.prefix_gen import pick_unique_branch_prefix, insert_with_unique_prefix
        await insert_with_unique_prefix(
            db.branches,
            branch_doc,
            "code_prefix",
            lambda: pick_unique_branch_prefix(
                name_latin=data.get("name") or "",
                name_ar=data.get("name_ar") or "",
                exclude_id=branch_id,
            ),
        )
        data["code_prefix"] = branch_doc.get("code_prefix", "")
    # Assign exclusive sequence blocks for this new branch
    await assign_seq_starts_for_new_branch(branch_id)
    cache_invalidate("branches:")
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="branch.create",
            entity_type="branch",
            entity_id=branch_id,
            entity_name=branch_doc.get("name_ar") or branch_doc.get("name", ""),
            after={k: v for k, v in branch_doc.items() if k != "_id"},
        )
    except Exception:
        pass
    return {k: v for k, v in branch_doc.items() if k != "_id"}


@router.get("/{branch_id}")
async def get_branch(branch_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single branch"""
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return branch


@router.put("/{branch_id}")
async def update_branch(branch_id: str, branch: BranchCreate, current_user: dict = Depends(get_current_user)):
    """Update a branch - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    before = await db.branches.find_one({"id": branch_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Branch not found")

    data = branch.model_dump()
    from utils.member_code import sanitize_prefix
    data["code_prefix"] = sanitize_prefix(data.get("code_prefix") or "")
    if data["code_prefix"]:
        dupe = await db.branches.find_one(
            {"code_prefix": data["code_prefix"], "id": {"$ne": branch_id}},
            {"_id": 0, "id": 1, "name_ar": 1, "name": 1},
        )
        if dupe:
            raise HTTPException(
                status_code=409,
                detail=f"البادئة '{data['code_prefix']}' مستخدمة بالفعل في فرع آخر"
            )
    result = await db.branches.find_one_and_update(
        {"id": branch_id},
        {"$set": data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Branch not found")
    cache_invalidate("branches:")
    after = {k: v for k, v in result.items() if k != "_id"}
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="branch.update",
            entity_type="branch",
            entity_id=branch_id,
            entity_name=after.get("name_ar") or after.get("name", ""),
            before=before,
            after=after,
        )
    except Exception:
        pass
    return after


@router.delete("/{branch_id}")
async def delete_branch(branch_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a branch - admin only"""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    before = await db.branches.find_one({"id": branch_id}, {"_id": 0})
    result = await db.branches.delete_one({"id": branch_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Branch not found")
    cache_invalidate("branches:")
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="branch.delete",
            entity_type="branch",
            entity_id=branch_id,
            entity_name=(before or {}).get("name_ar") or (before or {}).get("name", ""),
            before=before,
        )
    except Exception:
        pass
    return {"message": "Branch deleted"}
