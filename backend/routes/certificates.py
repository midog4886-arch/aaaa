"""Manual certificates with optional member linkage, independent of levels."""
from datetime import datetime, timezone
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from database import db
from utils.auth import get_current_user, require_permission, resolve_branch_filter

router = APIRouter(prefix="/certificates", tags=["Certificates"])


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
    return await db.certificates.find({}, {"_id": 0}).sort("issued_at", -1).to_list(500)


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
    member = None
    if payload.member_id:
        query = {"id": payload.member_id}
        branch_id = resolve_branch_filter(user, payload.branch_filter)
        if not branch_id:
            raise HTTPException(status_code=400, detail="اختر الفرع أولاً لربط الشهادة بعضو")
        query["branch_id"] = branch_id
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
    }
    if member:
        doc["member_id"] = member["id"]
        doc["member_code"] = member.get("member_code") or ""
    await db.certificates.insert_one(doc)
    doc.pop("_id", None)
    return doc
