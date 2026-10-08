"""Restore recent WAHA inbound history without triggering customer automations.

Run inside the application container. Dry-run is the default; --apply writes
idempotently using WAHA message IDs. No customer data is printed.
"""

import argparse
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx
from pymongo import MongoClient


def _chat_id(chat):
    value = chat.get("id")
    return value.get("_serialized", "") if isinstance(value, dict) else str(value or "")


def _phone(client, base, session, chat_id):
    if chat_id.endswith("@c.us"):
        return chat_id.split("@", 1)[0]
    if not chat_id.endswith("@lid"):
        return None
    response = client.get(f"{base}/api/{quote(session, safe='')}/lids/{quote(chat_id, safe='')}")
    response.raise_for_status()
    pn = response.json().get("pn")
    return pn.split("@", 1)[0] if isinstance(pn, str) and pn.endswith("@c.us") else None


def _iter_messages(client, base, session, chat_id, since_unix):
    path = f"{base}/api/{quote(session, safe='')}/chats/{quote(chat_id, safe='')}/messages"
    for offset in range(0, 1000, 100):
        response = client.get(path, params={
            "limit": 100, "offset": offset, "downloadMedia": "false",
            "filter.fromMe": "false", "filter.timestamp.gte": since_unix,
        })
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list):
            raise ValueError("Unexpected WAHA message list")
        yield from rows
        if len(rows) < 100:
            return
    raise RuntimeError("A chat exceeded the bounded 1000-message recovery window")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--days", type=int, default=3)
    parser.add_argument("--max-chats", type=int, default=3000)
    args = parser.parse_args()
    if not 1 <= args.days <= 30 or not 1 <= args.max_chats <= 10000:
        parser.error("days or max-chats out of range")
    base = os.environ["WAHA_BASE_URL"].rstrip("/")
    mongo = MongoClient(
        os.environ["MONGO_URL"],
        tls=os.getenv("MONGO_TLS", "false").lower() in ("1", "true", "yes"),
    )
    db = mongo["champions_default"]
    config = db.whatsapp_branch_configs.find_one(
        {"provider": "waha", "enabled": True},
        {"_id": 0, "branch_id": 1, "waha_physical_session_id": 1},
    )
    if not config:
        raise RuntimeError("No enabled WAHA branch")
    session = config["waha_physical_session_id"]
    branch_id = config["branch_id"]
    since_unix = int((datetime.now(timezone.utc) - timedelta(days=args.days)).timestamp())
    counts = {"chats": 0, "inbound": 0, "inserted": 0, "unmapped": 0, "errors": 0}
    with httpx.Client(headers={"X-Api-Key": os.environ["WAHA_API_KEY"]}, timeout=30) as client:
        for offset in range(0, args.max_chats, 100):
            response = client.get(f"{base}/api/{quote(session, safe='')}/chats", params={
                "limit": min(100, args.max_chats - offset), "offset": offset,
            })
            response.raise_for_status()
            chats = response.json()
            if not isinstance(chats, list):
                raise ValueError("Unexpected WAHA chat list")
            for chat in chats:
                counts["chats"] += 1
                chat_id = _chat_id(chat)
                if not chat_id.endswith(("@lid", "@c.us")):
                    continue
                try:
                    phone = _phone(client, base, session, chat_id)
                    if not phone:
                        counts["unmapped"] += 1
                        continue
                    rows = list(_iter_messages(client, base, session, chat_id, since_unix))
                    rows = [m for m in rows if isinstance(m, dict) and not m.get("fromMe")
                            and m.get("id") and int(m.get("timestamp") or 0) >= since_unix]
                    rows.sort(key=lambda m: int(m.get("timestamp") or 0))
                    counts["inbound"] += len(rows)
                    unread_total = max(0, int(chat.get("unreadCount") or 0))
                    conversation_id = f"{branch_id}:{phone}"
                    for index, message in enumerate(rows):
                        timestamp = datetime.fromtimestamp(int(message["timestamp"]), timezone.utc).isoformat()
                        body = message.get("body") or ""
                        kind = message.get("type") or "text"
                        if not args.apply:
                            continue
                        result = db.whatsapp_cloud_messages.update_one(
                            {"branch_id": branch_id, "provider": "waha", "waha_message_id": str(message["id"])},
                            {"$setOnInsert": {
                                "id": str(message["id"]), "conversation_id": conversation_id,
                                "branch_id": branch_id, "provider": "waha",
                                "waha_message_id": str(message["id"]), "direction": "inbound",
                                "phone": phone, "type": kind, "body": body, "status": "received",
                                "unread": index >= len(rows) - unread_total,
                                "created_at": timestamp, "received_at": timestamp,
                                "source": "waha_history",
                            }}, upsert=True,
                        )
                        counts["inserted"] += bool(result.upserted_id)
                    if args.apply and rows:
                        last = rows[-1]
                        last_at = datetime.fromtimestamp(int(last["timestamp"]), timezone.utc).isoformat()
                        existing = db.whatsapp_cloud_conversations.find_one(
                            {"id": conversation_id}, {"_id": 0, "last_message_at": 1}
                        )
                        db.whatsapp_cloud_conversations.update_one(
                            {"id": conversation_id}, {"$setOnInsert": {
                                "id": conversation_id, "branch_id": branch_id,
                                "provider": "waha", "phone": phone,
                                "contact_name": chat.get("name") or phone,
                                "created_at": last_at,
                            }}, upsert=True,
                        )
                        if not existing or str(existing.get("last_message_at") or "") < last_at:
                            db.whatsapp_cloud_conversations.update_one(
                                {"id": conversation_id}, {"$set": {
                                    "last_message": last.get("body") or f"[{last.get('type') or 'message'}]",
                                    "last_message_at": last_at,
                                    "last_inbound_message_id": str(last["id"]),
                                    "last_inbound_at": last_at, "last_direction": "inbound",
                                }},
                            )
                        unread_count = db.whatsapp_cloud_messages.count_documents({
                            "conversation_id": conversation_id, "direction": "inbound", "unread": True,
                        })
                        db.whatsapp_cloud_conversations.update_one(
                            {"id": conversation_id}, {"$set": {"unread_count": unread_count}}
                        )
                except (httpx.HTTPError, ValueError, KeyError, RuntimeError) as exc:
                    counts["errors"] += 1
                    print("chat_error", type(exc).__name__)
            if len(chats) < min(100, args.max_chats - offset):
                break
    print("mode", "apply" if args.apply else "dry-run", counts)


if __name__ == "__main__":
    main()
