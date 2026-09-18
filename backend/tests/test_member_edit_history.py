"""Contract and authorization coverage for the member edit-history endpoint."""
import asyncio
import os
import re
import sys
from copy import deepcopy

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database import TenantDBProxy  # noqa: E402
from routes import members  # noqa: E402
from utils import audit  # noqa: E402
from utils import tenant as tenant_context  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def _matches(row, query):
    for field, expected in query.items():
        value = row.get(field)
        if isinstance(expected, dict) and "$regex" in expected:
            if not re.search(expected["$regex"], str(value)):
                return False
        elif value != expected:
            return False
    return True


class _Cursor:
    def __init__(self, docs, collection):
        self.docs = docs
        self.collection = collection

    def sort(self, field, direction):
        self.collection.sort_args = (field, direction)
        self.docs.sort(key=lambda row: row.get(field, ""), reverse=direction < 0)
        return self

    def limit(self, count):
        self.collection.limit_arg = count
        self.docs = self.docs[:count]
        return self

    async def to_list(self, count):
        self.collection.to_list_arg = count
        return deepcopy(self.docs[:count])


class _Collection:
    def __init__(self, docs=()):
        self.docs = list(docs)
        self.find_calls = []
        self.find_one_calls = []
        self.sort_args = None
        self.limit_arg = None
        self.to_list_arg = None

    async def find_one(self, query, projection=None):
        self.find_one_calls.append((deepcopy(query), deepcopy(projection)))
        row = next((item for item in self.docs if _matches(item, query)), None)
        if row is None:
            return None
        return _project(row, projection)

    def find(self, query, projection=None):
        self.find_calls.append((deepcopy(query), deepcopy(projection)))
        rows = [_project(row, projection) for row in self.docs if _matches(row, query)]
        return _Cursor(rows, self)


def _project(row, projection):
    result = deepcopy(row)
    for field, included in (projection or {}).items():
        if included == 0:
            result.pop(field, None)
    return result


class _DB:
    def __init__(self, members_docs=(), audit_docs=()):
        self.members = _Collection(members_docs)
        self.audit_logs = _Collection(audit_docs)


class _Client:
    def __init__(self, databases):
        self.databases = databases
        self.opened = []

    def __getitem__(self, name):
        self.opened.append(name)
        return self.databases[name]


@pytest.mark.parametrize(
    "user",
    [
        {"user_id": "staff-members", "is_admin": False, "permissions": ["members"]},
        {"user_id": "staff-phones", "is_admin": False, "permissions": ["member-phones"]},
        {
            "user_id": "staff-both",
            "is_admin": False,
            "permissions": ["members", "member-phones"],
        },
    ],
)
def test_non_admin_permissions_are_rejected_before_any_database_access(monkeypatch, user):
    class _NoDatabaseAccess:
        def __getattr__(self, name):
            raise AssertionError(f"authorization must precede database access: {name}")

    monkeypatch.setattr(members, "db", _NoDatabaseAccess())

    with pytest.raises(HTTPException) as exc:
        run(members.get_member_subscription_audit("member-1", current_user=user))

    assert exc.value.status_code == 403


