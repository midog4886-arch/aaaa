"""In-process unit tests for the QUICK and BULK attendance paths.

These handlers live in backend/server.py (NOT routes/attendance.py — the
lookalikes there serve manual/QR check-in). Direct handler calls with a
monkeypatched module-level ``db`` — NO server, NO real DB.

Facts honoured here:
  - every attendance write must stamp branch_id or the record vanishes from
    all branch-filtered views; quick path: VIP = scanning user's branch,
    regular member = member's own branch.
  - quick path normalizes Arabic digits and recovers Arabic-keyboard-mangled
    codes before failing lookup.
  - bulk path updates (not duplicates) an existing member+activity+date
    record, and only notifies on "present".
"""
import asyncio
import os
import re
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SESSION_SECRET", "test-secret")

import server  # noqa: E402


def run(coro):
    """Run a coroutine on a fresh loop, then drain any tasks it spawned
    (handlers fire best-effort push notifications via asyncio.create_task)."""
    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(coro)
        pending = [t for t in asyncio.all_tasks(loop) if not t.done()]
        if pending:
            loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        return result
    finally:
        loop.close()


# ── fakes ────────────────────────────────────────────────────────────────────

class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, *a, **k):
        return self

    async def to_list(self, n=None):
        return list(self._docs)


class _FakeCollection:
    def __init__(self):
        self.docs = []

    @classmethod
    def _matches(cls, doc, query):
        for k, v in query.items():
            if k == "$or":
                if not any(cls._matches(doc, sub) for sub in v):
                    return False
            elif isinstance(v, dict):
                dv = doc.get(k)
                if "$in" in v and dv not in v["$in"]:
                    return False
                if "$regex" in v:
                    flags = re.IGNORECASE if "i" in v.get("$options", "") else 0
                    if dv is None or not re.search(v["$regex"], str(dv), flags):
                        return False
            else:
                if doc.get(k) != v:
                    return False
        return True

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

        class R:
            inserted_id = "x"
        return R()

    async def find_one(self, query, proj=None):
        for d in self.docs:
            if self._matches(d, query):
                return dict(d)
        return None

    async def update_one(self, query, update, upsert=False):
        for d in self.docs:
            if self._matches(d, query):
                d.update(update.get("$set", {}))
                return
        if upsert:
            doc = {k: v for k, v in query.items() if not isinstance(v, dict)}
            doc.update(update.get("$set", {}))
            self.docs.append(doc)

    def find(self, query, proj=None):
        return _FakeCursor([dict(d) for d in self.docs if self._matches(d, query)])


class _FakeDB:
    def __init__(self):
        self.cols = {}

    def __getattr__(self, name):
        if name == "cols":
            raise AttributeError(name)
        return self.cols.setdefault(name, _FakeCollection())

    def __getitem__(self, name):
        return self.cols.setdefault(name, _FakeCollection())


@pytest.fixture()
def db(monkeypatch):
    fdb = _FakeDB()
    monkeypatch.setattr(server, "db", fdb)

    async def _noop_push(*a, **k):
        return None
    monkeypatch.setattr(server, "_push_attendance_notice", _noop_push)
    return fdb


def user(branch_id=None):
    return {"id": "u1", "user_id": "u1", "username": "admin", "name": "Admin",
            "is_admin": True, "branch_id": branch_id, "permissions": []}


def _today():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _member(**over):
    doc = {"id": "m1", "member_code": "1001", "name_ar": "علي", "name": "Ali",
           "branch_id": "b-member", "is_vip": False,
           "activities": [{"activity_id": "act1", "activity_name": "كاراتيه",
                           "end_date": ""}]}
    doc.update(over)
    return doc


def _activity(**over):
    doc = {"id": "act1", "name_ar": "كاراتيه", "name": "Karate"}
    doc.update(over)
    return doc


# ── quick_attendance ─────────────────────────────────────────────────────────

def test_quick_stamps_member_branch_for_regular(db):
    db.members.docs.append(_member())
    db.activities.docs.append(_activity())
    out = run(server.quick_attendance("1001", "act1", user(branch_id="b-scanner")))
    assert out["already_recorded"] is False
    rec = db.attendance.docs[0]
    assert rec["branch_id"] == "b-member"
    assert rec["status"] == "present"
    assert rec["recorded_by"] == "u1"


