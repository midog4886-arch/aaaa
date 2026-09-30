"""Manual certificates with optional member linkage, independent of levels."""
from datetime import datetime, timezone
import base64
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from database import db
from utils.auth import get_current_user, require_permission, resolve_branch_filter
from routes.member_portal import get_current_member
from utils.certificate_artwork import POSITION_RANGES, branch_artwork, store_artwork_image

router = APIRouter(prefix="/certificates", tags=["Certificates"])


def _certificate_branch(user, requested):
    branch_id = resolve_branch_filter(user, requested)
    if not branch_id:
        raise HTTPException(status_code=400, detail="اختر الفرع أولاً لإصدار الشهادة")
    return branch_id


@router.get("/branch-artwork")
async def get_branch_artwork(branch_filter: str | None = None, user: dict = Depends(get_current_user)):
    return await branch_artwork(db, _certificate_branch(user, branch_filter))


@router.post("/branch-artwork/{branch_id}/{kind}")
async def upload_branch_artwork(branch_id: str, kind: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "تعديل تصميم الشهادة متاح للمدير فقط")
    if kind not in {"design", "stamp"}:
        raise HTTPException(400, "نوع صورة الشهادة غير صالح")
    if not await db.branches.find_one({"id": branch_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "الفرع غير موجود")
    asset_id = await store_artwork_image(db, file, kind)
    await db.certificate_artwork_settings.update_one(
        {"branch_id": branch_id},
        {"$set": {f"{kind}_id": asset_id, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return await branch_artwork(db, branch_id)


class ArtworkLayout(BaseModel):
    name_top: float = 55.2
    name_left: float = 23.0
    name_width: float = 54.0
    date_top: float = 79.5
    date_left: float = 24.0
    date_width: float = 15.5
    stamp_left: float = 65.0
    stamp_top: float = 77.0
    stamp_width: float = 16.0


@router.put("/branch-artwork/{branch_id}/layout")
async def update_branch_artwork_layout(branch_id: str, layout: ArtworkLayout, user: dict = Depends(get_current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "تعديل تصميم الشهادة متاح للمدير فقط")
    if not await db.branches.find_one({"id": branch_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "الفرع غير موجود")
    values = layout.model_dump()
    if any(not low <= values[key] <= high for key, (low, high) in POSITION_RANGES.items()):
        raise HTTPException(400, "مواضع الشهادة خارج النطاق المسموح")
    if any(values[left] + values[width] > 100 for left, width in (
        ("name_left", "name_width"), ("date_left", "date_width"), ("stamp_left", "stamp_width"),
    )):
        raise HTTPException(400, "العنصر يتجاوز حافة الشهادة")
    await db.certificate_artwork_settings.update_one(
        {"branch_id": branch_id}, {"$set": {**values, "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True,
    )
    return await branch_artwork(db, branch_id)


@router.delete("/branch-artwork/{branch_id}/{kind}")
async def clear_branch_artwork(branch_id: str, kind: str, user: dict = Depends(get_current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "تعديل تصميم الشهادة متاح للمدير فقط")
    if kind not in {"design", "stamp"}:
        raise HTTPException(400, "نوع صورة الشهادة غير صالح")
    if not await db.branches.find_one({"id": branch_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "الفرع غير موجود")
    await db.certificate_artwork_settings.update_one(
        {"branch_id": branch_id}, {"$set": {f"{kind}_id": None}}, upsert=True,
    )
    return await branch_artwork(db, branch_id)


@router.get("/artwork/{asset_id}")
async def get_artwork_asset(asset_id: str):
    if not re.fullmatch(r"[0-9a-f]{64}", asset_id):
        raise HTTPException(404, "الصورة غير موجودة")
    asset = await db.certificate_artwork_assets.find_one({"id": asset_id}, {"_id": 0})
    if not asset:
        raise HTTPException(404, "الصورة غير موجودة")
    return Response(content=base64.b64decode(asset["data"]), media_type=asset["content_type"], headers={"Cache-Control": "public, max-age=31536000, immutable"})


class IssueCertificate(BaseModel):
    student_name_ar: str = Field(min_length=2, max_length=120)
    student_name_en: str = Field(min_length=2, max_length=120)
    member_id: str | None = None
    branch_filter: str | None = None

    @field_validator("student_name_ar")
    @classmethod
    def arabic_name(cls, value):
        value = " ".join(value.split())
        if not any("\u0600" <= char <= "\u06ff" for char in value):
            raise ValueError("أدخل الاسم بالعربية")
        return value

    @field_validator("student_name_en")
    @classmethod
    def english_name(cls, value):
        value = " ".join(value.split())
        if not any("A" <= char <= "Z" or "a" <= char <= "z" for char in value) or any("\u0600" <= char <= "\u06ff" for char in value):
            raise ValueError("أدخل الاسم بالإنجليزية")
        return value


@router.get("")
async def list_certificates(user: dict = Depends(get_current_user)):
    await require_permission(user, "certificates")
    branch_id = resolve_branch_filter(user)
    return await db.certificates.find({"branch_id": branch_id} if branch_id else {}, {"_id": 0}).sort("issued_at", -1).to_list(500)


@router.get("/member-search")
async def search_certificate_members(search: str = Query(min_length=2, max_length=80), branch_filter: str | None = None, user: dict = Depends(get_current_user)):
    await require_permission(user, "certificates")
    query = {"$or": [
        {field: {"$regex": re.escape(search.strip()), "$options": "i"}}
        for field in ("name_ar", "name", "member_code", "phone")
    ]}
    branch_id = resolve_branch_filter(user, branch_filter)
    if not branch_id:
        raise HTTPException(status_code=400, detail="اختر الفرع أولاً للبحث عن عضو")
    query["branch_id"] = branch_id
    return await db.members.find(query, {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "member_code": 1}).limit(20).to_list(20)


@router.post("", status_code=201)
async def issue_certificate(payload: IssueCertificate, user: dict = Depends(get_current_user)):
    await require_permission(user, "certificates")
    branch_id = _certificate_branch(user, payload.branch_filter)
    if not await db.branches.find_one({"id": branch_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "الفرع غير موجود")
    member = None
    if payload.member_id:
        query = {"id": payload.member_id, "branch_id": branch_id}
        member = await db.members.find_one(query, {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "member_code": 1})
        if not member:
            raise HTTPException(status_code=404, detail="العضو المحدد غير موجود أو خارج نطاق الفرع")
    doc = {
        "id": str(uuid4()),
        "student_name_ar": payload.student_name_ar,
        "student_name_en": payload.student_name_en,
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "issued_by": user.get("user_id"),
        "issued_by_name": user.get("username") or user.get("name") or "",
        "branch_id": branch_id,
        "artwork": await branch_artwork(db, branch_id),
    }
    if member:
        doc["member_id"] = member["id"]
        doc["member_code"] = member.get("member_code") or ""
    await db.certificates.insert_one(doc)
    doc.pop("_id", None)
    return doc


class LinkCertificate(BaseModel):
    member_id: str
    branch_filter: str | None = None


@router.patch("/{certificate_id}/member")
async def link_certificate_member(certificate_id: str, payload: LinkCertificate, user: dict = Depends(get_current_user)):
    await require_permission(user, "certificates")
    branch_id = resolve_branch_filter(user, payload.branch_filter)
    if not branch_id:
        raise HTTPException(status_code=400, detail="اختر الفرع أولاً لربط الشهادة بعضو")
    member = await db.members.find_one(
        {"id": payload.member_id, "branch_id": branch_id},
        {"_id": 0, "id": 1, "member_code": 1},
    )
    if not member:
        raise HTTPException(status_code=404, detail="العضو المحدد غير موجود أو خارج نطاق الفرع")
    certificate = await db.certificates.find_one({"id": certificate_id}, {"_id": 0})
    if not certificate:
        raise HTTPException(status_code=404, detail="الشهادة غير موجودة")
    if certificate.get("branch_id") and certificate["branch_id"] != branch_id:
        raise HTTPException(status_code=403, detail="الشهادة تابعة لفرع آخر")
    updates = {"member_id": member["id"], "member_code": member.get("member_code") or ""}
    if not certificate.get("branch_id"):
        updates["branch_id"] = branch_id
    changes = {"$set": updates}
    if certificate.get("member_id") and certificate["member_id"] != member["id"]:
        changes["$push"] = {"member_link_history": {
            "member_id": certificate["member_id"],
            "member_code": certificate.get("member_code") or "",
            "changed_at": datetime.now(timezone.utc).isoformat(),
            "changed_by": user.get("user_id"),
        }}
    await db.certificates.update_one(
        {"id": certificate_id}, changes,
    )
    return {**certificate, **updates}


@router.get("/member/mine")
async def member_certificates(member: dict = Depends(get_current_member)):
    ids = member.get("_linked_member_ids") or [member["id"]]
    return await db.certificates.find(
        {"member_id": {"$in": ids}}, {"_id": 0}
    ).sort("issued_at", -1).to_list(100)
