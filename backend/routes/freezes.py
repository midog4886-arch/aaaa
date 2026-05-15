from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user
from .attendance import parse_schedule_days

router = APIRouter(prefix="/freezes", tags=["freezes"])


WEEKDAY_INDEX = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}


def count_training_days_in_range(schedule_text: str, start_date: str, end_date: str) -> int:
    """Count how many calendar days between start_date and end_date (inclusive)
    fall on the weekdays defined in `schedule_text`. Returns 0 when the schedule
    cannot be parsed (caller decides on a fallback)."""
    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
    except ValueError:
        return 0
    if end_dt < start_dt:
        return 0
    days = parse_schedule_days(schedule_text or "")
    if not days:
        return 0
    target_indices = {WEEKDAY_INDEX[d] for d in days if d in WEEKDAY_INDEX}
    if not target_indices:
        return 0
    count = 0
    cursor = start_dt
    while cursor <= end_dt:
        if cursor.weekday() in target_indices:
            count += 1
        cursor += timedelta(days=1)
    return count


def compute_activity_extension(activity: dict, start_date: str, end_date: str, fallback_days: int) -> int:
    """Decide how many days to add to a single activity's end_date for a freeze
    spanning [start_date, end_date]. Uses the activity's weekly schedule when
    available; otherwise falls back to calendar days so the subscription is
    never silently shortened."""
    schedule_text = activity.get("schedule", "") if isinstance(activity, dict) else ""
    if schedule_text and parse_schedule_days(schedule_text):
        return count_training_days_in_range(schedule_text, start_date, end_date)
    return fallback_days


class FreezeCreate(BaseModel):
    member_id: str
    start_date: str
    end_date: str
    reason: str


