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

SCOPES = ["user.info.basic", "video.upload", "video.publish"]


def _cfg():
    return {
        "client_key": os.environ.get("TIKTOK_CLIENT_KEY", ""),
        "client_secret": os.environ.get("TIKTOK_CLIENT_SECRET", ""),
        "redirect_uri": os.environ.get("TIKTOK_REDIRECT_URI", ""),
    }


def is_configured() -> bool:
    c = _cfg()
    return bool(c["client_key"] and c["client_secret"] and c["redirect_uri"])


class oauth:
    @staticmethod
    def authorize_url(state: str) -> str:
        c = _cfg()
        if not is_configured():
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
        c = _cfg()
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


async def publish(account: dict, media_path: str, public_url: str, caption: str) -> dict:
    if not media_path.lower().endswith((".mp4", ".mov", ".m4v")):
        return {"success": False, "error": "TikTok only accepts video files"}
    access_token = account.get("access_token")
    if not access_token:
        return {"success": False, "error": "TikTok account not connected"}
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
