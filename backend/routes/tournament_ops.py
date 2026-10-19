"""Day-of-event operations for academy tournaments."""
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import db
from routes.tournaments import (
    Participant, _load_tournament_or_403, _notify_result, _record_notification_log, _resolve_member_name,
    add_participant, require_tournaments_permission,
)
from routes.member_portal import get_current_member
from utils.cache import cache_invalidate

router = APIRouter(prefix="/tournaments", tags=["Tournament operations"])


def now():
    return datetime.now(timezone.utc).isoformat()


class RegistrationSettings(BaseModel):
    registration_open: bool = False
    capacity: int = Field(default=0, ge=0, le=10000)


class RegistrationRequest(BaseModel):
    member_id: str
    activity_id: Optional[str] = None
    subcategory: Optional[str] = None


class CheckIn(BaseModel):
    member_id: str


class Match(BaseModel):
    id: Optional[str] = None
    team_a: str = Field(min_length=1, max_length=120)
    team_b: str = Field(min_length=1, max_length=120)
    start_time: str = Field(default="", max_length=40)
    field: str = Field(default="", max_length=80)
    status: Literal["scheduled", "live", "finished"] = "scheduled"
    score_a: Optional[int] = Field(default=None, ge=0, le=999)
    score_b: Optional[int] = Field(default=None, ge=0, le=999)


class MatchList(BaseModel):
    revision: int = Field(ge=0)
    matches: list[Match] = Field(max_length=300)


def summary(t):
    participants = t.get("participants") or []
    requests = t.get("registration_requests") or []
    checked = t.get("tournament_checkins") or []
    matches = (t.get("match_board") or {}).get("matches") or []
    meet = t.get("swimming_meet") or {}
    entries = meet.get("entries") or []
    return {
        "participants": len(participants),
        "checked_in": len(checked),
        "pending_registrations": sum(r.get("status") == "pending" for r in requests),
        "waitlisted": sum(r.get("status") == "waitlisted" for r in requests),
        "matches_unscheduled": sum(not m.get("start_time") for m in matches),
        "matches_live": sum(m.get("status") == "live" for m in matches),
        "results_pending": (sum(bool(p.get("position")) for p in participants) + sum(m.get("status") == "finished" for m in matches)) if not t.get("results_approved", True) else 0,
        "swimming_unassigned": sum(not e.get("heat") or not e.get("lane") for e in entries),
        "swimming_pending": sum(e.get("status") == "pending" for e in entries),
        "swimming_approved": bool(meet.get("approved")),
    }


@router.get("/{tid}/operations")
async def get_operations(tid: str, user=Depends(require_tournaments_permission)):
    t = await _load_tournament_or_403(tid, user)
    return {
        "summary": summary(t),
        "registration_open": bool(t.get("registration_open")),
        "capacity": t.get("registration_capacity") or 0,
        "requests": t.get("registration_requests") or [],
        "checkins": t.get("tournament_checkins") or [],
        "match_board": t.get("match_board") or {"revision": 0, "matches": []},
        "results_approved": t.get("results_approved", True),
    }


@router.put("/{tid}/operations/registration")
async def configure_registration(tid: str, payload: RegistrationSettings, user=Depends(require_tournaments_permission)):
    await _load_tournament_or_403(tid, user)
    await db.tournaments.update_one({"id": tid}, {"$set": {
        "registration_open": payload.registration_open,
        "registration_capacity": payload.capacity,
        "updated_at": now(),
    }})
    return {"registration_open": payload.registration_open, "capacity": payload.capacity}


