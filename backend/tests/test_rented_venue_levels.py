import asyncio
import copy
from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from models.branch import BookingSlot, BranchCreate
import routes.branches as branches_mod
import routes.levels as levels_mod


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _dates():
    today = date.today()
    return (
        (today - timedelta(days=2)).isoformat(),
        (today + timedelta(days=2)).isoformat(),
    )


def _branch(**changes):
    start_date, end_date = _dates()
    doc = {
        "id": "branch-rented",
        "branch_type": "rented",
        "venues": [{
            "id": "venue-1",
            "name": "Court 1",
            "size": "20x40",
            "booking_slots": [{
                "id": "slot-1",
                "day": "monday",
                "start_time": "17:00",
                "end_time": "18:00",
                "start_date": start_date,
                "end_date": end_date,
                "cost": 100,
                "cost_type": "hourly",
            }],
        }],
    }
    doc.update(changes)
    return doc


def _legacy_rented_branch(**changes):
    """Build the venue shape stored before ``venues`` was introduced."""
    branch = _branch()
    branch["rented_venues"] = branch.pop("venues")
    branch.update(changes)
    return branch


def _level(**changes):
    data = {
        "level_number": 1,
        "activity_name": "Swimming",
        "branch_id": "branch-rented",
        "days": ["monday"],
        "time_slot": "5:00 PM",
        "venue_id": "venue-1",
        "booking_slot_id": "slot-1",
    }
    data.update(changes)
    return levels_mod.LevelCreate(**data)


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, _limit):
        return list(self.docs)


class _Collection:
    def __init__(self, docs):
        self.docs = list(docs)

    async def find_one(self, query, *_args, **_kwargs):
        return next((dict(doc) for doc in self.docs if _matches(doc, query)), None)

    def find(self, query, *_args, **_kwargs):
        results = []
        for doc in self.docs:
            if doc.get("branch_id") != query.get("branch_id"):
                continue
            if doc.get("venue_id") != query.get("venue_id"):
                continue
            if doc.get("is_active", True) is False:
                continue
            excluded = query.get("id", {}).get("$ne")
            if excluded and doc.get("id") == excluded:
                continue
            results.append(doc)
        return _Cursor(results)

    async def find_one_and_update(self, query, update, **_kwargs):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update(update.get("$set", {}))
                for field in update.get("$unset", {}):
                    doc.pop(field, None)
                return dict(doc)
        return None


def _matches(doc, query):
    for key, value in query.items():
        if key == "$or":
            if not any(_matches(doc, clause) for clause in value):
                return False
            continue
        actual = doc.get(key)
        if isinstance(value, dict):
            if "$in" in value and actual not in value["$in"]:
                return False
            if "$nin" in value and actual in value["$nin"]:
                return False
            if "$ne" in value and actual == value["$ne"]:
                return False
            if "$exists" in value and (key in doc) != value["$exists"]:
                return False
        elif actual != value:
            return False
    return True


class _DB:
    def __init__(self, branch, levels=None):
        self.branches = _Collection([branch])
        self.levels = _Collection(levels or [])


def test_nested_models_generate_ids_and_normalize_values():
    start_date, end_date = _dates()
    branch = BranchCreate(
        name="Rented",
        name_ar="مستأجر",
        phone="1",
        branch_type="rented",
        venues=[{
            "name": " Court ",
            "size": " 20x40 ",
            "booking_slots": [{
                "day": "MONDAY",
                "start_time": "09:00",
                "end_time": "10:00",
                "start_date": start_date,
                "end_date": end_date,
                "cost": 0,
                "cost_type": " hourly ",
            }],
        }],
    )
    assert branch.venues[0].id
    assert branch.venues[0].booking_slots[0].id
    assert branch.venues[0].booking_slots[0].day == "monday"
    assert branch.venues[0].booking_slots[0].cost_type == "hourly"


def test_legacy_permanent_branch_does_not_require_venues():
    branch = BranchCreate(name="Legacy", name_ar="قديم", phone="1")
    assert branch.branch_type == "permanent"
    assert branch.venues == []


