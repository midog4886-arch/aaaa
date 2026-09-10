import asyncio
from unittest.mock import AsyncMock
from routes import whatsapp as mod


def test_shared_phone_combines_members_dates_but_not_branches(monkeypatch):
    sender = AsyncMock(return_value=True)
    log = AsyncMock()
    reminders = AsyncMock()
    monkeypatch.setattr(mod, "_send_wa_message_for_branch", sender)
    monkeypatch.setattr(mod, "_get_branch_cloud_config", AsyncMock(return_value=None))
    monkeypatch.setattr(mod, "_record_renewal_reminder", reminders)
    monkeypatch.setattr(mod.asyncio, "sleep", AsyncMock())
    monkeypatch.setattr(mod, "_db", {"whatsapp_send_log": type("Log", (), {"insert_one": log})()})
    rows = []
    for mid, branch, phone, activity, date, days in [
        ("one", "a", "0501234567", "سباحة", "2026/09/01", -9),
        ("two", "a", "966501234567", "كاراتيه", "2026/09/03", -7),
        ("three", "b", "0501234567", "قدم", "2026/09/04", -6),
    ]:
        rows.append({"member": {"id": mid, "name": mid, "branch_id": branch, "phone": phone},
                     "activity_name": activity, "end_date_fmt": date, "_days_before": days})
    count = asyncio.run(mod._send_wa_for_members(rows, 0, "{name} {activity} {end_date}"))
    assert count == 2
    assert sender.await_count == 2
    message = sender.await_args_list[0].args[1]
    assert all(text in message for text in ("سباحة", "كاراتيه", "2026/09/01", "2026/09/03", "one", "two"))
    assert "قدم" not in message
    assert message.count("— English —") == 1
    assert reminders.await_count == 3
    assert log.await_count == 2


def test_preview_counts_destinations_not_activities_or_offsets():
    assert mod._send_now_reminder_count([
        {"member_id": "one", "branch_id": "a", "phone": "0501234567", "days_before": -1},
        {"member_id": "two", "branch_id": "a", "phone": "966501234567", "days_before": -3},
        {"member_id": "one", "branch_id": "b", "phone": "0501234567", "days_before": -1},
    ]) == 2