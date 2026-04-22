"""OAuth app credentials are stored in MongoDB so admins can edit them
from the Social Publisher page without redeploying. Environment variables
are used as a fallback if the DB has no entry for a platform."""
from __future__ import annotations
import os
from typing import Dict

# Field schema per platform — used by both backend validation and the UI.
SCHEMA: Dict[str, list[dict]] = {
    "meta": [
        {"key": "app_id",       "label": "App ID",       "secret": False},
        {"key": "app_secret",   "label": "App Secret",   "secret": True},
        {"key": "redirect_uri", "label": "Redirect URI", "secret": False},
    ],
    "youtube": [
        {"key": "client_id",     "label": "Client ID",     "secret": False},
        {"key": "client_secret", "label": "Client Secret", "secret": True},
        {"key": "redirect_uri",  "label": "Redirect URI",  "secret": False},
    ],
    "tiktok": [
        {"key": "client_key",    "label": "Client Key",    "secret": False},
        {"key": "client_secret", "label": "Client Secret", "secret": True},
        {"key": "redirect_uri",  "label": "Redirect URI",  "secret": False},
    ],
}

# Mapping for the env-var fallback so existing deployments keep working.
ENV_FALLBACK = {
    "meta":    {"app_id": "META_APP_ID", "app_secret": "META_APP_SECRET", "redirect_uri": "META_REDIRECT_URI"},
    "youtube": {"client_id": "GOOGLE_CLIENT_ID", "client_secret": "GOOGLE_CLIENT_SECRET", "redirect_uri": "GOOGLE_REDIRECT_URI"},
    "tiktok":  {"client_key": "TIKTOK_CLIENT_KEY", "client_secret": "TIKTOK_CLIENT_SECRET", "redirect_uri": "TIKTOK_REDIRECT_URI"},
}


async def get_config(provider: str) -> dict:
    """Returns the merged OAuth config for `provider` (env fallback + DB overrides)."""
    from routes.common import db
    out = {}
    for k, env_key in ENV_FALLBACK.get(provider, {}).items():
        out[k] = os.environ.get(env_key, "")
    doc = await db.social_config.find_one({"provider": provider})
    if doc:
        for f in SCHEMA.get(provider, []):
            v = doc.get(f["key"])
            if v:
                out[f["key"]] = v
    return out


async def is_provider_configured(provider: str) -> bool:
    cfg = await get_config(provider)
    return all(cfg.get(f["key"]) for f in SCHEMA.get(provider, []))
