import asyncio

from services.whatsflow import WhatsflowClient
from routes import whatsapp as whatsapp_mod


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_whatsflow_client_header_and_text_payload(monkeypatch):
    captured = {}

    class Response:
        status_code = 200

        def json(self):
            return {"key": {"id": "wf-1"}}

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def request(self, method, url, headers, **kwargs):
            captured.update(method=method, url=url, headers=headers, **kwargs)
            return Response()

    monkeypatch.setattr("services.whatsflow.httpx.AsyncClient", lambda **_: Client())
    result = run(
        WhatsflowClient("branch-a", "secret").send_text(
            "+966 50 123 4567", "hello", delay=250, link_preview=True
        )
    )
    assert result == (True, {"key": {"id": "wf-1"}}, None)
    assert captured["url"] == "https://connect.whats-flow.net/message/sendText/branch-a"
    assert captured["headers"] == {"apikey": "secret"}
    assert captured["json"] == {
        "number": "966501234567",
        "text": "hello",
        "delay": 250,
        "linkPreview": True,
    }


def test_whatsflow_media_contract(monkeypatch):
    captured = {}

    class Response:
        status_code = 200

        def json(self):
            return {"id": "wf-media"}

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def request(self, method, url, headers, **kwargs):
            captured.update(method=method, url=url, headers=headers, **kwargs)
            return Response()

    monkeypatch.setattr("services.whatsflow.httpx.AsyncClient", lambda **_: Client())
    run(WhatsflowClient("one", "key").send_media(
        "966500000000", "document", "application/pdf", "caption",
        "https://app.example/media/token", "file.pdf",
    ))
    assert captured["json"]["mediatype"] == "document"
    assert captured["json"]["mimetype"] == "application/pdf"
    assert captured["json"]["media"] == "https://app.example/media/token"
    assert captured["json"]["fileName"] == "file.pdf"


def test_provider_resolution_accepts_whatsflow_without_changing_legacy_defaults():
    assert whatsapp_mod._branch_provider({"provider": "whatsflow", "enabled": True}) == "whatsflow"
    assert whatsapp_mod._branch_provider(None) == "legacy"
    assert whatsapp_mod._branch_provider({"enabled": True}) == "meta_cloud"


def test_whatsflow_webhook_contract(monkeypatch):
    captured = {}

    class Response:
        status_code = 201

        def json(self):
            return {"enabled": True}

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def request(self, method, url, headers, **kwargs):
            captured.update(method=method, url=url, headers=headers, **kwargs)
            return Response()

    monkeypatch.setattr("services.whatsflow.httpx.AsyncClient", lambda **_: Client())
    result = run(
        WhatsflowClient("branch-a", "secret").set_webhook(
            "https://app.example/api/whatsapp/whatsflow-webhook/academy/branch",
            "webhook-secret",
        )
    )
    assert result == (True, {"enabled": True}, None)
    assert captured["url"].endswith("/webhook/set/branch-a")
    assert captured["headers"] == {"apikey": "secret"}
    assert captured["json"] == {
        "webhook": {
            "enabled": True,
            "url": "https://app.example/api/whatsapp/whatsflow-webhook/academy/branch",
            "byEvents": False,
            "base64": False,
            "headers": {"X-Webhook-Secret": "webhook-secret"},
            "events": [
                "MESSAGES_UPSERT",
                "MESSAGES_UPDATE",
                "CONNECTION_UPDATE",
            ],
        }
    }