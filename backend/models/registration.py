from pydantic import BaseModel
from typing import List, Optional

class RegistrationFormItem(BaseModel):
    activity_id: Optional[str] = ""
    product_id: Optional[str] = ""
    activity_name: str
    fee: float
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    period: Optional[str] = ""
    schedule: Optional[str] = ""
    is_product: bool = False
    quantity: int = 1

class RegistrationFormCreate(BaseModel):
    customer_name: str
    customer_phone: str
    items: List[RegistrationFormItem]
    subtotal: float
    discount: float = 0
    discount_code: Optional[str] = ""
    vat_amount: float
    total: float
    payment_method: str = "cash"
    notes: Optional[str] = ""
    branch_id: Optional[str] = None

class RegistrationForm(BaseModel):
    id: str
    form_number: str
    customer_name: str
    customer_phone: str
    items: List[RegistrationFormItem]
    subtotal: float
    discount: float
    discount_code: Optional[str] = ""
    vat_amount: float
    total: float
    payment_method: str
    notes: Optional[str] = ""
    branch_id: Optional[str] = None
    created_at: str
    status: str = "pending"
