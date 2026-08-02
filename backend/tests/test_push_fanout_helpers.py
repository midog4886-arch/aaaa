"""Unit tests for the push fan-out helpers.

``send_push_to_admins`` and ``send_push_to_members`` batch-call
``send_push_notification`` for every active subscription they resolve. The
per-subscription icon injection and language localization live INSIDE
``send_push_notification``, so a regression in how the fan-out helpers invoke
it (wrong sub dict, shared mutated payload, skipped subs) would silently strip
academy branding / language preference from every member push without the
existing single-sub tests noticing.

These tests pin:
  * exactly one ``send_push_notification`` call per active subscription,
    with the subscription doc passed through intact (language + platform);
  * success/failed counters reflect per-sub outcomes and one failure never
    aborts the rest of the fan-out;
  * branch-scoped admin fan-out includes global (no-branch) admins;
  * end-to-end through the REAL ``send_push_notification``: each web sub gets
    the payload in ITS OWN saved language and the tenant icon, proving the
    shared payload object is not mutated across recipients.

Firebase/pywebpush and Mongo are fully stubbed — no live services needed,
following the fake-module pattern of test_push_web_notification.py.
"""
import json
import os
import sys
import asyncio

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import routes.push_notifications as push_mod  # noqa: E402


_BASE_VARS = ("REACT_APP_BACKEND_URL", "PUBLIC_BASE_URL", "REPLIT_DOMAINS")


# ---------------------------------------------------------------------------
# Minimal fake Mongo (async find(...).to_list(n)) — just enough query support
# for the fan-out helpers: equality, $in, $or.
# ---------------------------------------------------------------------------


def _matches(doc, query):
    for key, cond in query.items():
        if key == "$or":
            if not any(_matches(doc, sub) for sub in cond):
                return False
        elif isinstance(cond, dict) and "$in" in cond:
            if doc.get(key) not in cond["$in"]:
                return False
        else:
            if doc.get(key) != cond:
                return False
    return True


class FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return self._docs[:n]


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query, projection=None):
        return FakeCursor([dict(d) for d in self.docs if _matches(d, query)])


class FakeDB:
    def __init__(self):
        self.users = FakeCollection()
        self.push_subscriptions = FakeCollection()
        self.members = FakeCollection()


@pytest.fixture
def fake_db(monkeypatch):
    dbx = FakeDB()
    monkeypatch.setattr(push_mod, "db", dbx)
    return dbx


@pytest.fixture
def clean_base_env(monkeypatch):
    for var in _BASE_VARS:
        monkeypatch.delenv(var, raising=False)
    return monkeypatch


def _capture_sends(monkeypatch, fail_for=None, raise_for=None):
    """Replace send_push_notification with a recorder.

    ``fail_for``/``raise_for`` are sets of subscription ids that should return
    False / raise, to exercise the counters and error isolation.
    """
    calls = []

    async def fake_send(sub, payload):
        calls.append({"sub": sub, "payload": payload})
        sid = sub.get("id")
        if raise_for and sid in raise_for:
            raise RuntimeError("boom")
        return not (fail_for and sid in fail_for)

    monkeypatch.setattr(push_mod, "send_push_notification", fake_send)
    return calls


def _payload():
    return push_mod.NotificationPayload(
        title="عنوان", body="نص", title_en="Title EN", body_en="Body EN"
    )


def _sub(sid, member_id, language=None, active=True, platform="web"):
    return {
        "id": sid,
        "member_id": member_id,
        "language": language,
        "is_active": active,
        "platform": platform,
        "endpoint": f"https://push.example.com/{sid}",
        "keys": {"p256dh": "k", "auth": "a"},
    }


# ---------------------------------------------------------------------------
# send_push_to_admins
# ---------------------------------------------------------------------------


def test_admins_fanout_calls_once_per_active_subscription(fake_db, monkeypatch):
    fake_db.users.docs = [
        {"id": "adm1", "is_admin": True},
        {"id": "adm2", "is_admin": True},
        {"id": "usr1", "is_admin": False},
    ]
    fake_db.push_subscriptions.docs = [
        _sub("s1", "adm1", "ar"),
        _sub("s2", "adm1", "en"),          # same admin, second device
        _sub("s3", "adm2", "en"),
        _sub("s4", "adm2", active=False),  # inactive — must be skipped
        _sub("s5", "usr1"),                # non-admin — must be skipped
    ]
    calls = _capture_sends(monkeypatch)

    result = asyncio.run(push_mod.send_push_to_admins(_payload()))

    assert result == {"total": 3, "success": 3, "failed": 0}
    assert [c["sub"]["id"] for c in calls] == ["s1", "s2", "s3"]
    # The sub doc (incl. its saved language) must be passed through intact so
    # send_push_notification can localize per recipient.
    assert [c["sub"]["language"] for c in calls] == ["ar", "en", "en"]


def test_admins_fanout_branch_scope_includes_global_admins(fake_db, monkeypatch):
    fake_db.users.docs = [
        {"id": "a-branch", "is_admin": True, "branch_id": "b1"},
        {"id": "a-other", "is_admin": True, "branch_id": "b2"},
        {"id": "a-global", "is_admin": True, "branch_id": None},
    ]
    fake_db.push_subscriptions.docs = [
        _sub("s1", "a-branch"),
        _sub("s2", "a-other"),
        _sub("s3", "a-global"),
    ]
    calls = _capture_sends(monkeypatch)

    result = asyncio.run(push_mod.send_push_to_admins(_payload(), branch_id="b1"))

    assert result["total"] == 2
    assert sorted(c["sub"]["id"] for c in calls) == ["s1", "s3"]


