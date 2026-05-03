"""Coach Advances API - سُلف المدربين"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from .common import db, get_current_user
from utils.auth import require_branch_scope, resolve_branch_filter

router = APIRouter(prefix="/coach-advances", tags=["coach-advances"])

PAYMENT_METHODS = {
    "cash": "نقداً",
    "transfer": "تحويل بنكي",
    "card": "بطاقة",
    "check": "شيك",
}


class AdvanceCreate(BaseModel):
    coach_id: str
    advance_date: str
    amount: float
    payment_method: str = "cash"
    notes: Optional[str] = ""


def _branch_scope_filter(effective_branch: Optional[str]) -> dict:
    if not effective_branch:
        return {}
    return {"$or": [
        {"branch_id": effective_branch},
        {"branch_id": None},
        {"branch_id": {"$exists": False}}
    ]}


async def _next_expense_number() -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": "internal_expense_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = (counter or {}).get("seq", 1)
    if seq < 10001:
        await db.counters.update_one(
            {"_id": "internal_expense_number"},
            {"$max": {"seq": 10001}}
        )
        seq = 10001
    return f"EXP-{seq:05d}"


@router.get("")
async def list_advances(
    coach_id: Optional[str] = None,
    month: Optional[str] = None,
    status: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query: dict = {}
    if coach_id:
        query["coach_id"] = coach_id
    if month:
        query["advance_date"] = {"$regex": f"^{month}"}
    if status and status in ("pending", "repaid"):
        query["status"] = status

    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query.update(_branch_scope_filter(effective_branch))

    advances = await db.coach_advances.find(query, {"_id": 0}).sort("advance_date", -1).to_list(2000)
    return advances


@router.post("")
async def create_advance(
    data: AdvanceCreate,
    current_user: dict = Depends(get_current_user)
):
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="المبلغ يجب أن يكون أكبر من صفر")

    effective_branch = require_branch_scope(current_user)

    coach = await db.coaches.find_one({"id": data.coach_id}, {"_id": 0})
    if not coach:
        raise HTTPException(status_code=404, detail="المدرب غير موجود")

    if effective_branch:
        coach_branch = coach.get("branch_id")
        if coach_branch and coach_branch != effective_branch:
            raise HTTPException(status_code=404, detail="المدرب غير موجود")

    branch_id = coach.get("branch_id") or current_user.get("branch_id")
    now = datetime.now(timezone.utc).isoformat()
    advance_id = str(uuid.uuid4())
    coach_name = coach.get("name_ar") or coach.get("name", "")

    expense_number = await _next_expense_number()
    expense_id = str(uuid.uuid4())
    expense_doc = {
        "id": expense_id,
        "expense_number": expense_number,
        "expense_date": data.advance_date,
        "expense_type": "coach_advance",
        "cost_center": branch_id,
        "description": f"سلفة للمدرب {coach_name}" + (f" — {data.notes}" if data.notes else ""),
        "amount": float(data.amount),
        "payment_method": data.payment_method,
        "executor_name": coach_name,
        "notes": data.notes or "",
        "receipt_url": None,
        "status": "approved",
        "branch_id": branch_id,
        "created_by": current_user.get("username") or current_user.get("name", ""),
        "created_at": now,
        "journal_entry_id": None,
        "coach_id": data.coach_id,
        "coach_advance_id": advance_id,
    }
    await db.internal_expenses.insert_one(expense_doc)

    advance_doc = {
        "id": advance_id,
        "coach_id": data.coach_id,
        "coach_name": coach_name,
        "branch_id": branch_id,
        "advance_date": data.advance_date,
        "amount": float(data.amount),
        "payment_method": data.payment_method,
        "notes": data.notes or "",
        "status": "pending",
        "repaid_in_salary_id": None,
        "repaid_at": None,
        "expense_id": expense_id,
        "created_by": current_user.get("username") or current_user.get("name", ""),
        "created_at": now,
    }
    await db.coach_advances.insert_one(advance_doc)
    advance_doc.pop("_id", None)
    return advance_doc


@router.delete("/{advance_id}")
async def delete_advance(
    advance_id: str,
    current_user: dict = Depends(get_current_user)
):
    effective_branch = resolve_branch_filter(current_user, None)
    query: dict = {"id": advance_id}
    if effective_branch:
        query.update(_branch_scope_filter(effective_branch))

    advance = await db.coach_advances.find_one(query, {"_id": 0})
    if not advance:
        raise HTTPException(status_code=404, detail="السلفة غير موجودة")

    if advance.get("status") == "repaid":
        raise HTTPException(status_code=400, detail="لا يمكن حذف سلفة تم خصمها من راتب مصروف. ألغِ صرف الراتب أولاً.")

    await db.coach_advances.delete_one({"id": advance_id})
    if advance.get("expense_id"):
        await db.internal_expenses.delete_one({"id": advance["expense_id"]})

    return {"message": "تم حذف السلفة"}
