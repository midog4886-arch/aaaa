"""A valid signature must never preserve privileges after the user row changes."""
import os
import sys
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import utils.auth as auth
from utils import tenant


@pytest.fixture
def anyio_backend():
    return "asyncio"


class Users:
    def __init__(self, user):
        self.user = user

    async def find_one(self, query, projection=None):
        return dict(self.user) if self.user and query.get("id") == self.user.get("id") else None


class DB:
    def __init__(self, user):
        self.users = Users(user)


@pytest.fixture
def session(monkeypatch):
    user = {"id": "u-1", "username": "manager", "is_admin": True,
            "branch_id": "a", "branch_ids": ["a"], "permissions": ["users"]}
    monkeypatch.setattr(auth, "db", DB(user))
    context = tenant.set_current_tenant({"slug": "default", "db_name": "champions_default"})
    try:
        yield user, auth.create_token("u-1", "manager", "a", is_admin=True)
    finally:
        tenant.reset_current_tenant(context)


@pytest.mark.anyio
async def test_live_role_and_branch_changes_take_effect(session):
    user, token = session
    user.update(is_admin=False, branch_id="b", branch_ids=["b"], permissions=["dashboard"])
    current = await auth.authenticate_user_token(token)
    assert current["is_admin"] is False
    assert current["branch_id"] == "b"
    assert current["branch_ids"] == ["b"]
    assert current["permissions"] == ["dashboard"]


@pytest.mark.anyio
@pytest.mark.parametrize("change", [{"is_active": False}, {"disabled": True}, {"status": "suspended"}])
async def test_disabled_account_loses_access(session, change):
    user, token = session
    user.update(change)
    with pytest.raises(HTTPException) as error:
        await auth.authenticate_user_token(token)
    assert error.value.status_code == 401


@pytest.mark.anyio
async def test_deleted_account_loses_access(session, monkeypatch):
    _, token = session
    monkeypatch.setattr(auth, "db", DB(None))
    with pytest.raises(HTTPException) as error:
        await auth.authenticate_user_token(token)
    assert error.value.status_code == 401


@pytest.mark.anyio
async def test_password_change_revokes_old_token(session):
    user, token = session
    user["auth_version"] = 1
    with pytest.raises(HTTPException) as error:
        await auth.authenticate_user_token(token)
    assert error.value.status_code == 401


@pytest.mark.anyio
async def test_legacy_long_lived_token_is_rejected(session):
    _, _token = session
    legacy = jwt.encode({"user_id": "u-1", "username": "manager", "tenant_slug": "default",
                         "exp": datetime.now(timezone.utc) + timedelta(days=36500)},
                        auth.JWT_SECRET, algorithm=auth.JWT_ALGORITHM)
    with pytest.raises(HTTPException) as error:
        await auth.authenticate_user_token(legacy)
    assert error.value.status_code == 401


def test_staff_token_lasts_thirty_days(session):
    _, token = session
    claims = jwt.decode(token, auth.JWT_SECRET, algorithms=[auth.JWT_ALGORITHM])
    lifetime = claims["exp"] - claims["iat"]
    assert lifetime == 30 * 24 * 3600


@pytest.mark.anyio
async def test_token_cannot_cross_tenants(session):
    _, token = session
    context = tenant.set_current_tenant({"slug": "other", "db_name": "champions_other"})
    try:
        with pytest.raises(HTTPException) as error:
            await auth.authenticate_user_token(token)
        assert error.value.status_code == 403
    finally:
        tenant.reset_current_tenant(context)
