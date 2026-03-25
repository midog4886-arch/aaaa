"""Internal messaging routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone

from .common import db, get_current_user

router = APIRouter(prefix="/messages", tags=["messages"])


async def send_message_push(member_id: str, subject: str, body: str):
    """Send push notification to member when they receive a message"""
    try:
        from .push_notifications import send_push_notification, NotificationPayload
        sub = await db.push_subscriptions.find_one({"member_id": member_id, "is_active": True})
        if not sub:
            return
        payload = NotificationPayload(
            title=f"✉️ رسالة جديدة: {subject}",
            body=body[:100] + ("..." if len(body) > 100 else ""),
            url="/member-messages",
            tag=f"message-{member_id}",
            data={"type": "message"}
        )
        await send_push_notification(sub, payload)
    except Exception as e:
        print(f"send_message_push error: {e}")


class MessageCreate(BaseModel):
    recipient_member_id: Optional[str] = None
    subject: str
    body: str
    broadcast: bool = False


class MessageReply(BaseModel):
    body: str


@router.post("")
async def send_message(data: MessageCreate, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    sender_name = current_user.get("name", current_user.get("username", "الإدارة"))

    if data.broadcast:
        members = await db.members.find(
            {"status": {"$ne": "deleted"}},
            {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "phone": 1}
        ).to_list(10000)

        messages = []
        for member in members:
            msg_id = str(uuid.uuid4())
            messages.append({
                "id": msg_id,
                "thread_id": msg_id,
                "sender_type": "admin",
                "sender_id": current_user.get("user_id", current_user.get("sub", "")),
                "sender_name": sender_name,
                "recipient_member_id": member["id"],
                "recipient_name": member.get("name_ar", member.get("name", "")),
                "subject": data.subject,
                "body": data.body,
                "is_broadcast": True,
                "read_by_member": False,
                "read_by_admin": True,
                "created_at": now
            })

        if messages:
            await db.messages.insert_many(messages)
            # Send push notification to each member
            for msg in messages:
                try:
                    await send_message_push(msg["recipient_member_id"], data.subject, data.body)
                except Exception:
                    pass

        return {"message": f"تم إرسال الرسالة إلى {len(messages)} عضو", "count": len(messages)}

    if not data.recipient_member_id:
        raise HTTPException(status_code=400, detail="يجب تحديد العضو المستلم")

    member = await db.members.find_one({"id": data.recipient_member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="العضو غير موجود")

    msg_id = str(uuid.uuid4())
    message = {
        "id": msg_id,
        "thread_id": msg_id,
        "sender_type": "admin",
        "sender_id": current_user.get("user_id", current_user.get("sub", "")),
        "sender_name": sender_name,
        "recipient_member_id": member["id"],
        "recipient_name": member.get("name_ar", member.get("name", "")),
        "subject": data.subject,
        "body": data.body,
        "is_broadcast": False,
        "read_by_member": False,
        "read_by_admin": True,
        "created_at": now
    }

    await db.messages.insert_one(message)
    try:
        await send_message_push(member["id"], data.subject, data.body)
    except Exception as e:
        print(f"Message push error: {e}")
    return {"message": "تم إرسال الرسالة بنجاح", "id": msg_id}


@router.get("")
async def get_messages(
    member_id: Optional[str] = None,
    unread_only: bool = False,
    page: int = 1,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if member_id:
        query["recipient_member_id"] = member_id
    if unread_only:
        query["$or"] = [
            {"sender_type": "member", "read_by_admin": False}
        ]

    total = await db.messages.count_documents(query)
    messages = await db.messages.find(
        query, {"_id": 0}
    ).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)

    return {"messages": messages, "total": total, "page": page}


@router.get("/conversations")
async def get_conversations(current_user: dict = Depends(get_current_user)):
    pipeline = [
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": "$recipient_member_id",
            "recipient_name": {"$first": "$recipient_name"},
            "last_message": {"$first": "$body"},
            "last_subject": {"$first": "$subject"},
            "last_sender_type": {"$first": "$sender_type"},
            "last_date": {"$first": "$created_at"},
            "total_messages": {"$sum": 1},
            "unread_count": {"$sum": {
                "$cond": [
                    {"$and": [
                        {"$eq": ["$sender_type", "member"]},
                        {"$eq": ["$read_by_admin", False]}
                    ]},
                    1, 0
                ]
            }}
        }},
        {"$sort": {"last_date": -1}}
    ]

    conversations = await db.messages.aggregate(pipeline).to_list(500)

    for conv in conversations:
        conv["member_id"] = conv.pop("_id")
        member = await db.members.find_one(
            {"id": conv["member_id"]},
            {"_id": 0, "name_ar": 1, "name": 1, "phone": 1, "member_code": 1}
        )
        if member:
            conv["member_name"] = member.get("name_ar", member.get("name", ""))
            conv["member_phone"] = member.get("phone", "")
            conv["member_code"] = member.get("member_code", "")

    return conversations


@router.get("/thread/{member_id}")
async def get_thread(member_id: str, current_user: dict = Depends(get_current_user)):
    messages = await db.messages.find(
        {"recipient_member_id": member_id},
        {"_id": 0}
    ).sort("created_at", 1).to_list(500)

    await db.messages.update_many(
        {"recipient_member_id": member_id, "sender_type": "member", "read_by_admin": False},
        {"$set": {"read_by_admin": True}}
    )

    member = await db.members.find_one({"id": member_id}, {"_id": 0, "name_ar": 1, "name": 1, "phone": 1, "member_code": 1})

    return {
        "messages": messages,
        "member": {
            "id": member_id,
            "name": member.get("name_ar", member.get("name", "")) if member else "",
            "phone": member.get("phone", "") if member else "",
            "member_code": member.get("member_code", "") if member else ""
        } if member else None
    }


@router.post("/thread/{member_id}/reply")
async def admin_reply(member_id: str, data: MessageReply, current_user: dict = Depends(get_current_user)):
    member = await db.members.find_one({"id": member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="العضو غير موجود")

    sender_name = current_user.get("name", current_user.get("username", "الإدارة"))

    last_msg = await db.messages.find_one(
        {"recipient_member_id": member_id},
        {"_id": 0, "subject": 1},
        sort=[("created_at", -1)]
    )

    msg_id = str(uuid.uuid4())
    message = {
        "id": msg_id,
        "thread_id": member_id,
        "sender_type": "admin",
        "sender_id": current_user.get("user_id", current_user.get("sub", "")),
        "sender_name": sender_name,
        "recipient_member_id": member_id,
        "recipient_name": member.get("name_ar", member.get("name", "")),
        "subject": last_msg.get("subject", "رد") if last_msg else "رد",
        "body": data.body,
        "is_broadcast": False,
        "read_by_member": False,
        "read_by_admin": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    await db.messages.insert_one(message)
    try:
        await send_message_push(member_id, message["subject"], data.body)
    except Exception as e:
        print(f"Reply push error: {e}")
    return {"message": "تم إرسال الرد", "id": msg_id}


@router.get("/unread-count")
async def get_unread_count(current_user: dict = Depends(get_current_user)):
    count = await db.messages.count_documents({
        "sender_type": "member",
        "read_by_admin": False
    })
    return {"unread_count": count}


@router.delete("/{message_id}")
async def delete_message(message_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.messages.delete_one({"id": message_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="الرسالة غير موجودة")
    return {"message": "تم حذف الرسالة"}
