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

def parse_schedule_time(schedule_text):
    if not schedule_text:
        return None
    schedule_text = schedule_text.strip()
    arabic_nums = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'}
    def convert_arabic_num(s):
        for a, e in arabic_nums.items():
            s = s.replace(a, e)
        return s

    if " - " in schedule_text:
        parts = schedule_text.split(" - ")
        time_part = parts[1].strip() if len(parts) > 1 else parts[0].strip()
        return time_part

    nums = re.findall(r'الساع[ةه]\s*([٠-٩\d]+)|الاساع[ةه]\s*([٠-٩\d]+)|([٠-٩\d]+)\s*مساء|(\d+)\s*-\s*\d+\s*مساء', schedule_text)
    for match in nums:
        for g in match:
            if g:
                g = convert_arabic_num(g)
                try:
                    t = int(g)
                    if 1 <= t <= 12:
                        return f"الساعة {t}"
                except:
                    pass
    all_nums = re.findall(r'[٠-٩\d]+', schedule_text)
    for n in all_nums:
        n = convert_arabic_num(n)
        try:
            t = int(n)
            if 1 <= t <= 12:
                day_words = sum(1 for d_aliases in ARABIC_DAY_MAP.values() for a in d_aliases if a in schedule_text)
                if day_words > 0:
                    return f"الساعة {t}"
        except:
            pass
    return None

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
    activity_ids: Optional[List[str]] = None
    activity_names: Optional[List[str]] = None
    stop_type: Optional[str] = "full_day"
    stop_hours: Optional[float] = 0
    affected_times: Optional[List[str]] = None
    branch_id: Optional[str] = "all"

