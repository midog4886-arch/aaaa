"""Today's expected list must reflect a freeze without waiting for SWR expiry."""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import routes.attendance as attendance
import utils.cache as cache


class Clock(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 9, 28, 12, tzinfo=tz or timezone.utc)


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args):
        return self

    async def to_list(self, _limit):
        return list(self.rows)

    def __aiter__(self):
        self._iterator = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return next(self._iterator)
        except StopIteration:
            raise StopAsyncIteration


def test_freeze_excludes_member_even_with_cached_expected_inputs(monkeypatch):
    monkeypatch.setattr(attendance, "datetime", Clock)
    member = {
        "id": "M", "status": "active", "name": "Swimmer", "member_code": "M1",
        "activities": [{"activity_id": "A", "activity_name": "Swimming", "status": "active",
                        "start_date": "2026-09-01", "end_date": "2026-10-01", "schedule": "Monday"}],
    }
    invoice = {"member_id": "M", "items": [{"activity_id": "A", "activity_name": "Swimming",
                                               "start_date": "2026-09-01", "end_date": "2026-10-01",
                                               "schedule": "Monday"}]}
    cached = {"members": [member], "levels_docs": [], "invoices_by_member": {"M": [invoice]}}

    async def stale_cache(*_args, **_kwargs):
        return cached

    monkeypatch.setattr(cache, "cache_swr", stale_cache)
    frozen = [{"member_id": "M"}]

    class Freezes:
        def find(self, query, projection):
            assert query == {"status": "active", "start_date": {"$lte": "2026-09-28"},
                             "end_date": {"$gte": "2026-09-28"}}
            assert projection == {"_id": 0, "member_id": 1}
            return Cursor(frozen)

    class Attendance:
        def find(self, *_args):
            return Cursor([])

    class Members:
        def find(self, *_args):
            return Cursor([])

    monkeypatch.setattr(attendance, "db", SimpleNamespace(
        member_freezes=Freezes(), attendance=Attendance(), members=Members()))

    frozen_result = asyncio.run(attendance.get_today_summary(current_user={"is_admin": True}))
    assert frozen_result["expected_count"] == frozen_result["absent_count"] == 0
    assert frozen_result["expected"] == []

    frozen.clear()  # The cached members and invoices stay unchanged.
    active_result = asyncio.run(attendance.get_today_summary(current_user={"is_admin": True}))
    assert active_result["expected_count"] == active_result["absent_count"] == 1
    assert active_result["expected"][0]["member_id"] == "M"
