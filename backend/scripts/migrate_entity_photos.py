"""One-off migration: move inline base64 coach/supervisor photos out of docs.

Same design as scripts/migrate_member_photos.py — for every active tenant:
  - coaches.photo / supervisors.photo that is a data URL -> compressed into
    the coach_photos / supervisor_photos store, doc keeps the small signed URL;
  - undecodable images are dropped (photo -> None) rather than kept as bloat.

Idempotent: URL-valued photos are skipped. Run from backend/:
    python -m scripts.migrate_entity_photos
"""
import asyncio
import sys

sys.path.insert(0, ".")

from utils.tenant import for_each_active_tenant, get_current_tenant_slug  # noqa: E402
from utils.member_photos import store_entity_photo, ENTITY_PHOTO_KINDS  # noqa: E402

_TARGETS = [
    ("coach", "coaches"),
    ("supervisor", "supervisors"),
]


async def migrate_tenant(tenant):
    from database import db
    slug = get_current_tenant_slug()
    stats = {"tenant": slug}

    for kind, source_col in _TARGETS:
        conf = ENTITY_PHOTO_KINDS[kind]
        await db[conf["collection"]].create_index(conf["id_field"], unique=True)
        migrated = failed = 0
        cursor = db[source_col].find(
            {"photo": {"$regex": "^data:image/"}}, {"_id": 0, "id": 1, "photo": 1}
        )
        async for doc in cursor:
            url = await store_entity_photo(db, kind, slug, doc["id"], doc["photo"])
            if url:
                await db[source_col].update_one({"id": doc["id"]}, {"$set": {"photo": url}})
                migrated += 1
            else:
                await db[source_col].update_one({"id": doc["id"]}, {"$set": {"photo": None}})
                failed += 1
        stats[f"{source_col}_migrated"] = migrated
        stats[f"{source_col}_failed"] = failed

    print(stats, flush=True)
    return stats


async def main():
    summary = await for_each_active_tenant(migrate_tenant, label="migrate_entity_photos")
    print({k: summary.get(k) for k in ("processed", "succeeded", "failed")}, flush=True)
    if summary.get("errors"):
        print("ERRORS:", summary["errors"], flush=True)


if __name__ == "__main__":
    asyncio.run(main())
