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
    # Alert-throttle state writes (delivery/signature alert counters) go to
    # platform_settings.update_one; a plain MagicMock isn't awaitable and
    # would raise TypeError inside the webhook's error path.
    fake_settings.update_one = AsyncMock(return_value=MagicMock())

    # Fake processed_payment_events: in-memory dict keyed by (provider, event_id)
    # that mimics the unique-index DuplicateKeyError on re-insert and supports
    # find_one / update_one / delete_one for the two-phase claim/confirm flow.
    processed_events = {}

    class _DupKeyError(Exception):
        pass
    _DupKeyError.__name__ = "DuplicateKeyError"

    fake_processed_events = MagicMock()

    def _key_from_query(q):
        return (q.get("provider"), q.get("event_id"))

    async def fake_processed_insert(doc):
        key = _key_from_query(doc)
        if key in processed_events:
            raise _DupKeyError("duplicate")
        processed_events[key] = dict(doc)
        return MagicMock()

    async def fake_processed_find_one(query, projection=None):
        return dict(processed_events.get(_key_from_query(query) or (), {})) or None

    async def fake_processed_update_one(query, update):
        key = _key_from_query(query)
        if key in processed_events:
            processed_events[key].update((update or {}).get("$set") or {})
        return MagicMock()

    async def fake_processed_delete_one(query):
        key = _key_from_query(query)
        existing = processed_events.get(key)
        if existing is None:
            return MagicMock()
        # Honor extra filter fields (e.g. status="processing") so we don't
        # delete confirmed rows.
        for k, v in (query or {}).items():
            if k in ("provider", "event_id"):
                continue
            if existing.get(k) != v:
                return MagicMock()
        processed_events.pop(key, None)
        return MagicMock()

    async def fake_processed_create_index(*args, **kwargs):
        return None

    fake_processed_events.insert_one = AsyncMock(side_effect=fake_processed_insert)
    fake_processed_events.find_one = AsyncMock(side_effect=fake_processed_find_one)
    fake_processed_events.update_one = AsyncMock(side_effect=fake_processed_update_one)
    fake_processed_events.delete_one = AsyncMock(side_effect=fake_processed_delete_one)
    fake_processed_events.create_index = AsyncMock(side_effect=fake_processed_create_index)

    fake_control_db = MagicMock()
    fake_control_db.tenants = fake_tenants
    fake_control_db.platform_settings = fake_settings
    fake_control_db.processed_payment_events = fake_processed_events
    state["processed_events"] = processed_events

    # Reset the cached "indexes ready" flag so each test re-runs index setup
    # against the fresh fake collection.
    import utils.payment_service as _ps
    _ps._processed_events_indexes_ready = False

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


def test_webhook_rate_limited_per_ip(webhook_client, monkeypatch):
    """Once the per-IP cap is exceeded the endpoint short-circuits with
    429 — *before* signature verification, so a flood of bogus signatures
    can't keep the worker busy. Adopting the shared limiter (Task #278)
    means the cap holds across Gunicorn workers / replicas."""
    client, _state, _email = webhook_client

    calls = {"count": 0}

    async def fake_check(scope, key, *, limit, window_seconds, control_db_override=None):
        assert scope == "payment_webhook"
        # Allow the first call, deny everything after it. We don't care
        # about the actual cap here — only that the route consults the
        # shared limiter and honors a False return.
        calls["count"] += 1
        return calls["count"] == 1

    monkeypatch.setattr("utils.rate_limit.check_rate_limit", fake_check, raising=True)

    body = b'{"type":"invoice.payment_failed"}'
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    headers = {"Stripe-Signature": sig, "Content-Type": "application/json"}

    # First call goes through the limiter and proceeds (signature still
    # validated downstream — the response code doesn't matter, only that
    # it's not 429).
    r1 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r1.status_code != 429
    # Second call from the same IP is denied by the limiter.
    r2 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r2.status_code == 429
    assert "rate limit" in r2.json().get("detail", "").lower()
    assert calls["count"] == 2


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


