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

router = APIRouter(tags=["RegistrationRequests"])

# ============ MODELS ============

class PublicRegistrationCreate(BaseModel):
    customer_name: str
    customer_phone: str
    activity_id: Optional[str] = ""
    activity_name: Optional[str] = ""
    preferred_days: List[str] = []
    preferred_time: Optional[str] = ""
    notes: Optional[str] = ""

class RegistrationRequestUpdate(BaseModel):
    status: str


# ============ PUBLIC ROUTES (no auth) ============

@router.get("/public/registration/{branch_id}")
async def public_get_registration_branch(branch_id: str):
    """Return the branch name and the activities available for that branch so
    the public form can present activity choices. Tenant is resolved by the
    middleware from the X-Tenant-Slug header / subdomain."""
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    # Branch-scoped activities + shared/legacy (branch_id null/missing)
    activities = await db.activities.find(
        {"$or": [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": {"$exists": False}}]},
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "monthly_fee": 1}
    ).to_list(200)

    return {
        "branch": {
            "id": branch["id"],
            "name": branch.get("name", ""),
            "name_ar": branch.get("name_ar", ""),
        },
        "activities": activities,
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
        "activity_id": (payload.activity_id or "").strip(),
        "activity_name": (payload.activity_name or "").strip(),
        "preferred_days": [d for d in (payload.preferred_days or []) if d],
        "preferred_time": (payload.preferred_time or "").strip(),
        "notes": (payload.notes or "").strip(),
        "branch_id": branch_id,
        "status": "pending",
        "source": "public_link",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.registration_requests.insert_one(doc)
    return {"success": True, "message": "تم استلام طلب التسجيل بنجاح"}


# ============ ADMIN ROUTES (auth + branch scope) ============

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
