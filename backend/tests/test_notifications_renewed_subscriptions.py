import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import routes.notifications as notifications  # noqa: E402
from routes.notifications import (  # noqa: E402
    _matching_renewal_evidence,
    _renewal_evidence_by_activity,
)


def _item(member_id, activity_id, start, end, **extra):
    return {
        "member_id": member_id,
        "activity_id": activity_id,
        "activity_name": activity_id,
        "start_date": start,
        "end_date": end,
        **extra,
    }


def _invoice(invoice_id, items, *, branch="b1", status="paid", renewal=False):
    return {
        "id": invoice_id,
        "member_id": "payer",
        "branch_id": branch,
        "status": status,
        "is_renewal": renewal,
        "items": items,
    }


def test_initial_purchase_is_not_renewal_but_successive_paid_period_is():
    members = [{"id": "m1", "branch_id": "b1"}]
    invoices = [
        _invoice("initial", [_item("m1", "a1", "2026-01-01", "2026-01-31")]),
        _invoice("next", [_item("m1", "a1", "2026-02-01", "2026-02-28")]),
    ]

    evidence = _renewal_evidence_by_activity(members, invoices)

    assert [row["invoice_id"] for row in evidence[("m1", "a1")]] == ["next"]


def test_explicit_paid_renewal_supports_activity_switch_and_prepaid_window():
    members = [{"id": "m1", "branch_id": "b1"}]
    invoice = _invoice(
        "switched",
        [_item("m1", "new-activity", "2026-05-01", "2026-05-31")],
        renewal=True,
    )

    evidence = _renewal_evidence_by_activity(members, [invoice])
    match = _matching_renewal_evidence(
        {
            "activity_id": "new-activity",
            "start_date": "2026-04-01",
            "end_date": "2026-04-30",
        },
        evidence[("m1", "new-activity")],
    )

    assert match["invoice_id"] == "switched"
    assert match["start"] == "2026-05-01"


def test_overlapping_old_renewal_does_not_match_later_activity_window():
    assert _matching_renewal_evidence(
        {
            "activity_id": "a1",
            "start_date": "2026-01-20",
            "end_date": "2026-02-20",
        },
        [{
            "invoice_id": "older-renewal",
            "start": "2026-01-01",
            "end": "2026-01-31",
            "explicit": True,
        }],
    ) is None


def test_only_fully_paid_same_member_non_product_same_branch_items_count():
    members = [
        {"id": "m1", "branch_id": "b1"},
        {"id": "m2", "branch_id": "b1"},
    ]
    invoices = [
        _invoice(
            "family",
            [
                _item("m1", "a1", "2026-02-01", "2026-02-28"),
                _item("m2", "a1", "2026-03-01", "2026-03-31"),
            ],
            renewal=True,
        ),
        _invoice(
            "product",
            [_item("m1", "a2", "2026-02-01", "2026-02-28", is_product=True)],
            renewal=True,
        ),
        _invoice(
            "partial",
            [_item("m1", "a3", "2026-02-01", "2026-02-28")],
            status="partial",
            renewal=True,
        ),
        _invoice(
            "cancelled",
            [_item("m1", "a4", "2026-02-01", "2026-02-28")],
            status="cancelled",
            renewal=True,
        ),
        _invoice(
            "other-branch",
            [_item("m1", "a5", "2026-02-01", "2026-02-28")],
            branch="b2",
            renewal=True,
        ),
    ]

    evidence = _renewal_evidence_by_activity(members, invoices)

    assert set(evidence) == {("m1", "a1"), ("m2", "a1")}
    assert evidence[("m1", "a1")][0]["invoice_id"] == "family"
    assert evidence[("m2", "a1")][0]["invoice_id"] == "family"


def test_ordinary_invoice_requires_successive_period_for_same_activity():
    members = [{"id": "m1", "branch_id": "b1"}]
    invoices = [
        _invoice("old-a1", [_item("m1", "a1", "2026-01-01", "2026-01-31")]),
        _invoice("first-a2", [_item("m1", "a2", "2026-02-01", "2026-02-28")]),
    ]

    assert _renewal_evidence_by_activity(members, invoices) == {}


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    async def to_list(self, _limit):
        return list(self.rows)

    def __aiter__(self):
        self._iterator = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return next(self._iterator)
        except StopIteration:
            raise StopAsyncIteration


class _Collection:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    def find(self, query, _projection=None):
        self.queries.append(query)
        return _Cursor(self.rows)

    def aggregate(self, _pipeline):
        return _Cursor([])


@pytest.mark.asyncio
async def test_endpoint_opt_in_expands_horizon_and_includes_nationality(monkeypatch):
    member = {
        "id": "m1",
        "branch_id": "b1",
        "name_ar": "عضو",
        "nationality": "SA",
        "activities": [{
            "activity_id": "a1",
            "activity_name": "Karate",
            "status": "active",
            "start_date": "2099-01-01",
            "end_date": "2099-01-31",
            "fee": 125,
        }],
    }
    invoice = _invoice(
        "renewed",
        [_item("m1", "a1", "2099-01-01", "2099-01-31")],
        renewal=True,
    )
    fake_db = type("FakeDB", (), {
        "members": _Collection([member]),
        "invoices": _Collection([invoice]),
        "attendance": _Collection([]),
    })()
    monkeypatch.setattr(notifications, "db", fake_db)
    user = {"is_admin": True, "branch_id": "b1"}

    legacy = await notifications.get_expiring_subscriptions(
        days=7, include_renewed=False, current_user=user
    )
    opted_in = await notifications.get_expiring_subscriptions(
        days=7, include_renewed=True, current_user=user
    )

    assert legacy == []
    assert len(opted_in) == 1
    assert opted_in[0]["_renewed"] is True
    assert opted_in[0]["renewal_invoice_id"] == "renewed"
    assert opted_in[0]["nationality"] == "SA"
    assert opted_in[0]["fee"] == 125
    assert "end_date" not in fake_db.members.queries[-1]["activities"]["$elemMatch"]


@pytest.mark.asyncio
async def test_endpoint_keeps_expired_card_normal_despite_old_renewal(monkeypatch):
    today = datetime.now(ZoneInfo("Asia/Riyadh")).date()
    start = (today - timedelta(days=31)).isoformat()
    end = (today - timedelta(days=1)).isoformat()
    member = {
        "id": "m1",
        "branch_id": "b1",
        "activities": [{
            "activity_id": "a1",
            "status": "active",
            "start_date": start,
            "end_date": end,
        }],
    }
    invoice = _invoice(
        "old-renewal",
        [_item("m1", "a1", start, end)],
        renewal=True,
    )
    fake_db = type("FakeDB", (), {
        "members": _Collection([member]),
        "invoices": _Collection([invoice]),
        "attendance": _Collection([]),
    })()
    monkeypatch.setattr(notifications, "db", fake_db)

    rows = await notifications.get_expiring_subscriptions(
        days=7,
        include_expired=True,
        include_renewed=True,
        current_user={"is_admin": True, "branch_id": "b1"},
    )

    assert len(rows) == 1
    assert "_renewed" not in rows[0]
    assert rows[0]["fee"] is None