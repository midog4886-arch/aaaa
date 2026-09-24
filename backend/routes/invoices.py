"""Invoices routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict
import uuid
import asyncio
import logging
import copy
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from .common import db, get_current_user
from utils.auth import require_branch_scope, resolve_branch_filter
from utils.sequences import get_branch_seq_start
from utils.effective_periods import source_key

# Loyalty points function - will be set from server.py
loyalty_award_points = None

def set_loyalty_award_function(func):
    global loyalty_award_points
    loyalty_award_points = func

router = APIRouter(prefix="/invoices", tags=["invoices"])


async def _enrich_branch_names(invoices: list) -> None:
    branch_ids = list({inv.get("branch_id") for inv in invoices if inv.get("branch_id")})
    if not branch_ids:
        return
    branches = await db.branches.find(
        {"id": {"$in": branch_ids}},
        {"_id": 0, "id": 1, "name_ar": 1, "name": 1},
    ).to_list(len(branch_ids))
    bmap = {b["id"]: (b.get("name_ar") or b.get("name") or "") for b in branches}
    for inv in invoices:
        bid = inv.get("branch_id")
        if bid and bid in bmap:
            inv["branch_name"] = bmap[bid]

# Company registration info
COMPANY_TAX_NUMBER = "312655637900003"
COMPANY_COMMERCIAL_REG = "7043630230"
VAT_RATE = 0.15  # 15% VAT

# ============ MODELS ============

class InvoiceItem(BaseModel):
    item_id: Optional[str] = None
    activity_id: Optional[str] = ""
    activity_name: str
    fee: float
    period: str
    schedule: Optional[str] = ""
    level_id: Optional[str] = ""
    level_name: Optional[str] = ""
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    training_days: Optional[List[str]] = []
    training_time: Optional[str] = ""
    training_time_hour: Optional[str] = ""
    day_times: Optional[Dict[str, str]] = {}
    is_product: Optional[bool] = False
    product_id: Optional[str] = None
    quantity: Optional[int] = 1
    member_id: Optional[str] = None
    member_name: Optional[str] = None

class AdditionalMember(BaseModel):
    member_id: str
    member_name: Optional[str] = ""
    member_code: Optional[str] = ""
    items: List[InvoiceItem]

class InvoiceCreate(BaseModel):
    member_id: Optional[str] = None
    items: List[InvoiceItem]
    additional_members: Optional[List[AdditionalMember]] = None
    discount: float = 0
    discount_code: Optional[str] = None
    notes: Optional[str] = ""
    payment_method: str = "cash"
    payment_split: Optional[Dict[str, float]] = None
    customer_name_ar: Optional[str] = ""
    customer_phone: Optional[str] = ""
    customer_address: Optional[str] = ""
    branch_id: Optional[str] = None
    is_renewal: Optional[bool] = False
    # Explicit relationship for public registration requests.  This is the
    # authoritative conversion signal; opening/prefilling the invoice form is
    # not a state transition.
    registration_request_id: Optional[str] = None

class Invoice(BaseModel):
    id: str
    invoice_number: Optional[str] = None
    member_id: Optional[str] = None
    member_name: Optional[str] = ""
    member_code: Optional[str] = ""
    items: List[InvoiceItem]
    subtotal: float
    discount: float
    vat_amount: float = 0
    total: float
    status: str = "pending"
    payment_method: str
    payment_split: Optional[Dict[str, float]] = None
    notes: Optional[str] = ""
    is_renewal: Optional[bool] = False
    branch_id: Optional[str] = None
    branch_name: Optional[str] = ""
    created_at: str
    paid_at: Optional[str] = None
    customer_name_ar: Optional[str] = ""
    customer_phone: Optional[str] = ""
    customer_address: Optional[str] = ""
    customer_preferred_language: Optional[str] = "ar"
    guardian_name_ar: Optional[str] = ""
    guardian_name: Optional[str] = ""
    supervisor_name: Optional[str] = ""
    tax_number: str = COMPANY_TAX_NUMBER
    commercial_reg: str = COMPANY_COMMERCIAL_REG
    registration_form_id: Optional[str] = None
    registration_request_id: Optional[str] = None
    is_checked: Optional[bool] = False


REGISTRATION_INVOICE_INVALID_STATUSES = {
    "cancelled", "canceled", "failed", "error", "void",
}


async def _active_registration_invoice(request_doc: dict):
    """Return a non-cancelled invoice linked to a public request, if any."""
    request_id = request_doc.get("id")
    invoice_ids = [request_doc.get("invoice_id")] if request_doc.get("invoice_id") else []
    candidates = []
    for invoice_id in invoice_ids:
        invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if invoice:
            candidates.append(invoice)
    if request_id:
        request_invoices = await db.invoices.find(
            {"registration_request_id": request_id}, {"_id": 0}
        ).to_list(100)
        candidates.extend(request_invoices)
    request_branch = request_doc.get("branch_id")
    for invoice in candidates:
        if invoice.get("status") not in REGISTRATION_INVOICE_INVALID_STATUSES:
            if request_branch and invoice.get("branch_id") != request_branch:
                continue
            return invoice
    return None


async def _load_registration_request_for_invoice(
    request_id: Optional[str], current_user: dict
):
    """Validate a request link before creating an invoice.

    This keeps branch authorization and duplicate conversion checks on the
    server.  A cancelled prior invoice is intentionally retryable; an active
    pending/paid invoice is not.
    """
    if not request_id:
        return None
    request_doc = await db.registration_requests.find_one(
        {"id": request_id}, {"_id": 0}
    )
    if not request_doc:
        raise HTTPException(status_code=404, detail="Registration request not found")
    scope = require_branch_scope(current_user)
    if scope and request_doc.get("branch_id") != scope:
        raise HTTPException(status_code=403, detail="No access to this registration request")
    if request_doc.get("status") == "rejected":
        raise HTTPException(status_code=409, detail="Registration request is rejected")
    existing = await _active_registration_invoice(request_doc)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Registration request already has invoice {existing.get('id')}",
        )
    return request_doc


def _registration_request_cas_query(request_doc: dict) -> dict:
    """Build a compare-and-set filter from the request read before creation.

    The request is deliberately not marked "in progress": a transient
    failure must never strand it behind a lock.  The final update instead
    succeeds only while both the original status and original invoice link
    are unchanged.
    """
    query = {"id": request_doc["id"]}
    for field in ("branch_id", "status", "invoice_id"):
        if field in request_doc:
            query[field] = request_doc[field]
        else:
            query[field] = {"$exists": False}
    return query


async def _rollback_unpaid_registration_invoice(invoice_id: str):
    """Best-effort removal of an invoice whose request CAS lost.

    The invoice is still pending here.  If deletion itself is unavailable,
    cancelling it prevents its invoice-side request link from looking like a
    successful conversion during read-time normalization.
    """
    try:
        result = await db.invoices.delete_one({"id": invoice_id, "status": "pending"})
        if getattr(result, "deleted_count", 0):
            return
    except Exception:
        logger.exception("Could not delete losing registration invoice %s", invoice_id)
    try:
        await db.invoices.update_one(
            {"id": invoice_id, "status": "pending"},
            {"$set": {"status": "cancelled"}},
        )
    except Exception:
        logger.exception("Could not cancel losing registration invoice %s", invoice_id)

# ============ ROUTES ============

@router.get("", response_model=List[Invoice])
async def get_invoices(
    member_id: Optional[str] = None,
    status: Optional[str] = None,
    invoice_number: Optional[str] = None,
    phone: Optional[str] = None,
    activity_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all invoices with optional filters"""
    query = {}

    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch
    
    if member_id:
        query["member_id"] = member_id
    if status:
        query["status"] = status
    if invoice_number:
        query["id"] = {"$regex": invoice_number, "$options": "i"}
    if phone:
        query["customer_phone"] = {"$regex": phone}
    if activity_id:
        query["items.activity_id"] = activity_id
    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    member_ids = list(set([inv.get("member_id") for inv in invoices if inv.get("member_id")]))
    if member_ids:
        members = await db.members.find({"id": {"$in": member_ids}}, {"id": 1, "member_code": 1, "guardian_name_ar": 1, "guardian_name": 1, "_id": 0}).to_list(len(member_ids))
        members_map = {m["id"]: m for m in members}
        for inv in invoices:
            mid = inv.get("member_id")
            if mid and mid in members_map:
                if not inv.get("member_code"):
                    inv["member_code"] = members_map[mid].get("member_code", "")
                if not inv.get("guardian_name_ar"):
                    inv["guardian_name_ar"] = members_map[mid].get("guardian_name_ar", "")
                if not inv.get("guardian_name"):
                    inv["guardian_name"] = members_map[mid].get("guardian_name", "")
    
    await _enrich_branch_names(invoices)
    return invoices

