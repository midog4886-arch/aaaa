"""End-to-end tests for the payment-provider failure webhook.

Covers:
  * Pure helpers: ``verify_signature`` and ``parse_failure_event``
  * Webhook endpoint at ``POST /api/billing/webhook/{provider}``:
      - rejects when no provider is configured
      - rejects on bad signature
      - on a valid Stripe ``invoice.payment_failed`` event:
          → appends a status='failed' entry to ``tenant.renewal_history``
          → invokes ``send_email(kind='payment_failed', ...)``

The control DB and the email transport are mocked, so this test is
hermetic and does not require live Mongo / Resend / SendGrid.

Run from the ``backend/`` directory:
    pytest tests/test_payment_failure_webhook.py -v
"""
import hmac
import hashlib
import json
import os
import sys
import time
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

WEBHOOK_SECRET_ENV = "PAYMENT_WEBHOOK_SECRET"
WEBHOOK_SECRET = "whsec_test_1234567890"


def _stripe_signature(body: bytes, secret: str, ts: int = None) -> str:
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


# ── 1. Pure helpers ─────────────────────────────────────────────────────

class TestPureHelpers:
    def test_verify_stripe_signature_valid(self):
        from utils.payment_service import verify_signature
        body = b'{"type":"invoice.payment_failed"}'
        header = _stripe_signature(body, WEBHOOK_SECRET)
        headers = [(b"stripe-signature", header.encode())]
        assert verify_signature("stripe", body, headers, WEBHOOK_SECRET) is True

    def test_verify_stripe_signature_tampered(self):
        from utils.payment_service import verify_signature
        body = b'{"type":"invoice.payment_failed"}'
        header = _stripe_signature(body, "wrong_secret")
        headers = [(b"stripe-signature", header.encode())]
        assert verify_signature("stripe", body, headers, WEBHOOK_SECRET) is False

    def test_verify_stripe_signature_old_timestamp(self):
        from utils.payment_service import verify_signature
        body = b'{"type":"invoice.payment_failed"}'
        old_ts = int(time.time()) - 3600
        header = _stripe_signature(body, WEBHOOK_SECRET, ts=old_ts)
        headers = [(b"stripe-signature", header.encode())]
        assert verify_signature("stripe", body, headers, WEBHOOK_SECRET) is False

    def test_verify_moyasar_hmac(self):
        from utils.payment_service import verify_signature
        body = b'{"type":"payment_failed","data":{}}'
        sig = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
        headers = [(b"x-moyasar-signature", sig.encode())]
        assert verify_signature("moyasar", body, headers, WEBHOOK_SECRET) is True

    def test_parse_stripe_failure(self):
        from utils.payment_service import parse_failure_event
        evt = {
            "type": "invoice.payment_failed",
            "id": "evt_123",
            "data": {"object": {
                "id": "in_abc",
                "amount_due": 29900,
                "currency": "sar",
                "failure_message": "card declined",
                "metadata": {"tenant_id": "tenant-xyz"},
            }},
        }
        out = parse_failure_event("stripe", evt)
        assert out is not None
        assert out["tenant_id"] == "tenant-xyz"
        assert out["amount"] == 299.0
        assert out["currency"] == "SAR"
        assert "card declined" in out["reason"]
        assert out["provider_ref"] == "in_abc"

    def test_parse_stripe_non_failure(self):
        from utils.payment_service import parse_failure_event
        evt = {"type": "invoice.payment_succeeded", "data": {"object": {}}}
        assert parse_failure_event("stripe", evt) is None

    def test_parse_moyasar_failure_by_status(self):
        from utils.payment_service import parse_failure_event
        evt = {
            "type": "payment.updated",
            "data": {
                "id": "p_999", "amount": 50000, "currency": "SAR",
                "status": "failed",
                "source": {"message": "insufficient funds"},
                "metadata": {"tenant_slug": "acme"},
            },
        }
        out = parse_failure_event("moyasar", evt)
        assert out is not None
        assert out["tenant_slug"] == "acme"
        assert out["amount"] == 500.0
        assert out["reason"] == "insufficient funds"

    def test_parse_stripe_success(self):
        from utils.payment_service import parse_success_event
        evt = {
            "type": "invoice.payment_succeeded",
            "id": "evt_ok",
            "data": {"object": {
                "id": "in_ok",
                "amount_paid": 29900,
                "currency": "sar",
                "metadata": {"tenant_id": "tenant-xyz",
                             "months": "12", "cycle": "yearly"},
            }},
        }
        out = parse_success_event("stripe", evt)
        assert out is not None
        assert out["tenant_id"] == "tenant-xyz"
        assert out["amount"] == 299.0
        assert out["currency"] == "SAR"
        assert out["months"] == 12
        assert out["cycle"] == "yearly"
        assert out["provider_ref"] == "in_ok"

    def test_parse_stripe_success_ignores_failure(self):
        from utils.payment_service import parse_success_event
        evt = {"type": "invoice.payment_failed", "data": {"object": {}}}
        assert parse_success_event("stripe", evt) is None

    def test_parse_moyasar_success_by_status(self):
        from utils.payment_service import parse_success_event
        evt = {
            "type": "payment.updated",
            "data": {"id": "p_ok", "amount": 50000, "currency": "SAR",
                     "status": "paid", "metadata": {"tenant_slug": "acme"}},
        }
        out = parse_success_event("moyasar", evt)
        assert out is not None
        assert out["tenant_slug"] == "acme"
        assert out["amount"] == 500.0


