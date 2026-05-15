"""Tests for the email-confirmation flow on billing contact updates (Task #269).

Locks in the contract of:

  * ``PATCH /api/billing/contact`` — changing ``owner_email`` does NOT flip the
    active value; it stores ``pending_owner_email`` + a token and emails a link.
  * ``GET /api/billing/confirm-email`` — visiting the link applies the change
    and clears the pending fields.
  * Expired tokens are rejected and the stale token is cleared.
  * ``POST /api/billing/contact/resend`` re-issues a fresh token.
  * Clearing ``billing_email`` (empty string) is applied immediately without
    a confirmation round-trip.

``send_email`` is mocked the same way as in ``test_payment_signature_alerts``
so the suite needs no SMTP / Mongo.
"""
import os
import sys
import asyncio
from datetime import datetime, timezone, timedelta

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


class _FakeRequest:
    def __init__(self):
        self.base_url = "http://testserver/"


ADMIN_USER = {"id": "u1", "username": "owner", "is_admin": True}


@pytest.fixture
def billing_module(monkeypatch):
    from routes import billing as billing_mod
    import utils.tenant as tenant_mod

    tenants = _FakeTenants([{
        "id": "t1",
        "slug": "academy-one",
        "name": "Academy One",
        "owner_email": "owner@example.com",
        "billing_email": "billing@example.com",
    }])
    fake_control = _FakeControlDb(tenants)

    monkeypatch.setattr(billing_mod, "control_db", fake_control, raising=True)
    monkeypatch.setattr(
        tenant_mod, "get_current_tenant_slug", lambda: "academy-one", raising=True
    )
    monkeypatch.setattr(
        billing_mod, "get_current_tenant_slug", lambda: "academy-one", raising=True
    )

    sent = []

    async def fake_send_email(*, kind, to, ctx, tenant_slug=None):
        sent.append({"kind": kind, "to": to, "ctx": ctx, "tenant_slug": tenant_slug})
        return {"status": "sent", "id": f"msg-{len(sent)}"}

    monkeypatch.setattr(billing_mod, "send_email", fake_send_email, raising=True)

    return billing_mod, tenants, sent


def _patch_contact(billing_mod, **fields):
    payload = billing_mod.BillingContactUpdate(**fields)
    return asyncio.run(billing_mod.update_billing_contact(
        payload, _FakeRequest(), ADMIN_USER,
    ))


# ── PATCH /contact ────────────────────────────────────────────────────────


def test_owner_email_change_is_pending_and_emails_token(billing_module):
    billing_mod, tenants, sent = billing_module

    resp = _patch_contact(
        billing_mod,
        owner_email="new-owner@example.com",
        billing_email="billing@example.com",
    )

    row = tenants.rows[0]
    # Active value untouched until link is clicked.
    assert row["owner_email"] == "owner@example.com"
    assert row["billing_email"] == "billing@example.com"
    # Pending fields populated with a token.
    assert row["pending_owner_email"] == "new-owner@example.com"
    token = row["pending_owner_email_token"]
    assert token.startswith("owner-") and len(token) > len("owner-")
    assert row["pending_owner_email_expires_at"]

    # Response advertises the change as pending, not applied.
    assert resp["owner_email"] == "owner@example.com"
    assert resp["pending_owner_email"] == "new-owner@example.com"
    assert resp["owner_email_changed"] is True
    assert resp["billing_email_changed"] is False

    # Exactly one confirmation email, sent to the new address with the link.
    assert len(sent) == 1
    msg = sent[0]
    assert msg["kind"] == "email_confirmation"
    assert msg["to"] == "new-owner@example.com"
    assert token in msg["ctx"]["confirm_url"]
    assert msg["ctx"]["role"] == "owner"


def test_unchanged_emails_send_no_confirmation(billing_module):
    billing_mod, tenants, sent = billing_module

    _patch_contact(
        billing_mod,
        owner_email="owner@example.com",
        billing_email="billing@example.com",
    )

    assert sent == []
    row = tenants.rows[0]
    assert "pending_owner_email_token" not in row
    assert "pending_billing_email_token" not in row


