"""Daily campaign plans must remain durable and respect branch send limits."""
from datetime import datetime, timezone
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from services.campaign_daily_schedule import schedule_recipients


NOW = datetime(2026, 10, 10, 6, 0, tzinfo=timezone.utc)


def test_400_recipients_are_spread_over_14_riyadh_days():
    recipients = [{"phone": str(index), "message": "Hello"} for index in range(400)]
    schedule_recipients(recipients, daily_recipients=30, start_date="2026-10-11",
                        send_time="10:00", provider_limit=30, now=NOW)
    assert recipients[0]["next_attempt_at"] == datetime(2026, 10, 11, 7, tzinfo=timezone.utc)
    assert recipients[29]["next_attempt_at"] == datetime(2026, 10, 11, 8, 27, tzinfo=timezone.utc)
    assert recipients[30]["next_attempt_at"] == datetime(2026, 10, 12, 7, tzinfo=timezone.utc)
    assert recipients[-1]["source_metadata"]["daily_schedule"]["day"] == 14
    assert recipients[-1]["next_attempt_at"] == datetime(2026, 10, 24, 7, 27, tzinfo=timezone.utc)


@pytest.mark.parametrize("kwargs", [
    {"daily_recipients": 31, "provider_limit": 30},
    {"daily_recipients": 16, "attachment_count": 2, "provider_limit": 30},
    {"daily_recipients": 30, "send_time": "19:30"},
    {"daily_recipients": 30, "start_date": "2026-10-09"},
])
def test_rejects_plans_that_exceed_quota_window_or_are_past(kwargs):
    options = dict(daily_recipients=30, start_date="2026-10-11", send_time="10:00",
                   provider_limit=30, now=NOW)
    options.update(kwargs)
    with pytest.raises(HTTPException) as error:
        schedule_recipients([{"phone": "1"}] * 40, **options)
    assert error.value.status_code == 400
