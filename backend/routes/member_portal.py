"""
Member Portal API Routes
- Login with phone number
- View subscriptions, schedule, invoices
- Download QR card
- Notifications
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
import os
import re
import jwt
import uuid

router = APIRouter(prefix="/api/member-portal", tags=["Member Portal"])
security = HTTPBearer()

# Use centralized database connection
from database import db

# JWT Config for members
MEMBER_JWT_SECRET = os.environ.get('JWT_SECRET_KEY', 'default_secret') + "_member"
JWT_ALGORITHM = "HS256"
MEMBER_JWT_EXPIRATION_DAYS = 365 * 100  # Permanent


async def get_member_level_coach_maps(member_id: str):
    """Return (by_activity_id, by_activity_name) coach_id maps from the levels
    this member is currently a member of. Used to resolve a per-LEVEL coach for
    each of the member's activities (since one activity can have many coaches
    across different levels)."""
    member_levels = await db.levels.find(
        {"members": member_id},
        {"_id": 0, "id": 1, "activity_id": 1, "activity_name": 1, "coach_id": 1}
    ).to_list(100)
    by_activity_id = {}
    by_activity_name = {}
    by_level_id = {}
    for lv in member_levels:
        cid = lv.get("coach_id")
        if not cid:
            continue
        aid = lv.get("activity_id")
        aname = lv.get("activity_name")
        lid = lv.get("id")
        if aid:
            by_activity_id[aid] = cid
        if aname:
            by_activity_name[aname] = cid
        if lid:
            by_level_id[lid] = cid
    return by_activity_id, by_activity_name, by_level_id


class MemberLogin(BaseModel):
    phone: str


class MemberTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    member: Dict[str, Any]


def create_member_token(member_id: str, phone: str) -> str:
    """Create JWT token for member"""
    from utils.tenant import get_current_tenant_slug, DEFAULT_TENANT_SLUG
    payload = {
        "member_id": member_id,
        "phone": phone,
        "type": "member",
        "tenant_slug": get_current_tenant_slug() or DEFAULT_TENANT_SLUG,
        "exp": datetime.now(timezone.utc) + timedelta(days=MEMBER_JWT_EXPIRATION_DAYS)
    }
    return jwt.encode(payload, MEMBER_JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_member(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify member JWT token. Also attach `_linked_member_ids` and
    `_linked_members` covering every member that shares the same phone
    (siblings sharing a guardian phone) and aggregate their `activities`
    into the returned member dict so that subscriptions/schedule endpoints
    naturally show all family members together. Each aggregated activity is
    tagged with `_owner_id` and `_owner_name` so the UI can label them."""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, MEMBER_JWT_SECRET, algorithms=[JWT_ALGORITHM])

        if payload.get("type") != "member":
            raise HTTPException(status_code=401, detail="Invalid token type")

        from utils.tenant import get_current_tenant_slug, DEFAULT_TENANT_SLUG
        token_tenant = payload.get("tenant_slug")
        if not token_tenant:
            raise HTTPException(status_code=401, detail="Token missing tenant — please log in again")
        if token_tenant != (get_current_tenant_slug() or DEFAULT_TENANT_SLUG):
            raise HTTPException(status_code=403, detail="Tenant mismatch")

        member_id = payload.get("member_id")
        member = await db.members.find_one({"id": member_id}, {"_id": 0})

        if not member:
            raise HTTPException(status_code=401, detail="Member not found")

        # ── Find sibling members (same phone) ──
        phone = (member.get("phone") or "").strip()
        linked_ids = [member["id"]]
        linked_meta = [{
            "id": member["id"],
            "name": member.get("name_ar") or member.get("name") or "",
            "member_code": member.get("member_code", ""),
            "photo": member.get("photo", ""),
        }]
        if phone:
            sibling_docs = await db.members.find(
                {"phone": phone, "id": {"$ne": member["id"]}},
                {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "member_code": 1, "photo": 1, "activities": 1}
            ).to_list(20)
            for sib in sibling_docs:
                linked_ids.append(sib["id"])
                sib_name = sib.get("name_ar") or sib.get("name") or ""
                linked_meta.append({
                    "id": sib["id"],
                    "name": sib_name,
                    "member_code": sib.get("member_code", ""),
                    "photo": sib.get("photo", ""),
                })
                # Tag and merge sibling activities into the primary member's list
                primary_acts = member.get("activities") or []
                # Tag primary's own activities once
                for a in primary_acts:
                    a.setdefault("_owner_id", member["id"])
                    a.setdefault("_owner_name", member.get("name_ar") or member.get("name") or "")
                    a.setdefault("_owner_member_code", member.get("member_code", ""))
                    a.setdefault("_owner_photo", member.get("photo", ""))
                for a in (sib.get("activities") or []):
                    a["_owner_id"] = sib["id"]
                    a["_owner_name"] = sib_name
                    a["_owner_member_code"] = sib.get("member_code", "")
                    a["_owner_photo"] = sib.get("photo", "")
                    primary_acts.append(a)
                member["activities"] = primary_acts

        # If no siblings, still tag own activities for consistency
        if len(linked_ids) == 1:
            for a in (member.get("activities") or []):
                a.setdefault("_owner_id", member["id"])
                a.setdefault("_owner_name", member.get("name_ar") or member.get("name") or "")
                a.setdefault("_owner_member_code", member.get("member_code", ""))
                a.setdefault("_owner_photo", member.get("photo", ""))

        member["_linked_member_ids"] = linked_ids
        member["_linked_members"] = linked_meta

        return member
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ============ AUTH ============

@router.post("/login", response_model=MemberTokenResponse)
async def member_login(data: MemberLogin):
    """Login with phone number only"""
    phone = data.phone.strip()
    
    # Find member by phone
    member = await db.members.find_one({"phone": phone}, {"_id": 0})
    
    if not member:
        raise HTTPException(status_code=404, detail="رقم الجوال غير مسجل")
    
    # Create token
    token = create_member_token(member["id"], phone)
    
    # Find any sibling members sharing this phone (so the UI can show them)
    linked = [{
        "id": member["id"],
        "name": member.get("name_ar") or member.get("name") or "",
        "member_code": member.get("member_code", ""),
        "photo": member.get("photo", ""),
    }]
    sibling_docs = await db.members.find(
        {"phone": phone, "id": {"$ne": member["id"]}},
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "member_code": 1, "photo": 1}
    ).to_list(20)
    for sib in sibling_docs:
        linked.append({
            "id": sib["id"],
            "name": sib.get("name_ar") or sib.get("name") or "",
            "member_code": sib.get("member_code", ""),
            "photo": sib.get("photo", ""),
        })

    return {
        "access_token": token,
        "token_type": "bearer",
        "member": {
            "id": member["id"],
            "name": member.get("name"),
            "name_ar": member.get("name_ar"),
            "phone": member.get("phone"),
            "member_code": member.get("member_code"),
            "email": member.get("email"),
            "photo": member.get("photo", ""),
            "dark_mode": member.get("preferences", {}).get("dark_mode", False),
            "linked_members": linked,
        }
    }


# ============ PROFILE ============

@router.get("/profile")
async def get_member_profile(member: dict = Depends(get_current_member)):
    """Get member profile"""
    return {
        "id": member["id"],
        "name": member.get("name"),
        "name_ar": member.get("name_ar"),
        "phone": member.get("phone"),
        "email": member.get("email"),
        "member_code": member.get("member_code"),
        "date_of_birth": member.get("date_of_birth"),
        "gender": member.get("gender"),
        "address": member.get("address"),
        "emergency_contact": member.get("emergency_contact"),
        "photo": member.get("photo", ""),
        "created_at": member.get("created_at"),
        "dark_mode": member.get("preferences", {}).get("dark_mode", False)
    }


# ~2MB actual file after base64 overhead (~33%); matches the 2MB file-size
# check applied on the upload form, mirroring the coach-photo validation in
# routes/coaches.py.
MAX_PROFILE_PHOTO_BYTES = 3 * 1024 * 1024


class MemberProfileUpdate(BaseModel):
    """Editable subset of the member profile from the member portal.
    Phone, name, member_code, date_of_birth, gender remain admin-only."""
    email: Optional[str] = None
    address: Optional[str] = None
    emergency_contact: Optional[str] = None
    photo: Optional[str] = None  # base64 data URL, "" to clear


# Lightweight format / length guards for member-editable text fields.
# We keep the email regex deliberately permissive (RFC-style validation is
# brittle and noisy); the real check is "does it look like local@domain.tld".
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
MAX_EMAIL_LEN = 254          # RFC 5321 practical cap
MAX_ADDRESS_LEN = 300        # plenty for street + city + postal
MAX_EMERGENCY_LEN = 200      # name + phone fits comfortably


