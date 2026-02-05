from pydantic import BaseModel
from typing import Optional

class AttendanceCreate(BaseModel):
    member_id: str
    activity_id: str
    date: str
    status: str = "present"  # present, absent

class AttendanceRecord(BaseModel):
    id: str
    member_id: str
    member_name: Optional[str] = ""
    activity_id: str
    activity_name: Optional[str] = ""
    date: str
    status: str
    branch_id: Optional[str] = None
    recorded_by: Optional[str] = ""
    created_at: str

class AttendanceBulkCreate(BaseModel):
    activity_id: str
    date: str
    records: list  # List of {member_id, status}
