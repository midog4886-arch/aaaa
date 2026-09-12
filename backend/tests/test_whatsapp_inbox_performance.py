import asyncio
import copy

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
        if isinstance(value, dict) and "$gt" in value:
            if not (row.get(key) is not None and row.get(key) > value["$gt"]):
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

    async def find_one(self, query, projection=None):
        self.find_one_queries.append(copy.deepcopy(query))
        for row in self.rows:
            if _matches(row, query):
                return copy.deepcopy(row)
        return None

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

    assert result == {"conversations": [], "unread_count": 0}


def test_cloud_unread_filter_runs_before_limit_and_skips_campaign_projection(monkeypatch):
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
        "branch-b:unread",
        "branch-a:old-unread",
    ]
    assert result["unread_count"] == 5
    assert db["whatsapp_cloud_conversations"].find_queries[0] == {
        "unread_count": {"$gt": 0},
    }


def test_cloud_unread_non_admin_uses_all_authorized_branches(monkeypatch):
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
        "branch-b:unread",
    ]
    assert [row["branch_name"] for row in result["conversations"]] == [
        "Branch A",
        "Branch B",
    ]
    assert result["unread_count"] == 4
    assert db["whatsapp_cloud_conversations"].find_queries[0] == {
        "branch_id": {"$in": ["branch-a", "branch-b"]},
        "unread_count": {"$gt": 0},
    }