import asyncio
import copy
import re

import pytest
from fastapi import HTTPException

from routes import whatsapp as mod


def run(coro):
    return asyncio.run(coro)


def _matches(row, query):
    for key, value in query.items():
        if key == "$or":
            if not any(_matches(row, branch) for branch in value):
                return False
            continue
        if isinstance(value, dict) and "$in" in value:
            if row.get(key) not in value["$in"]:
                return False
            continue
        if isinstance(value, dict) and "$exists" in value:
            if (key in row) != value["$exists"]:
                return False
            continue
        if isinstance(value, dict) and "$gt" in value:
            if not (row.get(key) is not None and row.get(key) > value["$gt"]):
                return False
            continue
        if isinstance(value, dict) and "$lt" in value:
            if not (row.get(key) is not None and row.get(key) < value["$lt"]):
                return False
            continue
        if isinstance(value, dict) and "$lte" in value:
            if not (row.get(key) is not None and row.get(key) <= value["$lte"]):
                return False
            continue
        if isinstance(value, dict) and "$ne" in value:
            if row.get(key) == value["$ne"]:
                return False
            continue
        if isinstance(value, dict) and "$regex" in value:
            flags = re.IGNORECASE if "i" in value.get("$options", "") else 0
            if not re.search(value["$regex"], str(row.get(key) or ""), flags):
                return False
            continue
        if row.get(key) != value:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, key, direction):
        self.rows.sort(
            key=lambda row: row.get(key) or "",
            reverse=direction < 0,
        )
        return self

    def limit(self, amount):
        self.rows = self.rows[:amount]
        return self

    async def to_list(self, length=None):
        return self.rows if length is None else self.rows[:length]


class _Collection:
    def __init__(self, rows=()):
        self.rows = [copy.deepcopy(row) for row in rows]
        self.find_queries = []
        self.find_projections = []
        self.find_one_queries = []
        self.distinct_queries = []

    async def find_one(self, query, projection=None):
        self.find_one_queries.append(copy.deepcopy(query))
        for row in self.rows:
            if _matches(row, query):
                return copy.deepcopy(row)
        return None

    async def count_documents(self, query):
        return sum(_matches(row, query) for row in self.rows)

    async def distinct(self, key, query):
        self.distinct_queries.append((key, copy.deepcopy(query)))
        return list({
            row.get(key) for row in self.rows
            if _matches(row, query) and row.get(key) is not None
        })

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                row.update(copy.deepcopy(update.get("$set", {})))
                for key, value in update.get("$max", {}).items():
                    if key not in row or row[key] < value:
                        row[key] = copy.deepcopy(value)
                return type("Result", (), {
                    "matched_count": 1, "modified_count": 1,
                })()
        return type("Result", (), {
            "matched_count": 0, "modified_count": 0,
        })()

    def aggregate(self, pipeline):
        match = pipeline[0].get("$match", {})
        group = pipeline[-1].get("$group", {})
        if "last_inbound_at" in group:
            grouped = {}
            for row in self.rows:
                if not _matches(row, match):
                    continue
                result = grouped.setdefault(row["conversation_id"], {
                    "_id": row["conversation_id"],
                    "last_inbound_at": None,
                    "last_human_reply_at": None,
                })
                created_at = row.get("created_at")
                if row.get("direction") == "inbound" and (
                    not result["last_inbound_at"]
                    or created_at > result["last_inbound_at"]
                ):
                    result["last_inbound_at"] = created_at
                human = (
                    row.get("human_reply") is True
                    or row.get("echo_source") == "human"
                    or bool(row.get("sent_by"))
                )
                if (
                    row.get("direction") == "outbound" and human
                    and str(row.get("status") or "").lower()
                    not in mod._UNSUCCESSFUL_OUTBOUND_STATUSES
                    and (
                        not result["last_human_reply_at"]
                        or created_at > result["last_human_reply_at"]
                    )
                ):
                    result["last_human_reply_at"] = created_at
            return _Cursor(list(grouped.values()))
        total = sum(
            int(row.get("unread_count") or 0)
            for row in self.rows if _matches(row, match)
        )
        return _Cursor([{"count": total}] if total else [])

    def find(self, query, projection=None):
        self.find_queries.append(copy.deepcopy(query))
        self.find_projections.append(copy.deepcopy(projection))
        rows = [row for row in self.rows if _matches(row, query)]
        if projection:
            included = {
                key for key, enabled in projection.items()
                if enabled and key != "_id"
            }
            if included:
                rows = [
                    {key: copy.deepcopy(row[key]) for key in included if key in row}
                    for row in rows
                ]
            else:
                excluded = {
                    key for key, enabled in projection.items() if not enabled
                }
                rows = [
                    {
                        key: copy.deepcopy(value)
                        for key, value in row.items()
                        if key not in excluded
                    }
                    for row in rows
                ]
        return _Cursor(rows)


