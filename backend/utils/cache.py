"""
Lightweight in-memory TTL cache for frequently-read, rarely-changed data.

Usage:
    from backend.utils.cache import cache_get, cache_set, cache_invalidate

    cached = cache_get("activities:all")
    if cached is not None:
        return cached
    data = await db.activities.find(...).to_list(1000)
    cache_set("activities:all", data, ttl=300)  # 5 minutes
    return data

    # On mutation:
    cache_invalidate("activities:")  # invalidates anything starting with this
"""

import time
import threading
from typing import Any, Optional

_cache_lock = threading.RLock()
_store: dict = {}  # key -> (expires_at_ts, value)


def cache_get(key: str) -> Optional[Any]:
    """Return cached value if present and not expired, else None."""
    with _cache_lock:
        entry = _store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at < time.time():
            _store.pop(key, None)
            return None
        return value


def cache_set(key: str, value: Any, ttl: int = 300) -> None:
    """Cache value under key for `ttl` seconds (default 5 min)."""
    with _cache_lock:
        _store[key] = (time.time() + ttl, value)


def cache_invalidate(prefix: str) -> int:
    """Remove all keys starting with `prefix`. Returns count removed."""
    with _cache_lock:
        keys = [k for k in _store.keys() if k.startswith(prefix)]
        for k in keys:
            _store.pop(k, None)
        return len(keys)


def cache_clear() -> None:
    """Drop the entire cache."""
    with _cache_lock:
        _store.clear()
