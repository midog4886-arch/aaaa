"""Coach/supervisor photo store tests (generalized member-photo design).

Guards:
  - signatures are kind-scoped: a valid coach sig must not serve the same id
    as supervisor/member (cross-kind forgery) and member sigs stay unchanged
    (backward compat with already-issued member URLs)
  - store/delete round-trip hits the right per-kind collection
  - write-path photo resolution: data URL -> stored URL, URL echo -> kept,
    empty -> store doc removed
"""
import asyncio
import base64
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

os.environ.setdefault("SESSION_SECRET", "test-secret")

from utils import member_photos as mp  # noqa: E402


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# 1x1 red pixel PNG
_PNG = "data:image/png;base64," + base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
    "53de0000000c4944415408d763f8cfc000000301010018dd8db00000000049"
    "454e44ae426082"
)).decode()


def test_entity_sig_is_kind_scoped():
    coach_sig = mp.entity_photo_sig("coach", "foo", "abc")
    sup_sig = mp.entity_photo_sig("supervisor", "foo", "abc")
    mem_sig = mp.entity_photo_sig("member", "foo", "abc")
    assert len({coach_sig, sup_sig, mem_sig}) == 3
    assert mp.verify_entity_photo_sig("coach", "foo", "abc", coach_sig)
    assert not mp.verify_entity_photo_sig("supervisor", "foo", "abc", coach_sig)
    assert not mp.verify_entity_photo_sig("coach", "bar", "abc", coach_sig)
    assert not mp.verify_entity_photo_sig("coach", "foo", "abc", "")


def test_member_sig_backward_compatible():
    # already-issued member URLs were signed with the unprefixed payload
    assert mp.entity_photo_sig("member", "foo", "m1") == mp.photo_sig("foo", "m1")


def test_build_entity_photo_url_shape():
    url = mp.build_entity_photo_url("coach", "foo", "c1", "abcdef123456")
    assert url.startswith("/api/public/coach-photo/foo/c1?v=abcdef1234&sig=")
    assert mp.is_entity_photo_url(url)
    assert mp.is_entity_photo_url(mp.build_photo_url("foo", "m1", "abcdef123456"))
    assert not mp.is_entity_photo_url(_PNG)
    assert not mp.is_entity_photo_url("https://evil.example/api/public/coach-photo/x")


class _FakeCollection:
    def __init__(self):
        self.docs = {}

    async def update_one(self, q, update, upsert=False):
        key = list(q.values())[0]
        doc = self.docs.get(key, dict(q))
        doc.update(update.get("$set", {}))
        self.docs[key] = doc

    async def delete_one(self, q):
        self.docs.pop(list(q.values())[0], None)

    async def find_one(self, q, proj=None):
        return self.docs.get(list(q.values())[0])


class _FakeDB:
    def __init__(self):
        self.cols = {}

    def __getitem__(self, name):
        return self.cols.setdefault(name, _FakeCollection())


def test_store_and_delete_round_trip_per_kind():
    db = _FakeDB()
    url = run(mp.store_entity_photo(db, "coach", "foo", "c1", _PNG))
    assert url and url.startswith("/api/public/coach-photo/foo/c1?")
    assert "c1" in db["coach_photos"].docs
    assert "supervisor_photos" not in db.cols or not db["supervisor_photos"].docs
    doc = run(mp.get_entity_photo_doc(db, "coach", "c1"))
    assert doc["data"].startswith("data:image/jpeg;base64,")
    run(mp.delete_entity_photo(db, "coach", "c1"))
    assert run(mp.get_entity_photo_doc(db, "coach", "c1")) is None


def test_store_rejects_garbage():
    db = _FakeDB()
    assert run(mp.store_entity_photo(db, "supervisor", "foo", "s1", "data:image/png;base64,!!!")) is None
    assert run(mp.store_entity_photo(db, "supervisor", "foo", "s1", "not a photo")) is None
    assert not db["supervisor_photos"].docs


def test_unknown_kind_raises():
    with pytest.raises(ValueError):
        mp.build_entity_photo_url("user", "foo", "x", "h")


def test_coach_resolve_photo_field(monkeypatch):
    from routes import coaches as coaches_mod
    db = _FakeDB()
    monkeypatch.setattr(coaches_mod, "db", db)
    monkeypatch.setattr(coaches_mod, "get_current_tenant_slug", lambda: "foo")

    # data URL -> stored + URL
    url = run(coaches_mod._resolve_photo_field("c9", _PNG))
    assert url.startswith("/api/public/coach-photo/foo/c9?")
    # URL echo -> kept, store untouched
    assert run(coaches_mod._resolve_photo_field("c9", url)) == url
    assert "c9" in db["coach_photos"].docs
    # empty -> store doc removed, None persisted
    assert run(coaches_mod._resolve_photo_field("c9", "")) is None
    assert "c9" not in db["coach_photos"].docs


def test_url_grafting_rejected(monkeypatch):
    """A signed URL from another kind/tenant/entity must NOT be accepted as
    a photo echo — write boundary enforces own-URL only."""
    from routes import coaches as coaches_mod
    from fastapi import HTTPException
    db = _FakeDB()
    monkeypatch.setattr(coaches_mod, "db", db)
    monkeypatch.setattr(coaches_mod, "get_current_tenant_slug", lambda: "foo")

    own = run(coaches_mod._resolve_photo_field("c1", _PNG))
    member_url = mp.build_photo_url("foo", "c1", "h" * 12)          # member kind, same id
    other_coach = mp.build_entity_photo_url("coach", "foo", "c2", "h" * 12)
    foreign = mp.build_entity_photo_url("coach", "bar", "c1", "h" * 12)
    forged = own.split("sig=")[0] + "sig=" + "0" * 20
    for bad in (member_url, other_coach, foreign, forged):
        with pytest.raises(HTTPException):
            run(coaches_mod._resolve_photo_field("c1", bad))
    # own URL still accepted
    assert run(coaches_mod._resolve_photo_field("c1", own)) == own


def test_is_own_entity_photo_url():
    url = mp.build_entity_photo_url("supervisor", "foo", "s1", "abc123def456")
    assert mp.is_own_entity_photo_url("supervisor", "foo", "s1", url)
    assert not mp.is_own_entity_photo_url("coach", "foo", "s1", url)
    assert not mp.is_own_entity_photo_url("supervisor", "bar", "s1", url)
    assert not mp.is_own_entity_photo_url("supervisor", "foo", "s2", url)
    assert not mp.is_own_entity_photo_url("supervisor", "foo", "s1", None)
    assert not mp.is_own_entity_photo_url("supervisor", "foo", "s1", "https://x" + url)


def test_coach_validate_photo_accepts_stored_url():
    from routes.coaches import _validate_photo
    _validate_photo(mp.build_entity_photo_url("coach", "foo", "c1", "h" * 12))
    _validate_photo(None)
    with pytest.raises(Exception):
        _validate_photo("http://x/evil.png")
