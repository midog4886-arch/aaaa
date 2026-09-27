import asyncio
import uuid
from copy import deepcopy
from types import SimpleNamespace
from datetime import timedelta
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from routes import payment_links as p, invoices as invoices_routes


def match(row, query):
    for key, expected in query.items():
        if key == 'sends.id':
            if not any(e['id'] == expected for e in row.get('sends', [])): return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if '$in' in expected and not (any(a in expected['$in'] for a in actual) if isinstance(actual, list) else actual in expected['$in']): return False
            if '$ne' in expected and (expected['$ne'] in actual if isinstance(actual, list) else actual == expected['$ne']): return False
            if '$exists' in expected and (key in row) != expected['$exists']: return False
        elif actual != expected: return False
    return True


class Collection:
    def __init__(self): self.rows = []
    def find(self, query, projection=None):
        rows = deepcopy([r for r in self.rows if match(r, query)])
        class Cursor:
            def sort(self, *args): return self
            async def to_list(self, limit): return rows[:limit]
        return Cursor()
    async def find_one(self, query, projection=None): return deepcopy(next((r for r in self.rows if match(r, query)), None))
    async def update_one(self, query, update, upsert=False):
        row = next((r for r in self.rows if match(r, query)), None)
        if row is None:
            if not upsert: return SimpleNamespace(modified_count=0, matched_count=0)
            row = {**query, **deepcopy(update.get('$setOnInsert', {}))}; self.rows.append(row)
            return SimpleNamespace(modified_count=1, matched_count=1)
        before = deepcopy(row)
        for key, value in update.get('$set', {}).items():
            if key == 'sends.$.status':
                next(e for e in row['sends'] if e['id'] == query['sends.id'])['status'] = value
            else: row[key] = deepcopy(value)
        for key in update.get('$unset', {}): row.pop(key, None)
        for key, value in update.get('$push', {}).items(): row.setdefault(key, []).append(deepcopy(value))
        for key, value in update.get('$addToSet', {}).items():
            if value not in row.setdefault(key, []): row[key].append(value)
        return SimpleNamespace(modified_count=int(row != before), matched_count=1)
    async def update_many(self, query, update):
        for row in list(self.rows):
            if match(row, query): await self.update_one({'id': row['id']}, update)


@pytest.fixture
def db(monkeypatch):
    db = SimpleNamespace(invoices=Collection(), payment_links=Collection(), settings=Collection())
    db.invoices.rows = [{'id': 'i1', 'branch_id': 'b1', 'customer_phone': '0501234567', 'customer_name': 'الأول', 'total': 115, 'status': 'pending', 'items': [{'activity_name': 'السباحة', 'period': 'شهر'}]},
                       {'id': 'i2', 'branch_id': 'b1', 'customer_phone': '+966501234567', 'customer_name': 'الثاني', 'total': 230, 'status': 'pending', 'items': []}]
    monkeypatch.setattr(p, 'db', db)
    monkeypatch.setattr(p, 'get_current_tenant_slug', lambda: 'default')
    monkeypatch.setattr(p, 'gateway_key', lambda: '')
    monkeypatch.setattr(p, 'require_permission', AsyncMock())
    return db


def run(coro): return asyncio.run(coro)
def create(ids=None, user=None): return run(p.create_link(p.CreateLink(invoice_ids=ids or ['i1', 'i2'], request_id=uuid.uuid4()), user or {'is_admin': True, 'id': 'admin'}))


def test_family_creation_retry_and_overlap(db):
    payload = p.CreateLink(invoice_ids=['i1', 'i2'], request_id=uuid.uuid4())
    link = run(p.create_link(payload, {'is_admin': True, 'id': 'admin'}))
    assert run(p.create_link(payload, {'is_admin': True, 'id': 'admin'}))['token'] == link['token']
    assert len(link['token']) >= 40 and sum(link['amounts'].values()) == 34500
    with pytest.raises(HTTPException) as err: create(['i1'])
    assert err.value.status_code == 409
    public = run(p.get_public_link(link['token']))
    assert public['total'] == 345 and public['gateway_ready'] is False
    assert len(public['invoices']) == 2 and 'phone' not in public
    with pytest.raises(HTTPException) as err: run(p.checkout(link['token']))
    assert err.value.status_code == 503
    assert not db.invoices.rows[0].get('online_payment_link_id')


@pytest.mark.parametrize('change', [{'branch_id': 'b2'}, {'customer_phone': '0509999999'}, {'status': 'paid'}])
def test_family_rejects_mixed_branch_phone_or_paid_invoice(db, change):
    db.invoices.rows[1].update(change)
    with pytest.raises(HTTPException): create()


def test_scope_states_and_amount_tampering(db):
    with pytest.raises(HTTPException) as err: create(['i1'], {'branch_id': 'b2'})
    assert err.value.status_code == 404
    link = create()
    rows = deepcopy(db.invoices.rows)
    assert p.link_state(link, rows) == 'pending'
    link['expires_at'] = (p.now() - timedelta(seconds=1)).isoformat()
    assert p.link_state(link, rows) == 'expired'
    link['expires_at'] = (p.now() + timedelta(days=1)).isoformat()
    rows[0]['total'] = 1
    assert p.link_state(link, rows) == 'cancelled'
    assert p.link_state(link, []) == 'cancelled'


