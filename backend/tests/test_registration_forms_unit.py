"""In-process unit tests for registration forms, dashboard pending-forms
stats, invoice creation supervisor_name, and form->invoice conversion.

Rewritten from the following legacy live-HTTP integration suites (deleted):
  - tests/test_pending_forms_dashboard.py
  - tests/test_registration_forms_update.py
  - tests/test_supervisor_name.py

These call the real route handlers directly (server.py + routes/invoices.py)
with a monkeypatched module-level ``db`` replaced by in-memory fakes, so they
run with NO server and NO real DB. Auth Depends is bypassed by passing a fake
``current_user`` dict straight into the handler.

Covered:
  - get registration form by id (+ 404 for missing)
  - update a pending form: fields persist; items update + totals recompute
    (registration forms keep total WITHOUT VAT — legacy invariant)
  - cannot update a converted form -> 400; 404 for missing form on update
  - dashboard stats expose pending_forms_count/total matching the collection
    (and honor pending status + branch scoping)
  - invoice create saves supervisor_name (from the users collection)
  - registration-form convert carries supervisor_name onto the created invoice
    and merges member.activities by activity_id (not $push)

Not covered here (out of scope per task): login, cleanup, and /pay flow.
"""
import asyncio
import os
import sys
import uuid

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SESSION_SECRET", "test-secret")


def run(coro):
    # Own loop per call: order-independent under the full suite (other tests
    # may close/replace the process-global loop via asyncio.run).
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── fakes ────────────────────────────────────────────────────────────────────

def _matches(doc, query):
    """Small Mongo matcher for the fields exercised by these unit handlers."""
    for k, v in query.items():
        if k == "$or":
            if not any(_matches(doc, branch) for branch in v):
                return False
            continue
        if isinstance(v, dict):
            if "$exists" in v and ((k in doc) != bool(v["$exists"])):
                return False
            if "$in" in v and doc.get(k) not in v["$in"]:
                return False
            if "$ne" in v and doc.get(k) == v["$ne"]:
                return False
            # Range/regex operators are not needed by these handlers.
            continue
        if doc.get(k) != v:
            return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, *a, **k):
        return self

    async def to_list(self, n=None):
        return list(self._docs)

    def __aiter__(self):
        self._it = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class _FakeCollection:
    def __init__(self):
        self.docs = {}          # id -> doc
        self._auto = 0

    def _id_of(self, doc):
        return doc.get("id") or doc.get("member_id") or str(id(doc))

    async def insert_one(self, doc):
        # Mongo would stamp _id on the passed dict; handlers then `del doc["_id"]`.
        self._auto += 1
        doc["_id"] = f"oid-{self._auto}"
        self.docs[self._id_of(doc)] = doc

        class R:
            inserted_id = doc["_id"]
        return R()

    async def find_one(self, query, proj=None):
        for d in self.docs.values():
            if _matches(d, query):
                return {k: v for k, v in d.items() if k != "_id"} if proj and proj.get("_id") == 0 else dict(d)
        return None

    async def update_one(self, query, update, upsert=False):
        target = None
        for d in self.docs.values():
            if _matches(d, query):
                target = d
                break
        if target is None:
            if upsert:
                target = {k: v for k, v in query.items() if not isinstance(v, dict)}
                self.docs[self._id_of(target)] = target
            else:
                class R0:
                    modified_count = 0
                return R0()
        if "$set" in update:
            target.update(update["$set"])
        if "$addToSet" in update:
            for field, val in update["$addToSet"].items():
                arr = target.setdefault(field, [])
                if val not in arr:
                    arr.append(val)

        class R:
            modified_count = 1
        return R()

    async def delete_one(self, query):
        for key, d in list(self.docs.items()):
            if _matches(d, query):
                del self.docs[key]

                class R:
                    deleted_count = 1
                return R()

        class R0:
            deleted_count = 0
        return R0()

    async def count_documents(self, query):
        return sum(1 for d in self.docs.values() if _matches(d, query))

    def find(self, query=None, proj=None):
        query = query or {}
        matched = [
            {k: v for k, v in d.items() if k != "_id"}
            for d in self.docs.values()
            if _matches(d, query)
        ]
        return _FakeCursor(matched)