def test_webhook_dedupes_repeated_event(webhook_client):
    """Re-delivering the same event id must record exactly one renewal row."""
    client, state, email_calls = webhook_client
    payload = {
        "type": "invoice.payment_succeeded",
        "id": "evt_dedupe_1",
        "data": {"object": {
            "id": "in_dedupe_1",
            "amount_paid": 29900,
            "currency": "sar",
            "metadata": {"tenant_id": "tenant-xyz",
                         "months": "12", "cycle": "yearly"},
        }},
    }
    body = json.dumps(payload).encode("utf-8")
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    headers = {"Stripe-Signature": sig, "Content-Type": "application/json"}

    r1 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r1.status_code == 200, r1.text
    assert r1.json()["status"] == "renewed"

    # Second delivery of the SAME event id — the provider retried.
    r2 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "duplicate"
    assert r2.json()["event_id"] == "evt_dedupe_1"

    # Exactly one row in renewal_history and exactly one email sent.
    history = state["tenant"]["renewal_history"]
    assert len(history) == 1, history
    assert len(email_calls) == 1
    assert ("stripe", "evt_dedupe_1") in state["processed_events"]
    assert state["processed_events"][("stripe", "evt_dedupe_1")]["status"] == "processed"


def test_webhook_dedupes_repeated_failure_event(webhook_client):
    """Failure events must also dedupe: no duplicate failure row or email."""
    client, state, email_calls = webhook_client
    payload = {
        "type": "invoice.payment_failed",
        "id": "evt_dedupe_fail",
        "data": {"object": {
            "id": "in_fail_1",
            "amount_due": 29900,
            "currency": "sar",
            "failure_message": "Your card was declined.",
            "metadata": {"tenant_id": "tenant-xyz"},
        }},
    }
    body = json.dumps(payload).encode("utf-8")
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    headers = {"Stripe-Signature": sig, "Content-Type": "application/json"}

    r1 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r1.status_code == 200
    assert r1.json()["status"] == "recorded"

    r2 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r2.status_code == 200
    assert r2.json()["status"] == "duplicate"

    assert len(state["tenant"]["renewal_history"]) == 1
    assert len(email_calls) == 1


def test_webhook_releases_claim_when_processing_fails(webhook_client, monkeypatch):
    """If processing crashes mid-flight, the next provider retry must succeed.

    Guards against the failure mode flagged in code review: marking the event
    as ``processed`` before side effects commit would silently drop legitimate
    events whenever an error occurs after the claim.
    """
    client, state, email_calls = webhook_client

    payload = {
        "type": "invoice.payment_succeeded",
        "id": "evt_recover_1",
        "data": {"object": {
            "id": "in_recover_1",
            "amount_paid": 29900,
            "currency": "sar",
            "metadata": {"tenant_id": "tenant-xyz",
                         "months": "12", "cycle": "yearly"},
        }},
    }
    body = json.dumps(payload).encode("utf-8")
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    headers = {"Stripe-Signature": sig, "Content-Type": "application/json"}

    # First delivery: force apply_renewal to blow up after the claim.
    boom_calls = {"n": 0}

    async def boom_apply_renewal(**kwargs):
        boom_calls["n"] += 1
        raise RuntimeError("simulated transient failure")

    import routes.super_admin as _sa
    real_apply_renewal = _sa.apply_renewal
    monkeypatch.setattr(_sa, "apply_renewal", boom_apply_renewal, raising=True)

    # The TestClient re-raises server exceptions by default; the important
    # thing is that the claim was released so a retry can re-process.
    with pytest.raises(RuntimeError, match="simulated transient failure"):
        client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert boom_calls["n"] == 1
    # Claim row must have been released, not left as "processing".
    assert ("stripe", "evt_recover_1") not in state["processed_events"]
    # No renewal side effects committed yet. The handler intentionally sends
    # a best-effort owner notification about the processing error.
    assert state["tenant"]["renewal_history"] == []
    error_notices = [c for c in email_calls if c["kind"] == "payment_failed"]
    assert len(error_notices) == 1
    assert "processing error" in error_notices[0]["ctx"]["reason"]

    # Restore the real handler and let the provider retry succeed.
    monkeypatch.setattr(_sa, "apply_renewal", real_apply_renewal, raising=True)
    r2 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "renewed"

    # Exactly one renewal row + one success email — retry processed, not dropped.
    assert len(state["tenant"]["renewal_history"]) == 1
    assert len([c for c in email_calls if c["kind"] == "payment_success"]) == 1
    assert state["processed_events"][("stripe", "evt_recover_1")]["status"] == "processed"


