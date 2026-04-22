"""TikTok Content Posting API adapter.

Required env / secrets:
- TIKTOK_CLIENT_KEY
- TIKTOK_CLIENT_SECRET
- TIKTOK_REDIRECT_URI

The Content Posting API requires app review and the `video.publish` scope
to publish directly. Without that scope the post lands as a draft inside
the user's TikTok inbox.
"""
from __future__ import annotations
import os
import time
from typing import Dict, Any
from urllib.parse import urlencode

import httpx

from .config import get_config

SCOPES = ["user.info.basic", "video.upload", "video.publish"]


async def _cfg():
    return await get_config("tiktok")


class oauth:
    @staticmethod
    async def authorize_url(state: str) -> str:
        c = await _cfg()
        if not (c.get("client_key") and c.get("client_secret") and c.get("redirect_uri")):
            raise RuntimeError("TikTok OAuth not configured")
        params = {
            "client_key": c["client_key"],
            "redirect_uri": c["redirect_uri"],
            "state": state,
            "scope": ",".join(SCOPES),
            "response_type": "code",
        }
        return f"https://www.tiktok.com/v2/auth/authorize/?{urlencode(params)}"

    @staticmethod
    async def exchange_code(code: str) -> Dict[str, Any]:
        c = await _cfg()
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://open.tiktokapis.com/v2/oauth/token/",
                data={
                    "client_key": c["client_key"],
                    "client_secret": c["client_secret"],
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": c["redirect_uri"],
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            r.raise_for_status()
            tok = r.json()
            return {
                "access_token": tok["access_token"],
                "refresh_token": tok.get("refresh_token"),
                "open_id": tok.get("open_id"),
                "expires_at": int(time.time()) + int(tok.get("expires_in", 86400)),
            }


async def _refresh_if_needed(account: dict) -> str:
    """Refresh the TikTok access token if it's expired (or close to expiry)."""
    if account.get("expires_at", 0) > int(time.time()) + 60:
        return account.get("access_token")
    refresh = account.get("refresh_token")
    if not refresh:
        return account.get("access_token")
    c = await _cfg()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://open.tiktokapis.com/v2/oauth/token/",
            data={
                "client_key": c.get("client_key"),
                "client_secret": c.get("client_secret"),
                "grant_type": "refresh_token",
                "refresh_token": refresh,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        r.raise_for_status()
        tok = r.json()
        new_access = tok.get("access_token") or account.get("access_token")
        update = {
            "access_token": new_access,
            "refresh_token": tok.get("refresh_token", refresh),
            "expires_at": int(time.time()) + int(tok.get("expires_in", 86400)),
        }
        # Persist the rotated tokens.
        from routes.common import db
        await db.social_accounts.update_one({"platform": "tiktok"}, {"$set": update})
        return new_access


async def publish(account: dict, media_path: str, public_url: str, caption: str) -> dict:
    if not media_path.lower().endswith((".mp4", ".mov", ".m4v")):
        return {"success": False, "error": "TikTok only accepts video files"}
    if not account.get("access_token"):
        return {"success": False, "error": "TikTok account not connected"}
    try:
        access_token = await _refresh_if_needed(account)
    except Exception as e:
        return {"success": False, "error": f"Token refresh failed: {e}"}
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            # Initialize a PULL_FROM_URL post. TikTok will fetch the public URL.
            init = await client.post(
                "https://open.tiktokapis.com/v2/post/publish/video/init/",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json; charset=UTF-8",
                },
                json={
                    "post_info": {
                        "title": (caption or "")[:2200],
                        "privacy_level": "PUBLIC_TO_EVERYONE",
                        "disable_duet": False,
                        "disable_comment": False,
                        "disable_stitch": False,
                    },
                    "source_info": {
                        "source": "PULL_FROM_URL",
                        "video_url": public_url,
                    },
                },
            )
            init.raise_for_status()
            data = init.json().get("data", {})
            publish_id = data.get("publish_id")
            return {
                "success": True,
                "post_id": publish_id,
                "post_url": None,  # TikTok doesn't return a public URL until processed.
            }
    except httpx.HTTPStatusError as e:
        return {"success": False, "error": f"{e.response.status_code}: {e.response.text[:300]}"}
    except Exception as e:
        return {"success": False, "error": str(e)}
