import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from routes import whatsapp as whatsapp_mod


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class PreviewCollection:
    def __init__(self):
        self.rows = []

    async def create_index(self, *_args, **_kwargs):
        return "idx"

    async def insert_one(self, row):
        self.rows.append(dict(row))

    async def find_one(self, query):
        return next((
            dict(row) for row in self.rows
            if all(row.get(key) == value for key, value in query.items())
        ), None)

    async def find_one_and_update(self, query, update, return_document=None):
        for row in self.rows:
            if row.get("preview_id") != query.get("preview_id"):
                continue
            if row.get("tenant_slug") != query.get("tenant_slug"):
                continue
            if row.get("actor_id") != query.get("actor_id"):
                continue
            if row.get("consumed_at") is not None:
                continue
            expires = row.get("expires_at")
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires <= query["expires_at"]["$gt"]:
                continue
            row.update(update["$set"])
            return dict(row)
        return None

    async def update_one(self, query, update):
        for row in self.rows:
            if row.get("preview_id") == query.get("preview_id"):
                row.update(update.get("$set", {}))


class FakeDB:
    def __init__(self):
        self.preview = PreviewCollection()

    def __getitem__(self, name):
        assert name == "whatsapp_send_previews"
        return self.preview


SETTINGS = {
    "enabled": True,
    "offsets": [{"days": 3, "enabled": True}],
    "message_template": "hello",
    "templates": {},
    "push_enabled": True,
    "portal_enabled": True,
}

CANDIDATES = [{
    "member_id": "member-1",
    "member_name": "عضو",
    "phone": "0500000000",
    "activity_id": "activity-1",
    "activity_name": "سباحة",
    "start_date": "2025-01-01",
    "end_date": "2025-01-31",
    "attended_sessions": 7,
    "fee": 100.0,
    "branch_id": "branch-1",
    "branch_name": "الفرع الأول",
    "days_before": 3,
}]


