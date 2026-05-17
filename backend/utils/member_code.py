"""
Member code generator.

New format (since the multi-academy update):
  ``{ACADEMY_PREFIX}-{BRANCH_PREFIX}-{NNNN}``  e.g. ``ABTL-RUH-0042``

Globally unique across the entire platform because:
  - ``academy_prefix`` is unique across ``control_db.tenants``
  - ``branch.code_prefix`` is unique within the tenant
  - the per-(academy, branch) serial is allocated atomically via
    ``branch_counters`` with ``$inc`` + upsert.

Legacy ``{BRANCH_PREFIX}-NNN`` codes already stored on existing members are
preserved as-is; only newly-created members receive the new 3-part format.
"""

import re
from database import db


def sanitize_prefix(value: str) -> str:
    if not value:
        return ""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", str(value)).upper()
    return cleaned[:8]


async def _ensure_branch_prefix(branch_id: str) -> str:
    """Return the branch's ``code_prefix``, auto-generating + persisting it
    if missing so legacy branches keep working transparently."""
    if not branch_id:
        return "BR"
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        return "BR"
    existing = sanitize_prefix(branch.get("code_prefix") or "")
    if existing:
        return existing
    from utils.prefix_gen import pick_unique_branch_prefix, update_with_unique_prefix
    new_prefix = await update_with_unique_prefix(
        db.branches,
        {"id": branch_id},
        "code_prefix",
        lambda: pick_unique_branch_prefix(
            name_latin=branch.get("name") or "",
            name_ar=branch.get("name_ar") or "",
            exclude_id=branch_id,
        ),
    )
    return new_prefix


async def _ensure_academy_prefix() -> str:
    """Return the current tenant's ``academy_prefix``, auto-generating +
    persisting it on ``control_db.tenants`` if missing."""
    from utils.tenant import get_current_tenant
    from control_db import control_db
    from utils.prefix_gen import pick_unique_academy_prefix

    tenant = get_current_tenant() or {}
    existing = sanitize_prefix(tenant.get("academy_prefix") or "")
    if existing:
        return existing

    slug = tenant.get("slug") or ""
    name = tenant.get("name") or ""
    tenant_id = tenant.get("id")
    if tenant_id:
        from utils.prefix_gen import update_with_unique_prefix
        new_prefix = await update_with_unique_prefix(
            control_db.tenants,
            {"id": tenant_id},
            "academy_prefix",
            lambda: pick_unique_academy_prefix(slug=slug, name=name),
        )
        tenant["academy_prefix"] = new_prefix
    else:
        new_prefix = await pick_unique_academy_prefix(slug=slug, name=name)
    return new_prefix


async def get_branch_code_prefix(branch_id: str) -> str:
    return await _ensure_branch_prefix(branch_id)


async def _seed_counter_from_existing(branch_id: str, academy: str, branch_prefix: str) -> int:
    branch_filter = {"branch_id": branch_id} if branch_id else {}
    full_re = re.compile(
        rf"^{re.escape(academy)}-{re.escape(branch_prefix)}-(\d+)$"
    )
    cursor = db.members.find(
        {
            "member_code": {
                "$regex": f"^{re.escape(academy)}-{re.escape(branch_prefix)}-\\d+$"
            },
            **branch_filter,
        },
        {"member_code": 1, "_id": 0},
    )
    max_num = 0
    async for m in cursor:
        match = full_re.match(m.get("member_code") or "")
        if not match:
            continue
        try:
            n = int(match.group(1))
        except (ValueError, TypeError):
            continue
        if n > max_num:
            max_num = n
    return max_num


async def generate_member_code(branch_id: str) -> str:
    academy = await _ensure_academy_prefix()
    branch_prefix = await _ensure_branch_prefix(branch_id)

    counter_id = f"member:{branch_id or 'global'}:{academy}:{branch_prefix}"
    existing = await db.branch_counters.find_one({"_id": counter_id})
    if not existing:
        seed = await _seed_counter_from_existing(branch_id, academy, branch_prefix)
        try:
            await db.branch_counters.insert_one({"_id": counter_id, "seq": seed})
        except Exception:
            pass

    result = await db.branch_counters.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    next_num = int(result.get("seq", 1)) if result else 1
    code = f"{academy}-{branch_prefix}-{next_num:04d}"

    clash = await db.members.find_one({"member_code": code}, {"_id": 1})
    if clash:
        return await generate_member_code(branch_id)
    return code
