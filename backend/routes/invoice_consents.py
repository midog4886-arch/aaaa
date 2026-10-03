"""Signed activity registration forms derived from saved invoices."""
import base64
import copy
import hashlib
import io
import json
import secrets
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError
from PIL import Image, UnidentifiedImageError

from .common import db, get_current_user
from services.consent_pdf import render_signed_consent_pdf
from utils.auth import require_branch_scope, require_permission
from utils.tenant import get_current_tenant

router = APIRouter(prefix="/invoices", tags=["invoice-consents"])

TERMS_VERSION = "activity-2026-09-29"
FORM_TITLE = "استمارة تسجيل نشاط وإقرار ولي الأمر"
COMPANY_NAME = "شركة أداء الأبطال"
FORM_TITLE_EN = "Activity Registration and Guardian Acknowledgment Form"
COMPANY_NAME_EN = "Adaa Al Abtal Company"
TERMS = [
    {"section": 'الاشتراك والرسوم', "text": 'الاشتراك محدد بتاريخ بداية ونهاية كما هو موضح في الفاتورة. لا تُعوَّض حصص الغياب، باستثناء الحالات المرضية الموثقة بتقرير طبي معتمد ووفق سياسة التعويض الخاصة بالأكاديمية.'},
    {"section": 'الاشتراك والرسوم', "text": 'المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك.'},
    {"section": 'شروط وتعهدات ولي الأمر', "text": 'الالتزام بالمواعيد: التزام تام بإحضار الطفل واستلامه في الأوقات المحددة للتدريب. الأكاديمية والمكان غير مسؤولين عن الطفل قبل بدء الحصة بخمس دقائق أو بعد انتهائها بخمس دقائق.'},
    {"section": 'شروط وتعهدات ولي الأمر', "text": 'الزي والمعدات الرياضية: إحضار جميع أدوات السباحة الخاصة بالطفل (زي سباحة مخصص، نظارة سباحة، طاقية شعر، وفوطة). ويمنع منعاً باتاً نزول المسبح بملابس قطنية أو غير مخصصة للسباحة.'},
    {"section": 'شروط وتعهدات ولي الأمر', "text": 'النظافة العامة والسلامة: الحرص على استحمام الطفل قبل نزول المسبح، والالتزام التام بقواعد ونظام النظافة والسلامة العامة الخاصة بالمرفق.'},
    {"section": 'شروط وتعهدات ولي الأمر', "text": 'تواجد أولياء الأمور: الانتظار في الأماكن المخصصة فقط، ويمنع منعاً باتاً دخول أولياء الأمور إلى منطقة حافة المسبح أو التحدث مع المدربين أثناء سير التدريب لضمان تركيز الأطفال والسلامة العامة.'},
    {"section": 'شروط وتعهدات ولي الأمر', "text": 'الإفصاح الطبي الشامل: التعهد بالإفصاح الكامل عن أي حالة صحية أو مرضية أو صعوبات تعلم أو إصابة سابقة يعاني منها الطفل. وفي حال إخفاء أي معلومات صحية، يتحمل ولي الأمر كافة النتائج والمترتبات.'},
    {"section": 'شروط وتعهدات ولي الأمر', "text": 'المرض والغياب: التعهد بعدم إرسال الطفل في حال ظهور أي أعراض مرضية (حرارة، زكام، أمراض جلدية) لحماية بقية المشتركين. ولا تعوض الحصص المفقودة إلا بموجب تقرير طبي معتمد ووفق سياسة التعويض الخاصة بالأكاديمية.'},
    {"section": 'شروط وتعهدات ولي الأمر', "text": 'الممتلكات الشخصية: الأكاديمية والمركز غير مسؤولين عن فقدان أو تلف أي ممتلكات شخصية أو أجهزة إلكترونية أو مبالغ مالية تخص الطفل أو ولي الأمر داخل المرفق.'},
    {"section": 'السلامة والمسؤولية والطوارئ', "text": 'بيئة التدريب: تتعهد إدارة المسبح والأكاديمية بتوفير بيئة تدريبية آمنة ومدربين ومنقذين مؤهلين لمتابعة الأطفال طوال فترة الجلسة التدريبية داخل الحوض.'},
    {"section": 'السلامة والمسؤولية والطوارئ', "text": 'المخاطر والإصابات: يُقر ولي الأمر بأن رياضة السباحة تتضمن نشاطاً بدنياً قد يتخلله بعض المخاطر الناتجة عن الحركة أو الانزلاق حول المسبح عند عدم الالتزام والركض. الأكاديمية والمكان غير مسؤولين عن أي إصابة تحدث نتيجة عدم التزام الطفل بتعليمات المدرب أو قواعد السلامة.'},
    {"section": 'السلامة والمسؤولية والطوارئ', "text": 'الإسعافات والطوارئ: في حالة حدوث أي طارئ (لا قدر الله)، يُعامل الطفل بالإسعافات الأولية اللازمة، ويتم الاتصال فوراً بولي الأمر. وفي الحالات الحرجة، يحق للأكاديمية نقل الطفل لأقرب مركز طبي لحين حضور ولي الأمر.'},
    {"section": 'السلامة والمسؤولية والطوارئ', "text": 'التلفيات والأضرار: يتحمل ولي الأمر قيمة أي تلفيات أو أضرار يُحدثها الطفل عمداً في مرافق أو أدوات المسبح/الأكاديمية.'},
]
DECLARATION = "أقر أنا ولي الأمر بأنني قرأت بيانات التسجيل وجميع الشروط وبنود المسؤولية الموضحة في هذه الاستمارة وفهمتها وأوافق عليها، وأتعهد بالالتزام بها وبالتعليمات الصادرة من إدارة الأكاديمية والمكان."
DECLARATION_EN = "I, the guardian, confirm that I have read and understood the registration details, terms, and responsibility provisions in this form, agree to them, and undertake to follow the instructions issued by the academy and the facility."
TERMS_EN = [
    ("Subscription and fees", "The subscription has the start and end dates shown on the invoice. Missed sessions are not made up, except documented illness supported by an approved medical report and subject to the academy's make-up policy."),
    ("Subscription and fees", "Paid fees are non-refundable after one week from the start of the subscription."),
    ("Guardian commitments", "Bring and collect the child at the scheduled training times. The academy and facility are not responsible for the child more than five minutes before a session starts or more than five minutes after it ends."),
    ("Guardian commitments", "Bring the child's swimming equipment: appropriate swimwear, goggles, swim cap, and towel. Cotton clothing or clothing unsuitable for swimming is not permitted in the pool."),
    ("Guardian commitments", "Ensure the child showers before entering the pool and follows the facility's hygiene and safety rules."),
    ("Guardian commitments", "Guardians must wait in designated areas and must not enter the poolside area or speak to coaches during training."),
    ("Guardian commitments", "Fully disclose any medical condition, illness, learning difficulty, or previous injury affecting the child. The guardian bears the consequences of withholding relevant health information."),
    ("Guardian commitments", "Do not bring the child when they have symptoms such as fever, a cold, or a skin condition, to protect other participants. Missed sessions are made up only with an approved medical report and according to the academy's make-up policy."),
    ("Guardian commitments", "The academy and facility are not responsible for loss of or damage to personal belongings, electronic devices, or money at the facility."),
    ("Safety, responsibility, and emergencies", "The pool management and academy undertake to provide a safe training environment and qualified coaches and lifeguards to supervise children during the session in the pool."),
    ("Safety, responsibility, and emergencies", "The guardian acknowledges that swimming is a physical activity involving risks such as movement and slipping. The academy and facility are not responsible for injuries caused by the child's failure to follow coach instructions or safety rules."),
    ("Safety, responsibility, and emergencies", "In an emergency, necessary first aid will be provided and the guardian contacted immediately. In critical cases, the academy may take the child to the nearest medical center until the guardian arrives."),
    ("Safety, responsibility, and emergencies", "The guardian is responsible for the cost of damage intentionally caused by the child to the pool or academy facilities or equipment."),
]
for term, (section_en, text_en) in zip(TERMS, TERMS_EN):
    term["section_en"] = section_en
    term["text_en"] = text_en

