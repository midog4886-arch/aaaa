"""Read-only fake DB tests; no server import, startup, or provider requests."""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from routes import whatsapp, member_portal
from utils.training_closures import RIYADH_TZ, closures_for_date, training_day_closed


def run(coro):
    return asyncio.run(coro)


class Collection:
    def __init__(self, rows=()):
        self.rows = deepcopy(list(rows))

    def find(self, query, projection=None):
        def matches(row):
            for key, expected in query.items():
                value = row.get(key)
                if isinstance(expected, dict):
                    for op, other in expected.items():
                        if op == "$lte" and (value is None or value > other):
                            return False
                        if op == "$gte" and (value is None or value < other):
                            return False
                        if op == "$in" and value not in other:
                            return False
                        if op == "$nin" and value in other:
                            return False
                        if op == "$exists" and (key in row) != other:
                            return False
                        if op == "$ne" and value == other:
                            return False
                elif value != expected:
                    return False
            return True
        rows = [deepcopy(row) for row in self.rows if matches(row)]
        class Cursor:
            async def to_list(self, length=None):
                return rows
        return Cursor()

    async def find_one(self, query, projection=None):
        return next(iter(await self.find(query).to_list()), None)

    async def create_index(self, *args, **kwargs):
        pass

    async def insert_one(self, row):
        if row.get("dedup_key") and any(r.get("dedup_key") == row["dedup_key"] for r in self.rows):
            raise whatsapp.DuplicateKeyError("duplicate")
        self.rows.append(deepcopy(row))

    async def update_one(self, query, update):
        for row in self.rows:
            if all(row.get(k) == v for k, v in query.items()):
                row.update(update.get("$set", {}))

    async def delete_one(self, query):
        self.rows = [r for r in self.rows if not all(r.get(k) == v for k, v in query.items())]


class DB:
    def __init__(self, closures=(), members=()):
        self.collections = {
            "closures": Collection(closures), "members": Collection(members),
            "branches": Collection([{"id": "a", "name": "Branch A"}, {"id": "b", "name": "Branch B"}]),
        }

    def __getitem__(self, name):
        return self.collections.setdefault(name, Collection())

    def __getattr__(self, name):
        return self[name]


CLOSURE = {"start_date": "2026-09-07", "end_date": "2026-09-09",
           "branch_id": "a", "scope": "all", "stop_type": "full_day"}
NOW = datetime(2026, 9, 7, 15, tzinfo=RIYADH_TZ)


def member(branch="a"):
    return {"id": branch, "name": "Member", "phone": "0501234567", "branch_id": branch,
            "activities": [{
                "activity_id": aid, "activity_name": aid,
                "start_date": "2026-09-01", "end_date": "2026-09-30",
                "training_days": ["monday"], "training_time": time, "schedule": "Monday 17:00",
            } for aid, time in [("swim", "5:00 م"), ("karate", "7:00 م")]]}


def configure(monkeypatch, db):
    sender = AsyncMock(return_value=(True, "fake", None))
    monkeypatch.setattr(whatsapp, "_db", db)
    monkeypatch.setattr(whatsapp, "_get_branch_cloud_config", AsyncMock(
        return_value={"enabled": True, "provider": "whatsflow"}))
    monkeypatch.setattr(whatsapp, "_send_session_provider_result", sender)
    return sender


@pytest.mark.parametrize("applied", [False, True])
@pytest.mark.parametrize("day,closed", [
    ("2026-09-06", False), ("2026-09-07", True), ("2026-09-08", True),
    ("2026-09-09", True), ("2026-09-10", False),
])
def test_inclusive_date_range_independent_of_compensation(applied, day, closed):
    db = DB([{**CLOSURE, "applied": applied}])
    assert training_day_closed(run(closures_for_date(db, day)), "a", "swim") is closed


@pytest.mark.parametrize("changes,branch,activity,closed", [
    ({}, "a", "swim", True), ({}, "b", "swim", False),
    ({"branch_id": "all"}, "b", "swim", True),
    ({"branch_id": ""}, "b", "swim", True),
    ({"branch_id": None}, "b", "swim", True),
    ({"scope": "specific", "activity_ids": ["swim"]}, "a", "swim", True),
    ({"scope": "specific", "activity_id": "swim"}, "a", "swim", True),
    ({"scope": "specific", "activity_ids": ["swim"]}, "a", "karate", False),
    ({"scope": "specific", "activity_ids": ["swim"]}, "b", "swim", False),
    ({"stop_type": "partial"}, "a", "swim", False),
    ({"stop_type": "specific_times"}, "a", "swim", False),
])
def test_scope_matches_attendance_full_day_rules(changes, branch, activity, closed):
    assert training_day_closed([dict(CLOSURE, **changes)], branch, activity) is closed


