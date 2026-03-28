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

PAYMENT_STATUSES = {
    "paid": "مدفوع",
    "unpaid": "غير مدفوع",
}
ALLOWED_STATUSES = set(PAYMENT_STATUSES.keys())


class PaymentVoucherCreate(BaseModel):
    beneficiary_name: str
    amount: float
    purpose: str
    payment_date: str
    payment_method: str = "cash"
    status: str = "paid"
    reference: Optional[str] = ""
    notes: Optional[str] = ""


class PaymentVoucherUpdate(BaseModel):
    beneficiary_name: Optional[str] = None
    amount: Optional[float] = None
    purpose: Optional[str] = None
    payment_date: Optional[str] = None
    payment_method: Optional[str] = None
    status: Optional[str] = None
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
    if data.status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail=f"حالة الدفع غير صالحة. القيم المسموح بها: {', '.join(ALLOWED_STATUSES)}")

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
        "status": data.status,
        "status_ar": PAYMENT_STATUSES.get(data.status, data.status),
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
            voucher["voucher_number"] = await generate_voucher_number()
            voucher["id"] = str(uuid.uuid4())
            await db.payment_vouchers.insert_one(voucher)
        else:
            raise HTTPException(status_code=500, detail="خطأ في حفظ السند")
    voucher.pop("_id", None)
    return voucher


@router.get("/beneficiaries")
async def list_beneficiaries(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Return unique beneficiary names with aggregated payment stats."""
    query = {}
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    if is_admin and branch_filter and branch_filter != "all":
        query["branch_id"] = branch_filter
    elif not is_admin and branch_id:
        query["branch_id"] = branch_id

    pipeline = [
        {"$match": query},
        {"$sort": {"payment_date": -1}},
        {"$group": {
            "_id": "$beneficiary_name",
            "total_amount": {"$sum": "$amount"},
            "count": {"$sum": 1},
            "last_payment_date": {"$first": "$payment_date"},
            "last_voucher_number": {"$first": "$voucher_number"},
            "paid_amount": {"$sum": {"$cond": [{"$eq": ["$status", "paid"]}, "$amount", 0]}},
            "unpaid_amount": {"$sum": {"$cond": [{"$eq": ["$status", "unpaid"]}, "$amount", 0]}},
        }},
        {"$project": {
            "_id": 0,
            "beneficiary_name": "$_id",
            "total_amount": 1,
            "count": 1,
            "last_payment_date": 1,
            "last_voucher_number": 1,
            "paid_amount": 1,
            "unpaid_amount": 1,
        }},
        {"$sort": {"beneficiary_name": 1}},
    ]

    beneficiaries = await db.payment_vouchers.aggregate(pipeline).to_list(500)
    return beneficiaries


@router.get("")
async def list_payment_vouchers(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    beneficiary_name: Optional[str] = None,
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

    if status and status in ALLOWED_STATUSES:
        query["status"] = status

    if beneficiary_name:
        query["beneficiary_name"] = beneficiary_name

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
    if "status" in update_data:
        if update_data["status"] not in ALLOWED_STATUSES:
            raise HTTPException(status_code=400, detail=f"حالة الدفع غير صالحة. القيم المسموح بها: {', '.join(ALLOWED_STATUSES)}")
        update_data["status_ar"] = PAYMENT_STATUSES.get(update_data["status"], update_data["status"])
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
