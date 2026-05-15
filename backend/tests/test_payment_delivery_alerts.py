"""Tests for the consecutive delivery-failure alerter (task #285).

Covers:
  * ``_update_delivery_streak`` increments on failures, clears on success,
    is a no-op for neutral statuses.
  * ``should_alert`` fires once per cooldown window.
  * ``list_active_delivery_alerts`` reflects the persisted banner state.
  * The webhook handler emails ``super_admin_delivery_failures`` after the
    streak threshold and clears the banner after one successful delivery.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _make_fake_platform_settings():
    """In-memory ``platform_settings`` supporting find_one / update_one /
    find (with regex + filter) so the streak doc and the active-alert
    listing both work end-to-end.
    """
    store = {}
    coll = MagicMock()

    async def find_one(query, projection=None):
        key = (query or {}).get("key")
        return dict(store[key]) if key in store else None

    async def update_one(query, update, upsert=False):
        key = (query or {}).get("key")
        existing = store.get(key) or {}
        existing.update((update or {}).get("$set") or {})
        if "key" not in existing and key:
            existing["key"] = key
        store[key] = existing
        return MagicMock()

    def find(query, projection=None):
        # Support {"key": {"$regex": "^prefix"}, "active_alert": True}.
        regex = ""
        key_filter = (query or {}).get("key")
        if isinstance(key_filter, dict) and "$regex" in key_filter:
            regex = key_filter["$regex"].lstrip("^")
        active_only = bool((query or {}).get("active_alert"))
        rows = [
            dict(v) for k, v in store.items()
            if (not regex or k.startswith(regex))
            and (not active_only or v.get("active_alert"))
        ]

        class _Cursor:
            def __init__(self, items):
                self._items = items

            def __aiter__(self):
                self._i = 0
                return self

            async def __anext__(self):
                if self._i >= len(self._items):
                    raise StopAsyncIteration
                row = self._items[self._i]
                self._i += 1
                return row

        return _Cursor(rows)

    coll.find_one = AsyncMock(side_effect=find_one)
    coll.update_one = AsyncMock(side_effect=update_one)
    coll.find = MagicMock(side_effect=find)
    return coll, store


@pytest.mark.asyncio
async def test_streak_increments_on_failure_and_alerts_at_threshold(monkeypatch):
    coll, store = _make_fake_platform_settings()
    fake_db = MagicMock()
    fake_db.platform_settings = coll
    monkeypatch.setattr("utils.payment_service.control_db", fake_db, raising=True)

    from utils.payment_service import (
        DELIVERY_FAILURE_STREAK_THRESHOLD,
        _update_delivery_streak,
    )

    # First (THRESHOLD - 1) failures: streak grows but no alert yet.
    for i in range(DELIVERY_FAILURE_STREAK_THRESHOLD - 1):
        out = await _update_delivery_streak("stripe", "tenant_not_found", "no meta", "")
        assert out["streak"] == i + 1
        assert out["should_alert"] is False
        assert out["active_alert"] is False

    # Crossing the threshold flips both flags.
    out = await _update_delivery_streak("stripe", "error", "boom", "acme")
    assert out["streak"] == DELIVERY_FAILURE_STREAK_THRESHOLD
    assert out["should_alert"] is True
    assert out["active_alert"] is True

    # Within cooldown, more failures keep the banner active but do NOT re-alert.
    out = await _update_delivery_streak("stripe", "signature_invalid", "bad sig", "")
    assert out["should_alert"] is False
    assert out["active_alert"] is True
    assert out["streak"] == DELIVERY_FAILURE_STREAK_THRESHOLD + 1

    persisted = store["payment_delivery_failures:stripe"]
    assert persisted["active_alert"] is True
    assert persisted["alerted_at"]


@pytest.mark.asyncio
async def test_streak_cleared_by_successful_delivery(monkeypatch):
    coll, store = _make_fake_platform_settings()
    fake_db = MagicMock()
    fake_db.platform_settings = coll
    monkeypatch.setattr("utils.payment_service.control_db", fake_db, raising=True)

    from utils.payment_service import (
        DELIVERY_FAILURE_STREAK_THRESHOLD,
        _update_delivery_streak,
        list_active_delivery_alerts,
    )

    # Build up an active alert.
    for _ in range(DELIVERY_FAILURE_STREAK_THRESHOLD):
        await _update_delivery_streak("stripe", "tenant_not_found", "x", "")
    alerts = await list_active_delivery_alerts()
    assert len(alerts) == 1
    assert alerts[0]["provider"] == "stripe"

    # One successful delivery clears the banner immediately.
    out = await _update_delivery_streak("stripe", "renewed", "+1m/+0d", "acme")
    assert out["streak"] == 0
    assert out["active_alert"] is False
    assert out["cleared"] is True

    alerts = await list_active_delivery_alerts()
    assert alerts == []
    assert store["payment_delivery_failures:stripe"]["alerted_at"] == ""


@pytest.mark.asyncio
async def test_neutral_statuses_do_not_change_streak(monkeypatch):
    coll, store = _make_fake_platform_settings()
    fake_db = MagicMock()
    fake_db.platform_settings = coll
    monkeypatch.setattr("utils.payment_service.control_db", fake_db, raising=True)

    from utils.payment_service import _update_delivery_streak

    for status in ("provider_disabled", "secret_missing", "invalid_payload",
                   "duplicate", "ignored", "received"):
        out = await _update_delivery_streak("stripe", status, "", "")
        assert out["streak"] == 0
        assert out["should_alert"] is False
        assert out["active_alert"] is False
    # No persisted state at all — neutral statuses must not even create the doc.
    assert "payment_delivery_failures:stripe" not in store


# ── Webhook-flow integration ────────────────────────────────────────────


WEBHOOK_SECRET_ENV = "PAYMENT_WEBHOOK_SECRET"
WEBHOOK_SECRET = "whsec_test_delivery"


def _make_settings_coll(initial):
    store = {initial["key"]: dict(initial)}
    coll = MagicMock()

    async def find_one(query, projection=None):
        return dict(store[query["key"]]) if query.get("key") in store else None

    async def update_one(query, update, upsert=False):
        existing = store.get(query.get("key")) or {}
        existing.update((update or {}).get("$set") or {})
        if "key" not in existing:
            existing["key"] = query.get("key")
        store[query.get("key")] = existing
        return MagicMock()

    def find(query, projection=None):
        regex = ""
        key_filter = (query or {}).get("key")
        if isinstance(key_filter, dict) and "$regex" in key_filter:
            regex = key_filter["$regex"].lstrip("^")
        active_only = bool((query or {}).get("active_alert"))
        rows = [
            dict(v) for k, v in store.items()
            if (not regex or k.startswith(regex))
            and (not active_only or v.get("active_alert"))
        ]

        class _C:
            def __aiter__(self):
                self._i = 0
                self._r = rows
                return self

            async def __anext__(self):
                if self._i >= len(self._r):
                    raise StopAsyncIteration
                v = self._r[self._i]
                self._i += 1
                return v

        return _C()

    coll.find_one = AsyncMock(side_effect=find_one)
    coll.update_one = AsyncMock(side_effect=update_one)
    coll.find = MagicMock(side_effect=find)
    return coll, store


@pytest.fixture
def delivery_alert_client(monkeypatch):
    """Mount the billing router with in-memory control_db so we can drive
    the delivery-failure alert through real HTTP calls.
    """
    monkeypatch.setenv(WEBHOOK_SECRET_ENV, WEBHOOK_SECRET)
    monkeypatch.setenv("SUPER_ADMIN_ALERT_EMAIL", "ops@example.com")

    coll, store = _make_settings_coll({
        "key": "payment", "provider": "stripe", "enabled": True,
        "secret_env": WEBHOOK_SECRET_ENV,
    })

    fake_db = MagicMock()
    fake_db.platform_settings = coll
    fake_db.tenants = MagicMock()
    fake_db.tenants.find_one = AsyncMock(return_value=None)
    fake_db.webhook_events = MagicMock()
    fake_db.webhook_events.insert_one = AsyncMock()
    fake_db.webhook_events.count_documents = AsyncMock(return_value=0)

    monkeypatch.setattr("routes.billing.control_db", fake_db, raising=True)
    monkeypatch.setattr("utils.payment_service.control_db", fake_db, raising=True)

    email_calls = []

    async def fake_send_email(*, kind, to, ctx, tenant_slug=None):
        email_calls.append({"kind": kind, "to": to, "ctx": ctx})
        return {"status": "sent", "id": "x"}

    monkeypatch.setattr("routes.billing.send_email", fake_send_email, raising=True)

    from routes.billing import router as billing_router
    app = FastAPI()
    app.include_router(billing_router, prefix="/api")
    return TestClient(app), store, email_calls


def test_tenant_not_found_streak_emails_super_admin(delivery_alert_client):
    """3 consecutive ``tenant_not_found`` deliveries (signed payloads with
    metadata that points nowhere) should trigger exactly one
    ``super_admin_delivery_failures`` email, and a subsequent ``recorded``
    or ``renewed`` should clear the active banner.
    """
    import hashlib
    import hmac
    import time

    from utils.payment_service import DELIVERY_FAILURE_STREAK_THRESHOLD

    client, store, email_calls = delivery_alert_client

    def _sign(body: bytes) -> dict:
        ts = str(int(time.time()))
        sig = hmac.new(
            WEBHOOK_SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256,
        ).hexdigest()
        return {
            "Stripe-Signature": f"t={ts},v1={sig}",
            "Content-Type": "application/json",
        }

    delivery_calls = lambda: [c for c in email_calls if c["kind"] == "super_admin_delivery_failures"]

    # Three signed failure events targeting a non-existent tenant.
    for i in range(DELIVERY_FAILURE_STREAK_THRESHOLD):
        body = json.dumps({
            "id": f"evt_test_{i}",
            "type": "invoice.payment_failed",
            "data": {"object": {
                "id": f"in_{i}",
                "metadata": {"tenant_slug": "nope"},
            }},
        }).encode()
        r = client.post("/api/billing/webhook/stripe", content=body, headers=_sign(body))
        assert r.status_code == 404

    # Exactly one delivery alert should have fired (debounced).
    assert len(delivery_calls()) == 1
    call = delivery_calls()[0]
    assert call["to"] == "ops@example.com"
    assert call["ctx"]["provider"] == "stripe"
    assert call["ctx"]["streak"] == DELIVERY_FAILURE_STREAK_THRESHOLD
    assert call["ctx"]["last_status"] == "tenant_not_found"

    # Banner is active in the persisted state.
    assert store["payment_delivery_failures:stripe"]["active_alert"] is True

    # Another failure within the cooldown does NOT re-alert.
    body = json.dumps({
        "id": "evt_test_extra",
        "type": "invoice.payment_failed",
        "data": {"object": {"id": "in_x", "metadata": {"tenant_slug": "nope"}}},
    }).encode()
    r = client.post("/api/billing/webhook/stripe", content=body, headers=_sign(body))
    assert r.status_code == 404
    assert len(delivery_calls()) == 1

    # Now wire a tenant lookup to succeed — the next signed event will be
    # an unrecognized type → "ignored", which is neutral and won't clear.
    # Use a real success path: simulate a renewal by having tenants.find_one
    # return a tenant and patching apply_renewal to short-circuit.
    fake_tenant = {
        "id": "t-1", "slug": "acme", "name": "Acme",
        "billing_cycle": "monthly",
    }

    async def find_tenant(query, projection=None):
        return dict(fake_tenant)

    from routes.billing import control_db as billing_control_db
    billing_control_db.tenants.find_one = AsyncMock(side_effect=find_tenant)

    async def fake_apply_renewal(**kwargs):
        return {"tenant": fake_tenant, "renewal": {"id": "r-1"}, "email": {"status": "skipped"}}

    import routes.super_admin as super_admin_module
    real_apply = getattr(super_admin_module, "apply_renewal", None)
    super_admin_module.apply_renewal = fake_apply_renewal
    try:
        body = json.dumps({
            "id": "evt_renew_1",
            "type": "invoice.payment_succeeded",
            "data": {"object": {
                "id": "in_renew",
                "amount_paid": 10000,
                "currency": "sar",
                "metadata": {"tenant_slug": "acme", "months": 1},
            }},
        }).encode()
        r = client.post("/api/billing/webhook/stripe", content=body, headers=_sign(body))
    finally:
        if real_apply is not None:
            super_admin_module.apply_renewal = real_apply

    # Banner is now cleared.
    assert store["payment_delivery_failures:stripe"]["active_alert"] is False
    assert store["payment_delivery_failures:stripe"]["streak"] == 0


def test_delivery_alert_skipped_without_super_admin_email(monkeypatch):
    """No SUPER_ADMIN_ALERT_EMAIL → streak still tracked, but no email sent."""
    monkeypatch.setenv(WEBHOOK_SECRET_ENV, WEBHOOK_SECRET)
    monkeypatch.delenv("SUPER_ADMIN_ALERT_EMAIL", raising=False)

    coll, store = _make_settings_coll({
        "key": "payment", "provider": "stripe", "enabled": True,
        "secret_env": WEBHOOK_SECRET_ENV,
    })
    fake_db = MagicMock()
    fake_db.platform_settings = coll
    fake_db.tenants = MagicMock()
    fake_db.tenants.find_one = AsyncMock(return_value=None)
    fake_db.webhook_events = MagicMock()
    fake_db.webhook_events.insert_one = AsyncMock()
    fake_db.webhook_events.count_documents = AsyncMock(return_value=0)

    monkeypatch.setattr("routes.billing.control_db", fake_db, raising=True)
    monkeypatch.setattr("utils.payment_service.control_db", fake_db, raising=True)

    email_calls = []

    async def fake_send_email(**kw):
        email_calls.append(kw)
        return {"status": "sent", "id": "x"}

    monkeypatch.setattr("routes.billing.send_email", fake_send_email, raising=True)

    import hashlib
    import hmac
    import time

    from routes.billing import router as billing_router
    from utils.payment_service import DELIVERY_FAILURE_STREAK_THRESHOLD

    app = FastAPI()
    app.include_router(billing_router, prefix="/api")
    client = TestClient(app)

    for i in range(DELIVERY_FAILURE_STREAK_THRESHOLD):
        body = json.dumps({
            "id": f"evt_x_{i}",
            "type": "invoice.payment_failed",
            "data": {"object": {"id": f"in_{i}", "metadata": {"tenant_slug": "nope"}}},
        }).encode()
        ts = str(int(time.time()))
        sig = hmac.new(
            WEBHOOK_SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256,
        ).hexdigest()
        r = client.post(
            "/api/billing/webhook/stripe", content=body,
            headers={"Stripe-Signature": f"t={ts},v1={sig}", "Content-Type": "application/json"},
        )
        assert r.status_code == 404

    assert store["payment_delivery_failures:stripe"]["active_alert"] is True
    assert [c for c in email_calls if c.get("kind") == "super_admin_delivery_failures"] == []
