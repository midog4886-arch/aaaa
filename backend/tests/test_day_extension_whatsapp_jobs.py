import asyncio

import pytest
from fastapi import HTTPException

from routes import day_extensions as mod


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _length):
        return [dict(row) for row in self.rows]


class Collection:
    def __init__(self, rows):
        self.rows = rows

    async def find_one(self, query, _projection=None):
        return next(
            (dict(row) for row in self.rows
             if all(row.get(key) == value for key, value in query.items())),
            None,
        )

    def find(self, query, _projection=None):
        def matches(row):
            return all(row.get(key) in value["$in"] if isinstance(value, dict)
                       else row.get(key) == value for key, value in query.items())
        return Cursor([row for row in self.rows if matches(row)])


class DB:
    def __init__(self):
        self.whatsapp_campaign_jobs = Collection([])
        self.closures = Collection([{
            "id": "closure-1", "days": 2, "branch_id": "all",
        }])
        self.branches = Collection([
            {"id": "branch-a"}, {"id": "branch-b"},
        ])
        self.members = Collection([
            {"id": "m1", "name_ar": "محمد", "phone": "0501111111", "branch_id": "branch-a"},
            {"id": "m2", "name_ar": "أحمد", "phone": "0502222222", "branch_id": "branch-b"},
        ])


def test_closure_notices_use_db_phones_split_branches_and_personalize(monkeypatch):
    monkeypatch.setattr(mod, "db", DB())
    seen_preview = []
    enqueued = []

    async def authorize(_user):
        return None

    async def preview(data, _user):
        seen_preview.append(data)
        return {"extended_members": [
            {"member_id": "m1", "name": "untrusted", "phone": "999",
             "details": [{"missed_sessions": 2, "new_end": "2026-09-12",
                          "old_end": "2026-09-10", "activity": "سباحة"}]},
            {"member_id": "m2", "name": "excluded", "phone": "888", "details": []},
        ]}

    async def provider(branch_id):
        return {"branch-a": "waha", "branch-b": "whatsflow"}[branch_id]

    async def enqueue(branch_id, provider_name, recipients, key, *, source):
        assert source == "closure_notice"
        enqueued.append((branch_id, provider_name, recipients, key))
        return {
            "id": "job-a", "branch_id": branch_id, "idempotency_key": key,
            "total": len(recipients), "status": "pending",
        }, True

    monkeypatch.setattr(mod, "_require_current_admin", authorize)
    monkeypatch.setattr(mod, "apply_extension", preview)
    monkeypatch.setattr(mod, "_closure_provider", provider)
    monkeypatch.setattr(mod.whatsapp_bulk_jobs, "enqueue", enqueue)

    result = run(mod.enqueue_closure_notices(
        mod.ClosureNoticeSend(
            closure_id="closure-1",
            message="{name}|{days}|{new_end}|{old_end}|{activity}",
            branch_id="all",
            excluded_member_ids=["m2"],
        ),
        {"is_admin": True},
    ))

    assert seen_preview[0].dry_run is True
    assert seen_preview[0].days == 2
    assert seen_preview[0].excluded_member_ids == ["m2"]
    assert len(enqueued) == 1
    assert enqueued[0][0:2] == ("branch-a", "waha")
    assert enqueued[0][2][0]["phone"] == "0501111111"
    message = enqueued[0][2][0]["message"]
    assert message.startswith("محمد|2|2026-09-12|2026-09-10|سباحة")
    assert "New end date: 2026-09-12" in message
    assert "Sessions to compensate: 2" in message
    assert enqueued[0][3] == "closure_notice_closure-1"
    assert result["queued"] == 1


def test_provider_failure_happens_before_any_enqueue(monkeypatch):
    fake_db = DB()
    fake_db.members = Collection([
        {"id": "m1", "name_ar": "أ", "phone": "0501111111", "branch_id": "branch-a"},
        {"id": "m2", "name_ar": "ب", "phone": "0502222222", "branch_id": "branch-b"},
    ])
    monkeypatch.setattr(mod, "db", fake_db)

    async def authorize(_user):
        return None

    async def preview(_data, _user):
        return {"extended_members": [
            {"member_id": "m1", "details": [{}]},
            {"member_id": "m2", "details": [{}]},
        ]}

    async def provider(branch_id):
        if branch_id == "branch-b":
            raise HTTPException(status_code=400, detail="disabled")
        return "meta_cloud"

    called = []
    monkeypatch.setattr(mod, "_require_current_admin", authorize)
    monkeypatch.setattr(mod, "apply_extension", preview)
    monkeypatch.setattr(mod, "_closure_provider", provider)
    monkeypatch.setattr(
        mod.whatsapp_bulk_jobs, "enqueue",
        lambda *_args, **_kwargs: called.append(True),
    )

    with pytest.raises(HTTPException, match="disabled"):
        run(mod.enqueue_closure_notices(
            mod.ClosureNoticeSend(closure_id="closure-1", message="hello"),
            {"is_admin": True},
        ))
    assert called == []


