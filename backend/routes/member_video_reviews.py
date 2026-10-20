"""Private, coach-reviewed performance videos attached to member profiles."""

from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import jwt
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator

from database import JWT_ALGORITHM, JWT_SECRET, db, _raw_client
from routes.member_portal import get_current_member
from routes.members import _scoped_member_query
from utils.auth import get_current_user, require_any_permission, require_permission
from utils.performance_comparison import comparison_summary
from utils.tenant import DEFAULT_TENANT_SLUG, get_current_tenant_slug, slug_to_db_name


router = APIRouter(prefix="/member-video-reviews", tags=["member-video-reviews"])
MAX_VIDEO_BYTES = 200 * 1024 * 1024
MAX_MEMBER_VIDEOS = 20
STORAGE_ROOT = Path(os.environ.get("MEMBER_VIDEO_REVIEW_DIR") or Path(__file__).resolve().parents[1] / "uploads" / "member-video-reviews")


class Drawing(BaseModel):
    x1: float = Field(ge=0, le=1)
    y1: float = Field(ge=0, le=1)
    x2: float = Field(ge=0, le=1)
    y2: float = Field(ge=0, le=1)


class CorrectedPoint(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class Marker(BaseModel):
    id: str = Field(max_length=80)
    time: float = Field(ge=0, le=36000)
    label: str = Field(min_length=1, max_length=100)
    note: str = Field(default="", max_length=1000)
    drawing: Drawing | None = None
    share_with_parent: bool = False
    pose_metrics: dict[str, float] = Field(default_factory=dict, max_length=3)
    pose_side: Literal["left", "right"] | None = None
    corrected_points: dict[str, CorrectedPoint] = Field(default_factory=dict, max_length=12)

    @model_validator(mode="after")
    def valid_corrected_joints(self):
        if any(key not in {"11", "12", "13", "14", "15", "16", "23", "24", "25", "26", "27", "28"}
               for key in self.corrected_points):
            raise ValueError("تصحيح مفصل غير مدعوم")
        return self


Skill = Literal["general", "swimming_freestyle", "swimming_backstroke", "swimming_breaststroke",
                "swimming_butterfly", "football_shot", "football_pass", "football_dribble", "football_run"]


class AnalysisSample(BaseModel):
    time: float = Field(ge=0, le=36000)
    quality: Literal["valid", "unreliable", "lost"]
    seen: int = Field(ge=0, le=33)
    metrics: dict[str, float] = Field(default_factory=dict, max_length=3)
    source: Literal["ai", "coach"] = "ai"
    model: Literal["lite", "full", "heavy"] = "lite"


class Comparison(BaseModel):
    baseline_review_id: str = Field(min_length=1, max_length=80)
    current_event_time: float = Field(ge=0, le=36000)
    baseline_event_time: float = Field(ge=0, le=36000)
    coach_finding: str = Field(default="", max_length=1000)
    next_exercise: str = Field(default="", max_length=500)
    share_with_parent: bool = False


class ImprovementPriority(BaseModel):
    observed: str = Field(default="", max_length=300)
    target: str = Field(default="", max_length=300)
    priority: Literal["high", "medium", "low"] = "medium"
    exercise: str = Field(default="", max_length=300)
    marker_time: float | None = Field(default=None, ge=0, le=36000)


class CoachAssessment(BaseModel):
    strengths: str = Field(default="", max_length=1000)
    priorities: list[ImprovementPriority] = Field(default_factory=list, max_length=3)


class ReviewUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    sport: Literal["football", "swimming"] = "swimming"
    skill: Skill = "general"
    coach_summary: str = Field(default="", max_length=2000)
    parent_summary: str = Field(default="", max_length=2000)
    markers: list[Marker] = Field(default_factory=list, max_length=100)
    samples: list[AnalysisSample] = Field(default_factory=list, max_length=3000)
    comparison: Comparison | None = None
    assessment: CoachAssessment = Field(default_factory=CoachAssessment)

    @model_validator(mode="after")
    def skill_matches_sport(self):
        if self.skill != "general" and not self.skill.startswith(f"{self.sport}_"):
            raise ValueError("المهارة لا تتبع الرياضة المختارة")
        return self


class ReviewStatus(BaseModel):
    status: Literal["draft", "approved"]


class LocalReviewCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    sport: Literal["football", "swimming"] = "swimming"
    skill: Skill = "general"

    @model_validator(mode="after")
    def skill_matches_sport(self):
        if self.skill != "general" and not self.skill.startswith(f"{self.sport}_"):
            raise ValueError("المهارة لا تتبع الرياضة المختارة")
        return self


def _public_doc(doc: dict) -> dict:
    return {key: value for key, value in doc.items() if key not in {"_id", "storage_name"}}


async def _staff_member(member_id: str, user: dict, edit: bool = False):
    await require_permission(user, "members")
    if edit:
        await require_any_permission(user, ("members-edit", "coach-notes"))
    member = await db.members.find_one(_scoped_member_query(member_id, user), {"_id": 0, "id": 1, "branch_id": 1, "name": 1, "name_ar": 1})
    if not member:
        raise HTTPException(status_code=404, detail="العضو غير موجود في فرعك")
    return member


async def _staff_review(review_id: str, user: dict, edit: bool = False):
    doc = await db.member_video_reviews.find_one({"id": review_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="التحليل غير موجود")
    await _staff_member(doc["member_id"], user, edit)
    return doc


@router.get("/member/{member_id}")
async def list_member_reviews(member_id: str, user: dict = Depends(get_current_user)):
    await _staff_member(member_id, user)
    docs = await db.member_video_reviews.find({"member_id": member_id}, {"_id": 0, "storage_name": 0}).sort("created_at", -1).to_list(MAX_MEMBER_VIDEOS)
    return docs


@router.post("/member/{member_id}/local")
async def create_local_review(member_id: str, payload: LocalReviewCreate, user: dict = Depends(get_current_user)):
    """Store coach-authored results only; the source video never reaches this endpoint."""
    member = await _staff_member(member_id, user, edit=True)
    if await db.member_video_reviews.count_documents({"member_id": member_id}) >= MAX_MEMBER_VIDEOS:
        raise HTTPException(status_code=409, detail="وصل العضو إلى حد 20 تقريرًا؛ احذف تقريرًا قديمًا أولًا")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": uuid.uuid4().hex, "member_id": member_id,
        "member_name": member.get("name_ar") or member.get("name") or "",
        "branch_id": member.get("branch_id"), "tenant_slug": get_current_tenant_slug(),
        "video_mode": "local", "title": payload.title, "sport": payload.sport, "skill": payload.skill,
        "coach_summary": "", "parent_summary": "", "markers": [], "samples": [],
        "comparison": None, "assessment": {"strengths": "", "priorities": []}, "status": "draft", "created_at": now, "updated_at": now,
        "created_by": user.get("user_id"), "approved_at": None,
    }
    await db.member_video_reviews.insert_one(doc)
    return _public_doc(doc)


@router.post("/member/{member_id}/upload")
async def upload_member_review(member_id: str, file: UploadFile = File(...), sport: Literal["football", "swimming"] = Form("swimming"),
                               skill: Skill = Form("general"), user: dict = Depends(get_current_user)):
    member = await _staff_member(member_id, user, edit=True)
    if skill != "general" and not skill.startswith(f"{sport}_"):
        raise HTTPException(status_code=400, detail="المهارة لا تتبع الرياضة المختارة")
    if await db.member_video_reviews.count_documents({"member_id": member_id}) >= MAX_MEMBER_VIDEOS:
        raise HTTPException(status_code=409, detail="وصل العضو إلى حد 20 فيديو؛ احذف فيديو قديمًا أولًا")
    if not (file.filename or "").lower().endswith(".mp4"):
        raise HTTPException(status_code=400, detail="ارفع فيديو MP4 فقط")
    if file.size and file.size > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail="الحد الأقصى للفيديو 200 ميجابايت")
    header = await file.read(12)
    if len(header) < 12 or header[4:8] != b"ftyp":
        raise HTTPException(status_code=400, detail="ملف MP4 غير صالح")
    tenant = get_current_tenant_slug()
    folder = STORAGE_ROOT / tenant
    folder.mkdir(parents=True, exist_ok=True)
    storage_name = f"{uuid.uuid4().hex}.mp4"
    target = folder / storage_name
    total = len(header)
    try:
        with target.open("xb") as output:
            output.write(header)
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_VIDEO_BYTES:
                    raise HTTPException(status_code=413, detail="الحد الأقصى للفيديو 200 ميجابايت")
                output.write(chunk)
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": uuid.uuid4().hex, "member_id": member_id, "member_name": member.get("name_ar") or member.get("name") or "",
            "branch_id": member.get("branch_id"),
            "tenant_slug": tenant, "storage_name": storage_name, "size": total, "video_mode": "stored",
            "title": Path(file.filename).stem[:120] or "تحليل أداء", "sport": sport, "skill": skill,
            "coach_summary": "", "parent_summary": "",
            "markers": [], "samples": [], "comparison": None, "assessment": {"strengths": "", "priorities": []},
            "status": "draft", "created_at": now, "updated_at": now,
            "created_by": user.get("user_id"), "approved_at": None,
        }
        await db.member_video_reviews.insert_one(doc)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return _public_doc(doc)


