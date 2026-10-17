"""Read-only Arabic questions over the existing, permission-scoped dashboard facts."""

import re
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .common import db, get_current_user
from .dashboard_actions import get_dashboard_actions
from .attendance import parse_schedule_days
from utils.auth import resolve_branch_filter

router = APIRouter(prefix="/ask-system", tags=["ask-system"])


class Question(BaseModel):
    question: str = Field(min_length=3, max_length=300)
    branch_filter: Optional[str] = None


QUESTIONS = [
    {"key": "expiring", "question": "كم اشتراكًا يحتاج تجديدًا خلال 7 أيام؟", "terms": ("تجديد", "تنتهي", "انتهاء", "انتهت", "منته")},
    {"key": "absence", "question": "من يحتاج متابعة بسبب الغياب؟", "terms": ("غياب", "غائب", "تغيب", "تغيبوا", "لم يحضر")},
    {"key": "registrations", "question": "كم طلب تسجيل ينتظر المراجعة؟", "terms": ("تسجيل", "طلب جديد")},
    {"key": "conversations", "question": "كم محادثة غير مقروءة؟", "terms": ("غير مقرو", "غير المقرو", "لم تقرا", "لم تفتح", "غير مفتوح")},
    {"key": "needs_reply", "question": "كم محادثة تحتاج ردًا؟", "terms": ("تحتاج رد", "بدون رد", "لم يرد", "لم نرد", "لم يتم الرد", "نرد عليها", "ردود", "رد عليها")},
    {"key": "failures", "question": "كم عملية إرسال أو دفع فشلت خلال 7 أيام؟", "terms": ("فشل", "فاشل", "تعثر", "لم ترسل", "لم تدفع")},
]

DEFINITIONS = {
    "expiring": "اشتراكات تنتهي خلال 7 أيام ولم تُجدّد بعد؛ تُحسب من بيانات العضويات والفواتير.",
    "absence": "أعضاء لديهم 3 حالات غياب مسجلة أو أكثر خلال آخر 30 يومًا.",
    "registrations": "طلبات التسجيل التي لا تزال بانتظار المراجعة.",
    "conversations": "محادثات لم تُفتح في النظام أو لا تزال غير مقروءة حسب آخر مزامنة.",
    "needs_reply": "محادثات وصلت فيها رسالة من العميل ولم يُرسل بعدها رد.",
    "failures": "عمليات إرسال أو دفع فاشلة مؤكدة خلال آخر 7 أيام.",
}

WEEKDAYS = {
    "الاحد": (6, "الأحد"), "الاثنين": (0, "الاثنين"),
    "الثلاثاء": (1, "الثلاثاء"), "الاربعاء": (2, "الأربعاء"),
    "الخميس": (3, "الخميس"), "الجمعه": (4, "الجمعة"),
    "السبت": (5, "السبت"),
}
ENGLISH_WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
ACTIVITY_ALIASES = {"كاراتيه": ("كاراتيه", "كارتيه", "كراتيه", "karate")}


def _normalize(value: str) -> str:
    value = str(value or "").translate(str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789"))
    value = re.sub(r"[\u064b-\u065f\u0670\u0640]", "", value)
    value = value.translate(str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه"})).lower()
    return " ".join(value.split())


def _intent(question: str) -> Optional[str]:
    text = _normalize(question)
    # A request for an unanswered conversation is more specific than a generic
    # request about messages, and must never be mistaken for unread messages.
    for entry in (QUESTIONS[4], QUESTIONS[3], QUESTIONS[0], QUESTIONS[1], QUESTIONS[2], QUESTIONS[5]):
        if any(_normalize(term) in text for term in entry["terms"]):
            return entry["key"]
    return None


def _scheduled_weekday(question: str):
    text = _normalize(question)
    if not any(term in text for term in ("كم", "عدد")):
        return None
    for name, (weekday, label) in WEEKDAYS.items():
        if name in text:
            return weekday, label
    return None


async def _scheduled_activity_answer(payload: Question, current_user: dict, weekday: int, day_label: str):
    # Keep the same dashboard and attendance permission boundary as the
    # existing actionable cards. Do not expose member names in this answer.
    if not current_user.get("is_admin"):
        user = await db.users.find_one({"id": current_user.get("user_id")}, {"_id": 0, "permissions": 1})
        permissions = set((user or {}).get("permissions") or [])
        if not {"dashboard", "attendance"}.issubset(permissions):
            raise HTTPException(status_code=403, detail="لا تملك صلاحية عرض هذه البيانات")
    branch_id = resolve_branch_filter(current_user, payload.branch_filter)
    activity_scope = {"$or": [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": {"$exists": False}}]} if branch_id else {}
    activities = await db.activities.find(activity_scope, {"_id": 0, "id": 1, "name": 1, "name_ar": 1}).to_list(500)
    question_text = _normalize(payload.question)
    def activity_names(activity):
        names = (activity.get("name_ar"), activity.get("name"))
        aliases = next((values for canonical, values in ACTIVITY_ALIASES.items()
                        if any(any(_normalize(alias) in _normalize(name) for alias in values)
                               for name in names if name)), ())
        return names + tuple(aliases)

    matches = [activity for activity in activities if any(
        _normalize(name) in question_text for name in activity_names(activity) if name
    )]
    if len(matches) != 1:
        return {"supported": False, "message": "اذكر اسم نشاط واحد كما يظهر في النظام، مثل: كم مشتركًا في الكاراتيه يوم الاثنين؟"}
    activity = matches[0]
    today = datetime.now(ZoneInfo("Asia/Riyadh")).date()
    target = today + timedelta(days=(weekday - today.weekday()) % 7)
    target_date = target.isoformat()
    name = activity.get("name_ar") or activity.get("name")
    member_scope = {"branch_id": branch_id} if branch_id else {}
    member_scope["activities"] = {"$elemMatch": {"end_date": {"$gte": target_date}, "$or": [
        {"activity_id": activity.get("id")},
        {"activity_name": {"$in": [value for value in activity_names(activity) if value]}},
    ]}}
    members = await db.members.find(member_scope, {"_id": 0, "id": 1, "status": 1, "activities": 1}).to_list(None)
    matching_names = {_normalize(value) for value in activity_names(activity) if value}
    count = 0
    for member in members:
        if str(member.get("status") or "active").lower() in {"archived", "deleted", "inactive"}:
            continue
        if any(
            (entry.get("activity_id") == activity.get("id") or _normalize(entry.get("activity_name")) in matching_names)
            and entry.get("status", "active") == "active"
            and (not entry.get("start_date") or str(entry["start_date"])[:10] <= target_date)
            and str(entry.get("end_date") or "")[:10] >= target_date
            and ENGLISH_WEEKDAYS[weekday] in parse_schedule_days(entry.get("schedule") or "")
            for entry in member.get("activities") or []
        ):
            count += 1
    return {
        "supported": True, "key": "scheduled_activity", "count": count,
        "answer": f"{count} مشتركًا مجدولًا في {name} يوم {day_label} {target_date}.",
        "definition": "العدد يشمل العضويات النشطة ذات الموعد المسجل لهذا اليوم، ولا يمثل الحضور الفعلي.",
        "date": target_date, "items": [], "has_more": False,
    }


@router.get("/suggestions")
async def suggestions(current_user: dict = Depends(get_current_user)):
    # Suggestions contain no private data. The answer endpoint checks the
    # existing dashboard permission and never returns a forbidden category.
    return [{"key": item["key"], "question": item["question"]} for item in QUESTIONS]


@router.post("/ask")
async def ask(payload: Question, current_user: dict = Depends(get_current_user)):
    scheduled_day = _scheduled_weekday(payload.question)
    if scheduled_day:
        return await _scheduled_activity_answer(payload, current_user, *scheduled_day)
    key = _intent(payload.question)
    if key is None:
        return {"supported": False, "message": "هذا السؤال غير مدعوم بعد. اختر سؤالًا من الأمثلة المعروضة.", "suggestions": [{"key": q["key"], "question": q["question"]} for q in QUESTIONS]}

    # Reuse the same branch and permission checks and the same source of truth
    # used by the actionable dashboard cards. No free-form database queries.
    facts = await get_dashboard_actions(branch_filter=payload.branch_filter, current_user=current_user)
    group = next((row for row in facts.get("groups", []) if row.get("key") == key), None)
    if group is None:
        raise HTTPException(status_code=403, detail="لا تملك صلاحية عرض هذه البيانات")
    if group.get("status") != "ready" or group.get("count") is None:
        raise HTTPException(status_code=503, detail="البيانات غير متاحة حاليًا؛ أعد المحاولة")

    count = int(group["count"])
    return {
        "supported": True,
        "key": key,
        "count": count,
        "answer": f"العدد {count}.",
        "definition": DEFINITIONS[key],
        "date": facts.get("date"),
        "generated_at": facts.get("generated_at"),
        "items": group.get("items") or [],
        "has_more": bool(group.get("has_more")),
    }
