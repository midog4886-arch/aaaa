import asyncio
import json
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from routes import whatsapp as mod


def matches(row, query):
    for key, value in query.items():
        if key == "$or":
            if not any(matches(row, part) for part in value):
                return False
        elif isinstance(value, dict):
            if "$exists" in value and (key in row) != value["$exists"]:
                return False
            if "$lte" in value and (key not in row or row[key] > value["$lte"]):
                return False
        elif row.get(key) != value:
            return False
    return True


class Collection:
    def __init__(self, rows=()):
        self.rows = list(rows)

    async def find_one(self, query, *args):
        return next((r.copy() for r in self.rows if matches(r, query)), None)

    async def create_index(self, *args, **kwargs):
        pass

    async def insert_one(self, row):
        if any(all(r.get(k) == row.get(k) for k in (
            "branch_id", "provider", "provider_message_id"
        )) for r in self.rows):
            raise mod.DuplicateKeyError("duplicate")
        self.rows.append(row.copy())

    async def update_one(self, query, update, upsert=False):
        row = next((r for r in self.rows if matches(r, query)), None)
        if row is None:
            if not upsert:
                return
            row = dict(query)
            row.update(update.get("$setOnInsert", {}))
            self.rows.append(row)
        row.update(update.get("$set", {}))
        for key, value in update.get("$inc", {}).items():
            row[key] = row.get(key, 0) + value


@pytest.fixture
def db(monkeypatch):
    database = {
        "whatsapp_branch_configs": Collection([{
            "branch_id": "a", "provider": "whatsflow",
            "enabled": True, "whatsflow_instance": "instance-a",
        }]),
        "whatsapp_cloud_messages": Collection(),
        "whatsapp_cloud_conversations": Collection([{
            "id": "a:966500000001", "branch_id": "a", "contact_name": "Customer",
            "last_inbound_at": "2026-09-10T10:00:00+00:00",
            "last_message_at": "2026-09-10T10:00:00+00:00",
            "last_message": "Question", "unread_count": 2,
        }]),
    }
    monkeypatch.setattr(mod, "_db", database)
    async def tenant(slug):
        assert slug == "tenant-a"
        return "token"
    monkeypatch.setattr(mod, "_with_webhook_tenant", tenant)
    monkeypatch.setattr(mod, "reset_current_tenant", lambda token: None)
    monkeypatch.setattr(mod, "_whatsflow_webhook_secret", lambda *args: "test-secret")
    return database


def deliver(*, outbound=True, timestamp="2026-09-10T10:01:00+00:00",
            branch="a", instance="instance-a", secret="test-secret",
            jid="966500000001@s.whatsapp.net"):
    envelope = {
        "event": "messages.upsert", "instance": instance,
        "data": {
            "key": {"id": "message-1", "fromMe": outbound, "remoteJid": jid},
            "messageTimestamp": datetime.fromisoformat(timestamp).timestamp(),
            "message": {"conversation": "Phone reply"},
            "pushName": "Branch owner",
        },
    }
    class Request:
        headers = {"x-webhook-secret": secret}
        async def body(self):
            return json.dumps(envelope).encode()
    return asyncio.run(mod.receive_whatsflow_webhook("tenant-a", branch, Request()))


def test_phone_reply_clears_unread_preserves_customer_and_deduplicates(db):
    deliver()
    deliver()
    messages = db["whatsapp_cloud_messages"].rows
    assert len(messages) == 1
    assert messages[0]["direction"] == "outbound"
    assert messages[0]["status"] == "sent"
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    assert conversation["unread_count"] == 0
    assert conversation["contact_name"] == "Customer"
    assert conversation["last_direction"] == "outbound"
    assert conversation["last_message"] == "Phone reply"


def test_old_reply_does_not_clear_newer_incoming_or_replace_preview(db):
    deliver(timestamp="2026-09-10T09:59:00+00:00")
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    assert conversation["unread_count"] == 2
    assert conversation["last_message"] == "Question"
    assert len(db["whatsapp_cloud_messages"].rows) == 1