def _install_preview_fakes(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(whatsapp_mod, "_db", db)

    async def settings():
        return dict(SETTINGS)

    async def candidates(_branch_id, _offsets):
        return [dict(row) for row in CANDIDATES]

    async def branch_templates():
        return {}

    monkeypatch.setattr(whatsapp_mod, "_get_settings", settings)
    monkeypatch.setattr(whatsapp_mod, "_build_send_now_candidates", candidates)
    monkeypatch.setattr(whatsapp_mod, "_get_branch_templates", branch_templates)
    return db


def test_preview_contains_no_phone_and_is_bound_to_branch(monkeypatch):
    db = _install_preview_fakes(monkeypatch)
    user = {"is_admin": True, "user_id": "admin-1"}

    response = run(whatsapp_mod.preview_reminders_now(
        whatsapp_mod.SendNowPreviewRequest(branch_id="branch-1"),
        current_user=user,
    ))

    assert response["count"] == 1
    assert response["member_count"] == 1
    assert response["channels"] == ["whatsapp", "push", "portal"]
    assert response["recipients"][0]["attended_sessions"] == 7
    assert "phone" not in response["recipients"][0]
    assert db.preview.rows[0]["actor_id"] == "admin-1"
    assert db.preview.rows[0]["branch_id"] == "branch-1"


def test_confirm_atomically_consumes_and_repeated_confirm_does_not_dispatch(monkeypatch):
    _install_preview_fakes(monkeypatch)
    user = {"is_admin": True, "user_id": "admin-1"}
    preview = run(whatsapp_mod.preview_reminders_now(
        whatsapp_mod.SendNowPreviewRequest(branch_id="branch-1"),
        current_user=user,
    ))
    scheduled = []

    def dispatch(snapshot, settings):
        scheduled.append(snapshot["preview_id"])

    def schedule(_pending):
        # Do not allow any real channel sender to run.
        return None

    monkeypatch.setattr(whatsapp_mod, "_dispatch_send_now_snapshot", dispatch)
    monkeypatch.setattr(whatsapp_mod.asyncio, "ensure_future", schedule)
    request = whatsapp_mod.SendNowConfirmRequest(
        preview_id=preview["preview_id"], confirm=True
    )

    result = run(whatsapp_mod.send_reminders_now(request, current_user=user))
    assert result["success"] is True
    assert scheduled == [preview["preview_id"]]

    with pytest.raises(HTTPException) as exc:
        run(whatsapp_mod.send_reminders_now(request, current_user=user))
    assert exc.value.status_code == 409
    assert scheduled == [preview["preview_id"]]


def test_preview_requires_enabled_setting_and_offset(monkeypatch):
    monkeypatch.setattr(whatsapp_mod, "_db", FakeDB())

    async def disabled_settings():
        return {"enabled": False, "offsets": []}

    monkeypatch.setattr(whatsapp_mod, "_get_settings", disabled_settings)
    with pytest.raises(HTTPException) as exc:
        run(whatsapp_mod.preview_reminders_now(
            whatsapp_mod.SendNowPreviewRequest(),
            current_user={"is_admin": True, "user_id": "admin-1"},
        ))
    assert exc.value.status_code == 400
    assert "تفعيل" in exc.value.detail


def test_naive_mongo_expiry_is_treated_as_utc(monkeypatch):
    db = _install_preview_fakes(monkeypatch)
    user = {"is_admin": True, "user_id": "admin-1"}
    preview = run(whatsapp_mod.preview_reminders_now(
        whatsapp_mod.SendNowPreviewRequest(branch_id="branch-1"),
        current_user=user,
    ))
    db.preview.rows[0]["expires_at"] = (
        db.preview.rows[0]["expires_at"].astimezone(timezone.utc).replace(tzinfo=None)
    )
    monkeypatch.setattr(whatsapp_mod.asyncio, "ensure_future", lambda _pending: None)
    monkeypatch.setattr(whatsapp_mod, "_dispatch_send_now_snapshot", lambda *_args: None)

    result = run(whatsapp_mod.send_reminders_now(
        whatsapp_mod.SendNowConfirmRequest(
            preview_id=preview["preview_id"], confirm=True
        ),
        current_user=user,
    ))
    assert result["success"] is True


def test_phone_or_branch_change_stales_preview_and_group_count_is_not_row_count(monkeypatch):
    db = _install_preview_fakes(monkeypatch)
    rows = [
        dict(CANDIDATES[0]),
        {
            **CANDIDATES[0],
            "activity_id": "activity-2",
            "activity_name": "لياقة",
            "attended_sessions": 4,
        },
    ]

    async def initial_candidates(_branch_id, _offsets):
        return [dict(row) for row in rows]

    monkeypatch.setattr(whatsapp_mod, "_build_send_now_candidates", initial_candidates)
    user = {"is_admin": True, "user_id": "admin-1"}
    preview = run(whatsapp_mod.preview_reminders_now(
        whatsapp_mod.SendNowPreviewRequest(branch_id="branch-1"),
        current_user=user,
    ))
    assert preview["count"] == 1
    assert preview["row_count"] == 2

    async def changed_candidates(_branch_id, _offsets):
        changed = [dict(row) for row in rows]
        changed[0]["phone"] = "0555555555"
        changed[1]["branch_id"] = "branch-2"
        return changed

    monkeypatch.setattr(whatsapp_mod, "_build_send_now_candidates", changed_candidates)
    with pytest.raises(HTTPException) as exc:
        run(whatsapp_mod.send_reminders_now(
            whatsapp_mod.SendNowConfirmRequest(
                preview_id=preview["preview_id"], confirm=True
            ),
            current_user=user,
        ))
    assert exc.value.status_code == 409
    assert db.preview.rows[0]["stale"] is True


def test_dispatch_groups_multiple_activities_into_one_member_offset(monkeypatch):
    captured = []
    rows = [
        dict(CANDIDATES[0]),
        {
            **CANDIDATES[0],
            "activity_id": "activity-2",
            "activity_name": "لياقة",
            "fee": 50.0,
        },
    ]

    async def send_wa(items, days, template, manual=False, branch_templates=None):
        captured.append((items, days, manual))
        return 1

    monkeypatch.setattr(whatsapp_mod, "_send_wa_for_members", send_wa)
    run(whatsapp_mod._dispatch_send_now_snapshot(
        {
            "candidates": rows,
            "channels": ["whatsapp"],
            "branch_templates": {},
        },
        SETTINGS,
    ))

    assert len(captured) == 1
    items, days, manual = captured[0]
    assert len(items) == 1
    assert items[0]["expiring_activities"] == ["سباحة", "لياقة"]
    assert items[0]["fee_str"] == "150"
    assert days == 3
    assert manual is True


class Cursor:
    def __init__(self, rows):
        self.rows = rows
        self._iterator = None

    async def to_list(self, length=None):
        return [dict(row) for row in self.rows]

    def __aiter__(self):
        self._iterator = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return dict(next(self._iterator))
        except StopIteration:
            raise StopAsyncIteration


class RowsCollection:
    def __init__(self, rows):
        self.rows = rows

    def find(self, *_args, **_kwargs):
        return Cursor(self.rows)


def test_candidate_builder_matches_legacy_timestamp_quota_dates(monkeypatch):
    today = datetime.now(whatsapp_mod.RIYADH_TZ).date()
    target = (today + whatsapp_mod.timedelta(days=3)).strftime("%Y-%m-%d")
    member = {
        "id": "member-legacy",
        "name": "Legacy",
        "phone": "0500000000",
        "branch_id": "branch-1",
        "activities": [{
            "activity_id": "activity-1",
            "activity_name": "سباحة",
            "status": "active",
            "start_date": "2025-01-01T00:00:00Z",
            "end_date": f"{target}T00:00:00Z",
            "schedule": "sunday",
        }],
    }

    class CandidateDB:
        def __getitem__(self, name):
            if name == "members":
                return RowsCollection([member])
            if name == "branches":
                return RowsCollection([{"id": "branch-1", "name_ar": "فرع"}])
            raise AssertionError(name)

    async def quota(_member_id):
        return [{
            "activity_id": "activity-1",
            "start_date": "2025-01-01T00:00:00Z",
            "end_date": f"{target}T00:00:00Z",
            "used_sessions": 5,
        }]

    from routes import attendance as attendance_mod
    monkeypatch.setattr(attendance_mod, "check_member_session_quota", quota)
    monkeypatch.setattr(whatsapp_mod, "_db", CandidateDB())

    candidates = run(whatsapp_mod._build_send_now_candidates("branch-1", [3]))
    assert candidates[0]["end_date"] == target
    assert candidates[0]["attended_sessions"] == 5