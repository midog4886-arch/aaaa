import os
import sys
import copy
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from utils.swimming import parse_time, format_time, seed, ranked, validate_meet
from routes import swimming_meets as api

def sample():
    return {'pool_length':25,'lanes':6,'races':[{'id':'r','distance':50,'stroke':'freestyle','min_age':8,'max_age':12,'gender':'mixed','start_time':'16:00','heat_minutes':5}], 'swimmers':[{'id':'s','name':'Lina','birth_date':'2016-01-01','gender':'female','member_id':None,'team':''}], 'entries':[{'id':'e','swimmer_id':'s','race_id':'r','seed_time':'01:10.00','time':'01:05.23','status':'finished','reason':'','heat':1,'lane':3}]}

def test_time_precision():
    assert parse_time('01:05.23') == 6523
    assert format_time(6523) == '01:05.23'

@pytest.mark.parametrize('value',['01:65.00','-1.00','00:00.00','1:05.123','abc'])
def test_invalid_times(value):
    with pytest.raises(ValueError): parse_time(value)

def test_ties_get_competition_places():
    rows=[{'id':str(i),'status':'finished','time_cs':t} for i,t in enumerate([6500,6300,6300,7000])]
    assert [e['place'] for e in ranked(rows)] == [1,1,3,4]

def test_seeding_unique_lanes_fastest_in_last_heat():
    rows=[{'id':str(i),'seed_cs':1000+i*100} for i in range(8)]
    result=seed(rows,6)
    assert len({(e['heat'],e['lane']) for e in result}) == 8
    fastest=next(e for e in result if e['id']=='0')
    assert fastest['heat']==2 and fastest['lane'] in (3,4)

def test_duplicate_entry_rejected():
    meet=sample();meet['entries'].append({**meet['entries'][0],'id':'second'})
    with pytest.raises(ValueError, match='مرتين'): validate_meet(meet,'2026-09-27')

def test_outside_age_category_rejected():
    meet=sample();meet['races'][0]['max_age']=9
    with pytest.raises(ValueError, match='فئة'): validate_meet(meet,'2026-09-27')

def test_disqualification_requires_reason():
    meet=sample();meet['entries'][0]['status']='dq'
    with pytest.raises(ValueError, match='سبب'): validate_meet(meet,'2026-09-27')

def test_detects_overlapping_races():
    meet=sample();meet['races'].append({**meet['races'][0],'id':'r2','start_time':'16:02'});meet['entries'].append({**meet['entries'][0],'id':'e2','race_id':'r2'})
    assert validate_meet(meet,'2026-09-27') == ['Lina']

def test_cross_branch_tournament_hidden(monkeypatch):
    monkeypatch.setattr(api,'require_permission',AsyncMock())
    monkeypatch.setattr(api,'resolve_branch_filter',lambda user:'north')
    monkeypatch.setattr(api,'db',SimpleNamespace(tournaments=SimpleNamespace(find_one=AsyncMock(return_value={'branch_id':'south'}))))
    with pytest.raises(HTTPException) as error: asyncio.run(api.load('t',{}))
    assert error.value.status_code==404

def test_save_optimistic_lock_and_pending_approval(monkeypatch):
    monkeypatch.setattr(api,'load',AsyncMock(return_value={'id':'t','date':'2026-09-27'}))
    collection=SimpleNamespace(update_one=AsyncMock(return_value=SimpleNamespace(modified_count=0)))
    monkeypatch.setattr(api,'db',SimpleNamespace(tournaments=collection))
    payload=api.Meet(**sample(),revision=3)
    with pytest.raises(HTTPException) as error: asyncio.run(api.save_meet('t',payload,False,{'user_id':'staff'}))
    assert error.value.status_code==409
    assert collection.update_one.call_args.args[0]['swimming_meet.revision']==3
    payload.entries[0].status='pending';payload.approved=True
    with pytest.raises(HTTPException) as error: asyncio.run(api.save_meet('t',payload,False,{'user_id':'staff'}))
    assert error.value.status_code==400

def test_personal_best_uses_approved_same_event_history(monkeypatch):
    meet=sample();meet['swimmers'][0]['member_id']='member';meet['entries'][0]['time_cs']=6523
    old=copy.deepcopy(meet);old['entries'][0]['time_cs']=6700
    monkeypatch.setattr(api,'load',AsyncMock(return_value={'id':'t','date':'2026-09-27','branch_id':'north','swimming_meet':meet}))
    monkeypatch.setattr(api,'resolve_branch_filter',lambda user:'north')
    cursor=SimpleNamespace(to_list=AsyncMock(return_value=[{'swimming_meet':old}]))
    collection=SimpleNamespace(find=lambda query,projection:cursor)
    monkeypatch.setattr(api,'db',SimpleNamespace(tournaments=collection))
    result=asyncio.run(api.bests('t',{}))
    assert result['e']=={'previous_best':'01:07.00','improvement_cs':177}
