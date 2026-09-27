import asyncio
from copy import deepcopy
from datetime import date
from types import SimpleNamespace
import uuid
import pytest
from fastapi import HTTPException
from routes import member_support as support
from routes import push_notifications as push
from services.member_expiry_reminders import reminder_stage, send_member_expiry_reminders


def matches(row, query):
    for key, expected in query.items():
        actual = row.get(key)
        if isinstance(expected, dict) and '$ne' in expected:
            if expected['$ne'] in actual if isinstance(actual, list) else actual == expected['$ne']:
                return False
        elif actual != expected:
            return False
    return True


class Cursor:
    def __init__(self, rows): self.rows = deepcopy(rows)
    def sort(self, *args): return self
    async def to_list(self, limit): return self.rows[:limit]
    def __aiter__(self): self.iterator = iter(self.rows); return self
    async def __anext__(self):
        try: return next(self.iterator)
        except StopIteration: raise StopAsyncIteration


class Collection:
    def __init__(self, rows=None): self.rows = deepcopy(rows or [])
    def find(self, query, projection=None): return Cursor([row for row in self.rows if matches(row, query)])
    async def find_one(self, query, projection=None):
        return deepcopy(next((row for row in self.rows if matches(row, query)), None))
    async def insert_one(self, row): self.rows.append(deepcopy(row))
    async def update_one(self, query, update, upsert=False):
        row = next((row for row in self.rows if matches(row, query)), None)
        if row is None:
            if not upsert: return SimpleNamespace(upserted_id=None, matched_count=0)
            row = {**query, **deepcopy(update.get('$setOnInsert', {}))}
            self.rows.append(row)
            return SimpleNamespace(upserted_id=row.get('_id', 'new'), matched_count=0)
        row.update(deepcopy(update.get('$set', {})))
        for key, value in update.get('$push', {}).items():
            row[key] = (row.get(key, []) + deepcopy(value['$each']))[value['$slice']:]
        return SimpleNamespace(upserted_id=None, matched_count=1)


def database(members=None):
    return SimpleNamespace(members=Collection(members), support_requests=Collection(),
                           notifications=Collection(), member_notifications=Collection())


def test_expiry_stages_skip_invalid_expired_and_distant_dates():
    assert reminder_stage('2030-01-08', date(2030, 1, 1)) == 7
    assert reminder_stage('2030-01-04', date(2030, 1, 1)) == 3
    assert reminder_stage('2030-01-02', date(2030, 1, 1)) == 1
    assert reminder_stage('2030-01-20', date(2030, 1, 1)) is None
    assert reminder_stage('2029-12-30', date(2030, 1, 1)) is None
    assert reminder_stage('bad', date(2030, 1, 1)) is None


def test_reminders_dedupe_each_stage_and_follow_changed_end_date(monkeypatch):
    db = database([{'id': 'member-1', 'activities': [{'activity_id': 'swim', 'end_date': '2030-01-08'}]}])
    sent = []
    async def send(payload, ids): sent.append(ids)
    monkeypatch.setattr(push, 'send_push_to_members', send)
    async def scenario():
        assert await send_member_expiry_reminders(db, date(2030, 1, 1)) == 1
        assert await send_member_expiry_reminders(db, date(2030, 1, 2)) == 0
        assert await send_member_expiry_reminders(db, date(2030, 1, 5)) == 1
        assert await send_member_expiry_reminders(db, date(2030, 1, 7)) == 1
        assert await send_member_expiry_reminders(db, date(2030, 1, 8)) == 0
        db.members.rows[0]['activities'][0]['end_date'] = '2030-01-15'
        assert await send_member_expiry_reminders(db, date(2030, 1, 8)) == 1
    asyncio.run(scenario())
    assert len(db.member_notifications.rows) == 4
    assert sent == [['member-1']] * 4


def test_cancelled_and_prepaid_renewed_periods_do_not_send(monkeypatch):
    db = database([{'id': 'm', 'activities': [
        {'activity_id': 'a', 'end_date': '2030-01-08', 'status': 'refunded'},
        {'activity_id': 'b', 'end_date': '2030-01-08'},
        {'activity_id': 'b', 'start_date': '2030-01-09', 'end_date': '2030-02-08'},
    ]}])
    assert asyncio.run(send_member_expiry_reminders(db, date(2030, 1, 1))) == 0


def test_support_creation_is_idempotent_and_member_list_is_owned(monkeypatch):
    db = database(); monkeypatch.setattr(support, 'db', db)
    payload = support.SupportRequestCreate(subject='مشكلة التدريب', body='أحتاج مراجعة موعد التدريب', request_id=uuid.uuid4())
    async def scenario():
        first = await support.create_support_request(payload, {'id': 'm1', 'branch_id': 'b1'})
        second = await support.create_support_request(payload, {'id': 'm1', 'branch_id': 'b1'})
        assert first['number'] == second['number']
        assert len(await support.list_member_support_requests({'id': 'm1'})) == 1
        assert await support.list_member_support_requests({'id': 'm2'}) == []
    asyncio.run(scenario())
    assert len(db.support_requests.rows) == len(db.notifications.rows) == 1


def test_staff_cannot_update_foreign_branch_and_reply_retry_is_idempotent(monkeypatch):
    db = database(); monkeypatch.setattr(support, 'db', db)
    async def permitted(*args): pass
    monkeypatch.setattr(support, 'require_permission', permitted)
    payload = support.SupportRequestCreate(subject='طلب دعم', body='وصف المشكلة للاختبار', request_id=uuid.uuid4())
    update = support.SupportRequestUpdate(status='resolved', reply='تم حل المشكلة', request_id=uuid.uuid4())
    async def scenario():
        ticket = await support.create_support_request(payload, {'id': 'm1', 'branch_id': 'b1'})
        with pytest.raises(HTTPException) as exc:
            await support.update_support_request(ticket['id'], update, {'is_admin': False, 'branch_id': 'b2'})
        assert exc.value.status_code == 404
        assert await support.list_staff_support_requests({'is_admin': False, 'branch_id': 'b2'}) == []
        await support.update_support_request(ticket['id'], update, {'is_admin': False, 'branch_id': 'b1'})
        result = await support.update_support_request(ticket['id'], update, {'is_admin': False, 'branch_id': 'b1'})
        assert result['status'] == 'resolved'
        assert len(result['messages']) == 1
    asyncio.run(scenario())
    assert len(db.member_notifications.rows) == 1
