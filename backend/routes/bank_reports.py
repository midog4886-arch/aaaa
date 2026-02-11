"""
Bank Reports API - Monthly bank account reports
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
from bson import ObjectId

router = APIRouter(prefix="/bank-reports", tags=["Bank Reports"])

# Pydantic models
class ExpenseItem(BaseModel):
    description: str
    amount: float

class BankReportCreate(BaseModel):
    month: int  # 1-12
    year: int
    card_total: float = 0
    tabby_total: float = 0
    tamara_total: float = 0
    bnpl_fees: float = 0
    bnpl_net: float = 0
    expenses: List[ExpenseItem] = []
    expenses_total: float = 0
    net_total: float = 0
    branch_id: Optional[str] = None
    notes: Optional[str] = None

class BankReportResponse(BaseModel):
    id: str
    month: int
    year: int
    month_name: str
    card_total: float
    tabby_total: float
    tamara_total: float
    bnpl_fees: float
    bnpl_net: float
    expenses: List[ExpenseItem]
    expenses_total: float
    net_total: float
    branch_id: Optional[str]
    notes: Optional[str]
    created_at: str
    created_by: Optional[str]

# Arabic month names
ARABIC_MONTHS = {
    1: "يناير", 2: "فبراير", 3: "مارس", 4: "أبريل",
    5: "مايو", 6: "يونيو", 7: "يوليو", 8: "أغسطس",
    9: "سبتمبر", 10: "أكتوبر", 11: "نوفمبر", 12: "ديسمبر"
}

def get_db():
    from server import db
    return db

@router.post("")
async def create_bank_report(report: BankReportCreate, db=Depends(get_db)):
    """Create or update a monthly bank report"""
    
    # Check if report already exists for this month/year
    existing = db.bank_reports.find_one({
        "month": report.month,
        "year": report.year,
        "branch_id": report.branch_id
    })
    
    report_data = {
        "month": report.month,
        "year": report.year,
        "month_name": ARABIC_MONTHS.get(report.month, str(report.month)),
        "card_total": report.card_total,
        "tabby_total": report.tabby_total,
        "tamara_total": report.tamara_total,
        "bnpl_fees": report.bnpl_fees,
        "bnpl_net": report.bnpl_net,
        "expenses": [e.dict() for e in report.expenses],
        "expenses_total": report.expenses_total,
        "net_total": report.net_total,
        "branch_id": report.branch_id,
        "notes": report.notes,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    if existing:
        # Update existing report
        db.bank_reports.update_one(
            {"_id": existing["_id"]},
            {"$set": report_data}
        )
        return {"message": "تم تحديث التقرير بنجاح", "id": str(existing["_id"]), "updated": True}
    else:
        # Create new report
        report_data["created_at"] = datetime.now(timezone.utc).isoformat()
        result = db.bank_reports.insert_one(report_data)
        return {"message": "تم حفظ التقرير بنجاح", "id": str(result.inserted_id), "created": True}

@router.get("")
async def get_bank_reports(
    year: Optional[int] = None,
    branch_id: Optional[str] = None,
    db=Depends(get_db)
):
    """Get all bank reports, optionally filtered by year"""
    
    query = {}
    if year:
        query["year"] = year
    if branch_id and branch_id != "all":
        query["branch_id"] = branch_id
    
    reports = list(db.bank_reports.find(query).sort([("year", -1), ("month", -1)]))
    
    result = []
    for r in reports:
        result.append({
            "id": str(r["_id"]),
            "month": r["month"],
            "year": r["year"],
            "month_name": r.get("month_name", ARABIC_MONTHS.get(r["month"], str(r["month"]))),
            "card_total": r.get("card_total", 0),
            "tabby_total": r.get("tabby_total", 0),
            "tamara_total": r.get("tamara_total", 0),
            "bnpl_fees": r.get("bnpl_fees", 0),
            "bnpl_net": r.get("bnpl_net", 0),
            "expenses": r.get("expenses", []),
            "expenses_total": r.get("expenses_total", 0),
            "net_total": r.get("net_total", 0),
            "branch_id": r.get("branch_id"),
            "notes": r.get("notes"),
            "created_at": r.get("created_at", ""),
            "updated_at": r.get("updated_at", "")
        })
    
    return result

@router.get("/{month}/{year}")
async def get_bank_report_by_month(
    month: int,
    year: int,
    branch_id: Optional[str] = None,
    db=Depends(get_db)
):
    """Get bank report for a specific month"""
    
    query = {"month": month, "year": year}
    if branch_id and branch_id != "all":
        query["branch_id"] = branch_id
    
    report = db.bank_reports.find_one(query)
    
    if not report:
        return None
    
    return {
        "id": str(report["_id"]),
        "month": report["month"],
        "year": report["year"],
        "month_name": report.get("month_name", ARABIC_MONTHS.get(report["month"], str(report["month"]))),
        "card_total": report.get("card_total", 0),
        "tabby_total": report.get("tabby_total", 0),
        "tamara_total": report.get("tamara_total", 0),
        "bnpl_fees": report.get("bnpl_fees", 0),
        "bnpl_net": report.get("bnpl_net", 0),
        "expenses": report.get("expenses", []),
        "expenses_total": report.get("expenses_total", 0),
        "net_total": report.get("net_total", 0),
        "branch_id": report.get("branch_id"),
        "notes": report.get("notes"),
        "created_at": report.get("created_at", ""),
        "updated_at": report.get("updated_at", "")
    }

@router.delete("/{report_id}")
async def delete_bank_report(report_id: str, db=Depends(get_db)):
    """Delete a bank report"""
    
    try:
        result = db.bank_reports.delete_one({"_id": ObjectId(report_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="التقرير غير موجود")
        return {"message": "تم حذف التقرير بنجاح"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
