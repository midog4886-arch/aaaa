"""Regression tests for the cross-academy push-cleanup sweep.

``cleanup_superseded_subscriptions`` walks every active academy, groups all
``is_active`` push subscriptions by device identity (FCM token for android/ios,
endpoint for web) and — for any device active in MORE THAN ONE academy — keeps
only the most-recently-updated row active, deactivating the older cross-tenant
duplicates in their own academy DBs with
``deactivated_reason="superseded_cross_tenant"``.

This complements the inline dedup in ``subscribe_to_push`` (covered by
``test_push_cross_tenant_dedup.py``): the inline path only fires the moment an
endpoint is re-claimed, whereas this sweep mops up stale duplicates left behind
on shared devices when the previous academy member never returned.

No live MongoDB is required: a fake mongo client routed through the real
``TenantDBProxy`` gives each academy its own database, and ``control_db`` is
stubbed so ``list_active_tenants`` resolves every academy.
"""
import os
import sys
import asyncio
import importlib

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _get_field(doc, dotted):
    cur = doc
    for part in dotted.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _matches(doc, query):
    for key, val in query.items():
        if key == "$or":
            if not any(_matches(doc, sub) for sub in val):
                return False
        elif key == "$and":
            if not all(_matches(doc, sub) for sub in val):
                return False
        else:
            actual = _get_field(doc, key)
            if isinstance(val, dict) and "$in" in val:
                if actual not in val["$in"]:
                    return False
            else:
                if actual != val:
                    return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def __aiter__(self):
        self._it = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class _Result:
    def __init__(self, modified=0):
        self.modified_count = modified


class FakeCollection:
    """Minimal async push_subscriptions collection.

    ``fail_on_find`` / ``fail_on_update`` let a test simulate a single bad
    academy DB so we can prove one tenant's failure never aborts the sweep.
    """

    def __init__(self, fail_on_find=False, fail_on_update=False):
        self.docs = []
        self.fail_on_find = fail_on_find
        self.fail_on_update = fail_on_update

    def find(self, query, projection=None):
        if self.fail_on_find:
            raise RuntimeError("simulated scan failure")
        return _FakeCursor([dict(d) for d in self.docs if _matches(d, query)])

    async def update_one(self, query, update):
        if self.fail_on_update:
            raise RuntimeError("simulated deactivate failure")
        for d in self.docs:
            if _matches(d, query):
                d.update(update.get("$set", {}))
                return _Result(modified=1)
        return _Result(modified=0)


class FakeDB:
    def __init__(self, coll):
        self._c = {"push_subscriptions": coll}

    def __getitem__(self, name):
        return self._c[name]

    def __getattr__(self, name):
        return self._c[name]


class FakeClient:
    def __init__(self, by_db):
        self.dbs = by_db

    def __getitem__(self, name):
        return self.dbs[name]


def _setup(monkeypatch, seeds, fail_find=(), fail_update=()):
    """Wire up N academies, a fake mongo behind the real TenantDBProxy and a
    stubbed control_db.

    ``seeds`` maps slug -> list of subscription docs to seed in that academy.
    Returns ``(push_mod, tenant_mod, colls)`` where ``colls`` maps slug ->
    FakeCollection so the test can inspect the docs after the sweep.
    """
    slugs = list(seeds.keys())
    tenants = [
        {"id": s, "slug": s, "db_name": f"champions_{s}", "status": "active"}
        for s in slugs
    ]

    colls = {}
    by_db = {}
    for s in slugs:
        coll = FakeCollection(
            fail_on_find=(s in fail_find),
            fail_on_update=(s in fail_update),
        )
        coll.docs = [dict(d) for d in seeds[s]]
        colls[s] = coll
        by_db[f"champions_{s}"] = FakeDB(coll)

    class _FakeTenants:
        def find(self, query, projection=None):
            status = (query or {}).get("status", {})
            allowed = status.get("$in") if isinstance(status, dict) else None
            rows = list(tenants)
            if allowed is not None:
                rows = [r for r in rows if r.get("status") in allowed]
            return _FakeCursor(rows)

    fake_control = type("M", (), {
        "control_db": type("C", (), {"tenants": _FakeTenants()})()
    })
    monkeypatch.setitem(sys.modules, "control_db", fake_control)

    from database import TenantDBProxy
    proxy = TenantDBProxy(FakeClient(by_db))

    tenant_mod = importlib.import_module("utils.tenant")
    push_mod = importlib.import_module("routes.push_notifications")
    monkeypatch.setattr(push_mod, "db", proxy)

    return push_mod, tenant_mod, colls


