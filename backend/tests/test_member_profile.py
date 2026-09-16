"""Fake-DB coverage for the read-only unified member-profile endpoints."""
import asyncio
import os
import sys
from copy import deepcopy
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from routes import member_profile as profile  # noqa: E402


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _values(row, field):
    values = [row]
    for part in field.split("."):
        next_values = []
        for value in values:
            if isinstance(value, list):
                for child in value:
                    if isinstance(child, dict) and part in child:
                        next_values.append(child[part])
            elif isinstance(value, dict) and part in value:
                next_values.append(value[part])
        values = next_values
    return values


def _matches(row, query):
    for field, expected in (query or {}).items():
        if field == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        if field == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        values = _values(row, field)
        if isinstance(expected, dict):
            if "$exists" in expected and bool(values) != bool(expected["$exists"]):
                return False
            if "$ne" in expected and any(value == expected["$ne"] for value in values):
                return False
            if "$regex" in expected:
                import re
                if not any(re.search(expected["$regex"], str(value)) for value in values):
                    return False
            if "$in" in expected and not any(value in expected["$in"] for value in values):
                return False
            continue
        if expected not in values:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, spec, direction=None):
        specs = spec if isinstance(spec, list) else [(spec, direction if direction is not None else 1)]
        for field, order in reversed(specs):
            self.docs.sort(key=lambda row: str((_values(row, field) or [""])[0]), reverse=order < 0)
        return self

    def skip(self, value):
        self.docs = self.docs[value:]
        return self

    def limit(self, value):
        self.docs = self.docs[:value]
        return self

    async def to_list(self, length=None):
        docs = self.docs if length is None else self.docs[:length]
        return deepcopy(docs)


class _Collection:
    def __init__(self, docs=()):
        self.docs = list(docs)

    def find(self, query, projection=None):
        return _Cursor([row for row in self.docs if _matches(row, query)])

    async def find_one(self, query, projection=None):
        row = next((row for row in self.docs if _matches(row, query)), None)
        return deepcopy(row) if row else None

    async def count_documents(self, query):
        return sum(_matches(row, query) for row in self.docs)

    def aggregate(self, pipeline):
        docs = deepcopy(self.docs)
        for stage in pipeline:
            if "$match" in stage:
                match = stage["$match"]
                if "owned_items.0" in match:
                    docs = [row for row in docs if row.get("owned_items")]
                else:
                    docs = [row for row in docs if _matches(row, match)]
            elif "$addFields" in stage:
                for row in docs:
                    expression = stage["$addFields"].get("_profile_sort_at", {})
                    source = expression.get("$convert", {}).get("input")
                    if isinstance(source, dict):
                        choices = source.get("$ifNull", [])
                        value = next((
                            (_values(row, choice[1:]) or [None])[0]
                            for choice in choices
                            if isinstance(choice, str) and choice.startswith("$")
                            and (_values(row, choice[1:]) or [None])[0] is not None
                        ), None)
                    else:
                        value = (_values(row, str(source)[1:]) or [None])[0]
                    if isinstance(value, datetime):
                        row["_profile_sort_at"] = value.replace(tzinfo=value.tzinfo or timezone.utc)
                    else:
                        try:
                            row["_profile_sort_at"] = datetime.fromisoformat(
                                str(value).replace("Z", "+00:00")
                            ).replace(tzinfo=timezone.utc)
                        except (TypeError, ValueError):
                            row["_profile_sort_at"] = datetime(1970, 1, 1, tzinfo=timezone.utc)
            elif "$sort" in stage:
                for field, order in reversed(list(stage["$sort"].items())):
                    docs.sort(key=lambda row: (_values(row, field) or [""])[0], reverse=order < 0)
            elif "$skip" in stage:
                docs = docs[stage["$skip"]:]
            elif "$limit" in stage:
                docs = docs[:stage["$limit"]]
            elif "$project" in stage and "owned_items" in stage["$project"]:
                # The production pipeline's filter is intentionally duplicated
                # here so the test exercises a top-level sibling / child target.
                cond = stage["$project"]["owned_items"]["$filter"]["cond"]
                target = cond["$or"][0]["$eq"][1]
                docs = [{
                    "owned_items": [
                        item for item in row.get("items", [])
                        if item.get("member_id") == target
                        or (not item.get("member_id") and row.get("member_id") == target)
                    ]
                } for row in docs]
            elif "$count" in stage:
                docs = [{stage["$count"]: len(docs)}]
        return _Cursor(docs)

    async def update_one(self, *args, **kwargs):  # reads must never get here
        raise AssertionError("profile read endpoint attempted a write")

    async def update_many(self, *args, **kwargs):
        raise AssertionError("profile read endpoint attempted a write")


class _DB:
    def __init__(self, collections):
        self.collections = {name: _Collection(rows) for name, rows in collections.items()}

    def __getattr__(self, name):
        return self.collections.setdefault(name, _Collection())


