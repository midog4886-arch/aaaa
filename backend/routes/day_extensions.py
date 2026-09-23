"""Day Extensions (ترحيل الأيام) routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
import re
import hashlib
import json
import math
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user
from services import whatsapp_bulk_jobs
from services.closure_notice_summary import summaries, notice_key
from utils.auth import get_allowed_branch_ids
from utils.effective_periods import (
    effective_period_map, invoice_item_key, operational_window, original_window,
    source_key,
)

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
    preview_token: Optional[str] = None

class ManualExtension(BaseModel):
    member_id: str
    days: float
    reason: str
    activity_id: Optional[str] = None


class ClosureNoticeSend(BaseModel):
    closure_id: str
    message: str
    branch_id: Optional[str] = None
    excluded_member_ids: Optional[List[str]] = []

@router.get("/closures")
async def get_closures(user=Depends(get_current_user), include_notice_summary: bool = True,
                       summary_only: bool = False):
    allowed = None if user.get("is_admin") else get_allowed_branch_ids(user)
    if allowed == []:
        raise HTTPException(status_code=403, detail="No branch assigned")
    query = {} if allowed is None else {"$or": [
        {"branch_id": {"$in": [*allowed, "all", "", None]}},
    ]}
    projection = {"_id": 0, "id": 1, "branch_id": 1} if summary_only else {"_id": 0}
    closures = await db.closures.find(query, projection).sort("created_at", -1).to_list(500)
    notice_summaries = await summaries(db, closures, allowed) if include_notice_summary or summary_only else {}
    branch_rows = await db.branches.find(
        {} if allowed is None else {"id": {"$in": allowed}},
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "name_en": 1},
    ).to_list(None)
    branch_map = {b["id"]: b for b in branch_rows}
    if summary_only:
        for c in closures:
            c["notice_summary"] = notice_summaries[c["id"]]
            c["notice_summary"]["scope_branch_ids"] = list(branch_map) if c.get("branch_id") in (None, "", "all") else [c["branch_id"]]
        return closures
    # Avoid importing the member routes (and their heavy dependencies) merely
    # to format persisted closure phones on the initial list request.
    def _mask_phone(phone):
        if not phone:
            return phone
        value = str(phone).strip()
        return value if len(value) <= 5 else value[:3] + "•" * (len(value) - 5) + value[-2:]
    current_user_doc = await db.users.find_one(
        {"id": user.get("user_id")},
        {"_id": 0, "is_admin": 1, "permissions": 1},
    )
    can_view_phones = bool(
        current_user_doc
        and (
            current_user_doc.get("is_admin", False)
            or "member-phones" in (current_user_doc.get("permissions") or [])
        )
    )
    affected_ids = list({a["member_id"] for c in closures
                         if c.get("branch_id") not in (None, "", "all")
                         for a in c.get("affected_members") or [] if a.get("member_id")})
    member_branch_cache = {}
    if affected_ids:
        async for m in db.members.find(
            {"id": {"$in": affected_ids}}, {"id": 1, "branch_id": 1, "_id": 0}
        ):
            member_branch_cache[m["id"]] = m.get("branch_id") or ""
    for c in closures:
        c.pop("_id", None)
        c["notice_summary"] = notice_summaries.get(c["id"], {"state": "loading", "jobs": []})
        c["branch_name"] = branch_map.get(c.get("branch_id"), {}).get("name_ar") or branch_map.get(c.get("branch_id"), {}).get("name")
        c["notice_summary"]["scope_branch_ids"] = list(branch_map) if c.get("branch_id") in (None, "", "all") else [c["branch_id"]]
        cb = (c.get("branch_id") or "all")
        if cb and cb != "all":
            affected = c.get("affected_members") or []
            if affected:
                filtered = [a for a in affected if member_branch_cache.get(a.get("member_id"), "") == cb]
                if len(filtered) != len(affected):
                    c["affected_members"] = filtered
                    c["applied_count"] = len(filtered)
        if not can_view_phones:
            for affected_member in c.get("affected_members") or []:
                affected_member["phone"] = _mask_phone(affected_member.get("phone"))
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

    try:
        from utils.audit import log_audit
        await log_audit(
            actor=user,
            action="closure.create",
            entity_type="closure",
            entity_id=closure["id"],
            entity_name=closure.get("title_ar", ""),
            after={
                "title_ar": closure.get("title_ar", ""),
                "start_date": closure.get("start_date", ""),
                "end_date": closure.get("end_date", ""),
                "scope": closure.get("scope", "all"),
                "branch_id": closure.get("branch_id", "all"),
                "activity_names": closure.get("activity_names", []),
                "activity_ids": closure.get("activity_ids", []),
                "stop_type": closure.get("stop_type", "full_day"),
            },
        )
    except Exception:
        pass

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

    try:
        from utils.audit import log_audit
        await log_audit(
            actor=user,
            action="closure.delete",
            entity_type="closure",
            entity_id=closure_id,
            entity_name=closure.get("title_ar", ""),
            before={
                "title_ar": closure.get("title_ar", ""),
                "start_date": closure.get("start_date", ""),
                "end_date": closure.get("end_date", ""),
                "scope": closure.get("scope", "all"),
                "branch_id": closure.get("branch_id", "all"),
                "activity_names": closure.get("activity_names", []),
                "activity_ids": closure.get("activity_ids", []),
                "stop_type": closure.get("stop_type", "full_day"),
            },
        )
    except Exception:
        pass

    return {"message": "Deleted"}

async def extend_freezes_for_closure(closure: dict, member_ids: list, applied_by: str) -> dict:
    """Extend any ACTIVE member freezes that overlap the closure date range
    by the number of overlapping calendar days. Idempotent per closure."""
    result = {"extended": 0, "skipped": 0}
    if not member_ids:
        return result
    closure_start_str = closure.get("start_date", "")
    closure_end_str = closure.get("end_date", "")
    closure_id = closure.get("id", "")
    if not closure_start_str or not closure_end_str or not closure_id:
        return result
    try:
        closure_start = datetime.strptime(closure_start_str, "%Y-%m-%d")
        closure_end = datetime.strptime(closure_end_str, "%Y-%m-%d")
    except ValueError:
        return result

    freezes = await db.member_freezes.find({
        "member_id": {"$in": list(set(member_ids))},
        "status": "active",
        "start_date": {"$lte": closure_end_str},
        "end_date": {"$gte": closure_start_str},
    }, {"_id": 0}).to_list(20000)

    now_str = datetime.now(timezone.utc).isoformat()
    for fz in freezes:
        try:
            fz_start = datetime.strptime(fz["start_date"], "%Y-%m-%d")
            fz_end = datetime.strptime(fz["end_date"], "%Y-%m-%d")
        except (ValueError, KeyError):
            result["skipped"] += 1
            continue
        overlap_start = max(fz_start, closure_start)
        overlap_end = min(fz_end, closure_end)
        overlap_days = (overlap_end - overlap_start).days + 1
        if overlap_days <= 0:
            result["skipped"] += 1
            continue
        already = fz.get("closure_extensions") or []
        if any((c or {}).get("closure_id") == closure_id for c in already):
            result["skipped"] += 1
            continue
        new_end_dt = fz_end + timedelta(days=overlap_days)
        new_end_str = new_end_dt.strftime("%Y-%m-%d")
        new_duration = int(fz.get("duration_days", 0) or 0) + overlap_days
        already.append({
            "closure_id": closure_id,
            "closure_title": closure.get("title_ar", "") or closure.get("title_en", ""),
            "overlap_days": overlap_days,
            "old_end_date": fz["end_date"],
            "new_end_date": new_end_str,
            "extended_at": now_str,
            "extended_by": applied_by or "",
        })
        await db.member_freezes.update_one(
            {"id": fz["id"]},
            {"$set": {
                "end_date": new_end_str,
                "duration_days": new_duration,
                "closure_extensions": already,
            }}
        )
        if applied_by == "system_backfill":
            result["extended"] += 1
            continue
        try:
            notification = {
                "id": str(uuid.uuid4()),
                "member_id": fz["member_id"],
                "type": "freeze",
                "title_ar": "تمديد فترة التجميد",
                "message_ar": f"تم تمديد فترة تجميد عضويتك بـ {overlap_days} يوم بسبب الإغلاق ({closure.get('title_ar', '') or closure.get('title_en', '')}). تاريخ الانتهاء الجديد: {new_end_str}",
                "title_en": "Freeze Extended",
                "message_en": f"Your membership freeze was extended by {overlap_days} day(s) due to closure ({closure.get('title_en', '') or closure.get('title_ar', '')}). New end date: {new_end_str}",
                "read": False,
                "created_at": now_str,
            }
            await db.member_notifications.insert_one(notification)
        except Exception:
            pass
        result["extended"] += 1
    return result


def _dates_between(start: datetime, end: datetime):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _scheduled_count(start: str, end: str, days: set[int]) -> int:
    try:
        lo = datetime.strptime(start, "%Y-%m-%d")
        hi = datetime.strptime(end, "%Y-%m-%d")
    except (TypeError, ValueError):
        return 0
    # Match attendance quota's purchased-total rule. Operational dates may offer
    # extra alternatives, but moving a period must retain the paid allowance.
    return max(1, math.ceil((hi - lo).days / 7)) * len(days)


def _nth_scheduled_on_or_after(start: datetime, count: int, days: set[int]) -> datetime:
    if count <= 0 or not days:
        raise ValueError("A positive quota and known schedule are required")
    current = start
    found = 0
    for _ in range(3700):
        if current.weekday() in days:
            found += 1
            if found == count:
                return current
        current += timedelta(days=1)
    raise ValueError("Could not place subscription period")


def _next_scheduled_str(after: str, days: set[int]) -> str:
    current = datetime.strptime(after, "%Y-%m-%d") + timedelta(days=1)
    for _ in range(14):
        if current.weekday() in days:
            return current.strftime("%Y-%m-%d")
        current += timedelta(days=1)
    raise ValueError("Could not find next training occurrence")


def _weekday_number(value) -> Optional[int]:
    if isinstance(value, int) and 0 <= value <= 6:
        return value
    text = str(value or "").strip().lower()
    english = {
        "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6,
    }
    if text in english:
        return english[text]
    parsed = parse_schedule_days(text)
    return next(iter(parsed)) if len(parsed) == 1 else None


def _normalize_time(value) -> str:
    text = str(value or "").strip()
    for arabic, western in zip("٠١٢٣٤٥٦٧٨٩", "0123456789"):
        text = text.replace(arabic, western)
    text = re.sub(r"\s+", " ", text).lower()
    match = re.search(r"(?<!\d)(\d{1,2})(?::(\d{1,2}))?", text)
    if not match:
        return text
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    is_pm = "pm" in text or "م" in text or "مساء" in text
    is_am = "am" in text or "ص" in text or "صباح" in text
    if is_pm and hour < 12:
        hour += 12
    elif is_am and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return text
    return f"{hour:02d}:{minute:02d}"


def _activity_schedule(activity: dict, source_items: list) -> tuple[set[int], dict[int, str], str]:
    """Structured fields are authoritative; invoice fields are fallback only."""
    source = activity
    if not (activity.get("training_days") or activity.get("day_times")):
        candidates = [
            item for _inv, _index, item in source_items
            if item.get("training_days") or item.get("day_times")
        ]
        if len(candidates) == 1:
            source = candidates[0]
    raw_days = source.get("training_days") or []
    day_times = source.get("day_times") or {}
    days = {_weekday_number(day) for day in raw_days}
    days.discard(None)
    per_day_times = {}
    for day, value in day_times.items():
        weekday = _weekday_number(day)
        if weekday is not None:
            per_day_times[weekday] = _normalize_time(value)
    if not days and per_day_times:
        days = set(per_day_times)
    schedule = source.get("schedule") or ""
    if not days:
        days = parse_schedule_days(schedule)
    common_time = _normalize_time(source.get("training_time") or parse_schedule_time(schedule))
    for day in days:
        if day not in per_day_times and common_time:
            per_day_times[day] = common_time
    return days, per_day_times, schedule


def _stable_rows(rows):
    """Canonicalize unordered query results, not ordered subscription/item arrays."""
    return sorted(rows, key=lambda row: json.dumps(
        row, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":")
    ))


def _preview_token(plan: dict) -> str:
    stable = {
        "closure_id": plan["closure_id"],
        "closure_version": plan["closure_version"],
        "branch_id": plan["branch_id"],
        "excluded_member_ids": plan["excluded_member_ids"],
        "members": plan["public_members"],
        "skipped": plan["skipped_members"],
        "source_fingerprint": plan["source_fingerprint"],
    }
    return hashlib.sha256(
        json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


async def _build_safe_extension_plan(data: ExtensionApply, closure: dict, session=None) -> dict:
    """Build the exact read-only plan used by both preview and apply."""
    try:
        closure_start = datetime.strptime(closure["start_date"], "%Y-%m-%d")
        closure_end = datetime.strptime(closure["end_date"], "%Y-%m-%d")
    except (KeyError, ValueError):
        raise HTTPException(status_code=400, detail="Closure has invalid dates")

    closure_branch = closure.get("branch_id") or "all"
    branch_id = closure_branch if closure_branch != "all" else (data.branch_id or "all")
    query = {
        "activities": {"$elemMatch": {
            "start_date": {"$lte": closure["end_date"]},
            "end_date": {"$gte": closure["start_date"]},
        }}
    }
    if branch_id != "all":
        query["branch_id"] = branch_id
    session_arg = {"session": session} if session is not None else {}
    members = await db.members.find(query, **session_arg).to_list(10000)
    excluded = sorted(set(data.excluded_member_ids or []))
    members = sorted(
        (m for m in members if m.get("id") not in excluded),
        key=lambda m: str(m.get("id") or ""),
    )
    member_ids = [m.get("id") for m in members if m.get("id")]

    invoices = await db.invoices.find({
        "status": "paid",
        "$or": [
            {"member_id": {"$in": member_ids}},
            {"items.member_id": {"$in": member_ids}},
        ],
    }, {"_id": 0}, **session_arg).to_list(50000)
    # Binding and equal-date cascade tie breaking must not depend on find order.
    invoices.sort(key=lambda inv: str(inv.get("id") or ""))
    periods = await effective_period_map(db, invoices, session=session)
    paid_by_member = {}
    for inv in invoices:
        for index, item in enumerate(inv.get("items") or []):
            owner = item.get("member_id") or inv.get("member_id")
            if owner in member_ids and not item.get("is_product"):
                paid_by_member.setdefault(owner, []).append((inv, index, item))
    try:
        level_collection = db.level_subscriptions
    except AttributeError:
        level_subscriptions = []
    else:
        level_subscriptions = await level_collection.find(
            {"member_id": {"$in": member_ids}},
            {"_id": 1, "id": 1, "member_id": 1, "level_id": 1, "activity_id": 1,
             "start_date": 1, "end_date": 1},
            **session_arg,
        ).to_list(50000)
    level_subs_by_member = {}
    for subscription in level_subscriptions:
        level_subs_by_member.setdefault(subscription.get("member_id"), []).append(subscription)

    freezes = await db.member_freezes.find({
        "member_id": {"$in": member_ids},
        "status": "active",
        "start_date": {"$lte": closure["end_date"]},
        "end_date": {"$gte": closure["start_date"]},
    }, {"_id": 0, "member_id": 1, "start_date": 1, "end_date": 1}, **session_arg).to_list(20000)
    frozen_dates = {}
    for freeze in freezes:
        try:
            lo = max(closure_start, datetime.strptime(freeze["start_date"], "%Y-%m-%d"))
            hi = min(closure_end, datetime.strptime(freeze["end_date"], "%Y-%m-%d"))
            frozen_dates.setdefault(freeze["member_id"], set()).update(
                day.strftime("%Y-%m-%d") for day in _dates_between(lo, hi)
            )
        except (KeyError, ValueError):
            continue

    prior = await db.day_extensions.find({
        "member_id": {"$in": member_ids},
        "compensated_dates": {"$exists": True},
    }, {"_id": 0, "member_id": 1, "activity_id": 1, "compensated_dates": 1}, **session_arg).to_list(50000)
    compensated = {}
    for row in prior:
        compensated.setdefault((row.get("member_id"), row.get("activity_id")), set()).update(
            row.get("compensated_dates") or []
        )

    branch_ids = list({m.get("branch_id") for m in members if m.get("branch_id")})
    branch_docs = await db.branches.find(
        {"id": {"$in": branch_ids}}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1},
        **session_arg,
    ).to_list(len(branch_ids) or 1)
    branch_names = {
        b["id"]: b.get("name_ar") or b.get("name") or "" for b in branch_docs
    }
    activity_filter = set(closure.get("activity_ids") or [])
    if closure.get("activity_id"):
        activity_filter.add(closure["activity_id"])
    affected_times = {
        _normalize_time(value) for value in (closure.get("affected_times") or [])
    }
    specific_times = closure.get("stop_type") == "specific_times" and affected_times
    writes = []
    public_members = []
    skipped_members = []
    for member in members:
        mid = member.get("id")
        original_activities = member.get("activities") or []
        activities = [dict(a) for a in original_activities]
        activity_changes = []
        deferred = []
        records = []
        effective_rows = {}
        level_updates = []
        warnings = []
        paid_items = paid_by_member.get(mid, [])
        for act in activities:
            if act.get("status", "active") not in ("active", "expired"):
                continue
            aid = act.get("activity_id") or ""
            if closure.get("scope", "all") == "specific" and activity_filter and aid not in activity_filter:
                continue
            astart = str(act.get("start_date") or "")[:10]
            aend = str(act.get("end_date") or "")[:10]
            if not astart or not aend or astart > closure["end_date"] or aend < closure["start_date"]:
                continue
            # An activity is paid only when an owned paid item binds to it/source.
            bound = []
            for row in paid_items:
                inv, _index, item = row
                exact_activity = item.get("activity_id") == aid
                source_bound = (
                    act.get("source_id")
                    and inv.get("id") == act.get("source_id")
                    and original_window(item)[0] == astart
                    and (
                        not act.get("schedule")
                        or item.get("schedule") == act.get("schedule")
                    )
                )
                if exact_activity or source_bound:
                    bound.append(row)
            if not bound:
                warnings.append(f"{act.get('activity_name') or aid}: no paid source period")
                continue
            current_bound = [
                r for r in bound
                if (
                    (act.get("source_id") and r[0].get("id") == act.get("source_id"))
                    or original_window(r[2])[0] == astart
                )
            ]
            days, times_by_day, schedule = _activity_schedule(act, current_bound)
            if not days:
                warnings.append(f"{act.get('activity_name') or aid}: unknown schedule; skipped")
                continue
            missed_dates = []
            had_affected_time = not specific_times
            for day in _dates_between(closure_start, closure_end):
                date = day.strftime("%Y-%m-%d")
                if date < astart or date > aend or day.weekday() not in days:
                    continue
                if specific_times:
                    occurrence_time = times_by_day.get(day.weekday())
                    if not occurrence_time or occurrence_time not in affected_times:
                        continue
                    had_affected_time = True
                if date in frozen_dates.get(mid, set()):
                    continue
                if date in compensated.get((mid, aid), set()):
                    continue
                missed_dates.append(date)
            if not missed_dates:
                if specific_times and not had_affected_time:
                    warnings.append(
                        f"{act.get('activity_name') or aid}: training time is not affected"
                    )
                continue
            act_before = dict(act)
            change_checkpoint = len(activity_changes)
            record_checkpoint = len(records)
            deferred_checkpoint = len(deferred)
            effective_checkpoint = dict(effective_rows)
            level_checkpoint = len(level_updates)
            activity_invalid = False
            old_end = aend
            new_end = find_new_end_date(
                datetime.strptime(old_end, "%Y-%m-%d"), len(missed_dates), days
            ).strftime("%Y-%m-%d")
            act["end_date"] = new_end
            if act.get("period") and " - " in act["period"]:
                act["period"] = f"{act['period'].split(' - ')[0]} - {new_end}"
            name = act.get("activity_name") or act.get("name") or ""
            activity_changes.append({
                "activity_id": aid, "activity_name": name,
                "old_end_date": old_end, "new_end_date": new_end,
                "missed_sessions": len(missed_dates),
            })
            records.append({
                "id": str(uuid.uuid4()), "scope_type": "activity",
                "closure_id": closure["id"], "closure_title": closure.get("title_ar") or closure.get("title_en") or "",
                "member_id": mid, "member_name": member.get("name_ar") or member.get("name") or "",
                "member_code": member.get("member_code") or "", "branch_id": member.get("branch_id") or "",
                "activity_id": aid, "activity_name": name, "old_end_date": old_end,
                "new_end_date": new_end, "missed_sessions": len(missed_dates),
                "compensated_dates": missed_dates, "schedule": schedule,
                "mode": "training_days",
            })
            for subscription in level_subs_by_member.get(mid, []):
                sub_start = str(subscription.get("start_date") or "")[:10]
                sub_end = str(subscription.get("end_date") or "")[:10]
                same_binding = (
                    subscription.get("activity_id") == aid
                    or (
                        act.get("level_id")
                        and subscription.get("level_id") == act.get("level_id")
                    )
                )
                if (
                    same_binding and sub_start and sub_end
                    and sub_start <= closure["end_date"]
                    and sub_end >= closure["start_date"]
                ):
                    try:
                        shifted_level_end = find_new_end_date(
                            datetime.strptime(sub_end, "%Y-%m-%d"),
                            len(missed_dates), days,
                        ).strftime("%Y-%m-%d")
                    except ValueError:
                        warnings.append(f"{name}: invalid level subscription dates")
                        continue
                    level_updates.append({
                        "_id": subscription.get("_id"),
                        "id": subscription.get("id"),
                        "old_end_date": sub_end,
                        "new_end_date": shifted_level_end,
                    })

            # Bind the current source's operational deadline without changing its
            # immutable invoice item, then cascade only genuinely overlapping paid
            # future periods for this member/activity.
            current_source = None
            for row in bound:
                inv, index, item = row
                pstart, pend = operational_window(inv, item, index, periods)
                if pstart <= astart <= pend or inv.get("id") == act.get("source_id"):
                    current_source = row
                    break
            if current_source:
                inv, index, item = current_source
                key = source_key(inv, item, index)
                effective_rows[key] = {
                    "source_key": key, "source_invoice_id": inv.get("id"),
                    "source_item_id": invoice_item_key(inv, item, index),
                    "member_id": mid, "activity_id": aid,
                    "original_start_date": original_window(item)[0],
                    "original_end_date": original_window(item)[1],
                    "effective_start_date": astart, "effective_end_date": new_end,
                    "schedule": schedule, "source_bound_quota": True,
                }
            preceding_end = new_end
            future = []
            source_activity_ids = {aid} | {
                row[2].get("activity_id") for row in bound if row[2].get("activity_id")
            }
            for inv, index, item in paid_items:
                if item.get("activity_id") not in source_activity_ids:
                    continue
                pstart, pend = operational_window(inv, item, index, periods)
                if not pstart or not pend:
                    if inv.get("id") != act.get("source_id"):
                        warnings.append(
                            f"{name}: deferred period has invalid dates; member skipped"
                        )
                        activity_invalid = True
                    continue
                if pstart <= astart:
                    continue
                future.append((pstart, pend, inv, index, item))
            future.sort(key=lambda row: (row[0], row[1], str(row[2].get("id"))))
            for pstart, pend, inv, index, item in future:
                if pstart > preceding_end:
                    preceding_end = pend
                    continue
                period_days, _period_times, _period_schedule = _activity_schedule(
                    item, []
                )
                if not period_days:
                    has_explicit_schedule = bool(
                        item.get("training_days") or item.get("day_times")
                        or item.get("schedule")
                    )
                    if not has_explicit_schedule:
                        period_days = days
                quota = _scheduled_count(
                    original_window(item)[0] or pstart,
                    original_window(item)[1] or pend,
                    period_days,
                )
                if not period_days or quota <= 0:
                    warnings.append(
                        f"{name}: deferred period has unknown schedule; member skipped"
                    )
                    activity_invalid = True
                    break
                new_start = _next_scheduled_str(preceding_end, period_days)
                new_end_dt = _nth_scheduled_on_or_after(
                    datetime.strptime(new_start, "%Y-%m-%d"), quota, period_days
                )
                new_period_end = new_end_dt.strftime("%Y-%m-%d")
                key = source_key(inv, item, index)
                effective_rows[key] = {
                    "source_key": key, "source_invoice_id": inv.get("id"),
                    "source_item_id": invoice_item_key(inv, item, index),
                    "member_id": mid, "activity_id": aid,
                    "original_start_date": original_window(item)[0],
                    "original_end_date": original_window(item)[1],
                    "effective_start_date": new_start, "effective_end_date": new_period_end,
                    "schedule": item.get("schedule") or schedule,
                    "source_bound_quota": True,
                }
                deferred.append({
                    "activity_id": aid, "activity_name": name,
                    "invoice_id": inv.get("id"), "old_start_date": pstart,
                    "old_end_date": pend, "new_start_date": new_start,
                    "new_end_date": new_period_end,
                })
                preceding_end = new_period_end
            if activity_invalid:
                act.clear()
                act.update(act_before)
                del activity_changes[change_checkpoint:]
                del records[record_checkpoint:]
                del deferred[deferred_checkpoint:]
                effective_rows = effective_checkpoint
                del level_updates[level_checkpoint:]
                continue

        if activity_changes:
            # One level membership may be linked to multiple activities. An
            # identical planned deadline is one CAS write, not two: after the
            # first update, a second old-end-date predicate cannot match.
            unique_level_updates = {}
            for update in level_updates:
                key = json.dumps(update, sort_keys=True, default=str)
                unique_level_updates[key] = update
            level_updates = list(unique_level_updates.values())
            public = {
                "member_id": mid, "id": mid,
                "name": member.get("name_ar") or member.get("name") or "",
                "guardian_name": member.get("guardian_name_ar") or member.get("guardian_name") or "",
                "phone": member.get("phone") or "",
                "branch_id": member.get("branch_id") or "",
                "branch_name": branch_names.get(member.get("branch_id"), ""),
                "activity_changes": activity_changes,
                "deferred_periods": deferred,
                "warnings": warnings,
                "details": [{
                    "activity": c["activity_name"], "old_end": c["old_end_date"],
                    "new_end": c["new_end_date"], "missed_sessions": c["missed_sessions"],
                } for c in activity_changes],
            }
            public_members.append(public)
            writes.append({
                "member_id": mid, "old_activities": original_activities,
                "activities": activities, "records": records,
                "effective_rows": list(effective_rows.values()),
                "level_updates": level_updates, "public": public,
            })
        elif warnings:
            skipped_members.append({
                "member_id": mid,
                "name": member.get("name_ar") or member.get("name") or "",
                "reason": "; ".join(warnings),
            })
    plan = {
        "closure_id": closure["id"],
        "closure_version": {
            key: closure.get(key) for key in (
                "start_date", "end_date", "scope", "activity_ids", "activity_id",
                "affected_times", "stop_type", "branch_id", "applied",
            )
        },
        "branch_id": branch_id, "excluded_member_ids": excluded,
        "writes": writes, "public_members": public_members,
        "skipped_members": skipped_members,
        "source_fingerprint": hashlib.sha256(json.dumps({
            "members": [
                {"id": m.get("id"), "branch_id": m.get("branch_id"),
                 "activities": m.get("activities") or []}
                for m in members
            ],
            # Receipt/notice delivery and paid_at backfills do not change the
            # purchased subscription. Retain full ordered items and financial
            # inputs so meaningful invoice edits still require review.
            "invoices": _stable_rows([{
                key: inv.get(key) for key in (
                    "id", "member_id", "status", "items", "branch_id",
                    "subtotal", "discount", "discount_code", "vat_amount",
                    "total", "amount_paid", "paid_amount", "remaining_amount",
                    "payment_method", "payment_split",
                )
            } for inv in invoices]),
            "freezes": _stable_rows(freezes),
            "prior_extensions": _stable_rows(prior),
            "effective_periods": _stable_rows([{
                key: row.get(key) for key in (
                    "source_key", "source_invoice_id", "source_item_id",
                    "member_id", "activity_id", "original_start_date",
                    "original_end_date", "effective_start_date",
                    "effective_end_date", "schedule", "source_bound_quota",
                )
            } for row in periods.values()]),
            "level_subscriptions": _stable_rows(level_subscriptions),
        }, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest(),
    }
    plan["preview_token"] = _preview_token(plan)
    return plan


async def _commit_safe_extension_plan(
    data: ExtensionApply, closure: dict, user: dict, expected_token: str
):
    """Commit all operational dates and records in one Mongo transaction."""
    client = getattr(db, "_client", None)
    if client is None or not hasattr(client, "start_session"):
        raise HTTPException(status_code=503, detail="Atomic transactions are unavailable")
    async with await client.start_session() as session:
        async with session.start_transaction():
            transactional_closure = await db.closures.find_one(
                {"id": closure["id"]}, session=session
            )
            if not transactional_closure or transactional_closure.get("applied"):
                raise HTTPException(status_code=409, detail="Closure was already applied")
            plan = await _build_safe_extension_plan(
                data, transactional_closure, session=session
            )
            if plan["preview_token"] != expected_token:
                raise HTTPException(
                    status_code=409,
                    detail="Preview sources changed; preview and confirm again",
                )
            lock = await db.closures.update_one(
                {"id": closure["id"], "applied": {"$ne": True}},
                {"$set": {"apply_in_progress": True}},
                session=session,
            )
            if not lock.modified_count:
                raise HTTPException(status_code=409, detail="Closure was already applied")
            now = datetime.now(timezone.utc).isoformat()
            for write in plan["writes"]:
                result = await db.members.update_one(
                    {"id": write["member_id"], "activities": write["old_activities"]},
                    {"$set": {"activities": write["activities"]}},
                    session=session,
                )
                if result.modified_count != 1:
                    raise HTTPException(status_code=409, detail="Member subscriptions changed; preview again")
                for level_update in write["level_updates"]:
                    identity = (
                        {"_id": level_update["_id"]}
                        if level_update.get("_id") is not None
                        else {"id": level_update.get("id")}
                    )
                    identity["member_id"] = write["member_id"]
                    identity["end_date"] = level_update["old_end_date"]
                    level_result = await db.level_subscriptions.update_one(
                        identity,
                        {"$set": {"end_date": level_update["new_end_date"]}},
                        session=session,
                    )
                    if level_result.modified_count != 1:
                        raise HTTPException(
                            status_code=409,
                            detail="Level subscription changed; preview again",
                        )
                for record in write["records"]:
                    record.update({"applied_by": user.get("username", ""), "applied_at": now})
                    await db.day_extensions.insert_one(record, session=session)
                for row in write["effective_rows"]:
                    row.update({"updated_at": now, "updated_by_closure_id": closure["id"]})
                    await db.subscription_effective_periods.replace_one(
                        {"source_key": row["source_key"]}, row, upsert=True, session=session
                    )
            affected = [write["public"] for write in plan["writes"]]
            await db.closures.update_one(
                {"id": closure["id"], "apply_in_progress": True},
                {"$set": {
                    "applied": True, "applied_count": len(affected),
                    "applied_at": now, "applied_by": user.get("username", ""),
                    "affected_members": affected, "freezes_extended": False,
                }, "$unset": {"apply_in_progress": ""}},
                session=session,
            )
            await db.extension_logs.insert_one({
                "id": str(uuid.uuid4()), "type": "closure",
                "closure_id": closure["id"], "closure_title": closure.get("title_ar", ""),
                "members_count": len(affected), "branch_id": plan["branch_id"],
                "scope": closure.get("scope", "all"), "applied_by": user.get("username", ""),
                "created_at": now, "affected_members": affected,
            }, session=session)
    return plan


@router.post("/apply")
async def apply_extension(data: ExtensionApply, user=Depends(get_current_user)):
    await _require_current_admin(user)
    if data.days <= 0:
        raise HTTPException(status_code=400, detail="Days must be positive")
    closure = await db.closures.find_one({"id": data.closure_id})
    if not closure:
        raise HTTPException(status_code=404, detail="Closure not found")

    # Applied retries are idempotent and never recompute against later state.
    if closure.get("applied"):
        excluded = set(data.excluded_member_ids or [])
        saved = [
            row for row in (closure.get("affected_members") or [])
            if row.get("member_id") not in excluded
            and (
                (closure.get("branch_id") or "all") != "all"
                or not data.branch_id or data.branch_id == "all"
                or row.get("branch_id") == data.branch_id
            )
        ]
        saved_token = hashlib.sha256(json.dumps(
            {"closure_id": closure["id"], "applied_at": closure.get("applied_at"),
             "members": saved, "excluded_member_ids": sorted(excluded)},
            ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        ).encode()).hexdigest()
        return {
            "message": f"Extended {len(saved)} members", "extended_count": len(saved),
            "days": data.days,
            "extended_members": saved, "affected_members": saved,
            "members": saved, "skipped_count": 0, "skipped_members": [],
            "applied": True, "dry_run": bool(data.dry_run),
            "preview_token": saved_token if data.dry_run else None,
        }
    if not data.dry_run and not data.preview_token:
        raise HTTPException(
            status_code=409,
            detail="Preview is required before applying this closure",
        )
    plan = await _build_safe_extension_plan(data, closure)
    token = plan["preview_token"]
    if data.dry_run:
        return {
            "message": f"Preview: would extend {len(plan['public_members'])} members",
            "dry_run": True, "preview_token": token, "days": data.days,
            "extended_count": len(plan["public_members"]),
            "extended_members": plan["public_members"],
            "affected_members": plan["public_members"],
            "members": plan["public_members"],
            "skipped_count": len(plan["skipped_members"]),
            "skipped_members": plan["skipped_members"],
        }
    if data.preview_token and data.preview_token != token:
        raise HTTPException(status_code=409, detail="Preview is stale; preview and confirm again")
    try:
        plan = await _commit_safe_extension_plan(data, closure, user, token)
    except HTTPException:
        raise
    except Exception as exc:
        # Concurrent confirmations race on the closure lock / unique extension
        # key. Surface a reconfirmation conflict; all other database errors remain
        # visible and the transaction has already rolled back.
        if getattr(exc, "code", None) in (11000, 112, 251):
            raise HTTPException(
                status_code=409, detail="Subscriptions changed concurrently; preview again"
            ) from exc
        raise
    return {
        "message": f"Extended {len(plan['public_members'])} members",
        "days": data.days,
        "extended_count": len(plan["public_members"]),
        "extended_members": plan["public_members"],
        "affected_members": plan["public_members"],
        "skipped_count": len(plan["skipped_members"]),
        "skipped_members": plan["skipped_members"],
    }

def _personalize_closure_notice(template: str, member: dict) -> str:
    detail = ((member.get("details") or [{}])[0]) or {}
    values = {
        "name": member.get("name") or "",
        "days": detail.get("missed_sessions") or "",
        "new_end": detail.get("new_end") or "",
        "old_end": detail.get("old_end") or "",
        "activity": detail.get("activity") or "",
    }
    message = template
    for key, value in values.items():
        message = message.replace("{" + key + "}", str(value))
    if "— English —" not in message:
        lines = [
            "— English —",
            "Subscription extension notice",
            f"Member: {values['name']}",
        ]
        for item in member.get("details") or []:
            lines.extend([
                f"Activity: {item.get('activity') or '—'}",
                f"Sessions to compensate: {item.get('missed_sessions') or 0}",
                f"Previous end date: {item.get('old_end') or '—'}",
                f"New end date: {item.get('new_end') or '—'}",
            ])
        message += "\n\n" + "\n".join(lines)
    return message


async def _require_current_admin(user: dict) -> None:
    """Do not authorize a sensitive send from stale JWT role claims alone."""
    require_admin(user)
    current = await db.users.find_one(
        {"id": user.get("user_id")}, {"_id": 0, "is_admin": 1}
    )
    if not current or not current.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")


async def _closure_provider(branch_id: str) -> str:
    """Validate the branch's actual provider before any branch is enqueued."""
    from routes import whatsapp as whatsapp_routes

    if not await db.branches.find_one({"id": branch_id}, {"_id": 1}):
        raise HTTPException(status_code=400, detail=f"Branch not found: {branch_id}")
    config = await whatsapp_routes._get_branch_cloud_config(branch_id)
    provider = whatsapp_routes._branch_provider(config)
    if provider not in {"meta_cloud", "waha", "whatsflow"}:
        raise HTTPException(
            status_code=400,
            detail=f"No supported WhatsApp provider is enabled for branch {branch_id}",
        )
    reason = whatsapp_routes._validate_bulk_job_config(provider, config)
    if reason:
        raise HTTPException(status_code=400, detail=f"Branch {branch_id}: {reason}")
    if provider == "meta_cloud" and not (
        config.get("message_template_name")
        and config.get("single_variable_template_confirmed")
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Branch {branch_id}: confirm an approved Meta text template",
        )
    if provider == "waha" and config.get("waha_session_status") not in {"WORKING", "CONNECTED"}:
        raise HTTPException(status_code=400, detail=f"Branch {branch_id}: WAHA is disconnected")
    if provider == "whatsflow" and config.get("whatsflow_state") != "open":
        raise HTTPException(status_code=400, detail=f"Branch {branch_id}: Whatsflow is disconnected")
    return provider


