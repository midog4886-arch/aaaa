"""In-process unit tests for Attendance (replaces the live-HTTP test_attendance.py).

Direct route-handler calls with a monkeypatched module-level ``db`` on
backend/routes/attendance.py — NO server, NO real DB. Auth Depends is bypassed
by passing a fake ``current_user`` dict straight into the handler.

Routing facts honoured here:
  - manual check-in (create_attendance) and QR check-in (qr_checkin) live in
    routes/attendance.py — the handlers under test. server.py has lookalike
    DEAD handlers which are intentionally NOT tested.
  - every attendance write must stamp branch_id: VIP members record under the
    scanning user's branch, everyone else under the member's own branch.
"""
import asyncio
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SESSION_SECRET", "test-secret")

from routes import attendance as att  # noqa: E402


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── fakes ────────────────────────────────────────────────────────────────────

class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, *a, **k):
        # Attendance queries only sort; we keep insertion order (tests do not
        # assert ordering of enriched list results).
        return self

    async def to_list(self, n=None):
        return list(self._docs)


class _FakeCollection:
    def __init__(self):
        self.docs = []

    @staticmethod
    def _matches(doc, query):
        for k, v in query.items():
            if isinstance(v, dict):
                # support $in / $lte / $gte / $regex minimally
                dv = doc.get(k)
                if "$in" in v and dv not in v["$in"]:
                    return False
                if "$lte" in v and not (dv is not None and dv <= v["$lte"]):
                    return False
                if "$gte" in v and not (dv is not None and dv >= v["$gte"]):
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

    async def delete_one(self, query):
        for i, d in enumerate(self.docs):
            if self._matches(d, query):
                del self.docs[i]
                return

    async def count_documents(self, query):
        return sum(1 for d in self.docs if self._matches(d, query))

    def find(self, query, proj=None):
        return _FakeCursor([dict(d) for d in self.docs if self._matches(d, query)])

    def aggregate(self, pipeline):
        return _FakeCursor([])


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
    monkeypatch.setattr(att, "db", fdb)
    # No loyalty award wired -> attendance points path is skipped.
    monkeypatch.setattr(att, "loyalty_award_points", None)
    # These fixtures exercise stamping/scanning, not subscription eligibility.
    # Real rejection/valid-history cases live in test_attendance_window_and_member_identity.
    async def eligible(*args, **kwargs):
        return None
    monkeypatch.setattr(att, "enforce_attendance_window", eligible)
    return fdb


def admin_user(branch_id=None):
    return {"id": "u1", "username": "admin", "name": "Admin",
            "is_admin": True, "branch_id": branch_id, "permissions": []}


# ── create_attendance (manual) ───────────────────────────────────────────────

def test_create_attendance_stamps_member_branch(db):
    """Regular member: record.branch_id == member's own branch (not scanner's)."""
    db.members.docs.append({"id": "m1", "name_ar": "علي", "member_code": "A1",
                            "branch_id": "branch-member", "is_vip": False})
    user = admin_user(branch_id="branch-scanner")
    out = run(att.create_attendance(
        att.AttendanceCreate(member_id="m1", activity_id="act1", date="2026-01-05"),
        user))
    assert out["record"]["branch_id"] == "branch-member"
    assert out["record"]["member_name"] == "علي"
    assert len(db.attendance.docs) == 1
    assert db.attendance.docs[0]["branch_id"] == "branch-member"


def test_create_attendance_vip_stamps_scanner_branch(db):
    """VIP member trains at any branch: record under the scanning user's branch."""
    db.members.docs.append({"id": "m2", "name_ar": "VIP", "member_code": "V1",
                            "branch_id": "branch-home", "is_vip": True})
    user = admin_user(branch_id="branch-scanner")
    out = run(att.create_attendance(
        att.AttendanceCreate(member_id="m2", activity_id="act1", date="2026-01-05"),
        user))
    assert out["record"]["branch_id"] == "branch-scanner"


def test_create_attendance_member_not_found_404(db):
    with pytest.raises(HTTPException) as e:
        run(att.create_attendance(
            att.AttendanceCreate(member_id="ghost", activity_id="act1", date="2026-01-05"),
            admin_user()))
    assert e.value.status_code == 404


def test_create_attendance_duplicate_same_day_400(db):
    """Second check-in for same member+activity+date is rejected."""
    db.members.docs.append({"id": "m1", "name_ar": "علي", "branch_id": "b1"})
    run(att.create_attendance(
        att.AttendanceCreate(member_id="m1", activity_id="act1", date="2026-01-05"),
        admin_user()))
    with pytest.raises(HTTPException) as e:
        run(att.create_attendance(
            att.AttendanceCreate(member_id="m1", activity_id="act1", date="2026-01-05"),
            admin_user()))
    assert e.value.status_code == 400
    assert "Already checked in" in e.value.detail
    assert len(db.attendance.docs) == 1


def test_create_attendance_frozen_membership_400(db):
    db.members.docs.append({"id": "m1", "name_ar": "علي", "branch_id": "b1"})
    db.member_freezes.docs.append({
        "member_id": "m1", "status": "active",
        "start_date": "2026-01-01", "end_date": "2026-01-31",
    })
    with pytest.raises(HTTPException) as e:
        run(att.create_attendance(
            att.AttendanceCreate(member_id="m1", activity_id="act1", date="2026-01-05"),
            admin_user()))
    assert e.value.status_code == 400
    assert "2026-01-31" in e.value.detail
    assert len(db.attendance.docs) == 0


