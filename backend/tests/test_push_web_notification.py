"""Unit tests for the web-push path in send_push_notification().

Covers the icon URL injection that ``send_push_notification`` does for browser
(web) subscriptions: resolving a per-academy logo via ``_tenant_logo_url`` and
embedding it as ``icon``/``badge`` in the JSON payload that reaches the service
worker.

Key cases:
  * With a base URL resolved → icon is absolute, academy branding shows up.
  * Without a base URL        → icon falls back to root-relative (acceptable;
    service workers can resolve relative paths against their own origin, unlike
    FCM's image CDN).
  * No tenant slug            → default icon from the payload is left in place.
  * Explicit ``payload.image`` is always passed through as-is.

Firebase/pywebpush are fully stubbed — no live services are needed.
"""
import json
import os
import sys
import types
import asyncio

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import routes.push_notifications as push_mod  # noqa: E402


_BASE_VARS = ("REACT_APP_BACKEND_URL", "PUBLIC_BASE_URL", "REPLIT_DOMAINS")

# A minimal web subscription dict — endpoint + keys are required by webpush.
_WEB_SUB = {
    "platform": "web",
    "endpoint": "https://push.example.com/sub/abc123",
    "keys": {"p256dh": "fake-p256dh", "auth": "fake-auth"},
}


@pytest.fixture
def clean_base_env(monkeypatch):
    """Start every test from a known-empty base-URL environment so values
    leaking in from the real Replit deployment can't change the outcome."""
    for var in _BASE_VARS:
        monkeypatch.delenv(var, raising=False)
    return monkeypatch


def _stub_webpush(monkeypatch):
    """Replace the real ``webpush`` call with one that captures its arguments.

    Returns a list that will accumulate one dict per call, each containing:
      ``data``  — the raw JSON string passed to webpush
      ``info``  — the subscription_info dict
    """
    calls = []

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims):
        calls.append({"info": subscription_info, "data": data})

    monkeypatch.setattr(push_mod, "webpush", fake_webpush)
    return calls


def _stub_tenant_slug(monkeypatch, slug):
    """Patch the tenant-slug getter used inside send_push_notification."""
    import utils.tenant as tenant_mod
    monkeypatch.setattr(tenant_mod, "get_current_tenant_slug", lambda: slug)


def _build_payload(image=None):
    return push_mod.NotificationPayload(title="عنوان", body="نص", image=image)


# ---------------------------------------------------------------------------
# Web-push path: icon URL embedded in the JSON payload
# ---------------------------------------------------------------------------


def test_web_push_icon_is_absolute_when_base_url_resolves(clean_base_env):
    """When a public base URL is available the icon must be absolute so push
    services and service workers can fetch it without guessing the origin."""
    clean_base_env.setenv("PUBLIC_BASE_URL", "https://app.example.com")
    calls = _stub_webpush(clean_base_env)
    _stub_tenant_slug(clean_base_env, "academyx")

    ok = asyncio.run(push_mod.send_push_notification(_WEB_SUB, _build_payload()))

    assert ok is True
    assert len(calls) == 1
    data = json.loads(calls[0]["data"])
    expected = "https://app.example.com/api/tenant/branding/logo?slug=academyx"
    assert data["icon"] == expected
    assert data["badge"] == expected


def test_web_push_icon_is_relative_when_no_base_url(clean_base_env):
    """When no base URL resolves the icon must fall back to the root-relative
    branding endpoint — the service worker's origin fills in the host, so
    branding still works on a single-domain deployment."""
    calls = _stub_webpush(clean_base_env)
    _stub_tenant_slug(clean_base_env, "academyx")

    ok = asyncio.run(push_mod.send_push_notification(_WEB_SUB, _build_payload()))

    assert ok is True
    data = json.loads(calls[0]["data"])
    expected = "/api/tenant/branding/logo?slug=academyx"
    assert data["icon"] == expected
    assert data["badge"] == expected


def test_web_push_icon_falls_back_to_default_when_no_slug(clean_base_env):
    """When there is no tenant slug the icon must be the payload's default
    (the shared ``/logo-new.png``), NOT a broken URL with an empty slug."""
    clean_base_env.setenv("PUBLIC_BASE_URL", "https://app.example.com")
    calls = _stub_webpush(clean_base_env)
    _stub_tenant_slug(clean_base_env, "")

    payload = _build_payload()
    ok = asyncio.run(push_mod.send_push_notification(_WEB_SUB, payload))

    assert ok is True
    data = json.loads(calls[0]["data"])
    # icon_url is "" → falls back to payload.icon default
    assert data["icon"] == payload.icon  # "/logo-new.png"
    assert data["badge"] == payload.badge  # "/images/icon-72x72.png"


def test_web_push_explicit_image_is_passed_through(clean_base_env):
    """An explicit ``payload.image`` (banner) is always forwarded verbatim,
    regardless of whether a tenant logo resolved."""
    calls = _stub_webpush(clean_base_env)
    _stub_tenant_slug(clean_base_env, "academyx")

    banner = "https://cdn.example.com/promo.jpg"
    ok = asyncio.run(
        push_mod.send_push_notification(_WEB_SUB, _build_payload(image=banner))
    )

    assert ok is True
    data = json.loads(calls[0]["data"])
    assert data["image"] == banner


def test_web_push_no_image_when_payload_image_not_set(clean_base_env):
    """When no explicit image is supplied the ``image`` key must be None so the
    service worker does not render a broken banner."""
    calls = _stub_webpush(clean_base_env)
    _stub_tenant_slug(clean_base_env, "academyx")

    ok = asyncio.run(push_mod.send_push_notification(_WEB_SUB, _build_payload()))

    assert ok is True
    data = json.loads(calls[0]["data"])
    assert data["image"] is None


def test_web_push_tenant_slug_is_in_payload(clean_base_env):
    """The tenant slug must be embedded in the JSON so the service worker can
    namespace notification tags per academy on shared devices."""
    calls = _stub_webpush(clean_base_env)
    _stub_tenant_slug(clean_base_env, "mygym")

    asyncio.run(push_mod.send_push_notification(_WEB_SUB, _build_payload()))

    data = json.loads(calls[0]["data"])
    assert data["tenant"] == "mygym"
