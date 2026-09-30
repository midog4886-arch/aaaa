"""Immutable certificate images and per-branch layout snapshots."""
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import base64
import warnings

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

DEFAULT_ARTWORK = {
    "design_id": None,
    "stamp_id": None,
    "name_top": 55.2,
    "name_left": 23.0,
    "name_width": 54.0,
    "date_top": 79.5,
    "date_left": 24.0,
    "date_width": 15.5,
    "stamp_left": 65.0,
    "stamp_top": 77.0,
    "stamp_width": 16.0,
}
POSITION_RANGES = {
    "name_top": (20, 75),
    "name_left": (0, 80),
    "name_width": (15, 100),
    "date_top": (60, 95),
    "date_left": (0, 85),
    "date_width": (5, 80),
    "stamp_left": (0, 90),
    "stamp_top": (55, 95),
    "stamp_width": (5, 40),
}


def public_artwork(config=None):
    config = config or {}
    artwork = {**DEFAULT_ARTWORK, **{key: config[key] for key in DEFAULT_ARTWORK if key in config}}
    artwork["design_url"] = f"/api/certificates/artwork/{artwork['design_id']}" if artwork["design_id"] else "/images/level-achievement-certificate.jpeg"
    artwork["stamp_url"] = f"/api/certificates/artwork/{artwork['stamp_id']}" if artwork["stamp_id"] else None
    return artwork


async def branch_artwork(db, branch_id):
    if not branch_id:
        return public_artwork()
    row = await db.certificate_artwork_settings.find_one({"branch_id": branch_id}, {"_id": 0})
    return public_artwork(row)


async def store_artwork_image(db, upload: UploadFile, kind: str):
    if upload.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(400, "ارفع صورة PNG أو JPG أو WEBP")
    raw = await upload.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(413, "حجم الصورة يتجاوز 8 ميجابايت")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = ImageOps.exif_transpose(Image.open(BytesIO(raw)))
            image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise HTTPException(400, "ملف الصورة غير صالح")
    if kind == "design":
        if not 1.15 <= image.width / image.height <= 1.35:
            raise HTTPException(400, "نسبة تصميم الشهادة يجب أن تقارب 1402×1122")
        image = ImageOps.fit(image.convert("RGB"), (1402, 1122), method=Image.Resampling.LANCZOS)
        media_type, extension = "image/jpeg", "jpg"
    else:
        image.thumbnail((700, 700), Image.Resampling.LANCZOS)
        image = image.convert("RGBA")
        media_type, extension = "image/png", "png"
    output = BytesIO()
    image.save(output, "JPEG" if kind == "design" else "PNG", optimize=True)
    content = output.getvalue()
    asset_id = sha256(content).hexdigest()
    await db.certificate_artwork_assets.update_one(
        {"id": asset_id},
        {"$setOnInsert": {
            "id": asset_id, "kind": kind, "content_type": media_type,
            "data": base64.b64encode(content).decode("ascii"),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "extension": extension,
        }},
        upsert=True,
    )
    return asset_id
