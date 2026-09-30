import asyncio
from io import BytesIO
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from utils.certificate_artwork import branch_artwork, store_artwork_image


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
