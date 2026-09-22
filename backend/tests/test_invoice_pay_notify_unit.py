"""In-process unit tests for the admin payment notification on pay_invoice.

Direct handler calls on routes/invoices.py with a fake db — NO server, NO
real DB. Covers:
  - bell notification row is admin-only (audience="admins") and branch-tagged
  - push fan-out runs in the BACKGROUND: a hanging/raising push service must
    never stall or fail the payment response
  - branchless invoice: bell only, push is skipped (fail closed)
  - already-paid invoice cannot be paid (and notified) twice
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SESSION_SECRET", "test-secret")

from routes import invoices as inv_mod  # noqa: E402
from routes import push_notifications as push_mod  # noqa: E402
from routes import whatsapp as whatsapp_mod  # noqa: E402


def run(coro, drain=True):
    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(coro)
        if drain:
            pending = [t for t in asyncio.all_tasks(loop) if not t.done()]
            if pending:
                for t in pending:
                    t.cancel()
                loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True))
        return result
    finally:
        loop.close()


# ── fakes ────────────────────────────────────────────────────────────────────

class _Result:
    def __init__(self, modified):
        self.modified_count = modified


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, *a, **k):
        return self

    def limit(self, n):
        return self

    async def to_list(self, n=None):
        return list(self._docs)


class _FakeCollection:
    def __init__(self):
        self.docs = []

    @classmethod
    def _matches(cls, doc, query):
        for k, v in query.items():
            if k == "$or":
                if not any(cls._matches(doc, s) for s in v):
                    return False
            elif isinstance(v, dict):
                dv = doc.get(k)
                if "$ne" in v and dv == v["$ne"]:
                    return False
                if "$in" in v and dv not in v["$in"]:
                    return False
            elif doc.get(k) != v:
                return False
        return True

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return _Result(1)

    async def find_one(self, query, proj=None):
        for d in self.docs:
            if self._matches(d, query):
                return dict(d)
        return None

    async def update_one(self, query, update, upsert=False):
        for d in self.docs:
            if self._matches(d, query):
                d.update(update.get("$set", {}))
                for key, value in update.get("$addToSet", {}).items():
                    values = d.setdefault(key, [])
                    if value not in values:
                        values.append(value)
                return _Result(1)
        if upsert:
            doc = {k: v for k, v in query.items() if not isinstance(v, dict)}
            doc.update(update.get("$set", {}))
            self.docs.append(doc)
            return _Result(1)
        return _Result(0)

    def find(self, query, proj=None):
        return _FakeCursor([dict(d) for d in self.docs if self._matches(d, query)])


class _FakeDB:
    def __init__(self):
        self.cols = {}

    def __getattr__(self, name):
        if name == "cols":
            raise AttributeError(name)
        return self.cols.setdefault(name, _FakeCollection())

    def __getitem__(self, name):
        return self.cols.setdefault(name, _FakeCollection())


@pytest.fixture()
def db(monkeypatch):
    fdb = _FakeDB()
    monkeypatch.setattr(inv_mod, "db", fdb)
    monkeypatch.setattr(inv_mod, "loyalty_award_points", None, raising=False)
    return fdb


@pytest.fixture()
def push_calls(monkeypatch):
    calls = []

    async def _fake_push(payload, branch_id=None):
        calls.append({"payload": payload, "branch_id": branch_id})
        return {"total": 0, "success": 0, "failed": 0}

    monkeypatch.setattr(push_mod, "send_push_to_admins", _fake_push)
    return calls


@pytest.fixture()
def whatsapp_calls(monkeypatch):
    calls = []

    async def _fake_whatsapp(invoice):
        calls.append(dict(invoice))
        return True

    monkeypatch.setattr(
        whatsapp_mod, "queue_invoice_payment_whatsapp_notice", _fake_whatsapp
    )
    return calls


def admin():
    return {"id": "u1", "user_id": "u1", "username": "admin", "name": "Admin",
            "is_admin": True, "branch_id": None, "permissions": []}


def _invoice(**over):
    doc = {"id": "inv1", "invoice_number": "230955", "status": "pending",
           "customer_name_ar": "عبدالعزيز", "total": 549.7,
           "branch_id": "b1", "member_id": None, "items": []}
    doc.update(over)
    return doc


# ── tests ────────────────────────────────────────────────────────────────────

def test_pay_inserts_admin_only_bell_and_background_push(db, push_calls, whatsapp_calls):
    db.invoices.docs.append(_invoice())
    db.branches.docs.append({"id": "b1", "name_ar": "الرياض", "name": "Riyadh"})
    out = run(inv_mod.pay_invoice("inv1", admin()))
    assert db.invoices.docs[0]["status"] == "paid"
    bells = db.notifications.docs
    assert len(bells) == 1
    assert bells[0]["audience"] == "admins"
    assert bells[0]["branch_id"] == "b1"
    assert "230955" in bells[0]["message_ar"]
    assert "الرياض" in bells[0]["message_ar"]
    # push ran (in background, drained by run()) and was branch-scoped
    assert push_calls and push_calls[0]["branch_id"] == "b1"
    assert len(whatsapp_calls) == 1
    assert whatsapp_calls[0]["id"] == "inv1"


def test_pay_returns_even_if_push_hangs(db, monkeypatch):
    """The push send must be off the critical path: a never-resolving push
    service cannot stall the payment response."""
    async def _hang(payload, branch_id=None):
        await asyncio.sleep(3600)

    monkeypatch.setattr(push_mod, "send_push_to_admins", _hang)
    db.invoices.docs.append(_invoice())

    async def _pay_with_timeout():
        return await asyncio.wait_for(inv_mod.pay_invoice("inv1", admin()), timeout=5)

    out = run(_pay_with_timeout())
    assert db.invoices.docs[0]["status"] == "paid"
    assert len(db.notifications.docs) == 1  # bell still delivered


def test_pay_survives_push_raising(db, monkeypatch):
    async def _boom(payload, branch_id=None):
        raise RuntimeError("push service down")

    monkeypatch.setattr(push_mod, "send_push_to_admins", _boom)
    db.invoices.docs.append(_invoice())
    run(inv_mod.pay_invoice("inv1", admin()))
    assert db.invoices.docs[0]["status"] == "paid"
    assert len(db.notifications.docs) == 1


def test_pay_branchless_invoice_bell_only_no_push(db, push_calls):
    db.invoices.docs.append(_invoice(branch_id=None))
    run(inv_mod.pay_invoice("inv1", admin()))
    assert db.invoices.docs[0]["status"] == "paid"
    assert len(db.notifications.docs) == 1
    assert push_calls == []  # fail closed: no cross-branch blast


def test_pay_already_paid_400_no_second_notification(db, push_calls, whatsapp_calls):
    db.invoices.docs.append(_invoice())
    run(inv_mod.pay_invoice("inv1", admin()))
    with pytest.raises(HTTPException) as e:
        run(inv_mod.pay_invoice("inv1", admin()))
    assert e.value.status_code == 400
    assert len(db.notifications.docs) == 1
    assert len(push_calls) == 1
    assert len(whatsapp_calls) == 1


def test_pay_unknown_invoice_404(db):
    with pytest.raises(HTTPException) as e:
        run(inv_mod.pay_invoice("ghost", admin()))
    assert e.value.status_code == 404


def _date(days):
    return (datetime.now(timezone.utc).date() + timedelta(days=days)).isoformat()


def _activity_item(**over):
    item = {
        "activity_id": "swim",
        "activity_name": "Swim",
        "start_date": _date(1),
        "end_date": _date(30),
        "period": "",
        "fee": 100,
        "schedule": "new schedule",
        "level_id": "future-level",
        "training_days": ["Monday"],
        "training_time": "18:00",
        "day_times": {"Monday": "18:00"},
        "is_product": False,
    }
    item.update(over)
    return item


def test_pay_future_same_activity_preserves_current_subscription_and_placement(
        db, push_calls, whatsapp_calls):
    """Exercise the real pay handler: a prepaid renewal stays on the paid
    invoice and cannot erase a freeze-compensated current activity."""
    current = {
        "activity_id": "swim",
        "activity_name": "Current swim",
        "start_date": _date(-20),
        # Represents a deadline extended by freeze compensation.
        "end_date": _date(10),
        "fee": 80,
        "status": "active",
        "coach_id": "coach-current",
        "level_id": "current-level",
        "schedule": "current schedule",
        "training_days": ["Sunday"],
        "training_time": "17:00",
        "day_times": {"Sunday": "17:00"},
        "source": "registration",
        "source_id": "registration-1",
    }
    future_item = _activity_item(start_date=_date(11), end_date=_date(40))
    db.members.docs.append({"id": "m1", "activities": [dict(current)]})
    db.levels.docs.extend([
        {"id": "current-level", "members": ["m1"]},
        {"id": "future-level", "members": []},
    ])
    db.invoices.docs.append(_invoice(
        member_id="m1", is_renewal=True, items=[future_item]))

    run(inv_mod.pay_invoice("inv1", admin()))

    assert db.invoices.docs[0]["status"] == "paid"
    assert db.invoices.docs[0]["items"][0] == future_item
    assert db.members.docs[0]["activities"] == [current]
    assert db.levels.docs[0]["members"] == ["m1"]
    assert db.levels.docs[1]["members"] == []
    assert db.level_subscriptions.docs == []


def test_pay_future_initial_purchase_still_activates_and_places_member(
        db, push_calls, whatsapp_calls):
    item = _activity_item()
    db.members.docs.append({"id": "m1", "activities": []})
    db.levels.docs.append({"id": "future-level", "members": []})
    db.invoices.docs.append(_invoice(member_id="m1", items=[item]))

    run(inv_mod.pay_invoice("inv1", admin()))

    activity = db.members.docs[0]["activities"][0]
    assert activity["start_date"] == item["start_date"]
    assert activity["end_date"] == item["end_date"]
    assert activity["source"] == "invoice"
    assert activity["source_id"] == "inv1"
    assert activity["source_period_key"]
    assert db.levels.docs[0]["members"] == ["m1"]
    assert db.level_subscriptions.docs[0]["invoice_id"] == "inv1"


def test_pay_arrived_expired_renewal_keeps_existing_overwrite_behavior(
        db, push_calls, whatsapp_calls):
    old = _activity_item(
        start_date=_date(-60), end_date=_date(-31),
        level_id="old-level", schedule="old schedule")
    arrived = _activity_item(
        start_date=_date(-30), end_date=_date(-1),
        level_id="", schedule="arrived schedule")
    db.members.docs.append({"id": "m1", "activities": [old]})
    db.invoices.docs.append(_invoice(
        member_id="m1", is_renewal=True, items=[arrived]))

    run(inv_mod.pay_invoice("inv1", admin()))

    activity = db.members.docs[0]["activities"][0]
    assert activity["start_date"] == arrived["start_date"]
    assert activity["end_date"] == arrived["end_date"]
    assert activity["status"] == "expired"
    assert activity["schedule"] == "arrived schedule"
    assert activity["source_id"] == "inv1"
