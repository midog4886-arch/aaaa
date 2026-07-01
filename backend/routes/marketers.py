"""
Marketers (Affiliates) — المسوّقون بالعمولة
==========================================
Commission-based marketers. Each marketer has a unique referral code, a
discount percentage (applied to a referred member's FIRST invoice only) and a
commission percentage (earned ONCE, on that first invoice's net value before
VAT). A per-branch public registration link carries the referral code so
self-registered potential members are attached to the marketer automatically.

Commission payouts reuse the existing payment-vouchers flow.

Routes:
  Public (no auth, tenant resolved from X-Tenant-Slug / subdomain):
    GET  /public/marketers/{code}            -> {name, discount_percent} (active only)
  Admin/staff (auth + `marketers` permission + branch scope):
    GET    /marketers                        -> list with commission stats
    POST   /marketers                        -> create (auto referral code)
    GET    /marketers/{id}                   -> one marketer
    PUT    /marketers/{id}                   -> update
    DELETE /marketers/{id}                   -> delete
    GET    /marketers/{id}/commissions       -> commission records
    POST   /marketers/{id}/payout            -> pay due commissions via a voucher
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
import random
import secrets
import string

from pymongo.errors import DuplicateKeyError

from database import db
from utils.auth import (
    get_current_user,
    require_branch_scope,
    resolve_branch_filter,
    require_permission,
)

router = APIRouter(tags=["Marketers"])

PERMISSION_KEY = "marketers"

PAYMENT_METHODS = {"cash": "نقداً", "transfer": "تحويل بنكي", "check": "شيك"}
ALLOWED_PAYMENT_METHODS = set(PAYMENT_METHODS.keys())


# ============ MODELS ============

class MarketerCreate(BaseModel):
    name: str
    phone: Optional[str] = ""
    referral_code: Optional[str] = None
    discount_percent: float = 0
    commission_percent: float = 0
    branch_id: Optional[str] = None
    branch_ids: Optional[List[str]] = None
    notes: Optional[str] = ""


class MarketerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    referral_code: Optional[str] = None
    discount_percent: Optional[float] = None
    commission_percent: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    branch_id: Optional[str] = None
    branch_ids: Optional[List[str]] = None


class MarketerPayout(BaseModel):
    payment_method: str = "cash"
    payment_date: Optional[str] = None
    reference: Optional[str] = ""
    notes: Optional[str] = ""


# ============ HELPERS ============

def _validate_percent(value, label: str) -> float:
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{label} غير صحيحة")
    if v < 0 or v > 100:
        raise HTTPException(status_code=400, detail=f"{label} يجب أن تكون بين 0 و 100")
    return round(v, 2)


def _normalize_referral_code(code: str) -> str:
    """Normalize a manually-entered referral code: uppercase, strip, keep only
    A-Z and 0-9. Validates length (3-20). Raises 400 on invalid input."""
    raw = (code or "").strip().upper()
    cleaned = "".join(c for c in raw if c in (string.ascii_uppercase + string.digits))
    if cleaned != raw.replace(" ", ""):
        # Reject if the user typed disallowed characters (anything beyond A-Z/0-9)
        raise HTTPException(status_code=400, detail="كود الإحالة يجب أن يحتوي على حروف إنجليزية وأرقام فقط")
    if len(cleaned) < 3 or len(cleaned) > 20:
        raise HTTPException(status_code=400, detail="كود الإحالة يجب أن يكون بين 3 و 20 حرفاً/رقماً")
    return cleaned


async def _ensure_code_unique(code: str, exclude_id: Optional[str] = None) -> None:
    """Raise 400 if another marketer already uses this referral code."""
    query: dict = {"referral_code": code}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    exists = await db.marketers.find_one(query, {"_id": 1})
    if exists:
        raise HTTPException(status_code=400, detail="كود الإحالة مستخدم بالفعل، اختر كوداً آخر")


async def _generate_referral_code(name: str) -> str:
    """Build a short, human-friendly, unique referral code (ASCII)."""
    base = "".join(c for c in (name or "").upper() if c in (string.ascii_uppercase + string.digits))[:5]
    if not base:
        base = "REF"
    for _ in range(20):
        suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
        code = f"{base}{suffix}"
        exists = await db.marketers.find_one({"referral_code": code}, {"_id": 1})
        if not exists:
            return code
    # Extremely unlikely fallback
    return f"REF{uuid.uuid4().hex[:8].upper()}"


async def _commission_stats(marketer_ids: list) -> dict:
    """Aggregate commission stats grouped by marketer_id."""
    if not marketer_ids:
        return {}
    pipeline = [
        {"$match": {"marketer_id": {"$in": marketer_ids}}},
        {"$group": {
            "_id": "$marketer_id",
            "referrals": {"$sum": 1},
            "total_commission": {"$sum": "$commission_amount"},
            "due_amount": {"$sum": {"$cond": [{"$eq": ["$status", "due"]}, "$commission_amount", 0]}},
            "paid_amount": {"$sum": {"$cond": [{"$eq": ["$status", "paid"]}, "$commission_amount", 0]}},
        }},
    ]
    rows = await db.marketer_commissions.aggregate(pipeline).to_list(5000)
    return {r["_id"]: r for r in rows}


def _generate_portal_token() -> str:
    """A long, URL-safe random token that acts as the marketer's private portal
    credential (the link itself is the secret)."""
    return secrets.token_urlsafe(24)


async def _ensure_portal_token(marketer: dict) -> str:
    """Return the marketer's portal token, generating and persisting one the
    first time it is needed (lazy backfill for marketers created before the
    portal existed)."""
    token = marketer.get("portal_token")
    if token:
        return token
    token = _generate_portal_token()
    await db.marketers.update_one({"id": marketer["id"]}, {"$set": {"portal_token": token}})
    marketer["portal_token"] = token
    return token


async def _generate_voucher_number() -> str:
    year = datetime.now(timezone.utc).year
    counter_id = f"payment_vouchers_{year}"
    result = await db.counters.find_one_and_update(
        {"_id": counter_id}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    return f"PV-{year}-{str(result['seq']).zfill(3)}"


# ============ PUBLIC ROUTE (no auth) ============

@router.get("/public/marketers/{code}")
async def public_get_marketer(code: str):
    """Resolve an active marketer by referral code so the public registration
    page can show the special discount. Tenant resolved by middleware."""
    marketer = await db.marketers.find_one(
        {"referral_code": code, "status": {"$ne": "inactive"}},
        {"_id": 0, "id": 1, "name": 1, "discount_percent": 1},
    )
    if not marketer:
        raise HTTPException(status_code=404, detail="كود الإحالة غير صحيح")
    return marketer


@router.get("/public/marketer-portal/{token}")
async def public_marketer_portal(token: str):
    """Read-only self-service portal data for a marketer, resolved by their
    private portal token. Tenant resolved by middleware. No auth — the long
    random token IS the credential."""
    if not token or len(token) < 10:
        raise HTTPException(status_code=404, detail="رابط البوابة غير صالح")
    marketer = await db.marketers.find_one({"portal_token": token}, {"_id": 0})
    if not marketer:
        raise HTTPException(status_code=404, detail="رابط البوابة غير صالح")
    stats = await _commission_stats([marketer["id"]])
    s = stats.get(marketer["id"], {})
    commissions = await db.marketer_commissions.find(
        {"marketer_id": marketer["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(2000)
    return {
        "marketer": {
            "name": marketer.get("name", ""),
            "referral_code": marketer.get("referral_code", ""),
            "discount_percent": marketer.get("discount_percent", 0),
            "commission_percent": marketer.get("commission_percent", 0),
            "status": marketer.get("status", "active"),
            "branch_id": marketer.get("branch_id"),
        },
        "stats": {
            "referrals": s.get("referrals", 0),
            "total_commission": round(s.get("total_commission", 0), 2),
            "due_amount": round(s.get("due_amount", 0), 2),
            "paid_amount": round(s.get("paid_amount", 0), 2),
        },
        "commissions": commissions,
    }


# ============ ADMIN ROUTES ============

def _resolve_branch_selection(raw_ids):
    """Normalize a marketer's branch selection into (branch_ids, legacy branch_id).

    Empty / ["all"] => shared across ALL branches (branch_ids=[], branch_id=None).
    One or more specific ids => scoped to those branches; legacy branch_id is set
    only when exactly one branch is picked (keeps single-branch legacy readers working).
    """
    ids = []
    for b in (raw_ids or []):
        if b and b != "all" and b not in ids:
            ids.append(b)
    if not ids:
        return [], None
    return ids, (ids[0] if len(ids) == 1 else None)


def _branch_visibility_or(effective_branch: str):
    """$or clauses making a marketer visible to `effective_branch` when it is one of
    the marketer's branches (new branch_ids OR legacy branch_id), or when the marketer
    is shared (no branch restriction at all)."""
    return [
        {"branch_ids": effective_branch},
        {"branch_id": effective_branch},
        {"$and": [
            {"$or": [{"branch_ids": {"$exists": False}}, {"branch_ids": []}, {"branch_ids": None}]},
            {"$or": [{"branch_id": None}, {"branch_id": ""}, {"branch_id": {"$exists": False}}]},
        ]},
    ]


@router.get("/marketers")
async def list_marketers(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    await require_permission(current_user, PERMISSION_KEY)
    query: dict = {}
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["$or"] = _branch_visibility_or(effective_branch)

    marketers = await db.marketers.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    stats = await _commission_stats([m["id"] for m in marketers])
    for m in marketers:
        s = stats.get(m["id"], {})
        m["referrals"] = s.get("referrals", 0)
        m["total_commission"] = round(s.get("total_commission", 0), 2)
        m["due_amount"] = round(s.get("due_amount", 0), 2)
        m["paid_amount"] = round(s.get("paid_amount", 0), 2)
        m["portal_token"] = await _ensure_portal_token(m)
    return marketers


@router.get("/marketers/analytics")
async def marketers_analytics(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Aggregate marketing-performance analytics for the admin dashboard,
    respecting the same branch scoping as the marketers list. Declared BEFORE
    /marketers/{marketer_id} so the literal path wins the route match."""
    await require_permission(current_user, PERMISSION_KEY)
    query: dict = {}
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["$or"] = _branch_visibility_or(effective_branch)

    marketers = await db.marketers.find(query, {"_id": 0}).to_list(2000)
    marketer_ids = [m["id"] for m in marketers]
    active = sum(1 for m in marketers if m.get("status") != "inactive")
    stats = await _commission_stats(marketer_ids)

    total_referrals = sum(s.get("referrals", 0) for s in stats.values())
    total_commission = round(sum(s.get("total_commission", 0) for s in stats.values()), 2)
    total_due = round(sum(s.get("due_amount", 0) for s in stats.values()), 2)
    total_paid = round(sum(s.get("paid_amount", 0) for s in stats.values()), 2)

    top = []
    for m in marketers:
        s = stats.get(m["id"], {})
        top.append({
            "id": m["id"],
            "name": m.get("name", ""),
            "referral_code": m.get("referral_code", ""),
            "referrals": s.get("referrals", 0),
            "total_commission": round(s.get("total_commission", 0), 2),
            "due_amount": round(s.get("due_amount", 0), 2),
            "paid_amount": round(s.get("paid_amount", 0), 2),
        })
    top.sort(key=lambda x: (x["total_commission"], x["referrals"]), reverse=True)
    top_marketers = top[:7]

    # Monthly trend over the last 6 months, from commissions of in-scope marketers.
    monthly_map = {}
    if marketer_ids:
        pipeline = [
            {"$match": {"marketer_id": {"$in": marketer_ids}}},
            {"$group": {
                "_id": {"$substr": ["$created_at", 0, 7]},
                "referrals": {"$sum": 1},
                "commission": {"$sum": "$commission_amount"},
            }},
        ]
        rows = await db.marketer_commissions.aggregate(pipeline).to_list(1000)
        monthly_map = {r["_id"]: r for r in rows}

    ar_months = ["", "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
                 "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
    now = datetime.now(timezone.utc)
    y, mo = now.year, now.month
    seq = []
    for _ in range(6):
        seq.append((y, mo))
        mo -= 1
        if mo == 0:
            mo = 12
            y -= 1
    seq.reverse()
    monthly = []
    for (yy, mm) in seq:
        key = f"{yy}-{str(mm).zfill(2)}"
        r = monthly_map.get(key, {})
        monthly.append({
            "month": key,
            "label": f"{ar_months[mm]} {yy}",
            "referrals": r.get("referrals", 0),
            "commission": round(r.get("commission", 0), 2),
        })

    return {
        "summary": {
            "total_marketers": len(marketers),
            "active_marketers": active,
            "inactive_marketers": len(marketers) - active,
            "total_referrals": total_referrals,
            "total_commission": total_commission,
            "total_due": total_due,
            "total_paid": total_paid,
        },
        "top_marketers": top_marketers,
        "monthly": monthly,
    }


@router.post("/marketers")
async def create_marketer(
    data: MarketerCreate,
    current_user: dict = Depends(get_current_user),
):
    await require_permission(current_user, PERMISSION_KEY)
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم المسوّق مطلوب")
    discount_percent = _validate_percent(data.discount_percent, "نسبة الخصم")
    commission_percent = _validate_percent(data.commission_percent, "نسبة العمولة")

    # Branch assignment: non-admins pinned to their own branch; admins may pick
    # a branch or leave it shared (None).
    if current_user.get("is_admin", False):
        raw = data.branch_ids if data.branch_ids is not None else ([data.branch_id] if data.branch_id else [])
        branch_ids, branch_id = _resolve_branch_selection(raw)
    else:
        own = require_branch_scope(current_user)
        branch_ids, branch_id = [own], own

    if (data.referral_code or "").strip():
        code = _normalize_referral_code(data.referral_code)
        await _ensure_code_unique(code)
    else:
        code = await _generate_referral_code(name)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "name": name,
        "phone": (data.phone or "").strip(),
        "referral_code": code,
        "discount_percent": discount_percent,
        "commission_percent": commission_percent,
        "status": "active",
        "notes": (data.notes or "").strip(),
        "branch_id": branch_id,
        "branch_ids": branch_ids,
        "portal_token": _generate_portal_token(),
        "created_by": current_user.get("name", current_user.get("username", "")),
        "created_at": now,
        "updated_at": now,
    }
    await db.marketers.insert_one(doc)
    doc.pop("_id", None)
    return doc


