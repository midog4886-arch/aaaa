"""One guardian signature for an explicitly selected set of sibling invoices."""
import base64
import hashlib
import io
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError
from pymongo.errors import DuplicateKeyError

from .common import db, get_current_user
from .invoice_consents import (consent_form_type, current_terms, has_activity,
                               invoice_snapshot, scoped_invoice, snapshot_hash)
from services.consent_pdf import render_signed_consent_pdf
from utils.auth import require_permission

router = APIRouter(prefix="/invoices", tags=["family-consents"])


class FamilyLinkInput(BaseModel):
    invoice_ids: list[str] = Field(min_length=2, max_length=10)


class ChildInput(BaseModel):
    invoice_id: str
    child_name: str = Field(min_length=2, max_length=160)
    birth_date: str = Field(default="", max_length=10)
    has_medical_condition: bool = False
    medical_details: str = Field(default="", max_length=2000)


class FamilySignInput(BaseModel):
    expected_group_hash: str = Field(min_length=64, max_length=64)
    expected_terms_version: str
    guardian_name: str = Field(min_length=2, max_length=160)
    relationship: str = Field(min_length=2, max_length=60)
    guardian_identity: str = Field(min_length=4, max_length=30)
    signer_name: str = Field(min_length=2, max_length=160)
    children: list[ChildInput] = Field(min_length=2, max_length=10)
    accepted: bool
    signature_png: str = Field(min_length=50, max_length=350000)


def _phone(value):
    digits = re.sub(r"\D", "", value or "")
    return digits[-9:] if len(digits) >= 9 else digits


def _group_hash(snapshots):
    return snapshot_hash([{"id": row["id"], "hash": snapshot_hash(row)} for row in sorted(snapshots, key=lambda row: row["id"])])


async def _invoices(ids, user=None):
    rows = []
    for invoice_id in ids:
        row = await scoped_invoice(invoice_id, user) if user else await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if not row or row.get("status") in {"cancelled", "canceled", "void"} or not has_activity(row):
            raise HTTPException(status_code=409, detail="إحدى الفواتير غير متاحة للاستمارة العائلية")
        rows.append(row)
    if len(rows) != len(set(ids)) or len({row.get("branch_id") for row in rows}) != 1:
        raise HTTPException(status_code=422, detail="اختر فواتير مختلفة من الفرع نفسه")
    phones = {_phone(row.get("customer_phone")) for row in rows}
    if len(phones) != 1 or not next(iter(phones)):
        raise HTTPException(status_code=422, detail="يجب أن تشترك فواتير الأخوة في رقم جوال ولي الأمر")
    return rows


async def _family_link(token):
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,80}", token):
        raise HTTPException(status_code=404, detail="الرابط غير صالح")
    link = await db.family_consent_links.find_one({"token_hash": hashlib.sha256(token.encode()).hexdigest()}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="الرابط غير صالح")
    if datetime.fromisoformat(link["expires_at"]) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="انتهت صلاحية الرابط")
    rows = await _invoices(link["invoice_ids"])
    snapshots = [invoice_snapshot(row) for row in rows]
    if _group_hash(snapshots) != link["group_hash"]:
        raise HTTPException(status_code=410, detail="تغيّرت إحدى الفواتير؛ اطلب رابطًا جديدًا")
    settings = await current_terms(link["form_type"])
    if settings["version"] != link["terms_version"]:
        raise HTTPException(status_code=410, detail="تغيّرت بنود الاستمارة؛ اطلب رابطًا جديدًا")
    signed = await db.family_consents.find_one({"link_id": link["id"]}, {"_id": 0})
    return link, snapshots, settings, signed


