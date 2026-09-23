import asyncio
import copy
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import pytest
from fastapi import HTTPException
from routes import day_extensions as mod
from utils.prepaid import roll_forward_member_prepaid
from utils.effective_periods import source_key


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _limit):
        return copy.deepcopy(self.rows)


class Collection:
    def __init__(self, rows):
        self.rows = list(rows)

    def find(self, _query, _projection=None, **_kwargs):
        return Cursor(self.rows)

    async def find_one(self, query, _projection=None, **_kwargs):
        return next(
            (copy.deepcopy(row) for row in self.rows
             if all(row.get(key) == value for key, value in query.items()
                    if not isinstance(value, dict))),
            None,
        )

    async def update_one(self, query, update, **_kwargs):
        for row in self.rows:
            if all(
                (row.get(key) != value["$ne"] if isinstance(value, dict) and "$ne" in value
                 else row.get(key) == value)
                for key, value in query.items()
            ):
                before = copy.deepcopy(row)
                row.update(copy.deepcopy(update.get("$set") or {}))
                for key in update.get("$unset") or {}:
                    row.pop(key, None)
                return SimpleNamespace(matched_count=1, modified_count=int(row != before))
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def insert_one(self, row, **_kwargs):
        self.rows.append(copy.deepcopy(row))

    async def replace_one(self, query, row, upsert=False, **_kwargs):
        for index, current in enumerate(self.rows):
            if current.get("source_key") == query.get("source_key"):
                self.rows[index] = copy.deepcopy(row)
                return SimpleNamespace(modified_count=1)
        if upsert:
            self.rows.append(copy.deepcopy(row))
            return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)


class Transaction:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        self.snapshot = {
            name: copy.deepcopy(getattr(self.db, name).rows)
            for name in self.db.collection_names
        }

    async def __aexit__(self, exc_type, _exc, _tb):
        if exc_type:
            for name, rows in self.snapshot.items():
                getattr(self.db, name).rows[:] = rows


class Session:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def start_transaction(self):
        return Transaction(self.db)


class Client:
    def __init__(self, db):
        self.db = db

    async def start_session(self):
        return Session(self.db)


class DB:
    def __init__(self, *, members, invoices, freezes=(), extensions=(), branches=()):
        self.members = Collection(members)
        self.invoices = Collection(invoices)
        self.member_freezes = Collection(freezes)
        self.day_extensions = Collection(extensions)
        self.branches = Collection(branches)
        self.subscription_effective_periods = Collection([])
        self.level_subscriptions = Collection([])
        self.closures = Collection([])
        self.extension_logs = Collection([])
        self.users = Collection([{"id": "u1", "is_admin": True}])
        self.collection_names = (
            "members", "invoices", "member_freezes", "day_extensions",
            "branches", "subscription_effective_periods", "closures",
            "level_subscriptions", "extension_logs", "users",
        )
        self._client = Client(self)


MON_WED = "الإثنين و الأربعاء - 5:00 م"
CLOSURE = {
    "id": "c1", "title_ar": "إغلاق", "start_date": "2026-09-23",
    "end_date": "2026-09-23", "scope": "all", "branch_id": "all",
    "stop_type": "full_day", "affected_times": [], "applied": False,
}


def member(end="2026-09-28", schedule=MON_WED, start="2026-09-01"):
    return {
        "id": "m1", "name": "Member", "branch_id": "b1",
        "activities": [{
            "activity_id": "a1", "activity_name": "Swim",
            "start_date": start, "end_date": end,
            "schedule": schedule, "status": "active",
            "source": "invoice", "source_id": "current",
        }],
    }


def invoice(invoice_id, start, end, schedule=MON_WED):
    return {
        "id": invoice_id, "member_id": "m1", "status": "paid",
        "items": [{
            "activity_id": "a1", "activity_name": "Swim",
            "start_date": start, "end_date": end, "schedule": schedule,
        }],
    }


def plan(monkeypatch, db, **kwargs):
    monkeypatch.setattr(mod, "db", db)
    data = mod.ExtensionApply(closure_id="c1", days=1, dry_run=True, **kwargs)
    return asyncio.run(mod._build_safe_extension_plan(data, CLOSURE))


