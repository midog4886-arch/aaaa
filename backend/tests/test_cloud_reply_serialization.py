"""Regression coverage for Motor mutating cloud-inbox reply documents."""

from copy import deepcopy

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

from routes import whatsapp as whatsapp_mod


CONVERSATION_ID = "branch-a:966501234567"
CONVERSATION = {
    "id": CONVERSATION_ID,
    "branch_id": "branch-a",
    "phone": "966501234567",
    "last_inbound_at": "2999-01-01T00:00:00+00:00",
}


class _Collection:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]
        self.insert_calls = []
        self.update_calls = []

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                result = dict(row)
                if projection and projection.get("_id") == 0:
                    result.pop("_id", None)
                return result
        return None

    async def insert_one(self, document):
        # Motor/PyMongo mutates the exact mapping passed by the application.
        document["_id"] = ObjectId()
        self.insert_calls.append(document)
        self.rows.append(dict(document))

    async def update_one(self, query, update, **_kwargs):
        self.update_calls.append((query, update))


class _DuplicateEchoCollection(_Collection):
    async def insert_one(self, document):
        document["_id"] = ObjectId()
        self.insert_calls.append(document)
        raise DuplicateKeyError("authenticated provider echo won the race")


class _DB:
    def __init__(self, provider, messages=None):
        config = {"branch_id": "branch-a", "provider": provider, "enabled": True}
        if provider == "meta_cloud":
            config.update({
                "phone_number_id": "meta-phone-id",
                "access_token_encrypted": "not-used-by-test",
            })
        self.collections = {
            "whatsapp_branch_configs": _Collection([config]),
            "whatsapp_cloud_conversations": _Collection([CONVERSATION]),
            "whatsapp_cloud_messages": messages or _Collection(),
        }

    def __getitem__(self, name):
        return self.collections.setdefault(name, _Collection())


def _client(monkeypatch, provider, provider_result=(True, "provider-message-1", None),
            messages=None):
    db = _DB(provider, messages=messages)
    sends = []
    stops = []
    notes = []

    async def session_send(phone, body, config, automated):
        sends.append(("session", phone, body, config["provider"], automated))
        return provider_result

    async def meta_send(phone, body, config):
        sends.append(("meta", phone, body, config.get("message_template_name")))
        return provider_result

    async def stop(*args):
        stops.append(args)

    async def note(*args):
        notes.append(args)

    monkeypatch.setattr(whatsapp_mod, "_db", db)
    monkeypatch.setattr(whatsapp_mod, "_send_session_provider_result", session_send)
    monkeypatch.setattr(whatsapp_mod, "_send_meta_cloud_message_result", meta_send)
    monkeypatch.setattr(whatsapp_mod.registration_followups, "stop_phone", stop)
    monkeypatch.setattr(whatsapp_mod.campaign_inquiry_automation, "stop_phone", stop)
    monkeypatch.setattr(whatsapp_mod, "_note_cloud_human_reply", note)

    app = FastAPI()
    app.include_router(whatsapp_mod.router, prefix="/api")
    app.dependency_overrides[whatsapp_mod.get_current_user] = lambda: {
        "is_admin": True,
        "user_id": "staff-1",
    }
    return TestClient(app, raise_server_exceptions=False), db, sends, stops, notes


@pytest.mark.parametrize("provider", ["whatsflow", "waha", "meta_cloud"])
def test_cloud_text_reply_serializes_motor_mutated_message(
    monkeypatch, provider,
):
    client, db, sends, stops, notes = _client(monkeypatch, provider)

    response = client.post(
        f"/api/whatsapp/cloud-inbox/conversations/{CONVERSATION_ID}/reply",
        json={"body": "A human reply"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["success"] is True
    assert payload["message"]["id"]
    assert "_id" not in payload["message"]
    assert payload["message"].get("provider_message_id", payload["message"].get("meta_message_id")) == (
        "provider-message-1"
    )
    inserted = db["whatsapp_cloud_messages"].insert_calls
    assert len(inserted) == 1
    assert isinstance(inserted[0]["_id"], ObjectId)
    assert len(sends) == 1
    assert len(stops) == 2
    assert len(notes) == 1


def test_cloud_text_reply_duplicate_echo_recovery_stays_serializable(monkeypatch):
    existing = {
        "id": "echo-message-1",
        "conversation_id": CONVERSATION_ID,
        "branch_id": "branch-a",
        "provider": "whatsflow",
        "provider_message_id": "provider-message-1",
        "direction": "outbound",
        "body": "A human reply",
        "_id": ObjectId(),
    }
    messages = _DuplicateEchoCollection([existing])
    client, _db, sends, _stops, notes = _client(
        monkeypatch, "whatsflow", messages=messages,
    )

    response = client.post(
        f"/api/whatsapp/cloud-inbox/conversations/{CONVERSATION_ID}/reply",
        json={"body": "A human reply"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["message"]["id"] == "echo-message-1"
    assert "_id" not in response.json()["message"]
    assert len(sends) == 1
    assert len(messages.insert_calls) == 1
    assert len(notes) == 1


def test_cloud_text_reply_provider_failure_is_not_reported_as_success(monkeypatch):
    client, db, sends, stops, notes = _client(
        monkeypatch, "whatsflow", provider_result=(False, None, "http_503"),
    )

    response = client.post(
        f"/api/whatsapp/cloud-inbox/conversations/{CONVERSATION_ID}/reply",
        json={"body": "Do not claim this was sent"},
    )

    assert response.status_code == 502
    assert "whatsflow send failed (http_503)" in response.json()["detail"]
    assert len(sends) == 1
    assert len(stops) == 2
    assert notes == []
    assert db["whatsapp_cloud_messages"].insert_calls == []


@pytest.mark.parametrize(
    ("message_type", "metadata"),
    [
        ("image", {"media_storage_id": "private-image-1", "mime_type": "image/png"}),
        ("audio", {"media_storage_id": "private-audio-1", "mime_type": "audio/ogg"}),
    ],
)
def test_cloud_send_response_preserves_media_metadata_without_mutating_stored_message(
    message_type, metadata,
):
    message = {
        "_id": ObjectId(),
        "id": f"{message_type}-message-1",
        "type": message_type,
        "provider_message_id": f"{message_type}-provider-1",
        **metadata,
    }
    original = deepcopy(message)

    response = whatsapp_mod._cloud_send_response(message, used_template=False)

    assert response["success"] is True
    assert response["used_template"] is False
    assert response["message"] == {key: value for key, value in original.items() if key != "_id"}
    assert message == original