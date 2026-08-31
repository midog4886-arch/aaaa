"""
Branches API Routes
Handles branch/location management
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, model_validator
from typing import Optional, List
from typing import Literal
from datetime import datetime, timezone
import uuid

from database import db
from utils.auth import get_current_user, resolve_branch_filter, get_allowed_branch_ids
from utils.sequences import assign_seq_starts_for_new_branch
from utils.cache import cache_get, cache_set, cache_invalidate
from models.branch import VenueCourt

router = APIRouter(prefix="/branches", tags=["Branches"])

# ============ MODELS ============

class BranchBase(BaseModel):
    name: str
    name_ar: str
    # Custom public-facing name shown to visitors on the public registration
    # form instead of the internal branch name. Empty -> fall back to name_ar/name.
    public_name: Optional[str] = ""
    address: Optional[str] = ""
    # Public Google-Maps (or similar) location link shown on the public
    # registration page. Empty -> hidden.
    location_url: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    manager_name: Optional[str] = ""
    is_active: bool = True
    code_prefix: Optional[str] = ""
    whatsapp_group_url: Optional[str] = ""
    # Per-branch WhatsApp message templates. Empty -> fall back to the shared
    # global templates in whatsapp_settings (backward compatible). Placeholders:
    # {name} {activity} {days} {end_date} {fee}.
    whatsapp_renewal_template: Optional[str] = ""
    whatsapp_manual_template: Optional[str] = ""
    # Used instead of whatsapp_manual_template when the subscription already
    # expired (past-tense wording). Empty -> global expired template.
    whatsapp_manual_expired_template: Optional[str] = ""
    whatsapp_welcome_template: Optional[str] = ""
    # Member-portal renewal/support WhatsApp number for THIS branch.
    # Empty -> falls back to branch phone, then the global default number.
    support_whatsapp: Optional[str] = ""
    # Days the branch operates. None/empty = open all week (backward compatible).
    working_days: Optional[List[str]] = None
    # Legacy branches have no type field and are therefore permanent.
    branch_type: Literal["permanent", "rented", "rented_venue"] = "permanent"
    venues: List[VenueCourt] = Field(default_factory=list)
    contract_warning_days: int = Field(default=30, ge=0, le=3650)

    @model_validator(mode="after")
    def validate_rented_venues(self):
        if self.branch_type == "rented_venue":
            self.branch_type = "rented"
        venue_ids = [venue.id for venue in self.venues]
        if len(venue_ids) != len(set(venue_ids)):
            raise ValueError("venue ids must be unique")
        return self

class BranchCreate(BranchBase):
    pass

class Branch(BranchBase):
    id: str
    created_at: str


def _validate_location_url(data: dict):
    """Only allow plain web links (http/https) as the public location URL —
    it is rendered as an <a href> on the public registration page, so schemes
    like javascript:/data: would be a stored XSS/phishing vector."""
    url = (data.get("location_url") or "").strip()
    if url and not url.lower().startswith(("http://", "https://")):
        raise HTTPException(
            status_code=400,
            detail="رابط اللوكيشن يجب أن يبدأ بـ http:// أو https://",
        )
    data["location_url"] = url


def _validate_branch_templates(data: dict):
    """Cap per-branch WhatsApp templates to align with global template limits."""
    for field in ("whatsapp_renewal_template", "whatsapp_manual_template", "whatsapp_manual_expired_template", "whatsapp_welcome_template"):
        val = data.get(field)
        if val and len(val) > 1000:
            raise HTTPException(
                status_code=400,
                detail=f"{field} must not exceed 1000 characters",
            )


# ============ ROUTES ============

@router.get("")
async def get_branches(current_user: dict = Depends(get_current_user)):
    """Get all branches - admin sees all, others see only their own branch.

    Branch isolation centralized via ``resolve_branch_filter`` — a non-admin
    without a branch_id is rejected with HTTP 403 (fail-closed). Without
    this guard the legacy ``find({"id": None})`` would silently return an
    empty list, masking a broken account.
    """
    # Admins see every branch; non-admins see ALL of their assigned branches
    # (one for single-branch staff, several for multi-branch supervisors) so the
    # branch switcher can list them. Fail-closed if a non-admin has no branch.
    if current_user.get("is_admin", False):
        cache_key = "branches:all"
        cached = cache_get(cache_key)
        if cached is not None:
            return cached
        branches = await db.branches.find({}, {"_id": 0}).to_list(100)
        cache_set(cache_key, branches, ttl=600)  # 10 min
        return branches

    allowed = get_allowed_branch_ids(current_user)
    if not allowed:
        raise HTTPException(status_code=403, detail="No branch assigned")
    cache_key = "branches:ids:" + ",".join(sorted(allowed))
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    branches = await db.branches.find({"id": {"$in": allowed}}, {"_id": 0}).to_list(100)
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
    _validate_branch_templates(data)
    _validate_location_url(data)
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
    if not current_user.get("is_admin", False):
        allowed = get_allowed_branch_ids(current_user)
        if branch_id not in allowed:
            raise HTTPException(status_code=403, detail="Forbidden: branch is outside your assigned branches")
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
    _validate_branch_templates(data)
    _validate_location_url(data)
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
    before_venues = before.get("venues") or before.get("rented_venues") or []
    old_venue_ids = {venue.get("id") for venue in before_venues if venue.get("id")}
    new_venue_ids = {venue.get("id") for venue in (data.get("venues") or []) if venue.get("id")}
    old_slot_pairs = {
        (venue.get("id"), slot.get("id"))
        for venue in before_venues
        for slot in (venue.get("booking_slots") or [])
        if venue.get("id") and slot.get("id")
    }
    new_slot_pairs = {
        (venue.get("id"), slot.get("id"))
        for venue in (data.get("venues") or [])
        for slot in (venue.get("booking_slots") or [])
        if venue.get("id") and slot.get("id")
    }
    removed_venues = old_venue_ids - new_venue_ids
    removed_slot_pairs = old_slot_pairs - new_slot_pairs
    old_slots = {
        (venue.get("id"), slot.get("id")): slot
        for venue in before_venues
        for slot in (venue.get("booking_slots") or [])
        if venue.get("id") and slot.get("id")
    }
    new_slots = {
        (venue.get("id"), slot.get("id")): slot
        for venue in (data.get("venues") or [])
        for slot in (venue.get("booking_slots") or [])
        if venue.get("id") and slot.get("id")
    }
    booking_fields = ("day", "start_time", "end_time", "start_date", "end_date")
    changed_slot_pairs = {
        pair for pair in (old_slot_pairs & new_slot_pairs)
        if any(old_slots[pair].get(field) != new_slots[pair].get(field) for field in booking_fields)
    }
    if removed_venues or removed_slot_pairs or changed_slot_pairs:
        ref_filters = []
        if removed_venues:
            ref_filters.append({"venue_id": {"$in": list(removed_venues)}})
        # A slot id is only unique within a venue.  Treat its venue/id pair as
        # the reference so moving/reusing an id cannot orphan a live level.
        ref_filters.extend(
            {"venue_id": venue_id, "booking_slot_id": slot_id}
            for venue_id, slot_id in (removed_slot_pairs | changed_slot_pairs)
        )
        referenced = await db.levels.find_one({
            "branch_id": branch_id,
            "is_active": {"$ne": False},
            "$or": ref_filters,
        }, {"_id": 0, "id": 1})
        if referenced:
            raise HTTPException(
                status_code=409,
                detail="لا يمكن حذف أو تغيير حجز مرتبط بمستوى نشط. أغلق المستوى أو غيّر حجزه أولاً",
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