# ── 2. Webhook end-to-end with mocked control_db + send_email ───────────

@pytest.fixture
def webhook_client(monkeypatch):
    """Build a minimal FastAPI app mounting only the billing router, with
    ``control_db`` and ``send_email`` swapped for in-memory fakes so the
    test is hermetic.
    """
    monkeypatch.setenv(WEBHOOK_SECRET_ENV, WEBHOOK_SECRET)

    tenant_doc = {
        "id": "tenant-xyz",
        "slug": "acme",
        "name": "Acme Academy",
        "owner_email": "owner@acme.example",
        "renewal_history": [],
    }
    state = {"tenant": dict(tenant_doc), "updates": []}

    fake_tenants = MagicMock()

    async def fake_find_one(query, projection=None):
        if query.get("id") == state["tenant"]["id"] or query.get("slug") == state["tenant"]["slug"]:
            return dict(state["tenant"])
        return None

    async def fake_update_one(query, update):
        state["updates"].append({"query": query, "update": update})
        push = (update.get("$push") or {})
        if "renewal_history" in push:
            state["tenant"].setdefault("renewal_history", []).append(push["renewal_history"])
        set_ops = (update.get("$set") or {})
        state["tenant"].update(set_ops)
        return MagicMock()

    fake_tenants.find_one = AsyncMock(side_effect=fake_find_one)
    fake_tenants.update_one = AsyncMock(side_effect=fake_update_one)

    fake_settings = MagicMock()
    settings_doc = {
        "key": "payment", "provider": "stripe", "enabled": True,
        "secret_env": WEBHOOK_SECRET_ENV,
    }

    async def fake_settings_find(query, projection=None):
        return dict(settings_doc) if (query or {}).get("key") == "payment" else None

    fake_settings.find_one = AsyncMock(side_effect=fake_settings_find)

    fake_control_db = MagicMock()
    fake_control_db.tenants = fake_tenants
    fake_control_db.platform_settings = fake_settings

    # Patch the symbol in every module that already imported it.
    monkeypatch.setattr("routes.billing.control_db", fake_control_db, raising=True)
    monkeypatch.setattr("utils.payment_service.control_db", fake_control_db, raising=True)
    # The success-event branch in the webhook calls into super_admin's
    # apply_renewal, which uses its own bound control_db / send_email refs.
    import routes.super_admin as _super_admin  # noqa: F401 — ensures import
    monkeypatch.setattr("routes.super_admin.control_db", fake_control_db, raising=True)

    email_calls = []

    async def fake_send_email(*, kind, to, ctx, tenant_slug=None):
        email_calls.append({"kind": kind, "to": to, "ctx": ctx, "tenant_slug": tenant_slug})
        return {"status": "sent", "id": "msg_test_1"}

    monkeypatch.setattr("routes.billing.send_email", fake_send_email, raising=True)
    monkeypatch.setattr("routes.super_admin.send_email", fake_send_email, raising=True)

    from routes.billing import router as billing_router
    app = FastAPI()
    app.include_router(billing_router, prefix="/api")

    client = TestClient(app)
    return client, state, email_calls