def test_webhook_dedupes_idless_success_event(webhook_client):
    """A success event with NO provider event id must still dedupe on retry
    via the payload fingerprint (fp-…) — one renewal row, one email."""
    client, state, email_calls = webhook_client
    payload = {
        "type": "invoice.payment_succeeded",
        # no top-level "id" → extract_event_id returns nothing
        "data": {"object": {
            "id": "in_noid_1",
            "amount_paid": 29900,
            "currency": "sar",
            "metadata": {"tenant_id": "tenant-xyz",
                         "months": "12", "cycle": "yearly"},
        }},
    }
    body = json.dumps(payload).encode("utf-8")
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    headers = {"Stripe-Signature": sig, "Content-Type": "application/json"}

    r1 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r1.status_code == 200, r1.text
    assert r1.json()["status"] == "renewed"

    r2 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "duplicate"
    fp_id = r2.json()["event_id"]
    assert fp_id.startswith("fp-")

    assert len(state["tenant"]["renewal_history"]) == 1
    assert len(email_calls) == 1
    assert ("stripe", fp_id) in state["processed_events"]
    assert state["processed_events"][("stripe", fp_id)]["status"] == "processed"


def test_webhook_dedupes_idless_failure_event(webhook_client):
    """Id-less failure events also dedupe by fingerprint: one row, one email."""
    client, state, email_calls = webhook_client
    payload = {
        "type": "invoice.payment_failed",
        "data": {"object": {
            "id": "in_noid_fail",
            "amount_due": 29900,
            "currency": "sar",
            "failure_message": "Your card was declined.",
            "metadata": {"tenant_id": "tenant-xyz"},
        }},
    }
    body = json.dumps(payload).encode("utf-8")
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    headers = {"Stripe-Signature": sig, "Content-Type": "application/json"}

    r1 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r1.status_code == 200
    assert r1.json()["status"] == "recorded"

    r2 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r2.status_code == 200
    assert r2.json()["status"] == "duplicate"
    assert r2.json()["event_id"].startswith("fp-")

    assert len(state["tenant"]["renewal_history"]) == 1
    assert len(email_calls) == 1


def test_webhook_idless_transient_failure_releases_claim(webhook_client, monkeypatch):
    """If processing an id-less event crashes, the fingerprint claim must be
    released so the provider's identical retry is processed, not dropped."""
    client, state, email_calls = webhook_client
    payload = {
        "type": "invoice.payment_succeeded",
        "data": {"object": {
            "id": "in_noid_recover",
            "amount_paid": 29900,
            "currency": "sar",
            "metadata": {"tenant_id": "tenant-xyz",
                         "months": "12", "cycle": "yearly"},
        }},
    }
    body = json.dumps(payload).encode("utf-8")
    sig = _stripe_signature(body, WEBHOOK_SECRET)
    headers = {"Stripe-Signature": sig, "Content-Type": "application/json"}

    async def boom_apply_renewal(**kwargs):
        raise RuntimeError("simulated transient failure")

    import routes.super_admin as _sa
    real_apply_renewal = _sa.apply_renewal
    monkeypatch.setattr(_sa, "apply_renewal", boom_apply_renewal, raising=True)

    with pytest.raises(RuntimeError, match="simulated transient failure"):
        client.post("/api/billing/webhook/stripe", content=body, headers=headers)

    # Fingerprint claim released — no lingering fp-… row blocks the retry.
    assert not any(k[1].startswith("fp-") for k in state["processed_events"]), \
        state["processed_events"]
    assert state["tenant"]["renewal_history"] == []

    monkeypatch.setattr(_sa, "apply_renewal", real_apply_renewal, raising=True)
    r2 = client.post("/api/billing/webhook/stripe", content=body, headers=headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "renewed"
    assert len(state["tenant"]["renewal_history"]) == 1
    assert len([c for c in email_calls if c["kind"] == "payment_success"]) == 1


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