def test_permanent_branch_can_contain_venues():
    branch_data = _branch(branch_type="permanent")
    branch = BranchCreate(
        name="Permanent",
        name_ar="دائم",
        phone="1",
        branch_type="permanent",
        venues=branch_data["venues"],
    )
    assert branch.branch_type == "permanent"
    assert branch.venues[0].id == "venue-1"


def test_rented_branch_does_not_require_venues():
    branch = BranchCreate(
        name="Rented", name_ar="مستأجر", phone="1", branch_type="rented"
    )
    assert branch.venues == []


def test_legacy_rented_venue_type_normalizes_for_safe_updates():
    branch = BranchCreate(
        name="Legacy rented",
        name_ar="مستأجر قديم",
        phone="1",
        branch_type="rented_venue",
    )
    route_branch = branches_mod.BranchCreate(
        name="Legacy rented",
        name_ar="مستأجر قديم",
        phone="1",
        branch_type="rented_venue",
    )
    assert branch.branch_type == "rented"
    assert route_branch.branch_type == "rented"


def test_overlapping_booking_windows_are_rejected():
    start_date, end_date = _dates()
    overlapping = _branch()["venues"][0]
    overlapping["booking_slots"].append({
        "id": "slot-2",
        "day": "monday",
        "start_time": "17:30",
        "end_time": "18:30",
        "start_date": start_date,
        "end_date": end_date,
        "cost": 100,
        "cost_type": "hourly",
    })
    with pytest.raises(ValidationError, match="overlap"):
        BranchCreate(
            name="Rented", name_ar="مستأجر", phone="1",
            branch_type="rented", venues=[overlapping],
        )


def test_rented_level_must_match_booking(monkeypatch):
    monkeypatch.setattr(levels_mod, "db", _DB(_branch()))
    run(levels_mod._validate_rented_level("branch-rented", _level()))

    with pytest.raises(HTTPException) as exc:
        run(levels_mod._validate_rented_level(
            "branch-rented", _level(time_slot="6:00 PM")
        ))
    assert exc.value.status_code == 400


@pytest.mark.parametrize("branch_type", ["permanent", "rented"])
def test_level_without_venue_booking_is_allowed_for_any_branch_type(
    monkeypatch, branch_type
):
    monkeypatch.setattr(
        levels_mod, "db", _DB(_branch(branch_type=branch_type, venues=[]))
    )
    run(levels_mod._validate_rented_level(
        "branch-rented", _level(venue_id=None, booking_slot_id=None)
    ))


@pytest.mark.parametrize("missing_field", ["venue_id", "booking_slot_id"])
def test_partial_venue_booking_link_is_rejected(monkeypatch, missing_field):
    monkeypatch.setattr(levels_mod, "db", _DB(_branch(branch_type="permanent")))
    with pytest.raises(HTTPException) as exc:
        run(levels_mod._validate_rented_level(
            "branch-rented", _level(**{missing_field: None})
        ))
    assert exc.value.status_code == 400


def test_permanent_branch_venue_booking_gets_full_validation(monkeypatch):
    monkeypatch.setattr(levels_mod, "db", _DB(_branch(branch_type="permanent")))
    run(levels_mod._validate_rented_level("branch-rented", _level()))

    with pytest.raises(HTTPException) as exc:
        run(levels_mod._validate_rented_level(
            "branch-rented", _level(days=["tuesday"])
        ))
    assert exc.value.status_code == 400


def test_permanent_branch_venue_booking_conflicts_are_rejected(monkeypatch):
    other = {
        "id": "other-level",
        "branch_id": "branch-rented",
        "venue_id": "venue-1",
        "booking_slot_id": "slot-1",
        "days": ["monday"],
        "time_slot": "17:00",
        "is_active": True,
    }
    monkeypatch.setattr(
        levels_mod,
        "db",
        _DB(_branch(branch_type="permanent"), [other]),
    )
    with pytest.raises(HTTPException) as exc:
        run(levels_mod._validate_rented_level("branch-rented", _level()))
    assert exc.value.status_code == 409


def test_linked_level_validates_against_legacy_rented_venues(monkeypatch):
    monkeypatch.setattr(levels_mod, "db", _DB(_legacy_rented_branch()))
    run(levels_mod._validate_rented_level("branch-rented", _level()))


