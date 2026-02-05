from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid

from database import db
from models.user import UserCreate, UserLogin, TokenResponse
from utils.auth import hash_password, verify_password, create_token, get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/register", response_model=TokenResponse)
async def register(user: UserCreate):
    existing = await db.users.find_one({"username": user.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "username": user.username,
        "password": hash_password(user.password),
        "name": user.name,
        "branch_id": None,
        "is_admin": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    token = create_token(user_id, user.username, None, False)
    return TokenResponse(
        access_token=token,
        user={"id": user_id, "username": user.username, "name": user.name, "branch_id": None, "is_admin": False}
    )

@router.post("/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    user = await db.users.find_one({"username": credentials.username}, {"_id": 0})
    if not user or not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    branch_id = user.get("branch_id")
    is_admin = user.get("is_admin", False)
    
    token = create_token(user["id"], user["username"], branch_id, is_admin)
    return TokenResponse(
        access_token=token,
        user={"id": user["id"], "username": user["username"], "name": user["name"], "branch_id": branch_id, "is_admin": is_admin}
    )

@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
