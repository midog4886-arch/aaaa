"""In-process accounting tests (chart of accounts + journal entries).

Replaces the live-HTTP scenarios in test_accounting_system.py for the
accounting core. Route handlers in backend/server.py are called directly with
the module-level ``db`` monkeypatched to fakes and a fake ``current_user`` dict
passed in place of the Depends(get_current_user) parameter.

Covered (highest value):
  - GET /accounts: returns list sorted by code; account_type / branch filters
  - Account structure: computed defaults (id, balance, branch scoping)
  - POST /accounts: duplicate code -> 400; non-admin branch scoping
  - POST /accounts/seed-default: seeds a well-formed tree; idempotent -> 400
    when accounts already exist; non-admin -> 403
  - POST /journal-entries: balanced entry accepted (balances + entry_number);
    unbalanced -> 400; float rounding tolerance
  - DELETE /accounts: blocked (400) when journal entries reference the account;
    404 when account missing
  - DELETE /journal-entries: non-admin -> 403; linked entry -> 400

Skipped vs legacy: login, suppliers, purchase-invoices, supplier-payments and
the end-to-end HTTP workflow tests (out of the accounting-core scope, or
require large multi-handler orchestration).
"""
import asyncio
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SESSION_SECRET", "test-secret")

import server  # noqa: E402


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── fakes ────────────────────────────────────────────────────────────────────

class _DeleteResult:
    def __init__(self, n):
        self.deleted_count = n


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, key, direction=1):
        self._docs.sort(key=lambda d: d.get(key), reverse=(direction == -1))
        return self

    async def to_list(self, n=None):
        return list(self._docs if n is None else self._docs[:n])


def _matches(doc, query):
    """Minimal Mongo-ish match: equality, $exists, dotted array field, $or."""
    for k, v in query.items():
        if k == "$or":
            if not any(_matches(doc, sub) for sub in v):
                return False
            continue
        if k == "lines.account_id":
            lines = doc.get("lines") or []
            if not any(ln.get("account_id") == v for ln in lines):
                return False
            continue
        actual = doc.get(k)
        if isinstance(v, dict):
            if "$exists" in v:
                present = k in doc
                if present != v["$exists"]:
                    return False
            if "$gte" in v and not (actual is not None and actual >= v["$gte"]):
                return False
            if "$lte" in v and not (actual is not None and actual <= v["$lte"]):
                return False
        else:
            if actual != v:
                return False
    return True


class _FakeCollection:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return type("R", (), {"inserted_id": doc.get("id")})()

    async def insert_many(self, docs):
        self.docs.extend(dict(d) for d in docs)
        return type("R", (), {"inserted_ids": [d.get("id") for d in docs]})()

    async def find_one(self, query, projection=None, sort=None):
        matched = [d for d in self.docs if _matches(d, query)]
        if sort:
            key, direction = sort[0]
            matched.sort(key=lambda d: d.get(key), reverse=(direction == -1))
        if not matched:
            return None
        d = dict(matched[0])
        d.pop("_id", None)
        return d

    def find(self, query=None, projection=None):
        query = query or {}
        matched = [{k: v for k, v in d.items() if k != "_id"}
                   for d in self.docs if _matches(d, query)]
        return _FakeCursor(matched)

    async def count_documents(self, query):
        return sum(1 for d in self.docs if _matches(d, query))

    async def delete_one(self, query):
        for i, d in enumerate(self.docs):
            if _matches(d, query):
                del self.docs[i]
                return _DeleteResult(1)
        return _DeleteResult(0)

    async def find_one_and_update(self, query, update, return_document=False):
        for d in self.docs:
            if _matches(d, query):
                d.update(update.get("$set", {}))
                return dict(d)
        return None

    def aggregate(self, pipeline):
        return _FakeCursor([])


class _FakeDB:
    def __init__(self):
        self.cols = {}

    def __getattr__(self, name):
        if name == "cols":
            raise AttributeError(name)
        return self.cols.setdefault(name, _FakeCollection())

    def __getitem__(self, name):
        return self.cols.setdefault(name, _FakeCollection())


ADMIN = {"user_id": "u1", "username": "admin", "is_admin": True, "branch_id": None}
STAFF = {"user_id": "u2", "username": "staff", "is_admin": False, "branch_id": "b1"}


