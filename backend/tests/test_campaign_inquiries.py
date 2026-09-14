"""Focused, in-process tests for the manual campaign-inquiry CRM.

The handlers are called directly with an in-memory database.  These tests do
not start the API and do not touch a live tenant database.
"""

import asyncio
import os
import sys
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _matches(doc, query):
    for key, expected in (query or {}).items():
        if key == "$or":
            if not any(_matches(doc, item) for item in expected):
                return False
            continue
        if isinstance(expected, dict):
            if "$exists" in expected and ((key in doc) != expected["$exists"]):
                return False
            if "$in" in expected and doc.get(key) not in expected["$in"]:
                return False
            if "$ne" in expected and doc.get(key) == expected["$ne"]:
                return False
            continue
        if doc.get(key) != expected:
            return False
    return True


class Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        self.docs.sort(key=lambda item: item.get(field) or "", reverse=direction < 0)
        return self

    async def to_list(self, _length=None):
        return [dict(item) for item in self.docs]


class Result:
    def __init__(self, matched=0, modified=0, upserted=None):
        self.matched_count = matched
        self.modified_count = modified
        self.upserted_id = upserted


class FakeCollection:
    def __init__(self):
        self.docs = []

    def _copy(self, doc, projection):
        output = dict(doc)
        if projection and projection.get("_id") == 0:
            output.pop("_id", None)
        return output

    async def find_one(self, query, projection=None, **_kwargs):
        for doc in self.docs:
            if _matches(doc, query):
                return self._copy(doc, projection)
        return None

    def find(self, query=None, projection=None):
        return Cursor([
            self._copy(doc, projection)
            for doc in self.docs
            if _matches(doc, query or {})
        ])

    async def insert_one(self, doc):
        if any(d.get("_id") == doc.get("_id") for d in self.docs):
            from pymongo.errors import DuplicateKeyError
            raise DuplicateKeyError("duplicate")
        self.docs.append(dict(doc))

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if _matches(doc, query):
                for key, value in update.get("$set", {}).items():
                    doc[key] = value
                return Result(matched=1, modified=1)
        if not upsert:
            return Result()
        document = dict(update.get("$setOnInsert", {}))
        for key, value in query.items():
            if not isinstance(value, dict):
                document.setdefault(key, value)
        if any(d.get("_id") == document.get("_id") for d in self.docs):
            from pymongo.errors import DuplicateKeyError
            raise DuplicateKeyError("duplicate")
        self.docs.append(document)
        return Result(upserted=document.get("_id"))


class FakeDB:
    def __init__(self):
        self.collections = {
            "branches": FakeCollection(),
            "campaign_inquiries": FakeCollection(),
            "invoices": FakeCollection(),
        }

    def __getattr__(self, name):
        return self.collections.setdefault(name, FakeCollection())

    def __getitem__(self, name):
        return self.__getattr__(name)


ADMIN = {
    "user_id": "admin",
    "id": "admin",
    "username": "admin",
    "is_admin": True,
    "branch_id": None,
}


@pytest.fixture()
def crm(monkeypatch):
    from routes import campaign_inquiries as module

    fake_db = FakeDB()
    fake_db.branches.docs.extend([{"id": "B1"}, {"id": "B2"}])
    monkeypatch.setattr(module, "db", fake_db)

    async def allow_permission(_user, _permission):
        return None

    monkeypatch.setattr(module, "require_permission", allow_permission)
    return module, fake_db


def test_branch_isolation_and_campaign_permission(crm):
    module, fake_db = crm
    fake_db.campaign_inquiries.docs.extend([
        {
            "id": "one", "branch_id": "B1", "phone": "966501234567",
            "status": "new", "created_at": "2026-01-02T00:00:00+00:00",
        },
        {
            "id": "two", "branch_id": "B2", "phone": "966501234568",
            "status": "new", "created_at": "2026-01-01T00:00:00+00:00",
        },
    ])
    staff_b1 = {
        "user_id": "staff", "username": "staff", "is_admin": False,
        "branch_id": "B1",
    }
    result = run(module.list_campaign_inquiries(current_user=staff_b1))
    assert result["total"] == 1
    assert result["items"][0]["id"] == "one"

    async def deny(_user, permission):
        raise HTTPException(status_code=403, detail=f"permission {permission}")

    module.require_permission = deny
    with pytest.raises(HTTPException) as exc:
        run(module.list_campaign_inquiries(current_user=ADMIN))
    assert exc.value.status_code == 403
    assert "messages" in exc.value.detail


