"""Schedule edits use reviewed future opportunities, not unused attendance."""
import asyncio
import copy
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from utils.schedule_changes import build_plan, commit_plan, protect_schedule_edit
from utils.effective_periods import source_key


def matches(row, query):
    for key, value in query.items():
        if key == "$or":
            if not any(matches(row, q) for q in value):
                return False
            continue
        actual = row.get(key)
        if isinstance(value, dict):
            for operator, operand in value.items():
                if operator == "$in" and actual not in operand:
                    return False
                if operator == "$gte" and (actual or "") < operand:
                    return False
        elif actual != value:
            return False
    return True


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, limit):
        return copy.deepcopy(self.rows)


class Collection:
    def __init__(self, rows=()):
        self.rows = copy.deepcopy(list(rows))
        self.writes = 0

    def find(self, query, projection=None, **kwargs):
        return Cursor([r for r in self.rows if matches(r, query)])

    async def find_one(self, query, projection=None, **kwargs):
        rows = await self.find(query).to_list(None)
        return rows[0] if rows else None

    async def update_one(self, query, change, **kwargs):
        for row in self.rows:
            if matches(row, query):
                row.update(copy.deepcopy(change["$set"]))
                self.writes += 1
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def replace_one(self, query, replacement, **kwargs):
        for n, row in enumerate(self.rows):
            if matches(row, query):
                self.rows[n] = copy.deepcopy(replacement)
                self.writes += 1
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def insert_one(self, row, **kwargs):
        self.rows.append(copy.deepcopy(row))
        self.writes += 1


class Transaction:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        self.backup = {k: copy.deepcopy(v.rows) for k, v in vars(self.db).items() if isinstance(v, Collection)}
        return self

    async def __aexit__(self, typ, value, traceback):
        if typ:
            for name, rows in self.backup.items():
                getattr(self.db, name).rows = rows


class Session:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def start_transaction(self, **kwargs):
        return Transaction(self.db)


class DB:
    async def start_session(self):
        return Session(self)

    @property
    def client(self):
        return self


def fixture():
    item = {"activity_id": "a", "start_date": "2026-09-09", "end_date": "2026-10-06",
            "schedule": "monday tuesday"}
    invoice = {"id": "invoice", "member_id": "m", "status": "paid", "items": [item]}
    key = source_key(invoice, item, 0)
    old = {**item, "end_date": "2026-09-30", "schedule": "monday wednesday",
           "source": "invoice", "source_id": "invoice", "source_period_key": key,
           "level_id": "l"}
    member = {"id": "m", "branch_id": "b", "activities": [old]}
    records = [{"id": str(i), "date": f"2026-09-{d}", "member_id": "m", "activity_id": "a"}
               for i, d in enumerate(("09", "14", "16", "21"))]
    records[0].update(off_schedule=True, end_shift_from="2026-10-06", end_shift_to="2026-10-05")
    records[2].update(off_schedule=True, end_shift_from="2026-10-05", end_shift_to="2026-09-29")
    db = DB()
    db.members = Collection([member])
    db.invoices = Collection([invoice])
    db.attendance = Collection(records)
    db.closures = Collection([{"id": "c", "branch_id": "b", "start_date": "2026-09-23",
                              "end_date": "2026-09-23", "applied": True}])
    db.member_freezes = Collection()
    db.level_subscriptions = Collection([{"id": "ls", "member_id": "m", "level_id": "l", "end_date": "2026-10-07"}])
    db.subscription_effective_periods = Collection([{
        "source_key": key, "effective_start_date": "2026-09-09", "effective_end_date": "2026-09-30",
        "original_start_date": "2026-09-09", "original_end_date": "2026-10-06"}])
    db.audit_logs = Collection()
    payload = {"activity": copy.deepcopy(old), "mode": "retrospective_correction", "reason": "Correct original weekdays"}
    return db, member, payload


def run_plan(db, member, payload):
    return asyncio.run(build_plan(db, member, "a", payload, today=date(2026, 9, 24)))


