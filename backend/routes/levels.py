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
                        valid_ids.append(mid)
                        schedule = ""
                        level_id_current = level.get("id", "")
                        activities = member.get("activities", [])
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
                        members_details.append({
                            "member_id": member["id"],
                            "member_name": member.get("name_ar") or member.get("name", ""),
                            "phone": member.get("phone", ""),
                            "schedule": schedule
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

    cache_set(cache_key, levels, ttl=300)  # 5 min (members can change more often)
    return levels


@router.post("")
async def create_level(level: LevelCreate, current_user: dict = Depends(get_current_user)):
    level_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)

    # Admin can specify branch, otherwise non-admin is locked to their own
    # branch (require_branch_scope rejects non-admins without a branch_id).
    if is_admin and level.branch_id:
        final_branch_id = level.branch_id if level.branch_id != "all" else None
    else:
        final_branch_id = require_branch_scope(current_user)
    
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
        "custom_name": level.custom_name or "",
        "description": level.description,
        "members": level.members,
        "coach_id": level.coach_id or None,
        # capacity was previously dropped here, causing the "max capacity"
        # field in the edit dialog to silently revert to the stored value.
        "capacity": int(level.capacity) if level.capacity else None,
        "days": list(level.days) if level.days else None,
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


@router.delete("/{level_id}")
async def delete_level(level_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.levels.delete_one({"id": level_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Level not found")
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
        for act in activities:
            matches = False
            # Match by activity_id OR activity_name — older member records may
            # only have activity_name populated, so we must accept either.
            if match_aid and act.get("activity_id") == match_aid:
                matches = True
            if not matches and match_aname and act.get("activity_name") == match_aname:
                matches = True
            if matches and act.get("level_id") != level_id:
                act["level_id"] = level_id
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
    """Remove a member from a level"""
    result = await db.levels.update_one(
        {"id": level_id},
        {"$pull": {"members": member_id}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Member not found in level")
    cache_invalidate("levels:")
    return {"message": "Member removed from level"}


@router.get("/unassigned-members")
async def get_unassigned_members(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Members with active subscriptions that are NOT yet assigned to any level."""
    # Branch filtering — fail-closed for non-admins without a branch_id.
    effective_branch = resolve_branch_filter(current_user, branch_filter)

    query = {}
    if effective_branch:
        query["$or"] = [{"branch_id": effective_branch}, {"branch_id": None}, {"branch_id": {"$exists": False}}]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    members = await db.members.find(query, {"_id": 0}).to_list(10000)

    result = []
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
                })
        if unassigned_acts:
            result.append({
                "id": m.get("id"),
                "name": m.get("name_ar") or m.get("name"),
                "name_ar": m.get("name_ar"),
                "phone": m.get("phone"),
                "member_code": m.get("member_code"),
                "branch_id": m.get("branch_id"),
                "unassigned_activities": unassigned_acts,
            })

    return {"count": len(result), "members": result}


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
    """Return True if the level's `time_slot` is compatible with the schedule
    string the member is registered for. Empty `level_slot` (or one with no
    parseable hour) matches anything — we don't want to over-filter when a
    level was created without a slot. Otherwise both sides must resolve to
    the same 12h hour."""
    if not level_slot:
        return True
    lh = _extract_hour_12(level_slot)
    if lh is None:
        return True
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

    candidates_by_aid = {}
    candidates_by_aname = {}
    for lvl in levels:
        aid = lvl.get("activity_id")
        aname = (lvl.get("activity_name") or "").strip().lower()
        if aid:
            candidates_by_aid.setdefault(aid, []).append(lvl)
        if aname:
            candidates_by_aname.setdefault(aname, []).append(lvl)

    for bucket in (candidates_by_aid, candidates_by_aname):
        for k in bucket:
            bucket[k].sort(key=lambda l: (l.get("level_number") or 999))

    capacity_used = {l["id"]: len(l.get("members") or []) for l in levels}
    capacity_max = {l["id"]: (int(l.get("capacity")) if l.get("capacity") else None) for l in levels}
    pending_writes_per_member = {}

    would_assign = []
    unmatched = []
    already_correct = []
    by_source = {"member_activities": 0, "invoices": 0, "registration_forms": 0}

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
        Used both for picking a candidate and for validating an "already
        assigned" subscription so we don't lazily report a stale/wrong link
        as already_correct."""
        if not lvl:
            return False
        l_aid = lvl.get("activity_id") or ""
        l_aname = (lvl.get("activity_name") or "").strip().lower()
        if _aid and l_aid:
            if l_aid != _aid:
                return False
        elif _aname_l and l_aname:
            if l_aname != _aname_l:
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
            })
            continue

        candidates = []
        if aid and aid in candidates_by_aid:
            candidates = list(candidates_by_aid[aid])
        elif aname and aname_l in candidates_by_aname:
            candidates = list(candidates_by_aname[aname_l])

        # Recovery from a previous partial commit: if the member is already
        # listed in the .members[] of one of the candidate levels for this
        # activity, skip — they're effectively already placed even though the
        # activities[].level_id link is missing. This keeps reruns idempotent.
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
                "reason": "لا يوجد مستوى لهذا النشاط",
                "reason_en": "No level exists for this activity",
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

    response = {
        "dry_run": dry_run,
        "totals": {
            "would_assign": len(would_assign),
            "unmatched": len(unmatched),
            "already_correct": len(already_correct),
            "candidate_levels": len(levels),
            "members_scanned": len(members),
            "subscriptions_scanned": len(subs),
        },
        "by_source": by_source,
        "by_activity": [
            {"activity_name": k, "count": len(v), "assignments": v}
            for k, v in sorted(by_activity.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        ],
        "unmatched": unmatched,
        "already_correct_count": len(already_correct),
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
