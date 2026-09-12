import asyncio
import hashlib
import hmac
import json
import pytest
from datetime import date, datetime, timedelta
from starlette.responses import Response

from routes import whatsapp as whatsapp_mod


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if all(
                (isinstance(expected, dict) and row.get(key) not in ("", None))
                or row.get(key) == expected
                for key, expected in query.items()
            ):
                return dict(row)
        return None

    async def update_one(self, query, update, upsert=False):
        row = await self.find_one(query)
        if row is None:
            row = dict(query)
            self.rows.append(row)
        stored = next(item for item in self.rows if all(item.get(k) == v for k, v in query.items()))
        stored.update(update.get("$set", {}))
        for key, value in update.get("$inc", {}).items():
            stored[key] = stored.get(key, 0) + value
        if row is None:
            stored.update(update.get("$setOnInsert", {}))

    async def insert_one(self, row):
        self.rows.append(dict(row))

    async def create_index(self, *_args, **_kwargs):
        return "test_index"


class _DB:
    def __init__(self):
        self.collections = {
            "branches": _Collection([{"id": "branch-a"}, {"id": "branch-b"}]),
            "whatsapp_branch_configs": _Collection(),
        }

    def __getitem__(self, name):
        return self.collections.setdefault(name, _Collection())


def test_branch_cloud_config_encrypts_and_redacts_access_token(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-only-secret")
    db = _DB()
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    admin = {"is_admin": True, "user_id": "admin"}

    response = run(whatsapp_mod.update_branch_cloud_config(
        "branch-a",
        whatsapp_mod.BranchCloudConfigUpdate(
            phone_number_id="123456",
            whatsapp_business_account_id="654321",
            access_token="secret-meta-token",
        ),
        current_user=admin,
    ))

    stored = db["whatsapp_branch_configs"].rows[0]
    assert stored["access_token_encrypted"] != "secret-meta-token"
    assert whatsapp_mod._decrypt_access_token(stored["access_token_encrypted"]) == "secret-meta-token"
    assert response["token_configured"] is True
    assert "access_token" not in response
    assert "access_token_encrypted" not in response


def test_send_uses_the_member_branch_cloud_config(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-only-secret")
    db = _DB()
    db["whatsapp_branch_configs"].rows.extend([
        {
            "branch_id": "branch-a",
            "enabled": True,
            "phone_number_id": "111",
            "access_token_encrypted": whatsapp_mod._encrypt_access_token("token-a"),
        },
        {
            "branch_id": "branch-b",
            "enabled": True,
            "phone_number_id": "222",
            "access_token_encrypted": whatsapp_mod._encrypt_access_token("token-b"),
        },
    ])
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    seen = []

    async def fake_meta(phone, message, config):
        seen.append((phone, message, config["branch_id"], config["phone_number_id"]))
        return True

    monkeypatch.setattr(whatsapp_mod, "_send_meta_cloud_message", fake_meta)

    assert run(whatsapp_mod._send_wa_message_for_branch(
        "966500000001@s.whatsapp.net", "hello", "branch-b"
    ))
    assert seen == [("966500000001@s.whatsapp.net", "hello", "branch-b", "222")]


def test_meta_sender_uses_the_branch_approved_template(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-only-secret")
    captured = {}

    class _Response:
        status_code = 200

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, headers, json):
            captured.update(url=url, headers=headers, payload=json)
            return _Response()

    monkeypatch.setattr(whatsapp_mod.httpx, "AsyncClient", lambda **_kwargs: _Client())
    config = {
        "branch_id": "branch-a",
        "phone_number_id": "123456",
        "access_token_encrypted": whatsapp_mod._encrypt_access_token("token-a"),
        "graph_api_version": "v23.0",
        "message_template_name": "academy_notification",
        "template_language": "ar",
    }

    assert run(whatsapp_mod._send_meta_cloud_message(
        "966500000001@s.whatsapp.net", "renewal body", config
    ))
    assert captured["url"].endswith("/v23.0/123456/messages")
    assert captured["payload"]["type"] == "template"
    assert captured["payload"]["template"]["name"] == "academy_notification"
    assert captured["payload"]["template"]["components"][0]["parameters"][0]["text"] == "renewal body"


def test_meta_renewal_template_includes_contact_quick_reply(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-only-secret")
    captured = {}

    class _Response:
        status_code = 200

        def json(self):
            return {"messages": [{"id": "wamid.button"}]}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, headers, json):
            captured["payload"] = json
            return _Response()

    monkeypatch.setattr(whatsapp_mod.httpx, "AsyncClient", lambda **_kwargs: _Client())
    config = {
        "branch_id": "branch-a",
        "phone_number_id": "123456",
        "access_token_encrypted": whatsapp_mod._encrypt_access_token("token-a"),
        "message_template_name": "renewal_reminder",
        "template_language": "ar",
        "_quick_reply_payload": "CONTACT_US",
    }

    assert run(whatsapp_mod._send_meta_cloud_message(
        "966500000001@s.whatsapp.net", "renewal body", config
    ))
    button = captured["payload"]["template"]["components"][1]
    assert button["type"] == "button"
    assert button["sub_type"] == "quick_reply"
    assert button["index"] == "0"
    assert button["parameters"][0]["payload"] == "CONTACT_US"


def test_cloud_connection_test_normalizes_local_saudi_phone(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "enabled": True,
        "inbox_enabled": True,
        "phone_number_id": "111",
        "access_token_encrypted": "encrypted",
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    seen = []

    async def fake_meta(phone, message, config):
        seen.append((phone, message, config["branch_id"]))
        return True

    monkeypatch.setattr(whatsapp_mod, "_send_meta_cloud_message", fake_meta)
    result = run(whatsapp_mod.test_branch_cloud_config(
        "branch-a",
        whatsapp_mod.BranchCloudTestRequest(phone="0501234567"),
        current_user={"is_admin": True},
    ))

    assert result == {"success": True}
    assert seen[0][0] == "966501234567@s.whatsapp.net"


def test_bulk_cloud_send_uses_selected_branch_and_messages(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-b",
        "enabled": True,
        "phone_number_id": "222",
        "access_token_encrypted": "encrypted",
        "message_template_name": "academy_notification",
        "single_variable_template_confirmed": True,
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    seen = []
    async def enqueue(branch, provider, recipients, key, **kwargs):
        seen.append((branch, provider, recipients, key, kwargs.get("metadata")))
        return {"id": "job-1", "status": "pending", "total": 2, "pending": 2}, True
    monkeypatch.setattr(whatsapp_mod.whatsapp_bulk_jobs, "enqueue", enqueue)
    http_response = Response()
    result = run(whatsapp_mod.send_branch_cloud_bulk(
        whatsapp_mod.BulkCloudSendRequest(
            branch_id="branch-b",
            idempotency_key="bulk-text-key-123",
            campaign_title="Spring enrollment",
            campaign_id="campaign-42",
            branch_name="Downtown",
            recipients=[
                {"phone": "0501234567", "message": "أهلاً محمد"},
                {"phone": "0509876543", "message": "أهلاً سارة"},
            ],
        ),
        current_user={"is_admin": True}, response=http_response,
    ))

    assert result == {"id": "job-1", "status": "pending", "total": 2, "pending": 2}
    assert http_response.status_code == 202
    assert seen[0][0:2] == ("branch-b", "meta_cloud")
    assert seen[0][2] == [
        {"phone": "0501234567", "message": "أهلاً محمد"},
        {"phone": "0509876543", "message": "أهلاً سارة"}]
    assert seen[0][4] == {
        "campaign_title": "Spring enrollment",
        "campaign_id": "campaign-42",
        "branch_name": "Downtown",
    }


def test_bulk_cloud_accepts_messages_permission_and_preserves_international_numbers(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "enabled": True,
        "phone_number_id": "111",
        "access_token_encrypted": "encrypted",
        "message_template_name": "academy_notification",
        "single_variable_template_confirmed": True,
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    seen = []
    async def enqueue(_branch, _provider, recipients, _key):
        seen.extend(item["phone"] for item in recipients)
        return {"id": "job-2", "sent": 0, "pending": 2}, True
    monkeypatch.setattr(whatsapp_mod.whatsapp_bulk_jobs, "enqueue", enqueue)
    result = run(whatsapp_mod.send_branch_cloud_bulk(
        whatsapp_mod.BulkCloudSendRequest(
            branch_id="branch-a",
            idempotency_key="international-key-123",
            recipients=[
                {"phone": "201001234567", "message": "Egypt"},
                {"phone": "+14155552671", "message": "International"},
            ],
        ),
        current_user={
            "is_admin": False,
            "permissions": ["messages"],
            "branch_id": "branch-a",
        },
    ))

    assert result["pending"] == 2
    assert seen == [
        "201001234567",
        "+14155552671",
    ]


def test_bulk_cloud_send_rejects_branch_outside_user_scope(monkeypatch):
    monkeypatch.setattr(whatsapp_mod, "_db", _DB())
    try:
        run(whatsapp_mod.send_branch_cloud_bulk(
            whatsapp_mod.BulkCloudSendRequest(
                branch_id="branch-b",
                idempotency_key="denied-branch-key-123",
                recipients=[{"phone": "0501234567", "message": "hello"}],
            ),
            current_user={
                "is_admin": False,
                "permissions": ["messages"],
                "branch_id": "branch-a",
            },
        ))
        assert False, "Expected branch access denial"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 403


def test_meta_webhook_accepts_valid_signature_and_saves_branch_chat(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-only-secret")
    db = _DB()
    app_secret = "meta-app-secret"
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "enabled": True,
        "inbox_enabled": True,
        "phone_number_id": "111",
        "app_secret_encrypted": whatsapp_mod._encrypt_access_token(app_secret),
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)

    async def fake_tenant(_slug):
        return whatsapp_mod.set_current_tenant({
            "slug": "academy",
            "db_name": "champions_academy",
        })

    monkeypatch.setattr(whatsapp_mod, "_with_webhook_tenant", fake_tenant)
    payload = {
        "entry": [{
            "changes": [{
                "field": "messages",
                "value": {
                    "metadata": {"phone_number_id": "111"},
                    "contacts": [{"wa_id": "966501234567", "profile": {"name": "محمد"}}],
                    "messages": [{
                        "id": "wamid.inbound-1",
                        "from": "966501234567",
                        "timestamp": "1700000000",
                        "type": "text",
                        "text": {"body": "السلام عليكم"},
                    }],
                },
            }],
        }],
    }
    raw = json.dumps(payload).encode()
    signature = "sha256=" + hmac.new(app_secret.encode(), raw, hashlib.sha256).hexdigest()

    class _Request:
        headers = {"x-hub-signature-256": signature}

        async def body(self):
            return raw

    assert run(whatsapp_mod.receive_meta_webhook("academy", _Request())) == {"received": True}
    saved = db["whatsapp_cloud_messages"].rows[0]
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    assert saved["meta_message_id"] == "wamid.inbound-1"
    assert saved["branch_id"] == "branch-a"
    assert conversation["contact_name"] == "محمد"
    assert conversation["unread_count"] == 1


def test_cloud_inbox_reply_inside_24_hours_uses_free_text(monkeypatch):
    now = whatsapp_mod.datetime.now(whatsapp_mod.timezone.utc).isoformat()
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "enabled": True,
        "phone_number_id": "111",
        "access_token_encrypted": "encrypted",
        "message_template_name": "academy_notification",
        "single_variable_template_confirmed": True,
    })
    db["whatsapp_cloud_conversations"].rows.append({
        "id": "branch-a:966501234567",
        "branch_id": "branch-a",
        "phone": "966501234567",
        "last_inbound_at": now,
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    seen = []

    async def fake_send(phone, message, config):
        seen.append((phone, message, config.get("message_template_name")))
        return True, "wamid.outbound-1", None

    monkeypatch.setattr(whatsapp_mod, "_send_meta_cloud_message_result", fake_send)
    result = run(whatsapp_mod.reply_to_cloud_inbox_thread(
        "branch-a:966501234567",
        whatsapp_mod.CloudInboxReplyRequest(body="وعليكم السلام"),
        current_user={
            "is_admin": False,
            "permissions": ["messages"],
            "branch_id": "branch-a",
            "id": "staff-1",
        },
    ))

    assert result["success"] is True
    assert result["used_template"] is False
    assert seen == [("966501234567", "وعليكم السلام", "")]
    assert db["whatsapp_cloud_messages"].rows[0]["meta_message_id"] == "wamid.outbound-1"


def test_whatsflow_text_send_preserves_existing_digits_recipient(monkeypatch):
    seen = []

    class Client:
        async def send_text(self, number, message, **kwargs):
            seen.append((number, message, kwargs))
            return True, {"key": {"id": "flow-text-1"}}, None

    monkeypatch.setattr(whatsapp_mod, "_whatsflow_client", lambda _config: Client())
    result = run(whatsapp_mod._send_whatsflow_message_result(
        "0501234567",
        "hello",
        {"provider": "whatsflow", "enabled": True},
    ))

    assert result == (True, "flow-text-1", None)
    assert seen == [(
        "0501234567",
        "hello",
        {"delay": 0, "link_preview": False},
    )]


def test_cloud_inbox_image_send_persists_private_media_message(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "provider": "waha",
        "enabled": True,
        "waha_session_name": "main",
    })
    db["whatsapp_cloud_conversations"].rows.append({
        "id": "branch-a:966501234567",
        "branch_id": "branch-a",
        "provider": "waha",
        "phone": "966501234567",
        "last_inbound_at": whatsapp_mod.datetime.now(
            whatsapp_mod.timezone.utc
        ).isoformat(),
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    stopped = []
    sent = []

    async def stop_phone(*args):
        stopped.append(args)

    async def store(branch_id, content, mime_type, filename):
        assert branch_id == "branch-a"
        assert content.startswith(b"\x89PNG\r\n\x1a\n")
        assert mime_type == "image/png"
        return {
            "media_id": "private-media-1",
            "mime_type": mime_type,
            "filename": filename,
            "size": len(content),
        }

    async def send(phone, content, mime_type, filename, caption, config, inside, branch):
        sent.append((phone, content, mime_type, filename, caption, config, inside, branch))
        return True, "waha-image-1", None, False, None

    monkeypatch.setattr(whatsapp_mod.registration_followups, "stop_phone", stop_phone)
    monkeypatch.setattr(whatsapp_mod, "_store_cloud_chat_image", store)
    monkeypatch.setattr(whatsapp_mod, "_send_cloud_chat_image_result", send)

    class Upload:
        filename = "../../offer.png"
        content_type = "image/png"
        done = False

        async def read(self, _size=-1):
            if self.done:
                return b""
            self.done = True
            return b"\x89PNG\r\n\x1a\nprivate-image"

    result = run(whatsapp_mod.send_cloud_inbox_media(
        "branch-a:966501234567",
        caption="Offer",
        attachments=[Upload()],
        current_user={"is_admin": True, "id": "staff-1"},
    ))

    assert result["success"] is True
    assert result["message"]["status"] == "sent"
    assert result["message"]["type"] == "image"
    assert result["message"]["media_storage_id"] == "private-media-1"
    assert result["message"]["waha_message_id"] == "waha-image-1"
    assert stopped == [("branch-a", "966501234567", "staff_contacted")]
    assert sent[0][0] == "966501234567"
    assert sent[0][4] == "Offer"
    assert sent[0][7] == "branch-a"


def test_cloud_inbox_image_send_rejects_cross_branch_before_storage(monkeypatch):
    db = _DB()
    db["whatsapp_cloud_conversations"].rows.append({
        "id": "branch-b:966501234567",
        "branch_id": "branch-b",
        "provider": "waha",
        "phone": "966501234567",
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    called = []

    async def store(*_args):
        called.append(True)
        raise AssertionError("unauthorized upload must not be stored")

    monkeypatch.setattr(whatsapp_mod, "_store_cloud_chat_image", store)

    class Upload:
        filename = "image.png"
        content_type = "image/png"
        done = False

        async def read(self, _size=-1):
            if self.done:
                return b""
            self.done = True
            return b"\x89PNG\r\n\x1a\nimage"

    with pytest.raises(Exception) as exc:
        run(whatsapp_mod.send_cloud_inbox_media(
            "branch-b:966501234567",
            attachments=[Upload()],
            current_user={
                "is_admin": False,
                "permissions": ["messages"],
                "branch_id": "branch-a",
            },
        ))
    assert getattr(exc.value, "status_code", None) == 403
    assert called == []


def test_cloud_inbox_image_unknown_provider_failure_is_explicit_and_cleans_media(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "provider": "waha",
        "enabled": True,
        "waha_session_name": "main",
    })
    db["whatsapp_cloud_conversations"].rows.append({
        "id": "branch-a:966501234567",
        "branch_id": "branch-a",
        "provider": "waha",
        "phone": "966501234567",
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    deleted = []

    async def stop_phone(*_args):
        return None

    async def store(*_args):
        return {
            "media_id": "private-media-failed",
            "mime_type": "image/png",
            "filename": "image.png",
            "size": 12,
        }

    async def send(*_args):
        return False, None, "ReadTimeout", False, None

    async def delete(branch_id, media_id):
        deleted.append((branch_id, media_id))

    monkeypatch.setattr(whatsapp_mod.registration_followups, "stop_phone", stop_phone)
    monkeypatch.setattr(whatsapp_mod, "_store_cloud_chat_image", store)
    monkeypatch.setattr(whatsapp_mod, "_send_cloud_chat_image_result", send)
    monkeypatch.setattr(whatsapp_mod, "_delete_cloud_chat_image", delete)

    class Upload:
        filename = "image.png"
        content_type = "image/png"
        done = False

        async def read(self, _size=-1):
            if self.done:
                return b""
            self.done = True
            return b"\x89PNG\r\n\x1a\nimage"

    with pytest.raises(Exception) as exc:
        run(whatsapp_mod.send_cloud_inbox_media(
            "branch-a:966501234567",
            attachments=[Upload()],
            current_user={"is_admin": True},
        ))
    assert getattr(exc.value, "status_code", None) == 502
    assert "delivery outcome is unknown" in str(exc.value.detail)
    assert deleted == [("branch-a", "private-media-failed")]
    assert db["whatsapp_cloud_messages"].rows == []


def test_meta_webhook_routes_multi_phone_batch_to_each_branch(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-only-secret")
    db = _DB()
    app_secret = "shared-meta-app-secret"
    encrypted = whatsapp_mod._encrypt_access_token(app_secret)
    db["whatsapp_branch_configs"].rows.extend([
        {
            "branch_id": "branch-a",
            "enabled": True,
            "inbox_enabled": True,
            "phone_number_id": "111",
            "app_secret_encrypted": encrypted,
        },
        {
            "branch_id": "branch-b",
            "enabled": True,
            "inbox_enabled": True,
            "phone_number_id": "222",
            "app_secret_encrypted": encrypted,
        },
    ])
    monkeypatch.setattr(whatsapp_mod, "_db", db)

    async def fake_tenant(_slug):
        return whatsapp_mod.set_current_tenant({
            "slug": "academy",
            "db_name": "champions_academy",
        })

    monkeypatch.setattr(whatsapp_mod, "_with_webhook_tenant", fake_tenant)
    timestamp = str(int(whatsapp_mod.datetime.now(whatsapp_mod.timezone.utc).timestamp()))
    payload = {
        "entry": [{
            "changes": [
                {
                    "field": "messages",
                    "value": {
                        "metadata": {"phone_number_id": "111"},
                        "messages": [{
                            "id": "wamid.multi-a",
                            "from": "966500000001",
                            "timestamp": timestamp,
                            "type": "text",
                            "text": {"body": "A"},
                        }],
                    },
                },
                {
                    "field": "messages",
                    "value": {
                        "metadata": {"phone_number_id": "222"},
                        "messages": [{
                            "id": "wamid.multi-b",
                            "from": "966500000002",
                            "timestamp": timestamp,
                            "type": "text",
                            "text": {"body": "B"},
                        }],
                    },
                },
            ],
        }],
    }
    raw = json.dumps(payload).encode()
    signature = "sha256=" + hmac.new(app_secret.encode(), raw, hashlib.sha256).hexdigest()

    class _Request:
        headers = {"x-hub-signature-256": signature}

        async def body(self):
            return raw

    assert run(whatsapp_mod.receive_meta_webhook("academy", _Request())) == {"received": True}
    assert {
        (row["branch_id"], row["body"])
        for row in db["whatsapp_cloud_messages"].rows
    } == {("branch-a", "A"), ("branch-b", "B")}


def test_bulk_pdf_upload_uses_document_template(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "enabled": True,
        "phone_number_id": "111",
        "access_token_encrypted": "encrypted",
        "document_template_name": "academy_document",
        "media_templates_confirmed": True,
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    queued = []
    async def no_existing(*_args):
        return None
    async def store(_branch, _upload):
        return {"attachment_id": "stored-pdf", "attachment_name": "offer.pdf",
                "attachment_type": "application/pdf", "attachment_size": 13}
    async def enqueue(branch, provider, recipients, key, attachments, **kwargs):
        queued.append((branch, provider, recipients, key, attachments, kwargs.get("metadata")))
        return {"id": "media-job", "status": "pending", "total": 1, "pending": 1}, True
    monkeypatch.setattr(whatsapp_mod.whatsapp_bulk_jobs, "get_job_by_key", no_existing)
    monkeypatch.setattr(whatsapp_mod, "_store_campaign_attachment", store)
    monkeypatch.setattr(whatsapp_mod.whatsapp_bulk_jobs, "enqueue", enqueue)

    class _Upload:
        filename = "offer.pdf"
        content_type = "application/pdf"
        done = False

        async def read(self, _size=-1):
            if self.done:
                return b""
            self.done = True
            return b"%PDF-1.7 test"
        async def seek(self, _offset):
            self.done = False

    result = run(whatsapp_mod.send_branch_cloud_bulk_media(
        branch_id="branch-a",
        recipients_json=json.dumps([{
            "phone": "0501234567",
            "message": "عرض خاص",
        }]),
        idempotency_key="test-batch-key-123",
        campaign_title="PDF offer",
        campaign_id="campaign-pdf-7",
        branch_name="Main branch",
        attachment=_Upload(),
        current_user={"is_admin": True},
    ))

    assert result["status"] == "pending"
    assert queued[0][0:2] == ("branch-a", "meta_cloud")
    assert queued[0][4][0]["media_type"] == "document"
    assert queued[0][4][0]["attachment_id"] == "stored-pdf"
    assert queued[0][5] == {
        "campaign_title": "PDF offer",
        "campaign_id": "campaign-pdf-7",
        "branch_name": "Main branch",
    }


def test_multi_image_waha_reserves_actual_messages_and_refunds_only_failures(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a", "provider": "waha", "enabled": True,
        "waha_daily_limit": 50, "waha_session_name": "main",
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    monkeypatch.setattr(whatsapp_mod, "_waha_config_for_branch", lambda _config: True)
    queued = []
    async def no_existing(*_args):
        return None
    async def store(_branch, upload):
        return {"attachment_id": upload.filename, "attachment_name": upload.filename,
                "attachment_type": "image/png", "attachment_size": 13}
    async def enqueue(branch, provider, recipients, key, attachments):
        queued.append((branch, provider, recipients, key, attachments))
        return {"id": "images-job", "status": "pending", "total": 4, "pending": 4}, True
    monkeypatch.setattr(whatsapp_mod.whatsapp_bulk_jobs, "get_job_by_key", no_existing)
    monkeypatch.setattr(whatsapp_mod, "_store_campaign_attachment", store)
    monkeypatch.setattr(whatsapp_mod.whatsapp_bulk_jobs, "enqueue", enqueue)

    class Upload:
        content_type = "image/png"
        def __init__(self, filename):
            self.filename = filename
            self.done = False
        async def read(self, _size=-1):
            if self.done:
                return b""
            self.done = True
            return b"\x89PNG\r\n\x1a\nimage"
        async def seek(self, _offset):
            self.done = False

    result = run(whatsapp_mod.send_branch_cloud_bulk_media(
        branch_id="branch-a",
        recipients_json=json.dumps([
            {"phone": "966500000001", "message": "First"},
            {"phone": "966500000002", "message": "Second"},
        ]),
        idempotency_key="multi-image-batch-123",
        attachment=None,
        attachments=[Upload("first.png"), Upload("second.png")],
        current_user={"is_admin": True},
    ))

    assert result["total"] == 4
    assert result["pending"] == 4
    assert [item["attachment_id"] for item in queued[0][4]] == ["first.png", "second.png"]


def test_bulk_media_completed_legacy_idempotency_row_returns_without_resend(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a", "provider": "waha", "enabled": True,
        "waha_daily_limit": 50, "waha_session_name": "main",
    })
    legacy_result = {
        "success": True, "total": 1, "sent": 1, "failed": 0,
        "failed_indices": [],
    }
    # This is the pre-change shape: no tenant_slug field.
    db["whatsapp_bulk_media_batches"].rows.append({
        "branch_id": "branch-a", "idempotency_key": "legacy-completed-123",
        "status": "completed", "result": legacy_result,
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    monkeypatch.setattr(whatsapp_mod, "_waha_config_for_branch", lambda _config: True)

    async def must_not_reserve(*_args):
        raise AssertionError("completed retry must not reserve quota")

    class Client:
        async def send_media(self, *_args, **_kwargs):
            raise AssertionError("completed retry must not send")

    monkeypatch.setattr(whatsapp_mod, "_reserve_waha_campaign_quota", must_not_reserve)
    monkeypatch.setattr(whatsapp_mod, "WAHAClient", lambda: Client())

    class Upload:
        filename = "image.png"
        content_type = "image/png"
        done = False
        async def read(self, _size=-1):
            if self.done:
                return b""
            self.done = True
            return b"\x89PNG\r\n\x1a\nimage"

    result = run(whatsapp_mod.send_branch_cloud_bulk_media(
        branch_id="branch-a",
        recipients_json=json.dumps([{"phone": "966500000001", "message": "Hello"}]),
        idempotency_key="legacy-completed-123",
        attachment=Upload(), attachments=None,
        current_user={"is_admin": True},
    ))
    assert result == legacy_result


def test_bulk_media_legacy_processing_key_fails_closed_without_enqueue(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a", "provider": "waha", "enabled": True,
        "waha_daily_limit": 50, "waha_session_name": "main",
    })
    db["whatsapp_bulk_media_batches"].rows.append({
        "branch_id": "branch-a", "idempotency_key": "legacy-processing-123",
        "status": "processing",
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    monkeypatch.setattr(whatsapp_mod, "_waha_config_for_branch", lambda _config: True)
    async def must_not_enqueue(*_args):
        raise AssertionError("uncertain legacy batch must not enqueue")
    monkeypatch.setattr(whatsapp_mod.whatsapp_bulk_jobs, "enqueue", must_not_enqueue)
    class Upload:
        filename = "image.png"
        content_type = "image/png"
        done = False
        async def read(self, _size=-1):
            if self.done:
                return b""
            self.done = True
            return b"\x89PNG\r\n\x1a\nimage"
    with pytest.raises(Exception) as exc:
        run(whatsapp_mod.send_branch_cloud_bulk_media(
            branch_id="branch-a",
            recipients_json=json.dumps([{"phone": "966500000001", "message": "Hello"}]),
            idempotency_key="legacy-processing-123",
            attachment=Upload(), attachments=None, current_user={"is_admin": True}))
    assert getattr(exc.value, "status_code", None) == 409


def test_media_owned_by_retained_failed_job_is_not_deleted(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a", "enabled": True, "phone_number_id": "111",
        "access_token_encrypted": "encrypted", "image_template_name": "image",
        "media_templates_confirmed": True,
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    lookups = {"count": 0}
    async def owner_lookup(*_args):
        lookups["count"] += 1
        return None if lookups["count"] == 1 else {
            "id": "retained-job", "status": "initialization_failed"}
    async def store(*_args):
        return {"attachment_id": "owned-media", "attachment_name": "image.png",
                "attachment_type": "image/png", "attachment_size": 9}
    async def fail_enqueue(*_args):
        raise RuntimeError("final parent activation failed")
    deleted = []
    async def delete(*args):
        deleted.append(args)
    monkeypatch.setattr(whatsapp_mod.whatsapp_bulk_jobs, "get_job_by_key", owner_lookup)
    monkeypatch.setattr(whatsapp_mod.whatsapp_bulk_jobs, "enqueue", fail_enqueue)
    monkeypatch.setattr(whatsapp_mod, "_store_campaign_attachment", store)
    monkeypatch.setattr(whatsapp_mod, "_delete_campaign_attachment", delete)
    class Upload:
        filename = "image.png"
        content_type = "image/png"
        done = False
        async def read(self, _size=-1):
            if self.done:
                return b""
            self.done = True
            return b"\x89PNG\r\n\x1a\nimage"
        async def seek(self, _offset):
            self.done = False
    with pytest.raises(RuntimeError):
        run(whatsapp_mod.send_branch_cloud_bulk_media(
            branch_id="branch-a",
            recipients_json=json.dumps([{"phone": "966500000001", "message": "Hello"}]),
            idempotency_key="retained-media-key-123", attachment=Upload(),
            attachments=None, current_user={"is_admin": True}))
    assert deleted == []


def test_bulk_media_same_branch_and_key_are_isolated_by_tenant_database(monkeypatch):
    monkeypatch.setattr(whatsapp_mod, "_waha_config_for_branch", lambda _config: True)
    current = {"db": None}
    jobs_by_db = {}
    async def get_existing(branch, key):
        return jobs_by_db.get((id(current["db"]), branch, key))
    async def store(_branch, upload):
        return {"attachment_id": upload.marker.decode(), "attachment_name": "image.png",
                "attachment_type": "image/png", "attachment_size": 9}
    async def enqueue(branch, _provider, _recipients, key, _attachments):
        job = {"id": f"job-{len(jobs_by_db)}", "status": "pending", "total": 1, "pending": 1}
        jobs_by_db[(id(current["db"]), branch, key)] = job
        return job, True
    monkeypatch.setattr(whatsapp_mod.whatsapp_bulk_jobs, "get_job_by_key", get_existing)
    monkeypatch.setattr(whatsapp_mod, "_store_campaign_attachment", store)
    monkeypatch.setattr(whatsapp_mod.whatsapp_bulk_jobs, "enqueue", enqueue)

    class Upload:
        filename = "image.png"
        content_type = "image/png"
        def __init__(self, marker):
            self.marker = marker
            self.done = False
        async def read(self, _size=-1):
            if self.done:
                return b""
            self.done = True
            return b"\x89PNG\r\n\x1a\n" + self.marker
        async def seek(self, _offset):
            self.done = False

    tenant_dbs = [_DB(), _DB()]
    for db in tenant_dbs:
        db["whatsapp_branch_configs"].rows.append({
            "branch_id": "branch-a", "provider": "waha", "enabled": True,
            "waha_daily_limit": 50, "waha_session_name": "main",
        })
    for index, db in enumerate(tenant_dbs):
        # TenantDBProxy performs this database selection in production.
        monkeypatch.setattr(whatsapp_mod, "_db", db)
        current["db"] = db
        result = run(whatsapp_mod.send_branch_cloud_bulk_media(
            branch_id="branch-a",
            recipients_json=json.dumps([{"phone": "966500000001", "message": "Hello"}]),
            idempotency_key="same-key-each-tenant",
            attachment=Upload(str(index).encode()), attachments=None,
            current_user={"is_admin": True},
        ))
        assert result["pending"] == 1
    assert len(jobs_by_db) == 2
    assert len({job["id"] for job in jobs_by_db.values()}) == 2


def test_attendance_notice_uses_branch_specific_template(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "enabled": True,
        "phone_number_id": "111",
        "access_token_encrypted": "encrypted",
        "attendance_template_name": "attendance_recorded",
        "attendance_template_confirmed": True,
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    sent = []

    async def fake_send(phone, message, config):
        sent.append((phone, message, config.get("message_template_name")))
        return True

    monkeypatch.setattr(whatsapp_mod, "_send_meta_cloud_message", fake_send)
    result = run(whatsapp_mod.send_attendance_whatsapp_notice(
        {"id": "member-1", "name_ar": "محمد", "phone": "0501234567", "branch_id": "branch-a"},
        "الكاراتيه",
        "2026-09-04",
        "18:30",
    ))

    assert result is True
    assert sent[0][0] == "966501234567@s.whatsapp.net"
    assert "محمد" in sent[0][1]
    assert "الكاراتيه" in sent[0][1]
    assert "Attendance recorded for محمد in الكاراتيه" in sent[0][1]
    assert sent[0][1].count(whatsapp_mod.BILINGUAL_ENGLISH_MARKER) == 1
    assert sent[0][2] == "attendance_recorded"


def test_class_occurrence_prefers_the_time_for_that_weekday():
    occurrence = whatsapp_mod._class_occurrence_for_date({
        "training_days": ["monday", "wednesday"],
        "training_time": "4:00 م",
        "day_times": {"monday": "5:30 م", "wednesday": "7:00 م"},
    }, date(2026, 9, 7))

    assert occurrence.hour == 17
    assert occurrence.minute == 30


def test_class_reminder_uses_branch_specific_template(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "enabled": True,
        "phone_number_id": "111",
        "access_token_encrypted": "encrypted",
        "class_reminder_template_name": "class_reminder_two_hours",
        "class_reminder_template_confirmed": True,
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    sent = []

    async def fake_send(phone, message, config):
        sent.append((phone, message, config.get("message_template_name")))
        return True

    monkeypatch.setattr(whatsapp_mod, "_send_meta_cloud_message", fake_send)
    result = run(whatsapp_mod.send_class_reminder_whatsapp_notice(
        {"id": "member-1", "name_ar": "محمد", "phone": "0501234567", "branch_id": "branch-a"},
        "الكاراتيه",
        datetime(2026, 9, 7, 17, 0, tzinfo=whatsapp_mod.RIYADH_TZ),
        "فرع الروضة",
    ))

    assert result is True
    assert "محمد" in sent[0][1]
    assert "الكاراتيه" in sent[0][1]
    assert "فرع الروضة" in sent[0][1]
    assert "Class reminder for محمد" in sent[0][1]
    assert "Activity: الكاراتيه" in sent[0][1]
    assert "Time: 5:00 PM" in sent[0][1]
    assert "Branch: فرع الروضة" in sent[0][1]
    assert sent[0][2] == "class_reminder_two_hours"


def test_schedule_update_notice_uses_branch_specific_template(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "enabled": True,
        "phone_number_id": "111",
        "access_token_encrypted": "encrypted",
        "schedule_update_template_name": "class_schedule_update",
        "schedule_update_template_confirmed": True,
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    sent = []

    async def fake_send(phone, message, config):
        sent.append((phone, message, config.get("message_template_name")))
        return True

    monkeypatch.setattr(whatsapp_mod, "_send_meta_cloud_message", fake_send)
    result = run(whatsapp_mod.send_schedule_update_whatsapp_notice(
        {
            "id": "member-1",
            "name_ar": "محمد",
            "phone": "0501234567",
            "branch_id": "branch-a",
        },
        "تم تغيير موعد تدريب محمد من 4:00 م إلى 5:00 م",
        notice_type="schedule_changed_cloud",
    ))

    assert result is True
    assert sent[0][0] == "966501234567@s.whatsapp.net"
    assert "الفرع: branch-a" not in sent[0][1]
    assert "Branch:" not in sent[0][1]
    assert sent[0][2] == "class_schedule_update"


def test_schedule_update_adds_both_branch_labels_without_translating_name(monkeypatch):
    db = _DB()
    db["branches"].rows[0].update({"name_ar": "فرع الروضة"})
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "enabled": True,
        "phone_number_id": "111",
        "access_token_encrypted": "encrypted",
        "schedule_update_template_name": "class_schedule_update",
        "schedule_update_template_confirmed": True,
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    sent = []

    async def fake_send(_phone, message, _config):
        sent.append(message)
        return True

    monkeypatch.setattr(whatsapp_mod, "_send_meta_cloud_message", fake_send)
    result = run(whatsapp_mod.send_schedule_update_whatsapp_notice(
        {"id": "member-1", "phone": "0501234567", "branch_id": "branch-a"},
        "تم تغيير الموعد\n\n— English —\nThe schedule changed",
        notice_type="schedule_changed_cloud",
    ))

    assert result is True
    assert "الفرع: فرع الروضة" in sent[0]
    assert "Branch: فرع الروضة" in sent[0]
    assert "Rawdah" not in sent[0]


def test_class_reminder_worker_sends_once_for_the_same_class(monkeypatch):
    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self, length=None):
            return [dict(row) for row in self.rows]

    class FindCollection(_Collection):
        def find(self, *_args, **_kwargs):
            return Cursor(self.rows)

    class ReminderLog(_Collection):
        async def insert_one(self, row):
            if any(item.get("dedup_key") == row.get("dedup_key") for item in self.rows):
                raise whatsapp_mod.DuplicateKeyError("duplicate")
            self.rows.append(dict(row))

        async def delete_one(self, query):
            self.rows = [
                row for row in self.rows
                if not all(row.get(key) == value for key, value in query.items())
            ]

    db = _DB()
    db.collections["branches"] = FindCollection([{
        "id": "branch-a", "name_ar": "فرع الروضة",
    }])
    db.collections["members"] = FindCollection([{
        "id": "member-1",
        "name_ar": "محمد",
        "phone": "0501234567",
        "branch_id": "branch-a",
        "activities": [{
            "activity_id": "activity-1",
            "activity_name": "الكاراتيه",
            "status": "active",
            "start_date": "2026-09-01",
            "end_date": "2026-09-30",
            "training_days": ["monday"],
            "training_time": "5:00 م",
        }, {
            "activity_id": "activity-2", "activity_name": "السباحة",
            "status": "active", "start_date": "2026-09-01", "end_date": "2026-09-30",
            "training_days": ["monday"], "training_time": "7:00 م",
        }],
    }])
    db.collections["whatsapp_class_reminder_log"] = ReminderLog()
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    sent = []

    async def fake_notice(member, activity_name, class_time, branch_name):
        assert [entry["activity_name"] for entry in member["_daily_classes"]] == ["الكاراتيه", "السباحة"]
        assert [entry["class_time"].hour for entry in member["_daily_classes"]] == [17, 19]
        sent.append((member["id"], activity_name, class_time, branch_name))
        return True

    monkeypatch.setattr(
        whatsapp_mod, "send_class_reminder_whatsapp_notice", fake_notice
    )
    now = datetime(2026, 9, 7, 15, 0, tzinfo=whatsapp_mod.RIYADH_TZ)

    assert run(whatsapp_mod.process_class_reminders(now)) == 1
    assert run(whatsapp_mod.process_class_reminders(now)) == 0
    assert run(whatsapp_mod.process_class_reminders(now.replace(hour=17))) == 0
    assert len(sent) == 1


def test_invoice_payment_notice_uses_customer_phone_and_branch_template(monkeypatch):
    db = _DB()
    db["whatsapp_branch_configs"].rows.append({
        "branch_id": "branch-a",
        "enabled": True,
        "phone_number_id": "111",
        "access_token_encrypted": "encrypted",
        "payment_template_name": "invoice_payment_received",
        "payment_template_confirmed": True,
    })
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    sent = []

    async def fake_send(phone, message, config):
        sent.append((phone, message, config.get("message_template_name")))
        return True

    monkeypatch.setattr(whatsapp_mod, "_send_meta_cloud_message", fake_send)
    result = run(whatsapp_mod.send_invoice_payment_whatsapp_notice({
        "id": "invoice-1",
        "invoice_number": "230955",
        "customer_name_ar": "عبدالعزيز",
        "customer_phone": "0501234567",
        "items": [{"activity_name": "الكاراتيه", "fee": 500}],
        "subtotal": 500,
        "vat_amount": 74.7,
        "discount": 25,
        "total": 549.7,
        "branch_id": "branch-a",
    }))

    assert result is True
    assert sent[0][0] == "966501234567@s.whatsapp.net"
    assert "230955" in sent[0][1]
    assert "الكاراتيه" in sent[0][1]
    assert "ضريبة القيمة المضافة" in sent[0][1]
    assert "549.7" in sent[0][1]
    assert "Your payment has been received successfully" in sent[0][1]
    assert "Customer: عبدالعزيز" in sent[0][1]
    assert "Items:\n• الكاراتيه: SAR 500" in sent[0][1]
    assert "VAT: SAR 74.7" in sent[0][1]
    assert "Total paid: SAR 549.7" in sent[0][1]
    assert sent[0][2] == "invoice_payment_received"


def test_stale_processing_payment_notice_is_not_resent_after_restart(monkeypatch):
    class Result:
        def __init__(self, modified_count):
            self.modified_count = modified_count

    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        def sort(self, *_args):
            return self

        async def to_list(self, _limit):
            return [dict(row) for row in self.rows]

    class Outbox:
        def __init__(self):
            self.rows = [{
                "invoice_id": "invoice-stale",
                "invoice": {"id": "invoice-stale", "branch_id": "branch-a"},
                "status": "processing",
                "attempts": 1,
                "claim_token": "dead-worker",
                "claimed_at": "2000-01-01T00:00:00+00:00",
                "created_at": "2000-01-01T00:00:00+00:00",
            }]

        async def create_index(self, *_args, **_kwargs):
            return "invoice_id_1"

        def find(self, _query, _projection=None):
            return Cursor(self.rows)

        async def update_one(self, query, update):
            row = self.rows[0]
            for key, expected in query.items():
                actual = row.get(key)
                if isinstance(expected, dict):
                    if "$in" in expected and actual not in expected["$in"]:
                        return Result(0)
                    if "$lt" in expected and not actual < expected["$lt"]:
                        return Result(0)
                elif actual != expected:
                    return Result(0)
            row.update(update.get("$set", {}))
            for key, value in update.get("$inc", {}).items():
                row[key] = row.get(key, 0) + value
            return Result(1)

    outbox = Outbox()

    class OutboxDB:
        def __getitem__(self, _name):
            return outbox

    monkeypatch.setattr(whatsapp_mod, "_db", OutboxDB())

    async def fake_send(_invoice):
        raise AssertionError("An uncertain receipt must not be resent")

    monkeypatch.setattr(
        whatsapp_mod, "send_invoice_payment_whatsapp_notice", fake_send
    )
    delivered = run(whatsapp_mod.process_invoice_payment_whatsapp_outbox())

    assert delivered == 0
    assert outbox.rows[0]["status"] == "unknown"
    assert outbox.rows[0]["attempts"] == 1
    assert outbox.rows[0]["claim_token"] == "dead-worker"


@pytest.mark.parametrize("result", [
    (True, {"key": {"id": "receipt"}}, None),
    (False, None, "http_400"),
    (False, None, "ReadTimeout"),
    (False, None, "http_502"),
])
def test_whatsflow_payment_sends_image_not_text(monkeypatch, result):
    import base64
    from services import invoice_receipt_image

    db = _DB()
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    config = {"provider": "whatsflow", "enabled": True, "branch_id": "branch-a"}
    async def get_config(branch_id):
        assert branch_id == "branch-a"
        return config
    monkeypatch.setattr(whatsapp_mod, "_get_branch_cloud_config", get_config)
    rendered = []
    def render(invoice, branch):
        rendered.append((invoice, branch))
        return b"\x89PNG\r\n\x1a\nreceipt"
    monkeypatch.setattr(invoice_receipt_image, "render_invoice_receipt_image", render)
    calls = []
    class Client:
        async def send_media(self, *args):
            calls.append(args)
            return result
        async def send_text(self, *_args, **_kwargs):
            raise AssertionError("No extra text send")
    def client(actual):
        assert actual is config
        return Client()
    monkeypatch.setattr(whatsapp_mod, "_whatsflow_client", client)
    invoice = {
        "id": "paid-invoice", "branch_id": "branch-a",
        "invoice_number": "830112", "customer_phone": "0501234567",
        "customer_name": "عميل تجريبي", "total": 11.5,
    }
    if result[2] in {"ReadTimeout", "http_502"}:
        with pytest.raises(whatsapp_mod.InvoiceReceiptDeliveryUnknown):
            run(whatsapp_mod.send_invoice_payment_whatsapp_notice(invoice))
    else:
        assert run(whatsapp_mod.send_invoice_payment_whatsapp_notice(invoice)) is result[0]
    assert len(calls) == 1
    number, kind, mime, caption, media, filename = calls[0]
    assert number == "966501234567"
    assert (kind, mime, filename) == ("image", "image/png", "invoice.png")
    assert "830112" in caption and "11.5" in caption
    assert "Your payment has been received successfully" in caption
    assert "Invoice number: 830112" in caption
    assert "Total paid: SAR 11.5" in caption
    assert base64.b64decode(media).startswith(b"\x89PNG")
    assert rendered == [(invoice, {"id": "branch-a"})]


def test_automatic_renewal_preserves_template_and_appends_structured_english_once(monkeypatch):
    db = _DB()
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    sent = []

    async def fake_send(phone, message, branch_id, quick_reply_payload=None):
        sent.append((phone, message, branch_id, quick_reply_payload))
        return True

    async def fake_config(_branch_id):
        return None

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(whatsapp_mod, "_send_wa_message_for_branch", fake_send)
    monkeypatch.setattr(whatsapp_mod, "_get_branch_cloud_config", fake_config)
    monkeypatch.setattr(whatsapp_mod.asyncio, "sleep", no_sleep)
    member_data = [{
        "member": {
            "id": "member-1",
            "name": "محمد Ali",
            "phone": "0501234567",
            "branch_id": "branch-a",
        },
        "activity_name": "الكاراتيه Kids",
        "expiring_activities": ["الكاراتيه Kids"],
        "end_date_fmt": "2026/09/10",
        "fee_str": "500",
    }]

    count = run(whatsapp_mod._send_wa_for_members(
        member_data,
        3,
        "مرحباً {name}، اشتراك {activity} ينتهي بتاريخ {end_date}.",
    ))

    assert count == 1
    message = sent[0][1]
    assert message.startswith("مرحباً محمد Ali، اشتراك الكاراتيه Kids")
    assert "Hello محمد Ali" in message
    assert "subscription for الكاراتيه Kids expires on 2026/09/10" in message
    assert "(3 day(s) remaining)" in message
    assert message.count(whatsapp_mod.BILINGUAL_ENGLISH_MARKER) == 1
    assert sent[0][3] == "CONTACT_US"


def test_automatic_renewal_does_not_double_marked_bilingual_template(monkeypatch):
    db = _DB()
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    sent = []

    async def fake_send(_phone, message, _branch_id, quick_reply_payload=None):
        sent.append(message)
        return True

    async def no_sleep(_seconds):
        return None

    async def fake_config(_branch_id):
        return None

    monkeypatch.setattr(whatsapp_mod, "_send_wa_message_for_branch", fake_send)
    monkeypatch.setattr(whatsapp_mod, "_get_branch_cloud_config", fake_config)
    monkeypatch.setattr(whatsapp_mod.asyncio, "sleep", no_sleep)

    count = run(whatsapp_mod._send_wa_for_members([{
        "member": {"id": "m1", "name": "سارة", "phone": "0501234567"},
        "activity_name": "Swimming",
        "end_date_fmt": "2026/09/10",
    }], 0, "تنبيه\n\n— English —\nAlready bilingual"))

    assert count == 1
    assert sent == ["تنبيه\nتاريخ انتهاء الاشتراك: 2026/09/10\n\n— English —\nAlready bilingual"]


def test_renewal_arabic_date_is_added_once():
    message = "مرحباً، اشتراككم سينتهي بعد يومين."
    result = whatsapp_mod._ensure_renewal_arabic_date(message, "2026/09/12")
    assert "تاريخ انتهاء الاشتراك: 2026/09/12" in result
    assert whatsapp_mod._ensure_renewal_arabic_date(result, "2026/09/12") == result
    custom = "ينتهي بتاريخ 2026/09/12، يرجى التجديد."
    assert whatsapp_mod._ensure_renewal_arabic_date(custom, "2026/09/12") == custom


def test_automatic_renewal_uses_expired_days_ago_not_negative_remaining(monkeypatch):
    db = _DB()
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    sent = []

    async def fake_send(_phone, message, _branch_id, quick_reply_payload=None):
        sent.append(message)
        return True

    async def fake_config(_branch_id):
        return None

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(whatsapp_mod, "_send_wa_message_for_branch", fake_send)
    monkeypatch.setattr(whatsapp_mod, "_get_branch_cloud_config", fake_config)
    monkeypatch.setattr(whatsapp_mod.asyncio, "sleep", no_sleep)

    count = run(whatsapp_mod._send_wa_for_members([{
        "member": {"id": "m1", "name": "سارة", "phone": "0501234567"},
        "activity_name": "Swimming",
        "end_date_fmt": "2026/09/10",
    }], -4, "انتهى الاشتراك بتاريخ {end_date}"))

    assert count == 1
    assert "expired on 2026/09/10 (4 day(s) ago)" in sent[0]
    assert "-4 day(s) remaining" not in sent[0]


def test_manual_bulk_expired_renewal_appends_structured_english(monkeypatch):
    class AsyncMembers(_Collection):
        def find(self, query, _projection=None):
            rows = [
                dict(row) for row in self.rows
                if row.get("id") in query.get("id", {}).get("$in", [])
            ]

            class Cursor:
                def __aiter__(self):
                    self._iter = iter(rows)
                    return self

                async def __anext__(self):
                    try:
                        return next(self._iter)
                    except StopIteration:
                        raise StopAsyncIteration

            return Cursor()

    db = _DB()
    db.collections["members"] = AsyncMembers([{
        "id": "member-1",
        "name_ar": "عبدالعزيز",
        "phone": "0501234567",
        "branch_id": "branch-a",
    }])
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    sent = []

    async def settings():
        return {
            "manual_reminder_template": "اشتراك {activity} ينتهي بتاريخ {end_date}",
            "manual_reminder_expired_template": "اشتراك {activity} انتهى بتاريخ {end_date}",
            "push_enabled": False,
            "portal_enabled": False,
        }

    async def branch_templates():
        return {}

    async def wa_status():
        return {"connected": True}

    async def fake_send(_phone, message, branch_id):
        sent.append((message, branch_id))
        return True

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(whatsapp_mod, "_get_settings", settings)
    monkeypatch.setattr(whatsapp_mod, "_get_branch_templates", branch_templates)
    monkeypatch.setattr(whatsapp_mod, "_get_wa_status", wa_status)
    monkeypatch.setattr(whatsapp_mod, "_send_wa_message_for_branch", fake_send)
    monkeypatch.setattr(whatsapp_mod.asyncio, "sleep", no_sleep)
    expired_date = (
        datetime.now(whatsapp_mod.RIYADH_TZ).date() - timedelta(days=3)
    ).isoformat()

    result = run(whatsapp_mod.send_bulk_renewal_reminders(
        whatsapp_mod.BulkReminderRequest(items=[whatsapp_mod.BulkReminderItem(
            member_id="member-1",
            activity_name="الكاراتيه Kids",
            end_date=expired_date,
            fee=500,
        )]),
        current_user={"id": "admin", "name": "Admin", "is_admin": True},
    ))

    assert result["wa_sent"] == 1
    assert sent[0][1] == "branch-a"
    message = sent[0][0]
    assert message.startswith(f"اشتراك الكاراتيه Kids انتهى بتاريخ {expired_date.replace('-', '/')}")
    assert "Hello عبدالعزيز" in message
    assert (
        f"subscription for الكاراتيه Kids expired on "
        f"{expired_date.replace('-', '/')} (3 day(s) ago)"
    ) in message
    assert "-3 day(s) remaining" not in message
    assert message.count(whatsapp_mod.BILINGUAL_ENGLISH_MARKER) == 1


def test_receipt_render_failure_does_not_send_text_fallback(monkeypatch):
    from services import invoice_receipt_image
    monkeypatch.setattr(whatsapp_mod, "_db", _DB())
    async def config(_branch):
        return {"provider": "whatsflow", "enabled": True}
    monkeypatch.setattr(whatsapp_mod, "_get_branch_cloud_config", config)
    def broken(*_args):
        raise RuntimeError("render failed")
    monkeypatch.setattr(invoice_receipt_image, "render_invoice_receipt_image", broken)
    monkeypatch.setattr(whatsapp_mod, "_whatsflow_client",
                        lambda *_args: pytest.fail("Must not send without image"))
    assert run(whatsapp_mod.send_invoice_payment_whatsapp_notice({
        "id": "invoice", "branch_id": "branch-a", "customer_phone": "0501234567",
    })) is False


@pytest.mark.parametrize("outcome, expected", [
    (True, "delivered"), (False, "failed"), ("timeout", "unknown"),
])
def test_receipt_outbox_records_media_delivery_outcome(monkeypatch, outcome, expected):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    collection = SimpleNamespace(update_one=AsyncMock(
        return_value=SimpleNamespace(modified_count=1)))
    monkeypatch.setattr(whatsapp_mod, "_db", {
        "whatsapp_invoice_payment_outbox": collection,
    })
    async def send(_invoice):
        if outcome == "timeout":
            raise whatsapp_mod.InvoiceReceiptDeliveryUnknown("ReadTimeout")
        return outcome
    monkeypatch.setattr(whatsapp_mod, "send_invoice_payment_whatsapp_notice", send)
    result = run(whatsapp_mod._deliver_invoice_payment_outbox_item({
        "invoice_id": "invoice", "status": "pending", "invoice": {"id": "invoice"},
    }))
    assert result is (outcome is True)
    update = collection.update_one.call_args.args[1]["$set"]
    assert update["status"] == expected
    assert update["last_error"] == ("ReadTimeout" if outcome == "timeout" else None)