class _Database:
    def __init__(self, conversations, branches=(), members=()):
        self.collections = {
            "whatsapp_cloud_conversations": _Collection(conversations),
            "branches": _Collection(branches),
            "members": _Collection(members),
        }

    def __getitem__(self, name):
        return self.collections.setdefault(name, _Collection())


def test_cloud_list_batches_branch_names_and_preserves_rows(monkeypatch):
    db = _Database(
        conversations=[
            {
                "id": "branch-a:966501234567",
                "branch_id": "branch-a",
                "phone": "966501234567",
                "last_message": "A",
                "last_message_at": "2025-02-02T00:00:00+00:00",
                "unread_count": 1,
                "required_field": "kept",
            },
            {
                "id": "branch-b:966501234568",
                "branch_id": "branch-b",
                "phone": "966501234568",
                "last_message": "B",
                "last_message_at": "2025-02-01T00:00:00+00:00",
                "unread_count": 0,
            },
            {
                "id": "branch-a:966501234569",
                "branch_id": "branch-a",
                "phone": "966501234569",
                "last_message": "A2",
                "last_message_at": "2025-01-31T00:00:00+00:00",
                "unread_count": 0,
            },
        ],
        branches=[
            {"id": "branch-a", "name": "Branch A", "private": "not projected"},
            {"id": "branch-b", "name": "Branch B", "private": "not projected"},
        ],
    )
    monkeypatch.setattr(mod, "_db", db)

    async def no_campaigns(_db, _query):
        return []

    monkeypatch.setattr(mod.campaign_inbox, "conversations", no_campaigns)

    result = run(mod.list_cloud_inbox_conversations(
        current_user={"is_admin": True},
    ))

    rows = result["conversations"]
    assert [row["id"] for row in rows] == [
        "branch-a:966501234567",
        "branch-b:966501234568",
        "branch-a:966501234569",
    ]
    assert [row["branch_name"] for row in rows] == [
        "Branch A", "Branch B", "Branch A",
    ]
    assert rows[0]["required_field"] == "kept"

    branches = db["branches"]
    unique_branch_count = 2
    # The previous branch_cache loop issued one find_one per unique branch.
    # The replacement issues one minimal $in read for all of them.
    assert len(branches.find_one_queries) == 0
    assert len(branches.find_queries) == 1
    assert branches.find_queries[0] == {
        "id": {"$in": ["branch-a", "branch-b"]},
    } or branches.find_queries[0] == {
        "id": {"$in": ["branch-b", "branch-a"]},
    }
    assert len(branches.find_queries) == 1 < unique_branch_count
    assert branches.find_projections == [
        {"_id": 0, "id": 1, "name": 1},
    ]


def test_cloud_list_runs_cloud_and_campaign_reads_concurrently(monkeypatch):
    db = _Database(conversations=[])
    monkeypatch.setattr(mod, "_db", db)
    cloud_read_finished = asyncio.Event()
    campaign_read_started = asyncio.Event()

    class _CloudCursor(_Cursor):
        async def to_list(self, length=None):
            cloud_read_finished.set()
            await campaign_read_started.wait()
            return self.rows if length is None else self.rows[:length]

    def cloud_find(query, projection=None):
        db["whatsapp_cloud_conversations"].find_queries.append(copy.deepcopy(query))
        return _CloudCursor([])

    async def campaigns(_db, _query):
        campaign_read_started.set()
        await cloud_read_finished.wait()
        return []

    db["whatsapp_cloud_conversations"].find = cloud_find
    monkeypatch.setattr(mod.campaign_inbox, "conversations", campaigns)

    result = run(mod.list_cloud_inbox_conversations(
        current_user={"is_admin": True},
    ))

    assert result == {
        "conversations": [], "unread_count": 0, "needs_reply_count": 0,
    }


