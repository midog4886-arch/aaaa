"""Public contact form submissions.

Saves visitor enquiries from the marketing landing page into
``control_db.contact_submissions`` so the super-admin can review them.
Phase 2 will route these to the email provider once one is configured.
"""
import re
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, Field, EmailStr

from control_db import control_db
from routes.super_admin import _require_super

router = APIRouter(prefix="/public", tags=["contact"])
logger = logging.getLogger("contact")

_HITS: dict = {}
_WINDOW_SEC = 3600
_MAX_PER_IP = 8


def _check_rate(ip: str) -> bool:
    now_ts = datetime.now(timezone.utc).timestamp()
    bucket = [t for t in _HITS.get(ip, []) if now_ts - t < _WINDOW_SEC]
    if len(bucket) >= _MAX_PER_IP:
        _HITS[ip] = bucket
        return False
    bucket.append(now_ts)
    _HITS[ip] = bucket
    if len(_HITS) > 5000:
        for k in list(_HITS.keys())[:1000]:
            _HITS.pop(k, None)
    return True


class ContactIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    phone: Optional[str] = ""
    academy_name: Optional[str] = ""
    subject: Optional[str] = "general"
    message: str = Field(..., min_length=5, max_length=4000)


@router.post("/contact")
async def submit_contact(payload: ContactIn, request: Request):
    ip = (request.client.host if request.client else "unknown") or "unknown"
    if not _check_rate(ip):
        raise HTTPException(status_code=429, detail="عدد كبير من المحاولات، حاول لاحقاً")

    subject = (payload.subject or "general").lower()[:40]
    if not re.match(r"^[a-z0-9_-]{2,40}$", subject):
        subject = "general"

    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "email": str(payload.email).lower(),
        "phone": (payload.phone or "").strip(),
        "academy_name": (payload.academy_name or "").strip(),
        "subject": subject,
        "message": payload.message.strip(),
        "status": "new",
        "ip": ip,
        "user_agent": request.headers.get("user-agent", "")[:300],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await control_db.contact_submissions.insert_one(doc)
    except Exception:
        logger.exception("contact insert failed")
        raise HTTPException(status_code=500, detail="تعذر إرسال الرسالة، حاول مجدداً")
    return {"ok": True}


super_router = APIRouter(prefix="/super/contact", tags=["super-contact"])


@super_router.get("")
async def list_submissions(_=Depends(_require_super)):
    cursor = control_db.contact_submissions.find({}, {"_id": 0}).sort("created_at", -1).limit(500)
    items: List[dict] = []
    async for doc in cursor:
        items.append(doc)
    return {"items": items}


@super_router.patch("/{submission_id}")
async def update_submission(submission_id: str, body: dict, _=Depends(_require_super)):
    status = (body or {}).get("status", "").lower()
    if status not in {"new", "read", "resolved", "spam"}:
        raise HTTPException(status_code=400, detail="حالة غير صالحة")
    res = await control_db.contact_submissions.update_one(
        {"id": submission_id},
        {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    return {"ok": True}
