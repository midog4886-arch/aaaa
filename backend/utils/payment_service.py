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
import json
import os
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple, Iterable

from control_db import control_db

logger = logging.getLogger("payment_service")

VALID_PROVIDERS = {"stripe", "moyasar", "tap", ""}
DEFAULT_SECRET_ENV = "PAYMENT_WEBHOOK_SECRET"
STRIPE_TIMESTAMP_TOLERANCE = 60 * 5  # seconds

# Rolling-window tracking of webhook signature failures per provider. If a
# secret rotates (or is misconfigured) every retry will return 401 silently;
# this surfaces the issue to the super-admin once a burst is detected.
SIGNATURE_FAILURE_WINDOW_SECONDS = 10 * 60      # 10 minutes
SIGNATURE_FAILURE_THRESHOLD = 5                  # failures within window
SIGNATURE_FAILURE_ALERT_COOLDOWN_SECONDS = 60 * 60  # don't re-alert for 1h
_SIGNATURE_FAILURE_KEY_PREFIX = "payment_signature_failures:"


def _signature_failure_key(provider: str) -> str:
    return f"{_SIGNATURE_FAILURE_KEY_PREFIX}{(provider or '').lower()}"


def _parse_iso(ts: str) -> Optional[datetime]:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def record_signature_failure(provider: str) -> Dict:
    """Record one signature-verification failure for ``provider`` and decide
    whether the super-admin should be alerted.

    Returns ``{"count", "should_alert", "window_seconds", "threshold"}``:
      * ``count`` — failures still inside the rolling window after this one.
      * ``should_alert`` — True iff the threshold was just crossed AND we
        haven't already alerted within the cooldown window.

    Best-effort persistence: on a DB error we still return a non-alerting
    response so the webhook handler keeps responding 401 to the provider.
    """
    provider_lc = (provider or "").lower()
    key = _signature_failure_key(provider_lc)
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(seconds=SIGNATURE_FAILURE_WINDOW_SECONDS)
    cooldown_start = now - timedelta(seconds=SIGNATURE_FAILURE_ALERT_COOLDOWN_SECONDS)

    try:
        doc = await control_db.platform_settings.find_one({"key": key}, {"_id": 0}) or {}
        raw_failures: List[str] = list(doc.get("failures") or [])
        failures: List[str] = []
        for ts in raw_failures:
            dt = _parse_iso(ts)
            if dt and dt >= window_start:
                failures.append(dt.isoformat())
        failures.append(now.isoformat())

        last_alerted = _parse_iso(doc.get("alerted_at") or "")
        # If the previous alert was sent before the cooldown window, treat
        # it as expired so a brand-new burst will alert again.
        previously_alerted_recently = bool(last_alerted and last_alerted >= cooldown_start)

        should_alert = (
            len(failures) >= SIGNATURE_FAILURE_THRESHOLD
            and not previously_alerted_recently
        )

        update: Dict = {
            "key": key,
            "provider": provider_lc,
            "failures": failures,
            "updated_at": now.isoformat(),
        }
        if should_alert:
            update["alerted_at"] = now.isoformat()
            update["last_alert_count"] = len(failures)
        elif "alerted_at" in doc:
            # Preserve prior alerted_at across non-alerting writes.
            update["alerted_at"] = doc.get("alerted_at")
            update["last_alert_count"] = doc.get("last_alert_count", 0)

        await control_db.platform_settings.update_one(
            {"key": key}, {"$set": update}, upsert=True,
        )
        return {
            "count": len(failures),
            "should_alert": should_alert,
            "window_seconds": SIGNATURE_FAILURE_WINDOW_SECONDS,
            "threshold": SIGNATURE_FAILURE_THRESHOLD,
        }
    except Exception:
        logger.exception("record_signature_failure persistence failed")
        return {
            "count": 0,
            "should_alert": False,
            "window_seconds": SIGNATURE_FAILURE_WINDOW_SECONDS,
            "threshold": SIGNATURE_FAILURE_THRESHOLD,
        }


