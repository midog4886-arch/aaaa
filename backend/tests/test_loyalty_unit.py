"""In-process unit tests for the Loyalty system (replaces the live-HTTP
test_loyalty_system.py).

Direct route-handler calls with a monkeypatched module-level ``db`` on
backend/routes/loyalty.py — NO server, NO real DB. Loyalty handlers take no
auth Depends (auth is enforced at the router include level), so they are called
directly with their pydantic request models imported from routes.loyalty.
"""
import asyncio
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SESSION_SECRET", "test-secret")

from routes import loyalty as loy  # noqa: E402


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

    def sort(self, field, direction=1):
        try:
            self._docs.sort(key=lambda d: d.get(field, 0), reverse=(direction == -1))
        except TypeError:
            pass
        return self

    def limit(self, n):
        self._docs = self._docs[:n]
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
                dv = doc.get(k)
                if "$in" in v and dv not in v["$in"]:
                    return False
            else:
                if doc.get(k) != v:
                    return False
        return True

    async def insert_one(self, doc):
        stored = dict(doc)
        # emulate the ObjectId Mongo would assign
        stored.setdefault("_id", f"oid-{len(self.docs)}")
        self.docs.append(stored)
        class R:
            inserted_id = stored["_id"]
        return R()

    async def find_one(self, query, proj=None):
        for d in self.docs:
            if self._matches(d, query):
                return dict(d)
        return None

    async def update_one(self, query, update, upsert=False):
        class R:
            matched_count = 0
            modified_count = 0
        for d in self.docs:
            if self._matches(d, query):
                d.update(update.get("$set", {}))
                for k, inc in update.get("$inc", {}).items():
                    d[k] = d.get(k, 0) + inc
                for k in update.get("$unset", {}):
                    d.pop(k, None)
                R.matched_count = 1
                R.modified_count = 1
                return R()
        if upsert:
            doc = {k: v for k, v in query.items() if not isinstance(v, dict)}
            doc.update(update.get("$set", {}))
            for k, inc in update.get("$inc", {}).items():
                doc[k] = doc.get(k, 0) + inc
            self.docs.append(doc)
        return R()

    async def delete_one(self, query):
        class R:
            deleted_count = 0
        for i, d in enumerate(self.docs):
            if self._matches(d, query):
                del self.docs[i]
                R.deleted_count = 1
                return R()
        return R()

    async def count_documents(self, query):
        return sum(1 for d in self.docs if self._matches(d, query))

    def find(self, query=None, proj=None):
        q = query or {}
        return _FakeCursor([dict(d) for d in self.docs if self._matches(d, q)])

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
    monkeypatch.setattr(loy, "db", fdb)
    return fdb


def _reward_model(**over):
    base = dict(
        name_ar="خصم", name_en="Discount",
        points_required=500, reward_type="discount",
        discount_percentage=10.0, quantity_available=-1, is_active=True,
    )
    base.update(over)
    return loy.RewardCreate(**base)


# ── settings ─────────────────────────────────────────────────────────────────

def test_points_settings_returns_defaults_when_empty(db):
    out = run(loy.get_points_settings())
    # PointsSettings defaults
    assert out["attendance_points"] == 10
    assert out["referral_points"] == 200
    for f in ("streak_5_days_bonus", "monthly_renewal_points", "birthday_points"):
        assert isinstance(out[f], int)


def test_points_settings_returns_stored(db):
    db.loyalty_settings.docs.append({"type": "points", "attendance_points": 25})
    out = run(loy.get_points_settings())
    assert out["attendance_points"] == 25
    # serialize_doc adds an 'id' key
    assert "id" in out


# ── rewards ──────────────────────────────────────────────────────────────────

def test_create_reward(db):
    out = run(loy.create_reward(_reward_model()))
    assert "id" in out
    assert len(db.loyalty_rewards.docs) == 1
    stored = db.loyalty_rewards.docs[0]
    assert stored["redeemed_count"] == 0
    assert stored["name_ar"] == "خصم"


def test_get_rewards_active_only_filters(db):
    run(loy.create_reward(_reward_model(name_en="Active", points_required=100, is_active=True)))
    run(loy.create_reward(_reward_model(name_en="Inactive", points_required=200, is_active=False)))
    all_rewards = run(loy.get_rewards(active_only=False))
    assert len(all_rewards) == 2
    active = run(loy.get_rewards(active_only=True))
    assert len(active) == 1
    assert active[0]["name_en"] == "Active"
    assert all(r["is_active"] for r in active)


def test_get_rewards_sorted_by_points(db):
    run(loy.create_reward(_reward_model(points_required=900)))
    run(loy.create_reward(_reward_model(points_required=100)))
    run(loy.create_reward(_reward_model(points_required=500)))
    rewards = run(loy.get_rewards())
    assert [r["points_required"] for r in rewards] == [100, 500, 900]


# ── member points adjustment ─────────────────────────────────────────────────

def test_adjust_member_points_positive(db):
    db.members.docs.append({"id": "m1", "name_ar": "علي"})
    out = run(loy.adjust_member_points(loy.ManualPointsAdjust(
        member_id="m1", points=50, reason="مكافأة")))
    assert out["points_adjusted"] == 50
    mp = db.member_points.docs[0]
    assert mp["total_points"] == 50
    assert mp["available_points"] == 50
    # A history entry and a notification were logged.
    assert len(db.points_history.docs) == 1
    assert db.points_history.docs[0]["points"] == 50
    assert len(db.member_notifications.docs) == 1


def test_adjust_member_points_negative_only_available(db):
    """A deduction lowers available_points but never inflates total_points."""
    db.members.docs.append({"id": "m1", "name_ar": "علي"})
    run(loy.adjust_member_points(loy.ManualPointsAdjust(
        member_id="m1", points=100, reason="add")))
    run(loy.adjust_member_points(loy.ManualPointsAdjust(
        member_id="m1", points=-25, reason="deduct")))
    mp = db.member_points.docs[0]
    # total only increased by the positive adjustment
    assert mp["total_points"] == 100
    # available reflects both: 100 - 25
    assert mp["available_points"] == 75


def test_adjust_member_points_nonexistent_member_404(db):
    with pytest.raises(HTTPException) as e:
        run(loy.adjust_member_points(loy.ManualPointsAdjust(
            member_id="ghost", points=10, reason="x")))
    assert e.value.status_code == 404
    assert db.member_points.docs == []


# ── redemptions listing / status filter ──────────────────────────────────────

def test_get_all_redemptions_enriches_member(db):
    db.members.docs.append({"id": "m1", "name_ar": "علي", "member_code": "A1"})
    db.redemption_requests.docs.append({
        "member_id": "m1", "reward_name_ar": "خصم", "status": "pending",
        "created_at": "2026-01-01",
    })
    out = run(loy.get_all_redemptions())
    assert len(out) == 1
    assert out[0]["member_name"] == "علي"
    assert out[0]["member_code"] == "A1"


def test_get_redemptions_status_filter(db):
    db.redemption_requests.docs.extend([
        {"member_id": "m1", "status": "pending", "created_at": "2026-01-02"},
        {"member_id": "m1", "status": "approved", "created_at": "2026-01-01"},
        {"member_id": "m1", "status": "pending", "created_at": "2026-01-03"},
    ])
    pending = run(loy.get_all_redemptions(status="pending"))
    assert len(pending) == 2
    assert all(r["status"] == "pending" for r in pending)
    all_r = run(loy.get_all_redemptions())
    assert len(all_r) == 3