def test_explicit_am_pm_does_not_match_opposite_half_day(monkeypatch):
    morning_branch = _branch()
    morning_branch["venues"][0]["booking_slots"][0]["start_time"] = "05:00"
    monkeypatch.setattr(levels_mod, "db", _DB(morning_branch))
    with pytest.raises(HTTPException) as exc:
        run(levels_mod._validate_rented_level(
            "branch-rented", _level(time_slot="5:00 PM")
        ))
    assert exc.value.status_code == 400

    monkeypatch.setattr(levels_mod, "db", _DB(_branch()))
    with pytest.raises(HTTPException) as exc:
        run(levels_mod._validate_rented_level(
            "branch-rented", _level(time_slot="5:00 AM")
        ))
    assert exc.value.status_code == 400


def test_legacy_bare_hour_can_match_either_half_day(monkeypatch):
    monkeypatch.setattr(levels_mod, "db", _DB(_branch()))
    run(levels_mod._validate_rented_level(
        "branch-rented", _level(time_slot="الساعة 5")
    ))


def test_rented_level_rejects_active_venue_time_conflict(monkeypatch):
    other = {
        "id": "other-level",
        "branch_id": "branch-rented",
        "venue_id": "venue-1",
        "booking_slot_id": "slot-1",
        "days": ["monday"],
        "time_slot": "17:00",
        "is_active": True,
    }
    monkeypatch.setattr(levels_mod, "db", _DB(_branch(), [other]))
    with pytest.raises(HTTPException) as exc:
        run(levels_mod._validate_rented_level("branch-rented", _level()))
    assert exc.value.status_code == 409


def test_schedule_slot_cannot_bypass_rented_booking_validation(monkeypatch):
    existing = {
        "id": "level-1", **_level().model_dump(),
        "is_active": True, "members": [],
    }
    monkeypatch.setattr(levels_mod, "db", _DB(_branch(), [existing]))
    payload = levels_mod.LevelSlotUpdate(level_id="level-1", hour=6)
    with pytest.raises(HTTPException) as exc:
        run(levels_mod.update_level_schedule_slot(
            payload, current_user={"is_admin": False, "branch_id": "branch-rented"}
        ))
    assert exc.value.status_code == 400


def test_legacy_all_days_level_conflicts_with_rented_venue_slot(monkeypatch):
    # A legacy level with no days means every weekday, not no weekdays.
    legacy_all_days = {
        "id": "legacy", "branch_id": "branch-rented", "venue_id": "venue-1",
        "booking_slot_id": "slot-1", "days": None, "time_slot": "5:00 PM",
        "is_active": True,
    }
    monkeypatch.setattr(levels_mod, "db", _DB(_branch(), [legacy_all_days]))
    with pytest.raises(HTTPException) as exc:
        run(levels_mod._validate_rented_level("branch-rented", _level()))
    assert exc.value.status_code == 409


def test_branch_detail_rejects_other_branch_staff(monkeypatch):
    monkeypatch.setattr(branches_mod, "db", _DB(
        {"id": "branch-b", "name": "B", "name_ar": "ب"}
    ))
    with pytest.raises(HTTPException) as exc:
        run(branches_mod.get_branch(
            "branch-b", current_user={"is_admin": False, "branch_id": "branch-a"}
        ))
    assert exc.value.status_code == 403


@pytest.mark.parametrize("method", ["get", "put"])
def test_branch_venues_endpoints_require_permission(monkeypatch, method):
    monkeypatch.setattr(branches_mod, "db", _DB(_branch()))

    async def deny_permission(_current_user, permission):
        assert permission == "rented-venues"
        raise HTTPException(status_code=403, detail="permission required")

    monkeypatch.setattr(branches_mod, "require_permission", deny_permission)
    user = {"is_admin": False, "branch_id": "branch-rented"}
    with pytest.raises(HTTPException) as exc:
        if method == "get":
            run(branches_mod.get_branch_venues("branch-rented", current_user=user))
        else:
            run(branches_mod.update_branch_venues(
                "branch-rented",
                branches_mod.BranchVenuesUpdate(venues=[]),
                current_user=user,
            ))
    assert exc.value.status_code == 403