def test_quick_vip_stamps_scanner_branch(db):
    db.members.docs.append(_member(is_vip=True, branch_id="b-home"))
    db.activities.docs.append(_activity())
    run(server.quick_attendance("1001", "act1", user(branch_id="b-scanner")))
    assert db.attendance.docs[0]["branch_id"] == "b-scanner"


def test_quick_vip_without_scanner_branch_falls_back_to_member(db):
    db.members.docs.append(_member(is_vip=True, branch_id="b-home"))
    db.activities.docs.append(_activity())
    run(server.quick_attendance("1001", "act1", user(branch_id=None)))
    assert db.attendance.docs[0]["branch_id"] == "b-home"


def test_quick_regular_without_member_branch_falls_back_to_scanner(db):
    db.members.docs.append(_member(branch_id=None))
    db.activities.docs.append(_activity())
    run(server.quick_attendance("1001", "act1", user(branch_id="b-scanner")))
    assert db.attendance.docs[0]["branch_id"] == "b-scanner"


def test_quick_unknown_code_404(db):
    db.activities.docs.append(_activity())
    with pytest.raises(HTTPException) as e:
        run(server.quick_attendance("9999", "act1", user()))
    assert e.value.status_code == 404


def test_quick_unknown_activity_404(db):
    db.members.docs.append(_member())
    with pytest.raises(HTTPException) as e:
        run(server.quick_attendance("1001", "ghost", user()))
    assert e.value.status_code == 404


def test_quick_arabic_digits_normalized(db):
    db.members.docs.append(_member(member_code="1001"))
    db.activities.docs.append(_activity())
    out = run(server.quick_attendance("١٠٠١", "act1", user()))
    assert out["already_recorded"] is False
    assert len(db.attendance.docs) == 1


def test_quick_duplicate_same_day_returns_already_recorded(db):
    db.members.docs.append(_member())
    db.activities.docs.append(_activity())
    run(server.quick_attendance("1001", "act1", user()))
    out = run(server.quick_attendance("1001", "act1", user()))
    assert out["already_recorded"] is True
    assert len(db.attendance.docs) == 1


def test_quick_expired_subscription_400_with_date(db):
    db.members.docs.append(_member(activities=[{
        "activity_id": "act1", "activity_name": "كاراتيه",
        "end_date": "2020-01-01"}]))
    db.activities.docs.append(_activity())
    with pytest.raises(HTTPException) as e:
        run(server.quick_attendance("1001", "act1", user()))
    assert e.value.status_code == 400
    assert "2020-01-01" in e.value.detail
    assert len(db.attendance.docs) == 0


def test_quick_not_enrolled_400(db):
    db.members.docs.append(_member(activities=[]))
    db.activities.docs.append(_activity())
    with pytest.raises(HTTPException) as e:
        run(server.quick_attendance("1001", "act1", user()))
    assert e.value.status_code == 400
    assert "غير مسجل" in e.value.detail


def test_quick_active_via_paid_invoice(db):
    db.members.docs.append(_member(activities=[]))
    db.activities.docs.append(_activity())
    db.invoices.docs.append({
        "member_id": "m1", "status": "paid",
        "items": [{"activity_id": "act1", "end_date": "2099-12-31"}],
    })
    out = run(server.quick_attendance("1001", "act1", user()))
    assert out["already_recorded"] is False


def test_quick_recovers_arabic_keyboard_mangled_code(db):
    """A Latin code typed while the OS keyboard is on Arabic layout gets
    mangled 1:1; the handler must recover it via the regex fallback."""
    from utils.text import _AR_KB_MAP
    # Derive a mangled input from the layout map itself: any Arabic char the
    # layout maps to a Latin letter ('b' lives on a ligature; pick a plain one).
    mangled, latin = next((k, v.upper()) for k, v in _AR_KB_MAP.items()
                          if v.isalpha())
    db.members.docs.append(_member(member_code=latin + "12"))
    db.activities.docs.append(_activity())
    out = run(server.quick_attendance(mangled + "12", "act1", user()))
    assert out["already_recorded"] is False
    assert db.attendance.docs[0]["member_code"] == latin + "12"