def test_preview_normalizes_arabic_digits_and_never_writes(crm):
    module, fake_db = crm
    payload = module.CampaignInquiryPreview(
        branch_id="B1",
        phones="٠٥٠١٢٣٤٥٦٧\nnot-a-phone",
    )
    result = run(module.preview_campaign_inquiries(payload, current_user=ADMIN))
    assert result["rows"][0] == {
        "line": 1,
        "phone": "966501234567",
        "status": "valid",
        "reason": None,
    }
    assert result["rows"][1]["status"] == "invalid"
    assert result["valid_count"] == 1
    assert result["invalid_count"] == 1
    assert result["duplicate_count"] == 0
    assert fake_db.campaign_inquiries.docs == []


def test_import_deduplicates_without_overwriting_existing_campaign(crm):
    module, fake_db = crm
    payload = module.CampaignInquiryImport(
        branch_id="B1",
        phones="٠٥٠١٢٣٤٥٦٧\n0501234567\n+966 50 123 4567\nbad",
        campaign="first",
    )
    first = run(module.import_campaign_inquiries(payload, current_user=ADMIN))
    assert first == {"created": 1, "duplicates": 2, "invalid": 1}
    stored = fake_db.campaign_inquiries.docs[0]
    assert stored["phone"] == "966501234567"
    assert stored["campaign"] == "first"

    second_payload = module.CampaignInquiryImport(
        branch_id="B1",
        phones="0501234567",
        campaign="must-not-overwrite",
    )
    second = run(module.import_campaign_inquiries(second_payload, current_user=ADMIN))
    assert second == {"created": 0, "duplicates": 1, "invalid": 0}
    assert fake_db.campaign_inquiries.docs[0]["campaign"] == "first"


def test_due_status_update_and_archive(crm):
    module, fake_db = crm
    create = module.CampaignInquiryCreate(
        branch_id="B1",
        phone="0501234567",
        followup_due_at="2020-01-01T00:00:00Z",
    )
    created = run(module.create_campaign_inquiry(create, current_user=ADMIN))
    assert created["status"] == "new"
    listed = run(module.list_campaign_inquiries(current_user=ADMIN))
    assert listed["counts"]["due"] == 1

    update = module.CampaignInquiryUpdate(status="do_not_contact", notes="called")
    updated = run(module.update_campaign_inquiry(
        created["id"], update, current_user=ADMIN
    ))
    assert updated["status"] == "do_not_contact"
    assert updated["followup_due_at"] is None
    assert len(updated["history"]) == 1
    listed = run(module.list_campaign_inquiries(current_user=ADMIN))
    assert listed["counts"]["due"] == 0

    archived = run(module.archive_campaign_inquiry(created["id"], current_user=ADMIN))
    assert archived["archived"] is True
    listed = run(module.list_campaign_inquiries(current_user=ADMIN))
    assert listed["total"] == 0


def test_due_uses_end_of_current_riyadh_day(crm):
    module, _fake_db = crm
    fixed_now = datetime(2026, 1, 2, 15, 0, tzinfo=timezone.utc)
    assert module._is_due(
        {
            "status": "new",
            "followup_due_at": "2026-01-02T23:30:00+03:00",
        },
        now=fixed_now,
    )
    assert module._is_due(
        {
            "status": "new",
            "followup_due_at": "2026-01-01T09:00:00+03:00",
        },
        now=fixed_now,
    )
    assert not module._is_due(
        {
            "status": "new",
            "followup_due_at": "2026-01-03T00:00:00+03:00",
        },
        now=fixed_now,
    )


def test_list_counts_are_not_capped_by_item_page_size(crm):
    module, fake_db = crm
    fake_db.campaign_inquiries.docs.extend(
        {
            "id": f"inquiry-{index}",
            "branch_id": "B1",
            "phone": f"9665012{index:05d}",
            "status": "new",
            "created_at": "2026-01-01T00:00:00+00:00",
        }
        for index in range(600)
    )
    listed = run(module.list_campaign_inquiries(current_user=ADMIN))
    assert len(listed["items"]) == 500
    assert listed["returned"] == 500
    assert listed["has_more"] is True
    assert listed["total"] == 600
    assert listed["counts"]["total"] == 600


def test_invoice_validation_is_branch_scoped_and_paid_is_authoritative(crm):
    module, fake_db = crm
    fake_db.invoices.docs.extend([
        {"id": "pending-b1", "branch_id": "B1", "status": "pending"},
        {"id": "paid-b1", "branch_id": "B1", "status": "paid"},
        {"id": "paid-b2", "branch_id": "B2", "status": "paid"},
        {"id": "cancelled-b1", "branch_id": "B1", "status": "cancelled"},
    ])
    with pytest.raises(HTTPException) as exc:
        run(module.create_campaign_inquiry(
            module.CampaignInquiryCreate(
                branch_id="B1", phone="0501234567", status="paid",
                invoice_id="pending-b1",
            ),
            current_user=ADMIN,
        ))
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        run(module.create_campaign_inquiry(
            module.CampaignInquiryCreate(
                branch_id="B1", phone="0501234567", status="invoiced",
                invoice_id="paid-b2",
            ),
            current_user=ADMIN,
        ))
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException):
        run(module.create_campaign_inquiry(
            module.CampaignInquiryCreate(
                branch_id="B1", phone="0501234567", status="invoiced",
                invoice_id="cancelled-b1",
            ),
            current_user=ADMIN,
        ))

    created = run(module.create_campaign_inquiry(
        module.CampaignInquiryCreate(
            branch_id="B1", phone="0501234567", status="paid",
            invoice_id="paid-b1",
        ),
        current_user=ADMIN,
    ))
    assert created["status"] == "paid"