@pytest.mark.parametrize("method", ["get", "put"])
def test_branch_venues_endpoints_reject_missing_branch(monkeypatch, method):
    monkeypatch.setattr(branches_mod, "db", _DB({"id": "another-branch"}))
    with pytest.raises(HTTPException) as exc:
        if method == "get":
            run(branches_mod.get_branch_venues(
                "missing", current_user={"is_admin": True}
            ))
        else:
            run(branches_mod.update_branch_venues(
                "missing",
                branches_mod.BranchVenuesUpdate(venues=[]),
                current_user={"is_admin": True},
            ))
    assert exc.value.status_code == 404


def test_get_branch_venues_uses_legacy_fallback(monkeypatch):
    monkeypatch.setattr(branches_mod, "db", _DB(_legacy_rented_branch()))
    venues = run(branches_mod.get_branch_venues(
        "branch-rented", current_user={"is_admin": True}
    ))
    assert len(venues) == 1
    assert venues[0].id == "venue-1"
    assert venues[0].booking_slots[0].id == "slot-1"


def test_update_branch_venues_replaces_only_venues_and_generates_ids(monkeypatch):
    branch = _branch(name="Keep this name")
    fake_db = _DB(branch)
    monkeypatch.setattr(branches_mod, "db", fake_db)
    invalidated = []
    monkeypatch.setattr(
        branches_mod, "cache_invalidate", lambda prefix: invalidated.append(prefix)
    )
    start_date, end_date = _dates()
    payload = branches_mod.BranchVenuesUpdate(venues=[{
        "name": "New court",
        "size": "10x20",
        "booking_slots": [{
            "day": "tuesday",
            "start_time": "09:00",
            "end_time": "10:00",
            "start_date": start_date,
            "end_date": end_date,
            "cost": 50,
            "cost_type": "hourly",
        }],
    }])

    venues = run(branches_mod.update_branch_venues(
        "branch-rented", payload, current_user={"is_admin": True}
    ))

    assert venues[0].id
    assert venues[0].booking_slots[0].id
    assert fake_db.branches.docs[0]["venues"][0]["id"] == venues[0].id
    assert fake_db.branches.docs[0]["name"] == "Keep this name"
    assert invalidated == ["branches:"]


def test_branch_venues_payload_runs_nested_and_unique_validation():
    venue = copy.deepcopy(_branch()["venues"][0])
    with pytest.raises(ValidationError, match="valid English weekday"):
        invalid = copy.deepcopy(venue)
        invalid["booking_slots"][0]["day"] = "not-a-day"
        branches_mod.BranchVenuesUpdate(venues=[invalid])

    with pytest.raises(ValidationError, match="venue ids must be unique"):
        branches_mod.BranchVenuesUpdate(venues=[venue, copy.deepcopy(venue)])


def test_rented_venues_permission_allows_assigned_branch_staff(monkeypatch):
    branch = _branch()
    monkeypatch.setattr(branches_mod, "db", _DB(branch))

    async def allow_permission(current_user, permission):
        assert permission == "rented-venues"

    monkeypatch.setattr(branches_mod, "require_permission", allow_permission)
    venues = run(branches_mod.get_branch_venues(
        "branch-rented",
        current_user={"is_admin": False, "branch_id": "branch-rented"},
    ))

    assert venues[0].id == "venue-1"


def test_rented_venues_permission_cannot_cross_branch(monkeypatch):
    monkeypatch.setattr(branches_mod, "db", _DB(_branch()))

    async def allow_permission(_current_user, _permission):
        return None

    monkeypatch.setattr(branches_mod, "require_permission", allow_permission)
    with pytest.raises(HTTPException) as exc:
        run(branches_mod.get_branch_venues(
            "branch-rented",
            current_user={"is_admin": False, "branch_id": "branch-other"},
        ))

    assert exc.value.status_code == 403


