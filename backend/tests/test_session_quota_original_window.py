"""Unit tests for the session-quota total computation.

A member's *paid* session total must come from the ORIGINAL purchased
subscription window, not from the (possibly extended) deadline. Freezes and
holiday closures push the end date out so the member keeps a deadline to use
their sessions, but they must never inflate the number of sessions the member
paid for.

Regression guarded here: محمد bought a 2-day/week swim subscription
2026-05-11 → 2026-06-03 (= 8 sessions). A freeze + Eid closure extended the
``member.activities`` deadline to 2026-06-22, which — under the old formula that
counted ``ceil((end - start)/7) * days_per_week`` from the *extended* date —
wrongly reported 12 sessions. The total must stay 8; only the displayed
end_date and the attendance counting window follow the extension.

No live MongoDB is required: a tiny fake db serves members / invoices /
attendance from in-memory dicts. Dates are placed far in the future so the
"expired subscription" guard never trips regardless of the real clock.
"""
import os
import sys
import asyncio

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import routes.attendance as att  # noqa: E402


SCHEDULE = "الإثنين و الأربعاء - 5:00 م"  # parses to 2 training days/week


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, _n):
        return list(self._docs)


class _FakeMembers:
    def __init__(self, member):
        self._member = member

    async def find_one(self, _query, _projection=None):
        return self._member


class _FakeInvoices:
    def __init__(self, invoices):
        self._invoices = invoices

    def find(self, _query, _projection=None):
        return _FakeCursor(self._invoices)


class _FakeAttendance:
    def __init__(self, records):
        self._records = records

    async def count_documents(self, query):
        mid = query.get("member_id")
        aid = query.get("activity_id")
        date_range = query.get("date", {})
        lo = date_range.get("$gte")
        hi = date_range.get("$lte")
        count = 0
        for rec in self._records:
            if rec["member_id"] != mid or rec["activity_id"] != aid:
                continue
            if lo is not None and rec["date"] < lo:
                continue
            if hi is not None and rec["date"] > hi:
                continue
            count += 1
        return count


class _FakeDB:
    def __init__(self, member=None, invoices=None, attendance=None):
        self.members = _FakeMembers(member or {})
        self.invoices = _FakeInvoices(invoices or [])
        self.attendance = _FakeAttendance(attendance or [])


@pytest.fixture
def fake_db(monkeypatch):
    def _install(member=None, invoices=None, attendance=None):
        db = _FakeDB(member=member, invoices=invoices, attendance=attendance)
        monkeypatch.setattr(att, "db", db)
        return db
    return _install


def _quota(member_id="M1"):
    return asyncio.run(att.check_member_session_quota(member_id))


# ---------------------------------------------------------------------------
# Regression: extended deadline must not inflate the paid total
# ---------------------------------------------------------------------------


def test_extended_activity_keeps_original_paid_total(fake_db):
    """member.activities deadline is extended (06-22) but the invoice keeps the
    original window (06-03 = 8 sessions). Total must be 8, not 12."""
    member = {
        "id": "M1",
        "activities": [{
            "activity_id": "A",
            "activity_name": "Swim",
            "start_date": "2099-05-11",
            "end_date": "2099-06-22",          # extended deadline
            "schedule": SCHEDULE,
            "status": "active",
            "source": "invoice",
            "source_id": "INV1",
        }],
    }
    invoices = [{
        "id": "INV1",
        "status": "paid",
        "invoice_number": "100",
        "items": [{
            "activity_id": "A",
            "activity_name": "Swim",
            "start_date": "2099-05-11",
            "end_date": "2099-06-03",          # ORIGINAL purchased window
            "schedule": SCHEDULE,
            "is_product": False,
        }],
    }]
    fake_db(member=member, invoices=invoices, attendance=[
        {"member_id": "M1", "activity_id": "A", "date": "2099-06-01"},
    ])

    res = _quota()
    assert len(res) == 1
    q = res[0]
    assert q["total_allowed"] == 8          # original window, NOT 12
    assert q["used_sessions"] == 1
    assert q["remaining"] == 7
    assert q["end_date"] == "2099-06-22"    # extended deadline still displayed