def test_create_attendance_enriches_activity_name(db):
    db.members.docs.append({"id": "m1", "name_ar": "علي", "branch_id": "b1"})
    db.activities.docs.append({"id": "act1", "name_ar": "كاراتيه"})
    out = run(att.create_attendance(
        att.AttendanceCreate(member_id="m1", activity_id="act1", date="2026-01-05"),
        admin_user()))
    assert out["record"]["activity_name"] == "كاراتيه"
    assert out["record"]["status"] == "present"


# ── qr_checkin ───────────────────────────────────────────────────────────────

def test_qr_checkin_happy_path(db):
    db.members.docs.append({
        "id": "m1", "member_code": "1001", "name_ar": "علي",
        "branch_id": "b-member",
        "activities": [{"activity_id": "act1", "activity_name": "كاراتيه", "status": "active"}],
    })
    out = run(att.qr_checkin("1001", current_user=admin_user(branch_id="b-scanner")))
    assert out["status"] == "success"
    assert out["member"]["name"] == "علي"
    assert len(db.attendance.docs) == 1
    # Regular member -> own branch stamped.
    assert db.attendance.docs[0]["branch_id"] == "b-member"


def test_qr_checkin_vip_stamps_scanner_branch(db):
    db.members.docs.append({
        "id": "m2", "member_code": "2002", "name_ar": "VIP", "is_vip": True,
        "branch_id": "b-home",
        "activities": [{"activity_id": "act1", "activity_name": "X", "status": "active"}],
    })
    out = run(att.qr_checkin("2002", current_user=admin_user(branch_id="b-scanner")))
    assert out["status"] == "success"
    assert db.attendance.docs[0]["branch_id"] == "b-scanner"


def test_qr_checkin_invalid_member_404(db):
    with pytest.raises(HTTPException) as e:
        run(att.qr_checkin("does-not-exist", current_user=admin_user()))
    assert e.value.status_code == 404


def test_qr_checkin_already_checked_in(db):
    db.members.docs.append({
        "id": "m1", "member_code": "1001", "name_ar": "علي", "branch_id": "b1",
        "activities": [{"activity_id": "act1", "activity_name": "X", "status": "active"}],
    })
    run(att.qr_checkin("1001", current_user=admin_user()))
    out = run(att.qr_checkin("1001", current_user=admin_user()))
    assert out["status"] == "already_checked_in"
    assert len(db.attendance.docs) == 1


def test_qr_checkin_no_active_activity_400(db):
    db.members.docs.append({
        "id": "m1", "member_code": "1001", "name_ar": "علي", "branch_id": "b1",
        "activities": [],
    })
    with pytest.raises(HTTPException) as e:
        run(att.qr_checkin("1001", current_user=admin_user()))
    assert e.value.status_code == 400


# ── report / date-filter logic ───────────────────────────────────────────────

def test_member_report_summary_counts(db):
    db.attendance.docs.extend([
        {"member_id": "m1", "date": "2026-01-05", "activity_name": "A", "status": "present"},
        {"member_id": "m1", "date": "2026-01-06", "activity_name": "A", "status": "absent"},
        {"member_id": "m1", "date": "2026-01-07", "activity_name": "B", "status": "present"},
        {"member_id": "other", "date": "2026-01-05", "activity_name": "A", "status": "present"},
    ])
    out = run(att.get_member_attendance_report("m1", current_user=admin_user()))
    assert out["summary"]["total_records"] == 3
    assert out["summary"]["present_count"] == 2
    assert out["summary"]["absent_count"] == 1
    assert out["by_activity"] == {"A": 2, "B": 1}


def test_member_report_date_filter(db):
    db.attendance.docs.extend([
        {"member_id": "m1", "date": "2026-01-01", "activity_name": "A", "status": "present"},
        {"member_id": "m1", "date": "2026-01-15", "activity_name": "A", "status": "present"},
        {"member_id": "m1", "date": "2026-02-01", "activity_name": "A", "status": "present"},
    ])
    out = run(att.get_member_attendance_report(
        "m1", date_from="2026-01-10", date_to="2026-01-31", current_user=admin_user()))
    assert out["summary"]["total_records"] == 1
    assert out["records"][0]["date"] == "2026-01-15"


def test_get_attendance_branch_scoping_for_non_admin(db):
    """A single-branch non-admin is pinned to their branch by resolve_branch_filter."""
    db.attendance.docs.extend([
        {"member_id": "m1", "date": "2026-01-05", "branch_id": "b1"},
        {"member_id": "m2", "date": "2026-01-05", "branch_id": "b2"},
    ])
    non_admin = {"id": "u2", "username": "staff", "is_admin": False,
                 "branch_id": "b1", "branch_ids": ["b1"], "permissions": []}
    out = run(att.get_attendance(current_user=non_admin))
    assert {r["branch_id"] for r in out} == {"b1"}


def test_activity_report_groups_by_date(db):
    db.attendance.docs.extend([
        {"member_id": "m1", "activity_id": "act1", "date": "2026-01-05"},
        {"member_id": "m2", "activity_id": "act1", "date": "2026-01-05"},
        {"member_id": "m1", "activity_id": "act1", "date": "2026-01-06"},
        {"member_id": "m3", "activity_id": "other", "date": "2026-01-05"},
    ])
    out = run(att.get_activity_attendance_report("act1", current_user=admin_user()))
    assert out["total_attendance"] == 3
    assert out["unique_members"] == 2
    assert set(out["by_date"].keys()) == {"2026-01-05", "2026-01-06"}
