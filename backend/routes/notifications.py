"""Notifications routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])

# ============ MODELS ============

class NotificationCreate(BaseModel):
    title: str
    message: str
    type: str = "info"  # info, warning, success, error
    link: Optional[str] = None

class Notification(BaseModel):
    id: str
    title: str
    message: str
    type: str
    link: Optional[str] = None
    is_read: bool = False
    branch_id: Optional[str] = None
    created_at: str

# ============ ROUTES ============

@router.get("")
async def get_notifications(
    is_read: Optional[bool] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get notifications for the current user's branch"""
    branch_id = current_user.get("branch_id")
    
    query = {}
    if branch_id:
        query["branch_id"] = branch_id
    if is_read is not None:
        query["is_read"] = is_read
    
    notifications = await db.notifications.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return notifications

@router.get("/unread-count")
async def get_unread_count(current_user: dict = Depends(get_current_user)):
    """Get count of unread notifications"""
    branch_id = current_user.get("branch_id")
    
    query = {"is_read": False}
    if branch_id:
        query["branch_id"] = branch_id
    
    count = await db.notifications.count_documents(query)
    return {"unread_count": count}

@router.put("/{notification_id}/read")
async def mark_notification_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Mark a notification as read"""
    result = await db.notifications.update_one(
        {"id": notification_id},
        {"$set": {"is_read": True}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Notification marked as read"}

@router.put("/mark-all-read")
async def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
    """Mark all notifications as read for the current branch"""
    branch_id = current_user.get("branch_id")
    
    query = {}
    if branch_id:
        query["branch_id"] = branch_id
    
    result = await db.notifications.update_many(
        query,
        {"$set": {"is_read": True}}
    )
    return {"message": f"Marked {result.modified_count} notifications as read"}

@router.delete("/{notification_id}")
async def delete_notification(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a notification"""
    result = await db.notifications.delete_one({"id": notification_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Notification deleted"}

@router.post("/check-renewals")
async def check_subscription_renewals(current_user: dict = Depends(get_current_user)):
    """Check for expiring subscriptions and create notifications"""
    branch_id = current_user.get("branch_id")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    # Find members with activities expiring in the next 7 days
    week_later = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")
    
    query = {
        "activities": {
            "$elemMatch": {
                "status": "active",
                "end_date": {"$gte": today, "$lte": week_later}
            }
        }
    }
    if branch_id:
        query["branch_id"] = branch_id
    
    members = await db.members.find(query, {"_id": 0}).to_list(1000)
    
    notifications_created = 0
    for member in members:
        for activity in member.get("activities", []):
            if activity.get("status") == "active":
                end_date = activity.get("end_date", "")
                if today <= end_date <= week_later:
                    # Check if notification already exists
                    existing = await db.notifications.find_one({
                        "type": "renewal_reminder",
                        "member_id": member["id"],
                        "activity_id": activity.get("activity_id"),
                        "created_at": {"$gte": today}
                    })
                    
                    if not existing:
                        notification_id = str(uuid.uuid4())
                        await db.notifications.insert_one({
                            "id": notification_id,
                            "title": "تنبيه تجديد اشتراك",
                            "message": f"اشتراك {member.get('name_ar', '')} في {activity.get('activity_name', '')} ينتهي بتاريخ {end_date}",
                            "type": "renewal_reminder",
                            "member_id": member["id"],
                            "activity_id": activity.get("activity_id"),
                            "is_read": False,
                            "branch_id": branch_id,
                            "created_at": datetime.now(timezone.utc).isoformat()
                        })
                        notifications_created += 1
    
    return {"message": f"Created {notifications_created} renewal notifications"}

@router.get("/expiring-subscriptions")
async def get_expiring_subscriptions(
    days: int = 7,
    current_user: dict = Depends(get_current_user)
):
    """Get list of subscriptions expiring within specified days"""
    branch_id = current_user.get("branch_id")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    future_date = (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d")
    
    query = {
        "activities": {
            "$elemMatch": {
                "status": "active",
                "end_date": {"$gte": today, "$lte": future_date}
            }
        }
    }
    if branch_id:
        query["branch_id"] = branch_id
    
    members = await db.members.find(query, {"_id": 0}).to_list(1000)
    
    expiring = []
    for member in members:
        for activity in member.get("activities", []):
            if activity.get("status") == "active":
                end_date = activity.get("end_date", "")
                if today <= end_date <= future_date:
                    expiring.append({
                        "member_id": member["id"],
                        "member_name": member.get("name_ar", member.get("name", "")),
                        "member_code": member.get("member_code", ""),
                        "phone": member.get("phone", ""),
                        "activity_name": activity.get("activity_name", ""),
                        "end_date": end_date,
                        "days_remaining": (datetime.strptime(end_date, "%Y-%m-%d") - datetime.now(timezone.utc).replace(tzinfo=None)).days
                    })
    
    # Sort by days remaining
    expiring.sort(key=lambda x: x.get("days_remaining", 999))
    
    return expiring
