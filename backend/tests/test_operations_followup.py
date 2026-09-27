import asyncio
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from routes import operations_followup as ops

def test_capacity_deduplicates_legacy_member_shapes():
    assert ops.capacity_summary({'members': ['m1', {'member_id': 'm1'}, {'id': 'm2'}], 'capacity': 2}) == {'used': 2, 'capacity': 2, 'available': 0, 'full': True}

def test_followup_rejects_invalid_status_and_date():
    with pytest.raises(ValidationError):
        ops.Followup(status='paid')
    with pytest.raises(ValidationError):
        ops.Followup(next_date='tomorrow')

def test_scoped_lookup_hides_other_branch(monkeypatch):
    collection = SimpleNamespace(find_one=AsyncMock(return_value=None))
    monkeypatch.setattr(ops, 'resolve_branch_filter', lambda user: 'north')
    with pytest.raises(HTTPException) as error:
        asyncio.run(ops.scoped(collection, 'member', {}))
    assert error.value.status_code == 404
    assert collection.find_one.call_args.args[0] == {'id': 'member', 'branch_id': 'north'}

def test_duplicate_waiting_entry_uses_atomic_condition(monkeypatch):
    levels = SimpleNamespace(find_one=AsyncMock(return_value={'id': 'l', 'branch_id': 'north', 'members': []}), update_one=AsyncMock(return_value=SimpleNamespace(modified_count=0)))
    members = SimpleNamespace(find_one=AsyncMock(return_value={'id': 'm', 'branch_id': 'north', 'name': 'Lina'}))
    monkeypatch.setattr(ops, 'db', SimpleNamespace(levels=levels, members=members))
    monkeypatch.setattr(ops, 'require_permission', AsyncMock())
    monkeypatch.setattr(ops, 'resolve_branch_filter', lambda user: 'north')
    with pytest.raises(HTTPException) as error:
        asyncio.run(ops.add_waiting('l', ops.WaitingMember(member_id='123'), {'user_id': 'staff'}))
    assert error.value.status_code == 409
    assert levels.update_one.call_args.args[0]['waiting_list.member_id'] == {'$ne': 'm'}

def test_save_assigns_authenticated_actor_and_serializes_date(monkeypatch):
    members = SimpleNamespace(find_one=AsyncMock(return_value={'id': 'm', 'branch_id': 'north'}), update_one=AsyncMock())
    monkeypatch.setattr(ops, 'db', SimpleNamespace(members=members, users=SimpleNamespace(find_one=AsyncMock(return_value={'name': 'Staff'}))))
    monkeypatch.setattr(ops, 'require_permission', AsyncMock())
    monkeypatch.setattr(ops, 'resolve_branch_filter', lambda user: 'north')
    result = asyncio.run(ops.save_followup('m', ops.Followup(status='promised', next_date='2026-10-01'), {'user_id': 'staff'}))
    assert result['owner_id'] == 'staff'
    assert result['next_date'] == '2026-10-01'
    assert members.update_one.call_args.args[0] == {'id': 'm', 'branch_id': 'north'}
