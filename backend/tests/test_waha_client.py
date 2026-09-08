import asyncio
import hashlib
import hmac
import json
from types import SimpleNamespace

from services.waha import WAHAClient
from routes import whatsapp as whatsapp_mod


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_waha_client_sends_api_key_and_text_payload(monkeypatch):
    captured = {}

    class Response:
        status_code = 200
        def json(self):
            return {"id": "waha-1"}

    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def request(self, method, url, headers, **kwargs):
            captured.update(method=method, url=url, headers=headers, **kwargs)
            return Response()

    monkeypatch.setattr("services.waha.httpx.AsyncClient", lambda **_: Client())
    ok, body, error = run(WAHAClient("https://waha.example", "secret").send_text(
        "academy-a", "966501234567@c.us", "hello"
    ))
    assert (ok, body, error) == (True, {"id": "waha-1"}, None)
    assert captured["headers"]["X-Api-Key"] == "secret"
    assert captured["json"] == {"session": "academy-a", "chatId": "966501234567@c.us", "text": "hello"}


def test_provider_resolution_keeps_existing_branch_defaults():
    assert whatsapp_mod._branch_provider(None) == "legacy"
    assert whatsapp_mod._branch_provider({"enabled": True}) == "meta_cloud"
    assert whatsapp_mod._branch_provider({"enabled": False}) == "legacy"
    assert whatsapp_mod._branch_provider({"provider": "waha", "enabled": True}) == "waha"


class _Collection:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if all(row.get(key) == expected for key, expected in query.items()):
                return dict(row)
        return None

    async def insert_one(self, row):
        if row.get("waha_message_id") and any(
            existing.get("branch_id") == row.get("branch_id")
            and existing.get("provider") == row.get("provider")
            and existing.get("waha_message_id") == row.get("waha_message_id")
            for existing in self.rows
        ):
            raise whatsapp_mod.DuplicateKeyError("duplicate")
        self.rows.append(dict(row))

    async def create_index(self, *_args, **_kwargs):
        return "test_index"

    async def update_one(self, query, update, upsert=False):
        stored = None
        for row in self.rows:
            if all(row.get(key) == expected for key, expected in query.items()):
                stored = row
                break
        if stored is None:
            stored = dict(query)
            self.rows.append(stored)
        stored.update(update.get("$setOnInsert", {}))
        stored.update(update.get("$set", {}))
        for key, value in update.get("$inc", {}).items():
            stored[key] = stored.get(key, 0) + value

    async def find_one_and_update(self, query, update, upsert=False, return_document=None):
        row = next((r for r in self.rows if r.get("_id") == query.get("_id")), None)
        maximum = (query.get("used") or {}).get("$lte")
        if row is not None and maximum is not None and row.get("used", 0) > maximum:
            return None
        if row is None:
            row = {"_id": query["_id"]}
            self.rows.append(row)
            row.update(update.get("$setOnInsert", {}))
        for key, value in update.get("$inc", {}).items():
            row[key] = row.get(key, 0) + value
        return dict(row)


class _DB:
    def __init__(self, configs):
        self.collections = {
            "branches": _Collection([{"id": "branch-a"}, {"id": "branch-b"}]),
            "whatsapp_branch_configs": _Collection(configs),
            "whatsapp_cloud_messages": _Collection(),
            "whatsapp_cloud_conversations": _Collection(),
        }

    def __getitem__(self, name):
        return self.collections.setdefault(name, _Collection())


def test_start_provisions_official_webhook_payload_once(monkeypatch):
    monkeypatch.setenv("WAHA_WEBHOOK_SECRET", "webhook-secret")
    db = _DB([{
        "branch_id": "branch-a",
        "provider": "waha",
        "enabled": True,
        "waha_session_name": "academy-a",
    }])
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    monkeypatch.setattr(whatsapp_mod, "get_current_tenant_slug", lambda: "tenant-a")
    calls = []

    class Client:
        configured = True

        async def session(self, name):
            calls.append(("session", name))
            return False, None, "http_404"

        async def create_session(self, payload):
            calls.append(("create", payload))
            return True, {}, None

        async def lifecycle(self, name, action):
            calls.append(("lifecycle", name, action))
            return True, {}, None

    monkeypatch.setattr(whatsapp_mod, "WAHAClient", Client)
    result = run(whatsapp_mod.branch_provider_lifecycle(
        "branch-a",
        "start",
        SimpleNamespace(base_url="https://academy.example/"),
        current_user={"is_admin": True},
    ))

    assert result["success"] is True
    create_payload = calls[1][1]
    webhook = create_payload["config"]["webhooks"][0]
    assert create_payload["config"]["metadata"] == {"branch_id": "branch-a"}
    assert webhook["url"] == "https://academy.example/api/whatsapp/waha-webhook/tenant-a"
    assert webhook["hmac"] == {"key": "webhook-secret"}
    assert webhook["events"] == ["message", "message.ack", "session.status"]
    assert webhook["retries"]["attempts"] == 15
    assert [call[0] for call in calls] == ["session", "create", "lifecycle"]


