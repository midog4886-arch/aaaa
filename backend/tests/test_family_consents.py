"""A family form signs the exact selected invoices once and keeps one PDF."""
import asyncio
import base64
import io
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image

from routes import family_consents as family
from services.consent_pdf import render_signed_consent_pdf


class Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, query, projection=None, sort=None):
        for row in self.rows:
            if all((value in row.get(key, []) if key == "invoice_ids" and isinstance(row.get(key), list)
                    else row.get(key) == value) for key, value in query.items()):
                return dict(row)
        return None

    async def insert_one(self, row):
        self.rows.append(dict(row))

    async def update_one(self, query, update):
        for row in self.rows:
            if row.get("id") == query.get("id"):
                row.update(update["$set"])


def signature():
    image = Image.new("RGB", (300, 100), "white")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


def invoices():
    return [
        {"id": "a", "invoice_number": "830171", "branch_id": "b1", "customer_phone": "0500097489",
         "customer_name_ar": "الأخت الأولى", "status": "paid", "total": 600,
         "items": [{"activity_name": "سباحة", "is_product": False}]},
        {"id": "b", "invoice_number": "830172", "branch_id": "b1", "customer_phone": "966500097489",
         "customer_name_ar": "الأخ الثاني", "status": "paid", "total": 600,
         "items": [{"activity_name": "سباحة", "is_product": False}]},
    ]


def test_family_link_signs_selected_children_once(monkeypatch):
    rows = invoices()
    database = SimpleNamespace(invoices=Collection(rows), family_consent_links=Collection(), family_consents=Collection())
    monkeypatch.setattr(family, "db", database)

    async def scoped(invoice_id, _user):
        return next(row for row in rows if row["id"] == invoice_id)

    async def permission(_user, _key):
        return None

    async def terms(_type):
        return {"version": "v1", "company_name": "شركة أداء الأبطال", "company_name_en": "Adaa",
                "terms": [{"section": "الاشتراك", "text": "شروط الاشتراك", "section_en": "Subscription", "text_en": "Subscription terms"}],
                "declaration": "أوافق على الشروط", "declaration_en": "I agree"}

    monkeypatch.setattr(family, "scoped_invoice", scoped)
    monkeypatch.setattr(family, "require_permission", permission)
    monkeypatch.setattr(family, "current_terms", terms)
    user = {"is_admin": True, "username": "admin"}
    created = asyncio.run(family.create_family_link("a", family.FamilyLinkInput(invoice_ids=["a", "b"]), user))
    assert "token" not in database.family_consent_links.rows[0]
    public = asyncio.run(family.get_public_family_consent(created["token"]))
    assert public["status"] == "pending"
    assert len(public["invoices"]) == 2
    payload = family.FamilySignInput(expected_group_hash=public["group_hash"], expected_terms_version="v1",
        guardian_name="ولي أمر الطفلين", relationship="الأب", guardian_identity="1234567890",
        signer_name="ولي أمر الطفلين", accepted=True, signature_png=signature(), children=[
            family.ChildInput(invoice_id="a", child_name="الأخت الأولى"),
            family.ChildInput(invoice_id="b", child_name="الأخ الثاني"),
        ])
    assert asyncio.run(family.sign_public_family_consent(created["token"], payload))["status"] == "signed"
    assert len(database.family_consents.rows) == 1
    assert render_signed_consent_pdf(database.family_consents.rows[0]).getvalue().startswith(b"%PDF")
    with pytest.raises(HTTPException) as repeated:
        asyncio.run(family.sign_public_family_consent(created["token"], payload))
    assert repeated.value.status_code == 409
    rows[1]["total"] = 650
    with pytest.raises(HTTPException) as changed:
        asyncio.run(family.get_public_family_consent(created["token"]))
    assert changed.value.status_code == 410


def test_family_link_rejects_other_guardian_phone(monkeypatch):
    rows = invoices()
    rows[1]["customer_phone"] = "0551234567"

    async def scoped(invoice_id, _user):
        return next(row for row in rows if row["id"] == invoice_id)

    monkeypatch.setattr(family, "scoped_invoice", scoped)
    with pytest.raises(HTTPException) as error:
        asyncio.run(family._invoices(["a", "b"], {"is_admin": True}))
    assert error.value.status_code == 422
