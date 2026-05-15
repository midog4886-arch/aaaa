"""Audit log admin routes — list, filter, export CSV."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from database import db
from utils.auth import get_current_user_from_token, get_current_user

router = APIRouter(prefix="/audit", tags=["audit"])


def _require_admin(user: dict):
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")


def _build_query(
    actor: Optional[str],
    action: Optional[str],
    entity_type: Optional[str],
    date_from: Optional[str],
    date_to: Optional[str],
    search: Optional[str],
) -> dict:
    # Each filter contributes a clause to ``$and`` so they compose with proper
    # AND semantics. Sub-clauses that themselves need OR (actor name vs id,
    # search across multiple fields) live as ``$or`` *inside* the and-clause.
    clauses: list = []
    if actor:
        clauses.append({"$or": [
            {"actor_id": actor},
            {"actor_username": {"$regex": actor, "$options": "i"}},
        ]})
    if action:
        clauses.append({"action": {"$regex": f"^{action}", "$options": "i"}})
    if entity_type:
        clauses.append({"entity_type": entity_type})
    if date_from or date_to:
        rng: dict = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to if "T" in date_to else f"{date_to}T23:59:59"
        clauses.append({"created_at": rng})
    if search:
        clauses.append({"$or": [
            {"entity_name": {"$regex": search, "$options": "i"}},
            {"entity_id": search},
        ]})
    if not clauses:
        return {}
    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}


@router.get("")
async def list_audit_logs(
    actor: Optional[str] = None,
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)
    q = _build_query(actor, action, entity_type, date_from, date_to, search)
    total = await db.audit_logs.count_documents(q)
    cursor = db.audit_logs.find(q, {"_id": 0}).sort("created_at", -1).skip(offset).limit(limit)
    items = await cursor.to_list(limit)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/actions")
async def list_known_actions(current_user: dict = Depends(get_current_user)):
    """Return the distinct ``action`` values for the filter dropdown."""
    _require_admin(current_user)
    try:
        actions = await db.audit_logs.distinct("action")
    except Exception:
        actions = []
    actions = sorted([a for a in actions if a])
    return {"actions": actions}


@router.get("/export")
async def export_audit_logs(
    actor: Optional[str] = None,
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    token: Optional[str] = None,
    current_user: dict = Depends(get_current_user_from_token),
):
    _require_admin(current_user)
    q = _build_query(actor, action, entity_type, date_from, date_to, search)
    rows = await db.audit_logs.find(q, {"_id": 0}).sort("created_at", -1).limit(10000).to_list(10000)

    buf = io.StringIO()
    buf.write("\ufeff")  # BOM for Excel UTF-8
    writer = csv.writer(buf)
    writer.writerow([
        "created_at", "action", "actor_username", "actor_is_admin",
        "entity_type", "entity_id", "entity_name", "branch_id", "diff",
    ])
    for r in rows:
        writer.writerow([
            r.get("created_at", ""),
            r.get("action", ""),
            r.get("actor_username", ""),
            "1" if r.get("actor_is_admin") else "0",
            r.get("entity_type", ""),
            r.get("entity_id", ""),
            r.get("entity_name", ""),
            r.get("branch_id", ""),
            json.dumps(r.get("diff") or {}, ensure_ascii=False),
        ])
    buf.seek(0)
    fname = f"audit_log_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )
