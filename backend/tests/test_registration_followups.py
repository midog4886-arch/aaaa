import asyncio
import os
import sys
from copy import deepcopy
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from routes import registration_requests as routes
from services import registration_followups as followups


def run(coro):
    return asyncio.run(coro)


def matches(row, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(matches(row, part) for part in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$exists" in expected and ((key in row) != expected["$exists"]):
                return False
        elif actual != expected:
            return False
    return True


class Cursor:
    def __init__(self, rows):
        self.rows = [deepcopy(row) for row in rows]

    def sort(self, *_args):
        return self

    async def to_list(self, length=None):
        return self.rows[:length]


class Collection:
    def __init__(self, rows=()):
        self.rows = [deepcopy(row) for row in rows]
        self.find_calls = []

    async def create_index(self, *_args, **_kwargs):
        return None

    async def find_one(self, query, *_args):
        row = next((row for row in self.rows if matches(row, query)), None)
        return deepcopy(row) if row else None

    def find(self, query, *_args):
        self.find_calls.append(deepcopy(query))
        return Cursor(row for row in self.rows if matches(row, query))

    async def insert_one(self, row):
        self.rows.append(deepcopy(row))

    async def count_documents(self, query):
        return sum(1 for row in self.rows if matches(row, query))

    async def update_one(self, query, update, upsert=False):
        row = next((row for row in self.rows if matches(row, query)), None)
        if row is None and upsert:
            row = {k: v for k, v in query.items() if not k.startswith("$") and not isinstance(v, dict)}
            row.update(deepcopy(update.get("$setOnInsert", {})))
            self.rows.append(row)
        if row is not None:
            row.update(deepcopy(update.get("$set", {})))
        return type("Result", (), {"matched_count": int(row is not None)})()

    async def update_many(self, query, update):
        for row in self.rows:
            if matches(row, query):
                row.update(deepcopy(update.get("$set", {})))

    async def delete_one(self, query):
        self.rows[:] = [row for row in self.rows if not matches(row, query)]


class DB:
    def __init__(self, requests=()):
        self.collections = {"registration_requests": Collection(requests)}

    def __getitem__(self, name):
        return self.collections.setdefault(name, Collection())

    def __getattr__(self, name):
        return self[name]


class Clock(datetime):
    value = datetime(2026, 1, 2, 6, 0, tzinfo=timezone.utc)

    @classmethod
    def now(cls, _tz=None):
        return cls.value


@pytest.fixture
def database(monkeypatch):
    db = DB()
    followups.configure(db, lambda _branch: None)
    monkeypatch.setattr(routes, "db", db)
    return db


def request_doc(**changes):
    row = {
        "id": "r1", "branch_id": "b1", "customer_name": "سارة",
        "customer_phone": "050 123 4567", "activity_name": "السباحة",
        "status": "pending", "created_at": "2026-01-01T07:00:00+00:00",
        "followup_enrolled": True, "followup_normalized_phone": "966501234567",
        "followup_status": "scheduled", "followup_stop_reason": None,
        "followup_sent_count": 0,
    }
    row.update(changes)
    return row


def test_new_enrollment_is_explicit_but_old_document_remains_unenrolled(database):
    old = {"id": "legacy", "created_at": "2025-01-01T00:00:00+00:00"}
    database.registration_requests.rows.append(old)
    fields = run(followups.enrollment_fields_for_new("b1", "0501234567"))
    assert fields["followup_enrolled"] is True
    assert fields["followup_status"] == "scheduled"
    assert "followup_status" not in old


def test_duplicate_submission_inherits_completed_phone_sequence(database):
    database.registration_requests.rows.append(request_doc(
        followup_status="completed", followup_sent_count=2
    ))
    fields = run(followups.enrollment_fields_for_new("b1", "+966 50 123 4567"))
    assert fields["followup_status"] == "completed"
    assert fields["followup_sent_count"] == 2


def test_duplicate_in_other_branch_inherits_tenant_phone_sequence(database):
    database.registration_requests.rows.append(request_doc(
        branch_id="b1", followup_status="completed", followup_sent_count=2
    ))
    fields = run(followups.enrollment_fields_for_new("b2", "+966 50 123 4567"))
    assert fields["followup_status"] == "completed"
    assert fields["followup_sent_count"] == 2


def test_bilingual_group_text_uses_only_real_names_and_combines_activities():
    rows = [
        request_doc(customer_name="سارة", activity_name="السباحة"),
        request_doc(id="r2", customer_name="محمد", activity_name="الكاراتيه"),
    ]
    text = followups._message(rows, 1)
    assert "سارة" in text and "محمد" in text
    assert "السباحة" in text and "الكاراتيه" in text
    assert "— English —" in text


def test_customer_reply_stops_all_same_phone_and_optout_is_persistent(database):
    database.registration_requests.rows.extend([request_doc(), request_doc(id="r2")])
    run(followups.note_customer_message("b1", "0501234567", "إلغاء من فضلك"))
    assert all(row["followup_status"] == "stopped"
               for row in database.registration_requests.rows)
    stop = database["registration_followup_stops"].rows[0]
    assert stop["reason"] == "opted_out"
    assert stop["persistent"] is True


def test_staff_stop_endpoint_returns_updated_request_and_guards_branch(database):
    database.registration_requests.rows.append(request_doc())
    payload = routes.RegistrationFollowupStop(reason="contacted")
    updated = run(routes.stop_registration_followup(
        "r1", payload, {"is_admin": False, "branch_id": "b1"}
    ))
    assert updated["followup_status"] == "stopped"
    assert updated["followup_stop_reason"] == "contacted"
    database.registration_requests.rows[0].update(
        followup_status="scheduled", followup_stop_reason=None
    )
    with pytest.raises(HTTPException) as error:
        run(routes.stop_registration_followup(
            "r1", payload, {"is_admin": False, "branch_id": "other"}
        ))
    assert error.value.status_code == 403


def test_explicit_staff_contact_survives_later_request_processing(database):
    database.registration_requests.rows.append(request_doc())
    # A request may only transition to processed after an actual linked
    # invoice exists; contacting evidence itself remains independent.
    database["invoices"].rows.append({
        "id": "invoice-r1",
        "registration_request_id": "r1",
        "status": "pending",
        "branch_id": "b1",
    })
    run(routes.stop_registration_followup(
        "r1",
        routes.RegistrationFollowupStop(reason="contacted"),
        {"is_admin": False, "branch_id": "b1"},
    ))
    run(routes.update_registration_request(
        "r1",
        routes.RegistrationRequestUpdate(status="processed"),
        {"is_admin": False, "branch_id": "b1"},
    ))
    row = database.registration_requests.rows[0]
    assert row["status"] == "processed"
    assert row["followup_stop_reason"] == "contacted"
    assert row["followup_staff_contacted_at"]


@pytest.mark.parametrize("invoice_status", ["pending", "paid"])
def test_processing_linked_child_preserves_same_phone_sibling(database, monkeypatch, invoice_status):
    first = request_doc(customer_name="First child")
    sibling = request_doc(id="r2", customer_name="Second child",
                          customer_phone="+966501234567")
    database.registration_requests.rows.extend([first, sibling])
    database.members.rows.append({
        "id": "m1", "branch_id": "b1", "phone": "0501234567",
        "name": "First child",
    })
    database.invoices.rows.append({
        "id": "i1", "branch_id": "b1", "registration_request_id": "r1",
        "member_id": "m1", "status": invoice_status,
    })
    run(routes.update_registration_request(
        "r1", routes.RegistrationRequestUpdate(status="processed"),
        {"is_admin": False, "branch_id": "b1"},
    ))
    assert first["status"] == "processed"
    assert first["followup_status"] == "stopped"
    assert sibling["status"] == "pending"
    assert sibling["followup_status"] == "scheduled"
    assert database["registration_followup_stops"].rows == []
    rows = run(routes.list_registration_requests(
        status="pending", current_user={"is_admin": True},
    ))
    assert [row["id"] for row in rows] == ["r2"]
    monkeypatch.setattr(followups, "_get_config", AsyncMock(return_value={
        "enabled": True, "provider": "whatsflow",
    }))
    enqueue = AsyncMock(return_value={"id": "job-1"})
    monkeypatch.setattr(followups.whatsapp_bulk_jobs, "enqueue", enqueue)
    run(followups.schedule_due())
    assert sibling["status"] == "pending"
    assert sibling["followup_status"] != "stopped"
    assert database["registration_followup_stops"].rows == []


def test_scheduler_closes_only_terminal_request_not_same_phone_sibling(database, monkeypatch):
    first = request_doc(status="processed")
    sibling = request_doc(id="r2", customer_phone="٠٥٠١٢٣٤٥٦٧")
    database.registration_requests.rows.extend([first, sibling])
    monkeypatch.setattr(followups, "_get_config", AsyncMock(return_value={}))
    run(followups.schedule_due())
    assert first["followup_status"] == "stopped"
    assert sibling["status"] == "pending"
    assert sibling["followup_status"] != "stopped"
    assert database["registration_followup_stops"].rows == []


def test_direct_processed_transition_requires_invoice(database):
    database.registration_requests.rows.append(request_doc())
    with pytest.raises(HTTPException) as error:
        run(routes.update_registration_request(
            "r1",
            routes.RegistrationRequestUpdate(status="processed"),
            {"is_admin": False, "branch_id": "b1"},
        ))
    assert error.value.status_code == 409
    assert database.registration_requests.rows[0]["status"] == "pending"


def test_first_is_due_at_24_hours_not_immediately(database, monkeypatch):
    database.registration_requests.rows.append(request_doc())
    config = AsyncMock(return_value={"provider": "whatsflow"})
    followups.configure(database, config)
    enqueue = AsyncMock(return_value=({"id": "job"}, True))
    monkeypatch.setattr(followups.whatsapp_bulk_jobs, "enqueue", enqueue)
    monkeypatch.setattr(followups, "datetime", Clock)

    # At hour 23 it may safely be pre-queued, but the durable item is not
    # eligible for dispatch until exactly creation + 24 hours.
    Clock.value = datetime(2026, 1, 2, 6, 0, tzinfo=timezone.utc)
    run(followups.schedule_due())
    recipient = enqueue.await_args.args[2][0]
    assert recipient["next_attempt_at"] == datetime(
        2026, 1, 2, 7, 0, tzinfo=timezone.utc
    )


def test_due_time_rolls_forward_to_riyadh_quiet_hours(database, monkeypatch):
    database.registration_requests.rows.append(request_doc(
        created_at="2026-01-01T18:00:00+00:00"
    ))
    followups.configure(database, AsyncMock(return_value={"provider": "waha"}))
    enqueue = AsyncMock(return_value=({"id": "job"}, True))
    monkeypatch.setattr(followups.whatsapp_bulk_jobs, "enqueue", enqueue)
    monkeypatch.setattr(followups, "datetime", Clock)
    Clock.value = datetime(2026, 1, 2, 17, 0, tzinfo=timezone.utc)
    run(followups.schedule_due())
    # 21:00 Riyadh target rolls to 10:00 Riyadh the following morning.
    assert enqueue.await_args.args[2][0]["next_attempt_at"] == datetime(
        2026, 1, 3, 7, 0, tzinfo=timezone.utc
    )


def test_marketing_contact_defers_followup_to_next_riyadh_day(database, monkeypatch):
    database.registration_requests.rows.append(request_doc())
    followups.configure(database, AsyncMock(return_value={"provider": "whatsflow"}))
    monkeypatch.setattr(followups, "datetime", Clock)
    Clock.value = datetime(2026, 1, 2, 9, 0, tzinfo=timezone.utc)  # noon Riyadh
    database["whatsapp_contact_days"].rows.append({
        "branch_id": "b1", "phone": "966501234567", "day": "2026-01-02",
        "kind": "marketing",
    })
    result = run(followups.authorize_dispatch({
        "id": "item", "job_id": "job", "branch_id": "b1",
        "phone": "0501234567", "communication_kind": "registration_followup",
        "source_metadata": {"sequence": 1},
    }))
    assert result == {
        "action": "defer",
        "until": datetime(2026, 1, 3, 7, 0, tzinfo=timezone.utc),
    }


def test_delayed_first_send_keeps_final_on_later_calendar_day(database, monkeypatch):
    database.registration_requests.rows.append(request_doc(
        followup_status="first_sent", followup_sent_count=1,
        followup_first_sent_at="2026-01-05T17:00:00+00:00",
    ))
    followups.configure(database, AsyncMock(return_value={"provider": "whatsflow"}))
    enqueue = AsyncMock(return_value=({"id": "job"}, True))
    monkeypatch.setattr(followups.whatsapp_bulk_jobs, "enqueue", enqueue)
    monkeypatch.setattr(followups, "datetime", Clock)
    Clock.value = datetime(2026, 1, 5, 18, 0, tzinfo=timezone.utc)
    run(followups.schedule_due())
    # First was sent at 20:00 Riyadh Jan 5; final cannot share that local day.
    assert enqueue.await_args.args[2][0]["next_attempt_at"] == datetime(
        2026, 1, 6, 7, 0, tzinfo=timezone.utc
    )


def test_stopping_phone_also_stops_temporarily_blocked_rows(database):
    database.registration_requests.rows.append(request_doc(followup_status="blocked"))
    run(followups.stop_phone("b1", "0501234567", "staff_contacted"))
    assert database.registration_requests.rows[0]["followup_status"] == "stopped"


def test_cross_branch_phone_uses_oldest_branch_without_payload_leak(database, monkeypatch):
    database.registration_requests.rows.extend([
        request_doc(branch_id="b1", customer_name="Branch One",
                    activity_name="Swimming"),
        request_doc(id="r2", branch_id="b2", customer_name="Private Branch Two",
                    activity_name="Karate",
                    created_at="2026-01-01T08:00:00+00:00"),
    ])
    followups.configure(database, AsyncMock(return_value={"provider": "whatsflow"}))
    enqueue = AsyncMock(return_value=({"id": "job"}, True))
    monkeypatch.setattr(followups.whatsapp_bulk_jobs, "enqueue", enqueue)
    run(followups.schedule_due())
    assert enqueue.await_count == 1
    assert enqueue.await_args.args[0] == "b1"
    message = enqueue.await_args.args[2][0]["message"]
    assert "Branch One" in message
    assert "Private Branch Two" not in message
    assert "Karate" not in message


def test_stop_and_daily_contact_safety_are_tenant_phone_wide(database, monkeypatch):
    database.registration_requests.rows.extend([
        request_doc(branch_id="b1"),
        request_doc(id="r2", branch_id="b2"),
    ])
    run(followups.stop_phone("b1", "0501234567", "opted_out", persistent=True))
    assert all(row["followup_status"] == "stopped"
               for row in database.registration_requests.rows)
    stop = database["registration_followup_stops"].rows[0]
    assert stop["phone"] == "966501234567"
    assert "branch_id" not in stop


def test_mismatched_outbound_id_is_buffered_then_becomes_staff_contact(database):
    database.registration_requests.rows.append(request_doc())
    database["whatsapp_campaign_job_items"].rows.append({
        "branch_id": "b1", "phone": "966501234567", "status": "dispatching",
        "communication_kind": "registration_followup",
        "provider": "whatsflow",
        "provider_message_id": "system-id",
    })
    run(followups.note_outbound(
        "b1", "0501234567", "different-staff-id", "whatsflow"
    ))
    assert database.registration_requests.rows[0]["followup_status"] == "scheduled"
    run(followups.completed({
        "branch_id": "b1", "phone": "0501234567",
        "provider": "whatsflow", "provider_message_id": "system-id",
        "communication_kind": "registration_followup",
        "source_metadata": {"sequence": 1},
    }, "sent"))
    assert database.registration_requests.rows[0]["followup_status"] == "stopped"


def test_provider_completion_cannot_resurrect_racing_staff_stop(database):
    database.registration_requests.rows.append(request_doc(followup_status="stopped"))
    database["registration_followup_stops"].rows.append({
        "phone": "966501234567", "reason": "staff_contacted",
    })
    run(followups.completed({
        "branch_id": "b1", "phone": "0501234567",
        "communication_kind": "registration_followup",
        "source_metadata": {"sequence": 1},
    }, "sent"))
    row = database.registration_requests.rows[0]
    assert row["followup_status"] == "stopped"
    assert row["followup_sent_count"] == 0


def test_webhook_before_response_exact_id_reconciles_as_system(database):
    database.registration_requests.rows.append(request_doc())
    item = {
        "id": "item", "branch_id": "b1", "phone": "966501234567",
        "status": "dispatching", "provider": "whatsflow",
        "communication_kind": "registration_followup",
        "source_metadata": {"sequence": 1},
    }
    database["whatsapp_campaign_job_items"].rows.append(item)
    run(followups.note_outbound(
        "b1", item["phone"], "provider-system-id", "whatsflow"
    ))
    observation = database["registration_followup_outbound_observations"].rows[0]
    assert observation["status"] == "unresolved"
    assert run(followups.recheck_dispatch(item)) is False

    item["provider_message_id"] = "provider-system-id"
    run(followups.completed(item, "sent"))
    assert observation["status"] == "system"
    assert database.registration_requests.rows[0]["followup_status"] == "first_sent"
    assert not database["registration_followup_stops"].rows


def test_simultaneous_human_id_wins_over_exact_system_echo(database):
    database.registration_requests.rows.append(request_doc())
    item = {
        "id": "item", "branch_id": "b1", "phone": "966501234567",
        "status": "dispatching", "provider": "waha",
        "communication_kind": "registration_followup",
        "source_metadata": {"sequence": 1},
    }
    database["whatsapp_campaign_job_items"].rows.append(item)
    run(followups.note_outbound("b1", item["phone"], "system-id", "waha"))
    run(followups.note_outbound("b1", item["phone"], "human-id", "waha"))
    item["provider_message_id"] = "system-id"
    run(followups.completed(item, "sent"))
    resolutions = {
        row["provider_message_id"]: row["status"]
        for row in database["registration_followup_outbound_observations"].rows
    }
    assert resolutions == {"system-id": "system", "human-id": "staff_contact"}
    assert database.registration_requests.rows[0]["followup_status"] == "stopped"


def test_unknown_recovery_conservatively_stops_unmatched_observation(database):
    database.registration_requests.rows.append(request_doc())
    item = {
        "id": "item", "branch_id": "b1", "phone": "966501234567",
        "status": "dispatching", "provider": "whatsflow",
        "communication_kind": "registration_followup",
        "source_metadata": {"sequence": 1},
    }
    database["whatsapp_campaign_job_items"].rows.append(item)
    run(followups.note_outbound("b1", item["phone"], "unmatched-id", "whatsflow"))
    run(followups.completed(item, "unknown"))
    assert database["registration_followup_outbound_observations"].rows[0]["status"] == "staff_contact"
    assert database.registration_requests.rows[0]["followup_status"] == "stopped"


def test_followed_up_list_uses_contact_or_provider_accepted_send_across_statuses(database):
    database.registration_requests.rows.extend([
        request_doc(
            id="staff-pending",
            followup_stop_reason="contacted",
            followup_stopped_at="2026-01-02T08:00:00+00:00",
        ),
        request_doc(id="auto-processed", status="processed"),
        request_doc(
            id="both-archived",
            status="archived",
            followup_stop_reason="staff_contacted",
            followup_stopped_at="2026-01-03T08:00:00+00:00",
        ),
        request_doc(
            id="optout-only",
            followup_status="stopped",
            followup_stop_reason="opted_out",
        ),
    ])
    database["whatsapp_campaign_job_items"].rows.extend([
        {
            "id": "accepted-auto",
            "branch_id": "b1",
            "communication_kind": "registration_followup",
            "status": "sent",
            "source_metadata": {"request_ids": ["auto-processed", "both-archived"]},
            "sent_at": "2026-01-03T09:00:00+00:00",
        },
        {
            "id": "unknown-auto",
            "branch_id": "b1",
            "communication_kind": "registration_followup",
            "status": "unknown",
            "source_metadata": {"request_ids": ["optout-only"]},
            "sent_at": "2026-01-03T10:00:00+00:00",
        },
        {
            "id": "failed-auto",
            "branch_id": "b1",
            "communication_kind": "registration_followup",
            "status": "failed",
            "source_metadata": {"request_ids": ["optout-only"]},
            "sent_at": "2026-01-03T11:00:00+00:00",
        },
    ])

    rows = run(routes.list_registration_requests(
        status="followed_up",
        current_user={"is_admin": True},
    ))
    by_id = {row["id"]: row for row in rows}
    assert set(by_id) == {"staff-pending", "auto-processed", "both-archived"}
    assert by_id["staff-pending"]["followup_types"] == ["staff_contacted"]
    assert by_id["auto-processed"]["followup_types"] == ["automatic"]
    assert by_id["auto-processed"]["followup_automatic_sent_at"] == "2026-01-03T09:00:00+00:00"
    assert by_id["both-archived"]["followup_types"] == ["staff_contacted", "automatic"]
    assert by_id["both-archived"]["followup_staff_contacted_at"] == "2026-01-03T08:00:00+00:00"


def test_registration_request_list_masks_phone_without_existing_phone_permission(database):
    database.registration_requests.rows.append(request_doc(customer_phone="0501234567"))
    database.users.rows.append({"id": "staff-1", "permissions": []})
    rows = run(routes.list_registration_requests(
        status="pending",
        current_user={"is_admin": False, "user_id": "staff-1", "branch_id": "b1"},
    ))
    assert rows[0]["customer_phone"] == "050•••••67"
    assert rows[0]["customer_phone_masked"] is True


def test_contacted_request_stays_pending_and_keeps_followup_evidence(database):
    database.registration_requests.rows.append(request_doc(
        followup_stop_reason="contacted",
        followup_stopped_at="2026-01-02T08:00:00+00:00",
    ))
    rows = run(routes.list_registration_requests(
        status="pending",
        current_user={"is_admin": True},
    ))
    assert rows[0]["status"] == "pending"
    followed = run(routes.list_registration_requests(
        status="followed_up",
        current_user={"is_admin": True},
    ))
    assert followed[0]["followup_staff_contacted"] is True


def test_historical_processed_without_invoice_is_read_as_pending_without_mutation(database):
    database.registration_requests.rows.append(request_doc(status="processed"))
    rows = run(routes.list_registration_requests(
        status="pending",
        current_user={"is_admin": True},
    ))
    assert rows[0]["status"] == "pending"
    assert "invoice_id" not in rows[0]
    assert database.registration_requests.rows[0]["status"] == "processed"
    assert run(routes.count_pending_registration_requests(
        current_user={"is_admin": True},
    ))["count"] == 1


def test_successful_linked_invoice_is_processed_without_payment(database):
    database.registration_requests.rows.append(request_doc())
    database["invoices"].rows.append({
        "id": "invoice-r1",
        "registration_request_id": "r1",
        "status": "pending",
        "branch_id": "b1",
    })
    rows = run(routes.list_registration_requests(
        status="processed",
        current_user={"is_admin": True},
    ))
    assert rows[0]["status"] == "processed"
    assert rows[0]["invoice_id"] == "invoice-r1"
    assert run(routes.list_registration_requests(
        status="pending",
        current_user={"is_admin": True},
    )) == []


@pytest.mark.parametrize("invoice_status", ["cancelled", "failed"])
def test_cancelled_or_failed_invoice_leaves_request_pending(database, invoice_status):
    database.registration_requests.rows.append(request_doc(
        status="processed",
        invoice_id="invoice-r1",
    ))
    database["invoices"].rows.append({
        "id": "invoice-r1",
        "registration_request_id": "r1",
        "status": invoice_status,
        "branch_id": "b1",
    })
    rows = run(routes.list_registration_requests(
        status="pending",
        current_user={"is_admin": True},
    ))
    assert rows[0]["status"] == "pending"
    assert "invoice_id" not in rows[0]
    assert database.registration_requests.rows[0]["status"] == "processed"


def test_archived_request_stays_archived_during_read_normalization(database):
    database.registration_requests.rows.append(request_doc(
        status="archived",
        archived_from="processed",
    ))
    rows = run(routes.list_registration_requests(
        status="archived",
        current_user={"is_admin": True},
    ))
    assert rows[0]["status"] == "archived"
    assert rows[0]["archived_from"] == "pending"
    assert run(routes.list_registration_requests(
        status="pending",
        current_user={"is_admin": True},
    )) == []


def test_member_phone_reconciliation_keeps_independent_requests_pending(database):
    database.members.rows.extend([
        {"id": "m1", "branch_id": "b1", "phone": "٠٠٩٦٦ ٥٠ ١٢٣ ٤٥٦٧"},
        {"id": "m2", "branch_id": "b2", "phone": "0509999999"},
    ])
    database.registration_requests.rows.extend([
        request_doc(id="same-branch", customer_phone="+966-50-123-4567"),
        request_doc(id="other-branch", branch_id="b2",
                    customer_phone="٠٥٠١٢٣٤٥٦٧"),
        request_doc(id="already-rejected", status="rejected",
                    customer_phone="0501234567"),
    ])

    assert run(followups.reconcile_member_registration_requests()) == 0
    assert run(followups.archive_pending_for_member("b1", "0501234567")) == 0
    by_id = {row["id"]: row for row in database.registration_requests.rows}
    archived = by_id["same-branch"]
    assert archived["status"] == "pending"
    assert "archived_reason" not in archived
    assert archived["followup_status"] == "scheduled"
    assert by_id["other-branch"]["status"] == "pending"
    assert by_id["other-branch"]["followup_status"] == "scheduled"
    assert by_id["already-rejected"]["status"] == "rejected"


def test_restore_stays_pending_while_member_phone_match_remains(database):
    database.members.rows.append({
        "id": "m1", "branch_id": "b1", "phone": "+966501234567"
    })
    database.registration_requests.rows.append(request_doc(
        status="archived",
        archived_from="pending",
        archived_reason="member_phone_match_same_branch",
        followup_status="stopped",
        followup_stop_reason="request_closed",
    ))
    run(routes.update_registration_request(
        "r1",
        routes.RegistrationRequestUpdate(status="pending"),
        {"is_admin": False, "branch_id": "b1"},
    ))
    row = database.registration_requests.rows[0]
    assert row["status"] == "pending"
    assert row["archived_reason"] == "member_phone_match_same_branch"
    assert run(followups.reconcile_member_registration_requests()) == 0
    assert run(routes.count_pending_registration_requests(
        current_user={"is_admin": True},
    )) == {"count": 1}
    run(followups.schedule_due())
    assert row["status"] == "pending"
    assert row["followup_status"] == "stopped"  # restoring never re-enrolls


def test_public_request_stays_pending_when_branch_member_matches(database):
    database.branches.rows.append({"id": "b1"})
    database.members.rows.append({
        "id": "m1", "branch_id": "b1", "phone": "00966 50 123 4567"
    })
    payload = routes.PublicRegistrationCreate(
        customer_name="طفل جديد",
        customer_phone="٠٥٠١٢٣٤٥٦٧",
        age=8,
        nationality="سعودي",
        expected_start_date="2026-02-01",
    )
    result = run(routes.public_create_registration("b1", payload))
    assert result["success"] is True
    row = database.registration_requests.rows[0]
    assert row["status"] == "pending"
    assert "archived_reason" not in row
    assert row["followup_status"] == "scheduled"
    assert "invoice_id" not in row
    assert "member_id" not in row


def test_non_admin_list_reconciles_only_authorized_branch(database):
    database.members.rows.extend([
        {"id": "m1", "branch_id": "b1", "phone": "0501234567"},
        {"id": "m2", "branch_id": "b2", "phone": "0509999999"},
    ])
    database.registration_requests.rows.extend([
        request_doc(id="b1-request", branch_id="b1"),
        request_doc(id="b2-request", branch_id="b2",
                    customer_phone="0509999999",
                    followup_normalized_phone="966509999999"),
    ])
    rows = run(routes.list_registration_requests(
        status="pending",
        current_user={"is_admin": False, "branch_id": "b1"},
    ))
    assert [row["id"] for row in rows] == ["b1-request"]
    by_id = {row["id"]: row for row in database.registration_requests.rows}
    assert by_id["b1-request"]["status"] == "pending"
    assert by_id["b2-request"]["status"] == "pending"


def test_archived_phone_match_returns_all_current_same_branch_members_in_one_query(database):
    database.registration_requests.rows.append(request_doc(
        id="legacy-archive",
        status="archived",
        archived_from="pending",
        archived_reason="member_phone_match_same_branch",
    ))
    database.members.rows.extend([
        {
            "id": "m1", "branch_id": "b1", "phone": "+966 50 123 4567",
            "name_ar": "سارة", "name": "Sarah", "member_code": "M-1",
        },
        {
            "id": "m2", "branch_id": "b1", "phone": "٠٥٠١٢٣٤٥٦٧",
            "name": "Mohammed", "member_code": "M-2",
        },
        {
            "id": "wrong-branch", "branch_id": "b2", "phone": "0501234567",
            "name": "Private", "member_code": "M-X",
        },
    ])

    rows = run(routes.list_registration_requests(
        status="archived",
        current_user={"is_admin": True},
    ))

    assert rows[0]["matching_members"] == [
        {"id": "m1", "name": "سارة", "code": "M-1"},
        {"id": "m2", "name": "Mohammed", "code": "M-2"},
    ]
    assert set(rows[0]["matching_members"][0]) == {"id", "name", "code"}
    assert len(database.members.find_calls) == 1
    assert "member_id" not in database.registration_requests.rows[0]


def test_archived_phone_member_matches_require_members_permission(database):
    database.registration_requests.rows.append(request_doc(
        status="archived",
        archived_reason="member_phone_match_same_branch",
    ))
    database.members.rows.append({
        "id": "m1", "branch_id": "b1", "phone": "0501234567",
        "name": "Sarah",
    })
    database.users.rows.append({
        "id": "staff-1", "permissions": ["invoices", "member-phones"],
    })

    rows = run(routes.list_registration_requests(
        status="archived",
        current_user={
            "is_admin": False, "user_id": "staff-1", "branch_id": "b1",
            "permissions": ["invoices", "member-phones"],
        },
    ))

    assert "matching_members" not in rows[0]
    assert database.members.find_calls == []


@pytest.mark.parametrize("status", ["pending", "processed", "rejected", "archived"])
def test_member_links_available_for_every_request_status(database, status):
    database.members.rows.extend([
        {"id": "member", "branch_id": "b1", "phone": "+966501234567", "name": "Member"},
        {"id": "other", "branch_id": "b2", "phone": "0501234567", "name": "Other"},
    ])
    rows = [request_doc(status=status)]
    result = run(routes._attach_phone_matched_members(rows, {"is_admin": True}))
    assert result[0]["matching_members"] == [
        {"id": "member", "name": "Member", "code": ""},
    ]
    assert result[0]["status"] == status