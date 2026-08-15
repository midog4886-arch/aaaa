"""One-off migration: move inline base64 member photos out of member docs.

For every active tenant:
  - members.photo that is a data URL -> compress into member_photos store,
    replace members.photo with the small signed URL;
  - attendance.member_photo copies that are data URLs -> replaced with the
    member's URL (or "" when the member has no stored photo), so attendance
    list payloads stop carrying MBs of base64.

Idempotent: URL-valued photos are skipped. Run from backend/:
    python -m scripts.migrate_member_photos
"""
import asyncio
import sys

sys.path.insert(0, ".")

from utils.tenant import for_each_active_tenant, get_current_tenant_slug  # noqa: E402
from utils.member_photos import store_member_photo, is_photo_url  # noqa: E402


async def migrate_tenant(tenant):
    from database import db
    slug = get_current_tenant_slug()
    stats = {"tenant": slug, "members_migrated": 0, "members_failed": 0, "attendance_updated": 0}

    await db.member_photos.create_index("member_id", unique=True)

    member_url = {}
    cursor = db.members.find(
        {"photo": {"$regex": "^data:image/"}}, {"_id": 0, "id": 1, "photo": 1}
    )
    async for m in cursor:
        url = await store_member_photo(db, slug, m["id"], m["photo"])
        if url:
            await db.members.update_one({"id": m["id"]}, {"$set": {"photo": url}})
            member_url[m["id"]] = url
            stats["members_migrated"] += 1
        else:
            # Undecodable image: drop it rather than keep bloating the doc.
            await db.members.update_one({"id": m["id"]}, {"$set": {"photo": ""}})
            stats["members_failed"] += 1

    # Also capture members already migrated on a previous partial run so their
    # attendance copies still get rewritten.
    async for m in db.members.find({"photo": {"$regex": "^/api/public/member-photo/"}}, {"_id": 0, "id": 1, "photo": 1}):
        member_url.setdefault(m["id"], m["photo"])

    # Rewrite inline attendance photo copies (biggest remaining payload bloat).
    mids = [d["member_id"] async for d in db.attendance.aggregate([
        {"$match": {"member_photo": {"$regex": "^data:image/"}}},
        {"$group": {"_id": "$member_id"}},
        {"$project": {"_id": 0, "member_id": "$_id"}},
    ])]
    for mid in mids:
        res = await db.attendance.update_many(
            {"member_id": mid, "member_photo": {"$regex": "^data:image/"}},
            {"$set": {"member_photo": member_url.get(mid, "")}},
        )
        stats["attendance_updated"] += res.modified_count

    print(stats, flush=True)
    return stats


async def main():
    summary = await for_each_active_tenant(migrate_tenant, label="migrate_member_photos")
    print({k: summary.get(k) for k in ("processed", "succeeded", "failed")}, flush=True)
    if summary.get("errors"):
        print("ERRORS:", summary["errors"], flush=True)


if __name__ == "__main__":
    asyncio.run(main())