def test_attendance_after_original_end_still_counts(fake_db):
    """An attendance recorded in the extension window (after the original end,
    before the extended deadline) must still count against the paid quota."""
    member = {
        "id": "M1",
        "activities": [{
            "activity_id": "A",
            "activity_name": "Swim",
            "start_date": "2099-05-11",
            "end_date": "2099-06-22",
            "schedule": SCHEDULE,
            "status": "active",
            "source": "invoice",
            "source_id": "INV1",
        }],
    }
    invoices = [{
        "id": "INV1",
        "status": "paid",
        "invoice_number": "100",
        "items": [{
            "activity_id": "A",
            "activity_name": "Swim",
            "start_date": "2099-05-11",
            "end_date": "2099-06-03",
            "schedule": SCHEDULE,
            "is_product": False,
        }],
    }]
    fake_db(member=member, invoices=invoices, attendance=[
        {"member_id": "M1", "activity_id": "A", "date": "2099-06-01"},   # original window
        {"member_id": "M1", "activity_id": "A", "date": "2099-06-15"},   # extension window
    ])

    q = _quota()[0]
    assert q["total_allowed"] == 8
    assert q["used_sessions"] == 2          # both attendances count
    assert q["remaining"] == 6


def test_registration_form_member_uses_activity_dates(fake_db):
    """No invoice (registration-form member): the activity dates ARE the
    original window, so the total is computed from them directly."""
    member = {
        "id": "M1",
        "activities": [{
            "activity_id": "B",
            "activity_name": "Swim",
            "start_date": "2099-05-11",
            "end_date": "2099-06-03",
            "schedule": SCHEDULE,
            "status": "active",
            "source": "registration",
        }],
    }
    fake_db(member=member, invoices=[], attendance=[])

    q = _quota()[0]
    assert q["total_allowed"] == 8
    assert q["remaining"] == 8


def test_invoice_fallback_uses_original_end(fake_db):
    """Activity present only on the invoice (not in member.activities): the
    fallback path computes the total from the invoice's own end date."""
    member = {"id": "M1", "activities": []}
    invoices = [{
        "id": "INV2",
        "status": "paid",
        "invoice_number": "200",
        "items": [{
            "activity_id": "C",
            "activity_name": "Swim",
            "start_date": "2099-05-11",
            "end_date": "2099-06-03",
            "schedule": SCHEDULE,
            "is_product": False,
        }],
    }]
    fake_db(member=member, invoices=invoices, attendance=[])

    q = _quota()[0]
    assert q["total_allowed"] == 8
    assert q["invoice_number"] == "200"


# ---------------------------------------------------------------------------
# Diverged activity_id: member.activities is linked to the invoice by source_id
# but carries a DIFFERENT activity_id than the invoiced item (level-based
# assignment uses its own activity record). The original window must still be
# recovered via (source_id, start_date[, schedule]) — not the extended deadline.
# ---------------------------------------------------------------------------


def test_diverged_activity_id_recovers_original_via_start_date(fake_db):
    """The real reported bug: activity_id differs between member.activities and
    the invoice item, a closure extended the deadline, and the total wrongly
    showed 10. Joining on start_date must restore the original 8."""
    member = {
        "id": "M1",
        "activities": [{
            "activity_id": "LEVEL_ACT",          # level-based id
            "activity_name": "كاراتيه",
            "start_date": "2099-05-04",
            "end_date": "2099-06-08",            # extended by Eid closure
            "schedule": SCHEDULE,
            "status": "active",
            "source": "invoice",
            "source_id": "INV1",
        }],
    }
    invoices = [{
        "id": "INV1",
        "status": "paid",
        "invoice_number": "230072",
        "items": [{
            "activity_id": "PRODUCT_ACT",        # different invoiced id
            "activity_name": "كاراتية 2يوم في الاسبوع",
            "start_date": "2099-05-04",
            "end_date": "2099-05-27",            # ORIGINAL window = 8 sessions
            "schedule": SCHEDULE,
            "is_product": False,
        }],
    }]
    fake_db(member=member, invoices=invoices, attendance=[
        {"member_id": "M1", "activity_id": "LEVEL_ACT", "date": "2099-06-01"},
    ])

    res = _quota()
    # The card we care about is the member's (level-based) activity. Pick it by
    # id; an unrelated invoice-fallback card may also appear for the diverged
    # invoiced activity (pre-existing dedup behaviour, out of scope here).
    q = next(r for r in res if r["activity_id"] == "LEVEL_ACT")
    assert q["total_allowed"] == 8              # NOT 10 (extended deadline)
    assert q["used_sessions"] == 1
    assert q["remaining"] == 7
    assert q["end_date"] == "2099-06-08"        # extended deadline still shown


