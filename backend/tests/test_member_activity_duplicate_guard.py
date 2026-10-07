import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routes import members


class FakeMembers:
    def __init__(self, member):
        self.member = member
        self.last_query = None

    async def update_one(self, query, update):
        self.last_query = query
        duplicate = query["activities"]["$not"]["$elemMatch"]
        exists = any(all(a.get(k) == v for k, v in duplicate.items())
                     for a in self.member.get("activities", []))
        if exists:
            return SimpleNamespace(matched_count=0)
        self.member.setdefault("activities", []).append(update["$push"]["activities"])
        return SimpleNamespace(matched_count=1)

    async def find_one(self, query, projection=None):
        return {"_id": "test"} if query.get("id") == self.member["id"] else None


def test_same_member_activity_period_cannot_be_added_twice(monkeypatch):
    fake = FakeMembers({"id": "m1", "activities": [{
        "activity_id": "swim", "start_date": "2026-09-14", "end_date": "2026-10-07",
    }]})
    monkeypatch.setattr(members, "db", SimpleNamespace(members=fake))
    activity = members.MemberActivity(
        activity_id="swim", activity_name="Swim", start_date="2026-09-14",
        end_date="2026-10-07",
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(members.add_member_activity("m1", activity, {"is_admin": True}))
    assert exc.value.status_code == 409
    assert len(fake.member["activities"]) == 1
    assert fake.last_query["activities"]["$not"]["$elemMatch"]["activity_id"] == "swim"
