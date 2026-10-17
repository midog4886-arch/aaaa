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
