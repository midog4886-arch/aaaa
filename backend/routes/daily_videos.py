"""
Daily Videos API - نظام الفيديوهات اليومية
Videos linked to activities and attendance
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import uuid
import os
import re

router = APIRouter(prefix="/daily-videos", tags=["daily-videos"])

# Loyalty points function - will be set from server.py
loyalty_award_points = None

def set_loyalty_award_function(func):
    global loyalty_award_points
    loyalty_award_points = func

# Push notification function - will be set from server.py
push_notify_new_video = None

def set_push_notify_function(func):
    global push_notify_new_video
    push_notify_new_video = func

# Use centralized database connection
from database import db

# Auth
import jwt
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

JWT_SECRET = os.environ.get('JWT_SECRET_KEY', 'default_secret')
JWT_ALGORITHM = "HS256"
security = HTTPBearer()


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ============ MODELS ============

class DailyVideoBase(BaseModel):
    title: str
    title_ar: str
    youtube_video_id: str
    video_platform: Optional[str] = "youtube"  # "youtube" or "tiktok"
    description: Optional[str] = ""
    description_ar: Optional[str] = ""
    scheduled_date: str  # YYYY-MM-DD format
    activity_id: Optional[str] = None
    activity_name: Optional[str] = ""
    branch_id: Optional[str] = None
    coach_id: Optional[str] = None
    coach_name: Optional[str] = ""
    is_active: bool = True
    tags: List[str] = []
    priority: int = 0  # Higher priority shows first


class DailyVideoCreate(DailyVideoBase):
    pass


class DailyVideoUpdate(DailyVideoBase):
    pass


class DailyVideo(DailyVideoBase):
    id: str
    views_count: int = 0
    created_at: str
    updated_at: str


# ============ HELPER FUNCTIONS ============

def extract_youtube_video_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from various URL formats"""
    if not url:
        return None
    
    # Already a video ID (11 characters)
    if re.match(r'^[a-zA-Z0-9_-]{11}$', url):
        return url
    
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    
    return None


