"""Read-only closure list regression tests: query shape, not wall-clock guesses."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from routes import day_extensions as mod


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_):
        return self

    async def to_list(self, _):
        return [dict(row) for row in self.rows]

    def __aiter__(self):
        async def iterate():
            for row in self.rows:
                yield dict(row)
        return iterate()


class Collection:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def find(self, query, projection):
        self.calls.append((query, projection))
        return Cursor(self.rows)

    async def find_one(self, *_):
        return {"is_admin": True}


def database():
    return SimpleNamespace(
        closures=Collection([
            {"id": str(i), "branch_id": "a", "affected_members": [
                {"member_id": "member-a", "phone": "0500000000"},
                {"member_id": "member-b"}, {"member_id": "deleted"},
            ]} for i in range(20)
        ]),
        members=Collection([
            {"id": "member-a", "branch_id": "a"},
            {"id": "member-b", "branch_id": "b"},
        ]),
        branches=Collection([{"id": "a", "name": "A"}]),
        users=Collection([]),
    )


def test_initial_list_skips_summary_and_batches_member_branch_lookup(monkeypatch):
    db = database()
    summarize = AsyncMock()
    monkeypatch.setattr(mod, "db", db)
    monkeypatch.setattr(mod, "summaries", summarize)
    rows = asyncio.run(mod.get_closures({"is_admin": True}, include_notice_summary=False))
    summarize.assert_not_awaited()
    assert len(db.members.calls) == 1
    assert db.members.calls[0][1] == {"id": 1, "branch_id": 1, "_id": 0}
    assert all(row["applied_count"] == 1 for row in rows)
    assert all(row["notice_summary"]["state"] == "loading" for row in rows)


def test_summary_poll_projects_only_scope_and_never_reads_members(monkeypatch):
    db = database()
    monkeypatch.setattr(mod, "db", db)
    monkeypatch.setattr(mod, "summaries", AsyncMock(return_value={
        str(i): {"state": "not_queued", "jobs": []} for i in range(20)
    }))
    rows = asyncio.run(mod.get_closures({"is_admin": True}, summary_only=True))
    assert db.closures.calls[0][1] == {"_id": 0, "id": 1, "branch_id": 1}
    assert not db.members.calls
    assert len(rows) == 20


def test_restricted_summary_passes_authorized_branches(monkeypatch):
    db = database()
    summarize = AsyncMock(return_value={
        str(i): {"state": "not_queued", "jobs": []} for i in range(20)
    })
    monkeypatch.setattr(mod, "db", db)
    monkeypatch.setattr(mod, "summaries", summarize)
    monkeypatch.setattr(mod, "get_allowed_branch_ids", lambda _: ["a"])
    asyncio.run(mod.get_closures({"is_admin": False}, summary_only=True))
    assert summarize.await_args.args[2] == ["a"]
    assert db.branches.calls[0][0] == {"id": {"$in": ["a"]}}


def test_member_picker_is_projected_scoped_and_phone_masked(monkeypatch):
    from routes import members as member_routes
    db = SimpleNamespace(members=Collection([{
        "id": "m", "phone": "0500000000", "branch_id": "a",
    }]))
    monkeypatch.setattr(member_routes, "db", db)
    monkeypatch.setattr(member_routes, "resolve_branch_filter", lambda *_: "a")
    monkeypatch.setattr(member_routes, "_can_view_member_phones", AsyncMock(return_value=False))
    rows = asyncio.run(member_routes.get_members(picker_only=True, current_user={}))
    assert db.members.calls[0][0] == {"branch_id": "a"}
    assert db.members.calls[0][1] == {
        "_id": 0, "id": 1, "name": 1, "name_ar": 1,
        "phone": 1, "status": 1, "branch_id": 1,
    }
    assert rows[0]["phone"] == "050•••••00"
    assert rows[0]["status"] == "active"