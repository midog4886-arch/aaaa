"""Social media platform adapters for the Social Publisher feature."""
from . import meta, youtube, tiktok

ADAPTERS = {
    "facebook": meta.publish_facebook,
    "instagram": meta.publish_instagram,
    "youtube": youtube.publish,
    "tiktok": tiktok.publish,
}

INSIGHTS_ADAPTERS = {
    "facebook": meta.insights_facebook,
    "instagram": meta.insights_instagram,
    "youtube": youtube.insights,
    "tiktok": tiktok.insights,
}

OAUTH_HANDLERS = {
    "facebook": meta.oauth,
    "instagram": meta.oauth,
    "youtube": youtube.oauth,
    "tiktok": tiktok.oauth,
}
