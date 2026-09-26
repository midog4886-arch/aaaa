import asyncio
import copy
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from routes import levels


class Collection:
    def __init__(self, rows):
        self.rows = copy.deepcopy(rows)
        self.fail = False

    async def find_one(self, query, projection=None, **kw):
        assert kw.get("session")
        return copy.deepcopy(next((r for r in self.rows if all(r.get(k) == v for k, v in query.items())), None))

    async def update_one(self, query, changes, **kw):
        assert kw.get("session")
        if self.fail and "$addToSet" in changes:
            raise RuntimeError("destination failed")
        for row in self.rows:
            if all(row.get(k) == v for k, v in query.items()):
                row.update(copy.deepcopy(changes.get("$set", {})))
                for k, value in changes.get("$pull", {}).items():
                    row[k] = [v for v in row.get(k, []) if v != value]
                for k, value in changes.get("$addToSet", {}).items():
                    if value not in row.setdefault(k, []):
                        row[k].append(value)
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def insert_one(self, row, **kw):
        assert kw.get("session")
        self.rows.append(copy.deepcopy(row))


class Context:
    def __init__(self, db, transaction=False):
        self.db, self.transaction = db, transaction

    async def __aenter__(self):
        self.backup = {k: copy.deepcopy(v.rows) for k, v in vars(self.db).items() if isinstance(v, Collection)}
        return self

    async def __aexit__(self, typ, *_):
        if typ and self.transaction:
            for k, rows in self.backup.items():
                getattr(self.db, k).rows = rows

    def start_transaction(self):
        return Context(self.db, True)


class DB:
    @property
    def client(self):
        return self

    async def start_session(self):
        return Context(self)


@pytest.fixture
def state(monkeypatch):
    db = DB()
    db.members = Collection([
        {"id": "m", "name": "Mohamed", "branch_id": "b", "photo": "photo",
         "activities": [{"activity_id": "swim", "level_id": "one", "schedule": "monday 4:00",
                         "start_date": "2026-09-01", "end_date": "2026-10-07", "source_id": "invoice",
                         "day_times": {"monday": "4:00"}, "custom_metadata": 123}]},
        {"id": "other-m", "name": "Mohamed", "branch_id": "b", "activities": []},
    ])
    db.levels = Collection([
        {"id": "one", "branch_id": "b", "activity_name": "سباحة الساعة 4", "members": ["m", "other-m"]},
        {"id": "two", "branch_id": "b", "activity_name": "سباحة الساعة 4", "members": []},
    ])
    db.audit_logs = Collection([])
    monkeypatch.setattr(levels, "db", db)
    monkeypatch.setattr(levels, "cache_invalidate", Mock())
    return db


def move():
    return asyncio.run(levels.transfer_level_member("two", "m",
        levels.LevelTransfer(source_level_id="one", activity_id="swim"),
        {"is_admin": True, "user_id": "admin"}))


def test_move_preserves_all_subscription_data_and_duplicate_names(state):
    original = copy.deepcopy(state.members.rows)
    move()
    expected = copy.deepcopy(original)
    expected[0]["activities"][0]["level_id"] = "two"
    assert state.members.rows == expected
    assert state.levels.rows[0]["members"] == ["other-m"]
    assert state.levels.rows[1]["members"] == ["m"]
    assert levels.member_belongs_to_level(expected[0]["activities"], "two")
    assert not levels.member_belongs_to_level(expected[0]["activities"], "one")
    levels.cache_invalidate.assert_called_with("levels:")
    assert len(state.audit_logs.rows) == 1


def test_destination_failure_rolls_back_member_source_and_audit(state):
    original = copy.deepcopy(state.members.rows)
    state.levels.fail = True
    with pytest.raises(RuntimeError):
        move()
    assert state.members.rows == original
    assert state.levels.rows[0]["members"] == ["m", "other-m"]
    assert state.levels.rows[1]["members"] == []
    assert state.audit_logs.rows == []


@pytest.mark.parametrize("failure", ["foreign", "duplicate", "stale", "missing"])
def test_invalid_transfer_never_detaches(state, failure):
    if failure == "foreign":
        state.levels.rows[1]["branch_id"] = "other"
    elif failure == "duplicate":
        state.members.rows[0]["activities"] *= 2
    elif failure == "stale":
        state.members.rows[0]["activities"][0]["level_id"] = "elsewhere"
    else:
        state.levels.rows.pop()
    original = copy.deepcopy(state.members.rows)
    with pytest.raises(HTTPException):
        move()
    assert state.members.rows == original
    assert state.levels.rows[0]["members"] == ["m", "other-m"]


def test_repeated_request_cannot_duplicate_or_reverse_move(state):
    move()
    with pytest.raises(HTTPException) as exc:
        move()
    assert exc.value.status_code == 409
    assert state.levels.rows[1]["members"] == ["m"]
    assert len(state.audit_logs.rows) == 1


def test_nonadmin_cannot_move_another_branch_member(state):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(levels.transfer_level_member("two", "m",
            levels.LevelTransfer(source_level_id="one", activity_id="swim"),
            {"is_admin": False, "branch_id": "foreign"}))
    assert exc.value.status_code == 403
    assert state.levels.rows[0]["members"] == ["m", "other-m"]


def test_other_subscription_in_source_is_not_removed(state):
    state.members.rows[0]["activities"].append({"activity_id": "second", "level_id": "one"})
    move()
    assert state.levels.rows[0]["members"] == ["m", "other-m"]
    assert state.members.rows[0]["activities"][1]["level_id"] == "one"