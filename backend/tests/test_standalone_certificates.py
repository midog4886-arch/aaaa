import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from routes import certificates


class Collection:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(dict(row))

    def find(self, query, projection):
        assert query == {}
        return self

    def sort(self, *_):
        return self

    async def to_list(self, *_):
        return [{k: v for k, v in row.items() if k != "_id"} for row in self.rows]


def test_issue_without_member_or_level(monkeypatch):
    store = Collection()
    monkeypatch.setattr(certificates, "db", SimpleNamespace(certificates=store))
    user = {"is_admin": True, "user_id": "owner", "username": "Owner"}
    payload = certificates.IssueCertificate(student_name_ar="  أحمد   علي  ", student_name_en=" Ahmed  Ali ")
    issued = asyncio.run(certificates.issue_certificate(payload, user))
    assert issued["student_name_ar"] == "أحمد علي"
    assert issued["student_name_en"] == "Ahmed Ali"
    assert not any(key in issued for key in ("member_id", "level_id", "transfer_audit_id"))
    assert asyncio.run(certificates.list_certificates(user))[0]["id"] == issued["id"]


def test_names_and_permission_are_checked(monkeypatch):
    with pytest.raises(ValidationError):
        certificates.IssueCertificate(student_name_ar="John", student_name_en="جون")
    async def deny(*_):
        raise HTTPException(403)
    monkeypatch.setattr(certificates, "require_permission", deny)
    monkeypatch.setattr(certificates, "db", SimpleNamespace(certificates=Collection()))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(certificates.issue_certificate(
            certificates.IssueCertificate(student_name_ar="أحمد علي", student_name_en="Ahmed Ali"),
            {"is_admin": False},
        ))
    assert exc.value.status_code == 403


def test_optional_member_link_is_validated_and_saved(monkeypatch):
    store = Collection()
    class Members:
        async def find_one(self, query, projection):
            assert query == {"id": "member-1", "branch_id": "branch-1"}
            return {"id": "member-1", "member_code": "AB-123"}
    monkeypatch.setattr(certificates, "db", SimpleNamespace(certificates=store, members=Members()))
    monkeypatch.setattr(certificates, "resolve_branch_filter", lambda *_: "branch-1")
    payload = certificates.IssueCertificate(student_name_ar="أحمد علي", student_name_en="Ahmed Ali", member_id="member-1", branch_filter="branch-1")
    issued = asyncio.run(certificates.issue_certificate(payload, {"is_admin": True, "user_id": "owner"}))
    assert issued["member_id"] == "member-1"
    assert issued["member_code"] == "AB-123"


def test_admin_must_choose_branch_before_linking(monkeypatch):
    monkeypatch.setattr(certificates, "db", SimpleNamespace(certificates=Collection()))
    payload = certificates.IssueCertificate(student_name_ar="أحمد علي", student_name_en="Ahmed Ali", member_id="member-1")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(certificates.issue_certificate(payload, {"is_admin": True}))
    assert exc.value.status_code == 400


def test_member_search_is_limited_to_selected_branch(monkeypatch):
    class Members:
        def find(self, query, projection):
            assert query["branch_id"] == "branch-1"
            assert projection["id"] == 1
            return self
        def limit(self, count):
            assert count == 20
            return self
        async def to_list(self, count):
            return [{"id": "member-1", "name_ar": "أحمد"}]
    monkeypatch.setattr(certificates, "db", SimpleNamespace(members=Members()))
    result = asyncio.run(certificates.search_certificate_members("أحمد", "branch-1", {"is_admin": True}))
    assert result[0]["id"] == "member-1"