@router.put("/{review_id}")
async def update_review(review_id: str, payload: ReviewUpdate, user: dict = Depends(get_current_user)):
    doc = await _staff_review(review_id, user, edit=True)
    if doc["status"] != "draft":
        raise HTTPException(status_code=409, detail="أعد التحليل إلى مسودة قبل التعديل")
    if payload.skill != "general" and not payload.skill.startswith(f"{payload.sport}_"):
        raise HTTPException(status_code=400, detail="المهارة لا تتبع الرياضة المختارة")
    if payload.comparison:
        if payload.comparison.baseline_review_id == review_id:
            raise HTTPException(status_code=400, detail="اختر فيديو سابقًا مختلفًا للمقارنة")
        baseline = await db.member_video_reviews.find_one({"id": payload.comparison.baseline_review_id,
                                                            "member_id": doc["member_id"]}, {"_id": 0})
        if not baseline or baseline.get("sport", "swimming") != payload.sport or baseline.get("skill", "general") != payload.skill:
            raise HTTPException(status_code=400, detail="المقارنة تتطلب نفس العضو والرياضة والمهارة")
    data = payload.model_dump()
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.member_video_reviews.update_one({"id": review_id, "status": "draft"}, {"$set": data})
    return {**_public_doc(doc), **data}


@router.put("/{review_id}/status")
async def set_review_status(review_id: str, payload: ReviewStatus, user: dict = Depends(get_current_user)):
    doc = await _staff_review(review_id, user, edit=True)
    if payload.status == "approved" and not doc.get("parent_summary", "").strip():
        raise HTTPException(status_code=400, detail="اكتب ملخص ولي الأمر قبل الاعتماد")
    assessment = doc.get("assessment") or {}
    if payload.status == "approved" and doc.get("sport") == "swimming" and assessment.get("priorities"):
        if any(not row.get("observed", "").strip() or not row.get("target", "").strip()
               or not row.get("exercise", "").strip()
               for row in assessment["priorities"]):
            raise HTTPException(status_code=400, detail="أكمل الملاحظة والهدف والتمرين لكل تحسين قبل الاعتماد")
    comparison = doc.get("comparison")
    if payload.status == "approved" and comparison and comparison.get("share_with_parent"):
        baseline = await db.member_video_reviews.find_one({"id": comparison["baseline_review_id"],
                                                            "member_id": doc["member_id"], "status": "approved"}, {"_id": 0})
        if not baseline:
            raise HTTPException(status_code=400, detail="اعتمد فيديو المقارنة السابق أولًا")
        if baseline.get("sport", "swimming") != doc.get("sport", "swimming") or baseline.get("skill", "general") != doc.get("skill", "general"):
            raise HTTPException(status_code=400, detail="المقارنة تتطلب نفس الرياضة والمهارة")
        if not comparison.get("coach_finding", "").strip() or not comparison.get("next_exercise", "").strip():
            raise HTTPException(status_code=400, detail="أكمل نتيجة المقارنة والتمرين التالي")
        if not comparison_summary(doc, baseline, comparison)["usable"]:
            raise HTTPException(status_code=400, detail="تتبّع اللاعب غير كافٍ حول لحظتي المقارنة؛ لا يمكن مشاركة أرقام غير موثوقة")
    now = datetime.now(timezone.utc).isoformat()
    changes = {"status": payload.status, "updated_at": now, "approved_at": now if payload.status == "approved" else None,
               "approved_by": user.get("user_id") if payload.status == "approved" else None}
    await db.member_video_reviews.update_one({"id": review_id}, {"$set": changes})
    return {**_public_doc(doc), **changes}