@router.post("")
async def create_freeze(freeze: FreezeCreate, current_user: dict = Depends(get_current_user)):
    if freeze.reason not in ("travel", "medical", "personal", "other"):
        raise HTTPException(status_code=400, detail="Invalid reason. Must be travel, medical, personal, or other")

    try:
        start_dt = datetime.strptime(freeze.start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(freeze.end_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    if end_dt < start_dt:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    duration_days = (end_dt - start_dt).days + 1

    member = await db.members.find_one({"id": freeze.member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    overlapping = await db.member_freezes.find_one({
        "member_id": freeze.member_id,
        "status": "active",
        "$or": [
            {"start_date": {"$lte": freeze.end_date}, "end_date": {"$gte": freeze.start_date}}
        ]
    })
    if overlapping:
        raise HTTPException(status_code=400, detail="Overlapping freeze exists for this member")

    year_start = f"{start_dt.year}-01-01"
    year_end = f"{start_dt.year}-12-31"
    year_freezes = await db.member_freezes.find({
        "member_id": freeze.member_id,
        "start_date": {"$gte": year_start, "$lte": year_end}
    }, {"_id": 0}).to_list(100)

    total_frozen_days = sum(f.get("duration_days", 0) for f in year_freezes if f.get("status") != "cancelled")
    if total_frozen_days + duration_days > 30:
        remaining = 30 - total_frozen_days
        raise HTTPException(
            status_code=400,
            detail=f"Exceeds max 30 days per year. Used: {total_frozen_days}, Remaining: {remaining}, Requested: {duration_days}"
        )

    activities = member.get("activities", [])
    # Per-activity extension records keyed by position so duplicate activity_ids
    # don't get their days collapsed together.
    extension_records = []
    for i, act in enumerate(activities):
        act_end = act.get("end_date", "")
        if not act_end:
            continue
        try:
            act_end_dt = datetime.strptime(act_end, "%Y-%m-%d")
        except ValueError:
            continue
        ext_days = compute_activity_extension(act, freeze.start_date, freeze.end_date, duration_days)
        if ext_days <= 0:
            continue
        new_end_dt = act_end_dt + timedelta(days=ext_days)
        activities[i]["end_date"] = new_end_dt.strftime("%Y-%m-%d")
        extension_records.append({
            "index": i,
            "activity_id": act.get("activity_id") or act.get("id") or "",
            "schedule": act.get("schedule", ""),
            "days": ext_days,
        })

    await db.members.update_one(
        {"id": freeze.member_id},
        {"$set": {"activities": activities}}
    )

    freeze_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    total_extension = sum(r["days"] for r in extension_records)
    freeze_doc = {
        "id": freeze_id,
        "member_id": freeze.member_id,
        "start_date": freeze.start_date,
        "end_date": freeze.end_date,
        "reason": freeze.reason,
        "duration_days": duration_days,
        "extension_records": extension_records,
        "total_extension_days": total_extension,
        "calculation_mode": "training_days",
        "status": "active",
        "created_by": current_user.get("username", current_user.get("name", "")),
        "created_at": now
    }

    await db.member_freezes.insert_one(freeze_doc)
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="freeze.create",
            entity_type="freeze",
            entity_id=freeze_id,
            entity_name=member.get("name_ar") or member.get("name", ""),
            after={
                "member_id": freeze.member_id,
                "start_date": freeze.start_date,
                "end_date": freeze.end_date,
                "reason": freeze.reason,
                "duration_days": duration_days,
                "total_extension_days": total_extension,
            },
        )
    except Exception:
        pass

    member_name = member.get("name_ar", member.get("name", ""))
    notification = {
        "id": str(uuid.uuid4()),
        "member_id": freeze.member_id,
        "type": "freeze",
        "title_ar": "تجميد العضوية",
        "message_ar": f"تم تجميد عضويتك من {freeze.start_date} إلى {freeze.end_date} ({duration_days} يوم) — تم تمديد الاشتراك بـ {total_extension} يوم تدريب",
        "title_en": "Membership Frozen",
        "message_en": f"Your membership has been frozen from {freeze.start_date} to {freeze.end_date} ({duration_days} days) — subscription extended by {total_extension} training day(s)",
        "read": False,
        "created_at": now
    }
    await db.member_notifications.insert_one(notification)

    return {k: v for k, v in freeze_doc.items() if k != "_id"}


def _legacy_restore_days(freeze_doc: dict, today_str: str) -> int:
    """Backwards-compat: pre-existing freezes without per-activity extensions
    still use the original calendar-day restore behavior."""
    if today_str < freeze_doc["start_date"]:
        return freeze_doc.get("duration_days", 0)
    if today_str <= freeze_doc["end_date"]:
        try:
            end_dt = datetime.strptime(freeze_doc["end_date"], "%Y-%m-%d")
            today_dt = datetime.strptime(today_str, "%Y-%m-%d")
            return (end_dt - today_dt).days + 1
        except ValueError:
            return 0
    return freeze_doc.get("duration_days", 0)


@router.post("/{freeze_id}/cancel")
async def cancel_freeze(freeze_id: str, current_user: dict = Depends(get_current_user)):
    freeze_doc = await db.member_freezes.find_one({"id": freeze_id}, {"_id": 0})
    if not freeze_doc:
        raise HTTPException(status_code=404, detail="Freeze not found")

    if freeze_doc.get("status") != "active":
        raise HTTPException(status_code=400, detail="Freeze is not active")

    now = datetime.now(timezone.utc)
    now_str = now.isoformat()
    today_str = now.strftime("%Y-%m-%d")

    try:
        datetime.strptime(freeze_doc["end_date"], "%Y-%m-%d")
        datetime.strptime(freeze_doc["start_date"], "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=500, detail="Invalid freeze dates")

    member = await db.members.find_one({"id": freeze_doc["member_id"]}, {"_id": 0})
    extension_records = freeze_doc.get("extension_records")
    use_training_mode = (
        isinstance(extension_records, list)
        and freeze_doc.get("calculation_mode") == "training_days"
    )

    if member and use_training_mode:
        # New behavior: per-activity training-day restore. Each record was saved
        # at create time with its position and (optional) activity_id, so we can
        # restore precisely even if duplicate activities exist.
        activities = member.get("activities", [])
        before_start = today_str < freeze_doc["start_date"]
        ongoing = freeze_doc["start_date"] <= today_str <= freeze_doc["end_date"]
        used_indices = set()
        for rec in extension_records:
            applied = int(rec.get("days", 0) or 0)
            if applied <= 0:
                continue
            target_idx = None
            preferred_idx = rec.get("index")
            rec_aid = rec.get("activity_id") or ""
            # Prefer the original position if it still points at the same activity.
            if (
                isinstance(preferred_idx, int)
                and 0 <= preferred_idx < len(activities)
                and preferred_idx not in used_indices
                and (not rec_aid or (
                    activities[preferred_idx].get("activity_id")
                    or activities[preferred_idx].get("id")
                    or ""
                ) == rec_aid)
            ):
                target_idx = preferred_idx
            # Fall back to the first unused activity matching activity_id.
            if target_idx is None and rec_aid:
                for j, a in enumerate(activities):
                    if j in used_indices:
                        continue
                    if (a.get("activity_id") or a.get("id") or "") == rec_aid:
                        target_idx = j
                        break
            if target_idx is None:
                continue
            used_indices.add(target_idx)
            act = activities[target_idx]
            if before_start:
                restore = applied
            elif ongoing:
                # Use the schedule we recorded at create time; if absent, fall
                # back to the activity's current schedule.
                schedule_for_calc = rec.get("schedule") or act.get("schedule", "")
                restore = count_training_days_in_range(
                    schedule_for_calc, today_str, freeze_doc["end_date"]
                )
                if restore <= 0 and not parse_schedule_days(schedule_for_calc or ""):
                    # No usable schedule — fall back to the calendar-day remainder.
                    try:
                        end_dt = datetime.strptime(freeze_doc["end_date"], "%Y-%m-%d")
                        today_dt = datetime.strptime(today_str, "%Y-%m-%d")
                        restore = (end_dt - today_dt).days + 1
                    except ValueError:
                        restore = 0
                restore = min(max(restore, 0), applied)
            else:
                restore = applied
            if restore <= 0:
                continue
            act_end = act.get("end_date", "")
            if not act_end:
                continue
            try:
                act_end_dt = datetime.strptime(act_end, "%Y-%m-%d")
            except ValueError:
                continue
            new_end_dt = act_end_dt - timedelta(days=restore)
            activities[target_idx]["end_date"] = new_end_dt.strftime("%Y-%m-%d")
        await db.members.update_one(
            {"id": freeze_doc["member_id"]},
            {"$set": {"activities": activities}}
        )
    elif member:
        # Legacy calendar-day behavior for old freezes.
        restore_days = _legacy_restore_days(freeze_doc, today_str)
        if restore_days > 0:
            activities = member.get("activities", [])
            for i, act in enumerate(activities):
                act_end = act.get("end_date", "")
                if act_end:
                    try:
                        act_end_dt = datetime.strptime(act_end, "%Y-%m-%d")
                        new_end_dt = act_end_dt - timedelta(days=restore_days)
                        activities[i]["end_date"] = new_end_dt.strftime("%Y-%m-%d")
                    except ValueError:
                        pass
            await db.members.update_one(
                {"id": freeze_doc["member_id"]},
                {"$set": {"activities": activities}}
            )

    await db.member_freezes.update_one(
        {"id": freeze_id},
        {"$set": {"status": "cancelled", "cancelled_at": now_str}}
    )

    notification = {
        "id": str(uuid.uuid4()),
        "member_id": freeze_doc["member_id"],
        "type": "freeze",
        "title_ar": "إلغاء تجميد العضوية",
        "message_ar": f"تم إلغاء تجميد عضويتك الذي كان من {freeze_doc['start_date']} إلى {freeze_doc['end_date']}",
        "title_en": "Freeze Cancelled",
        "message_en": f"Your membership freeze from {freeze_doc['start_date']} to {freeze_doc['end_date']} has been cancelled",
        "read": False,
        "created_at": now_str
    }
    await db.member_notifications.insert_one(notification)

    freeze_doc["status"] = "cancelled"
    freeze_doc["cancelled_at"] = now_str
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="freeze.cancel",
            entity_type="freeze",
            entity_id=freeze_id,
            entity_name=(member or {}).get("name_ar") or (member or {}).get("name", ""),
            before={"status": "active"},
            after={"status": "cancelled", "cancelled_at": now_str},
        )
    except Exception:
        pass
    return freeze_doc


@router.get("/member/{member_id}")
async def get_member_freezes(member_id: str, current_user: dict = Depends(get_current_user)):
    freezes = await db.member_freezes.find(
        {"member_id": member_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return freezes


@router.get("/active")
async def get_active_freezes(current_user: dict = Depends(get_current_user)):
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    freezes = await db.member_freezes.find({
        "status": "active",
        "start_date": {"$lte": today_str},
        "end_date": {"$gte": today_str}
    }, {"_id": 0}).to_list(500)
    return freezes


@router.get("/member/{member_id}/stats")
async def get_member_freeze_stats(member_id: str, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    year_start = f"{now.year}-01-01"
    year_end = f"{now.year}-12-31"
    today_str = now.strftime("%Y-%m-%d")

    year_freezes = await db.member_freezes.find({
        "member_id": member_id,
        "start_date": {"$gte": year_start, "$lte": year_end}
    }, {"_id": 0}).to_list(100)

    total_days = sum(f.get("duration_days", 0) for f in year_freezes if f.get("status") != "cancelled")

    active_freeze = None
    for f in year_freezes:
        if f.get("status") == "active" and f.get("start_date", "") <= today_str <= f.get("end_date", ""):
            active_freeze = f
            break

    return {
        "member_id": member_id,
        "year": now.year,
        "total_days_frozen": total_days,
        "remaining_days": max(0, 30 - total_days),
        "active_freeze": active_freeze,
        "freezes_count": len(year_freezes)
    }
