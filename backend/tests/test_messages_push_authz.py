"""HTTP-level auth regression tests for the messaging + push admin endpoints.

/push-notifications/broadcast, /subscribers-count, /subscribers-list and the
/messages/* admin endpoints used to be reachable without authentication or
without the "messages" permission, exposing member PII and letting anyone
broadcast pushes. These tests pin the contract:

  - no Authorization header      -> 401/403
  - authed WITHOUT "messages"    -> 403
  - authed WITH "messages"       -> 2xx

Requests go through a real FastAPI app (TestClient) that mounts the actual
routers, so the dependency wiring itself is under test. The db is a small
in-memory fake — no live Atlas, order-independent under the full suite.
"""
import os
import sys

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import routes.common as common_mod  # noqa: E402
import routes.messages as messages_mod  # noqa: E402
import routes.push_notifications as push_mod  # noqa: E402


# ── Minimal async fakes ──────────────────────────────────────────────────────

class _Cursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, *a, **k):
        return self

    def skip(self, *_):
        return self

    def limit(self, *_):
        return self

    async def to_list(self, *_a, **_k):
        return self._docs


def _matches(doc, query):
    for key, cond in (query or {}).items():
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and val not in cond["$in"]:
                return False
            if "$ne" in cond and val == cond["$ne"]:
                return False
        elif val != cond:
            return False
    return True


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _Cursor([d for d in self.docs if _matches(d, query)])

    async def find_one(self, query=None, projection=None, **_k):
        for d in self.docs:
            if _matches(d, query):
                return dict(d)
        return None

    async def count_documents(self, query=None):
        return len([d for d in self.docs if _matches(d, query)])

    async def update_many(self, *_a, **_k):
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def insert_many(self, docs):
        self.docs.extend(docs)

    async def delete_one(self, query):
        for i, d in enumerate(self.docs):
            if _matches(d, query):
                del self.docs[i]

                class R:
                    deleted_count = 1
                return R()

        class R:
            deleted_count = 0
        return R()

    def aggregate(self, _pipeline):
        return _Cursor([])


class _FakeDB:
    def __getattr__(self, name):
        coll = _Collection()
        setattr(self, name, coll)
        return coll


def _token(user_id, username="staff", tenant="global-champions", is_admin=False):
    return jwt.encode(
        {
            "user_id": user_id,
            "username": username,
            "tenant_slug": tenant,
            "is_admin": is_admin,
            "branch_id": "branch-A",
        },
        common_mod.JWT_SECRET,
        algorithm=common_mod.JWT_ALGORITHM,
    )


@pytest.fixture
def client(monkeypatch):
    db = _FakeDB()
    db.users = _Collection([
        {"id": "u-with", "permissions": ["messages"]},
        {"id": "u-without", "permissions": ["dashboard"]},
    ])
    db.members = _Collection([
        {"id": "m-1", "branch_id": "branch-A", "name_ar": "عضو", "status": "active"},
    ])
    db.push_subscriptions = _Collection([])
    db.messages = _Collection([])
    db.branches = _Collection([{"id": "branch-A", "name_ar": "فرع أ"}])

    monkeypatch.setattr(messages_mod, "db", db, raising=True)
    monkeypatch.setattr(push_mod, "db", db, raising=True)
    import database as database_mod
    monkeypatch.setattr(database_mod, "db", db, raising=False)

    # Pin the tenant so the token's tenant_slug matches.
    from utils import tenant as tenant_mod
    monkeypatch.setattr(tenant_mod, "get_current_tenant_slug", lambda: "global-champions", raising=True)

    # Broadcast fans out to real send helpers — neutralize them.
    async def _fake_broadcast_send(payload, branch_id=None):
        return {"total": 0, "success": 0, "failed": 0}

    monkeypatch.setattr(push_mod, "send_notification_to_all_members", _fake_broadcast_send, raising=True)

    app = FastAPI()
    app.include_router(messages_mod.router, prefix="/api")
    app.include_router(push_mod.router, prefix="/api")
    return TestClient(app)


PROTECTED_GETS = [
    "/api/messages",
    "/api/messages/conversations",
    "/api/messages/unread-count",
    "/api/messages/thread/m-1",
    "/api/push-notifications/subscribers-count",
    "/api/push-notifications/subscribers-list",
]
BROADCAST_BODY = {"title": "ت", "body": "ب"}


