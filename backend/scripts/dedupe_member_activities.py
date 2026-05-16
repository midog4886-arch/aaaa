"""One-off cleanup: remove duplicate activity entries from member documents.

A duplicate is defined as two entries in ``member.activities`` sharing the
same (activity_id, start_date, end_date, status). The first occurrence is
kept; later duplicates are removed.

Side-effects handled:
- For each affected member, any **active** freeze with
  ``extension_records`` is rewritten so:
  * records pointing at removed indices are dropped (their extension was
    applied to a duplicate that now no longer exists, so the surviving
    activity keeps the days it already received -- equivalent to one-time
    extension instead of double),
  * remaining records are renumbered to the new positional indices,
  * ``total_extension_days`` is recomputed.
- Cancelled freezes are left as-is (their extensions were already undone).

Usage (one of --tenant <slug> or --all-tenants is REQUIRED so the script
never silently runs against the legacy default DB):
    python -m scripts.dedupe_member_activities --dry-run --tenant default
    python -m scripts.dedupe_member_activities --apply   --tenant acme
    python -m scripts.dedupe_member_activities --dry-run --all-tenants
    python -m scripts.dedupe_member_activities --apply   --all-tenants
"""
import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from database import db  # noqa: E402
from utils.tenant import (  # noqa: E402
    set_current_tenant,
    reset_current_tenant,
    list_active_tenants,
)


def dedupe_activities(activities: list) -> tuple:
    """Return (new_activities, index_map, removed_indices).

    index_map maps each old index -> new index (or None if removed).
    """
    seen: dict = {}
    new_activities = []
    index_map = {}
    removed = []
    for old_idx, act in enumerate(activities):
        key = (
            act.get("activity_id") or "",
            act.get("start_date") or "",
            act.get("end_date") or "",
            act.get("status") or "",
        )
        if key in seen:
            index_map[old_idx] = None
            removed.append(old_idx)
            continue
        seen[key] = old_idx
        index_map[old_idx] = len(new_activities)
        new_activities.append(act)
    return new_activities, index_map, removed


async def rebuild_freeze_records(member_id: str, index_map: dict, apply_changes: bool) -> list:
    """Rewrite extension_records for any active training-day freezes on this
    member to reflect the new activity index numbering. Returns a summary list."""
    summary = []
    cursor = db.member_freezes.find(
        {"member_id": member_id, "status": "active"}, {"_id": 0}
    )
    freezes = await cursor.to_list(50)
    for fz in freezes:
        records = fz.get("extension_records") or []
        if not records:
            continue
        new_records = []
        dropped = 0
        for rec in records:
            old_idx = rec.get("index")
            if not isinstance(old_idx, int):
                continue
            new_idx = index_map.get(old_idx)
            if new_idx is None:
                dropped += 1
                continue
            new_records.append({**rec, "index": new_idx})
        if dropped == 0 and len(new_records) == len(records):
            continue
        new_total = sum(int(r.get("days", 0) or 0) for r in new_records)
        summary.append({
            "freeze_id": fz.get("id"),
            "old_records": len(records),
            "new_records": len(new_records),
            "dropped": dropped,
            "old_total": fz.get("total_extension_days"),
            "new_total": new_total,
        })
        if apply_changes:
            await db.member_freezes.update_one(
                {"id": fz["id"]},
                {"$set": {
                    "extension_records": new_records,
                    "total_extension_days": new_total,
                    "deduped_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
    return summary


async def migrate(apply_changes: bool) -> dict:
    cursor = db.members.find({}, {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "member_code": 1, "activities": 1})
    members = await cursor.to_list(20000)

    summary = {
        "members_scanned": len(members),
        "members_with_dupes": 0,
        "rows_removed": 0,
        "freeze_records_rewritten": 0,
        "freezes_touched": 0,
        "details": [],
    }

    for m in members:
        activities = list(m.get("activities") or [])
        new_acts, index_map, removed = dedupe_activities(activities)
        if not removed:
            continue
        summary["members_with_dupes"] += 1
        summary["rows_removed"] += len(removed)

        removed_acts = [activities[i] for i in removed]
        member_detail = {
            "member_id": m.get("id"),
            "member_code": m.get("member_code"),
            "name": m.get("name_ar") or m.get("name") or "",
            "before_count": len(activities),
            "after_count": len(new_acts),
            "removed_indices": removed,
            "removed_activities": [
                {
                    "name": a.get("activity_name") or a.get("name"),
                    "end": a.get("end_date"),
                    "activity_id": a.get("activity_id"),
                }
                for a in removed_acts
            ],
            "freezes_rewritten": [],
        }

        if apply_changes:
            await db.members.update_one(
                {"id": m["id"]},
                {"$set": {"activities": new_acts}},
            )

        freeze_changes = await rebuild_freeze_records(m["id"], index_map, apply_changes)
        member_detail["freezes_rewritten"] = freeze_changes
        summary["freezes_touched"] += len(freeze_changes)
        summary["freeze_records_rewritten"] += sum(c["dropped"] for c in freeze_changes)

        summary["details"].append(member_detail)

    return summary


def print_summary(summary: dict, applied: bool) -> None:
    label = "APPLIED" if applied else "DRY-RUN"
    print(f"\n=== Member-activity dedupe ({label}) ===")
    print(f"  Members scanned:           {summary['members_scanned']}")
    print(f"  Members with duplicates:   {summary['members_with_dupes']}")
    print(f"  Total duplicate rows removed: {summary['rows_removed']}")
    print(f"  Freeze docs touched:       {summary['freezes_touched']}")
    print(f"  Freeze extension records dropped: {summary['freeze_records_rewritten']}")
    print()
    if not summary["details"]:
        print("  Nothing to do.")
        return
    for d in summary["details"]:
        print(f"  - {d['name']} (#{d['member_code']}): "
              f"{d['before_count']} → {d['after_count']} activities "
              f"(removed indices {d['removed_indices']})")
        for ra in d["removed_activities"]:
            print(f"       · drop: {ra['name']!r} end={ra['end']}")
        for fr in d["freezes_rewritten"]:
            print(f"       · freeze {fr['freeze_id'][:8]}: "
                  f"{fr['old_records']} → {fr['new_records']} records "
                  f"(dropped {fr['dropped']}), "
                  f"total_ext {fr['old_total']} → {fr['new_total']}")


async def main():
    parser = argparse.ArgumentParser(
        description="Dedupe member activities. Must run against an explicit tenant."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--tenant", help="Tenant slug to operate on (e.g. 'default')")
    scope.add_argument("--all-tenants", action="store_true", help="Run against every active tenant")
    args = parser.parse_args()
    apply_changes = bool(args.apply)

    async def _run_for(tenant_dict):
        token = set_current_tenant(tenant_dict)
        try:
            print(f"\n>>> Tenant: {tenant_dict.get('slug')} (db={tenant_dict.get('db_name')})")
            summary = await migrate(apply_changes=apply_changes)
            print_summary(summary, applied=apply_changes)
        finally:
            reset_current_tenant(token)

    if args.all_tenants:
        tenants = await list_active_tenants()
        if not tenants:
            print("No active tenants found.")
            return
        for t in tenants:
            await _run_for(t)
    else:
        tenants = await list_active_tenants()
        match = next((t for t in tenants if t.get("slug") == args.tenant), None)
        if not match:
            print(f"Tenant '{args.tenant}' not found (or not active). Active tenants: "
                  f"{[t.get('slug') for t in tenants]}")
            sys.exit(2)
        await _run_for(match)


if __name__ == "__main__":
    asyncio.run(main())