@pytest.fixture
def fresh_modules(monkeypatch):
    monkeypatch.setenv("STRICT_TENANT_CONTEXT", "1")
    for mod in ("utils.tenant", "control_db", "database", "routes.push_notifications"):
        sys.modules.pop(mod, None)
    yield
    for mod in ("utils.tenant", "control_db", "routes.push_notifications"):
        sys.modules.pop(mod, None)


def _web(sub_id, endpoint, updated_at, active=True):
    return {
        "id": sub_id,
        "endpoint": endpoint,
        "keys": {"p256dh": "x", "auth": "y"},
        "platform": "web",
        "is_active": active,
        "updated_at": updated_at,
    }


def _fcm(sub_id, endpoint, fcm_token, updated_at, active=True):
    return {
        "id": sub_id,
        "endpoint": endpoint,
        "keys": {"fcm_token": fcm_token, "platform": "android"},
        "platform": "android",
        "is_active": active,
        "updated_at": updated_at,
    }


def _by_id(coll, sub_id):
    for d in coll.docs:
        if d.get("id") == sub_id:
            return d
    return None


def test_keeps_newest_and_deactivates_older_cross_tenant(monkeypatch, fresh_modules):
    """The most-recently-updated row per device wins; older cross-tenant
    duplicates are deactivated with the correct reason; unique rows untouched."""
    web_endpoint = "https://fcm.googleapis.com/web/SHARED"
    fcm_token = "device-token-SHARED"

    seeds = {
        # alpha holds the NEWEST row for both shared devices -> stays active.
        "alpha": [
            _web("a-web", web_endpoint, "2026-05-01T00:00:00+00:00"),
            _fcm("a-fcm", "fcm://new-a", fcm_token, "2026-04-01T00:00:00+00:00"),
        ],
        # beta has an older web row (loser) + a device only it holds (unique).
        "beta": [
            _web("b-web", web_endpoint, "2026-01-01T00:00:00+00:00"),
            _web("b-unique", "https://fcm.googleapis.com/web/ONLY-B",
                 "2026-02-01T00:00:00+00:00"),
        ],
        # gamma has an older fcm row for the shared token (loser).
        "gamma": [
            _fcm("g-fcm", "fcm://old-g", fcm_token, "2026-03-01T00:00:00+00:00"),
        ],
    }

    push_mod, _tenant_mod, colls = _setup(monkeypatch, seeds)

    summary = asyncio.run(push_mod.cleanup_superseded_subscriptions())

    # --- winners stay active, no deactivation metadata written ---
    a_web = _by_id(colls["alpha"], "a-web")
    a_fcm = _by_id(colls["alpha"], "a-fcm")
    assert a_web["is_active"] is True and "deactivated_reason" not in a_web
    assert a_fcm["is_active"] is True and "deactivated_reason" not in a_fcm

    # --- older cross-tenant duplicates deactivated with the right reason ---
    b_web = _by_id(colls["beta"], "b-web")
    g_fcm = _by_id(colls["gamma"], "g-fcm")
    assert b_web["is_active"] is False
    assert b_web["deactivated_reason"] == "superseded_cross_tenant"
    assert b_web.get("deactivated_at")
    assert g_fcm["is_active"] is False
    assert g_fcm["deactivated_reason"] == "superseded_cross_tenant"

    # --- a device held by only one academy is left completely alone ---
    b_unique = _by_id(colls["beta"], "b-unique")
    assert b_unique["is_active"] is True and "deactivated_reason" not in b_unique

    # --- summary accounting ---
    assert summary["tenants_scanned"] == 3
    assert summary["active_subscriptions"] == 5
    assert summary["duplicate_devices"] == 2
    assert summary["deactivated"] == 2
    assert summary["errors"] == []


def test_scan_failure_in_one_tenant_does_not_abort_sweep(monkeypatch, fresh_modules):
    """If reading one academy's DB blows up, the sweep records the error but
    still deduplicates every other device it could see."""
    web_endpoint = "https://fcm.googleapis.com/web/SHARED"

    seeds = {
        "alpha": [_web("a-web", web_endpoint, "2026-05-01T00:00:00+00:00")],
        "beta": [_web("b-web", web_endpoint, "2026-01-01T00:00:00+00:00")],
        # gamma's scan raises; its rows are never seen but the sweep continues.
        "gamma": [_web("g-web", "https://fcm.googleapis.com/web/ONLY-G",
                       "2026-03-01T00:00:00+00:00")],
    }

    push_mod, _tenant_mod, colls = _setup(monkeypatch, seeds, fail_find=("gamma",))

    summary = asyncio.run(push_mod.cleanup_superseded_subscriptions())

    # The shared web device was still deduplicated across alpha + beta.
    assert _by_id(colls["alpha"], "a-web")["is_active"] is True
    b_web = _by_id(colls["beta"], "b-web")
    assert b_web["is_active"] is False
    assert b_web["deactivated_reason"] == "superseded_cross_tenant"

    # gamma's own row is untouched (never scanned, never matched).
    assert _by_id(colls["gamma"], "g-web")["is_active"] is True

    # The failure is reported but the sweep was not aborted.
    assert summary["tenants_scanned"] == 3
    assert summary["deactivated"] == 1
    assert len(summary["errors"]) == 1
    assert "gamma" in summary["errors"][0]


