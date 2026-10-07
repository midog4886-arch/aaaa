"""One read-only view of a registration from request through card printing."""
from fastapi import APIRouter, Depends, HTTPException

from database import db
from routes.registration_requests import (
    INVALID_REGISTRATION_INVOICE_STATUSES,
    _registration_invoice_links,
)
from utils.auth import get_current_user, resolve_branch_filter


router = APIRouter(prefix="/registration-journey", tags=["Registration journey"])


def summarize_journey(request: dict, invoice: dict | None, members: list[dict]) -> dict:
    member_by_id = {member["id"]: member for member in members if member.get("id")}
    items = [item for item in (invoice or {}).get("items") or [] if not item.get("is_product")]
    item_member_ids = [item.get("member_id") or (invoice or {}).get("member_id") for item in items]
    required_member_ids = list(dict.fromkeys(mid for mid in item_member_ids if mid))
    invoice_exists = bool(invoice and invoice.get("status") not in INVALID_REGISTRATION_INVOICE_STATUSES)
    paid = invoice_exists and invoice.get("status") == "paid"
    linked_members = invoice_exists and bool(items) and all(mid and mid in member_by_id for mid in item_member_ids)
    level_selected = invoice_exists and bool(items) and all((item.get("level_id") or "").strip() for item in items)
    cards_printed = bool(required_member_ids) and linked_members and all(
        member_by_id[mid].get("card_printed_at") for mid in required_member_ids
    )
    contact_done = bool(request.get("followup_staff_contacted_at") or request.get("followup_stop_reason") in {"contacted", "staff_contacted"})
    return {
        "request": {
            "id": request.get("id"),
            "customer_name": request.get("customer_name") or "",
            "branch_id": request.get("branch_id"),
            "activity_name": request.get("activity_name") or "",
            "created_at": request.get("created_at") or "",
            "status": request.get("status") or "pending",
        },
        "invoice": {
            "id": invoice.get("id"),
            "invoice_number": invoice.get("invoice_number") or "",
            "status": invoice.get("status") or "pending",
            "created_at": invoice.get("created_at") or "",
        } if invoice_exists else None,
        "members": [{
            "id": mid,
            "name": member_by_id[mid].get("name_ar") or member_by_id[mid].get("name") or "",
            "member_code": member_by_id[mid].get("member_code") or "",
            "card_printed_at": member_by_id[mid].get("card_printed_at"),
        } for mid in required_member_ids if mid in member_by_id],
        "steps": {
            "request_received": True,
            "contacted": contact_done,
            "member_linked": linked_members,
            "invoice_created": invoice_exists,
            "level_selected": level_selected,
            "paid": paid,
            "card_printed": cards_printed,
        },
    }


@router.get("/{request_id}")
async def get_registration_journey(request_id: str, current_user: dict = Depends(get_current_user)):
    if not current_user.get("is_admin"):
        user = await db.users.find_one({"id": current_user.get("user_id")}, {"_id": 0, "permissions": 1})
        if "invoices" not in (user or {}).get("permissions", []):
            raise HTTPException(status_code=403, detail="Invoice access required")
    branch_id = resolve_branch_filter(current_user, None)
    query = {"id": request_id}
    if branch_id:
        query["branch_id"] = branch_id
    request = await db.registration_requests.find_one(query, {"_id": 0})
    if not request:
        raise HTTPException(status_code=404, detail="Registration request not found")
    links = await _registration_invoice_links([request])
    link = links.get(request_id)
    invoice = await db.invoices.find_one(
        {"id": link["id"], "branch_id": request.get("branch_id")}, {"_id": 0}
    ) if link else None
    member_ids = {
        mid for item in (invoice or {}).get("items") or []
        if not item.get("is_product")
        for mid in [item.get("member_id") or invoice.get("member_id")] if mid
    }
    member_query = {"id": {"$in": list(member_ids)}}
    if branch_id:
        member_query["branch_id"] = branch_id
    members = await db.members.find(
        member_query,
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "member_code": 1, "card_printed_at": 1},
    ).to_list(None) if member_ids else []
    return summarize_journey(request, invoice, members)
