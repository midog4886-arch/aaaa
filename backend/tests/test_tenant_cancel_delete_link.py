"""Tests for the self-service cancel-deletion link (Task #256).

Locks in the contract of the public ``GET /super/tenants/cancel-delete-public``
endpoint and the supporting token helpers in ``routes.super_admin``:

  (a) a freshly-minted token cancels a pending deletion and clears the
      grace-period fields exactly like the super-admin endpoint,
  (b) tokens with the wrong scope are rejected,
  (c) expired tokens are rejected,
  (d) IP-based rate limiting kicks in after the configured cap.

Mongo I/O is mocked so the suite needs no live database.
"""
import os
import sys
import asyncio
from datetime import datetime, timezone, timedelta

import jwt
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class _FakeTenants:
    def __init__(self, rows):
        self.rows = [dict(r) for r in rows]

    async def find_one(self, flt, _projection=None):
        for r in self.rows:
            if all(r.get(k) == v for k, v in flt.items()):
                return dict(r)
        return None

    async def update_one(self, flt, update):
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


class _FakeAuditLogs:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(doc)


class _FakeDb:
    def __init__(self):
        self.audit_logs = _FakeAuditLogs()


class _FakeRequest:
    def __init__(self, ip="1.2.3.4"):
        class _Client:
            host = ip
        self.client = _Client()
        self.base_url = "http://testserver/"


@pytest.fixture
def super_admin_module(monkeypatch):
    import control_db as control_db_mod
    import utils.audit as audit_mod
    from routes import super_admin as sa

    tenants = _FakeTenants([{
        "id": "t1",
        "slug": "academy-one",
        "name": "Academy One",
        "status": "pending_delete",
        "deletion_purge_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
        "deletion_scheduled_at": datetime.now(timezone.utc).isoformat(),
        "final_purge_alert_sent_at": "",
    }])
    fake_control = _FakeControlDb(tenants)
    fake_db = _FakeDb()

    monkeypatch.setattr(control_db_mod, "control_db", fake_control, raising=True)
    monkeypatch.setattr(sa, "control_db", fake_control, raising=True)
    monkeypatch.setattr(audit_mod, "db", fake_db, raising=True)
    sa._cancel_delete_rate_buckets.clear()
    return sa, tenants, fake_db


def test_owner_link_cancels_pending_deletion(super_admin_module):
    sa, tenants, fake_db = super_admin_module
    token = sa.make_cancel_delete_token("t1")

    resp = asyncio.run(sa.cancel_tenant_delete_public(token, _FakeRequest()))

    assert resp.status_code == 200
    row = tenants.rows[0]
    assert row["status"] == "active"
    assert "deletion_purge_at" not in row
    assert "deletion_scheduled_at" not in row
    assert "final_purge_alert_sent_at" not in row
    actions = [d["action"] for d in fake_db.audit_logs.docs]
    extras = [d.get("extra") for d in fake_db.audit_logs.docs]
    assert "tenant.cancel_delete" in actions
    assert any(isinstance(e, dict) and e.get("source") == "owner_email_link" for e in extras)


def test_wrong_scope_token_is_rejected(super_admin_module):
    sa, tenants, _ = super_admin_module
    bad = jwt.encode(
        {"scope": "super", "tid": "t1",
         "exp": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp())},
        sa.JWT_SECRET, algorithm=sa.JWT_ALGORITHM,
    )
    resp = asyncio.run(sa.cancel_tenant_delete_public(bad, _FakeRequest(ip="9.9.9.9")))
    assert resp.status_code == 400
    assert tenants.rows[0]["status"] == "pending_delete"


def test_expired_token_is_rejected(super_admin_module):
    sa, tenants, _ = super_admin_module
    expired = sa.make_cancel_delete_token("t1", ttl_hours=-1)
    resp = asyncio.run(sa.cancel_tenant_delete_public(expired, _FakeRequest(ip="8.8.8.8")))
    assert resp.status_code == 400
    assert tenants.rows[0]["status"] == "pending_delete"


def test_rate_limit_blocks_repeated_attempts(super_admin_module):
    sa, _, _ = super_admin_module
    token = sa.make_cancel_delete_token("missing-id")
    req = _FakeRequest(ip="5.5.5.5")
    # Burn the per-IP allowance with valid-shape but wrong-tenant lookups
    # (each attempt counts toward the bucket regardless of outcome).
    last = None
    for _ in range(sa._CANCEL_DELETE_RATE_LIMIT + 2):
        last = asyncio.run(sa.cancel_tenant_delete_public(token, req))
    assert last.status_code == 429
