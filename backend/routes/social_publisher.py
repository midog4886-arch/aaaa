"""Social Publisher API: upload media, connect platforms, publish.

Endpoints (all under /api/social):
- POST   /uploads                     multipart upload of one image/video
- GET    /accounts                    list connected social accounts
- DELETE /accounts/{platform}         disconnect a platform
- GET    /connect/{platform}          returns { authorize_url } (state generated server-side)
- GET    /callback/{platform}         OAuth redirect target — exchanges code, stores account
- POST   /posts                       publish to selected platforms (sync)
- GET    /posts                       paginated history
"""
from __future__ import annotations
import os
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from pydantic import BaseModel

from .common import db, get_current_user
from utils.social import meta as meta_adapter, youtube as yt_adapter, tiktok as tt_adapter
from utils.social.config import SCHEMA as CONFIG_SCHEMA, get_config, is_provider_configured

router = APIRouter(prefix="/social", tags=["Social Publisher"])
logger = logging.getLogger("social_publisher")

ROOT_DIR = Path(__file__).resolve().parent.parent
SOCIAL_UPLOAD_DIR = ROOT_DIR / "uploads" / "social"
SOCIAL_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png"}
ALLOWED_VIDEO_EXT = {".mp4", ".mov", ".m4v"}
MAX_UPLOAD_BYTES = 250 * 1024 * 1024  # ~250 MB

PLATFORMS = ("facebook", "instagram", "youtube", "tiktok")


def _require_social_publisher(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("is_admin", False):
        return current_user
    perms = current_user.get("permissions") or []
    if "social-publisher" in perms:
        return current_user
    raise HTTPException(status_code=403, detail="غير مصرح لك بهذه العملية")


def _public_base_url(request: Request) -> str:
    """Return the base URL that external platforms can fetch /uploads from."""
    forced = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    if forced:
        return forced
    # Trust the configured Replit domain if available — proxied previews
    # don't always set X-Forwarded-Host correctly.
    domain = os.environ.get("REPLIT_DOMAINS", "").split(",")[0].strip()
    if domain:
        return f"https://{domain}"
    return str(request.base_url).rstrip("/")


_TOKEN_KEYS = {
    "access_token", "refresh_token", "user_access_token", "id_token",
    "token", "client_secret", "app_secret",
}


def _strip_secrets(value):
    """Recursively strip any token-like fields from an account doc before
    sending it to the browser. Operates on dicts and lists."""
    if isinstance(value, dict):
        return {k: _strip_secrets(v) for k, v in value.items() if k not in _TOKEN_KEYS and k != "_id"}
    if isinstance(value, list):
        return [_strip_secrets(v) for v in value]
    return value


# ────────────────── Uploads ──────────────────

@router.post("/uploads")
async def upload_media(
    file: UploadFile = File(...),
    request: Request = None,
    current_user: dict = Depends(_require_social_publisher),
):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (ALLOWED_IMAGE_EXT | ALLOWED_VIDEO_EXT):
        raise HTTPException(status_code=400, detail="نوع الملف غير مدعوم. الصور: jpg/png — الفيديو: mp4/mov")
    name = f"{uuid.uuid4().hex}{ext}"
    dest = SOCIAL_UPLOAD_DIR / name
    total = 0
    with dest.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="حجم الملف أكبر من 250 ميجا")
            out.write(chunk)
    base = _public_base_url(request)
    return {
        "filename": name,
        "kind": "video" if ext in ALLOWED_VIDEO_EXT else "image",
        "size": total,
        "public_url": f"{base}/uploads/social/{name}",
    }


# ────────────────── Accounts ──────────────────

@router.get("/accounts")
async def list_accounts(current_user: dict = Depends(_require_social_publisher)):
    accounts = await db.social_accounts.find({}, {"_id": 0}).to_list(50)
    meta_ok = await is_provider_configured("meta")
    configured = {
        "facebook": meta_ok,
        "instagram": meta_ok,
        "youtube": await is_provider_configured("youtube"),
        "tiktok": await is_provider_configured("tiktok"),
    }
    return {
        "accounts": [_strip_secrets(a) for a in accounts],
        "configured": configured,
    }


# ────────────────── OAuth app credentials (editable from UI) ──────────────────

PROVIDER_FOR_PLATFORM = {"facebook": "meta", "instagram": "meta", "youtube": "youtube", "tiktok": "tiktok"}


@router.get("/config")
async def get_oauth_config(current_user: dict = Depends(_require_social_publisher)):
    """Returns saved OAuth app credentials for each provider, including the
    schema so the UI can render the right form fields."""
    out = {}
    for provider in CONFIG_SCHEMA.keys():
        cfg = await get_config(provider)
        out[provider] = {
            "schema": CONFIG_SCHEMA[provider],
            "values": cfg,
        }
    return out


