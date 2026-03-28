"""Payment Vouchers API - سندات الصرف"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime, timezone

from .common import db, get_current_user

router = APIRouter(prefix="/payment-vouchers", tags=["payment-vouchers"])

PAYMENT_METHODS = {
    "cash": "نقداً",
    "transfer": "تحويل بنكي",
    "check": "شيك",
}
ALLOWED_PAYMENT_METHODS = set(PAYMENT_METHODS.keys())


class PaymentVoucherCreate(BaseModel):
    beneficiary_name: str
    amount: float
    purpose: str
    payment_date: str
    payment_method: str = "cash"
    reference: Optional[str] = ""
    notes: Optional[str] = ""


class PaymentVoucherUpdate(BaseModel):
    beneficiary_name: Optional[str] = None
    amount: Optional[float] = None
    purpose: Optional[str] = None
    payment_date: Optional[str] = None
    payment_method: Optional[str] = None
    reference: Optional[str] = None
    notes: Optional[str] = None


async def generate_voucher_number() -> str:
    """Generate a sequential, collision-free voucher number using an atomic counter."""
    year = datetime.now(timezone.utc).year
    counter_id = f"payment_vouchers_{year}"
    result = await db.counters.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = result["seq"]
    return f"PV-{year}-{str(seq).zfill(3)}"


async def ensure_voucher_indexes():
    """Create unique index on voucher_number to prevent duplicates at DB level."""
    await db.payment_vouchers.create_index("voucher_number", unique=True)


def _build_ownership_query(voucher_id: str, current_user: dict) -> dict:
    """Return a query that scopes the voucher to the user's branch for non-admins."""
    query = {"id": voucher_id}
    if not current_user.get("is_admin", False):
        branch_id = current_user.get("branch_id")
        if branch_id:
            query["branch_id"] = branch_id
    return query


@router.post("")
async def create_payment_voucher(
    data: PaymentVoucherCreate,
    current_user: dict = Depends(get_current_user)
):
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="المبلغ يجب أن يكون أكبر من صفر")
    if not data.beneficiary_name.strip():
        raise HTTPException(status_code=400, detail="اسم المستفيد مطلوب")
    if not data.purpose.strip():
        raise HTTPException(status_code=400, detail="الغرض من الصرف مطلوب")
    if data.payment_method not in ALLOWED_PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail=f"طريقة الدفع غير صالحة. القيم المسموح بها: {', '.join(ALLOWED_PAYMENT_METHODS)}")

    voucher_number = await generate_voucher_number()
    now = datetime.now(timezone.utc).isoformat()

    voucher = {
        "id": str(uuid.uuid4()),
        "voucher_number": voucher_number,
        "beneficiary_name": data.beneficiary_name.strip(),
        "amount": data.amount,
        "purpose": data.purpose.strip(),
        "payment_date": data.payment_date,
        "payment_method": data.payment_method,
        "payment_method_ar": PAYMENT_METHODS.get(data.payment_method, data.payment_method),
        "reference": data.reference or "",
        "notes": data.notes or "",
        "created_by": current_user.get("name", current_user.get("username", "")),
        "branch_id": current_user.get("branch_id", ""),
        "created_at": now,
        "updated_at": now,
    }

    try:
        await db.payment_vouchers.insert_one(voucher)
    except Exception as e:
        if "duplicate key" in str(e).lower() or "E11000" in str(e):
            # Retry once with a fresh number in the rare case of a race condition
            voucher["voucher_number"] = await generate_voucher_number()
            voucher["id"] = str(uuid.uuid4())
            await db.payment_vouchers.insert_one(voucher)
        else:
            raise HTTPException(status_code=500, detail="خطأ في حفظ السند")
    voucher.pop("_id", None)
    return voucher


@router.get("")
async def list_payment_vouchers(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}

    if start_date and end_date:
        query["payment_date"] = {"$gte": start_date, "$lte": end_date}
    elif start_date:
        query["payment_date"] = {"$gte": start_date}
    elif end_date:
        query["payment_date"] = {"$lte": end_date}

    if search:
        query["$or"] = [
            {"beneficiary_name": {"$regex": search, "$options": "i"}},
            {"purpose": {"$regex": search, "$options": "i"}},
            {"voucher_number": {"$regex": search, "$options": "i"}},
        ]

    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id

    vouchers = await db.payment_vouchers.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return vouchers


@router.get("/{voucher_id}")
async def get_payment_voucher(
    voucher_id: str,
    current_user: dict = Depends(get_current_user)
):
    query = _build_ownership_query(voucher_id, current_user)
    voucher = await db.payment_vouchers.find_one(query, {"_id": 0})
    if not voucher:
        raise HTTPException(status_code=404, detail="السند غير موجود")
    return voucher


@router.put("/{voucher_id}")
async def update_payment_voucher(
    voucher_id: str,
    data: PaymentVoucherUpdate,
    current_user: dict = Depends(get_current_user)
):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية الأدمن مطلوبة لتعديل السندات")

    query = _build_ownership_query(voucher_id, current_user)
    existing = await db.payment_vouchers.find_one(query)
    if not existing:
        raise HTTPException(status_code=404, detail="السند غير موجود")

    update_data = {k: v for k, v in data.dict().items() if v is not None}
    if "payment_method" in update_data:
        if update_data["payment_method"] not in ALLOWED_PAYMENT_METHODS:
            raise HTTPException(status_code=400, detail=f"طريقة الدفع غير صالحة. القيم المسموح بها: {', '.join(ALLOWED_PAYMENT_METHODS)}")
        update_data["payment_method_ar"] = PAYMENT_METHODS.get(update_data["payment_method"], update_data["payment_method"])
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.payment_vouchers.update_one({"id": voucher_id}, {"$set": update_data})
    updated = await db.payment_vouchers.find_one({"id": voucher_id}, {"_id": 0})
    return updated


@router.delete("/{voucher_id}")
async def delete_payment_voucher(
    voucher_id: str,
    current_user: dict = Depends(get_current_user)
):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية الأدمن مطلوبة لحذف السندات")

    query = _build_ownership_query(voucher_id, current_user)
    result = await db.payment_vouchers.delete_one(query)
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="السند غير موجود")
    return {"message": "تم حذف السند بنجاح"}
