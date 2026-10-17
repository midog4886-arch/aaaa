"""Read-only Arabic questions over the existing, permission-scoped dashboard facts."""

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .common import get_current_user
from .dashboard_actions import get_dashboard_actions

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


@router.get("/suggestions")
async def suggestions(current_user: dict = Depends(get_current_user)):
    # Suggestions contain no private data. The answer endpoint checks the
    # existing dashboard permission and never returns a forbidden category.
    return [{"key": item["key"], "question": item["question"]} for item in QUESTIONS]


@router.post("/ask")
async def ask(payload: Question, current_user: dict = Depends(get_current_user)):
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
