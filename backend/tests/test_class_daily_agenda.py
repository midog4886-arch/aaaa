import asyncio
from datetime import datetime
from unittest.mock import AsyncMock
from routes import whatsapp as mod


def test_daily_message_lists_each_time_in_both_languages(monkeypatch):
    config = {"provider": "whatsflow", "enabled": True}
    sender = AsyncMock(return_value=(True, "id", None))
    monkeypatch.setattr(mod, "_get_branch_cloud_config", AsyncMock(return_value=config))
    monkeypatch.setattr(mod, "_send_session_provider_result", sender)
    monkeypatch.setattr(mod, "_db", {
        "closures": type("Closures", (), {
            "find": lambda *args: type("Cursor", (), {"to_list": AsyncMock(return_value=[])})(),
        })(),
        "whatsapp_send_log": type("Log", (), {"insert_one": AsyncMock()})(),
    })
    first = datetime(2026, 9, 7, 17, tzinfo=mod.RIYADH_TZ)
    member = {
        "id": "one", "name": "عضو", "phone": "0501234567", "branch_id": "a",
        "_daily_classes": [
            {"activity_name": "سباحة", "class_time": first, "member_name": "عضو"},
            {"activity_name": "كاراتيه", "class_time": first.replace(hour=19), "member_name": "عضو"},
        ],
    }
    assert asyncio.run(mod.send_class_reminder_whatsapp_notice(member, "سباحة", first, "الفرع"))
    sender.assert_awaited_once()
    body = sender.await_args.args[1]
    assert all(text in body for text in ["سباحة", "كاراتيه", "5:00 م", "7:00 م", "5:00 PM", "7:00 PM"])
    assert "أول نشاط بعد ساعتين" in body
    assert body.count("— English —") == 1
    assert "2026/09/07" in body