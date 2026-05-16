"""One-off migration: convert legacy calendar-day freezes to the new
training-day calculation. For each non-cancelled freeze without
``calculation_mode == "training_days"``:

- Recompute per-activity extension using the activity's weekly schedule.
- Compare against the legacy applied amount (``duration_days`` calendar days
  added to every activity at create time).
- Subtract the over-extension difference from each activity's ``end_date``.
- Stamp the freeze doc with ``extension_records``, ``total_extension_days``,
  ``calculation_mode = "training_days"`` and ``migrated_at``.

Cancelled freezes are simply tagged ``calculation_mode = "legacy_calendar"``
so they're skipped on subsequent runs (their effect was already undone at
cancellation time using the old logic).

Usage:
    python -m scripts.migrate_freezes_to_training_days --dry-run
    python -m scripts.migrate_freezes_to_training_days --apply
"""
import argparse
import asyncio
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from database import db  # noqa: E402
from routes.attendance import parse_schedule_days  # noqa: E402
from routes.freezes import (  # noqa: E402
    compute_activity_extension,
)
from utils.tenant import (  # noqa: E402
    set_current_tenant,
    reset_current_tenant,
    list_active_tenants,
)


def build_extension_records(freeze: dict, activities: list) -> list:
    """Compute what the new training-day extension records would be for the
    given freeze + current activities snapshot."""
    duration_days = int(freeze.get("duration_days", 0) or 0)
    records = []
    for i, act in enumerate(activities):
        act_end = act.get("end_date", "")
        if not act_end:
            continue
        try:
            datetime.strptime(act_end, "%Y-%m-%d")
        except ValueError:
            continue
        new_ext = compute_activity_extension(
            act, freeze["start_date"], freeze["end_date"], duration_days
        )
        records.append({
            "index": i,
            "activity_id": act.get("activity_id") or act.get("id") or "",
            "schedule": act.get("schedule", ""),
            "days": int(new_ext),
        })
    return records


async def migrate(apply_changes: bool) -> dict:
    legacy_filter = {
        "$or": [
            {"calculation_mode": {"$exists": False}},
            {"calculation_mode": {"$ne": "training_days"}},
        ]
    }
    cursor = db.member_freezes.find(legacy_filter, {"_id": 0})
    legacy_freezes = await cursor.to_list(10000)

    summary = {
        "total_legacy": len(legacy_freezes),
        "cancelled_tagged": 0,
        "active_migrated": 0,
        "members_updated": 0,
        "skipped_member_missing": 0,
        "total_days_reduced": 0,
        "details": [],
    }

    for freeze in legacy_freezes:
        fid = freeze.get("id", "?")
        status = freeze.get("status", "")
        member_id = freeze.get("member_id", "")
        duration_days = int(freeze.get("duration_days", 0) or 0)

        if status == "cancelled":
            summary["cancelled_tagged"] += 1
            if apply_changes:
                await db.member_freezes.update_one(
                    {"id": fid},
                    {"$set": {"calculation_mode": "legacy_calendar"}},
                )
            continue

        member = await db.members.find_one({"id": member_id}, {"_id": 0})
        if not member:
            summary["skipped_member_missing"] += 1
            continue

        activities = list(member.get("activities", []))
        records = build_extension_records(freeze, activities)

        # Apply per-activity reduction = (old_calendar - new_training).
        per_activity_changes = []
        new_activities = [dict(a) for a in activities]
        for rec in records:
            idx = rec["index"]
            new_ext = rec["days"]
            old_ext = duration_days
            diff = old_ext - new_ext
            if diff <= 0:
                continue
            act = new_activities[idx]
            act_end = act.get("end_date", "")
            if not act_end:
                continue
            try:
                act_end_dt = datetime.strptime(act_end, "%Y-%m-%d")
            except ValueError:
                continue
            new_end_dt = act_end_dt - timedelta(days=diff)
            new_activities[idx]["end_date"] = new_end_dt.strftime("%Y-%m-%d")
            per_activity_changes.append({
                "activity_index": idx,
                "activity_name": act.get("name") or act.get("name_ar") or "",
                "schedule": act.get("schedule", ""),
                "old_end": act_end,
                "new_end": new_activities[idx]["end_date"],
                "old_ext_calendar": old_ext,
                "new_ext_training": new_ext,
                "days_returned": diff,
            })

        total_returned = sum(c["days_returned"] for c in per_activity_changes)
        summary["total_days_reduced"] += total_returned

        detail = {
            "freeze_id": fid,
            "member_id": member_id,
            "member_name": member.get("name_ar") or member.get("name") or "",
            "status": status,
            "start_date": freeze.get("start_date"),
            "end_date": freeze.get("end_date"),
            "duration_days": duration_days,
            "new_total_extension_days": sum(r["days"] for r in records),
            "activities_changed": per_activity_changes,
        }
        summary["details"].append(detail)

        if apply_changes:
            if per_activity_changes:
                await db.members.update_one(
                    {"id": member_id},
                    {"$set": {"activities": new_activities}},
                )
                summary["members_updated"] += 1
            await db.member_freezes.update_one(
                {"id": fid},
                {"$set": {
                    "calculation_mode": "training_days",
                    "extension_records": records,
                    "total_extension_days": sum(r["days"] for r in records),
                    "migrated_at": datetime.now(timezone.utc).isoformat(),
                    "legacy_extension_days": duration_days,
                }},
            )
            summary["active_migrated"] += 1
        else:
            if per_activity_changes:
                summary["members_updated"] += 1
            summary["active_migrated"] += 1

    return summary


def print_summary(summary: dict, apply_changes: bool) -> None:
    label = "APPLIED" if apply_changes else "DRY-RUN"
    print(f"\n=== Freeze migration ({label}) ===")
    print(f"  Legacy freezes found:        {summary['total_legacy']}")
    print(f"  Cancelled (tagged only):     {summary['cancelled_tagged']}")
    print(f"  Active migrated:             {summary['active_migrated']}")
    print(f"  Members with date changes:   {summary['members_updated']}")
    print(f"  Skipped (member missing):    {summary['skipped_member_missing']}")
    print(f"  Total calendar days returned to subscriptions: "
          f"{summary['total_days_reduced']}")
    print()
    if not summary["details"]:
        print("  No active legacy freezes to migrate.")
        return
    print(f"  Per-freeze breakdown ({len(summary['details'])}):")
    for d in summary["details"]:
        ch = d["activities_changed"]
        if not ch:
            print(f"   - {d['freeze_id'][:8]} | {d['member_name']} "
                  f"({d['start_date']} → {d['end_date']}, {d['duration_days']}d) "
                  f"— no per-activity reduction "
                  f"(new total = {d['new_total_extension_days']})")
            continue
        print(f"   - {d['freeze_id'][:8]} | {d['member_name']} "
              f"({d['start_date']} → {d['end_date']}, {d['duration_days']}d) "
              f"— new total = {d['new_total_extension_days']}d:")
        for c in ch:
            print(f"       · activity[{c['activity_index']}] {c['activity_name']!r} "
                  f"({c['schedule'] or 'no schedule'}): "
                  f"{c['old_end']} → {c['new_end']} "
                  f"(returned {c['days_returned']}d, "
                  f"old cal={c['old_ext_calendar']}, new train={c['new_ext_training']})")


async def main():
    parser = argparse.ArgumentParser(
        description="Migrate legacy freezes. Must run against an explicit tenant."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Preview changes only.")
    mode.add_argument("--apply", action="store_true", help="Apply the migration.")
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
            print_summary(summary, apply_changes=apply_changes)
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