# Keep the existing swimming form and its links unchanged. Other activities use
# only the clauses that apply regardless of the sport.
GENERAL_TERMS = [TERMS[index] for index in (0, 1, 2, 6, 7, 8, 11)]


def consent_form_type(invoice):
    return "swimming" if any(
        not item.get("is_product") and re.search(r"سباح|swim", item.get("activity_name") or "", re.I)
        for item in invoice.get("items", [])
    ) else "general"


def has_activity(invoice):
    return any(not item.get("is_product") for item in invoice.get("items", []))


class ConsentInput(BaseModel):
    expected_invoice_hash: str = Field(min_length=64, max_length=64)
    expected_terms_version: str = Field(min_length=1, max_length=80)
    child_name: str = Field(min_length=2, max_length=160)
    birth_date: Optional[str] = Field(default=None, max_length=10)
    guardian_name: str = Field(min_length=2, max_length=160)
    relationship: str = Field(min_length=2, max_length=60)
    guardian_identity: str = Field(min_length=4, max_length=30)
    emergency_phone: Optional[str] = Field(default=None, max_length=25)
    has_medical_condition: bool
    medical_details: str = Field(default="", max_length=2000)
    signer_name: str = Field(min_length=2, max_length=160)
    accepted: bool
    signature_png: str = Field(min_length=50, max_length=350000)