@router.get("/member/open")
async def open_for_member(member=Depends(get_current_member)):
    linked = set(member.get("_linked_member_ids") or [member["id"]])
    members = await db.members.find({"id": {"$in": list(linked)}}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "branch_id": 1}).to_list(50)
    branches = {m.get("branch_id") for m in members if m.get("branch_id")}
    query = {"registration_open": True, "status": {"$ne": "completed"}}
    if branches:
        query["$or"] = [{"branch_id": {"$in": list(branches)}}, {"branch_id": None}]
    else:
        query["branch_id"] = None
    tournaments = await db.tournaments.find(query, {"_id": 0, "id": 1, "name": 1, "date": 1, "place": 1, "activity_name": 1, "branch_id": 1, "subcategories": 1, "registration_requests": 1, "participants": 1}).sort("date", 1).to_list(100)
    result = []
    for t in tournaments:
        result.append({
            "id": t["id"], "name": t.get("name"), "date": t.get("date"),
            "place": t.get("place"), "activity_name": t.get("activity_name"),
            "subcategories": t.get("subcategories") or [],
            "members": [{"id": m["id"], "name": m.get("name_ar") or m.get("name") or "", "status": next((r.get("status") for r in t.get("registration_requests") or [] if r.get("member_id") == m["id"]), "registered" if any(p.get("member_id") == m["id"] for p in t.get("participants") or []) else None)} for m in members if not t.get("branch_id") or m.get("branch_id") == t.get("branch_id")],
        })
    return result


@router.post("/{tid}/member/register")
async def request_registration(tid: str, payload: RegistrationRequest, member=Depends(get_current_member)):
    linked = set(member.get("_linked_member_ids") or [member["id"]])
    if payload.member_id not in linked:
        raise HTTPException(403, "لا يمكنك تسجيل عضو من حساب آخر")
    athlete = await db.members.find_one({"id": payload.member_id}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "branch_id": 1})
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not athlete or not t or not t.get("registration_open") or t.get("status") == "completed":
        raise HTTPException(404, "التسجيل غير متاح")
    if t.get("branch_id") and t["branch_id"] != athlete.get("branch_id"):
        raise HTTPException(403, "الفرع غير مطابق")
    sub = (payload.subcategory or "").strip() or None
    if t.get("subcategories") and sub not in t["subcategories"]:
        raise HTTPException(400, "اختر تصنيفًا صحيحًا")
    if payload.activity_id and payload.activity_id not in (t.get("activity_ids") or [t.get("activity_id")]):
        raise HTTPException(400, "النشاط غير مطابق")
    if any(p.get("member_id") == payload.member_id and (p.get("subcategory") or None) == sub for p in t.get("participants") or []):
        raise HTTPException(409, "العضو مسجل بالفعل")
    if any(r.get("member_id") == payload.member_id and (r.get("subcategory") or None) == sub and r.get("status") in ("pending", "waitlisted") for r in t.get("registration_requests") or []):
        raise HTTPException(409, "الطلب موجود بالفعل")
    cap = t.get("registration_capacity") or 0
    occupied = len(t.get("participants") or []) + sum(r.get("status") == "pending" for r in t.get("registration_requests") or [])
    status = "waitlisted" if cap and occupied >= cap else "pending"
    request = {"id": str(uuid4()), "member_id": payload.member_id, "member_name": athlete.get("name_ar") or athlete.get("name") or "", "activity_id": payload.activity_id, "subcategory": sub, "status": status, "created_at": now()}
    result = await db.tournaments.update_one({"id": tid, "registration_open": True, "registration_requests.id": {"$ne": request["id"]}}, {"$push": {"registration_requests": request}, "$set": {"updated_at": now()}})
    if not result.modified_count:
        raise HTTPException(409, "تعذر حفظ الطلب")
    return {"status": status}


@router.post("/{tid}/operations/requests/{request_id}/{action}")
async def review_request(tid: str, request_id: str, action: Literal["approve", "reject"], user=Depends(require_tournaments_permission)):
    t = await _load_tournament_or_403(tid, user)
    requests = t.get("registration_requests") or []
    request = next((r for r in requests if r.get("id") == request_id), None)
    if not request or request.get("status") not in ("pending", "waitlisted"):
        raise HTTPException(409, "الطلب غير متاح للمراجعة")
    if action == "approve":
        cap = t.get("registration_capacity") or 0
        if cap and len(t.get("participants") or []) >= cap:
            raise HTTPException(409, "اكتملت سعة البطولة")
        await add_participant(tid, Participant(member_id=request["member_id"], activity_id=request.get("activity_id"), subcategory=request.get("subcategory"), notify=True), user)
    result = await db.tournaments.update_one({"id": tid, "registration_requests": {"$elemMatch": {"id": request_id, "status": request["status"]}}}, {"$set": {"registration_requests.$.status": "approved" if action == "approve" else "rejected", "registration_requests.$.reviewed_at": now(), "updated_at": now()}})
    if not result.modified_count:
        raise HTTPException(409, "راجع الطلب بعد تحديث الصفحة")
    cache_invalidate("tournaments:")
    return {"status": "approved" if action == "approve" else "rejected"}


@router.post("/{tid}/operations/checkin")
async def check_in(tid: str, payload: CheckIn, user=Depends(require_tournaments_permission)):
    t = await _load_tournament_or_403(tid, user)
    if not any(p.get("member_id") == payload.member_id for p in t.get("participants") or []):
        raise HTTPException(404, "العضو غير مسجل في البطولة")
    if any(c.get("member_id") == payload.member_id for c in t.get("tournament_checkins") or []):
        return {"status": "already_checked_in"}
    result = await db.tournaments.update_one({"id": tid, "tournament_checkins.member_id": {"$ne": payload.member_id}}, {"$push": {"tournament_checkins": {"member_id": payload.member_id, "at": now(), "by": user.get("user_id")}}})
    return {"status": "checked_in" if result.modified_count else "already_checked_in"}


@router.put("/{tid}/operations/matches")
async def save_matches(tid: str, payload: MatchList, user=Depends(require_tournaments_permission)):
    await _load_tournament_or_403(tid, user)
    matches = [m.model_dump() for m in payload.matches]
    for m in matches:
        m["id"] = m["id"] or str(uuid4())
        if m["status"] == "finished" and (m["score_a"] is None or m["score_b"] is None):
            raise HTTPException(400, "أدخل نتيجتي الفريقين قبل إنهاء المباراة")
    if len({m["id"] for m in matches}) != len(matches):
        raise HTTPException(400, "معرّف مباراة مكرر")
    query = {"id": tid, "match_board.revision": payload.revision} if payload.revision else {"id": tid, "$or": [{"match_board": {"$exists": False}}, {"match_board.revision": 0}]}
    board = {"revision": payload.revision + 1, "matches": matches, "updated_at": now()}
    result = await db.tournaments.update_one(query, {"$set": {"match_board": board, "results_approved": False, "updated_at": now()}})
    if not result.modified_count:
        raise HTTPException(409, "عدّل موظف آخر المباريات؛ أعد التحميل")
    return board


@router.post("/{tid}/operations/results/approve")
async def approve_results(tid: str, user=Depends(require_tournaments_permission)):
    t = await _load_tournament_or_403(tid, user)
    if t.get("results_approved", True):
        return {"approved": True}
    published = t.get("published_positions") or {}
    current = {f"{p.get('member_id')}|{p.get('subcategory') or ''}": p.get("position") for p in t.get("participants") or []}
    result = await db.tournaments.update_one({"id": tid, "results_approved": False}, {"$set": {"results_approved": True, "published_positions": current, "results_approved_at": now(), "results_approved_by": user.get("user_id")}})
    if not result.modified_count:
        raise HTTPException(409, "أُعتمدت النتائج من موظف آخر")
    for p in t.get("participants") or []:
        key = f"{p.get('member_id')}|{p.get('subcategory') or ''}"
        if p.get("position") in ("1", "2", "3") and published.get(key) != p.get("position"):
            try:
                delivery = await _notify_result(t, p["member_id"], p["position"])
                if delivery:
                    await _record_notification_log(tournament_id=tid, notif_type="result", summary=delivery, current_user=user, member_id=p["member_id"], member_name=await _resolve_member_name(p["member_id"]))
            except Exception:
                pass  # Approval persists even when one optional notification fails.
    cache_invalidate("tournaments:")
    return {"approved": True}