def test_incoming_still_increments_unread(db):
    deliver(outbound=False)
    assert db["whatsapp_cloud_conversations"].rows[0]["unread_count"] == 3
    assert db["whatsapp_cloud_messages"].rows[0]["direction"] == "inbound"


@pytest.mark.parametrize("params", [
    {"branch": "b"}, {"instance": "wrong-instance"}, {"secret": "invalid"},
])
def test_authentication_and_branch_binding(db, params):
    with pytest.raises(HTTPException) as exc:
        deliver(**params)
    assert exc.value.status_code == 403
    assert not db["whatsapp_cloud_messages"].rows


@pytest.mark.parametrize("jid", ["123@g.us", "status@broadcast", "123@lid"])
def test_non_phone_chats_are_not_misidentified(db, jid):
    deliver(jid=jid)
    assert not db["whatsapp_cloud_messages"].rows


def test_other_branch_conversation_is_untouched(db):
    db["whatsapp_cloud_conversations"].rows.append({
        "id": "b:966500000001", "branch_id": "b", "unread_count": 5,
    })
    deliver()
    assert db["whatsapp_cloud_conversations"].rows[1]["unread_count"] == 5


@pytest.mark.parametrize("endpoint", ["provider", "cloud"])
def test_successful_connection_test_is_saved_without_webhook(db, monkeypatch, endpoint):
    from unittest.mock import AsyncMock
    config = {"provider": "whatsflow", "enabled": True, "branch_id": "a"}
    monkeypatch.setattr(mod, "_get_branch_cloud_config", AsyncMock(return_value=config))
    monkeypatch.setattr(mod, "_require_session_provider_branch", AsyncMock(return_value=config))
    sender = AsyncMock(return_value=(True, "test-message", None))
    monkeypatch.setattr(mod, "_send_session_provider_result", sender)
    handler = mod.branch_provider_test if endpoint == "provider" else mod.test_branch_cloud_config
    model = mod.WAHABranchTestRequest if endpoint == "provider" else mod.BranchCloudTestRequest
    result = asyncio.run(handler("a", model(phone="966500000002", message="Test"),
                                 {"is_admin": True, "id": "admin"}))
    assert result["success"]
    sender.assert_awaited_once()
    message = db["whatsapp_cloud_messages"].rows[0]
    assert message["direction"] == "outbound"
    assert message["body"] == "Test"
    assert message["branch_id"] == "a"
    conversation = db["whatsapp_cloud_conversations"].rows[-1]
    assert conversation["id"] == "a:966500000002"
    assert conversation["last_message"] == "Test"
    assert conversation["unread_count"] == 0


def test_recording_test_deduplicates_echo_and_keeps_unread(db):
    config = {"provider": "whatsflow", "enabled": True}
    deliver()
    asyncio.run(mod._record_branch_test_message(
        "a", "966500000001", "Phone reply", config, "message-1", {"id": "admin"}))
    assert len(db["whatsapp_cloud_messages"].rows) == 1
    assert db["whatsapp_cloud_conversations"].rows[0]["contact_name"] == "Customer"


def test_failed_connection_test_does_not_create_conversation(db, monkeypatch):
    from unittest.mock import AsyncMock
    monkeypatch.setattr(mod, "_require_session_provider_branch", AsyncMock(return_value={
        "provider": "whatsflow", "enabled": True,
    }))
    monkeypatch.setattr(mod, "_send_session_provider_result",
                        AsyncMock(return_value=(False, None, "http_401")))
    with pytest.raises(HTTPException):
        asyncio.run(mod.branch_provider_test(
            "a", mod.WAHABranchTestRequest(phone="966500000002", message="Test"),
            {"is_admin": True}))
    assert not db["whatsapp_cloud_messages"].rows
    assert len(db["whatsapp_cloud_conversations"].rows) == 1