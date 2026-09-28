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
