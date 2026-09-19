import asyncio
import json
from datetime import datetime, timezone

import pytest


def test_history_failed_and_pending_are_not_reported_as_accepted():
    assert mod._whatsflow_history_status({"status": "ERROR"}) == "failed"
    assert mod._whatsflow_history_status({"status": "failed"}) == "failed"
    assert mod._whatsflow_history_status({"status": "pending"}) == "pending"
from fastapi import HTTPException
from routes import whatsapp as mod


def matches(row, query):
    for key, value in query.items():
        if key == "$or":
            if not any(matches(row, part) for part in value):
                return False
        elif isinstance(value, dict):
            if "$exists" in value and (key in row) != value["$exists"]:
                return False
            if "$in" in value and row.get(key) not in value["$in"]:
                return False
            if "$lte" in value and (key not in row or row[key] > value["$lte"]):
                return False
            if "$gte" in value and (key not in row or row[key] < value["$gte"]):
                return False
        elif row.get(key) != value:
            return False
    return True


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, key, direction):
        self.rows.sort(key=lambda row: row.get(key) or "", reverse=direction < 0)
        return self

    def limit(self, amount):
        self.rows = self.rows[:amount]
        return self

    async def to_list(self, length=None):
        return self.rows if length is None else self.rows[:length]


class Collection:
    def __init__(self, rows=()):
        self.rows = list(rows)

    async def find_one(self, query, *args):
        return next((r.copy() for r in self.rows if matches(r, query)), None)

    async def create_index(self, *args, **kwargs):
        pass

    def find(self, query, projection=None):
        rows = [r.copy() for r in self.rows if matches(r, query)]
        if projection:
            included = {
                key for key, value in projection.items()
                if value and key != "_id"
            }
            if included:
                rows = [
                    {key: row[key] for key in included if key in row}
                    for row in rows
                ]
        return Cursor(rows)

    async def insert_one(self, row):
        if any(all(r.get(k) == row.get(k) for k in (
            "branch_id", "provider", "provider_message_id"
        )) for r in self.rows):
            raise mod.DuplicateKeyError("duplicate")
        self.rows.append(row.copy())

    async def update_one(self, query, update, upsert=False):
        row = next((r for r in self.rows if matches(r, query)), None)
        inserted = False
        if row is None:
            if not upsert:
                return type("Result", (), {
                    "matched_count": 0, "modified_count": 0,
                })()
            row = dict(query)
            row.update(update.get("$setOnInsert", {}))
            self.rows.append(row)
            inserted = True
        changed = any(
            row.get(key) != value
            for key, value in update.get("$set", {}).items()
        )
        row.update(update.get("$set", {}))
        for key, value in update.get("$inc", {}).items():
            row[key] = row.get(key, 0) + value
            changed = True
        return type("Result", (), {
            "matched_count": int(not inserted),
            "modified_count": int(changed),
        })()

    async def update_many(self, query, update):
        matched = 0
        modified = 0
        for row in self.rows:
            if not matches(row, query):
                continue
            matched += 1
            changed = any(
                row.get(key) != value
                for key, value in update.get("$set", {}).items()
            )
            row.update(update.get("$set", {}))
            for key, value in update.get("$inc", {}).items():
                row[key] = row.get(key, 0) + value
                changed = True
            modified += int(changed)
        return type("Result", (), {
            "matched_count": matched, "modified_count": modified,
        })()


@pytest.fixture
def db(monkeypatch):
    database = {
        "whatsapp_branch_configs": Collection([{
            "branch_id": "a", "provider": "whatsflow",
            "enabled": True, "whatsflow_instance": "instance-a",
        }]),
        "whatsapp_cloud_messages": Collection(),
        "whatsapp_cloud_conversations": Collection([{
            "id": "a:966500000001", "branch_id": "a", "contact_name": "Customer",
            "last_inbound_at": "2026-09-10T10:00:00+00:00",
            "last_inbound_message_id": "seed-inbound",
            "inbound_generation": 1,
            "last_message_at": "2026-09-10T10:00:00+00:00",
            "last_message": "Question", "unread_count": 2,
        }]),
        "whatsapp_campaign_job_items": Collection(),
        "whatsapp_invoice_payment_outbox": Collection(),
        "whatsapp_automated_outbound": Collection(),
        "whatsapp_cloud_outbound_failures": Collection(),
    }
    monkeypatch.setattr(mod, "_db", database)
    async def tenant(slug):
        assert slug == "tenant-a"
        return "token"
    monkeypatch.setattr(mod, "_with_webhook_tenant", tenant)
    monkeypatch.setattr(mod, "reset_current_tenant", lambda token: None)
    monkeypatch.setattr(mod, "_whatsflow_webhook_secret", lambda *args: "test-secret")
    return database


