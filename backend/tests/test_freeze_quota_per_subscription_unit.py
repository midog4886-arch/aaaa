"""Freeze quota: 30 days PER SUBSCRIPTION PERIOD (per renewal), not per year.

Covers backend/routes/freezes.py:
  - _current_period_window: latest start <= ref wins; next known start bounds
    the window; before-any-start falls back to earliest; no dates -> (None, None)
  - create_freeze quota: counts only freezes inside the current period window
    (renewal resets the counter; future-period freezes don't consume it;
    cancelled freezes don't count)
  - stats endpoint reflects the current period
"""
import asyncio
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SESSION_SECRET", "test-secret")

import routes.freezes as fz  # noqa: E402
from routes.freezes import _current_period_window, FreezeCreate  # noqa: E402


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── helper tests ─────────────────────────────────────────────────────────────

def _member(*starts):
    return {"activities": [{"start_date": s} for s in starts]}


def test_window_latest_start_wins():
    assert _current_period_window(_member("2026-01-01", "2026-06-01"), "2026-07-01") == ("2026-06-01", None)


def test_window_bounded_by_future_renewal():
    assert _current_period_window(_member("2026-01-01", "2026-06-01"), "2026-03-01") == ("2026-01-01", "2026-06-01")


def test_window_before_any_start_uses_earliest():
    assert _current_period_window(_member("2026-05-01", "2026-09-01"), "2026-02-01") == ("2026-05-01", "2026-09-01")


def test_window_no_dates():
    assert _current_period_window({"activities": [{}]}, "2026-02-01") == (None, None)
    assert _current_period_window(None, "2026-02-01") == (None, None)


# ── route-level quota tests with a fake db ───────────────────────────────────

class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return self._docs


def _match(doc, q):
    for k, v in q.items():
        if isinstance(v, dict):
            val = doc.get(k, "")
            if "$gte" in v and not val >= v["$gte"]:
                return False
            if "$lte" in v and not val <= v["$lte"]:
                return False
            if "$lt" in v and not val < v["$lt"]:
                return False
        elif k == "$or":
            if not any(_match(doc, sub) for sub in v):
                return False
        elif doc.get(k) != v:
            return False
    return True


class _Coll:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.inserted = []

    def find(self, q, proj=None):
        return _Cursor([d for d in self.docs if _match(d, q)])

    async def find_one(self, q, proj=None):
        for d in self.docs:
            if _match(d, q):
                return d
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)
        self.inserted.append(doc)

    async def update_one(self, q, u):
        pass


class _DB:
    def __init__(self, members, freezes):
        self.members = _Coll(members)
        self.member_freezes = _Coll(freezes)

    def __getattr__(self, name):
        # Any other collection touched by the route (notifications, audit…)
        # gets an empty throwaway store.
        coll = _Coll()
        setattr(self, name, coll)
        return coll


def _freeze_doc(start, end, days, status="active"):
    return {"member_id": "m1", "start_date": start, "end_date": end,
            "duration_days": days, "status": status}


def _mk_db(freezes, starts=("2026-01-01", "2026-06-01")):
    member = {"id": "m1", "activities": [
        {"start_date": s, "end_date": "2099-01-01", "schedule": ""} for s in starts
    ]}
    return _DB([member], freezes)


USER = {"username": "t", "is_admin": True}


def _create(db, start, end):
    orig = fz.db
    fz.db = db
    try:
        return run(fz.create_freeze(
            FreezeCreate(member_id="m1", start_date=start, end_date=end, reason="personal"),
            current_user=USER))
    finally:
        fz.db = orig


def test_renewal_resets_quota():
    # 30 days already used in the OLD period; new freeze after renewal is OK.
    db = _mk_db([_freeze_doc("2026-02-01", "2026-03-02", 30)])
    _create(db, "2026-06-10", "2026-06-12")
    assert db.member_freezes.inserted


def test_quota_enforced_within_period():
    db = _mk_db([_freeze_doc("2026-06-05", "2026-07-04", 30)])
    with pytest.raises(HTTPException) as e:
        _create(db, "2026-07-10", "2026-07-11")
    assert e.value.status_code == 400


def test_future_period_freeze_does_not_consume_current_quota():
    # Freeze booked inside the upcoming renewal period must not block a
    # freeze in the CURRENT period.
    db = _mk_db([_freeze_doc("2026-06-10", "2026-07-09", 30)])
    _create(db, "2026-02-01", "2026-02-05")
    assert db.member_freezes.inserted


def test_cancelled_freezes_do_not_count():
    db = _mk_db([_freeze_doc("2026-06-05", "2026-07-04", 30, status="cancelled")])
    _create(db, "2026-07-10", "2026-07-12")
    assert db.member_freezes.inserted


def test_stats_scoped_to_current_period(monkeypatch):
    import datetime as _dt
    db = _mk_db([
        _freeze_doc("2026-02-01", "2026-02-10", 10),   # old period
        _freeze_doc("2026-06-05", "2026-06-07", 3),    # current period
    ])
    orig = fz.db
    fz.db = db
    try:
        stats = run(fz.get_member_freeze_stats("m1", current_user=USER))
    finally:
        fz.db = orig
    # Today (real clock) is after 2026-06-01 renewal in this dataset only if
    # the test runs after that date; instead assert via period_start logic:
    assert stats["period_start"] in ("2026-01-01", "2026-06-01")
    if stats["period_start"] == "2026-06-01":
        assert stats["total_days_frozen"] == 3
        assert stats["remaining_days"] == 27
    else:
        assert stats["total_days_frozen"] == 10
