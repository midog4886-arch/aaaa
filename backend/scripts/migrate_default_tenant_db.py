"""Rename the legacy default-tenant MongoDB database.

The historical single-tenant deployment lived in MongoDB database
``champions_academy``. Every newer tenant uses ``champions_<slug>``, and the
default tenant now follows the same convention (``champions_default``). This
script migrates the live data from the old DB to the new one and updates the
control-plane registry entry so the application picks up the new name on the
next request.

Usage:

    python backend/scripts/migrate_default_tenant_db.py --dry-run
    python backend/scripts/migrate_default_tenant_db.py --apply

Idempotent — re-running after a successful migration is a no-op (the source DB
will be gone). MUST be run during a maintenance window with a fresh backup,
because the source DB is dropped at the end of a successful ``--apply`` run.

Strategy:
  1. Connect using ``MONGO_URL`` from the environment (same as the app).
  2. For each collection in the source DB, stream documents in batches and
     ``insert_many`` into the target DB. Indexes are recreated.
  3. Update the control-plane tenant doc (``slug = "default"``) to point
     ``db_name`` at the new name.
  4. Drop the source DB.

Safety:
  - Refuses to run if the target DB already contains documents (unless
    ``--force`` is passed) so we never overwrite a partial migration.
  - Refuses to drop the source if the target document count doesn't match
    the source count for every collection.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)

LEGACY_DB_NAME = os.environ.get("LEGACY_DEFAULT_DB_NAME", "champions_academy")
CONTROL_DB_NAME = os.environ.get("CONTROL_DB_NAME", "champions_control")

BATCH_SIZE = 500

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("migrate_default_tenant_db")


async def _copy_collection(src_db, dst_db, name: str, *, dry_run: bool) -> int:
    src = src_db[name]
    dst = dst_db[name]
    total = await src.estimated_document_count()
    if dry_run:
        log.info("  [dry-run] would copy %s docs from %s.%s", total, src_db.name, name)
        return total

    cursor = src.find({}, no_cursor_timeout=True)
    batch: list = []
    copied = 0
    try:
        async for doc in cursor:
            batch.append(doc)
            if len(batch) >= BATCH_SIZE:
                await dst.insert_many(batch, ordered=False)
                copied += len(batch)
                batch = []
        if batch:
            await dst.insert_many(batch, ordered=False)
            copied += len(batch)
    finally:
        await cursor.close()

    # Recreate non-_id indexes so query performance is preserved on day one.
    try:
        index_info = await src.index_information()
        for idx_name, spec in index_info.items():
            if idx_name == "_id_":
                continue
            keys = spec.get("key") or []
            options = {k: v for k, v in spec.items() if k not in ("key", "v", "ns")}
            options["name"] = idx_name
            try:
                await dst.create_index(keys, **options)
            except Exception as e:
                log.warning("    index %s could not be recreated: %s", idx_name, e)
    except Exception as e:
        log.warning("  could not enumerate indexes for %s: %s", name, e)

    log.info("  copied %s docs into %s.%s", copied, dst_db.name, name)
    return copied


async def _run(*, dry_run: bool, force: bool, drop_source: bool) -> int:
    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        log.error("MONGO_URL is required")
        return 2

    # Imported lazily so --help works without motor installed.
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(
        mongo_url,
        tls=True,
        tlsAllowInvalidCertificates=True,
        serverSelectionTimeoutMS=30000,
        connectTimeoutMS=20000,
        socketTimeoutMS=60000,
    )

    # Resolve the new name through the same code path the app uses so the
    # script and the runtime can never drift.
    from utils.tenant import DEFAULT_TENANT_SLUG, slug_to_db_name

    target_db_name = slug_to_db_name(DEFAULT_TENANT_SLUG)
    if target_db_name == LEGACY_DB_NAME:
        log.error(
            "Target DB name (%s) equals legacy name (%s) — nothing to migrate. "
            "Did you set TENANT_DB_PREFIX wrong?",
            target_db_name, LEGACY_DB_NAME,
        )
        return 2

    src_db = client[LEGACY_DB_NAME]
    dst_db = client[target_db_name]
    control_db = client[CONTROL_DB_NAME]

    existing = await client.list_database_names()
    if LEGACY_DB_NAME not in existing:
        log.info("Legacy DB %s does not exist — nothing to migrate.", LEGACY_DB_NAME)
        # Still try to fix the control-plane doc in case it points at the
        # legacy name even though the data has already moved.
        if not dry_run:
            await control_db.tenants.update_one(
                {"slug": DEFAULT_TENANT_SLUG, "db_name": LEGACY_DB_NAME},
                {"$set": {"db_name": target_db_name}},
            )
        return 0

    collections = await src_db.list_collection_names()
    log.info("Source DB %s has %d collection(s): %s",
             LEGACY_DB_NAME, len(collections), ", ".join(collections) or "(none)")

    # Refuse to overwrite a partially-populated target.
    if target_db_name in existing and not force:
        for name in await dst_db.list_collection_names():
            count = await dst_db[name].estimated_document_count()
            if count:
                log.error(
                    "Target DB %s already contains data (collection %s has %s docs). "
                    "Re-run with --force to proceed.",
                    target_db_name, name, count,
                )
                return 3

    src_counts: dict = {}
    for name in collections:
        src_counts[name] = await src_db[name].estimated_document_count()

    log.info("Source counts: %s", src_counts)

    for name in collections:
        await _copy_collection(src_db, dst_db, name, dry_run=dry_run)

    if dry_run:
        log.info("[dry-run] complete — no writes performed.")
        return 0

    # Verify counts match before dropping anything.
    mismatched: list = []
    for name, expected in src_counts.items():
        actual = await dst_db[name].estimated_document_count()
        if actual != expected:
            mismatched.append((name, expected, actual))
    if mismatched:
        log.error("Count mismatch — refusing to drop source: %s", mismatched)
        return 4

    # Update control-plane registry so the app starts using the new name
    # on the very next request.
    res = await control_db.tenants.update_one(
        {"slug": DEFAULT_TENANT_SLUG},
        {"$set": {"db_name": target_db_name}},
    )
    log.info("Control-plane tenant doc updated (matched=%s, modified=%s)",
             res.matched_count, res.modified_count)

    if drop_source:
        await client.drop_database(LEGACY_DB_NAME)
        log.info("Dropped legacy DB %s", LEGACY_DB_NAME)
    else:
        log.info("Skipped dropping legacy DB %s (--keep-source)", LEGACY_DB_NAME)

    log.info("Migration complete.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true",
                      help="Report what would be copied without writing.")
    mode.add_argument("--apply", action="store_true",
                      help="Perform the migration.")
    parser.add_argument("--force", action="store_true",
                        help="Proceed even if the target DB already has data.")
    parser.add_argument("--keep-source", action="store_true",
                        help="Do not drop the legacy DB after a successful copy.")
    args = parser.parse_args()

    return asyncio.run(_run(
        dry_run=args.dry_run,
        force=args.force,
        drop_source=not args.keep_source,
    ))


if __name__ == "__main__":
    sys.exit(main())
