"""Unit tests for tenant isolation primitives (Task #316).

Covers:
  (a) STRICT_TENANT_CONTEXT raises when no tenant is set,
  (b) for_each_active_tenant runs the callback once per active tenant
      with the right tenant ContextVar visible inside the callback,
  (c) a failure in one tenant does not stop the others,
  (d) maintenance scripts refuse to run without --tenant or --all-tenants.

No live MongoDB is required — control_db.tenants is stubbed.
"""
import os
import sys
import asyncio
import importlib
import subprocess
from pathlib import Path

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class _FakeTenantsCollection:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query, _projection=None):
        status = (query or {}).get("status")
        if isinstance(status, dict) and "$in" in status:
            allowed = status["$in"]
            matched = [r for r in self.rows if r.get("status") in allowed]
        else:
            matched = list(self.rows)
        return _FakeCursor(matched)


@pytest.fixture
def fresh_tenant_module():
    for mod in ("utils.tenant", "control_db"):
        sys.modules.pop(mod, None)
    yield
    for mod in ("utils.tenant", "control_db"):
        sys.modules.pop(mod, None)


def _patch_control_db(monkeypatch, rows):
    class _FakeControl:
        tenants = _FakeTenantsCollection(rows)

    monkeypatch.setitem(sys.modules, "control_db", type("M", (), {"control_db": _FakeControl()}))


def test_strict_mode_raises_without_tenant(monkeypatch, fresh_tenant_module):
    monkeypatch.setenv("STRICT_TENANT_CONTEXT", "1")
    tenant_mod = importlib.import_module("utils.tenant")
    with pytest.raises(RuntimeError, match="No tenant context set"):
        tenant_mod.get_current_tenant_db_name()


def test_explicit_lax_mode_falls_back_to_default(monkeypatch, fresh_tenant_module):
    monkeypatch.setenv("STRICT_TENANT_CONTEXT", "0")
    tenant_mod = importlib.import_module("utils.tenant")
    assert tenant_mod.get_current_tenant_db_name() == tenant_mod.DEFAULT_DB_NAME


def test_strict_is_default_outside_production(monkeypatch, fresh_tenant_module):
    monkeypatch.delenv("STRICT_TENANT_CONTEXT", raising=False)
    monkeypatch.delenv("REPLIT_DEPLOYMENT", raising=False)
    for k in ("SENTRY_ENVIRONMENT", "ENV", "ENVIRONMENT", "APP_ENV"):
        monkeypatch.delenv(k, raising=False)
    tenant_mod = importlib.import_module("utils.tenant")
    assert tenant_mod.is_strict_mode() is True
    with pytest.raises(RuntimeError):
        tenant_mod.get_current_tenant_db_name()


def test_strict_is_off_by_default_in_production(monkeypatch, fresh_tenant_module):
    monkeypatch.delenv("STRICT_TENANT_CONTEXT", raising=False)
    monkeypatch.setenv("REPLIT_DEPLOYMENT", "1")
    tenant_mod = importlib.import_module("utils.tenant")
    assert tenant_mod.is_strict_mode() is False
    assert tenant_mod.get_current_tenant_db_name() == tenant_mod.DEFAULT_DB_NAME


def test_bypass_strict_allows_fallback(monkeypatch, fresh_tenant_module):
    monkeypatch.setenv("STRICT_TENANT_CONTEXT", "1")
    tenant_mod = importlib.import_module("utils.tenant")
    token = tenant_mod.set_bypass_strict(True)
    try:
        assert tenant_mod.get_current_tenant_db_name() == tenant_mod.DEFAULT_DB_NAME
    finally:
        tenant_mod.reset_bypass_strict(token)
    with pytest.raises(RuntimeError):
        tenant_mod.get_current_tenant_db_name()


def test_middleware_sets_bypass_for_super_and_health(monkeypatch, fresh_tenant_module):
    monkeypatch.setenv("STRICT_TENANT_CONTEXT", "1")
    tenant_mod = importlib.import_module("utils.tenant")
    middleware_mod = importlib.import_module("middleware.tenant")
    importlib.reload(middleware_mod)

    captured_db = {}

    async def fake_app(scope, receive, send):
        captured_db[scope["path"]] = tenant_mod.get_current_tenant_db_name()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive():
        return {"type": "http.request"}

    sent = []

    async def send(msg):
        sent.append(msg)

    mw = middleware_mod.TenantMiddleware(fake_app)
    for path in ("/super/tenants", "/health"):
        asyncio.run(mw({"type": "http", "path": path, "headers": []}, receive, send))
    assert captured_db["/super/tenants"] == tenant_mod.DEFAULT_DB_NAME
    assert captured_db["/health"] == tenant_mod.DEFAULT_DB_NAME


