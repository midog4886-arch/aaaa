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


# ── Generic entity photo store (coaches, supervisors) ──────────────────────
# Same design as member photos, generalized: photo lives in a per-kind
# collection, the entity doc keeps only a signed relative URL that every
# existing <img src> consumer renders unchanged. Member photos keep their
# original URL/signature shape (unprefixed payload) for backward
# compatibility with already-issued URLs.

ENTITY_PHOTO_KINDS = {
    "member": {"collection": "member_photos", "id_field": "member_id"},
    "coach": {"collection": "coach_photos", "id_field": "coach_id"},
    "supervisor": {"collection": "supervisor_photos", "id_field": "supervisor_id"},
}


def _kind_conf(kind: str) -> dict:
    conf = ENTITY_PHOTO_KINDS.get(kind)
    if not conf:
        raise ValueError(f"unknown photo kind: {kind}")
    return conf


def entity_photo_sig(kind: str, tenant_slug: str, entity_id: str) -> str:
    if kind == "member":
        return photo_sig(tenant_slug, entity_id)
    return hmac.new(_secret(), f"{kind}:{tenant_slug}:{entity_id}".encode(),
                    hashlib.sha256).hexdigest()[:20]


def verify_entity_photo_sig(kind: str, tenant_slug: str, entity_id: str, sig: str) -> bool:
    return bool(sig) and hmac.compare_digest(entity_photo_sig(kind, tenant_slug, entity_id), sig)


def build_entity_photo_url(kind: str, tenant_slug: str, entity_id: str, content_hash: str) -> str:
    _kind_conf(kind)
    return (
        f"/api/public/{kind}-photo/{tenant_slug}/{entity_id}"
        f"?v={content_hash[:10]}&sig={entity_photo_sig(kind, tenant_slug, entity_id)}"
    )


def is_entity_photo_url(value) -> bool:
    return isinstance(value, str) and value.startswith("/api/public/") and "-photo/" in value


_ENTITY_URL_RE = None


def is_own_entity_photo_url(kind: str, tenant_slug: str, entity_id: str, value) -> bool:
    """Strict write-boundary check for an echoed photo URL.

    True only when ``value`` is the signed photo URL of EXACTLY this kind,
    tenant and entity (signature verified). Anything else — another entity's
    URL, another kind's URL, a foreign tenant's URL, or a forged sig — is
    rejected, so a signed URL obtained elsewhere can't be grafted onto a
    different entity through the edit form.
    """
    if not isinstance(value, str):
        return False
    _kind_conf(kind)
    import re
    m = re.match(
        r"^/api/public/([a-z]+)-photo/([a-z0-9_]{1,64})/([^/?]+)\?v=[0-9a-f]{1,64}&sig=([0-9a-f]{20})$",
        value,
    )
    if not m:
        return False
    url_kind, url_slug, url_id, sig = m.groups()
    if url_kind != kind or url_slug != tenant_slug or url_id != entity_id:
        return False
    return verify_entity_photo_sig(kind, tenant_slug, entity_id, sig)


async def store_entity_photo(db, kind: str, tenant_slug: str, entity_id: str, data_url: str) -> Optional[str]:
    """Compress + upsert an entity photo; return the stable signed URL (or None)."""
    conf = _kind_conf(kind)
    compressed = compress_photo_data_url(data_url)
    if not compressed:
        return None
    content_hash = hashlib.sha256(compressed.encode()).hexdigest()
    await db[conf["collection"]].update_one(
        {conf["id_field"]: entity_id},
        {"$set": {
            conf["id_field"]: entity_id,
            "data": compressed,
            "hash": content_hash,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return build_entity_photo_url(kind, tenant_slug, entity_id, content_hash)


async def delete_entity_photo(db, kind: str, entity_id: str) -> None:
    conf = _kind_conf(kind)
    await db[conf["collection"]].delete_one({conf["id_field"]: entity_id})


async def get_entity_photo_doc(db, kind: str, entity_id: str) -> Optional[dict]:
    conf = _kind_conf(kind)
    return await db[conf["collection"]].find_one(
        {conf["id_field"]: entity_id}, {"_id": 0, "data": 1, "hash": 1}
    )


async def load_photo_data_map(db, member_ids: List[str]) -> Dict[str, str]:
    """Bulk map member_id -> photo data URL from the photo store (for exports)."""
    ids = [m for m in set(member_ids) if m]
    if not ids:
        return {}
    docs = await db.member_photos.find(
        {"member_id": {"$in": ids}}, {"_id": 0, "member_id": 1, "data": 1}
    ).to_list(len(ids))
    return {d["member_id"]: d.get("data", "") for d in docs if d.get("data")}