def test_waha_webhook_accepts_string_text_and_deduplicates(monkeypatch):
    secret = "webhook-secret"
    monkeypatch.setenv("WAHA_WEBHOOK_SECRET", secret)
    physical = whatsapp_mod._waha_physical_session_id("branch-a", "academy-a", "tenant-a")
    db = _DB([{
        "branch_id": "branch-a",
        "provider": "waha",
        "enabled": True,
        "waha_session_name": "academy-a",
        "waha_physical_session_id": physical,
    }])
    monkeypatch.setattr(whatsapp_mod, "_db", db)

    async def fake_tenant(slug):
        assert slug == "tenant-a"
        return "tenant-token"

    monkeypatch.setattr(whatsapp_mod, "_with_webhook_tenant", fake_tenant)
    monkeypatch.setattr(whatsapp_mod, "reset_current_tenant", lambda token: None)
    envelope = {
        "event": "message",
        "session": physical,
        "payload": {
            "id": "message-1",
            "from": "966501234567@c.us",
            "text": "السلام عليكم",
            "type": "text",
        },
    }
    raw = json.dumps(envelope, ensure_ascii=False).encode("utf-8")
    signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()

    class Request:
        headers = {"x-webhook-hmac": signature}

        async def body(self):
            return raw

    assert run(whatsapp_mod.receive_waha_webhook("tenant-a", Request())) == {"received": True}
    assert run(whatsapp_mod.receive_waha_webhook("tenant-a", Request())) == {"received": True}
    messages = db["whatsapp_cloud_messages"].rows
    assert len(messages) == 1
    assert messages[0]["body"] == "السلام عليكم"
    assert messages[0]["phone"] == "966501234567"
    conversations = db["whatsapp_cloud_conversations"].rows
    assert len(conversations) == 1
    assert conversations[0]["unread_count"] == 1


def test_physical_session_is_tenant_and_branch_isolated():
    first = whatsapp_mod._waha_physical_session_id("branch-a", "shared", "tenant-a")
    second = whatsapp_mod._waha_physical_session_id("branch-b", "shared", "tenant-a")
    other_tenant = whatsapp_mod._waha_physical_session_id("branch-a", "shared", "tenant-b")
    assert len({first, second, other_tenant}) == 3
    assert all(value.startswith("shared-") for value in (first, second, other_tenant))


def test_structured_message_id_and_numeric_ack_normalization():
    assert whatsapp_mod._canonical_waha_message_id(
        {"key": {"id": "short", "_serialized": "canonical@id"}, "id": "fallback"}
    ) == "canonical@id"
    assert whatsapp_mod._normalize_waha_ack({"ack": 2}) == "delivered"
    assert whatsapp_mod._normalize_waha_ack({"ack": 3}) == "read"
    assert whatsapp_mod._normalize_waha_ack({"ackName": "READ"}) == "read"
    assert whatsapp_mod._normalize_waha_ack({"ack": 2, "ackName": "DEVICE"}) == "delivered"
    assert whatsapp_mod._normalize_waha_ack({"ack": 4, "ackName": "PLAYED"}) == "read"