@router.delete("/{review_id}")
async def delete_review(review_id: str, user: dict = Depends(get_current_user)):
    doc = await _staff_review(review_id, user, edit=True)
    await db.member_video_reviews.delete_one({"id": review_id})
    if doc.get("storage_name"):
        (STORAGE_ROOT / doc["tenant_slug"] / doc["storage_name"]).unlink(missing_ok=True)
    return {"deleted": True}


@router.get("/portal/approved")
async def portal_reviews(member: dict = Depends(get_current_member)):
    ids = member.get("_linked_member_ids", [member["id"]])
    docs = await db.member_video_reviews.find({"member_id": {"$in": ids}, "status": "approved"},
                                               {"_id": 0}).sort("approved_at", -1).to_list(30)
    approved_by_id = {doc["id"]: doc for doc in docs}
    result = []
    for doc in docs:
        item = {
            "id": doc["id"], "member_id": doc["member_id"], "member_name": doc.get("member_name", ""),
            "title": doc.get("title", ""), "parent_summary": doc.get("parent_summary", ""),
            "assessment": doc.get("assessment", {"strengths": "", "priorities": []}),
            "sport": doc.get("sport", "swimming"), "skill": doc.get("skill", "general"),
            "has_video": bool(doc.get("storage_name")),
            "approved_at": doc.get("approved_at"),
            "markers": [{**{key: value for key, value in marker.items() if key != "corrected_points"},
                         "coach_corrected": bool(marker.get("corrected_points"))}
                        for marker in doc.get("markers", []) if marker.get("share_with_parent")],
        }
        comparison = doc.get("comparison")
        baseline = approved_by_id.get(comparison.get("baseline_review_id")) if comparison else None
        if comparison and not baseline and comparison.get("share_with_parent"):
            baseline = await db.member_video_reviews.find_one({"id": comparison["baseline_review_id"],
                                                                 "member_id": doc["member_id"], "status": "approved"}, {"_id": 0})
        if (baseline and baseline.get("member_id") == doc["member_id"]
                and baseline.get("sport", "swimming") == doc.get("sport", "swimming")
                and baseline.get("skill", "general") == doc.get("skill", "general")
                and comparison.get("share_with_parent")):
            summary = comparison_summary(doc, baseline, comparison)
            if summary["usable"]:
                item["comparison"] = {"baseline_review_id": baseline["id"],
                                      "baseline_has_video": bool(baseline.get("storage_name")),
                                      "coach_finding": comparison.get("coach_finding", ""),
                                      "next_exercise": comparison.get("next_exercise", ""),
                                      "current_event_time": comparison["current_event_time"],
                                      "baseline_event_time": comparison["baseline_event_time"],
                                      "summary": summary}
        result.append(item)
    return result