class TermsItem(BaseModel):
    section: str = Field(min_length=2, max_length=100)
    text: str = Field(min_length=5, max_length=2000)
    section_en: str = Field(min_length=2, max_length=100)
    text_en: str = Field(min_length=5, max_length=2000)


class TermsUpdate(BaseModel):
    form_type: str = Field(default="swimming", pattern="^(swimming|general)$")
    title: str = Field(min_length=5, max_length=160)
    title_en: str = Field(min_length=5, max_length=160)
    company_name: str = Field(min_length=2, max_length=120)
    company_name_en: str = Field(min_length=2, max_length=120)
    terms: list[TermsItem] = Field(min_length=1, max_length=40)
    declaration: str = Field(min_length=20, max_length=3000)
    declaration_en: str = Field(min_length=20, max_length=3000)


async def current_terms(form_type="swimming"):
    settings_id = "activity-registration" if form_type == "swimming" else "activity-registration-general"
    saved = await db.registration_consent_settings.find_one({"id": settings_id}, {"_id": 0})
    return saved or {"id": settings_id, "version": TERMS_VERSION if form_type == "swimming" else "general-2026-09-29",
                     "title": FORM_TITLE, "title_en": FORM_TITLE_EN,
                     "company_name": COMPANY_NAME, "company_name_en": COMPANY_NAME_EN,
                     "terms": TERMS if form_type == "swimming" else GENERAL_TERMS,
                     "declaration": DECLARATION, "declaration_en": DECLARATION_EN}


@router.get("/registration-consent-terms")
async def get_registration_consent_terms(user: dict = Depends(get_current_user)):
    return await current_terms()


@router.put("/registration-consent-terms")
async def update_registration_consent_terms(payload: TermsUpdate, user: dict = Depends(get_current_user)):
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only administrators may edit form terms")
    doc = {"id": "activity-registration" if payload.form_type == "swimming" else "activity-registration-general", "version": str(uuid.uuid4()),
           "title": payload.title.strip(), "title_en": payload.title_en.strip(),
           "company_name": payload.company_name.strip(), "company_name_en": payload.company_name_en.strip(),
           "terms": [item.model_dump() for item in payload.terms],
           "declaration": payload.declaration.strip(), "declaration_en": payload.declaration_en.strip(),
           "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": user.get("username", "")}
    await db.registration_consent_settings.update_one({"_id": doc["id"]}, {"$set": doc}, upsert=True)
    return doc