def test_original_case_restores_only_proven_deductions_without_mutations():
    db, member, payload = fixture()
    before = copy.deepcopy(member)
    result = run_plan(db, member, payload)
    assert result["public"]["future_dates"] == ["2026-09-28", "2026-09-30", "2026-10-05", "2026-10-07"]
    assert result["public"]["new_end_date"] == "2026-10-07"
    assert (result["public"]["total_allowed"], result["public"]["used_sessions"]) == (8, 4)
    assert result["after"]["schedule_reconciliation"]["neutralized_attendance_ids"] == ["0", "2"]
    assert member == before
    assert all(v.writes == 0 for v in vars(db).values() if isinstance(v, Collection))


def test_future_only_does_not_reverse_history_or_compensate_absence():
    db, member, payload = fixture()
    payload["mode"] = "future_only"
    payload["activity"]["schedule"] = "thursday"
    result = run_plan(db, member, payload)
    assert result["public"]["future_dates"] == ["2026-09-24", "2026-10-01"]
    assert result["public"]["total_allowed"] == 8  # not four, despite one weekday
    assert result["public"]["remaining"] == 4
    assert result["after"]["schedule_reconciliation"]["neutralized_attendance_ids"] == []


def test_elapsed_absence_is_not_replaced():
    db, member, payload = fixture()
    payload["mode"] = "future_only"
    db.attendance.rows = []  # Eight unused sessions does not mean eight future ones.
    payload["activity"]["schedule"] = "thursday"
    result = run_plan(db, member, payload)
    assert result["public"]["remaining"] == 8
    assert len(result["public"]["future_dates"]) == 2


def test_noop_preserves_deadline():
    db, member, payload = fixture()
    payload["mode"] = "future_only"
    assert run_plan(db, member, payload)["public"]["new_end_date"] == "2026-09-30"


def test_closure_freeze_excluded_without_double_award():
    db, member, payload = fixture()
    db.closures.rows.append({"id": "later", "branch_id": "b", "start_date": "2026-09-28", "end_date": "2026-09-28"})
    db.member_freezes.rows.append({"id": "f", "member_id": "m", "status": "active",
                                  "start_date": "2026-10-05", "end_date": "2026-10-05"})
    result = run_plan(db, member, payload)
    # Only one existing future opportunity survives + two proven deductions.
    assert result["public"]["future_dates"] == ["2026-09-30", "2026-10-07", "2026-10-12"]


def test_projection_does_not_overwrite_or_overlap_prepaid_renewal():
    db, member, payload = fixture()
    db.invoices.rows.append({"id": "renewal", "member_id": "m", "status": "paid", "items": [{
        "activity_id": "a", "start_date": "2026-10-01", "end_date": "2026-10-28",
        "schedule": "monday wednesday",
    }]})
    with pytest.raises(HTTPException) as exc:
        run_plan(db, member, payload)
    assert exc.value.status_code == 409


def test_prior_manual_repair_without_exact_shift_ids_blocks_second_award():
    db, member, payload = fixture()
    member["activities"][0]["end_date"] = "2026-10-07"
    payload["activity"]["end_date"] = "2026-10-07"
    # An elapsed absence leaves spare paid quota: min(total-used) alone cannot
    # prevent the old September deductions from being restored a second time.
    db.attendance.rows.pop(1)
    db.audit_logs.rows.append({
        "id": "manual", "action": "subscription.manual_expiry_repair",
        "entity_id": "m:a", "extra": {"source_period_key": member["activities"][0]["source_period_key"]},
        "before": {"end_date": "2026-09-30"}, "after": {"end_date": "2026-10-07"},
    })
    with pytest.raises(HTTPException) as exc:
        run_plan(db, member, payload)
    assert exc.value.status_code == 409
    assert "يدويًا" in exc.value.detail
    assert member["activities"][0]["end_date"] == "2026-10-07"
    assert all(v.writes == 0 for v in vars(db).values() if isinstance(v, Collection))


def test_exact_manual_repair_shift_evidence_prevents_double_restoration():
    db, member, payload = fixture()
    member["activities"][0]["end_date"] = "2026-10-07"
    payload["activity"]["end_date"] = "2026-10-07"
    db.attendance.rows.pop(1)
    db.audit_logs.rows.append({
        "id": "manual", "action": "subscription.manual_expiry_repair", "member_id": "m",
        "activity_id": "a", "source_period_key": member["activities"][0]["source_period_key"],
        "extra": {"neutralized_attendance_ids": ["0", "2"]},
    })
    result = run_plan(db, member, payload)
    assert result["public"]["new_end_date"] == "2026-10-07"
    assert len(result["public"]["future_dates"]) == 4
    assert result["public"]["remaining"] == 5
    assert result["after"]["schedule_reconciliation"]["neutralized_attendance_ids"] == ["0", "2"]


