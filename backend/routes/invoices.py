"""Invoices routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone

from .common import db, get_current_user

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
    is_product: Optional[bool] = False
    product_id: Optional[str] = None
    quantity: Optional[int] = 1

class InvoiceCreate(BaseModel):
    member_id: Optional[str] = None
    items: List[InvoiceItem]
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

# ============ ROUTES ============

@router.get("", response_model=List[Invoice])
async def get_invoices(
    member_id: Optional[str] = None,
    status: Optional[str] = None,
    invoice_number: Optional[str] = None,
    phone: Optional[str] = None,
    activity: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
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
        query["invoice_number"] = {"$regex": invoice_number, "$options": "i"}
    if phone:
        query["customer_phone"] = {"$regex": phone, "$options": "i"}
    if activity:
        query["items.activity_name"] = {"$regex": activity, "$options": "i"}
    if date_from:
        query["created_at"] = {"$gte": date_from}
    if date_to:
        if "created_at" in query:
            query["created_at"]["$lte"] = date_to + "T23:59:59"
        else:
            query["created_at"] = {"$lte": date_to + "T23:59:59"}
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
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
    branch_id = invoice.branch_id if (is_admin and invoice.branch_id) else current_user.get("branch_id")
    user_name = current_user.get("name", current_user.get("username", ""))
    
    # Generate invoice number
    last_invoice = await db.invoices.find_one(
        {"invoice_number": {"$exists": True, "$ne": None}},
        sort=[("invoice_number", -1)]
    )
    if last_invoice and last_invoice.get("invoice_number"):
        try:
            last_num = int(last_invoice["invoice_number"])
            new_invoice_number = str(last_num + 1)
        except ValueError:
            new_invoice_number = "26001"
    else:
        new_invoice_number = "26001"
    
    # Get member info if member_id provided
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
    
    # Calculate totals
    subtotal = sum(item.fee * item.quantity for item in invoice.items)
    discount = invoice.discount
    taxable_amount = subtotal - discount
    vat_amount = round(taxable_amount * VAT_RATE, 2)
    total = round(taxable_amount + vat_amount, 2)
    
    invoice_doc = {
        "id": invoice_id,
        "invoice_number": new_invoice_number,
        "member_id": invoice.member_id,
        "member_name": member_name,
        "member_code": member_code,
        "items": [item.model_dump() for item in invoice.items],
        "subtotal": subtotal,
        "discount": discount,
        "vat_amount": vat_amount,
        "total": total,
        "status": "pending",
        "payment_method": invoice.payment_method,
        "notes": invoice.notes,
        "branch_id": branch_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "customer_name_ar": customer_name,
        "customer_phone": customer_phone,
        "customer_address": invoice.customer_address,
        "supervisor_name": user_name,
        "tax_number": COMPANY_TAX_NUMBER,
        "commercial_reg": COMPANY_COMMERCIAL_REG
    }
    
    await db.invoices.insert_one(invoice_doc)
    return Invoice(**{k: v for k, v in invoice_doc.items() if k != "_id"})

@router.put("/{invoice_id}/pay")
async def pay_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Mark an invoice as paid"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    if invoice.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Invoice already paid")
    
    # Update invoice status
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {
            "status": "paid",
            "paid_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Update member activities and levels if member_id exists
    member_id = invoice.get("member_id")
    if member_id:
        for item in invoice.get("items", []):
            if item.get("activity_id") and not item.get("is_product"):
                activity_data = {
                    "activity_id": item.get("activity_id"),
                    "activity_name": item.get("activity_name"),
                    "start_date": item.get("start_date", ""),
                    "end_date": item.get("end_date", ""),
                    "fee": item.get("fee", 0),
                    "status": "active",
                    "coach_id": "",
                    "level_id": item.get("level_id", ""),
                    "schedule": item.get("schedule", ""),
                    "source": "invoice",
                    "source_id": invoice_id
                }
                
                # Add or update activity
                await db.members.update_one(
                    {"id": member_id},
                    {"$push": {"activities": activity_data}}
                )
                
                # Add member to level if level_id is specified
                level_id = item.get("level_id")
                if level_id:
                    # Check if level exists
                    level = await db.levels.find_one({"id": level_id})
                    if level:
                        # Add member to level if not already there
                        if member_id not in level.get("members", []):
                            await db.levels.update_one(
                                {"id": level_id},
                                {"$addToSet": {"members": member_id}}
                            )
                        
                        # Create or update level subscription for auto-cleanup
                        end_date = item.get("end_date", "")
                        if end_date:
                            await db.level_subscriptions.update_one(
                                {"member_id": member_id, "level_id": level_id},
                                {"$set": {
                                    "member_id": member_id,
                                    "level_id": level_id,
                                    "start_date": item.get("start_date", ""),
                                    "end_date": end_date,
                                    "invoice_id": invoice_id
                                }},
                                upsert=True
                            )
    
    return {"message": "Invoice paid successfully"}

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