def test_providerless_meta_config_reenable_stores_meta(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret")
    db = _DB([{"branch_id": "branch-a", "enabled": False, "phone_number_id": "111",
               "access_token_encrypted": whatsapp_mod._encrypt_access_token("token")}])
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    run(whatsapp_mod.update_branch_cloud_config(
        "branch-a",
        whatsapp_mod.BranchCloudConfigUpdate(enabled=True, phone_number_id="111"),
        current_user={"is_admin": True, "id": "admin"},
    ))
    assert db["whatsapp_branch_configs"].rows[0]["provider"] == "meta_cloud"


def test_providerless_meta_disable_then_reenable_stays_meta(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-secret")
    db = _DB([{"branch_id": "branch-a", "enabled": True, "phone_number_id": "111",
               "access_token_encrypted": whatsapp_mod._encrypt_access_token("token")}])
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    admin = {"is_admin": True, "id": "admin"}

    run(whatsapp_mod.update_branch_cloud_config(
        "branch-a",
        whatsapp_mod.BranchCloudConfigUpdate(enabled=False, phone_number_id="111"),
        current_user=admin,
    ))
    assert db["whatsapp_branch_configs"].rows[0]["provider"] == "meta_cloud"
    run(whatsapp_mod.update_branch_cloud_config(
        "branch-a",
        whatsapp_mod.BranchCloudConfigUpdate(enabled=True, phone_number_id="111"),
        current_user=admin,
    ))
    assert db["whatsapp_branch_configs"].rows[0]["provider"] == "meta_cloud"


def test_campaign_quota_reservation_is_shared(monkeypatch):
    db = _DB([])
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    first = run(whatsapp_mod._reserve_waha_campaign_quota("branch-a", 3, 2))
    assert first["used"] == 2
    try:
        run(whatsapp_mod._reserve_waha_campaign_quota("branch-a", 3, 2))
        assert False, "expected quota rejection"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 429
    run(whatsapp_mod._release_waha_campaign_quota(first["_id"], 1))
    assert run(whatsapp_mod._get_waha_campaign_quota("branch-a", 3)) == {"used": 1, "remaining": 2}


def test_first_campaign_larger_than_limit_is_rejected(monkeypatch):
    db = _DB([])
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    try:
        run(whatsapp_mod._reserve_waha_campaign_quota("branch-a", 3, 4))
        assert False, "expected quota rejection"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 429
    assert db["whatsapp_waha_campaign_quota"].rows == []


def test_quota_release_uses_original_reservation_day(monkeypatch):
    db = _DB([])
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    first = run(whatsapp_mod._reserve_waha_campaign_quota("branch-a", 3, 2))
    original_id = first["_id"]
    monkeypatch.setattr(
        whatsapp_mod,
        "_campaign_quota_id",
        lambda branch_id: f"{branch_id}:2099-01-02",
    )
    run(whatsapp_mod._release_waha_campaign_quota(original_id, 1))
    original = run(db["whatsapp_waha_campaign_quota"].find_one({"_id": original_id}))
    assert original["used"] == 1
    assert run(db["whatsapp_waha_campaign_quota"].find_one(
        {"_id": "branch-a:2099-01-02"}
    )) is None


def test_concurrent_campaign_reservations_cannot_exceed_limit(monkeypatch):
    db = _DB([])
    monkeypatch.setattr(whatsapp_mod, "_db", db)

    async def reserve_both():
        return await asyncio.gather(
            whatsapp_mod._reserve_waha_campaign_quota("branch-a", 3, 2),
            whatsapp_mod._reserve_waha_campaign_quota("branch-a", 3, 2),
            return_exceptions=True,
        )

    outcomes = run(reserve_both())
    assert sum(isinstance(item, dict) for item in outcomes) == 1
    assert sum(getattr(item, "status_code", None) == 429 for item in outcomes) == 1
    assert run(whatsapp_mod._get_waha_campaign_quota("branch-a", 3)) == {"used": 2, "remaining": 1}


def test_numeric_ack_updates_canonical_branch_message(monkeypatch):
    secret = "webhook-secret"
    monkeypatch.setenv("WAHA_WEBHOOK_SECRET", secret)
    physical = whatsapp_mod._waha_physical_session_id("branch-a", "academy", "tenant-a")
    db = _DB([{"branch_id": "branch-a", "provider": "waha", "enabled": True,
               "waha_session_name": "academy", "waha_physical_session_id": physical}])
    db["whatsapp_cloud_messages"].rows.append({
        "branch_id": "branch-a", "provider": "waha",
        "waha_message_id": "chat@c.us_msg", "status": "sent",
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    monkeypatch.setattr(whatsapp_mod, "_with_webhook_tenant", lambda _slug: _async_value("token"))
    monkeypatch.setattr(whatsapp_mod, "reset_current_tenant", lambda _token: None)
    envelope = {"event": "message.ack", "session": physical,
                "payload": {"id": {"_serialized": "chat@c.us_msg"}, "ack": 3}}
    raw = json.dumps(envelope).encode()

    class Request:
        headers = {"x-webhook-hmac": hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()}
        async def body(self): return raw

    run(whatsapp_mod.receive_waha_webhook("tenant-a", Request()))
    assert db["whatsapp_cloud_messages"].rows[0]["status"] == "read"


async def _async_value(value):
    return value