"""
Renumber every member in the current tenant database so the numeric suffix
of their member_code is globally unique across all branches.

New format: {ACADEMY}-{BRANCH_PREFIX}-{NNNN}
where NNNN is a globally-unique sequence assigned in (created_at, id) order.

Updates (matched by member_id, not by old code string, so cross-branch
duplicates do not collide):
  - members.member_code
  - attendance.member_code
  - invoices.member_code
  - registration_forms.member_code

Also rewrites branch_counters to a single global counter so future
generate_member_code() calls keep producing globally-unique numbers.

Run:
  cd backend && DB_NAME=champions_default python scripts/renumber_members_globally.py --apply

Without --apply it prints a dry-run mapping table only.
"""
import asyncio
import argparse
import os
import sys
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


DEFAULT_ACADEMY_PREFIX = "DEFA"


def _sort_key(m):
    created = m.get("created_at") or ""
    if isinstance(created, datetime):
        created_iso = created.isoformat()
    else:
        created_iso = str(created)
    return (created_iso, str(m.get("id") or ""))


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually write changes")
    parser.add_argument("--db", default=os.environ.get("DB_NAME", "champions_default"))
    parser.add_argument(
        "--academy", default=os.environ.get("ACADEMY_PREFIX", DEFAULT_ACADEMY_PREFIX)
    )
    args = parser.parse_args()

    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        print("ERROR: MONGO_URL env var is required")
        sys.exit(1)

    client = AsyncIOMotorClient(mongo_url)
    db = client[args.db]

    # 1. Load branch prefixes
    branches = {}
    async for b in db.branches.find({}, {"_id": 0, "id": 1, "code_prefix": 1}):
        branches[b["id"]] = (b.get("code_prefix") or "BR").strip() or "BR"

    # 2. Load all members in deterministic order
    members = []
    async for m in db.members.find(
        {}, {"_id": 0, "id": 1, "member_code": 1, "branch_id": 1, "name_ar": 1, "created_at": 1}
    ):
        members.append(m)
    members.sort(key=_sort_key)

    print(f"Loaded {len(members)} members across {len(branches)} branches.")
    print(f"Academy prefix: {args.academy}")
    print()

    # 3. Build mapping
    mapping = []  # list of dicts
    used = set()
    seq = 0
    for m in members:
        seq += 1
        branch_prefix = branches.get(m.get("branch_id"), "BR")
        new_code = f"{args.academy}-{branch_prefix}-{seq:04d}"
        if new_code in used:
            # extremely unlikely (would require duplicate (branch,seq) → impossible since seq is global)
            raise RuntimeError(f"Collision generating new code {new_code}")
        used.add(new_code)
        mapping.append({
            "member_id": m["id"],
            "old_code": m.get("member_code") or "",
            "new_code": new_code,
            "branch_id": m.get("branch_id"),
            "name_ar": m.get("name_ar") or "",
            "seq": seq,
        })

    # 4. Print preview (first 5 + last 5)
    print(f"--- Preview (showing first 5 and last 5 of {len(mapping)}) ---")
    for row in mapping[:5] + (["…"] if len(mapping) > 10 else []) + mapping[-5:]:
        if row == "…":
            print("  …")
            continue
        print(
            f"  seq={row['seq']:4d}  {row['old_code']:18} -> {row['new_code']:20}  "
            f"({row['name_ar'][:25]})"
        )
    print()

    if not args.apply:
        print("DRY RUN — no changes written. Re-run with --apply to commit.")
        return

    # 5. Backup mapping in dedicated collection
    backup_coll = db["_member_code_renumber_backup"]
    backup_doc = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "academy": args.academy,
        "count": len(mapping),
        "entries": mapping,
    }
    await backup_coll.insert_one(backup_doc)
    print(f"✓ Backup written to _member_code_renumber_backup")

    # 6. Apply updates per collection, matched by member_id
    updated_members = 0
    updated_attendance = 0
    updated_invoices = 0
    updated_forms = 0
    for row in mapping:
        mid = row["member_id"]
        nc = row["new_code"]
        res = await db.members.update_one({"id": mid}, {"$set": {"member_code": nc}})
        updated_members += res.modified_count

        res = await db.attendance.update_many(
            {"member_id": mid}, {"$set": {"member_code": nc}}
        )
        updated_attendance += res.modified_count

        res = await db.invoices.update_many(
            {"member_id": mid}, {"$set": {"member_code": nc}}
        )
        updated_invoices += res.modified_count

        res = await db.registration_forms.update_many(
            {"member_id": mid}, {"$set": {"member_code": nc}}
        )
        updated_forms += res.modified_count

    print(f"✓ members updated: {updated_members}")
    print(f"✓ attendance updated: {updated_attendance}")
    print(f"✓ invoices updated: {updated_invoices}")
    print(f"✓ registration_forms updated: {updated_forms}")

    # 7. Rewrite branch_counters: drop old per-branch member counters,
    #    install one global counter at the current max seq.
    del_res = await db.branch_counters.delete_many(
        {"_id": {"$regex": r"^member:"}}
    )
    global_counter_id = f"member:global:{args.academy}"
    await db.branch_counters.update_one(
        {"_id": global_counter_id},
        {"$set": {"seq": len(mapping)}},
        upsert=True,
    )
    print(
        f"✓ branch_counters: removed {del_res.deleted_count} old member counters, "
        f"installed {global_counter_id} = {len(mapping)}"
    )

    print("\n✓ Renumber complete.")


if __name__ == "__main__":
    asyncio.run(main())
