"""Unit tests for the default-tenant DB migration script (Task #320).

Locks in the safety contract of
``backend/scripts/migrate_default_tenant_db._run``:

  - dry-run performs no writes,
  - happy-path apply copies docs, updates the control-plane tenant doc,
    and drops the legacy DB,
  - count-mismatch refuses to drop the source,
  - missing legacy DB is a no-op (but still patches a stale control-plane
    doc that still points at the legacy name),
  - non-empty target without ``--force`` is refused with no copy/drop.

All Mongo I/O is mocked so the suite runs without a live database.
"""
from __future__ import annotations

import asyncio
import importlib
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))


# ---------------------------------------------------------------- fakes
class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)
        self._iter = None
        self.closed = False

    def batch_size(self, _n):
        return self

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration

    async def close(self):
        self.closed = True


class _UpdateResult:
    def __init__(self, matched, modified):
        self.matched_count = matched
        self.modified_count = modified


class _FakeCollection:
    def __init__(self, docs=None, indexes=None, count_override=None):
        self.docs = list(docs or [])
        self._indexes = dict(indexes or {"_id_": {"key": [("_id", 1)], "v": 2}})
        self.inserted_batches = []
        self.created_indexes = []
        self.updates = []
        self._count_override = count_override

    async def estimated_document_count(self):
        if self._count_override is not None:
            return self._count_override
        return len(self.docs)

    def find(self, _flt):
        return _FakeCursor(self.docs)

    async def insert_many(self, batch, ordered=True):
        batch = list(batch)
        self.docs.extend(batch)
        self.inserted_batches.append(batch)

    async def index_information(self):
        return dict(self._indexes)

    async def create_index(self, keys, **options):
        self.created_indexes.append((list(keys), options))

    async def update_one(self, flt, update):
        self.updates.append((dict(flt), update))
        matched = modified = 0
        for d in self.docs:
            if all(d.get(k) == v for k, v in flt.items()):
                matched = 1
                for k, v in update.get("$set", {}).items():
                    if d.get(k) != v:
                        modified = 1
                    d[k] = v
                break
        return _UpdateResult(matched, modified)


class _FakeDb:
    def __init__(self, name, collections=None):
        self.name = name
        self._collections = dict(collections or {})

    def __getitem__(self, name):
        if name not in self._collections:
            self._collections[name] = _FakeCollection()
        return self._collections[name]

    def __getattr__(self, name):
        if name.startswith("_") or name == "name":
            raise AttributeError(name)
        return self[name]

    async def list_collection_names(self):
        return list(self._collections.keys())


class _FakeClient:
    """Mimics motor's client where accessing ``client[db]`` is lazy and does
    not by itself cause the database to appear in ``list_database_names``."""

    def __init__(self, dbs):
        self._dbs = dict(dbs)
        self._handles: dict = {}
        self.dropped = []

    def __getitem__(self, name):
        if name in self._dbs:
            return self._dbs[name]
        if name not in self._handles:
            self._handles[name] = _FakeDb(name)
        return self._handles[name]

    async def list_database_names(self):
        return list(self._dbs.keys())

    async def drop_database(self, name):
        self.dropped.append(name)
        self._dbs.pop(name, None)


