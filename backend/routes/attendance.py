"""Attendance routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
import math
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user
from utils.auth import resolve_branch_filter


async def send_attendance_push(member_id: str, member_name: str, activity_name: str, check_in_time: str):
    """Send push notification to ALL member subscriptions (web + android)"""
    try:
        from .push_notifications import send_push_notification, NotificationPayload
        from utils.i18n import t
        subs = await db.push_subscriptions.find(
            {"member_id": member_id, "is_active": True}, {"_id": 0}
        ).to_list(10)
        if not subs:
            return
        # Populate both Arabic and English variants on the payload; the
        # downstream send_push_notification picks the right one per
        # subscription based on the recipient's saved language preference.
        title_ar = t("attendance_title", "ar")
        title_en = t("attendance_title", "en")
        if activity_name:
            body_ar = t("attendance_body_with_activity", "ar", activity=activity_name, time=check_in_time)
            body_en = t("attendance_body_with_activity", "en", activity=activity_name, time=check_in_time)
        else:
            body_ar = t("attendance_body_time_only", "ar", time=check_in_time)
            body_en = t("attendance_body_time_only", "en", time=check_in_time)
        payload = NotificationPayload(
            title=title_ar,
            body=body_ar,
            title_en=title_en,
            body_en=body_en,
            url="/",
            tag=f"attendance-{member_id}",
            data={"type": "attendance"}
        )
        for sub in subs:
            try:
                await send_push_notification(sub, payload)
            except Exception as e:
                print(f"send_attendance_push sub error: {e}")
    except Exception as e:
        print(f"send_attendance_push error: {e}")

router = APIRouter(prefix="/attendance", tags=["attendance"])

# Loyalty points helper function (will be set from server.py)
loyalty_award_points = None

def set_loyalty_award_function(func):
    global loyalty_award_points
    loyalty_award_points = func

async def award_attendance_points(member_id: str):
    """Award points for attendance and check for streaks"""
    if not loyalty_award_points:
        return
    
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)
    
    # Get member points record
    member_points = await db.member_points.find_one({"member_id": member_id})
    
    current_streak = 1
    if member_points:
        last_date = member_points.get('last_attendance_date')
        if last_date:
            try:
                last_date = datetime.fromisoformat(last_date.replace('Z', '+00:00')).date()
                if last_date == yesterday:
                    # Consecutive day, increase streak
                    current_streak = member_points.get('attendance_streak', 0) + 1
                elif last_date == today:
                    # Already awarded today
                    return
            except Exception:
                pass
    
    # Update streak and last attendance date
    await db.member_points.update_one(
        {"member_id": member_id},
        {
            "$set": {
                "attendance_streak": current_streak,
                "last_attendance_date": today.isoformat()
            }
        },
        upsert=True
    )
    
    # Award attendance points
    await loyalty_award_points(
        member_id,
        "attendance",
        "نقاط الحضور اليومي",
        "Daily attendance points"
    )
    
    # Check for streak bonuses
    if current_streak == 5:
        await loyalty_award_points(
            member_id,
            "streak_5",
            "مكافأة 5 أيام حضور متتالية! 🔥",
            "5-day attendance streak bonus! 🔥"
        )
    elif current_streak == 10:
        await loyalty_award_points(
            member_id,
            "streak_10",
            "مكافأة 10 أيام حضور متتالية! 🔥🔥",
            "10-day attendance streak bonus! 🔥🔥"
        )
    elif current_streak == 20:
        await loyalty_award_points(
            member_id,
            "streak_10",
            "مكافأة 20 يوم حضور متتالي! 🏆",
            "20-day attendance streak bonus! 🏆",
            150  # Custom points for 20 days
        )

# ============ MODELS ============

class AttendanceCreate(BaseModel):
    member_id: str
    activity_id: str
    date: Optional[str] = None
    check_in_time: Optional[str] = None
    notes: Optional[str] = ""

class AttendanceRecord(BaseModel):
    id: str
    member_id: str
    member_name: Optional[str] = ""
    member_code: Optional[str] = ""
    member_photo: Optional[str] = ""
    phone: Optional[str] = ""
    activity_id: str
    activity_name: Optional[str] = ""
    date: str
    check_in_time: str
    notes: Optional[str] = ""
    branch_id: Optional[str] = None
    recorded_by: Optional[str] = ""
    created_at: str

# ============ ROUTES ============

@router.get("")
async def get_attendance(
    date: Optional[str] = None,
    activity_id: Optional[str] = None,
    member_id: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get attendance records with optional filters"""
    query = {}

    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch

    if date:
        query["date"] = date
    if activity_id:
        query["activity_id"] = activity_id
    if member_id:
        query["member_id"] = member_id
    
    records = await db.attendance.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)

    # Enrich records with member photo (batch lookup) for any record missing it
    member_ids = {r.get("member_id") for r in records if r.get("member_id") and not r.get("member_photo")}
    if member_ids:
        members_with_photo = await db.members.find(
            {"id": {"$in": list(member_ids)}},
            {"_id": 0, "id": 1, "photo": 1}
        ).to_list(len(member_ids))
        photo_map = {m["id"]: m.get("photo", "") for m in members_with_photo}
        for r in records:
            if not r.get("member_photo"):
                r["member_photo"] = photo_map.get(r.get("member_id"), "")

    return records