def test_admin_receives_exact_allowed_history_from_current_tenant(monkeypatch):
    expected = [
        {
            "id": "profile",
            "member_id": "member-1",
            "action": "member.update",
            "diff": {"marked": {"before": False, "after": True}},
            "actor_id": "admin-2",
            "actor_username": "second-admin",
            "actor_is_admin": True,
            "created_at": "2025-04-04T12:00:00+00:00",
        },
        {
            "id": "transfer",
            "member_id": "member-1",
            "action": "member.transfer",
            "diff": {"branch_id": {"before": "north", "after": "south"}},
            "actor_id": "admin-1",
            "actor_username": "first-admin",
            "actor_is_admin": True,
            "created_at": "2025-04-03T12:00:00+00:00",
        },
        {
            "id": "subscription",
            "member_id": "member-1",
            "action": "subscription.update",
            "entity_id": "member-1:swimming",
            "diff": {
                "fee": {"before": 0, "after": 125},
                "status": {"before": False, "after": True},
            },
            "actor_id": "admin-1",
            "actor_username": "first-admin",
            "actor_is_admin": True,
            "created_at": "2025-04-02T12:00:00+00:00",
        },
    ]
    alpha_logs = [
        dict(row, _id=f"mongo-{index}") for index, row in enumerate(reversed(expected))
    ]
    alpha_logs.extend(
        [
            {
                "_id": "wrong-member",
                "id": "wrong-member",
                "member_id": "member-2",
                "action": "member.update",
                "created_at": "2026-01-01T00:00:00+00:00",
            },
            {
                "_id": "wrong-action",
                "id": "login",
                "member_id": "member-1",
                "action": "auth.login.success",
                "created_at": "2026-01-02T00:00:00+00:00",
            },
            {
                "_id": "legacy-link-only",
                "id": "legacy",
                "entity_id": "member-1:swimming",
                "action": "subscription.update",
                "created_at": "2026-01-03T00:00:00+00:00",
            },
        ]
    )
    alpha = _DB([{"id": "member-1", "branch_id": "north"}], alpha_logs)
    beta = _DB(
        [{"id": "member-1", "branch_id": "elsewhere"}],
        [{
            "id": "tenant-leak",
            "member_id": "member-1",
            "action": "member.update",
            "created_at": "2027-01-01T00:00:00+00:00",
        }],
    )
    client = _Client({"champions_alpha": alpha, "champions_beta": beta})
    monkeypatch.setattr(members, "db", TenantDBProxy(client))
    token = tenant_context.set_current_tenant(
        {"slug": "alpha", "db_name": "champions_alpha", "status": "active"}
    )
    try:
        result = run(
            members.get_member_subscription_audit(
                "member-1",
                current_user={"user_id": "admin-1", "is_admin": True},
            )
        )
    finally:
        tenant_context.reset_current_tenant(token)

    assert result == expected
    assert set(client.opened) == {"champions_alpha"}
    assert alpha.members.find_one_calls == [
        ({"id": "member-1"}, {"_id": 0, "id": 1})
    ]
    assert alpha.audit_logs.find_calls == [
        (
            {
                "member_id": "member-1",
                "action": {
                    "$regex": (
                        "^(subscription\\.|member\\.update|member\\.transfer|"
                        "day_extension\\.)"
                    )
                },
            },
            {"_id": 0},
        )
    ]
    assert alpha.audit_logs.sort_args == ("created_at", -1)
    assert alpha.audit_logs.limit_arg == 200
    assert alpha.audit_logs.to_list_arg == 200
    assert all("_id" not in row for row in result)


def test_nonexistent_member_returns_404_without_audit_lookup(monkeypatch):
    database = _DB([], [{
        "member_id": "missing",
        "action": "member.update",
        "created_at": "2025-01-01T00:00:00+00:00",
    }])
    monkeypatch.setattr(members, "db", database)

    with pytest.raises(HTTPException) as exc:
        run(
            members.get_member_subscription_audit(
                "missing", current_user={"user_id": "admin", "is_admin": True}
            )
        )

    assert exc.value.status_code == 404
    assert database.audit_logs.find_calls == []


def test_history_is_capped_at_200_newest_normalized_member_rows(monkeypatch):
    rows = [
        {
            "_id": f"mongo-{index}",
            "id": f"audit-{index:03}",
            "member_id": "member-1",
            "entity_id": f"member-1:activity-{index}",
            "action": "subscription.update",
            "created_at": f"2025-01-01T00:{index:03}:00+00:00",
        }
        for index in range(205)
    ]
    database = _DB([{"id": "member-1"}], rows)
    monkeypatch.setattr(members, "db", database)

    result = run(
        members.get_member_subscription_audit(
            "member-1", current_user={"user_id": "admin", "is_admin": True}
        )
    )

    assert len(result) == 200
    assert result[0]["id"] == "audit-204"
    assert result[-1]["id"] == "audit-005"
    assert all(row["member_id"] == "member-1" and "_id" not in row for row in result)


def test_audit_diff_preserves_false_and_zero_and_redacts_secrets():
    result = audit._diff(
        {
            "fee": 0,
            "enabled": False,
            "password": "old-password",
            "settings": {"token": "old-token", "visible": 0},
        },
        {
            "fee": 10,
            "enabled": True,
            "password": "new-password",
            "settings": {"token": "new-token", "visible": False},
        },
    )

    assert result["fee"] == {"before": 0, "after": 10}
    assert result["enabled"] == {"before": False, "after": True}
    assert "password" not in result
    assert result["settings"] == {
        "before": {"token": "***", "visible": 0},
        "after": {"token": "***", "visible": False},
    }