"""Member signed-photo URL: cross-tenant leak guards (task: keep the member
photo URL from leaking between academies).

Covers, at the route-handler level (backend/server.py get_member_photo_public):
  - valid sig serves the photo bytes with immutable cache headers
  - tampered sig / slug / member_id -> 403
  - slug format abuse (dots, traversal, spaces, over-long, dashes) -> 403;
    uppercase/whitespace is CANONICALIZED to lowercase before sig check (the
    sig is always computed over the canonical slug, so this widens nothing)
  - missing photo doc -> 404, malformed stored data -> 404
And at the write path:
  - portal profile upload stores in member_photos and writes the signed URL
  - empty photo clears the store doc
  - migration rerun is a no-op once photos are URL-valued
"""
import asyncio
import base64
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("SESSION_SECRET", "test-secret")

from utils import member_photos as mp  # noqa: E402


def run(coro):
    # Own loop per call: order-independent under the full suite (other tests
    # may close/replace the process-global loop via asyncio.run).
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# 1x1 red pixel PNG
_PNG = "data:image/png;base64," + base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
    "53de0000000c4944415408d763f8cfc000000301010018dd8db00000000049"
    "454e44ae426082"
)).decode()


# ── fakes ────────────────────────────────────────────────────────────────────

class _FakeCollection:
    def __init__(self):
        self.docs = {}
        self.update_calls = 0

    def _key(self, q):
        for k in ("member_id", "id"):
            if k in q and isinstance(q[k], str):
                return q[k]
        return None

    async def find_one(self, q, proj=None):
        k = self._key(q)
        return dict(self.docs[k]) if k in self.docs else None

    async def update_one(self, q, update, upsert=False):
        self.update_calls += 1
        k = self._key(q)
        if k not in self.docs and not upsert:
            return
        doc = self.docs.get(k, {kk: vv for kk, vv in q.items() if isinstance(vv, str)})
        doc.update(update.get("$set", {}))
        self.docs[k] = doc

    async def delete_one(self, q):
        self.docs.pop(self._key(q), None)

    async def create_index(self, *a, **k):
        return None

    def find(self, q, proj=None):
        docs = []
        for d in self.docs.values():
            photo = d.get("photo", "")
            regex = (q.get("photo") or {}).get("$regex") if isinstance(q.get("photo"), dict) else None
            if regex is None or (isinstance(photo, str) and photo.startswith(regex.lstrip("^"))):
                docs.append(dict(d))
        return _FakeCursor(docs)

    def aggregate(self, pipeline):
        return _FakeCursor([])

    async def update_many(self, q, update):
        class R:
            modified_count = 0
        return R()


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        self._it = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration

    async def to_list(self, n=None):
        return list(self._docs)


class _FakeDB:
    def __init__(self):
        self.cols = {}

    def __getattr__(self, name):
        return self.cols.setdefault(name, _FakeCollection())

    def __getitem__(self, name):
        return self.cols.setdefault(name, _FakeCollection())


class _FakeRawClient:
    """Maps tenant db name -> fake db; records which db names were opened."""

    def __init__(self):
        self.dbs = {}
        self.opened = []

    def __getitem__(self, name):
        self.opened.append(name)
        return self.dbs.setdefault(name, _FakeDB())


@pytest.fixture()
def served(monkeypatch):
    """Wire the public route to a fake raw client with one stored photo."""
    import server
    import database
    from utils.tenant import slug_to_db_name

    raw = _FakeRawClient()
    monkeypatch.setattr(database, "_raw_client", raw)

    slug, mid = "acad_a", "m-1"
    compressed = mp.compress_photo_data_url(_PNG)
    tdb = raw[slug_to_db_name(slug)]
    run(tdb.member_photos.update_one(
        {"member_id": mid},
        {"$set": {"member_id": mid, "data": compressed, "hash": "h" * 64}},
        upsert=True,
    ))
    return server, raw, slug, mid


# ── serving route ────────────────────────────────────────────────────────────

def test_valid_sig_serves_photo(served):
    server, raw, slug, mid = served
    resp = run(server.get_member_photo_public(slug, mid, v="x", sig=mp.photo_sig(slug, mid)))
    assert resp.media_type == "image/jpeg"
    assert resp.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert resp.headers["etag"] == '"' + "h" * 16 + '"'
    assert len(resp.body) > 100


def test_tampered_sig_slug_member_rejected(served):
    server, raw, slug, mid = served
    good = mp.photo_sig(slug, mid)
    cases = [
        (slug, mid, ""),                                   # missing sig
        (slug, mid, "0" * 20),                             # forged sig
        (slug, "m-2", good),                               # sig for other member
        ("acad_b", mid, good),                             # sig for other tenant
        (slug, mid, mp.photo_sig("acad_b", mid)),          # foreign-tenant sig
        (slug, mid, mp.entity_photo_sig("coach", slug, mid)),  # cross-kind sig
    ]
    for s, m, sig in cases:
        with pytest.raises(HTTPException) as e:
            run(server.get_member_photo_public(s, m, v="x", sig=sig))
        assert e.value.status_code == 403, (s, m, sig)


def test_slug_format_abuse_rejected(served):
    server, raw, slug, mid = served
    for bad in ("a.b", "../../etc", "a b", "a" * 65, "", "a-b"):
        sig = mp.photo_sig(bad.strip().lower(), mid)
        with pytest.raises(HTTPException) as e:
            run(server.get_member_photo_public(bad, mid, v="x", sig=sig))
        assert e.value.status_code == 403, bad


