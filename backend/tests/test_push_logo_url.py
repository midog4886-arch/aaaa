"""Unit tests for push-notification logo URL building.

Whether an academy's logo reaches a push notification depends on resolving a
public base URL from several environment variables in a fixed priority order,
with graceful fallbacks:

  * ``_public_base_url()``  — resolves the public https origin from
    REACT_APP_BACKEND_URL > PUBLIC_BASE_URL > REPLIT_DOMAINS (first entry),
    normalizing trailing slashes; returns "" when none are set.
  * ``_tenant_logo_url(slug)`` — builds the per-academy branding-logo URL,
    ABSOLUTE when a base resolves (push CDNs can't fetch relative paths),
    root-relative when no base resolves, and "" when there is no slug.
  * ``send_fcm_notification()`` — only attaches the logo as the FCM image when
    it is absolute (https), so it degrades to the APK launcher icon rather than
    sending a broken relative URL. An explicit ``payload.image`` always wins.

These are easy to regress silently (a member quietly loses branding), so the
tests below pin the priority order and every fallback branch. No live MongoDB
or Firebase is required: env vars drive the URL helpers and a fake
``firebase_admin.messaging`` captures the FCM message that would be sent.
"""
import os
import sys
import types
import asyncio

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import routes.push_notifications as push_mod  # noqa: E402


_BASE_VARS = ("REACT_APP_BACKEND_URL", "PUBLIC_BASE_URL", "REPLIT_DOMAINS")


@pytest.fixture
def clean_base_env(monkeypatch):
    """Start every test from a known-empty base-URL environment so values
    leaking in from the real Replit deployment can't change the outcome."""
    for var in _BASE_VARS:
        monkeypatch.delenv(var, raising=False)
    return monkeypatch


# ---------------------------------------------------------------------------
# _public_base_url() — priority order, normalization, empty fallback
# ---------------------------------------------------------------------------


def test_public_base_url_empty_when_none_set(clean_base_env):
    assert push_mod._public_base_url() == ""


def test_public_base_url_prefers_react_app_backend_url(clean_base_env):
    clean_base_env.setenv("REACT_APP_BACKEND_URL", "https://react.example.com")
    clean_base_env.setenv("PUBLIC_BASE_URL", "https://public.example.com")
    clean_base_env.setenv("REPLIT_DOMAINS", "replit.example.com")
    assert push_mod._public_base_url() == "https://react.example.com"


def test_public_base_url_falls_back_to_public_base_url(clean_base_env):
    clean_base_env.setenv("PUBLIC_BASE_URL", "https://public.example.com")
    clean_base_env.setenv("REPLIT_DOMAINS", "replit.example.com")
    assert push_mod._public_base_url() == "https://public.example.com"


def test_public_base_url_falls_back_to_first_replit_domain(clean_base_env):
    clean_base_env.setenv("REPLIT_DOMAINS", "first.replit.app,second.replit.app")
    assert push_mod._public_base_url() == "https://first.replit.app"


def test_public_base_url_strips_trailing_slash(clean_base_env):
    clean_base_env.setenv("REACT_APP_BACKEND_URL", "https://react.example.com/")
    assert push_mod._public_base_url() == "https://react.example.com"


def test_public_base_url_strips_trailing_slash_on_replit_domain(clean_base_env):
    clean_base_env.setenv("REPLIT_DOMAINS", "first.replit.app/")
    assert push_mod._public_base_url() == "https://first.replit.app"


def test_public_base_url_skips_blank_higher_priority_var(clean_base_env):
    # A var set to whitespace must be treated as unset so the next one wins.
    clean_base_env.setenv("REACT_APP_BACKEND_URL", "   ")
    clean_base_env.setenv("PUBLIC_BASE_URL", "https://public.example.com")
    assert push_mod._public_base_url() == "https://public.example.com"


# ---------------------------------------------------------------------------
# _tenant_logo_url() — empty slug, absolute vs relative
# ---------------------------------------------------------------------------


def test_tenant_logo_url_empty_slug_returns_empty(clean_base_env):
    assert push_mod._tenant_logo_url("") == ""
    assert push_mod._tenant_logo_url(None) == ""
    assert push_mod._tenant_logo_url("   ") == ""