def test_invoice_status_normalization_handles_cancel_delete_and_restore(crm):
    module, fake_db = crm
    invoice = {
        "id": "paid-id",
        "invoice_number": "101",
        "branch_id": "B1",
        "status": "paid",
    }
    fake_db.invoices.docs.append(invoice)
    created = run(module.create_campaign_inquiry(
        module.CampaignInquiryCreate(
            branch_id="B1",
            phone="0501234567",
            status="paid",
            invoice_id="paid-id",
        ),
        current_user=ADMIN,
    ))
    assert created["status"] == "paid"
    assert created["invoice_number"] == "101"

    invoice["status"] = "cancelled"
    cancelled = run(module.list_campaign_inquiries(current_user=ADMIN))
    assert cancelled["items"][0]["status"] == "interested"
    assert "cancelled" in cancelled["items"][0]["invoice_link_error"]
    assert cancelled["items"][0]["invoice_number"] == "101"

    fake_db.invoices.docs.clear()
    deleted = run(module.list_campaign_inquiries(current_user=ADMIN))
    assert deleted["items"][0]["status"] == "interested"
    assert "deleted" in deleted["items"][0]["invoice_link_error"]
    assert deleted["items"][0]["invoice_status"] is None

    fake_db.invoices.docs.append({
        **invoice,
        "status": "pending",
    })
    restored = run(module.list_campaign_inquiries(current_user=ADMIN))
    assert restored["items"][0]["status"] == "invoiced"
    assert "invoice_link_error" not in restored["items"][0]
    assert restored["items"][0]["invoice_number"] == "101"

    fake_db.invoices.docs[0]["status"] = "paid"
    paid_again = run(module.list_campaign_inquiries(current_user=ADMIN))
    assert paid_again["items"][0]["status"] == "paid"


def test_invoice_status_without_a_link_never_claims_paid(crm):
    module, fake_db = crm
    fake_db.campaign_inquiries.docs.append({
        "id": "legacy-paid",
        "branch_id": "B1",
        "phone": "966501234567",
        "status": "paid",
    })
    listed = run(module.list_campaign_inquiries(current_user=ADMIN))
    assert listed["items"][0]["status"] == "interested"
    assert "no linked invoice" in listed["items"][0]["invoice_link_error"]


def test_invoice_number_resolves_to_canonical_id_and_rejects_ambiguity(crm):
    module, fake_db = crm
    fake_db.invoices.docs.extend([
        {
            "id": "canonical-id",
            "invoice_number": "202",
            "branch_id": "B1",
            "status": "pending",
        },
        {
            "id": "same-number-other-branch",
            "invoice_number": "202",
            "branch_id": "B2",
            "status": "paid",
        },
    ])
    created = run(module.create_campaign_inquiry(
        module.CampaignInquiryCreate(
            branch_id="B1",
            phone="0501234567",
            invoice_id="202",
        ),
        current_user=ADMIN,
    ))
    assert created["invoice_id"] == "canonical-id"
    assert created["invoice_number"] == "202"
    assert created["status"] == "invoiced"

    updated = run(module.update_campaign_inquiry(
        created["id"],
        module.CampaignInquiryUpdate(invoice_id="202"),
        current_user=ADMIN,
    ))
    assert updated["invoice_id"] == "canonical-id"
    assert updated["invoice_number"] == "202"

    fake_db.invoices.docs.append({
        "id": "ambiguous-id",
        "invoice_number": "202",
        "branch_id": "B1",
        "status": "pending",
    })
    with pytest.raises(HTTPException) as exc:
        run(module.create_campaign_inquiry(
            module.CampaignInquiryCreate(
                branch_id="B1",
                phone="0501234568",
                invoice_id="202",
            ),
            current_user=ADMIN,
        ))
    assert exc.value.status_code == 400
    assert "multiple" in exc.value.detail


