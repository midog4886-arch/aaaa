"""Unit tests for the tenant auto-purge scheduler (Task #244).

Locks in the contract of ``server._run_tenant_auto_purge``:

  (a) tenant in grace window is skipped,
  (b) first tick after grace emits a warning + stamps
      ``final_purge_alert_sent_at`` and does NOT drop the DB,
  (c) second tick drops the DB and sets ``status="deleted"``,
  (d) drop failure leaves the tenant ``pending_delete`` and records
      ``deletion_last_error``,
  (e) cancel-delete between warning and purge prevents the drop,
  (f) the default tenant is never purged.

All Mongo I/O and ``_raw_client.drop_database`` are mocked so the suite
runs without a live database.
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
    """Stand-in for ``control_db.tenants`` collection."""

    def __init__(self, rows):
        self.rows = [dict(r) for r in rows]
        self.updates = []

    def find(self, query, _projection=None):
        status = query.get("status")
        matched = [r for r in self.rows if r.get("status") == status]
        return _FakeCursor(matched)

    async def find_one(self, flt, _projection=None):
        for r in self.rows:
            if all(r.get(k) == v for k, v in flt.items()):
                return dict(r)
        return None

    async def update_one(self, flt, update):
        self.updates.append((dict(flt), update))
        for r in self.rows:
            if all(r.get(k) == v for k, v in flt.items()):
                for k, v in update.get("$set", {}).items():
                    r[k] = v
                for k in update.get("$unset", {}).keys():
                    r.pop(k, None)
                break


class _FakeControlDb:
    def __init__(self, tenants):
        self.tenants = tenants


class _FakeRawClient:
    def __init__(self, fail=False, error="boom"):
        self.dropped = []
        self.fail = fail
        self.error = error

    async def drop_database(self, name):
        if self.fail:
            raise RuntimeError(self.error)
        self.dropped.append(name)


@pytest.fixture
def server_module():
    import server  # noqa: WPS433
    return server


def _patch_deps(monkeypatch, server_module, tenants, *, drop_fail=False, drop_error="boom"):
    """Wire fake control_db and _raw_client into the modules the helper imports."""
    import control_db as control_db_mod
    import database as database_mod

    fake_control = _FakeControlDb(tenants)
    fake_client = _FakeRawClient(fail=drop_fail, error=drop_error)

    monkeypatch.setattr(control_db_mod, "control_db", fake_control, raising=True)
    monkeypatch.setattr(database_mod, "_raw_client", fake_client, raising=True)

    emitted = []

    async def fake_emit(*, kind, title, body, severity="error"):
        emitted.append({"kind": kind, "title": title, "body": body, "severity": severity})

    monkeypatch.setattr(server_module, "_emit_ops_alert", fake_emit, raising=True)
    return fake_control, fake_client, emitted


def _tenant(**overrides):
    base = {
        "id": "t1",
        "slug": "academy-one",
        "name": "Academy One",
        "status": "pending_delete",
        "db_name": "tenant_academy_one",
        "owner_email": "",
        "deletion_purge_at": None,
        "final_purge_alert_sent_at": None,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------- (a) grace
def test_tenant_in_grace_window_is_skipped(monkeypatch, server_module):
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    tenants = _FakeTenants([_tenant(deletion_purge_at=future)])
    _patch_deps(monkeypatch, server_module, tenants)

    summary = asyncio.run(server_module._run_tenant_auto_purge())

    assert summary == {"warned": 0, "purged": 0, "failed": 0, "skipped": 1}
    assert tenants.rows[0].get("final_purge_alert_sent_at") is None
    assert tenants.rows[0].get("status") == "pending_delete"


# ---------------------------------------------------------------- (b) warn
def test_first_tick_after_grace_warns_and_does_not_drop(monkeypatch, server_module):
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    tenants = _FakeTenants([_tenant(deletion_purge_at=past)])
    _, client, emitted = _patch_deps(monkeypatch, server_module, tenants)

    summary = asyncio.run(server_module._run_tenant_auto_purge())

    assert summary == {"warned": 1, "purged": 0, "failed": 0, "skipped": 0}
    assert client.dropped == []
    assert tenants.rows[0]["final_purge_alert_sent_at"] is not None
    # Status untouched until the second tick
    assert tenants.rows[0]["status"] == "pending_delete"
    assert any(a["kind"] == "tenant.auto_purge_pending" for a in emitted)


# ---------------------------------------------------------------- (c) drop
def test_second_tick_drops_db_and_marks_deleted(monkeypatch, server_module):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    warned = (datetime.now(timezone.utc) - timedelta(hours=23)).isoformat()
    tenants = _FakeTenants([
        _tenant(deletion_purge_at=past, final_purge_alert_sent_at=warned),
    ])
    _, client, _emitted = _patch_deps(monkeypatch, server_module, tenants)

    summary = asyncio.run(server_module._run_tenant_auto_purge())

    assert summary == {"warned": 0, "purged": 1, "failed": 0, "skipped": 0}
    assert client.dropped == ["tenant_academy_one"]
    row = tenants.rows[0]
    assert row["status"] == "deleted"
    assert row["db_dropped"] is True
    assert row["deleted_by"] == "auto_purge_scheduler"
    assert row.get("deleted_at")


# ---------------------------------------------------------------- (d) fail
def test_drop_failure_records_error_and_keeps_pending(monkeypatch, server_module):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    warned = (datetime.now(timezone.utc) - timedelta(hours=23)).isoformat()
    tenants = _FakeTenants([
        _tenant(deletion_purge_at=past, final_purge_alert_sent_at=warned),
    ])
    _, client, emitted = _patch_deps(
        monkeypatch, server_module, tenants,
        drop_fail=True, drop_error="atlas unavailable",
    )

    summary = asyncio.run(server_module._run_tenant_auto_purge())

    assert summary == {"warned": 0, "purged": 0, "failed": 1, "skipped": 0}
    assert client.dropped == []
    row = tenants.rows[0]
    assert row["status"] == "pending_delete"
    assert "atlas unavailable" in row["deletion_last_error"]
    assert row.get("deletion_last_error_at")
    assert any(a["kind"] == "tenant.auto_purge_failed" for a in emitted)


# ---------------------------------------------------------------- (e) cancel
def test_cancel_delete_between_warning_and_purge_prevents_drop(monkeypatch, server_module):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    warned = (datetime.now(timezone.utc) - timedelta(hours=23)).isoformat()
    # Tenant looks ready-to-drop on the initial scan ...
    tenants = _FakeTenants([
        _tenant(deletion_purge_at=past, final_purge_alert_sent_at=warned),
    ])
    _, client, _emitted = _patch_deps(monkeypatch, server_module, tenants)

    # ... but a super-admin races and cancels: status flips back to "active"
    # and ``deletion_purge_at`` is cleared. Simulate by mutating the row that
    # the pre-drop refetch will read.
    real_find_one = tenants.find_one

    async def cancelling_find_one(flt, projection=None):
        for r in tenants.rows:
            if r.get("id") == flt.get("id"):
                r["status"] = "active"
                r["deletion_purge_at"] = None
        return await real_find_one(flt, projection)

    tenants.find_one = cancelling_find_one  # type: ignore[assignment]

    summary = asyncio.run(server_module._run_tenant_auto_purge())

    assert summary == {"warned": 0, "purged": 0, "failed": 0, "skipped": 1}
    assert client.dropped == []
    assert tenants.rows[0]["status"] == "active"


# ---------------------------------------------------------------- (f) default
def test_default_tenant_is_never_purged(monkeypatch, server_module):
    past = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    warned = (datetime.now(timezone.utc) - timedelta(days=29)).isoformat()
    tenants = _FakeTenants([
        _tenant(
            id="default-id",
            slug="default",
            db_name="champions_academy",
            deletion_purge_at=past,
            final_purge_alert_sent_at=warned,
        ),
    ])
    _, client, emitted = _patch_deps(monkeypatch, server_module, tenants)

    summary = asyncio.run(server_module._run_tenant_auto_purge())

    assert summary == {"warned": 0, "purged": 0, "failed": 0, "skipped": 1}
    assert client.dropped == []
    assert emitted == []
    assert tenants.rows[0]["status"] == "pending_delete"
