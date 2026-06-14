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
from utils.auth import get_current_user, require_branch_scope, resolve_branch_filter
from utils.cache import cache_get, cache_set, cache_invalidate

router = APIRouter(prefix="/levels", tags=["Levels"])

# ============ MODELS ============

class LevelMember(BaseModel):
    member_id: str
    member_name: Optional[str] = ""
    phone: Optional[str] = ""

class LevelCreate(BaseModel):
    level_number: int  # 1, 2, 3, 4, 5, 6
    activity_name: str  # Manual activity name
    activity_id: Optional[str] = None  # Optional FK to activities collection
    custom_name: Optional[str] = ""  # User-defined name for the level
    description: Optional[str] = ""
    members: List[str] = []  # List of member IDs
    branch_id: Optional[str] = None
    coach_id: Optional[str] = None  # Coach assigned to this level
    capacity: Optional[int] = None  # Max members allowed in this level
    # Weekday IDs the level is active on (e.g. ["saturday","monday"]).
    # None or empty = treated as "all days" (back-compat with old levels).
    days: Optional[List[str]] = None
    # Free-text time slot (e.g. "الساعة 4", "5:00 م"). Used by auto-assign
    # to match member subscription schedules.
    time_slot: Optional[str] = None

class Level(BaseModel):
    id: str
    level_number: int
    activity_name: str
    custom_name: Optional[str] = ""
    description: Optional[str] = ""
    members: List[str] = []
    members_details: List[LevelMember] = []
    branch_id: Optional[str] = None
    coach_id: Optional[str] = None
    created_at: str

def member_belongs_to_level(activities, level_id) -> bool:
    """Return True if the member should be shown in / counted for ``level_id``.

    The authoritative link between a member and a level is ``activity.level_id``.
    A member is considered to belong to ``level_id`` when:
      - none of their activities carry a level_id (un-backfilled legacy rows are
        kept where they are), OR
      - at least one activity links to this exact level (covers multi-activity
        members who legitimately appear in more than one level).
    They do NOT belong when their activities link only to OTHER levels — that
    means they were reassigned and their id is just left over here (stale).
    """
    linked_levels = {a.get("level_id") for a in (activities or []) if a.get("level_id")}
    if not linked_levels:
        return True
    return level_id in linked_levels


def _activity_group_name(name) -> str:
    """Map a free-text activity name to its coarse group.

    The academy names levels and member activities inconsistently (e.g. a
    level is "سباحة - الساعة 7" while the member's subscription is named
    "السباحة 4 ايام في الاسبوع"). Group matching lets us link the two even
    when the exact strings differ.
    """
    s = (name or "").strip()
    if not s:
        return ""
    if "سباحة" in s or "سباحه" in s:
        return "swimming"
    if "قدم" in s or "كره" in s or "كرة" in s:
        return "football"
    if "كارات" in s:
        return "karate"
    return ""


# ============ ROUTES ============

