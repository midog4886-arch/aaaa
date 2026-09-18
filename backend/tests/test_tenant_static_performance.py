"""Public build assets must not wait on Mongo; APIs keep tenant enforcement."""
import sys
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.staticfiles import StaticFiles

from middleware.tenant import TenantMiddleware


@pytest.fixture
def static_client(monkeypatch, tmp_path):
    lookups = []

    async def lookup(slug):
        lookups.append(slug)
        return {"slug": slug, "db_name": "champions_test", "status": "suspended"}

    monkeypatch.setitem(
        sys.modules, "control_db", SimpleNamespace(get_tenant_by_slug=lookup)
    )
    monkeypatch.setenv("STRICT_TENANT_CONTEXT", "1")
    (tmp_path / "main.js").write_text("/* public application code */")
    (tmp_path / "main.css").write_text("body { margin: 0; }")
    app = FastAPI()
    app.mount("/static", StaticFiles(directory=tmp_path), name="static")

    @app.get("/{path:path}")
    async def protected(path: str):
        return {"unexpected": "must remain tenant-checked"}

    app.add_middleware(TenantMiddleware)
    with TestClient(app) as client:
        yield client, lookups


@pytest.mark.parametrize("asset", ["main.js", "main.css"])
def test_public_bundle_needs_no_registry_read(static_client, asset):
    client, lookups = static_client
    response = client.get(f"/static/{asset}", headers={"X-Tenant-Slug": "test"})
    assert response.status_code == 200
    assert lookups == []


def test_missing_bundle_remains_404_without_registry_read(static_client):
    client, lookups = static_client
    response = client.get("/static/missing.js", headers={"X-Tenant-Slug": "test"})
    assert response.status_code == 404
    assert lookups == []


@pytest.mark.parametrize("path", [
    "/api/auth/me",
    "/api/members",
    "/images/academy-logo.png",
    "/static-private/data",
    "/api/static/data",
    "/",
])
def test_dynamic_routes_still_enforce_suspension(static_client, path):
    client, lookups = static_client
    response = client.get(path, headers={"X-Tenant-Slug": "test"})
    assert response.status_code == 403
    assert response.json()["tenant_status"] == "suspended"
    assert lookups == ["test"]