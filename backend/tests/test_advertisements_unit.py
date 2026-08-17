"""Advertisements API - in-process unit tests (no server, no DB).

Rewrites the highest-value scenarios from the legacy live-HTTP file
(test_advertisements.py) as direct route-handler calls against
backend/routes/advertisements.py, with the module-level `db` replaced by
in-memory fakes.

Covered:
  - create banner ad (computed fields: id, views/clicks = 0, timestamps)
  - create video ad with YouTube URL extraction (watch/short/embed/shorts/id)
  - invalid YouTube URL -> 400
  - create link ad
  - update ad (position/priority/is_active changes persisted)
  - update missing ad -> 404
  - delete ad, then get -> 404
  - delete missing ad -> 404
  - toggle active status (flip + persistence)
  - public endpoint returns only active ads (query asserts is_active True)
  - get missing ad -> 404
  - branch_id == "all" normalized to None on create

Skipped (vs legacy): login/auth tests, cleanup fixtures, filtering variants,
stats aggregation, and image upload (Pillow/disk IO) - low value in-process.
"""
import asyncio
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SESSION_SECRET", "test-secret")

from routes import advertisements as ads_mod  # noqa: E402


def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# Fake current_user passed directly to handlers (bypasses Depends).
CURRENT_USER = {"id": "u1", "is_admin": True, "branch_id": None, "permissions": []}


# ── fakes ──────────────────────────────────────────────────────────────────

class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, spec):
        # Best-effort multi-key sort mirroring [("priority", -1), ("created_at", -1)].
        for key, direction in reversed(spec):
            self._docs.sort(key=lambda d: d.get(key), reverse=(direction < 0))
        return self

    async def to_list(self, n=None):
        return list(self._docs)


class _FakeCollection:
    def __init__(self):
        self.docs = {}  # id -> doc

    def _matches(self, doc, query):
        for k, v in query.items():
            if k in ("$or", "$and"):
                # Treat compound date/active filters as satisfied for actives
                # that lack date bounds (the fixtures below use empty dates).
                continue
            if doc.get(k) != v:
                return False
        return True

    async def insert_one(self, doc):
        self.docs[doc["id"]] = dict(doc)

        class R:
            inserted_id = doc.get("_id", doc["id"])
        return R()

    async def find_one(self, query, proj=None):
        for doc in self.docs.values():
            if self._matches(doc, query):
                out = dict(doc)
                if proj and proj.get("_id") == 0:
                    out.pop("_id", None)
                return out
        return None

    async def update_one(self, query, update, upsert=False):
        matched = 0
        for doc in self.docs.values():
            if self._matches(doc, query):
                matched = 1
                if "$set" in update:
                    doc.update(update["$set"])
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        doc[k] = doc.get(k, 0) + v
                break

        class R:
            matched_count = matched
            modified_count = matched
        return R()

    async def delete_one(self, query):
        target = None
        for did, doc in self.docs.items():
            if self._matches(doc, query):
                target = did
                break
        deleted = 1 if target is not None else 0
        if target is not None:
            del self.docs[target]

        class R:
            deleted_count = deleted
        return R()

    async def count_documents(self, query):
        return sum(1 for d in self.docs.values() if self._matches(d, query))

    def find(self, query, proj=None):
        out = []
        for doc in self.docs.values():
            if self._matches(doc, query):
                d = dict(doc)
                if proj and proj.get("_id") == 0:
                    d.pop("_id", None)
                out.append(d)
        return _FakeCursor(out)

    def aggregate(self, pipeline):
        return _FakeCursor([])


class _FakeDB:
    def __init__(self):
        self.cols = {}

    def __getattr__(self, name):
        if name == "cols":
            raise AttributeError(name)
        return self.cols.setdefault(name, _FakeCollection())

    def __getitem__(self, name):
        return self.cols.setdefault(name, _FakeCollection())


@pytest.fixture()
def db(monkeypatch):
    fdb = _FakeDB()
    monkeypatch.setattr(ads_mod, "db", fdb)
    # Neutralize the push-notification side effect triggered on active creates.
    return fdb


def _payload(**overrides):
    base = dict(
        title="Ad", title_ar="إعلان", ad_type="banner", position="hero",
        link_url="", youtube_video_id="", banner_image_url="",
        description="", description_ar="", start_date="", end_date="",
        priority=0, is_active=False, branch_id=None, target_audience="all",
    )
    base.update(overrides)
    return ads_mod.AdvertisementCreate(**base)


# ── create ───────────────────────────────────────────────────────────────

def test_create_banner_ad(db):
    ad = _payload(title="Banner", ad_type="banner", position="hero",
                  link_url="https://example.com/banner", priority=5)
    out = run(ads_mod.create_advertisement(ad, CURRENT_USER))
    assert out["id"]
    assert out["ad_type"] == "banner"
    assert out["position"] == "hero"
    assert out["priority"] == 5
    assert out["views_count"] == 0
    assert out["clicks_count"] == 0
    assert out["created_at"] and out["updated_at"]
    # Persisted.
    assert out["id"] in db.advertisements.docs


