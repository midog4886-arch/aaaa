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


def test_lax_mode_falls_back_to_default(monkeypatch, fresh_tenant_module):
    monkeypatch.delenv("STRICT_TENANT_CONTEXT", raising=False)
    tenant_mod = importlib.import_module("utils.tenant")
    assert tenant_mod.get_current_tenant_db_name() == tenant_mod.DEFAULT_DB_NAME


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