def test_unordered_queries_and_generated_record_ids_do_not_change_preview(monkeypatch):
    second = member()
    second["id"] = "m2"
    second_invoice = invoice("second", "2026-09-01", "2026-09-28")
    second_invoice["member_id"] = "m2"
    fake = DB(members=[member(), second], invoices=[
        invoice("current", "2026-09-01", "2026-09-28"), second_invoice,
    ], freezes=[
        {"member_id": mid, "start_date": "2026-09-22", "end_date": "2026-09-22"}
        for mid in ("m1", "m2")
    ])
    before = plan(monkeypatch, fake)
    for name in fake.collection_names:
        getattr(fake, name).rows.reverse()
    after = plan(monkeypatch, fake)
    assert before["preview_token"] == after["preview_token"]
    assert before["public_members"] == after["public_members"]
    assert before["writes"][0]["records"][0]["id"] != after["writes"][0]["records"][0]["id"]


def test_delivery_and_audit_metadata_do_not_invalidate_preview(monkeypatch):
    inv = invoice("current", "2026-09-01", "2026-09-28")
    fake = DB(members=[member()], invoices=[inv])
    fake.subscription_effective_periods.rows.append({
        "source_key": source_key(inv, inv["items"][0], 0),
        "effective_start_date": "2026-09-01", "effective_end_date": "2026-09-28",
    })
    before = plan(monkeypatch, fake)
    fake.invoices.rows[0].update({
        "paid_at": "2026-09-23T10:00:00Z", "whatsapp_sent": True,
        "updated_at": "2026-09-23T10:00:00Z",
    })
    fake.subscription_effective_periods.rows[0]["updated_at"] = "2026-09-23T10:00:00Z"
    assert before["preview_token"] == plan(monkeypatch, fake)["preview_token"]


@pytest.mark.parametrize("edit", ["subscription", "invoice", "total", "freeze", "effective", "level", "closure"])
def test_meaningful_source_edits_rejected_inside_transaction(monkeypatch, edit):
    inv = invoice("current", "2026-09-01", "2026-09-28")
    fake = DB(members=[member()], invoices=[inv])
    fake.closures.rows.append(copy.deepcopy(CLOSURE))
    before = plan(monkeypatch, fake)
    if edit == "subscription":
        fake.members.rows[0]["activities"][0]["end_date"] = "2026-09-30"
    elif edit == "invoice":
        fake.invoices.rows[0]["items"][0]["end_date"] = "2026-09-30"
    elif edit == "total":
        fake.invoices.rows[0]["total"] = 200
    elif edit == "freeze":
        fake.member_freezes.rows.append({"member_id": "m1", "start_date": "2026-09-23", "end_date": "2026-09-23"})
    elif edit == "effective":
        fake.subscription_effective_periods.rows.append({
            "source_key": source_key(inv, inv["items"][0], 0),
            "effective_start_date": "2026-09-02", "effective_end_date": "2026-09-30",
        })
    elif edit == "level":
        fake.level_subscriptions.rows.append({"id": "ls1", "member_id": "m1", "activity_id": "a1", "start_date": "2026-09-01", "end_date": "2026-09-29"})
    else:
        fake.closures.rows[0]["end_date"] = "2026-09-24"
    snapshot = copy.deepcopy(fake.members.rows)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(mod._commit_safe_extension_plan(
            mod.ExtensionApply(closure_id="c1", days=1), CLOSURE,
            {"username": "admin"}, before["preview_token"],
        ))
    assert caught.value.status_code == 409
    assert fake.members.rows == snapshot
    assert fake.day_extensions.rows == []
    assert not fake.closures.rows[0]["applied"]


def test_excluded_member_preview_commits_only_reviewed_set(monkeypatch):
    second = member()
    second["id"] = "m2"
    inv2 = invoice("second", "2026-09-01", "2026-09-28")
    inv2["member_id"] = "m2"
    fake = DB(members=[member(), second], invoices=[
        invoice("current", "2026-09-01", "2026-09-28"), inv2,
    ])
    fake.closures.rows.append(copy.deepcopy(CLOSURE))
    all_members = plan(monkeypatch, fake)
    reviewed = plan(monkeypatch, fake, excluded_member_ids=["m2"])
    assert reviewed["preview_token"] != all_members["preview_token"]
    user = {"user_id": "u1", "username": "admin", "is_admin": True}
    with pytest.raises(HTTPException) as caught:
        asyncio.run(mod.apply_extension(mod.ExtensionApply(
            closure_id="c1", days=1, excluded_member_ids=["m2"],
            preview_token=all_members["preview_token"],
        ), user))
    assert caught.value.status_code == 409
    asyncio.run(mod.apply_extension(mod.ExtensionApply(
        closure_id="c1", days=1, excluded_member_ids=["m2"],
        preview_token=reviewed["preview_token"],
    ), user))
    assert [r["member_id"] for r in fake.day_extensions.rows] == ["m1"]
    assert fake.members.rows[1]["activities"][0]["end_date"] == "2026-09-28"


