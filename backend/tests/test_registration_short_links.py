from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from routes import registration_requests as routes


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_staff_cannot_create_link_for_another_branch(monkeypatch):
    branches = SimpleNamespace(find_one=AsyncMock())
    monkeypatch.setattr(routes, "db", SimpleNamespace(branches=branches))
    with pytest.raises(HTTPException) as error:
        await routes.create_registration_link("other", {"branch_id": "own", "is_admin": False})
    assert error.value.status_code == 403
    branches.find_one.assert_not_awaited()


@pytest.mark.anyio
async def test_existing_slug_survives_branch_rename(monkeypatch):
    links = SimpleNamespace(
        create_index=AsyncMock(),
        find_one_and_update=AsyncMock(return_value={"slug": "riyadh-school-b11", "slug_version": 2}),
    )
    monkeypatch.setattr(routes, "db", SimpleNamespace(
        branches=SimpleNamespace(find_one=AsyncMock(return_value={"id": "branch", "name": "Renamed", "code_prefix": "B11"})),
        public_registration_links=links,
    ))
    assert await routes.create_registration_link("branch", {"is_admin": True}) == {"slug": "riyadh-school-b11"}
    update = links.find_one_and_update.call_args.args[1]
    assert "$set" not in update


@pytest.mark.anyio
async def test_upgrade_keeps_old_address_and_shortens_name(monkeypatch):
    old = "riyadh-school-educational-pool-b11"
    links = SimpleNamespace(
        create_index=AsyncMock(), find_one=AsyncMock(return_value=None),
        find_one_and_update=AsyncMock(side_effect=[{"slug": old}, {"slug": "riyadh-pool", "slug_version": 2}]),
    )
    monkeypatch.setattr(routes, "db", SimpleNamespace(
        branches=SimpleNamespace(find_one=AsyncMock(return_value={"id": "branch", "name": "Renamed"})),
        public_registration_links=links,
    ))
    assert await routes.create_registration_link("branch", {"is_admin": True}) == {"slug": "riyadh-pool"}
    update = links.find_one_and_update.call_args.args[1]
    assert update["$addToSet"]["aliases"]["$each"] == [old, "riyadh-pool"]


@pytest.mark.anyio
async def test_shorter_name_collision_keeps_existing_link(monkeypatch):
    old = "riyadh-school-educational-pool-b11"
    links = SimpleNamespace(
        create_index=AsyncMock(), find_one=AsyncMock(return_value={"_id": "other"}),
        find_one_and_update=AsyncMock(side_effect=[{"slug": old}, {"slug": old, "slug_version": 2}]),
    )
    monkeypatch.setattr(routes, "db", SimpleNamespace(
        branches=SimpleNamespace(find_one=AsyncMock(return_value={"id": "branch", "name": "Riyadh"})),
        public_registration_links=links,
    ))
    assert await routes.create_registration_link("branch", {"is_admin": True}) == {"slug": old}


@pytest.mark.anyio
async def test_short_link_resolves_to_original_branch(monkeypatch):
    monkeypatch.setattr(routes, "db", SimpleNamespace(public_registration_links=SimpleNamespace(
        find_one=AsyncMock(return_value={"branch_id": "original-id"}),
    )))
    details = AsyncMock(return_value={"branch": {"id": "original-id"}, "activities": []})
    monkeypatch.setattr(routes, "public_get_registration_branch", details)
    result = await routes.resolve_registration_link("riyadh-school-b11")
    assert result["branch"]["id"] == "original-id"
    details.assert_awaited_once_with("original-id")
    assert routes.db.public_registration_links.find_one.call_args.args[0] == {
        "$or": [{"slug": "riyadh-school-b11"}, {"aliases": "riyadh-school-b11"}]
    }


@pytest.mark.anyio
async def test_unknown_slug_does_not_fall_back_to_another_branch(monkeypatch):
    monkeypatch.setattr(routes, "db", SimpleNamespace(public_registration_links=SimpleNamespace(find_one=AsyncMock(return_value=None))))
    with pytest.raises(HTTPException) as error:
        await routes.resolve_registration_link("unknown")
    assert error.value.status_code == 404
