"""Read-only, administrator-only checks for records needing manual review."""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from database import db
from routes.levels import get_unassigned_members
from utils.auth import get_current_user, resolve_branch_filter


router = APIRouter(prefix="/data-integrity", tags=["Data integrity"])


def classify_invoice(invoice: dict, known_member_ids: set[str]) -> Optional[str]:
    """Only subscription items require a member; product-only sales do not."""
    items = [item for item in invoice.get("items") or [] if not item.get("is_product")]
    if not items:
        return None
    parent_id = invoice.get("member_id")
    item_ids = [item.get("member_id") or parent_id for item in items]
    if not any(item_ids):
        return "invoice_without_member"
    if any(not member_id for member_id in item_ids):
        return "invoice_item_without_member"
    if any(member_id not in known_member_ids for member_id in item_ids):
        return "invoice_member_not_found"
    return None


def missing_level_references(members: list[dict], known_level_ids: set[str], today: str) -> list[dict]:
    issues = []
    for member in members:
        for activity in member.get("activities") or []:
            if activity.get("status") != "active":
                continue
            if activity.get("start_date") and str(activity["start_date"])[:10] > today:
                continue
            if activity.get("end_date") and str(activity["end_date"])[:10] < today:
                continue
            level_id = activity.get("level_id")
            if level_id and level_id not in known_level_ids:
                issues.append({
                    "kind": "level_reference_not_found",
                    "member_id": member.get("id"),
                    "member_name": member.get("name_ar") or member.get("name") or "",
                    "member_code": member.get("member_code") or "",
                    "branch_id": member.get("branch_id"),
                    "activity_name": activity.get("activity_name") or "",
                    "level_id": level_id,
                })
    return issues


@router.get("")
async def get_data_integrity(branch_filter: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Administrator access required")

    branch_id = resolve_branch_filter(current_user, branch_filter)
    branch_query = {"branch_id": branch_id} if branch_id else {}
    invoice_query = {**branch_query, "status": {"$nin": ["cancelled", "canceled", "void", "failed", "error"]}}
    unassigned = await get_unassigned_members(branch_filter=branch_filter, current_user=current_user)
    invoices = await db.invoices.find(
        invoice_query,
        {"_id": 0, "id": 1, "invoice_number": 1, "branch_id": 1, "member_id": 1,
         "member_name": 1, "customer_name_ar": 1, "created_at": 1, "items": 1},
    ).to_list(None)
    members = await db.members.find(
        branch_query,
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "member_code": 1,
         "branch_id": 1, "activities": 1},
    ).to_list(None)
    # An invoice can validly refer to a member transferred to another branch.
    # Check all referenced IDs tenant-wide before reporting a broken link.
    referenced_ids = {
        member_id for invoice in invoices for member_id in
        [invoice.get("member_id"), *((item.get("member_id") for item in invoice.get("items") or []))]
        if member_id
    }
    existing_refs = await db.members.find(
        {"id": {"$in": list(referenced_ids)}}, {"_id": 0, "id": 1}
    ).to_list(None) if referenced_ids else []
    known_member_ids = {member["id"] for member in existing_refs}
    invoice_issues = []
    for invoice in invoices:
        kind = classify_invoice(invoice, known_member_ids)
        if kind:
            invoice_issues.append({
                "kind": kind,
                "invoice_id": invoice.get("id"),
                "invoice_number": invoice.get("invoice_number") or "",
                "name": invoice.get("member_name") or invoice.get("customer_name_ar") or "",
                "branch_id": invoice.get("branch_id"),
                "created_at": str(invoice.get("created_at") or "")[:10],
            })

    assigned_ids = {
        activity.get("level_id") for member in members
        for activity in member.get("activities") or [] if activity.get("level_id")
    }
    levels = await db.levels.find(
        {"id": {"$in": list(assigned_ids)}}, {"_id": 0, "id": 1}
    ).to_list(None) if assigned_ids else []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "branch_id": branch_id,
        "unassigned_members": unassigned["members"],
        "invoice_issues": invoice_issues,
        "level_reference_issues": missing_level_references(members, {level["id"] for level in levels}, today),
    }
