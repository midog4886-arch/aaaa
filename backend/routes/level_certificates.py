"""Certificates for approved, upward level transfers.

The transfer audit is the source of truth. Merely moving a member never issues
a certificate; a scoped staff member must explicitly approve the achievement.
"""
from datetime import datetime, timezone
import hashlib
import hmac
import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from database import JWT_SECRET, db
from routes.member_portal import get_current_member
from utils.auth import get_current_user, require_branch_scope, require_permission


router = APIRouter(prefix="/level-certificates", tags=["Level certificates"])

_SEAL_FIELDS = ("id", "transfer_audit_id", "member_id", "member_name",
                "member_name_en", "branch_id", "activity_name", "from_level_number",
                "to_level_number", "issued_at", "issued_by")


def _seal(doc):
    message = json.dumps({key: doc.get(key) for key in _SEAL_FIELDS},
                         ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hmac.new(JWT_SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()


def _seal_valid(doc):
    return bool(doc.get("seal_signature")) and hmac.compare_digest(
        doc["seal_signature"], _seal(doc))


class IssueCertificate(BaseModel):
    transfer_audit_id: str
    member_name_en: str = Field(min_length=2, max_length=120)

    @field_validator("member_name_en")
    @classmethod
    def english_name_only(cls, value):
        name = value.strip()
        if not name or any("\u0600" <= ch <= "\u06ff" for ch in name):
            raise ValueError("أدخل اسم اللاعب بالإنجليزية")
        return name


def _public_certificate(doc):
    result = {key: doc.get(key) for key in (
        "id", "member_name", "member_name_en", "activity_name", "from_level_name",
        "to_level_name", "from_level_number", "to_level_number",
        "issued_at", "issued_by_name", "branch_id", "status",
    )}
    result["seal_valid"] = _seal_valid(doc)
    return result


def _scoped_member(user, member):
    branch = member.get("branch_id")
    if not branch:
        raise HTTPException(409, "فرع العضو غير محدد")
    active_branch = require_branch_scope(user)
    if not user.get("is_admin") and branch != active_branch:
        raise HTTPException(403, "لا يمكن إصدار شهادة لفرع آخر")
    return branch


@router.get("/candidates/{member_id}")
async def certificate_candidates(member_id: str, user: dict = Depends(get_current_user)):
    """Show eligible transfers without changing state."""
    await require_permission(user, "levels")
    member = await db.members.find_one({"id": member_id}, {"_id": 0})
    if not member:
        raise HTTPException(404, "العضو غير موجود")
    branch = _scoped_member(user, member)
    audits = await db.audit_logs.find({
        "action": "level.transfer_member", "entity_id": member_id,
        "branch_id": branch,
    }, {"_id": 0}).sort("created_at", -1).to_list(100)
    ids = {x.get("level_id") for row in audits for x in
           (row.get("before") or {}, row.get("after") or {}) if x.get("level_id")}
    levels = await db.levels.find({"id": {"$in": list(ids)}}, {"_id": 0}).to_list(200)
    by_id = {level["id"]: level for level in levels}
    issued = await db.level_certificates.find({"member_id": member_id},
                                              {"_id": 0, "transfer_audit_id": 1, "id": 1}).to_list(100)
    issued_by_audit = {c["transfer_audit_id"]: c["id"] for c in issued}
    result = []
    for audit in audits:
        before, after = audit.get("before") or {}, audit.get("after") or {}
        source, target = by_id.get(before.get("level_id")), by_id.get(after.get("level_id"))
        if not source or not target or before.get("activity_id") != after.get("activity_id"):
            continue
        if (target.get("level_number") or 0) <= (source.get("level_number") or 0):
            continue  # time-slot change, lateral move or demotion is not an achievement
        if any(l.get("branch_id") not in (None, "", branch) for l in (source, target)):
            continue
        result.append({
            "transfer_audit_id": audit["id"], "created_at": audit.get("created_at"),
            "member_name": member.get("name_ar") or member.get("name"),
            "member_name_en": member.get("name") if (member.get("name") or "").isascii() else "",
            "activity_name": source.get("activity_name"),
            "from_level_name": source.get("custom_name") or source.get("activity_name"),
            "to_level_name": target.get("custom_name") or target.get("activity_name"),
            "from_level_number": source.get("level_number"),
            "to_level_number": target.get("level_number"),
            "certificate_id": issued_by_audit.get(audit["id"]),
        })
    return result


@router.post("")
async def issue_certificate(payload: IssueCertificate, user: dict = Depends(get_current_user)):
    await require_permission(user, "levels")
    audit = await db.audit_logs.find_one({
        "id": payload.transfer_audit_id, "action": "level.transfer_member",
    }, {"_id": 0})
    if not audit:
        raise HTTPException(404, "نقل المستوى غير موجود")
    member = await db.members.find_one({"id": audit.get("entity_id")}, {"_id": 0})
    if not member:
        raise HTTPException(404, "العضو غير موجود")
    branch = _scoped_member(user, member)
    if audit.get("branch_id") != branch:
        raise HTTPException(403, "نقل المستوى من فرع آخر")
    before, after = audit.get("before") or {}, audit.get("after") or {}
    source = await db.levels.find_one({"id": before.get("level_id")}, {"_id": 0})
    target = await db.levels.find_one({"id": after.get("level_id")}, {"_id": 0})
    if not source or not target or before.get("activity_id") != after.get("activity_id"):
        raise HTTPException(409, "بيانات النقل غير مكتملة")
    if (target.get("level_number") or 0) <= (source.get("level_number") or 0):
        raise HTTPException(409, "الشهادة متاحة فقط عند اجتياز مستوى أعلى")
    if any(l.get("branch_id") not in (None, "", branch) for l in (source, target)):
        raise HTTPException(403, "مستوى من فرع آخر")
    await db.level_certificates.create_index("transfer_audit_id", unique=True)
    existing = await db.level_certificates.find_one({"transfer_audit_id": audit["id"]}, {"_id": 0})
    if existing:
        return _public_certificate(existing)
    approver = await db.users.find_one({"id": user.get("user_id")}, {"_id": 0, "name": 1})
    doc = {
        "id": str(uuid4()), "transfer_audit_id": audit["id"],
        "member_id": member["id"], "member_name": member.get("name_ar") or member.get("name") or "",
        "member_name_en": payload.member_name_en,
        "branch_id": branch, "activity_name": source.get("activity_name") or "",
        "from_level_name": source.get("custom_name") or source.get("activity_name") or "",
        "to_level_name": target.get("custom_name") or target.get("activity_name") or "",
        "from_level_number": source.get("level_number"),
        "to_level_number": target.get("level_number"),
        "status": "issued",
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "issued_by": user.get("user_id"),
        "issued_by_name": (approver or {}).get("name") or "موظف الأكاديمية",
    }
    doc["seal_signature"] = _seal(doc)
    try:
        await db.level_certificates.insert_one(doc)
    except DuplicateKeyError:
        existing = await db.level_certificates.find_one({"transfer_audit_id": audit["id"]}, {"_id": 0})
        return _public_certificate(existing)
    return _public_certificate(doc)


@router.get("/member/mine")
async def member_certificates(member: dict = Depends(get_current_member)):
    ids = member.get("_linked_member_ids") or [member["id"]]
    docs = await db.level_certificates.find({"member_id": {"$in": ids}, "status": "issued"},
                                            {"_id": 0}).sort("issued_at", -1).to_list(100)
    return [_public_certificate(doc) for doc in docs]


@router.get("/verify/{certificate_id}")
async def verify_certificate(certificate_id: str):
    doc = await db.level_certificates.find_one({"id": certificate_id, "status": "issued"}, {"_id": 0})
    if not doc or not _seal_valid(doc):
        raise HTTPException(404, "الشهادة غير موجودة")
    return _public_certificate(doc)
