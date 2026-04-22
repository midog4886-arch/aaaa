"""YouTube Data API v3 adapter (channel-owner upload via OAuth).

Required env / secrets:
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI  (e.g. https://your-domain/api/social/callback/youtube)

Quota: a single video upload costs ~1600 units of the default 10,000/day
project quota, so this adapter is suitable for occasional posts.
"""
from __future__ import annotations
import os
import time
from typing import Dict, Any
from urllib.parse import urlencode

import httpx

from .config import get_config

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


async def _cfg():
    return await get_config("youtube")


class oauth:
    @staticmethod
    async def authorize_url(state: str) -> str:
        c = await _cfg()
        if not (c.get("client_id") and c.get("client_secret") and c.get("redirect_uri")):
            raise RuntimeError("YouTube OAuth not configured")
        params = {
            "client_id": c["client_id"],
            "redirect_uri": c["redirect_uri"],
            "state": state,
            "scope": " ".join(SCOPES),
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
        }
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

    @staticmethod
    async def exchange_code(code: str) -> Dict[str, Any]:
        c = await _cfg()
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": c["client_id"],
                    "client_secret": c["client_secret"],
                    "redirect_uri": c["redirect_uri"],
                    "grant_type": "authorization_code",
                    "code": code,
                },
            )
            r.raise_for_status()
            tok = r.json()
            # Look up the channel name for display.
            r2 = await client.get(
                "https://www.googleapis.com/youtube/v3/channels",
                params={"part": "snippet", "mine": "true"},
                headers={"Authorization": f"Bearer {tok['access_token']}"},
            )
            channel_name = ""
            channel_id = ""
            if r2.status_code == 200:
                items = r2.json().get("items", [])
                if items:
                    channel_id = items[0]["id"]
                    channel_name = items[0]["snippet"]["title"]
            return {
                "access_token": tok["access_token"],
                "refresh_token": tok.get("refresh_token"),
                "expires_at": int(time.time()) + int(tok.get("expires_in", 3600)),
                "channel_id": channel_id,
                "channel_name": channel_name,
            }


async def _refresh_if_needed(account: dict) -> str:
    if account.get("expires_at", 0) > int(time.time()) + 60:
        return account["access_token"]
    refresh = account.get("refresh_token")
    if not refresh:
        return account["access_token"]
    c = await _cfg()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": c["client_id"],
                "client_secret": c["client_secret"],
                "grant_type": "refresh_token",
                "refresh_token": refresh,
            },
        )
        r.raise_for_status()
        tok = r.json()
        return tok["access_token"]


async def publish(account: dict, media_path: str, public_url: str, caption: str) -> dict:
    """Resumable upload of a single video to YouTube."""
    if not media_path.lower().endswith((".mp4", ".mov", ".m4v")):
        return {"success": False, "error": "YouTube only accepts video files"}
    try:
        access_token = await _refresh_if_needed(account)
    except Exception as e:
        return {"success": False, "error": f"Token refresh failed: {e}"}
    title = (caption or "Video").splitlines()[0][:95] or "Video"
    metadata = {
        "snippet": {"title": title, "description": caption or ""},
        "status": {"privacyStatus": "public"},
    }
    try:
        async with httpx.AsyncClient(timeout=600) as client:
            init = await client.post(
                "https://www.googleapis.com/upload/youtube/v3/videos",
                params={"uploadType": "resumable", "part": "snippet,status"},
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json; charset=UTF-8",
                    "X-Upload-Content-Type": "video/*",
                },
                json=metadata,
            )
            init.raise_for_status()
            upload_url = init.headers["Location"]
            with open(media_path, "rb") as f:
                data = f.read()
            up = await client.put(
                upload_url,
                content=data,
                headers={"Content-Type": "video/*"},
            )
            up.raise_for_status()
            video_id = up.json()["id"]
            return {
                "success": True,
                "post_id": video_id,
                "post_url": f"https://youtu.be/{video_id}",
            }
    except httpx.HTTPStatusError as e:
        return {"success": False, "error": f"{e.response.status_code}: {e.response.text[:300]}"}
    except Exception as e:
        return {"success": False, "error": str(e)}
