"""
Public Self-Registration Requests
==================================
Lets a parent/guardian self-register through a public per-branch link
(no authentication). Submissions land in a review queue (status="pending")
as `registration_requests` documents and are NEVER auto-converted into
members — a supervisor reviews each one and completes it into an invoice
through the normal invoice flow.

Routes:
  Public (no auth, tenant resolved from X-Tenant-Slug / subdomain):
    GET  /public/registration/{branch_id}   -> branch name + its activities
    POST /public/registration/{branch_id}   -> create a pending request
  Admin/staff (auth + branch scope):
    GET    /registration-requests            -> list (branch-scoped)
    PUT    /registration-requests/{req_id}   -> update status
    DELETE /registration-requests/{req_id}   -> delete / reject
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import uuid

from database import db
from utils.auth import get_current_user, require_branch_scope, resolve_branch_filter
from utils.tenant import get_current_tenant

router = APIRouter(tags=["RegistrationRequests"])


def _academy_name() -> str:
    """Public display name of the current tenant (resolved by middleware from
    X-Tenant-Slug / subdomain). Only the name is exposed on public pages."""
    t = get_current_tenant() or {}
    return t.get("name", "") or ""

# ============ MODELS ============

class PublicRegistrationCreate(BaseModel):
    customer_name: str
    customer_phone: str
    nationality: Optional[str] = ""
    activity_id: Optional[str] = ""
    activity_name: Optional[str] = ""
    preferred_days: List[str] = []
    preferred_time: Optional[str] = ""
    notes: Optional[str] = ""
    referral_code: Optional[str] = ""
    source: Optional[str] = ""

class RegistrationRequestUpdate(BaseModel):
    status: str


# ============ PUBLIC ROUTES (no auth) ============

@router.get("/public/branches")
async def public_list_branches():
    """Return all branches for the tenant so the public form can let the
    visitor pick a branch. Tenant is resolved by the middleware from the
    X-Tenant-Slug header / subdomain."""
    branches = await db.branches.find(
        {}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "public_name": 1}
    ).to_list(500)
    # Only expose a public-facing label. When a branch has a custom public_name we
    # return it as the name so the internal branch name is never sent to the public
    # page; otherwise we fall back to the normal branch name.
    public_branches = []
    for b in branches:
        label = (b.get("public_name") or "").strip()
        public_branches.append({
            "id": b["id"],
            "name": label or b.get("name") or "",
            "name_ar": label or b.get("name_ar") or b.get("name") or "",
        })
    return {"branches": public_branches, "academy_name": _academy_name()}


@router.get("/public/registration/{branch_id}")
async def public_get_registration_branch(branch_id: str):
    """Return the branch name and the activities available for that branch so
    the public form can present activity choices. Tenant is resolved by the
    middleware from the X-Tenant-Slug header / subdomain."""
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "public_name": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    # Branch-scoped activities + shared/legacy (branch_id null/missing)
    activities = await db.activities.find(
        {"$or": [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": {"$exists": False}}]},
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "monthly_fee": 1}
    ).to_list(200)

    # Expose only the public-facing label so the internal branch name is never
    # sent to the public page; fall back to the normal name when no public_name.
    _label = (branch.get("public_name") or "").strip()
    return {
        "branch": {
            "id": branch["id"],
            "name": _label or branch.get("name", ""),
            "name_ar": _label or branch.get("name_ar", "") or branch.get("name", ""),
        },
        "activities": activities,
        "academy_name": _academy_name(),
    }


@router.post("/public/registration/{branch_id}")
async def public_create_registration(branch_id: str, payload: PublicRegistrationCreate):
    """Public submission -> pending review request. No member is created."""
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0, "id": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    name = (payload.customer_name or "").strip()
    phone = (payload.customer_phone or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="الاسم مطلوب")
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) < 8:
        raise HTTPException(status_code=400, detail="رقم الموبايل غير صحيح")
    nationality = (payload.nationality or "").strip()
    if not nationality:
        raise HTTPException(status_code=400, detail="الجنسية مطلوبة")

    # Light anti-spam: cap repeated submissions from the same phone+branch.
    one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    recent = await db.registration_requests.count_documents({
        "branch_id": branch_id,
        "customer_phone": phone,
        "created_at": {"$gte": one_hour_ago},
    })
    if recent >= 3:
        raise HTTPException(status_code=429, detail="تم استلام طلبك بالفعل. برجاء الانتظار قبل إرسال طلب جديد.")

    doc = {
        "id": str(uuid.uuid4()),
        "customer_name": name,
        "customer_phone": phone,
        "nationality": nationality,
        "activity_id": (payload.activity_id or "").strip(),
        "activity_name": (payload.activity_name or "").strip(),
        "preferred_days": [d for d in (payload.preferred_days or []) if d],
        "preferred_time": (payload.preferred_time or "").strip(),
        "notes": (payload.notes or "").strip(),
        "branch_id": branch_id,
        "status": "pending",
        # Track where the request came from. "social_ad" = the all-branches
        # link shared in social-media ads; anything else falls back to the
        # normal public link so we never store arbitrary client-supplied values.
        "source": "social_ad" if (payload.source or "").strip().lower() in ("social", "social_ad") else "public_link",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    # Marketer (affiliate) referral: attach the marketer if the link carried a
    # valid, active referral code so the supervisor sees it and the discount +
    # commission flow through to the first invoice.
    ref_code = (payload.referral_code or "").strip()
    if ref_code:
        marketer = await db.marketers.find_one(
            {"referral_code": ref_code, "status": {"$ne": "inactive"}},
            {"_id": 0, "id": 1, "name": 1, "discount_percent": 1, "commission_percent": 1, "branch_id": 1, "branch_ids": 1},
        )
        # Only attach if the marketer belongs to this branch or is shared
        # (no branch restriction). Prevents cross-branch referral attribution.
        m_branch_ids = (marketer or {}).get("branch_ids") or []
        m_branch = (marketer or {}).get("branch_id")
        if m_branch_ids:
            branch_ok = branch_id in m_branch_ids
        else:
            branch_ok = (not m_branch) or (m_branch == branch_id)
        if marketer and branch_ok:
            doc["marketer_id"] = marketer["id"]
            doc["referral_code"] = ref_code
            doc["marketer_name"] = marketer.get("name", "")
            doc["marketer_discount_percent"] = marketer.get("discount_percent", 0)
            doc["marketer_commission_percent"] = marketer.get("commission_percent", 0)

    await db.registration_requests.insert_one(doc)

    # Notify admins (branch-scoped) that a new self-registration request arrived.
    # Best-effort: a push failure must never break the public submission.
    try:
        from routes.push_notifications import send_push_to_admins, NotificationPayload
        activity_txt = doc["activity_name"] or "بدون نشاط محدد"
        payload = NotificationPayload(
            title="طلب تسجيل جديد",
            body=f"{name} — {activity_txt}",
            url="/admin/registration-requests",
            tag="registration-request",
            title_en="New registration request",
            body_en=f"{name} — {doc['activity_name'] or 'no activity'}",
        )
        await send_push_to_admins(payload, branch_id=branch_id)
    except Exception:
        pass

    return {"success": True, "message": "تم استلام طلب التسجيل بنجاح"}


# ============ ADMIN ROUTES (auth + branch scope) ============

@router.get("/registration-requests/count")
async def count_pending_registration_requests(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Lightweight count of pending requests for the sidebar badge."""
    query: dict = {"status": "pending"}
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch
    count = await db.registration_requests.count_documents(query)
    return {"count": count}


