from pydantic import BaseModel
from typing import Optional, List

class BranchBase(BaseModel):
    name: str
    name_ar: str
    public_name: Optional[str] = ""
    phone: str
    manager_name: Optional[str] = ""
    manager_name_ar: Optional[str] = ""
    address: Optional[str] = ""
    address_ar: Optional[str] = ""
    is_active: bool = True
    code_prefix: Optional[str] = ""
    whatsapp_group_url: Optional[str] = ""
    # Per-branch WhatsApp message templates. Empty -> fall back to the shared
    # global templates in whatsapp_settings (backward compatible).
    whatsapp_renewal_template: Optional[str] = ""
    whatsapp_manual_template: Optional[str] = ""
    whatsapp_welcome_template: Optional[str] = ""
    # Days the branch operates. None/empty = open all week (backward compatible).
    working_days: Optional[List[str]] = None

class BranchCreate(BranchBase):
    pass

class Branch(BranchBase):
    id: str
    created_at: str