def _headers(user_id):
    return {"Authorization": f"Bearer {_token(user_id)}"}


# ── Unauthenticated → rejected ───────────────────────────────────────────────

@pytest.mark.parametrize("path", PROTECTED_GETS)
def test_unauthenticated_get_rejected(client, path):
    r = client.get(path)
    assert r.status_code in (401, 403), f"{path} -> {r.status_code}"


def test_unauthenticated_broadcast_rejected(client):
    r = client.post("/api/push-notifications/broadcast", json=BROADCAST_BODY)
    assert r.status_code in (401, 403)


def test_unauthenticated_send_message_rejected(client):
    r = client.post("/api/messages", json={"subject": "س", "body": "ب", "broadcast": True})
    assert r.status_code in (401, 403)


def test_garbage_token_rejected(client):
    r = client.get("/api/messages/conversations", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401


# ── Authenticated WITHOUT the "messages" permission → 403 ───────────────────

@pytest.mark.parametrize("path", PROTECTED_GETS)
def test_no_permission_get_forbidden(client, path):
    r = client.get(path, headers=_headers("u-without"))
    assert r.status_code == 403, f"{path} -> {r.status_code}"


def test_no_permission_broadcast_forbidden(client):
    r = client.post(
        "/api/push-notifications/broadcast", json=BROADCAST_BODY, headers=_headers("u-without")
    )
    assert r.status_code == 403


def test_no_permission_send_message_forbidden(client):
    r = client.post(
        "/api/messages",
        json={"recipient_member_id": "m-1", "subject": "س", "body": "ب"},
        headers=_headers("u-without"),
    )
    assert r.status_code == 403


def test_no_permission_reply_forbidden(client):
    r = client.post(
        "/api/messages/thread/m-1/reply", json={"body": "ب"}, headers=_headers("u-without")
    )
    assert r.status_code == 403


def test_no_permission_delete_forbidden(client):
    r = client.delete("/api/messages/msg-1", headers=_headers("u-without"))
    assert r.status_code == 403


# ── Authenticated WITH the permission → allowed ──────────────────────────────

@pytest.mark.parametrize("path", [
    "/api/messages",
    "/api/messages/conversations",
    "/api/messages/unread-count",
    "/api/push-notifications/subscribers-count",
    "/api/push-notifications/subscribers-list",
])
def test_with_permission_get_allowed(client, path):
    r = client.get(path, headers=_headers("u-with"))
    assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text}"


def test_with_permission_broadcast_allowed(client):
    r = client.post(
        "/api/push-notifications/broadcast", json=BROADCAST_BODY, headers=_headers("u-with")
    )
    assert r.status_code == 200, r.text


def test_with_permission_thread_allowed(client):
    r = client.get("/api/messages/thread/m-1", headers=_headers("u-with"))
    assert r.status_code == 200, r.text
    assert r.json()["member"]["id"] == "m-1"


def test_with_permission_send_message_allowed(client, monkeypatch):
    async def _noop_push(*_a, **_k):
        return None

    monkeypatch.setattr(messages_mod, "send_message_push", _noop_push, raising=True)
    r = client.post(
        "/api/messages",
        json={"recipient_member_id": "m-1", "subject": "س", "body": "ب"},
        headers=_headers("u-with"),
    )
    assert r.status_code == 200, r.text


def test_with_permission_reply_allowed(client, monkeypatch):
    async def _noop_push(*_a, **_k):
        return None

    monkeypatch.setattr(messages_mod, "send_message_push", _noop_push, raising=True)
    r = client.post(
        "/api/messages/thread/m-1/reply", json={"body": "ب"}, headers=_headers("u-with")
    )
    assert r.status_code == 200, r.text


def test_with_permission_delete_allowed(client):
    # Seed a message for the in-scope member, then delete it.
    import asyncio
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(messages_mod.db.messages.insert_one(
            {"id": "msg-del", "recipient_member_id": "m-1"}
        ))
    finally:
        loop.close()
    r = client.delete("/api/messages/msg-del", headers=_headers("u-with"))
    assert r.status_code == 200, r.text


def test_unauthenticated_reply_and_delete_rejected(client):
    r1 = client.post("/api/messages/thread/m-1/reply", json={"body": "ب"})
    r2 = client.delete("/api/messages/msg-1")
    assert r1.status_code in (401, 403)
    assert r2.status_code in (401, 403)
