"""Real purchase handler, isolated collections; no live accounting writes."""
from test_accounting_unit import db, run, server, _FakeCollection, ADMIN, STAFF
import pytest
from fastapi import HTTPException


async def update_one(self, query, update):
    for row in self.docs:
        if all(row.get(k) == v for k, v in query.items()):
            row.update(update.get("$set", {}))
            for key, value in update.get("$inc", {}).items():
                row[key] = row.get(key, 0) + value


def prepare(db, monkeypatch):
    monkeypatch.setattr(_FakeCollection, "update_one", update_one, raising=False)
    db.suppliers.docs.extend([
        {"id": "s1", "name_ar": "Supplier1", "branch_id": "b1", "balance": 5},
        {"id": "s2", "name_ar": "Supplier2", "branch_id": "b2", "balance": 70},
    ])
    db.accounts.docs.extend(
        {"id": code, "code": code, "name_ar": code}
        for code in ("5200", "1150", "2110")
    )
    return server.PurchaseInvoiceCreate(
        supplier_id="s1", invoice_date="2026-09-26", branch_id="b2",
        items=[server.PurchaseInvoiceItem(description="Goods", quantity=2, unit_price=100, tax_rate=15)],
    )


def test_purchase_balanced_vat_and_supplier_branch_isolation(db, monkeypatch):
    invoice = prepare(db, monkeypatch)
    result = run(server.create_purchase_invoice(invoice, STAFF))
    entry = db.journal_entries.docs[0]
    assert result["branch_id"] == entry["branch_id"] == "b1"
    assert result["journal_entry_id"] == entry["id"]
    assert entry["reference_id"] == result["id"]
    assert sum(x["debit"] for x in entry["lines"]) == 230
    assert sum(x["credit"] for x in entry["lines"]) == 230
    assert [(x["account_code"], x["debit"], x["credit"]) for x in entry["lines"]] == [
        ("5200", 200, 0), ("1150", 30, 0), ("2110", 0, 230)]
    assert db.suppliers.docs[0]["balance"] == 235
    assert db.suppliers.docs[1]["balance"] == 70
    assert not db.payment_transactions.docs


def test_missing_vat_account_rejects_before_any_writes(db, monkeypatch):
    invoice = prepare(db, monkeypatch)
    db.accounts.docs = [a for a in db.accounts.docs if a["code"] != "1150"]
    with pytest.raises(HTTPException) as exc:
        run(server.create_purchase_invoice(invoice, ADMIN))
    assert exc.value.status_code == 400
    assert not db.purchase_invoices.docs and not db.journal_entries.docs
    assert db.suppliers.docs[0]["balance"] == 5


def test_other_branch_supplier_rejected(db, monkeypatch):
    invoice = prepare(db, monkeypatch)
    invoice.supplier_id = "s2"
    with pytest.raises(HTTPException) as exc:
        run(server.create_purchase_invoice(invoice, STAFF))
    assert exc.value.status_code == 403
    assert not db.purchase_invoices.docs and not db.journal_entries.docs