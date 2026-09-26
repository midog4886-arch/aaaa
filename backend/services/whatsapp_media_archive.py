"""Durable, private archive for inbound WhatsApp attachments.

The archive deliberately has no provider credentials.  Callers supply the
provider retrieval function, which keeps provider-specific URL validation and
authentication in the provider integration layer.
"""
import zipfile
import uuid
import hashlib
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Awaitable, Callable, Optional

import httpx

MAX_MEDIA_BYTES = 20 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
MAX_ATTEMPTS = 5
LEASE_SECONDS = 45


class ArchiveError(Exception):
    def __init__(self, status: str, detail: str):
        self.status, self.detail = status, detail
        super().__init__(detail)


def safe_filename(value: object, fallback: str = "attachment") -> str:
    name = Path(str(value or fallback).replace("\\", "/")).name
    name = "".join(c for c in name if c.isprintable() and c not in "\r\n").strip()
    return name[:180] if name and name not in {".", ".."} else fallback


def _mime(value: object) -> str:
    return str(value or "").split(";", 1)[0].strip().lower()


def _safe_office_zip(content: bytes) -> bool:
    """Inspect archive metadata only; reject macro/executable and zip-bomb docs."""
    try:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > 5000 or sum(entry.file_size for entry in entries) > 100 * 1024 * 1024:
                return False
            for entry in entries:
                name = entry.filename.lower()
                if (name.startswith(("/", "\\")) or ".." in Path(name).parts
                        or "vbaproject" in name
                        or name.endswith((".exe", ".dll", ".js", ".html", ".svg"))):
                    return False
        return True
    except (OSError, zipfile.BadZipFile):
        return False


