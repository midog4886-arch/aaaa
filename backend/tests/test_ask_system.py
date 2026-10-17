import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routes import ask_system as mod


def test_arabic_intents_are_specific_and_unknown_questions_are_not_guessed():
    assert mod._intent("كم محادثة تحتاج رداً؟") == "needs_reply"
    assert mod._intent("أريد المحادثات غير المقروءة") == "conversations"
    assert mod._intent("من تغيب عن التدريب؟") == "absence"
    assert mod._intent("كم طلب تسجيل ينتظر المراجعة؟") == "registrations"
    assert mod._intent("ما حالة المسبح؟") is None
    assert mod._intent("كم اشتراكًا مدفوعًا هذا الشهر؟") is None


def test_answer_reuses_scoped_dashboard_facts(monkeypatch):
    loader = AsyncMock(return_value={
        "date": "2026-10-17", "generated_at": "2026-10-17T10:00:00Z",
        "groups": [{"key": "needs_reply", "status": "ready", "count": 4,
                    "items": [{"id": "one", "title": "محادثة", "detail": "بحاجة إلى رد"}],
                    "has_more": False}],
    })
    monkeypatch.setattr(mod, "get_dashboard_actions", loader)
    user = {"user_id": "staff-1", "branch_ids": ["branch-1"]}
    result = asyncio.run(mod.ask(mod.Question(question="كم محادثة تحتاج ردًا؟", branch_filter="branch-1"), user))
    loader.assert_awaited_once_with(branch_filter="branch-1", current_user=user)
    assert result["count"] == 4
    assert result["items"][0]["id"] == "one"
    assert result["date"] == "2026-10-17"


def test_forbidden_group_never_returns_a_count(monkeypatch):
    monkeypatch.setattr(mod, "get_dashboard_actions", AsyncMock(return_value={"groups": []}))
    with pytest.raises(HTTPException) as error:
        asyncio.run(mod.ask(mod.Question(question="كم محادثة تحتاج ردًا؟"), {"user_id": "limited"}))
    assert error.value.status_code == 403


def test_weekday_activity_counts_unique_active_members_and_labels_schedule(monkeypatch):
    class Collection:
        def __init__(self, rows):
            self.rows = rows

        def find(self, *_args, **_kwargs):
            return self

        async def to_list(self, _limit):
            return self.rows

    class Database:
        activities = Collection([{"id": "karate", "name_ar": "كاراتيه", "name": "Karate"}])
        members = Collection([
            {"status": "active", "activities": [
                {"activity_id": "karate", "status": "active", "start_date": "2026-01-01", "end_date": "2099-01-01", "schedule": "الاثنين والأربعاء"},
                {"activity_id": "karate", "status": "active", "end_date": "2099-01-01", "schedule": "الاثنين"},
            ]},
            {"status": "active", "activities": [{"activity_id": "karate", "end_date": "2020-01-01", "schedule": "الاثنين"}]},
            {"status": "inactive", "activities": [{"activity_id": "karate", "end_date": "2099-01-01", "schedule": "الاثنين"}]},
            {"status": "active", "activities": [{"activity_id": "karate", "end_date": "2099-01-01", "schedule": "الثلاثاء"}]},
        ])

    monkeypatch.setattr(mod, "db", Database())
    monkeypatch.setattr(mod, "resolve_branch_filter", lambda user, branch: branch)
    assert mod._scheduled_weekday("كم واحد في الكاراتيه يوم الاثنين") == (0, "الاثنين")
    result = asyncio.run(mod.ask(mod.Question(question="كم واحد في الكاراتيه يوم الاثنين", branch_filter="b1"), {"is_admin": True}))
    assert result["count"] == 1
    assert "مجدول" in result["answer"]
    assert "لا يمثل الحضور الفعلي" in result["definition"]
    assert result["date"]
