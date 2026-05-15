"""Shared rate limiter backed by MongoDB.

Replaces in-process per-process counters that broke as soon as the API
ran behind multiple Gunicorn workers (or scaled horizontally): each
worker had its own bucket, so an attacker hitting a public endpoint
could effectively get ``N × limit`` attempts. Persisting the buckets in
the control DB means every worker sees the same counts.

Algorithm: sliding window. Each ``(scope, key)`` pair stores a small
list of recent hit timestamps in a single document. On every call we
prune timestamps older than ``window_seconds``, count what's left, and
either append a new timestamp (allow) or refuse (deny). A TTL index on
``expires_at`` keeps the collection from growing without bound — idle
buckets drop out automatically.

Usage from a route::

    from utils.rate_limit import check_rate_limit

    if not await check_rate_limit("cancel_delete", client_ip,
                                   limit=10, window_seconds=60):
        raise HTTPException(429, "Too many attempts")

The limiter is intentionally fail-open: if Mongo is unreachable we log
and allow the request through, on the principle that breaking every
public endpoint when the rate-limit collection is down is worse than
temporarily losing the cap.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger("rate_limit")

_COLLECTION = "rate_limit_buckets"
_indexes_ready = False


def _coll(control_db_override=None):
    if control_db_override is not None:
        return control_db_override[_COLLECTION]
    # Imported lazily so test suites can monkeypatch ``control_db``
    # before the limiter binds to it.
    from control_db import control_db
    return control_db[_COLLECTION]


async def _ensure_indexes(coll) -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    try:
        await coll.create_index("expires_at", expireAfterSeconds=0)
        _indexes_ready = True
    except Exception as exc:  # pragma: no cover - index errors are non-fatal
        logger.warning("rate_limit: failed to ensure TTL index: %s", exc)


async def check_rate_limit(
    scope: str,
    key: str,
    *,
    limit: int,
    window_seconds: int,
    control_db_override=None,
) -> bool:
    """Return ``True`` if the call is allowed (and record a hit), or
    ``False`` if the caller has already used ``limit`` hits inside the
    rolling ``window_seconds`` window.

    ``scope`` namespaces the bucket so two endpoints can share the same
    ``key`` (typically a client IP) without colliding.
    """
    if limit <= 0 or window_seconds <= 0:
        return True
    try:
        coll = _coll(control_db_override)
        await _ensure_indexes(coll)
        doc_id = f"{scope}:{key}"
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=window_seconds)

        # 1) Drop hits that have aged out so the size check below is
        #    accurate. Done as a separate update because Mongo doesn't
        #    allow $pull and $push on the same array in one op.
        await coll.update_one(
            {"_id": doc_id},
            {"$pull": {"hits": {"$lt": cutoff}}},
        )
        existing = await coll.find_one({"_id": doc_id}, {"hits": 1})
        current = len((existing or {}).get("hits") or [])
        if current >= limit:
            return False

        # 2) Record this hit. ``expires_at`` is set generously (2×
        #    window) so the TTL doesn't race with an in-flight request.
        await coll.update_one(
            {"_id": doc_id},
            {
                "$push": {"hits": now},
                "$set": {"expires_at": now + timedelta(seconds=window_seconds * 2)},
            },
            upsert=True,
        )
        return True
    except Exception as exc:
        # Fail-open: never break a public endpoint if the limiter store
        # is unavailable. Surface it loudly so ops can react.
        logger.error("rate_limit: store unavailable, allowing request (%s)", exc)
        return True


async def reset_rate_limit(scope: str, key: str, control_db_override=None) -> None:
    """Drop the bucket for a given (scope, key). Used by tests and by
    admin tooling that needs to clear a false positive."""
    try:
        coll = _coll(control_db_override)
        await coll.delete_one({"_id": f"{scope}:{key}"})
    except Exception as exc:  # pragma: no cover
        logger.warning("rate_limit: reset failed: %s", exc)