class ExtensionApply(BaseModel):
    closure_id: str
    days: float
    branch_id: Optional[str] = None
    dry_run: Optional[bool] = False
    excluded_member_ids: Optional[List[str]] = []

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

    act_ids = data.activity_ids or ([data.activity_id] if data.activity_id else [])
    act_names = data.activity_names or ([data.activity_name] if data.activity_name else [])
    if len(act_names) != len(act_ids):
        all_acts = await db.activities.find({"id": {"$in": act_ids}}).to_list(100)
        act_map = {a["id"]: a.get("name_ar", a.get("name", "")) for a in all_acts}
        act_names = [act_map.get(aid, "") for aid in act_ids]

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
        "activity_ids": act_ids,
        "activity_names": act_names,
        "stop_type": data.stop_type or "full_day",
        "stop_hours": data.stop_hours or 0,
        "affected_times": data.affected_times or [],
        "branch_id": data.branch_id or "all",
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
    activity_ids = closure.get("activity_ids", [])
    if not activity_ids and activity_id:
        activity_ids = [activity_id]
    affected_times = closure.get("affected_times", [])
    closure_start = datetime.strptime(closure["start_date"], '%Y-%m-%d')
    closure_end = datetime.strptime(closure["end_date"], '%Y-%m-%d')
    closure_weekdays = get_closure_weekdays(closure_start, closure_end)
    fallback_days = data.days

    today_str = datetime.now().strftime('%Y-%m-%d')
    query = {"activities": {"$elemMatch": {"end_date": {"$gte": today_str}}}}
    apply_branch = data.branch_id or closure.get("branch_id", "all")
    if apply_branch and apply_branch != "all":
        query["branch_id"] = apply_branch

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

    excluded_ids = set(data.excluded_member_ids or [])
    for member in members:
        if member.get("id") in excluded_ids:
            continue
        activities = member.get("activities", [])
        updated = False
        old_end_dates = {}
        new_end_dates = {}
        missed_info = {}

        for act in activities:
            act_end = act.get("end_date", "")
            if not act_end or act_end < today_str:
                continue
            if scope == "specific" and activity_ids:
                if act.get("activity_id") not in activity_ids:
                    continue

            act_id = act.get("activity_id", "")
            act_name = act.get("activity_name", act.get("name", ""))
            m_id = member.get("id", "")

            schedule_key = f"{m_id}_{act_id}"
            gen_key = f"{m_id}_general"
            schedule_text = member_schedules.get(schedule_key, member_schedules.get(gen_key, ""))
            member_training_days = parse_schedule_days(schedule_text)
            member_time = parse_schedule_time(schedule_text)

            if affected_times and len(affected_times) > 0 and closure.get("stop_type") == "specific_times":
                if member_time is None:
                    missed_info[act_name] = {
                        "missed_sessions": 0,
                        "training_days": ", ".join([ARABIC_DAY_NAMES.get(d, "") for d in sorted(member_training_days)]) if member_training_days else "غير محدد",
                        "schedule": schedule_text,
                        "member_time": None,
                        "skipped": True,
                        "skip_reason": "لا يوجد موعد محدد في الجدول"
                    }
                    continue
                if member_time not in affected_times:
                    missed_info[act_name] = {
                        "missed_sessions": 0,
                        "training_days": ", ".join([ARABIC_DAY_NAMES.get(d, "") for d in sorted(member_training_days)]) if member_training_days else "غير محدد",
                        "schedule": schedule_text,
                        "member_time": member_time,
                        "skipped": True,
                        "skip_reason": f"الموعد {member_time} غير متأثر"
                    }
                    continue

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
            if not data.dry_run:
                await db.members.update_one(
                    {"id": member["id"]},
                    {"$set": {"activities": activities}}
                )

            sub_query = {"member_id": member["id"]}
            if scope == "specific" and activity_ids:
                sub_query["activity_id"] = {"$in": activity_ids}
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
                        if not data.dry_run:
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
                "guardian_name": member.get("guardian_name_ar") or member.get("guardian_name") or "",
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
                skip_info = missed_info[skipped_acts[0]]
                skip_reason = skip_info.get("skip_reason", "لا يوجد تقاطع مع أيام الإغلاق")
                member_t = skip_info.get("member_time")
                skipped_members.append({
                    "name": member.get("name_ar", member.get("name", "")),
                    "training_days": skip_info.get("training_days", ""),
                    "member_time": f"الساعة {member_t}" if member_t else "",
                    "reason": skip_reason
                })

    if data.dry_run:
        return {
            "message": f"Preview: would extend {extended_count} members",
            "dry_run": True,
            "extended_count": extended_count,
            "extended_members": extended_members,
            "skipped_count": len(skipped_members),
            "skipped_members": skipped_members
        }

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
        "activity_name": ", ".join(closure.get("activity_names", [])) or closure.get("activity_name", ""),
        "stop_type": closure.get("stop_type", "full_day"),
        "stop_hours": closure.get("stop_hours", 0),
        "applied_by": user.get("username", ""),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.extension_logs.insert_one(log_entry)

    try:
        from utils.audit import log_audit
        await log_audit(
            actor=user,
            action="day_extension.apply",
            entity_type="closure",
            entity_id=data.closure_id,
            entity_name=closure.get("title_ar", ""),
            after={
                "days": data.days,
                "extended_count": extended_count,
                "skipped_count": len(skipped_members),
                "branch_id": data.branch_id,
                "scope": scope,
            },
        )
    except Exception:
        pass

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

    try:
        from utils.audit import log_audit
        await log_audit(
            actor=user,
            action="day_extension.manual",
            entity_type="member",
            entity_id=data.member_id,
            entity_name=member.get("name_ar", member.get("name", "")),
            after={
                "days": data.days,
                "reason": data.reason,
                "activity_id": data.activity_id,
            },
        )
    except Exception:
        pass

    return {"message": f"Extended {member.get('name_ar', '')} by {data.days} days"}

@router.get("/available-times")
async def get_available_times(user=Depends(get_current_user)):
    require_admin(user)
    levels = await db.levels.find({}, {"_id": 0, "activity_name": 1, "members": 1}).to_list(5000)
    time_slots = {}
    for level in levels:
        activity_name = level.get("activity_name", "")
        if not activity_name:
            continue
        slot_name = ""
        if " - " in activity_name:
            parts = activity_name.split(" - ")
            slot_name = parts[1].strip() if len(parts) > 1 else parts[0].strip()
        else:
            time_match = re.search(r'الساع[ةه]\s*(\d+)', activity_name)
            if time_match:
                slot_name = f"الساعة {time_match.group(1)}"
            else:
                continue
        if slot_name:
            member_count = len(level.get("members", []))
            if slot_name in time_slots:
                time_slots[slot_name]["count"] += member_count
            else:
                num_match = re.search(r'(\d+)', slot_name)
                sort_key = int(num_match.group(1)) if num_match else 999
                time_slots[slot_name] = {"time": slot_name, "count": member_count, "sort_key": sort_key}
    times = sorted(time_slots.values(), key=lambda x: x.get("sort_key", 999))
    for t in times:
        t.pop("sort_key", None)
    return times

@router.get("/logs")
async def get_extension_logs(user=Depends(get_current_user)):
    logs = await db.extension_logs.find().sort("created_at", -1).to_list(500)
    for l in logs:
        l.pop("_id", None)
    return logs