def test_actual_missed_session_extends_to_next_personal_occurrence(monkeypatch):
    result = plan(monkeypatch, DB(
        members=[member()],
        invoices=[invoice("current", "2026-09-01", "2026-09-28")],
        branches=[{"id": "b1", "name": "Branch"}],
    ))
    row = result["public_members"][0]
    assert row["branch_id"] == "b1"
    assert row["branch_name"] == "Branch"
    assert row["activity_changes"] == [{
        "activity_id": "a1", "activity_name": "Swim",
        "old_end_date": "2026-09-28", "new_end_date": "2026-09-30",
        "missed_sessions": 1,
    }]
    assert row["deferred_periods"] == []


def test_overlapping_prepaid_period_shifts_and_invoice_stays_immutable(monkeypatch):
    invoices = [
        invoice("current", "2026-09-01", "2026-09-28"),
        invoice("next", "2026-09-30", "2026-10-27"),
    ]
    original = copy.deepcopy(invoices)
    result = plan(monkeypatch, DB(members=[member()], invoices=invoices))
    deferred = result["public_members"][0]["deferred_periods"]
    assert deferred[0]["invoice_id"] == "next"
    assert deferred[0]["new_start_date"] == "2026-10-05"
    assert deferred[0]["new_end_date"] == "2026-10-28"
    assert invoices == original
    effective = result["writes"][0]["effective_rows"]
    assert next(r for r in effective if r["source_invoice_id"] == "next")[
        "source_bound_quota"
    ] is True


def test_non_overlapping_prepaid_period_is_unchanged(monkeypatch):
    result = plan(monkeypatch, DB(
        members=[member()],
        invoices=[
            invoice("current", "2026-09-01", "2026-09-28"),
            invoice("next", "2026-10-05", "2026-11-01"),
        ],
    ))
    assert result["public_members"][0]["deferred_periods"] == []


def test_future_expired_frozen_duplicate_and_unknown_schedule_are_not_compensated(monkeypatch):
    cases = [
        DB(members=[member(end="2026-09-22")], invoices=[invoice("current", "2026-09-01", "2026-09-22")]),
        DB(members=[member(start="2026-09-24")], invoices=[invoice("current", "2026-09-24", "2026-10-21")]),
        DB(members=[member()], invoices=[invoice("current", "2026-09-01", "2026-09-28")],
           freezes=[{"member_id": "m1", "status": "active", "start_date": "2026-09-23", "end_date": "2026-09-23"}]),
        DB(members=[member()], invoices=[invoice("current", "2026-09-01", "2026-09-28")],
           extensions=[{"member_id": "m1", "activity_id": "a1", "compensated_dates": ["2026-09-23"]}]),
        DB(members=[member(schedule="")], invoices=[invoice("current", "2026-09-01", "2026-09-28", schedule="")]),
    ]
    for fake in cases:
        result = plan(monkeypatch, fake)
        assert result["public_members"] == []


def test_preview_token_changes_with_exclusions(monkeypatch):
    fake = DB(
        members=[member()],
        invoices=[invoice("current", "2026-09-01", "2026-09-28")],
    )
    first = plan(monkeypatch, fake)
    excluded = plan(monkeypatch, fake, excluded_member_ids=["m1"])
    assert first["preview_token"] != excluded["preview_token"]
    assert excluded["public_members"] == []


def test_structured_day_time_is_authoritative_for_specific_time(monkeypatch):
    structured = member(schedule="Sunday - 9:00 AM")
    structured["activities"][0]["training_days"] = ["Monday", "Wednesday"]
    structured["activities"][0]["day_times"] = {
        "Monday": "5:00 PM", "Wednesday": "7:00 PM",
    }
    closure = {**CLOSURE, "stop_type": "specific_times", "affected_times": ["7:00 PM"]}
    fake = DB(
        members=[structured],
        invoices=[invoice("current", "2026-09-01", "2026-09-28")],
    )
    monkeypatch.setattr(mod, "db", fake)
    result = asyncio.run(mod._build_safe_extension_plan(
        mod.ExtensionApply(closure_id="c1", days=1, dry_run=True), closure
    ))
    assert result["public_members"][0]["activity_changes"][0]["missed_sessions"] == 1
    assert mod._normalize_time(16) == mod._normalize_time("16:00")
    assert mod._normalize_time("4 م") == mod._normalize_time("4:00 PM") == "16:00"


