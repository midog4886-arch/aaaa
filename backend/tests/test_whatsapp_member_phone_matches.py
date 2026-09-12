import asyncio
import copy
import re

from routes import whatsapp as mod


def run(coro):
    return asyncio.run(coro)


def _matches(row, query):
    for key, value in query.items():
        if key == "$or":
            if not any(_matches(row, branch) for branch in value):
                return False
            continue
        if isinstance(value, dict):
            if "$in" in value and row.get(key) not in value["$in"]:
                return False
            if "$regex" in value and not re.search(
                value["$regex"], str(row.get(key) or "")
            ):
                return False
            continue
        if row.get(key) != value:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return self.rows if length is None else self.rows[:length]


class _Collection:
    def __init__(self, rows=()):
        self.rows = [copy.deepcopy(row) for row in rows]
        self.queries = []

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if _matches(row, query):
                return copy.deepcopy(row)
        return None

    def find(self, query, projection=None):
        self.queries.append(copy.deepcopy(query))
        rows = [row for row in self.rows if _matches(row, query)]
        if projection:
            included = {
                key for key, enabled in projection.items()
                if enabled and key != "_id"
            }
            rows = [
                {key: copy.deepcopy(row[key]) for key in included if key in row}
                for row in rows
            ]
        return _Cursor(rows)


class _Database:
    def __init__(self, *, member_rows, user_rows=()):
        self.members = _Collection(member_rows)
        self.users = _Collection(user_rows)

    def __getitem__(self, name):
        return getattr(self, name)


def test_admin_match_ignores_active_branch_and_returns_only_boolean(monkeypatch):
    db = _Database(member_rows=[{
        "id": "member-other-branch",
        "phone": "+966 50 123 4567",
        "branch_id": "branch-b",
        "name": "must not be returned",
        "photo": "must not be scanned",
    }])
    monkeypatch.setattr(mod, "_db", db)
    rows = [{
        "id": "branch-a:966501234567",
        "phone": "966501234567",
        "branch_id": "branch-a",
        "member_phone_match": "stale",
    }]

    enriched = run(mod._enrich_member_phone_matches(
        rows,
        {"is_admin": True, "branch_id": "branch-a"},
        member_branch="branch-a",
    ))

    assert enriched[0]["member_phone_match"] is True
    assert set(enriched[0]) == {
        "id", "phone", "branch_id", "member_phone_match",
    }
    assert "branch_id" not in db.members.queries[0]
    assert set(db.members.queries[0]) == {"$or"}


def test_non_admin_match_is_limited_to_authorized_branch(monkeypatch):
    db = _Database(
        member_rows=[
            {"phone": "0501234567", "branch_id": "branch-a"},
            {"phone": "0501234567", "branch_id": "branch-b"},
        ],
        user_rows=[{"id": "staff-1", "permissions": ["member-phones"]}],
    )
    monkeypatch.setattr(mod, "_db", db)
    rows = [
        {"id": "branch-a:966501234567", "phone": "966501234567", "branch_id": "branch-a"},
        {"id": "branch-b:966501234567", "phone": "966501234567", "branch_id": "branch-b"},
    ]

    enriched = run(mod._enrich_member_phone_matches(
        rows,
        {"is_admin": False, "user_id": "staff-1", "branch_id": "branch-a"},
        member_branch="branch-a",
    ))

    assert [row["member_phone_match"] for row in enriched] == [True, False]
    assert db.members.queries[0]["branch_id"] == "branch-a"


def test_unauthorized_user_receives_no_match_flag_or_member_query(monkeypatch):
    db = _Database(
        member_rows=[{"phone": "0501234567", "branch_id": "branch-a"}],
        user_rows=[{"id": "staff-1", "permissions": []}],
    )
    monkeypatch.setattr(mod, "_db", db)
    rows = [{
        "id": "branch-a:966501234567",
        "phone": "966501234567",
        "branch_id": "branch-a",
        "member_phone_match": True,
    }]

    enriched = run(mod._enrich_member_phone_matches(
        rows,
        {"is_admin": False, "user_id": "staff-1", "branch_id": "branch-a"},
        member_branch="branch-a",
    ))

    assert "member_phone_match" not in enriched[0]
    assert db.members.queries == []