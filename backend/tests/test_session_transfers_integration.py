"""Real transactions against a disposable local replica set; never the live DB."""
import asyncio
import copy
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import routes.attendance as attendance
from utils import session_transfers as transfers


def test_atomic_session_transfers(monkeypatch):
    url = os.environ.get('SESSION_TRANSFER_TEST_MONGO_URL')
    if not url:
        pytest.skip('Set SESSION_TRANSFER_TEST_MONGO_URL to a disposable local replica set')
    assert url.startswith('mongodb://127.0.0.1:'), 'Integration tests require a local test DB'
    async def exercise():
        client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=5000)
        db = client['test_session_transfers_' + uuid.uuid4().hex]
        monkeypatch.setattr(attendance, 'db', db)
        today = datetime.now(timezone(timedelta(hours=3))).date()
        act = dict(activity_id='swim', activity_name='Swimming', status='active',
                   start_date=(today - timedelta(days=7)).isoformat(),
                   end_date=(today + timedelta(days=21)).isoformat(),
                   schedule='الإثنين و الأربعاء - 5:00 م', fee=200)
        sender = dict(id='sender', branch_id='b1', name='Sender', activities=[act])
        recipient = dict(id='recipient', branch_id='b1', name='Recipient', activities=[])
        try:
            await db.members.insert_many([sender, recipient, dict(id='other', branch_id='b2', activities=[])])
            await db.session_transfers.create_index('id', unique=True)
            await db.attendance.insert_one(dict(member_id='sender', activity_id='swim', date=today.isoformat()))
            invoices_before = await db.invoices.count_documents({})
            payload = dict(recipient_id='recipient', sessions=3, reason='Family request')
            reviewed = (await transfers.preview(db, {'id':'sender'}, {'id':'recipient'}, 'swim', payload))[-1]
            assert reviewed['sender_before'] == 7
            assert reviewed['recipient_before'] == 0
            for target, amount in [('other', 1), ('recipient', 8), ('sender', 1)]:
                with pytest.raises(HTTPException):
                    await transfers.preview(db, {'id':'sender'}, {'id':target}, 'swim', {**payload, 'sessions':amount})
            # Concurrent attendance invalidates the review; no member balance changes.
            await db.attendance.insert_one(dict(member_id='sender', activity_id='swim', date=today.isoformat()))
            with pytest.raises(HTTPException, match='409'):
                await transfers.confirm(db, {'id':'sender'}, {'id':'recipient'}, 'swim', {**payload, 'preview_token':reviewed['preview_token']}, {'id':'admin'})
            assert await db.session_transfers.count_documents({}) == 0
            reviewed = (await transfers.preview(db, {'id':'sender'}, {'id':'recipient'}, 'swim', payload))[-1]
            monkeypatch.setattr(transfers.uuid, 'uuid4', lambda: 'fixed-transfer-id')
            await transfers.confirm(db, {'id':'sender'}, {'id':'recipient'}, 'swim', {**payload, 'preview_token':reviewed['preview_token']}, {'id':'admin'})
            source_quota = await attendance.check_member_session_quota('sender', 'swim')
            target_quota = await attendance.check_member_session_quota('recipient', 'swim')
            assert source_quota[0]['remaining'] == 3
            assert target_quota[0]['remaining'] == 3
            assert source_quota[0]['remaining'] + target_quota[0]['remaining'] == reviewed['sender_before']
            saved = await db.members.find_one({'id':'recipient'})
            assert saved['activities'][0]['end_date'] == act['end_date']
            assert saved['activities'][0]['fee'] == 0
            assert await db.attendance.count_documents({}) == 2
            assert await db.invoices.count_documents({}) == invoices_before
            # Ledger insert failure must roll back BOTH updated member documents.
            before = copy.deepcopy(await db.members.find({}).to_list(10))
            again = (await transfers.preview(db, {'id':'sender'}, {'id':'recipient'}, 'swim', {**payload, 'sessions':1}))[-1]
            with pytest.raises(DuplicateKeyError):
                await transfers.confirm(db, {'id':'sender'}, {'id':'recipient'}, 'swim', {**payload, 'sessions':1, 'preview_token':again['preview_token']}, {'id':'admin'})
            assert await db.members.find({}).to_list(10) == before
            assert await db.session_transfers.count_documents({}) == 1
            assert await db.audit_logs.count_documents({}) == 2
        finally:
            await client.drop_database(db.name)
            client.close()
    asyncio.run(exercise())