def _scoped_marketer_query(marketer_id: str, current_user: dict) -> dict:
    """Object-level branch guard: list scoping alone leaks via a known id."""
    query = {"id": marketer_id}
    effective_branch = resolve_branch_filter(current_user, None)
    if effective_branch:
        query["$or"] = _branch_visibility_or(effective_branch)
    return query


@router.get("/marketers/{marketer_id}")
async def get_marketer(marketer_id: str, current_user: dict = Depends(get_current_user)):
    await require_permission(current_user, PERMISSION_KEY)
    marketer = await db.marketers.find_one(_scoped_marketer_query(marketer_id, current_user), {"_id": 0})
    if not marketer:
        raise HTTPException(status_code=404, detail="المسوّق غير موجود")
    return marketer


@router.put("/marketers/{marketer_id}")
async def update_marketer(
    marketer_id: str,
    data: MarketerUpdate,
    current_user: dict = Depends(get_current_user),
):
    await require_permission(current_user, PERMISSION_KEY)
    existing = await db.marketers.find_one(_scoped_marketer_query(marketer_id, current_user), {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="المسوّق غير موجود")

    update_data = {}
    if data.name is not None:
        if not data.name.strip():
            raise HTTPException(status_code=400, detail="اسم المسوّق مطلوب")
        update_data["name"] = data.name.strip()
    if data.phone is not None:
        update_data["phone"] = data.phone.strip()
    if data.discount_percent is not None:
        update_data["discount_percent"] = _validate_percent(data.discount_percent, "نسبة الخصم")
    if data.commission_percent is not None:
        update_data["commission_percent"] = _validate_percent(data.commission_percent, "نسبة العمولة")
    if data.status is not None:
        if data.status not in ("active", "inactive"):
            raise HTTPException(status_code=400, detail="حالة غير صحيحة")
        update_data["status"] = data.status
    if data.notes is not None:
        update_data["notes"] = data.notes.strip()
    if (data.referral_code or "").strip():
        code = _normalize_referral_code(data.referral_code)
        if code != existing.get("referral_code"):
            await _ensure_code_unique(code, exclude_id=marketer_id)
            update_data["referral_code"] = code

    # Branch reassignment is admin-only (mirrors create + the admin-gated UI field).
    # Use fields_set so an explicit "all"/empty from an admin maps to shared,
    # while non-admins / omitted payloads never touch the stored branch.
    if current_user.get("is_admin", False) and (
        "branch_ids" in data.model_fields_set or "branch_id" in data.model_fields_set
    ):
        if "branch_ids" in data.model_fields_set:
            raw = data.branch_ids or []
        else:
            raw = [data.branch_id] if data.branch_id else []
        b_ids, b_id = _resolve_branch_selection(raw)
        update_data["branch_ids"] = b_ids
        update_data["branch_id"] = b_id

    if not update_data:
        raise HTTPException(status_code=400, detail="لا توجد بيانات للتحديث")
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.marketers.update_one({"id": marketer_id}, {"$set": update_data})
    updated = await db.marketers.find_one({"id": marketer_id}, {"_id": 0})
    return updated


@router.delete("/marketers/{marketer_id}")
async def delete_marketer(marketer_id: str, current_user: dict = Depends(get_current_user)):
    await require_permission(current_user, PERMISSION_KEY)
    result = await db.marketers.delete_one(_scoped_marketer_query(marketer_id, current_user))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="المسوّق غير موجود")
    return {"success": True, "message": "تم حذف المسوّق"}


