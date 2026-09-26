"""Hermetic checks: rejected requests cannot write or notify."""
import asyncio
import copy
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from routes import attendance as att, member_portal as portal


class Cursor:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, limit):
        return copy.deepcopy(self.docs[:limit] if limit else self.docs)


class Collection:
    def __init__(self, docs=()):
        self.docs = list(docs)
        self.insert_one = AsyncMock()
        self.update_one = AsyncMock()

    def find(self, query, projection=None):
        def matches(doc):
            for key, value in query.items():
                if key == "$or":
                    return any(Collection([doc]).find(part).docs for part in value)
                actual = doc.get(key)
                if isinstance(value, dict):
                    if "$in" in value and actual not in value["$in"]:
                        return False
                    if "$ne" in value and actual == value["$ne"]:
                        return False
                    if "$regex" in value and not re.search(value["$regex"], actual or "", re.I):
                        return False
                elif actual != value:
                    return False
            return True
        return Cursor([d for d in self.docs if matches(d)])

    async def find_one(self, query, projection=None):
        rows = await self.find(query).to_list(1)
        return rows[0] if rows else None


@pytest.fixture
def database(monkeypatch):
    member = {"id": "m", "member_code": "ABC-123", "phone": "0501234567",
              "branch_id": "b", "activities": [{
                  "activity_id": "a", "status": "expired",
                  "start_date": "2020-01-01", "end_date": "2020-01-31"}]}
    db = SimpleNamespace(members=Collection([member]), activities=Collection([{"id": "a"}]),
                         attendance=Collection(), member_freezes=Collection())
    monkeypatch.setattr(att, "db", db)
    monkeypatch.setattr(portal, "db", db)
    monkeypatch.setattr(att, "check_member_session_quota", AsyncMock(return_value=[]))
    monkeypatch.setattr(att, "schedule_attendance_whatsapp", lambda *a: pytest.fail("unexpected send"))
    return db


def run(coro):
    return asyncio.run(coro)


@pytest.mark.parametrize("day", ["2019-12-31", "2020-02-01", "2099-01-01"])
def test_window_rejects_outside_dates(database, day):
    with pytest.raises(HTTPException) as exc:
        run(att.enforce_attendance_window("m", "a", day, {"is_admin": True}))
    assert exc.value.status_code == 400


@pytest.mark.parametrize("day", ["2020-01-01", "2020-01-31"])
def test_historical_inside_dates_allowed(database, day):
    run(att.enforce_attendance_window("m", "a", day, {"is_admin": True}))


def test_branch_isolation(database):
    with pytest.raises(HTTPException) as exc:
        run(att.enforce_attendance_window("m", "a", "2020-01-03", {"branch_id": "other"}))
    assert exc.value.status_code == 403


def test_manual_expired_does_not_write(database):
    with pytest.raises(HTTPException):
        run(att.create_attendance(att.AttendanceCreate(member_id="m", activity_id="a", date="2020-02-01"),
                                  {"is_admin": True}))
    database.attendance.insert_one.assert_not_awaited()


def test_edit_expired_does_not_write(database):
    database.attendance.docs = [{"id": "r", "member_id": "m", "activity_id": "a",
                                 "branch_id": "b", "date": "2020-01-03"}]
    with pytest.raises(HTTPException):
        run(att.update_attendance_date("r", {"date": "2020-02-01"}, {"is_admin": True}))
    database.attendance.update_one.assert_not_awaited()


def test_edit_valid_historical_date(database):
    database.attendance.docs = [{"id": "r", "member_id": "m", "activity_id": "a",
                                 "branch_id": "b", "date": "2020-01-03"}]
    result = run(att.update_attendance_date("r", {"date": "2020-01-05"}, {"is_admin": True}))
    assert result["date"] == "2020-01-05"
    database.attendance.update_one.assert_awaited_once()


def test_live_qr_force_cannot_bypass_expiry(database, monkeypatch):
    monkeypatch.setattr(att, "get_member_schedule_days", AsyncMock(return_value=[]))
    result = run(att.qr_checkin(member_code="ABC-123", activity_id="a", force=True,
                                current_user={"is_admin": True}))
    assert result["status"] == "quota_exceeded"
    database.attendance.insert_one.assert_not_awaited()


def test_cross_purchase_date_move_denied(database):
    with pytest.raises(HTTPException):
        run(att.enforce_attendance_window("m", "a", "2020-01-05",
                                          {"is_admin": True}, previous_date="2019-12-31"))


def test_login_wrong_tenant_cannot_find_member(database, monkeypatch):
    database.members.docs = []
    with pytest.raises(HTTPException) as exc:
        run(portal.member_login(portal.MemberLogin(member_code="ABC-123", phone="0501234567")))
    assert exc.value.status_code == 401


@pytest.mark.parametrize("path", ["quick", "bulk", "manual_shadow", "qr_shadow"])
def test_server_paths_reject_before_write(database, monkeypatch, path):
    import server
    monkeypatch.setattr(server, "db", database)
    actor = {"is_admin": True}
    if path == "quick":
        call = server.quick_attendance("ABC-123", "a", actor)
    elif path == "bulk":
        call = server.record_bulk_attendance(server.BulkAttendanceRequest(
            activity_id="a", date="2020-02-01", records=[{"member_id": "m"}]), actor)
    elif path == "qr_shadow":
        call = server.qr_checkin("m", "a", actor)
    else:
        call = server.record_attendance(SimpleNamespace(member_id="m", activity_id="a", date="2020-02-01"), actor)
    with pytest.raises(HTTPException):
        run(call)
    database.attendance.insert_one.assert_not_awaited()
    database.attendance.update_one.assert_not_awaited()


@pytest.mark.parametrize("code,phone", [("ABC-12", "0501234567"), ("ABC-123", "0509999999"), ("OTHER-123", "0501234567")])
def test_login_requires_pair_in_same_document(database, monkeypatch, code, phone):
    token = AsyncMock()
    monkeypatch.setattr(portal, "create_member_token", token)
    with pytest.raises(HTTPException) as exc:
        run(portal.member_login(portal.MemberLogin(member_code=code, phone=phone)))
    assert exc.value.status_code == 401
    token.assert_not_called()


def test_exact_primary_not_first_phone_sibling(database, monkeypatch):
    database.members.docs.insert(0, {"id": "sibling", "member_code": "ABC-999", "phone": "0501234567"})
    issued = []
    monkeypatch.setattr(portal, "create_member_token", lambda mid, phone: issued.append(mid) or "token")
    result = run(portal.member_login(portal.MemberLogin(member_code="abc-١٢٣", phone="0501234567")))
    assert issued == ["m"]
    assert result["member"]["id"] == "m"
    assert {m["id"] for m in result["member"]["linked_members"]} == {"m", "sibling"}