def validate_media(content: bytes, mime_type: object, filename: object = None) -> tuple[str, str]:
    """Allow only non-active attachment formats with a matching file signature."""
    mime = _mime(mime_type)
    if not content:
        raise ArchiveError("unsupported", "Attachment is empty")
    if len(content) > MAX_MEDIA_BYTES:
        raise ArchiveError("unsupported", "Attachment exceeds the 20 MB limit")
    webm = content.startswith(b"\x1aE\xdf\xa3") and b"webm" in content[:4096].lower()
    ftyp = len(content) >= 12 and content[4:8] == b"ftyp"
    allowed = (
        (mime == "image/jpeg" and content.startswith(b"\xff\xd8\xff"))
        or (mime == "image/png" and content.startswith(b"\x89PNG\r\n\x1a\n"))
        or (mime == "image/webp" and content[:4] == b"RIFF" and content[8:12] == b"WEBP")
        or (mime in {"audio/ogg", "audio/opus"} and content.startswith(b"OggS"))
        or (mime in {"audio/mpeg", "audio/mp3"} and (
            content.startswith(b"ID3") or content[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}))
        or (mime == "audio/aac" and len(content) > 1 and content[0] == 0xff and content[1] & 0xf6 == 0xf0)
        or (mime in {"audio/mp4", "video/mp4"} and ftyp)
        or (mime in {"audio/webm", "video/webm"} and webm)
        or (mime == "application/pdf" and content.startswith(b"%PDF-"))
        or (mime in {
            "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        } and ((content.startswith(b"PK\x03\x04") and _safe_office_zip(content))
                 or (mime in {"application/msword", "application/vnd.ms-excel",
                              "application/vnd.ms-powerpoint"}
                     and content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"))))
    )
    if not allowed:
        raise ArchiveError("unsupported", "Attachment type is not supported")
    return mime, safe_filename(filename)


async def stream_download(
    url: str, headers: dict, host_ok: Callable[[str], bool], *,
    timeout: float = 45.0, max_bytes: int = MAX_MEDIA_BYTES,
) -> bytes:
    """Download a vetted URL with redirects disabled and a hard streaming cap."""
    if not host_ok(url):
        raise ArchiveError("unavailable", "Attachment source is unavailable")
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            async with client.stream("GET", url, headers=headers) as response:
                if response.status_code in {404, 410}:
                    raise ArchiveError("unavailable", "Attachment is no longer available")
                if response.status_code < 200 or response.status_code >= 300:
                    raise ArchiveError("failed", "Attachment download failed")
                size = 0
                parts = []
                async for part in response.aiter_bytes(CHUNK_SIZE):
                    size += len(part)
                    if size > max_bytes:
                        raise ArchiveError("unsupported", "Attachment exceeds the 20 MB limit")
                    parts.append(part)
                return b"".join(parts)
    except ArchiveError:
        raise
    except Exception:
        raise ArchiveError("failed", "Attachment download failed")


def _scope(branch_id: str, storage_id: str, tenant_slug: str) -> dict:
    return {"tenant_slug": tenant_slug, "branch_id": branch_id, "media_id": storage_id}


async def store(db, tenant_slug: str, branch_id: str, storage_id: str, content: bytes,
                mime_type: str, filename: str, message_id: str) -> None:
    """Write chunks then metadata; clean all partial chunks on any failed write."""
    scope = _scope(branch_id, storage_id, tenant_slug)
    meta = db["whatsapp_cloud_media"]
    chunks = db["whatsapp_cloud_media_chunks"]
    if await meta.find_one(scope, {"_id": 1}):
        return
    try:
        for index, offset in enumerate(range(0, len(content), CHUNK_SIZE)):
            await chunks.insert_one({**scope, "index": index,
                                     "data": content[offset:offset + CHUNK_SIZE],
                                     "archive_owner_message_id": message_id})
        await meta.insert_one({**scope, "name": filename, "mime_type": mime_type,
                               "size": len(content),
                               "sha256": hashlib.sha256(content).hexdigest(),
                               "chunk_count": (len(content) + CHUNK_SIZE - 1) // CHUNK_SIZE,
                               "archive_owner_message_id": message_id,
                               "created_at": datetime.now(timezone.utc).isoformat()})
    except Exception:
        await chunks.delete_many(scope)
        await meta.delete_one(scope)
        raise


async def load(db, tenant_slug: str, branch_id: str, storage_id: str) -> tuple[bytes, str, str]:
    scope = _scope(branch_id, storage_id, tenant_slug)
    meta = await db["whatsapp_cloud_media"].find_one(scope, {"_id": 0})
    if not meta:
        raise ArchiveError("unavailable", "Archived attachment is unavailable")
    try:
        expected = int(meta.get("chunk_count") or 0)
        size = int(meta.get("size") or 0)
    except (TypeError, ValueError, OverflowError):
        raise ArchiveError("unavailable", "Archived attachment metadata is invalid")
    # Validate metadata before using it as a database read limit. An interrupted
    # or corrupt archive must not be presented as a successful empty attachment.
    if not (0 < size <= MAX_MEDIA_BYTES and
            expected == (size + CHUNK_SIZE - 1) // CHUNK_SIZE):
        raise ArchiveError("unavailable", "Archived attachment is incomplete")
    chunks = await db["whatsapp_cloud_media_chunks"].find(scope).sort("index", 1).to_list(expected + 1)
    content = b"".join(row.get("data") or b"" for row in chunks)
    if (len(chunks) != expected or any(row.get("index") != i for i, row in enumerate(chunks))
            or len(content) != size
            or (meta.get("sha256") and
                hashlib.sha256(content).hexdigest() != meta["sha256"])):
        raise ArchiveError("unavailable", "Archived attachment is incomplete")
    return content, str(meta.get("mime_type") or "application/octet-stream"), safe_filename(meta.get("name"))


async def delete(db, tenant_slug: str, branch_id: str, storage_id: Optional[str],
                 message_id: Optional[str] = None, *, cleanup_owner: bool = False) -> None:
    if storage_id:
        scope = _scope(branch_id, storage_id, tenant_slug)
        # Only archive-owned records are removable through this endpoint.
        ownership = (
            {"archive_owner_message_id": message_id}
            if message_id else {"archive_owner_message_id": {"$exists": True}}
        )
        await db["whatsapp_cloud_media_chunks"].delete_many(
            {**scope, **ownership})
        await db["whatsapp_cloud_media"].delete_one(
            {**scope, **ownership})
    if message_id and cleanup_owner:
        # Also clean stale staging objects from a worker interrupted before it
        # could publish media_storage_id.  This cannot touch outbound/campaign
        # media because ownership is an inbound archive-only marker.
        owner = {
            "tenant_slug": tenant_slug, "branch_id": branch_id,
            "archive_owner_message_id": message_id,
        }
        await db["whatsapp_cloud_media_chunks"].delete_many(owner)
        await db["whatsapp_cloud_media"].delete_many(owner)


def retry_at(attempt: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=min(300, 10 * (2 ** max(0, attempt - 1))))).isoformat()


async def process_message(db, tenant_slug: str, message_id: str,
                          downloader: Callable[[dict], Awaitable[tuple[bytes, str, str]]]) -> str:
    """Lease and archive one message.  A concurrent worker cannot download twice."""
    messages = db["whatsapp_cloud_messages"]
    message = await messages.find_one({"id": message_id}, {"_id": 0})
    if not message or message.get("archive_status") == "deleted":
        return "deleted"
    if message.get("media_storage_id"):
        # Older direct-chat copies predate archive_status.  They are already
        # durable, so repair the projection without contacting any provider.
        scope = _scope(str(message.get("branch_id") or ""),
                       str(message["media_storage_id"]), tenant_slug)
        metadata = await db["whatsapp_cloud_media"].find_one(scope, {"_id": 0})
        if metadata:
            await messages.update_one(
                {"id": message_id, "archive_status": {"$ne": "deleted"}},
                {"$set": {
                    "archive_status": "archived", "archive_error": None,
                    "archived_at": message.get("archived_at") or datetime.now(timezone.utc).isoformat(),
                    "archive_size": int(metadata.get("size") or 0),
                }},
            )
            return "archived"
        return "unavailable"
    if message.get("direction") != "inbound":
        return "unavailable"
    now = datetime.now(timezone.utc)
    lease_until = (now + timedelta(seconds=LEASE_SECONDS)).isoformat()
    query = {"id": message_id, "archive_status": {"$in": ["pending", "failed", "unavailable"]},
             "$or": [{"archive_lease_until": {"$exists": False}}, {"archive_lease_until": {"$lte": now.isoformat()}}]}
    claimed = await messages.find_one_and_update(
        query, {"$set": {"archive_lease_until": lease_until, "archive_leased_at": now.isoformat()}},
        return_document=True)
    if not claimed:
        return str((await messages.find_one({"id": message_id}, {"_id": 0}) or {}).get("archive_status") or "pending")
    attempt = int(claimed.get("archive_attempts") or 0) + 1
    try:
        # A prior lease may have died after chunk writes and before publishing.
        # It is safe to reclaim only before this lease creates its staging key;
        # lease losers below remove their own key, never all owner records.
        await delete(db, tenant_slug, str(claimed["branch_id"]), None, message_id,
                     cleanup_owner=True)
        content, provider_mime, provider_name = await downloader(claimed)
        mime, name = validate_media(content, provider_mime or claimed.get("mime_type"),
                                    provider_name or claimed.get("filename"))
        # Stage keys are unique per lease.  A lease loser only removes its own
        # chunks and can never delete a winner's just-published object.
        storage_id = f"archive-stage-{uuid.uuid4()}"
        staging = await messages.update_one(
            {"id": message_id, "archive_lease_until": lease_until,
             "archive_status": {"$ne": "deleted"}},
            {"$set": {"archive_staging_storage_id": storage_id}},
        )
        if getattr(staging, "matched_count", 1) != 1:
            return "deleted"
        await store(db, tenant_slug, str(claimed["branch_id"]), storage_id, content, mime, name, message_id)
        # Deletion can race a download.  The tombstone wins and removes this
        # archive-only object instead of allowing a post-delete orphan.
        current = await messages.find_one({"id": message_id}, {"_id": 0, "archive_status": 1})
        if (current or {}).get("archive_status") == "deleted":
            await delete(db, tenant_slug, str(claimed["branch_id"]), storage_id, message_id)
            return "deleted"
        published = await messages.update_one({"id": message_id, "archive_lease_until": lease_until,
                                                "archive_status": {"$ne": "deleted"}},
            {"$set": {"archive_status": "archived", "archive_error": None,
                      "archived_at": datetime.now(timezone.utc).isoformat(), "archive_size": len(content),
                      "archive_storage_id": storage_id, "media_storage_id": storage_id,
                      "mime_type": mime, "filename": name},
             "$unset": {"archive_lease_until": "", "archive_leased_at": "",
                        "archive_staging_storage_id": ""}})
        if getattr(published, "matched_count", 1) != 1:
            await delete(db, tenant_slug, str(claimed["branch_id"]), storage_id, message_id)
            current = await messages.find_one({"id": message_id}, {"_id": 0, "archive_status": 1})
            return str((current or {}).get("archive_status") or "pending")
        return "archived"
    except ArchiveError as exc:
        status = exc.status
        update = {"archive_status": status, "archive_error": exc.detail, "archive_attempts": attempt}
        if status == "failed" and attempt < MAX_ATTEMPTS:
            update["archive_status"] = "failed"
            update["archive_next_at"] = retry_at(attempt)
        elif status == "failed":
            update["archive_status"] = "unavailable"
        await messages.update_one({"id": message_id, "archive_lease_until": lease_until},
            {"$set": update, "$unset": {"archive_lease_until": "", "archive_leased_at": ""}})
        return str(update["archive_status"])
    except Exception:
        update = {"archive_status": "failed" if attempt < MAX_ATTEMPTS else "unavailable",
                  "archive_error": "Attachment archive failed", "archive_attempts": attempt}
        if attempt < MAX_ATTEMPTS:
            update["archive_next_at"] = retry_at(attempt)
        await messages.update_one({"id": message_id, "archive_lease_until": lease_until},
            {"$set": update, "$unset": {"archive_lease_until": "", "archive_leased_at": ""}})
        return str(update["archive_status"])