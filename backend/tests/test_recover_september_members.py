"""Verify the two-record recovery never duplicates live invoice numbers."""

import asyncio
import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi import UploadFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


MEMBER_IDS = ("154ccccb-c7ca-47d0-9032-f288143a9098", "d6406ec7-891c-4787-97b1-d906db85e9ed")
INVOICE_IDS = ("inv-one", "inv-two")


class Collection:
    def __init__(self, docs=()):
        self.docs = list(docs)

    async def find_one(self, query, projection=None):
        alternatives = query.get("$or", [query])
        return next((doc for doc in self.docs if any(all(doc.get(key) == value for key, value in part.items()) for part in alternatives)), None)

    async def insert_one(self, doc):
        saved = dict(doc, _id=len(self.docs) + 1)
        self.docs.append(saved)
        return SimpleNamespace(inserted_id=saved["_id"])

    async def delete_one(self, query):
        self.docs = [doc for doc in self.docs if doc.get("_id") != query["_id"]]


class Database(SimpleNamespace):
    def __getitem__(self, name):
        return getattr(self, name)


def test_recovery_renumbers_conflicting_invoices(monkeypatch):
    members = [
        {"id": member_id, "member_code": f"DEFA-B11-239{5 + index}", "name_ar": f"name{index}",
         "phone": "0548828992", "branch_id": "branch", "activities": [{"source_id": INVOICE_IDS[index], "activity_id": "activity", "level_id": "level"}]}
        for index, member_id in enumerate(MEMBER_IDS)
    ]
    invoices = [
        {"id": INVOICE_IDS[index], "member_id": member_id, "invoice_number": f"63076{7 + index}", "status": "paid"}
        for index, member_id in enumerate(MEMBER_IDS)
    ]
    records = {
        "members": members,
        "invoices": invoices,
        "level_subscriptions": [{"member_id": member_id, "invoice_id": INVOICE_IDS[index]} for index, member_id in enumerate(MEMBER_IDS)],
        "member_points": [{"member_id": member_id} for member_id in MEMBER_IDS],
        "points_history": [{"member_id": member_id} for member_id in MEMBER_IDS],
    }
    db = Database(
        members=Collection(),
        invoices=Collection([{"id": "different-1", "invoice_number": "630767"}, {"id": "different-2", "invoice_number": "630768"}]),
        level_subscriptions=Collection(), member_points=Collection(), points_history=Collection(),
        branches=Collection([{"id": "branch"}]), activities=Collection([{"id": "activity"}]), levels=Collection([{"id": "level"}]),
    )
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "_require_export_admin_token", lambda token: {"is_admin": True})
    encoded = json.dumps({"collections": records}).encode()

    def uploaded_file():
        return UploadFile(file=io.BytesIO(encoded), filename="recovery.json")

    preview = asyncio.run(server.recover_september_members(uploaded_file(), token="admin", apply=False))
    assert preview["number_changes"] == {"630767": "RBL-630767", "630768": "RBL-630768"}
    assert not db.members.docs
    result = asyncio.run(server.recover_september_members(uploaded_file(), token="admin", apply=True))
    assert result["applied"] is True
    assert {doc["invoice_number"] for doc in db.invoices.docs} == {"630767", "630768", "RBL-630767", "RBL-630768"}
    assert {doc["id"] for doc in db.members.docs} == set(MEMBER_IDS)