@router.post("")
async def create_attendance(
    attendance: AttendanceCreate,
    current_user: dict = Depends(get_current_user)
):
    """Record attendance for a member"""
    user_name = current_user.get("name", current_user.get("username", ""))
    
    # Get member info
    member = await db.members.find_one({"id": attendance.member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # Use member's branch first, fall back to current user's branch
    branch_id = member.get("branch_id") or current_user.get("branch_id")
    
    # Check if member has active freeze
    saudi_tz_w = timezone(timedelta(hours=3))
    record_date_check = attendance.date or datetime.now(saudi_tz_w).strftime("%Y-%m-%d")
    active_freeze = await db.member_freezes.find_one({
        "member_id": attendance.member_id,
        "status": "active",
        "start_date": {"$lte": record_date_check},
        "end_date": {"$gte": record_date_check}
    })
    if active_freeze:
        raise HTTPException(status_code=400, detail=f"عضوية مجمّدة حتى {active_freeze['end_date']} - لا يمكن تسجيل الحضور")
    
    # Get activity info
    activity = await db.activities.find_one({"id": attendance.activity_id}, {"_id": 0})
    activity_name = activity.get("name_ar", "") if activity else ""
    
    # Use provided date or today (Saudi tz to align with reports)
    record_date = attendance.date or datetime.now(saudi_tz_w).strftime("%Y-%m-%d")
    check_in_time = attendance.check_in_time or datetime.now(saudi_tz_w).strftime("%H:%M")
    
    # Check if already checked in today for this activity
    existing = await db.attendance.find_one({
        "member_id": attendance.member_id,
        "activity_id": attendance.activity_id,
        "date": record_date
    })
    if existing:
        raise HTTPException(status_code=400, detail="Already checked in for this activity today")

    # Hard cap on total allowed sessions for this subscription
    await enforce_session_cap(attendance.member_id, attendance.activity_id, record_date)

    # Off-schedule detection: did the member attend on a day NOT in their schedule?
    schedule_days = await get_member_schedule_days(attendance.member_id, attendance.activity_id)
    is_off_schedule = False
    if schedule_days:
        try:
            rec_day = datetime.strptime(record_date, "%Y-%m-%d").strftime("%A").lower()
            is_off_schedule = rec_day not in schedule_days
        except Exception:
            is_off_schedule = False

    note_text = attendance.notes
    if is_off_schedule:
        note_text = f"{attendance.notes} (خارج الموعد)" if attendance.notes else "خارج الموعد"

    record_id = str(uuid.uuid4())
    record = {
        "id": record_id,
        "member_id": attendance.member_id,
        "member_name": member.get("name_ar", member.get("name", "")),
        "member_code": member.get("member_code", ""),
        "member_photo": member.get("photo", ""),
        "phone": member.get("phone", ""),
        "activity_id": attendance.activity_id,
        "activity_name": activity_name,
        "date": record_date,
        "check_in_time": check_in_time,
        "status": "present",
        "notes": note_text,
        "branch_id": branch_id,
        "recorded_by": user_name,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    # Attending outside the schedule consumes a session out of order: pull the
    # subscription end date earlier by one scheduled occurrence.
    if is_off_schedule:
        record["off_schedule"] = True
        shift = await apply_off_schedule_end_shift(
            attendance.member_id, attendance.activity_id, record_date, schedule_days
        )
        if shift:
            record["end_shift_from"], record["end_shift_to"] = shift

    await db.attendance.insert_one(record)
    
    # Award loyalty points for attendance
    if loyalty_award_points:
        try:
            await award_attendance_points(attendance.member_id)
        except Exception as e:
            print(f"Error awarding loyalty points: {e}")
    
    # Send push notification to member
    try:
        await send_attendance_push(attendance.member_id, record["member_name"], activity_name, check_in_time)
    except Exception as e:
        print(f"Attendance push error: {e}")
    
    return {"message": "Attendance recorded", "record": {k: v for k, v in record.items() if k != "_id"}}

ARABIC_DAY_MAP = {
    "الأحد": "sunday", "الاحد": "sunday", "أحد": "sunday", "احد": "sunday",
    "الإثنين": "monday", "الاثنين": "monday", "إثنين": "monday", "اثنين": "monday",
    "الثلاثاء": "tuesday", "ثلاثاء": "tuesday",
    "الأربعاء": "wednesday", "الاربعاء": "wednesday", "أربعاء": "wednesday", "اربعاء": "wednesday",
    "الخميس": "thursday", "خميس": "thursday",
    "الجمعة": "friday", "جمعة": "friday",
    "السبت": "saturday", "سبت": "saturday"
}

ENGLISH_TO_ARABIC_DAY = {
    "sunday": "الأحد",
    "monday": "الإثنين",
    "tuesday": "الثلاثاء",
    "wednesday": "الأربعاء",
    "thursday": "الخميس",
    "friday": "الجمعة",
    "saturday": "السبت"
}

import re

def parse_schedule_days(schedule_text: str) -> list:
    if not schedule_text:
        return []
    days_found = []
    text = schedule_text.strip()
    for arabic, english in ARABIC_DAY_MAP.items():
        if arabic in text:
            if english not in days_found:
                days_found.append(english)
    eng_days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    for d in eng_days:
        if re.search(r'\b' + d + r'\b', text, re.IGNORECASE):
            if d not in days_found:
                days_found.append(d)
    return days_found

async def get_member_schedule_days(member_id: str, activity_id: str) -> list:
    """Return the member's scheduled weekdays (english lowercase) for an activity.

    The AUTHORITATIVE schedule lives in ``member.activities`` — that is where the
    admin edits الموعد and where level/day assignment writes the slot. Invoices are
    only a FALLBACK because their ``activity_id`` frequently diverges from the
    assigned-level activity_id (level-based assignment uses a different activity
    record) and their dates may already be expired — in which case reading invoices
    alone returns NO schedule and an off-schedule attendance is silently missed
    (its end-date shift never applies). Read member.activities first, fall back to
    invoices only when the member has no scheduled activity entry."""
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    all_days = []

    # 1) member.activities — authoritative source.
    member = await db.members.find_one({"id": member_id}, {"_id": 0, "activities": 1})
    for act in (member or {}).get("activities", []):
        if act.get("activity_id") != activity_id:
            continue
        if act.get("status", "active") != "active":
            continue
        for d in parse_schedule_days(act.get("schedule", "")):
            if d not in all_days:
                all_days.append(d)
    if all_days:
        return all_days

    # 2) Fallback: paid/partial invoices (original behaviour).
    invoices = await db.invoices.find(
        {"member_id": member_id, "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("activity_id") == activity_id:
                end_date = item.get("end_date", "")
                if end_date and end_date < today_str:
                    continue
                schedule_text = item.get("schedule", "")
                days = parse_schedule_days(schedule_text)
                for d in days:
                    if d not in all_days:
                        all_days.append(d)
    return all_days

def _previous_scheduled_date(end_date_str: str, schedule_days_eng: list):
    """Return the latest date strictly before `end_date_str` whose weekday is in
    `schedule_days_eng` (english lowercase day names). Returns None if it cannot
    be computed (missing date / no schedule days / none found within two weeks)."""
    if not end_date_str or not schedule_days_eng:
        return None
    try:
        d = datetime.strptime(end_date_str, "%Y-%m-%d")
    except Exception:
        return None
    sched = set(schedule_days_eng)
    for i in range(1, 15):
        cand = d - timedelta(days=i)
        if cand.strftime("%A").lower() in sched:
            return cand.strftime("%Y-%m-%d")
    return None

def _next_scheduled_date(end_date_str: str, schedule_days_eng: list):
    """Return the earliest date strictly after `end_date_str` whose weekday is in
    `schedule_days_eng`. Inverse of `_previous_scheduled_date`; used to undo an
    off-schedule shift on deletion. Returns None if it cannot be computed."""
    if not end_date_str or not schedule_days_eng:
        return None
    try:
        d = datetime.strptime(end_date_str, "%Y-%m-%d")
    except Exception:
        return None
    sched = set(schedule_days_eng)
    for i in range(1, 15):
        cand = d + timedelta(days=i)
        if cand.strftime("%A").lower() in sched:
            return cand.strftime("%Y-%m-%d")
    return None

async def apply_off_schedule_end_shift(member_id: str, activity_id: str,
                                       attendance_date: str, schedule_days_eng: list):
    """When a member attends OUTSIDE their scheduled days, pull the subscription
    end date earlier by one scheduled occurrence (the off-day session consumes a
    slot out of the schedule, so the subscription ends one scheduled day sooner).

    Mutates the matching active entry in member.activities. Returns
    (old_end, new_end) when the end date changed, otherwise None."""
    if not schedule_days_eng:
        return None
    member = await db.members.find_one({"id": member_id}, {"_id": 0, "activities": 1})
    if not member:
        return None
    activities = member.get("activities", []) or []
    target = None
    for a in activities:
        if (a.get("activity_id") == activity_id
                and a.get("status", "active") == "active"
                and a.get("end_date")):
            target = a
            break
    if not target:
        return None
    old_end = target.get("end_date")
    start_date = target.get("start_date") or ""
    prev = _previous_scheduled_date(old_end, schedule_days_eng)
    if not prev:
        return None
    new_end = prev
    # Exact rule: pull the end date back by exactly one scheduled occurrence.
    # Only guard against the degenerate case of crossing the subscription start.
    if start_date and new_end < start_date:
        new_end = start_date
    if new_end >= old_end:
        return None
    target["end_date"] = new_end
    await db.members.update_one({"id": member_id}, {"$set": {"activities": activities}})
    return (old_end, new_end)

async def enforce_session_cap(member_id: str, activity_id: str, check_date: str):
    """Raise HTTPException if recording another attendance would exceed the
    member's total allowed sessions for the active subscription that covers
    `check_date`. Uses the same calculation as check_member_session_quota so
    the total honours days_per_week × weeks (e.g. 2 days/week → 8/month)."""
    quotas = await check_member_session_quota(member_id, activity_id)
    for q in quotas:
        if q.get("activity_id") != activity_id:
            continue
        start = q.get("start_date") or ""
        end = q.get("end_date") or ""
        if start and end and not (start <= check_date <= end):
            continue
        if q.get("used_sessions", 0) >= q.get("total_allowed", 0):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"تم استنفاد عدد الحصص المسموح به ({q.get('used_sessions')}/"
                    f"{q.get('total_allowed')}) — لا يمكن تسجيل حصة إضافية"
                ),
            )
        return


async def check_member_session_quota(member_id: str, activity_id: str = None):
    """Check if member has used all their allowed sessions based on subscription days per week.
    Checks both invoices (normal members) and member.activities (registration form members)."""
    saudi_tz = timezone(timedelta(hours=3))
    today_str = datetime.now(saudi_tz).strftime("%Y-%m-%d")

    results = []
    # Track (activity_id, start_date, end_date) combos already added to avoid duplicates
    seen_subs = set()
    # Activity ids that already produced a card (from the authoritative
    # member.activities source); their stale invoice duplicates are skipped.
    produced_aids = set()

    async def _process_subscription(item_activity_id, activity_name, start_date, end_date,
                                     schedule_text, invoice_number="", quota_end_date=None,
                                     quota_start_date=None, count_activity_ids=None):
        """Inner helper to build one quota result from a subscription item.

        ``end_date`` is the (possibly extended) deadline used for display and the
        attendance counting window. ``quota_end_date`` is the ORIGINAL purchased
        subscription end date used to compute the paid session total, so that
        freezes / holiday extensions only push the deadline out and never inflate
        the number of sessions the member actually paid for. When omitted it
        falls back to ``end_date`` (e.g. registration-form members with no
        invoice, where the activity dates are already the original ones)."""
        if not end_date or not schedule_text:
            return
        if end_date < today_str:
            return
        if activity_id and item_activity_id != activity_id:
            return

        key = (item_activity_id, start_date, end_date)
        if key in seen_subs:
            return
        seen_subs.add(key)

        days = parse_schedule_days(schedule_text)
        days_per_week = len(days)
        if days_per_week == 0:
            return

        effective_start = start_date or today_str
        try:
            # The paid session total is computed from the ORIGINAL subscription
            # window (quota_start_date → quota_end_date) — NOT the extended /
            # shifted deadline — so that a freeze or holiday closure only moves
            # the end date and does not add extra sessions the member never paid
            # for. quota_start_date matters when the WHOLE window was shifted
            # (both start and end moved, e.g. a postponed subscription): pairing
            # the new start with the original end would collapse the total to
            # nearly zero. Both default to the display window when not supplied.
            total_end = quota_end_date or end_date
            total_start = quota_start_date or effective_start
            total_start_dt = datetime.strptime(total_start, "%Y-%m-%d")
            total_end_dt = datetime.strptime(total_end, "%Y-%m-%d")
            total_weeks = max(1, math.ceil((total_end_dt - total_start_dt).days / 7))
            total_allowed_sessions = total_weeks * days_per_week
        except Exception:
            return

        # Count attendance inside the (possibly shifted) window PLUS any
        # off-schedule records from the start onward — an off-schedule session is
        # always consumed even when it pushed the end date earlier than its date.
        # ``count_activity_ids`` lets one subscription count check-ins recorded
        # under more than one activity_id (a mid-subscription level rename leaves
        # older records carrying the original invoiced activity_id). The date
        # window keeps a previous subscription's records (same activity_id, older
        # dates) out of this count.
        count_aids = list(count_activity_ids) if count_activity_ids else [item_activity_id]
        attendance_count = await db.attendance.count_documents({
            "member_id": member_id,
            "activity_id": {"$in": count_aids},
            "date": {"$gte": effective_start},
            "$or": [
                {"date": {"$lte": end_date}},
                {"off_schedule": True},
            ],
        })

        results.append({
            "activity_id": item_activity_id,
            "activity_name": activity_name,
            "days_per_week": days_per_week,
            "schedule_days": [ENGLISH_TO_ARABIC_DAY.get(d, d) for d in days],
            "total_allowed": total_allowed_sessions,
            "used_sessions": attendance_count,
            "remaining": max(0, total_allowed_sessions - attendance_count),
            "exceeded": attendance_count >= total_allowed_sessions,
            "start_date": effective_start,
            "end_date": end_date,
            "invoice_number": invoice_number
        })
        produced_aids.add(item_activity_id)

    # ── Fetch paid/partial invoices up-front. They keep the ORIGINAL sale dates
    #    (never modified by extensions), so they are the source of truth for the
    #    paid session total. ──────────────────────────────────────────────────
    invoices = await db.invoices.find(
        {"member_id": member_id, "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)

    # Map the original (unextended) end date for each subscription so the session
    # total can be computed from what the member actually paid for, even when
    # member.activities holds a later (extended) deadline.
    orig_end_by_source = {}        # (invoice_id, activity_id) -> (original start_date, end_date)
    orig_end_by_activity = {}      # activity_id -> (original start_date, end_date) (latest seen)
    orig_end_by_src_start_sched = {}  # (invoice_id, start_date, schedule) -> end_date
    orig_end_by_src_start = {}     # (invoice_id, start_date) -> end_date OR None if ambiguous
    aids_by_src_start_sched = {}   # (invoice_id, start_date, schedule) -> {activity_ids}
    for inv in invoices:
        inv_id = inv.get("id", "")
        for item in inv.get("items", []):
            if item.get("is_product"):
                continue
            aid = item.get("activity_id", "")
            oend = item.get("end_date", "")
            if not oend:
                continue
            if aid:
                # Keep the original START too: when a subscription is postponed
                # (both start and end shifted), the paid total must come from the
                # original window LENGTH, not from (new start → original end).
                orig_end_by_source[(inv_id, aid)] = (item.get("start_date", ""), oend)
                orig_end_by_activity[aid] = (item.get("start_date", ""), oend)
            # Also index by (invoice, start_date). The member.activities entry is
            # linked to its invoice via source_id, but its activity_id often does
            # NOT match the invoiced item's activity_id (level-based assignment
            # uses a different activity record). start_date and schedule are never
            # rewritten by freezes / day-extensions, so they are reliable join
            # keys back to the original invoiced window even when activity_ids
            # diverge. schedule disambiguates multi-activity invoices that share a
            # start_date; the looser (invoice, start_date) key is flagged ambiguous
            # (None) when two items under it carry different end dates.
            istart = item.get("start_date", "")
            if not istart:
                continue
            isched = item.get("schedule", "")
            orig_end_by_src_start_sched[(inv_id, istart, isched)] = oend
            if aid:
                aids_by_src_start_sched.setdefault((inv_id, istart, isched), set()).add(aid)
            loose_key = (inv_id, istart)
            if loose_key not in orig_end_by_src_start:
                orig_end_by_src_start[loose_key] = oend
            elif orig_end_by_src_start[loose_key] != oend:
                orig_end_by_src_start[loose_key] = None  # ambiguous: do not guess

    # ── 1. member.activities FIRST — the authoritative source that reflects
    #       day-extensions / freezes. Its end_date is the extended deadline used
    #       for the attendance window, but the paid session total is computed
    #       from the original invoice window via quota_end_date. ───────────────
    member_doc = await db.members.find_one({"id": member_id}, {"_id": 0, "activities": 1})
    for act in (member_doc or {}).get("activities", []):
        item_activity_id = act.get("activity_id", "")
        if not item_activity_id:
            continue
        # A stored "expired" status can be STALE: freezes / renewals / postponed
        # subscriptions move the dates forward without always resetting the
        # status flag. The date filter inside _process_subscription (end_date <
        # today → skip) is the authoritative expiry check, so only skip statuses
        # that mark the entry as deliberately inactive (cancelled, frozen, ...).
        if act.get("status", "active") not in ("active", "expired"):
            continue
        quota_end = None
        quota_start = None
        if act.get("source") == "invoice" and act.get("source_id"):
            source_id = act.get("source_id")
            act_start = act.get("start_date", "")
            # 1) Exact (invoice, activity_id) match — carries the original start
            #    too, covering postponed subscriptions where BOTH dates moved.
            pair = orig_end_by_source.get((source_id, item_activity_id))
            if pair:
                quota_start, quota_end = pair[0] or None, pair[1]
            # 2) Same invoice but activity_id diverged (level-based assignment):
            #    join on the never-rewritten start_date + schedule so the total
            #    still comes from the original invoiced window, not the extended
            #    deadline (which would inflate the paid session count). schedule
            #    keeps multi-activity invoices that share a start_date apart.
            if not quota_end:
                quota_end = orig_end_by_src_start_sched.get(
                    (source_id, act_start, act.get("schedule", ""))
                )
            # 3) Schedule didn't match an item; use the looser (invoice, start)
            #    key only when it is unambiguous (a lone end date under it).
            if not quota_end:
                quota_end = orig_end_by_src_start.get((source_id, act_start))
        if not quota_end:
            pair = orig_end_by_activity.get(item_activity_id)
            if pair:
                quota_start, quota_end = pair[0] or None, pair[1]
        # Older check-ins for this same subscription may carry the original
        # invoiced activity_id rather than the current (level-renamed) one. Count
        # every activity_id mapped to the same invoiced item (matched on the
        # never-rewritten invoice + start + schedule) so a mid-subscription rename
        # does not under-count used sessions. The schedule key keeps other
        # activities that merely share a start_date apart.
        count_aids = {item_activity_id}
        if act.get("source") == "invoice" and act.get("source_id"):
            extra_aids = aids_by_src_start_sched.get(
                (act.get("source_id"), act.get("start_date", ""), act.get("schedule", ""))
            )
            if extra_aids:
                count_aids |= extra_aids
        await _process_subscription(
            item_activity_id,
            act.get("activity_name", ""),
            act.get("start_date", ""),
            act.get("end_date", ""),
            act.get("schedule", ""),
            "",
            quota_end_date=quota_end,
            quota_start_date=quota_start,
            count_activity_ids=count_aids,
        )

    # ── 2. Fall back to paid/partial invoices ONLY for activities that did not
    #       already produce a card above. This prevents a duplicate quota card
    #       when the same activity exists in both sources with different
    #       (stale invoice vs extended activity) end dates. ────────────────────
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("is_product"):
                continue
            item_activity_id = item.get("activity_id", "")
            if not item_activity_id:
                continue
            if item_activity_id in produced_aids:
                continue
            start = item.get("start_date", "") or inv.get("created_at", "")[:10]
            await _process_subscription(
                item_activity_id,
                item.get("activity_name", ""),
                start,
                item.get("end_date", ""),
                item.get("schedule", ""),
                inv.get("invoice_number", "")
            )

    return results


@router.get("/session-quota/{member_id}")
async def get_member_session_quota(
    member_id: str,
    activity_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    results = await check_member_session_quota(member_id, activity_id)
    return results


@router.get("/session-quota-alerts")
async def get_session_quota_alerts(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all members who have used up their session quota"""
    query = {}
    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch

    members = await db.members.find(query, {"_id": 0}).to_list(5000)
    
    alerts = []
    for member in members:
        mid = member.get("id")
        activities = member.get("activities", [])
        active_activities = [a for a in activities if a.get("status") == "active"]
        
        for act in active_activities:
            act_id = act.get("activity_id", "")
            if not act_id:
                continue
            quotas = await check_member_session_quota(mid, act_id)
            for q in quotas:
                if q["exceeded"]:
                    alerts.append({
                        "member_id": mid,
                        "member_name": member.get("name_ar", member.get("name", "")),
                        "member_code": member.get("member_code", ""),
                        "phone": member.get("phone", ""),
                        **q
                    })
    
    return alerts


@router.get("/today-summary")
async def get_today_summary(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Returns present/expected/absent members for today (Saudi tz)."""
    saudi_tz = timezone(timedelta(hours=3))
    now_saudi = datetime.now(saudi_tz)
    today_str = now_saudi.strftime("%Y-%m-%d")
    today_day = now_saudi.strftime("%A").lower()
    today_day_ar = ENGLISH_TO_ARABIC_DAY.get(today_day, today_day)

    query = {}
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch

    today_records = await db.attendance.find(
        {**query, "date": today_str}, {"_id": 0}
    ).sort("created_at", -1).to_list(5000)

    members = await db.members.find(query, {"_id": 0}).to_list(10000)
    active_member_ids = {m.get("id") for m in members if m.get("id") and m.get("status", "active") == "active"}
    member_created_at = {m.get("id"): (m.get("created_at") or "") for m in members if m.get("id")}

    member_ids_all = [m.get("id") for m in members if m.get("id")]
    invoices_by_member_pre = {}
    if member_ids_all:
        async for inv in db.invoices.find(
            {"member_id": {"$in": member_ids_all}, "status": {"$in": ["paid", "partial"]}},
            {"_id": 0, "member_id": 1, "items": 1}
        ):
            invoices_by_member_pre.setdefault(inv.get("member_id"), []).append(inv)

    def _has_active_subscription(mid):
        for inv in invoices_by_member_pre.get(mid, []):
            for item in inv.get("items", []):
                start_date = item.get("start_date", "")
                end_date = item.get("end_date", "")
                if not end_date or end_date < today_str:
                    continue
                if start_date and start_date > today_str:
                    continue
                return True
        return False

    members_with_active_sub = {mid for mid in active_member_ids if _has_active_subscription(mid)}
    members_by_id = {m.get("id"): m for m in members if m.get("id")}

    def _hour_12(text):
        if not text:
            return None
        import re as _re
        s = str(text)
        s = s.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
        mt = _re.search(r"(\d{1,2})", s)
        if not mt:
            return None
        h = int(mt.group(1))
        if not (0 <= h <= 23):
            return None
        if h == 0:
            return 12
        if h <= 12:
            return h
        return h - 12

    levels_docs = await db.levels.find({}, {"_id": 0, "id": 1, "time_slot": 1, "activity_name": 1, "name": 1, "days": 1}).to_list(2000)
    level_hour_by_id = {}
    level_days_by_id = {}
    for lv in levels_docs:
        lvid = lv.get("id")
        if not lvid:
            continue
        h = _hour_12(lv.get("time_slot")) or _hour_12(lv.get("activity_name")) or _hour_12(lv.get("name"))
        if h is not None:
            level_hour_by_id[lvid] = h
        d = lv.get("days") or []
        if d:
            level_days_by_id[lvid] = [str(x).lower() for x in d]

    member_activity_schedule = {}
    member_activity_levelid = {}
    member_activity_daytimes = {}
    for m in members:
        mid_m = m.get("id")
        if not mid_m:
            continue
        for act in (m.get("activities") or []):
            aid = act.get("activity_id", "")
            sch = act.get("schedule", "")
            lvid = act.get("level_id", "")
            dts = act.get("day_times") or {}
            if aid and sch:
                member_activity_schedule[(mid_m, aid)] = sch
            if aid and lvid:
                member_activity_levelid[(mid_m, aid)] = lvid
            if aid and dts:
                member_activity_daytimes[(mid_m, aid)] = dts

    def _activity_hour(mid_, aid_, sched_=""):
        # The member's own booked موعد is authoritative for the hour shown —
        # a level's time_slot describes the level's slot, and a member can be
        # placed in a level whose hour differs from what they actually booked
        # (e.g. موعد 8:00 م inside a "الساعه 7" level). Only fall back to the
        # level's hour when the member's schedule has no parseable time.
        for name, tval in (member_activity_daytimes.get((mid_, aid_)) or {}).items():
            if today_day in parse_schedule_days(name or ""):
                h = _hour_12(tval or "")
                if h is not None:
                    return h
        h = _hour_12(sched_)
        if h is not None:
            return h
        lvid = member_activity_levelid.get((mid_, aid_))
        if lvid and lvid in level_hour_by_id:
            return level_hour_by_id[lvid]
        return None

    present_by_member = {}
    for r in today_records:
        mid = r.get("member_id")
        if not mid or mid not in active_member_ids:
            continue
        if mid not in present_by_member:
            m_doc = members_by_id.get(mid, {})
            present_by_member[mid] = {
                "member_id": mid,
                "member_name": r.get("member_name", ""),
                "guardian_name_ar": m_doc.get("guardian_name_ar", "") or m_doc.get("guardian_name", ""),
                "guardian_name": m_doc.get("guardian_name", ""),
                "member_code": r.get("member_code", ""),
                "member_photo": r.get("member_photo", ""),
                "phone": r.get("phone", ""),
                "branch_id": r.get("branch_id", ""),
                "first_check_in": r.get("check_in_time", ""),
                "recorded_by": r.get("recorded_by", ""),
                "activities": [],
                "records": [],
            }
        aid_p = r.get("activity_id", "")
        sched_p = member_activity_schedule.get((mid, aid_p), "")
        present_by_member[mid]["activities"].append({
            "activity_id": aid_p,
            "activity_name": r.get("activity_name", ""),
            "check_in_time": r.get("check_in_time", ""),
            "schedule": sched_p,
            "hour": _activity_hour(mid, aid_p, sched_p),
        })
        present_by_member[mid]["records"].append(r)

    member_ids = member_ids_all
    invoices_by_member = invoices_by_member_pre

    active_freezes = set()
    if member_ids:
        freezes_cursor = db.member_freezes.find(
            {"member_id": {"$in": member_ids}, "status": "active",
             "start_date": {"$lte": today_str}, "end_date": {"$gte": today_str}},
            {"_id": 0, "member_id": 1}
        )
        async for f in freezes_cursor:
            active_freezes.add(f.get("member_id"))

    expected = []
    for m in members:
        mid = m.get("id")
        if mid not in active_member_ids:
            continue
        if mid in active_freezes:
            continue

        active_invoice_activity_ids = set()
        has_any_active_invoice = False
        for inv in invoices_by_member.get(mid, []):
            for item in inv.get("items", []):
                start_date = item.get("start_date", "")
                end_date = item.get("end_date", "")
                if not end_date or end_date < today_str:
                    continue
                if start_date and start_date > today_str:
                    continue
                has_any_active_invoice = True
                aid = item.get("activity_id", "")
                if aid:
                    active_invoice_activity_ids.add(aid)

        if not has_any_active_invoice:
            continue

        scheduled_activities = []

        for act in (m.get("activities") or []):
            if act.get("status", "active") != "active":
                continue
            aid = act.get("activity_id", "")
            if active_invoice_activity_ids and aid and aid not in active_invoice_activity_ids:
                continue
            start_date = act.get("start_date", "")
            end_date = act.get("end_date", "")
            if not end_date or end_date < today_str:
                continue
            if start_date and start_date > today_str:
                continue
            days = parse_schedule_days(act.get("schedule", ""))
            lvid_act = act.get("level_id", "")
            level_days = level_days_by_id.get(lvid_act, [])
            # The member's own recorded training days (from their activity
            # schedule) are authoritative. A level's days[] is the level's full
            # weekly timetable — frequently every day of the week, because the
            # same level hosts different sub-groups on different days — so it
            # must NOT widen a member's expected days beyond their personal
            # schedule (which previously made e.g. a Sun/Wed swimmer show up as
            # "expected" every single day). Only fall back to the level's days
            # when the member's schedule text has no parseable day names at all.
            if days:
                day_match = today_day in days
            else:
                day_match = today_day in level_days
            if day_match:
                scheduled_activities.append({
                    "activity_id": aid,
                    "activity_name": act.get("activity_name", ""),
                    "schedule": act.get("schedule", ""),
                    "hour": _activity_hour(mid, aid, act.get("schedule", "")),
                })

        for inv in invoices_by_member.get(mid, []):
            for item in inv.get("items", []):
                start_date = item.get("start_date", "")
                end_date = item.get("end_date", "")
                if not end_date or end_date < today_str:
                    continue
                if start_date and start_date > today_str:
                    continue
                days = parse_schedule_days(item.get("schedule", ""))
                if today_day in days:
                    iaid = item.get("activity_id", "")
                    isch = item.get("schedule", "")
                    scheduled_activities.append({
                        "activity_id": iaid,
                        "activity_name": item.get("activity_name", ""),
                        "schedule": isch,
                        "hour": _activity_hour(mid, iaid, isch),
                    })

        seen_act = set()
        unique_acts = []
        for a in scheduled_activities:
            key = a.get("activity_id") or a.get("activity_name")
            if key in seen_act:
                continue
            seen_act.add(key)
            unique_acts.append(a)

        if unique_acts:
            expected.append({
                "member_id": mid,
                "member_name": m.get("name_ar", m.get("name", "")),
                "guardian_name_ar": m.get("guardian_name_ar", "") or m.get("guardian_name", ""),
                "guardian_name": m.get("guardian_name", ""),
                "member_code": m.get("member_code", ""),
                "member_photo": m.get("photo", ""),
                "phone": m.get("phone", ""),
                "branch_id": m.get("branch_id", ""),
                "activities": unique_acts,
                "is_present": mid in present_by_member,
                "created_at": m.get("created_at", ""),
            })

    expected.sort(key=lambda e: str(e.get("created_at") or ""), reverse=True)
    absent = [e for e in expected if not e["is_present"]]

    present_list = sorted(
        present_by_member.values(),
        key=lambda p: str(member_created_at.get(p.get("member_id"), "") or ""),
        reverse=True,
    )

    by_branch = {}
    by_activity = {}
    for r in today_records:
        if r.get("member_id") not in active_member_ids:
            continue
        b = r.get("branch_id", "")
        by_branch[b] = by_branch.get(b, 0) + 1
        a = r.get("activity_name", "")
        by_activity[a] = by_activity.get(a, 0) + 1

    return {
        "date": today_str,
        "day_name": today_day,
        "day_name_ar": today_day_ar,
        "present_count": len(present_by_member),
        "records_count": len(today_records),
        "expected_count": len(expected),
        "absent_count": len(absent),
        "present": present_list,
        "present_records": [r for r in today_records if r.get("member_id") in active_member_ids],
        "expected": expected,
        "absent": absent,
        "by_branch": by_branch,
        "by_activity": by_activity,
    }


@router.get("/levels-board")
async def get_levels_board(
    branch_filter: Optional[str] = None,
    date: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Live board for today: members who checked in are placed into their level
    cell (hour + level + coach). Only members present today appear inside cells.

    Shape:
        {
          "date", "day_name_ar", "present_count",
          "hours_order": ["5","6",...],
          "hours": {"5": [<cell>, ...], ...},   # cells with a parseable hour
          "no_hour": [<cell>, ...],             # levels without an hour
          "unassigned": {"members": [...], "count": n}  # present, no level link
        }
    A <cell> is one level: {level_id, title, hour, hour_label, coach_name,
    branch_id, members: [...], count}.
    """
    saudi_tz = timezone(timedelta(hours=3))
    now_saudi = datetime.now(saudi_tz)
    # Default to today (Saudi tz); allow viewing any specific day via ?date=YYYY-MM-DD.
    today_str = now_saudi.strftime("%Y-%m-%d")
    today_day = now_saudi.strftime("%A").lower()
    if date:
        import re as _re_date
        if _re_date.match(r"^\d{4}-\d{2}-\d{2}$", date):
            try:
                day_dt = datetime.strptime(date, "%Y-%m-%d")
                today_str = date
                today_day = day_dt.strftime("%A").lower()
            except ValueError:
                pass
    today_day_ar = ENGLISH_TO_ARABIC_DAY.get(today_day, today_day)

    query = {}
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch

    today_records = await db.attendance.find(
        {**query, "date": today_str}, {"_id": 0}
    ).sort("created_at", 1).to_list(5000)

    members = await db.members.find(query, {"_id": 0}).to_list(10000)
    active_member_ids = {
        m.get("id") for m in members
        if m.get("id") and m.get("status", "active") == "active"
    }
    members_by_id = {m.get("id"): m for m in members if m.get("id")}

    def _hour_12(text):
        if not text:
            return None
        import re as _re
        s = str(text).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
        mt = _re.search(r"(\d{1,2})", s)
        if not mt:
            return None
        h = int(mt.group(1))
        if not (0 <= h <= 23):
            return None
        if h == 0:
            return 12
        return h if h <= 12 else h - 12

    # Scope levels to the effective branch (levels with no branch are shared),
    # mirroring the schedule-snapshot endpoint, so branch users never see other
    # branches' level metadata even if a member->level link is inconsistent.
    levels_query = {}
    if effective_branch:
        levels_query["$or"] = [
            {"branch_id": effective_branch},
            {"branch_id": None},
            {"branch_id": {"$exists": False}},
        ]
    levels_docs = await db.levels.find(
        levels_query, {"_id": 0, "id": 1, "time_slot": 1, "activity_name": 1,
                       "custom_name": 1, "name": 1, "level_number": 1,
                       "coach_id": 1, "branch_id": 1}
    ).to_list(2000)
    levels_by_id = {lv.get("id"): lv for lv in levels_docs if lv.get("id")}

    coaches = await db.coaches.find(
        {}, {"_id": 0, "id": 1, "name_ar": 1, "name": 1}
    ).to_list(500)
    coach_name_by_id = {
        c.get("id"): (c.get("name_ar") or c.get("name") or "")
        for c in coaches if c.get("id")
    }

    member_activity_levelid = {}
    for m in members:
        mid_m = m.get("id")
        if not mid_m:
            continue
        for act in (m.get("activities") or []):
            aid = act.get("activity_id", "")
            lvid = act.get("level_id", "")
            if aid and lvid:
                member_activity_levelid[(mid_m, aid)] = lvid

    def _level_title(lv):
        custom = (lv.get("custom_name") or "").strip()
        if custom:
            return custom
        act = (lv.get("activity_name") or lv.get("name") or "").strip()
        num = lv.get("level_number")
        if act and num:
            return f"{act} - المستوى {num}"
        if act:
            return act
        if num:
            return f"المستوى {num}"
        return "مستوى"

    cells = {}
    unassigned_members = []
    unassigned_seen = set()

    for r in today_records:
        mid = r.get("member_id")
        if not mid or mid not in active_member_ids:
            continue
        aid = r.get("activity_id", "")
        lvid = member_activity_levelid.get((mid, aid))
        m_doc = members_by_id.get(mid, {})
        member_entry = {
            "member_id": mid,
            "member_name": r.get("member_name", "") or m_doc.get("name_ar", "") or m_doc.get("name", ""),
            "member_code": r.get("member_code", "") or m_doc.get("member_code", ""),
            "member_photo": r.get("member_photo", "") or m_doc.get("photo", ""),
            "check_in_time": r.get("check_in_time", ""),
            "activity_name": r.get("activity_name", ""),
            "off_schedule": bool(r.get("off_schedule")),
        }
        if lvid and lvid in levels_by_id:
            cell = cells.get(lvid)
            if cell is None:
                lv = levels_by_id[lvid]
                hour = (_hour_12(lv.get("time_slot"))
                        or _hour_12(lv.get("activity_name"))
                        or _hour_12(lv.get("name")))
                cell = cells[lvid] = {
                    "level_id": lvid,
                    "title": _level_title(lv),
                    "hour": hour,
                    "hour_label": (f"الساعة {hour}" if hour else ""),
                    "coach_name": coach_name_by_id.get(lv.get("coach_id"), ""),
                    "branch_id": lv.get("branch_id"),
                    "members": [],
                    "_seen": set(),
                }
            key = (mid, aid)
            if key not in cell["_seen"]:
                cell["_seen"].add(key)
                cell["members"].append(member_entry)
        else:
            if mid not in unassigned_seen:
                unassigned_seen.add(mid)
                unassigned_members.append(member_entry)

    cell_list = []
    for c in cells.values():
        c.pop("_seen", None)
        c["members"].sort(key=lambda x: x.get("check_in_time") or "")
        c["count"] = len(c["members"])
        cell_list.append(c)

    hours = {}
    no_hour = []
    for c in cell_list:
        h = c.get("hour")
        if h:
            hours.setdefault(str(h), []).append(c)
        else:
            no_hour.append(c)
    for hkey in hours:
        hours[hkey].sort(key=lambda x: (x.get("title") or ""))
    no_hour.sort(key=lambda x: (x.get("title") or ""))
    hours_order = sorted(hours.keys(), key=lambda x: int(x))

    total_present = len({
        r.get("member_id") for r in today_records
        if r.get("member_id") in active_member_ids
    })

    return {
        "date": today_str,
        "day_name": today_day,
        "day_name_ar": today_day_ar,
        "present_count": total_present,
        "hours_order": hours_order,
        "hours": hours,
        "no_hour": no_hour,
        "unassigned": {
            "members": unassigned_members,
            "count": len(unassigned_members),
        },
    }


@router.post("/qr-checkin")
async def qr_checkin(
    member_code: str,
    activity_id: Optional[str] = None,
    force: bool = False,
    method: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Quick check-in via QR code scan with schedule validation.

    ``method="bulk"`` tags records created by the group "تحضير جماعي" action so
    the member page can flag how the attendance was taken."""
    user_name = current_user.get("name", current_user.get("username", ""))

    from utils.text import normalize_digits, dearabize_keyboard
    # Hardware scanners on an Arabic keyboard layout emit Arabic-Indic digits
    # that never match ASCII member codes; normalize before lookup.
    member_code = normalize_digits(member_code).strip()

    member = await db.members.find_one(
        {"$or": [{"member_code": member_code}, {"phone": member_code}]},
        {"_id": 0}
    )
    if not member and member_code.isdigit():
        import re as _re
        suffix_filter = {"member_code": {"$regex": f"-{_re.escape(member_code)}$"}}
        user_branch = current_user.get("branch_id")
        if user_branch:
            member = await db.members.find_one(
                {"$and": [suffix_filter, {"branch_id": user_branch}]},
                {"_id": 0}
            )
        if not member:
            matches = await db.members.find(suffix_filter, {"_id": 0}).to_list(5)
            if len(matches) == 1:
                member = matches[0]
            elif len(matches) > 1:
                raise HTTPException(
                    status_code=409,
                    detail="رقم العضوية مكرر بين فروع مختلفة — استخدم الرقم الكامل"
                )

    if not member:
        # Arabic keyboard layout mangles the whole scanned code; recover the
        # Latin form and retry an exact member_code/phone match.
        alt = dearabize_keyboard(member_code)
        if alt and alt != member_code:
            import re as _re_kb2
            member = await db.members.find_one(
                {"$or": [
                    {"member_code": {"$regex": f"^{_re_kb2.escape(alt)}$", "$options": "i"}},
                    {"phone": alt},
                ]},
                {"_id": 0}
            )

    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # Use member's branch first, fall back to current user's branch
    branch_id = member.get("branch_id") or current_user.get("branch_id")
    
    saudi_tz_q = timezone(timedelta(hours=3))
    today = datetime.now(saudi_tz_q).strftime("%Y-%m-%d")
    check_in_time = datetime.now(saudi_tz_q).strftime("%H:%M")
    
    # Check if member has active freeze
    active_freeze = await db.member_freezes.find_one({
        "member_id": member["id"],
        "status": "active",
        "start_date": {"$lte": today},
        "end_date": {"$gte": today}
    })
    if active_freeze:
        return {
            "status": "frozen",
            "message": f"عضوية مجمّدة حتى {active_freeze['end_date']}",
            "member": {
                "name": member.get("name_ar", member.get("name", "")),
                "member_code": member.get("member_code", ""),
                "photo": member.get("photo", ""),
                "phone": member.get("phone", "")
            },
            "freeze_end_date": active_freeze["end_date"]
        }
    
    target_activity_id = activity_id
    activity_name = ""
    
    if not target_activity_id:
        activities = member.get("activities", [])
        active_activities = [a for a in activities if a.get("status") == "active"]
        if active_activities:
            target_activity_id = active_activities[0].get("activity_id")
            activity_name = active_activities[0].get("activity_name", "")
    
    if not target_activity_id:
        raise HTTPException(status_code=400, detail="No active activity found for member")
    
    if not activity_name:
        activity = await db.activities.find_one({"id": target_activity_id}, {"_id": 0})
        activity_name = activity.get("name_ar", "") if activity else ""
    
    existing = await db.attendance.find_one({
        "member_id": member["id"],
        "activity_id": target_activity_id,
        "date": today
    })
    if existing:
        return {
            "message": "Already checked in today",
            "status": "already_checked_in",
            "member": {
                "name": member.get("name_ar", member.get("name", "")),
                "member_code": member.get("member_code", ""),
                "photo": member.get("photo", ""),
                "activity": activity_name
            }
        }
    
    schedule_days = await get_member_schedule_days(member["id"], target_activity_id)
    
    saudi_tz = timezone(timedelta(hours=3))
    today_day_name = datetime.now(saudi_tz).strftime("%A").lower()
    
    is_scheduled_day = True
    schedule_days_arabic = []
    
    if schedule_days:
        is_scheduled_day = today_day_name in schedule_days
        schedule_days_arabic = [ENGLISH_TO_ARABIC_DAY.get(d, d) for d in schedule_days]
    
    # Attendance on a non-scheduled day requires explicit confirmation (force=True).
    # Without it, a single accidental tap on the wrong activity would silently record
    # an off-schedule session AND pull the subscription end date earlier. Instead we
    # return a `wrong_day` prompt and save nothing until the operator confirms via the
    # "تسجيل حضور رغم ذلك" button (which re-calls this endpoint with force=True).
    if schedule_days and not is_scheduled_day and not force:
        return {
            "status": "wrong_day",
            "message": "⚠️ ليس موعدك اليوم — اضغط (تسجيل حضور رغم ذلك) للتأكيد",
            "schedule_days": schedule_days_arabic,
            "today": ENGLISH_TO_ARABIC_DAY.get(today_day_name, today_day_name),
            "member": {
                "name": member.get("name_ar", member.get("name", "")),
                "member_code": member.get("member_code", ""),
                "photo": member.get("photo", ""),
                "activity": activity_name
            }
        }

    # When today is not a scheduled day (and force=True), the record is still saved
    # with today's date and tagged in `notes` so it's visible in reports as "خارج الموعد".

    # Hard cap on total allowed sessions for this subscription
    try:
        await enforce_session_cap(member["id"], target_activity_id, today)
    except HTTPException as cap_err:
        return {
            "message": cap_err.detail,
            "status": "quota_exceeded",
            "schedule_days": schedule_days_arabic,
            "today": ENGLISH_TO_ARABIC_DAY.get(today_day_name, today_day_name),
            "member": {
                "name": member.get("name_ar", member.get("name", "")),
                "member_code": member.get("member_code", ""),
                "photo": member.get("photo", ""),
                "activity": activity_name
            }
        }

    record_id = str(uuid.uuid4())
    record = {
        "id": record_id,
        "member_id": member["id"],
        "member_name": member.get("name_ar", member.get("name", "")),
        "member_code": member.get("member_code", ""),
        "member_photo": member.get("photo", ""),
        "phone": member.get("phone", ""),
        "activity_id": target_activity_id,
        "activity_name": activity_name,
        "date": today,
        "status": "present",
        "check_in_time": check_in_time,
        "notes": "QR Check-in (خارج الموعد)" if (schedule_days and not is_scheduled_day) else "QR Check-in",
        "branch_id": branch_id,
        "recorded_by": user_name,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    # Attending outside the schedule consumes a session out of order: pull the
    # subscription end date earlier by one scheduled occurrence.
    if schedule_days and not is_scheduled_day:
        record["off_schedule"] = True
        shift = await apply_off_schedule_end_shift(
            member["id"], target_activity_id, today, schedule_days
        )
        if shift:
            record["end_shift_from"], record["end_shift_to"] = shift

    # Tag how the check-in was taken so the member page can show a distinctive
    # badge on that record. Whitelist values to keep the field consistent.
    if method == "bulk":
        record["check_in_method"] = "bulk"

    await db.attendance.insert_one(record)
    
    if loyalty_award_points:
        try:
            await award_attendance_points(member["id"])
        except Exception as e:
            print(f"Error awarding loyalty points: {e}")
    
    # Send push notification to member
    try:
        await send_attendance_push(member["id"], record["member_name"], activity_name, check_in_time)
    except Exception as e:
        print(f"QR Attendance push error: {e}")
    
    session_quota_warning = None
    try:
        quotas = await check_member_session_quota(member["id"], target_activity_id)
        chosen = None
        for q in quotas:
            if q["exceeded"]:
                chosen = {
                    "message": f"⚠️ استنفد حصصه! ({q['used_sessions']}/{q['total_allowed']})",
                    "used": q["used_sessions"],
                    "total": q["total_allowed"],
                    "remaining": q.get("remaining", 0),
                    "activity": q["activity_name"]
                }
                break
            elif q["remaining"] <= 2:
                chosen = {
                    "message": f"⚠️ متبقي {q['remaining']} حصص فقط ({q['used_sessions']}/{q['total_allowed']})",
                    "used": q["used_sessions"],
                    "total": q["total_allowed"],
                    "remaining": q["remaining"],
                    "activity": q["activity_name"]
                }
                break
        if not chosen:
            for q in quotas:
                if q.get("activity_id") == target_activity_id:
                    chosen = {
                        "message": "",
                        "used": q["used_sessions"],
                        "total": q["total_allowed"],
                        "remaining": q.get("remaining", 0),
                        "activity": q["activity_name"]
                    }
                    break
            if not chosen and quotas:
                q = quotas[0]
                chosen = {
                    "message": "",
                    "used": q["used_sessions"],
                    "total": q["total_allowed"],
                    "remaining": q.get("remaining", 0),
                    "activity": q["activity_name"]
                }
        session_quota_warning = chosen
    except Exception as e:
        print(f"Error checking session quota: {e}")
    
    response = {
        "message": "Check-in successful",
        "status": "success",
        "member": {
            "name": member.get("name_ar", member.get("name", "")),
            "member_code": member.get("member_code", ""),
            "photo": member.get("photo", ""),
            "activity": activity_name
        }
    }
    if session_quota_warning:
        response["session_quota_warning"] = session_quota_warning
    # Informational only: flag check-ins recorded on a non-scheduled day
    if schedule_days and not is_scheduled_day:
        response["wrong_day_warning"] = {
            "message": f"⚠️ ليس موعدك اليوم — تم تسجيل الحضور بتاريخ اليوم",
            "schedule_days": schedule_days_arabic,
            "today": ENGLISH_TO_ARABIC_DAY.get(today_day_name, today_day_name),
        }

    return response

@router.patch("/{record_id}/date")
async def update_attendance_date(
    record_id: str,
    payload: dict,
    current_user: dict = Depends(get_current_user)
):
    """Move an attendance record to a different date (branch-scoped). Does not change the used-sessions count."""
    new_date = (payload or {}).get("date")
    if not new_date or not isinstance(new_date, str):
        raise HTTPException(status_code=400, detail="Missing 'date' (YYYY-MM-DD)")
    try:
        datetime.strptime(new_date, "%Y-%m-%d")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    record = await db.attendance.find_one({"id": record_id})
    if not record:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    if not current_user.get("is_admin"):
        user_branch = current_user.get("branch_id")
        record_branch = record.get("branch_id")
        if not record_branch and record.get("member_id"):
            member = await db.members.find_one({"id": record["member_id"]}, {"branch_id": 1})
            record_branch = (member or {}).get("branch_id")
        if user_branch and record_branch and user_branch != record_branch:
            raise HTTPException(status_code=403, detail="Not allowed to modify attendance from another branch")

    if new_date == record.get("date"):
        return {"message": "No change", "id": record_id, "date": new_date}

    # Block move if another record already exists for same member+activity on the new date
    clash = await db.attendance.find_one({
        "member_id": record.get("member_id"),
        "activity_id": record.get("activity_id"),
        "date": new_date,
        "id": {"$ne": record_id},
    })
    if clash:
        raise HTTPException(status_code=400, detail=f"يوجد تسجيل حضور بالفعل بتاريخ {new_date} لهذا النشاط")

    await db.attendance.update_one(
        {"id": record_id},
        {"$set": {"date": new_date, "updated_at": datetime.utcnow()}}
    )
    return {"message": "Attendance date updated", "id": record_id, "date": new_date}


@router.delete("/{record_id}")
async def delete_attendance(
    record_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete an attendance record (branch-scoped for non-admins)"""
    record = await db.attendance.find_one({"id": record_id})
    if not record:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    if not current_user.get("is_admin"):
        user_branch = current_user.get("branch_id")
        record_branch = record.get("branch_id")
        if not record_branch and record.get("member_id"):
            member = await db.members.find_one({"id": record["member_id"]}, {"branch_id": 1})
            record_branch = (member or {}).get("branch_id")
        if user_branch and record_branch and user_branch != record_branch:
            raise HTTPException(status_code=403, detail="Not allowed to modify attendance from another branch")

    # Reverse the off-schedule end-date shift this record applied, if any. Each
    # off-schedule attendance pulled the end date back by one scheduled occurrence,
    # so removing the record pushes the end date forward by one occurrence. Stepping
    # one scheduled occurrence forward is order-independent across multiple records.
    if record.get("off_schedule") and record.get("end_shift_to"):
        member_doc = await db.members.find_one(
            {"id": record.get("member_id")}, {"_id": 0, "activities": 1}
        )
        if member_doc:
            activities = member_doc.get("activities", []) or []
            target = None
            for a in activities:
                if a.get("activity_id") == record.get("activity_id") and a.get("end_date"):
                    target = a
                    break
            if target:
                sched = await get_member_schedule_days(
                    record.get("member_id"), record.get("activity_id")
                )
                restored = _next_scheduled_date(target["end_date"], sched)
                if not restored and target["end_date"] == record.get("end_shift_to"):
                    # Fallback when the schedule is no longer resolvable: undo this
                    # record's own recorded shift (correct for the single-record case).
                    restored = record.get("end_shift_from")
                if restored and restored > target["end_date"]:
                    target["end_date"] = restored
                    await db.members.update_one(
                        {"id": record.get("member_id")}, {"$set": {"activities": activities}}
                    )

    result = await db.attendance.delete_one({"id": record_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Attendance record not found")
    return {"message": "Attendance record deleted"}

@router.get("/member/{member_id}/report")
async def get_member_attendance_report(
    member_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get attendance report for a specific member"""
    query = {"member_id": member_id}
    
    if date_from:
        query["date"] = {"$gte": date_from}
    if date_to:
        if "date" in query:
            query["date"]["$lte"] = date_to
        else:
            query["date"] = {"$lte": date_to}
    
    records = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    
    # Calculate summary
    total_days = len(records)
    activities_count = {}
    present_count = 0
    absent_count = 0
    for record in records:
        act_name = record.get("activity_name", "Unknown")
        activities_count[act_name] = activities_count.get(act_name, 0) + 1
        status = record.get("status") or "present"
        if status == "absent":
            absent_count += 1
        else:
            # Any check-in record (status "present" or unset) counts as attended.
            present_count += 1
    attendance_rate = round((present_count / total_days) * 100) if total_days else 0

    # `summary` is what the frontend reads for the top cards; keep the legacy
    # top-level fields too for backward compatibility.
    summary = {
        "total_records": total_days,
        "present_count": present_count,
        "absent_count": absent_count,
        "attendance_rate": attendance_rate,
    }

    return {
        "member_id": member_id,
        "total_attendance": total_days,
        "by_activity": activities_count,
        "summary": summary,
        "records": records
    }

@router.get("/activity/{activity_id}/report")
async def get_activity_attendance_report(
    activity_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get attendance report for a specific activity"""
    query = {"activity_id": activity_id}
    
    if date_from:
        query["date"] = {"$gte": date_from}
    if date_to:
        if "date" in query:
            query["date"]["$lte"] = date_to
        else:
            query["date"] = {"$lte": date_to}
    
    records = await db.attendance.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    
    # Group by date
    by_date = {}
    for record in records:
        date = record.get("date", "")
        if date not in by_date:
            by_date[date] = []
        by_date[date].append(record)
    
    return {
        "activity_id": activity_id,
        "total_attendance": len(records),
        "unique_members": len(set(r.get("member_id") for r in records)),
        "by_date": by_date,
        "records": records
    }
