import asyncio

import pytest
from fastapi import HTTPException

from routes import whatsapp as whatsapp_mod


class AsyncRows:
    def __init__(self, rows):
        self.rows = rows

    def __aiter__(self):
        self._iterator = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return next(self._iterator)
        except StopIteration:
            raise StopAsyncIteration


class Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def find(self, query, *_args, **_kwargs):
        ids = set(query.get("id", {}).get("$in", []))
        return AsyncRows([
            dict(row) for row in self.rows
            if not ids or row.get("id") in ids
        ])

    async def insert_one(self, row):
        self.rows.append(dict(row))


class FakeDB:
    def __init__(self, members):
        self.collections = {"members": Collection(members)}

    def __getitem__(self, name):
        return self.collections.setdefault(name, Collection())


def _item(member_id, activity, end_date):
    return whatsapp_mod.BulkReminderItem(
        member_id=member_id,
        activity_name=activity,
        end_date=end_date,
    )


def _install(monkeypatch, members):
    db = FakeDB(members)
    sent = []

    async def settings():
        return {
            "manual_reminder_template": "تنبيه {name}: {activity} {end_date}",
            "manual_reminder_expired_template": "تنبيه منتهي {name}: {activity} {end_date}",
            "push_enabled": False,
            "portal_enabled": False,
        }

    async def branch_templates():
        return {}

    async def wa_status():
        return {"connected": True}

    async def send(phone, message, branch_id):
        sent.append((phone, message, branch_id))
        return True

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(whatsapp_mod, "_db", db)
    monkeypatch.setattr(whatsapp_mod, "_get_settings", settings)
    monkeypatch.setattr(whatsapp_mod, "_get_branch_templates", branch_templates)
    monkeypatch.setattr(whatsapp_mod, "_get_wa_status", wa_status)
    monkeypatch.setattr(whatsapp_mod, "_send_wa_message_for_branch", send)
    monkeypatch.setattr(whatsapp_mod.asyncio, "sleep", no_sleep)
    return db, sent


def test_shared_normalized_phone_and_branch_gets_one_message_with_each_expiry(monkeypatch):
    db, sent = _install(monkeypatch, [
        {
            "id": "m1", "name": "Sara", "phone": "0500000001",
            "branch_id": "b1",
        },
        {
            "id": "m2", "name": "Lina", "phone": "966500000001",
            "branch_id": "b1",
        },
    ])
    payload = whatsapp_mod.BulkReminderRequest(items=[
        _item("m1", "Swimming", "2024-01-10"),
        _item("m1", "Fitness", "2024-02-20"),
        _item("m2", "Karate", "2024-03-30"),
    ])

    result = asyncio.run(whatsapp_mod.send_bulk_renewal_reminders(
        payload, current_user={"is_admin": True, "username": "admin"}
    ))

    assert result["wa_sent"] == 1
    assert len(sent) == 1
    phone, message, branch_id = sent[0]
    assert phone == "966500000001@s.whatsapp.net"
    assert branch_id == "b1"
    for expected in (
        "Sara", "Lina", "Swimming", "Fitness", "Karate",
        "2024/01/10", "2024/02/20", "2024/03/30",
    ):
        assert expected in message

    reminder_rows = db["renewal_reminder_log"].rows
    assert len(reminder_rows) == 3
    assert {
        (row["member_id"], row["activity_name"], row["channel"])
        for row in reminder_rows
    } == {
        ("m1", "Swimming", "whatsapp"),
        ("m1", "Fitness", "whatsapp"),
        ("m2", "Karate", "whatsapp"),
    }
    assert len(db["whatsapp_send_log"].rows) == 1


def test_same_normalized_phone_in_different_branches_is_dispatched_per_branch(monkeypatch):
    _db, sent = _install(monkeypatch, [
        {
            "id": "m1", "name": "Sara", "phone": "0500000001",
            "branch_id": "b1",
        },
        {
            "id": "m2", "name": "Lina", "phone": "+966 50 000 0001",
            "branch_id": "b2",
        },
    ])
    payload = whatsapp_mod.BulkReminderRequest(items=[
        _item("m1", "Swimming", "2026-01-10"),
        _item("m2", "Karate", "2026-01-20"),
    ])

    result = asyncio.run(whatsapp_mod.send_bulk_renewal_reminders(
        payload, current_user={"is_admin": True}
    ))

    assert result["wa_sent"] == 2
    assert [branch_id for _phone, _message, branch_id in sent] == ["b1", "b2"]


def test_cross_branch_authorization_happens_before_any_dispatch(monkeypatch):
    _db, sent = _install(monkeypatch, [
        {
            "id": "m1", "name": "Sara", "phone": "0500000001",
            "branch_id": "b2",
        },
    ])

    with pytest.raises(HTTPException) as exc:
        asyncio.run(whatsapp_mod.send_bulk_renewal_reminders(
            whatsapp_mod.BulkReminderRequest(items=[
                _item("m1", "Swimming", "2026-01-10"),
            ]),
            current_user={
                "is_admin": False,
                "permissions": ["renewals"],
                "branch_id": "b1",
            },
        ))

    assert exc.value.status_code == 403
    assert sent == []