def test_cloud_search_uses_scoped_safe_message_history_and_skips_campaign_queue(monkeypatch):
    db = _Database(conversations=[
        {
            "id": "branch-a:history", "branch_id": "branch-a",
            "phone": "966500000001", "contact_name": "Ahmed",
            "last_message": "new preview", "unread_count": 0,
            "last_message_at": "2026-03-01T10:00:00+00:00",
            "needs_reply": False,
        },
        {
            "id": "branch-b:history", "branch_id": "branch-b",
            "phone": "966500000002", "contact_name": "Other",
            "last_message": "other", "unread_count": 4,
            "last_message_at": "2026-03-01T11:00:00+00:00",
            "needs_reply": True,
        },
    ], branches=[{"id": "branch-a", "name": "Branch A"}])
    db["whatsapp_cloud_messages"].rows.extend([
        {
            "conversation_id": "branch-a:history", "branch_id": "branch-a",
            "body": "old literal a.b message",
        },
        {
            "conversation_id": "branch-a:private", "branch_id": "branch-a",
            "body": "a.b", "view_once": True,
        },
        {
            "conversation_id": "branch-a:deleted", "branch_id": "branch-a",
            "body": "a.b", "archive_status": "deleted",
        },
        {
            "conversation_id": "branch-b:history", "branch_id": "branch-b",
            "body": "a.b",
        },
    ])
    monkeypatch.setattr(mod, "_db", db)

    async def campaigns_should_not_run(*_args):
        raise AssertionError("queued campaign projections are not searchable")

    monkeypatch.setattr(mod.campaign_inbox, "conversations", campaigns_should_not_run)
    result = run(mod.list_cloud_inbox_conversations(
        branch_filter="branch-a", search="a.b",
        current_user={"is_admin": True},
    ))

    assert [row["id"] for row in result["conversations"]] == [
        "branch-a:history",
    ]
    assert result["unread_count"] == 0
    assert result["needs_reply_count"] == 0
    distinct_key, message_query = db[
        "whatsapp_cloud_messages"
    ].distinct_queries[0]
    assert distinct_key == "conversation_id"
    assert message_query == {
        "body": {"$regex": r"a\.b", "$options": "i"},
        "view_once": {"$ne": True},
        "archive_status": {"$ne": "deleted"},
        "branch_id": "branch-a",
    }


def test_cloud_needs_reply_is_independent_of_unread_and_scoped(monkeypatch):
    db = _Database(conversations=[
        {
            "id": "branch-a:resolved", "branch_id": "branch-a",
            "phone": "966500000001", "unread_count": 8,
            "last_message_at": "2026-03-01T10:01:00+00:00",
            "last_inbound_at": "2026-03-01T10:00:00+00:00",
            "last_human_reply_at": "2026-03-01T10:01:00+00:00",
        },
        {
            "id": "branch-a:needs", "branch_id": "branch-a",
            "phone": "966500000002", "unread_count": 0,
            "last_message_at": "2026-03-01T11:00:00+00:00",
            "last_inbound_at": "2026-03-01T11:00:00+00:00",
        },
        {
            "id": "branch-b:needs", "branch_id": "branch-b",
            "phone": "966500000003", "unread_count": 0,
            "last_message_at": "2026-03-01T12:00:00+00:00",
            "last_inbound_at": "2026-03-01T12:00:00+00:00",
        },
    ], branches=[{"id": "branch-a", "name": "Branch A"}])
    monkeypatch.setattr(mod, "_db", db)

    async def no_campaigns(_db, _query):
        return []

    monkeypatch.setattr(mod.campaign_inbox, "conversations", no_campaigns)
    result = run(mod.list_cloud_inbox_conversations(
        branch_filter="branch-a", needs_reply_only=True,
        current_user={"is_admin": True},
    ))

    assert [row["id"] for row in result["conversations"]] == ["branch-a:needs"]
    assert result["conversations"][0]["needs_reply"] is True
    assert result["needs_reply_count"] == 1
    assert result["unread_count"] == 8
    # The needs count is branch-scoped rather than an unread count or a
    # tenant-wide total.
    assert db["whatsapp_cloud_conversations"].find_queries[0] == {
        "branch_id": "branch-a",
        "needs_reply": {"$exists": False},
    }


