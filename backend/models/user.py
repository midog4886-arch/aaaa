from pydantic import BaseModel
from typing import Dict, Any, Optional, List

class UserCreate(BaseModel):
    username: str
    password: str
    name: str

class UserLogin(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]

class UserCreateAdmin(BaseModel):
    username: str
    password: str
    name: str
    branch_id: Optional[str] = None
    branch_ids: Optional[List[str]] = None
    is_admin: bool = False

class UserUpdateAdmin(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    branch_id: Optional[str] = None
    branch_ids: Optional[List[str]] = None
    is_admin: Optional[bool] = None
    password: Optional[str] = None