async def reset_signature_failures(provider: str) -> None:
    """Clear the rolling failure counter after a verified delivery.

    Called from the webhook on the first successful HMAC verify so a single
    valid retry clears the alert state — matching task #266's "counter resets
    after a successful verification" requirement.
    """
    key = _signature_failure_key(provider)
    try:
        await control_db.platform_settings.update_one(
            {"key": key},
            {"$set": {
                "key": key,
                "provider": (provider or "").lower(),
                "failures": [],
                "alerted_at": "",
                "last_alert_count": 0,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    except Exception:
        logger.exception("reset_signature_failures persistence failed")

# Consecutive-failure streak alerting (task #285). Distinct from the
# rolling-window signature tracker above: this watches *all* failure modes
# that indicate a regression in webhook delivery — bad signatures, missing
# tenant metadata, or unhandled exceptions — and surfaces a banner +
# debounced email when ``DELIVERY_FAILURE_STREAK_THRESHOLD`` failures occur
# back-to-back without any successful delivery in between. A single
# ``recorded`` or ``renewed`` delivery clears the streak (and the banner).
DELIVERY_FAILURE_STATUSES = {"signature_invalid", "tenant_not_found", "error"}
DELIVERY_SUCCESS_STATUSES = {"recorded", "renewed"}
DELIVERY_FAILURE_STREAK_THRESHOLD = 3
DELIVERY_FAILURE_ALERT_COOLDOWN_SECONDS = 60 * 60  # don't re-email within 1h
_DELIVERY_FAILURE_KEY_PREFIX = "payment_delivery_failures:"


def _delivery_failure_key(provider: str) -> str:
    return f"{_DELIVERY_FAILURE_KEY_PREFIX}{(provider or '').lower()}"


async def _update_delivery_streak(
    provider: str,
    status: str,
    reason: str,
    tenant_slug: Optional[str],
) -> Dict:
    """Update the per-provider consecutive-failure streak after one webhook
    delivery and decide whether the super-admin should be alerted.

    Returns ``{"streak", "should_alert", "active_alert", "threshold",
    "last_status", "last_reason", "last_failure_at", "since",
    "last_tenant_slug", "cleared"}``.

    * ``cleared`` — True when this delivery cleared a previously-active
      banner (i.e. a successful delivery after a failure streak).
    * ``should_alert`` — True iff the threshold was just crossed by this
      delivery AND we haven't already alerted within the cooldown.
    * ``active_alert`` — True while a banner should be shown.

    Best-effort: any persistence error is logged and swallowed so a
    diagnostic-side bug never breaks webhook processing.
    """
    provider_lc = (provider or "").lower()
    status_lc = (status or "").lower()
    is_failure = status_lc in DELIVERY_FAILURE_STATUSES
    is_success = status_lc in DELIVERY_SUCCESS_STATUSES
    # Neutral statuses (provider_disabled, secret_missing, invalid_payload,
    # duplicate, ignored, received) neither extend nor break the streak —
    # they tell us nothing about whether real delivery is healthy.
    if not is_failure and not is_success:
        return {
            "streak": 0,
            "should_alert": False,
            "active_alert": False,
            "threshold": DELIVERY_FAILURE_STREAK_THRESHOLD,
            "cleared": False,
        }
    key = _delivery_failure_key(provider_lc)
    now = datetime.now(timezone.utc)
    cooldown_start = now - timedelta(seconds=DELIVERY_FAILURE_ALERT_COOLDOWN_SECONDS)
    try:
        doc = await control_db.platform_settings.find_one({"key": key}, {"_id": 0}) or {}
        prev_streak = int(doc.get("streak") or 0)
        prev_active = bool(doc.get("active_alert"))
        last_alerted = _parse_iso(doc.get("alerted_at") or "")
        previously_alerted_recently = bool(last_alerted and last_alerted >= cooldown_start)

        if is_success:
            update = {
                "key": key,
                "provider": provider_lc,
                "streak": 0,
                "active_alert": False,
                "last_status": status_lc,
                "last_reason": (reason or "")[:500],
                "last_tenant_slug": (tenant_slug or "")[:80],
                "last_success_at": now.isoformat(),
                "updated_at": now.isoformat(),
                # Reset cooldown so the next genuine streak can alert.
                "alerted_at": "",
                "last_alert_count": 0,
            }
            # Preserve the most recent failure trail for diagnostics.
            if "last_failure_at" in doc:
                update["last_failure_at"] = doc.get("last_failure_at")
            if "since" in doc:
                update["since"] = doc.get("since")
            await control_db.platform_settings.update_one(
                {"key": key}, {"$set": update}, upsert=True,
            )
            return {
                "streak": 0,
                "should_alert": False,
                "active_alert": False,
                "threshold": DELIVERY_FAILURE_STREAK_THRESHOLD,
                "cleared": prev_active,
                "last_status": status_lc,
            }

        # Failure path: extend the streak.
        new_streak = prev_streak + 1
        since = doc.get("since") if prev_streak > 0 else now.isoformat()
        should_alert = (
            new_streak >= DELIVERY_FAILURE_STREAK_THRESHOLD
            and not previously_alerted_recently
        )
        update = {
            "key": key,
            "provider": provider_lc,
            "streak": new_streak,
            "active_alert": new_streak >= DELIVERY_FAILURE_STREAK_THRESHOLD,
            "last_status": status_lc,
            "last_reason": (reason or "")[:500],
            "last_tenant_slug": (tenant_slug or "")[:80],
            "last_failure_at": now.isoformat(),
            "since": since or now.isoformat(),
            "updated_at": now.isoformat(),
        }
        if should_alert:
            update["alerted_at"] = now.isoformat()
            update["last_alert_count"] = new_streak
        else:
            # Preserve prior alert metadata across non-alerting writes so
            # the cooldown is honored.
            if "alerted_at" in doc:
                update["alerted_at"] = doc.get("alerted_at")
            if "last_alert_count" in doc:
                update["last_alert_count"] = doc.get("last_alert_count")
        await control_db.platform_settings.update_one(
            {"key": key}, {"$set": update}, upsert=True,
        )
        return {
            "streak": new_streak,
            "should_alert": should_alert,
            "active_alert": update["active_alert"],
            "threshold": DELIVERY_FAILURE_STREAK_THRESHOLD,
            "cleared": False,
            "last_status": status_lc,
            "last_reason": update["last_reason"],
            "last_failure_at": update["last_failure_at"],
            "since": update["since"],
            "last_tenant_slug": update["last_tenant_slug"],
        }
    except Exception:
        logger.exception("_update_delivery_streak persistence failed")
        return {
            "streak": 0,
            "should_alert": False,
            "active_alert": False,
            "threshold": DELIVERY_FAILURE_STREAK_THRESHOLD,
            "cleared": False,
        }


async def list_active_delivery_alerts() -> list:
    """Return the active delivery-failure banners across all providers.

    Each entry: ``{"provider", "streak", "threshold", "since",
    "last_failure_at", "last_status", "last_reason", "last_tenant_slug"}``.
    Empty list means no banner should be shown.
    """
    try:
        cursor = control_db.platform_settings.find(
            {"key": {"$regex": f"^{_DELIVERY_FAILURE_KEY_PREFIX}"}, "active_alert": True},
            {"_id": 0},
        )
        out = []
        async for doc in cursor:
            out.append({
                "provider": doc.get("provider") or "",
                "streak": int(doc.get("streak") or 0),
                "threshold": DELIVERY_FAILURE_STREAK_THRESHOLD,
                "since": doc.get("since") or "",
                "last_failure_at": doc.get("last_failure_at") or "",
                "last_status": doc.get("last_status") or "",
                "last_reason": doc.get("last_reason") or "",
                "last_tenant_slug": doc.get("last_tenant_slug") or "",
            })
        out.sort(key=lambda r: r.get("last_failure_at") or "", reverse=True)
        return out
    except Exception:
        logger.exception("list_active_delivery_alerts failed")
        return []


# Diagnostics: how many recent webhook deliveries to retain for super-admin
# inspection. Each delivery is one row regardless of whether it was accepted,
# rejected by signature, deduplicated, or otherwise ignored.
WEBHOOK_EVENTS_MAX = 200
# Cap the redacted payload snapshot stored per row. Keeps the diagnostic
# collection bounded (200 rows × ~8 KB ≈ 1.6 MB worst case) and prevents a
# single oversized provider event from filling up control_db.
WEBHOOK_PAYLOAD_SNAPSHOT_MAX_BYTES = 8192
# Keys whose values are scrubbed from the snapshot before persisting.
# Card numbers / CVVs / signing secrets / API keys must never land in the
# diagnostics collection regardless of which provider sent them.
_SENSITIVE_PAYLOAD_KEYS = {
    "number", "card_number", "pan", "account_number", "iban",
    "cvc", "cvv", "cvv2", "csc",
    "secret", "client_secret", "signing_secret", "webhook_secret",
    "api_key", "apikey", "private_key", "password", "passcode", "pin",
    "authorization", "auth_token", "bearer",
}
_SENSITIVE_PAYLOAD_KEYS_LC = {k.lower() for k in _SENSITIVE_PAYLOAD_KEYS}
_REDACTED_PLACEHOLDER = "***REDACTED***"
_MAX_STRING_LEN = 500
_MAX_LIST_ITEMS = 50

# Pattern-based scrubbers for free-text payload values (and the unparsed-body
# fallback). Run *before* truncation so the placeholder lands intact.
import re as _re
_PAN_RE = _re.compile(r"(?<!\d)(?:\d[ -]?){12,19}(?!\d)")
# Match common secret-style tokens by prefix or by long alnum runs.
_TOKEN_RE = _re.compile(
    r"\b(?:sk_live|sk_test|pk_live|pk_test|whsec|rk_live|rk_test|Bearer\s+|"
    r"AIza|ghp_|gho_|github_pat_|xox[abprs]-)[A-Za-z0-9_\-\.]{6,}\b"
)
# Match generic long opaque tokens (>=24 chars of base64-ish + dashes/dots).
_LONG_TOKEN_RE = _re.compile(r"\b[A-Za-z0-9_\-]{32,}\b")


def _scrub_text(text: str) -> str:
    """Mask PAN-like digit runs and known secret-token shapes inside a string."""
    if not text:
        return text
    out = _PAN_RE.sub(_REDACTED_PLACEHOLDER, text)
    out = _TOKEN_RE.sub(_REDACTED_PLACEHOLDER, out)
    out = _LONG_TOKEN_RE.sub(_REDACTED_PLACEHOLDER, out)
    return out


def _redact_value(value: Any, depth: int = 0) -> Any:
    """Walk a JSON-ish value and scrub sensitive keys + clip giant strings."""
    if depth > 8:
        return "…"
    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for k, v in value.items():
            key = str(k)
            if key.lower() in _SENSITIVE_PAYLOAD_KEYS_LC:
                out[key] = _REDACTED_PLACEHOLDER
            else:
                out[key] = _redact_value(v, depth + 1)
        return out
    if isinstance(value, list):
        trimmed = list(value)[:_MAX_LIST_ITEMS]
        out_list = [_redact_value(v, depth + 1) for v in trimmed]
        if len(value) > _MAX_LIST_ITEMS:
            out_list.append(f"… (+{len(value) - _MAX_LIST_ITEMS} more)")
        return out_list
    if isinstance(value, str):
        scrubbed = _scrub_text(value)
        if len(scrubbed) > _MAX_STRING_LEN:
            return scrubbed[:_MAX_STRING_LEN] + "…"
        return scrubbed
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    try:
        s = str(value)
    except Exception:
        return _REDACTED_PLACEHOLDER
    if len(s) > _MAX_STRING_LEN:
        s = s[:_MAX_STRING_LEN] + "…"
    return s


def _build_payload_snapshot(payload: Any) -> Optional[Dict[str, Any]]:
    """Return ``{"data", "truncated", "size_bytes"}`` or ``None``.

    The snapshot is bounded by ``WEBHOOK_PAYLOAD_SNAPSHOT_MAX_BYTES`` so a
    single oversized provider event can't blow up the diagnostics collection.
    """
    if payload is None:
        return None
    try:
        redacted = _redact_value(payload)
        encoded = json.dumps(redacted, ensure_ascii=False, default=str)
    except Exception:
        logger.exception("payload snapshot serialization failed")
        return None
    raw = encoded.encode("utf-8")
    if len(raw) <= WEBHOOK_PAYLOAD_SNAPSHOT_MAX_BYTES:
        return {"data": redacted, "truncated": False, "size_bytes": len(raw)}
    # Too large to keep in structured form — fall back to a clipped string
    # preview so the super-admin still sees what the provider sent.
    clipped = raw[:WEBHOOK_PAYLOAD_SNAPSHOT_MAX_BYTES].decode("utf-8", errors="ignore")
    return {
        "data": None,
        "preview": clipped + "…",
        "truncated": True,
        "size_bytes": len(raw),
    }

VALID_WEBHOOK_EVENT_STATUSES = {
    "received",
    "signature_invalid",
    "invalid_payload",
    "provider_disabled",
    "secret_missing",
    "duplicate",
    "recorded",
    "renewed",
    "ignored",
    "tenant_not_found",
    "error",
}


async def record_webhook_event(
    *,
    provider: str,
    status: str,
    reason: str = "",
    tenant_id: Optional[str] = None,
    tenant_slug: Optional[str] = None,
    event_id: Optional[str] = None,
    payload: Any = None,
    signature_header: Optional[str] = None,
    http_status: Optional[int] = None,
) -> None:
    """Append a diagnostic row to ``control_db.webhook_events``.

    Used by the payment webhook handler so a super-admin can see at a glance
    whether deliveries are arriving, being signature-rejected, deduplicated,
    or successfully applied — without trawling server logs.

    Self-trims to the most recent ``WEBHOOK_EVENTS_MAX`` rows so the
    collection stays bounded. Best-effort: any failure is logged and
    swallowed (we never want diagnostics to break webhook processing).

    Also updates the consecutive-failure streak (task #285) and returns a
    ``{"delivery": {...}}`` dict describing the streak state so the caller
    can fire the super-admin alert email when the threshold is crossed.
    Existing callers that ignore the return value continue to work.
    """
    normalized_status = (status or "").strip().lower()
    if normalized_status not in VALID_WEBHOOK_EVENT_STATUSES:
        normalized_status = "error"
    provider_lc = (provider or "").strip().lower()[:40]
    reason_clean = (reason or "").strip()[:500]
    tenant_slug_clean = (tenant_slug or "").strip().lower()[:80] if tenant_slug else ""
    snapshot = _build_payload_snapshot(payload)
    sig_header_clean = (signature_header or "").strip()[:80]
    http_status_int: Optional[int] = None
    if http_status is not None:
        try:
            http_status_int = int(http_status)
        except (TypeError, ValueError):
            http_status_int = None
    import uuid as _uuid_mod
    try:
        doc = {
            "row_id": str(_uuid_mod.uuid4()),
            "provider": provider_lc,
            "status": normalized_status,
            "reason": reason_clean,
            "tenant_id": (tenant_id or "").strip()[:80] if tenant_id else "",
            "tenant_slug": tenant_slug_clean,
            "event_id": (event_id or "").strip()[:200] if event_id else "",
            "received_at": datetime.now(timezone.utc),
        }
        if snapshot is not None:
            doc["payload_snapshot"] = snapshot
        if sig_header_clean:
            doc["signature_header"] = sig_header_clean
        if http_status_int is not None:
            doc["http_status"] = http_status_int
        await control_db.webhook_events.insert_one(doc)
        # Trim oldest rows beyond the cap. Cheap because we keep the cap
        # small and the collection is queried rarely (admin only).
        total = await control_db.webhook_events.count_documents({})
        if total > WEBHOOK_EVENTS_MAX:
            cutoff_cursor = control_db.webhook_events.find(
                {}, {"_id": 1}
            ).sort("received_at", -1).skip(WEBHOOK_EVENTS_MAX).limit(total)
            stale_ids = [r["_id"] async for r in cutoff_cursor]
            if stale_ids:
                await control_db.webhook_events.delete_many({"_id": {"$in": stale_ids}})
    except Exception:
        logger.exception("record_webhook_event failed")
    delivery = await _update_delivery_streak(
        provider_lc, normalized_status, reason_clean, tenant_slug_clean,
    )
    return {"delivery": delivery}


# Maps the granular per-row ``status`` to the coarse ``outcome`` bucket the
# super-admin UI groups by (the three categories called out in task #265:
# processed / duplicate / ignored). ``status`` is retained as-is for callers
# that want the precise reason; ``outcome`` is derived for display.
_OUTCOME_BY_STATUS = {
    "recorded": "processed",
    "renewed": "processed",
    "duplicate": "duplicate",
    "ignored": "ignored",
    "received": "ignored",
    "signature_invalid": "ignored",
    "invalid_payload": "ignored",
    "provider_disabled": "ignored",
    "secret_missing": "ignored",
    "tenant_not_found": "ignored",
    "error": "ignored",
}

VALID_WEBHOOK_OUTCOMES = {"processed", "duplicate", "ignored"}


def _derive_outcome(status: str) -> str:
    return _OUTCOME_BY_STATUS.get((status or "").lower(), "ignored")


async def list_webhook_events(
    *,
    status: Optional[str] = None,
    provider: Optional[str] = None,
    outcome: Optional[str] = None,
    tenant_slug: Optional[str] = None,
    limit: int = 200,
) -> list:
    """Return the most recent webhook diagnostic rows (newest first).

    Each returned row includes an ``outcome`` field (``processed`` /
    ``duplicate`` / ``ignored``) derived from the granular ``status``, so the
    super-admin UI can group / filter the way task #265 specifies without
    losing the more detailed status string.

    Pass ``tenant_slug`` to restrict results to a specific academy.  An
    unknown slug simply returns no rows (no error).
    """
    try:
        limit = max(1, min(int(limit or 200), WEBHOOK_EVENTS_MAX))
    except (TypeError, ValueError):
        limit = 200
    query: Dict = {}
    status_filter = ""
    if status:
        s = str(status).strip().lower()
        if s and s != "all":
            status_filter = s
    if provider:
        p = str(provider).strip().lower()
        if p and p != "all":
            query["provider"] = p
    if tenant_slug:
        ts = str(tenant_slug).strip().lower()
        if ts:
            query["tenant_slug"] = ts
    outcome_filter = ""
    if outcome:
        o = str(outcome).strip().lower()
        if o and o != "all":
            if o not in VALID_WEBHOOK_OUTCOMES:
                return []
            outcome_filter = o
    # Intersect status + outcome rather than letting one overwrite the other.
    if status_filter and outcome_filter:
        if _OUTCOME_BY_STATUS.get(status_filter) != outcome_filter:
            return []
        query["status"] = status_filter
    elif status_filter:
        query["status"] = status_filter
    elif outcome_filter:
        query["status"] = {
            "$in": [s for s, oc in _OUTCOME_BY_STATUS.items() if oc == outcome_filter]
        }
    cursor = control_db.webhook_events.find(query, {"_id": 0}).sort("received_at", -1).limit(limit)
    rows = []
    async for r in cursor:
        recv = r.get("received_at")
        if isinstance(recv, datetime):
            r["received_at"] = recv.isoformat()
        r["outcome"] = _derive_outcome(r.get("status", ""))
        if outcome_filter and r["outcome"] != outcome_filter:
            continue
        rows.append(r)
    return rows

async def get_webhook_event_by_row_id(row_id: str) -> Optional[Dict]:
    """Return a single webhook event doc by its ``row_id`` UUID field."""
    if not row_id:
        return None
    try:
        doc = await control_db.webhook_events.find_one(
            {"row_id": str(row_id).strip()}, {"_id": 0}
        )
        if doc is None:
            return None
        recv = doc.get("received_at")
        if isinstance(recv, datetime):
            doc["received_at"] = recv.isoformat()
        doc["outcome"] = _derive_outcome(doc.get("status", ""))
        return doc
    except Exception:
        logger.exception("get_webhook_event_by_row_id failed for %s", row_id)
        return None


async def aggregate_webhook_event_stats(
    *,
    window_seconds: int = 24 * 60 * 60,
    provider: Optional[str] = None,
    tenant_slug: Optional[str] = None,
) -> Dict:
    """Return webhook delivery counts grouped by status over a recent window.

    Used by the super-admin payment page to surface a glanceable health
    strip ("last 24h: X received, Y signature_invalid, …") without making
    them scroll the paginated event log.

    Returns ``{"window_seconds", "since", "until", "provider", "total",
    "by_status": {status: count, …}, "by_outcome": {outcome: count, …}}``.
    Statuses with zero hits in the window are omitted from ``by_status`` so
    callers can iterate just the buckets that fired.

    Pass ``tenant_slug`` to restrict stats to a specific academy.
    """
    try:
        window = int(window_seconds)
    except (TypeError, ValueError):
        window = 24 * 60 * 60
    # Clamp to a sane range: 5 minutes minimum, 30 days maximum.
    window = max(5 * 60, min(window, 30 * 24 * 60 * 60))
    now = datetime.now(timezone.utc)
    since = now - timedelta(seconds=window)
    query: Dict = {"received_at": {"$gte": since}}
    provider_lc = ""
    if provider:
        p = str(provider).strip().lower()
        if p and p != "all":
            provider_lc = p
            query["provider"] = p
    if tenant_slug:
        ts = str(tenant_slug).strip().lower()
        if ts:
            query["tenant_slug"] = ts
    by_status: Dict[str, int] = {}
    by_outcome: Dict[str, int] = {"processed": 0, "duplicate": 0, "ignored": 0}
    total = 0
    try:
        cursor = control_db.webhook_events.aggregate([
            {"$match": query},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        ])
        async for row in cursor:
            status = (row.get("_id") or "").lower() or "error"
            count = int(row.get("count") or 0)
            if count <= 0:
                continue
            by_status[status] = by_status.get(status, 0) + count
            total += count
            outcome = _derive_outcome(status)
            by_outcome[outcome] = by_outcome.get(outcome, 0) + count
    except Exception:
        logger.exception("aggregate_webhook_event_stats failed")
    return {
        "window_seconds": window,
        "since": since.isoformat(),
        "until": now.isoformat(),
        "provider": provider_lc,
        "total": total,
        "by_status": by_status,
        "by_outcome": by_outcome,
    }


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


async def lock_original_event(provider: str, event_id: str) -> None:
    """After a manual reprocess succeeds, guarantee the original provider event
    is marked as ``processed`` so future provider retries cannot re-claim and
    re-apply the same side effects.

    Unlike :func:`confirm_event` (which only updates an *existing* row),
    this function upserts — it inserts a ``processed`` row when the original
    claim was already released (``status=error`` path in the webhook handler
    deletes the claim via :func:`release_event` so :func:`confirm_event` would
    silently no-op).  Best-effort: any failure is logged and swallowed.
    """
    if not event_id:
        return
    provider_lc = (provider or "").lower()
    await _ensure_processed_events_indexes()
    now = datetime.now(timezone.utc)
    try:
        await control_db.processed_payment_events.update_one(
            {"provider": provider_lc, "event_id": event_id},
            {
                "$set": {
                    "provider": provider_lc,
                    "event_id": event_id,
                    "status": "processed",
                    "processed_at": now,
                },
                "$setOnInsert": {
                    "created_at": now,
                },
            },
            upsert=True,
        )
    except Exception:
        logger.exception(
            "lock_original_event upsert failed for %s/%s", provider_lc, event_id
        )


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


async def update_payment_settings(
    provider: str,
    enabled: bool,
    secret_env: str,
    *,
    actor: Optional[Dict] = None,
    trigger: str = "automated",
    trigger_source: str = "",
) -> Dict:
    provider = (provider or "").lower()
    if provider not in VALID_PROVIDERS:
        raise ValueError("provider must be 'stripe', 'moyasar', 'tap', or '' (disabled)")
    secret_env = (secret_env or "").strip() or DEFAULT_SECRET_ENV
    if not secret_env.replace("_", "").isalnum():
        raise ValueError("secret_env must be alphanumeric / underscores only")
    before = await get_payment_settings()
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
    after = await get_payment_settings()
    try:
        from utils.audit import log_audit
        actor_doc = actor or {
            "user_id": "system",
            "username": "system",
            "is_admin": False,
        }
        trig = (trigger or "automated").lower()
        if trig not in {"manual", "automated"}:
            trig = "automated"
        await log_audit(
            actor=actor_doc,
            action="settings.payment.update",
            entity_type="settings",
            entity_id="payment",
            entity_name="payment_settings",
            before=before,
            after=after,
            extra={"trigger": trig, "trigger_source": trigger_source or ""},
        )
    except Exception:
        logger.exception("failed to write audit row for payment settings update")
    return after


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