def test_cloud_needs_reply_legacy_messages_and_filter_precede_limit(monkeypatch):
    db = _Database(conversations=[
        {
            "id": "branch-a:legacy", "branch_id": "branch-a",
            "phone": "966500000001", "unread_count": 0,
            "last_message_at": "2025-01-01T00:00:00+00:00",
        },
        *[
            {
                "id": f"branch-a:resolved-{index}", "branch_id": "branch-a",
                "phone": f"96650000{index:04d}", "unread_count": 0,
                "last_message_at": f"2026-01-{(index % 28) + 1:02d}T00:00:00+00:00",
                "last_inbound_at": "2025-01-01T00:00:00+00:00",
                "last_human_reply_at": "2025-01-01T00:01:00+00:00",
            }
            for index in range(249)
        ],
    ], branches=[{"id": "branch-a", "name": "Branch A"}])
    db["whatsapp_cloud_messages"].rows.extend([
        {
            "id": "legacy-inbound", "conversation_id": "branch-a:legacy",
            "direction": "inbound", "created_at": "2025-01-01T00:00:00+00:00",
        },
        {
            "id": "legacy-human", "conversation_id": "branch-a:legacy",
            "direction": "outbound", "human_reply": True, "status": "sent",
            "created_at": "2025-01-01T00:01:00+00:00",
        },
        {
            "id": "legacy-new-inbound", "conversation_id": "branch-a:legacy",
            "direction": "inbound", "created_at": "2025-01-01T00:02:00+00:00",
        },
        {
            "id": "legacy-failed", "conversation_id": "branch-a:legacy",
            "direction": "outbound", "human_reply": True, "status": "failed",
            "created_at": "2025-01-01T00:03:00+00:00",
        },
    ])
    monkeypatch.setattr(mod, "_db", db)

    result = run(mod.list_cloud_inbox_conversations(
        branch_filter="branch-a", needs_reply_only=True,
        current_user={"is_admin": True},
    ))

    assert [row["id"] for row in result["conversations"]] == ["branch-a:legacy"]
    assert result["needs_reply_count"] == 1


def test_delayed_human_or_inbound_event_cannot_hide_newer_inbound(monkeypatch):
    db = _Database(conversations=[{
        "id": "branch-a:race", "branch_id": "branch-a",
        "last_inbound_at": "2026-03-01T10:02:00+00:00",
        "needs_reply": True,
    }])
    monkeypatch.setattr(mod, "_db", db)

    run(mod._note_cloud_human_reply(
        "branch-a:race", "branch-a", "2026-03-01T10:00:00+00:00", "old-reply"
    ))
    run(mod._note_cloud_inbound_needs_reply(
        "branch-a:race", "branch-a", "2026-03-01T09:00:00+00:00"
    ))

    conversation = db["whatsapp_cloud_conversations"].rows[0]
    assert conversation["last_inbound_at"] == "2026-03-01T10:02:00+00:00"
    assert conversation["needs_reply"] is True


def test_cloud_unread_filter_respects_selected_branch_before_limit_and_skips_campaign_projection(monkeypatch):
    db = _Database(conversations=[
        {
            "id": "branch-a:old-unread",
            "branch_id": "branch-a",
            "phone": "966500000001",
            "last_message_at": "2025-01-01T00:00:00+00:00",
            "unread_count": 2,
        },
        {
            "id": "branch-b:unread",
            "branch_id": "branch-b",
            "phone": "966500000002",
            "last_message_at": "2025-01-02T00:00:00+00:00",
            "unread_count": 3,
        },
        *[
            {
                "id": f"branch-a:read-{index}",
                "branch_id": "branch-a",
                "phone": f"96650000{index:04d}",
                "last_message_at": f"2026-01-{(index % 28) + 1:02d}T00:00:00+00:00",
                "unread_count": 0,
            }
            for index in range(250)
        ],
    ], branches=[
        {"id": "branch-a", "name": "Branch A"},
        {"id": "branch-b", "name": "Branch B"},
    ])
    monkeypatch.setattr(mod, "_db", db)

    async def campaigns_should_not_run(*_args):
        raise AssertionError("campaign projections must not enter unread view")

    monkeypatch.setattr(mod.campaign_inbox, "conversations", campaigns_should_not_run)

    result = run(mod.list_cloud_inbox_conversations(
        branch_filter="branch-a",
        unread_only=True,
        current_user={"is_admin": True},
    ))

    assert [row["id"] for row in result["conversations"]] == [
        "branch-a:old-unread",
    ]
    assert result["unread_count"] == 2
    assert db["whatsapp_cloud_conversations"].find_queries[0] == {
        "branch_id": "branch-a",
        "unread_count": {"$gt": 0},
    }


