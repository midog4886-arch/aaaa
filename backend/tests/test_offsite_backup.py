"""Offsite (Telegram) backup delivery tests.

The nightly per-tenant backup must also push a copy offsite so backups
survive total server/disk loss:
  - unconfigured creds -> status "unconfigured", never raises
  - Telegram API success/failure -> "sent"/"failed" with error detail
  - sent auto backups are registered in the control DB and pruned to the
    same retention as local files (7 per tenant)
  - offsite failures surface via the ops-alerts aggregation in
    _create_auto_backup (failed/skipped only, and only when configured)
"""
import asyncio
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import server  # noqa: E402


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ── _send_backup_to_telegram status contract ────────────────────────────────

def test_unconfigured_returns_unconfigured(monkeypatch, tmp_path):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    f = tmp_path / "auto_backup_foo_20260815.json"
    f.write_text("{}")
    res = run(server._send_backup_to_telegram(f, f.name))
    assert res["status"] == "unconfigured"
    assert not server._offsite_backup_configured()


class _FakeResp:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


class _FakeAsyncClient:
    resp = None
    raise_exc = None
    calls = []

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, data=None, files=None):
        _FakeAsyncClient.calls.append({"url": url, "data": data})
        if _FakeAsyncClient.raise_exc:
            raise _FakeAsyncClient.raise_exc
        return _FakeAsyncClient.resp


@pytest.fixture
def telegram_env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "123")
    fake_httpx = types.SimpleNamespace(AsyncClient=_FakeAsyncClient)
    monkeypatch.setitem(sys.modules, "httpx", fake_httpx)
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.raise_exc = None
    yield


def test_sent_returns_message_id(telegram_env, tmp_path):
    _FakeAsyncClient.resp = _FakeResp(200, {"ok": True, "result": {"message_id": 42}})
    f = tmp_path / "auto_backup_foo_20260815.json"
    f.write_text("{\"x\": 1}")
    res = run(server._send_backup_to_telegram(f, f.name))
    assert res == {"status": "sent", "message_id": 42, "error": ""}


def test_api_error_returns_failed(telegram_env, tmp_path):
    _FakeAsyncClient.resp = _FakeResp(400, {"ok": False, "description": "chat not found"})
    f = tmp_path / "auto_backup_foo_20260815.json"
    f.write_text("{}")
    res = run(server._send_backup_to_telegram(f, f.name))
    assert res["status"] == "failed"
    assert "400" in res["error"]


def test_network_exception_returns_failed(telegram_env, tmp_path):
    _FakeAsyncClient.raise_exc = RuntimeError("boom")
    f = tmp_path / "auto_backup_foo_20260815.json"
    f.write_text("{}")
    res = run(server._send_backup_to_telegram(f, f.name))
    assert res["status"] == "failed"
    assert "boom" in res["error"]


# ── offsite registry + retention pruning ────────────────────────────────────

class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, n):
        return self._rows[:n]


class _FakeCollection:
    def __init__(self):
        self.rows = []

    async def insert_one(self, doc):
        self.rows.append(dict(doc))

    def find(self, query, proj=None):
        slug = query.get("tenant_slug")
        return _FakeCursor([dict(r) for r in self.rows if r.get("tenant_slug") == slug])

    async def delete_one(self, query):
        self.rows = [r for r in self.rows if r.get("id") != query.get("id")]

    async def update_one(self, query, update):
        for r in self.rows:
            if r.get("id") == query.get("id"):
                r.update(update.get("$set", {}))


def test_prune_keeps_last_seven_and_deletes_offsite(monkeypatch, telegram_env):
    col = _FakeCollection()
    fake_control = types.SimpleNamespace(offsite_backups=col)
    import control_db as control_db_mod
    monkeypatch.setattr(control_db_mod, "control_db", fake_control)
    _FakeAsyncClient.resp = _FakeResp(200, {"ok": True, "result": True})

    for i in range(9):
        run(server._record_and_prune_offsite_backup(
            "foo", f"auto_backup_foo_2026080{i}.json", 100 + i))
    # another tenant's rows must be untouched by foo's pruning
    run(server._record_and_prune_offsite_backup("bar", "auto_backup_bar_20260801.json", 500))

    foo_rows = [r for r in col.rows if r["tenant_slug"] == "foo"]
    assert len(foo_rows) == server._OFFSITE_KEEP_PER_TENANT
    kept = {r["message_id"] for r in foo_rows}
    assert kept == {102, 103, 104, 105, 106, 107, 108}
    assert [r for r in col.rows if r["tenant_slug"] == "bar"]
    delete_calls = [c for c in _FakeAsyncClient.calls if c["url"].endswith("/deleteMessage")]
    assert {c["data"]["message_id"] for c in delete_calls} == {100, 101}


