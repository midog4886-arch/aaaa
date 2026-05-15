"""Provider-agnostic transactional email sender for the control plane.

Supports two providers:
  - ``resend``    → POST https://api.resend.com/emails
  - ``sendgrid``  → POST https://api.sendgrid.com/v3/mail/send

Configuration:
  Provider selection + ``from_email``/``from_name`` are stored in
  ``control_db.platform_settings`` (key=``email``) so super-admins can edit
  them from the UI. The actual API key is read from environment secrets:
    - RESEND_API_KEY
    - SENDGRID_API_KEY
  This keeps the secret out of MongoDB.

Every send (success or failure) is appended to ``control_db.email_log`` so
super-admins can audit recent emails. The collection is capped to a sliding
window of the last 1000 entries (best-effort trim after each insert).

Triggers (welcome, trial_ending, payment_success, payment_failed, suspended,
cancelled) live in their respective routes/control_db functions and call
``send_email(...)`` from here.

If no provider is configured, ``send_email`` short-circuits and logs the
attempt with status=``skipped`` so triggers stay safe in dev environments.
"""
import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, Dict

import httpx

from control_db import control_db
from utils.email_templates import render

logger = logging.getLogger("email_service")

EMAIL_LOG_MAX = 1000
DEFAULT_FROM_EMAIL = "no-reply@champions-academy.app"
DEFAULT_FROM_NAME = "Champions Academy"


async def get_email_settings() -> Dict:
    doc = await control_db.platform_settings.find_one({"key": "email"}, {"_id": 0}) or {}
    provider = (doc.get("provider") or "").lower()
    if provider not in {"resend", "sendgrid", ""}:
        provider = ""
    has_key = False
    if provider == "resend":
        has_key = bool(os.environ.get("RESEND_API_KEY"))
    elif provider == "sendgrid":
        has_key = bool(os.environ.get("SENDGRID_API_KEY"))
    return {
        "provider": provider,
        "from_email": doc.get("from_email") or DEFAULT_FROM_EMAIL,
        "from_name": doc.get("from_name") or DEFAULT_FROM_NAME,
        "enabled": bool(doc.get("enabled", True)),
        "has_api_key": has_key,
        "updated_at": doc.get("updated_at"),
    }


async def update_email_settings(provider: str, from_email: str, from_name: str, enabled: bool) -> Dict:
    provider = (provider or "").lower()
    if provider not in {"resend", "sendgrid", ""}:
        raise ValueError("provider must be 'resend', 'sendgrid', or '' (disabled)")
    now_iso = datetime.now(timezone.utc).isoformat()
    await control_db.platform_settings.update_one(
        {"key": "email"},
        {"$set": {
            "key": "email",
            "provider": provider,
            "from_email": (from_email or "").strip() or DEFAULT_FROM_EMAIL,
            "from_name": (from_name or "").strip() or DEFAULT_FROM_NAME,
            "enabled": bool(enabled),
            "updated_at": now_iso,
        }},
        upsert=True,
    )
    return await get_email_settings()


async def _log_send(
    *,
    kind: str,
    to: str,
    tenant_slug: Optional[str],
    subject: str,
    status: str,
    provider: str,
    error: str = "",
    provider_id: str = "",
) -> None:
    try:
        await control_db.email_log.insert_one({
            "id": str(uuid.uuid4()),
            "kind": kind,
            "to": to,
            "tenant_slug": tenant_slug or "",
            "subject": subject,
            "status": status,
            "provider": provider,
            "provider_id": provider_id,
            "error": error[:500] if error else "",
            "sent_at": datetime.now(timezone.utc).isoformat(),
        })
        # Best-effort cap: trim oldest beyond EMAIL_LOG_MAX.
        count = await control_db.email_log.count_documents({})
        if count > EMAIL_LOG_MAX + 200:
            cutoff_doc = await control_db.email_log.find(
                {}, {"sent_at": 1, "_id": 0}
            ).sort("sent_at", -1).skip(EMAIL_LOG_MAX).limit(1).to_list(1)
            if cutoff_doc:
                cutoff = cutoff_doc[0].get("sent_at")
                if cutoff:
                    await control_db.email_log.delete_many({"sent_at": {"$lt": cutoff}})
    except Exception:
        logger.exception("failed to write email_log row")