def test_quick_active_via_registration_form_fallback(db):
    """No direct activity, no invoice — a pending registration form matched
    by phone still grants entry."""
    db.members.docs.append(_member(activities=[], phone="0501234567"))
    db.activities.docs.append(_activity())
    db.registration_forms.docs.append({
        "customer_phone": "0501234567", "customer_name": "غيره",
        "status": "pending",
        "items": [{"activity_id": "act1", "end_date": "2099-12-31"}],
    })
    out = run(server.quick_attendance("1001", "act1", user()))
    assert out["already_recorded"] is False
    assert len(db.attendance.docs) == 1


def test_quick_writes_member_notification(db):
    db.members.docs.append(_member())
    db.activities.docs.append(_activity())
    run(server.quick_attendance("1001", "act1", user()))
    notifs = db.member_notifications.docs
    assert len(notifs) == 1
    assert notifs[0]["member_id"] == "m1"
    assert notifs[0]["type"] == "attendance_recorded"


# ── record_bulk_attendance ───────────────────────────────────────────────────

def _bulk_req(records, date="2026-01-05", activity_id="act1"):
    return server.BulkAttendanceRequest(
        activity_id=activity_id, date=date, records=records)


def test_bulk_records_and_stamps_member_branch(db):
    db.activities.docs.append(_activity())
    db.members.docs.extend([
        _member(id="m1", branch_id="b1"),
        _member(id="m2", member_code="1002", name="Omar", branch_id="b2"),
    ])
    out = run(server.record_bulk_attendance(
        _bulk_req([{"member_id": "m1"}, {"member_id": "m2"}]),
        user(branch_id="b-scanner")))
    assert out["count"] == 2
    branches = {d["member_id"]: d["branch_id"] for d in db.attendance.docs}
    assert branches == {"m1": "b1", "m2": "b2"}


def test_bulk_skips_unknown_members(db):
    db.activities.docs.append(_activity())
    db.members.docs.append(_member(id="m1"))
    out = run(server.record_bulk_attendance(
        _bulk_req([{"member_id": "m1"}, {"member_id": "ghost"}]), user()))
    assert out["count"] == 1
    assert len(db.attendance.docs) == 1


def test_bulk_unknown_activity_404(db):
    with pytest.raises(HTTPException) as e:
        run(server.record_bulk_attendance(
            _bulk_req([{"member_id": "m1"}], activity_id="ghost"), user()))
    assert e.value.status_code == 404


def test_bulk_existing_record_updated_not_duplicated(db):
    db.activities.docs.append(_activity())
    db.members.docs.append(_member(id="m1"))
    db.attendance.docs.append({
        "id": "r1", "member_id": "m1", "activity_id": "act1",
        "date": "2026-01-05", "status": "present", "branch_id": "b1",
    })
    out = run(server.record_bulk_attendance(
        _bulk_req([{"member_id": "m1", "status": "absent", "notes": "مريض"}]),
        user()))
    assert out["count"] == 1
    assert len(db.attendance.docs) == 1
    assert db.attendance.docs[0]["status"] == "absent"
    assert db.attendance.docs[0]["notes"] == "مريض"
    # branch stamp untouched by the update path
    assert db.attendance.docs[0]["branch_id"] == "b1"


def test_bulk_notifies_only_present(db):
    db.activities.docs.append(_activity())
    db.members.docs.extend([
        _member(id="m1"),
        _member(id="m2", member_code="1002"),
    ])
    run(server.record_bulk_attendance(
        _bulk_req([{"member_id": "m1", "status": "present"},
                   {"member_id": "m2", "status": "absent"}]),
        user()))
    notif_members = [n["member_id"] for n in db.member_notifications.docs]
    assert notif_members == ["m1"]
    statuses = {d["member_id"]: d["status"] for d in db.attendance.docs}
    assert statuses == {"m1": "present", "m2": "absent"}