@pytest.fixture()
def db(monkeypatch):
    fdb = _FakeDB()
    monkeypatch.setattr(server, "db", fdb)
    # user lookup used by create_journal_entry for created_by
    fdb["users"].docs.append({"id": "u1", "name": "Admin User"})
    fdb["users"].docs.append({"id": "u2", "name": "Staff User"})
    return fdb


def _make_account(code, name_ar="حساب", account_type="expenses", **kw):
    return server.AccountCreate(code=code, name_ar=name_ar, account_type=account_type, **kw)


def _je_line(account_id, code, name, debit=0.0, credit=0.0):
    return {
        "account_id": account_id, "account_code": code, "account_name": name,
        "debit": debit, "credit": credit, "description": "",
    }


def _je(lines, journal_type="general", **kw):
    return server.JournalEntryCreate(
        entry_date="2024-01-01", journal_type=journal_type,
        lines=[server.JournalEntryLine(**ln) for ln in lines], **kw)


# ── chart of accounts ─────────────────────────────────────────────────────────

def test_seed_default_accounts_creates_tree(db):
    out = run(server.seed_default_accounts(current_user=ADMIN))
    assert out["count"] == len(db["accounts"].docs) > 30
    codes = {a["code"] for a in db["accounts"].docs}
    # spot-check the five top-level types exist
    for top in ("1000", "2000", "3000", "4000", "5000"):
        assert top in codes
    # every seeded account has the computed/default fields
    for a in db["accounts"].docs:
        for field in ("id", "code", "name_ar", "account_type", "balance", "is_active"):
            assert field in a, field
        assert a["balance"] == 0 and a["is_active"] is True


def test_seed_default_is_idempotent(db):
    run(server.seed_default_accounts(current_user=ADMIN))
    count = len(db["accounts"].docs)
    with pytest.raises(HTTPException) as e:
        run(server.seed_default_accounts(current_user=ADMIN))
    assert e.value.status_code == 400
    assert "موجودة مسبقاً" in e.value.detail
    # unchanged: no duplicate insert on the failed rerun
    assert len(db["accounts"].docs) == count


def test_seed_default_requires_admin(db):
    with pytest.raises(HTTPException) as e:
        run(server.seed_default_accounts(current_user=STAFF))
    assert e.value.status_code == 403
    assert db["accounts"].docs == []


def test_get_accounts_sorted_and_filtered(db):
    run(server.seed_default_accounts(current_user=ADMIN))
    all_accounts = run(server.get_accounts(current_user=ADMIN))
    assert isinstance(all_accounts, list)
    codes = [a["code"] for a in all_accounts]
    assert codes == sorted(codes)  # sort("code", 1)
    # account_type filter
    revenue = run(server.get_accounts(account_type="revenue", current_user=ADMIN))
    assert revenue and all(a["account_type"] == "revenue" for a in revenue)


def test_create_account_sets_defaults(db):
    out = run(server.create_account(_make_account("9999", "حساب اختباري"), current_user=ADMIN))
    assert out["code"] == "9999"
    assert out["name_ar"] == "حساب اختباري"
    assert out["balance"] == 0
    assert out["branch_id"] is None  # admin, no branch passed
    assert "id" in out and "_id" not in out


def test_create_account_duplicate_code_rejected(db):
    run(server.create_account(_make_account("9999"), current_user=ADMIN))
    with pytest.raises(HTTPException) as e:
        run(server.create_account(_make_account("9999"), current_user=ADMIN))
    assert e.value.status_code == 400
    assert "موجود مسبقاً" in e.value.detail
    assert len(db["accounts"].docs) == 1


def test_create_account_non_admin_scoped_to_own_branch(db):
    # staff cannot set an arbitrary branch: handler forces their own branch_id
    out = run(server.create_account(_make_account("8888", branch_id="other"), current_user=STAFF))
    assert out["branch_id"] == "b1"


def test_delete_account_missing_returns_404(db):
    with pytest.raises(HTTPException) as e:
        run(server.delete_account("nope", current_user=ADMIN))
    assert e.value.status_code == 404


def test_delete_account_with_entries_blocked(db):
    acc = run(server.create_account(_make_account("5800", "مصاريف إدارية"), current_user=ADMIN))
    # a posted journal entry references this account
    run(server.create_journal_entry(_je([
        _je_line(acc["id"], "5800", "مصاريف إدارية", debit=100),
        _je_line("cash", "1110", "الصندوق", credit=100),
    ]), current_user=ADMIN))
    with pytest.raises(HTTPException) as e:
        run(server.delete_account(acc["id"], current_user=ADMIN))
    assert e.value.status_code == 400
    assert "قيود محاسبية" in e.value.detail
    # account still present
    assert any(a["id"] == acc["id"] for a in db["accounts"].docs)


