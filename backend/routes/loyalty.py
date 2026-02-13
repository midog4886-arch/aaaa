"""
نظام الولاء - Loyalty System API
================================
- إدارة النقاط
- المكافآت
- مستويات العضوية
- الإحالات
- تعديل النقاط يدوياً
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
from bson import ObjectId
import random
import string

router = APIRouter(prefix="/loyalty", tags=["Loyalty"])

# Database connection will be set from server.py
db = None

def set_database(database):
    global db
    db = database

# ============== Models ==============

class PointsSettings(BaseModel):
    attendance_points: int = 10
    streak_5_days_bonus: int = 50
    streak_10_days_bonus: int = 100
    monthly_renewal_points: int = 100
    quarterly_renewal_points: int = 250
    yearly_renewal_points: int = 500
    referral_points: int = 200
    coach_rating_points: int = 5
    video_watch_points: int = 3
    birthday_points: int = 100

class LevelSettings(BaseModel):
    bronze_min: int = 0
    silver_min: int = 500
    gold_min: int = 1500
    diamond_min: int = 3000
    silver_discount: float = 3.0
    gold_discount: float = 5.0
    diamond_discount: float = 10.0

class RewardCreate(BaseModel):
    name_ar: str
    name_en: str
    description_ar: Optional[str] = ""
    description_en: Optional[str] = ""
    points_required: int
    reward_type: str  # discount, product, session
    discount_percentage: Optional[float] = 0
    quantity_available: Optional[int] = -1  # -1 = unlimited
    is_active: bool = True
    image_url: Optional[str] = ""

class ManualPointsAdjust(BaseModel):
    member_id: str
    points: int  # positive or negative
    reason: str
    admin_notes: Optional[str] = ""

class RedemptionRequest(BaseModel):
    reward_id: str
    notes: Optional[str] = ""

class RedemptionStatusUpdate(BaseModel):
    status: str  # approved, delivered, rejected
    admin_notes: Optional[str] = ""

# ============== Helper Functions ==============

def generate_referral_code(member_name: str) -> str:
    """Generate unique referral code"""
    name_part = ''.join(c for c in member_name[:4].upper() if c.isalpha())
    random_part = ''.join(random.choices(string.digits, k=4))
    return f"{name_part}{random_part}"

def calculate_level(total_points: int, settings: dict) -> dict:
    """Calculate member level based on total points"""
    if total_points >= settings.get('diamond_min', 3000):
        return {
            'level': 'diamond',
            'level_ar': 'ماسي',
            'level_en': 'Diamond',
            'icon': '💎',
            'discount': settings.get('diamond_discount', 10.0),
            'next_level': None,
            'points_to_next': 0
        }
    elif total_points >= settings.get('gold_min', 1500):
        return {
            'level': 'gold',
            'level_ar': 'ذهبي',
            'level_en': 'Gold',
            'icon': '🥇',
            'discount': settings.get('gold_discount', 5.0),
            'next_level': 'diamond',
            'points_to_next': settings.get('diamond_min', 3000) - total_points
        }
    elif total_points >= settings.get('silver_min', 500):
        return {
            'level': 'silver',
            'level_ar': 'فضي',
            'level_en': 'Silver',
            'icon': '🥈',
            'discount': settings.get('silver_discount', 3.0),
            'next_level': 'gold',
            'points_to_next': settings.get('gold_min', 1500) - total_points
        }
    else:
        return {
            'level': 'bronze',
            'level_ar': 'برونزي',
            'level_en': 'Bronze',
            'icon': '🥉',
            'discount': 0,
            'next_level': 'silver',
            'points_to_next': settings.get('silver_min', 500) - total_points
        }

def serialize_doc(doc):
    """Convert MongoDB document to JSON serializable format"""
    if doc is None:
        return None
    doc['id'] = str(doc.pop('_id'))
    return doc

# ============== Settings Endpoints ==============

@router.get("/settings/points")
async def get_points_settings():
    """Get points earning settings"""
    settings = await db.loyalty_settings.find_one({"type": "points"})
    if not settings:
        # Return defaults
        default = PointsSettings()
        return default.model_dump()
    return serialize_doc(settings)

@router.put("/settings/points")
async def update_points_settings(settings: PointsSettings):
    """Update points earning settings"""
    await db.loyalty_settings.update_one(
        {"type": "points"},
        {"$set": {**settings.model_dump(), "type": "points", "updated_at": datetime.now(timezone.utc)}},
        upsert=True
    )
    return {"message": "تم تحديث إعدادات النقاط بنجاح"}

@router.get("/settings/levels")
async def get_level_settings():
    """Get membership level settings"""
    settings = await db.loyalty_settings.find_one({"type": "levels"})
    if not settings:
        default = LevelSettings()
        return default.model_dump()
    return serialize_doc(settings)

@router.put("/settings/levels")
async def update_level_settings(settings: LevelSettings):
    """Update membership level settings"""
    await db.loyalty_settings.update_one(
        {"type": "levels"},
        {"$set": {**settings.model_dump(), "type": "levels", "updated_at": datetime.now(timezone.utc)}},
        upsert=True
    )
    return {"message": "تم تحديث إعدادات المستويات بنجاح"}

# ============== Member Points Endpoints ==============

@router.get("/members/{member_id}/points")
async def get_member_points(member_id: str):
    """Get member's loyalty points and level"""
    member_points = await db.member_points.find_one({"member_id": member_id})
    
    if not member_points:
        # Initialize points for new member
        member = await db.members.find_one({"_id": ObjectId(member_id)})
        if not member:
            raise HTTPException(status_code=404, detail="العضو غير موجود")
        
        referral_code = generate_referral_code(member.get('name_ar', 'MEMBER'))
        member_points = {
            "member_id": member_id,
            "total_points": 0,
            "available_points": 0,
            "referral_code": referral_code,
            "referred_by": None,
            "referral_count": 0,
            "attendance_streak": 0,
            "last_attendance_date": None,
            "created_at": datetime.now(timezone.utc)
        }
        await db.member_points.insert_one(member_points)
    
    # Get level settings
    level_settings = await db.loyalty_settings.find_one({"type": "levels"})
    if not level_settings:
        level_settings = LevelSettings().model_dump()
    
    level_info = calculate_level(member_points.get('total_points', 0), level_settings)
    
    return {
        "member_id": member_id,
        "total_points": member_points.get('total_points', 0),
        "available_points": member_points.get('available_points', 0),
        "referral_code": member_points.get('referral_code', ''),
        "referral_count": member_points.get('referral_count', 0),
        "attendance_streak": member_points.get('attendance_streak', 0),
        **level_info
    }

