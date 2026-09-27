"""Search must never read collections outside the staff member's permissions."""
import asyncio
import os
import re
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from routes import global_search as search


class Collection:
    def __init__(self):
        self.queries = []

    def find(self, query, projection):
        self.queries.append(query)
        return self

    def limit(self, count):
        return self

    async def to_list(self, count):
        return []


def test_search_reads_only_permitted_collections(monkeypatch):
    database = SimpleNamespace(users=SimpleNamespace(find_one=AsyncMock(return_value={'permissions': ['members']})),
                               members=Collection(), invoices=Collection(), activities=Collection())
    monkeypatch.setattr(search, 'db', database)
    monkeypatch.setattr(search, 'resolve_branch_filter', lambda user, branch: 'north')
    result = asyncio.run(search.global_search(q='Lina', current_user={'user_id': 'staff'}))
    assert database.members.queries[0]['branch_id'] == 'north'
    assert not database.invoices.queries
    assert not database.activities.queries
    assert result == {'members': [], 'invoices': [], 'activities': []}


def test_search_fails_closed_for_missing_user(monkeypatch):
    database = SimpleNamespace(users=SimpleNamespace(find_one=AsyncMock(return_value=None)),
                               members=Collection(), invoices=Collection(), activities=Collection())
    monkeypatch.setattr(search, 'db', database)
    monkeypatch.setattr(search, 'resolve_branch_filter', lambda user, branch: 'north')
    asyncio.run(search.global_search(q='Lina', current_user={'user_id': 'missing'}))
    assert not any(collection.queries for collection in [database.members, database.invoices, database.activities])


def test_arabic_phone_matches_formatted_number():
    pattern = search._phone_regex('٠٥٥ ١٢٣-٤٥٦٧')['$regex']
    assert re.search(pattern, '055 123-4567')
    assert not re.search(pattern, '055 987-6543')