@router.get("")
async def get_levels(
    branch_filter: Optional[str] = None,
    activity_id: Optional[str] = None,
    activity_name: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    import asyncio
    is_admin = current_user.get("is_admin", False)
    # Branch filtering — fail-closed for non-admins without a branch_id.
    # Levels without a branch (shared/legacy) are visible to everyone, hence the $or.
    effective_branch = resolve_branch_filter(current_user, branch_filter)

    cache_key = f"levels:{'admin' if is_admin else 'user'}:{effective_branch or 'all'}:{activity_id or '-'}:{activity_name or '-'}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    query = {}
    if effective_branch:
        query["$or"] = [{"branch_id": effective_branch}, {"branch_id": None}, {"branch_id": {"$exists": False}}]

    if activity_id:
        query["activity_id"] = activity_id
    if activity_name:
        query["activity_name"] = activity_name

    levels = await db.levels.find(query, {"_id": 0}).sort("level_number", 1).to_list(100)

    # Collect all unique member IDs across all levels in one shot
    all_member_ids = list({mid for level in levels for mid in level.get("members", [])})

    if all_member_ids:
        # Single batch query for all members
        members_cursor = db.members.find(
            {"id": {"$in": all_member_ids}},
            {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "phone": 1, "activities": 1}
        )
        members_list = await members_cursor.to_list(len(all_member_ids) + 10)
        members_map = {m["id"]: m for m in members_list}

        # Find member IDs that need an invoice lookup (no schedule in activities)
        needs_invoice = []
        for mid in all_member_ids:
            m = members_map.get(mid)
            if m:
                has_schedule = any(a.get("schedule") for a in m.get("activities", []))
                if not has_schedule:
                    needs_invoice.append(mid)

        # Single batch query for invoices (latest paid per member)
        invoice_schedules = {}
        if needs_invoice:
            # Fetch recent paid invoices for all members that need them
            invoices_cursor = db.invoices.find(
                {"member_id": {"$in": needs_invoice}, "status": "paid"},
                {"_id": 0, "member_id": 1, "items": 1, "created_at": 1}
            ).sort("created_at", -1)
            invoices_list = await invoices_cursor.to_list(len(needs_invoice) * 5)
            # For each member, pick schedule from latest invoice
            for inv in invoices_list:
                mid = inv.get("member_id")
                if mid and mid not in invoice_schedules:
                    for item in inv.get("items", []):
                        if item.get("schedule"):
                            invoice_schedules[mid] = item["schedule"]
                            break

        # Build members_details for each level using the pre-fetched data
        stale_updates = []  # (level_id, valid_members_list) pairs that need DB cleanup
        for level in levels:
            if level.get("members"):
                members_details = []
                valid_ids = []
                for mid in level["members"]:
                    member = members_map.get(mid)
                    if member:
                        level_id_current = level.get("id", "")
                        activities = member.get("activities", [])
                        # Stale cross-link guard: if the member's activities link
                        # to specific level(s) and NONE is THIS level, the member
                        # was reassigned elsewhere and their id is just left over
                        # here. Skip them so the card and its count reflect only
                        # members actually assigned to this level. Members with no
                        # level_id at all (un-backfilled legacy rows) are kept, and
                        # a multi-activity member is kept as long as one of their
                        # activities links to this level.
                        if not member_belongs_to_level(activities, level_id_current):
                            continue
                        valid_ids.append(mid)
                        schedule = ""
                        # Priority 1: activity that matches the current level
                        for act in activities:
                            if act.get("level_id") == level_id_current:
                                if act.get("schedule"):
                                    schedule = act["schedule"]
                                elif act.get("training_days"):
                                    days_str = " و ".join(act["training_days"])
                                    time_str = act.get("training_time", "")
                                    schedule = f"{days_str} - {time_str}" if time_str else days_str
                                break
                        # Priority 2: any other activity with a schedule
                        if not schedule:
                            for act in activities:
                                if act.get("schedule"):
                                    schedule = act["schedule"]
                                    break
                                elif act.get("training_days"):
                                    days_str = " و ".join(act["training_days"])
                                    time_str = act.get("training_time", "")
                                    schedule = f"{days_str} - {time_str}" if time_str else days_str
                                    break
                        # Priority 3: invoice-based fallback
                        if not schedule:
                            schedule = invoice_schedules.get(mid, "")
                        today_str = datetime.now().strftime("%Y-%m-%d")
                        has_active = any(
                            a.get("status") == "active" and (not a.get("end_date") or a["end_date"] >= today_str)
                            for a in activities
                        )
                        members_details.append({
                            "member_id": member["id"],
                            "member_name": member.get("name_ar") or member.get("name", ""),
                            "phone": member.get("phone", ""),
                            "schedule": schedule,
                            "has_active_sub": has_active
                        })
                level["members_details"] = members_details
                # Sync members array to only valid IDs (remove stale/deleted member refs)
                if len(valid_ids) != len(level["members"]):
                    level["members"] = valid_ids
                    if level.get("id"):
                        stale_updates.append((level["id"], valid_ids))
            else:
                level["members_details"] = []

        # Fire-and-forget: clean up stale member IDs in the database
        for level_id, valid_ids in stale_updates:
            try:
                await db.levels.update_one(
                    {"id": level_id},
                    {"$set": {"members": valid_ids}}
                )
            except Exception:
                pass
    else:
        for level in levels:
            level["members_details"] = []

    for level in levels:
        cn = level.get("custom_name") or ""
        level["display_name"] = cn.strip() if cn.strip() else f"المستوى {level.get('level_number', '')}"
        level["hour"] = _extract_hour_12(level.get("time_slot") or level.get("activity_name") or "")
        # Legacy levels predate the temporary-close flag; treat them as open.
        level["is_active"] = level.get("is_active", True)

    cache_set(cache_key, levels, ttl=300)  # 5 min (members can change more often)
    return levels


@router.post("")
async def create_level(level: LevelCreate, current_user: dict = Depends(get_current_user)):
    level_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)

    if is_admin:
        if not level.branch_id or level.branch_id == "all":
            raise HTTPException(status_code=400, detail="يجب اختيار فرع للمستوى — لا يمكن إنشاء مستوى بدون فرع")
        final_branch_id = level.branch_id
    else:
        final_branch_id = require_branch_scope(current_user)
    branch_exists = await db.branches.find_one({"id": final_branch_id}, {"_id": 1})
    if not branch_exists:
        raise HTTPException(status_code=400, detail="الفرع المحدد غير موجود")
    
    level_doc = {
        "id": level_id,
        "level_number": level.level_number,
        "activity_name": level.activity_name,
        "activity_id": level.activity_id or None,
        "custom_name": level.custom_name or "",
        "description": level.description,
        "members": level.members,
        "branch_id": final_branch_id,
        "coach_id": level.coach_id or None,
        "capacity": int(level.capacity) if level.capacity else None,
        "days": list(level.days) if level.days else None,
        "time_slot": level.time_slot or None,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.levels.insert_one(level_doc)
    cache_invalidate("levels:")
    return {k: v for k, v in level_doc.items() if k != "_id"}


@router.put("/{level_id}")
async def update_level(level_id: str, level: LevelCreate, current_user: dict = Depends(get_current_user)):
    update_data = {
        "level_number": level.level_number,
        "activity_name": level.activity_name,
        "activity_id": level.activity_id or None,
        "custom_name": level.custom_name or "",
        "description": level.description,
        "members": level.members,
        "coach_id": level.coach_id or None,
        # capacity was previously dropped here, causing the "max capacity"
        # field in the edit dialog to silently revert to the stored value.
        "capacity": int(level.capacity) if level.capacity else None,
        "days": list(level.days) if level.days else None,
        "time_slot": level.time_slot or None,
    }
    
    result = await db.levels.find_one_and_update(
        {"id": level_id},
        {"$set": update_data},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Level not found")
    cache_invalidate("levels:")
    return {k: v for k, v in result.items() if k != "_id"}


class LevelActiveUpdate(BaseModel):
    is_active: bool


@router.patch("/{level_id}/active")
async def set_level_active(
    level_id: str,
    payload: LevelActiveUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Temporarily open/close a level.

    A closed level (is_active=False) is hidden from the invoice and
    registration-form level selectors so no NEW members can be registered
    onto it, while keeping its existing members and visibility in the levels
    management page intact.
    """
    result = await db.levels.find_one_and_update(
        {"id": level_id},
        {"$set": {"is_active": payload.is_active}},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Level not found")
    cache_invalidate("levels:")
    return {k: v for k, v in result.items() if k != "_id"}


@router.delete("/{level_id}")
async def delete_level(level_id: str, current_user: dict = Depends(get_current_user)):
    # Branch-scope the destructive delete: non-admins may only delete levels in
    # their own branch (or shared branchless levels). A foreign-branch id returns
    # 403 (not 404) so we don't silently no-op a cross-branch deletion attempt.
    require_branch_scope(current_user)
    user_branch = None
    if not (current_user or {}).get("is_admin", False):
        user_branch = (current_user or {}).get("branch_id")

    filter_doc = {"id": level_id}
    if user_branch:
        filter_doc["$or"] = [
            {"branch_id": user_branch},
            {"branch_id": None},
            {"branch_id": {"$exists": False}},
        ]

    result = await db.levels.delete_one(filter_doc)
    if result.deleted_count == 0:
        exists = await db.levels.find_one({"id": level_id}, {"_id": 0, "id": 1})
        if exists:
            raise HTTPException(status_code=403, detail="Forbidden: level belongs to another branch")
        raise HTTPException(status_code=404, detail="Level not found")
    # Clear any dangling references to this level from member activities so the
    # members don't end up stuck as "present without level" on the live board
    # (a deleted level_id can never be matched again). We blank the level_id on
    # the affected activity rows; admins can re-assign via the schedule builder
    # or the auto-assign tool.
    await db.members.update_many(
        {"activities.level_id": level_id},
        {"$set": {"activities.$[elem].level_id": ""}},
        array_filters=[{"elem.level_id": level_id}],
    )
    cache_invalidate("levels:")
    return {"message": "Level deleted"}


@router.post("/{level_id}/members/{member_id}")
async def add_member_to_level(level_id: str, member_id: str, current_user: dict = Depends(get_current_user)):
    """Add a member to a level"""
    level = await db.levels.find_one({"id": level_id})
    if not level:
        raise HTTPException(status_code=404, detail="Level not found")
    
    if member_id in level.get("members", []):
        # Self-healing path: the member's id is already in level.members but
        # the corresponding entry on the member document may have lost its
        # `level_id` (e.g. legacy data, renewed activity, bulk import). In
        # that case, instead of erroring, we silently re-link the activity
        # to this level and report success — that's exactly what the admin
        # is trying to achieve.
        match_aid = level.get("activity_id")
        match_aname = level.get("activity_name")
        member_doc = await db.members.find_one({"id": member_id}, {"_id": 0, "activities": 1})
        needs_heal = False
        has_matching_activity = False
        if member_doc:
            activities = member_doc.get("activities", []) or []
            for act in activities:
                matches = False
                if match_aid and act.get("activity_id") == match_aid:
                    matches = True
                if not matches and match_aname and act.get("activity_name") == match_aname:
                    matches = True
                if matches:
                    has_matching_activity = True
                if matches and not act.get("level_id"):
                    act["level_id"] = level["id"]
                    needs_heal = True
            if needs_heal:
                await db.members.update_one(
                    {"id": member_id},
                    {"$set": {"activities": activities}}
                )
                cache_invalidate("levels:")
                return {"message": "Member activity re-linked to existing level membership", "healed": True}
        # If the id is present in level.members but the member has no matching
        # activity at all (member deleted, activity removed, or stale legacy
        # data), the entry is stale. Quietly remove it and fall through so the
        # normal add flow below can run cleanly.
        if not has_matching_activity:
            await db.levels.update_one({"id": level_id}, {"$pull": {"members": member_id}})
            level["members"] = [mid for mid in level.get("members", []) if mid != member_id]
        else:
            # Genuine duplicate request, surface the error.
            raise HTTPException(status_code=400, detail="العضو موجود مسبقاً في هذا المستوى")

    # Prevent the same member from being added to more than one level of the
    # same activity (whether matched by activity_id or activity_name).
    dup_query = {
        "id": {"$ne": level_id},
        "members": member_id,
    }
    act_id = level.get("activity_id")
    act_name = level.get("activity_name")
    if act_id:
        dup_query["activity_id"] = act_id
    elif act_name:
        dup_query["activity_name"] = act_name
    existing = await db.levels.find_one(dup_query, {"_id": 0, "id": 1, "level_number": 1, "name": 1, "time_slot": 1})
    if existing:
        lvl_label = existing.get("name") or f"المستوى {existing.get('level_number', '')}"
        slot_label = existing.get("time_slot") or ""
        detail = f"العضو موجود بالفعل في {lvl_label}"
        if slot_label:
            detail += f" ({slot_label})"
        raise HTTPException(status_code=400, detail=detail)

    # Prevent the same member from being added to a DIFFERENT activity that
    # runs at the same time slot (clash on the academy schedule).
    slot = level.get("time_slot")
    if slot:
        clash_query = {
            "id": {"$ne": level_id},
            "members": member_id,
            "time_slot": slot,
        }
        if act_id:
            clash_query["activity_id"] = {"$ne": act_id}
        elif act_name:
            clash_query["activity_name"] = {"$ne": act_name}
        clash = await db.levels.find_one(
            clash_query,
            {"_id": 0, "activity_name": 1, "level_number": 1, "name": 1, "time_slot": 1},
        )
        if clash:
            other_act = clash.get("activity_name") or "نشاط آخر"
            other_lvl = clash.get("name") or f"المستوى {clash.get('level_number', '')}"
            raise HTTPException(
                status_code=400,
                detail=f"العضو مسجّل بالفعل في {other_act} - {other_lvl} في نفس التوقيت ({slot})",
            )

    await db.levels.update_one(
        {"id": level_id},
        {"$addToSet": {"members": member_id}}
    )

    # Backfill level_id on the member's matching activity entry so that
    # downstream lookups (member portal, coach resolution) can find the level
    # without needing to scan levels.members[]. Match by activity_id when the
    # level has one, else by activity_name.
    match_aid = level.get("activity_id")
    match_aname = level.get("activity_name")
    member_doc = await db.members.find_one({"id": member_id}, {"_id": 0, "activities": 1})
    if member_doc:
        activities = member_doc.get("activities", []) or []
        changed = False
        matched_any = False
        for act in activities:
            matches = False
            # Match by activity_id OR activity_name — older member records may
            # only have activity_name populated, so we must accept either.
            if match_aid and act.get("activity_id") == match_aid:
                matches = True
            if not matches and match_aname and act.get("activity_name") == match_aname:
                matches = True
            if matches:
                matched_any = True
                if act.get("level_id") != level_id:
                    act["level_id"] = level_id
                    changed = True
        # Fallback: no activity matched by exact id/name. Without a backfilled
        # level_id, get_levels() drops this member on the next refetch (their
        # activities link to no/other levels) and strips them back out of
        # level.members — so the add silently reverts. Link by activity GROUP
        # instead (e.g. level "سباحة - الساعة 7" ↔ member "السباحة 4 ايام"),
        # preferring an active subscription, so the membership actually sticks.
        if not matched_any:
            level_group = _activity_group_name(match_aname)
            if level_group:
                today_str = datetime.now().strftime("%Y-%m-%d")

                def _is_active(a):
                    return a.get("status") == "active" and (
                        not a.get("end_date") or a.get("end_date") >= today_str
                    )

                candidates = [
                    a for a in activities
                    if _activity_group_name(a.get("activity_name")) == level_group
                ]
                chosen = next((a for a in candidates if _is_active(a)), None)
                if chosen is None and candidates:
                    chosen = candidates[0]
                if chosen is not None and chosen.get("level_id") != level_id:
                    chosen["level_id"] = level_id
                    changed = True
        if changed:
            await db.members.update_one(
                {"id": member_id},
                {"$set": {"activities": activities}}
            )

    cache_invalidate("levels:")
    return {"message": "Member added to level"}


@router.delete("/{level_id}/members/{member_id}")
async def remove_member_from_level(level_id: str, member_id: str, current_user: dict = Depends(get_current_user)):
    """Remove a member from a level.

    Mirrors `add_member_to_level`: in addition to pulling the member id out of
    `levels.members[]`, we also clear `level_id` on the member's matching
    activity entry. Without this, /levels/unassigned-members keeps treating
    the activity as assigned (because it has a stale `level_id`), so undoing
    or removing an assignment would not restore the row to the unassigned
    list. We look up the level first to know which activity to clear.
    """
    level = await db.levels.find_one({"id": level_id}, {"_id": 0, "id": 1, "activity_id": 1, "activity_name": 1})
    if not level:
        raise HTTPException(status_code=404, detail="Level not found")

    result = await db.levels.update_one(
        {"id": level_id},
        {"$pull": {"members": member_id}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Member not found in level")

    match_aid = level.get("activity_id")
    match_aname = level.get("activity_name")
    member_doc = await db.members.find_one({"id": member_id}, {"_id": 0, "activities": 1})
    if member_doc:
        activities = member_doc.get("activities", []) or []
        changed = False
        matched_any = False
        for act in activities:
            matches = False
            if match_aid and act.get("activity_id") == match_aid:
                matches = True
            if not matches and match_aname and act.get("activity_name") == match_aname:
                matches = True
            if matches:
                matched_any = True
                if act.get("level_id") == level_id:
                    act["level_id"] = ""
                    changed = True
        # Mirror add_member_to_level's group fallback: a member can be linked to
        # this level via same-group matching (name mismatch), so clear by group
        # too — otherwise a stale level_id is left behind and the member never
        # returns to the unassigned list.
        if not matched_any:
            level_group = _activity_group_name(match_aname)
            if level_group:
                for act in activities:
                    if (
                        act.get("level_id") == level_id
                        and _activity_group_name(act.get("activity_name")) == level_group
                    ):
                        act["level_id"] = ""
                        changed = True
        if changed:
            await db.members.update_one(
                {"id": member_id},
                {"$set": {"activities": activities}}
            )

    cache_invalidate("levels:")
    return {"message": "Member removed from level"}


@router.get("/unassigned-members")
async def get_unassigned_members(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Members with active subscriptions that are NOT yet assigned to any level.

    Each unassigned activity is enriched with `invoice_level_id` and
    `invoice_level_name` taken from the most recent invoice item that
    matches the activity (by `activity_id`, falling back to
    `activity_name`) and carries a non-empty `level_id`. The UI uses this
    to show the level the member was originally registered for so the
    operator can confirm the assignment in one click instead of picking
    again.
    """
    effective_branch = resolve_branch_filter(current_user, branch_filter)

    query = {}
    if effective_branch:
        query["$or"] = [{"branch_id": effective_branch}, {"branch_id": None}, {"branch_id": {"$exists": False}}]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    members = await db.members.find(query, {"_id": 0}).to_list(10000)

    pre_result = []
    for m in members:
        unassigned_acts = []
        for a in (m.get("activities") or []):
            if a.get("status") != "active":
                continue
            end_date = a.get("end_date") or ""
            if end_date and end_date < today:
                continue
            lvl_id = a.get("level_id")
            if not lvl_id:
                unassigned_acts.append({
                    "activity_id": a.get("activity_id"),
                    "activity_name": a.get("activity_name"),
                    "schedule": a.get("schedule"),
                    "start_date": a.get("start_date"),
                    "end_date": a.get("end_date"),
                    "invoice_level_id": "",
                    "invoice_level_name": "",
                })
        if unassigned_acts:
            pre_result.append({
                "id": m.get("id"),
                "name": m.get("name_ar") or m.get("name"),
                "name_ar": m.get("name_ar"),
                "phone": m.get("phone"),
                "member_code": m.get("member_code"),
                "branch_id": m.get("branch_id"),
                "unassigned_activities": unassigned_acts,
            })

    # Drop activities for members who are already in a level of the same
    # activity group (swimming/football/karate), even when the activity_name
    # on the member record does not exactly match the level's activity_name.
    # This handles the case where the level uses naming like "سباحة - ساعه 6"
    # while the member's activity is named "السباحة 2 يوم في الاسبوع".
    def _activity_group(name):
        s = (name or "").strip()
        if not s:
            return ""
        if "سباحة" in s or "سباحه" in s:
            return "swimming"
        if "قدم" in s or "كره" in s or "كرة" in s:
            return "football"
        if "كارات" in s:
            return "karate"
        return ""

    member_ids = [m["id"] for m in pre_result if m.get("id")]
    member_existing_groups = {}
    if member_ids:
        existing_levels_cursor = db.levels.find(
            {"members": {"$in": member_ids}},
            {"_id": 0, "activity_name": 1, "members": 1},
        )
        existing_levels = await existing_levels_cursor.to_list(20000)
        for lvl in existing_levels:
            grp = _activity_group(lvl.get("activity_name"))
            if not grp:
                continue
            for mid in (lvl.get("members") or []):
                if mid in member_ids:
                    member_existing_groups.setdefault(mid, set()).add(grp)

    cleaned_result = []
    for m in pre_result:
        existing_groups = member_existing_groups.get(m["id"], set())
        if existing_groups:
            kept = []
            for a in m["unassigned_activities"]:
                grp = _activity_group(a.get("activity_name"))
                if grp and grp in existing_groups:
                    continue
                kept.append(a)
            m["unassigned_activities"] = kept
        if m["unassigned_activities"]:
            cleaned_result.append(m)
    pre_result = cleaned_result

    member_ids = [m["id"] for m in pre_result if m.get("id")]
    invoices_by_member: dict = {}
    if member_ids:
        # `items.level_id: {$nin: [null, ""]}` is unsafe on an array field —
        # it would EXCLUDE any invoice whose items array contains *any*
        # element with a missing or empty level_id, even if other items in
        # the same invoice have a valid one. We need element-level matching
        # via $elemMatch so the predicate runs per item and matches the
        # invoice if at least one item has a non-empty level_id.
        inv_query = {
            "member_id": {"$in": member_ids},
            "items": {"$elemMatch": {"level_id": {"$exists": True, "$nin": [None, ""]}}},
        }
        inv_cursor = db.invoices.find(
            inv_query,
            {"_id": 0, "member_id": 1, "items": 1, "created_at": 1, "paid_at": 1, "status": 1},
        )
        all_invs = await inv_cursor.to_list(20000)
        for inv in all_invs:
            mid = inv.get("member_id")
            if not mid:
                continue
            invoices_by_member.setdefault(mid, []).append(inv)
        for mid, lst in invoices_by_member.items():
            lst.sort(key=lambda i: (i.get("paid_at") or i.get("created_at") or ""), reverse=True)

    for m in pre_result:
        invs = invoices_by_member.get(m["id"], [])
        for a in m["unassigned_activities"]:
            target_aid = a.get("activity_id") or ""
            target_aname = a.get("activity_name") or ""
            chosen_lid = ""
            chosen_lname = ""
            for inv in invs:
                for it in (inv.get("items") or []):
                    lid = (it.get("level_id") or "").strip()
                    if not lid:
                        continue
                    matches = False
                    if target_aid and (it.get("activity_id") or "") == target_aid:
                        matches = True
                    if not matches and target_aname and (it.get("activity_name") or "") == target_aname:
                        matches = True
                    if matches:
                        chosen_lid = lid
                        chosen_lname = (it.get("level_name") or "").strip()
                        break
                if chosen_lid:
                    break
            a["invoice_level_id"] = chosen_lid
            a["invoice_level_name"] = chosen_lname

    return {"count": len(pre_result), "members": pre_result}


@router.get("/unassigned-count")
async def get_unassigned_count(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Lightweight: just the count of unassigned members for sidebar badge."""
    data = await get_unassigned_members(branch_filter=branch_filter, current_user=current_user)
    return {"count": data["count"]}


@router.get("/{level_id}/count")
async def get_level_member_count(level_id: str, current_user: dict = Depends(get_current_user)):
    """Get the count of members in a level (deduplicated, using actual capacity)."""
    level = await db.levels.find_one(
        {"id": level_id},
        {"_id": 0, "members": 1, "level_number": 1, "activity_name": 1, "capacity": 1}
    )
    if not level:
        raise HTTPException(status_code=404, detail="Level not found")

    raw_members = level.get("members", []) or []
    seen = set()
    for m in raw_members:
        if isinstance(m, str):
            key = m
        elif isinstance(m, dict):
            key = m.get("id") or m.get("member_id")
        else:
            key = None
        if not key or key in seen:
            continue
        seen.add(key)
    member_count = len(seen)

    activity_name = (level.get("activity_name") or "").lower()
    default_capacity = 6 if "swim" in activity_name or "سباح" in activity_name else 10
    try:
        max_capacity = int(level.get("capacity") or default_capacity)
    except (TypeError, ValueError):
        max_capacity = default_capacity

    return {
        "level_id": level_id,
        "level_number": level.get("level_number"),
        "activity_name": level.get("activity_name"),
        "member_count": member_count,
        "is_full": member_count >= max_capacity,
        "max_capacity": max_capacity,
    }


def _extract_hour_12(text: str):
    """Extract the leading hour from a time-bearing string and return it as a
    12h integer in 1..12. Handles all the formats used in this app:
    - Arabic free-text: "الساعة 6", "السبت والإثنين 6:00 م", "الساعة 5:30"
    - English/digits:   "6:00 PM", "18:00", "6"
    Returns None if no usable hour can be parsed.

    Why 12h: every level slot in the UI ("الساعة 3" .. "الساعة 8") is a bare
    hour with no AM/PM, while invoice/registration schedules are written as
    "6:00 م". Comparing modulo 12 lets these match without forcing the admin
    to re-enter every slot in 24h notation. Sports training is afternoon/
    evening, so 12h granularity is enough to distinguish slots in practice.
    """
    if not text:
        return None
    import re as _re
    m = _re.search(r"(\d{1,2})", str(text))
    if not m:
        return None
    h = int(m.group(1))
    if 0 <= h <= 23:
        if h == 0:
            return 12
        if h <= 12:
            return h
        return h - 12
    return None


def _times_match(level_slot: str, schedule_text: str) -> bool:
    """Return True only if BOTH the level's `time_slot` and the subscription
    schedule resolve to the same 12h hour.

    Hour is now a required matching signal (see Task #177): with activity
    treated as a soft tiebreaker, an unslotted level can no longer be a
    catch-all match for every subscription — that would over-assign across
    activities. Levels without a parseable hour (legacy, missing time_slot)
    therefore won't match anything until the admin places them in the
    Schedule Builder."""
    lh = _extract_hour_12(level_slot)
    if lh is None:
        return False
    sh = _extract_hour_12(schedule_text or "")
    if sh is None:
        return False
    return lh == sh


def _branches_compatible(level_branch, member_branch) -> bool:
    """Levels with branch_id None are shared and match every member.
    Otherwise both must match. A member without branch_id is treated as
    matching shared (None) levels and any specific level when admin runs the
    job (admin-scope already passes the right candidate set)."""
    if not level_branch:
        return True
    if not member_branch:
        return True
    return level_branch == member_branch


_TIME_PATTERN_TOKENS = (
    "الساعه", "الساعة", "ساعه", "ساعة",
    "صباحاً", "صباحا", "صباحًا", "مساءً", "مساءا", "مساء",
    "ص", "م", "AM", "PM", "am", "pm",
)


def _strip_time_from_name(text: str) -> str:
    """Best-effort: remove ONLY time-related tokens/numbers from a level name
    so we can show a cleaner activity-only label. We deliberately keep digits
    that look like activity identifiers (e.g. 'السباحة 2 يوم') and only strip
    digits that are clearly part of a time expression (e.g. 'الساعه 4',
    '5:30 PM', '7 ص').
    Example: 'سباحة - الساعه 4' -> 'سباحة'.
             'السباحة 2 يوم في الاسبوع' -> 'السباحة 2 يوم في الاسبوع'."""
    if not text:
        return ""
    import re as _re
    s = str(text)
    hour_token = r"\d{1,2}(?:[:.]\d{1,2})?"
    pre_tokens = [t for t in _TIME_PATTERN_TOKENS if any(c.isalpha() for c in t) and any('\u0600' <= c <= '\u06FF' for c in t)]
    suf_tokens = ["صباحاً", "صباحا", "صباحًا", "مساءً", "مساءا", "مساء", "AM", "PM", "am", "pm", "ص", "م"]
    if pre_tokens:
        pre_pat = "|".join(_re.escape(t) for t in pre_tokens)
        s = _re.sub(rf"(?:{pre_pat})\s*{hour_token}", " ", s)
    if suf_tokens:
        suf_pat = "|".join(_re.escape(t) for t in suf_tokens)
        s = _re.sub(rf"{hour_token}\s*(?:{suf_pat})\b", " ", s)
    for tok in _TIME_PATTERN_TOKENS:
        s = _re.sub(rf"\b{_re.escape(tok)}\b", " ", s)
    s = _re.sub(r"[\-–—]+", " ", s)
    s = _re.sub(r"\s+", " ", s).strip()
    return s


def _suggest_activity_for_level(level_name: str, activities: list) -> Optional[str]:
    """Return the best matching activity_id for a level name, or None.
    Strategy: start from the cleaned (time-stripped) activity-token of the
    level, then prefer the activity whose name_ar contains that token (or vice
    versa). When ties exist we don't guess — the admin must pick explicitly."""
    if not activities:
        return None
    token = _strip_time_from_name(level_name).lower()
    if not token:
        return None
    candidates = []
    for act in activities:
        aname = (act.get("name_ar") or act.get("name") or "").strip().lower()
        if not aname:
            continue
        if token in aname or aname in token:
            candidates.append(act)
        else:
            # Word-by-word overlap on the leading word (e.g. "سباحة" in "السباحة 2 يوم")
            tk_words = [w for w in token.split() if w]
            an_words = [w for w in aname.split() if w]
            if tk_words and an_words:
                # Match on stem-like presence: any token word appears as
                # substring of any activity word (catches "كرة قدم" vs "كرة القدم").
                for tw in tk_words:
                    if any(tw in aw or aw in tw for aw in an_words):
                        candidates.append(act)
                        break
    if not candidates:
        return None
    # Prefer the activity with the shortest name_ar (more specific match wins
    # for ties: e.g. exact "سباحه" beats "السباحة 2 يوم في الاسبوع").
    candidates.sort(key=lambda a: len(a.get("name_ar") or a.get("name") or ""))
    return candidates[0].get("id")


@router.get("/cleanup-suggestions")
async def get_levels_cleanup_suggestions(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Return every level with auto-extracted activity_id / time_slot / clean
    name suggestions. The frontend renders these as pre-filled defaults the
    admin can accept or override before saving."""
    require_branch_scope(current_user)
    effective_branch = resolve_branch_filter(current_user, branch_filter)

    query = {}
    if effective_branch:
        query["$or"] = [
            {"branch_id": effective_branch},
            {"branch_id": None},
            {"branch_id": {"$exists": False}},
        ]

    levels = await db.levels.find(query, {"_id": 0}).sort("level_number", 1).to_list(500)

    activities = await db.activities.find(
        {}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "branch_id": 1}
    ).to_list(200)

    activity_index = {a["id"]: a for a in activities if a.get("id")}

    out = []
    incomplete = 0
    for lvl in levels:
        current_aid = lvl.get("activity_id") or None
        current_slot = lvl.get("time_slot") or None
        current_days = lvl.get("days") or []

        is_complete = bool(current_aid) and bool(current_slot)
        if not is_complete:
            incomplete += 1

        suggested_aid = current_aid or _suggest_activity_for_level(
            lvl.get("activity_name") or "", activities
        )
        hour = _extract_hour_12(lvl.get("activity_name") or "")
        suggested_slot = current_slot or (f"الساعة {hour}" if hour else "")
        clean_name = _strip_time_from_name(lvl.get("activity_name") or "")

        out.append({
            "id": lvl.get("id"),
            "level_number": lvl.get("level_number"),
            "activity_name": lvl.get("activity_name") or "",
            "custom_name": lvl.get("custom_name") or "",
            "branch_id": lvl.get("branch_id"),
            "members_count": len(lvl.get("members") or []),
            "current": {
                "activity_id": current_aid,
                "time_slot": current_slot,
                "days": current_days,
            },
            "suggested": {
                "activity_id": suggested_aid,
                "time_slot": suggested_slot,
                "clean_name": clean_name,
            },
            "is_complete": is_complete,
        })

    activity_options = [
        {
            "id": a.get("id"),
            "name": a.get("name_ar") or a.get("name") or "",
            "branch_id": a.get("branch_id"),
        }
        for a in activities
        if (a.get("name_ar") or a.get("name"))
    ]
    activity_options.sort(key=lambda x: x["name"])

    return {
        "totals": {
            "total": len(levels),
            "complete": len(levels) - incomplete,
            "incomplete": incomplete,
        },
        "levels": out,
        "activity_options": activity_options,
    }


class LevelCleanupItem(BaseModel):
    id: str
    activity_id: Optional[str] = None
    time_slot: Optional[str] = None
    days: Optional[List[str]] = None
    activity_name: Optional[str] = None  # if admin chose a "clean name", use it


class LevelCleanupBulk(BaseModel):
    items: List[LevelCleanupItem]


@router.post("/cleanup/bulk")
async def apply_levels_cleanup_bulk(
    payload: LevelCleanupBulk,
    current_user: dict = Depends(get_current_user),
):
    """Apply cleanup edits (activity_id, time_slot, days, optional renamed
    activity_name) to many levels in one call. Each item is updated with $set
    so unspecified fields are preserved. For non-admin users, the update is
    constrained to levels in their own branch (or shared branchless levels);
    foreign-branch IDs return `forbidden`. Returns per-item status."""
    require_branch_scope(current_user)

    user_branch = None
    if not (current_user or {}).get("is_admin", False):
        user_branch = (current_user or {}).get("branch_id")

    results = []
    for it in payload.items:
        update_doc = {}
        if it.activity_id is not None:
            update_doc["activity_id"] = it.activity_id or None
        if it.time_slot is not None:
            update_doc["time_slot"] = it.time_slot or None
        if it.days is not None:
            update_doc["days"] = list(it.days) if it.days else None
        if it.activity_name is not None and it.activity_name.strip():
            update_doc["activity_name"] = it.activity_name.strip()
        if not update_doc:
            results.append({"id": it.id, "status": "noop"})
            continue

        filter_doc = {"id": it.id}
        if user_branch:
            filter_doc["$or"] = [
                {"branch_id": user_branch},
                {"branch_id": None},
                {"branch_id": {"$exists": False}},
            ]

        try:
            res = await db.levels.update_one(filter_doc, {"$set": update_doc})
            if getattr(res, "matched_count", 0) == 0:
                exists = await db.levels.find_one({"id": it.id}, {"_id": 0, "id": 1})
                if exists and user_branch:
                    results.append({"id": it.id, "status": "forbidden"})
                else:
                    results.append({"id": it.id, "status": "not_found"})
            else:
                results.append({"id": it.id, "status": "ok"})
        except Exception as e:
            results.append({"id": it.id, "status": "error", "error": str(e)})

    cache_invalidate("levels:")
    ok = sum(1 for r in results if r["status"] == "ok")
    return {
        "applied": ok,
        "total": len(results),
        "results": results,
    }


@router.get("/schedule-snapshot")
async def get_levels_schedule_snapshot(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Return all levels in scope already bucketed by (weekday, hour) so the
    schedule-builder UI can render directly without client-side bucketing.

    Shape:
        {
          "days_order": ["saturday", ..., "friday"],
          "days": {
            "saturday": { "hours": { "5": [<level>, ...], "6": [...] } },
            ...
          },
          "unscheduled": [<level>, ...],   # levels missing days[] or hour
          "activity_options": [...],       # for the optional activity tag
          "totals": {"total_levels", "scheduled", "unscheduled"}
        }
    A level appears once under each weekday it's active on, at its single
    hour cell. This mirrors the user's mental model: same hour, multiple days.
    """
    require_branch_scope(current_user)
    effective_branch = resolve_branch_filter(current_user, branch_filter)

    query = {}
    if effective_branch:
        query["$or"] = [
            {"branch_id": effective_branch},
            {"branch_id": None},
            {"branch_id": {"$exists": False}},
        ]

    levels = await db.levels.find(query, {"_id": 0}).sort("level_number", 1).to_list(1000)
    activities = await db.activities.find(
        {}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "branch_id": 1}
    ).to_list(200)

    days_order = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"]
    days = {d: {"hours": {}} for d in days_order}
    unscheduled = []

    def _level_card(lvl, hour):
        return {
            "id": lvl.get("id"),
            "level_number": lvl.get("level_number"),
            "activity_name": lvl.get("activity_name") or "",
            "custom_name": lvl.get("custom_name") or "",
            "activity_id": lvl.get("activity_id") or None,
            "branch_id": lvl.get("branch_id"),
            "time_slot": lvl.get("time_slot") or "",
            "hour": hour,
            "days": list(lvl.get("days") or []),
            "capacity": int(lvl.get("capacity")) if lvl.get("capacity") else None,
            "members_count": len(lvl.get("members") or []),
            "coach_id": lvl.get("coach_id") or None,
        }

    for lvl in levels:
        hour = _extract_hour_12(lvl.get("time_slot") or "") or _extract_hour_12(lvl.get("activity_name") or "")
        lvl_days = lvl.get("days") or []
        info = _level_card(lvl, hour)
        if not hour or not lvl_days:
            unscheduled.append(info)
            continue
        for d in lvl_days:
            if d not in days:
                continue
            days[d]["hours"].setdefault(str(hour), []).append(info)

    for d_data in days.values():
        for hour_key in d_data["hours"]:
            d_data["hours"][hour_key].sort(key=lambda x: (x.get("level_number") or 999))

    activity_options = [
        {
            "id": a.get("id"),
            "name": a.get("name_ar") or a.get("name") or "",
            "branch_id": a.get("branch_id"),
        }
        for a in activities
        if (a.get("name_ar") or a.get("name"))
    ]
    activity_options.sort(key=lambda x: x["name"])

    return {
        "days_order": days_order,
        "days": days,
        "unscheduled": unscheduled,
        "activity_options": activity_options,
        "totals": {
            "total_levels": len(levels),
            "scheduled": len(levels) - len(unscheduled),
            "unscheduled": len(unscheduled),
        },
    }


class LevelSlotUpdate(BaseModel):
    level_id: str
    days_to_add: Optional[List[str]] = None
    days_to_remove: Optional[List[str]] = None
    hour: Optional[int] = None
    activity_id: Optional[str] = None


@router.post("/schedule-slot")
async def update_level_schedule_slot(
    payload: LevelSlotUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update a single level's (days, hour) placement in the weekly schedule.

    - `days_to_add` / `days_to_remove`: weekday ids merged into level.days[].
    - `hour`: 1..12, written as `time_slot = "الساعة <h>"`.
    - `activity_id`: only set if explicitly provided (optional tag).

    Branch-scoped: non-admins can only edit levels in their own branch
    (or shared branchless levels). Foreign-branch IDs return 403.
    """
    require_branch_scope(current_user)

    user_branch = None
    if not (current_user or {}).get("is_admin", False):
        user_branch = (current_user or {}).get("branch_id")

    filter_doc = {"id": payload.level_id}
    if user_branch:
        filter_doc["$or"] = [
            {"branch_id": user_branch},
            {"branch_id": None},
            {"branch_id": {"$exists": False}},
        ]

    lvl = await db.levels.find_one(filter_doc, {"_id": 0})
    if not lvl:
        exists = await db.levels.find_one({"id": payload.level_id}, {"_id": 0, "id": 1})
        if exists:
            raise HTTPException(status_code=403, detail="forbidden")
        raise HTTPException(status_code=404, detail="Level not found")

    valid_days = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"]
    cur_set = set(lvl.get("days") or [])
    for d in (payload.days_to_remove or []):
        cur_set.discard(d)
    for d in (payload.days_to_add or []):
        if d in valid_days:
            cur_set.add(d)
    new_days = [d for d in valid_days if d in cur_set]

    update = {"days": new_days if new_days else None}

    if payload.hour is not None:
        h = int(payload.hour)
        if h < 1 or h > 12:
            raise HTTPException(status_code=400, detail="hour must be between 1 and 12")
        update["time_slot"] = f"الساعة {h}"

    if payload.activity_id is not None:
        update["activity_id"] = payload.activity_id or None

    # Re-apply the same branch-scoped filter on the write so a non-admin
    # can't race a foreign-branch level into their scope between the read
    # check above and the update (mirrors the cleanup-bulk safety pattern).
    await db.levels.update_one(filter_doc, {"$set": update})
    cache_invalidate("levels:")

    refreshed = await db.levels.find_one({"id": payload.level_id}, {"_id": 0})
    if refreshed:
        refreshed["hour"] = _extract_hour_12(
            refreshed.get("time_slot") or refreshed.get("activity_name") or ""
        )
    return {"status": "ok", "level": refreshed}


class LevelDetailsUpdate(BaseModel):
    level_id: str
    activity_id: Optional[str] = None
    activity_name: Optional[str] = None
    capacity: Optional[int] = None
    custom_name: Optional[str] = None
    coach_id: Optional[str] = None


@router.patch("/details")
async def update_level_details(
    payload: LevelDetailsUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Partial update of a level's metadata from inside the Schedule Builder.

    Updates only the supplied non-None fields. Crucially this does NOT
    touch `members`, `days`, or `time_slot` — the slot endpoint owns those
    and we don't want to wipe member rosters when an admin just wants to
    rename the activity tag or change the capacity.

    Branch-scoped (mirrors schedule-slot): non-admins are limited to their
    own branch (or shared/branchless levels).
    """
    require_branch_scope(current_user)

    user_branch = None
    if not (current_user or {}).get("is_admin", False):
        user_branch = (current_user or {}).get("branch_id")

    filter_doc = {"id": payload.level_id}
    if user_branch:
        filter_doc["$or"] = [
            {"branch_id": user_branch},
            {"branch_id": None},
            {"branch_id": {"$exists": False}},
        ]

    lvl = await db.levels.find_one(filter_doc, {"_id": 0})
    if not lvl:
        exists = await db.levels.find_one({"id": payload.level_id}, {"_id": 0, "id": 1})
        if exists:
            raise HTTPException(status_code=403, detail="forbidden")
        raise HTTPException(status_code=404, detail="Level not found")

    update = {}
    if payload.activity_id is not None:
        update["activity_id"] = payload.activity_id or None
    if payload.activity_name is not None:
        update["activity_name"] = payload.activity_name
    if payload.custom_name is not None:
        update["custom_name"] = payload.custom_name
    if payload.coach_id is not None:
        update["coach_id"] = payload.coach_id or None
    if payload.capacity is not None:
        try:
            cap = int(payload.capacity)
            if cap < 0:
                raise ValueError
            update["capacity"] = cap if cap > 0 else None
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="capacity must be a non-negative integer")

    if not update:
        return {"status": "noop", "level": lvl}

    await db.levels.update_one(filter_doc, {"$set": update})
    cache_invalidate("levels:")

    refreshed = await db.levels.find_one({"id": payload.level_id}, {"_id": 0})
    if refreshed:
        refreshed["hour"] = _extract_hour_12(
            refreshed.get("time_slot") or refreshed.get("activity_name") or ""
        )
    return {"status": "ok", "level": refreshed}


@router.post("/auto-assign")
async def auto_assign_members_to_levels(
    dry_run: bool = True,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Auto-assign every active member to the most appropriate existing level.

    Reads each member's active activities (priority 1: member.activities,
    priority 2: paid/partial invoice items, priority 3: pending registration
    form items — deduped by (member_id, activity_id|activity_name)). For each
    (member, activity) pair, finds candidate levels by activity match,
    branch compatibility, weekday overlap, and time-slot compatibility, then
    picks the lowest-numbered level that still has remaining capacity.

    `dry_run=True` (default) only returns the plan; `dry_run=False` performs
    the writes (push to `level.members[]`, set `activities[].level_id` on the
    member document) and invalidates the levels cache.
    """
    from routes.attendance import parse_schedule_days

    effective_branch = resolve_branch_filter(current_user, branch_filter)

    level_query = {}
    if effective_branch:
        level_query["$or"] = [
            {"branch_id": effective_branch},
            {"branch_id": None},
            {"branch_id": {"$exists": False}},
        ]
    levels = await db.levels.find(level_query, {"_id": 0}).sort("level_number", 1).to_list(1000)

    member_query = {}
    if effective_branch:
        member_query["$or"] = [
            {"branch_id": effective_branch},
            {"branch_id": None},
            {"branch_id": {"$exists": False}},
        ]
    members = await db.members.find(member_query, {"_id": 0}).to_list(20000)
    member_ids = [m.get("id") for m in members if m.get("id")]
    members_by_id = {m["id"]: m for m in members if m.get("id")}

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    invoices = []
    if member_ids:
        invoices = await db.invoices.find(
            {
                "member_id": {"$in": member_ids},
                "status": {"$in": ["paid", "partial"]},
            },
            {"_id": 0, "member_id": 1, "items": 1, "created_at": 1, "branch_id": 1},
        ).sort("created_at", -1).to_list(50000)

    phones = list({m.get("phone") for m in members if m.get("phone")})
    reg_forms = []
    if phones:
        # Only "pending" registration forms count as a current subscription
        # (converted/cancelled forms have already been turned into invoices and
        # would otherwise produce duplicate work). We also re-apply the branch
        # filter so a phone reused across branches doesn't cross-leak.
        rf_query = {"customer_phone": {"$in": phones}, "status": "pending"}
        if effective_branch:
            rf_query["$or"] = [
                {"branch_id": effective_branch},
                {"branch_id": None},
                {"branch_id": {"$exists": False}},
            ]
        reg_forms = await db.registration_forms.find(
            rf_query,
            {"_id": 0, "customer_phone": 1, "items": 1, "created_at": 1, "branch_id": 1, "status": 1},
        ).sort("created_at", -1).to_list(50000)
    members_by_phone = {}
    for m in members:
        ph = m.get("phone")
        if ph:
            members_by_phone.setdefault(ph, m)

    def _normalize_subs():
        """Yield dicts {member_id, activity_id, activity_name, schedule,
        end_date, start_date, source} from all three sources, deduped by
        (member_id, activity_id or activity_name lowercased)."""
        seen = set()
        out = []
        for m in members:
            mid = m.get("id")
            if not mid:
                continue
            for a in (m.get("activities") or []):
                if a.get("status") and a.get("status") != "active":
                    continue
                end_d = a.get("end_date") or ""
                if end_d and end_d < today:
                    continue
                aid = a.get("activity_id") or ""
                aname = a.get("activity_name") or ""
                if not aid and not aname:
                    continue
                key = (mid, (aid or aname.strip().lower()))
                if key in seen:
                    continue
                seen.add(key)
                out.append({
                    "member_id": mid,
                    "activity_id": aid,
                    "activity_name": aname,
                    "schedule": a.get("schedule") or "",
                    "start_date": a.get("start_date") or "",
                    "end_date": end_d,
                    "level_id": a.get("level_id") or "",
                    "source": "member_activities",
                })
        for inv in invoices:
            mid = inv.get("member_id")
            if not mid or mid not in members_by_id:
                continue
            for it in inv.get("items", []) or []:
                if it.get("is_product"):
                    continue
                aid = it.get("activity_id") or ""
                aname = it.get("activity_name") or ""
                if not aid and not aname:
                    continue
                key = (mid, (aid or aname.strip().lower()))
                if key in seen:
                    continue
                end_d = it.get("end_date") or ""
                if not end_d and it.get("period") and " - " in it["period"]:
                    end_d = it["period"].split(" - ")[-1].strip()
                # For invoice / registration sources we require an explicit
                # end_date >= today. Undated line-items can be years old or
                # one-off product purchases mislabelled as services, and we'd
                # rather skip than over-assign stale records.
                if not end_d or end_d < today:
                    continue
                seen.add(key)
                out.append({
                    "member_id": mid,
                    "activity_id": aid,
                    "activity_name": aname,
                    "schedule": it.get("schedule") or "",
                    "start_date": it.get("start_date") or "",
                    "end_date": end_d,
                    "level_id": "",
                    "source": "invoices",
                })
        for rf in reg_forms:
            ph = rf.get("customer_phone")
            m = members_by_phone.get(ph) if ph else None
            if not m:
                continue
            mid = m.get("id")
            if not mid:
                continue
            for it in rf.get("items", []) or []:
                if it.get("is_product"):
                    continue
                aid = it.get("activity_id") or ""
                aname = it.get("activity_name") or ""
                if not aid and not aname:
                    continue
                key = (mid, (aid or aname.strip().lower()))
                if key in seen:
                    continue
                end_d = it.get("end_date") or ""
                if not end_d and it.get("period") and " - " in it["period"]:
                    end_d = it["period"].split(" - ")[-1].strip()
                if not end_d or end_d < today:
                    continue
                seen.add(key)
                out.append({
                    "member_id": mid,
                    "activity_id": aid,
                    "activity_name": aname,
                    "schedule": it.get("schedule") or "",
                    "start_date": it.get("start_date") or "",
                    "end_date": end_d,
                    "level_id": "",
                    "source": "registration_forms",
                })
        return out

    subs = _normalize_subs()

    capacity_used = {l["id"]: len(l.get("members") or []) for l in levels}
    capacity_max = {l["id"]: (int(l.get("capacity")) if l.get("capacity") else None) for l in levels}
    pending_writes_per_member = {}

    would_assign = []
    unmatched = []
    already_correct = []
    by_source = {"member_activities": 0, "invoices": 0, "registration_forms": 0}

    # Levels without an hour cannot be picked under the post-Task-#177 matching
    # rule (branch + day + hour all required). Surface them so the UI can prompt
    # the admin to open the schedule builder and finish the setup.
    levels_without_time_slot = [
        {
            "id": lvl.get("id"),
            "level_number": lvl.get("level_number"),
            "activity_name": lvl.get("activity_name") or "",
            "custom_name": lvl.get("custom_name") or "",
            "branch_id": lvl.get("branch_id"),
        }
        for lvl in levels
        if not (lvl.get("time_slot") or "").strip()
    ]

    levels_by_id = {l["id"]: l for l in levels}
    # Reverse index: which levels each member is already a direct member of.
    # Used to mark (member, activity) pairs as already_correct even when the
    # activities[].level_id link is missing (recovery after a previous partial
    # link failure), so reruns don't re-propose existing memberships.
    member_levels_index = {}
    for lvl in levels:
        for m_id in (lvl.get("members") or []):
            member_levels_index.setdefault(m_id, set()).add(lvl["id"])

    def _level_matches_subscription(lvl, _aid, _aname_l, member_branch_id, _sched_days, _sched):
        """Verify a given level is a valid placement for this subscription.
        Branch + day overlap + hour are REQUIRED. Activity is intentionally
        NOT checked here — many real slots host multiple activities at the
        same (day, hour), and the same activity name appears at many hours,
        so activity is treated only as a soft tiebreaker during candidate
        ranking. This helper is also used to re-validate "already assigned"
        subscriptions, so dropping the activity gate prevents legacy levels
        with missing activity metadata from being flagged as stale."""
        if not lvl:
            return False
        if not _branches_compatible(lvl.get("branch_id"), member_branch_id):
            return False
        l_days = lvl.get("days") or []
        if l_days and _sched_days:
            if not any(d in l_days for d in _sched_days):
                return False
        if not _times_match(lvl.get("time_slot") or "", _sched):
            return False
        return True

    for sub in subs:
        mid = sub["member_id"]
        member = members_by_id.get(mid)
        if not member:
            continue
        member_branch = member.get("branch_id")
        aid = sub["activity_id"]
        aname = (sub["activity_name"] or "").strip()
        aname_l = aname.lower()
        sched = sub["schedule"]
        sched_days = parse_schedule_days(sched)

        existing_lid = sub.get("level_id")
        if existing_lid:
            existing_lvl = levels_by_id.get(existing_lid)
            # Only treat as already_correct if the existing level actually
            # matches this subscription on activity / branch / schedule.
            # Otherwise the stale link will be ignored and re-evaluated below.
            if _level_matches_subscription(existing_lvl, aid, aname_l, member_branch, sched_days, sched):
                already_correct.append({
                    "member_id": mid,
                    "member_name": member.get("name_ar") or member.get("name") or "",
                    "activity_name": aname,
                    "level_id": existing_lid,
                })
                continue
            # Stale level_id (level deleted, or activity/branch/schedule
            # changed). Do NOT auto-rewrite — surface as unmatched so an
            # admin reviews it. The auto-assign tool only writes net-new
            # placements; mutating existing links is out of scope.
            unmatched.append({
                "member_id": mid,
                "member_name": member.get("name_ar") or member.get("name") or "",
                "phone": member.get("phone") or "",
                "activity_name": aname,
                "schedule": sched,
                "source": sub["source"],
                "reason": "المستوى الحالي لا يطابق النشاط/التوقيت — يتطلب مراجعة يدوية",
                "reason_en": "Existing level no longer matches activity/schedule — needs manual review",
                "reason_key": "stale_link",
            })
            continue

        # Schedule must be parseable for any source that depends on it. We
        # only require parseable days when the candidate level itself has
        # restrictive days set; this keeps "any-day" levels working with
        # legacy un-parseable schedule strings.
        if not sched_days and not sched:
            unmatched.append({
                "member_id": mid,
                "member_name": member.get("name_ar") or member.get("name") or "",
                "phone": member.get("phone") or "",
                "activity_name": aname,
                "schedule": sched,
                "source": sub["source"],
                "reason": "لا يوجد جدول للنشاط",
                "reason_en": "No schedule on subscription",
                "reason_key": "no_schedule",
            })
            continue

        # Candidate pool: every level in scope. Activity is no longer a hard
        # filter — branch + day overlap + hour are the required signals.
        # Activity match is folded into the ranking below as a tiebreaker so
        # that, when several levels share the same (day, hour), the one
        # tagged with this subscription's activity wins.
        def _rank(lvl):
            l_aid = lvl.get("activity_id") or ""
            l_aname = (lvl.get("activity_name") or "").strip().lower()
            activity_match = 0
            if aid and l_aid and l_aid == aid:
                activity_match = 2
            elif aname_l and l_aname and l_aname == aname_l:
                activity_match = 1
            return (-activity_match, lvl.get("level_number") or 999)
        candidates = sorted(levels, key=_rank)

        # Recovery from a previous partial commit: if the member is already
        # listed in the .members[] of one of the candidate levels and that
        # level still passes branch/day/hour, skip — they're effectively
        # already placed even though the activities[].level_id link is
        # missing. This keeps reruns idempotent.
        already_in_levels = member_levels_index.get(mid, set())
        recovered = None
        for lvl in candidates:
            if lvl["id"] in already_in_levels and _level_matches_subscription(
                lvl, aid, aname_l, member_branch, sched_days, sched
            ):
                recovered = lvl
                break
        if recovered:
            already_correct.append({
                "member_id": mid,
                "member_name": member.get("name_ar") or member.get("name") or "",
                "activity_name": aname,
                "level_id": recovered["id"],
            })
            continue

        if not candidates:
            unmatched.append({
                "member_id": mid,
                "member_name": member.get("name_ar") or member.get("name") or "",
                "phone": member.get("phone") or "",
                "activity_name": aname,
                "schedule": sched,
                "source": sub["source"],
                "reason": "لا توجد مستويات بعد — استخدم \"جدولة المستويات\" أولاً",
                "reason_en": "No levels exist yet — use the schedule builder first",
                "reason_key": "no_levels",
            })
            continue

        # If the candidate set has any day-restricted level AND we couldn't
        # parse the schedule's days, treat as schedule-parse failure rather
        # than silently assigning to whatever level survives. This is the
        # explicit "schedule could not be parsed" reporting the spec asks for.
        any_day_restricted = any((lvl.get("days") or []) for lvl in candidates)
        if any_day_restricted and sched and not sched_days:
            unmatched.append({
                "member_id": mid,
                "member_name": member.get("name_ar") or member.get("name") or "",
                "phone": member.get("phone") or "",
                "activity_name": aname,
                "schedule": sched,
                "source": sub["source"],
                "reason": "تعذّر قراءة أيام الجدول",
                "reason_en": "Could not parse schedule days",
                "reason_key": "unparseable_days",
            })
            continue

        chosen = None
        chosen_reason = ""
        for lvl in candidates:
            if not _branches_compatible(lvl.get("branch_id"), member_branch):
                chosen_reason = chosen_reason or "branch_mismatch"
                continue
            lvl_days = lvl.get("days") or []
            if lvl_days and sched_days:
                if not any(d in lvl_days for d in sched_days):
                    chosen_reason = chosen_reason or "days_mismatch"
                    continue
            if not _times_match(lvl.get("time_slot") or "", sched):
                chosen_reason = chosen_reason or "time_mismatch"
                continue
            cap_max = capacity_max.get(lvl["id"])
            cap_used = capacity_used.get(lvl["id"], 0)
            if cap_max is not None and cap_used >= cap_max:
                chosen_reason = chosen_reason or "level_full"
                continue
            if mid in pending_writes_per_member.get(lvl["id"], set()):
                continue
            chosen = lvl
            break

        if not chosen:
            reason_map = {
                "branch_mismatch": ("الفرع غير مطابق", "Branch mismatch"),
                "days_mismatch": ("أيام التدريب غير مطابقة للمستوى", "Schedule days don't match any level"),
                "time_mismatch": ("التوقيت غير مطابق للمستوى", "Time slot doesn't match any level"),
                "level_full": ("جميع المستويات المطابقة ممتلئة", "All matching levels are full"),
            }
            ar, en = reason_map.get(chosen_reason or "", ("لم يتم العثور على مستوى مطابق", "No matching level found"))
            unmatched.append({
                "member_id": mid,
                "member_name": member.get("name_ar") or member.get("name") or "",
                "phone": member.get("phone") or "",
                "activity_name": aname,
                "schedule": sched,
                "source": sub["source"],
                "reason": ar,
                "reason_en": en,
                "reason_key": chosen_reason or "no_match",
            })
            continue

        capacity_used[chosen["id"]] = capacity_used.get(chosen["id"], 0) + 1
        pending_writes_per_member.setdefault(chosen["id"], set()).add(mid)
        by_source[sub["source"]] = by_source.get(sub["source"], 0) + 1
        would_assign.append({
            "member_id": mid,
            "member_name": member.get("name_ar") or member.get("name") or "",
            "phone": member.get("phone") or "",
            "member_code": member.get("member_code") or "",
            "activity_id": aid,
            "activity_name": aname or chosen.get("activity_name") or "",
            "schedule": sched,
            "level_id": chosen["id"],
            "level_number": chosen.get("level_number"),
            "level_name": chosen.get("custom_name") or f"المستوى {chosen.get('level_number', '')}",
            "level_time_slot": chosen.get("time_slot") or "",
            "source": sub["source"],
        })

    by_activity = {}
    for w in would_assign:
        key = w["activity_name"] or "(غير مسمى)"
        by_activity.setdefault(key, []).append(w)

    # Aggregate unmatched by reason_key so the UI can call out the dominant
    # cause (especially "time_mismatch" — the post-Task-#177 hour rule).
    by_reason = {}
    for u in unmatched:
        rk = u.get("reason_key") or "no_match"
        by_reason[rk] = by_reason.get(rk, 0) + 1

    response = {
        "dry_run": dry_run,
        "totals": {
            "would_assign": len(would_assign),
            "unmatched": len(unmatched),
            "already_correct": len(already_correct),
            "candidate_levels": len(levels),
            "members_scanned": len(members),
            "subscriptions_scanned": len(subs),
            "levels_without_time_slot": len(levels_without_time_slot),
        },
        "by_source": by_source,
        "by_reason": by_reason,
        "by_activity": [
            {"activity_name": k, "count": len(v), "assignments": v}
            for k, v in sorted(by_activity.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        ],
        "unmatched": unmatched,
        "already_correct_count": len(already_correct),
        "levels_without_time_slot": levels_without_time_slot,
    }

    if dry_run or not would_assign:
        return response

    # Atomic, per-assignment commit. For each (member, level) pair:
    # 1. Update the level with a filter that re-checks capacity & non-membership
    #    in one operation. If modified_count is 0, the slot was filled (or the
    #    member was already there) by another writer between dry-run and now.
    # 2. Only after the level update succeeds, link the level on the member
    #    document. We update one activity entry per write so a partial failure
    #    affects at most one (member, activity) pair.
    applied = 0
    capacity_skipped = []
    member_link_failures = []
    member_doc_cache = {}

    async def _link_member_activity(mid: str, aid: str, aname: str, target_lid: str) -> bool:
        """Set level_id on the member's matching activities[] entry.

        Returns True only if an existing entry was found and updated. We
        deliberately do NOT append a new activity row here — the auto-assign
        tool's contract is to make safe writes (level.members[] +
        activities[].level_id), and synthesizing activities would create
        phantom subscriptions for invoice / registration_form sources where
        the member.activities list hasn't been built yet. Such cases are
        reported to the caller as a member_link_failures entry.
        """
        mdoc = member_doc_cache.get(mid)
        if mdoc is None:
            mdoc = await db.members.find_one({"id": mid}, {"_id": 0, "activities": 1})
            if not mdoc:
                return False
            member_doc_cache[mid] = mdoc
        acts = mdoc.get("activities", []) or []
        target_aname_l = (aname or "").strip().lower()
        # Match by activity_id OR by normalized activity_name. Many legacy
        # member.activities entries only carry activity_name (no id), so we
        # mirror manual add_member_to_level and accept either.
        for act in acts:
            if act.get("level_id"):
                continue
            a_aid = act.get("activity_id") or ""
            a_aname = (act.get("activity_name") or "").strip().lower()
            id_match = bool(aid) and bool(a_aid) and a_aid == aid
            name_match = bool(target_aname_l) and a_aname == target_aname_l
            if id_match or name_match:
                act["level_id"] = target_lid
                await db.members.update_one({"id": mid}, {"$set": {"activities": acts}})
                mdoc["activities"] = acts
                return True
        return False

    for w in would_assign:
        lid = w["level_id"]
        mid = w["member_id"]
        cap_max = capacity_max.get(lid)

        # Build a filter that ONLY matches if (a) the member isn't already in
        # the level and (b) capacity wouldn't be exceeded by this write. This
        # is the race-safety guarantee: even if another admin assigned members
        # in parallel, $size + $lt makes the write a no-op when full.
        update_filter = {"id": lid, "members": {"$ne": mid}}
        if cap_max is not None:
            update_filter["$expr"] = {
                "$lt": [{"$size": {"$ifNull": ["$members", []]}}, cap_max]
            }
        try:
            res = await db.levels.update_one(
                update_filter,
                {"$addToSet": {"members": mid}},
            )
            modified = getattr(res, "modified_count", 0) or 0
        except Exception as e:
            member_link_failures.append({
                "member_id": mid, "level_id": lid, "stage": "level_update", "error": str(e),
            })
            continue

        if modified == 0:
            # Either the member is already in level.members (counts as success
            # for idempotency), or the level filled up. Verify which.
            current = await db.levels.find_one({"id": lid}, {"_id": 0, "members": 1})
            already_in = current and mid in (current.get("members") or [])
            if already_in:
                # Backfill the member's level_id even if level.members was
                # already correct — this is the same self-healing the manual
                # add_member_to_level performs.
                try:
                    await _link_member_activity(mid, w["activity_id"], w["activity_name"], lid)
                except Exception as e:
                    member_link_failures.append({
                        "member_id": mid, "level_id": lid, "stage": "member_link", "error": str(e),
                    })
                continue
            capacity_skipped.append({
                "member_id": mid,
                "member_name": w.get("member_name") or "",
                "activity_name": w.get("activity_name") or "",
                "level_id": lid,
                "level_name": w.get("level_name") or "",
                "reason": "امتلأ المستوى أثناء التنفيذ",
                "reason_en": "Level filled up during commit",
            })
            continue

        try:
            ok = await _link_member_activity(mid, w["activity_id"], w["activity_name"], lid)
            if not ok:
                member_link_failures.append({
                    "member_id": mid, "level_id": lid, "stage": "member_link", "error": "member_not_found",
                })
        except Exception as e:
            member_link_failures.append({
                "member_id": mid, "level_id": lid, "stage": "member_link", "error": str(e),
            })

        applied += 1

    cache_invalidate("levels:")

    response["applied"] = applied
    if capacity_skipped:
        response["capacity_skipped"] = capacity_skipped
    if member_link_failures:
        response["member_link_failures"] = member_link_failures
    return response


@router.post("/cleanup-duplicates")
async def cleanup_duplicate_members(current_user: dict = Depends(get_current_user)):
    """Remove duplicate member entries from every level (members[] + members_details[])."""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")

    levels_cleaned = 0
    duplicates_removed = 0
    cursor = db.levels.find({})
    async for lvl in cursor:
        members = lvl.get("members") or []
        details = lvl.get("members_details") or []

        seen_m = set()
        new_members = []
        for mid in members:
            if not mid or mid in seen_m:
                continue
            seen_m.add(mid)
            new_members.append(mid)

        seen_d = set()
        new_details = []
        for md in details:
            mid = (md or {}).get("member_id") or (md or {}).get("id")
            if not mid or mid in seen_d:
                continue
            seen_d.add(mid)
            new_details.append(md)

        removed_here = (len(members) - len(new_members)) + (len(details) - len(new_details))
        if removed_here > 0:
            await db.levels.update_one(
                {"id": lvl.get("id")},
                {"$set": {"members": new_members, "members_details": new_details}}
            )
            levels_cleaned += 1
            duplicates_removed += removed_here

    return {
        "message": f"تم تنظيف {levels_cleaned} مستوى وإزالة {duplicates_removed} تكرار",
        "levels_cleaned": levels_cleaned,
        "duplicates_removed": duplicates_removed,
    }


@router.post("/cleanup-expired")
async def cleanup_expired_subscriptions(current_user: dict = Depends(get_current_user)):
    """Remove members from levels whose subscriptions have expired"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    # Find all expired subscriptions
    expired = await db.level_subscriptions.find({
        "end_date": {"$lt": today}
    }).to_list(1000)
    
    removed_count = 0
    for sub in expired:
        member_id = sub.get("member_id")
        level_id = sub.get("level_id")
        
        if member_id and level_id:
            # Remove member from level
            result = await db.levels.update_one(
                {"id": level_id},
                {"$pull": {"members": member_id}}
            )
            if result.modified_count > 0:
                removed_count += 1
            
            # Delete the subscription record
            await db.level_subscriptions.delete_one({"_id": sub["_id"]})
    
    return {
        "message": f"تم إزالة {removed_count} عضو من المستويات المنتهية اشتراكاتهم",
        "removed_count": removed_count
    }