def test_uppercase_slug_canonicalized_not_widened(served):
    """Uppercase/whitespace slugs are canonicalized to lowercase BEFORE the
    signature check, so ' ACAD_A ' serves the same photo as 'acad_a' — but the
    sig is always verified over the canonical slug, so a sig computed over any
    OTHER (e.g. uppercase-raw) payload is rejected."""
    server, raw, slug, mid = served
    resp = run(server.get_member_photo_public(" ACAD_A ", mid, v="x", sig=mp.photo_sig(slug, mid)))
    assert resp.media_type == "image/jpeg"
    # A sig minted over the raw (non-canonical) slug must NOT verify.
    with pytest.raises(HTTPException) as e:
        run(server.get_member_photo_public("ACAD_A", mid, v="x", sig=mp.photo_sig("ACAD_A", mid)))
    assert e.value.status_code == 403


def test_missing_photo_404(served):
    server, raw, slug, mid = served
    with pytest.raises(HTTPException) as e:
        run(server.get_member_photo_public(slug, "ghost", v="x", sig=mp.photo_sig(slug, "ghost")))
    assert e.value.status_code == 404


def test_malformed_stored_data_404(served):
    server, raw, slug, mid = served
    from utils.tenant import slug_to_db_name
    tdb = raw[slug_to_db_name(slug)]
    run(tdb.member_photos.update_one(
        {"member_id": mid}, {"$set": {"data": "not-a-data-url"}}))
    with pytest.raises(HTTPException) as e:
        run(server.get_member_photo_public(slug, mid, v="x", sig=mp.photo_sig(slug, mid)))
    assert e.value.status_code == 404


def test_tenant_db_resolved_from_url_slug(served):
    """The photo must be read from the slug's OWN db — tenant A's sig can never
    open tenant B's collection (name comes from the verified slug)."""
    server, raw, slug, mid = served
    from utils.tenant import slug_to_db_name
    raw.opened.clear()
    run(server.get_member_photo_public(slug, mid, v="x", sig=mp.photo_sig(slug, mid)))
    assert raw.opened == [slug_to_db_name(slug)]


# ── portal write path ────────────────────────────────────────────────────────

@pytest.fixture()
def portal(monkeypatch):
    from routes import member_portal as portal_mod
    import utils.tenant as tenant_mod
    fdb = _FakeDB()
    monkeypatch.setattr(portal_mod, "db", fdb)
    monkeypatch.setattr(tenant_mod, "get_current_tenant_slug", lambda: "acad_a")
    fdb["members"].docs["m-1"] = {"id": "m-1", "name": "x", "photo": ""}
    member = {"id": "m-1", "phone": "0500000000"}
    return portal_mod, fdb, member


def test_portal_upload_stores_and_writes_url(portal):
    portal_mod, fdb, member = portal
    out = run(portal_mod.update_member_profile(
        portal_mod.MemberProfileUpdate(photo=_PNG), member))
    stored = fdb["member_photos"].docs.get("m-1")
    assert stored and stored["data"].startswith("data:image/jpeg;base64,")
    url = out["profile"]["photo"]
    assert url.startswith("/api/public/member-photo/acad_a/m-1?")
    assert f"sig={mp.photo_sig('acad_a', 'm-1')}" in url
    assert fdb["members"].docs["m-1"]["photo"] == url


def test_portal_empty_photo_clears_store(portal):
    portal_mod, fdb, member = portal
    run(portal_mod.update_member_profile(
        portal_mod.MemberProfileUpdate(photo=_PNG), member))
    assert "m-1" in fdb["member_photos"].docs
    out = run(portal_mod.update_member_profile(
        portal_mod.MemberProfileUpdate(photo=""), member))
    assert "m-1" not in fdb["member_photos"].docs
    assert out["profile"]["photo"] == ""


def test_portal_rejects_non_image(portal):
    portal_mod, fdb, member = portal
    with pytest.raises(HTTPException) as e:
        run(portal_mod.update_member_profile(
            portal_mod.MemberProfileUpdate(photo="https://x/evil.png"), member))
    assert e.value.status_code == 400
    assert not fdb["member_photos"].docs


# ── migration idempotency ────────────────────────────────────────────────────

def test_migration_rerun_noop(monkeypatch):
    import database
    import utils.tenant as tenant_mod
    from scripts import migrate_member_photos as mig

    fdb = _FakeDB()
    monkeypatch.setattr(database, "db", fdb)
    monkeypatch.setattr(tenant_mod, "get_current_tenant_slug", lambda: "acad_a")

    fdb["members"].docs["m-1"] = {"id": "m-1", "photo": _PNG}
    stats1 = run(mig.migrate_tenant({"slug": "acad_a"}))
    assert stats1["members_migrated"] == 1
    url = fdb["members"].docs["m-1"]["photo"]
    assert mp.is_photo_url(url)

    # Rerun: URL-valued photo must be skipped, store untouched.
    before = dict(fdb["member_photos"].docs["m-1"])
    calls_before = fdb["member_photos"].update_calls
    stats2 = run(mig.migrate_tenant({"slug": "acad_a"}))
    assert stats2["members_migrated"] == 0 and stats2["members_failed"] == 0
    assert fdb["members"].docs["m-1"]["photo"] == url
    assert fdb["member_photos"].docs["m-1"] == before
    assert fdb["member_photos"].update_calls == calls_before
