import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from routes import whatsapp_workflow as workflow

def run(coro): return asyncio.run(coro)

@pytest.fixture
def env(monkeypatch):
    database=SimpleNamespace(**{name:SimpleNamespace(find_one=AsyncMock(return_value=None),
        insert_one=AsyncMock(),update_one=AsyncMock(return_value=SimpleNamespace(modified_count=1)),
        update_many=AsyncMock(return_value=SimpleNamespace(modified_count=2))) for name in
        ['members','levels','registration_followup_stops','whatsapp_reviews','whatsapp_campaigns','whatsapp_campaign_job_items']})
    monkeypatch.setattr(workflow,'db',database)
    monkeypatch.setattr(workflow,'access',AsyncMock())
    return database

def test_schedule_requires_future_and_timezone():
    for value in ['2020-01-01T10:00:00Z','2099-01-01T10:00','bad']:
        with pytest.raises(HTTPException): workflow.schedule(value)
    assert workflow.schedule('2099-01-01T10:00:00+03:00').hour==7

def test_preview_deduplicates_normalizes_and_respects_optout(env):
    env.registration_followup_stops.find_one.side_effect=lambda query: {'reason':'opted_out'} if query['phone']=='966500000002' else None
    data=workflow.PreviewRequest(branch_id='a',message='Hello {name}',recipients=[
        {'phone':'0500000001','name':'Ali'},{'phone':'+966500000001','name':'Ali'},
        {'phone':'0500000002'},{'phone':'bad'}])
    result=run(workflow.prepare(data))
    assert result['count']==1 and result['recipients'][0]['message']=='Hello Ali'
    assert result['removed']=={'duplicates':1,'invalid':1,'opted_out':1,'excluded':0}

def test_group_scope_and_authoritative_expiry(env):
    env.levels.find_one.return_value={'id':'g','branch_id':'a'}
    env.members.find_one.return_value={'id':'m','phone':'0500000001','name':'Stored name','activities':[{'level_id':'g','end_date':'2099-01-01'}]}
    result=run(workflow.prepare(workflow.PreviewRequest(branch_id='a',group_id='g',message='{name} {expiry_date}',
        recipients=[{'phone':'0500000001','name':'Wrong name','member_id':'m'}])))
    assert result['recipients'][0]['message']=='Stored name 2099-01-01'
    assert env.members.find_one.call_args.args[0]=={'id':'m','branch_id':'a'}
    env.levels.find_one.return_value=None
    with pytest.raises(HTTPException):run(workflow.prepare(workflow.PreviewRequest(branch_id='a',group_id='foreign',message='Hi')))

def test_staff_cannot_approve(env):
    env.whatsapp_reviews.find_one.return_value={'id':'r','status':'pending_review'}
    with pytest.raises(HTTPException) as error:run(workflow.approve('r','a',{'user_id':'staff','is_admin':False}))
    assert error.value.status_code==403
    env.whatsapp_reviews.update_one.assert_not_called()

def test_future_approval_does_not_enqueue(env,monkeypatch):
    env.whatsapp_reviews.find_one.return_value={'id':'r','branch_id':'a','status':'pending_review','schedule_at':datetime.now(timezone.utc)+timedelta(days=1)}
    monkeypatch.setattr(workflow.wa,'_get_branch_cloud_config',AsyncMock(return_value={}))
    monkeypatch.setattr(workflow.wa,'_validate_bulk_job_config',lambda *args:None)
    dispatch=AsyncMock(); monkeypatch.setattr(workflow,'dispatch',dispatch)
    assert run(workflow.approve('r','a',{'user_id':'admin','is_admin':True}))=={'status':'scheduled'}
    dispatch.assert_not_called()
    assert env.whatsapp_reviews.update_one.call_args.args[1]['$set']['status']=='scheduled'

def test_direct_staff_bulk_send_requires_review(monkeypatch):
    data=workflow.wa.BulkCloudSendRequest(branch_id='a',recipients=[{'phone':'0500000001','message':'Hi'}],idempotency_key='long-enough-key')
    with pytest.raises(HTTPException) as error:run(workflow.wa.send_branch_cloud_bulk(data,{'permissions':['whatsapp'],'is_admin':False}))
    assert error.value.status_code==403

def test_retry_matches_only_failed_and_never_sent_or_unknown(env,monkeypatch):
    env.whatsapp_reviews.find_one.return_value={'id':'r','branch_id':'a','status':'queued','job_id':'j'}
    monkeypatch.setattr(workflow.jobs,'get_job',AsyncMock(return_value={'pending':0}))
    monkeypatch.setattr(workflow.jobs,'_refresh_job',AsyncMock())
    assert run(workflow.retry('r','a',{'is_admin':True,'user_id':'admin'}))=={'retried':2}
    assert env.whatsapp_campaign_job_items.update_many.call_args.args[0]=={'job_id':'j','branch_id':'a','status':'failed'}

def test_cancel_other_staff_campaign_is_denied(env):
    env.whatsapp_reviews.find_one.return_value={'id':'r','created_by':'other','status':'pending_review'}
    with pytest.raises(HTTPException) as error:run(workflow.cancel('r','a',{'user_id':'staff'}))
    assert error.value.status_code==403
