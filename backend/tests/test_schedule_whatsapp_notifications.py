import asyncio

from routes import day_extensions as day_extensions_mod
from routes import members as members_mod
from routes import push_notifications as push_mod
from routes import whatsapp as whatsapp_mod


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _InsertCollection:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(dict(row))


class _MemberDB:
    def __init__(self):
        self.member_notifications = _InsertCollection()


def test_member_schedule_change_sends_old_and_new_times(monkeypatch):
    fake_db = _MemberDB()
    monkeypatch.setattr(members_mod, "db", fake_db)
    sent = []

    async def fake_whatsapp(member, message, **kwargs):
        sent.append((member, message, kwargs))
        return True

    async def fake_push(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        whatsapp_mod, "send_schedule_update_whatsapp_notice", fake_whatsapp
    )
    monkeypatch.setattr(push_mod, "send_push_to_members", fake_push)

    run(members_mod._notify_schedule_change(
        "member-1",
        {
            "id": "member-1",
            "name_ar": "محمد",
            "phone": "0501234567",
            "branch_id": "branch-a",
        },
        {
            "activity_name": "الكاراتيه",
            "training_days": ["monday"],
            "training_time": "4:00 م",
            "day_times": {"monday": "4:00 م"},
        },
        {
            "activity_name": "الكاراتيه",
            "training_days": ["monday"],
            "training_time": "5:00 م",
            "day_times": {"monday": "5:00 م"},
        },
    ))

    assert len(sent) == 1
    assert "4:00 م" in sent[0][1]
    assert "5:00 م" in sent[0][1]
    assert sent[0][2]["notice_type"] == "schedule_changed_cloud"
    assert "Training schedule changed" in sent[0][1]
    assert "Previous schedule:" in sent[0][1]
    assert "New schedule:" in sent[0][1]


def test_closure_apply_has_no_direct_whatsapp_sender():
    # Closure delivery is now an explicit, durable campaign operation. Applying
    # the extension must not expose the former burst-sending helper.
    assert not hasattr(day_extensions_mod, "_send_closure_whatsapp_notices")