@router.put("/profile")
async def update_member_profile(
    data: MemberProfileUpdate,
    member: dict = Depends(get_current_member)
):
    """Allow a logged-in member to update their own contact details and
    profile picture. Only fields included in the payload are updated, so the
    same endpoint handles partial saves (e.g. avatar-only)."""
    update_fields: Dict[str, Any] = {}

    if data.email is not None:
        email = data.email.strip()
        if email:
            if len(email) > MAX_EMAIL_LEN:
                raise HTTPException(
                    status_code=400,
                    detail="البريد الإلكتروني طويل جداً"
                )
            if not _EMAIL_RE.match(email):
                raise HTTPException(
                    status_code=400,
                    detail="صيغة البريد الإلكتروني غير صحيحة"
                )
        update_fields["email"] = email

    if data.address is not None:
        address = data.address.strip()
        if len(address) > MAX_ADDRESS_LEN:
            raise HTTPException(
                status_code=400,
                detail="العنوان طويل جداً"
            )
        update_fields["address"] = address

    if data.emergency_contact is not None:
        emergency = data.emergency_contact.strip()
        if len(emergency) > MAX_EMERGENCY_LEN:
            raise HTTPException(
                status_code=400,
                detail="جهة الاتصال للطوارئ طويلة جداً"
            )
        update_fields["emergency_contact"] = emergency

    if data.photo is not None:
        photo = data.photo
        if photo == "":
            update_fields["photo"] = ""
        else:
            if not photo.startswith("data:image/"):
                raise HTTPException(
                    status_code=400,
                    detail="نوع الملف غير مدعوم، يجب أن تكون صورة"
                )
            if len(photo.encode()) > MAX_PROFILE_PHOTO_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail="حجم الصورة كبير جداً، الحد الأقصى 2 ميجابايت"
                )
            update_fields["photo"] = photo

    if update_fields:
        await db.members.update_one(
            {"id": member["id"]},
            {"$set": update_fields}
        )

    updated = await db.members.find_one({"id": member["id"]}, {"_id": 0})
    return {
        "success": True,
        "profile": {
            "id": updated["id"],
            "name": updated.get("name"),
            "name_ar": updated.get("name_ar"),
            "phone": updated.get("phone"),
            "email": updated.get("email"),
            "member_code": updated.get("member_code"),
            "date_of_birth": updated.get("date_of_birth"),
            "gender": updated.get("gender"),
            "address": updated.get("address"),
            "emergency_contact": updated.get("emergency_contact"),
            "photo": updated.get("photo", ""),
            "created_at": updated.get("created_at"),
        }
    }


class MemberPreferences(BaseModel):
    dark_mode: Optional[bool] = None


@router.put("/preferences")
async def update_member_preferences(
    data: MemberPreferences,
    member: dict = Depends(get_current_member)
):
    """Save member UI preferences (e.g. dark mode) to the database"""
    update_fields = {}
    if data.dark_mode is not None:
        update_fields["preferences.dark_mode"] = data.dark_mode

    if update_fields:
        await db.members.update_one(
            {"id": member["id"]},
            {"$set": update_fields}
        )

    return {"success": True}


# ============ SUBSCRIPTIONS ============

