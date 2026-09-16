"""Isolated dashboard action tests; no server or live MongoDB is used."""
import asyncio
import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from routes import dashboard_actions as actions  # noqa: E402
from routes import registration_requests  # noqa: E402


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction=-1):
        self.docs.sort(key=lambda row: str(row.get(field) or ""), reverse=direction < 0)
        return self

    def limit(self, value):
        self.docs = self.docs[:value]
        return self

    async def to_list(self, length=None):
        return [dict(row) for row in self.docs[:length] if length is not None] if length else [dict(row) for row in self.docs]


class _Collection:
    def __init__(self, docs=()):
        self.docs = list(docs)

    @staticmethod
    def _matches(row, query):
        for field, expected in query.items():
            if field == "$or":
                if not any(_Collection._matches(row, part) for part in expected):
                    return False
                continue
            if field == "$and":
                if not all(_Collection._matches(row, part) for part in expected):
                    return False
                continue
            value = row.get(field)
            if isinstance(expected, dict):
                if "$type" in expected:
                    wanted = expected["$type"]
                    if wanted == "date" and not isinstance(value, datetime):
                        return False
                    if wanted == "string" and not isinstance(value, str):
                        return False
                if "$in" in expected and value not in expected["$in"]:
                    return False
                if "$nin" in expected and value in expected["$nin"]:
                    return False
                if "$gte" in expected and (value is None or value < expected["$gte"]):
                    return False
                if "$lte" in expected and (value is None or value > expected["$lte"]):
                    return False
                if "$elemMatch" in expected and not any(
                    _Collection._matches(item, expected["$elemMatch"])
                    for item in (value or [])
                ):
                    return False
            elif value != expected:
                return False
        return True

    def find(self, query, projection=None):
        return _Cursor([row for row in self.docs if self._matches(row, query)])

    async def find_one(self, query, projection=None):
        return next((dict(row) for row in self.docs if self._matches(row, query)), None)

    async def count_documents(self, query):
        return sum(self._matches(row, query) for row in self.docs)


class _DB:
    def __init__(self, collections):
        self.collections = {name: _Collection(rows) for name, rows in collections.items()}

    def __getattr__(self, name):
        return self.collections.setdefault(name, _Collection())

    def __getitem__(self, name):
        return self.collections.setdefault(name, _Collection())


@pytest.fixture()
def fake_db(monkeypatch):
    now = datetime.now(ZoneInfo("Asia/Riyadh"))
    today = now.date().isoformat()
    absent_dates = [(now.date() - timedelta(days=offset)).isoformat() for offset in (1, 4, 12)]
    db = _DB({
        "users": [{"id": "staff", "permissions": ["dashboard", "renewals", "attendance", "invoices", "messages"]}],
        "members": [
            {"id": "m-exp", "name_ar": "صالح", "branch_id": "a", "status": "active",
             "activities": [{"activity_id": "swim", "activity_name": "سباحة", "status": "active", "end_date": today}]},
            # This old activity would appear as expiring without the paid item.
            {"id": "m-paid", "name_ar": "مجدد", "branch_id": "a", "status": "active",
             "activities": [{"activity_id": "ball", "activity_name": "كرة", "status": "active", "end_date": today}]},
            {"id": "m-prepaid", "name_ar": "مدفوع مقدماً", "branch_id": "a", "status": "active",
             "activities": [{"activity_id": "karate", "activity_name": "كاراتيه", "status": "active", "end_date": today}]},
            {"id": "m-other", "name_ar": "فرع آخر", "branch_id": "b", "status": "active",
             "activities": [{"activity_id": "swim", "activity_name": "سباحة", "status": "active", "end_date": today}]},
        ],
        "invoices": [
            # Original paid period: its long end date must NOT hide a member
            # whose current window moved backwards after off-schedule visits.
            {"id": "original", "status": "paid", "branch_id": "a", "member_id": "m-paid",
             "items": [{"member_id": "m-paid", "activity_id": "ball", "activity_name": "كرة",
                        "start_date": (now.date() - timedelta(days=30)).isoformat(),
                        "end_date": (now.date() + timedelta(days=30)).isoformat()}]},
            # A separately prepaid future period is authoritative renewal evidence.
            {"id": "prepaid", "status": "paid", "branch_id": "a", "member_id": "m-prepaid",
             "items": [{"member_id": "m-prepaid", "activity_id": "karate", "activity_name": "كاراتيه",
                        "start_date": (now.date() + timedelta(days=1)).isoformat(),
                        "end_date": (now.date() + timedelta(days=31)).isoformat()}]},
        ],
        "attendance": [
            *[{"id": "a" + str(i), "member_id": "m-exp", "branch_id": "a", "status": "absent", "date": day}
              for i, day in enumerate(absent_dates)],
            *[{"id": "b" + str(i), "member_id": "m-other", "branch_id": "b", "status": "absent", "date": day}
              for i, day in enumerate(absent_dates)],
        ],
        "registration_requests": [
            {"id": "r-a", "branch_id": "a", "status": "pending", "customer_name": "طلب أ", "created_at": now.isoformat()},
            {"id": "r-b", "branch_id": "b", "status": "pending", "customer_name": "طلب ب", "created_at": now.isoformat()},
        ],
        "whatsapp_cloud_conversations": [
            {"id": "c-a", "branch_id": "a", "contact_name": "0500000000", "last_direction": "inbound", "last_message_at": now.isoformat()},
            {"id": "c-out", "branch_id": "a", "contact_name": "عميل", "last_direction": "outbound", "last_message_at": now.isoformat()},
            {"id": "c-b", "branch_id": "b", "contact_name": "آخر", "last_direction": "inbound", "last_message_at": now.isoformat()},
        ],
        "whatsapp_campaign_job_items": [
            {"id": "f-ok", "job_id": "j", "recipient_index": 0, "branch_id": "a", "status": "failed", "created_at": now.isoformat()},
            {"id": "f-sup", "job_id": "j", "recipient_index": 1, "branch_id": "a", "status": "failed", "created_at": now.isoformat()},
            {"id": "delivered", "job_id": "j2", "recipient_index": 1, "branch_id": "a", "status": "delivered",
             "retry_of": "f-sup", "created_at": now.isoformat()},
            {"id": "unknown", "job_id": "j", "recipient_index": 2, "branch_id": "a", "status": "unknown", "created_at": now.isoformat()},
            {"id": "f-b", "job_id": "j", "recipient_index": 0, "branch_id": "b", "status": "failed", "created_at": now.isoformat()},
        ],
        "whatsapp_cloud_messages": [],
    })
    monkeypatch.setattr(actions, "db", db)

    async def identity(rows):
        return [dict(row) for row in rows]

    monkeypatch.setattr(registration_requests, "_normalize_registration_request_rows", identity)
    return db


