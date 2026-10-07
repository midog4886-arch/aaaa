"""Expense receipts must remain private without breaking public campaign media."""
import asyncio
from io import BytesIO
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi.testclient import TestClient
from starlette.responses import FileResponse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import server
from utils.tenant import set_current_tenant, reset_current_tenant


def test_legacy_receipt_url_is_not_public():
    with TestClient(server.app) as client:
        response = client.get(f"/uploads/{uuid4()}.png")
        private_response = client.get(f"/uploads/expenses/alpha/{uuid4()}.png")
    assert response.status_code == 404
    assert private_response.status_code == 404


def test_receipt_upload_rejects_active_content_and_oversize(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "UPLOADS_DIR", tmp_path)
    token = set_current_tenant({"slug": "alpha", "db_name": "champions_alpha"})
    try:
        for name, content in (
            ("receipt.svg", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
            ("receipt.jpg", b"x" * (server._RECEIPT_MAX_BYTES + 1)),
        ):
            with pytest.raises(HTTPException) as error:
                asyncio.run(server._save_expense_receipt(UploadFile(file=BytesIO(content), filename=name)))
            assert error.value.status_code == 400
        assert not (tmp_path / "expenses").exists()
    finally:
        reset_current_tenant(token)


def test_receipt_requires_tenant_branch_and_ownership(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "UPLOADS_DIR", tmp_path)
    name = f"{uuid4()}.png"
    receipt = tmp_path / "expenses" / "alpha" / name
    receipt.parent.mkdir(parents=True)
    receipt.write_bytes(b"receipt test")
    expense = {
        "id": "expense-1", "branch_id": "branch-a", "created_by": "creator",
        "receipt_url": f"/uploads/expenses/alpha/{name}",
    }

    class Collection:
        async def find_one(self, query, projection):
            return expense if query.get("id") == "expense-1" else None

    monkeypatch.setattr(server, "db", SimpleNamespace(internal_expenses=Collection()))

    async def can_create(user):
        return user.get("allowed", False)

    async def can_approve(user):
        return user.get("approver", False) or user.get("is_admin", False)

    monkeypatch.setattr(server, "_can_create_internal_expenses", can_create)
    monkeypatch.setattr(server, "_can_approve_internal_expenses", can_approve)

    token = set_current_tenant({"slug": "alpha", "db_name": "champions_alpha"})
    try:
        denied = [
            {"username": "creator", "branch_id": "branch-a", "allowed": False},
            {"username": "creator", "branch_id": "branch-b", "allowed": True},
            {"username": "other", "branch_id": "branch-a", "allowed": True},
        ]
        for user in denied:
            with pytest.raises(HTTPException) as error:
                asyncio.run(server.get_internal_expense_receipt("expense-1", user))
            assert error.value.status_code == 403
        result = asyncio.run(server.get_internal_expense_receipt(
            "expense-1", {"username": "creator", "branch_id": "branch-a", "allowed": True}
        ))
        assert isinstance(result, FileResponse)
        assert Path(result.path) == receipt
    finally:
        reset_current_tenant(token)

    token = set_current_tenant({"slug": "beta", "db_name": "champions_beta"})
    try:
        with pytest.raises(HTTPException) as error:
            asyncio.run(server.get_internal_expense_receipt(
                "expense-1", {"is_admin": True, "allowed": True}
            ))
        assert error.value.status_code == 404
    finally:
        reset_current_tenant(token)