def deliver(*, outbound=True, timestamp="2026-09-10T10:01:00+00:00",
            branch="a", instance="instance-a", secret="test-secret",
             jid="966500000001@s.whatsapp.net", message=None,
             data_fields=None, message_id="message-1"):
    envelope = {
        "event": "messages.upsert", "instance": instance,
        "data": {
            "key": {"id": message_id, "fromMe": outbound, "remoteJid": jid},
            "messageTimestamp": datetime.fromisoformat(timestamp).timestamp(),
            "message": message if message is not None else {"conversation": "Phone reply"},
            "pushName": "Branch owner",
            **(data_fields or {}),
        },
    }
    class Request:
        headers = {"x-webhook-secret": secret}
        async def body(self):
            return json.dumps(envelope).encode()
    return asyncio.run(mod.receive_whatsflow_webhook("tenant-a", branch, Request()))


def test_phone_reply_clears_unread_preserves_customer_and_deduplicates(db):
    deliver()
    deliver()
    messages = db["whatsapp_cloud_messages"].rows
    assert len(messages) == 1
    assert messages[0]["direction"] == "outbound"
    assert messages[0]["status"] == "sent"
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    assert conversation["unread_count"] == 0
    assert conversation["contact_name"] == "Customer"
    assert conversation["last_direction"] == "outbound"
    assert conversation["last_message"] == "Phone reply"


@pytest.mark.parametrize("from_me", [True, "true", " TRUE "])
def test_upsert_accepts_only_canonical_outbound_boolean_forms(db, from_me):
    deliver(data_fields={"fromMe": from_me}, message_id=f"canonical-{from_me}")
    assert db["whatsapp_cloud_messages"].rows[-1]["direction"] == "outbound"


@pytest.mark.parametrize("from_me", [1, "yes", "1", "", None])
def test_upsert_rejects_ambiguous_outbound_boolean_forms(db, from_me):
    before = len(db["whatsapp_cloud_messages"].rows)
    deliver(data_fields={"fromMe": from_me}, message_id=f"ambiguous-{from_me}")
    assert len(db["whatsapp_cloud_messages"].rows) == before


def test_lid_upsert_requires_an_exact_documented_phone_alt(db):
    deliver(
        jid="opaque@lid",
        data_fields={"remoteJidAlt": "966500000001@s.whatsapp.net"},
        message_id="lid-valid",
    )
    assert db["whatsapp_cloud_messages"].rows[-1]["provider_message_id"] == "lid-valid"

    before = len(db["whatsapp_cloud_messages"].rows)
    deliver(
        jid="opaque@lid",
        data_fields={"remoteJidAlt": "not-a-phone@s.whatsapp.net"},
        message_id="lid-invalid",
    )
    assert len(db["whatsapp_cloud_messages"].rows) == before


def test_sync_phone_replies_is_bounded_filtered_idempotent_and_state_neutral(
    db, monkeypatch
):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["provider"] = "whatsflow"
    conversation["phone"] = "966500000001"
    state_before = conversation.copy()
    db["whatsapp_cloud_messages"].rows.append({
        "id": "known-local",
        "conversation_id": conversation["id"],
        "branch_id": "a",
        "provider": "whatsflow",
        "provider_message_id": "known-provider",
        "direction": "outbound",
        "body": "keep original",
        "status": "accepted",
        "source": "automation",
    })
    seen = {}

    class Client:
        async def find_messages(self, remote_jid, from_me, limit):
            seen.update(
                remote_jid=remote_jid, from_me=from_me, limit=limit
            )
            timestamp = datetime(
                2026, 9, 10, 10, 3, tzinfo=timezone.utc
            ).timestamp()
            return True, [
                {
                    "key": {
                        "id": "history-valid",
                        "remoteJid": remote_jid,
                        "fromMe": "true",
                    },
                    "messageTimestamp": timestamp,
                    "status": "DELIVERY_ACK",
                    "message": {"conversation": "Reply from linked phone"},
                },
                {
                    "key": {
                        "id": "known-provider",
                        "remoteJid": remote_jid,
                        "fromMe": True,
                    },
                    "messageTimestamp": timestamp,
                    "message": {"conversation": "must not overwrite"},
                },
                {
                    "key": {
                        "id": "wrong-recipient",
                        "remoteJid": "966599999999@s.whatsapp.net",
                        "fromMe": True,
                    },
                    "messageTimestamp": timestamp,
                    "message": {"conversation": "wrong"},
                },
                {
                    "key": {
                        "id": "inbound",
                        "remoteJid": remote_jid,
                        "fromMe": False,
                    },
                    "messageTimestamp": timestamp,
                    "message": {"conversation": "inbound"},
                },
                {
                    "key": {
                        "id": "private",
                        "remoteJid": remote_jid,
                        "fromMe": True,
                    },
                    "messageTimestamp": timestamp,
                    "message": {
                        "viewOnceMessage": {
                            "message": {"conversation": "private"}
                        }
                    },
                },
            ], None

    monkeypatch.setattr(mod, "_whatsflow_client", lambda config: Client())
    first = asyncio.run(mod.sync_cloud_inbox_phone_replies(
        conversation["id"], current_user={"is_admin": True}
    ))
    second = asyncio.run(mod.sync_cloud_inbox_phone_replies(
        conversation["id"], current_user={"is_admin": True}
    ))

    assert seen == {
        "remote_jid": "966500000001@s.whatsapp.net",
        "from_me": True,
        "limit": 50,
    }
    assert first == {
        "success": True,
        "outcome": "partial",
        "imported": 1,
        "existing": 1,
        "excluded": 3,
        "scanned": 5,
    }
    assert second["imported"] == 0
    assert second["existing"] == 2
    stored = {
        row.get("provider_message_id"): row
        for row in db["whatsapp_cloud_messages"].rows
    }
    assert stored["known-provider"]["body"] == "keep original"
    assert stored["history-valid"]["status"] == "delivered"
    assert stored["history-valid"]["source"] == "history"
    assert stored["history-valid"]["unread"] is False
    assert "human_reply" not in stored["history-valid"]
    assert conversation == state_before