def test_family_invoice_item_cannot_bind_to_wrong_member(monkeypatch):
    family_invoice = invoice("current", "2026-09-01", "2026-09-28")
    family_invoice["member_id"] = "parent"
    family_invoice["items"][0]["member_id"] = "other-child"
    result = plan(monkeypatch, DB(members=[member()], invoices=[family_invoice]))
    assert result["public_members"] == []


def test_unknown_overlapping_future_schedule_skips_current_change(monkeypatch):
    result = plan(monkeypatch, DB(
        members=[member()],
        invoices=[
            invoice("current", "2026-09-01", "2026-09-28"),
            invoice("next", "2026-09-30", "2026-10-27", schedule="not-a-day"),
        ],
    ))
    assert result["public_members"] == []
    assert "member skipped" in result["skipped_members"][0]["reason"]
    assert result["writes"] == []


def test_past_closure_still_compensates_when_inside_subscription(monkeypatch):
    closure = {
        **CLOSURE, "start_date": "2026-09-16", "end_date": "2026-09-16",
    }
    fake = DB(
        members=[member()],
        invoices=[invoice("current", "2026-09-01", "2026-09-28")],
    )
    monkeypatch.setattr(mod, "db", fake)
    result = asyncio.run(mod._build_safe_extension_plan(
        mod.ExtensionApply(closure_id="c1", days=1, dry_run=True), closure
    ))
    assert result["public_members"][0]["activity_changes"][0]["missed_sessions"] == 1


def test_prepaid_uses_effective_dates_and_earliest_period():
    current = invoice("current", "2026-09-01", "2026-09-28")
    october = invoice("oct", "2026-09-30", "2026-10-27")
    november = invoice("nov", "2026-10-28", "2026-11-24")
    oct_item = october["items"][0]
    oct_key = source_key(october, oct_item, 0)
    member_doc = member(end="2026-09-30")
    db = DB(members=[member_doc], invoices=[current, october, november])
    db.subscription_effective_periods = Collection([{
        "source_key": oct_key,
        "effective_start_date": "2026-10-05",
        "effective_end_date": "2026-10-28",
    }])
    changes = asyncio.run(roll_forward_member_prepaid(
        db, member_doc, today="2026-11-01"
    ))
    assert changes[0]["invoice_id"] == "oct"
    activity = member_doc["activities"][0]
    assert activity["start_date"] == "2026-10-05"
    assert activity["end_date"] == "2026-10-28"
    assert activity["source_period_key"] == oct_key


def test_apply_revalidates_sources_in_transaction_and_retry_is_idempotent(monkeypatch):
    fake = DB(
        members=[member()],
        invoices=[invoice("current", "2026-09-01", "2026-09-28")],
        branches=[{"id": "b1", "name": "Branch"}],
    )
    fake.closures.rows.append(copy.deepcopy(CLOSURE))
    monkeypatch.setattr(mod, "db", fake)
    preview = asyncio.run(mod.apply_extension(
        mod.ExtensionApply(closure_id="c1", days=1, dry_run=True),
        {"user_id": "u1", "username": "admin", "is_admin": True},
    ))
    applied = asyncio.run(mod.apply_extension(
        mod.ExtensionApply(
            closure_id="c1", days=1, preview_token=preview["preview_token"]
        ),
        {"user_id": "u1", "username": "admin", "is_admin": True},
    ))
    assert applied["days"] == 1
    assert len(fake.day_extensions.rows) == 1
    assert fake.members.rows[0]["activities"][0]["end_date"] == "2026-09-30"
    retry = asyncio.run(mod.apply_extension(
        mod.ExtensionApply(
            closure_id="c1", days=1, preview_token=preview["preview_token"]
        ),
        {"user_id": "u1", "username": "admin", "is_admin": True},
    ))
    assert retry["applied"] is True
    assert len(fake.day_extensions.rows) == 1


def test_new_apply_requires_preview_token(monkeypatch):
    fake = DB(
        members=[member()],
        invoices=[invoice("current", "2026-09-01", "2026-09-28")],
    )
    fake.closures.rows.append(copy.deepcopy(CLOSURE))
    monkeypatch.setattr(mod, "db", fake)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(mod.apply_extension(
            mod.ExtensionApply(closure_id="c1", days=1),
            {"user_id": "u1", "username": "admin", "is_admin": True},
        ))
    assert caught.value.status_code == 409
    assert fake.members.rows[0]["activities"][0]["end_date"] == "2026-09-28"


