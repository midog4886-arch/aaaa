import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

from routes import member_portal


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args):
        return self

    async def to_list(self, limit):
        return self.rows[:limit]


class Collection:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def find(self, *_args, **_kwargs):
        return Cursor(self.rows)


def test_family_dashboard_dedupes_only_identical_periods(monkeypatch):
    today = datetime.now(member_portal.RIYADH_TZ).date()
    end = (today + timedelta(days=5)).isoformat()
    period = {
        "activity_id": "swim", "activity_name": "Swimming",
        "start_date": (today - timedelta(days=20)).isoformat(),
        "end_date": end, "_owner_id": "child-1", "_owner_name": "Child 1",
    }
    other_child = {**period, "_owner_id": "child-2", "_owner_name": "Child 2"}
    member = {"id": "child-1", "activities": [period, dict(period), other_child]}

    async def empty_coaches(_member_id):
        return {}, {}, {}

    async def quota(_member_id):
        return [{"activity_id": "swim", "total_allowed": 8, "used_sessions": 1, "remaining": 7}]

    monkeypatch.setattr(member_portal, "db", SimpleNamespace(
        activities=Collection(), coaches=Collection()))
    monkeypatch.setattr(member_portal, "get_member_level_coach_maps", empty_coaches)
    from routes import attendance
    monkeypatch.setattr(attendance, "check_member_session_quota", quota)

    result = asyncio.run(member_portal.get_member_subscriptions(member))
    assert len(result["active"]) == 2
    assert {row["_owner_id"] for row in result["active"]} == {"child-1", "child-2"}
    assert all(row["end_date"] == end and row["sessions_remaining"] == 7
               for row in result["active"])


def test_renewed_period_hides_obsolete_expiry_reminders(monkeypatch):
    today = datetime.now(member_portal.RIYADH_TZ).date()
    old_end = (today - timedelta(days=2)).isoformat()
    new_end = (today + timedelta(days=5)).isoformat()
    member = {
        "id": "child-1", "name": "Child 1", "_linked_member_ids": ["child-1"],
        "activities": [
            {"activity_id": "swim", "activity_name": "Swimming", "end_date": old_end},
            {"activity_id": "swim", "activity_name": "Swimming", "end_date": new_end},
        ],
    }
    saved = [
        {"id": "old", "member_id": "child-1", "type": "subscription_expiry",
         "activity_id": "swim", "end_date": old_end},
        {"id": "old-auto", "member_id": "child-1", "type": "expiry_reminder",
         "dedup_key": f"expiry-child-1-{old_end}-3"},
        {"id": "new", "member_id": "child-1", "type": "subscription_expiry",
         "activity_id": "swim", "end_date": new_end},
        {"id": "same-period-older-stage", "member_id": "child-1", "type": "subscription_expiry",
         "activity_id": "swim", "end_date": new_end},
    ]
    monkeypatch.setattr(member_portal, "db", SimpleNamespace(
        notifications=Collection(), member_notifications=Collection(saved)))

    result = asyncio.run(member_portal.get_member_notifications(member))
    assert [row["id"] for row in result["notifications"]] == ["new"]
    assert result["unread_count"] == 1
