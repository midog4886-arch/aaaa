"""Hourly facility rentals for external coaches - تأجير الساعات للمدربين الخارجيين"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import re
import uuid
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user
from utils.auth import require_branch_scope, resolve_branch_filter, require_permission

router = APIRouter(prefix="/rentals", tags=["rentals"])

PAYMENT_METHODS = {
    "cash": "نقداً",
    "transfer": "تحويل بنكي",
    "card": "شبكة/بطاقة",
}

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WEEKDAY_AR = {
    "saturday": "السبت", "sunday": "الأحد", "monday": "الاثنين",
    "tuesday": "الثلاثاء", "wednesday": "الأربعاء", "thursday": "الخميس", "friday": "الجمعة",
}


def _weekday_of(date_str: str) -> str:
    """YYYY-MM-DD -> english lowercase weekday (matches levels.days[] convention)."""
    return WEEKDAYS[datetime.strptime(date_str, "%Y-%m-%d").weekday()]


def _parse_hour(text: str) -> Optional[int]:
    """Parse an hour (0-23) from strings like '17:00', '5:00 م', '5 م', '5:30 PM'."""
    if not text:
        return None
    m = re.search(r"(\d{1,2})(?::\d{2})?", str(text))
    if not m:
        return None
    hour = int(m.group(1))
    lowered = str(text).lower()
    is_pm = ("م" in str(text) and "ص" not in str(text)) or "pm" in lowered
    is_am = "ص" in str(text) or "am" in lowered
    if is_pm and hour < 12:
        hour += 12
    elif is_am and hour == 12:
        hour = 0
    return hour if 0 <= hour <= 23 else None


class RentalCoachCreate(BaseModel):
    name: str
    phone: Optional[str] = ""
    activity: Optional[str] = ""
    hourly_rate: Optional[float] = 0
    notes: Optional[str] = ""
    branch_id: Optional[str] = None  # admins only; non-admins pinned to own branch


class RentalCoachUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    activity: Optional[str] = None
    hourly_rate: Optional[float] = None
    notes: Optional[str] = None


class BookingCreate(BaseModel):
    coach_id: str
    branch_id: Optional[str] = None  # admins only
    date: Optional[str] = None       # single booking YYYY-MM-DD
    recurring: Optional[bool] = False
    start_date: Optional[str] = None  # recurring range
    end_date: Optional[str] = None
    days: Optional[List[str]] = None  # recurring weekdays (english lowercase)
    start_hour: int                   # 0-23
    duration_hours: float = 1
    hourly_rate: float
    persons_count: Optional[int] = 0      # per-person pricing (added on top)
    person_rate: Optional[float] = 0      # price per person per hour
    notes: Optional[str] = ""
    force: Optional[bool] = False     # override conflicts


class BookingUpdate(BaseModel):
    date: Optional[str] = None
    start_hour: Optional[int] = None
    duration_hours: Optional[float] = None
    hourly_rate: Optional[float] = None
    persons_count: Optional[int] = None
    person_rate: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[str] = None  # booked / cancelled


def _booking_total(hourly_rate: float, duration_hours: float, persons_count: int, person_rate: float) -> float:
    return round((hourly_rate * duration_hours) + (persons_count * person_rate * duration_hours), 2)


class PaymentCreate(BaseModel):
    coach_id: str
    booking_ids: List[str]
    payment_method: str = "cash"
    payment_date: str
    notes: Optional[str] = ""


def _effective_branch_for_create(current_user: dict, requested: Optional[str]) -> str:
    """Admins may pick any branch; non-admins are pinned to their own branch."""
    if current_user.get("is_admin", False):
        return requested or current_user.get("branch_id", "") or ""
    require_branch_scope(current_user)
    return current_user.get("branch_id", "")


async def _generate_receipt_number() -> str:
    year = datetime.now(timezone.utc).year
    counter_id = f"rental_receipts_{year}"
    result = await db.counters.find_one_and_update(
        {"_id": counter_id}, {"$inc": {"seq": 1}},
        upsert=True, return_document=True,
    )
    return f"RR-{year}-{str(result['seq']).zfill(3)}"


async def _find_conflicts(branch_id: str, date: str, start_hour: int, duration_hours: float,
                          exclude_booking_id: Optional[str] = None) -> List[dict]:
    """Conflicts against other rentals AND academy levels on branch + weekday + hour."""
    conflicts = []
    end_hour = start_hour + max(duration_hours, 0.5)

    q = {"branch_id": branch_id, "date": date, "status": {"$ne": "cancelled"}}
    if exclude_booking_id:
        q["id"] = {"$ne": exclude_booking_id}
    others = await db.rental_bookings.find(q, {"_id": 0}).to_list(500)
    for b in others:
        b_start = b.get("start_hour", 0)
        b_end = b_start + b.get("duration_hours", 1)
        if b_start < end_hour and start_hour < b_end:
            conflicts.append({
                "type": "rental",
                "date": date,
                "description": f"حجز تأجير آخر للمدرب {b.get('coach_name', '')} الساعة {b_start}:00",
            })

    weekday = _weekday_of(date)
    levels = await db.levels.find(
        {"branch_id": branch_id, "days": weekday},
        {"_id": 0, "name": 1, "time_slot": 1},
    ).to_list(500)
    for lv in levels:
        lv_hour = _parse_hour(lv.get("time_slot", ""))
        if lv_hour is not None and start_hour <= lv_hour < end_hour:
            conflicts.append({
                "type": "level",
                "date": date,
                "description": f"مستوى تدريب بالأكاديمية ({lv.get('name', '')}) في {WEEKDAY_AR.get(weekday, weekday)} الساعة {lv.get('time_slot', '')}",
            })
    return conflicts


# ============ COACHES ============

@router.get("/coaches")
async def list_rental_coaches(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    await require_permission(current_user, "rentals")
    query = {}
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch
    coaches = await db.rental_coaches.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)

    # Aggregate booking stats per coach (paid / unpaid)
    coach_ids = [c["id"] for c in coaches]
    if coach_ids:
        pipeline = [
            {"$match": {"coach_id": {"$in": coach_ids}, "status": {"$ne": "cancelled"}}},
            {"$group": {
                "_id": "$coach_id",
                "total_hours": {"$sum": "$duration_hours"},
                "total_amount": {"$sum": "$total_amount"},
                "unpaid_amount": {"$sum": {"$cond": [{"$eq": ["$payment_status", "unpaid"]}, "$total_amount", 0]}},
                "bookings_count": {"$sum": 1},
            }},
        ]
        stats = {s["_id"]: s for s in await db.rental_bookings.aggregate(pipeline).to_list(1000)}
        for c in coaches:
            s = stats.get(c["id"], {})
            c["total_hours"] = s.get("total_hours", 0)
            c["total_amount"] = s.get("total_amount", 0)
            c["unpaid_amount"] = s.get("unpaid_amount", 0)
            c["bookings_count"] = s.get("bookings_count", 0)
    return coaches


@router.post("/coaches")
async def create_rental_coach(data: RentalCoachCreate, current_user: dict = Depends(get_current_user)):
    await require_permission(current_user, "rentals")
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="اسم المدرب مطلوب")
    branch_id = _effective_branch_for_create(current_user, data.branch_id)
    now = datetime.now(timezone.utc).isoformat()
    coach = {
        "id": str(uuid.uuid4()),
        "name": data.name.strip(),
        "phone": (data.phone or "").strip(),
        "activity": (data.activity or "").strip(),
        "hourly_rate": data.hourly_rate or 0,
        "notes": data.notes or "",
        "branch_id": branch_id,
        "created_by": current_user.get("username", ""),
        "created_at": now,
        "updated_at": now,
    }
    await db.rental_coaches.insert_one(coach)
    coach.pop("_id", None)
    return coach


@router.put("/coaches/{coach_id}")
async def update_rental_coach(coach_id: str, data: RentalCoachUpdate, current_user: dict = Depends(get_current_user)):
    await require_permission(current_user, "rentals")
    query = {"id": coach_id}
    effective_branch = resolve_branch_filter(current_user, None)
    if effective_branch:
        query["branch_id"] = effective_branch
    existing = await db.rental_coaches.find_one(query)
    if not existing:
        raise HTTPException(status_code=404, detail="المدرب غير موجود")
    update_data = {k: v for k, v in data.dict().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.rental_coaches.update_one({"id": coach_id}, {"$set": update_data})
    if "name" in update_data:
        await db.rental_bookings.update_many({"coach_id": coach_id}, {"$set": {"coach_name": update_data["name"]}})
    updated = await db.rental_coaches.find_one({"id": coach_id}, {"_id": 0})
    return updated


@router.delete("/coaches/{coach_id}")
async def delete_rental_coach(coach_id: str, current_user: dict = Depends(get_current_user)):
    await require_permission(current_user, "rentals")
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية الأدمن مطلوبة")
    has_bookings = await db.rental_bookings.find_one({"coach_id": coach_id})
    if has_bookings:
        raise HTTPException(status_code=400, detail="لا يمكن حذف مدرب له حجوزات مسجلة")
    result = await db.rental_coaches.delete_one({"id": coach_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="المدرب غير موجود")
    return {"message": "تم الحذف"}


# ============ BOOKINGS ============

@router.get("/bookings")
async def list_bookings(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    coach_id: Optional[str] = None,
    payment_status: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    await require_permission(current_user, "rentals")
    query = {}
    if start_date and end_date:
        query["date"] = {"$gte": start_date, "$lte": end_date}
    elif start_date:
        query["date"] = {"$gte": start_date}
    elif end_date:
        query["date"] = {"$lte": end_date}
    if coach_id:
        query["coach_id"] = coach_id
    if payment_status in ("paid", "unpaid"):
        query["payment_status"] = payment_status
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch
    bookings = await db.rental_bookings.find(query, {"_id": 0}).sort([("date", -1), ("start_hour", 1)]).to_list(2000)
    return bookings


@router.post("/bookings")
async def create_booking(data: BookingCreate, current_user: dict = Depends(get_current_user)):
    await require_permission(current_user, "rentals")
    persons_count = int(data.persons_count or 0)
    person_rate = float(data.person_rate or 0)
    if data.hourly_rate < 0 or persons_count < 0 or person_rate < 0:
        raise HTTPException(status_code=400, detail="قيم غير صالحة")
    if data.duration_hours <= 0 or data.duration_hours > 12:
        raise HTTPException(status_code=400, detail="مدة الحجز غير صالحة")
    if _booking_total(data.hourly_rate, data.duration_hours, persons_count, person_rate) <= 0:
        raise HTTPException(status_code=400, detail="يجب إدخال سعر الساعة أو سعر الفرد وعدد الأفراد")
    if not (0 <= data.start_hour <= 23):
        raise HTTPException(status_code=400, detail="ساعة البداية غير صالحة")

    branch_id = _effective_branch_for_create(current_user, data.branch_id)
    coach = await db.rental_coaches.find_one({"id": data.coach_id}, {"_id": 0})
    if not coach:
        raise HTTPException(status_code=404, detail="المدرب غير موجود")
    if coach.get("branch_id") and branch_id and coach["branch_id"] != branch_id:
        raise HTTPException(status_code=400, detail="المدرب مسجل على فرع آخر")

    # Build the target dates list
    if data.recurring:
        if not (data.start_date and data.end_date and data.days):
            raise HTTPException(status_code=400, detail="الحجز المتكرر يحتاج تاريخ بداية ونهاية وأيام الأسبوع")
        bad_days = [d for d in data.days if d not in WEEKDAYS]
        if bad_days:
            raise HTTPException(status_code=400, detail="أيام أسبوع غير صالحة")
        try:
            start = datetime.strptime(data.start_date, "%Y-%m-%d")
            end = datetime.strptime(data.end_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="صيغة تاريخ غير صالحة")
        if end < start or (end - start).days > 185:
            raise HTTPException(status_code=400, detail="النطاق الزمني غير صالح (بحد أقصى 6 أشهر)")
        wanted = set(data.days)
        dates = []
        cur = start
        while cur <= end:
            if WEEKDAYS[cur.weekday()] in wanted:
                dates.append(cur.strftime("%Y-%m-%d"))
            cur += timedelta(days=1)
        if not dates:
            raise HTTPException(status_code=400, detail="لا توجد تواريخ مطابقة للأيام المختارة")
    else:
        if not data.date:
            raise HTTPException(status_code=400, detail="التاريخ مطلوب")
        try:
            datetime.strptime(data.date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="صيغة تاريخ غير صالحة")
        dates = [data.date]

    # Conflict detection across all target dates
    all_conflicts = []
    for d in dates:
        all_conflicts.extend(await _find_conflicts(branch_id, d, data.start_hour, data.duration_hours))
    if all_conflicts and not data.force:
        raise HTTPException(status_code=409, detail={"message": "توجد تعارضات في المواعيد", "conflicts": all_conflicts[:30]})

    now = datetime.now(timezone.utc).isoformat()
    recurring_group_id = str(uuid.uuid4()) if data.recurring else None
    total_each = _booking_total(data.hourly_rate, data.duration_hours, persons_count, person_rate)
    docs = []
    for d in dates:
        docs.append({
            "id": str(uuid.uuid4()),
            "coach_id": coach["id"],
            "coach_name": coach.get("name", ""),
            "branch_id": branch_id,
            "date": d,
            "weekday": _weekday_of(d),
            "start_hour": data.start_hour,
            "duration_hours": data.duration_hours,
            "hourly_rate": data.hourly_rate,
            "persons_count": persons_count,
            "person_rate": person_rate,
            "total_amount": total_each,
            "status": "booked",
            "payment_status": "unpaid",
            "payment_id": None,
            "recurring_group_id": recurring_group_id,
            "notes": data.notes or "",
            "created_by": current_user.get("username", ""),
            "created_at": now,
            "updated_at": now,
        })
    await db.rental_bookings.insert_many(docs)
    for doc in docs:
        doc.pop("_id", None)
    return {"created": len(docs), "bookings": docs, "conflicts_overridden": len(all_conflicts)}


@router.put("/bookings/{booking_id}")
async def update_booking(booking_id: str, data: BookingUpdate, current_user: dict = Depends(get_current_user)):
    await require_permission(current_user, "rentals")
    query = {"id": booking_id}
    effective_branch = resolve_branch_filter(current_user, None)
    if effective_branch:
        query["branch_id"] = effective_branch
    existing = await db.rental_bookings.find_one(query)
    if not existing:
        raise HTTPException(status_code=404, detail="الحجز غير موجود")
    if existing.get("payment_status") == "paid" and (
        data.hourly_rate is not None or data.duration_hours is not None
        or data.persons_count is not None or data.person_rate is not None
    ):
        raise HTTPException(status_code=400, detail="لا يمكن تعديل مبلغ حجز مدفوع؛ احذف الدفعة أولاً")

    update_data = {k: v for k, v in data.dict().items() if v is not None}
    if "status" in update_data and update_data["status"] not in ("booked", "cancelled"):
        raise HTTPException(status_code=400, detail="حالة غير صالحة")
    if "date" in update_data:
        try:
            update_data["weekday"] = _weekday_of(update_data["date"])
        except ValueError:
            raise HTTPException(status_code=400, detail="صيغة تاريخ غير صالحة")
    if "start_hour" in update_data and not (0 <= update_data["start_hour"] <= 23):
        raise HTTPException(status_code=400, detail="ساعة البداية غير صالحة")

    new_rate = update_data.get("hourly_rate", existing.get("hourly_rate", 0))
    new_dur = update_data.get("duration_hours", existing.get("duration_hours", 1))
    new_persons = int(update_data.get("persons_count", existing.get("persons_count", 0)) or 0)
    new_person_rate = float(update_data.get("person_rate", existing.get("person_rate", 0)) or 0)
    if new_dur <= 0 or new_dur > 12 or new_rate < 0 or new_persons < 0 or new_person_rate < 0:
        raise HTTPException(status_code=400, detail="قيم غير صالحة")
    if _booking_total(new_rate, new_dur, new_persons, new_person_rate) <= 0:
        raise HTTPException(status_code=400, detail="يجب إدخال سعر الساعة أو سعر الفرد وعدد الأفراد")

    # Re-run conflict detection when scheduling fields change or a cancelled
    # booking is reactivated (self-excluded)
    schedule_changed = any(k in update_data for k in ("date", "start_hour", "duration_hours"))
    new_status = update_data.get("status", existing.get("status", "booked"))
    reactivating = update_data.get("status") == "booked" and existing.get("status") == "cancelled"
    if (schedule_changed or reactivating) and new_status != "cancelled":
        new_date = update_data.get("date", existing.get("date"))
        new_hour = update_data.get("start_hour", existing.get("start_hour", 0))
        conflicts = await _find_conflicts(
            existing.get("branch_id", ""), new_date, new_hour, new_dur,
            exclude_booking_id=booking_id,
        )
        if conflicts:
            raise HTTPException(status_code=409, detail={"message": "توجد تعارضات في المواعيد", "conflicts": conflicts[:30]})

    update_data["total_amount"] = _booking_total(new_rate, new_dur, new_persons, new_person_rate)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.rental_bookings.update_one({"id": booking_id}, {"$set": update_data})
    updated = await db.rental_bookings.find_one({"id": booking_id}, {"_id": 0})
    return updated


@router.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, current_user: dict = Depends(get_current_user)):
    await require_permission(current_user, "rentals")
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية الأدمن مطلوبة للحذف؛ يمكنك إلغاء الحجز بدلاً من ذلك")
    existing = await db.rental_bookings.find_one({"id": booking_id})
    if not existing:
        raise HTTPException(status_code=404, detail="الحجز غير موجود")
    if existing.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="لا يمكن حذف حجز مدفوع؛ احذف الدفعة أولاً")
    await db.rental_bookings.delete_one({"id": booking_id})
    return {"message": "تم الحذف"}


@router.get("/bookings/check-conflicts")
async def check_conflicts_endpoint(
    date: str,
    start_hour: int,
    duration_hours: float = 1,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    await require_permission(current_user, "rentals")
    branch_id = _effective_branch_for_create(current_user, branch_filter)
    conflicts = await _find_conflicts(branch_id, date, start_hour, duration_hours)
    return {"conflicts": conflicts}


# ============ PAYMENTS ============

@router.get("/payments")
async def list_payments(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    coach_id: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    await require_permission(current_user, "rentals")
    query = {}
    if start_date and end_date:
        query["payment_date"] = {"$gte": start_date, "$lte": end_date}
    elif start_date:
        query["payment_date"] = {"$gte": start_date}
    elif end_date:
        query["payment_date"] = {"$lte": end_date}
    if coach_id:
        query["coach_id"] = coach_id
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch
    payments = await db.rental_payments.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return payments


@router.post("/payments")
async def create_payment(data: PaymentCreate, current_user: dict = Depends(get_current_user)):
    await require_permission(current_user, "rentals")
    if data.payment_method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="طريقة دفع غير صالحة")
    if not data.booking_ids:
        raise HTTPException(status_code=400, detail="اختر حجزاً واحداً على الأقل")
    try:
        datetime.strptime(data.payment_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="صيغة تاريخ غير صالحة")

    bq = {"id": {"$in": data.booking_ids}, "coach_id": data.coach_id}
    effective_branch = resolve_branch_filter(current_user, None)
    if effective_branch:
        bq["branch_id"] = effective_branch
    bookings = await db.rental_bookings.find(bq, {"_id": 0}).to_list(500)
    if len(bookings) != len(set(data.booking_ids)):
        raise HTTPException(status_code=400, detail="بعض الحجوزات غير موجودة أو لا تخص هذا المدرب")
    already_paid = [b for b in bookings if b.get("payment_status") == "paid"]
    if already_paid:
        raise HTTPException(status_code=400, detail="بعض الحجوزات مدفوعة بالفعل")
    cancelled = [b for b in bookings if b.get("status") == "cancelled"]
    if cancelled:
        raise HTTPException(status_code=400, detail="لا يمكن تحصيل حجوزات ملغاة")

    branch_ids = {b.get("branch_id", "") for b in bookings}
    if len(branch_ids) > 1:
        raise HTTPException(status_code=400, detail="الحجوزات المختارة من فروع مختلفة")
    pay_branch = branch_ids.pop() if branch_ids else current_user.get("branch_id", "")

    coach = await db.rental_coaches.find_one({"id": data.coach_id}, {"_id": 0})
    amount = round(sum(b.get("total_amount", 0) for b in bookings), 2)
    total_hours = sum(b.get("duration_hours", 1) for b in bookings)
    now = datetime.now(timezone.utc).isoformat()
    receipt_number = await _generate_receipt_number()

    payment = {
        "id": str(uuid.uuid4()),
        "receipt_number": receipt_number,
        "coach_id": data.coach_id,
        "coach_name": (coach or {}).get("name", bookings[0].get("coach_name", "")),
        "coach_phone": (coach or {}).get("phone", ""),
        "booking_ids": data.booking_ids,
        "bookings_count": len(bookings),
        "total_hours": total_hours,
        "amount": amount,
        "payment_method": data.payment_method,
        "payment_method_ar": PAYMENT_METHODS[data.payment_method],
        "payment_date": data.payment_date,
        "notes": data.notes or "",
        "branch_id": pay_branch,
        "created_by": current_user.get("name", current_user.get("username", "")),
        "created_at": now,
    }
    await db.rental_payments.insert_one(payment)
    await db.rental_bookings.update_many(
        {"id": {"$in": data.booking_ids}},
        {"$set": {"payment_status": "paid", "payment_id": payment["id"], "updated_at": now}},
    )
    payment.pop("_id", None)
    return payment


@router.delete("/payments/{payment_id}")
async def delete_payment(payment_id: str, current_user: dict = Depends(get_current_user)):
    await require_permission(current_user, "rentals")
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="صلاحية الأدمن مطلوبة لحذف الدفعات")
    payment = await db.rental_payments.find_one({"id": payment_id})
    if not payment:
        raise HTTPException(status_code=404, detail="الدفعة غير موجودة")
    now = datetime.now(timezone.utc).isoformat()
    await db.rental_bookings.update_many(
        {"id": {"$in": payment.get("booking_ids", [])}},
        {"$set": {"payment_status": "unpaid", "payment_id": None, "updated_at": now}},
    )
    await db.rental_payments.delete_one({"id": payment_id})
    return {"message": "تم حذف الدفعة وإرجاع الحجوزات لغير مدفوعة"}


# ============ REPORT ============

@router.get("/report")
async def rentals_report(
    month: str,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    await require_permission(current_user, "rentals")
    try:
        datetime.strptime(month + "-01", "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="صيغة الشهر غير صالحة (YYYY-MM)")
    import calendar as _cal
    year, m = int(month[:4]), int(month[5:7])
    _, days_in_month = _cal.monthrange(year, m)
    month_start, month_end = f"{month}-01", f"{month}-{days_in_month:02d}"

    bq = {"date": {"$gte": month_start, "$lte": month_end}, "status": {"$ne": "cancelled"}}
    pq = {"payment_date": {"$gte": month_start, "$lte": month_end}}
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        bq["branch_id"] = effective_branch
        pq["branch_id"] = effective_branch

    bookings = await db.rental_bookings.find(bq, {"_id": 0}).to_list(5000)
    payments = await db.rental_payments.find(pq, {"_id": 0}).to_list(2000)

    total_booked = round(sum(b.get("total_amount", 0) for b in bookings), 2)
    total_hours = sum(b.get("duration_hours", 1) for b in bookings)
    total_unpaid = round(sum(b.get("total_amount", 0) for b in bookings if b.get("payment_status") == "unpaid"), 2)
    total_collected = round(sum(p.get("amount", 0) for p in payments), 2)

    by_coach = {}
    for b in bookings:
        cid = b.get("coach_id", "")
        if cid not in by_coach:
            by_coach[cid] = {"coach_id": cid, "coach_name": b.get("coach_name", ""), "hours": 0, "amount": 0, "unpaid": 0, "bookings": 0}
        by_coach[cid]["hours"] += b.get("duration_hours", 1)
        by_coach[cid]["amount"] += b.get("total_amount", 0)
        by_coach[cid]["bookings"] += 1
        if b.get("payment_status") == "unpaid":
            by_coach[cid]["unpaid"] += b.get("total_amount", 0)

    by_hour = {}
    for b in bookings:
        h = b.get("start_hour", 0)
        by_hour[h] = by_hour.get(h, 0) + 1

    return {
        "month": month,
        "total_booked": total_booked,
        "total_hours": total_hours,
        "total_collected": total_collected,
        "total_unpaid": total_unpaid,
        "bookings_count": len(bookings),
        "payments_count": len(payments),
        "by_coach": sorted(by_coach.values(), key=lambda x: -x["amount"]),
        "by_hour": [{"hour": h, "count": c} for h, c in sorted(by_hour.items())],
    }
