"""Regression tests for cross-tenant push-subscription dedup (Task #329).

A web-push endpoint (and an FCM device token) is tied to the browser/app
install, NOT to whoever is logged in. On a SHARED device, an academy B member
subscribes (row active in B's DB), then later an academy A member subscribes on
the same browser/device. Once the endpoint/token is (re)claimed for academy A,
``subscribe_to_push`` MUST deactivate that same endpoint/token in every OTHER
academy's DB so academy B can no longer push to a device now used by academy A.

These tests pin that behaviour for both branches:
  * web-push  — matched purely on ``endpoint``.
  * FCM       — matched on ``endpoint`` OR ``keys.fcm_token`` (android/ios),
                so a NEW endpoint with the SAME fcm_token still deactivates the
                stale row in the other tenant.

No live MongoDB is required: a fake mongo client routed through the real
``TenantDBProxy`` gives each academy its own database, and ``control_db`` is
stubbed so ``list_active_tenants`` resolves both academies.
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
    def __init__(self, modified=0, inserted_id=None):
        self.modified_count = modified
        self.inserted_id = inserted_id


class FakeCollection:
    def __init__(self):
        self.docs = []
        self._counter = 0

    async def find_one(self, query, projection=None):
        for d in self.docs:
            if _matches(d, query):
                return dict(d)
        return None

    async def insert_one(self, doc):
        d = dict(doc)
        if "_id" not in d:
            self._counter += 1
            d["_id"] = f"oid-{id(self)}-{self._counter}"
        self.docs.append(d)
        return _Result(inserted_id=d["_id"])

    async def update_one(self, query, update):
        for d in self.docs:
            if _matches(d, query):
                d.update(update.get("$set", {}))
                return _Result(modified=1)
        return _Result(modified=0)

    async def update_many(self, query, update):
        n = 0
        for d in self.docs:
            if _matches(d, query):
                d.update(update.get("$set", {}))
                n += 1
        return _Result(modified=n)

    def find(self, query, projection=None):
        return _FakeCursor([dict(d) for d in self.docs if _matches(d, query)])


class FakeDB:
    def __init__(self):
        self._c = {}

    def __getitem__(self, name):
        return self._c.setdefault(name, FakeCollection())

    def __getattr__(self, name):
        return self[name]


class FakeClient:
    def __init__(self):
        self.dbs = {}

    def __getitem__(self, name):
        return self.dbs.setdefault(name, FakeDB())


@pytest.fixture
def fresh_modules(monkeypatch):
    monkeypatch.setenv("STRICT_TENANT_CONTEXT", "1")
    for mod in ("utils.tenant", "control_db", "database", "routes.push_notifications"):
        sys.modules.pop(mod, None)
    yield
    for mod in ("utils.tenant", "control_db", "routes.push_notifications"):
        sys.modules.pop(mod, None)


def _setup(monkeypatch):
    """Wire up two tenants (a, b), a fake mongo behind the real TenantDBProxy,
    and a stubbed control_db. Returns (push_mod, tenant_mod, tenants, client)."""
    tenant_a = {"id": "a", "slug": "a", "db_name": "champions_a", "status": "active"}
    tenant_b = {"id": "b", "slug": "b", "db_name": "champions_b", "status": "active"}

    class _FakeTenants:
        def find(self, query, projection=None):
            status = (query or {}).get("status", {})
            allowed = status.get("$in") if isinstance(status, dict) else None
            rows = [tenant_a, tenant_b]
            if allowed is not None:
                rows = [r for r in rows if r.get("status") in allowed]
            return _FakeCursor(rows)

    fake_control = type("M", (), {"control_db": type("C", (), {"tenants": _FakeTenants()})()})
    monkeypatch.setitem(sys.modules, "control_db", fake_control)

    from database import TenantDBProxy
    client = FakeClient()
    proxy = TenantDBProxy(client)

    tenant_mod = importlib.import_module("utils.tenant")
    push_mod = importlib.import_module("routes.push_notifications")
    monkeypatch.setattr(push_mod, "db", proxy)

    return push_mod, tenant_mod, (tenant_a, tenant_b), client


def _subs(client, db_name):
    return client.dbs[db_name]._c["push_subscriptions"].docs


def test_web_push_subscribe_deactivates_other_tenant(monkeypatch, fresh_modules):
    push_mod, tenant_mod, (tenant_a, tenant_b), client = _setup(monkeypatch)

    endpoint = "https://fcm.googleapis.com/web/EEEE"

    async def scenario():
        # Academy B claimed this browser endpoint first (active in B's DB).
        token_b = tenant_mod.set_current_tenant(tenant_b)
        try:
            await push_mod.db.push_subscriptions.insert_one({
                "id": "sub-b",
                "member_id": "member-b",
                "endpoint": endpoint,
                "keys": {"p256dh": "x", "auth": "y"},
                "platform": "web",
                "is_active": True,
            })
        finally:
            tenant_mod.reset_current_tenant(token_b)

        # Now an academy A member subscribes on the SAME browser.
        payload = push_mod.SubscriptionCreate(
            member_id="member-a",
            subscription=push_mod.PushSubscription(
                endpoint=endpoint, keys={"p256dh": "x", "auth": "y"}
            ),
        )
        token_a = tenant_mod.set_current_tenant(tenant_a)
        try:
            res = await push_mod.subscribe_to_push(payload)
        finally:
            tenant_mod.reset_current_tenant(token_a)
        return res

    res = asyncio.run(scenario())
    assert res["status"] == "created"

    a_rows = _subs(client, "champions_a")
    b_rows = _subs(client, "champions_b")

    a_match = [r for r in a_rows if r["endpoint"] == endpoint]
    b_match = [r for r in b_rows if r["endpoint"] == endpoint]

    assert len(a_match) == 1 and a_match[0]["is_active"] is True, (
        "endpoint must be active in the academy that just claimed it"
    )
    assert len(b_match) == 1 and b_match[0]["is_active"] is False, (
        "endpoint must be deactivated in the previous academy's DB"
    )
    assert b_match[0].get("deactivated_reason") == "claimed_by_other_academy"


def test_fcm_subscribe_deactivates_other_tenant_by_token(monkeypatch, fresh_modules):
    push_mod, tenant_mod, (tenant_a, tenant_b), client = _setup(monkeypatch)

    fcm_token = "TTTT-device-token"
    # Distinct fcm:// endpoints so we exercise the keys.fcm_token match branch,
    # not just the endpoint match.
    endpoint_b = "fcm://device-old-b"
    endpoint_a = "fcm://device-new-a"

    async def scenario():
        token_b = tenant_mod.set_current_tenant(tenant_b)
        try:
            await push_mod.db.push_subscriptions.insert_one({
                "id": "sub-b",
                "member_id": "member-b",
                "endpoint": endpoint_b,
                "keys": {"fcm_token": fcm_token, "platform": "android"},
                "platform": "android",
                "is_active": True,
            })
        finally:
            tenant_mod.reset_current_tenant(token_b)

        payload = push_mod.SubscriptionCreate(
            member_id="member-a",
            subscription=push_mod.PushSubscription(
                endpoint=endpoint_a,
                keys={"fcm_token": fcm_token, "platform": "android"},
            ),
        )
        token_a = tenant_mod.set_current_tenant(tenant_a)
        try:
            res = await push_mod.subscribe_to_push(payload)
        finally:
            tenant_mod.reset_current_tenant(token_a)
        return res

    res = asyncio.run(scenario())
    assert res["status"] == "created"

    a_rows = _subs(client, "champions_a")
    b_rows = _subs(client, "champions_b")

    a_match = [r for r in a_rows if r["endpoint"] == endpoint_a]
    b_match = [r for r in b_rows if r["keys"].get("fcm_token") == fcm_token]

    assert len(a_match) == 1 and a_match[0]["is_active"] is True, (
        "FCM device must be active in the academy that just claimed it"
    )
    assert len(b_match) == 1 and b_match[0]["is_active"] is False, (
        "FCM device must be deactivated in the previous academy's DB via fcm_token match"
    )
    assert b_match[0].get("deactivated_reason") == "claimed_by_other_academy"


# ---------------------------------------------------------------------------
# Periodic sweep: cleanup_superseded_subscriptions (Task #333)
#
# Complements the inline dedup above. The inline path only fires the moment a
# device is RE-CLAIMED. If an academy B member subscribes on a shared device and
# then an academy A member subscribes but B never returns to re-claim, B's row
# would linger active forever. The periodic sweep walks every active tenant,
# groups active subs by device identity (FCM token for android/ios, endpoint for
# web) and keeps only the most-recently-updated row active per device.
# ---------------------------------------------------------------------------


def test_cleanup_supersedes_web_endpoint_across_tenants(monkeypatch, fresh_modules):
    push_mod, tenant_mod, (tenant_a, tenant_b), client = _setup(monkeypatch)

    endpoint = "https://fcm.googleapis.com/web/SWEEP-WEB"

    async def scenario():
        # Academy B claimed it FIRST (older updated_at) and never re-claimed.
        token_b = tenant_mod.set_current_tenant(tenant_b)
        try:
            await push_mod.db.push_subscriptions.insert_one({
                "id": "sub-b",
                "member_id": "member-b",
                "endpoint": endpoint,
                "keys": {"p256dh": "x", "auth": "y"},
                "platform": "web",
                "is_active": True,
                "updated_at": "2026-01-01T00:00:00+00:00",
            })
        finally:
            tenant_mod.reset_current_tenant(token_b)

        # Academy A claimed it MORE RECENTLY (newer updated_at) — the winner.
        token_a = tenant_mod.set_current_tenant(tenant_a)
        try:
            await push_mod.db.push_subscriptions.insert_one({
                "id": "sub-a",
                "member_id": "member-a",
                "endpoint": endpoint,
                "keys": {"p256dh": "x", "auth": "y"},
                "platform": "web",
                "is_active": True,
                "updated_at": "2026-02-01T00:00:00+00:00",
            })
        finally:
            tenant_mod.reset_current_tenant(token_a)

        return await push_mod.cleanup_superseded_subscriptions()

    summary = asyncio.run(scenario())

    assert summary["duplicate_devices"] == 1
    assert summary["deactivated"] == 1
    assert not summary["errors"]

    a_rows = _subs(client, "champions_a")
    b_rows = _subs(client, "champions_b")
    a_match = [r for r in a_rows if r["endpoint"] == endpoint]
    b_match = [r for r in b_rows if r["endpoint"] == endpoint]

    assert len(a_match) == 1 and a_match[0]["is_active"] is True, (
        "newest-updated web row must stay active"
    )
    assert len(b_match) == 1 and b_match[0]["is_active"] is False, (
        "older cross-tenant web duplicate must be deactivated by the sweep"
    )
    assert b_match[0].get("deactivated_reason") == "superseded_cross_tenant"


def test_cleanup_supersedes_fcm_token_across_tenants(monkeypatch, fresh_modules):
    push_mod, tenant_mod, (tenant_a, tenant_b), client = _setup(monkeypatch)

    fcm_token = "SWEEP-device-token"
    # Distinct fcm:// endpoints so the device is grouped by fcm_token, not endpoint.
    endpoint_b = "fcm://sweep-old-b"
    endpoint_a = "fcm://sweep-new-a"

    async def scenario():
        token_b = tenant_mod.set_current_tenant(tenant_b)
        try:
            await push_mod.db.push_subscriptions.insert_one({
                "id": "sub-b",
                "member_id": "member-b",
                "endpoint": endpoint_b,
                "keys": {"fcm_token": fcm_token, "platform": "android"},
                "platform": "android",
                "is_active": True,
                "updated_at": "2026-01-01T00:00:00+00:00",
            })
        finally:
            tenant_mod.reset_current_tenant(token_b)

        token_a = tenant_mod.set_current_tenant(tenant_a)
        try:
            await push_mod.db.push_subscriptions.insert_one({
                "id": "sub-a",
                "member_id": "member-a",
                "endpoint": endpoint_a,
                "keys": {"fcm_token": fcm_token, "platform": "android"},
                "platform": "android",
                "is_active": True,
                "updated_at": "2026-02-01T00:00:00+00:00",
            })
        finally:
            tenant_mod.reset_current_tenant(token_a)

        return await push_mod.cleanup_superseded_subscriptions()

    summary = asyncio.run(scenario())

    assert summary["duplicate_devices"] == 1
    assert summary["deactivated"] == 1
    assert not summary["errors"]

    a_rows = _subs(client, "champions_a")
    b_rows = _subs(client, "champions_b")
    a_match = [r for r in a_rows if r["keys"].get("fcm_token") == fcm_token]
    b_match = [r for r in b_rows if r["keys"].get("fcm_token") == fcm_token]

    assert len(a_match) == 1 and a_match[0]["is_active"] is True, (
        "newest-updated FCM row must stay active"
    )
    assert len(b_match) == 1 and b_match[0]["is_active"] is False, (
        "older cross-tenant FCM duplicate must be deactivated via fcm_token grouping"
    )
    assert b_match[0].get("deactivated_reason") == "superseded_cross_tenant"


def test_cleanup_leaves_single_tenant_device_untouched(monkeypatch, fresh_modules):
    push_mod, tenant_mod, (tenant_a, tenant_b), client = _setup(monkeypatch)

    endpoint = "https://fcm.googleapis.com/web/ONLY-A"

    async def scenario():
        # Device active in ONLY ONE tenant — the len(slugs) < 2 path: untouched.
        token_a = tenant_mod.set_current_tenant(tenant_a)
        try:
            await push_mod.db.push_subscriptions.insert_one({
                "id": "sub-a",
                "member_id": "member-a",
                "endpoint": endpoint,
                "keys": {"p256dh": "x", "auth": "y"},
                "platform": "web",
                "is_active": True,
                "updated_at": "2026-02-01T00:00:00+00:00",
            })
        finally:
            tenant_mod.reset_current_tenant(token_a)

        return await push_mod.cleanup_superseded_subscriptions()

    summary = asyncio.run(scenario())

    assert summary["duplicate_devices"] == 0
    assert summary["deactivated"] == 0
    assert not summary["errors"]

    a_rows = _subs(client, "champions_a")
    a_match = [r for r in a_rows if r["endpoint"] == endpoint]
    assert len(a_match) == 1 and a_match[0]["is_active"] is True, (
        "a device active in only one tenant must be left active"
    )
    assert "deactivated_reason" not in a_match[0], (
        "untouched single-tenant device must not be marked superseded"
    )
