import asyncio
from types import SimpleNamespace

from services.closure_notice_summary import summaries, recipient_state


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _):
        return self.rows

    def __aiter__(self):
        async def iterate():
            for row in self.rows:
                yield row
        return iterate()


class Jobs:
    def __init__(self, rows):
        self.rows = rows
        self.query = None

    def find(self, query, projection):
        self.query = query
        return Cursor([r for r in self.rows if
            r["idempotency_key"] in query["idempotency_key"]["$in"] and
            ("branch_id" not in query or r["branch_id"] in query["branch_id"]["$in"])])


class Items:
    def __init__(self, rows):
        self.rows = rows
        self.calls = 0

    def aggregate(self, pipeline):
        self.calls += 1
        assert "$group" in pipeline[1]
        assert '"message"' not in str(pipeline) and "'message'" not in str(pipeline)
        return Cursor(self.rows)


def test_summary_all_branch_scope_and_recipient_counts():
    jobs = Jobs([
        {"id": branch, "branch_id": branch, "idempotency_key": "closure_notice_c",
         "status": "completed", "recipient_count": 1, "total": 3}
        for branch in ["a", "b", "forbidden"]
    ])
    items = Items([
        {"_id": {"job": "a", "branch": "a", "recipient": "m1"},
         "member_id": "m1", "items": [{"status": "sent", "delivery_status": "delivered", "provider_message_id": "exact-id"}]},
        {"_id": {"job": "b", "branch": "b", "recipient": "m2"},
         "member_id": "m2", "items": [{"status": "unknown"}]},
        {"_id": {"job": "forbidden", "branch": "forbidden", "recipient": "m3"},
         "statuses": ["sent"], "receipts": []},
    ])
    db = SimpleNamespace(whatsapp_campaign_jobs=jobs, whatsapp_campaign_job_items=items)
    result = asyncio.run(summaries(db, [
        {"id": "c", "branch_id": "all"}, {"id": "empty", "branch_id": "a"},
    ], ["a", "b"]))
    assert jobs.query["branch_id"] == {"$in": ["a", "b"]}
    assert items.calls == 1
    assert result["c"]["total"] == 2
    assert result["c"]["sent"] == result["c"]["unknown"] == result["c"]["delivered"] == 1
    assert result["c"]["state"] == "unknown"
    assert result["empty"]["state"] == "not_queued"
    assert "phone" not in str(result)


def test_pending_is_not_accepted_and_unknown_is_never_a_failure_retry():
    assert recipient_state({"statuses": ["pending", "sent"]}) == "pending"
    assert recipient_state({"statuses": ["unknown", "failed"]}) == "unknown"
    assert recipient_state({"items": [{"status": "sent", "receipt_status": "failed",
                                     "provider_message_id": "exact-id"}]}) == "failed"
    assert recipient_state({"statuses": ["sent"]}) == "sent"


def test_worker_states_and_mixed_outcomes_fail_closed():
    assert recipient_state({"statuses": ["claimed"]}) == "pending"
    assert recipient_state({"statuses": ["quota_reserving"]}) == "pending"
    assert recipient_state({"statuses": ["future_worker_state"]}) == "unknown"
    assert recipient_state({}) == "unknown"
    assert recipient_state({"statuses": ["sent", "failed"]}) == "unknown"
    assert recipient_state({"statuses": ["cancelled"]}) == "cancelled"
    assert recipient_state({"items": [{"status": "sent", "receipt_status": "failed"}]}) == "sent"


def test_delivery_requires_exact_provider_id_and_accepts_receipt_status():
    jobs = Jobs([{"id": "a", "branch_id": "a", "idempotency_key": "closure_notice_c",
                  "status": "completed", "recipient_count": 3}])
    items = Items([
        {"_id": {"job": "a", "branch": "a", "recipient": str(index)},
         "member_id": str(index), "items": [item]}
        for index, item in enumerate([
            {"status": "sent", "delivery_status": "delivered"},
            {"status": "sent", "receipt_status": "read"},
            {"status": "sent", "receipt_status": "delivered", "provider_message_id": "exact-id"},
        ])
    ])
    result = asyncio.run(summaries(SimpleNamespace(
        whatsapp_campaign_jobs=jobs, whatsapp_campaign_job_items=items,
    ), [{"id": "c", "branch_id": "a"}]))
    assert result["c"]["sent"] == 3
    assert result["c"]["delivered"] == 1


def test_branch_specific_closure_rejects_other_branch_and_tenant_db_is_independent():
    rows = [
        {"id": b, "branch_id": b, "idempotency_key": "closure_notice_c",
         "status": "completed", "recipient_count": 0} for b in ["a", "b"]
    ]
    tenant_a = SimpleNamespace(whatsapp_campaign_jobs=Jobs(rows),
                               whatsapp_campaign_job_items=Items([]))
    tenant_b = SimpleNamespace(whatsapp_campaign_jobs=Jobs([]),
                               whatsapp_campaign_job_items=Items([]))
    closures = [{"id": "c", "branch_id": "a"}]
    a = asyncio.run(summaries(tenant_a, closures))
    b = asyncio.run(summaries(tenant_b, closures))
    assert [j["branch_id"] for j in a["c"]["jobs"]] == ["a"]
    assert a["c"]["state"] == "zero_recipients"
    assert b["c"]["state"] == "not_queued"