import asyncio
import os
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SESSION_SECRET", "test-secret")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")

from routes import levels as levels_mod  # noqa: E402


class FakeCoaches:
    def __init__(self, coaches):
        self.coaches = coaches

    async def find_one(self, query, projection):
        return self.coaches.get(query["id"])


def test_level_coach_must_belong_to_level_branch(monkeypatch):
    monkeypatch.setattr(levels_mod, "db", SimpleNamespace(coaches=FakeCoaches({
        "same": {"branch_id": "branch-a"},
        "other": {"branch_id": "branch-b"},
        "legacy": {"branch_id": None},
    })))

    asyncio.run(levels_mod._validate_level_coach_branch("same", "branch-a"))
    asyncio.run(levels_mod._validate_level_coach_branch(None, "branch-a"))
    for coach_id in ("other", "legacy", "missing"):
        with pytest.raises(HTTPException) as error:
            asyncio.run(levels_mod._validate_level_coach_branch(coach_id, "branch-a"))
        assert error.value.status_code == 400