@pytest.mark.parametrize(
    "outbound,message,data_fields,expected",
    [
        (False, {"conversation": "Inbound conversation"}, {}, "Inbound conversation"),
        (True, {"extendedTextMessage": {"text": "Outbound extended"}}, {}, "Outbound extended"),
        (False, {"text": "Inbound message.text"}, {}, "Inbound message.text"),
        (True, {"text": {"body": "Outbound body object"}}, {}, "Outbound body object"),
        (False, {}, {"text": "Inbound data.text"}, "Inbound data.text"),
        (True, {}, {"body": "Outbound data.body"}, "Outbound data.body"),
        (
            False,
            {"ephemeralMessage": {"message": {"conversation": "Ephemeral text"}}},
            {},
            "Ephemeral text",
        ),
        (
            True,
            {"documentWithCaptionMessage": {"message": {
                "documentMessage": {"caption": "Document caption"}
            }}},
            {},
            "Document caption",
        ),
    ],
)
def test_webhook_extracts_supported_inbound_and_outbound_text_variants(
    db, outbound, message, data_fields, expected
):
    deliver(
        outbound=outbound,
        message=message,
        data_fields=data_fields,
        message_id=f"variant-{expected}",
    )
    stored = db["whatsapp_cloud_messages"].rows[-1]
    assert stored["direction"] == ("outbound" if outbound else "inbound")
    assert stored["body"] == expected
    assert isinstance(stored["body"], str)


@pytest.mark.parametrize(
    "message,data_fields",
    [
        ({"conversation": {"body": "not a string"}}, {}),
        ({"extendedTextMessage": {"text": {"body": "not direct text"}}}, {}),
        ({"text": {"unexpected": "not body"}}, {"text": {"unexpected": "also invalid"}}),
        (
            {"viewOnceMessage": {"message": {"conversation": "private"}}},
            {"text": "must not bypass view-once"},
        ),
        (
            {"extendedTextMessage": {
                "contextInfo": {"quotedMessage": {"conversation": "quoted secret"}}
            }},
            {},
        ),
    ],
)
def test_webhook_never_stores_malformed_view_once_or_quoted_objects_as_body(
    db, message, data_fields
):
    deliver(
        outbound=False,
        message=message,
        data_fields=data_fields,
        message_id=f"unsafe-{len(db['whatsapp_cloud_messages'].rows)}",
    )
    stored = db["whatsapp_cloud_messages"].rows[-1]
    assert stored["body"] == ""
    assert isinstance(stored["body"], str)


def test_whatsflow_text_extraction_has_a_hard_size_bound():
    body = mod._extract_whatsflow_body({
        "conversation": "x" * (mod.WHATSFLOW_TEXT_MAX_CHARS + 100),
    })
    assert body == "x" * mod.WHATSFLOW_TEXT_MAX_CHARS


def test_old_reply_does_not_clear_newer_incoming_or_replace_preview(db):
    deliver(timestamp="2026-09-10T09:59:00+00:00")
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    assert conversation["unread_count"] == 2
    assert conversation["last_message"] == "Question"
    assert len(db["whatsapp_cloud_messages"].rows) == 1


def test_explicit_history_recovery_only_fills_body_and_preserves_state(db, monkeypatch):
    original = {
        "id": "local-missing",
        "type": "text",
        "conversation_id": "a:966500000001",
        "branch_id": "a",
        "provider": "whatsflow",
        "provider_message_id": "provider-missing",
        "direction": "inbound",
        "body": "",
        "unread": True,
        "status": "received",
        "needs_reply": True,
    }
    db["whatsapp_cloud_messages"].rows.append(original.copy())
    seen = {}

    class Client:
        async def find_message(self, provider_message_id, from_me):
            seen.update(provider_message_id=provider_message_id, from_me=from_me)
            return True, {
                "key": {"id": provider_message_id, "fromMe": from_me},
                "message": {"extendedTextMessage": {"text": "Recovered safely"}},
            }, None

    monkeypatch.setattr(mod, "_whatsflow_client", lambda config: (
        seen.update(instance=config["whatsflow_instance"]) or Client()
    ))
    result = asyncio.run(mod.recover_cloud_inbox_message_text(
        "local-missing", current_user={"is_admin": True}
    ))

    assert result == {
        "success": True, "body": "Recovered safely", "recovered": True,
    }
    assert seen == {
        "instance": "instance-a",
        "provider_message_id": "provider-missing",
        "from_me": False,
    }
    stored = db["whatsapp_cloud_messages"].rows[-1]
    assert stored["body"] == "Recovered safely"
    for field in ("unread", "status", "needs_reply", "direction"):
        assert stored[field] == original[field]


