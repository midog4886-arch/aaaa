"""Payment-provider settings + webhook helpers (control plane).

Phase 2 of the billing flow: when a real payment provider (Stripe, Moyasar,
or Tap) is connected, it pushes events to ``POST /api/billing/webhook/{provider}``.
This module owns:

* ``get_payment_settings`` / ``update_payment_settings`` — provider config
  stored in ``control_db.platform_settings`` (key=``payment``). The signing
  secret itself is read from an env var (``PAYMENT_WEBHOOK_SECRET`` by
  default, or the env-var name configured by the super-admin) so it never
  lives in the database.
* ``verify_signature(provider, body_bytes, headers, secret)`` — provider-
  specific HMAC verification (Stripe ``Stripe-Signature``; HMAC-SHA256 of
  the raw body in the ``X-Webhook-Signature`` header for Moyasar / Tap /
  generic providers).
* ``parse_failure_event(provider, payload)`` — returns a normalized dict
  ``{"tenant_id"|"tenant_slug", "reason", "amount", "currency",
  "provider_ref"}`` when the event is a payment failure, otherwise ``None``.
"""
from __future__ import annotations

import hmac
import hashlib
import os
import logging
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple, Iterable

from control_db import control_db

logger = logging.getLogger("payment_service")

VALID_PROVIDERS = {"stripe", "moyasar", "tap", ""}
DEFAULT_SECRET_ENV = "PAYMENT_WEBHOOK_SECRET"
STRIPE_TIMESTAMP_TOLERANCE = 60 * 5  # seconds
# Retain the processed-event fingerprint long enough to cover the longest
# automatic retry window of any supported provider (Stripe retries for up to
# ~3 days). 30 days provides a comfortable safety margin while still keeping
# the collection bounded via a TTL index.
PROCESSED_EVENT_TTL_SECONDS = 60 * 60 * 24 * 30

_processed_events_indexes_ready = False


async def _ensure_processed_events_indexes() -> None:
    """Create the unique + TTL indexes on ``processed_payment_events`` once."""
    global _processed_events_indexes_ready
    if _processed_events_indexes_ready:
        return
    try:
        await control_db.processed_payment_events.create_index(
            [("provider", 1), ("event_id", 1)], unique=True
        )
        await control_db.processed_payment_events.create_index(
            "created_at", expireAfterSeconds=PROCESSED_EVENT_TTL_SECONDS
        )
    except Exception:
        logger.exception("processed_payment_events index creation failed")
    _processed_events_indexes_ready = True


def extract_event_id(provider: str, payload: Dict) -> Optional[str]:
    """Pull the provider-assigned event id out of a webhook payload."""
    if not isinstance(payload, dict):
        return None
    provider = (provider or "").lower()
    eid = payload.get("id")
    if not eid and provider == "moyasar":
        eid = (payload.get("data") or {}).get("id")
    if not eid:
        return None
    eid = str(eid).strip()[:200]
    return eid or None


def _is_duplicate_key_error(e: Exception) -> bool:
    try:
        from pymongo.errors import DuplicateKeyError
        if isinstance(e, DuplicateKeyError):
            return True
    except Exception:
        pass
    return e.__class__.__name__ == "DuplicateKeyError"


async def claim_event(provider: str, event_id: str) -> str:
    """Two-phase dedup: try to claim ``(provider, event_id)`` for processing.

    Returns one of:
      * ``"new"``       — caller is the unique owner; proceed with processing
                          and call :func:`confirm_event` on success or
                          :func:`release_event` on failure so a retry can
                          re-claim.
      * ``"processed"`` — the same event was already fully processed by a
                          previous delivery; caller should short-circuit
                          and respond ``2xx duplicate``.
      * ``"in_flight"`` — another delivery is currently processing the
                          event (or crashed mid-flight without releasing).
                          Caller should also short-circuit so the active /
                          next legitimate retry is the one that completes.

    When ``event_id`` is empty we cannot dedupe and return ``"new"`` so the
    legacy non-dedup behavior is preserved.
    """
    if not event_id:
        return "new"
    await _ensure_processed_events_indexes()
    provider_lc = (provider or "").lower()
    try:
        await control_db.processed_payment_events.insert_one({
            "provider": provider_lc,
            "event_id": event_id,
            "status": "processing",
            "created_at": datetime.now(timezone.utc),
        })
        return "new"
    except Exception as e:
        if not _is_duplicate_key_error(e):
            logger.exception("claim_event unexpected error")
            # Fail open: better to risk one duplicate than to drop a real event.
            return "new"
    # A row already exists — check its state.
    try:
        existing = await control_db.processed_payment_events.find_one(
            {"provider": provider_lc, "event_id": event_id}
        )
    except Exception:
        logger.exception("claim_event lookup failed; treating as duplicate")
        return "in_flight"
    status = ((existing or {}).get("status") or "").lower()
    if status == "processed":
        return "processed"
    return "in_flight"


