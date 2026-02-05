from pydantic import BaseModel
from typing import Optional, List

class SubscriptionRenewalCreate(BaseModel):
    member_id: str
    activity_id: str
    old_start_date: str
    old_end_date: str
    new_start_date: str
    new_end_date: str
    fee: float
    notes: Optional[str] = ""

class SubscriptionRenewal(SubscriptionRenewalCreate):
    id: str
    member_name: Optional[str] = ""
    activity_name: Optional[str] = ""
    invoice_id: Optional[str] = None
    branch_id: Optional[str] = None
    renewed_by: Optional[str] = ""
    created_at: str