def test_tenant_db_proxy_routes_to_correct_db(monkeypatch, fresh_tenant_module):
    monkeypatch.setenv("STRICT_TENANT_CONTEXT", "1")
    tenant_mod = importlib.import_module("utils.tenant")

    class FakeCollection:
        def __init__(self):
            self.docs = []

        async def insert_one(self, doc):
            self.docs.append(doc)

        def find(self, *_a, **_kw):
            docs = list(self.docs)

            class _Cur:
                def __aiter__(self_inner):
                    self_inner._it = iter(docs)
                    return self_inner

                async def __anext__(self_inner):
                    try:
                        return next(self_inner._it)
                    except StopIteration:
                        raise StopAsyncIteration

            return _Cur()

    class FakeDB:
        def __init__(self):
            self._collections = {}

        def __getitem__(self, name):
            if name not in self._collections:
                self._collections[name] = FakeCollection()
            return self._collections[name]

        def __getattr__(self, name):
            return self[name]

    class FakeClient:
        def __init__(self):
            self.dbs = {}

        def __getitem__(self, name):
            if name not in self.dbs:
                self.dbs[name] = FakeDB()
            return self.dbs[name]

    from database import TenantDBProxy
    client = FakeClient()
    db_proxy = TenantDBProxy(client)

    async def scenario():
        t_a = {"slug": "alpha", "db_name": "champions_alpha", "status": "active"}
        t_b = {"slug": "beta", "db_name": "champions_beta", "status": "active"}

        token = tenant_mod.set_current_tenant(t_a)
        try:
            await db_proxy.members.insert_one({"name": "alice"})
        finally:
            tenant_mod.reset_current_tenant(token)

        token = tenant_mod.set_current_tenant(t_b)
        try:
            beta_members = []
            async for m in db_proxy.members.find({}):
                beta_members.append(m)
        finally:
            tenant_mod.reset_current_tenant(token)
        assert beta_members == [], "tenant B leaked data from tenant A"

        token = tenant_mod.set_current_tenant(t_a)
        try:
            alpha_members = []
            async for m in db_proxy.members.find({}):
                alpha_members.append(m)
        finally:
            tenant_mod.reset_current_tenant(token)
        assert alpha_members == [{"name": "alice"}]

    asyncio.run(scenario())
    assert set(client.dbs.keys()) == {"champions_alpha", "champions_beta"}


def test_for_each_active_tenant_iterates(monkeypatch, fresh_tenant_module):
    tenant_mod = importlib.import_module("utils.tenant")
    rows = [
        {"id": "a", "slug": "alpha", "db_name": "champions_alpha", "status": "active"},
        {"id": "b", "slug": "beta", "db_name": "champions_beta", "status": "trial"},
        {"id": "c", "slug": "gamma", "db_name": "champions_gamma", "status": "suspended"},
    ]
    _patch_control_db(monkeypatch, rows)

    seen = []

    async def cb(tenant):
        current = tenant_mod.get_current_tenant()
        seen.append((tenant["slug"], (current or {}).get("slug"), tenant_mod.get_current_tenant_db_name()))
        return f"ok-{tenant['slug']}"

    summary = asyncio.run(tenant_mod.for_each_active_tenant(cb, label="test"))

    assert summary["processed"] == 2
    assert summary["succeeded"] == 2
    assert summary["failed"] == 0
    assert {s[0] for s in seen} == {"alpha", "beta"}
    for tenant_slug, ctx_slug, db_name in seen:
        assert tenant_slug == ctx_slug
        assert db_name == f"champions_{tenant_slug}"
    assert summary["results"] == {"alpha": "ok-alpha", "beta": "ok-beta"}


def test_for_each_active_tenant_isolates_failures(monkeypatch, fresh_tenant_module):
    tenant_mod = importlib.import_module("utils.tenant")
    rows = [
        {"id": "a", "slug": "alpha", "db_name": "champions_alpha", "status": "active"},
        {"id": "b", "slug": "beta", "db_name": "champions_beta", "status": "active"},
    ]
    _patch_control_db(monkeypatch, rows)

    async def cb(tenant):
        if tenant["slug"] == "alpha":
            raise ValueError("boom")
        return 42

    summary = asyncio.run(tenant_mod.for_each_active_tenant(cb, label="test"))

    assert summary["processed"] == 2
    assert summary["succeeded"] == 1
    assert summary["failed"] == 1
    assert "alpha" in summary["errors"]
    assert summary["results"].get("beta") == 42
    assert tenant_mod.get_current_tenant() is None


def test_context_is_reset_after_iteration(monkeypatch, fresh_tenant_module):
    tenant_mod = importlib.import_module("utils.tenant")
    _patch_control_db(monkeypatch, [
        {"id": "a", "slug": "alpha", "db_name": "champions_alpha", "status": "active"},
    ])

    async def cb(_t):
        return None

    asyncio.run(tenant_mod.for_each_active_tenant(cb))
    assert tenant_mod.get_current_tenant() is None


@pytest.mark.parametrize("script_name", [
    "dedupe_member_activities.py",
    "migrate_freezes_to_training_days.py",
])
def test_maintenance_script_requires_tenant_scope(script_name):
    script = Path(__file__).resolve().parent.parent / "scripts" / script_name
    result = subprocess.run(
        [sys.executable, str(script), "--dry-run"],
        capture_output=True,
        text=True,
        env={**os.environ, "MONGO_URL": os.environ.get("MONGO_URL", "mongodb://localhost:27017")},
    )
    assert result.returncode != 0
    combined = (result.stderr + result.stdout).lower()
    assert "--tenant" in combined or "--all-tenants" in combined or "required" in combined
