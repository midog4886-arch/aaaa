import asyncio
from types import SimpleNamespace

from routes import invoice_consents, invoices


class Collection:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def find(self, query, projection=None):
        def matches(row):
            return all((any(item in value['$in'] for item in row.get(key)) if isinstance(row.get(key), list) else row.get(key) in value['$in']) if isinstance(value, dict) and '$in' in value else row.get(key) == value
                       for key, value in query.items())
        rows = [dict(row) for row in self.rows if matches(row)]

        class Cursor:
            def sort(self, key, direction):
                rows.sort(key=lambda row: row.get(key, ''), reverse=direction < 0)
                return self

            async def to_list(self, length):
                return rows[:length]

        return Cursor()

    async def find_one(self, query, projection=None):
        return next((dict(row) for row in self.rows if all(row.get(key) == value for key, value in query.items())), None)


def test_invoice_list_distinguishes_current_signed_and_stale_forms(monkeypatch):
    def invoice(invoice_id):
        return {'id': invoice_id, 'created_at': '2026-10-02T10:00:00Z', 'branch_id': None,
                'items': [{'activity_name': 'سباحة', 'is_product': False}], 'total': 500}

    current, stale, unsigned = [invoice(value) for value in ('current', 'stale', 'unsigned')]
    signatures = [
        {'invoice_id': 'current', 'version': 1,
         'invoice_hash': invoice_consents.snapshot_hash(invoice_consents.invoice_snapshot(current)),
         'terms_version': invoice_consents.TERMS_VERSION},
        {'invoice_id': 'stale', 'version': 1, 'invoice_hash': 'old-invoice-hash',
         'terms_version': invoice_consents.TERMS_VERSION},
    ]
    db = SimpleNamespace(invoices=Collection([current, stale, unsigned]),
                         invoice_consents=Collection(signatures),
                         family_consents=Collection(),
                         registration_consent_settings=Collection())
    monkeypatch.setattr(invoices, 'db', db)
    monkeypatch.setattr(invoice_consents, 'db', db)

    async def no_branch_names(_rows):
        pass

    monkeypatch.setattr(invoices, '_enrich_branch_names', no_branch_names)
    rows = asyncio.run(invoices.get_invoices(current_user={'is_admin': True}))
    by_id = {row['id']: row for row in rows}
    assert by_id['current']['consent_signed'] is True
    assert by_id['current']['consent_needs_resign'] is False
    assert by_id['stale']['consent_signed'] is False
    assert by_id['stale']['consent_needs_resign'] is True
    assert by_id['unsigned'].get('consent_signed', False) is False


def test_one_family_signature_marks_each_sibling_invoice(monkeypatch):
    first = {'id': 'sibling-1', 'created_at': '2026-10-03T10:00:00Z', 'branch_id': None,
             'items': [{'activity_name': 'سباحة', 'is_product': False}], 'total': 600}
    second = {**first, 'id': 'sibling-2'}
    family = {'invoice_ids': ['sibling-1', 'sibling-2'],
              'invoice_snapshots': [invoice_consents.invoice_snapshot(first), invoice_consents.invoice_snapshot(second)],
              'form_type': 'swimming', 'terms_version': invoice_consents.TERMS_VERSION,
              'signed_at': '2026-10-03T12:00:00Z'}
    database = SimpleNamespace(invoices=Collection([first, second]), invoice_consents=Collection(),
                               family_consents=Collection([family]), registration_consent_settings=Collection())
    monkeypatch.setattr(invoices, 'db', database)
    monkeypatch.setattr(invoice_consents, 'db', database)

    async def no_branch_names(_rows):
        pass

    monkeypatch.setattr(invoices, '_enrich_branch_names', no_branch_names)
    rows = asyncio.run(invoices.get_invoices(current_user={'is_admin': True}))
    assert all(row['consent_signed'] and row['consent_family'] for row in rows)
