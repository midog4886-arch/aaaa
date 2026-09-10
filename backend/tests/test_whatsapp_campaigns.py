import asyncio
import io
import os
import sys

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import routes.whatsapp as whatsapp


def run(coro):
    return asyncio.run(coro)


def matches(doc, query):
    return all(doc.get(key) == value for key, value in (query or {}).items())


class Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, key, direction):
        self.rows.sort(key=lambda row: row.get(key, ""), reverse=direction < 0)
        return self

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    async def to_list(self, length):
        return self.rows[:length]

    def __aiter__(self):
        self.iterator = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return next(self.iterator)
        except StopIteration:
            raise StopAsyncIteration


class Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.fail_update = False

    async def find_one(self, query, projection=None):
        return next((dict(row) for row in self.rows if matches(row, query)), None)

    def find(self, query, projection=None):
        rows = [dict(row) for row in self.rows if matches(row, query)]
        return Cursor(rows)

    async def insert_one(self, doc):
        self.rows.append(dict(doc))

    async def update_one(self, query, update):
        if self.fail_update:
            raise RuntimeError("simulated metadata switch failure")
        for row in self.rows:
            if matches(row, query):
                row.update(update.get("$set", {}))
                break

    async def delete_one(self, query):
        self.rows[:] = [row for row in self.rows if not matches(row, query)]

    async def delete_many(self, query):
        self.rows[:] = [row for row in self.rows if not matches(row, query)]


class FakeDB:
    def __init__(self):
        self.collections = {
            "branches": Collection([{"id": "branch-a"}, {"id": "branch-b"}]),
            "whatsapp_campaigns": Collection(),
            "members": Collection(),
            "registration_requests": Collection(),
            "users": Collection(),
            "whatsapp_campaign_attachments": Collection(),
            "whatsapp_campaign_attachment_chunks": Collection(),
        }

    def __getitem__(self, name):
        return self.collections.setdefault(name, Collection())


ADMIN = {"is_admin": True, "user_id": "admin-1"}


@pytest.fixture
def campaign_env(monkeypatch):
    db = FakeDB()
    tenant = {"slug": "tenant-a"}
    monkeypatch.setattr(whatsapp, "_db", db)
    monkeypatch.setattr(whatsapp, "get_current_tenant_slug", lambda: tenant["slug"])
    return db, tenant


def create(branch_id="branch-a", name="Draft", attachment=None):
    return run(whatsapp.create_campaign(
        branch_id=branch_id,
        name=name,
        message="Hello {name}",
        audience="pasted",
        proposed_send_at="2026-06-01T18:30",
        default_name="Friend",
        recipients_json='[{"phone":"966500000001","name":"Member"}]',
        attachment=attachment,
        current_user=ADMIN,
    ))


def test_campaign_crud_and_branch_isolation(campaign_env):
    _db, _tenant = campaign_env
    created = create()
    assert created["name"] == "Draft"
    assert created["recipients"] == [{"phone": "966500000001", "name": "Member"}]

    own = run(whatsapp.list_campaigns("branch-a", ADMIN))
    other_branch = run(whatsapp.list_campaigns("branch-b", ADMIN))
    assert [row["id"] for row in own] == [created["id"]]
    assert "recipients" not in own[0]
    assert own[0]["recipient_count"] == 1
    assert other_branch == []

    updated = run(whatsapp.update_campaign(
        created["id"], branch_id="branch-a", name="Edited", message="Changed",
        audience="pasted", proposed_send_at="", default_name="",
        recipients_json="[]", remove_attachment=False, attachment=None,
        current_user=ADMIN,
    ))
    assert updated["name"] == "Edited"
    loaded = run(whatsapp.get_campaign(created["id"], "branch-a", ADMIN))
    assert loaded["message"] == "Changed"

    run(whatsapp.delete_campaign(created["id"], "branch-a", ADMIN))
    assert run(whatsapp.list_campaigns("branch-a", ADMIN)) == []


def test_campaign_tenant_isolation(campaign_env):
    _db, tenant = campaign_env
    tenant_a = create(name="Tenant A")
    tenant["slug"] = "tenant-b"
    assert run(whatsapp.list_campaigns("branch-a", ADMIN)) == []
    tenant_b = create(name="Tenant B")
    assert tenant_b["id"] != tenant_a["id"]
    tenant["slug"] = "tenant-a"
    assert [row["name"] for row in run(whatsapp.list_campaigns("branch-a", ADMIN))] == ["Tenant A"]


