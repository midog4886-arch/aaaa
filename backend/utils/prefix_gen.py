"""
Prefix generators for academy and branch member codes.

Academy prefix:
  - Derived from tenant slug (already lowercase Latin alphanumeric).
  - 3-4 chars, uppercased.
  - Globally unique across ``control_db.tenants``.

Branch prefix:
  - Derived from branch latin name first, then sequential B{N} fallback.
  - 2-4 chars, uppercased.
  - Unique within the current tenant's ``branches`` collection.
"""
import re
from typing import Optional

from database import db


_NON_ALNUM = re.compile(r"[^A-Za-z0-9]")


def _sanitize(value: str) -> str:
    if not value:
        return ""
    return _NON_ALNUM.sub("", str(value)).upper()


def _base_from_slug(slug: str, name: str = "") -> str:
    base = _sanitize(slug)
    if not base:
        base = _sanitize(name)
    if not base:
        base = "ACAD"
    return base


async def pick_unique_academy_prefix(slug: str, name: str = "") -> str:
    """Allocate a globally-unique 3-4 char academy prefix."""
    from control_db import control_db

    base = _base_from_slug(slug, name)
    for length in (4, 5, 6, 7, 8):
        candidate = base[:length] if len(base) >= length else base
        if not candidate:
            continue
        clash = await control_db.tenants.find_one(
            {"academy_prefix": candidate},
            {"_id": 1},
        )
        if not clash:
            return candidate
    stem = base[:4] if len(base) >= 4 else base
    for n in range(2, 1000):
        candidate = f"{stem}{n}"[:8]
        clash = await control_db.tenants.find_one(
            {"academy_prefix": candidate},
            {"_id": 1},
        )
        if not clash:
            return candidate
    raise RuntimeError("Could not allocate unique academy prefix")


async def _branch_prefix_exists(candidate: str, exclude_id: Optional[str] = None) -> bool:
    query = {"code_prefix": candidate}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    existing = await db.branches.find_one(query, {"_id": 1})
    return existing is not None


async def pick_unique_branch_prefix(
    name_latin: str = "",
    name_ar: str = "",
    exclude_id: Optional[str] = None,
) -> str:
    """Allocate a branch prefix unique within the current tenant.

    Tries the first 3 chars of the latin name, then the arabic name (after
    sanitisation usually empty), then falls back to ``B{N}`` sequential.
    """
    for candidate_source in (name_latin, name_ar):
        base = _sanitize(candidate_source)
        if not base:
            continue
        for length in (3, 4, 5):
            candidate = base[:length] if len(base) >= length else base
            if not candidate:
                continue
            if not await _branch_prefix_exists(candidate, exclude_id):
                return candidate

    count = await db.branches.count_documents({})
    for n in range(count + 1, count + 1000):
        candidate = f"B{n}"
        if not await _branch_prefix_exists(candidate, exclude_id):
            return candidate
    raise RuntimeError("Could not allocate unique branch prefix")
