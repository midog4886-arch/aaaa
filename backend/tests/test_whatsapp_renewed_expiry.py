import asyncio
from types import SimpleNamespace

from routes import whatsapp as mod


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return self.rows


class Invoices:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query, projection=None):
        return Cursor([row for row in self.rows if row.get("status") == query.get("status")])


def test_old_expiry_suppressed_only_by_later_same_activity_paid_period():
    members = [{
        "id": "m1", "branch_id": "b1", "activities": [
            {"activity_id": "swim", "activity_name": "سباحة", "status": "active",
             "start_date": "2026-09-01", "end_date": "2026-10-20", "source_id": "old"},
            {"activity_id": "football", "status": "active",
             "start_date": "2026-09-01", "end_date": "2026-10-20"},
        ],
    }]
    invoices = [
        {"id": "old", "status": "paid", "branch_id": "b1", "member_id": "m1",
         "items": [{"activity_id": "swim", "start_date": "2026-09-01", "end_date": "2026-10-20"}]},
        {"id": "next", "status": "paid", "branch_id": "b1", "member_id": "payer",
         "items": [{"member_id": "m1", "activity_id": "swim",
                    "start_date": "2026-10-21", "end_date": "2026-11-20"}]},
        {"id": "unpaid", "status": "partial", "branch_id": "b1", "member_id": "m1",
         "items": [{"activity_id": "football", "start_date": "2026-10-21", "end_date": "2026-11-20"}]},
    ]
    result = asyncio.run(mod._renewed_expiry_keys(members, SimpleNamespace(invoices=Invoices(invoices))))
    assert result == {("m1", "swim", "2026-10-20")}


def test_later_activity_on_member_card_suppresses_old_expiry():
    members = [{"id": "m1", "branch_id": "b1", "activities": [
        {"activity_id": "swim", "status": "active", "end_date": "2026-10-20"},
        {"activity_id": "swim", "status": "active", "start_date": "2026-10-21", "end_date": "2026-11-20"},
    ]}]
    result = asyncio.run(mod._renewed_expiry_keys(members, SimpleNamespace(invoices=Invoices([]))))
    assert result == {("m1", "swim", "2026-10-20")}


def test_paid_renewal_suppresses_old_expiry_even_when_freeze_overlaps_it():
    members = [{"id": "m1", "branch_id": "b1", "activities": [{
        "activity_id": "swim", "status": "active", "source_id": "old",
        "start_date": "2026-09-27", "end_date": "2026-10-27",
    }]}]
    invoices = [
        {"id": "old", "status": "paid", "branch_id": "b1", "member_id": "m1",
         "items": [{"activity_id": "swim", "start_date": "2026-09-27", "end_date": "2026-10-25"}]},
        {"id": "new", "status": "paid", "branch_id": "b1", "member_id": "m1",
         "items": [{"activity_id": "swim", "start_date": "2026-10-26", "end_date": "2026-11-22"}]},
    ]
    result = asyncio.run(mod._renewed_expiry_keys(
        members, SimpleNamespace(invoices=Invoices(invoices))))
    assert result == {("m1", "swim", "2026-10-27")}


def test_later_paid_item_on_same_invoice_suppresses_old_expiry():
    members = [{"id": "m1", "branch_id": "b1", "activities": [{
        "activity_id": "swim", "status": "active", "source_id": "bundle",
        "start_date": "2026-09-27", "end_date": "2026-10-25",
    }]}]
    invoices = [{"id": "bundle", "status": "paid", "branch_id": "b1",
                 "member_id": "m1", "items": [
                     {"activity_id": "swim", "start_date": "2026-09-27",
                      "end_date": "2026-10-20"},
                     {"activity_id": "swim", "start_date": "2026-10-25",
                      "end_date": "2026-11-17"},
                 ]}]
    result = asyncio.run(mod._renewed_expiry_keys(
        members, SimpleNamespace(invoices=Invoices(invoices))))
    assert result == {("m1", "swim", "2026-10-25")}