def test_shared_level_subscription_is_updated_once(monkeypatch):
    person = member()
    person["activities"][0]["level_id"] = "shared"
    other = copy.deepcopy(person["activities"][0])
    other["activity_id"] = "a2"
    person["activities"].append(other)
    inv = invoice("current", "2026-09-01", "2026-09-28")
    inv["items"].append({**inv["items"][0], "activity_id": "a2"})
    fake = DB(members=[person], invoices=[inv])
    fake.level_subscriptions.rows.append({
        "_id": "mongo-level", "id": "ls1", "member_id": "m1", "level_id": "shared",
        "start_date": "2026-09-01", "end_date": "2026-09-28",
    })
    fake.closures.rows.append(copy.deepcopy(CLOSURE))
    reviewed = plan(monkeypatch, fake)
    asyncio.run(mod._commit_safe_extension_plan(
        mod.ExtensionApply(closure_id="c1", days=1), CLOSURE,
        {"username": "admin"}, reviewed["preview_token"],
    ))
    assert fake.level_subscriptions.rows[0]["end_date"] == "2026-09-30"
    assert len(fake.day_extensions.rows) == 2
    assert fake.closures.rows[0]["applied"]


def test_apply_keeps_matching_level_subscription_deadline_in_sync(monkeypatch):
    fake = DB(
        members=[member()],
        invoices=[invoice("current", "2026-09-01", "2026-09-28")],
    )
    fake.level_subscriptions.rows.append({
        "id": "ls1", "member_id": "m1", "activity_id": "a1",
        "start_date": "2026-09-01", "end_date": "2026-09-28",
    })
    fake.closures.rows.append(copy.deepcopy(CLOSURE))
    monkeypatch.setattr(mod, "db", fake)
    preview = asyncio.run(mod.apply_extension(
        mod.ExtensionApply(closure_id="c1", days=1, dry_run=True),
        {"user_id": "u1", "username": "admin", "is_admin": True},
    ))
    asyncio.run(mod.apply_extension(
        mod.ExtensionApply(
            closure_id="c1", days=1, preview_token=preview["preview_token"]
        ),
        {"user_id": "u1", "username": "admin", "is_admin": True},
    ))
    assert fake.level_subscriptions.rows[0]["end_date"] == "2026-09-30"


def test_source_race_returns_409_without_writes(monkeypatch):
    fake = DB(
        members=[member()],
        invoices=[invoice("current", "2026-09-01", "2026-09-28")],
    )
    fake.closures.rows.append(copy.deepcopy(CLOSURE))
    monkeypatch.setattr(mod, "db", fake)
    preview = asyncio.run(mod.apply_extension(
        mod.ExtensionApply(closure_id="c1", days=1, dry_run=True),
        {"user_id": "u1", "username": "admin", "is_admin": True},
    ))
    fake.invoices.rows[0]["items"][0]["schedule"] = "الإثنين - 5:00 م"
    with pytest.raises(HTTPException) as caught:
        asyncio.run(mod._commit_safe_extension_plan(
            mod.ExtensionApply(closure_id="c1", days=1),
            copy.deepcopy(CLOSURE),
            {"user_id": "u1", "username": "admin", "is_admin": True},
            preview["preview_token"],
        ))
    assert caught.value.status_code == 409
    assert fake.members.rows[0]["activities"][0]["end_date"] == "2026-09-28"
    assert fake.day_extensions.rows == []
    assert fake.subscription_effective_periods.rows == []


def test_transaction_rolls_back_member_when_record_insert_fails(monkeypatch):
    fake = DB(
        members=[member()],
        invoices=[invoice("current", "2026-09-01", "2026-09-28")],
    )
    fake.closures.rows.append(copy.deepcopy(CLOSURE))
    monkeypatch.setattr(mod, "db", fake)
    data = mod.ExtensionApply(closure_id="c1", days=1)
    preview_plan = asyncio.run(mod._build_safe_extension_plan(data, CLOSURE))

    async def fail_insert(_row, **_kwargs):
        raise RuntimeError("record write failed")

    fake.day_extensions.insert_one = fail_insert
    with pytest.raises(RuntimeError, match="record write failed"):
        asyncio.run(mod._commit_safe_extension_plan(
            data, copy.deepcopy(CLOSURE),
            {"user_id": "u1", "username": "admin", "is_admin": True},
            preview_plan["preview_token"],
        ))
    assert fake.members.rows[0]["activities"][0]["end_date"] == "2026-09-28"
    assert fake.closures.rows[0]["applied"] is False
    assert fake.subscription_effective_periods.rows == []