def test_manual_repair_evidence_invalidates_future_preview_and_excludes_other_period():
    db, member, payload = fixture()
    payload["mode"] = "future_only"
    before = run_plan(db, member, payload)["public"]["preview_token"]
    db.audit_logs.rows.append({
        "id": "old", "action": "subscription.manual_expiry_repair", "entity_id": "m:a",
        "source_id": "different-invoice",
    })
    assert run_plan(db, member, payload)["public"]["preview_token"] == before
    db.audit_logs.rows.append({
        "id": "new", "action": "subscription.manual_expiry_repair", "entity_id": "m:a",
        "source_id": "invoice",
    })
    assert run_plan(db, member, payload)["public"]["preview_token"] != before


@pytest.mark.parametrize("damage", ["missing_shift", "wrong_shift", "ambiguous_source", "partial_closure", "shared_level"])
def test_uncertainty_blocks(damage):
    db, member, payload = fixture()
    if damage == "missing_shift":
        db.attendance.rows[0].pop("end_shift_from")
    elif damage == "wrong_shift":
        db.attendance.rows[0]["end_shift_to"] = "2026-10-01"
    elif damage == "ambiguous_source":
        member["activities"][0].pop("source_period_key")
        db.invoices.rows[0]["items"].append(copy.deepcopy(db.invoices.rows[0]["items"][0]))
    elif damage == "partial_closure":
        db.closures.rows.append({"branch_id": "b", "end_date": "2026-09-30", "stop_type": "specific_time"})
    else:
        member["activities"].append({"activity_id": "other", "level_id": "l"})
    with pytest.raises(HTTPException) as exc:
        run_plan(db, member, payload)
    assert exc.value.status_code == 409


def test_legacy_guards_and_real_renewal():
    old = {"schedule": "monday tuesday", "start_date": "2026-09-09",
           "end_date": "2026-10-06", "source_id": "first"}
    with pytest.raises(HTTPException):
        protect_schedule_edit(old, {**old, "schedule": "monday wednesday"})
    protect_schedule_edit(old, {**old, "source_id": "next", "start_date": "2026-10-07",
                                "schedule": "monday wednesday"})


def test_commit_sync_and_stale_retry(monkeypatch):
    import utils.schedule_changes as service
    real_build = service.build_plan

    async def fixed_build(*args, **kwargs):
        kwargs["today"] = date(2026, 9, 24)
        return await real_build(*args, **kwargs)

    monkeypatch.setattr(service, "build_plan", fixed_build)
    db, member, payload = fixture()
    original_invoice, original_attendance = copy.deepcopy(db.invoices.rows), copy.deepcopy(db.attendance.rows)
    payload["preview_token"] = run_plan(db, member, payload)["public"]["preview_token"]
    asyncio.run(commit_plan(db, {"id": "m", "branch_id": "b"}, "a", payload, {"user_id": "staff"}))
    assert db.members.rows[0]["activities"][0]["end_date"] == "2026-10-07"
    assert db.subscription_effective_periods.rows[0]["effective_end_date"] == "2026-10-07"
    assert db.level_subscriptions.rows[0]["end_date"] == "2026-10-07"
    assert db.invoices.rows == original_invoice
    assert db.attendance.rows == original_attendance
    assert len(db.audit_logs.rows) == 1
    with pytest.raises(HTTPException):
        asyncio.run(commit_plan(db, {"id": "m"}, "a", payload, {}))
    assert len(db.audit_logs.rows) == 1
    # A new preview of the already corrected period does not reverse twice.
    fresh = db.members.rows[0]
    payload["activity"] = copy.deepcopy(fresh["activities"][0])
    again = run_plan(db, fresh, payload)
    assert again["public"]["new_end_date"] == "2026-10-07"


