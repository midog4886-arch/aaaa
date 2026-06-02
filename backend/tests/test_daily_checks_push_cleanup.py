"""Wiring tests for the scheduled daily-checks job (Task #338).

The cross-academy push-subscription cleanup and the inactive-subscription prune
are both invoked from the scheduled background job
``server._run_daily_renewal_and_ads_checks`` (steps 8 and 9). The sweep/prune
functions themselves are unit-tested elsewhere
(``test_push_superseded_cleanup.py`` / ``test_push_cross_tenant_dedup.py``), but
nothing verified that the scheduler still *calls* them. If an import were moved
or a guard added, the cleanup would silently never run in production and these
tests would catch it.

These drive the job function directly — no live MongoDB and no real scheduler
timing. Every heavy dependency the job lazily imports is monkeypatched on its
source module (``from X import Y`` re-reads the attribute at call time), so the
job reaches steps 8/9 with ``cleanup_superseded_subscriptions`` and
``prune_inactive_subscriptions`` replaced by spies.
"""
import os
import sys
import asyncio

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


@pytest.fixture
def server_module():
    import server  # noqa: WPS433

    return server


def _stub_job_dependencies(monkeypatch, server_module, *, cleanup_fn, prune_fn):
    """Neutralise every part of the daily job except the push cleanup/prune.

    Returns a dict the caller can inspect after the run, currently the kwargs the
    job passed to ``_persist_daily_checks_status`` (so tests can assert how the
    cleanup summary was handled/logged).
    """
    import routes.notifications as notifications_mod
    import routes.push_notifications as push_mod
    import utils.tenant as tenant_mod
    import control_db as control_mod

    captured: dict = {}

    # Step 2 import must succeed or the job returns early, before push cleanup.
    async def _noop_check(*_a, **_k):
        return {"count": 0}

    monkeypatch.setattr(notifications_mod, "check_subscription_renewals", _noop_check, raising=False)
    monkeypatch.setattr(notifications_mod, "check_ads_expiry", _noop_check, raising=False)

    # Per-tenant iteration: report a clean run without touching Mongo or invoking
    # the callback (which would reference db.branches).
    async def _fake_for_each(_callback, label=None):
        return {"processed": 1, "failed": [], "results": {}, "errors": {}}

    monkeypatch.setattr(tenant_mod, "for_each_active_tenant", _fake_for_each, raising=False)

    # Control-plane checks (steps 4-6): quiet no-ops.
    async def _empty_summary(*_a, **_k):
        return {"errors": []}

    async def _zero(*_a, **_k):
        return 0

    monkeypatch.setattr(control_mod, "send_trial_ending_emails", _empty_summary, raising=False)
    monkeypatch.setattr(control_mod, "auto_suspend_expired", _zero, raising=False)
    monkeypatch.setattr(control_mod, "notify_expired_email_confirmations", _empty_summary, raising=False)

    # Step 7: ops-alerts digest -> nothing to send.
    async def _no_digest(*_a, **_k):
        return (False, 0)

    monkeypatch.setattr(server_module, "_send_ops_alerts_daily_digest", _no_digest, raising=False)

    # Steps 8 & 9: the functions under test, replaced by the caller's spies.
    monkeypatch.setattr(push_mod, "cleanup_superseded_subscriptions", cleanup_fn, raising=False)
    monkeypatch.setattr(push_mod, "prune_inactive_subscriptions", prune_fn, raising=False)

    # Final persistence step is NOT wrapped in try/except in the job; stub it so a
    # missing Mongo cannot mask the assertions, and capture what it received.
    async def _fake_persist(**kwargs):
        captured["persist"] = kwargs

    monkeypatch.setattr(server_module, "_persist_daily_checks_status", _fake_persist, raising=False)

    # On failure the job emits an ops alert (best-effort); stub it so a missing
    # Mongo / SMTP cannot interfere with the failure-path assertions.
    async def _noop_emit(*_a, **_k):
        return None

    monkeypatch.setattr(server_module, "_emit_ops_alert", _noop_emit, raising=False)

    return captured


def test_scheduler_invokes_push_cleanup_and_prune(monkeypatch, server_module, capsys):
    """The happy path: the job awaits both push maintenance functions exactly
    once and logs each summary. A clean run persists success=True / errors=[]."""
    calls = {"cleanup": 0, "prune": 0}

    async def spy_cleanup():
        calls["cleanup"] += 1
        return {"deactivated": 4, "duplicate_devices": 2, "errors": []}

    async def spy_prune():
        calls["prune"] += 1
        return {"deleted": 7, "retention_days": 90, "scanned_inactive": 12, "errors": []}

    captured = _stub_job_dependencies(
        monkeypatch, server_module, cleanup_fn=spy_cleanup, prune_fn=spy_prune
    )

    summary = asyncio.run(server_module._run_daily_renewal_and_ads_checks(trigger="test"))

    # The wiring requirement: both maintenance functions were actually awaited.
    assert calls == {"cleanup": 1, "prune": 1}

    # Their summaries are surfaced in the job's own log output.
    out = capsys.readouterr().out
    assert "push-subscription cleanup → deactivated=4 dup_devices=2" in out
    assert "push-subscription prune → deleted=7" in out

    # A clean run reports success and persists it.
    assert summary["success"] is True
    assert summary["errors"] == []
    assert captured["persist"]["success"] is True
    assert captured["persist"]["errors"] == []


def test_scheduler_propagates_push_cleanup_and_prune_errors(monkeypatch, server_module):
    """Errors reported inside the cleanup/prune summaries must be folded into the
    job's error list (prefixed) and flip the run to success=False — proving the
    summary is handled, not silently discarded."""

    async def spy_cleanup():
        return {"deactivated": 0, "duplicate_devices": 0, "errors": ["sweep boom"]}

    async def spy_prune():
        return {"deleted": 0, "retention_days": 90, "scanned_inactive": 0, "errors": ["prune boom"]}

    captured = _stub_job_dependencies(
        monkeypatch, server_module, cleanup_fn=spy_cleanup, prune_fn=spy_prune
    )

    summary = asyncio.run(server_module._run_daily_renewal_and_ads_checks(trigger="test"))

    assert summary["success"] is False
    assert "push_cleanup: sweep boom" in summary["errors"]
    assert "push_prune: prune boom" in summary["errors"]
    # The same error list is what gets persisted for the admin status page.
    assert captured["persist"]["success"] is False
    assert "push_cleanup: sweep boom" in captured["persist"]["errors"]
    assert "push_prune: prune boom" in captured["persist"]["errors"]


def test_scheduler_survives_push_cleanup_raising(monkeypatch, server_module):
    """If the cleanup call itself raises, the job must catch it, record a
    ``push-subscription cleanup failed`` error, and STILL go on to run the prune
    (the two steps are independently guarded)."""
    calls = {"prune": 0}

    async def boom_cleanup():
        raise RuntimeError("cleanup exploded")

    async def spy_prune():
        calls["prune"] += 1
        return {"deleted": 1, "retention_days": 90, "scanned_inactive": 3, "errors": []}

    captured = _stub_job_dependencies(
        monkeypatch, server_module, cleanup_fn=boom_cleanup, prune_fn=spy_prune
    )

    summary = asyncio.run(server_module._run_daily_renewal_and_ads_checks(trigger="test"))

    # Prune still ran despite the cleanup blowing up.
    assert calls["prune"] == 1
    assert summary["success"] is False
    assert any("push-subscription cleanup failed" in e for e in summary["errors"])
    assert any("push-subscription cleanup failed" in e for e in captured["persist"]["errors"])
