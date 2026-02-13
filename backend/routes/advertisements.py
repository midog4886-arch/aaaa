"""
Advertisements API - نظام الإعلانات
Supports banners, videos (YouTube), and links
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import uuid
import os
import shutil
import re
from pathlib import Path

router = APIRouter(prefix="/advertisements", tags=["advertisements"])

# Get database from server module
from motor.motor_asyncio import AsyncIOMotorClient
mongo_url = os.environ.get('MONGO_URL')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME')]

# Uploads directory for banners
UPLOADS_DIR = Path(__file__).parent.parent / "uploads" / "ads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# ============ MODELS ============

class AdvertisementBase(BaseModel):
    title: str
    title_ar: str
    ad_type: str  # banner, video, link
    position: str  # hero, sidebar, inline, popup
    link_url: Optional[str] = ""
    youtube_video_id: Optional[str] = ""
    banner_image_url: Optional[str] = ""
    description: Optional[str] = ""
    description_ar: Optional[str] = ""
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    priority: int = 0
    is_active: bool = True
    branch_id: Optional[str] = None
    target_audience: str = "all"  # all, members, guests


class AdvertisementCreate(AdvertisementBase):
    pass


class AdvertisementUpdate(AdvertisementBase):
    pass


class Advertisement(AdvertisementBase):
    id: str
    views_count: int = 0
    clicks_count: int = 0
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


# ============ AUTH HELPER ============
# Import from server module
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


# ============ ROUTES ============

@router.get("", response_model=List[Advertisement])
async def get_advertisements(
    branch_filter: Optional[str] = None,
    ad_type: Optional[str] = None,
    position: Optional[str] = None,
    active_only: bool = False,
    current_user: dict = Depends(get_current_user)
):
    """Get all advertisements (admin)"""
    query = {}
    
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    
    if ad_type:
        query["ad_type"] = ad_type
    
    if position:
        query["position"] = position
    
    if active_only:
        query["is_active"] = True
        # Check date validity
        now = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        query["$or"] = [
            {"start_date": {"$lte": now}, "end_date": {"$gte": now}},
            {"start_date": "", "end_date": ""},
            {"start_date": None, "end_date": None},
            {"start_date": {"$lte": now}, "end_date": ""},
            {"start_date": {"$lte": now}, "end_date": None},
        ]
    
    ads = await db.advertisements.find(query, {"_id": 0}).sort([("priority", -1), ("created_at", -1)]).to_list(1000)
    return ads


@router.get("/public")
async def get_public_advertisements(
    branch_id: Optional[str] = None,
    position: Optional[str] = None
):
    """Get active advertisements for public display (member portal)"""
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    query = {
        "is_active": True,
        "$or": [
            {"start_date": {"$lte": now}, "end_date": {"$gte": now}},
            {"start_date": "", "end_date": ""},
            {"start_date": None, "end_date": None},
            {"start_date": {"$lte": now}, "end_date": ""},
            {"start_date": {"$lte": now}, "end_date": None},
            {"start_date": "", "end_date": {"$gte": now}},
            {"start_date": None, "end_date": {"$gte": now}},
        ]
    }
    
    if branch_id and branch_id != "all":
        query["$and"] = [
            {"$or": [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": ""}]}
        ]
    
    if position:
        query["position"] = position
    
    ads = await db.advertisements.find(query, {"_id": 0}).sort([("priority", -1), ("created_at", -1)]).to_list(100)
    return ads


@router.get("/{ad_id}", response_model=Advertisement)
async def get_advertisement(ad_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single advertisement"""
    ad = await db.advertisements.find_one({"id": ad_id}, {"_id": 0})
    if not ad:
        raise HTTPException(status_code=404, detail="Advertisement not found")
    return ad


@router.post("", response_model=Advertisement)
async def create_advertisement(
    ad: AdvertisementCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a new advertisement"""
    ad_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    
    # Extract YouTube video ID if provided
    youtube_id = None
    if ad.ad_type == "video" and ad.youtube_video_id:
        youtube_id = extract_youtube_video_id(ad.youtube_video_id)
        if not youtube_id:
            raise HTTPException(status_code=400, detail="رابط YouTube غير صالح")
    
    ad_doc = {
        "id": ad_id,
        "title": ad.title,
        "title_ar": ad.title_ar,
        "ad_type": ad.ad_type,
        "position": ad.position,
        "link_url": ad.link_url,
        "youtube_video_id": youtube_id or ad.youtube_video_id,
        "banner_image_url": ad.banner_image_url,
        "description": ad.description,
        "description_ar": ad.description_ar,
        "start_date": ad.start_date,
        "end_date": ad.end_date,
        "priority": ad.priority,
        "is_active": ad.is_active,
        "branch_id": ad.branch_id if ad.branch_id != "all" else None,
        "target_audience": ad.target_audience,
        "views_count": 0,
        "clicks_count": 0,
        "created_at": now,
        "updated_at": now
    }
    
    await db.advertisements.insert_one(ad_doc)
    ad_doc.pop("_id", None)
    return ad_doc


@router.post("/upload-banner")
async def upload_banner_image(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Upload a banner image"""
    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="نوع الملف غير مدعوم. يرجى رفع صورة (JPG, PNG, GIF, WEBP)")
    
    # Generate unique filename
    file_ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    filename = f"{uuid.uuid4()}.{file_ext}"
    file_path = UPLOADS_DIR / filename
    
    # Save file
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Return URL
    return {"url": f"/uploads/ads/{filename}", "filename": filename}


