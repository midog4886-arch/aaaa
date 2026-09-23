import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from routes import whatsapp as mod


@pytest.mark.parametrize("response,connected,error", [
    ((True, {"instance": {"state": "open"}}, None), True, None),
    ((True, {"state": "close"}, None), False, None),
    ((True, {"state": "connecting"}, None), False, None),
    ((False, None, "http_401"), None, "http_401"),
    ((False, None, "ReadTimeout"), None, "ReadTimeout"),
    ((True, {}, None), None, "invalid_status_response"),
    ((True, {"state": {"unexpected": True}}, None), None, "invalid_status_response"),
    ((True, {"state": "unknown"}, None), None, "invalid_status_response"),
])
def test_status_distinguishes_failure_from_disconnection(monkeypatch, response, connected, error):
    monkeypatch.setattr(mod, "_require_session_provider_branch", AsyncMock(return_value={
        "provider": "whatsflow", "enabled": True, "whatsflow_instance": "test",
    }))
    monkeypatch.setattr(mod, "_whatsflow_client", lambda _: SimpleNamespace(
        connection_state=AsyncMock(return_value=response)))
    updates = AsyncMock()
    monkeypatch.setattr(mod, "_db", {"whatsapp_branch_configs": SimpleNamespace(update_one=updates)})
    result = asyncio.run(mod.branch_provider_status("branch", {"is_admin": True}))
    assert result["connected"] is connected
    assert result["error"] == error
    assert result["check_ok"] is (error is None)
    assert updates.call_count == (0 if error else 1)


@pytest.mark.parametrize("response,reason", [
    ((True, {"instance": {"state": "open"}}, None), None),
    ((True, {"instance": {"state": "close"}}, None), "state: close"),
    ((True, {"state": "unknown"}, None), "invalid_status_response"),
    ((False, None, "ReadTimeout"), "ReadTimeout"),
    ((False, None, "http_401"), "http_401"),
])
@pytest.mark.parametrize("cached_state", ["connecting", "open"])
def test_closure_preflight_verifies_live_state_without_cache_write(monkeypatch, response, reason, cached_state):
    from fastapi import HTTPException
    from routes import day_extensions
    config = {
        "provider": "whatsflow", "enabled": True, "whatsflow_instance": "test",
        "whatsflow_api_key_encrypted": "test", "whatsflow_state": cached_state,
    }
    monkeypatch.setattr(day_extensions, "db", SimpleNamespace(
        branches=SimpleNamespace(find_one=AsyncMock(return_value={"id": "branch"}))))
    monkeypatch.setattr(mod, "_get_branch_cloud_config", AsyncMock(return_value=config))
    check = AsyncMock(return_value=response)
    monkeypatch.setattr(mod, "_whatsflow_client", lambda _: SimpleNamespace(connection_state=check))
    if reason:
        with pytest.raises(HTTPException, match=reason):
            asyncio.run(day_extensions._closure_provider("branch"))
    else:
        assert asyncio.run(day_extensions._closure_provider("branch")) == "whatsflow"
    check.assert_awaited_once()
    assert config["whatsflow_state"] == cached_state


@pytest.mark.parametrize("override", [
    {"enabled": False}, {"whatsflow_instance": ""},
    {"whatsflow_api_key_encrypted": ""}, {"provider": "disabled"},
])
def test_closure_invalid_config_never_checks_network(monkeypatch, override):
    config = {
        "provider": "whatsflow", "enabled": True, "whatsflow_instance": "test",
        "whatsflow_api_key_encrypted": "test", "whatsflow_state": "open", **override,
    }
    def forbidden(_):
        pytest.fail("Invalid config must not contact provider")
    monkeypatch.setattr(mod, "_whatsflow_client", forbidden)
    assert asyncio.run(mod._validate_closure_job_config("whatsflow", config))