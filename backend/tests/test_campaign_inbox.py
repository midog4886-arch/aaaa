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
    assert collection.query["branch_id"] == "a"
    assert collection.query["phone"]["$in"][0] == "966500000001"
    assert len(messages) == 1
    rows = asyncio.run(inbox.conversations(db, {"branch_id": "a"}))
    assert collection.pipeline[0]["$match"]["branch_id"] == "a"
    assert rows[0]["unread_count"] == 0


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