@router.get("/{review_id}/play-ticket")
async def play_ticket(review_id: str, user: dict = Depends(get_current_user)):
    doc = await _staff_review(review_id, user)
    if not doc.get("storage_name"):
        raise HTTPException(status_code=404, detail="الفيديو محفوظ على جهاز المدرب فقط")
    token = jwt.encode({"review_id": doc["id"], "tenant_slug": get_current_tenant_slug(), "scope": "staff",
                        "aud": "member-video-review", "exp": datetime.now(timezone.utc) + timedelta(minutes=30)},
                       JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {"url": f"/api/member-video-reviews/stream/{token}"}


@router.get("/portal/{review_id}/play-ticket")
async def portal_play_ticket(review_id: str, member: dict = Depends(get_current_member)):
    doc = await db.member_video_reviews.find_one({"id": review_id, "status": "approved",
                                                   "member_id": {"$in": member.get("_linked_member_ids", [member["id"]])}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="الفيديو غير متاح")
    if not doc.get("storage_name"):
        raise HTTPException(status_code=404, detail="التقرير لا يتضمن فيديو منشورًا")
    token = jwt.encode({"review_id": doc["id"], "tenant_slug": get_current_tenant_slug(), "scope": "parent",
                        "aud": "member-video-review", "exp": datetime.now(timezone.utc) + timedelta(minutes=30)},
                       JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {"url": f"/api/member-video-reviews/stream/{token}"}


@router.get("/stream/{token}")
async def stream_review(token: str):
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], audience="member-video-review")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="انتهت صلاحية رابط الفيديو")
    slug = claims.get("tenant_slug") or ""
    if not re.fullmatch(r"[a-z0-9_-]{1,64}", slug):
        raise HTTPException(status_code=403, detail="رابط الفيديو غير صالح")
    db_name = slug_to_db_name(slug)
    if slug != DEFAULT_TENANT_SLUG:
        from control_db import get_tenant_by_slug
        tenant = await get_tenant_by_slug(slug)
        if not tenant or tenant.get("status") in ("suspended", "deleted", "inactive", "pending_approval", "rejected"):
            raise HTTPException(status_code=403, detail="الأكاديمية غير متاحة")
        db_name = tenant.get("db_name") or db_name
    doc = await _raw_client[db_name].member_video_reviews.find_one({"id": claims.get("review_id")}, {"_id": 0})
    if not doc or doc.get("tenant_slug") != slug or (claims.get("scope") == "parent" and doc.get("status") != "approved"):
        raise HTTPException(status_code=404, detail="الفيديو غير موجود")
    if claims.get("scope") not in ("staff", "parent"):
        raise HTTPException(status_code=403, detail="رابط الفيديو غير صالح")
    path = STORAGE_ROOT / doc["tenant_slug"] / doc["storage_name"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="ملف الفيديو غير موجود على الخادم")
    return FileResponse(path, media_type="video/mp4", headers={"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer"})