async def confirm_event(provider: str, event_id: str) -> None:
    """Mark a previously-claimed event as fully processed."""
    if not event_id:
        return
    try:
        await control_db.processed_payment_events.update_one(
            {"provider": (provider or "").lower(), "event_id": event_id},
            {"$set": {
                "status": "processed",
                "processed_at": datetime.now(timezone.utc),
            }},
        )
    except Exception:
        logger.exception("confirm_event update failed for %s/%s", provider, event_id)


async def release_event(provider: str, event_id: str) -> None:
    """Release a claim so a provider retry can re-attempt processing.

    Only releases rows still in the ``processing`` state — never deletes a
    confirmed ``processed`` row (which would silently re-enable double
    processing).
    """
    if not event_id:
        return
    try:
        await control_db.processed_payment_events.delete_one({
            "provider": (provider or "").lower(),
            "event_id": event_id,
            "status": "processing",
        })
    except Exception:
        logger.exception("release_event delete failed for %s/%s", provider, event_id)


async def get_payment_settings() -> Dict:
    doc = await control_db.platform_settings.find_one({"key": "payment"}, {"_id": 0}) or {}
    provider = (doc.get("provider") or "").lower()
    if provider not in VALID_PROVIDERS:
        provider = ""
    secret_env = (doc.get("secret_env") or DEFAULT_SECRET_ENV).strip() or DEFAULT_SECRET_ENV
    has_secret = bool(os.environ.get(secret_env))
    return {
        "provider": provider,
        "enabled": bool(doc.get("enabled", False)),
        "secret_env": secret_env,
        "has_secret": has_secret,
        "updated_at": doc.get("updated_at"),
    }


async def update_payment_settings(provider: str, enabled: bool, secret_env: str) -> Dict:
    provider = (provider or "").lower()
    if provider not in VALID_PROVIDERS:
        raise ValueError("provider must be 'stripe', 'moyasar', 'tap', or '' (disabled)")
    secret_env = (secret_env or "").strip() or DEFAULT_SECRET_ENV
    if not secret_env.replace("_", "").isalnum():
        raise ValueError("secret_env must be alphanumeric / underscores only")
    now_iso = datetime.now(timezone.utc).isoformat()
    await control_db.platform_settings.update_one(
        {"key": "payment"},
        {"$set": {
            "key": "payment",
            "provider": provider,
            "enabled": bool(enabled),
            "secret_env": secret_env,
            "updated_at": now_iso,
        }},
        upsert=True,
    )
    return await get_payment_settings()


# ── Signature verification ──────────────────────────────────────────────

def _const_eq(a: str, b: str) -> bool:
    try:
        return hmac.compare_digest(a or "", b or "")
    except Exception:
        return False


def _header(headers: Iterable, name: str) -> str:
    target = name.lower()
    if isinstance(headers, dict):
        for k, v in headers.items():
            if (k or "").lower() == target:
                return v or ""
        return ""
    for k, v in headers:
        try:
            kk = k.decode("latin1") if isinstance(k, bytes) else k
            vv = v.decode("latin1") if isinstance(v, bytes) else v
        except Exception:
            continue
        if (kk or "").lower() == target:
            return vv or ""
    return ""


def _verify_stripe(body: bytes, sig_header: str, secret: str) -> bool:
    if not sig_header or not secret:
        return False
    parts = {}
    for piece in sig_header.split(","):
        if "=" in piece:
            k, v = piece.split("=", 1)
            parts.setdefault(k.strip(), []).append(v.strip())
    ts_list = parts.get("t") or []
    sigs = parts.get("v1") or []
    if not ts_list or not sigs:
        return False
    ts = ts_list[0]
    try:
        ts_int = int(ts)
        if abs(time.time() - ts_int) > STRIPE_TIMESTAMP_TOLERANCE:
            return False
    except ValueError:
        return False
    signed = f"{ts}.".encode("utf-8") + body
    expected = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return any(_const_eq(expected, s) for s in sigs)


def _verify_hmac_sha256(body: bytes, sig_header: str, secret: str) -> bool:
    if not sig_header or not secret:
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    candidate = sig_header.strip()
    if candidate.lower().startswith("sha256="):
        candidate = candidate.split("=", 1)[1].strip()
    return _const_eq(expected, candidate)


