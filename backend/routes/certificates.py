"""Manual certificates, independent of members, activities and levels."""
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from database import db
from utils.auth import get_current_user, require_permission

router = APIRouter(prefix="/certificates", tags=["Certificates"])


class IssueCertificate(BaseModel):
    student_name_ar: str = Field(min_length=2, max_length=120)
    student_name_en: str = Field(min_length=2, max_length=120)

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


@router.post("", status_code=201)
async def issue_certificate(payload: IssueCertificate, user: dict = Depends(get_current_user)):
    await require_permission(user, "certificates")
    doc = {
        "id": str(uuid4()),
        "student_name_ar": payload.student_name_ar,
        "student_name_en": payload.student_name_en,
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "issued_by": user.get("user_id"),
        "issued_by_name": user.get("username") or user.get("name") or "",
    }
    await db.certificates.insert_one(doc)
    doc.pop("_id", None)
    return doc
