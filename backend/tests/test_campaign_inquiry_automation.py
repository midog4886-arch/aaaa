"""Focused safety tests for campaign-inquiry automation.

These tests deliberately use an in-memory Mongo-shaped double and a mocked
bulk enqueue function.  No provider or real database is touched.
"""

import asyncio
import copy
import os
import sys
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services import campaign_inquiry_automation as automation


def run(coro):
    return asyncio.run(coro)


def _matches(document, query):
    document = document or {}
    for key, expected in (query or {}).items():
        if key == "$or":
            if not any(_matches(document, part) for part in expected):
                return False
            continue
        if key == "$and":
            if not all(_matches(document, part) for part in expected):
                return False
            continue
        actual = document.get(key)
        if isinstance(expected, dict):
            if "$exists" in expected and ((key in document) != expected["$exists"]):
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$lte" in expected and not (actual is not None and actual <= expected["$lte"]):
                return False
            if "$lt" in expected and not (actual is not None and actual < expected["$lt"]):
                return False
            continue
        if actual != expected:
            return False
    return True


class Result:
    def __init__(self, matched_count=0, upserted_id=None):
        self.matched_count = matched_count
        self.modified_count = matched_count
        self.upserted_id = upserted_id


class Cursor:
    def __init__(self, rows):
        self.rows = [copy.deepcopy(row) for row in rows]

    async def to_list(self, length=None):
        return self.rows if length is None else self.rows[:length]