def test_checkout_reserves_invoices_once_and_uses_server_amount(db, monkeypatch):
    link = create()
    monkeypatch.setattr(p, 'gateway_key', lambda: 'test')
    gateway = AsyncMock(return_value={'id': 'gateway1', 'amount': 34500, 'currency': 'SAR', 'url': 'https://checkout.moyasar.com/invoices/gateway1'})
    monkeypatch.setattr(p, 'gateway_request', gateway)
    first = run(p.checkout(link['token']))
    second = run(p.checkout(link['token']))
    assert first == second and gateway.await_count == 1
    assert gateway.call_args.kwargs['json']['amount'] == 34500
    assert all(i['online_payment_link_id'] == link['id'] for i in db.invoices.rows)


def test_paid_verification_is_idempotent_and_creates_each_child_receipt(db, monkeypatch):
    link = create()
    db.payment_links.rows[0].update(gateway_invoice_id='gateway1')
    link['gateway_invoice_id'] = 'gateway1'
    gateway = AsyncMock(return_value={'id': 'gateway1', 'status': 'paid', 'amount': 34500, 'currency': 'SAR', 'metadata': {'academy_link_id': link['id']}})
    monkeypatch.setattr(p, 'gateway_request', gateway)
    paid = []
    async def pay(iid, actor):
        paid.append(iid)
        await db.invoices.update_one({'id': iid}, {'$set': {'status': 'paid', 'paid_at': p.now().isoformat()}})
    monkeypatch.setattr(invoices_routes, 'pay_invoice', pay)
    assert run(p.verify_public(link['token']))['paid']
    assert run(p.verify_public(link['token']))['paid']
    assert paid == ['i1', 'i2'] and gateway.await_count == 1
    assert run(p.get_public_link(link['token']))['state'] == 'paid'


@pytest.mark.parametrize('field,value', [('amount', 1), ('currency', 'USD'), ('id', 'wrong'), ('metadata', {})])
def test_gateway_paid_payload_mismatch_never_marks_paid(db, monkeypatch, field, value):
    link = create(); link['gateway_invoice_id'] = 'g'
    record = {'id': 'g', 'status': 'paid', 'amount': 34500, 'currency': 'SAR', 'metadata': {'academy_link_id': link['id']}}
    record[field] = value
    monkeypatch.setattr(p, 'gateway_request', AsyncMock(return_value=record))
    pay = AsyncMock(); monkeypatch.setattr(invoices_routes, 'pay_invoice', pay)
    with pytest.raises(HTTPException): run(p.verify_link(link))
    pay.assert_not_called()


def test_unknown_creation_is_not_retried_or_released(db, monkeypatch):
    link = create()
    monkeypatch.setattr(p, 'gateway_key', lambda: 'test')
    gateway = AsyncMock(side_effect=HTTPException(502, 'timeout'))
    monkeypatch.setattr(p, 'gateway_request', gateway)
    with pytest.raises(HTTPException): run(p.checkout(link['token']))
    with pytest.raises(HTTPException): run(p.checkout(link['token']))
    with pytest.raises(HTTPException): run(p.cancel_link(link['id'], {'is_admin': True}))
    assert gateway.await_count == 1
    assert run(p.get_public_link(link['token']))['state'] == 'review'


def test_whatsapp_sends_record_actor_outcome_and_block_rapid_duplicates(db, monkeypatch):
    from routes import whatsapp
    link = create()
    sender = AsyncMock(return_value=True)
    monkeypatch.setattr(whatsapp, '_send_wa_message_for_branch', sender)
    assert run(p.send_link(link, 'أحمد'))['sent']
    event = db.payment_links.rows[0]['sends'][0]
    assert event['actor'] == 'أحمد' and event['status'] == 'sent' and event['at']
    with pytest.raises(HTTPException) as error: run(p.send_link(db.payment_links.rows[0], 'أحمد'))
    assert error.value.status_code == 429 and sender.await_count == 1


def test_reminders_are_limited_and_stop_after_payment(db, monkeypatch):
    link = create()
    stored = db.payment_links.rows[0]
    stored['reminders_enabled'] = True
    stored['created_at'] = (p.now() - timedelta(days=1, seconds=5)).isoformat()
    monkeypatch.setattr(p, 'gateway_key', lambda: 'test')
    sender = AsyncMock(); monkeypatch.setattr(p, 'send_link', sender)
    run(p.payment_link_reminders()); run(p.payment_link_reminders())
    assert sender.await_count == 1
    stored['created_at'] = (p.now() - timedelta(days=3, seconds=5)).isoformat()
    run(p.payment_link_reminders()); run(p.payment_link_reminders())
    assert sender.await_count == 2
    for invoice in db.invoices.rows: invoice['status'] = 'paid'
    run(p.payment_link_reminders())
    assert sender.await_count == 2
