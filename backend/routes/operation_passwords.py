from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict

from database import db
from utils.auth import get_current_user

router = APIRouter(prefix="/settings/operation-passwords", tags=["OperationPasswords"])

PASSWORD_KEYS = {
    "delete_invoice": "حذف فاتورة مدفوعة",
    "edit_price": "تعديل سعر فاتورة",
    "reg_forms": "استمارات التسجيل",
    "delete_member": "حذف عضو",
    "reports": "إظهار التقارير",
    "daily_ledger": "الدفتر اليومي",
}

DEFAULT_PASSWORD = "242456"
DOC_ID = "operation_passwords"


class UpdateBody(BaseModel):
    values: Dict[str, str]


class VerifyBody(BaseModel):
    key: str
    password: str


async def _load_values() -> Dict[str, str]:
    doc = await db.app_settings.find_one({"_id": DOC_ID})
    stored = (doc or {}).get("values") or {}
    out = {}
    for k in PASSWORD_KEYS.keys():
        v = stored.get(k)
        out[k] = v if (isinstance(v, str) and v.strip()) else DEFAULT_PASSWORD
    return out


@router.get("")
async def get_passwords(current_user: dict = Depends(get_current_user)):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    values = await _load_values()
    return {"keys": PASSWORD_KEYS, "values": values, "default": DEFAULT_PASSWORD}


@router.put("")
async def update_passwords(body: UpdateBody, current_user: dict = Depends(get_current_user)):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    clean = {}
    for k, v in (body.values or {}).items():
        if k not in PASSWORD_KEYS:
            continue
        if not isinstance(v, str):
            continue
        v2 = v.strip()
        if len(v2) < 4:
            raise HTTPException(status_code=400, detail=f"كلمة المرور قصيرة جداً (الحد الأدنى 4 أحرف): {PASSWORD_KEYS[k]}")
        if len(v2) > 64:
            raise HTTPException(status_code=400, detail="كلمة المرور طويلة جداً")
        clean[k] = v2
    await db.app_settings.update_one(
        {"_id": DOC_ID},
        {"$set": {"values": clean}},
        upsert=True,
    )
    return {"ok": True, "values": await _load_values()}


@router.post("/verify")
async def verify_password(body: VerifyBody, current_user: dict = Depends(get_current_user)):
    if body.key not in PASSWORD_KEYS:
        raise HTTPException(status_code=400, detail="Invalid key")
    values = await _load_values()
    expected = values.get(body.key) or DEFAULT_PASSWORD
    valid = (body.password or "") == expected
    return {"valid": valid}
