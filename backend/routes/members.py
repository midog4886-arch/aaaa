"""Members routes"""
from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone

from .common import db, get_current_user
from utils.auth import require_branch_scope, resolve_branch_filter, require_permission
from utils.sequences import get_branch_seq_start
from utils.member_code import generate_member_code
from utils.cache import cache_invalidate

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
    preferred_language: Optional[str] = "ar"

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
    preferred_language: Optional[str] = None

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
    preferred_language: Optional[str] = "ar"

class MemberTransferRequest(BaseModel):
    new_branch_id: str
    transfer_date: Optional[str] = None

class MemberBulkTransferRequest(BaseModel):
    member_ids: List[str] = []
    new_branch_id: str
    transfer_date: Optional[str] = None

# ============ ROUTES ============

@router.get("/daily-new-cards")
async def get_daily_new_member_cards(
    date: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        target_date = (date or datetime.now(timezone.utc).strftime("%Y-%m-%d")).strip()
        datetime.strptime(target_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    start_iso = f"{target_date}T00:00:00"
    end_iso = f"{target_date}T23:59:59.999999"
    query = {"created_at": {"$gte": start_iso, "$lte": end_iso}}

    members = await db.members.find(query, {"_id": 0}).sort("created_at", 1).to_list(5000)

    activity_ids = list({a.get("activity_id") for m in members for a in (m.get("activities") or []) if a.get("activity_id")})
    activities_en_map = {}
    if activity_ids:
        act_docs = await db.activities.find({"id": {"$in": activity_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        activities_en_map = {a["id"]: a.get("name") or "" for a in act_docs}
    for m in members:
        for a in (m.get("activities") or []):
            a["activity_name_en"] = activities_en_map.get(a.get("activity_id")) or ""

    branches = await db.branches.find({}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "phone": 1}).to_list(500)
    branch_map = {b["id"]: b for b in branches}

    grouped: Dict[str, Dict[str, Any]] = {}
    for m in members:
        bid = m.get("branch_id") or "__no_branch__"
        if bid not in grouped:
            b = branch_map.get(bid, {})
            grouped[bid] = {
                "branch_id": bid,
                "branch_name": b.get("name_ar") or b.get("name") or ("بدون فرع" if bid == "__no_branch__" else bid),
                "branch_phone": b.get("phone") or "",
                "members": [],
            }
        grouped[bid]["members"].append(m)

    branch_summaries = sorted(grouped.values(), key=lambda g: g["branch_name"])

    return {
        "date": target_date,
        "total_members": len(members),
        "total_branches": len([g for g in branch_summaries if g["members"]]),
        "branches": branch_summaries,
        "members": members,
    }


@router.get("")
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

    branch_docs = await db.branches.find({}, {"_id": 0, "id": 1, "phone": 1}).to_list(500)
    branch_phone_map = {b["id"]: (b.get("phone") or "") for b in branch_docs}

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
        member["branch_phone"] = branch_phone_map.get(member.get("branch_id") or "", "")

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
    await require_permission(current_user, "members-create")
    from utils.tenant import get_current_tenant
    tenant = get_current_tenant() or {}
    max_members = int(tenant.get("max_members") or 0)
    if max_members > 0:
        current_count = await db.members.count_documents({})
        if current_count >= max_members:
            raise HTTPException(
                status_code=402,
                detail=f"تم بلوغ الحد الأقصى للأعضاء ({max_members}) في خطة اشتراكك"
            )
    member_id = str(uuid.uuid4())
    branch_id = require_branch_scope(current_user) or current_user.get("branch_id")

    new_code = await generate_member_code(branch_id)
    
    payload = member.model_dump()
    payload["preferred_language"] = "en" if str(payload.get("preferred_language") or "ar").lower().startswith("en") else "ar"
    member_doc = {
        "id": member_id,
        "member_code": new_code,
        **payload,
        "branch_id": branch_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.members.insert_one(member_doc)
    try:
        await db.push_subscriptions.update_many(
            {"member_id": member_id, "is_active": True},
            {"$set": {"language": payload["preferred_language"]}},
        )
    except Exception:
        pass
    return Member(**{k: v for k, v in member_doc.items() if k != "_id"})

@router.put("/{member_id}", response_model=Member)
async def update_member(member_id: str, member: MemberUpdate, current_user: dict = Depends(get_current_user)):
    """Update an existing member"""
    update_data = {k: v for k, v in member.model_dump().items() if v is not None}
    if "preferred_language" in update_data:
        update_data["preferred_language"] = "en" if str(update_data["preferred_language"]).lower().startswith("en") else "ar"
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")

    before = await db.members.find_one(_scoped_member_query(member_id, current_user), {"_id": 0})
    result = await db.members.find_one_and_update(
        _scoped_member_query(member_id, current_user),
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Member not found")
    if "preferred_language" in update_data:
        try:
            await db.push_subscriptions.update_many(
                {"member_id": member_id, "is_active": True},
                {"$set": {"language": update_data["preferred_language"]}},
            )
        except Exception:
            pass
    from utils.audit import log_audit
    await log_audit(
        actor=current_user,
        action="member.update",
        entity_type="member",
        entity_id=member_id,
        entity_name=(result.get("name_ar") or result.get("name") or ""),
        before=before,
        after=result,
    )
    return Member(**{k: v for k, v in result.items() if k != "_id"})

async def _transfer_member_doc(member: dict, new_branch: str, transfer_date: str, current_user: dict):
    """Move a single member to a new branch. Levels/coaches are branch-bound, so
    their links are cleared (training days/times kept) to let the member be
    re-assigned at the new branch. Subscription/sessions/activity dates are kept."""
    member_id = member["id"]
    old_branch = member.get("branch_id")
    activities = member.get("activities") or []
    old_level_ids = [a.get("level_id") for a in activities if a.get("level_id")]
    new_activities = []
    for a in activities:
        a = dict(a)
        a["level_id"] = ""
        a["coach_id"] = ""
        new_activities.append(a)
    transfer_entry = {
        "from_branch_id": old_branch,
        "to_branch_id": new_branch,
        "transfer_date": transfer_date,
        "by": current_user.get("username") or current_user.get("id"),
        "at": datetime.now(timezone.utc).isoformat(),
    }
    await db.members.update_one(
        {"id": member_id},
        {"$set": {"branch_id": new_branch, "activities": new_activities},
         "$push": {"transfers": transfer_entry}}
    )
    # Drop the member from the old (branch-bound) level membership caches.
    valid_level_ids = [lid for lid in old_level_ids if lid]
    if valid_level_ids:
        await db.levels.update_many(
            {"id": {"$in": valid_level_ids}},
            {"$pull": {"members": member_id}}
        )
    return old_branch


@router.post("/transfer-bulk")
async def transfer_members_bulk(req: MemberBulkTransferRequest, current_user: dict = Depends(get_current_user)):
    """Transfer multiple members to another branch at once."""
    new_branch = (req.new_branch_id or "").strip()
    if not new_branch or new_branch == "all":
        raise HTTPException(status_code=400, detail="يجب اختيار الفرع الجديد")
    if not req.member_ids:
        raise HTTPException(status_code=400, detail="يجب اختيار عضو واحد على الأقل")
    # Cross-branch transfers are admin-only: non-admins are pinned to their own
    # branch, so moving members to a different branch would break isolation.
    if not current_user.get("is_admin", False) and new_branch != current_user.get("branch_id"):
        raise HTTPException(status_code=403, detail="غير مصرح بنقل الأعضاء لفرع آخر")
    branch_exists = await db.branches.find_one({"id": new_branch}, {"_id": 1})
    if not branch_exists:
        raise HTTPException(status_code=400, detail="الفرع الجديد غير موجود")
    transfer_date = (req.transfer_date or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Scope: non-admins can only act on members within their own branch.
    base_query = {"id": {"$in": req.member_ids}}
    effective_branch = resolve_branch_filter(current_user, None)
    if effective_branch:
        base_query["branch_id"] = effective_branch
    members = await db.members.find(base_query, {"_id": 0}).to_list(len(req.member_ids) + 10)

    moved, skipped = 0, 0
    for m in members:
        if m.get("branch_id") == new_branch:
            skipped += 1
            continue
        await _transfer_member_doc(m, new_branch, transfer_date, current_user)
        moved += 1

    cache_invalidate("levels:")
    from utils.audit import log_audit
    try:
        await log_audit(
            actor=current_user,
            action="member.transfer_bulk",
            entity_type="member",
            entity_id="",
            entity_name=f"{moved} → {new_branch}",
        )
    except Exception:
        pass
    return {"message": "تم نقل الأعضاء للفرع الجديد", "moved": moved, "skipped": skipped,
            "new_branch_id": new_branch, "transfer_date": transfer_date}


@router.post("/{member_id}/transfer")
async def transfer_member(member_id: str, req: MemberTransferRequest, current_user: dict = Depends(get_current_user)):
    """Transfer a single member to another branch."""
    new_branch = (req.new_branch_id or "").strip()
    if not new_branch or new_branch == "all":
        raise HTTPException(status_code=400, detail="يجب اختيار الفرع الجديد")
    member = await db.members.find_one(_scoped_member_query(member_id, current_user), {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.get("branch_id") == new_branch:
        raise HTTPException(status_code=400, detail="العضو موجود بالفعل في هذا الفرع")
    # Cross-branch transfers are admin-only (see bulk endpoint for rationale).
    if not current_user.get("is_admin", False) and new_branch != current_user.get("branch_id"):
        raise HTTPException(status_code=403, detail="غير مصرح بنقل الأعضاء لفرع آخر")
    branch_exists = await db.branches.find_one({"id": new_branch}, {"_id": 1})
    if not branch_exists:
        raise HTTPException(status_code=400, detail="الفرع الجديد غير موجود")
    transfer_date = (req.transfer_date or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await _transfer_member_doc(member, new_branch, transfer_date, current_user)
    cache_invalidate("levels:")
    from utils.audit import log_audit
    try:
        await log_audit(
            actor=current_user,
            action="member.transfer",
            entity_type="member",
            entity_id=member_id,
            entity_name=(member.get("name_ar") or member.get("name") or ""),
        )
    except Exception:
        pass
    return {"message": "تم نقل العضو للفرع الجديد", "new_branch_id": new_branch, "transfer_date": transfer_date}


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

@router.post("/mark-printed")
async def mark_members_printed(payload: dict, current_user: dict = Depends(get_current_user)):
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    member_ids = payload.get("member_ids") or []
    if not isinstance(member_ids, list) or not member_ids:
        raise HTTPException(status_code=400, detail="member_ids list required")
    now_iso = datetime.now(timezone.utc).isoformat()
    query = {"id": {"$in": member_ids}}
    effective_branch = resolve_branch_filter(current_user, None)
    if effective_branch:
        query["branch_id"] = effective_branch
    result = await db.members.update_many(
        query,
        {"$set": {"card_printed_at": now_iso, "card_printed_by": current_user.get("username") or current_user.get("id") or ""},
         "$inc": {"card_print_count": 1}}
    )
    return {"updated": result.modified_count, "printed_at": now_iso}

@router.delete("/{member_id}")
async def delete_member(member_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a member"""
    before = await db.members.find_one(_scoped_member_query(member_id, current_user), {"_id": 0})
    result = await db.members.delete_one(_scoped_member_query(member_id, current_user))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Member not found")
    from utils.audit import log_audit
    await log_audit(
        actor=current_user,
        action="member.delete",
        entity_type="member",
        entity_id=member_id,
        entity_name=(before or {}).get("name_ar") or (before or {}).get("name", ""),
        before=before,
    )
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
    from utils.audit import log_audit
    await log_audit(
        actor=current_user,
        action="subscription.add",
        entity_type="member",
        entity_id=member_id,
        entity_name=activity.activity_name or "",
        after=activity.model_dump(),
    )
    return {"message": "Activity added"}

_PROFILE_CHANGE_FIELD_MAP = {
    "name": "name_ar",
    "phone": "phone",
    "date_of_birth": "date_of_birth",
}

_PROFILE_CHANGE_FIELD_LABELS = {
    "name": ("الاسم", "Name"),
    "phone": ("رقم الجوال", "Phone"),
    "date_of_birth": ("تاريخ الميلاد", "Date of birth"),
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
    existing_status = msg.get("change_request_status")
    if existing_status == "applied":
        raise HTTPException(status_code=400, detail="تم تطبيق هذا الطلب من قبل")
    if existing_status == "rejected":
        raise HTTPException(status_code=400, detail="تم رفض هذا الطلب من قبل")

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

    # Notify the member: append an admin->member confirmation in the same
    # thread so the change is visible in the messages tab, and fire a push
    # notification on their registered devices. Failures here must not roll
    # back the actual profile update.
    label_ar, label_en = _PROFILE_CHANGE_FIELD_LABELS[field]
    subject_ar = f"تم تحديث {label_ar}"
    subject_en = f"Your {label_en.lower()} has been updated"
    body_ar = f"تم تحديث {label_ar} إلى {new_value}."
    body_en = f"Your {label_en.lower()} has been updated to {new_value}."
    confirm_subject = f"{subject_ar} / {subject_en}"
    confirm_body = f"{body_ar}\n{body_en}"

    confirm_id = str(uuid.uuid4())
    await db.messages.insert_one({
        "id": confirm_id,
        "thread_id": member_id,
        "sender_type": "admin",
        "sender_id": applied_by,
        "sender_name": current_user.get(
            "name", current_user.get("username", "الإدارة")
        ),
        "recipient_member_id": member_id,
        "recipient_name": member_result.get("name_ar")
        or member_result.get("name")
        or "",
        "subject": confirm_subject,
        "body": confirm_body,
        "is_broadcast": False,
        "read_by_member": False,
        "read_by_admin": True,
        "created_at": now,
    })

    try:
        from .messages import send_message_push
        await send_message_push(member_id, confirm_subject, confirm_body)
    except Exception as e:
        print(f"apply_profile_change_request push error: {e}")

    return {
        "success": True,
        "message_id": message_id,
        "field": field,
        "target_field": target_field,
        "new_value": new_value,
        "applied_at": now,
        "confirmation_message_id": confirm_id,
        "member": Member(**{k: v for k, v in member_result.items() if k != "_id"}),
    }


@router.post("/{member_id}/reject-change-request/{message_id}")
async def reject_profile_change_request(
    member_id: str,
    message_id: str,
    payload: Optional[Dict[str, Any]] = Body(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Mark a member's pending profile change request as rejected without
    touching the member record.

    Mirrors :func:`apply_profile_change_request` but records
    ``change_request_status = "rejected"`` instead. The optional ``reason``
    in the body, if provided, is sent back to the member as a regular admin
    reply so they understand why the request was dismissed. The original
    request message is also marked ``read_by_admin=True`` so it disappears
    from the pending count and from the member's "request pending" indicator.
    """
    msg = await db.messages.find_one(
        {"id": message_id, "kind": "profile_change_request"},
        {"_id": 0},
    )
    if not msg:
        raise HTTPException(status_code=404, detail="طلب التعديل غير موجود")
    if msg.get("recipient_member_id") != member_id and msg.get("sender_id") != member_id:
        raise HTTPException(status_code=400, detail="طلب التعديل لا يخص هذا العضو")
    status = msg.get("change_request_status")
    if status == "applied":
        raise HTTPException(status_code=400, detail="تم تطبيق هذا الطلب من قبل")
    if status == "rejected":
        raise HTTPException(status_code=400, detail="تم رفض هذا الطلب من قبل")

    # Confirm the member exists & is in scope before touching anything else.
    member_doc = await db.members.find_one(
        _scoped_member_query(member_id, current_user),
        {"_id": 0, "id": 1, "name_ar": 1, "name": 1},
    )
    if not member_doc:
        raise HTTPException(status_code=404, detail="Member not found")

    raw_reason = ""
    if isinstance(payload, dict):
        raw_reason = (payload.get("reason") or "").strip()
    if len(raw_reason) > 500:
        raise HTTPException(status_code=400, detail="السبب طويل جداً")

    now = datetime.now(timezone.utc).isoformat()
    rejected_by = current_user.get("user_id", current_user.get("sub", ""))
    update_fields: Dict[str, Any] = {
        "change_request_status": "rejected",
        "change_request_rejected_at": now,
        "change_request_rejected_by": rejected_by,
        "read_by_admin": True,
    }
    if raw_reason:
        update_fields["change_request_rejection_reason"] = raw_reason

    await db.messages.update_one(
        {"id": message_id},
        {"$set": update_fields},
    )

    reply_id: Optional[str] = None
    if raw_reason:
        cr = msg.get("change_request") or {}
        field_label = cr.get("field_label_ar") or cr.get("field") or ""
        subject = (
            f"رفض طلب تعديل {field_label}".strip()
            if field_label
            else "رفض طلب التعديل"
        )
        body_lines = ["تم رفض طلب التعديل."]
        if field_label:
            body_lines[0] = f"تم رفض طلب تعديل {field_label}."
        body_lines.append(f"السبب: {raw_reason}")

        reply_id = str(uuid.uuid4())
        await db.messages.insert_one({
            "id": reply_id,
            "thread_id": member_id,
            "sender_type": "admin",
            "sender_id": rejected_by,
            "sender_name": current_user.get(
                "name", current_user.get("username", "الإدارة")
            ),
            "recipient_member_id": member_id,
            "recipient_name": member_doc.get("name_ar") or member_doc.get("name") or "",
            "subject": subject,
            "body": "\n".join(body_lines),
            "is_broadcast": False,
            "read_by_member": False,
            "read_by_admin": True,
            "created_at": now,
        })

    return {
        "success": True,
        "message_id": message_id,
        "rejected_at": now,
        "rejected_by": rejected_by,
        "reason": raw_reason,
        "reply_id": reply_id,
    }


@router.put("/{member_id}/activities/{activity_id}")
async def update_member_activity(member_id: str, activity_id: str, activity: MemberActivity, current_user: dict = Depends(get_current_user)):
    """Update a member's activity"""
    scoped = _scoped_member_query(member_id, current_user)
    scoped["activities.activity_id"] = activity_id
    before_member = await db.members.find_one(scoped, {"_id": 0, "activities": 1, "name_ar": 1, "name": 1})
    before_act = None
    if before_member:
        for a in (before_member.get("activities") or []):
            if a.get("activity_id") == activity_id:
                before_act = a
                break
    result = await db.members.update_one(
        scoped,
        {"$set": {"activities.$": activity.model_dump()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Member or activity not found")
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="subscription.update",
            entity_type="member_activity",
            entity_id=f"{member_id}:{activity_id}",
            entity_name=(before_member or {}).get("name_ar") or (before_member or {}).get("name", ""),
            before=before_act,
            after=activity.model_dump(),
        )
    except Exception:
        pass

    # Notify the member when their training schedule (الموعد) changed.
    try:
        await _notify_schedule_change(
            member_id=member_id,
            member_doc=before_member,
            before_act=before_act,
            after_act=activity.model_dump(),
        )
    except Exception:
        pass

    return {"message": "Activity updated"}


def _activity_schedule_str(act: dict) -> str:
    """Human-readable schedule string for an activity entry.
    Prefers the free-text ``schedule`` field, else builds it from
    ``training_days`` + ``training_time``."""
    if not act:
        return ""
    s = (act.get("schedule") or "").strip()
    if s:
        return s
    days = act.get("training_days") or []
    time = (act.get("training_time") or "").strip()
    days_str = " و ".join([d for d in days if d]) if days else ""
    if days_str and time:
        return f"{days_str} - {time}"
    return days_str or time


async def _notify_schedule_change(member_id: str, member_doc: Optional[dict],
                                  before_act: Optional[dict], after_act: dict) -> None:
    """Insert an in-app notification + send a push when a member's training
    schedule fields (schedule / training_days / training_time) changed."""
    def _sig(a: Optional[dict]):
        a = a or {}
        days = a.get("training_days") or []
        return (
            (a.get("schedule") or "").strip(),
            tuple(d for d in days if d),
            (a.get("training_time") or "").strip(),
        )

    if _sig(before_act) == _sig(after_act):
        return

    new_sched = _activity_schedule_str(after_act)
    activity_name = after_act.get("activity_name") or (before_act or {}).get("activity_name") or "التدريب"
    now = datetime.now(timezone.utc).isoformat()

    if new_sched:
        message_ar = f"تم تغيير موعد تدريبك ({activity_name}) إلى: {new_sched}"
        message_en = f"Your training schedule for ({activity_name}) has been changed to: {new_sched}"
    else:
        message_ar = f"تم تحديث موعد تدريبك ({activity_name}). يرجى مراجعة جدولك."
        message_en = f"Your training schedule for ({activity_name}) has been updated. Please review your schedule."

    notif = {
        "id": str(uuid.uuid4()),
        "member_id": member_id,
        "type": "schedule_changed",
        "title_ar": "تم تغيير موعد التدريب",
        "title_en": "Training schedule changed",
        "message_ar": message_ar,
        "message_en": message_en,
        "new_schedule": new_sched,
        "activity_name": activity_name,
        "is_read": False,
        "created_at": now,
    }
    await db.member_notifications.insert_one(notif)

    try:
        from routes.push_notifications import send_push_to_members, NotificationPayload
        payload = NotificationPayload(
            title="تم تغيير موعد التدريب",
            body=message_ar,
            title_en="Training schedule changed",
            body_en=message_en,
            url="/member-schedule",
            tag="schedule-changed",
            data={"type": "schedule_changed"},
        )
        await send_push_to_members(payload, [member_id])
    except Exception:
        pass
