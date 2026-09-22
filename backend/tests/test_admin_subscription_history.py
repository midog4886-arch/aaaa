"""Read-only invoice history must not change operational quota decisions."""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import routes.attendance as att
from utils.effective_periods import source_key
from test_session_quota_original_window import _FakeMembers, _FakeInvoices, SCHEDULE


def matches(doc, query):
    for key, value in query.items():
        if key == "$or":
            if not any(matches(doc, branch) for branch in value):
                return False
        elif isinstance(value, dict):
            actual = doc.get(key)
            for op, operand in value.items():
                if op == "$in" and actual not in operand:
                    return False
                if op == "$gte" and actual < operand:
                    return False
                if op == "$lte" and actual > operand:
                    return False
                if op == "$lt" and actual >= operand:
                    return False
        elif doc.get(key) != value:
            return False
    return True


class Attendance:
    def __init__(self, records):
        self.records = records

    async def count_documents(self, query):
        return sum(matches(record, query) for record in self.records)


class Clock(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 5, tzinfo=timezone.utc)


def invoice(month, owner="M", status="paid"):
    return {
        "id": f"I{month}", "member_id": owner, "status": status,
        "invoice_number": str(month), "items": [{
            "item_id": f"P{month}", "activity_id": "A", "activity_name": "Swim",
            "start_date": f"2026-{month:02}-01", "end_date": f"2026-{month:02}-24",
            "schedule": SCHEDULE,
        }],
    }


def install(monkeypatch, invoices, activities=None, records=None, effective=None):
    monkeypatch.setattr(att, "datetime", Clock)
    db = SimpleNamespace(
        members=_FakeMembers({"id": "M", "activities": activities or []}),
        invoices=_FakeInvoices(invoices), attendance=Attendance(records or []),
        subscription_effective_periods=_FakeInvoices(effective or []),
    )
    monkeypatch.setattr(att, "db", db)
    return db


def history():
    return asyncio.run(att.get_member_subscription_history("M"))


def test_missing_october_visible_without_broadening_default(monkeypatch):
    invoices = [invoice(m) for m in (9, 10, 11)]
    act = {**invoices[2]["items"][0], "source": "invoice", "source_id": "I11"}
    records = [{"member_id": "M", "activity_id": "A", "date": f"2026-09-{d:02}"} for d in range(1, 9)]
    records += [{"member_id": "M", "activity_id": "A", "date": "2026-11-02", "off_schedule": True}]
    install(monkeypatch, invoices, [act], records)
    before = asyncio.run(att.check_member_session_quota("M"))
    cards = history()
    assert len(cards) == 3
    assert [c["used_sessions"] for c in cards] == [8, 0, 1]
    assert [c["total_allowed"] for c in cards] == [8, 8, 8]
    assert [c["period_status"] for c in cards] == ["previous", "current", "upcoming"]
    assert [c["source_period_key"] for c in cards] == [source_key(i, i["items"][0], 0) for i in invoices]
    assert cards[2]["profile_subscription"] is True
    assert len(before) == 1 and before[0]["start_date"] == "2026-11-01"
    assert asyncio.run(att.check_member_session_quota("M")) == before


def test_effective_shift_original_quota_alias_and_off_day(monkeypatch):
    inv = invoice(10)
    key = source_key(inv, inv["items"][0], 0)
    act = {**inv["items"][0], "activity_id": "LEVEL", "source": "invoice", "source_id": inv["id"],
           "source_period_key": key, "start_date": "2026-10-08", "end_date": "2026-10-25"}
    install(monkeypatch, [inv, invoice(11)], [act], [
        {"member_id": "M", "activity_id": "LEVEL", "date": "2026-10-28", "off_schedule": True},
        {"member_id": "M", "activity_id": "A", "date": "2026-10-15"},
    ], [{"source_key": key, "effective_start_date": "2026-10-08", "effective_end_date": "2026-10-25"}])
    card = history()[0]
    assert card["start_date"] == "2026-10-08" and card["end_date"] == "2026-10-25"
    assert card["total_allowed"] == 8 and card["used_sessions"] == 2
    assert card["count_activity_ids"] == ["A", "LEVEL"]
    assert len(history()) == 2


