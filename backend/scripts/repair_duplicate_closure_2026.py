"""One-time, reviewed repair for duplicate activity rows and missed closures.

Defaults to a read-only preview. ``--apply`` requires the expected production
database and aborts if any member, invoice, freeze, or closure changed. The
entire repair is committed in one MongoDB transaction with a database backup.
"""
import argparse
import copy
import os
import uuid
from datetime import datetime, timezone

from pymongo import MongoClient

from routes.day_extensions import find_new_end_date, parse_schedule_days
from utils.effective_periods import invoice_item_key, original_window, source_key


DATABASE = "champions_default"
SEPTEMBER_CLOSURE = "1bd7d9a9-c35f-4182-8d5c-49416950f8a6"
REPAIR_ID = "duplicate-closure-repair-2026-10-07-v1"

# The first row has the invoice fee and/or the previously recorded extension.
# The second row is a duplicate projection, not a second paid subscription.
CASES = {
    "DEFA-B7-0051": ("2026-08-31", "2026-08-31", None),
    "DEFA-B5-0016": ("2026-10-21", "2026-10-21", None),
    "DEFA-B7-0210": ("2026-10-12", "2026-10-12", SEPTEMBER_CLOSURE),
    "DEFA-B5-0015": ("2026-10-21", "2026-10-21", None),
    "DEFA-B7-0211": ("2026-10-12", "2026-10-12", SEPTEMBER_CLOSURE),
    "DEFA-B11-0635": ("2026-10-06", "2026-10-06", None),
    "DEFA-B7-0227": ("2026-10-07", "2026-10-05", SEPTEMBER_CLOSURE),
    "DEFA-B7-0228": ("2026-10-07", "2026-10-05", SEPTEMBER_CLOSURE),
}


def plan_member(db, code, expected, session=None):
    opts = {"session": session} if session is not None else {}
    member = db.members.find_one({"member_code": code}, **opts)
    if not member:
        raise ValueError(f"{code}: member not found")
    activities = member.get("activities") or []
    if len(activities) != 2:
        raise ValueError(f"{code}: expected exactly two activity rows")
    keep, remove = activities
    expected_keep_end, expected_remove_end, closure_id = expected
    if (keep.get("end_date"), remove.get("end_date")) != (expected_keep_end, expected_remove_end):
        raise ValueError(f"{code}: activity deadlines changed")
    fields = ("activity_id", "start_date", "source", "source_id", "schedule", "status")
    if any(keep.get(field) != remove.get(field) for field in fields):
        raise ValueError(f"{code}: rows are not the expected duplicate source")
    if keep.get("source") != "invoice" or not keep.get("source_id"):
        raise ValueError(f"{code}: invoice source is missing")
    invoice = db.invoices.find_one({"id": keep["source_id"], "status": "paid"}, **opts)
    if not invoice:
        raise ValueError(f"{code}: source invoice is not paid")
    owned_items = [(index, item) for index, item in enumerate(invoice.get("items") or [])
                   if item.get("activity_id") == keep.get("activity_id")
                   and (item.get("member_id") or invoice.get("member_id")) == member["id"]]
    if len(owned_items) != 1 or keep.get("fee") != owned_items[0][1].get("fee"):
        raise ValueError(f"{code}: kept row does not match the paid invoice fee")
    index, item = owned_items[0]
    freezes = list(db.member_freezes.find({"member_id": member["id"], "status": "active"}, **opts))
    updated_freezes = []
    for freeze in freezes:
        records = freeze.get("extension_records")
        if not isinstance(records, list):
            continue
        new_records = [r for r in records if r.get("index") != 1]
        if len(new_records) != len(records):
            updated_freezes.append((freeze, new_records))

    result = {
        "member": member, "invoice": invoice, "item_index": index, "item": item,
        "kept_activity": copy.deepcopy(keep), "removed_activity": remove,
        "freezes": updated_freezes, "closure": None, "extension": None,
    }
    if closure_id:
        closure = db.closures.find_one({"id": closure_id, "applied": True}, **opts)
        day = "2026-09-23"
        if not closure or closure.get("branch_id") != member.get("branch_id"):
            raise ValueError(f"{code}: closure or branch changed")
        if closure.get("start_date") != day or closure.get("end_date") != day:
            raise ValueError(f"{code}: closure dates changed")
        if any(row.get("member_id") == member["id"] for row in closure.get("affected_members") or []):
            raise ValueError(f"{code}: closure already includes member")
        if db.day_extensions.find_one({"member_id": member["id"], "compensated_dates": day}, **opts):
            raise ValueError(f"{code}: day already compensated")
        if db.member_freezes.find_one({"member_id": member["id"], "status": "active",
                                       "start_date": {"$lte": day}, "end_date": {"$gte": day}}, **opts):
            raise ValueError(f"{code}: day is frozen")
        if db.attendance.find_one({"member_id": member["id"], "date": day}, **opts):
            raise ValueError(f"{code}: member attended on closure day")
        days = parse_schedule_days(keep.get("schedule") or "")
        if not days or datetime.fromisoformat(day).weekday() not in days:
            raise ValueError(f"{code}: closure is not a training day")
        new_end = find_new_end_date(datetime.fromisoformat(expected_keep_end), 1, days).strftime("%Y-%m-%d")
        result["kept_activity"]["end_date"] = new_end
        if " - " in (result["kept_activity"].get("period") or ""):
            result["kept_activity"]["period"] = result["kept_activity"]["period"].split(" - ")[0] + " - " + new_end
        result["closure"] = closure
        result["extension"] = {"old_end_date": expected_keep_end, "new_end_date": new_end,
                               "compensated_dates": [day], "activity_id": keep["activity_id"]}
    return result


