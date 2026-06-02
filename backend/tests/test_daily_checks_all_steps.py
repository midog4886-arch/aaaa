"""Wiring tests for every maintenance step of the scheduled daily-checks job.

The scheduled background job ``server._run_daily_renewal_and_ads_checks`` runs
many steps in sequence:

  * per-tenant renewal / ad-expiry iteration via ``utils.tenant.for_each_active_tenant``
  * trial-ending owner emails (``control_db.send_trial_ending_emails``)
  * auto-suspend of expired tenants (``control_db.auto_suspend_expired``)
  * expired email-confirmation reminders (``control_db.notify_expired_email_confirmations``)
  * the ops-alerts daily digest (``server._send_ops_alerts_daily_digest``)
  * push-subscription cleanup / prune (covered by ``test_daily_checks_push_cleanup.py``)

Only the push cleanup/prune steps previously had wiring tests. The other steps
could silently disconnect (a moved import, an added guard, a swallowed error)
and never run in production without any test catching it. These tests drive the
job function directly — no live MongoDB and no real scheduler timing. Every
heavy dependency the job lazily imports is monkeypatched on its source module
(``from X import Y`` re-reads the attribute at call time), so each step reaches a
spy that records the call and returns a controllable summary. The patches use
``raising=True`` (the default) so that if a production import target is renamed
or removed, the test setup itself fails loudly rather than masking the very
disconnect these wiring tests exist to catch.

They assert, for every step, that it is actually invoked, that any errors it
reports are folded into the job's error list and persisted, and that a step
failing (returning errors or raising) never prevents the later steps from
running (each step is independently guarded in its own try/except). One test
also drives the real per-tenant callback (with a fake tenant and branch) to
verify the renewal/ads checks themselves are reached, not just the iterator.
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


# The maintenance steps this file is responsible for, in execution order.
_MAINTENANCE_STEPS = (
    "for_each_active_tenant",
    "send_trial_ending_emails",
    "auto_suspend_expired",
    "notify_expired_email_confirmations",
    "_send_ops_alerts_daily_digest",
    "cleanup_superseded_subscriptions",
    "prune_inactive_subscriptions",
)


def _install_job_spies(monkeypatch, server_module, **overrides):
    """Replace every dependency of the daily job with a recording spy.

    Each spy increments ``calls[name]`` and then awaits either the test-supplied
    override (passed as a keyword argument matching the dependency name) or a
    quiet default that reports a clean run. ``_persist_daily_checks_status`` is
    stubbed to capture the kwargs the job hands it (so tests can assert how each
    step's summary/errors were persisted for the admin status page), and
    ``_emit_ops_alert`` is neutralised so a missing Mongo/SMTP cannot interfere.

    Returns ``(calls, captured)`` where ``calls`` maps each dependency name to
    its invocation count and ``captured["persist"]`` holds the persistence
    kwargs after the run.
    """
    import routes.notifications as notifications_mod
    import routes.push_notifications as push_mod
    import utils.tenant as tenant_mod
    import control_db as control_mod

    calls: dict = {}
    captured: dict = {}

    # Step 2 import (notifications routes) must succeed or the job returns early,
    # before any of the steps under test. The per-tenant callback is never run
    # because the default ``for_each`` spy does not invoke it.
    async def _default_check(*_a, **_k):
        return {"count": 0}

    async def _default_for_each(_callback, label=None):
        return {"processed": 1, "failed": [], "results": {}, "errors": {}}

    async def _default_trial(*_a, **_k):
        return {"errors": []}

    async def _default_suspend(*_a, **_k):
        return 0

    async def _default_confirm(*_a, **_k):
        return {"errors": []}

    async def _default_digest(*_a, **_k):
        return (False, 0)

    async def _default_cleanup(*_a, **_k):
        return {"deactivated": 0, "duplicate_devices": 0, "errors": []}

    async def _default_prune(*_a, **_k):
        return {"deleted": 0, "retention_days": 90, "scanned_inactive": 0, "errors": []}

    def _wrap(name, default):
        impl = overrides.get(name, default)

        async def wrapper(*a, **k):
            calls[name] = calls.get(name, 0) + 1
            return await impl(*a, **k)

        return wrapper

    monkeypatch.setattr(
        notifications_mod, "check_subscription_renewals",
        _wrap("check_subscription_renewals", _default_check), raising=True,
    )
    monkeypatch.setattr(
        notifications_mod, "check_ads_expiry",
        _wrap("check_ads_expiry", _default_check), raising=True,
    )
    monkeypatch.setattr(
        tenant_mod, "for_each_active_tenant",
        _wrap("for_each_active_tenant", _default_for_each), raising=True,
    )
    monkeypatch.setattr(
        control_mod, "send_trial_ending_emails",
        _wrap("send_trial_ending_emails", _default_trial), raising=True,
    )
    monkeypatch.setattr(
        control_mod, "auto_suspend_expired",
        _wrap("auto_suspend_expired", _default_suspend), raising=True,
    )
    monkeypatch.setattr(
        control_mod, "notify_expired_email_confirmations",
        _wrap("notify_expired_email_confirmations", _default_confirm), raising=True,
    )
    monkeypatch.setattr(
        server_module, "_send_ops_alerts_daily_digest",
        _wrap("_send_ops_alerts_daily_digest", _default_digest), raising=True,
    )
    monkeypatch.setattr(
        push_mod, "cleanup_superseded_subscriptions",
        _wrap("cleanup_superseded_subscriptions", _default_cleanup), raising=True,
    )
    monkeypatch.setattr(
        push_mod, "prune_inactive_subscriptions",
        _wrap("prune_inactive_subscriptions", _default_prune), raising=True,
    )

    async def _fake_persist(**kwargs):
        captured["persist"] = kwargs

    monkeypatch.setattr(server_module, "_persist_daily_checks_status", _fake_persist, raising=True)

    async def _noop_emit(*_a, **_k):
        return None

    monkeypatch.setattr(server_module, "_emit_ops_alert", _noop_emit, raising=True)

    return calls, captured


def _run(server_module):
    return asyncio.run(server_module._run_daily_renewal_and_ads_checks(trigger="test"))


def test_all_maintenance_steps_are_invoked(monkeypatch, server_module):
    """The happy path: every maintenance step is awaited exactly once and a
    clean run persists success=True / errors=[]."""
    calls, captured = _install_job_spies(monkeypatch, server_module)

    summary = _run(server_module)

    for name in _MAINTENANCE_STEPS:
        assert calls.get(name) == 1, f"{name} was not invoked exactly once (got {calls.get(name)})"

    assert summary["success"] is True
    assert summary["errors"] == []
    assert captured["persist"]["success"] is True
    assert captured["persist"]["errors"] == []


def test_trial_ending_email_errors_are_folded(monkeypatch, server_module):
    """Errors reported inside the trial-ending-email summary are prefixed,
    folded into the job's error list, persisted, and flip the run to failed —
    proving the summary is handled, not silently discarded. Later steps still
    run."""

    async def trial_with_errors(*_a, **_k):
        return {"errors": ["smtp refused"]}

    calls, captured = _install_job_spies(
        monkeypatch, server_module, send_trial_ending_emails=trial_with_errors
    )

    summary = _run(server_module)

    assert summary["success"] is False
    assert "trial_ending email: smtp refused" in summary["errors"]
    assert "trial_ending email: smtp refused" in captured["persist"]["errors"]
    # Steps that come after trial emails still executed.
    assert calls["auto_suspend_expired"] == 1
    assert calls["notify_expired_email_confirmations"] == 1
    assert calls["_send_ops_alerts_daily_digest"] == 1


def test_expired_confirmation_errors_are_folded(monkeypatch, server_module):
    """Errors reported by the expired email-confirmation reminders are prefixed,
    folded into the job error list, persisted, and flip the run to failed."""

    async def confirm_with_errors(*_a, **_k):
        return {"errors": ["reminder delivery failed"]}

    calls, captured = _install_job_spies(
        monkeypatch, server_module, notify_expired_email_confirmations=confirm_with_errors
    )

    summary = _run(server_module)

    assert summary["success"] is False
    assert "email_confirmation_expired: reminder delivery failed" in summary["errors"]
    assert "email_confirmation_expired: reminder delivery failed" in captured["persist"]["errors"]


def test_trial_email_exception_is_isolated(monkeypatch, server_module):
    """If the trial-ending-email step raises, the job records the failure and
    STILL runs every later step (each step is independently guarded)."""

    async def boom(*_a, **_k):
        raise RuntimeError("kapow")

    calls, captured = _install_job_spies(
        monkeypatch, server_module, send_trial_ending_emails=boom
    )

    summary = _run(server_module)

    assert summary["success"] is False
    assert any("trial-ending emails failed" in e for e in summary["errors"])
    assert any("trial-ending emails failed" in e for e in captured["persist"]["errors"])
    # Every step after the failing one still executed.
    assert calls["auto_suspend_expired"] == 1
    assert calls["notify_expired_email_confirmations"] == 1
    assert calls["_send_ops_alerts_daily_digest"] == 1
    assert calls["cleanup_superseded_subscriptions"] == 1
    assert calls["prune_inactive_subscriptions"] == 1


def test_auto_suspend_exception_is_isolated(monkeypatch, server_module):
    """An auto-suspend failure is caught, recorded, and does not stop the
    remaining steps."""

    async def boom(*_a, **_k):
        raise RuntimeError("suspend boom")

    calls, captured = _install_job_spies(monkeypatch, server_module, auto_suspend_expired=boom)

    summary = _run(server_module)

    assert summary["success"] is False
    assert any("auto-suspend failed" in e for e in summary["errors"])
    assert captured["persist"]["success"] is False
    assert any("auto-suspend failed" in e for e in captured["persist"]["errors"])
    assert calls["notify_expired_email_confirmations"] == 1
    assert calls["_send_ops_alerts_daily_digest"] == 1


def test_ops_digest_exception_is_isolated(monkeypatch, server_module):
    """A crash in the ops-alerts digest is caught and recorded, and the push
    maintenance steps that follow still run."""

    async def boom(*_a, **_k):
        raise RuntimeError("digest boom")

    calls, captured = _install_job_spies(
        monkeypatch, server_module, _send_ops_alerts_daily_digest=boom
    )

    summary = _run(server_module)

    assert summary["success"] is False
    assert any("ops-alerts digest failed" in e for e in summary["errors"])
    assert captured["persist"]["success"] is False
    assert any("ops-alerts digest failed" in e for e in captured["persist"]["errors"])
    assert calls["cleanup_superseded_subscriptions"] == 1
    assert calls["prune_inactive_subscriptions"] == 1


def test_ops_digest_results_propagate(monkeypatch, server_module):
    """When the digest reports it emailed N exhausted alerts, those values are
    surfaced in the job's return summary without flipping success."""

    async def digest(*_a, **_k):
        return (True, 5)

    _install_job_spies(monkeypatch, server_module, _send_ops_alerts_daily_digest=digest)

    summary = _run(server_module)

    assert summary["ops_alerts_digest_sent"] is True
    assert summary["ops_alerts_digest_count"] == 5
    assert summary["success"] is True


def test_per_tenant_iteration_results_are_folded(monkeypatch, server_module):
    """The per-tenant renewal/ads iteration result is consumed: processed count
    is surfaced, and a tenant whose scope failed is recorded as an error and
    counted as failed."""

    async def for_each(_callback, label=None):
        return {
            "processed": 3,
            "failed": ["acme"],
            "results": {"acme": {}},
            "errors": {"acme": "scope kaboom"},
        }

    calls, captured = _install_job_spies(
        monkeypatch, server_module, for_each_active_tenant=for_each
    )

    summary = _run(server_module)

    assert calls["for_each_active_tenant"] == 1
    assert summary["tenants_processed"] == 3
    assert summary["tenants_failed"] == 1
    assert "[acme] tenant scope failed: scope kaboom" in summary["errors"]
    assert summary["success"] is False
    assert captured["persist"]["tenants_processed"] == 3
    assert captured["persist"]["tenants_failed"] == 1


class _FakeBranchCursor:
    """Async cursor mimicking ``db.branches.find(...)``."""

    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        async def _gen():
            for d in self._docs:
                yield d

        return _gen()


class _FakeBranches:
    def __init__(self, docs):
        self._docs = docs

    def find(self, *_a, **_k):
        return _FakeBranchCursor(self._docs)


class _FakeDB:
    def __init__(self, branch_docs):
        self.branches = _FakeBranches(branch_docs)


def test_per_tenant_callback_runs_renewal_and_ads_checks(monkeypatch, server_module):
    """Exercise the real per-tenant callback: when ``for_each_active_tenant``
    invokes the callback with a tenant, the renewal and ad-expiry checks must
    actually be called (admin-global + per-branch). This guards against the
    callback silently disconnecting from the notification checks even though the
    iteration itself still runs.
    """
    seen = {"label": None, "global_renewals": 0}

    async def real_for_each(callback, label=None):
        seen["label"] = label
        # Drive the callback exactly like the real iterator would.
        await callback({"slug": "acme"})
        return {"processed": 1, "failed": [], "results": {}, "errors": {}}

    calls, captured = _install_job_spies(
        monkeypatch, server_module, for_each_active_tenant=real_for_each
    )

    # The admin-global renewal call resolves to server.py's own module-level
    # ``check_subscription_renewals`` (defined later in server.py), not the
    # ``routes.notifications`` alias — patch it so we can confirm it runs.
    async def spy_global_renewals(current_user=None):
        seen["global_renewals"] += 1
        return {"count": 1}

    monkeypatch.setattr(server_module, "check_subscription_renewals", spy_global_renewals, raising=True)

    # One fake branch so the per-branch renewal/ads checks execute.
    monkeypatch.setattr(server_module, "db", _FakeDB([{"id": "branch-1"}]), raising=True)

    summary = _run(server_module)

    # The job iterated tenants with the expected label.
    assert seen["label"] == "renewal_ads"
    # Admin-global renewal check ran.
    assert seen["global_renewals"] == 1
    # Per-branch renewal check (routes.notifications alias) ran for the branch.
    assert calls.get("check_subscription_renewals") == 1
    # Ads-expiry ran for both the branch and the admin-global scope.
    assert calls.get("check_ads_expiry") == 2
    # A clean per-tenant run keeps the job successful.
    assert summary["success"] is True
    assert captured["persist"]["success"] is True


def test_per_tenant_iteration_exception_is_isolated(monkeypatch, server_module):
    """If the whole per-tenant iteration raises, the job records it but still
    proceeds to every control-plane and push maintenance step."""

    async def boom(_callback, label=None):
        raise RuntimeError("iter boom")

    calls, captured = _install_job_spies(
        monkeypatch, server_module, for_each_active_tenant=boom
    )

    summary = _run(server_module)

    assert summary["success"] is False
    assert any("per-tenant iteration failed" in e for e in summary["errors"])
    assert captured["persist"]["success"] is False
    assert any("per-tenant iteration failed" in e for e in captured["persist"]["errors"])
    # Control-plane and push steps after the iteration still executed.
    assert calls["send_trial_ending_emails"] == 1
    assert calls["auto_suspend_expired"] == 1
    assert calls["notify_expired_email_confirmations"] == 1
    assert calls["_send_ops_alerts_daily_digest"] == 1
    assert calls["cleanup_superseded_subscriptions"] == 1
    assert calls["prune_inactive_subscriptions"] == 1