def extract_tiktok_video_id(url: str) -> Optional[str]:
    """Extract TikTok video ID from URL formats"""
    if not url:
        return None
    # Already a numeric ID
    if re.match(r'^\d+$', url):
        return url
    # tiktok.com/@username/video/VIDEO_ID or vm.tiktok.com/VIDEO_ID
    patterns = [
        r'tiktok\.com\/@[^/]+\/video\/(\d+)',
        r'tiktok\.com\/t\/(\w+)',
        r'vm\.tiktok\.com\/(\w+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def detect_video_platform(url: str) -> str:
    """Detect video platform from URL"""
    if not url:
        return "youtube"
    if 'tiktok.com' in url or 'vm.tiktok.com' in url:
        return "tiktok"
    return "youtube"


# ============ ROUTES ============

@router.get("", response_model=List[DailyVideo])
async def get_all_daily_videos(
    activity_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all daily videos (admin/coach)"""
    query = {}
    
    if activity_id:
        query["activity_id"] = activity_id
    
    # Filter by branch for non-admin users
    user_branch = current_user.get("branch_id")
    is_admin = current_user.get("is_admin", False)
    
    if not is_admin and user_branch:
        query["$or"] = [{"branch_id": user_branch}, {"branch_id": None}, {"branch_id": ""}]
    elif branch_id and branch_id != "all":
        query["branch_id"] = branch_id
    
    # Filter by month/year
    if month and year:
        start_date = f"{year}-{month:02d}-01"
        if month == 12:
            end_date = f"{year + 1}-01-01"
        else:
            end_date = f"{year}-{month + 1:02d}-01"
        query["scheduled_date"] = {"$gte": start_date, "$lt": end_date}
    
    videos = await db.daily_videos.find(query, {"_id": 0}).sort("scheduled_date", -1).to_list(1000)
    return videos


@router.get("/today")
async def get_today_videos(
    activity_id: Optional[str] = None,
    branch_id: Optional[str] = None
):
    """Get today's videos (public endpoint for member portal) - supports multiple videos per day"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    query = {
        "scheduled_date": today,
        "is_active": True
    }
    
    if activity_id:
        query["activity_id"] = activity_id
    
    if branch_id:
        query["$or"] = [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": ""}]
    
    videos = await db.daily_videos.find(query, {"_id": 0}).sort("priority", -1).to_list(50)
    
    # Record views for all videos
    for video in videos:
        await db.daily_videos.update_one(
            {"id": video["id"]},
            {"$inc": {"views_count": 1}}
        )
    
    return videos


@router.get("/week")
async def get_week_videos(
    activity_id: Optional[str] = None,
    branch_id: Optional[str] = None
):
    """Get this week's videos (public endpoint for member portal)"""
    today = datetime.now(timezone.utc)
    start_of_week = (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d")
    end_of_week = (today + timedelta(days=6 - today.weekday())).strftime("%Y-%m-%d")
    
    query = {
        "scheduled_date": {"$gte": start_of_week, "$lte": end_of_week},
        "is_active": True
    }
    
    if activity_id:
        query["activity_id"] = activity_id
    
    if branch_id:
        query["$or"] = [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": ""}]
    
    videos = await db.daily_videos.find(query, {"_id": 0}).sort("scheduled_date", 1).to_list(7)
    return videos


@router.get("/by-date/{date}")
async def get_videos_by_date(
    date: str,
    activity_id: Optional[str] = None,
    branch_id: Optional[str] = None
):
    """Get videos for a specific date (public endpoint) - supports multiple videos"""
    query = {
        "scheduled_date": date,
        "is_active": True
    }
    
    if activity_id:
        query["activity_id"] = activity_id
    
    if branch_id:
        query["$or"] = [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": ""}]
    
    videos = await db.daily_videos.find(query, {"_id": 0}).sort("priority", -1).to_list(50)
    
    return videos


@router.get("/calendar/{year}/{month}")
async def get_calendar_videos(
    year: int,
    month: int,
    activity_id: Optional[str] = None,
    branch_id: Optional[str] = None
):
    """Get videos for calendar view - returns dates with video counts"""
    start_date = f"{year}-{month:02d}-01"
    if month == 12:
        end_date = f"{year + 1}-01-01"
    else:
        end_date = f"{year}-{month + 1:02d}-01"
    
    query = {
        "scheduled_date": {"$gte": start_date, "$lt": end_date},
        "is_active": True
    }
    
    if activity_id:
        query["activity_id"] = activity_id
    
    if branch_id:
        query["$or"] = [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": ""}]
    
    videos = await db.daily_videos.find(
        query, 
        {"_id": 0, "id": 1, "scheduled_date": 1, "title_ar": 1, "activity_name": 1, "youtube_video_id": 1}
    ).to_list(100)
    
    # Create a map of date -> videos list (supports multiple videos per day)
    calendar_data = {}
    for video in videos:
        date = video.get("scheduled_date")
        if date not in calendar_data:
            calendar_data[date] = {
                "videos": [],
                "count": 0,
                "has_video": True
            }
        calendar_data[date]["videos"].append({
            "id": video.get("id"),
            "title_ar": video.get("title_ar"),
            "activity_name": video.get("activity_name"),
            "thumbnail": f"https://img.youtube.com/vi/{video.get('youtube_video_id')}/mqdefault.jpg"
        })
        calendar_data[date]["count"] += 1
    
    return calendar_data


@router.get("/{video_id}", response_model=DailyVideo)
async def get_daily_video(video_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single daily video"""
    video = await db.daily_videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return video


@router.post("", response_model=DailyVideo)
async def create_daily_video(
    video: DailyVideoCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a new daily video and send notifications to members"""
    video_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    
    # Use sent platform if available, else detect from URL
    platform = video.video_platform or detect_video_platform(video.youtube_video_id)
    if platform == "tiktok":
        extracted_id = extract_tiktok_video_id(video.youtube_video_id)
        if not extracted_id:
            raise HTTPException(status_code=400, detail="رابط TikTok غير صالح")
        youtube_id = None
    else:
        extracted_id = extract_youtube_video_id(video.youtube_video_id)
        if not extracted_id:
            raise HTTPException(status_code=400, detail="رابط YouTube غير صالح")
        youtube_id = extracted_id

    # Get coach info if not provided
    coach_id = video.coach_id or current_user.get("user_id")
    coach_name = video.coach_name
    if not coach_name:
        user = await db.users.find_one({"id": coach_id}, {"_id": 0, "name": 1})
        coach_name = user.get("name", "") if user else ""
    
    video_doc = {
        "id": video_id,
        "title": video.title,
        "title_ar": video.title_ar,
        "youtube_video_id": extracted_id,
        "video_platform": platform,
        "description": video.description,
        "description_ar": video.description_ar,
        "scheduled_date": video.scheduled_date,
        "activity_id": video.activity_id,
        "activity_name": video.activity_name,
        "branch_id": video.branch_id if video.branch_id != "all" else None,
        "coach_id": coach_id,
        "coach_name": coach_name,
        "is_active": video.is_active,
        "tags": video.tags,
        "views_count": 0,
        "created_at": now,
        "updated_at": now
    }
    
    await db.daily_videos.insert_one(video_doc)
    video_doc.pop("_id", None)
    
    # Create notification for ALL members if video is active and scheduled for today or future
    if video.is_active:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if video.scheduled_date >= today:
            # Get all members to send individual notifications
            members = await db.members.find({}, {"_id": 0, "id": 1}).to_list(10000)
            
            activity_text = f" - {video.activity_name}" if video.activity_name else ""
            
            # Create notification for each member
            notifications_to_insert = []
            for member in members:
                notification_doc = {
                    "member_id": member["id"],
                    "title_ar": "🎬 فيديو تدريبي جديد",
                    "title_en": "🎬 New Training Video",
                    "message_ar": f"تم إضافة فيديو جديد: {video.title_ar}{activity_text}",
                    "message_en": f"New video added: {video.title or video.title_ar}{activity_text}",
                    "type": "new_video",
                    "video_id": video_id,
                    "link": f"/videos?videoId={video_id}",
                    "is_read": False,
                    "created_at": now
                }
                notifications_to_insert.append(notification_doc)
            
            if notifications_to_insert:
                await db.member_notifications.insert_many(notifications_to_insert)
            
            # Send Push Notifications to all subscribed members
            if push_notify_new_video:
                try:
                    push_result = await push_notify_new_video(
                        video_title=video.title_ar,
                        video_id=video_id,
                        branch_id=video.branch_id if video.branch_id != "all" else None,
                        youtube_id=youtube_id
                    )
                    print(f"Push notifications sent: {push_result}")
                except Exception as e:
                    print(f"Failed to send push notifications: {e}")
    
    return video_doc


@router.put("/{video_id}", response_model=DailyVideo)
async def update_daily_video(
    video_id: str,
    video: DailyVideoUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update a daily video"""
    existing = await db.daily_videos.find_one({"id": video_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Video not found")
    
    # Use sent platform if available, else detect from URL
    platform = video.video_platform or detect_video_platform(video.youtube_video_id)
    if platform == "tiktok":
        extracted_id = extract_tiktok_video_id(video.youtube_video_id)
        if not extracted_id:
            raise HTTPException(status_code=400, detail="رابط TikTok غير صالح")
    else:
        extracted_id = extract_youtube_video_id(video.youtube_video_id)
        if not extracted_id:
            raise HTTPException(status_code=400, detail="رابط YouTube غير صالح")

    update_data = {
        "title": video.title,
        "title_ar": video.title_ar,
        "youtube_video_id": extracted_id,
        "video_platform": platform,
        "description": video.description,
        "description_ar": video.description_ar,
        "scheduled_date": video.scheduled_date,
        "activity_id": video.activity_id,
        "activity_name": video.activity_name,
        "branch_id": video.branch_id if video.branch_id != "all" else None,
        "coach_id": video.coach_id,
        "coach_name": video.coach_name,
        "is_active": video.is_active,
        "tags": video.tags,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.daily_videos.update_one({"id": video_id}, {"$set": update_data})
    
    updated = await db.daily_videos.find_one({"id": video_id}, {"_id": 0})
    return updated


@router.delete("/{video_id}")
async def delete_daily_video(video_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a daily video"""
    result = await db.daily_videos.delete_one({"id": video_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Video not found")
    return {"message": "تم حذف الفيديو بنجاح"}


@router.post("/{video_id}/view")
async def record_video_view(video_id: str, member_id: Optional[str] = None):
    """Record a view for a video and award loyalty points"""
    result = await db.daily_videos.update_one(
        {"id": video_id},
        {"$inc": {"views_count": 1}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Video not found")
    
    # Award loyalty points for watching video
    if member_id and loyalty_award_points:
        try:
            # Check if member already watched this video today
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            existing_view = await db.video_views.find_one({
                "member_id": member_id,
                "video_id": video_id,
                "date": today
            })
            
            if not existing_view:
                # Record the view
                await db.video_views.insert_one({
                    "id": str(uuid.uuid4()),
                    "member_id": member_id,
                    "video_id": video_id,
                    "date": today,
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
                
                # Get video info
                video = await db.daily_videos.find_one({"id": video_id}, {"_id": 0})
                video_title = video.get("title_ar", "فيديو") if video else "فيديو"
                
                # Award points
                await loyalty_award_points(
                    member_id,
                    "video_watch",
                    f"مكافأة مشاهدة فيديو: {video_title}",
                    f"Video watch bonus: {video.get('title', 'Video') if video else 'Video'}"
                )
        except Exception as e:
            print(f"Error awarding loyalty points for video watch: {e}")
    
    return {"success": True}


@router.get("/stats/summary")
async def get_videos_statistics(
    branch_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get daily videos statistics"""
    query = {}
    
    is_admin = current_user.get("is_admin", False)
    user_branch = current_user.get("branch_id")
    
    if not is_admin and user_branch:
        query["$or"] = [{"branch_id": user_branch}, {"branch_id": None}, {"branch_id": ""}]
    elif branch_id and branch_id != "all":
        query["branch_id"] = branch_id
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    pipeline = [
        {"$match": query},
        {"$group": {
            "_id": None,
            "total_videos": {"$sum": 1},
            "active_videos": {"$sum": {"$cond": [{"$eq": ["$is_active", True]}, 1, 0]}},
            "total_views": {"$sum": "$views_count"},
            "upcoming_count": {"$sum": {"$cond": [{"$gt": ["$scheduled_date", today]}, 1, 0]}},
            "past_count": {"$sum": {"$cond": [{"$lt": ["$scheduled_date", today]}, 1, 0]}}
        }}
    ]
    
    result = await db.daily_videos.aggregate(pipeline).to_list(1)
    
    if result:
        stats = result[0]
        stats.pop("_id", None)
        return stats
    
    return {
        "total_videos": 0,
        "active_videos": 0,
        "total_views": 0,
        "upcoming_count": 0,
        "past_count": 0
    }


@router.get("/activity/{activity_id}/videos")
async def get_videos_by_activity(
    activity_id: str,
    limit: int = 10
):
    """Get recent videos for a specific activity (public)"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    videos = await db.daily_videos.find(
        {
            "activity_id": activity_id,
            "is_active": True,
            "scheduled_date": {"$lte": today}
        },
        {"_id": 0}
    ).sort("scheduled_date", -1).limit(limit).to_list(limit)
    
    return videos