def apply_plan(db, code, plan, session):
    member = plan["member"]
    now = datetime.now(timezone.utc).isoformat()
    result = db.members.update_one(
        {"_id": member["_id"], "activities": member["activities"]},
        {"$set": {"activities": [plan["kept_activity"]]}}, session=session,
    )
    if result.modified_count != 1:
        raise RuntimeError(f"{code}: member changed during repair")
    for freeze, records in plan["freezes"]:
        db.member_freezes.update_one(
            {"_id": freeze["_id"], "extension_records": freeze["extension_records"]},
            {"$set": {"extension_records": records,
                      "total_extension_days": sum(int(r.get("days") or 0) for r in records),
                      "deduped_at": now}}, session=session,
        )
    if plan["extension"]:
        ext = plan["extension"]
        closure = plan["closure"]
        activity = plan["kept_activity"]
        db.day_extensions.insert_one({
            "id": str(uuid.uuid4()), "scope_type": "activity", "closure_id": closure["id"],
            "closure_title": closure.get("title_ar") or closure.get("title_en") or "",
            "member_id": member["id"], "member_name": member.get("name_ar") or member.get("name") or "",
            "member_code": code, "branch_id": member.get("branch_id") or "",
            "activity_id": ext["activity_id"], "activity_name": activity.get("activity_name") or "",
            "old_end_date": ext["old_end_date"], "new_end_date": ext["new_end_date"],
            "missed_sessions": 1, "compensated_dates": ext["compensated_dates"],
            "schedule": activity.get("schedule") or "", "mode": "training_days",
            "applied_by": REPAIR_ID, "applied_at": now,
        }, session=session)
        summary = {
            "member_id": member["id"], "id": member["id"],
            "name": member.get("name_ar") or member.get("name") or "",
            "branch_id": member.get("branch_id") or "",
            "details": [{"activity": activity.get("activity_name") or "",
                         "old_end": ext["old_end_date"], "new_end": ext["new_end_date"],
                         "missed_sessions": 1}],
            "activity_changes": [{"activity_id": ext["activity_id"],
                                  "activity_name": activity.get("activity_name") or "",
                                  "old_end_date": ext["old_end_date"],
                                  "new_end_date": ext["new_end_date"], "missed_sessions": 1}],
        }
        closure_result = db.closures.update_one(
            {"_id": closure["_id"], "affected_members.member_id": {"$ne": member["id"]}},
            {"$push": {"affected_members": summary}, "$inc": {"applied_count": 1}},
            session=session,
        )
        if closure_result.modified_count != 1:
            raise RuntimeError(f"{code}: closure changed during repair")
        invoice, item, index = plan["invoice"], plan["item"], plan["item_index"]
        original_start, original_end = original_window(item)
        period_key = source_key(invoice, item, index)
        db.subscription_effective_periods.replace_one(
            {"source_key": period_key}, {
                "source_key": period_key, "source_invoice_id": invoice["id"],
                "source_item_id": invoice_item_key(invoice, item, index),
                "member_id": member["id"], "activity_id": ext["activity_id"],
                "original_start_date": original_start, "original_end_date": original_end,
                "effective_start_date": activity.get("start_date"),
                "effective_end_date": ext["new_end_date"],
                "schedule": activity.get("schedule") or "", "source_bound_quota": True,
                "updated_at": now, "updated_by_closure_id": closure["id"],
            }, upsert=True, session=session,
        )
    db.extension_logs.insert_one({
        "id": str(uuid.uuid4()), "type": "data_repair", "repair_id": REPAIR_ID,
        "member_id": member["id"], "member_code": code,
        "closure_id": plan["closure"]["id"] if plan["closure"] else None,
        "created_at": now,
    }, session=session)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Commit after a reviewed dry run")
    args = parser.parse_args()
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[DATABASE]
    if db.migration_backups.find_one({"repair_id": REPAIR_ID}):
        raise SystemExit("Repair already applied; no changes made")
    preview = {code: plan_member(db, code, expected) for code, expected in CASES.items()}
    for code, plan in preview.items():
        ext = plan["extension"]
        print(code, "keep_fee", plan["kept_activity"].get("fee"),
              "removed_fee", plan["removed_activity"].get("fee"),
              "old_end", ext["old_end_date"] if ext else plan["kept_activity"].get("end_date"),
              "new_end", ext["new_end_date"] if ext else plan["kept_activity"].get("end_date"),
              "freeze_docs", len(plan["freezes"]))
    if not args.apply:
        print("DRY RUN ONLY; no data changed")
        return
    with client.start_session() as session:
        with session.start_transaction():
            plans = {code: plan_member(db, code, expected, session=session)
                     for code, expected in CASES.items()}
            backup = {
                "repair_id": REPAIR_ID, "created_at": datetime.now(timezone.utc).isoformat(),
                "members_before": [p["member"] for p in plans.values()],
                "freezes_before": [row for p in plans.values() for row, _ in p["freezes"]],
                "closures_before": [db.closures.find_one({"id": SEPTEMBER_CLOSURE}, session=session)],
            }
            db.migration_backups.insert_one(backup, session=session)
            for code, plan in plans.items():
                apply_plan(db, code, plan, session)
    print("APPLIED", REPAIR_ID, "members", len(CASES), "closures_compensated", 4)


if __name__ == "__main__":
    main()
