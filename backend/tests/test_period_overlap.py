import asyncio
from copy import deepcopy

from utils.effective_periods import source_key
from utils.period_overlap import reconcile_member_period_overlap


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return self.rows


class Invoices:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query, projection=None):
        return Cursor([row for row in self.rows if row['status'] == 'paid'])


class Periods:
    def __init__(self):
        self.rows = {}

    def find(self, query, projection=None, **kwargs):
        return Cursor([deepcopy(self.rows[key]) for key in query['source_key']['$in']
                       if key in self.rows])

    async def update_one(self, query, update, upsert=False):
        row = self.rows.setdefault(query['source_key'], {})
        row.update(update['$set'])
        for key in update.get('$unset', {}):
            row.pop(key, None)


class DB:
    def __init__(self, invoices):
        self.invoices = Invoices(invoices)
        self.subscription_effective_periods = Periods()


def test_freeze_moves_paid_renewals_and_cancel_restores_them():
    invoices = [
        {'id': f'invoice-{n}', 'status': 'paid', 'member_id': 'm1', 'branch_id': 'b1',
         'items': [{'member_id': 'm1', 'activity_id': 'swim', 'schedule': 'الأحد والثلاثاء',
                    'start_date': start, 'end_date': end}]}
        for n, start, end in (
            (1, '2026-09-27', '2026-10-25'),
            (2, '2026-10-26', '2026-11-22'),
            (3, '2026-11-23', '2026-12-20'),
        )
    ]
    db = DB(invoices)
    member = {'id': 'm1', 'branch_id': 'b1'}
    activity = {'activity_id': 'swim', 'source_id': 'invoice-1',
                'source_period_key': source_key(invoices[0], invoices[0]['items'][0], 0),
                'start_date': '2026-09-27', 'end_date': '2026-10-27',
                'schedule': 'الأحد والثلاثاء'}
    planned = asyncio.run(reconcile_member_period_overlap(db, member, activity,
                                                            persist=False))
    assert len(planned) == 3
    assert db.subscription_effective_periods.rows == {}
    asyncio.run(reconcile_member_period_overlap(db, member, activity))
    second = db.subscription_effective_periods.rows[
        source_key(invoices[1], invoices[1]['items'][0], 0)]
    third = db.subscription_effective_periods.rows[
        source_key(invoices[2], invoices[2]['items'][0], 0)]
    assert (second['effective_start_date'], second['effective_end_date']) == (
        '2026-11-01', '2026-11-28')
    assert third['effective_start_date'] == '2026-11-29'
    assert asyncio.run(reconcile_member_period_overlap(db, member, activity)) == []

    activity['end_date'] = '2026-10-25'
    asyncio.run(reconcile_member_period_overlap(db, member, activity))
    assert second['effective_start_date'] == '2026-10-26'
    assert second['effective_end_date'] == '2026-11-22'
    assert third['effective_start_date'] == '2026-11-23'
    assert 'overlap_anchor_key' not in second


def test_other_member_or_unpaid_invoice_cannot_shift_period():
    invoices = [
        {'id': 'first', 'status': 'paid', 'member_id': 'm1', 'branch_id': 'b1',
         'items': [{'activity_id': 'swim', 'start_date': '2026-09-27',
                    'end_date': '2026-10-25'}]},
        {'id': 'other', 'status': 'paid', 'member_id': 'm2', 'branch_id': 'b1',
         'items': [{'activity_id': 'swim', 'start_date': '2026-10-26',
                    'end_date': '2026-11-22'}]},
        {'id': 'unpaid', 'status': 'partial', 'member_id': 'm1', 'branch_id': 'b1',
         'items': [{'activity_id': 'swim', 'start_date': '2026-10-26',
                    'end_date': '2026-11-22'}]},
    ]
    db = DB(invoices)
    activity = {'activity_id': 'swim', 'source_id': 'first',
                'start_date': '2026-09-27', 'end_date': '2026-10-27'}
    assert len(asyncio.run(reconcile_member_period_overlap(
        db, {'id': 'm1', 'branch_id': 'b1'}, activity))) == 1


def test_two_paid_periods_on_one_invoice_shift_independently():
    invoice = {'id': 'bundle', 'status': 'paid', 'member_id': 'm1',
               'branch_id': 'b1', 'items': [
                   {'activity_id': 'swim', 'schedule': 'الجمعة والسبت',
                    'start_date': '2026-09-27', 'end_date': '2026-10-20'},
                   {'activity_id': 'swim', 'schedule': 'الجمعة والسبت',
                    'start_date': '2026-10-25', 'end_date': '2026-11-17'},
               ]}
    db = DB([invoice])
    activity = {'activity_id': 'swim', 'source_id': 'bundle',
                'start_date': '2026-09-27', 'end_date': '2026-10-25',
                'schedule': 'الجمعة والسبت'}
    asyncio.run(reconcile_member_period_overlap(
        db, {'id': 'm1', 'branch_id': 'b1'}, activity))
    later = db.subscription_effective_periods.rows[
        source_key(invoice, invoice['items'][1], 1)]
    assert later['effective_start_date'] == '2026-10-30'
    assert later['effective_end_date'] == '2026-11-22'
