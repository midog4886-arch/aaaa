import asyncio
import hashlib
import hmac
import json
from datetime import date, datetime

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

    async def fake_meta(phone, message, config):
        seen.append((phone, message, config["branch_id"]))
        return True

    monkeypatch.setattr(whatsapp_mod, "_send_meta_cloud_message", fake_meta)
    result = run(whatsapp_mod.send_branch_cloud_bulk(
        whatsapp_mod.BulkCloudSendRequest(
            branch_id="branch-b",
            recipients=[
                {"phone": "0501234567", "message": "أهلاً محمد"},
                {"phone": "0509876543", "message": "أهلاً سارة"},
            ],
        ),
        current_user={"is_admin": True},
    ))

    assert result == {
        "success": True,
        "total": 2,
        "sent": 2,
        "failed": 0,
        "failed_indices": [],
    }
    assert seen == [
        ("966501234567@s.whatsapp.net", "أهلاً محمد", "branch-b"),
        ("966509876543@s.whatsapp.net", "أهلاً سارة", "branch-b"),
    ]


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

    async def fake_meta(phone, message, config):
        seen.append(phone)
        return True

    monkeypatch.setattr(whatsapp_mod, "_send_meta_cloud_message", fake_meta)
    result = run(whatsapp_mod.send_branch_cloud_bulk(
        whatsapp_mod.BulkCloudSendRequest(
            branch_id="branch-a",
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

    assert result["sent"] == 2
    assert seen == [
        "201001234567@s.whatsapp.net",
        "14155552671@s.whatsapp.net",
    ]


def test_bulk_cloud_send_rejects_branch_outside_user_scope(monkeypatch):
    monkeypatch.setattr(whatsapp_mod, "_db", _DB())
    try:
        run(whatsapp_mod.send_branch_cloud_bulk(
            whatsapp_mod.BulkCloudSendRequest(
                branch_id="branch-b",
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
    uploaded = []
    sent = []

    async def fake_upload(content, filename, mime_type, config):
        uploaded.append((content, filename, mime_type, config["branch_id"]))
        return "media-1"

    async def fake_send(phone, message, media_id, media_type, filename, config):
        sent.append((phone, message, media_id, media_type, filename, config["branch_id"]))
        return True

    monkeypatch.setattr(whatsapp_mod, "_upload_meta_bulk_media", fake_upload)
    monkeypatch.setattr(whatsapp_mod, "_send_meta_media_template", fake_send)

    class _Upload:
        filename = "offer.pdf"
        content_type = "application/pdf"
        done = False

        async def read(self, _size=-1):
            if self.done:
                return b""
            self.done = True
            return b"%PDF-1.7 test"

    result = run(whatsapp_mod.send_branch_cloud_bulk_media(
        branch_id="branch-a",
        recipients_json=json.dumps([{
            "phone": "0501234567",
            "message": "عرض خاص",
        }]),
        idempotency_key="test-batch-key-123",
        attachment=_Upload(),
        current_user={"is_admin": True},
    ))

    assert result["sent"] == 1
    assert result["media_type"] == "document"
    assert uploaded[0][1:3] == ("offer.pdf", "application/pdf")
    assert sent[0][2:5] == ("media-1", "document", "offer.pdf")


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
    assert sent[0][2] == "class_reminder_two_hours"


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
        }],
    }])
    db.collections["whatsapp_class_reminder_log"] = ReminderLog()
    monkeypatch.setattr(whatsapp_mod, "_db", db)
    sent = []

    async def fake_notice(member, activity_name, class_time, branch_name):
        sent.append((member["id"], activity_name, class_time, branch_name))
        return True

    monkeypatch.setattr(
        whatsapp_mod, "send_class_reminder_whatsapp_notice", fake_notice
    )
    now = datetime(2026, 9, 7, 15, 0, tzinfo=whatsapp_mod.RIYADH_TZ)

    assert run(whatsapp_mod.process_class_reminders(now)) == 1
    assert run(whatsapp_mod.process_class_reminders(now)) == 0
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
    assert sent[0][2] == "invoice_payment_received"


def test_stale_processing_payment_notice_is_reclaimed_after_restart(monkeypatch):
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
        return True

    monkeypatch.setattr(
        whatsapp_mod, "send_invoice_payment_whatsapp_notice", fake_send
    )
    delivered = run(whatsapp_mod.process_invoice_payment_whatsapp_outbox())

    assert delivered == 1
    assert outbox.rows[0]["status"] == "delivered"
    assert outbox.rows[0]["attempts"] == 2
    assert outbox.rows[0]["claim_token"] != "dead-worker"