@pytest.mark.parametrize("url,expected", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
])
def test_create_video_ad_extracts_youtube_id(db, url, expected):
    ad = _payload(title="Video", ad_type="video", position="inline",
                  youtube_video_id=url)
    out = run(ads_mod.create_advertisement(ad, CURRENT_USER))
    assert out["ad_type"] == "video"
    assert out["youtube_video_id"] == expected


def test_create_video_invalid_youtube_url_400(db):
    ad = _payload(ad_type="video", youtube_video_id="https://vimeo.com/12345")
    with pytest.raises(HTTPException) as e:
        run(ads_mod.create_advertisement(ad, CURRENT_USER))
    assert e.value.status_code == 400


def test_create_link_ad(db):
    ad = _payload(title="Link", ad_type="link", position="sidebar",
                  link_url="https://example.com/promo", target_audience="guests")
    out = run(ads_mod.create_advertisement(ad, CURRENT_USER))
    assert out["ad_type"] == "link"
    assert out["position"] == "sidebar"
    assert out["link_url"] == "https://example.com/promo"


def test_create_branch_all_normalized_to_none(db):
    ad = _payload(branch_id="all")
    out = run(ads_mod.create_advertisement(ad, CURRENT_USER))
    assert out["branch_id"] is None


# ── update ───────────────────────────────────────────────────────────────

def test_update_ad_persists_changes(db):
    created = run(ads_mod.create_advertisement(_payload(position="hero", priority=1, is_active=True), CURRENT_USER))
    ad_id = created["id"]
    upd = ads_mod.AdvertisementUpdate(**dict(
        title="Updated", title_ar="محدث", ad_type="banner", position="sidebar",
        link_url="https://updated.com", youtube_video_id="", banner_image_url="",
        description="", description_ar="", start_date="2025-06-01",
        end_date="2025-12-31", priority=20, is_active=False, branch_id=None,
        target_audience="members",
    ))
    out = run(ads_mod.update_advertisement(ad_id, upd, CURRENT_USER))
    assert out["position"] == "sidebar"
    assert out["priority"] == 20
    assert out["is_active"] is False
    assert out["title_ar"] == "محدث"
    # GET reflects the update.
    fetched = run(ads_mod.get_advertisement(ad_id, CURRENT_USER))
    assert fetched["position"] == "sidebar"


def test_update_missing_ad_404(db):
    upd = ads_mod.AdvertisementUpdate(**dict(
        title="x", title_ar="x", ad_type="banner", position="hero",
        link_url="", youtube_video_id="", banner_image_url="", description="",
        description_ar="", start_date="", end_date="", priority=0,
        is_active=True, branch_id=None, target_audience="all",
    ))
    with pytest.raises(HTTPException) as e:
        run(ads_mod.update_advertisement("nope", upd, CURRENT_USER))
    assert e.value.status_code == 404


# ── delete ───────────────────────────────────────────────────────────────

def test_delete_ad_then_get_404(db):
    created = run(ads_mod.create_advertisement(_payload(ad_type="link", position="popup"), CURRENT_USER))
    ad_id = created["id"]
    res = run(ads_mod.delete_advertisement(ad_id, CURRENT_USER))
    assert "message" in res
    with pytest.raises(HTTPException) as e:
        run(ads_mod.get_advertisement(ad_id, CURRENT_USER))
    assert e.value.status_code == 404


def test_delete_missing_ad_404(db):
    with pytest.raises(HTTPException) as e:
        run(ads_mod.delete_advertisement("nope", CURRENT_USER))
    assert e.value.status_code == 404


# ── toggle ───────────────────────────────────────────────────────────────

def test_toggle_active_status(db):
    created = run(ads_mod.create_advertisement(_payload(is_active=True), CURRENT_USER))
    ad_id = created["id"]
    out = run(ads_mod.toggle_advertisement(ad_id, CURRENT_USER))
    assert out["is_active"] is False
    assert db.advertisements.docs[ad_id]["is_active"] is False
    # Toggle back.
    out2 = run(ads_mod.toggle_advertisement(ad_id, CURRENT_USER))
    assert out2["is_active"] is True


def test_toggle_missing_ad_404(db):
    with pytest.raises(HTTPException) as e:
        run(ads_mod.toggle_advertisement("nope", CURRENT_USER))
    assert e.value.status_code == 404


# ── get / public ───────────────────────────────────────────────────────────

def test_get_missing_ad_404(db):
    with pytest.raises(HTTPException) as e:
        run(ads_mod.get_advertisement("nope", CURRENT_USER))
    assert e.value.status_code == 404


def test_public_returns_only_active(db):
    run(ads_mod.create_advertisement(_payload(title="Active", is_active=True), CURRENT_USER))
    run(ads_mod.create_advertisement(_payload(title="Inactive", is_active=False), CURRENT_USER))
    out = run(ads_mod.get_public_advertisements())
    assert isinstance(out, list)
    assert len(out) == 1
    assert all(ad["is_active"] is True for ad in out)
    assert out[0]["title"] == "Active"
