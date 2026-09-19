import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from services import campaign_inbox as inbox
from routes import whatsapp as mod


def item(**changes):
    return {
        "id": "item-1", "branch_id": "a", "provider": "whatsflow",
        "phone": "966500000001", "message": "Campaign text",
        "status": "sent", "created_at": datetime(2026, 9, 10),
        **changes,
    }


@pytest.mark.parametrize("status", ["sent", "failed", "pending", "unknown", "cancelled"])
def test_projection_preserves_status_without_marking_delivery(status):
    message = inbox.as_message(item(status=status))
    assert message["status"] == status
    assert message["direction"] == "outbound"
    assert message["conversation_id"] == "a:966500000001"
    assert message["created_at"] == "2026-09-10T00:00:00+00:00"


def test_pending_projection_is_queued_not_sent():
    message = inbox.as_message(item(status="pending"))
    assert message["source"] == "campaign"
    assert message["queue_status"] == "pending"
    assert message["delivery_status"] is None
    assert message["sent_at"] == ""
    assert message["queued_at"] == message["created_at"]
    assert message["display_at"] == message["created_at"]
    assert message["timestamp_kind"] == "queued"


@pytest.mark.parametrize("status", ["dispatching", "unknown", "failed"])
def test_non_sent_queue_states_never_get_a_sent_timestamp(status):
    message = inbox.as_message(item(
        status=status,
        completed_at=datetime(2026, 9, 10, 1),
        sent_at=datetime(2026, 9, 10, 1),
    ))
    assert message["sent_at"] == (
        "2026-09-10T01:00:00+00:00" if status == "failed" else ""
    )
    assert message["status"] == ("failed" if status == "failed" else
                                 ("pending" if status == "dispatching" else "unknown"))
    if status == "failed":
        assert message["failed_at"] == "2026-09-10T01:00:00+00:00"
        assert message["timestamp_kind"] == "failed"


def test_completed_sent_item_projects_provider_acceptance_not_delivery():
    message = inbox.as_message(item(completed_at=datetime(2026, 9, 10, 1)))
    assert message["status"] == "sent"
    assert message["delivery_status"] is None
    assert message["sent_at"] == "2026-09-10T01:00:00+00:00"
    assert message["timestamp_kind"] == "sent"
    assert message["display_at"] == message["sent_at"]
    assert message["created_at"] == "2026-09-10T00:00:00+00:00"


def test_delivery_and_read_need_the_exact_provider_id():
    delivered = inbox.as_message(item(
        provider_message_id="exact", delivery_status="delivered",
        delivered_at=datetime(2026, 9, 10, 2),
        completed_at=datetime(2026, 9, 10, 1),
    ))
    assert delivered["status"] == "delivered"
    assert delivered["delivery_status"] == "delivered"
    assert delivered["delivered_at"] == "2026-09-10T02:00:00+00:00"
    assert delivered["timestamp_kind"] == "delivered"

    read = inbox.as_message(item(
        provider_message_id="exact", receipt_status="read",
        read_at=datetime(2026, 9, 10, 3),
    ))
    assert read["status"] == "read"
    assert read["read_at"] == "2026-09-10T03:00:00+00:00"
    assert read["timestamp_kind"] == "read"

    uncorrelated = inbox.as_message(item(
        delivery_status="delivered", delivered_at=datetime(2026, 9, 10, 2),
    ))
    assert uncorrelated["status"] == "sent"
    assert uncorrelated["delivery_status"] is None
    assert uncorrelated["delivered_at"] == ""


def test_projection_preserves_multiple_media_and_caption_rules():
    ref = {"media_type": "image", "mime_type": "image/png", "filename": "offer.png"}
    first = inbox.as_message(item(attachment=ref, media_index=0))
    second = inbox.as_message(item(id="item-2", attachment=ref, media_index=1))
    assert first["body"] == "Campaign text"
    assert second["body"] == ""
    assert first["media_id"] != second["media_id"]
    assert second["filename"] == "offer.png"


