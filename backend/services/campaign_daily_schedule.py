"""Place campaign recipients into Riyadh-local daily sending windows."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException


RIYADH = ZoneInfo("Asia/Riyadh")
MAX_SCHEDULED_RECIPIENTS = 1000
MIN_INTERVAL_MINUTES = 3


def schedule_recipients(recipients, *, daily_recipients, start_date, send_time,
                        attachment_count=1, provider_limit=None, now=None):
    """Set durable not-before times without changing recipient order."""
    if not isinstance(daily_recipients, int) or isinstance(daily_recipients, bool) or daily_recipients < 1:
        raise HTTPException(400, detail="Daily recipient count must be positive")
    if not recipients or len(recipients) > MAX_SCHEDULED_RECIPIENTS:
        raise HTTPException(400, detail="Supply 1-1000 scheduled recipients")
    if attachment_count < 1:
        raise HTTPException(400, detail="Invalid attachment count")
    try:
        first_day = date.fromisoformat(start_date)
        hour, minute = map(int, send_time.split(":"))
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError
    except (AttributeError, TypeError, ValueError):
        raise HTTPException(400, detail="Use YYYY-MM-DD date and HH:MM time")
    if hour < 10 or hour >= 20:
        raise HTTPException(400, detail="Daily sending must start between 10:00 and 19:59 Riyadh time")
    window_minutes = 20 * 60 - (hour * 60 + minute)
    max_in_window = (window_minutes - 1) // (MIN_INTERVAL_MINUTES * attachment_count) + 1
    if daily_recipients > max_in_window:
        raise HTTPException(400, detail=f"At most {max_in_window} recipients fit in the daily sending window")
    if provider_limit is not None and daily_recipients * attachment_count > provider_limit:
        raise HTTPException(400, detail="Daily plan exceeds the branch WhatsApp message limit")

    now = now or datetime.now(timezone.utc)
    first_send = datetime.combine(first_day, time(hour, minute), RIYADH)
    if first_send.astimezone(timezone.utc) <= now:
        raise HTTPException(400, detail="Campaign start must be in the future")

    for index, recipient in enumerate(recipients):
        day_index, position = divmod(index, daily_recipients)
        due = datetime.combine(first_day + timedelta(days=day_index),
                               time(hour, minute), RIYADH)
        due += timedelta(minutes=MIN_INTERVAL_MINUTES * attachment_count * position)
        recipient["next_attempt_at"] = due.astimezone(timezone.utc)
        metadata = dict(recipient.get("source_metadata") or {})
        metadata["daily_schedule"] = {"send_time": send_time, "day": day_index + 1}
        recipient["source_metadata"] = metadata
    return recipients
