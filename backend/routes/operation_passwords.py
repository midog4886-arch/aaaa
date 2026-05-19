import re
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, List

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
GLOBAL_KEY = "__global__"
_BRANCH_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


class UpdateBody(BaseModel):
    values: Dict[str, str]
    branch_id: Optional[str] = None


class VerifyBody(BaseModel):
    key: str
    password: str
    branch_id: Optional[str] = None


def _safe_branch_id(branch_id: Optional[str]) -> Optional[str]:
    if branch_id is None:
        return None
    bid = str(branch_id).strip()
    if not bid:
        return None
    if not _BRANCH_ID_RE.match(bid):
        raise HTTPException(status_code=400, detail="Invalid branch_id format")
    return bid


def _effective_branch_for_user(current_user: dict, branch_id: Optional[str]) -> str:
    safe = _safe_branch_id(branch_id)
    if current_user.get("is_admin", False):
        return safe if safe else GLOBAL_KEY
    user_branch = current_user.get("branch_id")
    if not user_branch:
        return GLOBAL_KEY
    return str(user_branch)


async def _load_doc() -> dict:
    return await db.app_settings.find_one({"_id": DOC_ID}) or {}


def _branch_values_from_doc(doc: dict, branch_key: str) -> Dict[str, str]:
    branch_map = doc.get("branch_values") if isinstance(doc.get("branch_values"), dict) else {}
    branch_map = branch_map or {}
    branch_stored = branch_map.get(branch_key) if isinstance(branch_map.get(branch_key), dict) else {}
    global_stored = branch_map.get(GLOBAL_KEY) if isinstance(branch_map.get(GLOBAL_KEY), dict) else {}
    legacy_stored = doc.get("values") if isinstance(doc.get("values"), dict) else {}
    out = {}
    for k in PASSWORD_KEYS.keys():
        chosen = None
        for source in (branch_stored, global_stored, legacy_stored):
            v = source.get(k) if isinstance(source, dict) else None
            if isinstance(v, str) and v.strip():
                chosen = v.strip()
                break
        out[k] = chosen if chosen else DEFAULT_PASSWORD
    return out


async def _load_branches_for_user(current_user: dict) -> List[dict]:
    branches_cursor = db.branches.find({}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1})
    branches = await branches_cursor.to_list(500)
    user_branch_id = current_user.get("branch_id")
    if not current_user.get("is_admin", False) and user_branch_id:
        branches = [b for b in branches if b.get("id") == user_branch_id]
    return branches


@router.get("")
async def get_passwords(
    branch_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    safe = _safe_branch_id(branch_id)
    branch_key = safe if safe else GLOBAL_KEY
    doc = await _load_doc()
    values = _branch_values_from_doc(doc, branch_key)
    branches = await _load_branches_for_user(current_user)
    return {
        "keys": PASSWORD_KEYS,
        "values": values,
        "default": DEFAULT_PASSWORD,
        "branch_id": branch_key,
        "branches": branches,
    }


@router.put("")
async def update_passwords(body: UpdateBody, current_user: dict = Depends(get_current_user)):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    safe = _safe_branch_id(body.branch_id)
    branch_key = safe if safe else GLOBAL_KEY
    if branch_key != GLOBAL_KEY:
        valid_ids = {b.get("id") for b in await _load_branches_for_user(current_user) if b.get("id")}
        if branch_key not in valid_ids:
            raise HTTPException(status_code=400, detail="Unknown branch_id")
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
        {"$set": {f"branch_values.{branch_key}": clean}},
        upsert=True,
    )
    doc = await _load_doc()
    return {
        "ok": True,
        "branch_id": branch_key,
        "values": _branch_values_from_doc(doc, branch_key),
    }


@router.post("/verify")
async def verify_password(body: VerifyBody, current_user: dict = Depends(get_current_user)):
    if body.key not in PASSWORD_KEYS:
        raise HTTPException(status_code=400, detail="Invalid key")
    branch_key = _effective_branch_for_user(current_user, body.branch_id)
    doc = await _load_doc()
    values = _branch_values_from_doc(doc, branch_key)
    expected = values.get(body.key) or DEFAULT_PASSWORD
    valid = (body.password or "") == expected
    return {"valid": valid}