@router.get("/members/{member_id}/history")
async def get_member_points_history(member_id: str, limit: int = 50):
    """Get member's points history"""
    history = await db.points_history.find(
        {"member_id": member_id}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    
    return [serialize_doc(h) for h in history]

@router.post("/members/adjust")
async def adjust_member_points(adjustment: ManualPointsAdjust):
    """Manually adjust member points (admin only)"""
    member = await db.members.find_one({"_id": ObjectId(adjustment.member_id)})
    if not member:
        raise HTTPException(status_code=404, detail="العضو غير موجود")
    
    # Update points
    await db.member_points.update_one(
        {"member_id": adjustment.member_id},
        {
            "$inc": {
                "total_points": adjustment.points if adjustment.points > 0 else 0,
                "available_points": adjustment.points
            }
        },
        upsert=True
    )
    
    # Log the adjustment
    await db.points_history.insert_one({
        "member_id": adjustment.member_id,
        "points": adjustment.points,
        "action_type": "manual_adjustment",
        "description_ar": f"تعديل يدوي: {adjustment.reason}",
        "description_en": f"Manual adjustment: {adjustment.reason}",
        "admin_notes": adjustment.admin_notes,
        "created_at": datetime.now(timezone.utc)
    })
    
    # Create notification
    await db.member_notifications.insert_one({
        "member_id": adjustment.member_id,
        "title_ar": "تعديل على نقاطك",
        "title_en": "Points Adjustment",
        "message_ar": f"تم {'إضافة' if adjustment.points > 0 else 'خصم'} {abs(adjustment.points)} نقطة. السبب: {adjustment.reason}",
        "message_en": f"{abs(adjustment.points)} points {'added' if adjustment.points > 0 else 'deducted'}. Reason: {adjustment.reason}",
        "type": "loyalty",
        "is_read": False,
        "created_at": datetime.now(timezone.utc)
    })
    
    return {"message": "تم تعديل النقاط بنجاح", "points_adjusted": adjustment.points}

# ============== Award Points (Internal) ==============

async def award_points(member_id: str, action_type: str, description_ar: str, description_en: str, custom_points: int = None):
    """Award points to member based on action"""
    # Get points settings
    settings = await db.loyalty_settings.find_one({"type": "points"})
    if not settings:
        settings = PointsSettings().model_dump()
    
    # Determine points based on action
    points_map = {
        "attendance": settings.get('attendance_points', 10),
        "streak_5": settings.get('streak_5_days_bonus', 50),
        "streak_10": settings.get('streak_10_days_bonus', 100),
        "monthly_renewal": settings.get('monthly_renewal_points', 100),
        "quarterly_renewal": settings.get('quarterly_renewal_points', 250),
        "yearly_renewal": settings.get('yearly_renewal_points', 500),
        "referral": settings.get('referral_points', 200),
        "coach_rating": settings.get('coach_rating_points', 5),
        "video_watch": settings.get('video_watch_points', 3),
        "birthday": settings.get('birthday_points', 100),
    }
    
    points = custom_points if custom_points is not None else points_map.get(action_type, 0)
    
    if points <= 0:
        return
    
    # Update member points
    await db.member_points.update_one(
        {"member_id": member_id},
        {
            "$inc": {
                "total_points": points,
                "available_points": points
            }
        },
        upsert=True
    )
    
    # Log points history
    await db.points_history.insert_one({
        "member_id": member_id,
        "points": points,
        "action_type": action_type,
        "description_ar": description_ar,
        "description_en": description_en,
        "created_at": datetime.now(timezone.utc)
    })
    
    # Check for level up
    member_points = await db.member_points.find_one({"member_id": member_id})
    if member_points:
        level_settings = await db.loyalty_settings.find_one({"type": "levels"})
        if not level_settings:
            level_settings = LevelSettings().model_dump()
        
        new_level = calculate_level(member_points['total_points'], level_settings)
        old_level = calculate_level(member_points['total_points'] - points, level_settings)
        
        if new_level['level'] != old_level['level']:
            # Level up notification
            await db.member_notifications.insert_one({
                "member_id": member_id,
                "title_ar": f"مبروك! ترقيت للمستوى {new_level['level_ar']} {new_level['icon']}",
                "title_en": f"Congratulations! You've reached {new_level['level_en']} level {new_level['icon']}",
                "message_ar": f"لقد وصلت إلى المستوى {new_level['level_ar']}! تحصل الآن على خصم {new_level['discount']}% على جميع التجديدات.",
                "message_en": f"You've reached {new_level['level_en']} level! You now get {new_level['discount']}% discount on all renewals.",
                "type": "loyalty_level_up",
                "is_read": False,
                "created_at": datetime.now(timezone.utc)
            })

# ============== Rewards Endpoints ==============

@router.get("/rewards")
async def get_rewards(active_only: bool = False):
    """Get all rewards"""
    query = {"is_active": True} if active_only else {}
    rewards = await db.loyalty_rewards.find(query).sort("points_required", 1).to_list(100)
    return [serialize_doc(r) for r in rewards]

@router.post("/rewards")
async def create_reward(reward: RewardCreate):
    """Create a new reward"""
    reward_doc = {
        **reward.model_dump(),
        "redeemed_count": 0,
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.loyalty_rewards.insert_one(reward_doc)
    return {"message": "تم إنشاء المكافأة بنجاح", "id": str(result.inserted_id)}

@router.put("/rewards/{reward_id}")
async def update_reward(reward_id: str, reward: RewardCreate):
    """Update a reward"""
    result = await db.loyalty_rewards.update_one(
        {"_id": ObjectId(reward_id)},
        {"$set": {**reward.model_dump(), "updated_at": datetime.now(timezone.utc)}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="المكافأة غير موجودة")
    return {"message": "تم تحديث المكافأة بنجاح"}

@router.delete("/rewards/{reward_id}")
async def delete_reward(reward_id: str):
    """Delete a reward"""
    result = await db.loyalty_rewards.delete_one({"_id": ObjectId(reward_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="المكافأة غير موجودة")
    return {"message": "تم حذف المكافأة بنجاح"}

# ============== Redemption Endpoints ==============

@router.post("/redeem/{member_id}")
async def redeem_reward(member_id: str, request: RedemptionRequest):
    """Redeem a reward"""
    # Get reward
    reward = await db.loyalty_rewards.find_one({"_id": ObjectId(request.reward_id)})
    if not reward:
        raise HTTPException(status_code=404, detail="المكافأة غير موجودة")
    
    if not reward.get('is_active', True):
        raise HTTPException(status_code=400, detail="هذه المكافأة غير متاحة حالياً")
    
    # Check quantity
    if reward.get('quantity_available', -1) != -1 and reward.get('quantity_available', 0) <= 0:
        raise HTTPException(status_code=400, detail="هذه المكافأة نفدت")
    
    # Get member points
    member_points = await db.member_points.find_one({"member_id": member_id})
    if not member_points:
        raise HTTPException(status_code=404, detail="لم يتم العثور على نقاط العضو")
    
    if member_points.get('available_points', 0) < reward['points_required']:
        raise HTTPException(status_code=400, detail="نقاطك غير كافية لاستبدال هذه المكافأة")
    
    # Deduct points
    await db.member_points.update_one(
        {"member_id": member_id},
        {"$inc": {"available_points": -reward['points_required']}}
    )
    
    # Update reward quantity if limited
    if reward.get('quantity_available', -1) != -1:
        await db.loyalty_rewards.update_one(
            {"_id": ObjectId(request.reward_id)},
            {"$inc": {"quantity_available": -1, "redeemed_count": 1}}
        )
    else:
        await db.loyalty_rewards.update_one(
            {"_id": ObjectId(request.reward_id)},
            {"$inc": {"redeemed_count": 1}}
        )
    
    # Create redemption request
    redemption = {
        "member_id": member_id,
        "reward_id": request.reward_id,
        "reward_name_ar": reward['name_ar'],
        "reward_name_en": reward['name_en'],
        "reward_type": reward['reward_type'],
        "points_used": reward['points_required'],
        "discount_percentage": reward.get('discount_percentage', 0),
        "status": "pending",
        "member_notes": request.notes,
        "admin_notes": "",
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.redemption_requests.insert_one(redemption)
    
    # Log points history
    await db.points_history.insert_one({
        "member_id": member_id,
        "points": -reward['points_required'],
        "action_type": "redemption",
        "description_ar": f"استبدال: {reward['name_ar']}",
        "description_en": f"Redemption: {reward['name_en']}",
        "created_at": datetime.now(timezone.utc)
    })
    
    # Notification
    await db.member_notifications.insert_one({
        "member_id": member_id,
        "title_ar": "تم استلام طلب الاستبدال",
        "title_en": "Redemption Request Received",
        "message_ar": f"تم استلام طلبك لاستبدال {reward['name_ar']}. سيتم مراجعته قريباً.",
        "message_en": f"Your request to redeem {reward['name_en']} has been received. It will be reviewed soon.",
        "type": "loyalty",
        "is_read": False,
        "created_at": datetime.now(timezone.utc)
    })
    
    return {"message": "تم تقديم طلب الاستبدال بنجاح", "redemption_id": str(result.inserted_id)}

@router.get("/redemptions")
async def get_all_redemptions(status: str = None, limit: int = 100):
    """Get all redemption requests (admin)"""
    query = {}
    if status:
        query["status"] = status
    
    redemptions = await db.redemption_requests.find(query).sort("created_at", -1).limit(limit).to_list(limit)
    
    # Enrich with member info
    for r in redemptions:
        member = await db.members.find_one({"_id": ObjectId(r['member_id'])})
        if member:
            r['member_name'] = member.get('name_ar', '')
            r['member_code'] = member.get('member_code', '')
    
    return [serialize_doc(r) for r in redemptions]

@router.get("/redemptions/member/{member_id}")
async def get_member_redemptions(member_id: str):
    """Get member's redemption requests"""
    redemptions = await db.redemption_requests.find(
        {"member_id": member_id}
    ).sort("created_at", -1).to_list(50)
    
    return [serialize_doc(r) for r in redemptions]

@router.put("/redemptions/{redemption_id}/status")
async def update_redemption_status(redemption_id: str, update: RedemptionStatusUpdate):
    """Update redemption request status (admin)"""
    redemption = await db.redemption_requests.find_one({"_id": ObjectId(redemption_id)})
    if not redemption:
        raise HTTPException(status_code=404, detail="طلب الاستبدال غير موجود")
    
    # If rejecting, refund points
    if update.status == "rejected" and redemption['status'] == 'pending':
        await db.member_points.update_one(
            {"member_id": redemption['member_id']},
            {"$inc": {"available_points": redemption['points_used']}}
        )
        
        # Restore reward quantity if limited
        reward = await db.loyalty_rewards.find_one({"_id": ObjectId(redemption['reward_id'])})
        if reward and reward.get('quantity_available', -1) != -1:
            await db.loyalty_rewards.update_one(
                {"_id": ObjectId(redemption['reward_id'])},
                {"$inc": {"quantity_available": 1, "redeemed_count": -1}}
            )
    
    # Update status
    await db.redemption_requests.update_one(
        {"_id": ObjectId(redemption_id)},
        {
            "$set": {
                "status": update.status,
                "admin_notes": update.admin_notes,
                "updated_at": datetime.now(timezone.utc)
            }
        }
    )
    
    # Notification
    status_messages = {
        "approved": ("تمت الموافقة على طلبك", "Your request has been approved"),
        "delivered": ("تم تسليم مكافأتك", "Your reward has been delivered"),
        "rejected": ("تم رفض طلبك", "Your request has been rejected")
    }
    
    msg = status_messages.get(update.status, ("تم تحديث حالة طلبك", "Your request status has been updated"))
    
    await db.member_notifications.insert_one({
        "member_id": redemption['member_id'],
        "title_ar": msg[0],
        "title_en": msg[1],
        "message_ar": f"{msg[0]}: {redemption['reward_name_ar']}" + (f"\nملاحظة: {update.admin_notes}" if update.admin_notes else ""),
        "message_en": f"{msg[1]}: {redemption['reward_name_en']}" + (f"\nNote: {update.admin_notes}" if update.admin_notes else ""),
        "type": "loyalty",
        "is_read": False,
        "created_at": datetime.now(timezone.utc)
    })
    
    return {"message": "تم تحديث حالة الطلب بنجاح"}

# ============== Referral Endpoints ==============

@router.post("/referral/apply")
async def apply_referral_code(member_id: str, referral_code: str):
    """Apply referral code for new member"""
    # Check if member already has a referrer
    member_points = await db.member_points.find_one({"member_id": member_id})
    if member_points and member_points.get('referred_by'):
        raise HTTPException(status_code=400, detail="لقد استخدمت كود إحالة من قبل")
    
    # Find referrer
    referrer = await db.member_points.find_one({"referral_code": referral_code.upper()})
    if not referrer:
        raise HTTPException(status_code=404, detail="كود الإحالة غير صحيح")
    
    if referrer['member_id'] == member_id:
        raise HTTPException(status_code=400, detail="لا يمكنك استخدام كود الإحالة الخاص بك")
    
    # Update new member
    await db.member_points.update_one(
        {"member_id": member_id},
        {"$set": {"referred_by": referrer['member_id']}},
        upsert=True
    )
    
    # Award points to referrer
    await db.member_points.update_one(
        {"member_id": referrer['member_id']},
        {"$inc": {"referral_count": 1}}
    )
    
    await award_points(
        referrer['member_id'],
        "referral",
        "مكافأة إحالة عضو جديد",
        "New member referral bonus"
    )
    
    # Notification to referrer
    new_member = await db.members.find_one({"_id": ObjectId(member_id)})
    await db.member_notifications.insert_one({
        "member_id": referrer['member_id'],
        "title_ar": "🎉 عضو جديد استخدم كود الإحالة الخاص بك",
        "title_en": "🎉 New member used your referral code",
        "message_ar": f"قام {new_member.get('name_ar', 'عضو جديد')} بالتسجيل باستخدام كود الإحالة الخاص بك. تم إضافة نقاط المكافأة لحسابك!",
        "message_en": f"{new_member.get('name_en', 'A new member')} signed up using your referral code. Bonus points added to your account!",
        "type": "loyalty",
        "is_read": False,
        "created_at": datetime.now(timezone.utc)
    })
    
    return {"message": "تم تطبيق كود الإحالة بنجاح"}

# ============== Statistics Endpoints ==============

@router.get("/stats")
async def get_loyalty_stats():
    """Get loyalty program statistics (admin)"""
    # Total points
    pipeline = [
        {"$group": {
            "_id": None,
            "total_points_earned": {"$sum": "$total_points"},
            "total_points_available": {"$sum": "$available_points"},
            "total_members": {"$sum": 1}
        }}
    ]
    points_stats = await db.member_points.aggregate(pipeline).to_list(1)
    points_stats = points_stats[0] if points_stats else {}
    
    # Level distribution
    level_settings = await db.loyalty_settings.find_one({"type": "levels"})
    if not level_settings:
        level_settings = LevelSettings().model_dump()
    
    level_counts = {
        "bronze": 0,
        "silver": 0,
        "gold": 0,
        "diamond": 0
    }
    
    all_members = await db.member_points.find({}).to_list(10000)
    for m in all_members:
        level = calculate_level(m.get('total_points', 0), level_settings)
        level_counts[level['level']] += 1
    
    # Redemption stats
    total_redemptions = await db.redemption_requests.count_documents({})
    pending_redemptions = await db.redemption_requests.count_documents({"status": "pending"})
    
    # Top rewards
    top_rewards = await db.loyalty_rewards.find({"is_active": True}).sort("redeemed_count", -1).limit(5).to_list(5)
    
    return {
        "total_points_earned": points_stats.get('total_points_earned', 0),
        "total_points_available": points_stats.get('total_points_available', 0),
        "total_points_redeemed": points_stats.get('total_points_earned', 0) - points_stats.get('total_points_available', 0),
        "total_members_in_program": points_stats.get('total_members', 0),
        "level_distribution": level_counts,
        "total_redemptions": total_redemptions,
        "pending_redemptions": pending_redemptions,
        "top_rewards": [serialize_doc(r) for r in top_rewards]
    }

@router.get("/leaderboard")
async def get_leaderboard(limit: int = 10):
    """Get top members by points"""
    top_members = await db.member_points.find({}).sort("total_points", -1).limit(limit).to_list(limit)
    
    result = []
    for i, mp in enumerate(top_members):
        member = await db.members.find_one({"_id": ObjectId(mp['member_id'])})
        if member:
            level_settings = await db.loyalty_settings.find_one({"type": "levels"})
            if not level_settings:
                level_settings = LevelSettings().model_dump()
            level_info = calculate_level(mp.get('total_points', 0), level_settings)
            
            result.append({
                "rank": i + 1,
                "member_id": mp['member_id'],
                "member_name": member.get('name_ar', ''),
                "member_code": member.get('member_code', ''),
                "total_points": mp.get('total_points', 0),
                "level": level_info['level'],
                "level_ar": level_info['level_ar'],
                "icon": level_info['icon']
            })
    
    return result

# ============== Birthday Points ==============

@router.post("/process-birthdays")
async def process_birthday_points():
    """Process birthday points for all members with birthdays today"""
    today = datetime.now(timezone.utc)
    today_month_day = today.strftime("%m-%d")
    
    # Find members with birthday today (checking birth_date field)
    members = await db.members.find({}, {"_id": 0, "id": 1, "name_ar": 1, "name_en": 1, "birth_date": 1}).to_list(10000)
    
    birthday_count = 0
    for member in members:
        birth_date = member.get("birth_date", "")
        if not birth_date:
            continue
        
        try:
            # Extract month-day from birth_date (format: YYYY-MM-DD)
            member_month_day = birth_date[5:10]
            
            if member_month_day == today_month_day:
                member_id = member.get("id")
                
                # Check if already awarded today
                existing_award = await db.points_history.find_one({
                    "member_id": member_id,
                    "action_type": "birthday",
                    "created_at": {"$gte": today.replace(hour=0, minute=0, second=0).isoformat()}
                })
                
                if not existing_award:
                    # Award birthday points
                    await award_points(
                        member_id,
                        "birthday",
                        f"🎂 مكافأة عيد ميلاد سعيد!",
                        f"🎂 Happy Birthday bonus!"
                    )
                    
                    # Create notification
                    await db.member_notifications.insert_one({
                        "member_id": member_id,
                        "title_ar": "🎂 عيد ميلاد سعيد!",
                        "title_en": "🎂 Happy Birthday!",
                        "message_ar": "كل عام وأنت بخير! تم إضافة نقاط مكافأة عيد ميلادك لحسابك.",
                        "message_en": "Happy Birthday! Birthday bonus points have been added to your account.",
                        "type": "loyalty_birthday",
                        "is_read": False,
                        "created_at": datetime.now(timezone.utc).isoformat()
                    })
                    
                    birthday_count += 1
        except Exception as e:
            print(f"Error processing birthday for member {member.get('id')}: {e}")
            continue
    
    return {
        "message": f"تمت معالجة {birthday_count} عيد ميلاد",
        "birthdays_processed": birthday_count
    }

@router.get("/birthdays/today")
async def get_today_birthdays():
    """Get list of members with birthdays today"""
    today = datetime.now(timezone.utc)
    today_month_day = today.strftime("%m-%d")
    
    members = await db.members.find({}, {"_id": 0}).to_list(10000)
    
    birthday_members = []
    for member in members:
        birth_date = member.get("birth_date", "")
        if birth_date and len(birth_date) >= 10:
            if birth_date[5:10] == today_month_day:
                birthday_members.append({
                    "id": member.get("id"),
                    "name_ar": member.get("name_ar", ""),
                    "name_en": member.get("name_en", ""),
                    "phone": member.get("phone", ""),
                    "birth_date": birth_date
                })
    
    return birthday_members
