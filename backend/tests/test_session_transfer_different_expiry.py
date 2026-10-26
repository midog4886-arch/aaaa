import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from routes import attendance
from utils import session_transfers
from utils.transferred_session_dates import next_training_dates


def test_transfer_adds_sessions_to_active_recipient_with_different_expiry(monkeypatch):
    today = datetime.now(timezone(timedelta(hours=3))).date()
    start = (today - timedelta(days=7)).isoformat()
    sender_end = (today + timedelta(days=21)).isoformat()
    recipient_end = (today + timedelta(days=35)).isoformat()
    sender = {"id": "sender", "branch_id": "branch", "name": "Sender", "activities": [{
        "activity_id": "swim", "activity_name": "Swimming", "status": "active",
        "start_date": start, "end_date": sender_end, "schedule": "Monday Wednesday Friday",
    }]}
    recipient = {"id": "recipient", "branch_id": "branch", "name": "Recipient", "activities": [{
        "activity_id": "swim", "status": "active", "start_date": start, "end_date": recipient_end,
        "schedule": "Monday Wednesday Friday",
    }]}

    class Members:
        async def find_one(self, query, projection, **kwargs):
            return {"sender": sender, "recipient": recipient}.get(query["id"])

    async def quota(member_id, activity_id, session=None):
        end = sender_end if member_id == "sender" else recipient_end
        return [{"start_date": start, "end_date": end,
                 "remaining": 5 if member_id == "sender" else 2,
                 "used_sessions": 1, "total_allowed": 6}]

    monkeypatch.setattr(attendance, "check_member_session_quota", quota)
    database = SimpleNamespace(members=Members())
    reviewed = asyncio.run(session_transfers.preview(
        database, {"id": "sender"}, {"id": "recipient"}, "swim",
        {"sessions": 3, "reason": "Family request"},
    ))[-1]
    assert reviewed["sender_after"] == 2
    assert reviewed["recipient_after"] == 5
    assert reviewed["added_dates"] == next_training_dates(recipient_end, "Monday Wednesday Friday", 3)
    assert reviewed["end_date"] == reviewed["added_dates"][-1]
    assert reviewed["sender_end_date"] == sender_end

    recipient["activities"][0]["end_date"] = (today - timedelta(days=1)).isoformat()
    with pytest.raises(HTTPException, match="409"):
        asyncio.run(session_transfers.preview(
            database, {"id": "sender"}, {"id": "recipient"}, "swim",
            {"sessions": 3, "reason": "Family request"},
        ))
