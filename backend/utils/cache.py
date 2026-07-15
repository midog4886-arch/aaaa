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

import asyncio
import time
import threading
from typing import Any, Awaitable, Callable, Optional

_cache_lock = threading.RLock()
_store: dict = {}  # key -> (expires_at_ts, value)
_swr_inflight: set = set()  # keys currently being refreshed in background
_swr_tasks: set = set()  # strong refs so background refresh tasks aren't GC'd


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


def invalidate_dashboard_caches() -> None:
    """Drop the current tenant's SWR dashboard caches (today-summary, stats,
    expiring report) so mutations like paying an invoice, freezing a member,
    or adding a member show up immediately instead of after the fresh TTL."""
    from utils.tenant import get_current_tenant_slug
    slug = get_current_tenant_slug()
    for prefix in ("todaysum:", "dashstats:", "expiring:"):
        cache_invalidate(f"{prefix}{slug}:")


async def cache_swr(
    key: str,
    loader: Callable[[], Awaitable[Any]],
    fresh_ttl: int = 60,
    stale_ttl: int = 600,
) -> Any:
    """Stale-while-revalidate cache.

    - Cache hit younger than `fresh_ttl`: return it immediately.
    - Cache hit older than `fresh_ttl` but younger than `stale_ttl`: return the
      stale value immediately AND refresh it in a background task (deduped per
      key), so the next caller gets fresh data without anyone paying the wait.
    - Miss (or older than `stale_ttl`): await `loader()` and cache the result.

    The background task inherits the caller's contextvars (tenant context), so
    tenant-scoped DB proxies keep working inside `loader`.
    """
    now = time.time()
    with _cache_lock:
        entry = _store.get(key)
    if entry is not None:
        expires_at, wrapped = entry
        if expires_at >= now and isinstance(wrapped, tuple) and len(wrapped) == 2:
            fetched_at, value = wrapped
            if now - fetched_at >= fresh_ttl:
                _swr_spawn_refresh(key, loader, stale_ttl)
            return value
    value = await loader()
    with _cache_lock:
        _store[key] = (time.time() + stale_ttl, (time.time(), value))
    return value


def _swr_spawn_refresh(key: str, loader: Callable[[], Awaitable[Any]], stale_ttl: int) -> None:
    with _cache_lock:
        if key in _swr_inflight:
            return
        _swr_inflight.add(key)

    async def _run():
        try:
            value = await loader()
            with _cache_lock:
                _store[key] = (time.time() + stale_ttl, (time.time(), value))
        except Exception:
            pass  # keep serving the stale value; next expiry forces a real load
        finally:
            with _cache_lock:
                _swr_inflight.discard(key)

    try:
        asyncio.get_running_loop()
        task = asyncio.ensure_future(_run())
        _swr_tasks.add(task)
        task.add_done_callback(_swr_tasks.discard)
    except RuntimeError:
        with _cache_lock:
            _swr_inflight.discard(key)