def test_delete_refused_keeps_row_and_marks_retained(monkeypatch, telegram_env):
    col = _FakeCollection()
    fake_control = types.SimpleNamespace(offsite_backups=col)
    import control_db as control_db_mod
    monkeypatch.setattr(control_db_mod, "control_db", fake_control)
    # Telegram refuses the delete
    _FakeAsyncClient.resp = _FakeResp(400, {"ok": False, "description": "message can't be deleted"})

    for i in range(8):
        run(server._record_and_prune_offsite_backup(
            "foo", f"auto_backup_foo_2026080{i}.json", 200 + i))
    # attempt 1 failed -> oldest row kept for retry with delete_attempts=1
    oldest = next(r for r in col.rows if r["message_id"] == 200)
    assert oldest["delete_attempts"] == 1
    assert not oldest.get("retained")
    assert len(col.rows) == 8

    # two more nightly runs keep failing -> attempts hit 3 -> row is KEPT and
    # marked retained (the Telegram copy still exists; never pretend it's gone)
    run(server._record_and_prune_offsite_backup("foo", "auto_backup_foo_20260809.json", 209))
    run(server._record_and_prune_offsite_backup("foo", "auto_backup_foo_20260810.json", 210))
    oldest = next(r for r in col.rows if r["message_id"] == 200)
    assert oldest["retained"] is True
    assert oldest["delete_attempts"] >= server._OFFSITE_DELETE_MAX_ATTEMPTS


def test_aged_rows_never_attempt_delete_and_are_marked_retained(monkeypatch, telegram_env):
    """Telegram hard-refuses deleteMessage for messages older than 48h — the
    pruner must not even attempt it, and must record the copy as retained."""
    col = _FakeCollection()
    fake_control = types.SimpleNamespace(offsite_backups=col)
    import control_db as control_db_mod
    monkeypatch.setattr(control_db_mod, "control_db", fake_control)
    _FakeAsyncClient.resp = _FakeResp(200, {"ok": True, "result": True})

    from datetime import datetime, timedelta, timezone
    # Seed 8 rows sent ~8..1 days ago (all past the 48h delete window)
    for i in range(8):
        col.rows.append({
            "id": f"old-{i}", "tenant_slug": "foo",
            "filename": f"auto_backup_foo_old{i}.json", "message_id": 300 + i,
            "sent_at": (datetime.now(timezone.utc) - timedelta(days=8 - i)).isoformat(),
        })
    run(server._record_and_prune_offsite_backup("foo", "auto_backup_foo_new.json", 400))

    # 9 rows total, 2 in excess — both too old to delete: kept + retained
    assert len([r for r in col.rows if r["tenant_slug"] == "foo"]) == 9
    for msg_id in (300, 301):
        row = next(r for r in col.rows if r.get("message_id") == msg_id)
        assert row["retained"] is True
        assert "48h" in row["retained_reason"]
    # and NO deleteMessage call was made for them
    delete_calls = [c for c in _FakeAsyncClient.calls if c["url"].endswith("/deleteMessage")]
    assert not delete_calls


def test_registry_error_never_raises(monkeypatch):
    import control_db as control_db_mod

    class _Boom:
        def __getattr__(self, name):
            raise RuntimeError("control db down")

    monkeypatch.setattr(control_db_mod, "control_db", _Boom())
    # must swallow, not raise — bookkeeping can't fail the backup itself
    run(server._record_and_prune_offsite_backup("foo", "f.json", 1))


# ── ops-alert aggregation in _create_auto_backup ────────────────────────────

def _run_create_auto_backup(monkeypatch, results, configured, tmp_path):
    alerts = []
    # Point local retention pruning at an empty temp dir so the test can
    # never delete real backup files from backend/backups/.
    monkeypatch.setattr(server, "BACKUPS_DIR", tmp_path)

    async def fake_for_each(fn, label=""):
        return {"processed": len(results), "succeeded": len(results),
                "failed": 0, "results": results, "errors": {}}

    async def fake_emit(**kw):
        alerts.append(kw)

    import utils.tenant as tenant_mod
    monkeypatch.setattr(tenant_mod, "for_each_active_tenant", fake_for_each)
    monkeypatch.setattr(server, "_emit_ops_alert", fake_emit)
    monkeypatch.setattr(server, "_offsite_backup_configured", lambda: configured)
    run(server._create_auto_backup())
    return alerts


def test_offsite_failure_raises_ops_alert(monkeypatch, tmp_path):
    alerts = _run_create_auto_backup(monkeypatch, tmp_path=tmp_path, results={
        "foo": {"offsite": "sent", "offsite_error": ""},
        "bar": {"offsite": "failed", "offsite_error": "HTTP 400"},
    }, configured=True)
    kinds = [a["kind"] for a in alerts]
    assert "backup.offsite_failure" in kinds
    alert = next(a for a in alerts if a["kind"] == "backup.offsite_failure")
    assert "bar" in alert["body"] and "foo" not in alert["body"].split("bar")[0]


def test_all_sent_no_offsite_alert(monkeypatch, tmp_path):
    alerts = _run_create_auto_backup(monkeypatch, tmp_path=tmp_path, results={
        "foo": {"offsite": "sent", "offsite_error": ""},
    }, configured=True)
    assert not [a for a in alerts if a["kind"] == "backup.offsite_failure"]


def test_unconfigured_does_not_spam_alerts(monkeypatch, tmp_path):
    alerts = _run_create_auto_backup(monkeypatch, tmp_path=tmp_path, results={
        "foo": {"offsite": "unconfigured", "offsite_error": ""},
    }, configured=False)
    assert not [a for a in alerts if a["kind"] == "backup.offsite_failure"]
