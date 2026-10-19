import asyncio
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from routes import tournaments


def test_external_participant_does_not_create_member_or_send_notification(monkeypatch):
    tournament = {
        'id': 'cup', 'name': 'Cup', 'participants': [],
        'activity_ids': ['swim'], 'subcategories': [],
        'tournament_levels': [{'id': 'beginner', 'name': 'Beginner', 'capacity': 6}],
    }
    collection = SimpleNamespace(update_one=AsyncMock())
    members = SimpleNamespace(find_one=AsyncMock())
    monkeypatch.setattr(tournaments, '_load_tournament_or_403', AsyncMock(return_value=tournament))
    monkeypatch.setattr(tournaments, '_log_activity', AsyncMock())
    monkeypatch.setattr(tournaments, '_notify_participant_added', AsyncMock())
    monkeypatch.setattr(tournaments, 'db', SimpleNamespace(tournaments=collection, members=members))

    result = asyncio.run(tournaments.add_participant(
        'cup', tournaments.Participant(external_name=' Guest ', external_phone='0500000000',
                                       external_club='Other club', level_id='beginner', notify=True),
        {'is_admin': True},
    ))

    participant = collection.update_one.call_args.args[1]['$push']['participants']
    assert result['message'] == 'Participant added'
    assert participant['member_id'].startswith('external:')
    assert participant['external_name'] == 'Guest'
    members.find_one.assert_not_called()
    tournaments._notify_participant_added.assert_not_called()