def test_delete_account_success(db):
    acc = run(server.create_account(_make_account("7777"), current_user=ADMIN))
    out = run(server.delete_account(acc["id"], current_user=ADMIN))
    assert "message" in out
    assert db["accounts"].docs == []


# ── journal entries ────────────────────────────────────────────────────────────

def test_create_balanced_journal_entry(db):
    out = run(server.create_journal_entry(_je([
        _je_line("exp", "5800", "مصاريف", debit=500),
        _je_line("cash", "1110", "الصندوق", credit=500),
    ]), current_user=ADMIN))
    assert out["total_debit"] == 500
    assert out["total_credit"] == 500
    assert out["is_balanced"] is True
    assert out["status"] == "posted"
    assert out["entry_number"].startswith("JE-")
    assert out["created_by"] == "Admin User"


def test_journal_entry_numbers_increment(db):
    e1 = run(server.create_journal_entry(_je([
        _je_line("exp", "5800", "م", debit=100), _je_line("cash", "1110", "ص", credit=100),
    ]), current_user=ADMIN))
    e2 = run(server.create_journal_entry(_je([
        _je_line("exp", "5800", "م", debit=100), _je_line("cash", "1110", "ص", credit=100),
    ]), current_user=ADMIN))
    n1 = int(e1["entry_number"].replace("JE-", ""))
    n2 = int(e2["entry_number"].replace("JE-", ""))
    assert n2 == n1 + 1


def test_unbalanced_journal_entry_rejected(db):
    with pytest.raises(HTTPException) as e:
        run(server.create_journal_entry(_je([
            _je_line("a", "1000", "أ", debit=1000),
            _je_line("b", "2000", "ب", credit=500),  # intentionally unbalanced
        ]), current_user=ADMIN))
    assert e.value.status_code == 400
    assert "غير متوازن" in e.value.detail
    assert db["journal_entries"].docs == []


def test_journal_entry_balance_uses_rounding_tolerance(db):
    # 0.1 * 3 == 0.30000000000000004; handler rounds to 2 dp before compare
    out = run(server.create_journal_entry(_je([
        _je_line("a", "1", "أ", debit=0.1),
        _je_line("b", "2", "ب", debit=0.2),
        _je_line("c", "3", "ج", credit=0.3),
    ]), current_user=ADMIN))
    assert out["total_debit"] == out["total_credit"] == 0.3


def test_delete_journal_entry_non_admin_forbidden(db):
    out = run(server.create_journal_entry(_je([
        _je_line("a", "1", "أ", debit=100), _je_line("b", "2", "ب", credit=100),
    ]), current_user=ADMIN))
    with pytest.raises(HTTPException) as e:
        run(server.delete_journal_entry(out["id"], current_user=STAFF))
    assert e.value.status_code == 403


def test_delete_linked_journal_entry_blocked(db):
    out = run(server.create_journal_entry(_je(
        [_je_line("a", "1", "أ", debit=100), _je_line("b", "2", "ب", credit=100)],
        reference_type="purchase_invoice", reference_id="inv-1",
    ), current_user=ADMIN))
    with pytest.raises(HTTPException) as e:
        run(server.delete_journal_entry(out["id"], current_user=ADMIN))
    assert e.value.status_code == 400
    assert "مرتبط بعملية" in e.value.detail


def test_get_journal_entries_sorted_desc_by_date(db):
    run(server.create_journal_entry(server.JournalEntryCreate(
        entry_date="2024-01-01", journal_type="general",
        lines=[server.JournalEntryLine(**_je_line("a", "1", "أ", debit=1)),
               server.JournalEntryLine(**_je_line("b", "2", "ب", credit=1))],
    ), current_user=ADMIN))
    run(server.create_journal_entry(server.JournalEntryCreate(
        entry_date="2024-03-01", journal_type="general",
        lines=[server.JournalEntryLine(**_je_line("a", "1", "أ", debit=1)),
               server.JournalEntryLine(**_je_line("b", "2", "ب", credit=1))],
    ), current_user=ADMIN))
    entries = run(server.get_journal_entries(current_user=ADMIN))
    assert [e["entry_date"] for e in entries] == ["2024-03-01", "2024-01-01"]