def test_admins_fanout_no_admins_sends_nothing(fake_db, monkeypatch):
    fake_db.users.docs = [{"id": "usr1", "is_admin": False}]
    fake_db.push_subscriptions.docs = [_sub("s1", "usr1")]
    calls = _capture_sends(monkeypatch)

    result = asyncio.run(push_mod.send_push_to_admins(_payload()))

    assert result == {"total": 0, "success": 0, "failed": 0}
    assert calls == []


def test_admins_fanout_one_failure_does_not_stop_the_rest(fake_db, monkeypatch):
    fake_db.users.docs = [{"id": "adm1", "is_admin": True}]
    fake_db.push_subscriptions.docs = [
        _sub("s1", "adm1"), _sub("s2", "adm1"), _sub("s3", "adm1"),
    ]
    calls = _capture_sends(monkeypatch, fail_for={"s2"}, raise_for={"s1"})

    result = asyncio.run(push_mod.send_push_to_admins(_payload()))

    # s1 raised, s2 returned False, s3 succeeded — all three attempted.
    assert len(calls) == 3
    assert result == {"total": 3, "success": 1, "failed": 2}


# ---------------------------------------------------------------------------
# send_push_to_members
# ---------------------------------------------------------------------------


def test_members_fanout_calls_once_per_active_subscription(fake_db, monkeypatch):
    fake_db.push_subscriptions.docs = [
        _sub("s1", "m1", "en"),
        _sub("s2", "m2", "ar"),
        _sub("s3", "m2", active=False),  # inactive — skipped
        _sub("s4", "m3"),                # not in target list — skipped
    ]
    calls = _capture_sends(monkeypatch)

    result = asyncio.run(push_mod.send_push_to_members(_payload(), ["m1", "m2"]))

    assert result == {"total": 2, "success": 2, "failed": 0}
    assert [c["sub"]["id"] for c in calls] == ["s1", "s2"]
    assert [c["sub"]["language"] for c in calls] == ["en", "ar"]


def test_members_fanout_empty_member_list_sends_nothing(fake_db, monkeypatch):
    fake_db.push_subscriptions.docs = [_sub("s1", "m1")]
    calls = _capture_sends(monkeypatch)

    result = asyncio.run(push_mod.send_push_to_members(_payload(), []))

    assert result == {"total": 0, "success": 0, "failed": 0}
    assert calls == []


def test_members_fanout_one_failure_does_not_stop_the_rest(fake_db, monkeypatch):
    fake_db.push_subscriptions.docs = [
        _sub("s1", "m1"), _sub("s2", "m1"), _sub("s3", "m1"),
    ]
    calls = _capture_sends(monkeypatch, raise_for={"s2"})

    result = asyncio.run(push_mod.send_push_to_members(_payload(), ["m1"]))

    assert len(calls) == 3
    assert result == {"total": 3, "success": 2, "failed": 1}


# ---------------------------------------------------------------------------
# send_notification_to_all_members
# ---------------------------------------------------------------------------


def test_all_members_fanout_calls_once_per_active_subscription(fake_db, monkeypatch):
    fake_db.push_subscriptions.docs = [
        _sub("s1", "m1", "ar"),
        _sub("s2", "m2", "en"),
        _sub("s3", "m3", active=False),  # inactive — skipped
    ]
    calls = _capture_sends(monkeypatch)

    result = asyncio.run(push_mod.send_notification_to_all_members(_payload()))

    assert result == {"total": 2, "success": 2, "failed": 0}
    assert [c["sub"]["id"] for c in calls] == ["s1", "s2"]
    assert [c["sub"]["language"] for c in calls] == ["ar", "en"]


def test_all_members_fanout_branch_scope_limits_recipients(fake_db, monkeypatch):
    fake_db.members.docs = [
        {"id": "m1", "branch_id": "b1"},
        {"id": "m2", "branch_id": "b2"},
    ]
    fake_db.push_subscriptions.docs = [
        _sub("s1", "m1"),
        _sub("s2", "m2"),
    ]
    calls = _capture_sends(monkeypatch)

    result = asyncio.run(
        push_mod.send_notification_to_all_members(_payload(), branch_id="b1")
    )

    assert result["total"] == 1
    assert [c["sub"]["id"] for c in calls] == ["s1"]


# ---------------------------------------------------------------------------
# End-to-end through the REAL send_push_notification: per-sub language + icon
# ---------------------------------------------------------------------------


def test_fanout_respects_each_subs_language_and_tenant_icon(
    fake_db, clean_base_env
):
    """Fan out to an Arabic sub and an English sub through the real
    ``send_push_notification`` (webpush stubbed): each recipient must get the
    payload in their OWN language with the tenant icon — proving the shared
    payload object is localized per sub, not mutated for everyone."""
    clean_base_env.setenv("PUBLIC_BASE_URL", "https://app.example.com")
    import utils.tenant as tenant_mod
    clean_base_env.setattr(tenant_mod, "get_current_tenant_slug", lambda: "academyx")

    sent = []

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims):
        sent.append(json.loads(data))

    clean_base_env.setattr(push_mod, "webpush", fake_webpush)

    fake_db.push_subscriptions.docs = [
        _sub("s-ar", "m1", "ar"),
        _sub("s-en", "m2", "en"),
    ]

    payload = _payload()
    result = asyncio.run(push_mod.send_push_to_members(payload, ["m1", "m2"]))

    assert result == {"total": 2, "success": 2, "failed": 0}
    assert [d["title"] for d in sent] == ["عنوان", "Title EN"]
    assert [d["body"] for d in sent] == ["نص", "Body EN"]
    icon = "https://app.example.com/api/tenant/branding/logo?slug=academyx"
    assert all(d["icon"] == icon and d["badge"] == icon for d in sent)
    # The caller's payload object must remain un-mutated (Arabic defaults).
    assert payload.title == "عنوان" and payload.body == "نص"
