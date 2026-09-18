"""Isolated tests for control-plane tenant lookup in-flight coalescing."""
import asyncio
import copy
import os
import sys

import pytest


os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import control_db as control_db_module


class _FakeTenants:
    def __init__(self, handler):
        self.handler = handler
        self.calls = []

    async def find_one(self, query, projection):
        self.calls.append((copy.deepcopy(query), copy.deepcopy(projection)))
        return await self.handler(query)


class _FakeControlDB:
    def __init__(self, tenants):
        self.tenants = tenants


@pytest.fixture(autouse=True)
def _clear_inflight():
    control_db_module._tenant_lookup_inflight.clear()
    yield
    control_db_module._tenant_lookup_inflight.clear()


def _install(monkeypatch, handler):
    tenants = _FakeTenants(handler)
    monkeypatch.setattr(control_db_module, "control_db", _FakeControlDB(tenants))
    return tenants


def test_twelve_concurrent_reads_coalesce_and_sequential_reads_are_fresh(monkeypatch):
    async def scenario():
        release = asyncio.Event()
        statuses = iter(("active", "suspended", "rejected", "deleted"))

        async def handler(_query):
            status = next(statuses)
            if status == "active":
                await release.wait()
            return {
                "slug": "academy",
                "status": status,
                "branding": {"logo_base64": "full-logo", "background": "full-bg"},
            }

        tenants = _install(monkeypatch, handler)
        pending = [
            asyncio.create_task(control_db_module.get_tenant_by_slug("academy"))
            for _ in range(12)
        ]
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert len(tenants.calls) == 1
        assert tenants.calls[0] == ({"slug": "academy"}, {"_id": 0})

        release.set()
        concurrent = await asyncio.gather(*pending)
        assert len(tenants.calls) == 1
        assert {row["status"] for row in concurrent} == {"active"}
        assert all(row["branding"]["logo_base64"] == "full-logo" for row in concurrent)

        # Coalesced callers receive independent mutable document graphs.
        concurrent[0]["branding"]["logo_base64"] = "mutated"
        assert concurrent[1]["branding"]["logo_base64"] == "full-logo"

        fresh = [
            await control_db_module.get_tenant_by_slug("academy")
            for _ in range(3)
        ]
        assert [row["status"] for row in fresh] == [
            "suspended", "rejected", "deleted"
        ]
        assert len(tenants.calls) == 4

    asyncio.run(scenario())


def test_motor_style_future_is_accepted_and_coalesced(monkeypatch):
    async def scenario():
        class _MotorStyleTenants:
            def __init__(self):
                self.calls = []
                self.result_future = None

            # Motor's method is synchronous and returns an asyncio Future.
            def find_one(self, query, projection):
                self.calls.append(
                    (copy.deepcopy(query), copy.deepcopy(projection))
                )
                self.result_future = asyncio.get_running_loop().create_future()
                return self.result_future

        tenants = _MotorStyleTenants()
        monkeypatch.setattr(
            control_db_module, "control_db", _FakeControlDB(tenants)
        )
        pending = [
            asyncio.create_task(control_db_module.get_tenant_by_slug("motor"))
            for _ in range(12)
        ]
        await asyncio.sleep(0)
        assert tenants.calls == [({"slug": "motor"}, {"_id": 0})]

        tenants.result_future.set_result(
            {"slug": "motor", "branding": {"logo_base64": "logo"}}
        )
        results = await asyncio.gather(*pending)
        assert len(results) == 12
        assert all(result["slug"] == "motor" for result in results)
        results[0]["branding"]["logo_base64"] = "changed"
        assert results[1]["branding"]["logo_base64"] == "logo"

    asyncio.run(scenario())


def test_failed_lookup_is_retried(monkeypatch):
    async def scenario():
        attempts = 0

        async def handler(_query):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("control DB unavailable")
            return {"slug": "academy", "status": "active"}

        tenants = _install(monkeypatch, handler)
        with pytest.raises(RuntimeError, match="control DB unavailable"):
            await control_db_module.get_tenant_by_slug("academy")
        assert await control_db_module.get_tenant_by_slug("academy") == {
            "slug": "academy", "status": "active"
        }
        assert len(tenants.calls) == 2

    asyncio.run(scenario())


def test_none_result_is_not_cached(monkeypatch):
    async def scenario():
        results = iter((None, {"slug": "new-academy", "status": "active"}))

        async def handler(_query):
            return next(results)

        tenants = _install(monkeypatch, handler)
        assert await control_db_module.get_tenant_by_slug("new-academy") is None
        assert await control_db_module.get_tenant_by_slug("new-academy") == {
            "slug": "new-academy", "status": "active"
        }
        assert len(tenants.calls) == 2

    asyncio.run(scenario())


def test_cancelling_one_waiter_does_not_cancel_shared_lookup(monkeypatch):
    async def scenario():
        started = asyncio.Event()
        release = asyncio.Event()

        async def handler(_query):
            started.set()
            await release.wait()
            return {"slug": "academy", "nested": {"value": 1}}

        tenants = _install(monkeypatch, handler)
        cancelled_waiter = asyncio.create_task(
            control_db_module.get_tenant_by_slug("academy")
        )
        surviving_waiter = asyncio.create_task(
            control_db_module.get_tenant_by_slug("academy")
        )
        await started.wait()
        cancelled_waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cancelled_waiter

        release.set()
        assert await surviving_waiter == {
            "slug": "academy", "nested": {"value": 1}
        }
        assert len(tenants.calls) == 1
        assert not control_db_module._tenant_lookup_inflight

    asyncio.run(scenario())


def test_distinct_slugs_are_independent_and_documents_do_not_cross(monkeypatch):
    async def scenario():
        releases = {"alpha": asyncio.Event(), "beta": asyncio.Event()}

        async def handler(query):
            slug = query["slug"]
            await releases[slug].wait()
            return {"slug": slug, "branding": {"logo": f"{slug}-logo"}}

        tenants = _install(monkeypatch, handler)
        alpha = asyncio.create_task(control_db_module.get_tenant_by_slug("alpha"))
        beta = asyncio.create_task(control_db_module.get_tenant_by_slug("beta"))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert len(tenants.calls) == 2

        releases["beta"].set()
        beta_doc = await beta
        assert not alpha.done()
        releases["alpha"].set()
        alpha_doc = await alpha

        assert alpha_doc == {
            "slug": "alpha", "branding": {"logo": "alpha-logo"}
        }
        assert beta_doc == {"slug": "beta", "branding": {"logo": "beta-logo"}}

    asyncio.run(scenario())