@pytest.mark.parametrize("applied", [False, True])
def test_worker_suppresses_closed_branch_but_sends_other_branch(monkeypatch, applied):
    db = DB([{**CLOSURE, "applied": applied}], [member(), member("b")])
    sender = configure(monkeypatch, db)
    assert run(whatsapp.process_class_reminders(NOW)) == 1
    assert sender.await_count == 1
    assert "Branch B" in sender.await_args.args[1]
    assert len(db.whatsapp_class_reminder_log.rows) == 1


def test_activity_closure_keeps_open_activity_and_its_reminder_time(monkeypatch):
    db = DB([{**CLOSURE, "scope": "specific", "activity_ids": ["swim"]}], [member()])
    sender = configure(monkeypatch, db)
    assert run(whatsapp.process_class_reminders(NOW)) == 0
    assert run(whatsapp.process_class_reminders(NOW.replace(hour=17))) == 1
    assert "karate" in sender.await_args.args[1]
    assert "swim" not in sender.await_args.args[1]


@pytest.mark.parametrize("changes,expected", [
    ({"branch_id": "all"}, 0),
    ({"start_date": "2026-09-08", "end_date": "2026-09-09"}, 2),
    ({"start_date": "2026-09-05", "end_date": "2026-09-06"}, 2),
    ({"scope": "specific", "activity_ids": ["unrelated"]}, 2),
])
def test_worker_all_branches_and_nonapplicable_closures(monkeypatch, changes, expected):
    db = DB([dict(CLOSURE, **changes)], [member(), member("b")])
    sender = configure(monkeypatch, db)
    assert run(whatsapp.process_class_reminders(NOW)) == expected
    assert sender.await_count == expected


@pytest.mark.parametrize("provider", ["whatsflow", "waha", "meta_cloud"])
@pytest.mark.parametrize("changes,sent", [
    ({}, 0),
    ({"scope": "specific", "activity_ids": ["swim"]}, 0),
    ({"scope": "specific", "activity_ids": ["karate"]}, 1),
])
def test_rechecks_closure_added_after_agenda_claim(monkeypatch, changes, sent, provider):
    db = DB(members=[member()])
    sender = configure(monkeypatch, db)
    if provider == "meta_cloud":
        sender = AsyncMock(return_value=True)
        monkeypatch.setattr(whatsapp, "_send_meta_cloud_message", sender)
    async def config(_branch):
        # Agenda has already been claimed, but provider has not been called.
        assert db.whatsapp_class_reminder_log.rows
        db.closures.rows.append(dict(CLOSURE, **changes))
        return {"enabled": True, "provider": provider, "phone_number_id": "fake",
                "access_token_encrypted": "fake", "class_reminder_template_name": "fake",
                "class_reminder_template_confirmed": True}
    monkeypatch.setattr(whatsapp, "_get_branch_cloud_config", config)
    assert run(whatsapp.process_class_reminders(NOW)) == sent
    assert sender.await_count == sent
    if sent:
        assert "swim" in sender.await_args.args[1]
        assert "karate" not in sender.await_args.args[1]
    else:
        assert db.whatsapp_class_reminder_log.rows == []


@pytest.mark.parametrize("applied", [False, True])
def test_portal_uses_riyadh_today_and_filters_subscription_and_invoice(monkeypatch, applied):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            # Sunday UTC is already Monday in Riyadh.
            return datetime(2026, 9, 6, 22, tzinfo=timezone.utc).astimezone(tz)
    m = member()
    m["activities"] = m["activities"][:1]
    db = DB([{**CLOSURE, "scope": "specific", "activity_ids": ["swim", "invoice-closed"],
              "applied": applied}])
    db.invoices.rows = [{"member_id": "a", "status": "paid", "items": [
        {"activity_id": aid, "schedule": "Monday 17:00", "end_date": "2026-09-30"}
        for aid in ["invoice-closed", "invoice-open"]
    ]}]
    monkeypatch.setattr(member_portal, "db", db)
    monkeypatch.setattr(member_portal, "datetime", Clock)
    result = run(member_portal.get_training_reminders(m))
    assert result["today"] == "2026-09-07"
    assert result["day_name_en"] == "Monday"
    assert [r["activity_id"] for r in result["reminders"]] == ["invoice-open"]