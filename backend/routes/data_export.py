"""Per-tenant data export (admin-only) and final delete (super-admin).

Provides:
  * ``GET /api/tenant/export-data`` — admin downloads a ZIP of every
    collection in their academy DB as JSON (one file per collection).
  * Super-admin endpoints to schedule and force a permanent tenant delete
    behind a 7-day grace period are in ``routes/super_admin.py``.
"""
from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from database import db
from utils.auth import get_current_user_from_token
from utils.audit import log_audit

router = APIRouter(prefix="/tenant", tags=["tenant-data"])


# Collections to dump. Kept in sync with server._ALL_COLLECTIONS but
# duplicated here so this router has no startup-order dependency.
_COLLECTIONS = [
    "accounts", "activities", "activity_notes", "advertisements",
    "attendance", "audit_logs", "bank_reports", "branches", "closures",
    "coach_attendance", "coaches", "coach_ratings", "counters",
    "credit_notes", "daily_videos", "dashboard_settings", "discounts",
    "expenses", "extension_logs", "internal_expense_payments",
    "internal_expenses", "invoices", "journal_entries", "levels",
    "level_subscriptions", "loyalty_rewards", "loyalty_settings",
    "member_freezes", "member_notifications", "member_points", "members",
    "messages", "notifications", "notifications_settings",
    "payment_transactions", "payment_vouchers", "points_history",
    "product_invoices", "products", "purchase_invoices", "push_subscriptions",
    "redemption_requests", "registration_forms", "supplier_payments",
    "suppliers", "users", "video_views", "whatsapp_settings",
    "whatsapp_send_log",
]


@router.get("/export-data")
async def export_tenant_data(current_user: dict = Depends(get_current_user_from_token)):
    """Stream a ZIP of every collection as JSON. Admin-only."""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    buf = io.BytesIO()
    summary: dict = {"exported_at": datetime.now(timezone.utc).isoformat(), "collections": {}}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for col_name in _COLLECTIONS:
            try:
                docs = await db[col_name].find({}, {"_id": 0}).to_list(200000)
            except Exception:
                docs = []
            if not docs:
                summary["collections"][col_name] = 0
                continue
            # Strip password fields before export.
            if col_name == "users":
                docs = [{k: v for k, v in d.items() if k != "password"} for d in docs]
            zf.writestr(f"{col_name}.json", json.dumps(docs, ensure_ascii=False, default=str, indent=2))
            summary["collections"][col_name] = len(docs)
        zf.writestr("_summary.json", json.dumps(summary, ensure_ascii=False, indent=2))

    buf.seek(0)
    fname = f"academy_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"

    await log_audit(
        actor=current_user,
        action="tenant.data.export",
        entity_type="tenant",
        entity_name=fname,
        extra={"collection_counts": summary["collections"]},
    )

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )
