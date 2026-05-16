"""
Per-branch member code generator: {PREFIX}-NNN starting from 001 within each branch.

Allocation is atomic via `branch_counters` with `$inc` + upsert so that
concurrent requests in the same branch+prefix always get distinct numbers.
Existing legacy numeric `member_code` values are not migrated — the counter
is seeded once from the current max suffix of `{PREFIX}-\\d+` codes in that
branch (if any) so legacy and new codes coexist.
"""

import re
from database import db


def sanitize_prefix(value: str) -> str:
    if not value:
        return ""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", str(value)).upper()
    return cleaned[:8]


async def get_branch_code_prefix(branch_id: str) -> str:
    if not branch_id:
        return "BR"
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        return "BR"
    prefix = sanitize_prefix(branch.get("code_prefix") or "")
    if prefix:
        return prefix
    all_branches = await db.branches.find(
        {}, {"id": 1, "created_at": 1, "_id": 0}
    ).to_list(500)
    all_branches.sort(key=lambda b: b.get("created_at", ""))
    idx = next((i for i, b in enumerate(all_branches) if b["id"] == branch_id), 0)
    return f"B{idx + 1}"


async def _seed_counter_from_existing(branch_id: str, prefix: str) -> int:
    branch_filter = {"branch_id": branch_id} if branch_id else {}
    regex = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    cursor = db.members.find(
        {
            "member_code": {"$regex": f"^{re.escape(prefix)}-\\d+$"},
            **branch_filter,
        },
        {"member_code": 1, "_id": 0},
    )
    max_num = 0
    async for m in cursor:
        match = regex.match(m.get("member_code") or "")
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
    prefix = await get_branch_code_prefix(branch_id)
    counter_id = f"member:{branch_id or 'global'}:{prefix}"
    existing = await db.branch_counters.find_one({"_id": counter_id})
    if not existing:
        seed = await _seed_counter_from_existing(branch_id, prefix)
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
    code = f"{prefix}-{next_num:03d}"
    if branch_id:
        clash = await db.members.find_one(
            {"member_code": code, "branch_id": branch_id},
            {"_id": 1},
        )
        if clash:
            return await generate_member_code(branch_id)
    return code