def test_hourly_booking_calculates_duration_and_total_on_server():
    start_date, _ = _dates()
    booking = BookingSlot(
        day="tuesday",
        start_time="21:30",
        end_time="23:00",
        start_date=start_date,
        end_date=start_date,
        cost=175,
        cost_type="hourly",
        hourly_rate=175,
        total_cost=1,
        payment_status="paid",
        payment_method="card",
    )

    assert booking.duration_hours == 1.5
    assert booking.total_cost == 262.5
    assert booking.payment_status == "paid"
    assert booking.payment_method == "card"


def test_paid_hourly_booking_requires_payment_method():
    start_date, _ = _dates()
    with pytest.raises(ValidationError, match="payment_method is required"):
        BookingSlot(
            day="tuesday",
            start_time="21:30",
            end_time="23:00",
            start_date=start_date,
            end_date=start_date,
            cost=100,
            cost_type="hourly",
            hourly_rate=100,
            payment_status="paid",
        )


def test_update_branch_venues_rejects_active_referenced_booking_change(monkeypatch):
    branch = _branch()
    referenced = {
        "id": "level-1", "branch_id": "branch-rented", "venue_id": "venue-1",
        "booking_slot_id": "slot-1", "is_active": True,
    }
    fake_db = _DB(branch, [referenced])
    monkeypatch.setattr(branches_mod, "db", fake_db)
    changed = copy.deepcopy(branch["venues"])
    changed[0]["booking_slots"][0]["start_time"] = "16:00"

    with pytest.raises(HTTPException) as exc:
        run(branches_mod.update_branch_venues(
            "branch-rented",
            branches_mod.BranchVenuesUpdate(venues=changed),
            current_user={"is_admin": True},
        ))
    assert exc.value.status_code == 409
    assert fake_db.branches.docs[0]["venues"][0]["booking_slots"][0]["start_time"] == "17:00"


def test_active_toggle_rejects_other_branch_staff(monkeypatch):
    foreign = {"id": "level-b", "branch_id": "branch-b", "is_active": True}
    monkeypatch.setattr(levels_mod, "db", _DB(_branch(), [foreign]))
    with pytest.raises(HTTPException) as exc:
        run(levels_mod.set_level_active(
            "level-b", levels_mod.LevelActiveUpdate(is_active=False),
            current_user={"is_admin": False, "branch_id": "branch-a"},
        ))
    assert exc.value.status_code == 403


def test_branch_update_rejects_removing_referenced_booking_slot(monkeypatch):
    branch = _branch()
    referenced = {
        "id": "level-1", "branch_id": "branch-rented", "venue_id": "venue-1",
        "booking_slot_id": "slot-1", "is_active": True,
    }
    fake_db = _DB(branch, [referenced])
    monkeypatch.setattr(branches_mod, "db", fake_db)
    payload = branches_mod.BranchCreate(
        name="Rented", name_ar="مستأجر", branch_type="rented",
        venues=[{"id": "venue-1", "name": "Court 1", "size": "20x40", "booking_slots": []}],
    )
    with pytest.raises(HTTPException) as exc:
        run(branches_mod.update_branch(
            "branch-rented", payload, current_user={"is_admin": True}
        ))
    assert exc.value.status_code == 409


def test_cleanup_bulk_cannot_bypass_rented_booking_validation(monkeypatch):
    existing = {
        "id": "level-1", **_level().model_dump(),
        "is_active": True, "members": [],
    }
    fake_db = _DB(_branch(), [existing])
    monkeypatch.setattr(levels_mod, "db", fake_db)
    payload = levels_mod.LevelCleanupBulk(items=[
        levels_mod.LevelCleanupItem(id="level-1", time_slot="6:00 PM")
    ])
    result = run(levels_mod.apply_levels_cleanup_bulk(
        payload, current_user={"is_admin": False, "branch_id": "branch-rented"}
    ))
    assert result["applied"] == 0
    assert result["results"][0]["status"] == "error"
    assert fake_db.levels.docs[0]["time_slot"] == "5:00 PM"