def test_campaign_permission_and_phone_privacy_use_current_db_user(campaign_env):
    db, _tenant = campaign_env
    created = create()
    denied = {"is_admin": False, "permissions": [], "branch_id": "branch-a", "user_id": "staff-1"}
    with pytest.raises(HTTPException) as exc:
        run(whatsapp.list_campaigns("branch-a", denied))
    assert exc.value.status_code == 403

    staff = {"is_admin": False, "permissions": ["messages"], "branch_id": "branch-a", "user_id": "staff-1"}
    db["users"].rows.append({"id": "staff-1", "permissions": ["messages"]})
    summary = run(whatsapp.list_campaigns("branch-a", staff))
    assert summary[0]["recipient_count"] == 1
    assert "recipients" not in summary[0]
    with pytest.raises(HTTPException) as exc:
        run(whatsapp.get_campaign(created["id"], "branch-a", staff))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        run(whatsapp.campaign_audience_preview("branch-a", "all_members", staff))
    assert exc.value.status_code == 403

    # Permissions are re-read from this tenant's users collection.
    db["users"].rows[0]["permissions"].append("member-phones")
    assert run(whatsapp.get_campaign(created["id"], "branch-a", staff))["recipients"][0]["phone"]


def test_campaign_attachment_is_durable_bounded_and_deleted(campaign_env):
    db, _tenant = campaign_env
    payload = b"\x89PNG\r\n" + (b"x" * (whatsapp.CAMPAIGN_ATTACHMENT_CHUNK_SIZE * 2 + 17))
    upload = UploadFile(
        io.BytesIO(payload),
        filename="offer.png",
        headers=Headers({"content-type": "image/png"}),
    )
    created = create(attachment=upload)
    assert created["has_attachment"] is True
    chunks = db["whatsapp_campaign_attachment_chunks"].rows
    assert len(chunks) == 3
    assert all(len(chunk["data"]) <= whatsapp.CAMPAIGN_ATTACHMENT_CHUNK_SIZE for chunk in chunks)
    response = run(whatsapp.get_campaign_attachment(created["id"], "branch-a", ADMIN))
    async def read_response():
        return b"".join([part async for part in response.body_iterator])
    assert run(read_response()) == payload

    run(whatsapp.delete_campaign(created["id"], "branch-a", ADMIN))
    assert db["whatsapp_campaign_attachment_chunks"].rows == []
    assert db["whatsapp_campaign_attachments"].rows == []

    oversized = UploadFile(
        io.BytesIO(b"x" * (whatsapp.CAMPAIGN_IMAGE_LIMIT + 1)),
        filename="large.png",
        headers=Headers({"content-type": "image/png"}),
    )
    with pytest.raises(HTTPException) as exc:
        create(name="Too large", attachment=oversized)
    assert exc.value.status_code == 413


def test_attachment_replacement_keeps_old_when_campaign_switch_fails(campaign_env):
    db, _tenant = campaign_env
    old_upload = UploadFile(
        io.BytesIO(b"old"),
        filename="old.pdf",
        headers=Headers({"content-type": "application/pdf"}),
    )
    created = create(attachment=old_upload)
    old_id = db["whatsapp_campaigns"].rows[0]["attachment_id"]
    db["whatsapp_campaigns"].fail_update = True
    new_upload = UploadFile(
        io.BytesIO(b"new"),
        filename="new.pdf",
        headers=Headers({"content-type": "application/pdf"}),
    )
    with pytest.raises(RuntimeError, match="metadata switch"):
        run(whatsapp.update_campaign(
            created["id"], branch_id="branch-a", name="Draft", message="Hello",
            audience="pasted", proposed_send_at="", default_name="",
            recipients_json="[]", remove_attachment=False, attachment=new_upload,
            current_user=ADMIN,
        ))
    assert db["whatsapp_campaigns"].rows[0]["attachment_id"] == old_id
    assert {row["attachment_id"] for row in db["whatsapp_campaign_attachments"].rows} == {old_id}
    assert {row["attachment_id"] for row in db["whatsapp_campaign_attachment_chunks"].rows} == {old_id}