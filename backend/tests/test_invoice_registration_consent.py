"""Signed registration forms are scoped and tied to the reviewed invoice revision."""
import asyncio
import base64
import io
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routes import invoice_consents as route
from services.consent_pdf import render_signed_consent_pdf
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
            if all((k not in row if v.get('$exists') is False else k in row) if isinstance(v, dict) and '$exists' in v else row.get(k) == v for k, v in query.items()):
                row.update(change['$set'])
                return


def fixture_db(monkeypatch):
    invoice = {'id': 'i1', 'invoice_number': '530405', 'branch_id': 'b1', 'status': 'pending',
               'customer_name_ar': 'طفل', 'total': 500, 'items': [{'activity_name': 'سباحة يومين', 'is_product': False}]}
    database = SimpleNamespace(invoices=Collection([invoice]), members=Collection(), invoice_consents=Collection(), invoice_consent_links=Collection(), family_consents=Collection(), registration_consent_settings=Collection())
    monkeypatch.setattr(route, 'db', database)
    user = {'is_admin': False, 'branch_id': 'b1', 'username': 'staff'}
    return invoice, database, user


def payload(invoice):
    return route.ConsentInput(expected_invoice_hash=route.snapshot_hash(route.invoice_snapshot(invoice)), expected_terms_version=route.TERMS_VERSION,
        child_name='اسم الطفل', guardian_name='اسم ولي الأمر', relationship='الأب',
        guardian_identity='1234567890', has_medical_condition=False,
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
    history = asyncio.run(route.get_registration_consent_links('i1', user))['links']
    assert history[0]['status'] == 'created'
    asyncio.run(route.mark_registration_consent_sent('i1', created['id'], user))
    assert asyncio.run(route.get_registration_consent_links('i1', user))['links'][0]['status'] == 'sent'
    state = asyncio.run(route.get_public_registration_consent(created['token']))
    assert state['status'] == 'pending'
    with pytest.raises(HTTPException) as unsigned_pdf:
        asyncio.run(route.download_public_registration_consent_pdf(created['token']))
    assert unsigned_pdf.value.status_code == 404
    history = asyncio.run(route.get_registration_consent_links('i1', user))['links']
    assert history[0]['status'] == 'opened'
    assert history[0]['opened_at']
    assert history[0]['created_by'] == 'staff'
    asyncio.run(route.mark_registration_consent_whatsapp_opened('i1', created['id'], user))
    asyncio.run(route.mark_registration_consent_sent('i1', created['id'], user))
    assert asyncio.run(route.get_registration_consent_links('i1', user))['links'][0]['status'] == 'opened'
    assert asyncio.run(route.get_registration_consent_links('i1', user))['links'][0]['sent_by'] == 'staff'
    result = asyncio.run(route.sign_public_registration_consent(created['token'], payload(invoice)))
    assert result['status'] == 'signed'
    assert asyncio.run(route.get_registration_consent_links('i1', user))['links'][0]['status'] == 'signed'
    assert asyncio.run(route.get_public_registration_consent(created['token']))['status'] == 'signed'
    copy = asyncio.run(route.download_public_registration_consent_pdf(created['token']))
    assert copy.media_type == 'application/pdf'
    assert 'signed-consent-530405.pdf' in copy.headers['content-disposition']
    assert copy.headers['cache-control'] == 'no-store'
    with pytest.raises(HTTPException) as repeated:
        asyncio.run(route.sign_public_registration_consent(created['token'], payload(invoice)))
    assert repeated.value.status_code == 409

    invoice['total'] = 600
    database.invoices.rows[0]['total'] = 600
    with pytest.raises(HTTPException) as changed:
        asyncio.run(route.get_public_registration_consent(created['token']))
    assert changed.value.status_code == 410
    with pytest.raises(HTTPException) as changed_pdf:
        asyncio.run(route.download_public_registration_consent_pdf(created['token']))
    assert changed_pdf.value.status_code == 410


def test_mobile_form_prefills_guardian_name_without_changing_invoice_revision(monkeypatch):
    invoice, database, user = fixture_db(monkeypatch)
    async def allow(_user, _permission):
        return None
    monkeypatch.setattr(route, 'require_permission', allow)
    invoice['member_id'] = 'm1'
    database.invoices.rows[0]['member_id'] = 'm1'
    database.members.rows.append({'id': 'm1', 'guardian_name_ar': 'أحمد محمد'})
    created = asyncio.run(route.create_registration_consent_link('i1', user))
    state = asyncio.run(route.get_public_registration_consent(created['token']))
    assert state['guardian_name'] == 'أحمد محمد'
    assert state['invoice_hash'] == route.snapshot_hash(route.invoice_snapshot(invoice))
    database.invoices.rows[0]['guardian_name_ar'] = 'محمد أحمد'
    state = asyncio.run(route.get_public_registration_consent(created['token']))
    assert state['guardian_name'] == 'محمد أحمد'


def test_existing_and_new_non_swimming_activities_get_general_form(monkeypatch):
    invoice, database, user = fixture_db(monkeypatch)
    async def allow(_user, _permission):
        return None
    monkeypatch.setattr(route, 'require_permission', allow)
    # Older invoice items may not have an is_product flag.
    invoice['items'] = [{'activity_name': 'كرة قدم'}]
    database.invoices.rows[0]['items'] = invoice['items']
    state = asyncio.run(route.get_registration_consent('i1', user))
    assert state['form_type'] == 'general'
    assert state['terms_version'] != route.TERMS_VERSION
    assert all('سباح' not in item['text'] and 'pool' not in item['text_en'] for item in state['terms'])
    created = asyncio.run(route.create_registration_consent_link('i1', user))
    assert asyncio.run(route.get_public_registration_consent(created['token']))['status'] == 'pending'
    form = payload(invoice)
    form.expected_terms_version = state['terms_version']
    assert asyncio.run(route.sign_public_registration_consent(created['token'], form))['status'] == 'signed'

    new_invoice = {'id': 'i2', 'invoice_number': '530406', 'branch_id': 'b1', 'status': 'pending',
                   'customer_name_ar': 'طفل', 'total': 500,
                   'items': [{'activity_name': 'كاراتيه', 'is_product': False}]}
    database.invoices.rows.append(new_invoice)
    assert asyncio.run(route.get_registration_consent('i2', user))['form_type'] == 'general'
    assert 'token' in asyncio.run(route.create_registration_consent_link('i2', user))


def test_product_only_invoice_cannot_create_activity_form(monkeypatch):
    invoice, database, user = fixture_db(monkeypatch)
    async def allow(_user, _permission):
        return None
    monkeypatch.setattr(route, 'require_permission', allow)
    invoice['items'] = [{'activity_name': 'نظارة سباحة', 'is_product': True}]
    database.invoices.rows[0]['items'] = invoice['items']
    with pytest.raises(HTTPException) as error:
        asyncio.run(route.create_registration_consent_link('i1', user))
    assert error.value.status_code == 422


def test_signed_pdf_download_uses_saved_form_and_is_branch_scoped(monkeypatch):
    invoice, database, user = fixture_db(monkeypatch)
    async def allow(_user, _permission):
        return None
    monkeypatch.setattr(route, 'require_permission', allow)
    signed = asyncio.run(route.sign_registration_consent('i1', payload(invoice), user))
    pdf = render_signed_consent_pdf(signed).getvalue()
    assert pdf.startswith(b'%PDF-')
    assert len(pdf) > 5000
    response = asyncio.run(route.download_registration_consent_pdf('i1', user=user))
    assert response.media_type == 'application/pdf'
    assert 'signed-consent-530405.pdf' in response.headers['content-disposition']
    with pytest.raises(HTTPException) as forbidden:
        asyncio.run(route.download_registration_consent_pdf('i1', user={'is_admin': False, 'branch_id': 'b2'}))
    assert forbidden.value.status_code == 403


def test_saved_versions_and_historical_pdf_survive_later_changes(monkeypatch):
    invoice, database, user = fixture_db(monkeypatch)
    async def allow(_user, _permission):
        return None
    monkeypatch.setattr(route, 'require_permission', allow)
    first = asyncio.run(route.sign_registration_consent('i1', payload(invoice), user))
    invoice['total'] = 600
    database.invoices.rows[0]['total'] = 600
    second = asyncio.run(route.sign_registration_consent('i1', payload(invoice), user))
    history = asyncio.run(route.get_registration_consent_history('i1', user))['versions']
    assert [row['version'] for row in history] == [2, 1]
    assert database.invoice_consents.rows[0]['invoice_snapshot']['total'] == 500
    assert database.invoice_consents.rows[1]['invoice_snapshot']['total'] == 600
    assert first['signed_at'] and second['signed_at']
    old_pdf = asyncio.run(route.download_registration_consent_pdf('i1', 1, user))
    assert 'v1.pdf' in old_pdf.headers['content-disposition']
    with pytest.raises(HTTPException) as missing:
        asyncio.run(route.download_registration_consent_pdf('i1', 3, user))
    assert missing.value.status_code == 404
