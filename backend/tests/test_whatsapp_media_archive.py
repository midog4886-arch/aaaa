import pytest

from services import whatsapp_media_archive as archive


def run(coro):
    import asyncio
    return asyncio.run(coro)


class _Result:
    def __init__(self, matched_count):
        self.matched_count = matched_count


def _matches(row, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(row, part) for part in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and (key in row) != expected["$exists"]:
                return False
            if "$lte" in expected and (actual is None or actual > expected["$lte"]):
                return False
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, key, direction):
        return _Cursor(sorted(self.rows, key=lambda row: row.get(key), reverse=direction < 0))

    async def to_list(self, length):
        return [dict(row) for row in self.rows[:length]]


class _Collection:
    def __init__(self, rows=(), lose_publish=False):
        self.rows = [dict(row) for row in rows]
        self.lose_publish = lose_publish

    async def find_one(self, query, projection=None):
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query, projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def find_one_and_update(self, query, update, return_document=True):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set", {}))
                for key in update.get("$unset", {}):
                    row.pop(key, None)
                return dict(row)
        return None

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                if self.lose_publish and "media_storage_id" in update.get("$set", {}):
                    return _Result(0)
                row.update(update.get("$set", {}))
                for key in update.get("$unset", {}):
                    row.pop(key, None)
                return _Result(1)
        return _Result(0)

    async def insert_one(self, row):
        self.rows.append(dict(row))

    async def delete_one(self, query):
        self.rows[:] = [row for row in self.rows if not _matches(row, query)]

    async def delete_many(self, query):
        self.rows[:] = [row for row in self.rows if not _matches(row, query)]


class _DB:
    def __init__(self, message, lose_publish=False):
        self.collections = {
            "whatsapp_cloud_messages": _Collection([message], lose_publish),
            "whatsapp_cloud_media": _Collection(),
            "whatsapp_cloud_media_chunks": _Collection(),
        }

    def __getitem__(self, name):
        return self.collections[name]


def _pending_message():
    return {
        "id": "inbound-1", "branch_id": "branch-a", "direction": "inbound",
        "type": "image", "media_id": "provider-1", "mime_type": "image/png",
        "archive_status": "pending",
    }


def test_process_archives_once_and_local_load_does_not_need_provider_again():
    db = _DB(_pending_message())
    calls = []

    async def download(_message):
        calls.append(True)
        return b"\x89PNG\r\n\x1a\nprivate", "image/png", "picture.png"

    assert run(archive.process_message(db, "tenant-a", "inbound-1", download)) == "archived"
    # The durable media_storage_id short-circuits any later worker/provider use.
    assert run(archive.process_message(
        db, "tenant-a", "inbound-1",
        lambda _message: (_ for _ in ()).throw(AssertionError("provider called")),
    )) == "archived"
    message = db["whatsapp_cloud_messages"].rows[0]
    assert calls == [True]
    content, mime, name = run(archive.load(
        db, "tenant-a", "branch-a", message["media_storage_id"]))
    assert (content, mime, name) == (b"\x89PNG\r\n\x1a\nprivate", "image/png", "picture.png")


def test_existing_private_copy_repairs_pending_status_without_provider_io():
    message = _pending_message()
    message["media_storage_id"] = "legacy-direct-copy"
    db = _DB(message)
    db["whatsapp_cloud_media"].rows.append({
        "tenant_slug": "tenant-a", "branch_id": "branch-a",
        "media_id": "legacy-direct-copy", "size": 8,
    })

    async def must_not_download(_message):
        raise AssertionError("saved media must short-circuit provider retrieval")

    assert run(archive.process_message(
        db, "tenant-a", "inbound-1", must_not_download)) == "archived"
    assert db["whatsapp_cloud_messages"].rows[0]["archive_status"] == "archived"