def invoice_snapshot(invoice):
    snapshot = {key: invoice.get(key) for key in (
        "id", "invoice_number", "branch_id", "member_id", "member_code",
        "customer_name_ar", "customer_phone", "member_name", "commercial_reg", "items",
        "subtotal", "discount", "vat_amount", "total",
    )}
    tenant = get_current_tenant() or {}
    snapshot["commercial_reg"] = tenant.get("commercial_reg") or snapshot.get("commercial_reg") or ""
    return snapshot


def snapshot_hash(snapshot):
    encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


async def scoped_invoice(invoice_id, user):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    branch = require_branch_scope(user, invoice.get("branch_id"))
    if branch and invoice.get("branch_id") != branch:
        raise HTTPException(status_code=403, detail="Invoice outside your branch")
    return invoice


def link_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def link_history(invoice, settings):
    links = await db.invoice_consent_links.find({"invoice_id": invoice["id"]}, {"_id": 0}).sort("created_at", -1).to_list(25)
    signatures = await db.invoice_consents.find({"invoice_id": invoice["id"]}, {"_id": 0}).to_list(100)
    current_hash = snapshot_hash(invoice_snapshot(invoice))
    history = []
    for link in links:
        signed = next((item for item in signatures if item.get("invoice_hash") == link["invoice_hash"] and item.get("terms_version") == link["terms_version"] and item.get("signed_at", "") >= link["created_at"]), None)
        if signed:
            status = "signed"
        elif invoice.get("status") in {"cancelled", "canceled", "void"} or current_hash != link["invoice_hash"] or settings["version"] != link["terms_version"]:
            status = "invalid"
        elif datetime.fromisoformat(link["expires_at"]) <= datetime.now(timezone.utc):
            status = "expired"
        elif link.get("opened_at"):
            status = "opened"
        elif link.get("sent_at"):
            status = "sent"
        else:
            status = "created"
        history.append({"id": link["id"], "status": status, "created_at": link["created_at"],
                        "expires_at": link["expires_at"], "created_by": link.get("created_by", ""),
                        "whatsapp_opened_at": link.get("whatsapp_opened_at"), "sent_at": link.get("sent_at"),
                        "sent_by": link.get("sent_by"), "opened_at": link.get("opened_at"),
                        "signed_at": signed.get("signed_at") if signed else None,
                        "signed_version": signed.get("version") if signed else None})
    return history


async def public_link(token: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,80}", token):
        raise HTTPException(status_code=404, detail="الرابط غير صالح")
    link = await db.invoice_consent_links.find_one({"token_hash": link_hash(token)}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="الرابط غير صالح")
    invoice = await db.invoices.find_one({"id": link["invoice_id"]}, {"_id": 0})
    if not invoice or invoice.get("status") in {"cancelled", "canceled", "void"}:
        raise HTTPException(status_code=410, detail="أُلغيت الفاتورة")
    if datetime.fromisoformat(link["expires_at"]) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="انتهت صلاحية الرابط")
    if link["invoice_hash"] != snapshot_hash(invoice_snapshot(invoice)):
        raise HTTPException(status_code=410, detail="تغيّرت بيانات الفاتورة؛ اطلب رابطًا جديدًا")
    settings = await current_terms(consent_form_type(invoice))
    if link["terms_version"] != settings["version"]:
        raise HTTPException(status_code=410, detail="تغيّرت بنود الاستمارة؛ اطلب رابطًا جديدًا")
    signed = await db.invoice_consents.find_one({"invoice_id": invoice["id"], "invoice_hash": link["invoice_hash"], "terms_version": link["terms_version"]}, {"_id": 0})
    return link, invoice, settings, signed


