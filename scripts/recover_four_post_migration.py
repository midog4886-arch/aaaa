"""Restore four paid invoices created after the 2026-09-27 migration snapshot.

Dry-run by default. The source must be the 2026-09-29 default-tenant backup.
Only the four named members and their invoice, subscription and points records
are inserted. Existing production records are never replaced.
"""

import argparse
import copy
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from pymongo import MongoClient, ReturnDocument


EXPECTED = {
    "630764": ("223b8ca6-d58e-4e21-9ef7-e03a75ef270c", "DEFA-B11-2392"),
    "630765": ("d4c50781-c9cf-41ee-a30f-e69d7b4620a2", "DEFA-B11-2393"),
    "630766": ("f6c39fb7-ae97-48ac-9b7f-df7eb9fdb1ad", "DEFA-B11-2394"),
    "630769": ("88b9d4ca-ee5a-4797-ae0e-49229ad60450", "DEFA-B11-2397"),
}
COLLECTIONS = ("members", "invoices", "level_subscriptions", "member_points", "points_history")
BRANCH_ID = "656aa5eb-d915-4de5-b233-bfc329e62641"
SOURCE_SHA256 = "bff24d09d1a172e50341a3beb67bbae749e376b4f857d4ed513a6956661bbb67"


def source_records(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if (payload.get("kind") != "recovery-only-four-post-migration"
            or payload.get("source_sha256") != SOURCE_SHA256
            or payload.get("source_timestamp") != "2026-09-28T23:50:15.778851+00:00"):
        raise ValueError("Recovery source identity differs")
    source = payload["records"]
    ids = {member_id for member_id, _ in EXPECTED.values()}
    records = {
        name: [copy.deepcopy(row) for row in source.get(name, [])
               if (row.get("id") if name == "members" else row.get("member_id")) in ids]
        for name in COLLECTIONS
    }
    invoices = {row["invoice_number"]: row for row in records["invoices"]}
    members = {row["id"]: row for row in records["members"]}
    if set(invoices) != set(EXPECTED) or set(members) != ids:
        raise ValueError("Expected four source members and invoices")
    invoice_ids = {row["id"] for row in invoices.values()}
    for number, (member_id, code) in EXPECTED.items():
        inv, member = invoices[number], members[member_id]
        if (inv["member_id"] != member_id or member["member_code"] != code
                or inv["member_code"] != code or inv["status"] != "paid"
                or round(float(inv["total"]) * 100) != 29600
                or member["branch_id"] != BRANCH_ID or inv["branch_id"] != BRANCH_ID
                or len(member.get("activities", [])) != 1
                or member["activities"][0]["source_id"] != inv["id"]):
            raise ValueError(f"Source identity or payment mismatch: {number}")
    for name in COLLECTIONS[2:]:
        if len(records[name]) != 4 or {row["member_id"] for row in records[name]} != ids:
            raise ValueError(f"Expected one {name} record per member")
    if {row["invoice_id"] for row in records["level_subscriptions"]} != invoice_ids:
        raise ValueError("Subscription/invoice links differ")
    return records


def check_destination(db, records):
    if not db.members.count_documents({}) or not db.invoices.count_documents({}):
        raise RuntimeError("Destination empty or incorrect")
    if not db.branches.find_one({"id": BRANCH_ID}):
        raise RuntimeError("Source branch missing")
    for inv in records["invoices"]:
        number, member_id = inv["invoice_number"], inv["member_id"]
        member = next(row for row in records["members"] if row["id"] == member_id)
        if db.members.find_one({"id": member_id}):
            raise RuntimeError(f"Member already restored: {number}")
        if db.members.find_one({"phone": member["phone"], "name_ar": member["name_ar"]}):
            raise RuntimeError(f"Member phone/name already present: {number}")
        if number != "630769" and db.members.find_one({"member_code": member["member_code"]}):
            raise RuntimeError(f"Member code collision: {number}")
        if number == "630769" and not db.members.find_one({"member_code": member["member_code"]}):
            raise RuntimeError("Expected member-code collision is absent; re-review allocation")
        if db.invoices.find_one({"id": inv["id"]}):
            raise RuntimeError(f"Invoice already restored: {number}")
        existing_number = db.invoices.find_one({"invoice_number": number}, {"id": 1})
        if not existing_number or existing_number["id"] == inv["id"]:
            raise RuntimeError(f"Expected live invoice-number collision absent: {number}")
        if db.invoices.find_one({"invoice_number": f"RBL-{number}"}):
            raise RuntimeError(f"Recovery invoice number already used: {number}")
        for item in inv["items"]:
            if not db.activities.find_one({"id": item["activity_id"]}):
                raise RuntimeError(f"Activity missing: {number}")
            if not db.levels.find_one({"id": item["level_id"]}):
                raise RuntimeError(f"Level missing: {number}")
    ids = [member_id for member_id, _ in EXPECTED.values()]
    for name in COLLECTIONS[2:]:
        if db[name].find_one({"member_id": {"$in": ids}}):
            raise RuntimeError(f"Some {name} records already present")
    if not db.branch_counters.find_one({"_id": "member:global:DEFA"}):
        raise RuntimeError("Global member counter missing")


def allocate_member_code(db):
    for _ in range(10000):
        counter = db.branch_counters.find_one_and_update(
            {"_id": "member:global:DEFA"}, {"$inc": {"seq": 1}},
            return_document=ReturnDocument.AFTER)
        seq = int(counter["seq"])
        code = f"DEFA-B11-{seq:04d}"
        if not db.members.find_one({"member_code": {"$regex": rf"-{seq}$"}}):
            return code
    raise RuntimeError("Could not allocate a unique member code")


def apply(db, records):
    # A second full preflight catches changes after the preview.
    check_destination(db, records)
    code = allocate_member_code(db)
    now = datetime.now(timezone.utc).isoformat()
    for member in records["members"]:
        if member["id"] == EXPECTED["630769"][0]:
            member["legacy_member_code"] = member["member_code"]
            member["member_code"] = code
        member["recovered_at"] = now
        member["recovery_source"] = "auto_backup_default_20260929"
    for inv in records["invoices"]:
        number = inv["invoice_number"]
        inv["legacy_invoice_number"] = number
        inv["invoice_number"] = f"RBL-{number}"
        inv["notes"] = ((inv.get("notes") or "") + f" | رقم الفاتورة الأصلي: {number}").strip(" |")
        inv["recovered_at"] = now
        inv["recovery_source"] = "auto_backup_default_20260929"
        if number == "630769":
            inv["member_code"] = code
    with db.client.start_session() as session:
        with session.start_transaction():
            for name in COLLECTIONS:
                for row in records[name]:
                    row.pop("_id", None)
                    db[name].insert_one(row, session=session)
    return code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    records = source_records(args.source)
    url = os.environ.get("MONGO_URL")
    if not url:
        raise RuntimeError("MONGO_URL missing")
    db = MongoClient(url, serverSelectionTimeoutMS=10000)["champions_default"]
    check_destination(db, records)
    if not args.apply:
        print(json.dumps({"ready": True, "records": {name: len(rows) for name, rows in records.items()},
                          "new_invoice_numbers": [f"RBL-{number}" for number in EXPECTED],
                          "member_code_change": "DEFA-B11-2397 -> next unique DEFA-B11 code"}))
        return
    code = apply(db, records)
    found = sorted(row["invoice_number"] for row in db.invoices.find(
        {"invoice_number": {"$in": [f"RBL-{number}" for number in EXPECTED]}},
        {"_id": 0, "invoice_number": 1}))
    expected = sorted(f"RBL-{number}" for number in EXPECTED)
    if found != expected:
        raise RuntimeError("Post-import invoice verification failed")
    print(json.dumps({"restored": True, "invoices": found,
                      "restored_members": db.members.count_documents(
                          {"id": {"$in": [mid for mid, _ in EXPECTED.values()]}}),
                      "new_rashed_member_code": code}))


if __name__ == "__main__":
    main()