def test_concurrent_workers_obtain_one_atomic_lease():
    import asyncio

    db = _DB(_pending_message())
    started = asyncio.Event()
    release = asyncio.Event()
    calls = []

    async def download(_message):
        calls.append(True)
        started.set()
        await release.wait()
        return b"\x89PNG\r\n\x1a\nprivate", "image/png", "picture.png"

    async def exercise():
        first = asyncio.create_task(
            archive.process_message(db, "tenant-a", "inbound-1", download))
        await started.wait()
        second = await archive.process_message(db, "tenant-a", "inbound-1", download)
        release.set()
        return await first, second

    assert run(exercise()) == ("archived", "pending")
    assert calls == [True]


def test_lost_publish_lease_cleans_only_its_staged_chunks():
    db = _DB(_pending_message(), lose_publish=True)

    async def download(_message):
        return b"\x89PNG\r\n\x1a\nprivate", "image/png", "picture.png"

    assert run(archive.process_message(db, "tenant-a", "inbound-1", download)) == "pending"
    assert db["whatsapp_cloud_media"].rows == []
    assert db["whatsapp_cloud_media_chunks"].rows == []


def test_tombstone_during_a_blocked_download_never_restores_media():
    import asyncio

    db = _DB(_pending_message())
    started = asyncio.Event()
    release = asyncio.Event()

    async def download(_message):
        started.set()
        await release.wait()
        return b"\x89PNG\r\n\x1a\nprivate", "image/png", "picture.png"

    async def exercise():
        task = asyncio.create_task(
            archive.process_message(db, "tenant-a", "inbound-1", download))
        await started.wait()
        # This mirrors the route's committed delete tombstone while a provider
        # request remains blocked; the worker must not resurrect storage.
        db["whatsapp_cloud_messages"].rows[0]["archive_status"] = "deleted"
        release.set()
        return await task

    assert run(exercise()) == "deleted"
    assert db["whatsapp_cloud_media"].rows == []
    assert db["whatsapp_cloud_media_chunks"].rows == []


def test_unavailable_and_bounded_failed_retries_do_not_claim_success():
    db = _DB(_pending_message())

    async def unavailable(_message):
        raise archive.ArchiveError("unavailable", "Attachment is no longer available")

    assert run(archive.process_message(db, "tenant-a", "inbound-1", unavailable)) == "unavailable"
    assert db["whatsapp_cloud_messages"].rows[0]["archive_status"] == "unavailable"

    db = _DB(_pending_message())

    async def failed(_message):
        raise archive.ArchiveError("failed", "Attachment download failed")

    for _ in range(archive.MAX_ATTEMPTS):
        run(archive.process_message(db, "tenant-a", "inbound-1", failed))
    assert db["whatsapp_cloud_messages"].rows[0]["archive_status"] == "unavailable"


def test_archive_media_magic_allowlist_and_safe_name():
    mime, name = archive.validate_media(
        b"\x89PNG\r\n\x1a\narchive", "image/png; charset=binary", "../../photo.png"
    )
    assert (mime, name) == ("image/png", "photo.png")

    with pytest.raises(archive.ArchiveError) as rejected:
        archive.validate_media(b"<svg onload=alert(1)>", "image/svg+xml", "evil.svg")
    assert rejected.value.status == "unsupported"


def test_archive_media_enforces_hard_twenty_mib_cap_before_storage():
    with pytest.raises(archive.ArchiveError) as rejected:
        archive.validate_media(
            b"\x89PNG\r\n\x1a\n" + b"x" * archive.MAX_MEDIA_BYTES,
            "image/png", "large.png",
        )
    assert rejected.value.status == "unsupported"
    assert "20 MB" in rejected.value.detail


def test_archive_rejects_macro_office_zip_even_with_a_safe_office_mime():
    # A tiny ZIP with macro evidence is enough; archive inspection never
    # expands arbitrary document bodies.
    import io
    import zipfile

    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as document:
        document.writestr("word/vbaProject.bin", b"macro")
    with pytest.raises(archive.ArchiveError):
        archive.validate_media(
            stream.getvalue(),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "report.docx",
        )