def test_dashboard_actions_scope_thresholds_and_authoritative_renewal(fake_db):
    """A branch user gets only A; original invoices differ from future prepaid periods."""
    response = run(actions.get_dashboard_actions(
        branch_filter="a",
        current_user={"user_id": "staff", "branch_id": "a", "is_admin": False},
    ))
    groups = {group["key"]: group for group in response["groups"]}
    assert groups["expiring"]["count"] == 2
    assert {item["entity_id"] for item in groups["expiring"]["items"]} == {"m-exp", "m-paid"}
    assert groups["absence"]["count"] == 1
    assert groups["absence"]["items"][0]["entity_id"] == "m-exp"
    assert groups["registrations"]["count"] == 1
    assert groups["conversations"]["count"] == 1
    assert groups["conversations"]["items"][0]["title"] == "محادثة واردة"
    assert groups["failures"]["count"] == 1
    assert groups["failures"]["items"][0]["kind"] == "failed_send"


def test_failed_sends_dedupe_cloud_echo_and_keep_full_count_over_item_cap(fake_db):
    """A delivered cloud receipt suppresses its campaign failure across sources."""
    now = datetime.now(ZoneInfo("Asia/Riyadh"))
    fake_db.whatsapp_campaign_job_items.docs.append({
        "id": "campaign-echo-failure", "branch_id": "a", "provider": "whatsflow",
        "provider_message_id": "provider-message-1", "status": "failed",
        # Legacy ISO storage is deliberately exercised here.
        "created_at": now.isoformat(),
    })
    fake_db.whatsapp_cloud_messages.docs.append({
        "id": "cloud-echo-delivered", "branch_id": "a", "provider": "whatsflow",
        "provider_message_id": "provider-message-1", "direction": "outbound",
        "status": "delivered",
        # Current Mongo datetime storage is deliberately exercised here.
        "status_updated_at": now,
    })
    for index in range(21):
        fake_db.whatsapp_campaign_job_items.docs.append({
            "id": "bulk-failure-{}".format(index), "job_id": "bulk-{}".format(index),
            "recipient_index": 0, "branch_id": "a", "status": "failed",
            "created_at": now.isoformat(),
        })

    response = run(actions.get_dashboard_actions(
        branch_filter="a",
        current_user={"user_id": "staff", "branch_id": "a", "is_admin": False},
    ))
    failures = next(group for group in response["groups"] if group["key"] == "failures")
    # f-ok + 21 bulk failures; retry-delivered and cross-source echo are excluded.
    assert failures["count"] == 22
    assert len(failures["items"]) == 20
    assert failures["has_more"] is True
    assert all(item["entity_id"] != "campaign-echo-failure" for item in failures["items"])


def test_dashboard_actions_omits_groups_without_their_existing_permissions(fake_db):
    fake_db.users.docs[0]["permissions"] = ["dashboard", "renewals"]
    response = run(actions.get_dashboard_actions(
        branch_filter="a",
        current_user={"user_id": "staff", "branch_id": "a", "is_admin": False},
    ))
    assert [group["key"] for group in response["groups"]] == ["expiring"]