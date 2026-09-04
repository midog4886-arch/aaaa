import asyncio

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

    async def insert_one(self, row):
        self.rows.append(dict(row))


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