@pytest.fixture()
def fake_db(monkeypatch):
    database = _DB({
        "users": [{
            "id": "staff",
            "permissions": ["members", "messages", "attendance-view", "invoices-view"],
        }],
        "members": [
            {"id": "m1", "branch_id": "a", "created_at": "2025-01-01T00:00:00Z"},
            {"id": "m2", "branch_id": "b", "created_at": "2025-01-01T00:00:00Z"},
        ],
        "attendance": [
            {"id": "old", "member_id": "m1", "activity_name": "كرة", "status": "present", "created_at": "2025-01-02T00:00:00Z"},
            {"id": "new", "member_id": "m1", "activity_name": "سباحة", "status": "present", "created_at": "2025-01-05T00:00:00Z"},
        ],
        "invoices": [{
            "id": "family", "member_id": "m1", "invoice_number": "I-1",
            "created_at": "2025-01-03T00:00:00Z",
            "items": [
                {"member_id": "sibling", "activity_name": "Sibling only"},
                {"member_id": "m1", "activity_name": "Target only"},
            ],
        }],
        "member_freezes": [],
        "audit_logs": [{
            "id": "audit-1", "member_id": "m1", "action": "subscription.add",
            "entity_id": "m1:swim", "entity_name": "سباحة",
            "actor_username": "admin", "created_at": "2025-01-04T00:00:00Z",
            "diff": {"phone": {"before": "0500000000", "after": "0599999999"}},
        }],
        "messages": [{
            "id": "request", "recipient_member_id": "m1", "sender_type": "member",
            "subject": "طلب تعديل رقم الجوال 0500000000", "body": "الرقم الجديد 0599999999",
            "created_at": "2025-01-06T00:00:00Z", "kind": "profile_change_request",
            "change_request": {
                "field": "phone", "current_value": "0500000000",
                "new_value": "0599999999", "reason": "تصحيح",
            },
        }],
    })
    monkeypatch.setattr(profile, "db", database)

    async def required(user, permission):
        if permission not in database.users.docs[0]["permissions"] and not user.get("is_admin"):
            raise HTTPException(status_code=403, detail="missing permission")

    monkeypatch.setattr(profile, "require_permission", required)
    return database


def _staff(branch="a", admin=False):
    return {"user_id": "staff", "branch_id": branch, "is_admin": admin}


def test_profile_routes_are_mounted_shapes():
    paths = {route.path for route in profile.router.routes}
    assert "/members/{member_id}/profile-history" in paths
    assert "/members/{member_id}/profile-messages" in paths
    assert "/members/{member_id}/profile-summary" in paths


def test_profile_history_branch_scope_limited_permissions_and_paging(fake_db):
    with pytest.raises(HTTPException) as exc:
        run(profile.get_member_profile_history("m2", offset=0, limit=20, current_user=_staff()))
    assert exc.value.status_code == 404

    fake_db.users.docs[0]["permissions"] = ["members"]
    limited = run(profile.get_member_profile_history("m1", offset=0, limit=20, current_user=_staff()))
    assert {item["type"] for item in limited["items"]} == {"member_created"}

    fake_db.users.docs[0]["permissions"] = ["members", "attendance-view", "invoices-view"]
    page = run(profile.get_member_profile_history("m1", offset=1, limit=1, current_user=_staff()))
    # Newest event is attendance:new; offset lands on the invoice/audit-era
    # timeline rather than a source-local second page.
    assert page["items"][0]["id"] == "invoice:family"


def test_profile_history_hides_sibling_invoice_data_and_audit_diff(fake_db):
    result = run(profile.get_member_profile_history("m1", offset=0, limit=20, current_user=_staff(admin=True)))
    invoice = next(item for item in result["items"] if item["type"] == "invoice")
    assert "Target only" in invoice["detail_en"]
    assert "Sibling only" not in invoice["detail_en"]
    audit = next(item for item in result["items"] if item["type"] == "subscription_audit")
    assert "phone" not in audit
    assert "diff" not in audit
    assert audit["target_tab"] == "activities"


def test_profile_history_normalizes_mixed_timestamps_and_attendance_date_fallback(fake_db):
    fake_db.invoices.docs[0]["created_at"] = datetime(2025, 1, 8, tzinfo=timezone.utc)
    fake_db.attendance.docs.append({
        "id": "fallback-date", "member_id": "m1", "activity_name": "جودو",
        "status": "present", "date": "2025-01-07",
    })
    result = run(profile.get_member_profile_history("m1", offset=0, limit=2, current_user=_staff()))
    assert [item["id"] for item in result["items"]] == ["invoice:family", "attendance:fallback-date"]


def test_profile_summary_counts_exact_child_item_only(fake_db):
    fake_db.invoices.docs[0]["status"] = "paid"
    fake_db.invoices.docs.append({
        "id": "sibling-only", "member_id": "m1", "status": "paid",
        "items": [{"member_id": "sibling", "activity_name": "Sibling only"}],
    })
    result = run(profile.get_member_profile_summary("m1", current_user=_staff()))
    assert result == {"paid_invoice_count": 1, "errors": []}


def test_profile_messages_are_recipient_only_phone_safe_and_read_only(fake_db):
    # A similarly-shaped sender record must not be selected by a recipient-only query.
    fake_db.messages.docs.append({
        "id": "other", "recipient_member_id": "sibling", "sender_id": "m1",
        "sender_type": "member", "subject": "other", "body": "other",
        "created_at": "2025-01-07T00:00:00Z",
    })
    result = run(profile.get_member_profile_messages("m1", offset=0, limit=20, current_user=_staff()))
    assert [item["id"] for item in result["items"]] == ["request"]
    assert result["items"][0]["status"] == "pending"
    assert "current_value" not in result["items"][0]["changes"]
    assert "new_value" not in result["items"][0]["changes"]
    assert "reason" not in result["items"][0]["changes"]
    assert result["items"][0]["subject"] == "طلب تعديل رقم الجوال"
    assert "0500000000" not in result["items"][0]["body"]
    assert "0599999999" not in result["items"][0]["body"]