def test_deactivate_failure_in_one_tenant_does_not_abort_sweep(monkeypatch, fresh_modules):
    """If deactivating a loser in one academy raises, the error is recorded but
    losers in other academies are still deactivated."""
    web_endpoint = "https://fcm.googleapis.com/web/SHARED"
    fcm_token = "device-token-SHARED"

    seeds = {
        # alpha holds the newest row for BOTH shared devices.
        "alpha": [
            _web("a-web", web_endpoint, "2026-05-01T00:00:00+00:00"),
            _fcm("a-fcm", "fcm://new-a", fcm_token, "2026-05-01T00:00:00+00:00"),
        ],
        # beta is the loser for the web device, but its update_one raises.
        "beta": [_web("b-web", web_endpoint, "2026-01-01T00:00:00+00:00")],
        # gamma is the loser for the fcm device and deactivates cleanly.
        "gamma": [_fcm("g-fcm", "fcm://old-g", fcm_token, "2026-02-01T00:00:00+00:00")],
    }

    push_mod, _tenant_mod, colls = _setup(monkeypatch, seeds, fail_update=("beta",))

    summary = asyncio.run(push_mod.cleanup_superseded_subscriptions())

    # beta's deactivation failed -> still active, error recorded.
    b_web = _by_id(colls["beta"], "b-web")
    assert b_web["is_active"] is True
    assert any("beta" in e for e in summary["errors"])

    # gamma's deactivation still succeeded despite beta failing.
    g_fcm = _by_id(colls["gamma"], "g-fcm")
    assert g_fcm["is_active"] is False
    assert g_fcm["deactivated_reason"] == "superseded_cross_tenant"

    assert summary["duplicate_devices"] == 2
    assert summary["deactivated"] == 1
    assert len(summary["errors"]) == 1


def test_cleanup_endpoint_admin_guard(monkeypatch, fresh_modules):
    """The HTTP entry point is admin-only: a non-admin caller gets 403 and the
    sweep never runs; an admin caller runs the sweep and gets its summary back."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    push_mod = importlib.import_module("routes.push_notifications")
    from routes.common import get_current_user

    # Stub the sweep so the endpoint test focuses on the guard, not the DB walk,
    # and so we can prove whether the sweep was actually invoked.
    sentinel = {"tenants_scanned": 7, "deactivated": 3, "errors": []}
    calls = {"n": 0}

    async def fake_sweep():
        calls["n"] += 1
        return sentinel

    monkeypatch.setattr(push_mod, "cleanup_superseded_subscriptions", fake_sweep)

    app = FastAPI()
    app.include_router(push_mod.router)
    client = TestClient(app)

    # --- non-admin -> 403, sweep NOT run ---
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u1", "username": "bob", "is_admin": False
    }
    r_forbidden = client.post("/push-notifications/cleanup-superseded")
    assert r_forbidden.status_code == 403, r_forbidden.text
    assert calls["n"] == 0, "sweep must not run for a non-admin caller"

    # --- admin -> 200, sweep runs once, summary returned verbatim ---
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u2", "username": "ada", "is_admin": True
    }
    r_ok = client.post("/push-notifications/cleanup-superseded")
    assert r_ok.status_code == 200, r_ok.text
    assert r_ok.json() == sentinel
    assert calls["n"] == 1, "sweep must run exactly once for an admin caller"

    app.dependency_overrides.clear()


def test_list_tenants_failure_records_error_and_no_deactivations(monkeypatch, fresh_modules):
    """If the academy directory itself is unreachable, the sweep early-returns a
    summary with the error recorded and nothing scanned/deactivated — never raises."""
    tenant_mod = importlib.import_module("utils.tenant")
    push_mod = importlib.import_module("routes.push_notifications")

    async def _boom():
        raise RuntimeError("control db unreachable")

    # cleanup_superseded_subscriptions imports list_active_tenants from
    # utils.tenant at call time, so patching the attribute there takes effect.
    monkeypatch.setattr(tenant_mod, "list_active_tenants", _boom)

    summary = asyncio.run(push_mod.cleanup_superseded_subscriptions())

    assert summary["tenants_scanned"] == 0
    assert summary["active_subscriptions"] == 0
    assert summary["duplicate_devices"] == 0
    assert summary["deactivated"] == 0
    assert len(summary["errors"]) == 1
    assert "list tenants failed" in summary["errors"][0]
    assert "control db unreachable" in summary["errors"][0]
