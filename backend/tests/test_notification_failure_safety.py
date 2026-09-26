import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from pymongo.errors import DuplicateKeyError
from routes import billing
from utils.notification_health import report_notification_failure
from routes import push_notifications


class Claims:
    def __init__(self):
        self.rows = {}

    async def insert_one(self, doc):
        if doc["_id"] in self.rows:
            raise DuplicateKeyError("duplicate")
        self.rows[doc["_id"]] = dict(doc)

    async def update_one(self, query, update):
        self.rows[query["_id"]].update(update["$set"])

    async def delete_one(self, query):
        self.rows.pop(query["_id"], None)


def test_owner_event_fence_concurrent_tenant_isolated(monkeypatch):
    claims = Claims()
    sender = AsyncMock(return_value={"status": "sent"})
    monkeypatch.setattr(billing, "control_db", SimpleNamespace(payment_owner_alerts=claims))
    monkeypatch.setattr(billing, "send_email", sender)

    async def scenario():
        tenant = {"id": "a", "slug": "a", "owner_email": "owner@example.test"}
        kwargs = dict(reason="failure", provider="stripe", event_key="event1")
        await asyncio.gather(*(billing._notify_owner_webhook_failure(tenant, **kwargs) for _ in range(10)))
        assert sender.await_count == 1
        await billing._notify_owner_webhook_failure({**tenant, "id": "b"}, **kwargs)
        assert sender.await_count == 2
        await billing._notify_owner_webhook_failure(tenant, **{**kwargs, "event_key": "event2"})
        assert sender.await_count == 3
    asyncio.run(scenario())


def test_unsent_config_skip_can_retry_but_uncertain_transport_cannot(monkeypatch):
    claims = Claims()
    sender = AsyncMock(side_effect=[{"status": "skipped"}, {"status": "failed"}])
    monkeypatch.setattr(billing, "control_db", SimpleNamespace(payment_owner_alerts=claims))
    monkeypatch.setattr(billing, "send_email", sender)
    async def scenario():
        tenant = {"id": "a", "owner_email": "owner@example.test"}
        kwargs = dict(reason="error", provider="tap", event_key="e")
        await billing._notify_owner_webhook_failure(tenant, **kwargs)
        assert not claims.rows
        await billing._notify_owner_webhook_failure(tenant, **kwargs)
        await billing._notify_owner_webhook_failure(tenant, **kwargs)
        assert sender.await_count == 2
        assert next(iter(claims.rows.values()))["status"] == "failed"
    asyncio.run(scenario())


def test_warning_persists_even_if_bell_service_broken():
    db = {"notifications": SimpleNamespace(insert_one=AsyncMock(side_effect=RuntimeError("offline"))),
          "ops_alerts": SimpleNamespace(insert_one=AsyncMock())}
    asyncio.run(report_notification_failure(db, source="expense_pending", branch_id="b1"))
    row = db["ops_alerts"].insert_one.call_args.args[0]
    assert row["branch_id"] == "b1"
    assert row["delivery_status"] == "pending"
    assert "offline" not in row["body"]


def test_admin_push_pipeline_outage_is_visible_not_zero_success(monkeypatch):
    users = SimpleNamespace(find=lambda *args: (_ for _ in ()).throw(RuntimeError("offline")))
    db = {"notifications": SimpleNamespace(insert_one=AsyncMock()),
          "ops_alerts": SimpleNamespace(insert_one=AsyncMock())}
    class DB(dict):
        pass
    fake = DB(db)
    fake.users = users
    monkeypatch.setattr(push_notifications, "db", fake)
    result = asyncio.run(push_notifications.send_push_to_admins(
        push_notifications.NotificationPayload(title="Test", body="Test"), branch_id="b1"))
    assert result["error"] == "notification_service_unavailable"
    for collection in db.values():
        assert collection.insert_one.await_count == 1