def test_cloud_unread_non_admin_respects_selected_authorized_branch(monkeypatch):
    db = _Database(
        conversations=[
            {
                "id": "branch-a:unread",
                "branch_id": "branch-a",
                "phone": "966500000001",
                "last_message_at": "2026-02-02T00:00:00+00:00",
                "unread_count": 1,
            },
            {
                "id": "branch-b:unread",
                "branch_id": "branch-b",
                "phone": "966500000002",
                "last_message_at": "2026-02-01T00:00:00+00:00",
                "unread_count": 3,
            },
            {
                "id": "branch-c:unread",
                "branch_id": "branch-c",
                "phone": "966500000003",
                "last_message_at": "2026-01-31T00:00:00+00:00",
                "unread_count": 7,
            },
        ],
        branches=[
            {"id": "branch-a", "name": "Branch A"},
            {"id": "branch-b", "name": "Branch B"},
        ],
    )
    monkeypatch.setattr(mod, "_db", db)

    result = run(mod.list_cloud_inbox_conversations(
        branch_filter="branch-a",
        unread_only=True,
        current_user={
            "is_admin": False,
            "permissions": ["messages"],
            "branch_id": "branch-a",
            "branch_ids": ["branch-a", "branch-b"],
            "_active_branch": "branch-a",
        },
    ))

    assert [row["id"] for row in result["conversations"]] == [
        "branch-a:unread",
    ]
    assert [row["branch_name"] for row in result["conversations"]] == [
        "Branch A",
    ]
    assert result["unread_count"] == 1
    assert db["whatsapp_cloud_conversations"].find_queries[0] == {
        "branch_id": "branch-a",
        "unread_count": {"$gt": 0},
    }


def test_cloud_unread_non_admin_can_select_another_authorized_branch(monkeypatch):
    db = _Database(conversations=[
        {
            "id": "branch-a:unread",
            "branch_id": "branch-a",
            "phone": "966500000001",
            "last_message_at": "2026-02-02T00:00:00+00:00",
            "unread_count": 1,
        },
        {
            "id": "branch-b:unread",
            "branch_id": "branch-b",
            "phone": "966500000002",
            "last_message_at": "2026-02-01T00:00:00+00:00",
            "unread_count": 3,
        },
    ], branches=[
        {"id": "branch-a", "name": "Branch A"},
        {"id": "branch-b", "name": "Branch B"},
    ])
    monkeypatch.setattr(mod, "_db", db)

    result = run(mod.list_cloud_inbox_conversations(
        branch_filter="branch-b",
        unread_only=True,
        current_user={
            "is_admin": False,
            "permissions": ["messages"],
            "branch_id": "branch-a",
            "branch_ids": ["branch-a", "branch-b"],
            "_active_branch": "branch-a",
        },
    ))

    assert [row["id"] for row in result["conversations"]] == [
        "branch-b:unread",
    ]
    assert result["unread_count"] == 3
    assert db["whatsapp_cloud_conversations"].find_queries[0] == {
        "branch_id": "branch-b",
        "unread_count": {"$gt": 0},
    }


def test_cloud_unread_requires_whatsapp_or_messages_permission(monkeypatch):
    db = _Database(conversations=[])
    monkeypatch.setattr(mod, "_db", db)

    with pytest.raises(HTTPException) as error:
        run(mod.list_cloud_inbox_conversations(
            branch_filter="branch-a",
            unread_only=True,
            current_user={
                "is_admin": False,
                "permissions": [],
                "branch_id": "branch-a",
            },
        ))

    assert error.value.status_code == 403


def test_cloud_unread_without_branch_assignment_fails_closed(monkeypatch):
    db = _Database(conversations=[])
    monkeypatch.setattr(mod, "_db", db)

    with pytest.raises(HTTPException) as error:
        run(mod.list_cloud_inbox_conversations(
            branch_filter="branch-a",
            unread_only=True,
            current_user={
                "is_admin": False,
                "permissions": ["messages"],
            },
        ))

    assert error.value.status_code == 403