async def _post_resend(api_key: str, payload: Dict) -> Dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        r.raise_for_status()
        return r.json() if r.content else {}


async def _post_sendgrid(api_key: str, payload: Dict) -> Dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.sendgrid.com/v3/mail/send",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        r.raise_for_status()
        # SendGrid returns 202 with empty body + X-Message-Id header.
        return {"id": r.headers.get("X-Message-Id", "")}


async def send_email(
    *,
    kind: str,
    to: str,
    ctx: Dict,
    tenant_slug: Optional[str] = None,
) -> Dict:
    """Render ``kind`` with ``ctx`` and send to ``to``. Always logs the result.

    Returns ``{"status": "sent"|"skipped"|"failed", "id": "...", "error": "..."}``.
    Never raises — triggers should be fire-and-forget.
    """
    if not to or "@" not in (to or ""):
        await _log_send(kind=kind, to=to or "", tenant_slug=tenant_slug,
                        subject="", status="skipped", provider="", error="missing recipient")
        return {"status": "skipped", "error": "missing recipient"}

    try:
        subject, html, text = render(kind, ctx or {})
    except Exception as e:
        await _log_send(kind=kind, to=to, tenant_slug=tenant_slug,
                        subject="", status="failed", provider="", error=f"template error: {e}")
        return {"status": "failed", "error": str(e)}

    settings = await get_email_settings()
    provider = settings.get("provider") or ""
    if not settings.get("enabled") or not provider:
        await _log_send(kind=kind, to=to, tenant_slug=tenant_slug,
                        subject=subject, status="skipped", provider=provider,
                        error="provider not configured")
        return {"status": "skipped", "error": "provider not configured"}

    from_email = settings.get("from_email") or DEFAULT_FROM_EMAIL
    from_name = settings.get("from_name") or DEFAULT_FROM_NAME
    from_header = f"{from_name} <{from_email}>"

    try:
        if provider == "resend":
            api_key = os.environ.get("RESEND_API_KEY", "")
            if not api_key:
                raise RuntimeError("RESEND_API_KEY env secret is missing")
            payload = {
                "from": from_header,
                "to": [to],
                "subject": subject,
                "html": html,
                "text": text,
            }
            res = await _post_resend(api_key, payload)
            provider_id = (res or {}).get("id", "")
        elif provider == "sendgrid":
            api_key = os.environ.get("SENDGRID_API_KEY", "")
            if not api_key:
                raise RuntimeError("SENDGRID_API_KEY env secret is missing")
            payload = {
                "personalizations": [{"to": [{"email": to}]}],
                "from": {"email": from_email, "name": from_name},
                "subject": subject,
                "content": [
                    {"type": "text/plain", "value": text},
                    {"type": "text/html", "value": html},
                ],
            }
            res = await _post_sendgrid(api_key, payload)
            provider_id = (res or {}).get("id", "")
        else:
            raise RuntimeError(f"unsupported provider: {provider}")
    except httpx.HTTPStatusError as e:
        body = ""
        try:
            body = e.response.text[:300]
        except Exception:
            pass
        err = f"HTTP {e.response.status_code}: {body}"
        await _log_send(kind=kind, to=to, tenant_slug=tenant_slug, subject=subject,
                        status="failed", provider=provider, error=err)
        return {"status": "failed", "error": err}
    except Exception as e:
        await _log_send(kind=kind, to=to, tenant_slug=tenant_slug, subject=subject,
                        status="failed", provider=provider, error=str(e))
        return {"status": "failed", "error": str(e)}

    await _log_send(kind=kind, to=to, tenant_slug=tenant_slug, subject=subject,
                    status="sent", provider=provider, provider_id=provider_id)
    return {"status": "sent", "id": provider_id}


async def list_email_log(limit: int = 100, kind: str = "", status: str = "", tenant_slug: str = "") -> list:
    q: Dict = {}
    if kind:
        q["kind"] = kind
    if status:
        q["status"] = status
    if tenant_slug:
        q["tenant_slug"] = tenant_slug
    limit = max(1, min(int(limit or 100), 500))
    rows = await control_db.email_log.find(q, {"_id": 0}).sort("sent_at", -1).to_list(limit)
    return rows