@router.get("/{invoice_id}/family-consent-candidates")
async def family_candidates(invoice_id: str, user: dict = Depends(get_current_user)):
    await require_permission(user, "invoices")
    source = await scoped_invoice(invoice_id, user)
    phone = _phone(source.get("customer_phone"))
    if not phone:
        return {"invoices": []}
    rows = await db.invoices.find({"branch_id": source.get("branch_id")}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return {"invoices": [{"id": row["id"], "invoice_number": row.get("invoice_number"),
                          "child_name": row.get("customer_name_ar") or row.get("member_name") or "",
                          "activity": "، ".join(item.get("activity_name") or "" for item in row.get("items", []) if not item.get("is_product"))}
                         for row in rows if _phone(row.get("customer_phone")) == phone and has_activity(row)
                         and row.get("status") not in {"cancelled", "canceled", "void"}]}


@router.post("/{invoice_id}/family-consent-link")
async def create_family_link(invoice_id: str, payload: FamilyLinkInput, user: dict = Depends(get_current_user)):
    await require_permission(user, "invoices")
    if invoice_id not in payload.invoice_ids:
        raise HTTPException(status_code=422, detail="يجب تضمين الفاتورة الحالية")
    rows = await _invoices(payload.invoice_ids, user)
    snapshots = [invoice_snapshot(row) for row in rows]
    form_type = "swimming" if any(consent_form_type(row) == "swimming" for row in rows) else "general"
    settings = await current_terms(form_type)
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    link = {"id": str(uuid.uuid4()), "invoice_ids": sorted(payload.invoice_ids), "branch_id": rows[0].get("branch_id"),
            "token_hash": hashlib.sha256(token.encode()).hexdigest(), "group_hash": _group_hash(snapshots),
            "terms_version": settings["version"], "form_type": form_type,
            "created_at": now.isoformat(), "expires_at": (now + timedelta(days=7)).isoformat(),
            "created_by": user.get("username", "")}
    await db.family_consent_links.insert_one(link)
    return {"id": link["id"], "token": token, "expires_at": link["expires_at"],
            "customer_phone": rows[0].get("customer_phone", "")}


@router.get("/public/family-consent/{token}")
async def get_public_family_consent(token: str):
    link, snapshots, settings, signed = await _family_link(token)
    if not link.get("opened_at"):
        await db.family_consent_links.update_one({"id": link["id"], "opened_at": {"$exists": False}},
                                                 {"$set": {"opened_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "signed" if signed else "pending", "invoices": snapshots,
            "group_hash": link["group_hash"], "terms_version": link["terms_version"],
            "title": "استمارة تسجيل عائلية وإقرار ولي الأمر", "company_name": settings["company_name"],
            "company_name_en": settings["company_name_en"], "terms": settings["terms"],
            "declaration": settings["declaration"], "declaration_en": settings["declaration_en"],
            "expires_at": link["expires_at"]}


@router.post("/public/family-consent/{token}")
async def sign_public_family_consent(token: str, payload: FamilySignInput):
    link, snapshots, settings, signed = await _family_link(token)
    if signed:
        raise HTTPException(status_code=409, detail="تم توقيع الاستمارة بالفعل")
    if not payload.accepted or payload.expected_group_hash != link["group_hash"] or payload.expected_terms_version != link["terms_version"]:
        raise HTTPException(status_code=409, detail="تغيّرت الاستمارة؛ أعد فتح الرابط وراجع البيانات")
    if {child.invoice_id for child in payload.children} != set(link["invoice_ids"]) or len(payload.children) != len(link["invoice_ids"]):
        raise HTTPException(status_code=422, detail="أكمل بيانات كل طفل في الاستمارة")
    if any(child.has_medical_condition and not child.medical_details.strip() for child in payload.children):
        raise HTTPException(status_code=422, detail="أدخل تفاصيل الحالة الصحية لكل طفل محدد")
    match = re.fullmatch(r"data:image/png;base64,([A-Za-z0-9+/=]+)", payload.signature_png)
    try:
        raw = base64.b64decode(match.group(1), validate=True) if match else b""
        if len(raw) > 250000 or not raw.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError()
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != "PNG" or image.width < 100 or image.height < 40 or image.width * image.height > 2_000_000:
                raise ValueError()
            image.verify()
    except (ValueError, UnidentifiedImageError, OSError):
        raise HTTPException(status_code=422, detail="التوقيع غير صالح")
    now = datetime.now(timezone.utc).isoformat()
    doc = {"_id": link["id"], "id": str(uuid.uuid4()), "link_id": link["id"], "invoice_ids": link["invoice_ids"],
           "branch_id": link["branch_id"], "invoice_snapshots": snapshots, "group_hash": link["group_hash"],
           "terms_version": link["terms_version"], "form_type": link["form_type"], "title": "استمارة تسجيل عائلية وإقرار ولي الأمر",
           "company_name": settings["company_name"], "company_name_en": settings["company_name_en"],
           "terms": settings["terms"], "declaration": settings["declaration"], "declaration_en": settings["declaration_en"],
           "fields": payload.model_dump(exclude={"expected_group_hash", "expected_terms_version", "accepted", "signature_png"}),
           "signer_name": payload.signer_name, "signature_png": payload.signature_png, "signed_at": now,
           "recorded_by": "ولي الأمر عبر الرابط"}
    try:
        await db.family_consents.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="تم توقيع الاستمارة بالفعل")
    return {"status": "signed", "signed_at": now}


@router.get("/public/family-consent/{token}/pdf")
async def download_public_family_pdf(token: str):
    _link, _snapshots, _settings, signed = await _family_link(token)
    if not signed:
        raise HTTPException(status_code=404, detail="لم تُوقَّع الاستمارة بعد")
    return StreamingResponse(render_signed_consent_pdf(signed), media_type="application/pdf",
                             headers={"Content-Disposition": 'attachment; filename="signed-family-consent.pdf"', "Cache-Control": "no-store"})