def test_family_item_ownership_and_future_partial(monkeypatch):
    family = invoice(10, owner="PAYER")
    family["items"][0]["member_id"] = "M"
    sibling = {**family["items"][0], "item_id": "sibling", "member_id": "SIBLING"}
    family["items"].append(sibling)
    partial = invoice(11, status="partial")
    act = {**partial["items"][0], "source": "invoice", "source_id": partial["id"]}
    install(monkeypatch, [family, partial, invoice(9, status="partial")], [act])
    cards = history()
    assert len(cards) == 2
    assert {c["source_id"] for c in cards} == {"I9", "I10"}
    assert all("SIBLING" not in c["source_period_key"] for c in cards)


def test_overlapping_distinct_purchases_not_deduplicated(monkeypatch):
    first = invoice(9)
    first["items"][0]["end_date"] = "2026-10-09"
    second = invoice(10)
    second["items"][0]["start_date"] = "2026-09-28"
    install(monkeypatch, [first, second])
    cards = history()
    assert len(cards) == 2
    assert len({c["source_period_key"] for c in cards}) == 2


def test_same_invoice_exact_period_key_and_shift_no_duplicate(monkeypatch):
    inv = invoice(10)
    inv["items"].append(invoice(11)["items"][0])
    key = source_key(inv, inv["items"][0], 0)
    act = {**inv["items"][0], "source": "invoice", "source_id": inv["id"],
           "source_period_key": key, "start_date": "2026-10-08", "end_date": "2026-10-31"}
    install(monkeypatch, [inv], [act])
    cards = history()
    assert len(cards) == 2
    assert cards[0]["source_period_key"] == key
    assert cards[0]["total_allowed"] == 8
    assert cards[0]["start_date"] == "2026-10-08"


def test_ambiguous_legacy_alias_does_not_guess_source(monkeypatch):
    inv = invoice(10)
    inv["items"].append({**inv["items"][0], "item_id": "other", "activity_id": "B"})
    act = {**inv["items"][0], "activity_id": "LEVEL", "source": "invoice", "source_id": inv["id"]}
    install(monkeypatch, [inv], [act])
    cards = history()
    assert len(cards) == 3
    assert all(c["count_activity_ids"] == [c["activity_id"]] for c in cards)


def test_route_history_is_opt_in(monkeypatch):
    install(monkeypatch, [invoice(9), invoice(10), invoice(11)])
    default = asyncio.run(att.get_member_session_quota("M", current_user={}))
    assert default == asyncio.run(att.check_member_session_quota("M"))
    expanded = asyncio.run(att.get_member_session_quota("M", include_periods=True, current_user={"is_admin": True}))
    assert len(expanded) == 3
    assert all("source_period_key" in c for c in expanded)


def test_profile_dates_and_schedule_override_stale_effective_row(monkeypatch):
    inv = invoice(10)
    key = source_key(inv, inv["items"][0], 0)
    act = {**inv["items"][0], "source": "invoice", "source_id": inv["id"],
           "start_date": "2026-10-08", "end_date": "2026-11-02", "schedule": "الأحد"}
    install(monkeypatch, [inv], [act], effective=[{
        "source_key": key, "effective_start_date": "2026-10-04", "effective_end_date": "2026-10-27",
    }])
    cards = history()
    assert len(cards) == 1
    assert cards[0]["start_date"] == "2026-10-08"
    assert cards[0]["end_date"] == "2026-11-02"
    assert cards[0]["total_allowed"] == 8  # original two-day purchased schedule
    assert cards[0]["days_per_week"] == 1
    assert cards[0]["schedule_days"] == [att.ENGLISH_TO_ARABIC_DAY["sunday"]]


@pytest.mark.parametrize("member,user,error", [
    (None, {"is_admin": True}, 404),
    ({"branch_id": "B"}, {"branch_id": "A"}, 403),
    ({"branch_id": "B"}, {}, 403),
    ({"branch_id": "B"}, {"branch_id": "B"}, None),
    ({"branch_id": "B"}, {"is_admin": True}, None),
])
def test_history_object_branch_guard_before_invoice_reads(monkeypatch, member, user, error):
    db = install(monkeypatch, [])

    class Members:
        async def find_one(self, query, projection):
            assert projection == {"_id": 0, "activities": 1, "branch_id": 1}
            return member

    class NoInvoiceReads:
        def find(self, *args, **kwargs):
            pytest.fail("Unauthorized history must not fetch invoices")

    db.members = Members()
    if error:
        db.invoices = NoInvoiceReads()
        with pytest.raises(HTTPException) as exc:
            asyncio.run(att.get_member_session_quota("M", include_periods=True, current_user=user))
        assert exc.value.status_code == error
    else:
        assert asyncio.run(att.get_member_session_quota("M", include_periods=True, current_user=user)) == []