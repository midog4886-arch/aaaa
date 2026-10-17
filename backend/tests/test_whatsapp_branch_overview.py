import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routes import whatsapp as mod


class Collection:
    def __init__(self, rows):
        self.rows = rows
        self.query = None

    def find(self, query, projection):
        self.query = query
        return self

    async def to_list(self, limit):
        return self.rows[:limit]


def test_overview_scopes_branches_and_distinguishes_live_states(monkeypatch):
    branches = Collection([
        {"id": "a", "name_ar": "الفرع أ"},
        {"id": "b", "name_ar": "الفرع ب"},
        {"id": "c", "name_ar": "الفرع ج"},
    ])
    configs = Collection([
        {"branch_id": "a", "provider": "whatsflow", "enabled": True,
         "whatsflow_instance": "a", "whatsflow_api_key_encrypted": "secret"},
        {"branch_id": "b", "provider": "waha", "enabled": True,
         "waha_session_name": "b", "waha_physical_session_id": "physical-b"},
        {"branch_id": "c", "provider": "meta_cloud", "enabled": True,
         "phone_number_id": "123", "access_token_encrypted": "secret"},
    ])
    monkeypatch.setattr(mod, "_db", {"branches": branches, "whatsapp_branch_configs": configs})
    monkeypatch.setattr(mod, "_whatsflow_client", lambda config: SimpleNamespace(
        connection_state=AsyncMock(return_value=(True, {"state": "open"}, None))))
    monkeypatch.setattr(mod, "WAHAClient", lambda: SimpleNamespace(
        configured=True, session=AsyncMock(return_value=(True, {"status": "STOPPED"}, None))))

    result = asyncio.run(mod.branch_provider_overview({"branch_ids": ["a", "b", "c"]}))
    assert branches.query == {"id": {"$in": ["a", "b", "c"]}}
    assert [row["state"] for row in result["branches"]] == ["connected", "disconnected", "ready"]
    assert [row["connected"] for row in result["branches"]] == [True, False, None]
    assert "secret" not in str(result)


def test_overview_fails_closed_without_branch(monkeypatch):
    monkeypatch.setattr(mod, "_db", {"branches": Collection([])})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(mod.branch_provider_overview({"is_admin": False}))
    assert exc.value.status_code == 403


def test_overview_provider_failure_is_not_disconnected(monkeypatch):
    monkeypatch.setattr(mod, "_db", {
        "branches": Collection([{"id": "a", "name": "A"}]),
        "whatsapp_branch_configs": Collection([{
            "branch_id": "a", "provider": "whatsflow", "enabled": True,
            "whatsflow_instance": "a", "whatsflow_api_key_encrypted": "secret",
        }]),
    })
    monkeypatch.setattr(mod, "_whatsflow_client", lambda config: SimpleNamespace(
        connection_state=AsyncMock(return_value=(False, None, "ReadTimeout"))))
    result = asyncio.run(mod.branch_provider_overview({"is_admin": True}))
    assert result["branches"][0]["state"] == "unavailable"
    assert result["branches"][0]["connected"] is None