def test_webhook_503_when_provider_disabled(monkeypatch):
    """If no provider is configured/enabled, the webhook returns 503."""
    monkeypatch.setenv(WEBHOOK_SECRET_ENV, WEBHOOK_SECRET)

    fake_settings = MagicMock()

    async def fake_settings_find(query, projection=None):
        return {"key": "payment", "provider": "", "enabled": False,
                "secret_env": WEBHOOK_SECRET_ENV}

    fake_settings.find_one = AsyncMock(side_effect=fake_settings_find)
    fake_control_db = MagicMock()
    fake_control_db.platform_settings = fake_settings
    fake_control_db.tenants = MagicMock()

    monkeypatch.setattr("routes.billing.control_db", fake_control_db, raising=True)
    monkeypatch.setattr("utils.payment_service.control_db", fake_control_db, raising=True)

    from routes.billing import router as billing_router
    app = FastAPI()
    app.include_router(billing_router, prefix="/api")
    client = TestClient(app)

    body = b'{"type":"invoice.payment_failed"}'
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    r = client.post("/api/billing/webhook/stripe", content=body,
                    headers={"Stripe-Signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 503
    assert "not configured" in r.json().get("detail", "").lower()


def test_webhook_rejects_unknown_provider(webhook_client):
    client, state, _ = webhook_client
    body = b'{"type":"invoice.payment_failed"}'
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    r = client.post("/api/billing/webhook/moyasar", content=body,
                    headers={"Stripe-Signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 404


def test_webhook_rejects_bad_signature(webhook_client):
    client, state, _ = webhook_client
    body = b'{"type":"invoice.payment_failed"}'
    r = client.post("/api/billing/webhook/stripe", content=body,
                    headers={"Stripe-Signature": "t=1,v1=deadbeef",
                             "Content-Type": "application/json"})
    assert r.status_code == 401


def test_webhook_records_failure_and_sends_email(webhook_client):
    client, state, email_calls = webhook_client
    payload = {
        "type": "invoice.payment_failed",
        "id": "evt_test_1",
        "data": {"object": {
            "id": "in_test_1",
            "amount_due": 29900,
            "currency": "sar",
            "failure_message": "Your card was declined.",
            "metadata": {"tenant_id": "tenant-xyz"},
        }},
    }
    body = json.dumps(payload).encode("utf-8")
    sig = _stripe_signature(body, WEBHOOK_SECRET)

    r = client.post("/api/billing/webhook/stripe", content=body,
                    headers={"Stripe-Signature": sig, "Content-Type": "application/json"})

    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "recorded"
    assert data["tenant_slug"] == "acme"
    assert data["failure_id"].startswith("fail-")
    assert data["email"]["status"] == "sent"

    # renewal_history was appended with status='failed'
    history = state["tenant"]["renewal_history"]
    assert len(history) == 1
    assert history[0]["status"] == "failed"
    assert history[0]["method"] == "stripe"
    assert history[0]["amount"] == 299.0
    assert "card was declined" in history[0]["reason"]
    assert history[0]["provider_ref"] == "in_test_1"
    assert "last_payment_failure_at" in state["tenant"]

    # payment_failed email was sent to the owner
    assert len(email_calls) == 1
    call = email_calls[0]
    assert call["kind"] == "payment_failed"
    assert call["to"] == "owner@acme.example"
    assert call["tenant_slug"] == "acme"
    assert "card was declined" in call["ctx"]["reason"]
    assert call["ctx"]["currency"] == "SAR"


def test_webhook_renews_and_emails_on_success_event(webhook_client):
    """A signed Stripe success event auto-renews and emails ``payment_success``."""
    client, state, email_calls = webhook_client
    payload = {
        "type": "invoice.payment_succeeded",
        "id": "evt_ok",
        "data": {"object": {
            "id": "in_ok",
            "amount_paid": 29900,
            "currency": "sar",
            "metadata": {"tenant_id": "tenant-xyz",
                         "months": "12", "cycle": "yearly"},
        }},
    }
    body = json.dumps(payload).encode("utf-8")
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    r = client.post("/api/billing/webhook/stripe", content=body,
                    headers={"Stripe-Signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "renewed"
    assert data["tenant_slug"] == "acme"
    assert data["renewal_id"].startswith("renew-")
    assert data["email"]["status"] == "sent"

    history = state["tenant"]["renewal_history"]
    assert len(history) == 1
    assert history[0]["status"] == "paid"
    assert history[0]["method"] == "stripe"
    assert history[0]["amount"] == 299.0
    assert history[0]["months"] == 12
    assert history[0]["provider_ref"] == "in_ok"
    assert "subscription_end_at" in state["tenant"]

    assert len(email_calls) == 1
    call = email_calls[0]
    assert call["kind"] == "payment_success"
    assert call["to"] == "owner@acme.example"
    assert call["ctx"]["currency"] == "SAR"


def test_webhook_renews_using_tenant_cycle_when_metadata_missing(webhook_client):
    """When the event omits months/cycle, fall back to tenant.billing_cycle."""
    client, state, email_calls = webhook_client
    state["tenant"]["billing_cycle"] = "quarterly"
    payload = {
        "type": "invoice.payment_succeeded",
        "data": {"object": {
            "id": "in_q",
            "amount_paid": 89700,
            "currency": "sar",
            "metadata": {"tenant_id": "tenant-xyz"},
        }},
    }
    body = json.dumps(payload).encode("utf-8")
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    r = client.post("/api/billing/webhook/stripe", content=body,
                    headers={"Stripe-Signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "renewed"
    assert state["tenant"]["renewal_history"][0]["months"] == 3


def test_webhook_ignores_unrecognized_event(webhook_client):
    """Events that match neither failure nor success are accepted but ignored."""
    client, state, email_calls = webhook_client
    payload = {"type": "customer.created",
               "data": {"object": {"id": "cus_x", "metadata": {"tenant_id": "tenant-xyz"}}}}
    body = json.dumps(payload).encode("utf-8")
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    r = client.post("/api/billing/webhook/stripe", content=body,
                    headers={"Stripe-Signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200
    assert r.json()["status"] == "ignored"
    assert email_calls == []
    assert state["tenant"]["renewal_history"] == []
