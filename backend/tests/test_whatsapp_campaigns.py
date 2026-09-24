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
    for key, value in (query or {}).items():
        if key == "$or":
            if not any(matches(doc, clause) for clause in value):
                return False
        elif isinstance(value, dict) and "$in" in value:
            values = (
                [item.get("member_id") for item in doc.get("items", [])]
                if key == "items.member_id" else [doc.get(key)]
            )
            if not any(item in value["$in"] for item in values):
                return False
        elif doc.get(key) != value:
            return False
    return True


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


def test_expired_audience_dates_branch_phones_and_stale_status(campaign_env, monkeypatch):
    from datetime import datetime

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            # Already tomorrow in Riyadh, while UTC is still the previous day.
            return datetime(2026, 9, 12, 0, 30, tzinfo=whatsapp.RIYADH_TZ)

    monkeypatch.setattr(whatsapp, "datetime", Clock)
    db, _ = campaign_env
    cases = [
        ("expired", ["2026-09-11", "2026-08-01"], "active"),
        ("today", ["2026-09-12"], "expired"),
        ("mixed", ["2026-09-11", "2026-10-01"], "expired"),
        ("future", ["2026-10-01"], "expired"),
        ("unknown", ["2026-09-11", None], "expired"),
        ("empty", [], "expired"),
        ("invalid", ["2026-02-30"], "expired"),
        ("blank", [""], "expired"),
    ]
    for index, (member_id, ends, status) in enumerate(cases):
        db["members"].rows.append({
            "id": member_id, "branch_id": "branch-a", "phone": f"96650000000{index}",
            "activities": [{"activity_id": "a", "end_date": end, "status": status} for end in ends],
        })
    db["members"].rows.extend([
        {"id": "other", "branch_id": "branch-b", "phone": "966599999999",
         "activities": [{"end_date": "2020-01-01"}]},
        {"id": "duplicate", "branch_id": "branch-a", "phone": "+966 500000000",
         "activities": [{"end_date": "2020-01-01"}]},
        {"id": "bad-phone", "branch_id": "branch-a", "phone": "123",
         "activities": [{"end_date": "2020-01-01"}]},
    ])
    result = run(whatsapp.campaign_audience_preview("branch-a", "expired_members", ADMIN))
    assert result == {"count": 1, "recipients": [
        {"phone": "966500000000", "name": "", "member_id": "expired"},
    ]}
    staff = {"is_admin": False, "permissions": ["messages"], "branch_id": "branch-b"}
    with pytest.raises(HTTPException) as exc:
        run(whatsapp.campaign_audience_preview("branch-a", "expired_members", staff))
    assert exc.value.status_code == 403


def test_expired_audience_respects_paid_future_effective_and_family_periods(campaign_env, monkeypatch):
    from utils.effective_periods import source_key
    import utils.effective_periods as effective

    db, _ = campaign_env
    for member_id in ["future", "effective", "same-period", "partial", "family-payer", "family-child", "unknown"]:
        db["members"].rows.append({
            "id": member_id, "branch_id": "branch-a", "phone": f"9665000000{len(db['members'].rows):02}",
            "activities": [{"activity_id": "a", "end_date": "2020-01-31"}],
        })
    def invoice(member_id, start, end, **extra):
        return {"id": member_id, "branch_id": "branch-a", "status": "paid", "member_id": member_id,
                "items": [{"activity_id": "a", "start_date": start, "end_date": end}], **extra}
    shifted = invoice("effective", "2020-02-01", "2020-02-28")
    db["invoices"].rows = [
        invoice("future", "2099-01-01", "2099-02-01"),
        shifted,
        invoice("same-period", "2020-01-01", "2099-02-01"),
        invoice("partial", "2099-01-01", "2099-02-01", status="partial"),
        invoice("family-payer", "", "", items=[{
            "member_id": "family-child", "activity_id": "a",
            "start_date": "2099-01-01", "end_date": "2099-02-01",
        }]),
        invoice("unknown", "", ""),
        invoice("unrelated", "2099-01-01", "2099-02-01"),
        invoice("other-payer", "", "", items=[{
            "member_id": "partial", "activity_id": "a",
            "start_date": "2020-01-01", "end_date": "2020-01-31",
        }]),
    ]
    async def periods(_db, invoices):
        assert all(inv["branch_id"] == "branch-a" for inv in invoices)
        assert "unrelated" not in {inv["id"] for inv in invoices}
        assert "other-payer" in {inv["id"] for inv in invoices}
        return {source_key(shifted, shifted["items"][0], 0): {
            "effective_start_date": "2099-01-01", "effective_end_date": "2099-02-01",
        }}
    monkeypatch.setattr(effective, "effective_period_map", periods)
    result = run(whatsapp.campaign_audience_preview("branch-a", "expired_members", ADMIN))
    assert {row["member_id"] for row in result["recipients"]} == {"same-period", "partial", "family-payer"}
    assert db["members"].rows[0]["activities"][0]["end_date"] == "2020-01-31"
    assert shifted["items"][0]["end_date"] == "2020-02-28"


