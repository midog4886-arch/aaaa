"""Invoices routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone

from .common import db, get_current_user
from utils.sequences import get_branch_seq_start

# Loyalty points function - will be set from server.py
loyalty_award_points = None

def set_loyalty_award_function(func):
    global loyalty_award_points
    loyalty_award_points = func

router = APIRouter(prefix="/invoices", tags=["invoices"])

# Company registration info
COMPANY_TAX_NUMBER = "312655637900003"
COMPANY_COMMERCIAL_REG = "7043630230"
VAT_RATE = 0.15  # 15% VAT

# ============ MODELS ============

class InvoiceItem(BaseModel):
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
    customer_name_ar: Optional[str] = ""
    customer_phone: Optional[str] = ""
    customer_address: Optional[str] = ""
    branch_id: Optional[str] = None

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
    notes: Optional[str] = ""
    branch_id: Optional[str] = None
    created_at: str
    paid_at: Optional[str] = None
    customer_name_ar: Optional[str] = ""
    customer_phone: Optional[str] = ""
    customer_address: Optional[str] = ""
    supervisor_name: Optional[str] = ""
    tax_number: str = COMPANY_TAX_NUMBER
    commercial_reg: str = COMPANY_COMMERCIAL_REG
    registration_form_id: Optional[str] = None
    is_checked: Optional[bool] = False

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
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    
    # Branch filtering
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
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
    
    # Enrich invoices with member_code for legacy invoices that don't have it
    member_ids = list(set([inv.get("member_id") for inv in invoices if inv.get("member_id") and not inv.get("member_code")]))
    if member_ids:
        members = await db.members.find({"id": {"$in": member_ids}}, {"id": 1, "member_code": 1, "_id": 0}).to_list(len(member_ids))
        member_codes = {m["id"]: m.get("member_code", "") for m in members}
        for inv in invoices:
            if inv.get("member_id") and not inv.get("member_code"):
                inv["member_code"] = member_codes.get(inv["member_id"], "")
    
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
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    
    query = {}
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id
    
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
    
    # Enrich invoices with member_code
    member_ids = list(set([inv.get("member_id") for inv in invoices if inv.get("member_id") and not inv.get("member_code")]))
    if member_ids:
        members = await db.members.find({"id": {"$in": member_ids}}, {"id": 1, "member_code": 1, "_id": 0}).to_list(len(member_ids))
        member_codes = {m["id"]: m.get("member_code", "") for m in members}
        for inv in invoices:
            if inv.get("member_id") and not inv.get("member_code"):
                inv["member_code"] = member_codes.get(inv["member_id"], "")
    
    return invoices

@router.get("/{invoice_id}", response_model=Invoice)
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single invoice by ID"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice

@router.post("", response_model=Invoice)
async def create_invoice(invoice: InvoiceCreate, current_user: dict = Depends(get_current_user)):
    """Create a new invoice"""
    invoice_id = str(uuid.uuid4())
    is_admin = current_user.get("is_admin", False)

    # Get supervisor name
    user_doc = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
    supervisor_name = user_doc.get("name", current_user.get("username", "")) if user_doc else current_user.get("username", "")

    # Fetch member first so we can use their branch if needed
    member = None
    member_name = ""
    member_code = ""
    customer_name = invoice.customer_name_ar
    customer_phone = invoice.customer_phone

    if invoice.member_id:
        member = await db.members.find_one({"id": invoice.member_id}, {"_id": 0})
        if member:
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
        if invoice.member_id and not item_dict.get("member_id"):
            item_dict["member_id"] = invoice.member_id
            item_dict["member_name"] = member_name
        all_items.append(item_dict)

    additional_members_info = []
    if invoice.additional_members:
        for am in invoice.additional_members:
            am_member = await db.members.find_one({"id": am.member_id}, {"_id": 0})
            am_name = am.member_name or (am_member.get("name_ar", am_member.get("name", "")) if am_member else "")
            am_code = am.member_code or (am_member.get("member_code", "") if am_member else "")
            additional_members_info.append({"member_id": am.member_id, "member_name": am_name, "member_code": am_code})
            for item in am.items:
                item_dict = item.model_dump()
                item_dict["member_id"] = am.member_id
                item_dict["member_name"] = am_name
                all_items.append(item_dict)

    # Calculate totals from all items
    subtotal = sum(item.get("fee", 0) * (item.get("quantity") or 1) for item in all_items)
    discount = invoice.discount
    taxable_amount = subtotal - discount
    vat_amount = round(taxable_amount * VAT_RATE, 2)
    total = round(taxable_amount + vat_amount, 2)

    # Build member names for multi-member display
    all_member_names = []
    if customer_name:
        all_member_names.append(customer_name)
    for am_info in additional_members_info:
        if am_info["member_name"] and am_info["member_name"] not in all_member_names:
            all_member_names.append(am_info["member_name"])
    display_name = " & ".join(all_member_names) if all_member_names else customer_name

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
        "payment_method": invoice.payment_method,
        "notes": invoice.notes,
        "branch_id": branch_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "paid_at": None,
        "customer_name_ar": display_name,
        "customer_phone": customer_phone,
        "customer_address": invoice.customer_address,
        "supervisor_name": supervisor_name,
        "tax_number": COMPANY_TAX_NUMBER,
        "commercial_reg": COMPANY_COMMERCIAL_REG,
        "additional_members": additional_members_info if additional_members_info else None
    }
    
    await db.invoices.insert_one(invoice_doc)
    
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
    """Mark an invoice as paid"""
    invoice = await db.invoices.find_one({"id": invoice_id})
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
    
    # Update invoice status
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {
            "status": "paid",
            "paid_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
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
        existing_activities = member.get("activities", [])
        
        for item in member_items:
            if item.get("is_product"):
                continue
            
            start_date = item.get("start_date", today)
            end_date = item.get("end_date", "")
            
            if item.get("period") and " - " in item.get("period", ""):
                period_parts = item["period"].split(" - ")
                if len(period_parts) == 2:
                    start_date = period_parts[0].strip()
                    end_date = period_parts[1].strip()
            
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
                        "source": "invoice",
                        "source_id": invoice_id
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
                    "source": "invoice",
                    "source_id": invoice_id
                })
        
        await db.members.update_one(
            {"id": mid},
            {"$set": {"activities": existing_activities}}
        )
        
        for item in member_items:
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
    
    # Award loyalty points for subscription renewal
    member_id = primary_member_id
    if member_id and loyalty_award_points:
        try:
            # Determine renewal type based on duration
            activity_items = [i for i in invoice.get("items", []) if not i.get("is_product")]
            if activity_items:
                # Check if this is a renewal (member had previous activity)
                member = await db.members.find_one({"id": member_id})
                if member and member.get("activities"):
                    # Calculate duration from first item
                    first_item = activity_items[0]
                    start = first_item.get("start_date", "")
                    end = first_item.get("end_date", "")
                    
                    renewal_type = "monthly_renewal"
                    description_ar = "مكافأة تجديد اشتراك شهري"
                    description_en = "Monthly subscription renewal bonus"
                    
                    if start and end:
                        try:
                            start_date = datetime.strptime(start, '%Y-%m-%d')
                            end_date = datetime.strptime(end, '%Y-%m-%d')
                            days = (end_date - start_date).days
                            
                            if days >= 330:  # ~yearly
                                renewal_type = "yearly_renewal"
                                description_ar = "مكافأة تجديد اشتراك سنوي"
                                description_en = "Yearly subscription renewal bonus"
                            elif days >= 80:  # ~quarterly
                                renewal_type = "quarterly_renewal"
                                description_ar = "مكافأة تجديد اشتراك ربع سنوي"
                                description_en = "Quarterly subscription renewal bonus"
                        except Exception:
                            pass
                    
                    await loyalty_award_points(
                        member_id,
                        renewal_type,
                        description_ar,
                        description_en
                    )
        except Exception as e:
            print(f"Error awarding loyalty points for renewal: {e}")
    
    return {"message": "Invoice paid", "status": "paid"}

@router.put("/{invoice_id}/cancel")
async def cancel_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel an invoice"""
    result = await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"status": "cancelled"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"message": "Invoice cancelled"}

@router.put("/{invoice_id}/restore")
async def restore_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Restore a cancelled invoice"""
    result = await db.invoices.update_one(
        {"id": invoice_id, "status": "cancelled"},
        {"$set": {"status": "pending"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found or not cancelled")
    return {"message": "Invoice restored"}

@router.delete("/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an invoice"""
    invoice = await db.invoices.find_one({"id": invoice_id})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if invoice.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Cannot delete paid invoice")
    
    await db.invoices.delete_one({"id": invoice_id})
    return {"message": "Invoice deleted"}