def test_stale_attendance_aborts_and_crossbranch_hidden(monkeypatch):
    import utils.schedule_changes as service
    real_build = service.build_plan

    async def fixed_build(*args, **kwargs):
        return await real_build(*args, **kwargs, today=date(2026, 9, 24))

    monkeypatch.setattr(service, "build_plan", fixed_build)
    db, member, payload = fixture()
    payload["preview_token"] = run_plan(db, member, payload)["public"]["preview_token"]
    db.attendance.rows.pop()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(commit_plan(db, {"id": "m"}, "a", payload, {}))
    assert exc.value.status_code == 409
    assert not db.audit_logs.rows
    with pytest.raises(HTTPException) as exc:
        asyncio.run(commit_plan(db, {"id": "m", "branch_id": "other"}, "a", payload, {}))
    assert exc.value.status_code == 404


def test_endpoint_permission_denied_before_lookup(monkeypatch):
    from routes import members
    calls = []

    async def deny(user, permission):
        calls.append(permission)
        raise HTTPException(403, detail="permission denied")

    monkeypatch.setattr(members, "require_permission", deny)
    db, member, payload = fixture()
    payload["activity"]["activity_name"] = "Swimming"
    request = members.ScheduleChangeRequest(**payload)
    for endpoint in (members.preview_schedule_change, members.confirm_schedule_change):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(endpoint("m", "a", request, current_user={"user_id": "staff"}))
        assert exc.value.status_code == 403
    assert calls == ["members-edit", "members-edit"]


def test_admin_preview_and_crossbranch_route(monkeypatch):
    from routes import members
    import utils.schedule_changes as service
    db, member, payload = fixture()
    payload["activity"]["activity_name"] = "Swimming"
    request = members.ScheduleChangeRequest(**payload)
    real_build = service.build_plan

    async def fixed_build(*args, **kwargs):
        return await real_build(*args, **kwargs, today=date(2026, 9, 24))

    monkeypatch.setattr(service, "build_plan", fixed_build)
    monkeypatch.setattr(members, "db", db)
    preview = asyncio.run(members.preview_schedule_change("m", "a", request, current_user={"is_admin": True}))
    assert preview["total_allowed"] == 8
    # Model a permission-authorized non-admin; branch guard still hides member.
    async def permitted(*args):
        return None
    monkeypatch.setattr(members, "require_permission", permitted)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(members.preview_schedule_change("m", "a", request, current_user={"branch_id": "other"}))
    assert exc.value.status_code == 404


def test_deleting_neutralized_shift_after_renewal_does_not_extend_new_period(monkeypatch):
    from routes import attendance as route
    db, member, payload = fixture()
    # The renewed profile no longer carries the old period's correction metadata.
    db.members.rows[0]["activities"][0]["end_date"] = "2026-11-07"
    lookups = []

    async def recorded_correction(query, projection=None):
        lookups.append(query)
        return {"id": "durable-correction"}

    async def delete_record(query):
        db.attendance.rows = [r for r in db.attendance.rows if r["id"] != query["id"]]
        return SimpleNamespace(deleted_count=1)

    monkeypatch.setattr(db.audit_logs, "find_one", recorded_correction)
    monkeypatch.setattr(db.attendance, "delete_one", delete_record, raising=False)
    monkeypatch.setattr(route, "db", db)
    asyncio.run(route.delete_attendance("0", current_user={"is_admin": True}))
    assert db.members.rows[0]["activities"][0]["end_date"] == "2026-11-07"
    assert db.members.writes == 0
    assert lookups[0]["after.schedule_reconciliation.neutralized_attendance_ids"] == "0"


def test_conflicting_effective_row_rolls_back_member_write(monkeypatch):
    import utils.schedule_changes as service
    db, member, payload = fixture()
    real_build = service.build_plan

    async def fixed_build(*args, **kwargs):
        return await real_build(*args, **kwargs, today=date(2026, 9, 24))

    async def conflict(*args, **kwargs):
        return SimpleNamespace(matched_count=0)

    monkeypatch.setattr(service, "build_plan", fixed_build)
    monkeypatch.setattr(db.subscription_effective_periods, "replace_one", conflict)
    payload["preview_token"] = run_plan(db, member, payload)["public"]["preview_token"]
    with pytest.raises(HTTPException) as exc:
        asyncio.run(commit_plan(db, {"id": "m"}, "a", payload, {}))
    assert exc.value.status_code == 409
    assert db.members.rows[0]["activities"][0]["end_date"] == "2026-09-30"
    assert not db.audit_logs.rows