class _FakeDB:
    def __init__(self):
        self.cols = {}

    def __getattr__(self, name):
        if name.startswith("_") or name == "cols":
            raise AttributeError(name)
        return self.cols.setdefault(name, _FakeCollection())

    def __getitem__(self, name):
        return self.cols.setdefault(name, _FakeCollection())


class _RaceRegistrationCollection(_FakeCollection):
    """Return two identical snapshots before allowing either CAS write."""

    def __init__(self):
        super().__init__()
        self._snapshots = 0
        self.intervening_status = None

    async def find_one(self, query, proj=None):
        snapshot = await super().find_one(query, proj)
        if query.get("id") == "request-race":
            self._snapshots += 1
            if self._snapshots <= 2:
                await asyncio.sleep(0)
        return snapshot

    async def update_one(self, query, update, upsert=False):
        if self.intervening_status and query.get("id") == "request-race":
            self.docs["request-race"]["status"] = self.intervening_status
            self.intervening_status = None
        target = next(
            (doc for doc in self.docs.values() if _matches(doc, query)),
            None,
        )
        if target is None:
            class R0:
                matched_count = 0
                modified_count = 0
            return R0()
        target.update(update.get("$set", {}))

        class R:
            matched_count = 1
            modified_count = 1
        return R()


# ── shared fixtures ────────────────────────────────────────────────────────

ADMIN = {"user_id": "u1", "id": "u1", "username": "admin", "is_admin": True, "branch_id": None}


@pytest.fixture()
def srv(monkeypatch):
    """Wire server.py's module-level db to a fresh fake."""
    import server
    fdb = _FakeDB()
    monkeypatch.setattr(server, "db", fdb)
    return server, fdb


def _make_form_doc(fdb, **overrides):
    """Insert a pending registration form directly into the fake collection."""
    form = {
        "id": overrides.get("id", str(uuid.uuid4())),
        "form_number": "REG-00001",
        "customer_name": "Ali",
        "customer_phone": "0501234567",
        "items": [
            {"activity_id": "a1", "activity_name": "Swimming", "fee": 100.0,
             "quantity": 1, "is_product": False, "start_date": "", "end_date": ""}
        ],
        "subtotal": 100.0,
        "discount": 10.0,
        "discount_code": "",
        "vat_amount": 0,
        "total": 90.0,
        "payment_method": "cash",
        "notes": "",
        "branch_id": None,
        "status": "pending",
        "created_at": "2025-01-01T00:00:00+00:00",
    }
    form.update(overrides)
    run(fdb.registration_forms.insert_one(dict(form)))
    return form


def _reg_create_model(server, **overrides):
    data = {
        "customer_name": "Ali",
        "customer_phone": "0501234567",
        "items": [
            {"activity_id": "a1", "activity_name": "Swimming", "fee": 100.0,
             "quantity": 1, "is_product": False}
        ],
        "subtotal": 100.0,
        "discount": 10.0,
        "vat_amount": 0,
        "total": 90.0,
        "payment_method": "cash",
        "notes": "",
    }
    data.update(overrides)
    return server.RegistrationFormCreate(**data)


# ── GET form by id ─────────────────────────────────────────────────────────

def test_get_form_by_id(srv):
    server, fdb = srv
    form = _make_form_doc(fdb)
    out = run(server.get_registration_form(form["id"], current_user=ADMIN))
    assert out["id"] == form["id"]
    assert out["customer_name"] == "Ali"
    assert "_id" not in out


def test_get_missing_form_404(srv):
    server, fdb = srv
    with pytest.raises(HTTPException) as e:
        run(server.get_registration_form("nope", current_user=ADMIN))
    assert e.value.status_code == 404


# ── UPDATE pending form ──────────────────────────────────────────────────────

def test_update_pending_form_persists_fields(srv):
    server, fdb = srv
    form = _make_form_doc(fdb)
    model = _reg_create_model(
        server, customer_name="Ali - edited", notes="changed"
    )
    out = run(server.update_registration_form(form["id"], model, current_user=ADMIN))
    assert out["customer_name"] == "Ali - edited"
    assert out["notes"] == "changed"
    assert "updated_at" in out
    # Persisted in the store, not just echoed
    stored = run(fdb.registration_forms.find_one({"id": form["id"]}))
    assert stored["customer_name"] == "Ali - edited"


