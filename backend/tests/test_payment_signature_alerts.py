"""Tests for the rolling-window signature-failure tracker (task #266).

Covers:
  * ``record_signature_failure`` increments / prunes / triggers alerts
  * ``reset_signature_failures`` clears state on a verified delivery
  * The webhook handler emails the super-admin when the threshold is crossed
    and resets the counter on the next valid signature.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

WEBHOOK_SECRET_ENV = "PAYMENT_WEBHOOK_SECRET"
WEBHOOK_SECRET = "whsec_test_alert_xyz"


def _stripe_signature(body: bytes, secret: str, ts: int = None) -> str:
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


def _make_fake_platform_settings(initial_payment_doc):
    """Build an in-memory fake of ``control_db.platform_settings`` keyed by
    the ``key`` field, supporting find_one / update_one (with $set + upsert).
    """
    store = {}
    if initial_payment_doc:
        store[initial_payment_doc["key"]] = dict(initial_payment_doc)
    coll = MagicMock()

    async def find_one(query, projection=None):
        key = (query or {}).get("key")
        doc = store.get(key)
        return dict(doc) if doc is not None else None

    async def update_one(query, update, upsert=False):
        key = (query or {}).get("key")
        existing = store.get(key) or {}
        set_ops = (update or {}).get("$set") or {}
        existing.update(set_ops)
        if "key" not in existing and key:
            existing["key"] = key
        store[key] = existing
        return MagicMock()

    coll.find_one = AsyncMock(side_effect=find_one)
    coll.update_one = AsyncMock(side_effect=update_one)
    return coll, store


# ── 1. Helper-level tests ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_record_signature_failure_increments_and_alerts(monkeypatch):
    coll, store = _make_fake_platform_settings(None)
    fake_db = MagicMock()
    fake_db.platform_settings = coll
    monkeypatch.setattr("utils.payment_service.control_db", fake_db, raising=True)

    from utils.payment_service import (
        SIGNATURE_FAILURE_THRESHOLD,
        record_signature_failure,
    )

    # First (THRESHOLD-1) failures must NOT alert.
    for i in range(SIGNATURE_FAILURE_THRESHOLD - 1):
        out = await record_signature_failure("stripe")
        assert out["count"] == i + 1
        assert out["should_alert"] is False

    # Crossing the threshold must alert exactly once.
    out = await record_signature_failure("stripe")
    assert out["count"] == SIGNATURE_FAILURE_THRESHOLD
    assert out["should_alert"] is True

    # A subsequent failure inside the same cooldown window must NOT alert again.
    out = await record_signature_failure("stripe")
    assert out["count"] == SIGNATURE_FAILURE_THRESHOLD + 1
    assert out["should_alert"] is False

    # State persisted correctly.
    persisted = store.get("payment_signature_failures:stripe")
    assert persisted is not None
    assert persisted["alerted_at"]
    assert persisted["last_alert_count"] == SIGNATURE_FAILURE_THRESHOLD
    assert len(persisted["failures"]) == SIGNATURE_FAILURE_THRESHOLD + 1


@pytest.mark.asyncio
async def test_record_signature_failure_prunes_outside_window(monkeypatch):
    coll, store = _make_fake_platform_settings(None)
    fake_db = MagicMock()
    fake_db.platform_settings = coll
    monkeypatch.setattr("utils.payment_service.control_db", fake_db, raising=True)

    from utils.payment_service import (
        SIGNATURE_FAILURE_WINDOW_SECONDS,
        record_signature_failure,
    )

    stale_ts = (
        datetime.now(timezone.utc)
        - timedelta(seconds=SIGNATURE_FAILURE_WINDOW_SECONDS + 60)
    ).isoformat()
    store["payment_signature_failures:stripe"] = {
        "key": "payment_signature_failures:stripe",
        "provider": "stripe",
        "failures": [stale_ts, stale_ts, stale_ts, stale_ts],
        "alerted_at": "",
        "last_alert_count": 0,
    }

    out = await record_signature_failure("stripe")
    # Stale failures are pruned, leaving only the new one.
    assert out["count"] == 1
    assert out["should_alert"] is False
    persisted = store["payment_signature_failures:stripe"]
    assert len(persisted["failures"]) == 1


@pytest.mark.asyncio
async def test_reset_signature_failures_clears_state(monkeypatch):
    coll, store = _make_fake_platform_settings(None)
    fake_db = MagicMock()
    fake_db.platform_settings = coll
    monkeypatch.setattr("utils.payment_service.control_db", fake_db, raising=True)

    from utils.payment_service import (
        record_signature_failure,
        reset_signature_failures,
        SIGNATURE_FAILURE_THRESHOLD,
    )

    for _ in range(SIGNATURE_FAILURE_THRESHOLD):
        await record_signature_failure("stripe")
    assert store["payment_signature_failures:stripe"]["alerted_at"]

    await reset_signature_failures("stripe")
    persisted = store["payment_signature_failures:stripe"]
    assert persisted["failures"] == []
    assert persisted["alerted_at"] == ""
    assert persisted["last_alert_count"] == 0

    # After reset, a fresh burst can alert again.
    for i in range(SIGNATURE_FAILURE_THRESHOLD - 1):
        out = await record_signature_failure("stripe")
        assert out["should_alert"] is False
    out = await record_signature_failure("stripe")
    assert out["should_alert"] is True


# ── 2. Webhook end-to-end ────────────────────────────────────────────────


@pytest.fixture
def webhook_alert_client(monkeypatch):
    """Mount the billing router with in-memory control_db so we can drive the
    signature-failure alert through real HTTP calls.
    """
    monkeypatch.setenv(WEBHOOK_SECRET_ENV, WEBHOOK_SECRET)
    monkeypatch.setenv("SUPER_ADMIN_ALERT_EMAIL", "ops@example.com")

    coll, store = _make_fake_platform_settings({
        "key": "payment", "provider": "stripe", "enabled": True,
        "secret_env": WEBHOOK_SECRET_ENV,
    })

    fake_control_db = MagicMock()
    fake_control_db.platform_settings = coll
    fake_control_db.tenants = MagicMock()
    fake_control_db.webhook_events = MagicMock()
    fake_control_db.webhook_events.insert_one = AsyncMock()
    fake_control_db.webhook_events.count_documents = AsyncMock(return_value=0)
    fake_control_db.webhook_events.find = MagicMock()
    fake_control_db.webhook_events.delete_many = AsyncMock()

    monkeypatch.setattr("routes.billing.control_db", fake_control_db, raising=True)
    monkeypatch.setattr("utils.payment_service.control_db", fake_control_db, raising=True)

    email_calls = []

    async def fake_send_email(*, kind, to, ctx, tenant_slug=None):
        email_calls.append({"kind": kind, "to": to, "ctx": ctx})
        return {"status": "sent", "id": "msg-test"}

    monkeypatch.setattr("routes.billing.send_email", fake_send_email, raising=True)

    from routes.billing import router as billing_router
    app = FastAPI()
    app.include_router(billing_router, prefix="/api")
    client = TestClient(app)
    return client, store, email_calls


def test_webhook_alerts_super_admin_after_threshold(webhook_alert_client):
    from utils.payment_service import SIGNATURE_FAILURE_THRESHOLD

    client, store, email_calls = webhook_alert_client
    body = b'{"type":"invoice.payment_failed"}'

    # Below threshold: 401 each time, no alert email yet.
    for _ in range(SIGNATURE_FAILURE_THRESHOLD - 1):
        r = client.post(
            "/api/billing/webhook/stripe", content=body,
            headers={"Stripe-Signature": "t=1,v1=deadbeef",
                     "Content-Type": "application/json"},
        )
        assert r.status_code == 401
    assert email_calls == []

    # Crossing the threshold triggers exactly one super-admin alert.
    r = client.post(
        "/api/billing/webhook/stripe", content=body,
        headers={"Stripe-Signature": "t=1,v1=deadbeef",
                 "Content-Type": "application/json"},
    )
    assert r.status_code == 401
    assert len(email_calls) == 1
    call = email_calls[0]
    assert call["kind"] == "super_admin_signature_failures"
    assert call["to"] == "ops@example.com"
    assert call["ctx"]["provider"] == "stripe"
    assert call["ctx"]["count"] == SIGNATURE_FAILURE_THRESHOLD
    assert call["ctx"]["secret_env"] == WEBHOOK_SECRET_ENV

    # Subsequent failures within the cooldown do NOT re-alert.
    r = client.post(
        "/api/billing/webhook/stripe", content=body,
        headers={"Stripe-Signature": "t=1,v1=deadbeef",
                 "Content-Type": "application/json"},
    )
    assert r.status_code == 401
    assert len(email_calls) == 1


def test_webhook_resets_counter_on_valid_signature(webhook_alert_client):
    from utils.payment_service import SIGNATURE_FAILURE_THRESHOLD

    client, store, email_calls = webhook_alert_client

    # Build up 3 bad-sig failures (below threshold).
    for _ in range(3):
        r = client.post(
            "/api/billing/webhook/stripe", content=b"{}",
            headers={"Stripe-Signature": "t=1,v1=deadbeef",
                     "Content-Type": "application/json"},
        )
        assert r.status_code == 401
    persisted = store["payment_signature_failures:stripe"]
    assert len(persisted["failures"]) == 3

    # A valid signature must reset the counter, even though the body is an
    # ignored event type (so the request returns 200 ignored).
    body = json.dumps({"type": "customer.created", "id": "evt_x"}).encode("utf-8")
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    r = client.post(
        "/api/billing/webhook/stripe", content=body,
        headers={"Stripe-Signature": sig, "Content-Type": "application/json"},
    )
    assert r.status_code in (200, 404)  # tenant lookup may 404 — both clear the counter

    persisted = store["payment_signature_failures:stripe"]
    assert persisted["failures"] == []
    assert persisted["alerted_at"] == ""


def test_webhook_skips_alert_when_super_admin_email_missing(monkeypatch):
    """No SUPER_ADMIN_ALERT_EMAIL → threshold still tracked, but no email."""
    monkeypatch.setenv(WEBHOOK_SECRET_ENV, WEBHOOK_SECRET)
    monkeypatch.delenv("SUPER_ADMIN_ALERT_EMAIL", raising=False)

    coll, store = _make_fake_platform_settings({
        "key": "payment", "provider": "stripe", "enabled": True,
        "secret_env": WEBHOOK_SECRET_ENV,
    })
    fake_control_db = MagicMock()
    fake_control_db.platform_settings = coll
    fake_control_db.tenants = MagicMock()
    fake_control_db.webhook_events = MagicMock()
    fake_control_db.webhook_events.insert_one = AsyncMock()
    fake_control_db.webhook_events.count_documents = AsyncMock(return_value=0)

    monkeypatch.setattr("routes.billing.control_db", fake_control_db, raising=True)
    monkeypatch.setattr("utils.payment_service.control_db", fake_control_db, raising=True)

    email_calls = []

    async def fake_send_email(**kw):
        email_calls.append(kw)
        return {"status": "sent", "id": "x"}

    monkeypatch.setattr("routes.billing.send_email", fake_send_email, raising=True)

    from routes.billing import router as billing_router
    from utils.payment_service import SIGNATURE_FAILURE_THRESHOLD
    app = FastAPI()
    app.include_router(billing_router, prefix="/api")
    client = TestClient(app)

    for _ in range(SIGNATURE_FAILURE_THRESHOLD + 1):
        r = client.post(
            "/api/billing/webhook/stripe", content=b"{}",
            headers={"Stripe-Signature": "t=1,v1=deadbeef",
                     "Content-Type": "application/json"},
        )
        assert r.status_code == 401

    # State was tracked even though no email was sent.
    assert store["payment_signature_failures:stripe"]["alerted_at"]
    assert email_calls == []