class ConfigUpdate(BaseModel):
    values: Dict[str, str]


@router.put("/config/{provider}")
async def save_oauth_config(
    provider: str,
    payload: ConfigUpdate,
    current_user: dict = Depends(_require_social_publisher),
):
    if provider not in CONFIG_SCHEMA:
        raise HTTPException(status_code=400, detail="مزود غير معروف")
    valid_keys = {f["key"] for f in CONFIG_SCHEMA[provider]}
    cleaned = {k: (v or "").strip() for k, v in payload.values.items() if k in valid_keys}
    cleaned["provider"] = provider
    cleaned["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.social_config.replace_one({"provider": provider}, cleaned, upsert=True)
    return {"saved": provider, "configured": await is_provider_configured(provider)}


@router.delete("/accounts/{platform}")
async def disconnect_account(platform: str, current_user: dict = Depends(_require_social_publisher)):
    if platform not in PLATFORMS:
        raise HTTPException(status_code=400, detail="منصة غير معروفة")
    await db.social_accounts.delete_one({"platform": platform})
    return {"deleted": platform}


# ────────────────── OAuth ──────────────────

def _adapter_for(platform: str):
    if platform in ("facebook", "instagram"):
        return meta_adapter
    if platform == "youtube":
        return yt_adapter
    if platform == "tiktok":
        return tt_adapter
    raise HTTPException(status_code=400, detail="منصة غير معروفة")


@router.get("/connect/{platform}")
async def connect_platform(
    platform: str,
    current_user: dict = Depends(_require_social_publisher),
):
    adapter = _adapter_for(platform)
    provider = PROVIDER_FOR_PLATFORM[platform]
    if not await is_provider_configured(provider):
        raise HTTPException(
            status_code=503,
            detail=f"إعدادات OAuth الخاصة بـ {platform} غير مكتملة. يرجى إكمالها من قسم الإعدادات أعلاه.",
        )
    # Meta uses a single OAuth flow + single redirect URI. Both the Facebook
    # and Instagram "connect" buttons hit the same authorize URL and the
    # callback creates both accounts. Persist the state under 'facebook' so
    # the canonical callback at /callback/facebook can look it up.
    callback_platform = "facebook" if provider == "meta" else platform
    state = uuid.uuid4().hex
    await db.social_oauth_states.insert_one({
        "state": state,
        "platform": callback_platform,
        "provider": provider,
        "user_id": current_user.get("user_id") or current_user.get("id"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"authorize_url": await adapter.oauth.authorize_url(state)}


@router.get("/callback/{platform}")
async def oauth_callback(platform: str, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    """OAuth redirect target. Returns a small HTML page that the user closes."""
    adapter = _adapter_for(platform)

    def _page(title: str, body: str, ok: bool) -> HTMLResponse:
        color = "#16a34a" if ok else "#dc2626"
        return HTMLResponse(
            f"""<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
            <title>{title}</title>
            <style>body{{font-family:Tajawal,Arial,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}}
            .card{{background:white;border-radius:16px;padding:32px;max-width:420px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.08)}}
            h2{{color:{color};margin-top:0}} button{{background:{color};color:white;border:0;border-radius:10px;padding:10px 20px;font-size:14px;cursor:pointer}}</style>
            </head><body><div class="card"><h2>{title}</h2><p>{body}</p>
            <button onclick="window.close()">إغلاق النافذة</button>
            <script>setTimeout(()=>{{try{{window.opener&&window.opener.postMessage({{social_oauth:true,platform:'{platform}',ok:{str(ok).lower()}}},'*');}}catch(e){{}};}},100);</script>
            </div></body></html>""",
            status_code=200,
        )

    if error:
        return _page("فشل الربط", f"رفضت المنصة الطلب: {error}", ok=False)
    if not code or not state:
        return _page("رابط غير مكتمل", "لم يصل رمز التفويض من المنصة.", ok=False)
    # For Meta we accept the state regardless of which connect button was
    # clicked, since the single Facebook callback writes both accounts.
    expected_provider = PROVIDER_FOR_PLATFORM[platform]
    state_doc = await db.social_oauth_states.find_one({
        "state": state,
        "provider": expected_provider,
    })
    if not state_doc:
        return _page("جلسة غير صالحة", "انتهت صلاحية الجلسة، حاول مرة أخرى.", ok=False)
    await db.social_oauth_states.delete_one({"state": state})

    try:
        result = await adapter.oauth.exchange_code(code)
    except Exception as e:
        logger.exception("OAuth exchange failed for %s", platform)
        return _page("فشل الربط", f"تعذر إكمال الربط: {e}", ok=False)

    if platform in ("facebook", "instagram"):
        # Persist a single Meta connection that owns both Facebook & Instagram.
        # Choose the first page as the default; the user can manage it later.
        pages = result.get("pages") or []
        page = pages[0] if pages else None
        for plat in ("facebook", "instagram"):
            doc = {
                "platform": plat,
                "display_name": (page or {}).get("name") or "Meta account",
                "user_access_token": result["access_token"],
                "expires_at": result.get("expires_at"),
                "page": page,
                "all_pages": pages,
                "connected_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.social_accounts.replace_one({"platform": plat}, doc, upsert=True)
    else:
        doc = {
            "platform": platform,
            "display_name": result.get("channel_name") or result.get("open_id") or platform,
            "access_token": result["access_token"],
            "refresh_token": result.get("refresh_token"),
            "expires_at": result.get("expires_at"),
            "channel_id": result.get("channel_id"),
            "open_id": result.get("open_id"),
            "connected_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.social_accounts.replace_one({"platform": platform}, doc, upsert=True)

    return _page("تم الربط بنجاح", f"تم ربط حساب {platform}. يمكنك إغلاق هذه النافذة الآن.", ok=True)


# ────────────────── Publishing ──────────────────

class PublishTarget(BaseModel):
    platform: str
    caption_override: Optional[str] = None


class PublishRequest(BaseModel):
    media_filename: str
    caption: str = ""
    targets: List[PublishTarget]


@router.post("/posts")
async def publish_post(
    payload: PublishRequest,
    request: Request,
    current_user: dict = Depends(_require_social_publisher),
):
    if not payload.targets:
        raise HTTPException(status_code=400, detail="اختر منصة واحدة على الأقل")
    media_path = SOCIAL_UPLOAD_DIR / payload.media_filename
    if not media_path.exists():
        raise HTTPException(status_code=404, detail="الملف المرفوع غير موجود")
    base = _public_base_url(request)
    public_url = f"{base}/uploads/social/{payload.media_filename}"

    post_id = str(uuid.uuid4())
    media_kind = "video" if media_path.suffix.lower() in ALLOWED_VIDEO_EXT else "image"
    post_doc = {
        "id": post_id,
        "caption": payload.caption,
        "media_filename": payload.media_filename,
        "media_kind": media_kind,
        "public_url": public_url,
        "created_by": current_user.get("user_id") or current_user.get("id"),
        "created_by_name": current_user.get("name") or current_user.get("username"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "targets": [t.model_dump() for t in payload.targets],
    }
    await db.social_posts.insert_one(post_doc)

    from utils.social import ADAPTERS
    results = []
    for t in payload.targets:
        target_id = str(uuid.uuid4())
        target_doc = {
            "id": target_id,
            "post_id": post_id,
            "platform": t.platform,
            "status": "pending",
            "attempted_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.social_post_targets.insert_one(target_doc)

        account = await db.social_accounts.find_one({"platform": t.platform}, {"_id": 0})
        if not account:
            update = {
                "status": "failed",
                "error_message": "الحساب غير مربوط",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.social_post_targets.update_one({"id": target_id}, {"$set": update})
            results.append({"platform": t.platform, **update})
            continue

        adapter_fn = ADAPTERS.get(t.platform)
        if adapter_fn is None:
            update = {"status": "failed", "error_message": "منصة غير مدعومة"}
            await db.social_post_targets.update_one({"id": target_id}, {"$set": update})
            results.append({"platform": t.platform, **update})
            continue

        caption = t.caption_override if t.caption_override is not None else payload.caption
        try:
            res = await adapter_fn(account, str(media_path), public_url, caption)
        except Exception as e:
            logger.exception("Publish failed for %s", t.platform)
            res = {"success": False, "error": str(e)}

        update = {
            "status": "success" if res.get("success") else "failed",
            "platform_post_id": res.get("post_id"),
            "public_post_url": res.get("post_url"),
            "error_message": res.get("error"),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.social_post_targets.update_one({"id": target_id}, {"$set": update})
        results.append({"platform": t.platform, **update})

    return {"post_id": post_id, "results": results}


@router.get("/posts")
async def list_posts(
    limit: int = 30,
    current_user: dict = Depends(_require_social_publisher),
):
    posts = await db.social_posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 100))
    if not posts:
        return {"posts": []}
    ids = [p["id"] for p in posts]
    targets = await db.social_post_targets.find({"post_id": {"$in": ids}}, {"_id": 0}).to_list(1000)
    by_post: Dict[str, list] = {}
    for t in targets:
        by_post.setdefault(t["post_id"], []).append(t)
    for p in posts:
        p["target_results"] = by_post.get(p["id"], [])
    return {"posts": posts}