def test_private_archive_detects_same_length_corruption_without_provider_access():
    db = _DB(_pending_message())
    content = b"%PDF-1.4\nprivate attachment"
    run(archive.store(db, "tenant-a", "branch-a", "stored-1", content,
                      "application/pdf", "report.pdf", "inbound-1"))
    assert run(archive.load(db, "tenant-a", "branch-a", "stored-1"))[0] == content
    db["whatsapp_cloud_media_chunks"].rows[0]["data"] = b"x" * len(content)
    with pytest.raises(archive.ArchiveError, match="incomplete"):
        run(archive.load(db, "tenant-a", "branch-a", "stored-1"))


@pytest.mark.parametrize("size,count", [(0, 0), ("invalid", 1), (20 * 1024 * 1024 + 1, 1)])
def test_corrupt_metadata_is_rejected_before_reading_chunks(size, count):
    db = _DB(_pending_message())
    db["whatsapp_cloud_media"].rows.append({
        "tenant_slug": "tenant-a", "branch_id": "branch-a", "media_id": "stored-1",
        "size": size, "chunk_count": count,
    })
    def forbidden_read(*args, **kwargs):
        raise AssertionError("Invalid metadata must not trigger a chunks query")
    db["whatsapp_cloud_media_chunks"].find = forbidden_read
    with pytest.raises(archive.ArchiveError):
        run(archive.load(db, "tenant-a", "branch-a", "stored-1"))


def test_legacy_archive_without_digest_remains_readable_but_branch_and_tenant_scoped():
    db = _DB(_pending_message())
    content = b"%PDF-1.4\nlegacy attachment"
    run(archive.store(db, "tenant-a", "branch-a", "stored-1", content,
                      "application/pdf", "report.pdf", "inbound-1"))
    db["whatsapp_cloud_media"].rows[0].pop("sha256")
    assert run(archive.load(db, "tenant-a", "branch-a", "stored-1"))[0] == content
    for tenant, branch in [("tenant-b", "branch-a"), ("tenant-a", "branch-b")]:
        with pytest.raises(archive.ArchiveError, match="unavailable"):
            run(archive.load(db, tenant, branch, "stored-1"))


@pytest.mark.parametrize("legacy", [False, True])
def test_actual_inbox_route_reads_archive_without_provider_then_rejects_corruption(monkeypatch, legacy):
    from routes import whatsapp
    message = {**_pending_message(), "media_storage_id": "stored-1",
               "archive_status": "archived", "provider": "meta_cloud"}
    db = _DB(message)
    content = b"%PDF-1.4\nretained after Meta expiry"
    run(archive.store(db, "tenant-a", "branch-a", "stored-1", content,
                      "application/pdf", "report.pdf", message["id"]))
    if legacy:
        db["whatsapp_cloud_media"].rows[0].pop("sha256")
    monkeypatch.setattr(whatsapp, "_db", db)
    monkeypatch.setattr(whatsapp, "get_current_tenant_slug", lambda: "tenant-a")

    async def forbidden_provider(*args, **kwargs):
        raise AssertionError("Archived media must never need Meta")
    monkeypatch.setattr(whatsapp, "_get_branch_cloud_config", forbidden_provider)
    monkeypatch.setattr(whatsapp, "_download_inbound_archive_media", forbidden_provider)
    response = run(whatsapp.get_cloud_inbox_media(message["id"], current_user={"is_admin": True}))
    assert response.body == content
    assert response.media_type == "application/pdf"
    # New archives detect same-size damage; legacy archives still detect missing bytes.
    db["whatsapp_cloud_media_chunks"].rows[0]["data"] = b"x" * (len(content) - int(legacy))
    with pytest.raises(whatsapp.HTTPException) as exc:
        run(whatsapp.get_cloud_inbox_media(message["id"], current_user={"is_admin": True}))
    assert exc.value.status_code == 500
    assert "incomplete" in exc.value.detail