def test_update_form_items_recompute_total_without_vat(srv):
    server, fdb = srv
    form = _make_form_doc(fdb)
    # Two items: 100 + 200 = 300 subtotal, discount 10 -> total 290 (NO VAT)
    new_items = [
        {"activity_id": "a1", "activity_name": "Swimming", "fee": 100.0,
         "quantity": 1, "is_product": False},
        {"activity_id": "a2", "activity_name": "Karate", "fee": 200.0,
         "quantity": 1, "is_product": False},
    ]
    subtotal = sum(i["fee"] * i["quantity"] for i in new_items)
    total = subtotal - 10.0
    model = _reg_create_model(
        server, items=new_items, subtotal=subtotal, discount=10.0,
        vat_amount=0, total=total,
    )
    out = run(server.update_registration_form(form["id"], model, current_user=ADMIN))
    assert len(out["items"]) == 2
    assert out["subtotal"] == 300.0
    # Registration-form invariant: total is WITHOUT VAT (subtotal - discount).
    assert out["total"] == 290.0
    assert out["vat_amount"] == 0


def test_cannot_update_converted_form(srv):
    server, fdb = srv
    form = _make_form_doc(fdb, status="converted")
    model = _reg_create_model(server, customer_name="hacked")
    with pytest.raises(HTTPException) as e:
        run(server.update_registration_form(form["id"], model, current_user=ADMIN))
    assert e.value.status_code == 400
    assert "converted" in e.value.detail.lower()


def test_update_missing_form_404(srv):
    server, fdb = srv
    model = _reg_create_model(server)
    with pytest.raises(HTTPException) as e:
        run(server.update_registration_form("nope", model, current_user=ADMIN))
    assert e.value.status_code == 404


# ── DASHBOARD stats: pending forms ───────────────────────────────────────────

def test_dashboard_stats_pending_forms_count_and_total(srv, monkeypatch):
    server, fdb = srv
    import utils.tenant as tenant_mod
    # Unique tenant slug guarantees a cache miss so the loader actually runs.
    monkeypatch.setattr(tenant_mod, "get_current_tenant_slug",
                        lambda: "unit-" + uuid.uuid4().hex)

    # Two pending forms (90 + 40) and one converted (should be excluded).
    _make_form_doc(fdb, id="f1", total=90.0, status="pending")
    _make_form_doc(fdb, id="f2", total=40.0, status="pending")
    _make_form_doc(fdb, id="f3", total=500.0, status="converted")

    stats = run(server.get_dashboard_stats(branch_filter=None, current_user=ADMIN))
    assert stats["pending_forms_count"] == 2
    assert abs(stats["pending_forms_total"] - 130.0) < 0.01


def test_dashboard_stats_pending_forms_branch_scoped(srv, monkeypatch):
    server, fdb = srv
    import utils.tenant as tenant_mod
    monkeypatch.setattr(tenant_mod, "get_current_tenant_slug",
                        lambda: "unit-" + uuid.uuid4().hex)

    _make_form_doc(fdb, id="b1", total=90.0, status="pending", branch_id="B1")
    _make_form_doc(fdb, id="b2", total=40.0, status="pending", branch_id="B2")

    non_admin = {"user_id": "u2", "id": "u2", "username": "staff",
                 "is_admin": False, "branch_id": "B1"}
    stats = run(server.get_dashboard_stats(branch_filter=None, current_user=non_admin))
    assert stats["pending_forms_count"] == 1
    assert abs(stats["pending_forms_total"] - 90.0) < 0.01


# ── INVOICE create: supervisor_name ─────────────────────────────────────────

@pytest.fixture()
def inv(monkeypatch):
    """Wire routes/invoices.py db to a fresh fake with a users doc."""
    from routes import invoices as inv_mod
    fdb = _FakeDB()
    monkeypatch.setattr(inv_mod, "db", fdb)
    run(fdb.users.insert_one({"id": "u1", "name": "مدير النظام"}))
    return inv_mod, fdb


