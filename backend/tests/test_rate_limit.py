"""Tests for the shared MongoDB-backed rate limiter (Task #278).

Locks in the contract of ``utils.rate_limit.check_rate_limit``:

  (a) calls under the cap are allowed and recorded,
  (b) the (limit+1)th call inside the window is denied,
  (c) hits older than ``window_seconds`` are evicted so the bucket
      eventually refills (sliding-window semantics),
  (d) different ``scope`` values do not collide for the same key,
  (e) the limiter fails open when the store raises so a Mongo outage
      can't take down every public endpoint.

A tiny in-memory fake stands in for the Mongo collection so the suite
needs no live database.
"""
import os
import sys
import asyncio
from datetime import datetime, timezone, timedelta

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class _FakeRateColl:
    def __init__(self):
        self.docs = {}

    async def create_index(self, *args, **kwargs):
        return None

    async def update_one(self, flt, update, upsert=False):
        doc_id = flt.get("_id")
        doc = self.docs.get(doc_id)
        if doc is None:
            if not upsert:
                return None
            doc = {"_id": doc_id, "hits": []}
            self.docs[doc_id] = doc
        pull = (update.get("$pull") or {}).get("hits") or {}
        if pull:
            cutoff = pull.get("$lt")
            if cutoff is not None:
                doc["hits"] = [t for t in doc.get("hits", []) if t >= cutoff]
        push = (update.get("$push") or {}).get("hits")
        if push is not None:
            doc.setdefault("hits", []).append(push)
        for k, v in (update.get("$set") or {}).items():
            doc[k] = v

    async def find_one(self, flt, _projection=None):
        doc = self.docs.get(flt.get("_id"))
        return dict(doc) if doc else None

    async def delete_one(self, flt):
        self.docs.pop(flt.get("_id"), None)


class _FakeControlDb:
    def __init__(self):
        self._rate = _FakeRateColl()

    def __getitem__(self, name):
        if name == "rate_limit_buckets":
            return self._rate
        raise KeyError(name)


@pytest.fixture
def limiter(monkeypatch):
    import control_db as control_db_mod
    import utils.rate_limit as rate_limit_mod

    fake = _FakeControlDb()
    monkeypatch.setattr(control_db_mod, "control_db", fake, raising=True)
    # Reset module-level cache so each test gets a fresh ensure_indexes.
    monkeypatch.setattr(rate_limit_mod, "_indexes_ready", False, raising=True)
    return rate_limit_mod, fake


def test_calls_under_limit_are_allowed(limiter):
    rl, _ = limiter
    results = [
        asyncio.run(rl.check_rate_limit("scope-a", "1.1.1.1", limit=3, window_seconds=60))
        for _ in range(3)
    ]
    assert results == [True, True, True]


def test_call_above_limit_is_denied(limiter):
    rl, _ = limiter
    for _ in range(3):
        asyncio.run(rl.check_rate_limit("scope-a", "1.1.1.1", limit=3, window_seconds=60))
    blocked = asyncio.run(
        rl.check_rate_limit("scope-a", "1.1.1.1", limit=3, window_seconds=60)
    )
    assert blocked is False


def test_old_hits_age_out_of_the_window(limiter):
    rl, fake = limiter
    # Burn the bucket.
    for _ in range(3):
        asyncio.run(rl.check_rate_limit("scope-a", "1.1.1.1", limit=3, window_seconds=60))
    assert asyncio.run(
        rl.check_rate_limit("scope-a", "1.1.1.1", limit=3, window_seconds=60)
    ) is False
    # Backdate the recorded hits past the window so they should be pruned.
    bucket = fake["rate_limit_buckets"].docs["scope-a:1.1.1.1"]
    bucket["hits"] = [datetime.now(timezone.utc) - timedelta(seconds=120) for _ in bucket["hits"]]
    # The next call prunes the stale entries and is therefore allowed again.
    assert asyncio.run(
        rl.check_rate_limit("scope-a", "1.1.1.1", limit=3, window_seconds=60)
    ) is True


def test_different_scopes_do_not_share_buckets(limiter):
    rl, _ = limiter
    for _ in range(3):
        asyncio.run(rl.check_rate_limit("scope-a", "1.1.1.1", limit=3, window_seconds=60))
    # scope-b for the same IP starts fresh.
    assert asyncio.run(
        rl.check_rate_limit("scope-b", "1.1.1.1", limit=3, window_seconds=60)
    ) is True
    # And scope-a is still capped.
    assert asyncio.run(
        rl.check_rate_limit("scope-a", "1.1.1.1", limit=3, window_seconds=60)
    ) is False


def test_limiter_fails_open_when_store_errors(monkeypatch):
    import control_db as control_db_mod
    import utils.rate_limit as rate_limit_mod

    class _BrokenColl:
        async def create_index(self, *a, **k):
            return None

        async def update_one(self, *a, **k):
            raise RuntimeError("mongo down")

        async def find_one(self, *a, **k):
            raise RuntimeError("mongo down")

    class _BrokenDb:
        def __getitem__(self, name):
            return _BrokenColl()

    monkeypatch.setattr(control_db_mod, "control_db", _BrokenDb(), raising=True)
    monkeypatch.setattr(rate_limit_mod, "_indexes_ready", False, raising=True)

    # Even though the store is unreachable, we let the request through
    # rather than 429-ing every public endpoint.
    assert asyncio.run(
        rate_limit_mod.check_rate_limit("scope", "ip", limit=1, window_seconds=60)
    ) is True


def test_zero_limit_short_circuits_to_allowed(limiter):
    rl, _ = limiter
    # Defensive: misconfigured callers (limit<=0) should not deny everything.
    assert asyncio.run(rl.check_rate_limit("scope", "ip", limit=0, window_seconds=60)) is True
    assert asyncio.run(rl.check_rate_limit("scope", "ip", limit=10, window_seconds=0)) is True
