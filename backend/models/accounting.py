from pydantic import BaseModel
from typing import List, Optional

class AccountCreate(BaseModel):
    code: str
    name_ar: str
    name: Optional[str] = ""
    account_type: str  # asset, liability, equity, revenue, expense
    parent_id: Optional[str] = None
    is_active: bool = True
    description: Optional[str] = ""

class Account(AccountCreate):
    id: str
    balance: float = 0
    branch_id: Optional[str] = None
    created_at: str

class SupplierCreate(BaseModel):
    name_ar: str
    name: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    tax_number: Optional[str] = ""
    commercial_reg: Optional[str] = ""
    notes: Optional[str] = ""

class Supplier(SupplierCreate):
    id: str
    total_purchases: float = 0
    total_paid: float = 0
    balance: float = 0
    branch_id: Optional[str] = None
    created_at: str

class PurchaseInvoiceItem(BaseModel):
    description: str
    quantity: int = 1
    unit_price: float
    total: float
    account_id: Optional[str] = None

class PurchaseInvoiceCreate(BaseModel):
    supplier_id: str
    invoice_number: str
    invoice_date: str
    due_date: Optional[str] = None
    items: List[PurchaseInvoiceItem]
    subtotal: float
    tax_amount: float = 0
    total: float
    payment_method: str = "cash"
    paid_amount: float = 0
    notes: Optional[str] = ""

class PurchaseInvoice(PurchaseInvoiceCreate):
    id: str
    supplier_name: Optional[str] = ""
    remaining_amount: float = 0
    status: str = "pending"
    branch_id: Optional[str] = None
    created_by: Optional[str] = ""
    created_at: str

class JournalEntryLine(BaseModel):
    account_id: str
    account_code: Optional[str] = ""
    account_name: Optional[str] = ""
    debit: float = 0
    credit: float = 0
    description: Optional[str] = ""
    party_type: Optional[str] = None
    party_id: Optional[str] = None
    party_name: Optional[str] = None

class JournalEntryCreate(BaseModel):
    entry_date: str
    description: str
    reference_number: Optional[str] = ""
    journal_type: str = "general"
    lines: List[JournalEntryLine]

class JournalEntry(JournalEntryCreate):
    id: str
    entry_number: str
    total_debit: float = 0
    total_credit: float = 0
    status: str = "posted"
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None
    branch_id: Optional[str] = None
    created_by: Optional[str] = ""
    created_at: str

class InternalExpenseCreate(BaseModel):
    expense_date: str
    expense_type: str
    description: str
    amount: float
    payment_method: str = "cash"
    executor_name: Optional[str] = ""
    notes: Optional[str] = ""

class InternalExpense(InternalExpenseCreate):
    id: str
    expense_number: str
    receipt_url: Optional[str] = None
    status: str = "pending"
    branch_id: Optional[str] = None
    created_by: Optional[str] = ""
    created_at: str
    journal_entry_id: Optional[str] = None