@router.post("/{invoice_id}/registration-consent-link")
async def create_registration_consent_link(invoice_id: str, user: dict = Depends(get_current_user)):
    await require_permission(user, "invoices")
    invoice = await scoped_invoice(invoice_id, user)
    if invoice.get("status") in {"cancelled", "canceled", "void"}:
        raise HTTPException(status_code=409, detail="لا يمكن إنشاء رابط لفاتورة ملغاة")
    if not has_activity(invoice):
        raise HTTPException(status_code=422, detail="الاستمارة متاحة لفواتير الأنشطة فقط")
    settings = await current_terms(consent_form_type(invoice))
    snapshot = invoice_snapshot(invoice)
    existing = await db.invoice_consents.find_one({"invoice_id": invoice_id, "invoice_hash": snapshot_hash(snapshot), "terms_version": settings["version"]}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="الاستمارة معتمدة بالفعل")
    token = secrets.token_urlsafe(32)
    created = datetime.now(timezone.utc)
    link_id = str(uuid.uuid4())
    await db.invoice_consent_links.insert_one({"id": link_id, "invoice_id": invoice_id, "branch_id": invoice.get("branch_id"),
        "token_hash": link_hash(token), "invoice_hash": snapshot_hash(snapshot), "terms_version": settings["version"],
        "created_at": created.isoformat(), "expires_at": (created + timedelta(days=7)).isoformat(),
        "created_by": user.get("username", "")})
    return {"id": link_id, "token": token, "expires_at": (created + timedelta(days=7)).isoformat(), "customer_phone": invoice.get("customer_phone", ""), "invoice_number": invoice.get("invoice_number", "")}


@router.get("/{invoice_id}/registration-consent-links")
async def get_registration_consent_links(invoice_id: str, user: dict = Depends(get_current_user)):
    await require_permission(user, "invoices")
    invoice = await scoped_invoice(invoice_id, user)
    return {"links": await link_history(invoice, await current_terms(consent_form_type(invoice)))}


@router.post("/{invoice_id}/registration-consent-links/{link_id}/whatsapp-opened")
async def mark_registration_consent_whatsapp_opened(invoice_id: str, link_id: str, user: dict = Depends(get_current_user)):
    await require_permission(user, "invoices")
    await scoped_invoice(invoice_id, user)
    link = await db.invoice_consent_links.find_one({"id": link_id, "invoice_id": invoice_id}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="الرابط غير موجود")
    if not link.get("whatsapp_opened_at"):
        await db.invoice_consent_links.update_one({"id": link_id, "invoice_id": invoice_id}, {"$set": {
            "whatsapp_opened_at": datetime.now(timezone.utc).isoformat(), "whatsapp_opened_by": user.get("username", "")}})
    return {"ok": True}


@router.post("/{invoice_id}/registration-consent-links/{link_id}/sent")
async def mark_registration_consent_sent(invoice_id: str, link_id: str, user: dict = Depends(get_current_user)):
    await require_permission(user, "invoices")
    await scoped_invoice(invoice_id, user)
    link = await db.invoice_consent_links.find_one({"id": link_id, "invoice_id": invoice_id}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="الرابط غير موجود")
    if not link.get("sent_at"):
        await db.invoice_consent_links.update_one({"id": link_id, "invoice_id": invoice_id, "sent_at": {"$exists": False}}, {"$set": {
            "sent_at": datetime.now(timezone.utc).isoformat(), "sent_by": user.get("username", "")}})
    return {"ok": True}


@router.get("/public/registration-consent/{token}")
async def get_public_registration_consent(token: str):
    link, invoice, settings, signed = await public_link(token)
    if not link.get("opened_at"):
        await db.invoice_consent_links.update_one({"id": link["id"], "opened_at": {"$exists": False}}, {"$set": {
            "opened_at": datetime.now(timezone.utc).isoformat()}})
    snapshot = invoice_snapshot(invoice)
    guardian_name = (invoice.get("guardian_name_ar") or invoice.get("guardian_name") or "").strip()
    if not guardian_name and invoice.get("member_id"):
        member = await db.members.find_one(
            {"id": invoice["member_id"]},
            {"guardian_name_ar": 1, "guardian_name": 1, "_id": 0},
        )
        if member:
            guardian_name = (member.get("guardian_name_ar") or member.get("guardian_name") or "").strip()
    return {"status": "signed" if signed else "pending", "invoice": snapshot,
            "guardian_name": guardian_name,
            "invoice_hash": link["invoice_hash"], "terms_version": link["terms_version"],
            "title": settings["title"], "title_en": settings["title_en"],
            "company_name": settings["company_name"], "company_name_en": settings["company_name_en"],
            "terms": settings["terms"], "declaration": settings["declaration"], "declaration_en": settings["declaration_en"],
            "expires_at": link["expires_at"]}


