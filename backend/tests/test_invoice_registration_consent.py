"""Signed registration forms are scoped and tied to the reviewed invoice revision."""
import asyncio
import base64
import io
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routes import invoice_consents as route
from PIL import Image


def sample_signature():
    image = Image.new('RGB', (300, 100), 'white')
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()


class Collection:
    def __init__(self, rows=None):
        self.rows = rows or []

    async def find_one(self, query, projection=None, sort=None):
        rows = [row for row in self.rows if all(row.get(k) == v for k, v in query.items())]
        if sort:
            rows.sort(key=lambda row: row.get(sort[0][0], 0), reverse=True)
        return dict(rows[0]) if rows else None

    async def insert_one(self, row):
        self.rows.append(dict(row))

    def find(self, query, projection=None):
        rows = [dict(row) for row in self.rows if all(row.get(k) == v for k, v in query.items())]
        class Cursor:
            def sort(self, key, direction):
                rows.sort(key=lambda row: row.get(key, ''), reverse=direction < 0)
                return self
            async def to_list(self, length):
                return rows[:length] if length is not None else rows
        return Cursor()

    async def update_one(self, query, change):
        for row in self.rows:
            if all(row.get(k) == v for k, v in query.items()):
                row.update(change['$set'])
                return


def fixture_db(monkeypatch):
    invoice = {'id': 'i1', 'invoice_number': '530405', 'branch_id': 'b1', 'status': 'pending',
               'customer_name_ar': 'طفل', 'total': 500, 'items': [{'activity_name': 'سباحة يومين', 'is_product': False}]}
    database = SimpleNamespace(invoices=Collection([invoice]), invoice_consents=Collection(), invoice_consent_links=Collection(), registration_consent_settings=Collection())
    monkeypatch.setattr(route, 'db', database)
    user = {'is_admin': False, 'branch_id': 'b1', 'username': 'staff'}
    return invoice, database, user


def payload(invoice):
    return route.ConsentInput(expected_invoice_hash=route.snapshot_hash(route.invoice_snapshot(invoice)), expected_terms_version=route.TERMS_VERSION,
        child_name='اسم الطفل', guardian_name='اسم ولي الأمر', relationship='الأب',
        guardian_identity='1234567890', emergency_phone='0500000000', has_medical_condition=False,
        signer_name='اسم ولي الأمر', accepted=True, signature_png=sample_signature())


def test_consent_is_immutable_and_requires_new_version_after_invoice_edit(monkeypatch):
    invoice, database, user = fixture_db(monkeypatch)
    first = asyncio.run(route.sign_registration_consent('i1', payload(invoice), user))
    assert first['version'] == 1
    with pytest.raises(HTTPException) as repeated:
        asyncio.run(route.sign_registration_consent('i1', payload(invoice), user))
    assert repeated.value.status_code == 409
    invoice['total'] = 600
    database.invoices.rows[0]['total'] = 600
    state = asyncio.run(route.get_registration_consent('i1', user))
    assert state['needs_resign'] is True
    with pytest.raises(HTTPException) as stale:
        asyncio.run(route.sign_registration_consent('i1', payload({'id': 'i1', 'invoice_number': '530405', 'branch_id': 'b1', 'total': 500, 'items': invoice['items']}), user))
    assert stale.value.status_code == 409
    second = asyncio.run(route.sign_registration_consent('i1', payload(invoice), user))
    assert second['version'] == 2
    assert len(database.invoice_consents.rows) == 2


def test_consent_rejects_other_branch_and_missing_medical_details(monkeypatch):
    invoice, database, user = fixture_db(monkeypatch)
    with pytest.raises(HTTPException) as forbidden:
        asyncio.run(route.get_registration_consent('i1', {'is_admin': False, 'branch_id': 'b2'}))
    assert forbidden.value.status_code == 403
    form = payload(invoice)
    form.has_medical_condition = True
    with pytest.raises(HTTPException) as medical:
        asyncio.run(route.sign_registration_consent('i1', form, user))
    assert medical.value.status_code == 422
    assert not database.invoice_consents.rows


def test_mobile_link_signs_once_and_invalidates_when_invoice_changes(monkeypatch):
    invoice, database, user = fixture_db(monkeypatch)
    async def allow(_user, _permission):
        return None
    monkeypatch.setattr(route, 'require_permission', allow)
    created = asyncio.run(route.create_registration_consent_link('i1', user))
    assert 'token' in created
    assert 'token' not in database.invoice_consent_links.rows[0]
    state = asyncio.run(route.get_public_registration_consent(created['token']))
    assert state['status'] == 'pending'
    history = asyncio.run(route.get_registration_consent_links('i1', user))['links']
    assert history[0]['status'] == 'created'
    assert history[0]['created_by'] == 'staff'
    asyncio.run(route.mark_registration_consent_whatsapp_opened('i1', created['id'], user))
    assert asyncio.run(route.get_registration_consent_links('i1', user))['links'][0]['status'] == 'awaiting_signature'
    result = asyncio.run(route.sign_public_registration_consent(created['token'], payload(invoice)))
    assert result['status'] == 'signed'
    assert asyncio.run(route.get_registration_consent_links('i1', user))['links'][0]['status'] == 'signed'
    assert asyncio.run(route.get_public_registration_consent(created['token']))['status'] == 'signed'
    with pytest.raises(HTTPException) as repeated:
        asyncio.run(route.sign_public_registration_consent(created['token'], payload(invoice)))
    assert repeated.value.status_code == 409

    invoice['total'] = 600
    database.invoices.rows[0]['total'] = 600
    with pytest.raises(HTTPException) as changed:
        asyncio.run(route.get_public_registration_consent(created['token']))
    assert changed.value.status_code == 410
