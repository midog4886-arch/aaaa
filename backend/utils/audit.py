"""Audit log helper.

Writes a row to ``db.audit_logs`` for sensitive operations. Designed to be a
single ``await log_audit(...)`` call from any route handler. Failures are
swallowed — auditing must never break the underlying operation.

Each row carries: actor (user_id, username, is_admin), action (e.g.
``member.delete``), entity (type + id), branch_id, timestamps, and a
``before/after`` diff (compact — only top-level keys whose value changed).
The whole record is automatically scoped to the current tenant DB by the
``TenantDBProxy``.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from database import db

logger = logging.getLogger("audit")

_MAX_VALUE_LEN = 500
_REDACTED = "***"
_REDACT_KEYS = {"password", "token", "secret", "access_token", "refresh_token"}


def _shorten(value: Any) -> Any:
    if isinstance(value, str) and len(value) > _MAX_VALUE_LEN:
        return value[:_MAX_VALUE_LEN] + "…"
    if isinstance(value, (list, tuple)) and len(value) > 20:
        return list(value[:20]) + [f"…(+{len(value) - 20})"]
    if isinstance(value, dict):
        return {k: (_REDACTED if k.lower() in _REDACT_KEYS else _shorten(v)) for k, v in list(value.items())[:30]}
    return value


def _diff(before: Optional[Dict[str, Any]], after: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Return a compact ``{field: {before, after}}`` diff for top-level keys."""
    if not isinstance(before, dict) and not isinstance(after, dict):
        return {}
    b = before or {}
    a = after or {}
    keys = set(b.keys()) | set(a.keys())
    out: Dict[str, Any] = {}
    for k in keys:
        if k.startswith("_") or k.lower() in _REDACT_KEYS:
            continue
        if b.get(k) != a.get(k):
            out[k] = {"before": _shorten(b.get(k)), "after": _shorten(a.get(k))}
    return out


async def log_audit(
    *,
    actor: Optional[Dict[str, Any]] = None,
    action: str,
    entity_type: str = "",
    entity_id: str = "",
    entity_name: str = "",
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Best-effort audit row writer. Never raises."""
    try:
        actor = actor or {}
        diff = _diff(before, after) if (before is not None or after is not None) else {}
        doc = {
            "id": str(uuid.uuid4()),
            "action": action,
            "entity_type": entity_type or "",
            "entity_id": entity_id or "",
            "entity_name": entity_name or "",
            "actor_id": actor.get("user_id") or actor.get("id") or "",
            "actor_username": actor.get("username") or "",
            "actor_is_admin": bool(actor.get("is_admin")),
            "branch_id": actor.get("branch_id") or "",
            "diff": diff,
            "extra": _shorten(extra or {}),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        # Normalized member linkage for fast, indexed lookups — subscription
        # entries store entity_id as "<member_id>:<activity_id>".
        if entity_type in ("member", "member_activity") and entity_id:
            doc["member_id"] = entity_id.split(":", 1)[0]
        await db.audit_logs.insert_one(doc)
    except Exception as e:  # pragma: no cover — best-effort
        logger.warning("audit log failed for %s: %s", action, e)


async def log_login(*, username: str, success: bool, user: Optional[Dict[str, Any]] = None) -> None:
    """Convenience wrapper for login attempts."""
    await log_audit(
        actor=user or {"username": username},
        action="auth.login.success" if success else "auth.login.failure",
        entity_type="user",
        entity_id=(user or {}).get("id", "") if user else "",
        entity_name=username,
    )