@router.post("/public/registration-consent/{token}")
async def sign_public_registration_consent(token: str, payload: ConsentInput):
    link, invoice, _settings, signed = await public_link(token)
    if signed:
        raise HTTPException(status_code=409, detail="تم اعتماد الاستمارة بالفعل")
    if payload.expected_invoice_hash != link["invoice_hash"] or payload.expected_terms_version != link["terms_version"]:
        raise HTTPException(status_code=409, detail="تغيّرت الاستمارة؛ أعد فتح الرابط")
    result = await sign_registration_consent(invoice["id"], payload, {"is_admin": True, "username": "ولي الأمر عبر الرابط"})
    return {"status": "signed", "signed_at": result["signed_at"], "version": result["version"]}


@router.get("/public/registration-consent/{token}/pdf")
async def download_public_registration_consent_pdf(token: str):
    _link, invoice, _settings, signed = await public_link(token)
    if not signed:
        raise HTTPException(status_code=404, detail="لم تُوقَّع الاستمارة بعد")
    number = re.sub(r"[^A-Za-z0-9_-]", "", str(invoice.get("invoice_number") or invoice["id"]))
    return StreamingResponse(render_signed_consent_pdf(signed), media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="signed-consent-{number}.pdf"',
        "Cache-Control": "no-store",
    })


@router.get("/{invoice_id}/registration-consent")
async def get_registration_consent(invoice_id: str, user: dict = Depends(get_current_user)):
    invoice = await scoped_invoice(invoice_id, user)
    settings = await current_terms(consent_form_type(invoice))
    latest = await db.invoice_consents.find_one({"invoice_id": invoice_id}, {"_id": 0}, sort=[("version", -1)])
    family = await db.family_consents.find_one({"invoice_ids": invoice_id}, {"_id": 0}, sort=[("signed_at", -1)])
    if family and (not latest or family.get("signed_at", "") > latest.get("signed_at", "")):
        latest = family
    else:
        family = None
    snapshot = invoice_snapshot(invoice)
    family_current = bool(family and any(row.get("id") == invoice_id and snapshot_hash(row) == snapshot_hash(snapshot) for row in family.get("invoice_snapshots", [])) and family.get("terms_version") == (await current_terms(family.get("form_type", "swimming")))["version"])
    return {"invoice": snapshot, "invoice_hash": snapshot_hash(snapshot), "terms_version": settings["version"],
            "form_type": consent_form_type(invoice),
            "title": settings["title"], "title_en": settings["title_en"],
            "company_name": settings["company_name"], "company_name_en": settings["company_name_en"],
            "terms": settings["terms"], "declaration": settings["declaration"], "declaration_en": settings["declaration_en"], "signed": latest,
            "family_signed": bool(family),
            "needs_resign": bool(latest and (not family_current if family else (latest.get("invoice_hash") != snapshot_hash(snapshot) or latest.get("terms_version") != settings["version"])))}


@router.get("/{invoice_id}/registration-consent/pdf")
async def download_registration_consent_pdf(invoice_id: str, version: Optional[int] = None, user: dict = Depends(get_current_user)):
    await require_permission(user, "invoices")
    await scoped_invoice(invoice_id, user)
    if version is not None and version < 1:
        raise HTTPException(status_code=422, detail="رقم النسخة غير صالح")
    query = {"invoice_id": invoice_id}
    if version is not None:
        query["version"] = version
    signed = await db.invoice_consents.find_one(query, {"_id": 0}, sort=[("version", -1)])
    if version is None:
        family = await db.family_consents.find_one({"invoice_ids": invoice_id}, {"_id": 0}, sort=[("signed_at", -1)])
        if family and (not signed or family.get("signed_at", "") > signed.get("signed_at", "")):
            signed = family
    if not signed:
        raise HTTPException(status_code=404, detail="لا توجد استمارة موقّعة لهذه الفاتورة")
    pdf = render_signed_consent_pdf(signed)
    number = re.sub(r"[^A-Za-z0-9_-]", "", str(signed.get("invoice_snapshot", {}).get("invoice_number") or invoice_id))
    return StreamingResponse(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="signed-consent-{number}' + (f'-v{version}' if version is not None else '') + '.pdf"',
        "Cache-Control": "no-store",
    })


