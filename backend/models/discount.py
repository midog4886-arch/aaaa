from pydantic import BaseModel
from typing import Optional, List

class DiscountCreate(BaseModel):
    code: str
    name_ar: str
    name: Optional[str] = ""
    discount_type: str = "percentage"
    value: float
    min_purchase: float = 0
    max_uses: int = 0
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    is_active: bool = True
    branch_id: Optional[str] = None
    # Offer scope: when non-empty, the coupon is only valid on invoices that
    # include ALL of these activities together (e.g. a two-activity bundle offer).
    activity_ids: Optional[List[str]] = None

class Discount(BaseModel):
    id: str
    code: str
    name_ar: str
    name: Optional[str] = ""
    discount_type: str
    value: float
    min_purchase: float
    max_uses: int
    used_count: int = 0
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    is_active: bool
    branch_id: Optional[str] = None
    activity_ids: Optional[List[str]] = None
    created_at: str
