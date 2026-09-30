import asyncio
import base64
from io import BytesIO
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from utils.certificate_artwork import branch_artwork, clean_existing_stamp, store_artwork_image


class Collection:
    def __init__(self, rows=None):
        self.rows = rows or []

    async def find_one(self, query, projection=None):
        return next((dict(row) for row in self.rows if all(row.get(key) == value for key, value in query.items())), None)

    async def update_one(self, query, update, upsert=False):
        row = await self.find_one(query)
        if row is None:
            row = dict(query)
            self.rows.append(row)
        else:
            row = next(item for item in self.rows if all(item.get(key) == value for key, value in query.items()))
        row.update(update.get("$setOnInsert", {}))


def _upload(size, mode="RGB", image_format="PNG"):
    image = Image.new(mode, size, (255, 0, 0, 0) if mode == "RGBA" else "red")
    if mode == "RGBA":
        ImageDraw.Draw(image).ellipse((100, 100, 200, 200), fill=(30, 55, 155, 255))
    data = BytesIO()
    image.save(data, image_format)
    return UploadFile(file=BytesIO(data.getvalue()), filename="art.png", headers={"content-type": "image/png"})


def test_branch_artwork_is_independent_and_immutable_asset_is_reused():
    db = SimpleNamespace(
        certificate_artwork_settings=Collection([
            {"branch_id": "a", "design_id": "one", "stamp_id": "stamp-a"},
            {"branch_id": "b", "design_id": "two", "stamp_id": "stamp-b"},
        ]),
        certificate_artwork_assets=Collection(),
    )
    first = asyncio.run(branch_artwork(db, "a"))
    second = asyncio.run(branch_artwork(db, "b"))
    assert first["design_url"].endswith("/one") and first["stamp_url"].endswith("/stamp-a")
    assert second["design_url"].endswith("/two") and second["stamp_url"].endswith("/stamp-b")
    asset_id = asyncio.run(store_artwork_image(db, _upload((1402, 1122)), "design"))
    assert asset_id == asyncio.run(store_artwork_image(db, _upload((1402, 1122)), "design"))
    assert len(db.certificate_artwork_assets.rows) == 1
    assert db.certificate_artwork_assets.rows[0]["content_type"] == "image/jpeg"


def test_design_ratio_is_checked_and_stamp_keeps_transparency():
    db = SimpleNamespace(certificate_artwork_assets=Collection())
    with pytest.raises(HTTPException) as error:
        asyncio.run(store_artwork_image(db, _upload((600, 600)), "design"))
    assert error.value.status_code == 400
    asset_id = asyncio.run(store_artwork_image(db, _upload((400, 400), mode="RGBA"), "stamp"))
    assert len(asset_id) == 64
    assert db.certificate_artwork_assets.rows[0]["content_type"] == "image/png"
    saved = Image.open(BytesIO(base64.b64decode(db.certificate_artwork_assets.rows[0]["data"])))
    assert saved.width < 200 and saved.height < 200
    assert saved.getpixel((0, 0))[3] == 0


def test_stamp_photo_background_is_removed_and_existing_stamp_can_be_cleaned():
    photo = Image.new("RGB", (400, 400), (175, 175, 175))
    ImageDraw.Draw(photo).ellipse((150, 170, 250, 220), outline=(48, 75, 151), width=5)
    source = BytesIO()
    photo.save(source, "PNG")
    db = SimpleNamespace(certificate_artwork_assets=Collection())
    old_id = "old-stamp"
    db.certificate_artwork_assets.rows.append({
        "id": old_id, "kind": "stamp", "data": base64.b64encode(source.getvalue()).decode("ascii"),
    })
    asset_id = asyncio.run(clean_existing_stamp(db, old_id))
    saved = Image.open(BytesIO(base64.b64decode(next(row for row in db.certificate_artwork_assets.rows if row["id"] == asset_id)["data"])))
    assert saved.width < 130 and saved.height < 80
    assert saved.getpixel((0, 0))[3] == 0
    assert max(saved.getchannel("A").getextrema()) > 100
