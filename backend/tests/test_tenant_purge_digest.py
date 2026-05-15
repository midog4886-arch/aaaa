"""Unit tests for the tenant auto-purge daily digest (Task #257).

Locks in the contract of ``server._run_tenant_purge_digest``:

  (a) no pending tenants → no email is sent,
  (b) tenants pending in the next 72h → one ops alert with all of them,
  (c) tenants pending later than the window → excluded from digest,
  (d) the default tenant is never included,
  (e) digest body is sorted by purge_at and lists slug + purge_at + remaining.
"""
import os
import sys
import asyncio
from datetime import datetime, timezone, timedelta

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    async def to_list(self, _n):
        out, self._docs = self._docs, []
        return out


class _FakeTenants:
    def __init__(self, rows):
        self.rows = [dict(r) for r in rows]

    def find(self, query, _projection=None):
        status = query.get("status")
        matched = [r for r in self.rows if r.get("status") == status]
        return _FakeCursor(matched)


class _FakeControlDb:
    def __init__(self, tenants):
        self.tenants = tenants


@pytest.fixture
def server_module():
    import server  # noqa: WPS433
    return server


def _patch_deps(monkeypatch, server_module, tenants):
    import control_db as control_db_mod

    fake_control = _FakeControlDb(tenants)
    monkeypatch.setattr(control_db_mod, "control_db", fake_control, raising=True)

    emitted = []

    async def fake_emit(*, kind, title, body, severity="error"):
        emitted.append({"kind": kind, "title": title, "body": body, "severity": severity})

    monkeypatch.setattr(server_module, "_emit_ops_alert", fake_emit, raising=True)
    return fake_control, emitted


def _tenant(**overrides):
    base = {
        "id": "t1",
        "slug": "academy-one",
        "name": "Academy One",
        "status": "pending_delete",
        "deletion_purge_at": None,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------- (a) silent
def test_no_pending_tenants_sends_no_email(monkeypatch, server_module):
    tenants = _FakeTenants([])
    _, emitted = _patch_deps(monkeypatch, server_module, tenants)

    summary = asyncio.run(server_module._run_tenant_purge_digest())

    assert summary == {"sent": False, "tenants": 0}
    assert emitted == []


def test_only_far_future_tenants_sends_no_email(monkeypatch, server_module):
    far = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    tenants = _FakeTenants([_tenant(deletion_purge_at=far)])
    _, emitted = _patch_deps(monkeypatch, server_module, tenants)

    summary = asyncio.run(server_module._run_tenant_purge_digest())

    assert summary == {"sent": False, "tenants": 0}
    assert emitted == []


# ---------------------------------------------------------------- (b) digest
def test_tenants_pending_in_window_emit_single_digest(monkeypatch, server_module):
    now = datetime.now(timezone.utc)
    in_36h = (now + timedelta(hours=36)).isoformat()
    in_60h = (now + timedelta(hours=60)).isoformat()
    tenants = _FakeTenants([
        _tenant(id="t1", slug="academy-one", deletion_purge_at=in_60h),
        _tenant(id="t2", slug="academy-two", deletion_purge_at=in_36h),
    ])
    _, emitted = _patch_deps(monkeypatch, server_module, tenants)

    summary = asyncio.run(server_module._run_tenant_purge_digest())

    assert summary == {"sent": True, "tenants": 2}
    assert len(emitted) == 1
    alert = emitted[0]
    assert alert["kind"] == "tenant.auto_purge_digest"
    assert "2 tenant" in alert["title"]
    # Sorted by purge_at — academy-two (36h) appears before academy-one (60h)
    body = alert["body"]
    assert body.index("academy-two") < body.index("academy-one")
    assert "purge_at=" in body
    assert "remaining" in body


# ---------------------------------------------------------------- (c) filter
def test_tenants_outside_window_are_excluded(monkeypatch, server_module):
    now = datetime.now(timezone.utc)
    in_36h = (now + timedelta(hours=36)).isoformat()
    in_10d = (now + timedelta(days=10)).isoformat()
    tenants = _FakeTenants([
        _tenant(id="t1", slug="academy-one", deletion_purge_at=in_36h),
        _tenant(id="t2", slug="academy-two", deletion_purge_at=in_10d),
    ])
    _, emitted = _patch_deps(monkeypatch, server_module, tenants)

    summary = asyncio.run(server_module._run_tenant_purge_digest())

    assert summary == {"sent": True, "tenants": 1}
    assert "academy-one" in emitted[0]["body"]
    assert "academy-two" not in emitted[0]["body"]


# ---------------------------------------------------------------- (d) default
def test_default_tenant_excluded_from_digest(monkeypatch, server_module):
    in_36h = (datetime.now(timezone.utc) + timedelta(hours=36)).isoformat()
    tenants = _FakeTenants([
        _tenant(id="default-id", slug="default", deletion_purge_at=in_36h),
    ])
    _, emitted = _patch_deps(monkeypatch, server_module, tenants)

    summary = asyncio.run(server_module._run_tenant_purge_digest())

    assert summary == {"sent": False, "tenants": 0}
    assert emitted == []


# ---------------------------------------------------------------- (e) overdue
def test_overdue_tenant_included_with_overdue_marker(monkeypatch, server_module):
    past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    tenants = _FakeTenants([_tenant(deletion_purge_at=past)])
    _, emitted = _patch_deps(monkeypatch, server_module, tenants)

    summary = asyncio.run(server_module._run_tenant_purge_digest())

    assert summary == {"sent": True, "tenants": 1}
    assert "OVERDUE" in emitted[0]["body"]
