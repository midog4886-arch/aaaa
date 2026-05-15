"""Unit tests for the ops-alerts delivery worker (Task #231).

Covers the retry/backoff requirement: a failed SMTP/WhatsApp send must
increment ``attempts``, set ``delivery_status="retrying"``, schedule
``next_attempt_at`` using the exponential backoff schedule, and only mark
the row acknowledged once every channel has resolved (or the schedule is
exhausted). These are pure-Python tests — they monkey-patch the module's
``db`` and the two transport helpers, so they can run without Mongo.
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

    def limit(self, _n):
        return self

    async def to_list(self, _n):
        out, self._docs = self._docs, []
        return out


class _FakeOpsAlerts:
    """Minimal stand-in for ``db.ops_alerts`` used by the worker."""

    def __init__(self):
        self.rows: list = []
        self.updates: list = []

    def find(self, query, _projection=None):
        # Match the worker's filter: acknowledged=False AND
        #   (next_attempt_at <= now OR missing/null next_attempt_at)
        or_clauses = query.get("$or", [])
        now_iso = ""
        for clause in or_clauses:
            v = clause.get("next_attempt_at")
            if isinstance(v, dict) and "$lte" in v:
                now_iso = v["$lte"]
                break
        matched = []
        for r in self.rows:
            if r.get("acknowledged"):
                continue
            nxt = r.get("next_attempt_at")
            if nxt is None or "next_attempt_at" not in r or nxt <= now_iso:
                matched.append(r)
        return _FakeCursor(matched)

    async def update_one(self, flt, update):
        self.updates.append((flt, update))
        for r in self.rows:
            if r.get("id") == flt.get("id"):
                r.update(update.get("$set", {}))


class _FakeNotificationsSettings:
    def __init__(self, doc=None):
        self.doc = doc

    async def find_one(self, _flt, _proj=None):
        return self.doc


class _FakeDb:
    def __init__(self, alerts, settings):
        self.ops_alerts = alerts
        self.notifications_settings = settings


@pytest.fixture
def server_module(monkeypatch):
    import server  # noqa: WPS433
    return server


def _new_alert(**overrides):
    base = {
        "id": "alert-1",
        "kind": "backup.failure",
        "title": "Daily backup FAILED",
        "body": "boom",
        "severity": "error",
        "created_at": "2026-05-15T08:00:00+00:00",
        "acknowledged": False,
        "attempts": 0,
        "next_attempt_at": "2026-05-15T08:00:00+00:00",
        "delivered_email": False,
        "delivered_whatsapp": False,
        "last_error": "",
        "delivery_status": "pending",
    }
    base.update(overrides)
    return base


def _install_env_for_both_channels(monkeypatch):
    monkeypatch.setenv("OPS_ALERT_EMAIL_TO", "ops@example.com")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_FROM", "noreply@example.com")
    monkeypatch.setenv("OPS_ALERT_WHATSAPP_TO", "9665XXXXXXXX")


def test_failed_email_schedules_retry_with_backoff(monkeypatch, server_module):
    """A failing SMTP send must NOT acknowledge the row; it must increment
    attempts, mark delivery_status=retrying, and push next_attempt_at out
    by the first backoff slot (60s)."""
    _install_env_for_both_channels(monkeypatch)
    alerts = _FakeOpsAlerts()
    alerts.rows.append(_new_alert())
    fake_db = _FakeDb(alerts, _FakeNotificationsSettings(doc=None))
    monkeypatch.setattr(server_module, "db", fake_db)

    async def boom_email(_subject, _body):
        raise RuntimeError("smtp connection refused")

    async def ok_whatsapp(_body):
        return None

    monkeypatch.setattr(server_module, "_send_ops_email", boom_email)
    monkeypatch.setattr(server_module, "_send_ops_whatsapp", ok_whatsapp)

    before = datetime.now(timezone.utc)
    asyncio.run(server_module._process_pending_ops_alerts())
    after = datetime.now(timezone.utc)

    row = alerts.rows[0]
    assert row["attempts"] == 1
    assert row["acknowledged"] is False
    assert row["delivery_status"] == "retrying"
    assert row["delivered_email"] is False
    # WhatsApp succeeded, must not be retried
    assert row["delivered_whatsapp"] is True
    assert "smtp connection refused" in row["last_error"]
    next_at = datetime.fromisoformat(row["next_attempt_at"])
    # First backoff slot is 60 seconds
    assert next_at >= before + timedelta(seconds=59)
    assert next_at <= after + timedelta(seconds=61)


def test_both_channels_succeed_acknowledges(monkeypatch, server_module):
    _install_env_for_both_channels(monkeypatch)
    alerts = _FakeOpsAlerts()
    alerts.rows.append(_new_alert())
    fake_db = _FakeDb(alerts, _FakeNotificationsSettings(doc=None))
    monkeypatch.setattr(server_module, "db", fake_db)

    async def ok(*_a, **_k):
        return None

    monkeypatch.setattr(server_module, "_send_ops_email", ok)
    monkeypatch.setattr(server_module, "_send_ops_whatsapp", ok)

    asyncio.run(server_module._process_pending_ops_alerts())

    row = alerts.rows[0]
    assert row["acknowledged"] is True
    assert row["delivery_status"] == "delivered"
    assert row["delivered_email"] is True
    assert row["delivered_whatsapp"] is True


def test_per_tenant_toggle_disables_channel(monkeypatch, server_module):
    """When a channel is disabled in notifications_settings, the worker
    must treat it as satisfied (so a row with no other failures settles)
    and must not invoke the transport at all."""
    _install_env_for_both_channels(monkeypatch)
    alerts = _FakeOpsAlerts()
    alerts.rows.append(_new_alert())
    settings = _FakeNotificationsSettings(doc={
        "email_enabled": False,
        "whatsapp_enabled": True,
    })
    fake_db = _FakeDb(alerts, settings)
    monkeypatch.setattr(server_module, "db", fake_db)

    called = {"email": 0, "whatsapp": 0}

    async def email_send(*_a, **_k):
        called["email"] += 1

    async def wa_send(*_a, **_k):
        called["whatsapp"] += 1

    monkeypatch.setattr(server_module, "_send_ops_email", email_send)
    monkeypatch.setattr(server_module, "_send_ops_whatsapp", wa_send)

    asyncio.run(server_module._process_pending_ops_alerts())

    assert called["email"] == 0  # disabled → not invoked
    assert called["whatsapp"] == 1
    row = alerts.rows[0]
    assert row["acknowledged"] is True
    assert row["delivery_status"] == "delivered"


def test_legacy_alert_without_bookkeeping_fields_is_processed(monkeypatch, server_module):
    """Alerts written by the previous _emit_ops_alert lack
    ``next_attempt_at`` / ``attempts`` / ``delivered_*`` / ``last_error``
    / ``delivery_status``. The worker must still pick them up, deliver,
    and acknowledge them — otherwise the upgrade leaks pending alerts."""
    _install_env_for_both_channels(monkeypatch)
    alerts = _FakeOpsAlerts()
    # Legacy row: only the original fields _emit_ops_alert used to write.
    legacy = {
        "id": "legacy-1",
        "kind": "backup.failure",
        "title": "Daily backup FAILED",
        "body": "boom",
        "severity": "error",
        "created_at": "2026-05-15T08:00:00+00:00",
        "acknowledged": False,
    }
    alerts.rows.append(legacy)
    fake_db = _FakeDb(alerts, _FakeNotificationsSettings(doc=None))
    monkeypatch.setattr(server_module, "db", fake_db)

    async def ok(*_a, **_k):
        return None

    monkeypatch.setattr(server_module, "_send_ops_email", ok)
    monkeypatch.setattr(server_module, "_send_ops_whatsapp", ok)

    asyncio.run(server_module._process_pending_ops_alerts())

    row = alerts.rows[0]
    assert row["acknowledged"] is True
    assert row["delivery_status"] == "delivered"
    assert row["attempts"] == 1
    assert row["delivered_email"] is True
    assert row["delivered_whatsapp"] is True


def test_exhausted_after_max_attempts(monkeypatch, server_module):
    """After MAX_ATTEMPTS failures the worker must mark the row
    acknowledged with delivery_status=exhausted so it stops cycling."""
    _install_env_for_both_channels(monkeypatch)
    alerts = _FakeOpsAlerts()
    # Pre-load with attempts == MAX-1 so the next failed attempt exhausts.
    pre = server_module._OPS_ALERTS_MAX_ATTEMPTS - 1
    alerts.rows.append(_new_alert(attempts=pre))
    fake_db = _FakeDb(alerts, _FakeNotificationsSettings(doc=None))
    monkeypatch.setattr(server_module, "db", fake_db)

    async def boom(*_a, **_k):
        raise RuntimeError("still failing")

    monkeypatch.setattr(server_module, "_send_ops_email", boom)
    monkeypatch.setattr(server_module, "_send_ops_whatsapp", boom)

    asyncio.run(server_module._process_pending_ops_alerts())

    row = alerts.rows[0]
    assert row["attempts"] == server_module._OPS_ALERTS_MAX_ATTEMPTS
    assert row["acknowledged"] is True
    assert row["delivery_status"] == "exhausted"


def test_retry_policy_uses_every_backoff_slot(monkeypatch, server_module):
    """Lock the retry policy: every entry of ``_OPS_ALERTS_BACKOFF_SECONDS``
    must actually be used as a delay before exhaustion. Prevents the
    schedule and the exhaustion threshold from drifting out of sync (the
    earlier policy advertised 5 slots but only used 4 before exhausting)."""
    _install_env_for_both_channels(monkeypatch)
    schedule = server_module._OPS_ALERTS_BACKOFF_SECONDS
    # Total attempts before exhaustion = first try + one retry per slot.
    assert server_module._OPS_ALERTS_MAX_ATTEMPTS == len(schedule) + 1

    async def boom(*_a, **_k):
        raise RuntimeError("nope")

    monkeypatch.setattr(server_module, "_send_ops_email", boom)
    monkeypatch.setattr(server_module, "_send_ops_whatsapp", boom)

    observed_delays: list = []
    for attempts_before in range(len(schedule)):
        alerts = _FakeOpsAlerts()
        alerts.rows.append(_new_alert(attempts=attempts_before))
        fake_db = _FakeDb(alerts, _FakeNotificationsSettings(doc=None))
        monkeypatch.setattr(server_module, "db", fake_db)
        before = datetime.now(timezone.utc)
        asyncio.run(server_module._process_pending_ops_alerts())
        row = alerts.rows[0]
        # Every non-exhausting failure must schedule a retry, never ack.
        assert row["acknowledged"] is False
        assert row["delivery_status"] == "retrying"
        delay = (
            datetime.fromisoformat(row["next_attempt_at"]) - before
        ).total_seconds()
        observed_delays.append(delay)

    # Each observed delay should be within ±2s of the corresponding slot
    # (allowing for clock jitter between the "before" snapshot and the
    # worker's internal ``now``).
    for slot, delay in zip(schedule, observed_delays):
        assert slot - 2 <= delay <= slot + 2, (slot, delay)
