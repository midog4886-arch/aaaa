"""Day Extensions (ترحيل الأيام) routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
import re
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user

router = APIRouter(prefix="/day-extensions", tags=["day-extensions"])

def require_admin(user: dict):
    if not user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")

ARABIC_DAY_MAP = {
    0: ["الاثنين", "الإثنين", "الاينين", "لالثنين", "اثنين", "إثنين"],
    1: ["الثلاثاء", "الثلاثائ", "ثلاثاء"],
    2: ["الأربعاء", "الاربعاء", "الاربعائ", "أربعاء", "اربعاء"],
    3: ["الخميس", "خميس"],
    4: ["الجمعة", "الجمعه", "جمعه", "جمعة"],
    5: ["السبت", "سبت"],
    6: ["الأحد", "الاحد", "أحد", "احد"],
}

ARABIC_DAY_NAMES = {
    0: "الاثنين", 1: "الثلاثاء", 2: "الأربعاء",
    3: "الخميس", 4: "الجمعة", 5: "السبت", 6: "الأحد"
}

DAY_ORDER = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
DAY_ORDER_NUM = [6, 0, 1, 2, 3, 4, 5]

def parse_schedule_days(schedule_text):
    if not schedule_text:
        return set()

    schedule_text = schedule_text.strip()
    training_days = set()

    range_match = re.search(r'من\s+(\S+)\s+(الي|إلى|الى|لـ|ل)\s+(\S+)', schedule_text)
    if range_match:
        start_day_text = range_match.group(1)
        end_day_text = range_match.group(3)
        start_idx = None
        end_idx = None
        for i in range(7):
            weekday_num = DAY_ORDER_NUM[i]
            aliases = ARABIC_DAY_MAP.get(weekday_num, [])
            if start_idx is None:
                for a in aliases:
                    if a in start_day_text:
                        start_idx = i
                        break
            if end_idx is None:
                for a in aliases:
                    if a in end_day_text:
                        end_idx = i
                        break
        if start_idx is not None and end_idx is not None:
            if end_idx >= start_idx:
                for i in range(start_idx, end_idx + 1):
                    training_days.add(DAY_ORDER_NUM[i])
            else:
                for i in range(start_idx, 7):
                    training_days.add(DAY_ORDER_NUM[i])
                for i in range(0, end_idx + 1):
                    training_days.add(DAY_ORDER_NUM[i])
            return training_days

    for weekday_num, aliases in ARABIC_DAY_MAP.items():
        for alias in aliases:
            if alias in schedule_text:
                training_days.add(weekday_num)
                break

    return training_days

def get_closure_weekdays(start_date, end_date):
    weekdays = set()
    current = start_date
    while current <= end_date:
        weekdays.add(current.weekday())
        current += timedelta(days=1)
    return weekdays

def count_missed_sessions(closure_start, closure_end, member_days):
    missed = 0
    current = closure_start
    while current <= closure_end:
        if current.weekday() in member_days:
            missed += 1
        current += timedelta(days=1)
    return missed

def find_new_end_date(current_end, missed_sessions, member_days):
    if missed_sessions <= 0 or not member_days:
        return current_end
    sessions_added = 0
    current = current_end + timedelta(days=1)
    new_end = current_end
    safety = 0
    while sessions_added < missed_sessions and safety < 365:
        if current.weekday() in member_days:
            sessions_added += 1
            new_end = current
        current += timedelta(days=1)
        safety += 1
    return new_end

class ClosureCreate(BaseModel):
    title_ar: str
    title_en: Optional[str] = ""
    reason: str
    start_date: str
    end_date: str
    notes: Optional[str] = ""
    scope: Optional[str] = "all"
    activity_id: Optional[str] = None
    activity_name: Optional[str] = None
    stop_type: Optional[str] = "full_day"
    stop_hours: Optional[float] = 0

class ExtensionApply(BaseModel):
    closure_id: str
    days: float
    branch_id: Optional[str] = None

class ManualExtension(BaseModel):
    member_id: str
    days: float
    reason: str
    activity_id: Optional[str] = None

@router.get("/closures")
async def get_closures(user=Depends(get_current_user)):
    closures = await db.closures.find().sort("created_at", -1).to_list(500)
    for c in closures:
        c.pop("_id", None)
    return closures

@router.post("/closures")
async def create_closure(data: ClosureCreate, user=Depends(get_current_user)):
    require_admin(user)
    try:
        start = datetime.strptime(data.start_date, '%Y-%m-%d')
        end = datetime.strptime(data.end_date, '%Y-%m-%d')
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    if end < start:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    total_days_count = (end - start).days + 1
    closure_weekdays = get_closure_weekdays(start, end)
    closure_day_names = [ARABIC_DAY_NAMES.get(d, "") for d in sorted(closure_weekdays)]

    if data.stop_type == "partial" and data.stop_hours and data.stop_hours > 0:
        extension_days = round((data.stop_hours / 24) * total_days_count, 1)
    else:
        extension_days = total_days_count

    closure = {
        "id": str(uuid.uuid4()),
        "title_ar": data.title_ar,
        "title_en": data.title_en,
        "reason": data.reason,
        "start_date": data.start_date,
        "end_date": data.end_date,
        "total_days_count": total_days_count,
        "days": extension_days,
        "closure_weekdays": list(closure_weekdays),
        "closure_day_names": closure_day_names,
        "notes": data.notes,
        "scope": data.scope or "all",
        "activity_id": data.activity_id,
        "activity_name": data.activity_name,
        "stop_type": data.stop_type or "full_day",
        "stop_hours": data.stop_hours or 0,
        "applied": False,
        "applied_count": 0,
        "created_by": user.get("username", ""),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.closures.insert_one(closure)
    closure.pop("_id", None)
    return closure

@router.delete("/closures/{closure_id}")
async def delete_closure(closure_id: str, user=Depends(get_current_user)):
    require_admin(user)
    closure = await db.closures.find_one({"id": closure_id})
    if not closure:
        raise HTTPException(status_code=404, detail="Closure not found")
    if closure.get("applied"):
        raise HTTPException(status_code=400, detail="Cannot delete applied closure")
    await db.closures.delete_one({"id": closure_id})
    return {"message": "Deleted"}

@router.post("/apply")
async def apply_extension(data: ExtensionApply, user=Depends(get_current_user)):
    require_admin(user)
    if data.days <= 0:
        raise HTTPException(status_code=400, detail="Days must be positive")
    closure = await db.closures.find_one({"id": data.closure_id})
    if not closure:
        raise HTTPException(status_code=404, detail="Closure not found")

    scope = closure.get("scope", "all")
    activity_id = closure.get("activity_id")
    closure_start = datetime.strptime(closure["start_date"], '%Y-%m-%d')
    closure_end = datetime.strptime(closure["end_date"], '%Y-%m-%d')
    closure_weekdays = get_closure_weekdays(closure_start, closure_end)
    fallback_days = data.days

    query = {"activities": {"$elemMatch": {"status": "active", "end_date": {"$exists": True, "$ne": ""}}}}
    if data.branch_id and data.branch_id != "all":
        query["branch_id"] = data.branch_id

    members = await db.members.find(query).to_list(10000)
    extended_count = 0
    extended_members = []
    skipped_members = []

    all_invoices = await db.invoices.find(
        {"items.schedule": {"$exists": True, "$ne": ""}}
    ).sort("created_at", -1).to_list(50000)
    member_schedules = {}
    for inv in all_invoices:
        m_id = inv.get("member_id", "")
        for item in (inv.get("items") or []):
            schedule = item.get("schedule", "")
            act_id = item.get("activity_id", "")
            if schedule and m_id:
                key = f"{m_id}_{act_id}"
                if key not in member_schedules:
                    member_schedules[key] = schedule
                gen_key = f"{m_id}_general"
                if gen_key not in member_schedules:
                    member_schedules[gen_key] = schedule

    for member in members:
        activities = member.get("activities", [])
        updated = False
        old_end_dates = {}
        new_end_dates = {}
        missed_info = {}

        for act in activities:
            if act.get("status") != "active" or not act.get("end_date"):
                continue
            if scope == "specific" and activity_id:
                if act.get("activity_id") != activity_id:
                    continue

            act_id = act.get("activity_id", "")
            act_name = act.get("activity_name", act.get("name", ""))
            m_id = member.get("id", "")

            schedule_key = f"{m_id}_{act_id}"
            gen_key = f"{m_id}_general"
            schedule_text = member_schedules.get(schedule_key, member_schedules.get(gen_key, ""))
            member_training_days = parse_schedule_days(schedule_text)

            try:
                end_date = datetime.strptime(act["end_date"], '%Y-%m-%d')
                old_end_dates[act_name] = act["end_date"]

                if member_training_days:
                    missed = count_missed_sessions(closure_start, closure_end, member_training_days)
                    day_names = [ARABIC_DAY_NAMES.get(d, "") for d in sorted(member_training_days)]
                    if missed > 0:
                        new_end = find_new_end_date(end_date, missed, member_training_days)
                        act["end_date"] = new_end.strftime('%Y-%m-%d')
                        new_end_dates[act_name] = act["end_date"]
                        missed_info[act_name] = {
                            "missed_sessions": missed,
                            "training_days": ", ".join(day_names),
                            "schedule": schedule_text
                        }
                        if act.get("period") and " - " in act["period"]:
                            parts = act["period"].split(" - ")
                            act["period"] = f"{parts[0]} - {new_end.strftime('%Y-%m-%d')}"
                        updated = True
                    else:
                        missed_info[act_name] = {
                            "missed_sessions": 0,
                            "training_days": ", ".join(day_names),
                            "schedule": schedule_text,
                            "skipped": True
                        }
                else:
                    days_to_add = int(fallback_days) if fallback_days == int(fallback_days) else fallback_days
                    new_end = end_date + timedelta(days=int(round(days_to_add)))
                    act["end_date"] = new_end.strftime('%Y-%m-%d')
                    new_end_dates[act_name] = act["end_date"]
                    missed_info[act_name] = {
                        "missed_sessions": int(round(fallback_days)),
                        "training_days": "غير محدد",
                        "schedule": ""
                    }
                    if act.get("period") and " - " in act["period"]:
                        parts = act["period"].split(" - ")
                        act["period"] = f"{parts[0]} - {new_end.strftime('%Y-%m-%d')}"
                    updated = True
            except Exception:
                pass

        if updated:
            await db.members.update_one(
                {"id": member["id"]},
                {"$set": {"activities": activities}}
            )

            sub_query = {"member_id": member["id"]}
            if scope == "specific" and activity_id:
                sub_query["activity_id"] = activity_id
            subs = await db.level_subscriptions.find(sub_query).to_list(100)
            for sub in subs:
                if sub.get("end_date"):
                    try:
                        sub_act_id = sub.get("activity_id", "")
                        s_key = f"{member['id']}_{sub_act_id}"
                        s_gen_key = f"{member['id']}_general"
                        s_text = member_schedules.get(s_key, member_schedules.get(s_gen_key, ""))
                        s_days = parse_schedule_days(s_text)
                        sub_end = datetime.strptime(sub["end_date"], '%Y-%m-%d')
                        if s_days:
                            s_missed = count_missed_sessions(closure_start, closure_end, s_days)
                            if s_missed > 0:
                                new_sub_end = find_new_end_date(sub_end, s_missed, s_days)
                            else:
                                continue
                        else:
                            new_sub_end = sub_end + timedelta(days=int(round(fallback_days)))
                        await db.level_subscriptions.update_one(
                            {"_id": sub["_id"]},
                            {"$set": {"end_date": new_sub_end.strftime('%Y-%m-%d')}}
                        )
                    except Exception:
                        pass

            extended_count += 1
            member_info = {
                "name": member.get("name_ar", member.get("name", "")),
                "phone": member.get("phone", ""),
                "member_id": member.get("id", ""),
            }
            details = []
            for a_name in new_end_dates:
                info = missed_info.get(a_name, {})
                details.append({
                    "activity": a_name,
                    "old_end": old_end_dates.get(a_name, ""),
                    "new_end": new_end_dates.get(a_name, ""),
                    "missed_sessions": info.get("missed_sessions", 0),
                    "training_days": info.get("training_days", ""),
                    "schedule": info.get("schedule", "")
                })
            member_info["details"] = details
            extended_members.append(member_info)
        else:
            skipped_acts = [a for a, info in missed_info.items() if info.get("skipped")]
            if skipped_acts:
                skipped_members.append({
                    "name": member.get("name_ar", member.get("name", "")),
                    "training_days": missed_info[skipped_acts[0]].get("training_days", ""),
                    "reason": "لا يوجد تقاطع مع أيام الإغلاق"
                })

    await db.closures.update_one(
        {"id": data.closure_id},
        {"$set": {
            "applied": True,
            "applied_count": extended_count,
            "applied_at": datetime.now(timezone.utc).isoformat(),
            "applied_by": user.get("username", "")
        }}
    )

    log_entry = {
        "id": str(uuid.uuid4()),
        "type": "closure",
        "closure_id": data.closure_id,
        "closure_title": closure.get("title_ar", ""),
        "days": data.days,
        "members_count": extended_count,
        "branch_id": data.branch_id,
        "scope": scope,
        "activity_name": closure.get("activity_name", ""),
        "stop_type": closure.get("stop_type", "full_day"),
        "stop_hours": closure.get("stop_hours", 0),
        "applied_by": user.get("username", ""),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.extension_logs.insert_one(log_entry)

    return {
        "message": f"Extended {extended_count} members",
        "extended_count": extended_count,
        "extended_members": extended_members,
        "skipped_count": len(skipped_members),
        "skipped_members": skipped_members
    }

@router.post("/manual")
async def manual_extension(data: ManualExtension, user=Depends(get_current_user)):
    require_admin(user)
    if data.days <= 0:
        raise HTTPException(status_code=400, detail="Days must be positive")
    member = await db.members.find_one({"id": data.member_id})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    activities = member.get("activities", [])
    updated = False
    for act in activities:
        if act.get("status") != "active" or not act.get("end_date"):
            continue
        if data.activity_id and act.get("activity_id") != data.activity_id:
            continue
        try:
            end_date = datetime.strptime(act["end_date"], '%Y-%m-%d')
            new_end = end_date + timedelta(days=int(round(data.days)))
            act["end_date"] = new_end.strftime('%Y-%m-%d')
            if act.get("period") and " - " in act["period"]:
                parts = act["period"].split(" - ")
                act["period"] = f"{parts[0]} - {new_end.strftime('%Y-%m-%d')}"
            updated = True
        except Exception:
            pass

    if updated:
        await db.members.update_one(
            {"id": data.member_id},
            {"$set": {"activities": activities}}
        )

        sub_query = {"member_id": data.member_id}
        if data.activity_id:
            sub_query["activity_id"] = data.activity_id
        subs = await db.level_subscriptions.find(sub_query).to_list(100)
        for sub in subs:
            if sub.get("end_date"):
                try:
                    sub_end = datetime.strptime(sub["end_date"], '%Y-%m-%d')
                    new_sub_end = sub_end + timedelta(days=int(round(data.days)))
                    await db.level_subscriptions.update_one(
                        {"_id": sub["_id"]},
                        {"$set": {"end_date": new_sub_end.strftime('%Y-%m-%d')}}
                    )
                except Exception:
                    pass

    log_entry = {
        "id": str(uuid.uuid4()),
        "type": "manual",
        "member_id": data.member_id,
        "member_name": member.get("name_ar", member.get("name", "")),
        "days": data.days,
        "reason": data.reason,
        "activity_id": data.activity_id,
        "applied_by": user.get("username", ""),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.extension_logs.insert_one(log_entry)

    return {"message": f"Extended {member.get('name_ar', '')} by {data.days} days"}

@router.get("/logs")
async def get_extension_logs(user=Depends(get_current_user)):
    logs = await db.extension_logs.find().sort("created_at", -1).to_list(500)
    for l in logs:
        l.pop("_id", None)
    return logs