def test_create_invoice_saves_supervisor_name(inv):
    inv_mod, fdb = inv
    # Product-only invoice with no member: avoids member/branch DB lookups and
    # the /pay path, exercising the supervisor_name + totals logic directly.
    model = inv_mod.InvoiceCreate(
        items=[inv_mod.InvoiceItem(
            activity_name="Ball", fee=100.0, period="", is_product=True,
            product_id="p1", quantity=1)],
        discount=0,
        notes="test",
        payment_method="cash",
        customer_name_ar="Walk-in",
        customer_phone="0500000000",
    )
    out = run(inv_mod.create_invoice(model, current_user=ADMIN))
    assert out.supervisor_name == "مدير النظام"
    # VAT applied to invoices (unlike registration forms): 100 * 0.15 = 15.
    assert out.vat_amount == 15.0
    assert out.total == 115.0
    stored = run(fdb.invoices.find_one({"id": out.id}))
    assert stored["supervisor_name"] == "مدير النظام"


def test_create_invoice_falls_back_to_username_without_user_doc(inv):
    inv_mod, fdb = inv
    model = inv_mod.InvoiceCreate(
        items=[inv_mod.InvoiceItem(
            activity_name="Ball", fee=50.0, period="", is_product=True,
            product_id="p1", quantity=1)],
        payment_method="cash",
    )
    other = dict(ADMIN, user_id="ghost", id="ghost", username="frontdesk")
    out = run(inv_mod.create_invoice(model, current_user=other))
    assert out.supervisor_name == "frontdesk"


def test_create_invoice_links_registration_request_after_insert(inv, monkeypatch):
    inv_mod, fdb = inv
    async def _seq_start():
        return 30001
    monkeypatch.setattr(inv_mod, "get_branch_seq_start", lambda *_args: _seq_start())
    run(fdb.registration_requests.insert_one({
        "id": "request-1",
        "branch_id": "B1",
        "status": "pending",
    }))
    model = inv_mod.InvoiceCreate(
        items=[inv_mod.InvoiceItem(
            activity_name="Ball", fee=100.0, period="", is_product=True,
            product_id="p1", quantity=1)],
        payment_method="cash",
        branch_id="B1",
        registration_request_id="request-1",
    )
    out = run(inv_mod.create_invoice(model, current_user=ADMIN))
    stored_request = run(fdb.registration_requests.find_one({"id": "request-1"}))
    stored_invoice = run(fdb.invoices.find_one({"id": out.id}))
    assert stored_request["status"] == "processed"
    assert stored_request["invoice_id"] == out.id
    assert stored_invoice["registration_request_id"] == "request-1"
    assert stored_invoice["status"] == "pending"

    with pytest.raises(HTTPException) as exc:
        run(inv_mod.create_invoice(model, current_user=ADMIN))
    assert exc.value.status_code == 409


def test_concurrent_registration_invoice_creates_use_one_cas_winner(inv, monkeypatch):
    inv_mod, fdb = inv
    async def _seq_start():
        return 30001
    monkeypatch.setattr(inv_mod, "get_branch_seq_start", lambda *_args: _seq_start())
    fdb.cols["registration_requests"] = _RaceRegistrationCollection()
    run(fdb.registration_requests.insert_one({
        "id": "request-race",
        "branch_id": "B1",
        "status": "pending",
    }))
    model = inv_mod.InvoiceCreate(
        items=[inv_mod.InvoiceItem(
            activity_name="Ball", fee=100.0, period="", is_product=True,
            product_id="p1", quantity=1)],
        payment_method="cash",
        branch_id="B1",
        registration_request_id="request-race",
    )

    async def _create_both():
        return await asyncio.gather(
            inv_mod.create_invoice(model, current_user=ADMIN),
            inv_mod.create_invoice(model, current_user=ADMIN),
            return_exceptions=True,
        )

    results = run(_create_both())
    successes = [result for result in results if not isinstance(result, HTTPException)]
    failures = [result for result in results if isinstance(result, HTTPException)]
    assert len(successes) == 1
    assert len(failures) == 1
    assert failures[0].status_code == 409
    stored_request = run(fdb.registration_requests.find_one({"id": "request-race"}))
    assert stored_request["status"] == "processed"
    assert len(fdb.invoices.docs) == 1
    assert fdb.invoices.docs[next(iter(fdb.invoices.docs))]["id"] == stored_request["invoice_id"]


