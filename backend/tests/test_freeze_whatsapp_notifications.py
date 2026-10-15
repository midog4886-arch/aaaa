import asyncio
import pytest
from fastapi import HTTPException

from routes import freezes as freezes_mod
from routes import whatsapp as whatsapp_mod


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _matches(row, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(row, item) for item in expected):
                return False
        elif isinstance(expected, dict):
            actual = row.get(key, "")
            if "$gte" in expected and actual < expected["$gte"]:
                return False
            if "$lte" in expected and actual > expected["$lte"]:
                return False
            if "$lt" in expected and actual >= expected["$lt"]:
                return False
        elif row.get(key) != expected:
            return False
    return True


class Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query, _projection=None):
        rows = [dict(row) for row in self.rows if _matches(row, query)]

        class Cursor:
            async def to_list(self, _length):
                return rows

        return Cursor()

    async def insert_one(self, row):
        self.rows.append(dict(row))

    async def update_one(self, query, update):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set") or {})
                break


class DB:
    def __init__(self, collections=None):
        self.collections = dict(collections or {})

    def __getattr__(self, name):
        return self[name]

    def __getitem__(self, name):
        if name not in self.collections:
            self.collections[name] = Collection()
        return self.collections[name]


def test_create_and_cancel_invoke_freeze_notice_without_affecting_portal(monkeypatch):
    database = DB({
        "members": Collection([{
            "id": "member-1",
            "name_ar": "ليان",
            "phone": "0501234567",
            "branch_id": "branch-1",
            "activities": [],
        }]),
        "member_freezes": Collection(),
        "member_notifications": Collection(),
    })
    monkeypatch.setattr(freezes_mod, "db", database)
    calls = []

    async def sender(member, freeze, *, event_type):
        calls.append((member["id"], freeze["id"], event_type))
        return False

    monkeypatch.setattr(whatsapp_mod, "send_freeze_whatsapp_notice", sender)
    created = run(freezes_mod.create_freeze(
        freezes_mod.FreezeCreate(
            member_id="member-1",
            start_date="2026-10-01",
            end_date="2026-10-03",
            reason="medical",
        ),
        current_user={"username": "admin", "is_admin": True},
    ))
    cancelled = run(freezes_mod.cancel_freeze(
        created["id"],
        current_user={"username": "admin", "is_admin": True},
    ))

    assert cancelled["status"] == "cancelled"
    assert [item[2] for item in calls] == ["freeze_created", "freeze_cancelled"]
    assert len(database.member_notifications.rows) == 2


def _whatsapp_db(provider):
    return DB({
        "whatsapp_branch_configs": Collection([{
            "branch_id": "branch-1",
            "provider": provider,
            "enabled": True,
            "waha_session_name": "branch-session",
        }]),
        "branches": Collection([{
            "id": "branch-1",
            "name_ar": "فرع النخيل",
        }]),
        "whatsapp_send_log": Collection(),
    })


def test_freeze_notice_uses_session_provider_and_bilingual_inclusive_dates(monkeypatch):
    database = _whatsapp_db("waha")
    monkeypatch.setattr(whatsapp_mod, "_db", database)
    dispatched = []

    async def send(phone, message, config):
        dispatched.append((phone, message, config))
        return True, "provider-1", None

    monkeypatch.setattr(whatsapp_mod, "_send_session_provider_result", send)
    result = run(whatsapp_mod.send_freeze_whatsapp_notice(
        {
            "id": "member-1",
            "name_ar": "ليان",
            "phone": "0501234567",
            "branch_id": "branch-1",
        },
        {
            "id": "freeze-1",
            "member_id": "member-1",
            "start_date": "2026-10-01",
            "end_date": "2026-10-03",
            "duration_days": 3,
            "reason": "medical",
            "status": "active",
        },
        event_type="freeze_created",
    ))

    assert result is True
    assert dispatched[0][0] == "966501234567@s.whatsapp.net"
    message = dispatched[0][1]
    assert "ليان" in message
    assert "2026-10-01" in message and "2026-10-03" in message
    assert "شاملة" in message and "Inclusive period" in message
    assert "فرع النخيل" in message and "— English —" in message
    assert "medical" not in message
    log = database.whatsapp_send_log.rows[0]
    assert log["type"] == "freeze_created"
    assert log["freeze_id"] == "freeze-1"
    assert log["success"] is True


