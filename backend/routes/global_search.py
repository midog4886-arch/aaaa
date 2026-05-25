from fastapi import APIRouter, Depends, Query
from typing import Optional
import re

from .common import db, get_current_user
from utils.auth import resolve_branch_filter

router = APIRouter(prefix="/global-search", tags=["global-search"])


def _safe_regex(q: str) -> dict:
    return {"$regex": re.escape(q), "$options": "i"}


@router.get("")
async def global_search(
    q: str = Query(..., min_length=1),
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    q = q.strip()
    if len(q) < 2:
        return {"members": [], "invoices": [], "activities": []}

    branch_id = resolve_branch_filter(current_user, branch_filter)
    branch_q = {"branch_id": branch_id} if branch_id else {}
    rx = _safe_regex(q)

    member_query = {
        **branch_q,
        "$or": [
            {"name_ar": rx},
            {"name": rx},
            {"phone": rx},
            {"member_code": rx},
            {"guardian_name_ar": rx},
            {"guardian_name": rx},
            {"guardian_phone": rx},
        ],
    }
    members_raw = await db.members.find(
        member_query,
        {
            "_id": 0, "id": 1, "name_ar": 1, "name": 1, "phone": 1,
            "activities": 1,
            "guardian_name_ar": 1, "guardian_name": 1, "guardian_phone": 1,
        },
    ).limit(10).to_list(10)
    members = [
        {
            "id": m.get("id"),
            "name": m.get("name_ar") or m.get("name") or "",
            "phone": m.get("phone") or "",
            "guardian_name": m.get("guardian_name_ar") or m.get("guardian_name") or "",
            "guardian_phone": m.get("guardian_phone") or "",
            "activities_count": len(m.get("activities") or []),
        }
        for m in members_raw
    ]

    invoice_query = {
        **branch_q,
        "$or": [
            {"invoice_number": rx},
            {"member_name": rx},
            {"id": rx},
        ],
    }
    invoices_raw = await db.invoices.find(
        invoice_query,
        {"_id": 0, "id": 1, "invoice_number": 1, "member_name": 1, "total": 1, "status": 1},
    ).limit(10).to_list(10)
    invoices = [
        {
            "id": i.get("id"),
            "invoice_number": i.get("invoice_number") or i.get("id", "")[:8],
            "member_name": i.get("member_name") or "",
            "total": i.get("total") or 0,
            "status": i.get("status") or "pending",
        }
        for i in invoices_raw
    ]

    activity_query = {
        **branch_q,
        "$or": [{"name": rx}, {"name_ar": rx}],
    }
    activities_raw = await db.activities.find(
        activity_query,
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "monthly_fee": 1, "price": 1},
    ).limit(10).to_list(10)
    activities = [
        {
            "id": a.get("id"),
            "name": a.get("name_ar") or a.get("name") or "",
            "monthly_fee": a.get("monthly_fee") or a.get("price") or 0,
        }
        for a in activities_raw
    ]

    return {"members": members, "invoices": invoices, "activities": activities}