def test_expired_audience_canonicalizes_sibling_phones_before_cap(campaign_env, monkeypatch):
    db, _ = campaign_env
    monkeypatch.setattr(whatsapp, "CAMPAIGN_MAX_PASTED_RECIPIENTS", 2)
    for index, phone in enumerate([
        "0500000001", "+966 50 000 0001", "٠٥٠٠٠٠٠٠٠١",
        "00966500000001", "123", "00000000000", "٠٥٠٠٠٠٠٠٠٢",
        "966500000003",
    ]):
        db["members"].rows.append({
            "id": f"sibling-{index}", "branch_id": "branch-a", "phone": phone,
            "activities": [{"end_date": "2020-01-01"}],
        })
    result = run(whatsapp.campaign_audience_preview("branch-a", "expired_members", ADMIN))
    assert result["count"] == 2
    assert [row["phone"] for row in result["recipients"]] == ["966500000001", "966500000002"]
    assert [row["member_id"] for row in result["recipients"]] == ["sibling-0", "sibling-6"]


def test_expired_draft_create_edit_load_does_not_enqueue(campaign_env):
    db, tenant = campaign_env
    created = run(whatsapp.create_campaign(
        branch_id="branch-a", name="Expired", message="Hello", audience="expired_members",
        proposed_send_at="", default_name="", recipients_json="[]", attachment=None,
        current_user=ADMIN,
    ))
    assert created["audience"] == "expired_members"
    assert created["recipients"] == []
    run(whatsapp.update_campaign(
        created["id"], branch_id="branch-a", name="Edited", message="Hello",
        audience="expired_members", proposed_send_at="", default_name="", recipients_json="[]",
        remove_attachment=False, attachment=None, current_user=ADMIN,
    ))
    assert run(whatsapp.get_campaign(created["id"], "branch-a", ADMIN))["audience"] == "expired_members"
    tenant["slug"] = "tenant-b"
    with pytest.raises(HTTPException) as exc:
        run(whatsapp.get_campaign(created["id"], "branch-a", ADMIN))
    assert exc.value.status_code == 404
    assert not any("job" in name for name in db.collections)


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
    payload = b"\x89PNG\r\n\x1a\n" + (b"x" * (whatsapp.CAMPAIGN_ATTACHMENT_CHUNK_SIZE * 2 + 17))
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
        io.BytesIO(b"%PDF-old"),
        filename="old.pdf",
        headers=Headers({"content-type": "application/pdf"}),
    )
    created = create(attachment=old_upload)
    old_id = db["whatsapp_campaigns"].rows[0]["attachment_id"]
    db["whatsapp_campaigns"].fail_update = True
    new_upload = UploadFile(
        io.BytesIO(b"%PDF-new"),
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


def image_upload(name, marker=b"x"):
    return UploadFile(
        io.BytesIO(b"\x89PNG\r\n\x1a\n" + marker),
        filename=name,
        headers=Headers({"content-type": "image/png"}),
    )


def test_multiple_images_round_trip_in_order_and_legacy_attachment_still_loads(campaign_env):
    db, _tenant = campaign_env
    created = run(whatsapp.create_campaign(
        branch_id="branch-a", name="Gallery", message="Hello",
        audience="pasted", proposed_send_at="", default_name="",
        recipients_json="[]", attachment=None,
        attachments=[image_upload("first.png", b"1"), image_upload("second.png", b"2")],
        current_user=ADMIN,
    ))
    assert created["attachment_count"] == 2
    assert [item["attachment_name"] for item in created["attachments"]] == [
        "first.png", "second.png",
    ]

    second = run(whatsapp.get_campaign_attachment(
        created["id"], "branch-a", ADMIN, index=1
    ))
    async def read_response(response):
        return b"".join([part async for part in response.body_iterator])
    assert run(read_response(second)).endswith(b"2")

    # Old campaign rows with only attachment_id remain readable.
    stored = db["whatsapp_campaigns"].rows[0]
    stored.pop("attachments")
    stored.pop("attachment_ids")
    loaded = run(whatsapp.get_campaign(created["id"], "branch-a", ADMIN))
    assert loaded["attachment_count"] == 1
    assert loaded["attachments"][0]["attachment_name"] == "first.png"


def test_campaign_rejects_mixed_pdf_images_and_more_than_ten(campaign_env):
    pdf = UploadFile(
        io.BytesIO(b"%PDF-1.7"),
        filename="offer.pdf",
        headers=Headers({"content-type": "application/pdf"}),
    )
    with pytest.raises(HTTPException, match="PDF cannot be mixed"):
        run(whatsapp.create_campaign(
            branch_id="branch-a", name="Mixed", message="Hello",
            audience="pasted", proposed_send_at="", default_name="",
            recipients_json="[]", attachment=None,
            attachments=[image_upload("image.png"), pdf], current_user=ADMIN,
        ))
    with pytest.raises(HTTPException, match="at most 10"):
        run(whatsapp.create_campaign(
            branch_id="branch-a", name="Too many", message="Hello",
            audience="pasted", proposed_send_at="", default_name="",
            recipients_json="[]", attachment=None,
            attachments=[image_upload(f"{index}.png") for index in range(11)],
            current_user=ADMIN,
        ))