def verify_signature(provider: str, body: bytes, headers, secret: str) -> bool:
    """Verify a provider's webhook signature against ``body`` using ``secret``."""
    provider = (provider or "").lower()
    if not secret:
        return False
    if provider == "stripe":
        return _verify_stripe(body, _header(headers, "Stripe-Signature"), secret)
    if provider == "moyasar":
        return _verify_hmac_sha256(body, _header(headers, "X-Moyasar-Signature")
                                   or _header(headers, "X-Webhook-Signature"), secret)
    if provider == "tap":
        return _verify_hmac_sha256(body, _header(headers, "Tap-Signature")
                                   or _header(headers, "X-Webhook-Signature"), secret)
    return _verify_hmac_sha256(body, _header(headers, "X-Webhook-Signature"), secret)


# ── Event normalization ─────────────────────────────────────────────────

_STRIPE_FAILURE_TYPES = {
    "invoice.payment_failed",
    "payment_intent.payment_failed",
    "charge.failed",
}
_MOYASAR_FAILURE_TYPES = {"payment_failed", "payment.failed"}


def _meta_lookup(meta: Dict) -> Tuple[Optional[str], Optional[str]]:
    if not isinstance(meta, dict):
        return None, None
    tid = meta.get("tenant_id") or meta.get("tenantId")
    slug = meta.get("tenant_slug") or meta.get("tenantSlug") or meta.get("slug")
    return (str(tid).strip() if tid else None,
            str(slug).strip().lower() if slug else None)


def _parse_stripe(payload: Dict) -> Optional[Dict]:
    evt_type = (payload.get("type") or "").strip()
    if evt_type not in _STRIPE_FAILURE_TYPES:
        return None
    obj = ((payload.get("data") or {}).get("object")) or {}
    meta = obj.get("metadata") or {}
    tid, slug = _meta_lookup(meta)
    reason = (obj.get("failure_message")
              or (obj.get("last_payment_error") or {}).get("message")
              or obj.get("failure_code")
              or evt_type)
    raw_amount = obj.get("amount_due") or obj.get("amount") or 0
    try:
        amount = float(raw_amount) / 100.0 if raw_amount else None
    except (TypeError, ValueError):
        amount = None
    currency = (obj.get("currency") or "SAR").upper()
    provider_ref = obj.get("id") or payload.get("id") or ""
    return {
        "tenant_id": tid,
        "tenant_slug": slug,
        "reason": str(reason)[:500],
        "amount": amount,
        "currency": currency,
        "provider_ref": str(provider_ref)[:200],
    }


def _parse_moyasar(payload: Dict) -> Optional[Dict]:
    evt_type = (payload.get("type") or payload.get("event") or "").strip().lower()
    data = payload.get("data") or payload
    status = (data.get("status") or "").lower()
    is_failure = evt_type in _MOYASAR_FAILURE_TYPES or status == "failed"
    if not is_failure:
        return None
    meta = data.get("metadata") or payload.get("metadata") or {}
    tid, slug = _meta_lookup(meta)
    raw_amount = data.get("amount") or 0
    try:
        amount = float(raw_amount) / 100.0 if raw_amount else None
    except (TypeError, ValueError):
        amount = None
    currency = (data.get("currency") or "SAR").upper()
    reason = (data.get("source") or {}).get("message") if isinstance(data.get("source"), dict) else None
    reason = reason or data.get("description") or data.get("message") or "payment_failed"
    provider_ref = data.get("id") or payload.get("id") or ""
    return {
        "tenant_id": tid,
        "tenant_slug": slug,
        "reason": str(reason)[:500],
        "amount": amount,
        "currency": currency,
        "provider_ref": str(provider_ref)[:200],
    }


def _parse_tap(payload: Dict) -> Optional[Dict]:
    status = (payload.get("status") or "").upper()
    if status not in {"FAILED", "DECLINED", "CANCELLED"}:
        return None
    meta = payload.get("metadata") or {}
    tid, slug = _meta_lookup(meta)
    response = payload.get("response") or {}
    reason = response.get("message") or payload.get("description") or status
    raw_amount = payload.get("amount")
    try:
        amount = float(raw_amount) if raw_amount is not None else None
    except (TypeError, ValueError):
        amount = None
    currency = (payload.get("currency") or "SAR").upper()
    provider_ref = payload.get("id") or ""
    return {
        "tenant_id": tid,
        "tenant_slug": slug,
        "reason": str(reason)[:500],
        "amount": amount,
        "currency": currency,
        "provider_ref": str(provider_ref)[:200],
    }


def parse_failure_event(provider: str, payload: Dict) -> Optional[Dict]:
    """Return a normalized failure dict, or ``None`` if not a failure event."""
    provider = (provider or "").lower()
    if not isinstance(payload, dict):
        return None
    if provider == "stripe":
        return _parse_stripe(payload)
    if provider == "moyasar":
        return _parse_moyasar(payload)
    if provider == "tap":
        return _parse_tap(payload)
    return None