@pytest.mark.parametrize("intervening_status", ["archived", "rejected"])
def test_registration_invoice_cas_does_not_overwrite_terminal_race(
    inv, monkeypatch, intervening_status
):
    inv_mod, fdb = inv
    async def _seq_start():
        return 30001
    monkeypatch.setattr(inv_mod, "get_branch_seq_start", lambda *_args: _seq_start())
    requests = _RaceRegistrationCollection()
    fdb.cols["registration_requests"] = requests
    run(requests.insert_one({
        "id": "request-race",
        "branch_id": "B1",
        "status": "pending",
    }))
    requests.intervening_status = intervening_status
    model = inv_mod.InvoiceCreate(
        items=[inv_mod.InvoiceItem(
            activity_name="Ball", fee=100.0, period="", is_product=True,
            product_id="p1", quantity=1)],
        payment_method="cash",
        branch_id="B1",
        registration_request_id="request-race",
    )
    with pytest.raises(HTTPException) as exc:
        run(inv_mod.create_invoice(model, current_user=ADMIN))
    assert exc.value.status_code == 409
    stored_request = run(requests.find_one({"id": "request-race"}))
    assert stored_request["status"] == intervening_status
    assert "invoice_id" not in stored_request
    assert fdb.invoices.docs == {}


def test_failed_invoice_validation_leaves_registration_request_pending(inv):
    inv_mod, fdb = inv
    run(fdb.registration_requests.insert_one({
        "id": "request-failed",
        "branch_id": None,
        "status": "pending",
    }))
    model = inv_mod.InvoiceCreate(
        items=[inv_mod.InvoiceItem(
            activity_name="Swimming", fee=100.0, period="", is_product=False,
        )],
        payment_method="cash",
        registration_request_id="request-failed",
    )
    with pytest.raises(HTTPException) as exc:
        run(inv_mod.create_invoice(model, current_user=ADMIN))
    assert exc.value.status_code == 422
    stored_request = run(fdb.registration_requests.find_one({"id": "request-failed"}))
    assert stored_request["status"] == "pending"
    assert run(fdb.invoices.find_one({"registration_request_id": "request-failed"})) is None


# ── CONVERT form -> invoice ──────────────────────────────────────────────────

def test_convert_form_carries_supervisor_name(srv):
    server, fdb = srv
    run(fdb.users.insert_one({"id": "u1", "name": "مدير النظام"}))
    # Product-only form (no member link required) with branch_id=None.
    form = _make_form_doc(
        fdb,
        items=[{"activity_id": "", "activity_name": "Ball", "fee": 100.0,
                "quantity": 1, "is_product": True, "start_date": "", "end_date": ""}],
    )
    result = run(server.convert_registration_form(form["id"], current_user=ADMIN))
    invoice = result["invoice"]
    assert invoice["supervisor_name"] == "مدير النظام"
    assert invoice["registration_form_id"] == form["id"]
    # Total copied straight from the form (no VAT re-computation on convert).
    assert invoice["total"] == 90.0
    # Form deleted after conversion.
    assert run(fdb.registration_forms.find_one({"id": form["id"]})) is None


def test_convert_missing_form_404(srv):
    server, fdb = srv
    with pytest.raises(HTTPException) as e:
        run(server.convert_registration_form("nope", current_user=ADMIN))
    assert e.value.status_code == 404


def test_convert_already_converted_form_400(srv):
    server, fdb = srv
    form = _make_form_doc(fdb, status="converted")
    with pytest.raises(HTTPException) as e:
        run(server.convert_registration_form(form["id"], current_user=ADMIN))
    assert e.value.status_code == 400


def test_convert_activity_form_requires_member_link(srv):
    server, fdb = srv
    run(fdb.users.insert_one({"id": "u1", "name": "مدير النظام"}))
    # Activity (non-product) form with NO member_id -> 422 (cannot convert).
    form = _make_form_doc(fdb)  # default item is an activity, no member_id
    with pytest.raises(HTTPException) as e:
        run(server.convert_registration_form(form["id"], current_user=ADMIN))
    assert e.value.status_code == 422


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