# ---------------------------------------------------------------- fixtures
@pytest.fixture
def migrate_mod(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://fake/")
    monkeypatch.setenv("LEGACY_DEFAULT_DB_NAME", "champions_academy")
    monkeypatch.setenv("CONTROL_DB_NAME", "champions_control")
    monkeypatch.setenv("TENANT_DB_PREFIX", "champions_")

    import utils.tenant as t
    importlib.reload(t)
    import migrate_default_tenant_db as m
    importlib.reload(m)
    return m


def _install_client(monkeypatch, fake_client):
    import motor.motor_asyncio as motor_mod

    def _factory(*_a, **_kw):
        return fake_client

    monkeypatch.setattr(motor_mod, "AsyncIOMotorClient", _factory, raising=True)


def _build_world(*, legacy_present=True, target_collections=None, src_counts=(("members", 3), ("invoices", 2))):
    """Construct a fake client matching the migration script's expectations."""
    src_collections = {}
    for name, n in src_counts:
        docs = [{"_id": f"{name}-{i}", "n": i} for i in range(n)]
        idx = {
            "_id_": {"key": [("_id", 1)], "v": 2},
            f"{name}_n_idx": {"key": [("n", 1)], "v": 2, "unique": False},
        }
        src_collections[name] = _FakeCollection(docs=docs, indexes=idx)

    dbs = {"champions_control": _FakeDb(
        "champions_control",
        {"tenants": _FakeCollection(
            docs=[{"slug": "default", "db_name": "champions_academy"}]
        )},
    )}
    if legacy_present:
        dbs["champions_academy"] = _FakeDb("champions_academy", src_collections)
    if target_collections is not None:
        dbs["champions_default"] = _FakeDb("champions_default", target_collections)
    return _FakeClient(dbs)


# ---------------------------------------------------------------- (1) dry-run
def test_dry_run_performs_no_writes(monkeypatch, migrate_mod):
    client = _build_world()
    _install_client(monkeypatch, client)

    rc = asyncio.run(migrate_mod._run(dry_run=True, force=False, drop_source=True))

    assert rc == 0
    # No inserts / index creation into any target collection.
    target = client["champions_default"]
    for coll in target._collections.values():
        assert coll.inserted_batches == []
        assert coll.created_indexes == []
    # No drop, no control-plane mutation
    assert client.dropped == []
    tenants = client["champions_control"]._collections["tenants"]
    assert tenants.updates == []


# ---------------------------------------------------------------- (2) happy path
def test_apply_copies_updates_control_doc_and_drops_source(monkeypatch, migrate_mod):
    client = _build_world()
    _install_client(monkeypatch, client)

    rc = asyncio.run(migrate_mod._run(dry_run=False, force=False, drop_source=True))

    assert rc == 0

    # Source docs landed in the target.
    target = client["champions_default"]
    assert sorted(target._collections.keys()) == ["invoices", "members"]
    assert len(target["members"].docs) == 3
    assert len(target["invoices"].docs) == 2

    # Non-_id indexes recreated.
    assert any(opt.get("name") == "members_n_idx"
               for _keys, opt in target["members"].created_indexes)

    # Control-plane doc flipped to the new name.
    tenants = client["champions_control"]._collections["tenants"]
    assert tenants.updates, "control-plane update_one must have been called"
    flt, update = tenants.updates[-1]
    assert flt == {"slug": "default"}
    assert update == {"$set": {"db_name": "champions_default"}}
    assert tenants.docs[0]["db_name"] == "champions_default"

    # Source dropped.
    assert client.dropped == ["champions_academy"]


# ---------------------------------------------------------------- (3) count mismatch
def test_count_mismatch_refuses_to_drop_source(monkeypatch, migrate_mod):
    client = _build_world()
    _install_client(monkeypatch, client)

    # Force the target ``members`` collection to under-report after copy.
    real_target = client["champions_default"]

    real_getitem = _FakeDb.__getitem__

    def patched_getitem(self, name):
        coll = real_getitem(self, name)
        if self.name == "champions_default" and name == "members":
            coll._count_override = 1  # source has 3
        return coll

    monkeypatch.setattr(_FakeDb, "__getitem__", patched_getitem)

    rc = asyncio.run(migrate_mod._run(dry_run=False, force=False, drop_source=True))

    assert rc == 4
    assert client.dropped == []
    # Control-plane doc untouched on mismatch.
    tenants = client["champions_control"]._collections["tenants"]
    assert tenants.updates == []
    assert tenants.docs[0]["db_name"] == "champions_academy"
    # Sanity: target was populated by the copy itself even though count check failed.
    assert len(real_target["members"].docs) == 3


# ---------------------------------------------------------------- (4) missing legacy
def test_missing_legacy_db_is_noop_but_patches_stale_control_doc(monkeypatch, migrate_mod):
    client = _build_world(legacy_present=False)
    _install_client(monkeypatch, client)

    rc = asyncio.run(migrate_mod._run(dry_run=False, force=False, drop_source=True))

    assert rc == 0
    # Nothing dropped, no copy happened.
    assert client.dropped == []
    target = client["champions_default"]
    assert target._collections == {}
    # Stale control-plane doc was healed.
    tenants = client["champions_control"]._collections["tenants"]
    assert tenants.updates, "stale control-plane doc must be patched"
    flt, update = tenants.updates[-1]
    assert flt == {"slug": "default", "db_name": "champions_academy"}
    assert update == {"$set": {"db_name": "champions_default"}}
    assert tenants.docs[0]["db_name"] == "champions_default"


# ---------------------------------------------------------------- (4b) dry-run skips control-plane patch
def test_missing_legacy_dry_run_does_not_touch_control_doc(monkeypatch, migrate_mod):
    client = _build_world(legacy_present=False)
    _install_client(monkeypatch, client)

    rc = asyncio.run(migrate_mod._run(dry_run=True, force=False, drop_source=True))

    assert rc == 0
    tenants = client["champions_control"]._collections["tenants"]
    assert tenants.updates == []
    assert tenants.docs[0]["db_name"] == "champions_academy"


# ---------------------------------------------------------------- (5) non-empty target refusal
def test_non_empty_target_without_force_is_refused(monkeypatch, migrate_mod):
    existing = {
        "members": _FakeCollection(docs=[{"_id": "pre-existing"}]),
    }
    client = _build_world(target_collections=existing)
    _install_client(monkeypatch, client)

    rc = asyncio.run(migrate_mod._run(dry_run=False, force=False, drop_source=True))

    assert rc == 3
    # Did not copy, did not drop, did not touch control plane.
    assert client.dropped == []
    target = client["champions_default"]
    assert list(target._collections.keys()) == ["members"]
    assert target["members"].docs == [{"_id": "pre-existing"}]
    assert target["members"].inserted_batches == []
    tenants = client["champions_control"]._collections["tenants"]
    assert tenants.updates == []


def test_non_empty_target_with_force_proceeds(monkeypatch, migrate_mod):
    existing = {
        "members": _FakeCollection(docs=[{"_id": "pre-existing"}]),
    }
    client = _build_world(target_collections=existing)
    _install_client(monkeypatch, client)

    # With --force, the script bypasses the non-empty check. Counts will not
    # match (target already had 1 doc), so it should refuse to drop (rc=4)
    # rather than the up-front refusal (rc=3). This proves --force only
    # bypasses the pre-check, not the post-copy verification.
    rc = asyncio.run(migrate_mod._run(dry_run=False, force=True, drop_source=True))

    assert rc == 4
    assert client.dropped == []