@router.get("/registration-requests")
async def list_registration_requests(
    branch_filter: Optional[str] = None,
    status: Optional[str] = "pending",
    current_user: dict = Depends(get_current_user),
):
    query: dict = {}
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch
    if status and status != "all":
        query["status"] = status

    requests = await db.registration_requests.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return requests


@router.put("/registration-requests/{req_id}")
async def update_registration_request(
    req_id: str,
    payload: RegistrationRequestUpdate,
    current_user: dict = Depends(get_current_user),
):
    allowed_statuses = {"pending", "processed", "rejected"}
    if payload.status not in allowed_statuses:
        raise HTTPException(status_code=400, detail="حالة غير صحيحة")

    req = await db.registration_requests.find_one({"id": req_id}, {"_id": 0, "branch_id": 1})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    scope = require_branch_scope(current_user)
    if scope and req.get("branch_id") != scope:
        raise HTTPException(status_code=403, detail="غير مصرح لك بهذا الطلب")

    await db.registration_requests.update_one(
        {"id": req_id}, {"$set": {"status": payload.status}}
    )
    return {"success": True}


@router.delete("/registration-requests/{req_id}")
async def delete_registration_request(
    req_id: str,
    current_user: dict = Depends(get_current_user),
):
    req = await db.registration_requests.find_one({"id": req_id}, {"_id": 0, "branch_id": 1})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    scope = require_branch_scope(current_user)
    if scope and req.get("branch_id") != scope:
        raise HTTPException(status_code=403, detail="غير مصرح لك بهذا الطلب")

    await db.registration_requests.delete_one({"id": req_id})
    return {"success": True}