def test_first_send_after_apply_uses_saved_affected_members(monkeypatch):
    fake_db = DB()
    fake_db.closures = Collection([{
        "id": "closure-1",
        "days": 2,
        "branch_id": "all",
        "start_date": "2026-09-10",
        "end_date": "2026-09-11",
        "applied": True,
        "affected_members": [{
            "member_id": "m1",
            "phone": "untrusted-old-phone",
            "details": [{
                "missed_sessions": 2,
                "old_end": "2026-09-20",
                "new_end": "2026-09-22",
                "activity": "سباحة",
            }],
        }],
    }])
    monkeypatch.setattr(mod, "db", fake_db)
    enqueued = []

    async def authorize(_user):
        return None

    async def provider(_branch_id):
        return "waha"

    async def enqueue(branch_id, provider_name, recipients, key, *, source):
        assert source == "closure_notice"
        enqueued.append((branch_id, provider_name, recipients, key))
        return {
            "id": "same-job", "branch_id": branch_id, "idempotency_key": key,
            "total": len(recipients), "status": "pending",
        }, True

    monkeypatch.setattr(mod, "_require_current_admin", authorize)
    monkeypatch.setattr(mod, "_closure_provider", provider)
    monkeypatch.setattr(mod.whatsapp_bulk_jobs, "enqueue", enqueue)

    result = run(mod.enqueue_closure_notices(
        mod.ClosureNoticeSend(
            closure_id="closure-1",
            message="{name} {old_end} {new_end}",
            branch_id="all",
        ),
        {"is_admin": True},
    ))

    assert result["queued"] == 1
    assert enqueued[0][2][0]["phone"] == "0501111111"
    message = enqueued[0][2][0]["message"]
    assert message.startswith("محمد 2026-09-20 2026-09-22")
    assert "Previous end date: 2026-09-20" in message
    assert "New end date: 2026-09-22" in message
    assert enqueued[0][3] == "closure_notice_closure-1"


def test_invalid_phone_in_second_branch_prevents_every_enqueue(monkeypatch):
    fake_db = DB()
    fake_db.members = Collection([
        {"id": "m1", "name_ar": "أ", "phone": "0501111111", "branch_id": "branch-a"},
        {"id": "m2", "name_ar": "ب", "phone": "not-a-phone", "branch_id": "branch-b"},
    ])
    monkeypatch.setattr(mod, "db", fake_db)
    called = []

    async def authorize(_user):
        return None

    async def preview(_data, _user):
        return {"extended_members": [
            {"member_id": "m1", "details": [{}]},
            {"member_id": "m2", "details": [{}]},
        ]}

    async def provider(_branch_id):
        return "waha"

    async def enqueue(*_args, **_kwargs):
        called.append(True)

    monkeypatch.setattr(mod, "_require_current_admin", authorize)
    monkeypatch.setattr(mod, "apply_extension", preview)
    monkeypatch.setattr(mod, "_closure_provider", provider)
    monkeypatch.setattr(mod.whatsapp_bulk_jobs, "enqueue", enqueue)

    with pytest.raises(HTTPException, match="invalid WhatsApp phone"):
        run(mod.enqueue_closure_notices(
            mod.ClosureNoticeSend(closure_id="closure-1", message="hello"),
            {"is_admin": True},
        ))
    assert called == []


def test_send_then_apply_then_lost_response_retry_returns_same_job(monkeypatch):
    fake_db = DB()
    monkeypatch.setattr(mod, "db", fake_db)
    jobs_by_key = {}

    async def authorize(_user):
        return None

    async def preview(_data, _user):
        return {"extended_members": [{
            "member_id": "m1",
            "details": [{"missed_sessions": 2}],
        }]}

    async def provider(_branch_id):
        return "waha"

    async def enqueue(branch_id, _provider, recipients, key, *, source):
        assert source == "closure_notice"
        scope = (branch_id, key)
        if scope not in jobs_by_key:
            jobs_by_key[scope] = {
                "id": "durable-job-1", "branch_id": branch_id,
                "idempotency_key": key, "total": len(recipients),
                "status": "pending",
            }
            return jobs_by_key[scope], True
        return jobs_by_key[scope], False

    monkeypatch.setattr(mod, "_require_current_admin", authorize)
    monkeypatch.setattr(mod, "apply_extension", preview)
    monkeypatch.setattr(mod, "_closure_provider", provider)
    monkeypatch.setattr(mod.whatsapp_bulk_jobs, "enqueue", enqueue)
    request = mod.ClosureNoticeSend(closure_id="closure-1", message="hello {name}")

    first = run(mod.enqueue_closure_notices(request, {"is_admin": True}))
    # Model applying while the enqueue response is lost; the retry sees the
    # applied closure but must retain the same durable campaign identity.
    fake_db.closures.rows[0]["applied"] = True
    second = run(mod.enqueue_closure_notices(request, {"is_admin": True}))

    assert first["jobs"][0]["id"] == second["jobs"][0]["id"] == "durable-job-1"
    assert first["jobs"][0]["created"] is True
    assert second["jobs"][0]["created"] is False
    assert len(jobs_by_key) == 1
    assert second["queued"] == 0
    assert second["existing"] is True


@pytest.mark.parametrize("status", ["completed", "pending", "unknown", "failed"])
def test_existing_branch_job_is_returned_without_preview_or_send(monkeypatch, status):
    fake_db = DB()
    fake_db.whatsapp_campaign_jobs.rows = [{
        "id": "existing", "branch_id": "branch-a",
        "idempotency_key": "closure_notice_closure-1",
        "status": status, "total": 2,
    }]
    monkeypatch.setattr(mod, "db", fake_db)

    async def authorize(_):
        pass

    async def forbidden(*args, **kwargs):
        raise AssertionError("Existing job must not rebuild, validate, or enqueue")

    monkeypatch.setattr(mod, "_require_current_admin", authorize)
    monkeypatch.setattr(mod, "apply_extension", forbidden)
    monkeypatch.setattr(mod, "_closure_provider", forbidden)
    monkeypatch.setattr(mod.whatsapp_bulk_jobs, "enqueue", forbidden)
    result = run(mod.enqueue_closure_notices(mod.ClosureNoticeSend(
        closure_id="closure-1", branch_id="branch-a", message="notice",
    ), {"is_admin": True}))
    assert result["queued"] == 0
    assert result["existing"] is True
    assert result["jobs"][0]["created"] is False
    assert len(fake_db.whatsapp_campaign_jobs.rows) == 1