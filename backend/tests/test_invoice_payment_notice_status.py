"""Staff receipt diagnostics are read-only and branch scoped."""
import asyncio
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SESSION_SECRET", "test-secret")

from routes import invoices


def test_payment_notice_reports_provider_acceptance_without_claiming_phone_delivery(monkeypatch):
    invoice = {"id": "inv-1", "branch_id": "branch-a", "status": "paid", "customer_phone": "0500000000"}
    store = SimpleNamespace(
        invoices=SimpleNamespace(find_one=AsyncMock(return_value=invoice)),
        whatsapp_invoice_payment_outbox=SimpleNamespace(find_one=AsyncMock(return_value={
            "status": "delivered", "attempts": 1, "last_error": None,
        })),
        whatsapp_send_log=SimpleNamespace(find_one=AsyncMock(return_value={
            "success": True, "sent_at": "2026-09-30T12:00:00+00:00", "transport": "whatsflow",
        })),
        whatsapp_branch_configs=SimpleNamespace(find_one=AsyncMock(return_value={
            "enabled": True, "provider": "whatsflow",
        })),
    )
    monkeypatch.setattr(invoices, "db", store)

    result = asyncio.run(invoices.get_invoice_payment_notice(
        "inv-1", {"is_admin": False, "branch_id": "branch-a"},
    ))
    assert result["notice_status"] == "delivered"
    assert result["provider_accepted"] is True
    assert result["attempts"] == 1
    assert "customer_phone" not in result
    assert store.invoices.find_one.call_args.args[0] == {
        "id": "inv-1", "branch_id": "branch-a",
    }


def test_payment_notice_cannot_read_another_branch(monkeypatch):
    store = SimpleNamespace(invoices=SimpleNamespace(find_one=AsyncMock(return_value=None)))
    monkeypatch.setattr(invoices, "db", store)
    with pytest.raises(HTTPException) as error:
        asyncio.run(invoices.get_invoice_payment_notice(
            "inv-1", {"is_admin": False, "branch_id": "branch-a"},
        ))
    assert error.value.status_code == 404
    assert store.invoices.find_one.call_args.args[0]["branch_id"] == "branch-a"
