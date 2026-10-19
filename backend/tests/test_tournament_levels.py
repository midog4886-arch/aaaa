import asyncio
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from routes import tournaments


def test_tournament_levels_are_explicit_and_get_stable_ids():
    levels = tournaments._tournament_levels([{'name': ' مبتدئ ', 'capacity': 6}])
    assert levels[0]['name'] == 'مبتدئ'
    assert levels[0]['capacity'] == 6
    assert levels[0]['id']
    assert tournaments._tournament_levels(levels) == levels


def test_duplicate_tournament_level_is_rejected():
    with pytest.raises(HTTPException):
        tournaments._tournament_levels([{'name': 'G3'}, {'name': 'g3'}])


def test_participant_uses_tournament_level_label(monkeypatch):
    cursor = SimpleNamespace(to_list=AsyncMock(return_value=[]))
    monkeypatch.setattr(tournaments, 'db', SimpleNamespace(
        members=SimpleNamespace(find=lambda *args: cursor),
        levels=SimpleNamespace(find=lambda *args: cursor),
    ))
    data = {
        'tournament_levels': [{'id': 'local-1', 'name': 'مبتدئ', 'capacity': 6}],
        'participants': [{'member_id': 'm1', 'level_id': 'local-1'}],
    }
    result = asyncio.run(tournaments._enrich_participants(data))
    assert result['participants'][0]['level_label'] == 'مبتدئ'