@router.get("/subscriptions")
async def get_member_subscriptions(member: dict = Depends(get_current_member)):
    """Get all subscriptions from member's activities data"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    # Get member's activities directly from member data
    activities = member.get("activities", [])
    
    active_subscriptions = []
    expired_subscriptions = []

    # Build per-level coach maps from levels this member is enrolled in.
    level_coach_by_aid, level_coach_by_aname, level_coach_by_lid = \
        await get_member_level_coach_maps(member["id"])

    # ── Batch fetch all activities (single query instead of N) ──
    activity_ids = list({a.get("activity_id") for a in activities if a.get("activity_id")})
    activities_map = {}
    if activity_ids:
        activity_docs = await db.activities.find(
            {"id": {"$in": activity_ids}},
            {"_id": 0, "id": 1, "schedule": 1, "coach_id": 1}
        ).to_list(len(activity_ids))
        activities_map = {a["id"]: a for a in activity_docs}

    # ── Resolve coach IDs per activity (no DB calls yet) ──
    # Prefer the level_id stored on the member's activity entry — handles
    # the case where the level's activity_name has drifted from the member's.
    activity_coach_id = {}
    for activity in activities:
        aid = activity.get("activity_id")
        aname = activity.get("activity_name")
        lid = activity.get("level_id")
        coach_id = ""
        if lid and lid in level_coach_by_lid:
            coach_id = level_coach_by_lid[lid]
        elif aid and aid in level_coach_by_aid:
            coach_id = level_coach_by_aid[aid]
        elif aname and aname in level_coach_by_aname:
            coach_id = level_coach_by_aname[aname]
        if not coach_id:
            adata = activities_map.get(aid) if aid else None
            coach_id = (adata.get("coach_id") if adata else "") or activity.get("coach_id") or ""
        activity_coach_id[id(activity)] = coach_id

    # ── Batch fetch all coaches (single query) ──
    coach_ids = list({cid for cid in activity_coach_id.values() if cid})
    coaches_map = {}
    if coach_ids:
        coach_docs = await db.coaches.find(
            {"id": {"$in": coach_ids}},
            {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "photo": 1}
        ).to_list(len(coach_ids))
        coaches_map = {c["id"]: c for c in coach_docs}

    for activity in activities:
        end_date = activity.get("end_date", "")
        start_date = activity.get("start_date", "")

        activity_data = activities_map.get(activity.get("activity_id"))
        coach_id = activity_coach_id.get(id(activity), "")
        coach = coaches_map.get(coach_id) if coach_id else None
        coach_name = (coach.get("name_ar") or coach.get("name")) if coach else ""
        coach_photo = coach.get("photo", "") if coach else ""

        subscription = {
            "activity_id": activity.get("activity_id"),
            "activity_name": activity.get("activity_name"),
            "start_date": start_date,
            "end_date": end_date,
            "schedule": activity.get("schedule") or (activity_data.get("schedule") if activity_data else ""),
            "fee": activity.get("fee", 0),
            "coach_name": coach_name,
            "coach_photo": coach_photo,
            "coach_id": coach_id,
            "status": activity.get("status", ""),
            # Sibling-aggregation owner tags so the UI can label which linked
            # member each subscription belongs to (parent + multiple children).
            "_owner_id": activity.get("_owner_id", ""),
            "_owner_name": activity.get("_owner_name", ""),
            "_owner_member_code": activity.get("_owner_member_code", ""),
            "_owner_photo": activity.get("_owner_photo", ""),
        }
        
        # Check if active or expired
        if end_date and end_date >= today:
            subscription["status"] = "active"
            active_subscriptions.append(subscription)
        else:
            subscription["status"] = "expired"
            expired_subscriptions.append(subscription)
    
    return {
        "active": active_subscriptions,
        "expired": expired_subscriptions,
        "total_active": len(active_subscriptions),
        "total_expired": len(expired_subscriptions)
    }


# ============ SCHEDULE ============

@router.get("/schedule")
async def get_member_schedule(member: dict = Depends(get_current_member)):
    """Get member's training schedule based on active subscriptions"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    # Get active subscriptions
    invoices = await db.invoices.find(
        {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
    schedules = []
    activity_ids = set()
    
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("activity_id"):
                end_date = item.get("end_date", "")
                if not end_date and item.get("period"):
                    period = item.get("period", "")
                    if " - " in period:
                        parts = period.split(" - ")
                        if len(parts) == 2:
                            end_date = parts[1].strip()
                
                # Only include active subscriptions
                if end_date and end_date >= today:
                    activity_ids.add(item.get("activity_id"))
                    schedules.append({
                        "activity_id": item.get("activity_id"),
                        "activity_name": item.get("activity_name"),
                        "schedule": item.get("schedule", ""),
                        "end_date": end_date
                    })
    
    # Get activity notes for these activities
    activity_notes = []
    if activity_ids:
        notes = await db.activity_notes.find(
            {"activity_id": {"$in": list(activity_ids)}},
            {"_id": 0}
        ).sort("date", -1).to_list(50)
        activity_notes = notes
    
    return {
        "schedules": schedules,
        "activity_notes": activity_notes
    }


# ============ INVOICES ============

@router.get("/invoices")
async def get_member_invoices(member: dict = Depends(get_current_member)):
    """Get all invoices for the member"""
    invoices = await db.invoices.find(
        {"member_id": {"$in": member.get("_linked_member_ids", [member["id"]])}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)

    # Tag each invoice with the owner's display name when sibling accounts are linked
    linked_meta = {m["id"]: m for m in member.get("_linked_members", [])}
    for inv in invoices:
        owner = linked_meta.get(inv.get("member_id"))
        if owner:
            inv["_owner_name"] = owner.get("name", "")
            inv["_owner_member_code"] = owner.get("member_code", "")
            inv["_owner_photo"] = owner.get("photo", "")

    return {"invoices": invoices}


@router.get("/invoices/{invoice_id}")
async def get_invoice_details(invoice_id: str, member: dict = Depends(get_current_member)):
    """Get single invoice details"""
    invoice = await db.invoices.find_one(
        {"id": invoice_id, "member_id": {"$in": member.get("_linked_member_ids", [member["id"]])}},
        {"_id": 0}
    )
    
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    return invoice


# ============ QR CARD ============

@router.get("/qr-card")
async def get_qr_card_data(member: dict = Depends(get_current_member)):
    """Get QR card data for the member AND every linked sibling sharing the
    same phone. Returns `cards`: one full card per linked member with their
    own QR code, member_code, phone, and active activities. Top-level fields
    mirror the primary (logged-in) card for backward compatibility."""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    # Linked members = the logged-in member + any siblings sharing the phone.
    # Falls back to a single-entry list when no siblings exist.
    linked_meta = member.get("_linked_members") or [{
        "id": member["id"],
        "name": member.get("name_ar") or member.get("name") or "",
        "member_code": member.get("member_code", ""),
    }]
    linked_ids = [lm["id"] for lm in linked_meta]

    # Single batch fetch: all paid/partial invoices for ALL linked members.
    # IMPORTANT: A single invoice can be issued under one parent's member_id
    # but contain items for multiple siblings (e.g. one swim subscription per
    # child on the same receipt). So we group ITEMS — not invoices — by their
    # own item.member_id (falling back to inv.member_id when missing). This
    # ensures each sibling's card lists exactly their own subscriptions.
    invoices = await db.invoices.find(
        {"member_id": {"$in": linked_ids}, "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(500)
    items_by_member: Dict[str, list] = {}
    for inv in invoices:
        inv_owner = inv.get("member_id")
        for item in inv.get("items", []):
            owner = item.get("member_id") or inv_owner
            if owner in linked_ids:
                items_by_member.setdefault(owner, []).append(item)

    # Hydrate each linked member's full doc once (name_ar, phone, activities).
    # `activities` is needed so we can map each subscription's activity_id to
    # its level_id and resolve the per-level coach even when the level's
    # activity_name doesn't textually match the member's activity_name.
    linked_docs = await db.members.find(
        {"id": {"$in": linked_ids}},
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "member_code": 1,
         "phone": 1, "photo": 1, "activities": 1}
    ).to_list(len(linked_ids))
    docs_by_id = {d["id"]: d for d in linked_docs}

    # Coach cache shared across all cards to avoid redundant DB lookups.
    # Key includes the linked-member id because per-level coach assignments
    # are member-specific: two siblings enrolled in the same activity may be
    # in different levels with different coaches, so the cache must not bleed
    # one sibling's coach into another's card.
    coach_cache: Dict[tuple, tuple] = {}

    async def resolve_coach(member_id: str, activity_id: str, activity_name: str,
                            level_by_aid: Dict[str, str], level_by_aname: Dict[str, str],
                            level_by_lid: Dict[str, str] = None, level_id: str = ""):
        if not activity_id and not activity_name and not level_id:
            return "", ""
        cache_key = (member_id or "", activity_id or "", activity_name or "", level_id or "")
        if cache_key in coach_cache:
            return coach_cache[cache_key]
        coach_id = ""
        # Prefer the explicit level_id on the member's activity entry — this
        # handles the common case where the level's activity_name has been
        # renamed (e.g. "سباحة - الساعه 4") and no longer textually matches
        # the member's recorded activity_name ("السباحة 3 ايام في الاسبوع").
        if level_id and level_by_lid and level_id in level_by_lid:
            coach_id = level_by_lid[level_id]
        elif activity_id and activity_id in level_by_aid:
            coach_id = level_by_aid[activity_id]
        elif activity_name and activity_name in level_by_aname:
            coach_id = level_by_aname[activity_name]
        if not coach_id and activity_id:
            activity_data = await db.activities.find_one(
                {"id": activity_id}, {"_id": 0, "coach_id": 1}
            )
            coach_id = activity_data.get("coach_id") if activity_data else ""
        if coach_id:
            coach = await db.coaches.find_one(
                {"id": coach_id}, {"_id": 0, "name_ar": 1, "name": 1, "photo": 1}
            )
            if coach:
                result = (
                    coach.get("name_ar") or coach.get("name", ""),
                    coach.get("photo", "")
                )
                coach_cache[cache_key] = result
                return result
        coach_cache[cache_key] = ("", "")
        return ("", "")

    cards = []
    for lm in linked_meta:
        lm_id = lm["id"]
        doc = docs_by_id.get(lm_id, {})
        level_by_aid, level_by_aname, level_by_lid = await get_member_level_coach_maps(lm_id)

        # Build a per-member map: activity_id -> level_id from the member's
        # own activity entries. Used to look up the per-level coach even when
        # the level's activity_name has drifted from the member's recorded one.
        member_activities = doc.get("activities") or []
        level_id_by_aid: Dict[str, str] = {}
        for ma in member_activities:
            aid = ma.get("activity_id")
            lid = ma.get("level_id")
            if aid and lid:
                level_id_by_aid[aid] = lid

        active_activities = []
        seen_keys = set()
        for item in items_by_member.get(lm_id, []):
            if not item.get("activity_id"):
                continue
            end_date = item.get("end_date", "")
            start_date = item.get("start_date", "")
            if not end_date and item.get("period"):
                period = item.get("period", "")
                if " - " in period:
                    parts = period.split(" - ")
                    if len(parts) == 2:
                        start_date = start_date or parts[0].strip()
                        end_date = parts[1].strip()
            if end_date and end_date >= today:
                # Dedupe in case the same subscription appears on multiple
                # invoices (e.g. partial + paid combinations).
                dedupe_key = (item.get("activity_id"), start_date, end_date)
                if dedupe_key in seen_keys:
                    continue
                seen_keys.add(dedupe_key)
                level_id_for_item = level_id_by_aid.get(item.get("activity_id"), "")
                coach_name, coach_photo = await resolve_coach(
                    lm_id,
                    item.get("activity_id"),
                    item.get("activity_name") or "",
                    level_by_aid, level_by_aname,
                    level_by_lid, level_id_for_item,
                )
                active_activities.append({
                    "activity_name": item.get("activity_name"),
                    "start_date": start_date,
                    "end_date": end_date,
                    "schedule": item.get("schedule", ""),
                    "coach_name": coach_name,
                    "coach_photo": coach_photo,
                })

        name_ar = doc.get("name_ar") or lm.get("name") or ""
        cards.append({
            "id": lm_id,
            "name": doc.get("name"),
            "name_ar": name_ar,
            "member_code": doc.get("member_code") or lm.get("member_code", ""),
            "phone": doc.get("phone"),
            "photo": doc.get("photo", "") or lm.get("photo", ""),
            "active_activities": active_activities,
            "qr_data": {
                "type": "WCPA_MEMBER",
                "id": lm_id,
                "code": doc.get("member_code") or lm.get("member_code", ""),
                "name": name_ar,
            }
        })

    # Backward compatibility: also expose the primary (logged-in) member's
    # fields at the top level so older clients keep working.
    primary = next((c for c in cards if c["id"] == member["id"]), cards[0] if cards else {})
    return {
        **primary,
        "cards": cards,
    }


# ============ TOURNAMENTS ============

@router.get("/my-tournaments")
async def get_my_tournaments(member: dict = Depends(get_current_member)):
    """Return all tournaments this member has participated in, with their
    position/medal in each. Most-recent first.
    """
    POSITION_LABEL_AR = {"1": "الأول", "2": "الثاني", "3": "الثالث", "participation": "مشاركة"}
    POSITION_LABEL_EN = {"1": "1st Place", "2": "2nd Place", "3": "3rd Place", "participation": "Participation"}

    linked_ids_set = set(member.get("_linked_member_ids", [member["id"]]))
    tournaments = await db.tournaments.find(
        {"participants.member_id": {"$in": list(linked_ids_set)}},
        {"_id": 0, "id": 1, "name": 1, "date": 1, "place": 1,
         "activity_name": 1, "status": 1, "participants": 1},
    ).sort("date", -1).to_list(200)

    # Collect level ids needed for label enrichment
    level_ids = set()
    for t in tournaments:
        for p in t.get("participants", []) or []:
            if p.get("member_id") in linked_ids_set and p.get("level_id"):
                level_ids.add(p["level_id"])

    levels_map: Dict[str, dict] = {}
    if level_ids:
        levels = await db.levels.find(
            {"id": {"$in": list(level_ids)}},
            {"_id": 0, "id": 1, "level_number": 1, "custom_name": 1},
        ).to_list(len(level_ids) + 5)
        levels_map = {l["id"]: l for l in levels}

    results = []
    medals_count = {"1": 0, "2": 0, "3": 0}
    for t in tournaments:
        my = next((p for p in (t.get("participants") or []) if p.get("member_id") == member["id"]), None)
        if not my:
            continue
        pos = my.get("position")
        if pos in medals_count:
            medals_count[pos] += 1
        lvl = levels_map.get(my.get("level_id")) if my.get("level_id") else None
        lvl_label = ""
        if lvl:
            cn = (lvl.get("custom_name") or "").strip()
            lvl_label = cn if cn else f"المستوى {lvl.get('level_number', '')}"
        results.append({
            "tournament_id": t.get("id"),
            "tournament_name": t.get("name") or "",
            "date": t.get("date") or "",
            "place": t.get("place") or "",
            "activity_name": t.get("activity_name") or "",
            "status": t.get("status") or "",
            "position": pos,
            "position_label_ar": POSITION_LABEL_AR.get(pos or "", ""),
            "position_label_en": POSITION_LABEL_EN.get(pos or "", ""),
            "level_label": lvl_label,
            "notes": my.get("notes") or "",
        })

    return {
        "tournaments": results,
        "totals": {
            "participations": len(results),
            "gold": medals_count["1"],
            "silver": medals_count["2"],
            "bronze": medals_count["3"],
            "medals": medals_count["1"] + medals_count["2"] + medals_count["3"],
        },
    }


# ============ NOTIFICATIONS ============

@router.get("/notifications")
async def get_member_notifications(member: dict = Depends(get_current_member)):
    """Get notifications for the member"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    notifications = []
    
    linked_ids_list = member.get("_linked_member_ids", [member["id"]])

    # Check for expiring subscriptions (within 7 days) — across all linked siblings
    invoices = await db.invoices.find(
        {"member_id": {"$in": linked_ids_list}, "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(200)

    seven_days_later = (datetime.now(timezone.utc) + timedelta(days=7)).strftime('%Y-%m-%d')
    linked_meta = {m["id"]: m for m in member.get("_linked_members", [])}

    for inv in invoices:
        owner = linked_meta.get(inv.get("member_id"))
        owner_name = owner.get("name") if owner else ""
        for item in inv.get("items", []):
            if item.get("activity_id"):
                end_date = item.get("end_date", "")
                if not end_date and item.get("period"):
                    period = item.get("period", "")
                    if " - " in period:
                        parts = period.split(" - ")
                        if len(parts) == 2:
                            end_date = parts[1].strip()

                if end_date:
                    name_prefix = f"{owner_name} - " if owner_name else ""
                    if today <= end_date <= seven_days_later:
                        notifications.append({
                            "id": str(uuid.uuid4()),
                            "type": "expiring_soon",
                            "title": "اشتراك على وشك الانتهاء",
                            "message": f"{name_prefix}اشتراك {item.get('activity_name')} سينتهي في {end_date}",
                            "activity_name": item.get("activity_name"),
                            "end_date": end_date,
                            "priority": "warning",
                            "created_at": datetime.now(timezone.utc).isoformat()
                        })
                    elif end_date < today:
                        notifications.append({
                            "id": str(uuid.uuid4()),
                            "type": "expired",
                            "title": "اشتراك منتهي",
                            "message": f"{name_prefix}انتهى اشتراك {item.get('activity_name')} في {end_date}",
                            "activity_name": item.get("activity_name"),
                            "end_date": end_date,
                            "priority": "danger",
                            "created_at": datetime.now(timezone.utc).isoformat()
                        })

    # Get general notifications/offers (broadcast to any linked sibling)
    general_notifications = await db.notifications.find(
        {"$or": [
            {"target": "all_members"},
            {"target_members": {"$in": linked_ids_list}}
        ]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20)
    
    for notif in general_notifications:
        notifications.append({
            "id": notif.get("id"),
            "type": notif.get("type", "info"),
            "title": notif.get("title"),
            "message": notif.get("message"),
            "priority": notif.get("priority", "info"),
            "created_at": notif.get("created_at"),
            "is_read": notif.get("is_read", False)
        })
    
    # Get member-specific notifications (videos, loyalty, etc.)
    member_notifs = await db.member_notifications.find(
        {"member_id": member["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    
    for notif in member_notifs:
        notifications.append({
            "id": notif.get("id", str(notif.get("_id", ""))),
            "type": notif.get("type", "info"),
            "title": notif.get("title_ar", notif.get("title", "")),
            "title_ar": notif.get("title_ar", notif.get("title", "")),
            "title_en": notif.get("title", notif.get("title_en", "")),
            "message": notif.get("message_ar", notif.get("message", "")),
            "message_ar": notif.get("message_ar", notif.get("message", "")),
            "message_en": notif.get("message", notif.get("message_en", "")),
            "priority": "info",
            "link": notif.get("link"),
            "video_id": notif.get("video_id"),
            "created_at": notif.get("created_at"),
            "is_read": notif.get("is_read", False)
        })
    
    # Sort by priority and date (ensure created_at is string)
    priority_order = {"danger": 0, "warning": 1, "info": 2}
    
    def get_sort_key(x):
        created_at = x.get("created_at", "")
        if hasattr(created_at, 'isoformat'):
            created_at = created_at.isoformat()
        return (priority_order.get(x.get("priority"), 3), str(created_at))
    
    notifications.sort(key=get_sort_key, reverse=True)

    def is_unread(n):
        if n.get("type") in ("expiring_soon", "expired"):
            return not n.get("is_read", False)
        return not n.get("is_read", False)

    return {
        "notifications": notifications,
        "unread_count": len([n for n in notifications if is_unread(n)])
    }


@router.put("/notifications/mark-all-read")
async def member_mark_all_notifications_read(member: dict = Depends(get_current_member)):
    """Mark all notifications as read for the current member"""
    linked_ids_list = member.get("_linked_member_ids", [member["id"]])
    member_result = await db.member_notifications.update_many(
        {"member_id": {"$in": linked_ids_list}, "is_read": {"$ne": True}},
        {"$set": {"is_read": True}}
    )
    general_result = await db.notifications.update_many(
        {"$or": [
            {"target": "all_members"},
            {"target_members": {"$in": linked_ids_list}}
        ], "is_read": {"$ne": True}},
        {"$set": {"is_read": True}}
    )
    return {
        "message": "ok",
        "updated": (member_result.modified_count or 0) + (general_result.modified_count or 0)
    }


# ============ TRAINING REMINDERS ============

@router.get("/training-reminders")
async def get_training_reminders(member: dict = Depends(get_current_member)):
    """Get today's training reminders based on active subscriptions and schedules"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    now = datetime.now(timezone.utc)
    
    day_names_ar = {
        0: 'الاثنين', 1: 'الثلاثاء', 2: 'الأربعاء',
        3: 'الخميس', 4: 'الجمعة', 5: 'السبت', 6: 'الأحد'
    }
    day_names_en = {
        0: 'Monday', 1: 'Tuesday', 2: 'Wednesday',
        3: 'Thursday', 4: 'Friday', 5: 'Saturday', 6: 'Sunday'
    }
    today_day_num = now.weekday()
    today_day_ar = day_names_ar.get(today_day_num, '')
    today_day_en = day_names_en.get(today_day_num, '')
    
    reminders = []
    seen_activities = set()
    
    member_activities = member.get("activities", [])
    for act in member_activities:
        activity_id = act.get("activity_id")
        if not activity_id or activity_id in seen_activities:
            continue
        end_date = act.get("end_date", "")
        if not end_date:
            continue
        try:
            if isinstance(end_date, str):
                end_date_parsed = datetime.strptime(end_date[:10], '%Y-%m-%d').date()
            elif isinstance(end_date, datetime):
                end_date_parsed = end_date.date()
            else:
                continue
            if end_date_parsed < now.date():
                continue
        except (ValueError, TypeError):
            continue
        seen_activities.add(activity_id)
        
        schedule_text = act.get("schedule", "")
        activity_data = await db.activities.find_one(
            {"id": activity_id}, {"_id": 0, "schedule": 1, "name": 1, "name_ar": 1}
        )
        if not schedule_text and activity_data:
            schedule_text = activity_data.get("schedule", "")
        
        is_today = False
        if schedule_text:
            schedule_lower = schedule_text.lower()
            if today_day_ar in schedule_text or today_day_en.lower() in schedule_lower:
                is_today = True
            for day_ar in day_names_ar.values():
                if day_ar in schedule_text:
                    break
            else:
                if schedule_text.strip():
                    is_today = True
        
        if is_today:
            import re
            time_patterns = re.findall(r'(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|ص|م)?)', schedule_text)
            reminders.append({
                "id": str(uuid.uuid4()),
                "activity_id": activity_id,
                "activity_name": act.get("activity_name", ""),
                "schedule": schedule_text,
                "time": time_patterns[0] if time_patterns else "",
                "end_date": str(end_date),
                "type": "training_reminder"
            })
    
    invoices = await db.invoices.find(
        {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
    for inv in invoices:
        for item in inv.get("items", []):
            if not item.get("activity_id"):
                continue
            
            activity_id = item.get("activity_id")
            if activity_id in seen_activities:
                continue
                
            end_date = item.get("end_date", "")
            if not end_date and item.get("period"):
                period = item.get("period", "")
                if " - " in period:
                    parts = period.split(" - ")
                    if len(parts) == 2:
                        end_date = parts[1].strip()
            
            if not end_date:
                continue
            try:
                if isinstance(end_date, str):
                    end_date_parsed = datetime.strptime(end_date[:10], '%Y-%m-%d').date()
                elif isinstance(end_date, datetime):
                    end_date_parsed = end_date.date()
                else:
                    continue
                if end_date_parsed < now.date():
                    continue
            except (ValueError, TypeError):
                continue
            
            seen_activities.add(activity_id)
            
            schedule_text = item.get("schedule", "")
            activity_data = await db.activities.find_one(
                {"id": activity_id}, {"_id": 0, "schedule": 1, "name": 1, "name_ar": 1}
            )
            if not schedule_text and activity_data:
                schedule_text = activity_data.get("schedule", "")
            
            is_today = False
            if schedule_text:
                schedule_lower = schedule_text.lower()
                if today_day_ar in schedule_text or today_day_en.lower() in schedule_lower:
                    is_today = True
                for day_ar in day_names_ar.values():
                    if day_ar in schedule_text:
                        break
                else:
                    if schedule_text.strip():
                        is_today = True
            
            if is_today:
                time_match = ""
                import re
                time_patterns = re.findall(r'(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|ص|م)?)', schedule_text)
                if time_patterns:
                    time_match = time_patterns[0]
                
                reminders.append({
                    "id": str(uuid.uuid4()),
                    "activity_id": activity_id,
                    "activity_name": item.get("activity_name", ""),
                    "schedule": schedule_text,
                    "time": time_match,
                    "end_date": end_date,
                    "type": "training_reminder"
                })
    
    today_attendance = await db.attendance.find(
        {"member_id": {"$in": member.get("_linked_member_ids", [member["id"]])}, "date": today},
        {"_id": 0}
    ).to_list(20)
    
    attended_activities = {a.get("activity_id") for a in today_attendance}
    
    for reminder in reminders:
        reminder["already_attended"] = reminder["activity_id"] in attended_activities
    
    return {
        "reminders": reminders,
        "today": today,
        "day_name_ar": today_day_ar,
        "day_name_en": today_day_en,
        "total": len(reminders)
    }


# ============ ATTENDANCE HISTORY ============

@router.get("/attendance")
async def get_member_attendance(member: dict = Depends(get_current_member)):
    """Get attendance history for the member (and any linked siblings)"""
    linked_ids_list = member.get("_linked_member_ids", [member["id"]])
    attendance = await db.attendance.find(
        {"member_id": {"$in": linked_ids_list}},
        {"_id": 0}
    ).sort("date", -1).to_list(200)

    linked_meta = {m["id"]: m for m in member.get("_linked_members", [])}
    for a in attendance:
        owner = linked_meta.get(a.get("member_id"))
        if owner:
            a["_owner_name"] = owner.get("name", "")
            a["_owner_member_code"] = owner.get("member_code", "")
            a["_owner_photo"] = owner.get("photo", "")

    return {"attendance": attendance}


# ============ ATTENDANCE STATS ============

def _count_scheduled_days(schedule_text: str) -> int:
    """Count how many days per week from a schedule text string (Arabic or English)."""
    if not schedule_text:
        return 0
    # Arabic day names (each is unique and unambiguous)
    ar_days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
    # Full English day names (check before short forms to avoid double-counting)
    en_days_full = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    en_days_short = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
    
    count = sum(1 for d in ar_days if d in schedule_text)
    if count == 0:
        text_lower = schedule_text.lower()
        matched = set()
        for i, full in enumerate(en_days_full):
            if full in text_lower:
                matched.add(i)
        for i, short in enumerate(en_days_short):
            if short in text_lower and i not in matched:
                matched.add(i)
        count = len(matched)
    return count


@router.get("/attendance-stats")
async def get_member_attendance_stats(
    year: Optional[int] = Query(default=None, ge=2000, le=2100),
    month: Optional[int] = Query(default=None, ge=1, le=12),
    member: dict = Depends(get_current_member)
):
    """Get attendance statistics for the member"""
    from datetime import datetime, timedelta
    import re as _re
    import calendar as _calendar
    
    # Determine the target month/year (bounds already validated by FastAPI Query)
    today = datetime.now(timezone.utc)
    if year and month:
        target_year = year
        target_month = month
    else:
        target_year = today.year
        target_month = today.month

    today_str = today.strftime('%Y-%m-%d')

    # Compute first and last day of the target month
    first_day_of_month = datetime(target_year, target_month, 1, tzinfo=timezone.utc)
    last_day_num = _calendar.monthrange(target_year, target_month)[1]
    last_day_of_month = datetime(target_year, target_month, last_day_num, tzinfo=timezone.utc)

    first_day_str = first_day_of_month.strftime('%Y-%m-%d')
    # For the current month, cap at today; for past months use the last day
    if target_year == today.year and target_month == today.month:
        last_day_str = today_str
    else:
        last_day_str = last_day_of_month.strftime('%Y-%m-%d')

    # Get last month dates (relative to the target month)
    last_month_dt = first_day_of_month - timedelta(days=1)
    first_day_last_month = last_month_dt.replace(day=1)
    first_day_last_month_str = first_day_last_month.strftime('%Y-%m-%d')
    last_day_last_month_str = last_month_dt.strftime('%Y-%m-%d')
    
    linked_ids_list = member.get("_linked_member_ids", [member["id"]])

    # Get attendance for the target month (across all linked siblings)
    this_month_attendance = await db.attendance.find(
        {
            "member_id": {"$in": linked_ids_list},
            "date": {"$gte": first_day_str, "$lte": last_day_str}
        },
        {"_id": 0}
    ).to_list(500)

    # Get attendance for last month
    last_month_attendance = await db.attendance.find(
        {
            "member_id": {"$in": linked_ids_list},
            "date": {"$gte": first_day_last_month_str, "$lte": last_day_last_month_str}
        },
        {"_id": 0}
    ).to_list(500)

    # Get all-time attendance
    total_attendance = await db.attendance.count_documents({"member_id": {"$in": linked_ids_list}})
    
    # Group by activity for this month
    activities_count = {}
    for att in this_month_attendance:
        activity_name = att.get("activity_name", "غير محدد")
        activities_count[activity_name] = activities_count.get(activity_name, 0) + 1
    
    # Extract attendance dates for current month
    this_month_dates = sorted(set(
        att.get("date", "") for att in this_month_attendance if att.get("date")
    ))

    # Calculate best week from this month (group by ISO week)
    week_counts = {}
    for att in this_month_attendance:
        date_str = att.get("date", "")
        if not date_str:
            continue
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d")
            iso = d.isocalendar()
            week_key = f"{iso[0]}-W{iso[1]:02d}"
            week_counts[week_key] = week_counts.get(week_key, 0) + 1
        except Exception:
            pass
    best_week = None
    if week_counts:
        best_week_key = max(week_counts, key=lambda k: week_counts[k])
        best_week = {
            "count": week_counts[best_week_key],
            "week_label": best_week_key
        }

    # Calculate scheduled_per_week from active subscriptions' schedule text
    scheduled_per_week = 0
    activities = member.get("activities", [])
    for act in activities:
        end_date = act.get("end_date", "")
        if end_date and end_date >= today_str:
            schedule_text = act.get("schedule", "") or ""
            days = _count_scheduled_days(schedule_text)
            scheduled_per_week += days
    
    # Recent attendance (last 10) — span linked siblings so the badge shows
    # which member each row belongs to (and renders their photo).
    linked_ids_list = member.get("_linked_member_ids", [member["id"]])
    recent_attendance = await db.attendance.find(
        {"member_id": {"$in": linked_ids_list}},
        {"_id": 0}
    ).sort("date", -1).to_list(10)
    linked_meta_map = {m["id"]: m for m in member.get("_linked_members", [])}
    for a in recent_attendance:
        owner = linked_meta_map.get(a.get("member_id"))
        if owner:
            a["_owner_name"] = owner.get("name", "")
            a["_owner_member_code"] = owner.get("member_code", "")
            a["_owner_photo"] = owner.get("photo", "")
    
    return {
        "this_month": {
            "count": len(this_month_attendance),
            "month_name": first_day_of_month.strftime('%B %Y'),
            "year": target_year,
            "month": target_month,
            "activities": activities_count,
            "dates": this_month_dates
        },
        "last_month": {
            "count": len(last_month_attendance),
            "month_name": last_month_dt.strftime('%B %Y')
        },
        "total": total_attendance,
        "recent": recent_attendance,
        "best_week": best_week,
        "scheduled_per_week": scheduled_per_week
    }


# ============ COACH RATINGS ============

class CoachRatingCreate(BaseModel):
    coach_id: Optional[str] = None
    coach_name: Optional[str] = None  # For manual entry
    activity_id: Optional[str] = None
    activity_name: Optional[str] = None  # For manual entry
    rating: int  # 1-5 stars
    comment: Optional[str] = None

@router.get("/coaches-to-rate")
async def get_coaches_to_rate(member: dict = Depends(get_current_member)):
    """Get list of coaches the member can rate based on their subscriptions"""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    # Get active subscriptions across the member AND every linked sibling so
    # the rating page reflects all coaches the family is actively training with.
    # An invoice paid by one parent often contains items for multiple kids; we
    # accept any item whose item.member_id (or fallback inv.member_id) belongs
    # to the linked-member set.
    linked_ids = member.get("_linked_member_ids") or [member["id"]]
    invoices = await db.invoices.find(
        {"member_id": {"$in": linked_ids}, "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(200)

    activity_ids = set()
    for inv in invoices:
        inv_owner = inv.get("member_id")
        for item in inv.get("items", []):
            if not item.get("activity_id"):
                continue
            owner = item.get("member_id") or inv_owner
            if owner not in linked_ids:
                continue
            end_date = item.get("end_date", "")
            if not end_date and item.get("period"):
                period = item.get("period", "")
                if " - " in period:
                    parts = period.split(" - ")
                    if len(parts) == 2:
                        end_date = parts[1].strip()
            # Include both active and recently expired (last 30 days)
            if end_date:
                activity_ids.add(item.get("activity_id"))
    
    # Get coaches for these activities
    coaches = []
    if activity_ids:
        activities = await db.activities.find(
            {"id": {"$in": list(activity_ids)}},
            {"_id": 0}
        ).to_list(100)
        activities_by_id = {a.get("id"): a for a in activities}

        # Resolve a single coach per eligible activity using the LEVELS this
        # member is enrolled in (matched by level_id from member.activities,
        # then activity_id, then activity_name). Falls back to the
        # activity-level coach when no level match exists.
        level_coach_by_aid, level_coach_by_aname, level_coach_by_lid = \
            await get_member_level_coach_maps(member["id"])
        # Build activity_id -> level_id from the member's own activity entries
        # (handles the case where the level's activity_name has drifted).
        member_acts = member.get("activities", []) or []
        level_id_by_aid = {
            ma.get("activity_id"): ma.get("level_id")
            for ma in member_acts
            if ma.get("activity_id") and ma.get("level_id")
        }
        activity_coach = {}  # activity_id -> coach_id (final resolution)
        for aid in activity_ids:
            act = activities_by_id.get(aid)
            cid = ""
            lid = level_id_by_aid.get(aid)
            if lid and lid in level_coach_by_lid:
                cid = level_coach_by_lid[lid]
            elif aid in level_coach_by_aid:
                cid = level_coach_by_aid[aid]
            elif act:
                aname = act.get("name_ar") or act.get("name") or ""
                if aname and aname in level_coach_by_aname:
                    cid = level_coach_by_aname[aname]
            if not cid and act and act.get("coach_id"):
                cid = act.get("coach_id")
            if cid:
                activity_coach[aid] = cid

        coach_ids = set(activity_coach.values())

        if coach_ids:
            coaches_data = await db.coaches.find(
                {"id": {"$in": list(coach_ids)}},
                {"_id": 0}
            ).to_list(50)
            
            for coach in coaches_data:
                # Get existing rating from this member
                existing_rating = await db.coach_ratings.find_one(
                    {"member_id": member["id"], "coach_id": coach["id"]},
                    {"_id": 0}
                )
                
                # Activities for this coach: only those whose RESOLVED coach equals this coach.
                # Each activity is associated with at most one coach (level-first, activity fallback),
                # so an activity will not appear under two coaches.
                coach_activity_ids = {
                    aid for aid, cid in activity_coach.items() if cid == coach["id"]
                }
                coach_activities = [
                    activities_by_id[aid] for aid in coach_activity_ids if aid in activities_by_id
                ]
                
                coaches.append({
                    "id": coach["id"],
                    "name": coach.get("name"),
                    "name_ar": coach.get("name_ar"),
                    "specialization": coach.get("specialization") or ", ".join(str(a) for a in (coach.get("activities") or []) if a),
                    "photo": coach.get("photo"),
                    "activities": [{"id": a["id"], "name": a.get("name_ar") or a.get("name")} for a in coach_activities],
                    "my_rating": existing_rating
                })
    
    return {"coaches": coaches}


@router.get("/all-coaches")
async def get_all_coaches_for_rating(member: dict = Depends(get_current_member)):
    """Get all coaches for manual rating selection"""
    coaches = await db.coaches.find({}, {"_id": 0}).to_list(100)
    
    # Get all activities
    activities = await db.activities.find({}, {"_id": 0}).to_list(100)
    
    result = []
    for coach in coaches:
        # Get existing rating from this member
        existing_rating = await db.coach_ratings.find_one(
            {"member_id": member["id"], "coach_id": coach["id"]},
            {"_id": 0}
        )
        
        # Get coach's activities
        coach_activities = [a for a in activities if a.get("coach_id") == coach["id"]]
        
        result.append({
            "id": coach["id"],
            "name": coach.get("name"),
            "name_ar": coach.get("name_ar"),
            "specialization": coach.get("specialization") or ", ".join(str(a) for a in (coach.get("activities") or []) if a),
            "photo": coach.get("photo"),
            "activities": [{"id": a["id"], "name": a.get("name_ar") or a.get("name")} for a in coach_activities],
            "my_rating": existing_rating
        })
    
    return {"coaches": result}


@router.get("/all-activities")
async def get_all_activities_for_rating(member: dict = Depends(get_current_member)):
    """Get all activities for manual rating selection"""
    activities = await db.activities.find({}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1}).to_list(100)
    return {"activities": activities}


@router.post("/rate-coach")
async def rate_coach(data: CoachRatingCreate, member: dict = Depends(get_current_member)):
    """Submit or update coach rating"""
    if data.rating < 1 or data.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    
    # Get coach name if coach_id provided
    coach_name = data.coach_name
    if data.coach_id:
        coach = await db.coaches.find_one({"id": data.coach_id}, {"_id": 0, "name": 1, "name_ar": 1})
        if coach:
            coach_name = coach.get("name_ar") or coach.get("name")
    
    # Get activity name if activity_id provided
    activity_name = data.activity_name
    if data.activity_id:
        activity = await db.activities.find_one({"id": data.activity_id}, {"_id": 0, "name": 1, "name_ar": 1})
        if activity:
            activity_name = activity.get("name_ar") or activity.get("name")
    
    rating_data = {
        "member_id": member["id"],
        "member_name": member.get("name_ar") or member.get("name"),
        "member_phone": member.get("phone"),
        "coach_id": data.coach_id,
        "coach_name": coach_name,
        "activity_id": data.activity_id,
        "activity_name": activity_name,
        "rating": data.rating,
        "comment": data.comment,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Check if rating exists (by coach_id or coach_name for manual entries)
    existing = None
    if data.coach_id:
        existing = await db.coach_ratings.find_one({
            "member_id": member["id"],
            "coach_id": data.coach_id
        })
    
    if existing:
        await db.coach_ratings.update_one(
            {"member_id": member["id"], "coach_id": data.coach_id},
            {"$set": rating_data}
        )
        message = "تم تحديث التقييم بنجاح"
    else:
        rating_data["id"] = str(uuid.uuid4())
        rating_data["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.coach_ratings.insert_one(rating_data)
        message = "تم إرسال التقييم بنجاح"
    
    return {"message": message}


@router.get("/coach-profile/{coach_id}")
async def get_coach_profile(coach_id: str, member: dict = Depends(get_current_member)):
    """Get a coach's public profile including activities and ratings summary"""
    coach = await db.coaches.find_one({"id": coach_id}, {"_id": 0})
    if not coach:
        raise HTTPException(status_code=404, detail="لم يتم العثور على المدرب")

    # Merge activities from db.activities (linked by coach_id) with the coach's own activity list
    db_activities = await db.activities.find(
        {"coach_id": coach_id},
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1}
    ).to_list(50)
    activity_names_from_db = {a.get("name_ar") or a.get("name") for a in db_activities if a.get("name") or a.get("name_ar")}
    # Coach document may also store its own activity strings
    coach_own_activities = set(coach.get("activities") or [])
    all_activities = sorted(activity_names_from_db | coach_own_activities)

    # Build a list of activities with IDs for the rating selector
    activities_with_ids = [
        {"id": a.get("id"), "name": a.get("name_ar") or a.get("name")}
        for a in db_activities
        if a.get("name") or a.get("name_ar")
    ]
    db_activity_names_set = {a["name"] for a in activities_with_ids}
    for name in coach_own_activities:
        if name not in db_activity_names_set:
            activities_with_ids.append({"id": None, "name": name})
    activities_with_ids = sorted(activities_with_ids, key=lambda x: x["name"])

    # Privacy: each member should only see THEIR OWN rating for a coach.
    # Aggregate stats and other members' reviews are intentionally NOT returned.
    my_rating_doc = await db.coach_ratings.find_one(
        {"coach_id": coach_id, "member_id": member["id"]},
        {"_id": 0, "rating": 1, "comment": 1}
    )
    my_rating = None
    if my_rating_doc:
        my_rating = {
            "rating": my_rating_doc.get("rating", 0),
            "comment": my_rating_doc.get("comment") or "",
        }

    return {
        "id": coach["id"],
        "name": coach.get("name_ar") or coach.get("name"),
        "photo": coach.get("photo"),
        "specialization": coach.get("specialization") or ", ".join(str(a) for a in (coach.get("activities") or []) if a),
        "notes": coach.get("notes") or "",
        "activities": all_activities,
        "activities_with_ids": activities_with_ids,
        "my_rating": my_rating,
    }


# ============ SUPERVISOR RATINGS ============

class SupervisorRatingCreate(BaseModel):
    supervisor_id: str
    rating: int  # 1-5
    comment: Optional[str] = None


@router.get("/supervisors-to-rate")
async def get_supervisors_to_rate(member: dict = Depends(get_current_member)):
    """List all supervisors with the current member's rating (if any)."""
    supervisors = await db.supervisors.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    result = []
    for sup in supervisors:
        existing = await db.supervisor_ratings.find_one(
            {"member_id": member["id"], "supervisor_id": sup["id"]},
            {"_id": 0, "rating": 1, "comment": 1}
        )
        result.append({
            "id": sup["id"],
            "name": sup.get("name"),
            "photo": sup.get("photo"),
            "my_rating": existing,
        })
    return {"supervisors": result}


@router.post("/rate-supervisor")
async def rate_supervisor(data: SupervisorRatingCreate, member: dict = Depends(get_current_member)):
    """Submit or update supervisor rating."""
    if data.rating < 1 or data.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

    sup = await db.supervisors.find_one({"id": data.supervisor_id}, {"_id": 0, "name": 1})
    if not sup:
        raise HTTPException(status_code=404, detail="المشرف غير موجود")

    rating_data = {
        "member_id": member["id"],
        "member_name": member.get("name_ar") or member.get("name"),
        "member_phone": member.get("phone"),
        "supervisor_id": data.supervisor_id,
        "supervisor_name": sup.get("name"),
        "rating": data.rating,
        "comment": data.comment,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    existing = await db.supervisor_ratings.find_one({
        "member_id": member["id"],
        "supervisor_id": data.supervisor_id,
    })

    if existing:
        await db.supervisor_ratings.update_one(
            {"member_id": member["id"], "supervisor_id": data.supervisor_id},
            {"$set": rating_data},
        )
        message = "تم تحديث التقييم بنجاح"
    else:
        rating_data["id"] = str(uuid.uuid4())
        rating_data["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.supervisor_ratings.insert_one(rating_data)
        message = "تم إرسال التقييم بنجاح"

    return {"message": message}


@router.delete("/delete-supervisor-rating/{supervisor_id}")
async def delete_supervisor_rating(supervisor_id: str, member: dict = Depends(get_current_member)):
    """Delete the current member's rating for a supervisor."""
    result = await db.supervisor_ratings.delete_one({
        "member_id": member["id"],
        "supervisor_id": supervisor_id,
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="لم يتم العثور على تقييم")
    return {"message": "تم حذف التقييم بنجاح"}


@router.delete("/delete-rating/{coach_id}")
async def delete_coach_rating(coach_id: str, member: dict = Depends(get_current_member)):
    """Delete the current member's rating for a coach"""
    result = await db.coach_ratings.delete_one({
        "member_id": member["id"],
        "coach_id": coach_id
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="لم يتم العثور على تقييم")
    return {"message": "تم حذف التقييم بنجاح"}


@router.get("/my-ratings")
async def get_my_ratings(member: dict = Depends(get_current_member)):
    """Get all ratings submitted by this member"""
    ratings = await db.coach_ratings.find(
        {"member_id": member["id"]},
        {"_id": 0}
    ).to_list(50)
    
    # Enrich with coach names
    for rating in ratings:
        coach = await db.coaches.find_one({"id": rating["coach_id"]}, {"_id": 0, "name": 1, "name_ar": 1})
        if coach:
            rating["coach_name"] = coach.get("name_ar") or coach.get("name")
    
    return {"ratings": ratings}


# ============ REGISTRATION FORMS ============

@router.get("/registration-forms")
async def get_member_registration_forms(member: dict = Depends(get_current_member)):
    """Get registration forms for the member"""
    phone = member.get("phone")
    
    # Find registration forms by phone number
    forms = await db.registration_forms.find(
        {"customer_phone": phone},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    
    return {"forms": forms}


@router.get("/registration-forms/{form_id}")
async def get_registration_form_details(form_id: str, member: dict = Depends(get_current_member)):
    """Get single registration form details"""
    phone = member.get("phone")
    
    form = await db.registration_forms.find_one(
        {"id": form_id, "customer_phone": phone},
        {"_id": 0}
    )
    
    if not form:
        raise HTTPException(status_code=404, detail="Registration form not found")
    
    return form


@router.get("/my-schedule")
async def get_member_full_schedule(member: dict = Depends(get_current_member)):
    """Get complete training schedule from registration forms and invoices"""
    phone = member.get("phone")
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    schedules = []
    
    # Get from registration forms
    forms = await db.registration_forms.find(
        {"customer_phone": phone},
        {"_id": 0}
    ).to_list(50)
    
    # Cache for coach lookups to avoid duplicate DB queries
    coach_cache = {}

    # Per-LEVEL coach maps for this member.
    level_coach_by_aid, level_coach_by_aname, level_coach_by_lid = \
        await get_member_level_coach_maps(member["id"])
    # activity_id -> level_id from the member's own activity entries.
    member_acts = member.get("activities", []) or []
    level_id_by_aid = {
        ma.get("activity_id"): ma.get("level_id")
        for ma in member_acts
        if ma.get("activity_id") and ma.get("level_id")
    }

    async def get_coach_for_activity(activity_id: str, activity_name: str = ""):
        """Look up coach info for an activity, using cache.
        Prefers the coach assigned to the member's level (matched by level_id,
        then activity_id, then activity_name) over the activity-level coach."""
        if not activity_id and not activity_name:
            return "", "", ""
        cache_key = (activity_id or "", activity_name or "")
        if cache_key in coach_cache:
            return coach_cache[cache_key]
        coach_id = ""
        lid = level_id_by_aid.get(activity_id) if activity_id else ""
        if lid and lid in level_coach_by_lid:
            coach_id = level_coach_by_lid[lid]
        elif activity_id and activity_id in level_coach_by_aid:
            coach_id = level_coach_by_aid[activity_id]
        elif activity_name and activity_name in level_coach_by_aname:
            coach_id = level_coach_by_aname[activity_name]
        if not coach_id and activity_id:
            activity_data = await db.activities.find_one(
                {"id": activity_id}, {"_id": 0, "coach_id": 1}
            )
            coach_id = activity_data.get("coach_id") if activity_data else ""
        if coach_id:
            coach = await db.coaches.find_one(
                {"id": coach_id}, {"_id": 0, "name_ar": 1, "name": 1, "photo": 1}
            )
            if coach:
                result = (
                    coach_id,
                    coach.get("name_ar") or coach.get("name", ""),
                    coach.get("photo", "")
                )
                coach_cache[cache_key] = result
                return result
        coach_cache[cache_key] = ("", "", "")
        return ("", "", "")

    for form in forms:
        for item in form.get("items", []):
            if item.get("activity_id") and item.get("schedule"):
                end_date = item.get("end_date", "")
                start_date = item.get("start_date", "")
                
                if not end_date and item.get("period"):
                    period = item.get("period", "")
                    if " - " in period:
                        parts = period.split(" - ")
                        if len(parts) == 2:
                            start_date = parts[0].strip()
                            end_date = parts[1].strip()
                
                status = "active" if end_date and end_date >= today else "expired"
                coach_id, coach_name, coach_photo = await get_coach_for_activity(item.get("activity_id"), item.get("activity_name") or "")
                
                schedules.append({
                    "source": "registration_form",
                    "form_number": form.get("form_number"),
                    "activity_id": item.get("activity_id"),
                    "activity_name": item.get("activity_name"),
                    "schedule": item.get("schedule"),
                    "start_date": start_date,
                    "end_date": end_date,
                    "status": status,
                    "coach_id": coach_id,
                    "coach_name": coach_name,
                    "coach_photo": coach_photo
                })
    
    # Get from invoices (for items with schedule)
    invoices = await db.invoices.find(
        {"member_id": member["id"], "status": {"$in": ["paid", "partial"]}},
        {"_id": 0}
    ).to_list(100)
    
    for inv in invoices:
        for item in inv.get("items", []):
            if item.get("activity_id") and item.get("schedule"):
                end_date = item.get("end_date", "")
                start_date = item.get("start_date", "")
                
                if not end_date and item.get("period"):
                    period = item.get("period", "")
                    if " - " in period:
                        parts = period.split(" - ")
                        if len(parts) == 2:
                            start_date = parts[0].strip()
                            end_date = parts[1].strip()
                
                status = "active" if end_date and end_date >= today else "expired"
                
                # Check if not already added from registration form
                already_exists = any(
                    s.get("activity_name") == item.get("activity_name") and 
                    s.get("start_date") == start_date 
                    for s in schedules
                )
                
                if not already_exists:
                    coach_id, coach_name, coach_photo = await get_coach_for_activity(item.get("activity_id"), item.get("activity_name") or "")
                    schedules.append({
                        "source": "invoice",
                        "invoice_number": inv.get("invoice_number"),
                        "activity_id": item.get("activity_id"),
                        "activity_name": item.get("activity_name"),
                        "schedule": item.get("schedule"),
                        "start_date": start_date,
                        "end_date": end_date,
                        "status": status,
                        "coach_id": coach_id,
                        "coach_name": coach_name,
                        "coach_photo": coach_photo
                    })
    
    # Sort by status (active first) then by end_date
    schedules.sort(key=lambda x: (0 if x.get("status") == "active" else 1, x.get("end_date", "")), reverse=True)
    
    return {
        "schedules": schedules,
        "active_count": len([s for s in schedules if s.get("status") == "active"]),
        "expired_count": len([s for s in schedules if s.get("status") == "expired"])
    }


class MemberMessageReply(BaseModel):
    body: str


PROFILE_CHANGE_FIELDS = {
    "name": ("الاسم", "Name"),
    "phone": ("رقم الجوال", "Phone"),
    "date_of_birth": ("تاريخ الميلاد", "Date of birth"),
}


class ProfileChangeRequest(BaseModel):
    field: str
    new_value: str
    reason: Optional[str] = None


@router.post("/profile/change-request")
async def submit_profile_change_request(
    data: ProfileChangeRequest,
    member: dict = Depends(get_current_member),
):
    """Let a member request an admin change one of their locked profile fields
    (name / phone / date of birth). Creates a message in the admin inbox; the
    member's profile is NOT mutated by this call."""
    field = (data.field or "").strip()
    if field not in PROFILE_CHANGE_FIELDS:
        raise HTTPException(status_code=400, detail="حقل غير مدعوم للتعديل")

    new_value = (data.new_value or "").strip()
    if not new_value:
        raise HTTPException(status_code=400, detail="الرجاء إدخال القيمة الجديدة")
    if len(new_value) > 200:
        raise HTTPException(status_code=400, detail="القيمة الجديدة طويلة جداً")

    reason = (data.reason or "").strip()
    if len(reason) > 500:
        raise HTTPException(status_code=400, detail="السبب طويل جداً")

    label_ar, label_en = PROFILE_CHANGE_FIELDS[field]
    if field == "name":
        current_value = member.get("name_ar") or member.get("name") or ""
    else:
        current_value = member.get(field) or ""

    body_lines = [
        f"طلب تعديل {label_ar}",
        f"القيمة الحالية: {current_value or '—'}",
        f"القيمة المطلوبة: {new_value}",
    ]
    if reason:
        body_lines.append(f"السبب: {reason}")
    body = "\n".join(body_lines)

    msg_id = str(uuid.uuid4())
    message = {
        "id": msg_id,
        "thread_id": member["id"],
        "sender_type": "member",
        "sender_id": member["id"],
        "sender_name": member.get("name_ar") or member.get("name") or "",
        "recipient_member_id": member["id"],
        "recipient_name": "الإدارة",
        "subject": f"طلب تعديل {label_ar}",
        "body": body,
        "is_broadcast": False,
        "read_by_member": True,
        "read_by_admin": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "kind": "profile_change_request",
        "change_request": {
            "field": field,
            "field_label_ar": label_ar,
            "field_label_en": label_en,
            "current_value": current_value,
            "new_value": new_value,
            "reason": reason,
        },
    }

    await db.messages.insert_one(message)
    return {"success": True, "id": msg_id, "message": "تم إرسال طلب التعديل إلى الإدارة"}


@router.get("/profile/change-requests")
async def get_pending_profile_change_requests(
    member: dict = Depends(get_current_member),
):
    """Return the member's currently-pending profile change requests so the
    profile page can show a "request pending" badge next to each locked field.

    A request is considered pending until an admin has read it (i.e.
    `read_by_admin` is False on the original member-sent message) AND it has
    not been resolved by the admin (status is neither "applied" nor
    "rejected"). The status guard catches the edge case where an admin
    rejects/applies a request that another admin already marked read. We
    keep at most one entry per field — the most recent unresolved one —
    because it's the only one the member would care about."""
    cursor = db.messages.find(
        {
            "sender_type": "member",
            "sender_id": member["id"],
            "kind": "profile_change_request",
            "read_by_admin": False,
            "change_request_status": {"$nin": ["applied", "rejected"]},
        },
        {"_id": 0},
    ).sort("created_at", -1)
    rows = await cursor.to_list(100)

    by_field: Dict[str, Dict[str, Any]] = {}
    for msg in rows:
        cr = msg.get("change_request") or {}
        field = cr.get("field")
        if not field or field not in PROFILE_CHANGE_FIELDS or field in by_field:
            continue
        by_field[field] = {
            "id": msg.get("id"),
            "field": field,
            "new_value": cr.get("new_value", ""),
            "current_value": cr.get("current_value", ""),
            "reason": cr.get("reason", ""),
            "created_at": msg.get("created_at"),
        }

    return {"pending": list(by_field.values())}


@router.get("/member/messages")
async def get_member_messages(member: dict = Depends(get_current_member)):
    messages = await db.messages.find(
        {"recipient_member_id": member["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(500)

    await db.messages.update_many(
        {"recipient_member_id": member["id"], "sender_type": "admin", "read_by_member": False},
        {"$set": {"read_by_member": True}}
    )

    member_photo = member.get("photo", "") or ""

    # Look up admin sender photos in one batch so admin bubbles can also
    # show a photo when the admin user has one. Admins don't always have a
    # `photo` field today — `sender_photo` is "" in that case and the UI
    # falls back to initials.
    admin_sender_ids = list({
        msg.get("sender_id") for msg in messages
        if msg.get("sender_type") == "admin" and msg.get("sender_id")
    })
    admin_info = {}
    if admin_sender_ids:
        admin_users = await db.users.find(
            {"id": {"$in": admin_sender_ids}},
            {"_id": 0, "id": 1, "photo": 1, "name": 1}
        ).to_list(len(admin_sender_ids))
        admin_info = {
            u["id"]: {"photo": u.get("photo", "") or "", "name": u.get("name", "") or ""}
            for u in admin_users
        }

    for msg in messages:
        if msg.get("sender_type") == "member":
            msg["sender_photo"] = member_photo
        else:
            info = admin_info.get(msg.get("sender_id", ""), {})
            msg["sender_photo"] = info.get("photo", "")

    return {
        "messages": messages,
        "member_photo": member_photo,
    }


@router.post("/member/messages/reply")
async def member_reply(data: MemberMessageReply, member: dict = Depends(get_current_member)):
    import uuid

    last_msg = await db.messages.find_one(
        {"recipient_member_id": member["id"]},
        {"_id": 0, "subject": 1},
        sort=[("created_at", -1)]
    )

    msg_id = str(uuid.uuid4())
    message = {
        "id": msg_id,
        "thread_id": member["id"],
        "sender_type": "member",
        "sender_id": member["id"],
        "sender_name": member.get("name_ar", member.get("name", "")),
        "recipient_member_id": member["id"],
        "recipient_name": "الإدارة",
        "subject": last_msg.get("subject", "رسالة من عضو") if last_msg else "رسالة من عضو",
        "body": data.body,
        "is_broadcast": False,
        "read_by_member": True,
        "read_by_admin": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    await db.messages.insert_one(message)
    return {"message": "تم إرسال الرسالة", "id": msg_id}


@router.get("/member/messages/unread-count")
async def get_member_unread_count(member: dict = Depends(get_current_member)):
    count = await db.messages.count_documents({
        "recipient_member_id": member["id"],
        "sender_type": "admin",
        "read_by_member": False
    })
    return {"unread_count": count}

