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
    custom_name: Optional[str] = ""  # User-defined name for the level
    description: Optional[str] = ""
    members: List[str] = []  # List of member IDs
    branch_id: Optional[str] = None
    coach_id: Optional[str] = None  # Coach assigned to this level

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
    branch_id = current_user.get("branch_id")

    query = {}
    if is_admin:
        if branch_filter and branch_filter != "all":
            query["$or"] = [{"branch_id": branch_filter}, {"branch_id": None}, {"branch_id": {"$exists": False}}]
    else:
        query["$or"] = [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": {"$exists": False}}]

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

    return levels


@router.post("")
async def create_level(level: LevelCreate, current_user: dict = Depends(get_current_user)):
    level_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)
    
    if is_admin and level.branch_id:
        final_branch_id = level.branch_id if level.branch_id != "all" else None
    else:
        final_branch_id = current_user.get("branch_id")
    
    level_doc = {
        "id": level_id,
        "level_number": level.level_number,
        "activity_name": level.activity_name,
        "custom_name": level.custom_name or "",
        "description": level.description,
        "members": level.members,
        "branch_id": final_branch_id,
        "coach_id": level.coach_id or None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.levels.insert_one(level_doc)
    
    return {k: v for k, v in level_doc.items() if k != "_id"}


@router.put("/{level_id}")
async def update_level(level_id: str, level: LevelCreate, current_user: dict = Depends(get_current_user)):
    update_data = {
        "level_number": level.level_number,
        "activity_name": level.activity_name,
        "custom_name": level.custom_name or "",
        "description": level.description,
        "members": level.members,
        "coach_id": level.coach_id or None
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