# ── Success-event normalization ─────────────────────────────────────────

_STRIPE_SUCCESS_TYPES = {
    "invoice.payment_succeeded",
    "payment_intent.succeeded",
    "charge.succeeded",
}
_MOYASAR_SUCCESS_TYPES = {"payment_paid", "payment.paid", "payment_succeeded"}
_TAP_SUCCESS_STATUSES = {"CAPTURED", "PAID", "AUTHORIZED"}


def _meta_period(meta: Dict) -> Tuple[Optional[int], Optional[int], Optional[str]]:
    if not isinstance(meta, dict):
        return None, None, None
    raw_months = meta.get("months") if meta.get("months") is not None else meta.get("renewal_months")
    raw_days = meta.get("days") if meta.get("days") is not None else meta.get("renewal_days")
    cycle = (meta.get("cycle") or meta.get("billing_cycle") or "").strip().lower() or None
    try:
        months = int(raw_months) if raw_months is not None else None
    except (TypeError, ValueError):
        months = None
    try:
        days = int(raw_days) if raw_days is not None else None
    except (TypeError, ValueError):
        days = None
    return months, days, cycle


def _parse_stripe_success(payload: Dict) -> Optional[Dict]:
    evt_type = (payload.get("type") or "").strip()
    if evt_type not in _STRIPE_SUCCESS_TYPES:
        return None
    obj = ((payload.get("data") or {}).get("object")) or {}
    meta = obj.get("metadata") or {}
    tid, slug = _meta_lookup(meta)
    raw_amount = (obj.get("amount_paid")
                  or obj.get("amount_received")
                  or obj.get("amount") or 0)
    try:
        amount = float(raw_amount) / 100.0 if raw_amount else None
    except (TypeError, ValueError):
        amount = None
    currency = (obj.get("currency") or "SAR").upper()
    provider_ref = obj.get("id") or payload.get("id") or ""
    months, days, cycle = _meta_period(meta)
    return {
        "tenant_id": tid,
        "tenant_slug": slug,
        "amount": amount,
        "currency": currency,
        "provider_ref": str(provider_ref)[:200],
        "months": months,
        "days": days,
        "cycle": cycle,
    }


def _parse_moyasar_success(payload: Dict) -> Optional[Dict]:
    evt_type = (payload.get("type") or payload.get("event") or "").strip().lower()
    data = payload.get("data") or payload
    status = (data.get("status") or "").lower()
    is_success = evt_type in _MOYASAR_SUCCESS_TYPES or status == "paid"
    if not is_success:
        return None
    meta = data.get("metadata") or payload.get("metadata") or {}
    tid, slug = _meta_lookup(meta)
    raw_amount = data.get("amount") or 0
    try:
        amount = float(raw_amount) / 100.0 if raw_amount else None
    except (TypeError, ValueError):
        amount = None
    currency = (data.get("currency") or "SAR").upper()
    provider_ref = data.get("id") or payload.get("id") or ""
    months, days, cycle = _meta_period(meta)
    return {
        "tenant_id": tid,
        "tenant_slug": slug,
        "amount": amount,
        "currency": currency,
        "provider_ref": str(provider_ref)[:200],
        "months": months,
        "days": days,
        "cycle": cycle,
    }


def _parse_tap_success(payload: Dict) -> Optional[Dict]:
    status = (payload.get("status") or "").upper()
    if status not in _TAP_SUCCESS_STATUSES:
        return None
    meta = payload.get("metadata") or {}
    tid, slug = _meta_lookup(meta)
    raw_amount = payload.get("amount")
    try:
        amount = float(raw_amount) if raw_amount is not None else None
    except (TypeError, ValueError):
        amount = None
    currency = (payload.get("currency") or "SAR").upper()
    provider_ref = payload.get("id") or ""
    months, days, cycle = _meta_period(meta)
    return {
        "tenant_id": tid,
        "tenant_slug": slug,
        "amount": amount,
        "currency": currency,
        "provider_ref": str(provider_ref)[:200],
        "months": months,
        "days": days,
        "cycle": cycle,
    }


def parse_success_event(provider: str, payload: Dict) -> Optional[Dict]:
    """Return a normalized success dict, or ``None`` if not a success event.

    Shape mirrors :func:`parse_failure_event` and adds optional
    ``months``/``days``/``cycle`` extracted from the event ``metadata`` so the
    webhook can drive the same renewal flow as the manual super-admin endpoint.
    """
    provider = (provider or "").lower()
    if not isinstance(payload, dict):
        return None
    if provider == "stripe":
        return _parse_stripe_success(payload)
    if provider == "moyasar":
        return _parse_moyasar_success(payload)
    if provider == "tap":
        return _parse_tap_success(payload)
    return None