@router.put("/{ad_id}", response_model=Advertisement)
async def update_advertisement(
    ad_id: str,
    ad: AdvertisementUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update an advertisement"""
    existing = await db.advertisements.find_one({"id": ad_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Advertisement not found")
    
    # Extract YouTube video ID if provided
    youtube_id = ad.youtube_video_id
    if ad.ad_type == "video" and ad.youtube_video_id:
        youtube_id = extract_youtube_video_id(ad.youtube_video_id)
        if not youtube_id:
            raise HTTPException(status_code=400, detail="رابط YouTube غير صالح")
    
    update_data = {
        "title": ad.title,
        "title_ar": ad.title_ar,
        "ad_type": ad.ad_type,
        "position": ad.position,
        "link_url": ad.link_url,
        "youtube_video_id": youtube_id,
        "banner_image_url": ad.banner_image_url,
        "description": ad.description,
        "description_ar": ad.description_ar,
        "start_date": ad.start_date,
        "end_date": ad.end_date,
        "priority": ad.priority,
        "is_active": ad.is_active,
        "branch_id": ad.branch_id if ad.branch_id != "all" else None,
        "target_audience": ad.target_audience,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.advertisements.update_one({"id": ad_id}, {"$set": update_data})
    
    updated = await db.advertisements.find_one({"id": ad_id}, {"_id": 0})
    return updated


@router.delete("/{ad_id}")
async def delete_advertisement(ad_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an advertisement"""
    ad = await db.advertisements.find_one({"id": ad_id}, {"_id": 0})
    if not ad:
        raise HTTPException(status_code=404, detail="Advertisement not found")
    
    # Delete banner image if exists
    if ad.get("banner_image_url") and ad["banner_image_url"].startswith("/uploads/ads/"):
        filename = ad["banner_image_url"].split("/")[-1]
        file_path = UPLOADS_DIR / filename
        if file_path.exists():
            file_path.unlink()
    
    result = await db.advertisements.delete_one({"id": ad_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Advertisement not found")
    
    return {"message": "تم حذف الإعلان بنجاح"}


@router.post("/{ad_id}/view")
async def record_view(ad_id: str):
    """Record a view for an advertisement (public endpoint)"""
    result = await db.advertisements.update_one(
        {"id": ad_id},
        {"$inc": {"views_count": 1}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Advertisement not found")
    return {"success": True}


@router.post("/{ad_id}/click")
async def record_click(ad_id: str):
    """Record a click for an advertisement (public endpoint)"""
    result = await db.advertisements.update_one(
        {"id": ad_id},
        {"$inc": {"clicks_count": 1}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Advertisement not found")
    return {"success": True}


@router.put("/{ad_id}/toggle")
async def toggle_advertisement(ad_id: str, current_user: dict = Depends(get_current_user)):
    """Toggle advertisement active status"""
    ad = await db.advertisements.find_one({"id": ad_id})
    if not ad:
        raise HTTPException(status_code=404, detail="Advertisement not found")
    
    new_status = not ad.get("is_active", True)
    await db.advertisements.update_one(
        {"id": ad_id},
        {"$set": {"is_active": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"is_active": new_status, "message": "تم تغيير حالة الإعلان"}


@router.get("/stats/summary")
async def get_ads_statistics(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get advertisements statistics summary"""
    query = {}
    if branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    
    pipeline = [
        {"$match": query},
        {"$group": {
            "_id": None,
            "total_ads": {"$sum": 1},
            "active_ads": {"$sum": {"$cond": [{"$eq": ["$is_active", True]}, 1, 0]}},
            "total_views": {"$sum": "$views_count"},
            "total_clicks": {"$sum": "$clicks_count"},
            "banners_count": {"$sum": {"$cond": [{"$eq": ["$ad_type", "banner"]}, 1, 0]}},
            "videos_count": {"$sum": {"$cond": [{"$eq": ["$ad_type", "video"]}, 1, 0]}},
            "links_count": {"$sum": {"$cond": [{"$eq": ["$ad_type", "link"]}, 1, 0]}}
        }}
    ]
    
    result = await db.advertisements.aggregate(pipeline).to_list(1)
    
    if result:
        stats = result[0]
        stats.pop("_id", None)
        # Calculate CTR (Click Through Rate)
        if stats["total_views"] > 0:
            stats["ctr"] = round((stats["total_clicks"] / stats["total_views"]) * 100, 2)
        else:
            stats["ctr"] = 0
        return stats
    
    return {
        "total_ads": 0,
        "active_ads": 0,
        "total_views": 0,
        "total_clicks": 0,
        "banners_count": 0,
        "videos_count": 0,
        "links_count": 0,
        "ctr": 0
    }