def test_phone_reply_reconciles_only_older_marked_inbound_messages(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["unread_count"] = 3
    db["whatsapp_cloud_messages"].rows.extend([
        {
            "id": "inbound-old-1", "conversation_id": conversation["id"],
            "branch_id": "a", "provider": "whatsflow",
            "direction": "inbound", "created_at": "2026-09-10T09:58:00+00:00",
            "unread": True,
        },
        {
            "id": "inbound-old-2", "conversation_id": conversation["id"],
            "branch_id": "a", "provider": "whatsflow",
            "direction": "inbound", "created_at": "2026-09-10T09:59:00+00:00",
            "unread": True,
        },
        {
            "id": "inbound-new", "conversation_id": conversation["id"],
            "branch_id": "a", "provider": "whatsflow",
            "direction": "inbound", "created_at": "2026-09-10T10:02:00+00:00",
            "unread": True,
        },
    ])
    conversation["last_inbound_at"] = "2026-09-10T10:02:00+00:00"

    deliver(timestamp="2026-09-10T10:00:00+00:00")

    assert conversation["unread_count"] == 1
    by_id = {
        row.get("id"): row for row in db["whatsapp_cloud_messages"].rows
    }
    assert by_id["inbound-old-1"]["unread"] is False
    assert by_id["inbound-old-2"]["unread"] is False
    assert by_id["inbound-new"]["unread"] is True


def test_phone_reply_mixed_legacy_and_marked_old_inbound_clears_safely(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["unread_count"] = 2
    conversation["last_inbound_at"] = "2026-09-10T09:59:00+00:00"
    conversation["last_inbound_message_id"] = "marked-old"
    conversation["inbound_generation"] = 2
    legacy = {
        "id": "legacy-old", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": "2026-09-10T09:58:00+00:00",
    }
    marked = {
        "id": "marked-old", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": "2026-09-10T09:59:00+00:00", "unread": True,
    }
    db["whatsapp_cloud_messages"].rows.extend([legacy, marked])

    deliver(timestamp="2026-09-10T10:00:00+00:00")

    assert conversation["unread_count"] == 0
    assert marked["unread"] is False
    assert "unread" not in legacy


def test_phone_reply_equal_timestamp_keeps_inbound_unread(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["unread_count"] = 1
    conversation["last_inbound_at"] = "2026-09-10T10:00:00+00:00"
    conversation["last_inbound_message_id"] = "same-second"
    conversation["inbound_generation"] = 2
    inbound = {
        "id": "same-second", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": "2026-09-10T10:00:00+00:00", "unread": True,
    }
    db["whatsapp_cloud_messages"].rows.append(inbound)

    deliver(timestamp="2026-09-10T10:00:00+00:00")

    assert conversation["unread_count"] == 1
    assert inbound["unread"] is True


def test_concurrent_duplicate_reconciliation_uses_transitioned_rows(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["unread_count"] = 2
    old = {
        "id": "inbound-old", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": "2026-09-10T09:59:00+00:00", "unread": True,
    }
    newer = {
        "id": "inbound-new", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": "2026-09-10T10:02:00+00:00", "unread": True,
    }
    db["whatsapp_cloud_messages"].rows.extend([old, newer])
    conversation["last_inbound_at"] = newer["created_at"]
    messages = db["whatsapp_cloud_messages"]
    calls = 0

    async def raced_update(query, update):
        nonlocal calls
        if query.get("unread") is True:
            calls += 1
            call_number = calls
            await asyncio.sleep(0)
            return type("Result", (), {
                "matched_count": 1,
                "modified_count": 1 if call_number == 1 else 0,
            })()
        return await Collection.update_one(messages, query, update)

    messages.update_one = raced_update
    async def run_both():
        await asyncio.gather(
            mod._reconcile_whatsflow_phone_reply_unread(
                conversation["id"], "a", "2026-09-10T10:00:00+00:00"
            ),
            mod._reconcile_whatsflow_phone_reply_unread(
                conversation["id"], "a", "2026-09-10T10:00:00+00:00"
            ),
        )
    asyncio.run(run_both())

    assert calls == 2
    assert conversation["unread_count"] == 1


def test_thread_read_race_preserves_arrival_after_fetch(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["unread_count"] = 2
    conversation["last_inbound_at"] = "2026-09-10T10:00:00+00:00"
    conversation["last_inbound_message_id"] = "marked-inbound"
    conversation["inbound_generation"] = 2
    old = {
        "id": "fetched-old", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": "2026-09-10T10:00:00+00:00", "unread": True,
    }
    db["whatsapp_cloud_messages"].rows.append(old)
    messages = db["whatsapp_cloud_messages"]
    original_update_many = messages.update_many

    async def update_and_arrive(query, update):
        result = await original_update_many(query, update)
        newer = {
            "id": "arrived-after-fetch", "conversation_id": conversation["id"],
            "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
            "created_at": "2026-09-10T10:00:00+00:00", "unread": True,
        }
        messages.rows.append(newer)
        conversation["last_inbound_at"] = newer["created_at"]
        conversation["last_inbound_message_id"] = newer["id"]
        conversation["inbound_generation"] = 3
        conversation["unread_count"] = 3
        return result

    messages.update_many = update_and_arrive
    asyncio.run(mod._mark_cloud_inbound_read(
        conversation["id"], "a", [old]
    ))

    by_id = {row["id"]: row for row in messages.rows}
    assert by_id["fetched-old"]["unread"] is False
    assert by_id["arrived-after-fetch"]["unread"] is True
    assert conversation["unread_count"] == 2


def test_thread_read_mixed_legacy_and_new_clears_when_cutoff_is_safe(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["unread_count"] = 2
    conversation["last_inbound_at"] = "2026-09-10T10:00:00+00:00"
    conversation["last_inbound_message_id"] = "marked-inbound"
    conversation["inbound_generation"] = 2
    legacy = {
        "id": "legacy-inbound", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": "2026-09-10T09:59:00+00:00",
    }
    marked = {
        "id": "marked-inbound", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": "2026-09-10T10:00:00+00:00", "unread": True,
    }
    db["whatsapp_cloud_messages"].rows.extend([legacy, marked])

    asyncio.run(mod._mark_cloud_inbound_read(
        conversation["id"], "a", [legacy, marked]
    ))

    assert conversation["unread_count"] == 0
    assert marked["unread"] is False


def test_thread_read_clears_legacy_row_missing_inbound_identity(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation.pop("last_inbound_message_id")
    conversation.pop("inbound_generation")
    conversation["unread_count"] = 1
    legacy = {
        "id": "legacy-inbound", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": conversation["last_inbound_at"],
    }
    db["whatsapp_cloud_messages"].rows.append(legacy)

    asyncio.run(mod._mark_cloud_inbound_read(
        conversation["id"], "a", [legacy], fetched_complete=True
    ))

    assert conversation["unread_count"] == 0


def test_thread_read_legacy_cas_does_not_overwrite_first_concurrent_inbound(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation.pop("last_inbound_message_id")
    conversation.pop("inbound_generation")
    conversation["unread_count"] = 1
    legacy = {
        "id": "legacy-inbound", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": conversation["last_inbound_at"],
    }
    db["whatsapp_cloud_messages"].rows.append(legacy)
    conversations = db["whatsapp_cloud_conversations"]
    original_update = conversations.update_one

    async def update_after_arrival(query, update, upsert=False):
        if (
            update.get("$set", {}).get("unread_count") == 0
            and "last_inbound_message_id" in query
        ):
            conversation.update({
                "last_inbound_message_id": "first-new-inbound",
                "inbound_generation": 1,
                "last_inbound_at": "2026-09-10T10:01:00+00:00",
                "unread_count": 2,
            })
        return await original_update(query, update, upsert=upsert)

    conversations.update_one = update_after_arrival
    asyncio.run(mod._mark_cloud_inbound_read(
        conversation["id"], "a", [legacy], fetched_complete=True
    ))

    assert conversation["unread_count"] == 2
    assert conversation["last_inbound_message_id"] == "first-new-inbound"


def test_thread_read_incomplete_latest_page_does_not_clear_unseen_legacy(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["unread_count"] = 2
    unseen_legacy = {
        "id": "unseen-legacy", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": "2026-09-10T09:59:00+00:00",
    }
    fetched = {
        "id": "fetched-new", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow", "direction": "inbound",
        "created_at": conversation["last_inbound_at"], "unread": True,
    }
    db["whatsapp_cloud_messages"].rows.extend([unseen_legacy, fetched])

    asyncio.run(mod._mark_cloud_inbound_read(
        conversation["id"], "a", [fetched], fetched_complete=False
    ))

    assert fetched["unread"] is False
    assert "unread" not in unseen_legacy
    assert conversation["unread_count"] == 1


def test_thread_fetches_latest_500_without_marking_unseen_older_message(
    db, monkeypatch
):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["phone"] = "966500000001"
    conversation["unread_count"] = 501
    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    rows = []
    for index in range(501):
        created_at = (
            start.replace(hour=index // 60, minute=index % 60)
            if index < 24 * 60
            else start
        ).isoformat()
        rows.append({
            "id": f"inbound-{index:03d}",
            "conversation_id": conversation["id"],
            "branch_id": "a",
            "provider": "whatsflow",
            "direction": "inbound",
            "created_at": created_at,
            "unread": True,
        })
    conversation["last_inbound_at"] = rows[-1]["created_at"]
    conversation["last_inbound_message_id"] = rows[-1]["id"]
    conversation["inbound_generation"] = 501
    db["whatsapp_cloud_messages"].rows.extend(rows)
    db["branches"] = Collection([{"id": "a", "name": "Branch A"}])

    async def no_campaign_messages(*args, **kwargs):
        return []

    async def passthrough(rows, *args, **kwargs):
        return rows

    monkeypatch.setattr(mod.campaign_inbox, "thread", no_campaign_messages)
    monkeypatch.setattr(
        mod.campaign_inbox,
        "merge_messages",
        lambda cloud, campaign: cloud,
    )
    monkeypatch.setattr(mod, "_enrich_member_phone_matches", passthrough)

    result = asyncio.run(mod.get_cloud_inbox_thread(
        conversation["id"], {"is_admin": True}
    ))

    assert len(result["messages"]) == 500
    assert result["messages"][0]["id"] == "inbound-001"
    assert result["messages"][-1]["id"] == "inbound-500"
    assert rows[0]["unread"] is True
    assert all(row["unread"] is False for row in rows[1:])
    assert conversation["unread_count"] == 1
    # The detail response intentionally retains the pre-mark aggregate value.
    assert result["conversation"]["unread_count"] == 501


def test_common_whatsflow_send_persists_exact_automation_evidence(db, monkeypatch):
    class Client:
        async def send_text(self, *args, **kwargs):
            return True, {"key": {"id": "attendance-send-1"}}, None

    monkeypatch.setattr(mod, "_whatsflow_client", lambda config: Client())
    config = {"branch_id": "a", "provider": "whatsflow", "enabled": True}

    result = asyncio.run(mod._send_whatsflow_message_result(
        "966500000001", "Attendance", config
    ))

    assert result[:2] == (True, "attendance-send-1")
    evidence = db["whatsapp_automated_outbound"].rows
    assert evidence[0]["provider_message_id"] == "attendance-send-1"
    assert evidence[0]["status"] == "sent"
    assert asyncio.run(mod._classify_whatsflow_echo(
        "a", "966500000001", "attendance-send-1"
    )) == "automated"


def test_inflight_whatsflow_automation_echo_is_conservative(db):
    db["whatsapp_automated_outbound"].rows.append({
        "id": "pending-send",
        "branch_id": "a",
        "provider": "whatsflow",
        "phone": "966500000001",
        "status": "unknown",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    assert asyncio.run(mod._classify_whatsflow_echo(
        "a", "966500000001", "untracked-echo"
    )) == "ambiguous_automation"


def test_stale_whatsflow_unknown_send_does_not_block_human_echo(db):
    db["whatsapp_automated_outbound"].rows.append({
        "id": "old-unknown", "branch_id": "a", "provider": "whatsflow",
        "phone": "966500000001", "status": "unknown",
        "created_at": "2020-01-01T00:00:00+00:00",
    })

    assert asyncio.run(mod._classify_whatsflow_echo(
        "a", "966500000001", "later-human-echo"
    )) == "human"


def test_automation_evidence_persistence_fails_closed(db, monkeypatch):
    class FailingEvidence:
        async def insert_one(self, row):
            raise RuntimeError("storage unavailable")

    class Client:
        called = False

        async def send_text(self, *args, **kwargs):
            self.called = True
            return True, {"key": {"id": "must-not-send"}}, None

    client = Client()
    db["whatsapp_automated_outbound"] = FailingEvidence()
    monkeypatch.setattr(mod, "_whatsflow_client", lambda config: client)

    with pytest.raises(RuntimeError, match="automation_evidence_unavailable"):
        asyncio.run(mod._send_whatsflow_message_result(
            "966500000001",
            "Attendance",
            {"branch_id": "a", "provider": "whatsflow", "enabled": True},
        ))
    assert client.called is False


def test_campaign_echo_does_not_clear_unread(db):
    db["whatsapp_campaign_job_items"].rows.append({
        "branch_id": "a", "provider": "whatsflow",
        "provider_message_id": "message-1",
        "communication_kind": "marketing",
    })

    deliver()

    assert db["whatsapp_cloud_conversations"].rows[0]["unread_count"] == 2


def test_failed_receipt_before_whatsflow_echo_is_preserved(db):
    asyncio.run(mod._remember_unmatched_outbound_failure(
        "a", "whatsflow", "message-1", "failed"
    ))

    deliver()

    message = db["whatsapp_cloud_messages"].rows[0]
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    assert message["status"] == "failed"
    assert message["human_reply"] is True
    assert conversation.get("needs_reply") is not False


def test_whatsflow_read_receipt_does_not_clear_unread(db):
    envelope = {
        "event": "messages.update", "instance": "instance-a",
        "data": {
            "key": {"id": "message-1"},
            "status": "read",
        },
    }

    class Request:
        headers = {"x-webhook-secret": "test-secret"}

        async def body(self):
            return json.dumps(envelope).encode()

    asyncio.run(mod.receive_whatsflow_webhook("tenant-a", "a", Request()))

    assert db["whatsapp_cloud_conversations"].rows[0]["unread_count"] == 2


def _read_update(provider_message_id, *, from_me=False):
    envelope = {
        "event": "messages.update", "instance": "instance-a",
        "data": {
            # Evolution API 2.3.7 sends MESSAGES_UPDATE in this flattened
            # shape: keyId/fromMe/status.
            "keyId": provider_message_id,
            "fromMe": from_me,
            "status": "READ",
        },
    }

    class Request:
        headers = {"x-webhook-secret": "test-secret"}

        async def body(self):
            return json.dumps(envelope).encode()

    return asyncio.run(mod.receive_whatsflow_webhook("tenant-a", "a", Request()))


def test_phone_read_marks_exact_inbound_id_and_preserves_other_messages(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["unread_count"] = 2
    db["whatsapp_cloud_messages"].rows.extend([
        {
            "id": "stored-old", "conversation_id": conversation["id"],
            "branch_id": "a", "provider": "whatsflow",
            "provider_message_id": "inbound-old", "direction": "inbound",
            "unread": True,
        },
        {
            "id": "stored-new", "conversation_id": conversation["id"],
            "branch_id": "a", "provider": "whatsflow",
            "provider_message_id": "inbound-new", "direction": "inbound",
            "unread": True,
        },
        {
            "id": "stored-outbound", "conversation_id": conversation["id"],
            "branch_id": "a", "provider": "whatsflow",
            "provider_message_id": "outbound-read", "direction": "outbound",
            "unread": False,
        },
    ])

    _read_update("inbound-old")
    by_provider_id = {
        row.get("provider_message_id"): row
        for row in db["whatsapp_cloud_messages"].rows
    }
    assert by_provider_id["inbound-old"]["unread"] is False
    assert by_provider_id["inbound-new"]["unread"] is True
    assert conversation["unread_count"] == 1

    # Duplicate delivery is a no-op, while a READ for our outbound message
    # remains only a delivery receipt and cannot clear the inbox.
    _read_update("inbound-old")
    _read_update("outbound-read", from_me=True)
    assert conversation["unread_count"] == 1
    assert by_provider_id["outbound-read"]["unread"] is False


@pytest.mark.parametrize("from_me", [False, "false", " FALSE "])
def test_phone_read_accepts_explicit_false_boolean_or_string(db, from_me):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["unread_count"] = 1
    db["whatsapp_cloud_messages"].rows.append({
        "id": "stored-old", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow",
        "provider_message_id": "inbound-old", "direction": "inbound",
        "unread": True,
    })

    _read_update("inbound-old", from_me=from_me)

    assert db["whatsapp_cloud_messages"].rows[0]["unread"] is False
    assert conversation["unread_count"] == 0


@pytest.mark.parametrize("from_me", [True, "true", "yes", 0, 1])
def test_phone_read_rejects_non_false_or_ambiguous_from_me(db, from_me):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["unread_count"] = 1
    db["whatsapp_cloud_messages"].rows.append({
        "id": "stored-old", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow",
        "provider_message_id": "inbound-old", "direction": "inbound",
        "unread": True,
    })

    _read_update("inbound-old", from_me=from_me)

    assert db["whatsapp_cloud_messages"].rows[0]["unread"] is True
    assert conversation["unread_count"] == 1


def test_phone_read_race_with_new_inbound_decrements_only_transitioned_row(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation["unread_count"] = 1
    old = {
        "id": "stored-old", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow",
        "provider_message_id": "inbound-old", "direction": "inbound",
        "unread": True,
    }
    db["whatsapp_cloud_messages"].rows.append(old)
    messages = db["whatsapp_cloud_messages"]
    original_update = messages.update_one

    async def update_and_arrive(query, update, upsert=False):
        result = await original_update(query, update, upsert=upsert)
        if query.get("unread") is True and result.modified_count:
            messages.rows.append({
                "id": "arrived-after-read", "conversation_id": conversation["id"],
                "branch_id": "a", "provider": "whatsflow",
                "provider_message_id": "inbound-new", "direction": "inbound",
                "unread": True,
            })
            conversation["unread_count"] += 1
            conversation["last_inbound_message_id"] = "inbound-new"
            conversation["inbound_generation"] = (
                conversation.get("inbound_generation") or 0
            ) + 1
        return result

    messages.update_one = update_and_arrive
    asyncio.run(mod._mark_whatsflow_inbound_message_read("a", "inbound-old"))

    assert old["unread"] is False
    assert messages.rows[-1]["unread"] is True
    # The identity changed between the row transition and counter update, so
    # the helper conservatively leaves the aggregate untouched rather than
    # hiding the newly arrived unread message.
    assert conversation["unread_count"] == 2


def test_phone_read_does_not_hide_new_inbound_after_thread_clear(db):
    conversation = db["whatsapp_cloud_conversations"].rows[0]
    conversation.update({
        "unread_count": 1,
        "last_inbound_message_id": "seed-inbound",
        "inbound_generation": 1,
    })
    old = {
        "id": "stored-old", "conversation_id": conversation["id"],
        "branch_id": "a", "provider": "whatsflow",
        "provider_message_id": "inbound-old", "direction": "inbound",
        "unread": True,
    }
    db["whatsapp_cloud_messages"].rows.append(old)
    messages = db["whatsapp_cloud_messages"]
    conversations = db["whatsapp_cloud_conversations"]
    original_update = messages.update_one

    async def update_then_thread_clear(query, update, upsert=False):
        result = await original_update(query, update, upsert=upsert)
        if query.get("unread") is True and result.modified_count:
            # Simulate _mark_cloud_inbound_read's successful identity CAS,
            # followed by a new webhook arrival before the phone-read helper's
            # counter update.
            await conversations.update_one(
                {
                    "id": conversation["id"], "branch_id": "a",
                    "unread_count": 1,
                    "last_inbound_message_id": "seed-inbound",
                    "inbound_generation": 1,
                },
                {"$set": {"unread_count": 0}},
            )
            messages.rows.append({
                "id": "arrived-after-thread-clear",
                "conversation_id": conversation["id"], "branch_id": "a",
                "provider": "whatsflow", "provider_message_id": "inbound-new",
                "direction": "inbound", "unread": True,
            })
            conversation.update({
                "unread_count": 1,
                "last_inbound_message_id": "inbound-new",
                "inbound_generation": 2,
            })
        return result

    messages.update_one = update_then_thread_clear
    asyncio.run(mod._mark_whatsflow_inbound_message_read("a", "inbound-old"))

    assert old["unread"] is False
    assert messages.rows[-1]["unread"] is True
    assert conversation["unread_count"] == 1


def test_incoming_still_increments_unread(db):
    deliver(outbound=False)
    assert db["whatsapp_cloud_conversations"].rows[0]["unread_count"] == 3
    assert db["whatsapp_cloud_messages"].rows[0]["direction"] == "inbound"


@pytest.mark.parametrize("params", [
    {"branch": "b"}, {"instance": "wrong-instance"}, {"secret": "invalid"},
])
def test_authentication_and_branch_binding(db, params):
    with pytest.raises(HTTPException) as exc:
        deliver(**params)
    assert exc.value.status_code == 403
    assert not db["whatsapp_cloud_messages"].rows


@pytest.mark.parametrize("jid", ["123@g.us", "status@broadcast", "123@lid"])
def test_non_phone_chats_are_not_misidentified(db, jid):
    deliver(jid=jid)
    assert not db["whatsapp_cloud_messages"].rows


def test_other_branch_conversation_is_untouched(db):
    db["whatsapp_cloud_conversations"].rows.append({
        "id": "b:966500000001", "branch_id": "b", "unread_count": 5,
    })
    deliver()
    assert db["whatsapp_cloud_conversations"].rows[1]["unread_count"] == 5


@pytest.mark.parametrize("endpoint", ["provider", "cloud"])
def test_successful_connection_test_is_saved_without_webhook(db, monkeypatch, endpoint):
    from unittest.mock import AsyncMock
    config = {"provider": "whatsflow", "enabled": True, "branch_id": "a"}
    monkeypatch.setattr(mod, "_get_branch_cloud_config", AsyncMock(return_value=config))
    monkeypatch.setattr(mod, "_require_session_provider_branch", AsyncMock(return_value=config))
    sender = AsyncMock(return_value=(True, "test-message", None))
    monkeypatch.setattr(mod, "_send_session_provider_result", sender)
    handler = mod.branch_provider_test if endpoint == "provider" else mod.test_branch_cloud_config
    model = mod.WAHABranchTestRequest if endpoint == "provider" else mod.BranchCloudTestRequest
    result = asyncio.run(handler("a", model(phone="966500000002", message="Test"),
                                 {"is_admin": True, "id": "admin"}))
    assert result["success"]
    sender.assert_awaited_once()
    message = db["whatsapp_cloud_messages"].rows[0]
    assert message["direction"] == "outbound"
    assert message["body"] == "Test"
    assert message["branch_id"] == "a"
    conversation = db["whatsapp_cloud_conversations"].rows[-1]
    assert conversation["id"] == "a:966500000002"
    assert conversation["last_message"] == "Test"
    assert conversation["unread_count"] == 0


def test_recording_test_deduplicates_echo_and_keeps_unread(db):
    config = {"provider": "whatsflow", "enabled": True}
    deliver()
    asyncio.run(mod._record_branch_test_message(
        "a", "966500000001", "Phone reply", config, "message-1", {"id": "admin"}))
    assert len(db["whatsapp_cloud_messages"].rows) == 1
    assert db["whatsapp_cloud_conversations"].rows[0]["contact_name"] == "Customer"


def test_failed_connection_test_does_not_create_conversation(db, monkeypatch):
    from unittest.mock import AsyncMock
    monkeypatch.setattr(mod, "_require_session_provider_branch", AsyncMock(return_value={
        "provider": "whatsflow", "enabled": True,
    }))
    monkeypatch.setattr(mod, "_send_session_provider_result",
                        AsyncMock(return_value=(False, None, "http_401")))
    with pytest.raises(HTTPException):
        asyncio.run(mod.branch_provider_test(
            "a", mod.WAHABranchTestRequest(phone="966500000002", message="Test"),
            {"is_admin": True}))
    assert not db["whatsapp_cloud_messages"].rows
    assert len(db["whatsapp_cloud_conversations"].rows) == 1