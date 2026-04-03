"""
Per-branch sequence utilities.
Each branch owns an exclusive block of SEQ_BLOCK_SIZE numbers per sequence type.
  Branch index 0 → base .. base + BLOCK_SIZE - 1
  Branch index 1 → base + BLOCK_SIZE .. base + 2*BLOCK_SIZE - 1
  …
This guarantees numbers never collide across branches.
"""

from database import db

SEQ_BLOCK_SIZE = 100_000
SEQ_BASES = {"member": 10_001, "invoice": 30_001, "reg": 10_001}


async def get_branch_seq_start(branch_id: str, seq_type: str) -> int:
    """Return (and persist) the exclusive start number for branch + type."""
    base = SEQ_BASES.get(seq_type, 10_001)
    if not branch_id:
        return base

    field = f"{seq_type}_seq_start"
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0})
    if not branch:
        return base

    if branch.get(field):
        return int(branch[field])

    # First time – derive block from creation order and persist it
    all_branches = await db.branches.find(
        {}, {"id": 1, "created_at": 1, "_id": 0}
    ).to_list(500)
    all_branches.sort(key=lambda b: b.get("created_at", ""))
    idx = next((i for i, b in enumerate(all_branches) if b["id"] == branch_id), 0)
    seq_start = base + idx * SEQ_BLOCK_SIZE
    await db.branches.update_one({"id": branch_id}, {"$set": {field: seq_start}})
    return seq_start


async def assign_seq_starts_for_new_branch(branch_id: str):
    """Call right after inserting a new branch to lock in its sequence blocks."""
    for seq_type in SEQ_BASES:
        await get_branch_seq_start(branch_id, seq_type)
