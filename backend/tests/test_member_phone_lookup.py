import asyncio
import copy
import re
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routes import members as mod


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
        self.limit_value = None

    def limit(self, value):
        self.limit_value = value
        return self

    async def to_list(self, length=None):
        limit = self.limit_value if self.limit_value is not None else length
        return self.rows[:limit] if limit else self.rows


class _Collection:
    def __init__(self, rows=()):
        self.rows = [copy.deepcopy(row) for row in rows]

    async def find_one(self, query, projection=None):
        rows = self._project(
            [row for row in self.rows if _matches(row, query)],
            projection,
        )
        return rows[0] if rows else None

    def find(self, query, projection=None):
        return _Cursor(self._project(
            [row for row in self.rows if _matches(row, query)],
            projection,
        ))

    @staticmethod
    def _project(rows, projection):
        if not projection:
            return [copy.deepcopy(row) for row in rows]
        included = {key for key, enabled in projection.items() if enabled and key != "_id"}
        return [
            {key: copy.deepcopy(row[key]) for key in included if key in row}
            for row in rows
        ]


def _database(*, permissions=None):
    return SimpleNamespace(
        users=_Collection([{
            "id": "staff-1",
            "permissions": permissions or [],
        }]),
        members=_Collection([
            {
                "id": "saudi-a",
                "name": "Saudi A",
                "name_ar": "السعودي أ",
                "phone": "0501234567",
                "branch_id": "branch-a",
                "email": "not-returned@example.com",
            },
            {
                "id": "saudi-b",
                "name": "Saudi B",
                "name_ar": "السعودي ب",
                "phone": "+966 50 123 4567",
                "branch_id": "branch-b",
            },
            {
                "id": "egypt-a",
                "name": "Egypt A",
                "name_ar": "المصري أ",
                "phone": "01012345678",
                "branch_id": "branch-a",
            },
        ]),
        branches=_Collection([
            {"id": "branch-a", "name": "Branch A", "name_ar": "الفرع أ"},
            {"id": "branch-b", "name": "Branch B", "name_ar": "الفرع ب"},
        ]),
    )


def _lookup(phone, user):
    return asyncio.run(mod.lookup_members_by_phone(phone, user))


def test_admin_lookup_crosses_selected_branch_and_uses_shared_phone_chooser(monkeypatch):
    monkeypatch.setattr(mod, "db", _database())

    result = _lookup("+966 50 123 4567", {
        "is_admin": True,
        "branch_id": "branch-a",
        "_active_branch": "branch-a",
    })

    assert {member["id"] for member in result["members"]} == {"saudi-a", "saudi-b"}
    assert {member["branch_name"] for member in result["members"]} == {
        "Branch A", "Branch B",
    }
    # Lookup responses stay minimal and never expose the full member document.
    assert all(set(member) == {
        "id", "name", "name_ar", "branch_id", "branch_name", "branch_name_ar",
    } for member in result["members"])


def test_lookup_normalizes_egyptian_local_and_international_forms(monkeypatch):
    monkeypatch.setattr(mod, "db", _database())

    local = _lookup("01012345678", {"is_admin": True})
    international = _lookup("0020 10 1234 5678", {"is_admin": True})

    assert [member["id"] for member in local["members"]] == ["egypt-a"]
    assert [member["id"] for member in international["members"]] == ["egypt-a"]


def test_non_admin_lookup_is_permission_and_branch_scoped(monkeypatch):
    monkeypatch.setattr(mod, "db", _database(permissions=["member-phones"]))

    result = _lookup("0501234567", {
        "is_admin": False,
        "user_id": "staff-1",
        "branch_id": "branch-a",
    })

    assert [member["id"] for member in result["members"]] == ["saudi-a"]


def test_non_admin_without_member_phone_permission_is_rejected(monkeypatch):
    monkeypatch.setattr(mod, "db", _database())

    with pytest.raises(HTTPException) as exc:
        _lookup("0501234567", {
            "is_admin": False,
            "user_id": "staff-1",
            "branch_id": "branch-a",
        })

    assert exc.value.status_code == 403


def test_lookup_returns_no_match_without_navigating_or_exposing_rows(monkeypatch):
    monkeypatch.setattr(mod, "db", _database())

    assert _lookup("0559999999", {"is_admin": True}) == {"members": []}