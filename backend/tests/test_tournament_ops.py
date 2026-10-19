import asyncio
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from routes import tournament_ops as api
from routes import member_portal


def test_readiness_counts_only_pending_work():
    data = {
        'participants': [{'member_id': 'a', 'position': '1'}, {'member_id': 'b'}],
        'registration_requests': [{'status': 'pending'}, {'status': 'waitlisted'}, {'status': 'approved'}],
        'tournament_checkins': [{'member_id': 'a'}],
        'match_board': {'matches': [{'start_time': '', 'status': 'scheduled'}, {'start_time': '10:00', 'status': 'live'}]},
        'swimming_meet': {'entries': [{'heat': 0, 'lane': 0, 'status': 'pending'}]},
        'results_approved': False,
    }
    result = api.summary(data)
    assert result['pending_registrations'] == 1
    assert result['waitlisted'] == 1
    assert result['checked_in'] == 1
    assert result['results_pending'] == 1
    assert result['swimming_unassigned'] == 1
    assert result['matches_unscheduled'] == 1


def test_member_cannot_register_another_account(monkeypatch):
    monkeypatch.setattr(api, 'db', SimpleNamespace(tournaments=SimpleNamespace(find_one=AsyncMock()), members=SimpleNamespace(find_one=AsyncMock())))
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.request_registration('t', api.RegistrationRequest(member_id='other'), {'id': 'my-id', '_linked_member_ids': ['my-id']}))
    assert error.value.status_code == 403
    api.db.tournaments.find_one.assert_not_called()


def test_full_tournament_puts_member_on_waitlist(monkeypatch):
    collection = SimpleNamespace(
        find_one=AsyncMock(return_value={'id': 't', 'registration_open': True, 'registration_capacity': 1, 'participants': [{'member_id': 'first'}], 'registration_requests': []}),
        update_one=AsyncMock(return_value=SimpleNamespace(modified_count=1)),
    )
    monkeypatch.setattr(api, 'db', SimpleNamespace(
        tournaments=collection,
        members=SimpleNamespace(find_one=AsyncMock(return_value={'id': 'second', 'branch_id': 'b', 'name': 'Second'})),
    ))
    result = asyncio.run(api.request_registration('t', api.RegistrationRequest(member_id='second'), {'id': 'second'}))
    assert result == {'status': 'waitlisted'}
    assert collection.update_one.call_args.args[1]['$push']['registration_requests']['status'] == 'waitlisted'


def test_closed_registration_keeps_linked_pending_requests_visible(monkeypatch):
    tournaments = [{
        'id': 'test-cup', 'name': 'Test Cup', 'branch_id': 'b', 'registration_open': False,
        'registration_requests': [
            {'member_id': 'amjad', 'status': 'pending'},
            {'member_id': 'mohammed', 'status': 'pending'},
        ],
    }]
    cursor = SimpleNamespace(sort=lambda *args: SimpleNamespace(to_list=AsyncMock(return_value=tournaments)))
    find_tournaments = lambda *args: cursor
    members_cursor = SimpleNamespace(to_list=AsyncMock(return_value=[
        {'id': 'amjad', 'name': 'Amjad', 'branch_id': 'b'},
        {'id': 'mohammed', 'name': 'Mohammed', 'branch_id': 'b'},
        {'id': 'other', 'name': 'Other', 'branch_id': 'b'},
    ]))
    monkeypatch.setattr(api, 'db', SimpleNamespace(
        tournaments=SimpleNamespace(find=find_tournaments),
        members=SimpleNamespace(find=lambda *args: members_cursor),
    ))
    result = asyncio.run(api.open_for_member({'id': 'amjad', '_linked_member_ids': ['amjad', 'mohammed']}))
    assert result[0]['registration_open'] is False
    assert [(m['id'], m['status']) for m in result[0]['members']] == [
        ('amjad', 'pending'), ('mohammed', 'pending'),
    ]


def test_checkin_rejects_unregistered_member(monkeypatch):
    monkeypatch.setattr(api, '_load_tournament_or_403', AsyncMock(return_value={'participants': [{'member_id': 'registered'}]}))
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.check_in('t', api.CheckIn(member_id='other'), {'user_id': 'staff'}))
    assert error.value.status_code == 404


def test_approval_is_one_time_and_notifies_ranked_members(monkeypatch):
    monkeypatch.setattr(api, '_load_tournament_or_403', AsyncMock(return_value={
        'results_approved': False,
        'participants': [{'member_id': 'winner', 'position': '1'}, {'member_id': 'other', 'position': None}],
    }))
    update = AsyncMock(return_value=SimpleNamespace(modified_count=1))
    monkeypatch.setattr(api, 'db', SimpleNamespace(tournaments=SimpleNamespace(update_one=update)))
    notify = AsyncMock()
    monkeypatch.setattr(api, '_notify_result', notify)
    monkeypatch.setattr(api, '_record_notification_log', AsyncMock())
    monkeypatch.setattr(api, '_resolve_member_name', AsyncMock(return_value='Winner'))
    monkeypatch.setattr(api, 'cache_invalidate', lambda _: None)
    result = asyncio.run(api.approve_results('t', {'user_id': 'staff'}))
    assert result == {'approved': True}
    notify.assert_awaited_once()
    assert update.call_args.args[0]['results_approved'] is False


def test_reapproval_does_not_resend_unchanged_medal(monkeypatch):
    monkeypatch.setattr(api, '_load_tournament_or_403', AsyncMock(return_value={
        'results_approved': False,
        'participants': [{'member_id': 'winner', 'position': '1'}],
        'published_positions': {'winner|': '1'},
    }))
    monkeypatch.setattr(api, 'db', SimpleNamespace(tournaments=SimpleNamespace(update_one=AsyncMock(return_value=SimpleNamespace(modified_count=1)))))
    notify = AsyncMock()
    monkeypatch.setattr(api, '_notify_result', notify)
    monkeypatch.setattr(api, 'cache_invalidate', lambda _: None)
    asyncio.run(api.approve_results('t', {'user_id': 'staff'}))
    notify.assert_not_awaited()


def test_member_portal_hides_draft_result_and_notes(monkeypatch):
    tournament = {
        'id': 't', 'name': 'Cup', 'participants': [{'member_id': 'athlete', 'position': '1', 'notes': 'Draft coach note'}],
        'results_approved': False,
    }
    cursor = SimpleNamespace(sort=lambda *args: SimpleNamespace(to_list=AsyncMock(return_value=[tournament])))
    monkeypatch.setattr(member_portal, 'db', SimpleNamespace(tournaments=SimpleNamespace(find=lambda *args: cursor)))
    result = asyncio.run(member_portal.get_my_tournaments({'id': 'athlete'}))
    assert result['totals']['gold'] == 0
    assert result['tournaments'][0]['position'] is None
    assert result['tournaments'][0]['notes'] == ''
    assert result['tournaments'][0]['results_approved'] is False
