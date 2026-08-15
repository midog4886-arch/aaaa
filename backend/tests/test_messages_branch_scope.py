"""Branch scoping for the internal-messaging admin endpoints.

A non-admin staff user pinned to branch A must not be able to read, mark
read, reply to, or delete another branch's member conversations — even by
guessing member/message ids. Admins keep the tenant-wide view.

Handlers are called directly with a fake in-memory db (no live Atlas, no
HTTP server); permissions are bypassed for non-admins by giving the fake
users collection the "messages" permission.
"""
import asyncio
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import routes.messages as messages_mod  # noqa: E402


def run(coro):
    # Own loop per call: order-independent under the full suite.
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Minimal async-Mongo fakes ────────────────────────────────────────────────

def _matches(doc, query):
    for key, cond in query.items():
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond:
                if val not in cond["$in"]:
                    return False
            if "$ne" in cond:
                if val == cond["$ne"]:
                    return False
        else:
            if val != cond:
                return False
    return True


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


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.update_many_calls = []
        self.inserted = []

    def find(self, query=None, projection=None):
        return _Cursor([d for d in self.docs if _matches(d, query or {})])

    async def find_one(self, query=None, projection=None, **_k):
        for d in self.docs:
            if _matches(d, query or {}):
                return dict(d)
        return None

    async def count_documents(self, query=None):
        return len([d for d in self.docs if _matches(d, query or {})])

    async def update_many(self, query, update):
        self.update_many_calls.append((query, update))
        for d in self.docs:
            if _matches(d, query):
                d.update(update.get("$set", {}))

    async def insert_one(self, doc):
        self.inserted.append(doc)
        self.docs.append(doc)

    async def insert_many(self, docs):
        for d in docs:
            await self.insert_one(d)

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

    def aggregate(self, pipeline):
        docs = self.docs
        for stage in pipeline:
            if "$match" in stage:
                docs = [d for d in docs if _matches(d, stage["$match"])]
        # Group by recipient_member_id (enough fidelity for these tests).
        groups = {}
        for d in docs:
            g = groups.setdefault(d.get("recipient_member_id"), {
                "_id": d.get("recipient_member_id"),
                "recipient_name": d.get("recipient_name", ""),
                "last_message": d.get("body", ""),
                "last_subject": d.get("subject", ""),
                "last_sender_type": d.get("sender_type", ""),
                "last_date": d.get("created_at", ""),
                "total_messages": 0,
                "unread_count": 0,
                "pending_change_requests": 0,
            })
            g["total_messages"] += 1
            if d.get("sender_type") == "member" and d.get("read_by_admin") is False:
                g["unread_count"] += 1
        return _Cursor(list(groups.values()))


class _FakeDB:
    def __init__(self, **collections):
        for name, coll in collections.items():
            setattr(self, name, coll)

    def __getattr__(self, name):
        coll = _Collection()
        setattr(self, name, coll)
        return coll


MEMBER_A = {"id": "m-a", "branch_id": "branch-A", "name_ar": "عضو أ", "phone": "0500000001", "member_code": "A1", "status": "active"}
MEMBER_B = {"id": "m-b", "branch_id": "branch-B", "name_ar": "عضو ب", "phone": "0500000002", "member_code": "B1", "status": "active"}

MSG_A = {"id": "msg-a", "recipient_member_id": "m-a", "sender_type": "member", "read_by_admin": False, "body": "hi", "subject": "س", "created_at": "2026-08-15T00:00:00"}
MSG_B = {"id": "msg-b", "recipient_member_id": "m-b", "sender_type": "member", "read_by_admin": False, "body": "hello", "subject": "ص", "created_at": "2026-08-15T01:00:00"}

STAFF_A = {"is_admin": False, "user_id": "staff-a", "branch_id": "branch-A"}
ADMIN = {"is_admin": True, "user_id": "admin-1"}


