"""Member photo store: photos live OUTSIDE the member document.

Historically member photos were base64 data URLs embedded in ``members.photo``,
which bloated every list/report payload to MBs (Atlas free tier is wire-bound).
Now:

  - the actual image lives in the ``member_photos`` collection
    ({member_id, data, hash, updated_at}), recompressed server-side
    (max 512px JPEG) so a photo is a few tens of KB at most;
  - ``members.photo`` holds only a small, stable URL
    ``/api/public/member-photo/<tenant_slug>/<member_id>?v=<hash>&sig=<hmac>``
    which every existing ``<img src>`` consumer renders unchanged;
  - the serving endpoint is public-but-signed (browsers can't attach JWT
    headers to <img>), resolves the tenant from the URL path (the native
    member app is served from one fixed domain and can't set X-Tenant-Slug
    on image requests), and responds with immutable cache headers keyed by
    the content hash.

Exports that must EMBED pixels (XLSX/PDF) bulk-load the data back from
``member_photos`` — see ``load_photo_data_map``.
"""
import base64
import hashlib
import hmac
import os
from datetime import datetime, timezone
from io import BytesIO
from typing import Dict, List, Optional

PHOTO_URL_PREFIX = "/api/public/member-photo/"
_MAX_SIDE = 512
_JPEG_QUALITY = 82


def _secret() -> bytes:
    return (os.environ.get("SESSION_SECRET") or "").encode()


def photo_sig(tenant_slug: str, member_id: str) -> str:
    return hmac.new(_secret(), f"{tenant_slug}:{member_id}".encode(), hashlib.sha256).hexdigest()[:20]


def verify_photo_sig(tenant_slug: str, member_id: str, sig: str) -> bool:
    return bool(sig) and hmac.compare_digest(photo_sig(tenant_slug, member_id), sig)


def build_photo_url(tenant_slug: str, member_id: str, content_hash: str) -> str:
    return (
        f"{PHOTO_URL_PREFIX}{tenant_slug}/{member_id}"
        f"?v={content_hash[:10]}&sig={photo_sig(tenant_slug, member_id)}"
    )


def is_photo_url(value) -> bool:
    return isinstance(value, str) and value.startswith(PHOTO_URL_PREFIX)


def compress_photo_data_url(data_url: str) -> Optional[str]:
    """Recompress a base64 image data URL to a bounded JPEG data URL.

    Returns None when the input is empty/malformed/undecodable (caller decides
    whether that is a 400 or a silent skip).
    """
    if not data_url or not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        return None
    try:
        _, b64 = data_url.split(",", 1)
        raw = base64.b64decode(b64)
    except Exception:
        return None
    try:
        import warnings
        from PIL import Image as PILImage
        img = PILImage.open(BytesIO(raw))
        w, h = img.size
        # Decompression-bomb guard before any pixel decode.
        if w <= 0 or h <= 0 or w * h > 25_000_000:
            return None
        with warnings.catch_warnings():
            warnings.simplefilter("error", PILImage.DecompressionBombWarning)
            img.thumbnail((_MAX_SIDE, _MAX_SIDE))
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
        out = BytesIO()
        img.save(out, format="JPEG", quality=_JPEG_QUALITY)
        return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()
    except Exception:
        return None


async def store_member_photo(db, tenant_slug: str, member_id: str, data_url: str) -> Optional[str]:
    """Compress + upsert the photo into ``member_photos``; return the stable URL.

    Returns None if the image can't be processed. Does NOT touch members.photo —
    callers set it (they know their own write path).
    """
    compressed = compress_photo_data_url(data_url)
    if not compressed:
        return None
    content_hash = hashlib.sha256(compressed.encode()).hexdigest()
    await db.member_photos.update_one(
        {"member_id": member_id},
        {"$set": {
            "member_id": member_id,
            "data": compressed,
            "hash": content_hash,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return build_photo_url(tenant_slug, member_id, content_hash)


async def delete_member_photo(db, member_id: str) -> None:
    await db.member_photos.delete_one({"member_id": member_id})


async def load_photo_data_map(db, member_ids: List[str]) -> Dict[str, str]:
    """Bulk map member_id -> photo data URL from the photo store (for exports)."""
    ids = [m for m in set(member_ids) if m]
    if not ids:
        return {}
    docs = await db.member_photos.find(
        {"member_id": {"$in": ids}}, {"_id": 0, "member_id": 1, "data": 1}
    ).to_list(len(ids))
    return {d["member_id"]: d.get("data", "") for d in docs if d.get("data")}