def test_webhook_echo_is_merged_by_provider_id_not_text():
    projected = inbox.as_message(item(provider_message_id="external"))
    echo = {**projected, "id": "webhook", "status": "read"}
    another = inbox.as_message(item(id="item-2", provider_message_id="different"))
    result = inbox.merge_messages([echo], [projected, another])
    assert len(result) == 2
    assert next(m for m in result if m["id"] == "webhook")["status"] == "read"


def test_media_echo_keeps_local_attachment_and_receipt():
    projected = inbox.as_message(item(provider_message_id="external", attachment={
        "media_type": "image", "mime_type": "image/png", "filename": "offer.png",
    }))
    echo = {**projected, "id": "webhook", "media_id": None, "status": "delivered"}
    result = inbox.merge_messages([echo], [projected])
    assert len(result) == 1
    assert result[0]["media_id"] == "campaign:item-1"
    assert result[0]["id"] == "campaign:item-1"
    assert result[0]["status"] == "delivered"


def test_old_messages_without_ids_are_not_guessed_equal_by_text():
    first = inbox.as_message(item())
    second = inbox.as_message(item(id="another"))
    assert len(inbox.merge_messages([first], [second])) == 2


def test_out_of_order_campaign_projection_does_not_regress_exact_receipt():
    projected = inbox.as_message(item(
        provider_message_id="external",
        completed_at=datetime(2026, 9, 10, 1),
    ))
    receipt_echo = {
        **projected, "id": "webhook", "status": "read",
        "delivery_status": "read", "read_at": "2026-09-10T02:00:00+00:00",
    }
    merged = inbox.merge_messages([receipt_echo], [projected])
    assert merged[0]["status"] == "read"
    assert merged[0]["delivery_status"] == "read"
    assert merged[0]["read_at"] == "2026-09-10T02:00:00+00:00"
    assert merged[0]["timestamp_kind"] == "read"


class Cursor:
    def __init__(self, rows):
        self.rows = rows
    def sort(self, *args):
        return self
    def limit(self, *args):
        return self
    async def to_list(self, *args, **kwargs):
        return self.rows


class ReadOnlyItems:
    def __init__(self):
        self.query = None
    def find(self, query, projection):
        self.query = query
        return Cursor([item()])
    def aggregate(self, pipeline):
        self.pipeline = pipeline
        return Cursor([{"item": item()}])


def test_read_only_projection_queries_scope_branch_and_phone():
    collection = ReadOnlyItems()
    db = {"whatsapp_campaign_job_items": collection}
    messages = asyncio.run(inbox.thread(db, "a", "966500000001"))
    thread_scope, thread_evidence = collection.query["$and"]
    assert thread_scope["branch_id"] == "a"
    assert thread_scope["phone"]["$in"][0] == "966500000001"
    assert thread_evidence == inbox.CAMPAIGN_INBOX_EVIDENCE
    assert len(messages) == 1
    rows = asyncio.run(inbox.conversations(db, {"branch_id": "a"}))
    conversation_scope, conversation_evidence = (
        collection.pipeline[0]["$match"]["$and"]
    )
    assert conversation_scope["branch_id"] == "a"
    assert conversation_evidence == inbox.CAMPAIGN_INBOX_EVIDENCE
    assert next(
        index for index, stage in enumerate(collection.pipeline) if "$match" in stage
    ) < next(
        index for index, stage in enumerate(collection.pipeline) if "$group" in stage
    )
    assert rows[0]["unread_count"] == 0
    assert {
        key: rows[0][key] for key in (
            "last_source", "last_status", "last_queue_status",
            "last_queued_at", "last_sent_at", "last_delivered_at",
            "last_read_at", "last_failed_at", "last_cancelled_at",
            "last_timestamp_kind",
            "last_message_at",
        )
    } == {
        "last_source": "campaign", "last_status": "sent",
        "last_queue_status": "sent",
        "last_queued_at": "2026-09-10T00:00:00+00:00",
        "last_sent_at": "", "last_delivered_at": "", "last_read_at": "",
        "last_failed_at": "", "last_cancelled_at": "",
        "last_timestamp_kind": "queued",
        "last_message_at": "2026-09-10T00:00:00+00:00",
    }