def test_tenant_logo_url_absolute_when_base_resolves(clean_base_env):
    clean_base_env.setenv("PUBLIC_BASE_URL", "https://app.example.com")
    assert (
        push_mod._tenant_logo_url("academyx")
        == "https://app.example.com/api/tenant/branding/logo?slug=academyx"
    )


def test_tenant_logo_url_relative_when_no_base(clean_base_env):
    assert (
        push_mod._tenant_logo_url("academyx")
        == "/api/tenant/branding/logo?slug=academyx"
    )


def test_tenant_logo_url_lowercases_and_trims_slug(clean_base_env):
    assert (
        push_mod._tenant_logo_url("  AcademyX  ")
        == "/api/tenant/branding/logo?slug=academyx"
    )


# ---------------------------------------------------------------------------
# send_fcm_notification() — image included only when absolute
# ---------------------------------------------------------------------------


class _FakeMessaging:
    """Captures the FCM message instead of sending it.

    Each constructor returns a plain dict tagged with its type so the test can
    inspect exactly what ``send_fcm_notification`` built. ``send`` records the
    final message and returns a fake id (truthy success).
    """

    def __init__(self):
        self.sent = []

    def Notification(self, **kwargs):
        return {"_type": "Notification", **kwargs}

    def AndroidNotification(self, **kwargs):
        return {"_type": "AndroidNotification", **kwargs}

    def AndroidConfig(self, **kwargs):
        return {"_type": "AndroidConfig", **kwargs}

    def Message(self, **kwargs):
        return {"_type": "Message", **kwargs}

    def send(self, message):
        self.sent.append(message)
        return "fake-message-id"


def _install_fake_fcm(monkeypatch, tenant_slug):
    """Stub Firebase init, the firebase_admin.messaging module, and the current
    tenant slug. Returns the _FakeMessaging instance that captured the send."""
    fake_messaging = _FakeMessaging()

    fake_firebase = types.ModuleType("firebase_admin")
    fake_firebase.messaging = fake_messaging
    monkeypatch.setitem(sys.modules, "firebase_admin", fake_firebase)

    monkeypatch.setattr(push_mod, "_init_firebase", lambda: True)

    import utils.tenant as tenant_mod
    monkeypatch.setattr(tenant_mod, "get_current_tenant_slug", lambda: tenant_slug)

    return fake_messaging


def _build_payload(image=None):
    return push_mod.NotificationPayload(title="عنوان", body="نص", image=image)


def test_fcm_drops_image_when_only_relative_url(clean_base_env):
    # No base URL resolves -> tenant logo is relative -> FCM must drop it.
    fake = _install_fake_fcm(clean_base_env, "academyx")

    ok = asyncio.run(push_mod.send_fcm_notification("tok-1", _build_payload()))

    assert ok is True
    assert len(fake.sent) == 1
    msg = fake.sent[0]
    # Top-level notification must NOT carry an image.
    assert "image" not in msg["notification"]
    # Android notification image must be None (degrade to launcher icon).
    assert msg["android"]["notification"]["image"] is None


def test_fcm_includes_image_when_absolute_url(clean_base_env):
    clean_base_env.setenv("PUBLIC_BASE_URL", "https://app.example.com")
    fake = _install_fake_fcm(clean_base_env, "academyx")

    expected = "https://app.example.com/api/tenant/branding/logo?slug=academyx"
    ok = asyncio.run(push_mod.send_fcm_notification("tok-2", _build_payload()))

    assert ok is True
    msg = fake.sent[0]
    assert msg["notification"]["image"] == expected
    assert msg["android"]["notification"]["image"] == expected


def test_fcm_explicit_payload_image_wins_over_relative_logo(clean_base_env):
    # No base URL, but an explicit banner image is always sent as-is.
    fake = _install_fake_fcm(clean_base_env, "academyx")

    banner = "https://cdn.example.com/banner.png"
    ok = asyncio.run(
        push_mod.send_fcm_notification("tok-3", _build_payload(image=banner))
    )

    assert ok is True
    msg = fake.sent[0]
    assert msg["notification"]["image"] == banner
    assert msg["android"]["notification"]["image"] == banner