@pytest.mark.parametrize("field,value", [
    ("start_time", "16:00"),
    ("day", "tuesday"),
    ("start_date", (date.today() - timedelta(days=1)).isoformat()),
])
def test_branch_update_rejects_changing_active_referenced_slot_booking_fields(
    monkeypatch, field, value
):
    branch = _branch()
    referenced = {
        "id": "level-1", "branch_id": "branch-rented", "venue_id": "venue-1",
        "booking_slot_id": "slot-1", "is_active": True,
    }
    monkeypatch.setattr(branches_mod, "db", _DB(branch, [referenced]))
    changed_venues = copy.deepcopy(branch["venues"])
    changed_venues[0]["booking_slots"][0][field] = value
    payload = branches_mod.BranchCreate(
        name="Rented", name_ar="مستأجر", branch_type="rented",
        venues=changed_venues,
    )
    with pytest.raises(HTTPException) as exc:
        run(branches_mod.update_branch(
            "branch-rented", payload, current_user={"is_admin": True}
        ))
    assert exc.value.status_code == 409


def test_branch_update_rejects_removing_referenced_venues_during_type_change(
    monkeypatch
):
    branch = _branch()
    referenced = {
        "id": "level-1", "branch_id": "branch-rented", "venue_id": "venue-1",
        "booking_slot_id": "slot-1", "is_active": True,
    }
    monkeypatch.setattr(branches_mod, "db", _DB(branch, [referenced]))
    payload = branches_mod.BranchCreate(
        name="Permanent", name_ar="دائم", branch_type="permanent", venues=[],
    )
    with pytest.raises(HTTPException) as exc:
        run(branches_mod.update_branch(
            "branch-rented", payload, current_user={"is_admin": True}
        ))
    assert exc.value.status_code == 409


@pytest.mark.parametrize("change", ["remove", "modify"])
def test_branch_update_rejects_active_legacy_referenced_slot_changes(
    monkeypatch, change
):
    branch = _legacy_rented_branch()
    referenced = {
        "id": "level-1", "branch_id": "branch-rented", "venue_id": "venue-1",
        "booking_slot_id": "slot-1", "is_active": True,
    }
    monkeypatch.setattr(branches_mod, "db", _DB(branch, [referenced]))
    venues = copy.deepcopy(branch["rented_venues"])
    if change == "remove":
        venues[0]["booking_slots"] = []
    else:
        venues[0]["booking_slots"][0]["start_time"] = "16:00"
    payload = branches_mod.BranchCreate(
        name="Legacy",
        name_ar="قديم",
        branch_type="permanent",
        venues=venues,
    )
    with pytest.raises(HTTPException) as exc:
        run(branches_mod.update_branch(
            "branch-rented", payload, current_user={"is_admin": True}
        ))
    assert exc.value.status_code == 409


def test_branch_type_change_keeps_active_venue_links_when_venues_remain(monkeypatch):
    branch = _branch()
    referenced = {
        "id": "level-1", "branch_id": "branch-rented", "venue_id": "venue-1",
        "booking_slot_id": "slot-1", "is_active": True,
    }
    monkeypatch.setattr(branches_mod, "db", _DB(branch, [referenced]))
    payload = branches_mod.BranchCreate(
        name="Permanent",
        name_ar="دائم",
        branch_type="permanent",
        venues=copy.deepcopy(branch["venues"]),
    )
    result = run(branches_mod.update_branch(
        "branch-rented", payload, current_user={"is_admin": True}
    ))
    assert result["branch_type"] == "permanent"
    assert result["venues"][0]["id"] == "venue-1"


def test_cleanup_bulk_still_allows_legacy_branchless_level(monkeypatch):
    legacy = {
        "id": "legacy", "level_number": 1, "activity_name": "Swimming",
        "branch_id": None, "time_slot": "5:00 PM", "days": ["monday"],
    }
    fake_db = _DB(_branch(), [legacy])
    monkeypatch.setattr(levels_mod, "db", fake_db)

    class _Result:
        matched_count = 1

    async def update_one(query, update):
        assert _matches(legacy, query)
        legacy.update(update["$set"])
        return _Result()

    fake_db.levels.update_one = update_one
    result = run(levels_mod.apply_levels_cleanup_bulk(
        levels_mod.LevelCleanupBulk(items=[
            levels_mod.LevelCleanupItem(id="legacy", activity_name="Swim")
        ]),
        current_user={"is_admin": False, "branch_id": "branch-rented"},
    ))
    assert result["applied"] == 1
    assert legacy["activity_name"] == "Swim"