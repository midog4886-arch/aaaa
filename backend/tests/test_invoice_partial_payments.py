"""Partial customer payments retain the outstanding balance and cannot repeat."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routes import invoices as routes


class Invoices:
    def __init__(self):
        self.row = {'id': 'invoice-1', 'branch_id': 'branch-1', 'total': 750.0,
                    'status': 'pending', 'paid_amount': 0, 'remaining_amount': 750.0,
                    'payment_records': [], 'items': []}

    async def find_one(self, query, projection=None):
        return dict(self.row) if query.get('id') == self.row['id'] and query.get('branch_id', self.row['branch_id']) == self.row['branch_id'] else None

    async def update_one(self, query, update):
        if query.get('status') != self.row['status'] or query.get('paid_amount', self.row['paid_amount']) != self.row['paid_amount']:
            return SimpleNamespace(modified_count=0)
        payment_id = query.get('payment_records.id', {}).get('$ne')
        if any(p['id'] == payment_id for p in self.row['payment_records']):
            return SimpleNamespace(modified_count=0)
        self.row.update(update.get('$set', {}))
        if 'payment_records' in update.get('$push', {}):
            self.row['payment_records'].append(update['$push']['payment_records'])
        return SimpleNamespace(modified_count=1)


def test_partial_payment_updates_balance_and_is_idempotent(monkeypatch):
    invoices = Invoices()
    monkeypatch.setattr(routes, 'db', SimpleNamespace(invoices=invoices))
    user = {'is_admin': False, 'branch_id': 'branch-1', 'name': 'Reem'}
    payload = routes.InvoicePaymentInput(amount=300, method='cash', payment_id='unique-payment-1')
    result = asyncio.run(routes.record_invoice_partial_payment('invoice-1', payload, user))
    assert result['invoice']['status'] == 'partial'
    assert result['invoice']['paid_amount'] == 300
    assert result['invoice']['remaining_amount'] == 450
    assert result['invoice']['payment_records'][0]['created_by'] == 'Reem'
    repeated = asyncio.run(routes.record_invoice_partial_payment('invoice-1', payload, user))
    assert repeated['already_recorded'] is True
    assert len(invoices.row['payment_records']) == 1


def test_partial_payment_rejects_overpayment_and_full_amount(monkeypatch):
    invoices = Invoices()
    monkeypatch.setattr(routes, 'db', SimpleNamespace(invoices=invoices))
    user = {'is_admin': False, 'branch_id': 'branch-1'}
    for amount in (0, 750, 751):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(routes.record_invoice_partial_payment('invoice-1', routes.InvoicePaymentInput(amount=amount, payment_id='another-payment-1'), user))
        assert exc.value.status_code == 400
    assert invoices.row['paid_amount'] == 0
