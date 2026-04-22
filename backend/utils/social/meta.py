"""Meta (Facebook + Instagram) Graph API adapter.

Uses the same Facebook OAuth flow for both platforms. The user logs in
once with Facebook; we then list their managed Pages and the Instagram
Business account linked to each Page (if any).

Required env / secrets:
- META_APP_ID
- META_APP_SECRET
- META_REDIRECT_URI  (must exactly match the OAuth redirect URI registered
  in the Meta developer console, e.g. https://your-domain/api/social/callback/facebook)

Docs:
- Pages publishing: https://developers.facebook.com/docs/pages-api
- Instagram publishing: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
"""
from __future__ import annotations
import os
import time
from typing import Dict, Any, List
from urllib.parse import urlencode

import httpx

from .config import get_config

GRAPH = "https://graph.facebook.com/v19.0"
SCOPES = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "instagram_basic",
    "instagram_content_publish",
    "business_management",
]


async def _cfg():
    return await get_config("meta")


class oauth:
    @staticmethod
    async def authorize_url(state: str) -> str:
        c = await _cfg()
        if not (c.get("app_id") and c.get("app_secret") and c.get("redirect_uri")):
            raise RuntimeError("Meta OAuth not configured")
        params = {
            "client_id": c["app_id"],
            "redirect_uri": c["redirect_uri"],
            "state": state,
            "scope": ",".join(SCOPES),
            "response_type": "code",
        }
        return f"https://www.facebook.com/v19.0/dialog/oauth?{urlencode(params)}"

    @staticmethod
    async def exchange_code(code: str) -> Dict[str, Any]:
        c = await _cfg()
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"{GRAPH}/oauth/access_token",
                params={
                    "client_id": c["app_id"],
                    "client_secret": c["app_secret"],
                    "redirect_uri": c["redirect_uri"],
                    "code": code,
                },
            )
            r.raise_for_status()
            short = r.json()
            # Exchange for long-lived token (~60 days).
            r2 = await client.get(
                f"{GRAPH}/oauth/access_token",
                params={
                    "grant_type": "fb_exchange_token",
                    "client_id": c["app_id"],
                    "client_secret": c["app_secret"],
                    "fb_exchange_token": short["access_token"],
                },
            )
            r2.raise_for_status()
            long_tok = r2.json()
            user_token = long_tok["access_token"]
            expires_in = long_tok.get("expires_in", 60 * 24 * 3600)
            # List the pages the user manages. Each page comes with its own
            # page-scoped access token used for publishing.
            r3 = await client.get(
                f"{GRAPH}/me/accounts",
                params={"access_token": user_token, "fields": "id,name,access_token,instagram_business_account{id,username}"},
            )
            r3.raise_for_status()
            pages = r3.json().get("data", [])
            return {
                "access_token": user_token,
                "expires_at": int(time.time()) + int(expires_in),
                "pages": pages,
            }


async def publish_facebook(account: dict, media_path: str, public_url: str, caption: str) -> dict:
    """Publish a single image or video to a Facebook Page."""
    page = account.get("page") or {}
    page_id = page.get("id")
    page_token = page.get("access_token")
    if not page_id or not page_token:
        return {"success": False, "error": "No Facebook Page selected for this account"}
    is_video = media_path.lower().endswith((".mp4", ".mov", ".m4v"))
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            if is_video:
                r = await client.post(
                    f"https://graph-video.facebook.com/v19.0/{page_id}/videos",
                    data={"file_url": public_url, "description": caption, "access_token": page_token},
                )
            else:
                r = await client.post(
                    f"{GRAPH}/{page_id}/photos",
                    data={"url": public_url, "caption": caption, "access_token": page_token},
                )
            r.raise_for_status()
            data = r.json()
            post_id = data.get("post_id") or data.get("id")
            return {
                "success": True,
                "post_id": post_id,
                "post_url": f"https://www.facebook.com/{post_id}" if post_id else None,
            }
        except httpx.HTTPStatusError as e:
            return {"success": False, "error": f"{e.response.status_code}: {e.response.text[:300]}"}
        except Exception as e:
            return {"success": False, "error": str(e)}


async def publish_instagram(account: dict, media_path: str, public_url: str, caption: str) -> dict:
    """Two-step Instagram publish: create container, then publish."""
    page = account.get("page") or {}
    ig = (page.get("instagram_business_account") or {})
    ig_id = ig.get("id")
    page_token = page.get("access_token")
    if not ig_id or not page_token:
        return {"success": False, "error": "No Instagram Business account linked to selected Facebook Page"}
    is_video = media_path.lower().endswith((".mp4", ".mov", ".m4v"))
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            container_payload = {"caption": caption, "access_token": page_token}
            if is_video:
                container_payload["media_type"] = "REELS"
                container_payload["video_url"] = public_url
            else:
                container_payload["image_url"] = public_url
            r = await client.post(f"{GRAPH}/{ig_id}/media", data=container_payload)
            r.raise_for_status()
            container_id = r.json()["id"]
            # For videos, IG needs a moment to process the container before publish.
            if is_video:
                for _ in range(20):
                    s = await client.get(
                        f"{GRAPH}/{container_id}",
                        params={"fields": "status_code", "access_token": page_token},
                    )
                    if s.json().get("status_code") == "FINISHED":
                        break
                    if s.json().get("status_code") == "ERROR":
                        return {"success": False, "error": "Instagram failed to process the video"}
                    import asyncio as _a; await _a.sleep(3)
            r2 = await client.post(
                f"{GRAPH}/{ig_id}/media_publish",
                data={"creation_id": container_id, "access_token": page_token},
            )
            r2.raise_for_status()
            media_id = r2.json()["id"]
            r3 = await client.get(
                f"{GRAPH}/{media_id}",
                params={"fields": "permalink", "access_token": page_token},
            )
            permalink = r3.json().get("permalink") if r3.status_code == 200 else None
            return {"success": True, "post_id": media_id, "post_url": permalink}
        except httpx.HTTPStatusError as e:
            return {"success": False, "error": f"{e.response.status_code}: {e.response.text[:300]}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