def test_unsupported_provider_is_logged_and_isolated(monkeypatch):
    database = _whatsapp_db("disabled")
    monkeypatch.setattr(whatsapp_mod, "_db", database)

    result = run(whatsapp_mod.send_freeze_whatsapp_notice(
        {
            "id": "member-1",
            "name": "Member",
            "phone": "0501234567",
            "branch_id": "branch-1",
        },
        {
            "id": "freeze-1",
            "member_id": "member-1",
            "start_date": "2026-10-01",
            "end_date": "2026-10-03",
            "duration_days": 3,
            "status": "cancelled",
        },
        event_type="freeze_cancelled",
    ))

    assert result is False
    assert len(database.whatsapp_send_log.rows) == 1
    log = database.whatsapp_send_log.rows[0]
    assert log["error"] == "unsupported_provider:disabled"
    assert log["success"] is False


def test_single_activity_freeze_moves_only_its_sessions_and_can_overlap_another(monkeypatch):
    database = DB({
        "members": Collection([{
            "id": "member-1", "name_ar": "مرام", "phone": "0501234567", "branch_id": "branch-1",
            "activities": [
                {"activity_id": "swim", "activity_name": "السباحة", "status": "active",
                 "start_date": "2026-10-01", "end_date": "2026-11-01", "schedule": "Monday, Wednesday"},
                {"activity_id": "football", "activity_name": "القدم", "status": "active",
                 "start_date": "2026-10-01", "end_date": "2026-11-01", "schedule": "Tuesday"},
            ],
        }]),
        "member_freezes": Collection(), "member_notifications": Collection(),
    })
    monkeypatch.setattr(freezes_mod, "db", database)

    async def no_send(*args, **kwargs):
        return False

    monkeypatch.setattr(whatsapp_mod, "send_freeze_whatsapp_notice", no_send)
    swim = run(freezes_mod.create_freeze(freezes_mod.FreezeCreate(
        member_id="member-1", activity_id="swim", start_date="2026-10-19",
        end_date="2026-10-21", reason="personal",
    ), current_user={"username": "admin"}))
    assert swim["duration_days"] == 3
    assert swim["total_extension_days"] == 2
    assert swim["activity_name"] == "السباحة"
    member = database.members.rows[0]
    assert member["activities"][0]["end_date"] == "2026-11-04"
    assert member["activities"][1]["end_date"] == "2026-11-01"
    assert "حصتان" in database.member_notifications.rows[0]["message_ar"]

    with pytest.raises(HTTPException):
        run(freezes_mod.create_freeze(freezes_mod.FreezeCreate(
            member_id="member-1", activity_id="swim", start_date="2026-10-20",
            end_date="2026-10-21", reason="personal",
        ), current_user={"username": "admin"}))

    football = run(freezes_mod.create_freeze(freezes_mod.FreezeCreate(
        member_id="member-1", activity_id="football", start_date="2026-10-19",
        end_date="2026-10-21", reason="personal",
    ), current_user={"username": "admin"}))
    assert football["total_extension_days"] == 1
    assert member["activities"][1]["end_date"] == "2026-11-03"

    run(freezes_mod.cancel_freeze(swim["id"], current_user={"username": "admin"}))
    assert member["activities"][0]["end_date"] == "2026-11-01"
    assert member["activities"][1]["end_date"] == "2026-11-03"


def test_freeze_whatsapp_uses_session_duration_when_available(monkeypatch):
    database = _whatsapp_db("waha")
    monkeypatch.setattr(whatsapp_mod, "_db", database)
    messages = []

    async def send(phone, message, config):
        messages.append(message)
        return True, "provider-1", None

    monkeypatch.setattr(whatsapp_mod, "_send_session_provider_result", send)
    run(whatsapp_mod.send_freeze_whatsapp_notice(
        {"id": "member-1", "name_ar": "مرام", "phone": "0501234567", "branch_id": "branch-1"},
        {"id": "freeze-1", "member_id": "member-1", "activity_id": "swim",
         "activity_name": "السباحة", "start_date": "2026-10-19", "end_date": "2026-10-21",
         "duration_days": 3, "total_extension_days": 2},
        event_type="freeze_created",
    ))
    assert "المدة: حصتان" in messages[0]
    assert "Duration: 2 session(s)" in messages[0]
    assert "السباحة" in messages[0]
    assert "3 day(s)" not in messages[0]
