"""
Push Notifications API - نظام إشعارات Push
Web Push + Firebase Cloud Messaging for Android
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

# Use centralized database connection
from database import db

VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', 'BLBx-hf2WrL2qEa0qKb-aCJbcxEvyn62GDTyyP9KTS5K7ZL0K7TfmOKSPqp8vQF0DaG8hgSFYHdBYq_VuaJSbxQ')
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', 'BQv3sSRJtUCFQiEZ6z9IXPKHFuJ6E9d0cL0pFQxXVgM')
VAPID_CLAIMS = {
    "sub": "mailto:admin@globalchampions.sa"
}

_firebase_initialized = False

def _init_firebase():
    global _firebase_initialized
    if _firebase_initialized:
        return True
    try:
        import firebase_admin
        from firebase_admin import credentials

        # Check if already initialized by another route/module
        try:
            firebase_admin.get_app()
            _firebase_initialized = True
            return True
        except ValueError:
            pass  # Not yet initialized

        firebase_creds = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
        if firebase_creds:
            cred_dict = json.loads(firebase_creds)
            cred = credentials.Certificate(cred_dict)
            try:
                firebase_admin.initialize_app(cred)
            except ValueError:
                pass  # Already initialized between our check and initialize
            _firebase_initialized = True
            print("Firebase Admin SDK initialized successfully")
            return True

        cred_path = os.path.join(os.path.dirname(__file__), '..', 'firebase-service-account.json')
        if os.path.exists(cred_path):
            cred = credentials.Certificate(cred_path)
            try:
                firebase_admin.initialize_app(cred)
            except ValueError:
                pass
            _firebase_initialized = True
            print("Firebase Admin SDK initialized from file")
            return True

        print("Firebase credentials not found - FCM notifications disabled")
        return False
    except Exception as e:
        print(f"Firebase initialization error: {e}")
        return False


class PushSubscription(BaseModel):
    endpoint: str
    keys: dict


class SubscriptionCreate(BaseModel):
    member_id: str
    subscription: PushSubscription


class NotificationPayload(BaseModel):
    title: str
    body: str
    icon: Optional[str] = "/logo-new.png"
    badge: Optional[str] = "/images/icon-72x72.png"
    image: Optional[str] = None
    url: Optional[str] = "/portal/daily-videos"
    tag: Optional[str] = None
    data: Optional[dict] = None


@router.get("/vapid-public-key")
async def get_vapid_public_key():
    return {"publicKey": VAPID_PUBLIC_KEY}


@router.post("/subscribe")
async def subscribe_to_push(data: SubscriptionCreate):
    try:
        is_fcm = data.subscription.endpoint.startswith('fcm://')
        platform = data.subscription.keys.get('platform', 'web')
        
        subscription_data = {
            "id": str(uuid.uuid4()),
            "member_id": data.member_id,
            "endpoint": data.subscription.endpoint,
            "keys": data.subscription.keys,
            "platform": platform if is_fcm else "web",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "is_active": True
        }
        
        if is_fcm:
            fcm_token = data.subscription.keys.get('fcm_token', '')
            existing = await db.push_subscriptions.find_one({
                "$or": [
                    {"endpoint": data.subscription.endpoint},
                    {"keys.fcm_token": fcm_token, "platform": {"$in": ["android", "ios"]}}
                ]
            })
        else:
            existing = await db.push_subscriptions.find_one({"endpoint": data.subscription.endpoint})
        
        if existing:
            await db.push_subscriptions.update_one(
                {"_id": existing["_id"]},
                {"$set": {
                    "member_id": data.member_id,
                    "endpoint": data.subscription.endpoint,
                    "keys": data.subscription.keys,
                    "platform": platform if is_fcm else "web",
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
    result = await db.push_subscriptions.update_one(
        {"endpoint": endpoint},
        {"$set": {"is_active": False}}
    )
    
    if result.modified_count == 0:
        return {"message": "الاشتراك غير موجود", "status": "not_found"}
    
    return {"message": "تم إلغاء الاشتراك بنجاح", "status": "unsubscribed"}


@router.get("/subscription-status/{member_id}")
async def get_subscription_status(member_id: str):
    subscription = await db.push_subscriptions.find_one({
        "member_id": member_id,
        "is_active": True
    })
    
    return {
        "subscribed": subscription is not None,
        "endpoint": subscription.get("endpoint") if subscription else None,
        "platform": subscription.get("platform", "web") if subscription else None
    }


async def send_fcm_notification(token: str, payload: NotificationPayload):
    import logging
    logger = logging.getLogger(__name__)
    try:
        if not _init_firebase():
            logger.error("Firebase not initialized, skipping FCM notification")
            return False

        from firebase_admin import messaging

        notif_kwargs = {"title": payload.title, "body": payload.body}
        if payload.image:
            notif_kwargs["image"] = payload.image

        message = messaging.Message(
            notification=messaging.Notification(**notif_kwargs),
            data={
                "url": payload.url or "/",
                "tag": payload.tag or "",
                "type": (payload.data or {}).get("type", "general"),
            },
            token=token,
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    icon="ic_launcher",
                    color="#1e40af",
                    sound="default",
                    channel_id="default",
                ),
            ),
        )

        result = messaging.send(message)
        logger.info(f"FCM sent OK: {result}")
        return True

    except Exception as e:
        error_str = str(e)
        logger.error(f"FCM notification failed: {type(e).__name__}: {error_str}")
        if 'NOT_FOUND' in error_str or 'UNREGISTERED' in error_str or 'INVALID_ARGUMENT' in error_str:
            await db.push_subscriptions.update_one(
                {"keys.fcm_token": token},
                {"$set": {"is_active": False}}
            )
        return False


@router.get("/test-send")
async def test_send_notification():
    """Debug endpoint - test FCM send directly"""
    import logging
    logger = logging.getLogger(__name__)
    subs = await db.push_subscriptions.find(
        {"is_active": True, "platform": "android"}, {"_id": 0}
    ).to_list(10)
    if not subs:
        return {"error": "No active Android subscriptions found"}
    results = []
    for sub in subs:
        token = sub.get("keys", {}).get("fcm_token", "")
        payload = NotificationPayload(
            title="🔔 اختبار مباشر",
            body="اختبار إشعار مباشر من السيرفر",
            url="/",
            tag="debug-test"
        )
        try:
            ok = await send_fcm_notification(token, payload)
            results.append({"member": sub.get("member_id", "")[:8], "success": ok})
        except Exception as e:
            results.append({"member": sub.get("member_id", "")[:8], "error": str(e)})
    return {"results": results}


async def send_push_notification(subscription: dict, payload: NotificationPayload):
    platform = subscription.get("platform", "web")
    
    if platform in ["android", "ios"]:
        fcm_token = subscription.get("keys", {}).get("fcm_token")
        if fcm_token:
            return await send_fcm_notification(fcm_token, payload)
        return False
    
    try:
        notification_data = {
            "title": payload.title,
            "body": payload.body,
            "icon": payload.icon,
            "badge": payload.badge,
            "image": payload.image or None,
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
        if e.response and e.response.status_code in [404, 410]:
            await db.push_subscriptions.update_one(
                {"endpoint": subscription["endpoint"]},
                {"$set": {"is_active": False}}
            )
        return False


async def send_notification_to_all_members(payload: NotificationPayload, branch_id: Optional[str] = None):
    query = {"is_active": True}
    
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


async def notify_new_video(video_title: str, video_id: str, branch_id: Optional[str] = None, youtube_id: Optional[str] = None):
    thumbnail = f"https://img.youtube.com/vi/{youtube_id}/hqdefault.jpg" if youtube_id else None
    payload = NotificationPayload(
        title="🎬 فيديو جديد!",
        body=video_title,
        icon="/logo-new.png",
        image=thumbnail,
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
    image: Optional[str] = None
    branch_id: Optional[str] = None
    member_ids: Optional[List[str]] = None


@router.post("/broadcast")
async def broadcast_notification(data: BroadcastPayload):
    payload = NotificationPayload(
        title=data.title,
        body=data.body,
        image=data.image or None,
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
    total = await db.push_subscriptions.count_documents({"is_active": True})
    web_count = await db.push_subscriptions.count_documents({"is_active": True, "platform": "web"})
    android_count = await db.push_subscriptions.count_documents({"is_active": True, "platform": "android"})
    return {"count": total, "web": web_count, "android": android_count}


@router.get("/subscribers-list")
async def get_subscribers_list():
    subscriptions = await db.push_subscriptions.find(
        {"is_active": True},
        {"_id": 0, "member_id": 1, "created_at": 1, "updated_at": 1, "platform": 1}
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
        name = member.get("name", "") or member.get("phone", "") or mid
        result.append({
            "member_id": mid,
            "name": name,
            "phone": member.get("phone", ""),
            "branch_id": member.get("branch_id", ""),
            "platform": sub.get("platform", "web"),
            "subscribed_at": sub.get("updated_at") or sub.get("created_at", "")
        })

    return {"subscribers": result}