class EvidenceItems:
    def __init__(self, rows):
        self.rows = rows

    def aggregate(self, pipeline):
        assert "$match" in pipeline[0]
        visible = [row for row in self.rows if inbox._has_send_evidence(row)]
        newest_by_phone = {}
        for row in visible:
            phone = row["phone"].split("@")[0]
            current = newest_by_phone.get((row["branch_id"], phone))
            if not current or row["created_at"] > current["created_at"]:
                newest_by_phone[(row["branch_id"], phone)] = row
        return Cursor([{"item": row} for row in newest_by_phone.values()])

    def find(self, query, projection):
        assert query["$and"][1] == inbox.CAMPAIGN_INBOX_EVIDENCE
        return Cursor([row for row in self.rows if inbox._has_send_evidence(row)])


def test_newer_queued_item_does_not_hide_older_sent_projection():
    rows = [
        item(id="sent", status="sent", completed_at=datetime(2026, 9, 10, 1)),
        item(id="queued", status="pending", created_at=datetime(2026, 9, 11)),
    ]
    db = {"whatsapp_campaign_job_items": EvidenceItems(rows)}
    conversations = asyncio.run(inbox.conversations(db, {"branch_id": "a"}))
    assert len(conversations) == 1
    assert conversations[0]["last_status"] == "sent"
    assert conversations[0]["last_message_at"] == "2026-09-10T01:00:00+00:00"


def test_queue_only_campaign_disappears_but_existing_inbound_remains():
    db = {"whatsapp_campaign_job_items": EvidenceItems([
        item(status="queued"),
        item(id="failed-before-send", status="failed",
             provider_message_id="correlation-is-not-evidence"),
    ])}
    assert asyncio.run(inbox.conversations(db, {"branch_id": "a"})) == []
    assert asyncio.run(inbox.thread(db, "a", "966500000001")) == []

    inbound = {
        "id": "inbound", "provider": "whatsflow",
        "provider_message_id": "inbound-id", "direction": "inbound",
        "created_at": "2026-09-09T00:00:00+00:00", "status": "received",
    }
    assert inbox.merge_messages([inbound], []) == [inbound]


def test_receipt_can_project_before_queue_status_update_and_failure_needs_send_evidence():
    delivered = item(
        status="processing", provider_message_id="provider-id",
        delivery_status="delivered", delivered_at=datetime(2026, 9, 10, 2),
    )
    assert inbox._has_send_evidence(delivered)
    assert inbox.as_message(delivered)["status"] == "delivered"
    assert not inbox._has_send_evidence(item(
        status="failed", provider_message_id="provider-id",
    ))
    after_acceptance = item(
        status="failed", accepted_at=datetime(2026, 9, 10, 1),
        failed_at=datetime(2026, 9, 10, 2),
    )
    assert inbox._has_send_evidence(after_acceptance)
    projected = inbox.as_message(after_acceptance)
    assert projected["status"] == "failed"
    assert projected["sent_at"] == "2026-09-10T01:00:00+00:00"
    assert projected["failed_at"] == "2026-09-10T02:00:00+00:00"


def test_virtual_thread_denies_foreign_branch_before_read(monkeypatch):
    monkeypatch.setattr(mod, "_db", {})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(mod._campaign_conversation("other:966500000001",
                    {"is_admin": False, "branch_id": "a"}))
    assert exc.value.status_code == 403


def test_campaign_media_enforces_branch_guard(monkeypatch):
    collection = type("Items", (), {"find_one": AsyncMock(return_value=item(
        attachment={"media_type": "image", "mime_type": "image/png"}))})()
    monkeypatch.setattr(mod, "_db", {"whatsapp_campaign_job_items": collection})
    loader = AsyncMock()
    monkeypatch.setattr(mod, "_load_bulk_attachment", loader)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(mod.get_cloud_inbox_media("campaign:item-1", {
            "branch_id": "b", "permissions": ["whatsapp", "whatsapp-bulk"],
        }))
    assert exc.value.status_code == 403
    loader.assert_not_awaited()