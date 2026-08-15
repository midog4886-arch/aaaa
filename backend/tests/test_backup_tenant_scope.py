"""Tenant scoping & safety tests for the /backup endpoints' helpers.

Guards against the cross-tenant backup leak fixed in Aug 2026:
  - filenames are matched against exact shapes, so tenant "foo" can never
    own files of tenant "foo_bar" (slugs may contain underscores)
  - path traversal / weird filenames are rejected outright
  - legacy slug-less manual backups belong to the default tenant only
"""
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import server  # noqa: E402
from utils import tenant as tenant_mod  # noqa: E402


@pytest.fixture
def as_tenant(monkeypatch):
    def _set(slug):
        monkeypatch.setattr(tenant_mod, "get_current_tenant_slug", lambda: slug)
    return _set


def owned(name):
    return server._backup_owned_by_current_tenant(name)


def test_tenant_owns_its_own_backup_shapes(as_tenant):
    as_tenant("foo")
    assert owned("auto_backup_foo_20260814.json")
    assert owned("backup_foo--20260814_120000.json")
    assert owned("backup_foo--pre_restore_20260814_120000.json")
    assert owned("backup_foo--myupload.json")


def test_underscore_slug_cannot_grab_sibling_tenant_files(as_tenant):
    # tenant "foo" must NOT own "foo_bar"'s files ...
    as_tenant("foo")
    assert not owned("auto_backup_foo_bar_20260814.json")
    assert not owned("backup_foo_bar--20260814_120000.json")
    assert not owned("backup_foo_bar--myupload.json")
    assert not owned("backup_foo_bar--pre_restore_20260814_120000.json")
    # ... and "foo_bar" owns them
    as_tenant("foo_bar")
    assert owned("auto_backup_foo_bar_20260814.json")
    assert owned("backup_foo_bar--20260814_120000.json")
    assert owned("backup_foo_bar--myupload.json")


def test_date_like_slugs_do_not_collide(as_tenant):
    as_tenant("foo")
    # foo must not own files of tenant foo_20260814
    assert not owned("auto_backup_foo_20260814_20260815.json")
    assert not owned("backup_foo_20260814--20260814_120000.json")
    as_tenant("foo_20260814")
    assert owned("auto_backup_foo_20260814_20260815.json")
    assert owned("backup_foo_20260814--20260814_120000.json")


def test_legacy_slugless_manual_backup_default_tenant_only(as_tenant):
    default_slug = tenant_mod.DEFAULT_TENANT_SLUG or "default"
    as_tenant(default_slug)
    assert owned("backup_20250101_120000.json")
    as_tenant("foo")
    assert not owned("backup_20250101_120000.json")


def test_numeric_slug_cannot_collide_with_legacy_default_files(as_tenant):
    # Tenant "20250101" writes manual backups as backup_20250101--<ts>.json,
    # which the default tenant must NOT own; and the numeric-slug tenant must
    # NOT own default's legacy slug-less files.
    as_tenant("20250101")
    assert owned("backup_20250101--20260814_120000.json")
    assert not owned("backup_20250101_120000.json")  # legacy default file
    default_slug = tenant_mod.DEFAULT_TENANT_SLUG or "default"
    as_tenant(default_slug)
    assert not owned("backup_20250101--20260814_120000.json")


def test_safe_backup_path_rejects_traversal_and_junk():
    for bad in (
        "../secrets.json",
        "..%2Fserver.py",
        "backup_x/../../y.json",
        "auto_backup_foo_20260814.txt",
        "",
        "server.py",
        "backup_foo_20260814_120000.json.gz.json/..",
    ):
        with pytest.raises(HTTPException):
            server._safe_backup_path(bad)


def test_safe_backup_path_accepts_valid_names():
    p = server._safe_backup_path("auto_backup_foo_20260814.json")
    assert p.name == "auto_backup_foo_20260814.json"
    assert p.parent == server.BACKUPS_DIR.resolve()