def test_clearing_billing_email_is_applied_immediately(billing_module):
    billing_mod, tenants, sent = billing_module
    # Seed an in-flight billing change so we can also assert it gets wiped.
    tenants.rows[0]["pending_billing_email"] = "leftover@example.com"
    tenants.rows[0]["pending_billing_email_token"] = "billing-stale"
    tenants.rows[0]["pending_billing_email_expires_at"] = "2030-01-01T00:00:00+00:00"

    resp = _patch_contact(
        billing_mod,
        owner_email="owner@example.com",
        billing_email="",
    )

    row = tenants.rows[0]
    assert row["billing_email"] == ""
    assert "pending_billing_email" not in row
    assert "pending_billing_email_token" not in row
    assert "pending_billing_email_expires_at" not in row

    # No confirmation email needed for a removal.
    assert sent == []
    assert resp["billing_email"] == ""
    assert resp["billing_email_changed"] is True


# ── GET /confirm-email ────────────────────────────────────────────────────


def test_confirm_email_link_applies_pending_change(billing_module):
    billing_mod, tenants, _sent = billing_module

    _patch_contact(
        billing_mod,
        owner_email="new-owner@example.com",
        billing_email="billing@example.com",
    )
    token = tenants.rows[0]["pending_owner_email_token"]

    resp = asyncio.run(billing_mod.confirm_email_change(token))

    assert resp.status_code == 200
    row = tenants.rows[0]
    assert row["owner_email"] == "new-owner@example.com"
    assert row["owner_email_confirmed_at"]
    # All pending fields cleared.
    assert "pending_owner_email" not in row
    assert "pending_owner_email_token" not in row
    assert "pending_owner_email_expires_at" not in row


def test_expired_token_is_rejected_and_cleared(billing_module):
    billing_mod, tenants, _sent = billing_module

    _patch_contact(
        billing_mod,
        owner_email="new-owner@example.com",
        billing_email="billing@example.com",
    )
    token = tenants.rows[0]["pending_owner_email_token"]
    # Backdate the expiry so the link counts as expired.
    tenants.rows[0]["pending_owner_email_expires_at"] = (
        datetime.now(timezone.utc) - timedelta(hours=1)
    ).isoformat()

    resp = asyncio.run(billing_mod.confirm_email_change(token))

    assert resp.status_code == 410
    row = tenants.rows[0]
    # Active value still untouched.
    assert row["owner_email"] == "owner@example.com"
    # Stale token wiped so a resend produces a fresh one.
    assert "pending_owner_email_token" not in row
    # Pending email itself is preserved so the UI still shows what was pending.
    assert row["pending_owner_email"] == "new-owner@example.com"


def test_malformed_token_is_rejected(billing_module):
    billing_mod, tenants, _sent = billing_module

    # Valid shape, unknown random part → no tenant matched → 410.
    resp = asyncio.run(billing_mod.confirm_email_change("owner-deadbeef"))
    assert resp.status_code == 410
    # Bare-string with no role prefix → 400.
    resp2 = asyncio.run(billing_mod.confirm_email_change("bogus"))
    assert resp2.status_code == 400
    # Known prefix shape but unknown role → 400.
    resp3 = asyncio.run(billing_mod.confirm_email_change("hacker-deadbeef"))
    assert resp3.status_code == 400
    assert tenants.rows[0]["owner_email"] == "owner@example.com"


# ── POST /contact/resend ──────────────────────────────────────────────────


def test_resend_generates_a_new_token_and_emails_it(billing_module):
    billing_mod, tenants, sent = billing_module

    _patch_contact(
        billing_mod,
        owner_email="new-owner@example.com",
        billing_email="billing@example.com",
    )
    first_token = tenants.rows[0]["pending_owner_email_token"]
    sent.clear()

    payload = billing_mod.ResendConfirmationPayload(role="owner")
    resp = asyncio.run(billing_mod.resend_email_confirmation(
        payload, _FakeRequest(), ADMIN_USER,
    ))

    second_token = tenants.rows[0]["pending_owner_email_token"]
    assert second_token != first_token
    assert second_token.startswith("owner-")
    # The previously issued token is no longer valid (it was overwritten).
    assert resp["pending_email"] == "new-owner@example.com"

    assert len(sent) == 1
    msg = sent[0]
    assert msg["kind"] == "email_confirmation"
    assert msg["to"] == "new-owner@example.com"
    assert second_token in msg["ctx"]["confirm_url"]


def test_resend_without_pending_change_returns_404(billing_module):
    billing_mod, _tenants, sent = billing_module

    payload = billing_mod.ResendConfirmationPayload(role="owner")
    with pytest.raises(Exception) as exc:  # HTTPException
        asyncio.run(billing_mod.resend_email_confirmation(
            payload, _FakeRequest(), ADMIN_USER,
        ))
    assert getattr(exc.value, "status_code", None) == 404
    assert sent == []