@router.post("/closure-notices")
async def enqueue_closure_notices(
    data: ClosureNoticeSend, user=Depends(get_current_user)
):
    """Queue a preview's notices without applying or mutating the closure."""
    await _require_current_admin(user)
    template = data.message.strip()
    if not template:
        raise HTTPException(status_code=400, detail="Message text is required")
    if len(template) > 4096:
        raise HTTPException(status_code=400, detail="Message text is too long")

    closure = await db.closures.find_one({"id": data.closure_id})
    if not closure:
        raise HTTPException(status_code=404, detail="Closure not found")
    closure_branch = closure.get("branch_id") or "all"
    requested_branch = data.branch_id or "all"
    if closure_branch != "all":
        effective_branch = closure_branch
    else:
        effective_branch = requested_branch
        if effective_branch != "all" and not await db.branches.find_one(
            {"id": effective_branch}, {"_id": 1}
        ):
            raise HTTPException(status_code=400, detail="Branch not found")

    existing_query = {"idempotency_key": notice_key(closure["id"])}
    if effective_branch != "all":
        existing_query["branch_id"] = effective_branch
    existing_jobs = await db.whatsapp_campaign_jobs.find(
        existing_query, {"_id": 0, "tenant_slug": 0}
    ).to_list(None)
    existing_by_branch = {j["branch_id"]: j for j in existing_jobs}
    target_branches = (
        [effective_branch] if effective_branch != "all" else
        [b["id"] for b in await db.branches.find({}, {"id": 1}).to_list(None)]
    )
    if target_branches and all(b in existing_by_branch for b in target_branches):
        return {"queued": 0, "existing": True, "skipped_without_phone": 0,
                "jobs": [{**j, "created": False} for j in existing_jobs]}

    # Recompute the preview from the stored closure. The client supplies neither
    # recipient phones nor personalization values.
    preview = await apply_extension(
        ExtensionApply(
            closure_id=closure["id"],
            days=closure["days"],
            branch_id=effective_branch,
            dry_run=True,
            excluded_member_ids=list(set(data.excluded_member_ids or [])),
        ),
        user,
    )
    preview_members = preview.get("extended_members") or []
    excluded_ids = set(data.excluded_member_ids or [])
    preview_members = [
        member for member in preview_members
        if member.get("member_id") not in excluded_ids
    ]
    if not preview_members:
        if existing_jobs:
            return {"queued": 0, "existing": True, "skipped_without_phone": 0,
                    "jobs": [{**j, "created": False} for j in existing_jobs]}
        raise HTTPException(status_code=400, detail="No eligible recipients")

    member_ids = [m["member_id"] for m in preview_members if m.get("member_id")]
    authoritative = {
        m["id"]: m
        for m in await db.members.find(
            {"id": {"$in": member_ids}},
            {"_id": 0, "id": 1, "name": 1, "name_ar": 1,
             "phone": 1, "branch_id": 1},
        ).to_list(10000)
    }
    grouped = {}
    skipped_without_phone = 0
    from routes import whatsapp as whatsapp_routes
    for item in preview_members:
        member = authoritative.get(item.get("member_id"))
        if not member:
            continue
        branch_id = member.get("branch_id")
        if branch_id in existing_by_branch:
            continue
        if not branch_id:
            raise HTTPException(
                status_code=400,
                detail=f"Member {member.get('id')} has no branch; nothing was queued",
            )
        if effective_branch != "all" and branch_id != effective_branch:
            raise HTTPException(status_code=403, detail="Recipient branch mismatch")
        phone = member.get("phone") or ""
        if not phone:
            skipped_without_phone += 1
            continue
        if not whatsapp_routes._format_cloud_phone(phone):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Member {member.get('id')} has an invalid WhatsApp phone; "
                    "nothing was queued"
                ),
            )
        item["name"] = member.get("name_ar") or member.get("name") or ""
        message = _personalize_closure_notice(template, item)
        if not message or len(message) > 4096:
            raise HTTPException(status_code=400, detail="Personalized message is invalid")
        grouped.setdefault(branch_id, []).append({"phone": phone, "message": message,
                                                  "recipient_id": member["id"]})
    if not grouped and not existing_jobs:
        raise HTTPException(status_code=400, detail="No recipients have a phone number")

    # Validate every branch first so unsupported/disabled branches cannot result
    # in an avoidable partial enqueue.
    providers = {
        branch_id: await _closure_provider(branch_id) for branch_id in grouped
    }
    jobs = [{**j, "created": False} for j in existing_jobs]
    for branch_id, recipients in grouped.items():
        # Branch-scoped uniqueness makes retries, double-clicks, and a later
        # all-branches retry return the original job rather than sending twice.
        key = notice_key(closure["id"])
        job, created = await whatsapp_bulk_jobs.enqueue(
            branch_id, providers[branch_id], recipients, key
        )
        jobs.append({**job, "created": created})
    return {
        "queued": sum(job.get("recipient_count", job.get("total", 0)) for job in jobs if job["created"]),
        "existing": any(not job["created"] for job in jobs),
        "skipped_without_phone": skipped_without_phone,
        "jobs": jobs,
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