def _make_db():
    return _FakeDB(
        members=_Collection([dict(MEMBER_A), dict(MEMBER_B)]),
        messages=_Collection([dict(MSG_A), dict(MSG_B)]),
        branches=_Collection([
            {"id": "branch-A", "name_ar": "فرع أ"},
            {"id": "branch-B", "name_ar": "فرع ب"},
        ]),
        users=_Collection([
            {"id": "staff-a", "permissions": ["messages"]},
        ]),
    )


@pytest.fixture
def fake_db(monkeypatch):
    db = _make_db()
    monkeypatch.setattr(messages_mod, "db", db, raising=True)
    # require_permission reads the real database module — point it at the fake.
    import database as database_mod
    monkeypatch.setattr(database_mod, "db", db, raising=False)

    # Hermetic: send_message_push lazily imports routes.push_notifications,
    # which would capture the fake db binding and leak into later tests.
    async def _noop_push(*_a, **_k):
        return None

    monkeypatch.setattr(messages_mod, "send_message_push", _noop_push, raising=True)
    return db


# ── Tests ────────────────────────────────────────────────────────────────────

def test_staff_conversations_exclude_other_branch(fake_db):
    convs = run(messages_mod.get_conversations(current_user=dict(STAFF_A)))
    ids = {c["member_id"] for c in convs}
    assert ids == {"m-a"}


def test_admin_conversations_see_all_branches(fake_db):
    convs = run(messages_mod.get_conversations(current_user=dict(ADMIN)))
    ids = {c["member_id"] for c in convs}
    assert ids == {"m-a", "m-b"}


def test_staff_thread_other_branch_404_and_not_marked_read(fake_db):
    with pytest.raises(HTTPException) as exc:
        run(messages_mod.get_thread("m-b", current_user=dict(STAFF_A)))
    assert exc.value.status_code == 404
    # The out-of-scope thread must NOT have been marked read.
    assert fake_db.messages.update_many_calls == []
    msg_b = [d for d in fake_db.messages.docs if d["id"] == "msg-b"][0]
    assert msg_b["read_by_admin"] is False


def test_staff_thread_own_branch_works(fake_db):
    res = run(messages_mod.get_thread("m-a", current_user=dict(STAFF_A)))
    assert res["member"]["id"] == "m-a"
    assert len(res["messages"]) == 1


def test_staff_reply_other_branch_404_no_insert(fake_db):
    with pytest.raises(HTTPException) as exc:
        run(messages_mod.admin_reply("m-b", messages_mod.MessageReply(body="x"), current_user=dict(STAFF_A)))
    assert exc.value.status_code == 404
    assert fake_db.messages.inserted == []


def test_staff_delete_other_branch_message_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        run(messages_mod.delete_message("msg-b", current_user=dict(STAFF_A)))
    assert exc.value.status_code == 404
    assert any(d["id"] == "msg-b" for d in fake_db.messages.docs)


def test_staff_unread_count_scoped(fake_db):
    res = run(messages_mod.get_unread_count(current_user=dict(STAFF_A)))
    assert res["unread_count"] == 1
    res_admin = run(messages_mod.get_unread_count(current_user=dict(ADMIN)))
    assert res_admin["unread_count"] == 2


def test_staff_send_message_other_branch_404(fake_db):
    payload = messages_mod.MessageCreate(recipient_member_id="m-b", subject="س", body="ب")
    with pytest.raises(HTTPException) as exc:
        run(messages_mod.send_message(payload, current_user=dict(STAFF_A)))
    assert exc.value.status_code == 404


def test_staff_broadcast_only_own_branch(fake_db):
    payload = messages_mod.MessageCreate(subject="س", body="ب", broadcast=True)
    res = run(messages_mod.send_message(payload, current_user=dict(STAFF_A)))
    assert res["count"] == 1
    recipients = {m["recipient_member_id"] for m in fake_db.messages.inserted}
    assert recipients == {"m-a"}
