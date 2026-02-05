from pydantic import BaseModel
from typing import List, Optional

# Company registration info
COMPANY_TAX_NUMBER = "312655637900003"
COMPANY_COMMERCIAL_REG = "7043630230"
VAT_RATE = 0.15  # 15% VAT

class InvoiceItem(BaseModel):
    activity_id: str
    activity_name: str
    fee: float
    period: str
    schedule: Optional[str] = ""
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

class CreditNoteItem(BaseModel):
    activity_id: Optional[str] = ""
    product_id: Optional[str] = ""
    activity_name: str
    fee: float
    quantity: int = 1
    period: Optional[str] = ""
    schedule: Optional[str] = ""
    is_product: bool = False

class CreditNoteCreate(BaseModel):
    original_invoice_id: str
    original_invoice_number: str
    items: List[CreditNoteItem]
    refund_amount: float
    reason: Optional[str] = ""
    notes: Optional[str] = ""

class CreditNote(BaseModel):
    id: str
    credit_note_number: str
    original_invoice_id: str
    original_invoice_number: str
    customer_name_ar: str
    customer_phone: str
    items: List[CreditNoteItem]
    subtotal: float
    vat_amount: float
    refund_amount: float
    reason: Optional[str] = ""
    notes: Optional[str] = ""
    branch_id: Optional[str] = None
    created_by: Optional[str] = ""
    created_at: str