@router.get("/marketers/{marketer_id}/commissions")
async def list_marketer_commissions(
    marketer_id: str,
    current_user: dict = Depends(get_current_user),
):
    await require_permission(current_user, PERMISSION_KEY)
    marketer = await db.marketers.find_one(_scoped_marketer_query(marketer_id, current_user), {"_id": 0, "id": 1})
    if not marketer:
        raise HTTPException(status_code=404, detail="المسوّق غير موجود")
    commissions = await db.marketer_commissions.find(
        {"marketer_id": marketer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(5000)
    return commissions


@router.post("/marketers/{marketer_id}/portal-token")
async def marketer_portal_token(
    marketer_id: str,
    regenerate: bool = False,
    current_user: dict = Depends(get_current_user),
):
    """Ensure (or rotate) the marketer's private portal token and return it.
    Rotating invalidates any previously shared portal link."""
    await require_permission(current_user, PERMISSION_KEY)
    marketer = await db.marketers.find_one(_scoped_marketer_query(marketer_id, current_user), {"_id": 0})
    if not marketer:
        raise HTTPException(status_code=404, detail="المسوّق غير موجود")
    if regenerate or not marketer.get("portal_token"):
        token = _generate_portal_token()
        await db.marketers.update_one(
            {"id": marketer_id},
            {"$set": {"portal_token": token, "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
    else:
        token = marketer["portal_token"]
    return {"portal_token": token}


@router.post("/marketers/{marketer_id}/payout")
async def payout_marketer(
    marketer_id: str,
    data: MarketerPayout,
    current_user: dict = Depends(get_current_user),
):
    """Pay all DUE commissions for a marketer by issuing a single payment
    voucher, then mark those commissions as paid."""
    await require_permission(current_user, PERMISSION_KEY)
    marketer = await db.marketers.find_one(_scoped_marketer_query(marketer_id, current_user), {"_id": 0})
    if not marketer:
        raise HTTPException(status_code=404, detail="المسوّق غير موجود")
    if data.payment_method not in ALLOWED_PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="طريقة الدفع غير صالحة")

    due = await db.marketer_commissions.find(
        {"marketer_id": marketer_id, "status": "due"}, {"_id": 0}
    ).to_list(5000)
    total = round(sum(float(c.get("commission_amount") or 0) for c in due), 2)
    if total <= 0:
        raise HTTPException(status_code=400, detail="لا توجد عمولات مستحقة للصرف")

    # Voucher branch: marketer's branch, else the user's branch (fail-closed for
    # non-admins so we never create a branch-less voucher visible to all).
    branch_id = marketer.get("branch_id") or current_user.get("branch_id")
    if not current_user.get("is_admin", False):
        branch_id = require_branch_scope(current_user)

    payment_date = data.payment_date or datetime.now(timezone.utc).date().isoformat()
    now = datetime.now(timezone.utc).isoformat()
    voucher_number = await _generate_voucher_number()
    voucher = {
        "id": str(uuid.uuid4()),
        "voucher_number": voucher_number,
        "beneficiary_name": marketer.get("name", ""),
        "amount": total,
        "purpose": f"عمولة تسويق - {marketer.get('name', '')}",
        "payment_date": payment_date,
        "payment_method": data.payment_method,
        "payment_method_ar": PAYMENT_METHODS.get(data.payment_method, data.payment_method),
        "status": "paid",
        "status_ar": "مدفوع",
        "reference": data.reference or "",
        "notes": data.notes or "",
        "created_by": current_user.get("name", current_user.get("username", "")),
        "branch_id": branch_id or "",
        "created_at": now,
        "updated_at": now,
        "source": "marketer_commission",
        "marketer_id": marketer_id,
    }
    try:
        await db.payment_vouchers.insert_one(voucher)
    except Exception:
        voucher["voucher_number"] = await _generate_voucher_number()
        voucher["id"] = str(uuid.uuid4())
        await db.payment_vouchers.insert_one(voucher)
    voucher.pop("_id", None)

    await db.marketer_commissions.update_many(
        {"marketer_id": marketer_id, "status": "due"},
        {"$set": {
            "status": "paid",
            "voucher_id": voucher["id"],
            "voucher_number": voucher["voucher_number"],
            "paid_at": now,
        }},
    )
    return {"success": True, "voucher": voucher, "paid_count": len(due), "paid_amount": total}


# ============ INVOICE HOOK (called from invoices.create) ============

async def record_first_invoice_commission(member: dict, invoice_doc: dict, subtotal: float, discount: float):
    """If the member was referred by a marketer and this is their FIRST invoice,
    record a one-time commission. Idempotent per member (guarded by the caller
    via 'no prior invoice' + the unique-per-member commission check here)."""
    if not member:
        return
    marketer_id = member.get("marketer_id")
    if not marketer_id:
        return
    existing = await db.marketer_commissions.find_one({"member_id": member.get("id")}, {"_id": 1})
    if existing:
        return
    marketer = await db.marketers.find_one({"id": marketer_id}, {"_id": 0})
    if not marketer:
        return
    comm_pct = float(marketer.get("commission_percent") or 0)
    base_amount = round(float(subtotal) - float(discount or 0), 2)
    commission_amount = round(base_amount * comm_pct / 100, 2)
    # Idempotency: a unique index on member_id makes the insert atomic so two
    # concurrent "first" invoices cannot both record a commission. The index is
    # created opportunistically (no-op once it exists).
    try:
        await db.marketer_commissions.create_index("member_id", unique=True)
    except Exception:
        pass
    try:
        await db.marketer_commissions.insert_one({
            "id": str(uuid.uuid4()),
            "marketer_id": marketer_id,
            "marketer_name": marketer.get("name", ""),
            "referral_code": marketer.get("referral_code", ""),
            "member_id": member.get("id"),
            "member_name": member.get("name_ar", member.get("name", "")),
            "invoice_id": invoice_doc.get("id"),
            "invoice_number": invoice_doc.get("invoice_number"),
            "base_amount": base_amount,
            "commission_percent": comm_pct,
            "commission_amount": commission_amount,
            "status": "due",
            "voucher_id": None,
            "voucher_number": None,
            "branch_id": invoice_doc.get("branch_id"),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "paid_at": None,
        })
    except DuplicateKeyError:
        # Another first-invoice request already recorded the commission.
        return


async def resolve_marketer_discount(member: dict, current_discount: float, subtotal: float) -> float:
    """Return the discount to apply for a referred member's FIRST invoice.
    Respects an already-entered manual discount and only applies when the member
    has no prior invoice."""
    if not member or (current_discount or 0) > 0:
        return current_discount or 0
    marketer_id = member.get("marketer_id")
    if not marketer_id:
        return current_discount or 0
    prior_invoice = await db.invoices.find_one({"member_id": member.get("id")}, {"_id": 1})
    if prior_invoice:
        return current_discount or 0
    marketer = await db.marketers.find_one(
        {"id": marketer_id, "status": {"$ne": "inactive"}}, {"_id": 0, "discount_percent": 1}
    )
    if not marketer:
        return current_discount or 0
    disc_pct = float(marketer.get("discount_percent") or 0)
    if disc_pct <= 0:
        return current_discount or 0
    return round(float(subtotal) * disc_pct / 100, 2)
