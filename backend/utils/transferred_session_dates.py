"""Schedule received session credits on the member's training weekdays."""
from datetime import datetime, timedelta

WEEKDAY = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}


def next_training_dates(end_date: str, schedule: str, count: int) -> list[str]:
    from routes.attendance import parse_schedule_days
    days = {WEEKDAY[day] for day in parse_schedule_days(schedule) if day in WEEKDAY}
    if not days or not end_date or count <= 0:
        return []
    cursor = datetime.strptime(str(end_date)[:10], "%Y-%m-%d")
    dates = []
    for _ in range(3660):
        cursor += timedelta(days=1)
        if cursor.weekday() in days:
            dates.append(cursor.strftime("%Y-%m-%d"))
            if len(dates) == count:
                return dates
    raise ValueError("Could not schedule transferred sessions")


def transfer_dates(activity: dict) -> list[str]:
    """Include older transfers that credited sessions but stored no dates."""
    stored = activity.get("session_transfer_dates")
    if isinstance(stored, list):
        return sorted({str(value)[:10] for value in stored if value})
    count = max(0, int(activity.get("session_transfer_delta") or 0))
    return next_training_dates(activity.get("end_date"), activity.get("schedule", ""), count)


def effective_transfer_end(activity: dict) -> str:
    original = str(activity.get("end_date") or "")[:10]
    dates = transfer_dates(activity)
    return max(original, dates[-1]) if dates else original