@router.get("/search")
async def search_invoices(
    q: Optional[str] = None,
    status: Optional[str] = None,
    activity_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Search invoices with member name"""
    query = {}
    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch
    
    if q:
        query["$or"] = [
            {"id": {"$regex": q, "$options": "i"}},
            {"member_name": {"$regex": q, "$options": "i"}},
            {"customer_phone": {"$regex": q}},
            {"customer_name": {"$regex": q, "$options": "i"}},
            {"customer_name_ar": {"$regex": q}}
        ]
    if status:
        query["status"] = status
    if activity_id:
        query["items.activity_id"] = activity_id
    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    member_ids = list(set([inv.get("member_id") for inv in invoices if inv.get("member_id")]))
    if member_ids:
        members = await db.members.find({"id": {"$in": member_ids}}, {"id": 1, "member_code": 1, "guardian_name_ar": 1, "guardian_name": 1, "_id": 0}).to_list(len(member_ids))
        members_map = {m["id"]: m for m in members}
        for inv in invoices:
            mid = inv.get("member_id")
            if mid and mid in members_map:
                if not inv.get("member_code"):
                    inv["member_code"] = members_map[mid].get("member_code", "")
                if not inv.get("guardian_name_ar"):
                    inv["guardian_name_ar"] = members_map[mid].get("guardian_name_ar", "")
                if not inv.get("guardian_name"):
                    inv["guardian_name"] = members_map[mid].get("guardian_name", "")
    
    await _enrich_branch_names(invoices)
    return invoices

def _scoped_invoice_query(invoice_id: str, current_user: dict) -> dict:
    """Build an invoice-id query scoped to the caller's branch for non-admins.

    Fail-closed via ``resolve_branch_filter`` — a non-admin without a
    branch_id receives 403 instead of being able to look up invoices from
    other branches by ID (IDOR-style cross-branch exposure).
    """
    query = {"id": invoice_id}
    effective_branch = resolve_branch_filter(current_user, None)
    if effective_branch:
        query["branch_id"] = effective_branch
    return query


@router.get("/{invoice_id}", response_model=Invoice)
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single invoice by ID (branch-scoped for non-admins)"""
    invoice = await db.invoices.find_one(_scoped_invoice_query(invoice_id, current_user), {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice

@router.post("", response_model=Invoice)
async def create_invoice(invoice: InvoiceCreate, current_user: dict = Depends(get_current_user)):
    """Create a new invoice"""
    invoice_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)
    # Fail-closed: non-admins must have a branch (otherwise the invoice would
    # be created with branch_id=None and visible to all branch-less users).
    require_branch_scope(current_user)
    registration_request = await _load_registration_request_for_invoice(
        invoice.registration_request_id, current_user
    )

    # A subscription (activity) invoice must be linked to a member record —
    # otherwise the membership card can never be printed and attendance /
    # renewals lose track of the subscriber. Product-only invoices may still
    # be issued to walk-in customers without a member. Items carrying their
    # own per-item member_id (multi-member invoices) are already linked;
    # additional_members items always get one (AdditionalMember.member_id is
    # required), so only unlinked primary activity items are rejected here.
    has_activity_items = any(
        not item.is_product and not item.member_id for item in (invoice.items or [])
    )
    if has_activity_items and not invoice.member_id:
        raise HTTPException(
            status_code=422,
            detail="فاتورة الاشتراك يجب أن تكون مربوطة بعضو — اختر عضواً موجوداً أو أضِف عضواً جديداً أولاً",
        )

    # Reject inverted subscription windows (end before start) — they corrupt
    # the member card and attendance windows downstream.
    from utils.subscription_dates import validate_invoice_payload_windows
    validate_invoice_payload_windows(invoice)

    # Get supervisor name
    user_doc = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    supervisor_name = user_doc.get("name", current_user.get("username", "")) if user_doc else current_user.get("username", "")

    # Fetch member first so we can use their branch if needed
    member = None
    member_name = ""
    member_code = ""
    customer_name = invoice.customer_name_ar
    customer_phone = invoice.customer_phone

    # Branch-scope member lookups for non-admins so a staff user cannot
    # use a member_id from a different branch (cross-branch IDOR / data leak).
    effective_branch = resolve_branch_filter(current_user, None)

    def _scoped_member_filter(member_id: str) -> dict:
        q = {"id": member_id}
        if effective_branch:
            q["branch_id"] = effective_branch
        return q

    if invoice.member_id:
        member = await db.members.find_one(_scoped_member_filter(invoice.member_id), {"_id": 0})
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")
        member_name = member.get("name_ar", member.get("name", ""))
        member_code = member.get("member_code", "")
        if not customer_name:
            customer_name = member_name
        if not customer_phone:
            customer_phone = member.get("phone", "")

    # Determine branch: explicit admin choice > member's branch > current user's branch
    if is_admin and invoice.branch_id and invoice.branch_id != "all":
        branch_id = invoice.branch_id
    elif member and member.get("branch_id"):
        branch_id = member["branch_id"]
    else:
        branch_id = current_user.get("branch_id")

    if (
        registration_request
        and registration_request.get("branch_id")
        and branch_id != registration_request.get("branch_id")
    ):
        raise HTTPException(
            status_code=403,
            detail="Invoice branch does not match the registration request",
        )

    # Generate invoice number – unique per branch (each branch owns a block)
    seq_start = await get_branch_seq_start(branch_id, "invoice")
    branch_inv_filter = {"branch_id": branch_id} if branch_id else {}
    all_invoices = await db.invoices.find(
        {"invoice_number": {"$exists": True}, **branch_inv_filter},
        {"invoice_number": 1, "_id": 0}
    ).to_list(10000)

    max_number = seq_start - 1
    for inv in all_invoices:
        inv_num = inv.get("invoice_number", "")
        try:
            if inv_num.startswith("INV-"):
                num = int(inv_num.replace("INV-", ""))
            else:
                num = int(inv_num)
            if num > max_number:
                max_number = num
        except ValueError:
            continue

    next_number = max(max_number + 1, seq_start)
    
    # Merge all items: tag primary member items + additional members items
    all_items = []
    for item in invoice.items:
        item_dict = item.model_dump()
        item_dict["item_id"] = item_dict.get("item_id") or str(uuid.uuid4())
        # Never trust a client-supplied per-item member_id on primary items:
        # validate it resolves to a real, branch-authorized member, otherwise
        # a caller could bypass the member-link requirement above or route
        # activities to a member from another branch at pay time.
        item_mid = item_dict.get("member_id")
        if item_mid and item_mid != invoice.member_id:
            item_member = await db.members.find_one(
                _scoped_member_filter(item_mid), {"_id": 0, "name_ar": 1, "name": 1}
            )
            if not item_member:
                raise HTTPException(status_code=404, detail="Member not found for invoice item")
            if not item_dict.get("member_name"):
                item_dict["member_name"] = item_member.get("name_ar", item_member.get("name", ""))
        if invoice.member_id and not item_dict.get("member_id"):
            item_dict["member_id"] = invoice.member_id
            item_dict["member_name"] = member_name
        all_items.append(item_dict)

    additional_members_info = []
    if invoice.additional_members:
        for am in invoice.additional_members:
            am_member = await db.members.find_one(_scoped_member_filter(am.member_id), {"_id": 0})
            if not am_member:
                raise HTTPException(status_code=404, detail="Additional member not found")
            am_name = am.member_name or am_member.get("name_ar", am_member.get("name", ""))
            am_code = am.member_code or am_member.get("member_code", "")
            additional_members_info.append({"member_id": am.member_id, "member_name": am_name, "member_code": am_code})
            for item in am.items:
                item_dict = item.model_dump()
                item_dict["item_id"] = item_dict.get("item_id") or str(uuid.uuid4())
                item_dict["member_id"] = am.member_id
                item_dict["member_name"] = am_name
                all_items.append(item_dict)

    # Calculate totals from all items
    subtotal = sum(item.get("fee", 0) * (item.get("quantity") or 1) for item in all_items)
    discount = invoice.discount
    # Marketer (affiliate) referral: apply the marketer's discount on the
    # referred member's FIRST invoice (respects a manual discount if present).
    from routes.marketers import resolve_marketer_discount, record_first_invoice_commission
    discount = await resolve_marketer_discount(member, discount, subtotal)
    # Discount is applied AFTER tax: VAT is computed on the full subtotal and
    # the discount is subtracted from the grand total (e.g. 400 total incl.
    # VAT with a 50 coupon → invoice total 350). Matches the frontend preview.
    vat_amount = round(subtotal * VAT_RATE, 2)
    total = max(round(subtotal + vat_amount - discount, 2), 0)

    # Build member names for multi-member display
    all_member_names = []
    if customer_name:
        all_member_names.append(customer_name)
    for am_info in additional_members_info:
        if am_info["member_name"] and am_info["member_name"] not in all_member_names:
            all_member_names.append(am_info["member_name"])
    display_name = " & ".join(all_member_names) if all_member_names else customer_name

    # Split payment: member pays part cash / part card / part transfer. Keep only
    # the non-zero legs; when a valid split is present the invoice payment_method
    # is marked "split" and reports distribute each leg to its own method.
    payment_method = invoice.payment_method
    payment_split = None
    if invoice.payment_split:
        allowed_split_methods = {"cash", "card", "transfer"}
        cleaned = {}
        for k, v in invoice.payment_split.items():
            if k not in allowed_split_methods:
                raise HTTPException(
                    status_code=400,
                    detail=f"طريقة دفع غير صالحة في الدفع المقسّم: {k}"
                )
            if v in (None, ""):
                continue
            try:
                amount = round(float(v), 2)
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=400,
                    detail=f"قيمة غير صالحة في الدفع المقسّم: {k}"
                )
            if amount > 0:
                cleaned[k] = amount
        if cleaned:
            split_sum = round(sum(cleaned.values()), 2)
            if abs(split_sum - total) > 0.5:
                raise HTTPException(
                    status_code=400,
                    detail=f"مجموع الدفع المقسّم ({split_sum}) لا يساوي إجمالي الفاتورة ({total})"
                )
            payment_split = cleaned
            payment_method = "split"

    invoice_doc = {
        "id": invoice_id,
        "invoice_number": str(next_number),
        "member_id": invoice.member_id,
        "member_name": display_name,
        "member_code": member_code,
        "items": all_items,
        "subtotal": subtotal,
        "discount": discount,
        "discount_code": invoice.discount_code,
        "vat_amount": vat_amount,
        "total": total,
        "status": "pending",
        "payment_method": payment_method,
        "payment_split": payment_split,
        "notes": invoice.notes,
        "is_renewal": bool(invoice.is_renewal),
        "branch_id": branch_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "paid_at": None,
        "customer_name_ar": display_name,
        "customer_phone": customer_phone,
        "customer_address": invoice.customer_address,
        "customer_preferred_language": (member.get("preferred_language") if member else None) or "ar",
        "supervisor_name": supervisor_name,
        "tax_number": COMPANY_TAX_NUMBER,
        "commercial_reg": COMPANY_COMMERCIAL_REG,
        "additional_members": additional_members_info if additional_members_info else None,
        "registration_request_id": invoice.registration_request_id,
    }
    
    await db.invoices.insert_one(invoice_doc)

    # Only a successfully inserted invoice may convert the request.  Keep
    # archived requests archived (they remain an archive-history decision),
    # while pending/legacy processed-without-invoice requests become
    # processed.  If the link cannot be written, remove this still-unpaid
    # invoice rather than leaving an orphan that could falsely imply success.
    if registration_request:
        from services import registration_followups
        stopped_at = datetime.now(timezone.utc).isoformat()
        stop_reason = registration_request.get("followup_stop_reason")
        if stop_reason not in registration_followups.PRESERVE_ON_REQUEST_CLOSE:
            stop_reason = (
                "staff_contacted"
                if registration_request.get("followup_staff_contacted_at")
                else "request_closed"
            )
        link_update = {
            "$set": {
                "invoice_id": invoice_id,
                "invoice_status": "pending",
                "processed_at": datetime.now(timezone.utc).isoformat(),
                # Stop only this explicitly linked request, atomically with
                # conversion. Phone-level pacing/contact safety stays intact.
                "followup_status": "stopped",
                "followup_stop_reason": stop_reason,
                "followup_stopped_at": stopped_at,
            }
        }
        if registration_request.get("status") != "archived":
            link_update["$set"]["status"] = "processed"
        cas_query = _registration_request_cas_query(registration_request)
        try:
            link_result = await db.registration_requests.update_one(
                cas_query,
                link_update,
            )
        except Exception:
            # Do not leave an invoice-side relationship that would make
            # read-time normalization report a conversion when the request
            # side could not be linked.
            await _rollback_unpaid_registration_invoice(invoice_id)
            raise
        matched = getattr(link_result, "matched_count", None)
        if matched is None:
            matched = getattr(link_result, "modified_count", 0)
        if not matched:
            await _rollback_unpaid_registration_invoice(invoice_id)
            raise HTTPException(
                status_code=409,
                detail="Registration request changed before invoice conversion; please retry",
            )

    # Marketer referral: record a one-time commission on the member's first invoice
    try:
        await record_first_invoice_commission(member, invoice_doc, subtotal, discount)
    except Exception:
        pass

    # Add members to levels if specified in invoice items
    async def process_member_levels(mid, items_list):
        for item in items_list:
            level_id = item.get("level_id") if isinstance(item, dict) else item.level_id
            if level_id:
                await db.levels.update_one({"id": level_id}, {"$addToSet": {"members": mid}})
                end_date = item.get("end_date") if isinstance(item, dict) else item.end_date
                if end_date:
                    await db.level_subscriptions.update_one(
                        {"member_id": mid, "level_id": level_id},
                        {"$set": {"end_date": end_date, "member_id": mid, "level_id": level_id}},
                        upsert=True
                    )

    if invoice.member_id:
        await process_member_levels(invoice.member_id, invoice.items)
    if invoice.additional_members:
        for am in invoice.additional_members:
            await process_member_levels(am.member_id, am.items)
    
    return Invoice(**{k: v for k, v in invoice_doc.items() if k != "_id" and k != "additional_members"})

@router.put("/{invoice_id}/pay")
async def pay_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Mark an invoice as paid (branch-scoped for non-admins)"""
    scoped_invoice_query = _scoped_invoice_query(invoice_id, current_user)
    invoice = await db.invoices.find_one(scoped_invoice_query)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if invoice.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Invoice already paid")
    
    # Deduct stock for product items
    for item in invoice.get("items", []):
        if item.get("is_product") and item.get("product_id"):
            product = await db.products.find_one({"id": item["product_id"]})
            if product:
                qty = item.get("quantity", 1)
                new_qty = product["quantity"] - qty
                if new_qty < 0:
                    raise HTTPException(status_code=400, detail=f"Insufficient stock for {item['activity_name']}")
                await db.products.update_one(
                    {"id": item["product_id"]},
                    {"$set": {"quantity": new_qty, "updated_at": datetime.now(timezone.utc).isoformat()}}
                )
    
    # Update discount usage if coupon was used
    if invoice.get("discount_code"):
        await db.discounts.update_one(
            {"code": invoice["discount_code"]},
            {"$inc": {"used_count": 1}}
        )
    
    # Update invoice status (scoped filter — defence-in-depth in case of
    # future refactors that move the existence check away from the write).
    paid_at = datetime.now(timezone.utc).isoformat()
    # Conditional transition: only ONE concurrent /pay call can win, so the
    # side effects below (admin notification, activity merge) run once.
    pay_result = await db.invoices.update_one(
        {**scoped_invoice_query, "status": {"$ne": "paid"}},
        {"$set": {
            "status": "paid",
            "paid_at": paid_at
        }}
    )
    if getattr(pay_result, "modified_count", 1) == 0:
        raise HTTPException(status_code=400, detail="Invoice already paid")
    # Customer WhatsApp receipt runs outside the payment critical path. It is
    # fail-closed unless this invoice's branch has an enabled, approved template.
    try:
        from .whatsapp import queue_invoice_payment_whatsapp_notice
        await queue_invoice_payment_whatsapp_notice({
            **invoice, "status": "paid", "paid_at": paid_at
        })
    except Exception as exc:
        logger.warning("Could not schedule invoice payment WhatsApp: %s", type(exc).__name__)
    try:
        from utils.audit import log_audit
        await log_audit(
            actor=current_user,
            action="invoice.pay",
            entity_type="invoice",
            entity_id=invoice_id,
            entity_name=invoice.get("customer_name_ar") or invoice.get("invoice_number", ""),
            before={"status": invoice.get("status")},
            after={"status": "paid", "paid_at": paid_at, "total": invoice.get("total")},
        )
    except Exception:
        pass

    # Notify admins (bell + push) that a payment was received. Best-effort:
    # a notification hiccup must never break the payment itself.
    try:
        customer = invoice.get("customer_name_ar") or invoice.get("customer_name") or ""
        inv_no = invoice.get("invoice_number") or invoice.get("id", "")
        total = invoice.get("total", 0)
        title_ar = "تم استلام دفعة فاتورة"
        title_en = "Invoice payment received"
        branch_ar = branch_en = ""
        if invoice.get("branch_id"):
            branch = await db.branches.find_one(
                {"id": invoice["branch_id"]}, {"_id": 0, "name": 1, "name_ar": 1})
            if branch:
                bname_ar = branch.get("name_ar") or branch.get("name") or ""
                bname_en = branch.get("name") or branch.get("name_ar") or ""
                if bname_ar:
                    branch_ar = f" — فرع {bname_ar}"
                if bname_en:
                    branch_en = f" — {bname_en} branch"
        message_ar = f"تم دفع الفاتورة {inv_no} — {customer} بقيمة {total}{branch_ar}"
        message_en = f"Invoice {inv_no} paid — {customer}, total {total}{branch_en}"
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "title": title_ar,
            "title_ar": title_ar,
            "title_en": title_en,
            "message": message_ar,
            "message_ar": message_ar,
            "message_en": message_en,
            "type": "invoice_paid",
            "invoice_id": invoice.get("id"),
            "member_id": invoice.get("member_id"),
            "is_read": False,
            "branch_id": invoice.get("branch_id"),
            # Payment amounts are admin-only: the bell endpoints exclude
            # audience="admins" rows for non-admin users.
            "audience": "admins",
            "action_url": "/invoices",
            "created_at": paid_at,
        })
        # Fail closed on branchless invoices: pushing with branch_id=None
        # would blast payment details to EVERY admin across branches. The
        # bell notification above still surfaces it to global admins.
        if invoice.get("branch_id"):
            from .push_notifications import send_push_to_admins, NotificationPayload
            payload = NotificationPayload(
                title=title_ar,
                body=message_ar,
                title_en=title_en,
                body_en=message_en,
                url="/invoices",
                tag=f"invoice-paid-{invoice.get('id')}",
                data={"type": "invoice_paid", "invoice_id": invoice.get("id")},
            )

            async def _push_bg(payload=payload, branch_id=invoice.get("branch_id")):
                # Off the payment critical path: a hung/slow push service must
                # never stall the cashier's confirmation. Hard 15s ceiling.
                try:
                    await asyncio.wait_for(
                        send_push_to_admins(payload, branch_id=branch_id),
                        timeout=15,
                    )
                except Exception as exc:
                    logging.getLogger(__name__).error(
                        f"pay_invoice: background admin push failed: {exc}")

            asyncio.create_task(_push_bg())
    except Exception as exc:
        logging.getLogger(__name__).error(f"pay_invoice: admin notification failed: {exc}")

    # Group items by member_id for multi-member invoice support
    items_by_member = {}
    primary_member_id = invoice.get("member_id")
    for item in invoice.get("items", []):
        mid = item.get("member_id") or primary_member_id
        if mid:
            if mid not in items_by_member:
                items_by_member[mid] = []
            items_by_member[mid].append(item)

    # If no member_id in items, fall back to primary member
    if not items_by_member and primary_member_id:
        items_by_member[primary_member_id] = invoice.get("items", [])

    # Process each member's activities and levels
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    for mid, member_items in items_by_member.items():
        member = await db.members.find_one({"id": mid})
        if not member:
            continue
        original_activities = copy.deepcopy(member.get("activities", []))
        existing_activities = copy.deepcopy(original_activities)
        existing_activity_ids = {
            act.get("activity_id") for act in existing_activities
            if act.get("activity_id")
        }

        def _item_period(it):
            s = it.get("start_date", today)
            e = it.get("end_date", "")
            if it.get("period") and " - " in it.get("period", ""):
                parts = it["period"].split(" - ")
                if len(parts) == 2:
                    s = parts[0].strip()
                    e = parts[1].strip()
            return s, e

        def _is_deferred_prepaid(it):
            """A future period must remain invoice-only until it arrives.

            In particular, paying ahead must not discard the current activity
            subdocument's compensated deadline, schedule/source/level, or its
            current level placement. Initial purchases have no matching
            activity and therefore continue to activate immediately.
            """
            start_date, _ = _item_period(it)
            return (
                bool(it.get("activity_id"))
                and it.get("activity_id") in existing_activity_ids
                and bool(start_date)
                and start_date > today
            )

        # When one invoice carries multiple periods for the SAME activity
        # (e.g. two prepaid months), only ONE can live in member.activities.
        # Pick the period covering today; otherwise the earliest upcoming;
        # otherwise the latest. The other (prepaid) periods stay on the
        # invoice and activate when their start date arrives.
        def _pick_best(items_for_activity):
            covering = [it for it in items_for_activity
                        if (lambda p: p[0] <= today and (not p[1] or p[1] >= today))(_item_period(it))]
            if covering:
                return covering[0]
            upcoming = [it for it in items_for_activity if _item_period(it)[0] > today]
            if upcoming:
                return min(upcoming, key=lambda it: _item_period(it)[0])
            return max(items_for_activity, key=lambda it: _item_period(it)[1] or _item_period(it)[0])

        by_activity = {}
        for it in member_items:
            if it.get("is_product"):
                continue
            by_activity.setdefault(it.get("activity_id"), []).append(it)

        deduped_items = [
            _pick_best(group) if len(group) > 1 else group[0]
            for group in by_activity.values()
        ]

        for item in deduped_items:
            start_date, end_date = _item_period(item)
            item_index = next(
                index for index, candidate in enumerate(invoice.get("items") or [])
                if candidate is item
            )
            period_key = source_key(invoice, item, item_index)

            # The paid invoice is the durable record for a prepaid period.
            # utils.prepaid rolls it into member.activities once its start date
            # arrives; doing so at payment time would erase the current period.
            if _is_deferred_prepaid(item):
                continue
            
            status = "active"
            if end_date:
                try:
                    end_date_obj = datetime.strptime(end_date, '%Y-%m-%d')
                    today_obj = datetime.strptime(today, '%Y-%m-%d')
                    if end_date_obj < today_obj:
                        status = "expired"
                except Exception:
                    pass
            
            activity_exists = False
            for idx, existing_act in enumerate(existing_activities):
                if existing_act.get("activity_id") == item.get("activity_id"):
                    # Re-paying/replaying this exact purchased period must not
                    # undo an explicitly reviewed operational schedule/deadline.
                    if existing_act.get("source_id") == invoice_id and (
                        existing_act.get("source_period_key") == period_key
                        or (not existing_act.get("source_period_key")
                            and existing_act.get("start_date") == start_date)
                    ):
                        activity_exists = True
                        break
                    existing_activities[idx] = {
                        "activity_id": item.get("activity_id"),
                        "activity_name": item.get("activity_name", ""),
                        "start_date": start_date,
                        "end_date": end_date,
                        "fee": item.get("fee", 0),
                        "status": status,
                        "coach_id": existing_act.get("coach_id", ""),
                        "level_id": item.get("level_id", ""),
                        "schedule": item.get("schedule", ""),
                        "training_days": item.get("training_days", []),
                        "training_time": item.get("training_time", ""),
                        "day_times": item.get("day_times", {}),
                        "source": "invoice",
                        "source_id": invoice_id,
                        "source_period_key": period_key,
                    }
                    activity_exists = True
                    break
            
            if not activity_exists:
                existing_activities.append({
                    "activity_id": item.get("activity_id"),
                    "activity_name": item.get("activity_name", ""),
                    "start_date": start_date,
                    "end_date": end_date,
                    "fee": item.get("fee", 0),
                    "status": status,
                    "coach_id": "",
                    "level_id": item.get("level_id", ""),
                    "schedule": item.get("schedule", ""),
                    "training_days": item.get("training_days", []),
                    "training_time": item.get("training_time", ""),
                    "day_times": item.get("day_times", {}),
                    "source": "invoice",
                    "source_id": invoice_id,
                    "source_period_key": period_key,
                })
        
        activity_write = await db.members.update_one(
            {"id": mid, "activities": original_activities if "activities" in member else {"$exists": False}},
            {"$set": {"activities": existing_activities}}
        )
        if activity_write.matched_count != 1:
            # Payment was recorded earlier in this route. Do not claim complete
            # success, silently erase a concurrent reviewed edit, or invite a
            # second payment to repair this projection.
            raise HTTPException(status_code=409, detail={
                "code": "payment_recorded_subscription_conflict",
                "payment_recorded": True,
                "invoice_id": invoice_id,
                "member_id": mid,
                "message": "تم تسجيل الدفع، لكن الاشتراك تغير أثناء الحفظ ولم تتم مزامنته. لا تكرر الدفع؛ حدّث الفاتورة وراجع الاشتراك.",
            })
        
        for item in member_items:
            # Do not move a currently placed member to a future period's level
            # before that prepaid period has started.
            if _is_deferred_prepaid(item):
                continue
            preserved = next((a for a in existing_activities
                              if a.get("activity_id") == item.get("activity_id")
                              and a.get("source_id") == invoice_id
                              and a.get("schedule_reconciliation")), None)
            if preserved:
                # Its matching level period was committed with the schedule edit.
                continue
            level_id = item.get("level_id")
            if level_id:
                await db.levels.update_one(
                    {"id": level_id},
                    {"$addToSet": {"members": mid}}
                )
                end_date = item.get("end_date", "")
                if end_date:
                    await db.level_subscriptions.update_one(
                        {"member_id": mid, "level_id": level_id},
                        {"$set": {
                            "member_id": mid,
                            "level_id": level_id,
                            "start_date": item.get("start_date", ""),
                            "end_date": end_date,
                            "invoice_id": invoice_id
                        }},
                        upsert=True
                    )
    
    # Award loyalty points for each member's activity items
    loyalty_results = []  # track what was awarded for response message
    if loyalty_award_points:
        for mid, member_items in items_by_member.items():
            try:
                activity_items = [i for i in member_items if not i.get("is_product")]
                if not activity_items:
                    continue

                # Determine renewal type from the first activity item's dates.
                # Fall back to monthly if dates are missing or cannot be parsed.
                first_item = activity_items[0]
                start = first_item.get("start_date", "")
                end = first_item.get("end_date", "")

                # Also try extracting from the period field (e.g. "2024-01-01 - 2024-04-01")
                if (not start or not end) and first_item.get("period") and " - " in first_item.get("period", ""):
                    period_parts = first_item["period"].split(" - ")
                    if len(period_parts) == 2:
                        start = start or period_parts[0].strip()
                        end = end or period_parts[1].strip()

                renewal_type = "monthly_renewal"
                description_ar = "مكافأة اشتراك شهري"
                description_en = "Monthly subscription bonus"

                if start and end:
                    try:
                        start_dt = datetime.strptime(start, '%Y-%m-%d')
                        end_dt = datetime.strptime(end, '%Y-%m-%d')
                        days = (end_dt - start_dt).days

                        if days >= 330:  # ~yearly
                            renewal_type = "yearly_renewal"
                            description_ar = "مكافأة اشتراك سنوي"
                            description_en = "Yearly subscription bonus"
                        elif days >= 80:  # ~quarterly
                            renewal_type = "quarterly_renewal"
                            description_ar = "مكافأة اشتراك ربع سنوي"
                            description_en = "Quarterly subscription bonus"
                    except Exception:
                        pass  # keep monthly default

                points_awarded = await loyalty_award_points(mid, renewal_type, description_ar, description_en)
                loyalty_results.append({
                    "member_id": mid,
                    "renewal_type": renewal_type,
                    "points": points_awarded or 0
                })
            except Exception as e:
                logger.error(
                    "Failed to award loyalty points: invoice_id=%s member_id=%s error=%s",
                    invoice_id, mid, e
                )

    from utils.cache import invalidate_dashboard_caches
    invalidate_dashboard_caches()

    return {
        "message": "Invoice paid",
        "status": "paid",
        "loyalty_awarded": loyalty_results
    }

@router.put("/{invoice_id}/cancel")
async def cancel_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel an invoice (branch-scoped for non-admins)"""
    before = await db.invoices.find_one(_scoped_invoice_query(invoice_id, current_user), {"_id": 0})
    result = await db.invoices.update_one(
        _scoped_invoice_query(invoice_id, current_user),
        {"$set": {"status": "cancelled"}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    from utils.audit import log_audit
    await log_audit(
        actor=current_user,
        action="invoice.cancel",
        entity_type="invoice",
        entity_id=invoice_id,
        entity_name=(before or {}).get("invoice_number") or invoice_id[:8],
        before=before,
        after={"status": "cancelled"},
    )
    return {"message": "Invoice cancelled"}

@router.put("/{invoice_id}/restore")
async def restore_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Restore a cancelled invoice (branch-scoped for non-admins)"""
    scoped = _scoped_invoice_query(invoice_id, current_user)
    scoped["status"] = "cancelled"
    result = await db.invoices.update_one(
        scoped,
        {"$set": {"status": "pending"}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found or not cancelled")
    return {"message": "Invoice restored"}

@router.delete("/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an invoice (branch-scoped for non-admins)"""
    scoped = _scoped_invoice_query(invoice_id, current_user)
    invoice = await db.invoices.find_one(scoped)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if invoice.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Cannot delete paid invoice")

    await db.invoices.delete_one(scoped)
    from utils.audit import log_audit
    await log_audit(
        actor=current_user,
        action="invoice.delete",
        entity_type="invoice",
        entity_id=invoice_id,
        entity_name=invoice.get("invoice_number") or invoice_id[:8],
        before=invoice,
    )
    return {"message": "Invoice deleted"}
