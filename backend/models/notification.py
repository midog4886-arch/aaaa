from pydantic import BaseModel
from typing import Optional

class NotificationCreate(BaseModel):
    title: str
    message: str
    notification_type: str = "general"  # subscription_expiry, payment_reminder, general
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None

class Notification(NotificationCreate):
    id: str
    is_read: bool = False
    branch_id: Optional[str] = None
    created_by: Optional[str] = ""
    created_at: str
