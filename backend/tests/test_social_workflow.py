import asyncio
import os
import sys
from datetime import datetime,timezone,timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
sys.path.insert(0,os.path.abspath(os.path.join(os.path.dirname(__file__),'..')))
from routes import social_workflow as workflow
from routes.social_publisher import PublishRequest

def test_schedule_requires_timezone_and_future():
    for date in [datetime.now(),datetime.now(timezone.utc)-timedelta(days=1)]:
        with pytest.raises(HTTPException): workflow.schedule_text(date)
    assert workflow.schedule_text(datetime.now(timezone.utc)+timedelta(days=1)).endswith('+00:00')

def test_rejects_unsupported_and_duplicate_platforms():
    for targets in [[{'platform':'other'}],[{'platform':'facebook'},{'platform':'facebook'}]]:
        with pytest.raises(HTTPException):workflow.validate_targets(PublishRequest(media_filename='m.png',targets=targets))

def test_other_branch_plan_is_not_visible(monkeypatch):
    collection=SimpleNamespace(find_one=AsyncMock(return_value=None))
    monkeypatch.setattr(workflow,'db',SimpleNamespace(social_plans=collection))
    monkeypatch.setattr(workflow,'resolve_branch_filter',lambda user,branch=None:'north')
    with pytest.raises(HTTPException) as error:asyncio.run(workflow.get_plan('p',{}))
    assert error.value.status_code==404
    assert collection.find_one.call_args.args[0]=={'id':'p','branch_id':'north'}

def test_nonadmin_cannot_review(monkeypatch):
    with pytest.raises(HTTPException) as error:asyncio.run(workflow.review('p',workflow.Review(approve=True),None,{'is_admin':False}))
    assert error.value.status_code==403

def test_dispatch_skips_successful_platform_and_persists_failed_result(monkeypatch):
    collection=SimpleNamespace(update_one=AsyncMock(return_value=SimpleNamespace(modified_count=1)))
    monkeypatch.setattr(workflow,'db',SimpleNamespace(social_plans=collection,social_media=SimpleNamespace(find_one=AsyncMock(return_value={'allowed_to_publish':True}))))
    sender=AsyncMock(return_value={'post_id':'sent','results':[{'platform':'instagram','status':'failed','error_message':'permissions'}]})
    monkeypatch.setattr(workflow,'publish_post',sender)
    row={'id':'p','revision':1,'created_by':'staff','public_base_url':'https://example.com','payload':{'media_filename':'m.png','caption':'Text','targets':[{'platform':'facebook'},{'platform':'instagram'}]},'results':{'facebook':{'status':'success','public_post_url':'https://example.com/post'}}}
    asyncio.run(workflow.dispatch(row))
    assert sender.await_count==1
    assert sender.call_args.args[0].targets[0].platform=='instagram'
    saved=collection.update_one.call_args.args[1]['$set']
    assert saved['status']=='partial'
    assert saved['results']['facebook']['status']=='success'

def test_atomic_claim_prevents_second_dispatch(monkeypatch):
    collection=SimpleNamespace(update_one=AsyncMock(return_value=SimpleNamespace(modified_count=0)))
    monkeypatch.setattr(workflow,'db',SimpleNamespace(social_plans=collection))
    sender=AsyncMock();monkeypatch.setattr(workflow,'publish_post',sender)
    asyncio.run(workflow.dispatch({'id':'p','revision':2}))
    sender.assert_not_called()

def test_retry_resets_only_failed_results(monkeypatch):
    row={'id':'p','status':'partial','revision':2,'results':{'facebook':{'status':'success'},'instagram':{'status':'failed'}}}
    monkeypatch.setattr(workflow,'get_plan',AsyncMock(return_value=row))
    collection=SimpleNamespace(update_one=AsyncMock(return_value=SimpleNamespace(modified_count=1)))
    monkeypatch.setattr(workflow,'db',SimpleNamespace(social_plans=collection))
    asyncio.run(workflow.retry('p',{}))
    updated=collection.update_one.call_args.args[1]['$set']
    assert updated['results']=={'facebook':{'status':'success'},'instagram':{'status':'pending'}}
