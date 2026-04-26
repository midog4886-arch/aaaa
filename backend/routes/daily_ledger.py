"""Daily Financial Ledger routes"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta

from .common import db, get_current_user
from utils.auth import require_branch_scope, resolve_branch_filter

router = APIRouter(prefix="/daily-ledger", tags=["daily-ledger"])

EXPENSE_CATEGORIES = [
    "rent", "salaries", "maintenance", "purchases",
    "utilities", "marketing", "equipment", "transportation", "other"
]

CATEGORY_LABELS_AR = {
    "rent": "إيجار",
    "salaries": "رواتب",
    "maintenance": "صيانة",
    "purchases": "مشتريات",
    "utilities": "خدمات (كهرباء/ماء)",
    "marketing": "تسويق",
    "equipment": "معدات",
    "transportation": "نقل ومواصلات",
    "other": "أخرى"
}

class ExpenseCreate(BaseModel):
    date: str
    amount: float
    category: str
    description: str
    notes: Optional[str] = ""

class ExpenseUpdate(BaseModel):
    amount: Optional[float] = None
    category: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None

@router.get("/summary")
async def get_daily_summary(
    date: str,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    date_start = date + "T00:00:00"
    date_end = date + "T23:59:59"

    inv_query = {"status": "paid", "paid_at": {"$gte": date_start, "$lte": date_end}}
    cn_query = {"created_at": {"$gte": date_start, "$lte": date_end}}
    exp_query = {"date": date}

    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        inv_query["branch_id"] = effective_branch
        cn_query["branch_id"] = effective_branch
        exp_query["branch_id"] = effective_branch

    invoices = await db.invoices.find(inv_query, {"_id": 0}).to_list(10000)
    credit_notes = await db.credit_notes.find(cn_query, {"_id": 0}).to_list(10000)
    expenses = await db.expenses.find(exp_query, {"_id": 0}).to_list(10000)

    total_income = sum(inv.get("total", 0) for inv in invoices)
    total_refunds = sum(cn.get("refund_amount", 0) for cn in credit_notes)
    total_expenses = sum(exp.get("amount", 0) for exp in expenses)
    net_profit = total_income - total_refunds - total_expenses

    transactions = []
    for inv in invoices:
        transactions.append({
            "type": "invoice",
            "id": inv.get("id", ""),
            "number": inv.get("invoice_number", ""),
            "description": inv.get("customer_name_ar", inv.get("member_name", "")),
            "amount": inv.get("total", 0),
            "payment_method": inv.get("payment_method", ""),
            "time": inv.get("paid_at", inv.get("created_at", "")),
            "items": inv.get("items", [])
        })
    for cn in credit_notes:
        transactions.append({
            "type": "refund",
            "id": cn.get("id", ""),
            "number": cn.get("credit_note_number", ""),
            "description": cn.get("customer_name_ar", ""),
            "amount": cn.get("refund_amount", 0),
            "reason": cn.get("reason", ""),
            "time": cn.get("created_at", "")
        })
    for exp in expenses:
        transactions.append({
            "type": "expense",
            "id": exp.get("id", ""),
            "description": exp.get("description", ""),
            "amount": exp.get("amount", 0),
            "category": exp.get("category", ""),
            "category_ar": CATEGORY_LABELS_AR.get(exp.get("category", ""), exp.get("category", "")),
            "notes": exp.get("notes", ""),
            "time": exp.get("created_at", "")
        })

    transactions.sort(key=lambda x: x.get("time", ""), reverse=True)

    expenses_by_category = {}
    for exp in expenses:
        cat = exp.get("category", "other")
        if cat not in expenses_by_category:
            expenses_by_category[cat] = {"category": cat, "label_ar": CATEGORY_LABELS_AR.get(cat, cat), "total": 0, "count": 0}
        expenses_by_category[cat]["total"] += exp.get("amount", 0)
        expenses_by_category[cat]["count"] += 1

    income_by_method = {}
    for inv in invoices:
        method = inv.get("payment_method", "cash")
        if method not in income_by_method:
            income_by_method[method] = 0
        income_by_method[method] += inv.get("total", 0)

    return {
        "date": date,
        "total_income": total_income,
        "total_refunds": total_refunds,
        "total_expenses": total_expenses,
        "net_profit": net_profit,
        "invoice_count": len(invoices),
        "refund_count": len(credit_notes),
        "expense_count": len(expenses),
        "transactions": transactions,
        "expenses_by_category": list(expenses_by_category.values()),
        "income_by_method": income_by_method
    }

@router.get("/comparison")
async def get_daily_comparison(
    date: str,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    from datetime import date as date_type
    target = datetime.strptime(date, "%Y-%m-%d")
    yesterday = (target - timedelta(days=1)).strftime("%Y-%m-%d")
    last_week = (target - timedelta(days=7)).strftime("%Y-%m-%d")

    # Resolve branch once outside the inner helper (also fail-closes early)
    effective_branch = resolve_branch_filter(current_user, branch_filter)

    async def get_day_totals(d):
        d_start = d + "T00:00:00"
        d_end = d + "T23:59:59"

        inv_q = {"status": "paid", "paid_at": {"$gte": d_start, "$lte": d_end}}
        cn_q = {"created_at": {"$gte": d_start, "$lte": d_end}}
        exp_q = {"date": d}

        if effective_branch:
            inv_q["branch_id"] = effective_branch
            cn_q["branch_id"] = effective_branch
            exp_q["branch_id"] = effective_branch

        invs = await db.invoices.find(inv_q, {"total": 1, "_id": 0}).to_list(10000)
        cns = await db.credit_notes.find(cn_q, {"refund_amount": 1, "_id": 0}).to_list(10000)
        exps = await db.expenses.find(exp_q, {"amount": 1, "_id": 0}).to_list(10000)

        income = sum(i.get("total", 0) for i in invs)
        refunds = sum(c.get("refund_amount", 0) for c in cns)
        expenses = sum(e.get("amount", 0) for e in exps)
        return {"date": d, "income": income, "refunds": refunds, "expenses": expenses, "net": income - refunds - expenses}

    today_data = await get_day_totals(date)
    yesterday_data = await get_day_totals(yesterday)
    last_week_data = await get_day_totals(last_week)

    return {
        "today": today_data,
        "yesterday": yesterday_data,
        "last_week": last_week_data
    }

@router.get("/calendar")
async def get_monthly_calendar(
    month: str,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    year, m = month.split("-")
    year, m = int(year), int(m)
    import calendar
    _, days_in_month = calendar.monthrange(year, m)

    month_start = f"{month}-01T00:00:00"
    month_end = f"{month}-{days_in_month:02d}T23:59:59"

    inv_q = {"status": "paid", "paid_at": {"$gte": month_start, "$lte": month_end}}
    cn_q = {"created_at": {"$gte": month_start, "$lte": month_end}}
    exp_q = {"date": {"$gte": f"{month}-01", "$lte": f"{month}-{days_in_month:02d}"}}

    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        inv_q["branch_id"] = effective_branch
        cn_q["branch_id"] = effective_branch
        exp_q["branch_id"] = effective_branch

    invoices = await db.invoices.find(inv_q, {"_id": 0, "total": 1, "paid_at": 1}).to_list(50000)
    credit_notes = await db.credit_notes.find(cn_q, {"_id": 0, "refund_amount": 1, "created_at": 1}).to_list(50000)
    expenses = await db.expenses.find(exp_q, {"_id": 0, "amount": 1, "date": 1}).to_list(50000)

    days_data = {}
    for day in range(1, days_in_month + 1):
        d = f"{month}-{day:02d}"
        days_data[d] = {"date": d, "income": 0, "refunds": 0, "expenses": 0, "net": 0, "tx_count": 0}

    for inv in invoices:
        paid_at = inv.get("paid_at", "")
        if paid_at:
            d = paid_at[:10]
            if d in days_data:
                days_data[d]["income"] += inv.get("total", 0)
                days_data[d]["tx_count"] += 1

    for cn in credit_notes:
        created = cn.get("created_at", "")
        if created:
            d = created[:10]
            if d in days_data:
                days_data[d]["refunds"] += cn.get("refund_amount", 0)
                days_data[d]["tx_count"] += 1

    for exp in expenses:
        d = exp.get("date", "")
        if d in days_data:
            days_data[d]["expenses"] += exp.get("amount", 0)
            days_data[d]["tx_count"] += 1

    for d in days_data:
        days_data[d]["net"] = days_data[d]["income"] - days_data[d]["refunds"] - days_data[d]["expenses"]

    total_income = sum(dd["income"] for dd in days_data.values())
    total_expenses = sum(dd["expenses"] for dd in days_data.values())
    total_refunds = sum(dd["refunds"] for dd in days_data.values())

    return {
        "month": month,
        "days": list(days_data.values()),
        "totals": {
            "income": total_income,
            "expenses": total_expenses,
            "refunds": total_refunds,
            "net": total_income - total_refunds - total_expenses
        }
    }

@router.get("/expenses")
async def list_expenses(
    date: Optional[str] = None,
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if date:
        query["date"] = date
    if category:
        query["category"] = category
    if start_date and end_date:
        query["date"] = {"$gte": start_date, "$lte": end_date}
    elif start_date:
        query["date"] = {"$gte": start_date}
    elif end_date:
        query["date"] = {"$lte": end_date}

    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch

    expenses = await db.expenses.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    return expenses

@router.post("/expenses")
async def create_expense(
    expense: ExpenseCreate,
    current_user: dict = Depends(get_current_user)
):
    if expense.category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category. Must be one of: {', '.join(EXPENSE_CATEGORIES)}")
    if expense.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    # Fail-closed: non-admins must have a branch (otherwise the expense would
    # be created with branch_id="" and visible to all branch-less users).
    require_branch_scope(current_user)

    new_expense = {
        "id": str(uuid.uuid4()),
        "date": expense.date,
        "amount": expense.amount,
        "category": expense.category,
        "category_ar": CATEGORY_LABELS_AR.get(expense.category, expense.category),
        "description": expense.description,
        "notes": expense.notes or "",
        "branch_id": current_user.get("branch_id", ""),
        "created_by": current_user.get("username", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    await db.expenses.insert_one(new_expense)
    new_expense.pop("_id", None)
    return new_expense

@router.put("/expenses/{expense_id}")
async def update_expense(
    expense_id: str,
    update: ExpenseUpdate,
    current_user: dict = Depends(get_current_user)
):
    existing = await db.expenses.find_one({"id": expense_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")

    update_data = {k: v for k, v in update.dict().items() if v is not None}
    if "category" in update_data:
        if update_data["category"] not in EXPENSE_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category")
        update_data["category_ar"] = CATEGORY_LABELS_AR.get(update_data["category"], update_data["category"])

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.expenses.update_one({"id": expense_id}, {"$set": update_data})
    updated = await db.expenses.find_one({"id": expense_id}, {"_id": 0})
    return updated

@router.delete("/expenses/{expense_id}")
async def delete_expense(
    expense_id: str,
    current_user: dict = Depends(get_current_user)
):
    result = await db.expenses.delete_one({"id": expense_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"message": "Expense deleted successfully"}

@router.get("/categories")
async def get_expense_categories(current_user: dict = Depends(get_current_user)):
    return [{"value": cat, "label_ar": CATEGORY_LABELS_AR[cat], "label_en": cat.replace("_", " ").title()} for cat in EXPENSE_CATEGORIES]