def test_write_scope_and_phone_permission_fail_closed(crm):
    module, fake_db = crm
    staff_b1 = {
        "user_id": "staff",
        "username": "staff",
        "is_admin": False,
        "branch_id": "B1",
    }
    with pytest.raises(HTTPException) as exc:
        run(module.create_campaign_inquiry(
            module.CampaignInquiryCreate(branch_id="B2", phone="0501234567"),
            current_user=staff_b1,
        ))
    assert exc.value.status_code == 403
    assert fake_db.campaign_inquiries.docs == []

    async def allow_messages_only(_user, permission):
        if permission == module.PHONE_PERMISSION:
            raise HTTPException(status_code=403, detail="member phones required")

    module.require_permission = allow_messages_only
    with pytest.raises(HTTPException) as exc:
        run(module.import_campaign_inquiries(
            module.CampaignInquiryImport(branch_id="B1", phones="0501234567"),
            current_user=ADMIN,
        ))
    assert exc.value.status_code == 403
    assert fake_db.campaign_inquiries.docs == []

    fake_db.campaign_inquiries.docs.append({
        "id": "masked",
        "branch_id": "B1",
        "phone": "966501234567",
        "status": "new",
    })
    masked = {
        "user_id": "staff",
        "username": "staff",
        "is_admin": False,
        "branch_id": "B1",
        "permissions": [],
    }
    # Listing does not require the phone permission, but never exposes a phone
    # to a user who lacks it.
    listed = run(module.list_campaign_inquiries(current_user=masked))
    assert listed["items"][0]["phone"] != "966501234567"
    assert listed["items"][0]["phone_masked"] is True


def test_concurrent_imports_converge_without_overwriting(crm):
    module, fake_db = crm
    payload = module.CampaignInquiryImport(
        branch_id="B1",
        phones="0501234567",
        campaign="first",
    )
    second_payload = module.CampaignInquiryImport(
        branch_id="B1",
        phones="٠٥٠١٢٣٤٥٦٧",
        campaign="second",
    )
    async def concurrent_imports():
        return await asyncio.gather(
            module.import_campaign_inquiries(payload, current_user=ADMIN),
            module.import_campaign_inquiries(second_payload, current_user=ADMIN),
        )

    first, second = run(concurrent_imports())
    assert sorted([first["created"], second["created"]]) == [0, 1]
    assert len(fake_db.campaign_inquiries.docs) == 1
    assert fake_db.campaign_inquiries.docs[0]["campaign"] in {"first", "second"}


def test_priority_sorting_happens_before_500_item_bound(crm):
    module, fake_db = crm
    fake_db.campaign_inquiries.docs.extend(
        [
            {
                "id": "ordinary",
                "branch_id": "B1",
                "phone": "966501234500",
                "status": "new",
                "created_at": "2026-01-04T00:00:00+00:00",
                "last_contact_at": "2026-01-04T01:00:00+00:00",
            },
            {
                "id": "uncontacted",
                "branch_id": "B1",
                "phone": "966501234501",
                "status": "new",
                "created_at": "2026-01-03T00:00:00+00:00",
            },
            {
                "id": "overdue",
                "branch_id": "B1",
                "phone": "966501234502",
                "status": "new",
                "created_at": "2026-01-01T00:00:00+00:00",
                "followup_due_at": "2020-01-01T00:00:00+00:00",
            },
            {
                "id": "terminal",
                "branch_id": "B1",
                "phone": "966501234503",
                "status": "do_not_contact",
                "created_at": "2026-01-05T00:00:00+00:00",
                "followup_due_at": "2020-01-01T00:00:00+00:00",
            },
        ]
    )
    listed = run(module.list_campaign_inquiries(current_user=ADMIN))
    assert [item["id"] for item in listed["items"]] == [
        "overdue",
        "uncontacted",
        "terminal",
        "ordinary",
    ]


def test_campaign_filter_options_and_paid_stats_are_branch_scoped(crm):
    module, fake_db = crm
    fake_db.invoices.docs.append({
        "id": "paid-b1",
        "branch_id": "B1",
        "status": "paid",
        "total": 125,
    })
    fake_db.campaign_inquiries.docs.extend(
        [
            {
                "id": "campaign-a",
                "branch_id": "B1",
                "phone": "966501234510",
                "campaign": "Campaign A",
                "status": "new",
            },
            {
                "id": "campaign-b",
                "branch_id": "B1",
                "phone": "966501234511",
                "campaign": "Campaign B",
                "status": "paid",
                "invoice_id": "paid-b1",
            },
            {
                "id": "other-branch",
                "branch_id": "B2",
                "phone": "966501234512",
                "campaign": "Secret B2",
                "status": "new",
            },
        ]
    )
    selected = run(module.list_campaign_inquiries(
        branch_filter="B1",
        campaign_exact="Campaign B",
        current_user=ADMIN,
    ))
    assert selected["campaigns"] == ["Campaign A", "Campaign B"]
    assert selected["selected_campaign"] == "Campaign B"
    assert [item["id"] for item in selected["items"]] == ["campaign-b"]
    assert selected["counts"]["total"] == 1
    assert selected["paid_stats"] == {"count": 1, "amount": 125.0}
    assert "Secret B2" not in selected["campaigns"]