@router.get("/{invoice_id}/registration-consent/history")
async def get_registration_consent_history(invoice_id: str, user: dict = Depends(get_current_user)):
    await require_permission(user, "invoices")
    await scoped_invoice(invoice_id, user)
    rows = await db.invoice_consents.find({"invoice_id": invoice_id}, {"_id": 0, "signature_png": 0}).sort("version", -1).to_list(100)
    return {"versions": [{"version": row["version"], "signed_at": row.get("signed_at"),
             "signer_name": row.get("signer_name"), "recorded_by": row.get("recorded_by"),
             "terms_version": row.get("terms_version"), "invoice_hash": row.get("invoice_hash")}
            for row in rows]}


@router.post("/{invoice_id}/registration-consent")
async def sign_registration_consent(invoice_id: str, payload: ConsentInput, user: dict = Depends(get_current_user)):
    invoice = await scoped_invoice(invoice_id, user)
    settings = await current_terms(consent_form_type(invoice))
    if invoice.get("status") == "cancelled":
        raise HTTPException(status_code=409, detail="Cannot sign a cancelled invoice")
    if not has_activity(invoice):
        raise HTTPException(status_code=422, detail="This form applies to activity invoices")
    if not payload.accepted:
        raise HTTPException(status_code=422, detail="Terms must be accepted")
    if payload.has_medical_condition and not payload.medical_details.strip():
        raise HTTPException(status_code=422, detail="Medical details are required")
    match = re.fullmatch(r"data:image/png;base64,([A-Za-z0-9+/=]+)", payload.signature_png)
    if not match:
        raise HTTPException(status_code=422, detail="Invalid signature format")
    try:
        raw = base64.b64decode(match.group(1), validate=True)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid signature image")
    if len(raw) > 250000 or not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=422, detail="Invalid signature image")
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != "PNG" or image.width < 100 or image.height < 40 or image.width * image.height > 2_000_000:
                raise ValueError("Invalid dimensions")
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=422, detail="Invalid signature image")
    snapshot = invoice_snapshot(invoice)
    if payload.expected_invoice_hash != snapshot_hash(snapshot):
        raise HTTPException(status_code=409, detail="Invoice changed; review the form again before signing")
    if payload.expected_terms_version != settings["version"]:
        raise HTTPException(status_code=409, detail="Form terms changed; review them again before signing")
    latest = await db.invoice_consents.find_one({"invoice_id": invoice_id}, {"_id": 0}, sort=[("version", -1)])
    if latest and latest.get("invoice_hash") == snapshot_hash(snapshot) and latest.get("terms_version") == settings["version"]:
        raise HTTPException(status_code=409, detail="This invoice already has a signed form")
    version = (latest or {}).get("version", 0) + 1
    doc = {"_id": f"{invoice_id}:{version}", "id": str(uuid.uuid4()), "invoice_id": invoice_id, "branch_id": invoice.get("branch_id"),
           "version": version, "invoice_snapshot": copy.deepcopy(snapshot),
           "invoice_hash": snapshot_hash(snapshot), "terms_version": settings["version"], "title": settings["title"], "title_en": settings["title_en"],
           "company_name": settings["company_name"], "company_name_en": settings["company_name_en"], "terms": copy.deepcopy(settings["terms"]),
           "declaration": settings["declaration"], "declaration_en": settings["declaration_en"], "fields": payload.model_dump(exclude={"signature_png", "accepted", "expected_invoice_hash", "expected_terms_version"}),
           "signer_name": payload.signer_name, "signature_png": payload.signature_png,
           "signed_at": datetime.now(timezone.utc).isoformat(), "recorded_by": user.get("username", "")}
    try:
        await db.invoice_consents.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Form was signed concurrently; reload it")
    doc.pop("_id", None)
    return doc