def test_diverged_activity_id_disambiguated_by_schedule(fake_db):
    """A multi-activity invoice shares one start_date across two items with
    different windows. The diverged member activity must pick the item matching
    its SCHEDULE, not the last-written one."""
    other_schedule = "الأحد و الثلاثاء - 6:00 م"  # also 2 days/week
    member = {
        "id": "M1",
        "activities": [{
            "activity_id": "LEVEL_ACT",
            "activity_name": "كاراتيه",
            "start_date": "2099-05-04",
            "end_date": "2099-07-20",            # extended; must be ignored for total
            "schedule": SCHEDULE,
            "status": "active",
            "source": "invoice",
            "source_id": "INV1",
        }],
    }
    invoices = [{
        "id": "INV1",
        "status": "paid",
        "invoice_number": "300",
        "items": [
            {  # the item that matches the member's schedule -> 8 sessions
                "activity_id": "P1",
                "activity_name": "كاراتيه",
                "start_date": "2099-05-04",
                "end_date": "2099-05-27",
                "schedule": SCHEDULE,
                "is_product": False,
            },
            {  # a longer co-purchased item sharing the start_date (12 sessions)
                "activity_id": "P2",
                "activity_name": "سباحة",
                "start_date": "2099-05-04",
                "end_date": "2099-06-22",
                "schedule": other_schedule,
                "is_product": False,
            },
        ],
    }]
    fake_db(member=member, invoices=invoices, attendance=[])

    q = _quota()[0]
    assert q["total_allowed"] == 8             # schedule-matched item, not 12


def test_ambiguous_invoice_does_not_guess_original_end(fake_db):
    """When (invoice, start_date) is ambiguous (two items, different ends) AND
    the member activity's schedule matches NEITHER item, the loose key is
    flagged None so the code must NOT silently pick one item's end. It safely
    falls back to the activity's own (extended) end instead of guessing wrong."""
    member_schedule = "الأحد و الخميس - 7:00 م"  # 2 days/week, matches no item
    member = {
        "id": "M1",
        "activities": [{
            "activity_id": "LEVEL_ACT",
            "activity_name": "كاراتيه",
            "start_date": "2099-05-04",
            "end_date": "2099-07-04",            # extended fallback window (9 weeks)
            "schedule": member_schedule,
            "status": "active",
            "source": "invoice",
            "source_id": "INV1",
        }],
    }
    invoices = [{
        "id": "INV1",
        "status": "paid",
        "invoice_number": "400",
        "items": [
            {
                "activity_id": "P1",
                "activity_name": "كاراتيه",
                "start_date": "2099-05-04",
                "end_date": "2099-05-27",        # one end
                "schedule": SCHEDULE,
                "is_product": False,
            },
            {
                "activity_id": "P2",
                "activity_name": "سباحة",
                "start_date": "2099-05-04",
                "end_date": "2099-06-22",        # different end -> ambiguous loose key
                "schedule": "الإثنين و الخميس - 6:00 م",
                "is_product": False,
            },
        ],
    }]
    fake_db(member=member, invoices=invoices, attendance=[])

    q = next(r for r in _quota() if r["activity_id"] == "LEVEL_ACT")
    # 2099-05-04 → 2099-07-04 = 61 days → ceil(61/7)=9 weeks × 2 = 18.
    # The guard refused to guess either 8 (P1) or 12 (P2); it used the extended
    # deadline fallback, proving no wrong original end was silently selected.
    assert q["total_allowed"] == 18
