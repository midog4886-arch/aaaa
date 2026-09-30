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


def prepare_stamp_image(image):
    """Keep transparent artwork, or isolate blue ink from an opaque stamp photo."""
    image.thumbnail((700, 700), Image.Resampling.LANCZOS)
    image = image.convert("RGBA")
    original_alpha = image.getchannel("A")
    if original_alpha.getextrema()[0] < 245:
        alpha = original_alpha
    else:
        # Blue ink has a stronger blue channel than either red or green;
        # neutral white/grey paper has nearly equal channels.
        alpha = Image.new("L", image.size)
        alpha.putdata([
            max(0, min(255, (blue - max(red, green) - 5) * 8))
            for red, green, blue, _ in image.getdata()
        ])
        if not alpha.getbbox():
            raise HTTPException(422, "لم أتعرف على حبر أزرق في الصورة. ارفع ختمًا أزرق واضحًا أو PNG بخلفية شفافة")
        image.putalpha(alpha)
    bounds = alpha.getbbox()
    if not bounds:
        raise HTTPException(422, "صورة الختم فارغة")
    padding = max(4, round(max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 0.06))
    return image.crop((
        max(0, bounds[0] - padding), max(0, bounds[1] - padding),
        min(image.width, bounds[2] + padding), min(image.height, bounds[3] + padding),
    ))


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
        image = prepare_stamp_image(image)
        media_type, extension = "image/png", "png"
    return await _persist_artwork_image(db, image, kind, media_type, extension)


async def clean_existing_stamp(db, asset_id: str):
    asset = await db.certificate_artwork_assets.find_one({"id": asset_id, "kind": "stamp"}, {"_id": 0})
    if not asset:
        raise HTTPException(404, "الختم غير موجود")
    try:
        image = Image.open(BytesIO(base64.b64decode(asset["data"])))
        image.load()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, "صورة الختم غير صالحة")
    return await _persist_artwork_image(db, prepare_stamp_image(image), "stamp", "image/png", "png")


async def _persist_artwork_image(db, image, kind, media_type, extension):
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
