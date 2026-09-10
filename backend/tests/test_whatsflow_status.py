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