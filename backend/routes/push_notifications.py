"""
Push Notifications API - نظام إشعارات Push
Web Push Notifications for member portal
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import uuid
import os
import json
from pywebpush import webpush, WebPushException

router = APIRouter(prefix="/push-notifications", tags=["push-notifications"])

# Database connection
from motor.motor_asyncio import AsyncIOMotorClient
mongo_url = os.environ.get('MONGO_URL')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME')]

# VAPID keys for Web Push
# Generate keys: vapid --gen
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', 'BLBx-hf2WrL2qEa0qKb-aCJbcxEvyn62GDTyyP9KTS5K7ZL0K7TfmOKSPqp8vQF0DaG8hgSFYHdBYq_VuaJSbxQ')
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', 'BQv3sSRJtUCFQiEZ6z9IXPKHFuJ6E9d0cL0pFQxXVgM')
VAPID_CLAIMS = {
    "sub": "mailto:admin@globalchampions.sa"
}


# ============ MODELS ============

class PushSubscription(BaseModel):
    endpoint: str
    keys: dict  # Contains p256dh and auth keys


class SubscriptionCreate(BaseModel):
    member_id: str
    subscription: PushSubscription


class NotificationPayload(BaseModel):
    title: str
    body: str
    icon: Optional[str] = "/logo-new.png"
    badge: Optional[str] = "/images/icon-72x72.png"
    url: Optional[str] = "/portal/daily-videos"
    tag: Optional[str] = None
    data: Optional[dict] = None


# ============ ROUTES ============

@router.get("/vapid-public-key")
async def get_vapid_public_key():
    """Get VAPID public key for client subscription"""
    return {"publicKey": VAPID_PUBLIC_KEY}


@router.post("/subscribe")
async def subscribe_to_push(data: SubscriptionCreate):
    """Subscribe a member to push notifications"""
    try:
        subscription_data = {
            "id": str(uuid.uuid4()),
            "member_id": data.member_id,
            "endpoint": data.subscription.endpoint,
            "keys": data.subscription.keys,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "is_active": True
        }
        
        # Check if subscription already exists for this endpoint
        existing = await db.push_subscriptions.find_one({"endpoint": data.subscription.endpoint})
        if existing:
            # Update existing subscription
            await db.push_subscriptions.update_one(
                {"endpoint": data.subscription.endpoint},
                {"$set": {
                    "member_id": data.member_id,
                    "keys": data.subscription.keys,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "is_active": True
                }}
            )
            return {"message": "تم تحديث الاشتراك بنجاح", "status": "updated"}
        
        await db.push_subscriptions.insert_one(subscription_data)
        return {"message": "تم الاشتراك في الإشعارات بنجاح", "status": "created"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل في حفظ الاشتراك: {str(e)}")


@router.post("/unsubscribe")
async def unsubscribe_from_push(endpoint: str):
    """Unsubscribe from push notifications"""
    result = await db.push_subscriptions.update_one(
        {"endpoint": endpoint},
        {"$set": {"is_active": False}}
    )
    
    if result.modified_count == 0:
        return {"message": "الاشتراك غير موجود", "status": "not_found"}
    
    return {"message": "تم إلغاء الاشتراك بنجاح", "status": "unsubscribed"}


@router.get("/subscription-status/{member_id}")
async def get_subscription_status(member_id: str):
    """Check if member has an active push subscription"""
    subscription = await db.push_subscriptions.find_one({
        "member_id": member_id,
        "is_active": True
    })
    
    return {
        "subscribed": subscription is not None,
        "endpoint": subscription.get("endpoint") if subscription else None
    }


async def send_push_notification(subscription: dict, payload: NotificationPayload):
    """Send a push notification to a single subscription"""
    try:
        notification_data = {
            "title": payload.title,
            "body": payload.body,
            "icon": payload.icon,
            "badge": payload.badge,
            "url": payload.url,
            "tag": payload.tag or str(uuid.uuid4()),
            "data": payload.data or {}
        }
        
        webpush(
            subscription_info={
                "endpoint": subscription["endpoint"],
                "keys": subscription["keys"]
            },
            data=json.dumps(notification_data),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS
        )
        return True
        
    except WebPushException as e:
        print(f"Push notification failed: {e}")
        # If subscription is invalid, mark it as inactive
        if e.response and e.response.status_code in [404, 410]:
            await db.push_subscriptions.update_one(
                {"endpoint": subscription["endpoint"]},
                {"$set": {"is_active": False}}
            )
        return False


async def send_notification_to_all_members(payload: NotificationPayload, branch_id: Optional[str] = None):
    """Send push notification to all subscribed members"""
    query = {"is_active": True}
    
    # If branch_id specified, get members of that branch and filter subscriptions
    if branch_id:
        members = await db.members.find(
            {"branch_id": branch_id}, 
            {"_id": 0, "id": 1}
        ).to_list(10000)
        member_ids = [m["id"] for m in members]
        query["member_id"] = {"$in": member_ids}
    
    subscriptions = await db.push_subscriptions.find(query, {"_id": 0}).to_list(10000)
    
    success_count = 0
    fail_count = 0
    
    for sub in subscriptions:
        result = await send_push_notification(sub, payload)
        if result:
            success_count += 1
        else:
            fail_count += 1
    
    return {
        "total": len(subscriptions),
        "success": success_count,
        "failed": fail_count
    }


async def notify_new_video(video_title: str, video_id: str, branch_id: Optional[str] = None):
    """Send notification about a new daily video"""
    payload = NotificationPayload(
        title="🎬 فيديو جديد!",
        body=video_title,
        icon="/logo-new.png",
        url="/portal/daily-videos",
        tag=f"video-{video_id}",
        data={"video_id": video_id, "type": "new_video"}
    )
    
    return await send_notification_to_all_members(payload, branch_id)


def get_notify_new_video_function():
    return notify_new_video


class BroadcastPayload(BaseModel):
    title: str
    body: str
    url: Optional[str] = "/"
    branch_id: Optional[str] = None
    member_ids: Optional[List[str]] = None


@router.post("/broadcast")
async def broadcast_notification(data: BroadcastPayload):
    payload = NotificationPayload(
        title=data.title,
        body=data.body,
        url=data.url or "/",
        tag=f"broadcast-{uuid.uuid4()}"
    )

    if data.member_ids:
        query = {"is_active": True, "member_id": {"$in": data.member_ids}}
        subscriptions = await db.push_subscriptions.find(query, {"_id": 0}).to_list(10000)
        success_count = 0
        fail_count = 0
        for sub in subscriptions:
            result = await send_push_notification(sub, payload)
            if result:
                success_count += 1
            else:
                fail_count += 1
        return {"total": len(subscriptions), "success": success_count, "failed": fail_count}
    else:
        return await send_notification_to_all_members(payload, data.branch_id)


@router.get("/subscribers-count")
async def get_subscribers_count():
    count = await db.push_subscriptions.count_documents({"is_active": True})
    return {"count": count}


@router.get("/subscribers-list")
async def get_subscribers_list():
    subscriptions = await db.push_subscriptions.find(
        {"is_active": True},
        {"_id": 0, "member_id": 1, "created_at": 1, "updated_at": 1}
    ).to_list(10000)

    member_ids = list(set(s["member_id"] for s in subscriptions if s.get("member_id")))

    members = await db.members.find(
        {"id": {"$in": member_ids}},
        {"_id": 0, "id": 1, "name": 1, "phone": 1, "branch_id": 1}
    ).to_list(10000)
    members_map = {m["id"]: m for m in members}

    result = []
    for sub in subscriptions:
        mid = sub.get("member_id", "")
        member = members_map.get(mid, {})
        result.append({
            "member_id": mid,
            "name": member.get("name", mid),
            "phone": member.get("phone", ""),
            "branch_id": member.get("branch_id", ""),
            "subscribed_at": sub.get("updated_at") or sub.get("created_at", "")
        })

    return {"subscribers": result}
