"""Read-only closure rules for training reminders (not compensation eligibility)."""
from zoneinfo import ZoneInfo

RIYADH_TZ = ZoneInfo("Asia/Riyadh")


async def closures_for_date(db, day):
    """Inclusive calendar dates; applied only tracks compensation, not closure."""
    return await db["closures"].find({
        "start_date": {"$lte": day},
        "end_date": {"$gte": day},
    }, {"_id": 0}).to_list(length=None)


def training_day_closed(closures, branch_id, activity_id):
    """Attendance's full-day/activity rules, restricted to the closure's branch.

    Missing/empty/'all' branch means all branches, as in day_extensions.
    Partial and specific-time stops are not full-day cancellations.
    """
    for closure in closures:
        if closure.get("branch_id") not in (None, "", "all", branch_id):
            continue
        if closure.get("stop_type", "full_day") != "full_day":
            continue
        if (closure.get("scope", "all") == "all"
                or (activity_id and (
                    activity_id in (closure.get("activity_ids") or [])
                    or activity_id == closure.get("activity_id")))):
            return True
    return False