class Collection:
    def __init__(self, rows=()):
        self.rows = [copy.deepcopy(row) for row in rows]

    async def create_index(self, *_args, **_kwargs):
        return None

    async def find_one(self, query, projection=None, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                return copy.deepcopy(row)
        return None

    def find(self, query=None, projection=None):
        return Cursor(row for row in self.rows if _matches(row, query or {}))

    async def insert_one(self, document):
        self.rows.append(copy.deepcopy(document))
        return Result(upserted_id=document.get("_id"))

    async def insert_many(self, documents):
        self.rows.extend(copy.deepcopy(document) for document in documents)

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                row.update(copy.deepcopy(update.get("$set", {})))
                for field in update.get("$unset", {}):
                    row.pop(field, None)
                return Result(1)
        if not upsert:
            return Result(0)
        row = {
            key: copy.deepcopy(value)
            for key, value in query.items()
            if not key.startswith("$") and not isinstance(value, dict)
        }
        row.update(copy.deepcopy(update.get("$setOnInsert", {})))
        row.update(copy.deepcopy(update.get("$set", {})))
        self.rows.append(row)
        return Result(0, row.get("_id"))

    async def update_many(self, query, update):
        count = 0
        for row in self.rows:
            if _matches(row, query):
                row.update(copy.deepcopy(update.get("$set", {})))
                count += 1
        return Result(count)


class Database:
    def __init__(self, inquiries=()):
        self.collections = {
            "campaign_inquiries": Collection(inquiries),
            "whatsapp_campaign_job_items": Collection(),
            "whatsapp_campaign_jobs": Collection(),
            "campaign_inquiry_automation_settings": Collection(),
            "campaign_inquiry_automation_previews": Collection(),
        }

    def __getitem__(self, name):
        return self.collections.setdefault(name, Collection())

    def __getattr__(self, name):
        return self[name]


def inquiry(
    inquiry_id="i1",
    branch_id="b1",
    *,
    phone="0501234567",
    status="new",
    name="Sara",
    **extra,
):
    row = {
        "id": inquiry_id,
        "branch_id": branch_id,
        "phone": phone,
        "status": status,
        "name": name,
    }
    row.update(extra)
    return row


@pytest.fixture
def harness(monkeypatch):
    db = Database([inquiry()])

    async def config(_branch_id):
        return {
            "branch_id": "b1",
            "provider": "whatsflow",
            "enabled": True,
            "whatsflow_instance": "academy",
            "whatsflow_api_key_encrypted": "encrypted",
            "whatsflow_state": "open",
        }

    queued = []

    async def enqueue(
        branch_id,
        provider,
        recipients,
        idempotency_key,
        attachments=None,
        kind="marketing",
        source="campaign",
        metadata=None,
    ):
        queued.append(
            {
                "branch_id": branch_id,
                "provider": provider,
                "recipients": copy.deepcopy(recipients),
                "idempotency_key": idempotency_key,
                "kind": kind,
                "source": source,
            }
        )
        return {"id": f"job-{len(queued)}"}, True

    automation.configure(db, config)
    monkeypatch.setattr(automation.whatsapp_bulk_jobs, "enqueue", enqueue)
    return db, queued


def test_preview_is_immutable_single_use_and_idempotent_confirm(harness):
    db, queued = harness
    preview = run(
        automation.preview(
            "b1",
            ["i1"],
            mode="direct",
            message="Hello {name}",
        )
    )
    # Mutating a response object cannot mutate the durable token snapshot.
    preview["recipients"][0]["name"] = "tampered"
    first = run(automation.confirm("b1", preview["preview_id"]))
    second = run(automation.confirm("b1", preview["preview_id"]))

    assert first == {"accepted": 1, "skipped": 0}
    assert second == first
    assert len(queued) == 1
    assert queued[0]["recipients"][0]["message"] == "Hello Sara"
    assert db.campaign_inquiries.rows[0]["automation_status"] == "direct_queued"


def test_stale_recipient_data_invalidates_preview(harness):
    db, _queued = harness
    preview = run(
        automation.preview(
            "b1", ["i1"], mode="direct", message="A confirmed message"
        )
    )
    db.campaign_inquiries.rows[0]["name"] = "Changed by staff"

    with pytest.raises(RuntimeError, match="stale"):
        run(automation.confirm("b1", preview["preview_id"]))


@pytest.mark.parametrize("crm_status", ["waiting", "interested"])
def test_non_new_crm_statuses_keep_the_approved_snapshot(harness, crm_status):
    db, queued = harness
    db.campaign_inquiries.rows[0]["status"] = crm_status
    preview = run(
        automation.preview("b1", ["i1"], mode="direct", message="Approved")
    )
    assert preview["recipients"][0]["eligible"] is True
    assert run(automation.confirm("b1", preview["preview_id"])) == {
        "accepted": 1,
        "skipped": 0,
    }
    assert db.campaign_inquiries.rows[0]["automation_phone_snapshot"] == "966501234567"
    assert db.campaign_inquiries.rows[0]["automation_name_snapshot"] == "Sara"
    assert queued[0]["recipients"][0]["phone"] == "966501234567"


def test_same_inquiry_cannot_be_reenrolled_direct_then_followup(harness):
    _db, queued = harness
    direct = run(
        automation.preview("b1", ["i1"], mode="direct", message="One")
    )
    run(automation.confirm("b1", direct["preview_id"]))

    second_direct = run(
        automation.preview("b1", ["i1"], mode="direct", message="Two")
    )
    followup = run(
        automation.preview(
            "b1",
            ["i1"],
            mode="followup",
            first_message="First",
            second_message="Second",
        )
    )

    assert second_direct["recipients"][0]["reason"] == "already_confirmed"
    assert followup["recipients"][0]["reason"] == "already_enrolled"
    assert len(queued) == 1


def test_distinct_previews_cas_claim_one_direct_and_one_followup(harness):
    _db, queued = harness
    direct = run(
        automation.preview("b1", ["i1"], mode="direct", message="Direct")
    )
    followup = run(
        automation.preview(
            "b1",
            ["i1"],
            mode="followup",
            first_message="First",
            second_message="Second",
        )
    )

    async def confirm_both():
        return await asyncio.gather(
            automation.confirm("b1", direct["preview_id"]),
            automation.confirm("b1", followup["preview_id"]),
        )

    first, second = run(confirm_both())
    assert sorted([first["accepted"], second["accepted"]]) == [0, 1]
    assert len(queued) == 1
    db_row = _db.campaign_inquiries.rows[0]
    assert db_row["automation_claim_id"] in {
        direct["preview_id"],
        followup["preview_id"],
    }


def test_distinct_direct_previews_have_one_atomic_claim(harness):
    _db, queued = harness
    first_preview = run(
        automation.preview("b1", ["i1"], mode="direct", message="First")
    )
    second_preview = run(
        automation.preview("b1", ["i1"], mode="direct", message="Second")
    )
    async def confirm_both():
        return await asyncio.gather(
            automation.confirm("b1", first_preview["preview_id"]),
            automation.confirm("b1", second_preview["preview_id"]),
        )

    results = run(confirm_both())
    assert sorted(result["accepted"] for result in results) == [0, 1]
    assert len(queued) == 1


def test_delayed_confirmation_recomputes_followup_due_from_confirmation(harness, monkeypatch):
    db, _queued = harness
    clock = {"value": datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(automation, "_now", lambda: clock["value"])
    preview = run(
        automation.preview(
            "b1",
            ["i1"],
            mode="followup",
            first_message="First",
            second_message="Second",
        )
    )
    preview_due = preview["first_due_at"]
    clock["value"] += automation.timedelta(minutes=2)
    run(automation.confirm("b1", preview["preview_id"]))
    enrolled_due = db.campaign_inquiries.rows[0]["automation_first_due_at"]
    assert enrolled_due != preview_due
    assert _parse_test_datetime(enrolled_due) == clock["value"] + automation.timedelta(hours=24)


def _parse_test_datetime(value):
    return datetime.fromisoformat(value)


def test_phone_or_name_edit_after_enrollment_hard_stops_before_schedule(harness):
    db, queued = harness
    preview = run(
        automation.preview(
            "b1",
            ["i1"],
            mode="followup",
            first_message="First",
            second_message="Second",
        )
    )
    run(automation.confirm("b1", preview["preview_id"]))
    row = db.campaign_inquiries.rows[0]
    row["phone"] = "0507654321"
    row["name"] = "New name"
    row["automation_first_due_at"] = "2000-01-01T00:00:00+00:00"
    run(automation.schedule_due())

    assert row["automation_status"] == "stopped"
    assert row["automation_stop_reason"] == "identity_changed"
    assert not queued
    item = {
        "branch_id": "b1",
        "phone": "966507654321",
        "communication_kind": automation.KIND,
        "source_metadata": {"inquiry_id": "i1", "sequence": 1},
    }
    assert run(automation.authorize_dispatch(item))["action"] == "cancel"


def test_archive_after_queue_hard_stops_scheduler_and_dispatch(harness):
    db, queued = harness
    preview = run(
        automation.preview("b1", ["i1"], mode="direct", message="Direct")
    )
    run(automation.confirm("b1", preview["preview_id"]))
    assert queued
    row = db.campaign_inquiries.rows[0]
    row["archived"] = True
    run(automation.schedule_due())
    assert row["automation_status"] == "stopped"
    assert row["automation_stop_reason"] == "archived"
    assert run(
        automation.authorize_dispatch(
            {
                "branch_id": "b1",
                "phone": "966501234567",
                "communication_kind": automation.KIND,
                "source_metadata": {"inquiry_id": "i1", "sequence": 0},
            }
        )
    )["action"] == "cancel"


def test_failed_direct_enqueue_recovers_with_deterministic_job(harness, monkeypatch):
    db, queued = harness
    original = automation.whatsapp_bulk_jobs.enqueue
    attempts = {"count": 0}

    async def fail_once(*args, **kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise RuntimeError("queue unavailable")
        return await original(*args, **kwargs)

    monkeypatch.setattr(automation.whatsapp_bulk_jobs, "enqueue", fail_once)
    preview = run(
        automation.preview("b1", ["i1"], mode="direct", message="Recover")
    )
    assert run(automation.confirm("b1", preview["preview_id"])) == {
        "accepted": 1,
        "skipped": 0,
    }
    assert db.campaign_inquiries.rows[0].get("automation_last_job_id") is None
    run(automation.schedule_due())
    assert len(queued) == 1
    assert attempts["count"] == 2


def test_branch_scope_never_leaks_inquiry_or_allows_cross_branch_enrollment(harness):
    db, queued = harness
    db.campaign_inquiries.rows.append(inquiry("other", "b2", phone="0507654321"))

    preview = run(
        automation.preview("b1", ["other"], mode="direct", message="No leak")
    )
    assert preview["recipients"] == [
        {
            "id": "other",
            "name": "",
            "phone": "",
            "eligible": False,
            "reason": "not_found",
        }
    ]
    assert not queued


def test_settings_route_rejects_a_branch_outside_staff_scope(harness, monkeypatch):
    db, _queued = harness
    from routes import campaign_inquiries as routes

    db.branches.rows.append({"id": "b1"})
    monkeypatch.setattr(routes, "db", db)

    async def allow_messages(_user, _permission):
        return None

    def scope(_user, branch_id):
        if branch_id != "b1":
            raise HTTPException(status_code=403, detail="No access to this branch")
        return branch_id

    monkeypatch.setattr(routes, "require_permission", allow_messages)
    monkeypatch.setattr(routes, "require_branch_scope", scope)

    with pytest.raises(HTTPException) as error:
        run(
            routes.get_campaign_automation_settings(
                "b2", {"id": "staff", "is_admin": False}
            )
        )
    assert error.value.status_code == 403


def test_archive_route_stops_queued_automation(harness, monkeypatch):
    db, _queued = harness
    from routes import campaign_inquiries as routes

    db.branches.rows.append({"id": "b1"})
    db.campaign_inquiries.rows[0].update(
        {
            "automation_status": "direct_queued",
            "automation_claim_id": "claim-1",
            "automation_phone_snapshot": "966501234567",
            "automation_name_snapshot": "Sara",
        }
    )
    monkeypatch.setattr(routes, "db", db)

    async def allow_messages(_user, _permission):
        return None

    monkeypatch.setattr(routes, "require_permission", allow_messages)
    monkeypatch.setattr(routes, "require_branch_scope", lambda _user, branch: branch)
    result = run(
        routes.archive_campaign_inquiry("i1", {"id": "staff", "is_admin": True})
    )
    assert result["archived"] is True
    assert db.campaign_inquiries.rows[0]["automation_status"] == "stopped"
    assert db.campaign_inquiries.rows[0]["automation_stop_reason"] == "archived"


def test_identity_edit_route_stops_queued_automation(harness, monkeypatch):
    db, _queued = harness
    from routes import campaign_inquiries as routes

    db.branches.rows.append({"id": "b1"})
    db.campaign_inquiries.rows[0].update(
        {
            "automation_status": "direct_queued",
            "automation_claim_id": "claim-1",
            "automation_phone_snapshot": "966501234567",
            "automation_name_snapshot": "Sara",
        }
    )
    monkeypatch.setattr(routes, "db", db)

    async def allow_messages(_user, _permission):
        return None

    monkeypatch.setattr(routes, "require_permission", allow_messages)
    monkeypatch.setattr(routes, "require_branch_scope", lambda _user, branch: branch)
    run(
        routes.update_campaign_inquiry(
            "i1",
            routes.CampaignInquiryUpdate(name="Changed"),
            {"id": "staff", "is_admin": True},
        )
    )
    assert db.campaign_inquiries.rows[0]["automation_status"] == "stopped"
    assert db.campaign_inquiries.rows[0]["automation_stop_reason"] == "identity_changed"


def test_status_endpoint_and_shared_callback_are_branch_scoped(harness, monkeypatch):
    db, _queued = harness
    from routes import campaign_inquiries as routes
    from routes import whatsapp

    db.branches.rows.append({"id": "b1"})
    db.campaign_inquiries.rows[0].update(
        {
            "automation_status": "direct_queued",
            "automation_next_due_at": "later",
            "automation_phone_snapshot": "966501234567",
            "automation_name_snapshot": "Sara",
        }
    )
    db.whatsapp_campaign_job_items.rows.append(
        {
            "id": "item-1",
            "branch_id": "b1",
            "status": "sent",
            "provider": "whatsflow",
            "source_metadata": {"inquiry_id": "i1", "sequence": 0},
        }
    )
    monkeypatch.setattr(routes, "db", db)

    async def allow_messages(_user, _permission):
        return None

    monkeypatch.setattr(routes, "require_permission", allow_messages)
    monkeypatch.setattr(routes, "require_branch_scope", lambda _user, branch: branch)
    status = run(
        routes.get_campaign_automation_status(
            "b1", {"id": "staff", "is_admin": True}
        )
    )
    assert status["items"][0]["status"] == "direct_queued"
    assert status["items"][0]["delivery_status"] == "accepted"

    decision = run(
        whatsapp._authorize_bulk_dispatch(
            {
                "branch_id": "b1",
                "phone": "966501234567",
                "communication_kind": automation.KIND,
                "source_metadata": {"inquiry_id": "i1", "sequence": 0},
            }
        )
    )
    assert decision["action"] == "send"


def test_pause_and_riyadh_hours_are_checked_before_dispatch(harness, monkeypatch):
    _db, _queued = harness
    run(automation.update_settings("b1", paused=True))
    item = {
        "branch_id": "b1",
        "communication_kind": automation.KIND,
        "source_metadata": {"inquiry_id": "i1", "sequence": 0},
    }
    paused = run(automation.authorize_dispatch(item))
    assert paused["action"] == "defer"

    run(automation.update_settings("b1", paused=False, start_hour=23, end_hour=24))
    monkeypatch.setattr(
        automation,
        "_now",
        lambda: datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc),
    )
    outside = run(automation.authorize_dispatch(item))
    assert outside["action"] == "defer"
    assert run(automation.recheck_dispatch(item)) is False


def test_reply_cancels_pending_and_only_human_outbound_stops(harness):
    db, _queued = harness
    row = db.campaign_inquiries.rows[0]
    row.update(
        {
            "automation_enrolled": True,
            "automation_status": "scheduled",
            "automation_first_due_at": "2099-01-01T00:00:00+00:00",
        }
    )
    db.whatsapp_campaign_job_items.rows.append(
        {
            "id": "automated-item",
            "branch_id": "b1",
            "provider": "whatsflow",
            "provider_message_id": "wa-auto-1",
            "communication_kind": automation.KIND,
            "phone": "966501234567",
            "status": "sent",
        }
    )

    run(automation.note_outbound("b1", "0501234567", "wa-auto-1", "whatsflow"))
    assert row["automation_status"] == "scheduled"

    run(automation.note_outbound("b1", "0501234567", "wa-human-1", "whatsflow"))
    assert row["automation_status"] == "stopped"
    assert row["automation_stop_reason"] == "staff_contacted"

    row.update(
        {
            "automation_status": "scheduled",
            "automation_stop_reason": None,
        }
    )
    run(automation.note_customer_message("b1", "0501234567", "Please stop"))
    assert row["automation_status"] == "stopped"
    assert row["automation_stop_reason"] == "opted_out"


def test_shared_queue_sequences_accept_first_then_hard_stop_unknown(harness):
    db, queued = harness
    now = datetime.now(timezone.utc).isoformat()
    db.campaign_inquiries.rows[0].update(
        {
            "automation_enrolled": True,
            "automation_confirmation_id": "confirmation-1",
            "automation_status": "scheduled",
            "automation_first_due_at": "2000-01-01T00:00:00+00:00",
            "automation_second_due_at": "2000-01-02T00:00:00+00:00",
            "automation_first_message": "first",
            "automation_second_message": "second",
            "automation_phone_snapshot": "966501234567",
            "automation_name_snapshot": "Sara",
            "automation_next_due_at": now,
        }
    )

    run(automation.schedule_due())
    assert queued[0]["kind"] == automation.KIND
    assert queued[0]["recipients"][0]["source_metadata"]["sequence"] == 1
    first_item = {
        "branch_id": "b1",
        "phone": "966501234567",
        "communication_kind": automation.KIND,
        "source_metadata": {"inquiry_id": "i1", "sequence": 1},
    }
    run(automation.completed(first_item, "sent"))
    assert db.campaign_inquiries.rows[0]["automation_status"] == "first_sent"

    run(automation.schedule_due())
    assert len(queued) == 2
    assert queued[1]["recipients"][0]["source_metadata"]["sequence"] == 2
    second_item = {
        "branch_id": "b1",
        "phone": "966501234567",
        "communication_kind": automation.KIND,
        "source_metadata": {"inquiry_id": "i1", "sequence": 2},
    }
    run(automation.completed(second_item, "unknown"))
    assert db.campaign_inquiries.rows[0]["automation_status"] == "unknown"
    assert db.campaign_inquiries.rows[0]["automation_stop_reason"] == "provider_outcome_unknown"

    run(automation.schedule_due())
    assert len(queued) == 2


def test_status_callback_preserves_hard_stop_race(harness):
    db, _queued = harness
    row = db.campaign_inquiries.rows[0]
    row.update(
        {
            "automation_enrolled": True,
            "automation_status": "first_queued",
            "automation_stop_reason": "customer_replied",
            "automation_phone_snapshot": "966501234567",
            "automation_name_snapshot": "Sara",
        }
    )
    item = {
        "branch_id": "b1",
        "phone": "966501234567",
        "communication_kind": automation.KIND,
        "source_metadata": {"inquiry_id": "i1", "sequence": 1},
    }
    run(automation.completed(item, "sent"))
    assert row["automation_status"] == "first_queued"
    assert row["automation_stop_reason"] == "customer_replied"
