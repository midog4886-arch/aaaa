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
import json
import html
import uuid
import shutil
import asyncio
import logging
from datetime import datetime, timezone, timedelta
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
MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB

PLATFORMS = ("facebook", "instagram", "youtube", "tiktok")

# Maximum video duration accepted by each platform (seconds).
# Instagram Reels caps around 90s, TikTok 10min, YouTube Shorts 15min, FB much higher.
PLATFORM_MAX_VIDEO_SECONDS = {
    "instagram": 60,   # Reels limit per task spec
    "tiktok": 600,
    "youtube": 900,
    "facebook": 14400,
}

# Hardest cap that applies to any platform we publish to. Used by the
# upload endpoint, which doesn't know which targets the user will pick.
MAX_UPLOAD_VIDEO_SECONDS = max(PLATFORM_MAX_VIDEO_SECONDS.values())


async def _probe_video_dimensions(path: Path) -> Optional[tuple]:
    """Return (width, height) of the first video stream, or None on failure.

    Used by the publish processor to express logo size as a pixel value
    relative to the main video width without needing ffmpeg's scale2ref
    (which produces a second output that must be sunk explicitly).
    """
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=s=x:p=0", str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        text = (stdout or b"").decode().strip()
        if "x" not in text:
            return None
        w_s, h_s = text.split("x", 1)
        return int(w_s), int(h_s)
    except Exception:
        return None


async def _probe_video_duration(path: Path) -> float:
    """Return the video duration in seconds via ffprobe.

    Raises HTTPException(500) if ffprobe is unavailable or fails — the
    duration check is a hard requirement for accepting uploaded videos,
    not a best-effort hint.
    """
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise HTTPException(
            status_code=500,
            detail="تعذر التحقق من مدة الفيديو: ffprobe غير مثبت على الخادم.",
        )
    try:
        proc = await asyncio.create_subprocess_exec(
            ffprobe, "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        text = (stdout or b"").decode().strip()
        if not text:
            raise ValueError("empty ffprobe output")
        return float(text)
    except Exception as exc:
        logger.warning("ffprobe failed for %s: %s", path, exc)
        raise HTTPException(
            status_code=400,
            detail="تعذر قراءة مدة الفيديو. تأكد أن الملف صالح.",
        )


async def _require_social_publisher(current_user: dict = Depends(get_current_user)) -> dict:
    """Allow either admin users or any user whose stored permissions contain
    `social-publisher`. JWT payloads do not carry permissions, so we always
    resolve the user document from the database."""
    if current_user.get("is_admin", False):
        return current_user
    user_id = current_user.get("user_id")
    if user_id:
        user_doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
        if user_doc:
            if user_doc.get("is_admin", False):
                return user_doc
            perms = user_doc.get("permissions") or []
            if "social-publisher" in perms:
                # Merge DB record onto the JWT context so callers can use it.
                return {**current_user, **user_doc}
    raise HTTPException(status_code=403, detail="غير مصرح لك بهذه العملية")


def _require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """OAuth app credentials are sensitive and only admins may read or edit them."""
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="هذه الإعدادات للمسؤول فقط")
    return current_user


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
                raise HTTPException(status_code=413, detail="حجم الملف أكبر من 200 ميجا")
            out.write(chunk)
    kind = "video" if ext in ALLOWED_VIDEO_EXT else "image"

    # Hard duration check at upload time. We can't know which platforms the
    # user will pick yet, so we enforce the maximum cap across all platforms
    # here and rely on the publish endpoint for per-platform checks.
    duration: Optional[float] = None
    if kind == "video":
        try:
            duration = await _probe_video_duration(dest)
        except HTTPException:
            dest.unlink(missing_ok=True)
            raise
        if duration > MAX_UPLOAD_VIDEO_SECONDS:
            dest.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail=(
                    f"مدة الفيديو ({int(duration)}ث) أطول من الحد الأقصى "
                    f"المسموح به للنشر ({MAX_UPLOAD_VIDEO_SECONDS}ث)."
                ),
            )

    base = _public_base_url(request)
    return {
        "filename": name,
        "kind": kind,
        "size": total,
        "duration": duration,
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
async def get_oauth_config(current_user: dict = Depends(_require_admin)):
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
    current_user: dict = Depends(_require_admin),
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

    # Escape every dynamic value before interpolating into HTML to prevent
    # reflected XSS via the `error`, `body`, or `platform` parameters.
    def _page(title: str, body: str, ok: bool) -> HTMLResponse:
        color = "#16a34a" if ok else "#dc2626"
        safe_title = html.escape(title)
        safe_body = html.escape(body)
        # platform is one of {"facebook","instagram","youtube","tiktok"} but we
        # still json-encode to safely embed in a JS string literal.
        safe_platform_js = json.dumps(platform)
        ok_js = "true" if ok else "false"
        return HTMLResponse(
            f"""<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
            <title>{safe_title}</title>
            <style>body{{font-family:Tajawal,Arial,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}}
            .card{{background:white;border-radius:16px;padding:32px;max-width:420px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.08)}}
            h2{{color:{color};margin-top:0}} button{{background:{color};color:white;border:0;border-radius:10px;padding:10px 20px;font-size:14px;cursor:pointer}}</style>
            </head><body><div class="card"><h2>{safe_title}</h2><p>{safe_body}</p>
            <button onclick="window.close()">إغلاق النافذة</button>
            <script>setTimeout(function(){{try{{window.opener&&window.opener.postMessage({{social_oauth:true,platform:{safe_platform_js},ok:{ok_js}}},'*');}}catch(e){{}};}},100);</script>
            </div></body></html>""",
            status_code=200,
        )

    if error:
        return _page("فشل الربط", "رفضت المنصة الطلب.", ok=False)
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
    except Exception:
        logger.exception("OAuth exchange failed for %s", platform)
        return _page("فشل الربط", "تعذر إكمال الربط. راجع سجلات الخادم لمعرفة السبب.", ok=False)

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


# ────────────────── Manual token paste (alternative to OAuth) ──────────────────
#
# Power-users (and admins who don't want to set up the full OAuth redirect
# dance) can paste tokens they've obtained from the platform's own tooling
# (Graph API Explorer, Google OAuth Playground, TikTok Sandbox).
#
# The endpoint validates each token by making a single read call against the
# platform's API, then writes the same `social_accounts` shape that the OAuth
# callback would have produced. From this point on the publish flow is
# identical regardless of how the account was connected.

class ManualConnectPayload(BaseModel):
    # Meta (facebook/instagram)
    page_id: Optional[str] = None
    page_access_token: Optional[str] = None
    # YouTube — refresh_token is enough; client id/secret come from saved config
    refresh_token: Optional[str] = None
    # TikTok
    access_token: Optional[str] = None
    expires_in: Optional[int] = None


@router.post("/manual-connect/{platform}")
async def manual_connect(
    platform: str,
    payload: ManualConnectPayload,
    current_user: dict = Depends(_require_social_publisher),
):
    """Connect an account by pasting tokens, bypassing the OAuth redirect.

    Each platform validates its tokens against a single read endpoint
    before persisting, so a bad/expired token fails fast with a clear
    Arabic error instead of silently breaking the publish flow.
    """
    import time
    import httpx

    if platform not in PLATFORMS:
        raise HTTPException(status_code=400, detail="منصة غير معروفة")

    now_iso = datetime.now(timezone.utc).isoformat()

    # ── Meta (facebook + instagram share one connection) ──
    if platform in ("facebook", "instagram"):
        page_id = (payload.page_id or "").strip()
        page_token = (payload.page_access_token or "").strip()
        if not page_id or not page_token:
            raise HTTPException(status_code=400, detail="يرجى إدخال Page ID و Page Access Token.")
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(
                    f"https://graph.facebook.com/v19.0/{page_id}",
                    params={
                        "fields": "id,name,access_token,instagram_business_account{id,username}",
                        "access_token": page_token,
                    },
                )
            if r.status_code != 200:
                detail = (r.json().get("error", {}) or {}).get("message", "تحقق التوكن فشل")
                raise HTTPException(status_code=400, detail=f"فشل التحقق من Meta: {detail}")
            data = r.json()
        except HTTPException:
            raise
        except Exception:
            logger.exception("Meta manual-connect validation failed")
            raise HTTPException(status_code=502, detail="تعذر الاتصال بـ Meta للتحقق من التوكن.")

        page = {
            "id": data.get("id") or page_id,
            "name": data.get("name") or "Facebook Page",
            # Prefer the page_access_token returned by Graph (some pasted tokens are
            # already page-scoped, in which case Graph echoes the same value).
            "access_token": data.get("access_token") or page_token,
            "instagram_business_account": data.get("instagram_business_account"),
        }
        pages = [page]
        for plat in ("facebook", "instagram"):
            doc = {
                "platform": plat,
                "display_name": page["name"],
                "user_access_token": page_token,
                "expires_at": None,  # pasted tokens — expiry unknown
                "page": page,
                "all_pages": pages,
                "connected_at": now_iso,
                "connected_via": "manual",
            }
            await db.social_accounts.replace_one({"platform": plat}, doc, upsert=True)
        return {"connected": ["facebook", "instagram"], "page_name": page["name"]}

    # ── YouTube — paste a refresh_token, we exchange + look up the channel ──
    if platform == "youtube":
        refresh = (payload.refresh_token or "").strip()
        if not refresh:
            raise HTTPException(status_code=400, detail="يرجى إدخال Refresh Token.")
        cfg = await get_config("youtube")
        client_id = (cfg.get("client_id") or "").strip()
        client_secret = (cfg.get("client_secret") or "").strip()
        if not (client_id and client_secret):
            raise HTTPException(
                status_code=400,
                detail="يجب أولاً حفظ Google Client ID و Client Secret من قسم الإعدادات.",
            )
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                tr = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "refresh_token": refresh,
                        "grant_type": "refresh_token",
                    },
                )
            if tr.status_code != 200:
                detail = (tr.json() or {}).get("error_description") or "تحقق التوكن فشل"
                raise HTTPException(status_code=400, detail=f"فشل تجديد توكن YouTube: {detail}")
            tok = tr.json()
            access_token = tok.get("access_token")
            expires_in = int(tok.get("expires_in") or 3600)

            async with httpx.AsyncClient(timeout=30) as client:
                cr = await client.get(
                    "https://www.googleapis.com/youtube/v3/channels",
                    params={"part": "snippet", "mine": "true"},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
            if cr.status_code != 200:
                raise HTTPException(status_code=400, detail="تعذر جلب بيانات قناة YouTube بهذا التوكن.")
            items = (cr.json() or {}).get("items") or []
            if not items:
                raise HTTPException(status_code=400, detail="هذا الحساب لا يملك قناة YouTube.")
            ch = items[0]
            channel_id = ch.get("id")
            channel_name = ((ch.get("snippet") or {}).get("title")) or "YouTube channel"
        except HTTPException:
            raise
        except Exception:
            logger.exception("YouTube manual-connect validation failed")
            raise HTTPException(status_code=502, detail="تعذر الاتصال بـ Google للتحقق من التوكن.")

        doc = {
            "platform": "youtube",
            "display_name": channel_name,
            "access_token": access_token,
            "refresh_token": refresh,
            "client_id": client_id,
            "client_secret": client_secret,
            "expires_at": int(time.time()) + expires_in,
            "channel_id": channel_id,
            "connected_at": now_iso,
            "connected_via": "manual",
        }
        await db.social_accounts.replace_one({"platform": "youtube"}, doc, upsert=True)
        return {"connected": ["youtube"], "channel_name": channel_name}

    # ── TikTok — paste access_token + refresh_token, look up open_id/display_name ──
    if platform == "tiktok":
        access = (payload.access_token or "").strip()
        refresh = (payload.refresh_token or "").strip()
        if not access:
            raise HTTPException(status_code=400, detail="يرجى إدخال Access Token.")
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                ur = await client.get(
                    "https://open.tiktokapis.com/v2/user/info/",
                    params={"fields": "open_id,display_name"},
                    headers={"Authorization": f"Bearer {access}"},
                )
            if ur.status_code != 200:
                raise HTTPException(status_code=400, detail="فشل التحقق من توكن TikTok.")
            user = ((ur.json() or {}).get("data") or {}).get("user") or {}
            open_id = user.get("open_id")
            display_name = user.get("display_name") or "TikTok account"
        except HTTPException:
            raise
        except Exception:
            logger.exception("TikTok manual-connect validation failed")
            raise HTTPException(status_code=502, detail="تعذر الاتصال بـ TikTok للتحقق من التوكن.")

        expires_in = int(payload.expires_in or 86400)
        doc = {
            "platform": "tiktok",
            "display_name": display_name,
            "access_token": access,
            "refresh_token": refresh or None,
            "expires_at": int(time.time()) + expires_in,
            "open_id": open_id,
            "connected_at": now_iso,
            "connected_via": "manual",
        }
        await db.social_accounts.replace_one({"platform": "tiktok"}, doc, upsert=True)
        return {"connected": ["tiktok"], "display_name": display_name}

    raise HTTPException(status_code=400, detail="منصة غير مدعومة للربط اليدوي.")


# ────────────────── Publishing ──────────────────

class PublishTarget(BaseModel):
    platform: str
    caption_override: Optional[str] = None


class VideoCrop(BaseModel):
    x: int
    y: int
    width: int
    height: int


class VideoFilter(BaseModel):
    # All percentages — 100 means "no change". hueRotate is in degrees.
    brightness: int = 100
    contrast: int = 100
    saturate: int = 100
    sepia: int = 0
    grayscale: int = 0
    hueRotate: int = 0


class VideoLogo(BaseModel):
    # 'default' uses the bundled academy logo; 'custom' references a previously
    # uploaded image by `filename` (basename inside the social uploads dir).
    source: str  # 'default' | 'custom'
    filename: Optional[str] = None
    size_percent: float = 20
    x_percent: float = 95
    y_percent: float = 95
    opacity_percent: float = 80


class VideoEdits(BaseModel):
    filter: Optional[VideoFilter] = None
    logo: Optional[VideoLogo] = None


class PublishRequest(BaseModel):
    media_filename: str
    caption: str = ""
    targets: List[PublishTarget]
    video_crop: Optional[VideoCrop] = None
    video_edits: Optional[VideoEdits] = None


DEFAULT_LOGO_PATH = ROOT_DIR / "static" / "logo-new.png"


def _build_video_filter_chain(vf: VideoFilter) -> List[str]:
    """Build a list of ffmpeg filter expressions matching the CSS filter
    semantics used by the editor: brightness/contrast/saturate as percentages,
    plus optional sepia, grayscale, and hue-rotate.
    """
    chain: List[str] = []
    # Match CSS filter semantics:
    #   * brightness(B%) is multiplicative — multiply each channel by B/100.
    #     ffmpeg's `eq=brightness` is an additive offset and does NOT match
    #     CSS, so we use colorchannelmixer with a diagonal matrix instead.
    #   * contrast(C%) and saturate(S%) are also multiplicative; ffmpeg's `eq`
    #     contrast/saturation params are multipliers around 1.0, which lines
    #     up with the CSS definition.
    #   * grayscale(G%) collapses saturation; combine with the saturate slider.
    b_mult = vf.brightness / 100.0
    if abs(b_mult - 1.0) > 1e-3:
        chain.append(
            f"colorchannelmixer=rr={b_mult:.3f}:gg={b_mult:.3f}:bb={b_mult:.3f}"
        )
    sat_factor = (vf.saturate / 100.0) * (1.0 - max(0, min(100, vf.grayscale)) / 100.0)
    contrast_mult = vf.contrast / 100.0
    if abs(contrast_mult - 1.0) > 1e-3 or abs(sat_factor - 1.0) > 1e-3:
        chain.append(f"eq=contrast={contrast_mult:.3f}:saturation={sat_factor:.3f}")
    if vf.hueRotate:
        chain.append(f"hue=h={vf.hueRotate}")
    if vf.sepia:
        a = max(0, min(100, vf.sepia)) / 100.0
        # Mix the identity matrix with the canonical sepia matrix by `a`.
        rr = (1 - a) + a * 0.393
        rg = a * 0.769
        rb = a * 0.189
        gr = a * 0.349
        gg = (1 - a) + a * 0.686
        gb = a * 0.168
        br = a * 0.272
        bg = a * 0.534
        bb = (1 - a) + a * 0.131
        chain.append(
            "colorchannelmixer="
            f"rr={rr:.3f}:rg={rg:.3f}:rb={rb:.3f}:"
            f"gr={gr:.3f}:gg={gg:.3f}:gb={gb:.3f}:"
            f"br={br:.3f}:bg={bg:.3f}:bb={bb:.3f}"
        )
    return chain


def _resolve_logo_path(logo: VideoLogo) -> Path:
    """Resolve the actual path on disk for the requested logo, with the same
    sandbox guarantees we use for the main media file."""
    if logo.source == "default":
        if not DEFAULT_LOGO_PATH.exists():
            raise HTTPException(status_code=500, detail="ملف الشعار الافتراضي غير موجود.")
        return DEFAULT_LOGO_PATH
    if logo.source == "custom":
        raw = logo.filename or ""
        safe = os.path.basename(raw)
        if not safe or safe in {".", ".."} or safe != raw:
            raise HTTPException(status_code=400, detail="اسم ملف الشعار غير صالح.")
        if Path(safe).suffix.lower() not in ALLOWED_IMAGE_EXT:
            raise HTTPException(status_code=400, detail="نوع ملف الشعار غير مدعوم.")
        path = (SOCIAL_UPLOAD_DIR / safe).resolve()
        try:
            path.relative_to(SOCIAL_UPLOAD_DIR.resolve())
        except ValueError:
            raise HTTPException(status_code=400, detail="مسار الشعار غير مسموح به.")
        if not path.exists():
            raise HTTPException(status_code=404, detail="ملف الشعار غير موجود.")
        return path
    raise HTTPException(status_code=400, detail="مصدر الشعار غير معروف.")


async def _ffmpeg_process_video(
    src: Path,
    crop: Optional[VideoCrop] = None,
    edits: Optional[VideoEdits] = None,
) -> Path:
    """Run ffmpeg to apply crop, color filters, and a logo overlay in a
    single re-encode pass. Returns the path of the processed output.

    Raises HTTPException on failure. Caller is responsible for unlinking
    the output file once done.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(status_code=500, detail="ffmpeg غير مثبت على الخادم.")

    has_crop = crop is not None
    color_filter = edits.filter if (edits and edits.filter) else None
    logo = edits.logo if (edits and edits.logo) else None
    if not has_crop and not color_filter and not logo:
        # Nothing to do — caller shouldn't call us, but be defensive.
        return src

    if has_crop and (crop.width <= 0 or crop.height <= 0):
        raise HTTPException(status_code=400, detail="أبعاد القص غير صالحة.")

    out_path = src.with_name(f"{src.stem}-edited-{uuid.uuid4().hex[:8]}{src.suffix}")

    # Build the filter graph. Always operate on `[0:v]`. If a logo is present
    # we need a filter_complex with a second input; otherwise -vf is enough.
    main_filters: List[str] = []
    if has_crop:
        # Even-aligned dimensions: most codecs require width/height divisible by 2.
        w = max(2, crop.width - (crop.width % 2))
        h = max(2, crop.height - (crop.height % 2))
        x = max(0, crop.x)
        y = max(0, crop.y)
        main_filters.append(f"crop={w}:{h}:{x}:{y}")
    if color_filter:
        main_filters.extend(_build_video_filter_chain(color_filter))

    cmd = [ffmpeg, "-y", "-i", str(src)]

    if logo:
        logo_path = _resolve_logo_path(logo)
        cmd.extend(["-i", str(logo_path)])
        size = max(1.0, min(100.0, float(logo.size_percent)))
        opacity = max(0.0, min(1.0, float(logo.opacity_percent) / 100.0))
        x_pct = max(0.0, min(100.0, float(logo.x_percent))) / 100.0
        y_pct = max(0.0, min(100.0, float(logo.y_percent))) / 100.0
        main_chain = ",".join(main_filters) if main_filters else "null"
        # The logo size is expressed as a percentage of the MAIN video width
        # (matches the editor's CSS preview). Probe the input dimensions and
        # compute an absolute pixel width so we can use a plain `scale` filter.
        # If a crop is applied first, use the cropped width as the reference
        # so what the user sees stays consistent.
        if has_crop:
            ref_w = max(2, crop.width - (crop.width % 2))
        else:
            dims = await _probe_video_dimensions(src)
            if not dims:
                raise HTTPException(
                    status_code=500,
                    detail="تعذر قراءة أبعاد الفيديو لتحديد حجم الشعار.",
                )
            ref_w = dims[0]
        logo_w_px = max(2, int(round(ref_w * size / 100.0)))
        # Even-aligned width keeps yuv420p encoders happy when the logo is
        # used downstream.
        if logo_w_px % 2:
            logo_w_px += 1
        logo_chain = (
            f"[1:v]scale={logo_w_px}:-1,"
            f"format=rgba,colorchannelmixer=aa={opacity:.3f}[lg]"
        )
        overlay_x = f"main_w*{x_pct:.4f}-overlay_w/2"
        overlay_y = f"main_h*{y_pct:.4f}-overlay_h/2"
        filter_complex = (
            f"[0:v]{main_chain}[v0];{logo_chain};"
            f"[v0][lg]overlay=x={overlay_x}:y={overlay_y}:format=auto[outv]"
        )
        cmd.extend(["-filter_complex", filter_complex, "-map", "[outv]", "-map", "0:a?"])
    else:
        if main_filters:
            cmd.extend(["-vf", ",".join(main_filters)])
        # When only color filters are applied (no overlay) audio can be copied.
        cmd.extend(["-map", "0:v", "-map", "0:a?"])

    cmd.extend([
        "-c:a", "copy",
        "-preset", "veryfast",
        "-movflags", "+faststart",
        str(out_path),
    ])

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)
        if proc.returncode != 0:
            logger.warning(
                "ffmpeg process failed: %s",
                (stderr or b"")[-600:].decode(errors="ignore"),
            )
            out_path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail="فشل تطبيق التعديلات على الفيديو.")
    except HTTPException:
        raise
    except Exception:
        logger.exception("ffmpeg process crashed")
        out_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="تعذر تنفيذ معالجة الفيديو.")
    return out_path


# Backwards-compat shim retained in case other modules import this name.
async def _ffmpeg_crop_video(src: Path, crop: VideoCrop) -> Path:
    return await _ffmpeg_process_video(src, crop=crop)


class VideoPreviewRequest(BaseModel):
    media_filename: str
    video_crop: Optional[VideoCrop] = None
    video_edits: Optional[VideoEdits] = None


# Temp preview videos live for this many seconds before being deleted in
# the background. Long enough to watch through once or twice, short enough
# that the uploads dir doesn't fill up if the user previews many times.
PREVIEW_TTL_SECONDS = 600


async def _delete_path_after(path: Path, delay_seconds: float) -> None:
    """Background helper that sleeps then removes a file. Safe to fire and
    forget — exceptions are logged, not re-raised."""
    try:
        await asyncio.sleep(delay_seconds)
        path.unlink(missing_ok=True)
    except Exception:
        logger.exception("preview cleanup failed for %s", path)


@router.post("/posts/preview")
async def preview_video_edits(
    payload: VideoPreviewRequest,
    request: Request,
    current_user: dict = Depends(_require_social_publisher),
):
    """Apply the requested crop / filters / logo to the uploaded video and
    return a temporary public URL the browser can play. The output file is
    deleted automatically after PREVIEW_TTL_SECONDS.
    """
    raw_name = payload.media_filename or ""
    safe_name = os.path.basename(raw_name)
    if not safe_name or safe_name in {".", ".."} or safe_name != raw_name:
        raise HTTPException(status_code=400, detail="اسم الملف غير صالح")
    if Path(safe_name).suffix.lower() not in ALLOWED_VIDEO_EXT:
        raise HTTPException(status_code=400, detail="المعاينة متاحة للفيديو فقط")
    src = (SOCIAL_UPLOAD_DIR / safe_name).resolve()
    try:
        src.relative_to(SOCIAL_UPLOAD_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="مسار غير مسموح به")
    if not src.exists():
        raise HTTPException(status_code=404, detail="الملف المرفوع غير موجود")
    if payload.video_crop is None and payload.video_edits is None:
        raise HTTPException(status_code=400, detail="لا توجد تعديلات لمعاينتها")

    processed = await _ffmpeg_process_video(
        src, crop=payload.video_crop, edits=payload.video_edits,
    )
    if processed == src:
        # No-op edits — nothing new to show.
        raise HTTPException(status_code=400, detail="لا توجد تعديلات لمعاينتها")

    # Tag the file so cleanup tools and ops can recognise it as a preview.
    preview_path = processed.with_name(f"preview-{processed.name}")
    try:
        processed.rename(preview_path)
    except OSError:
        # Rename across-device shouldn't happen (same dir) but stay safe.
        preview_path = processed

    asyncio.create_task(_delete_path_after(preview_path, PREVIEW_TTL_SECONDS))
    base = _public_base_url(request)
    return {
        "filename": preview_path.name,
        "public_url": f"{base}/uploads/social/{preview_path.name}",
        "expires_in": PREVIEW_TTL_SECONDS,
    }


@router.post("/posts")
async def publish_post(
    payload: PublishRequest,
    request: Request,
    current_user: dict = Depends(_require_social_publisher),
):
    if not payload.targets:
        raise HTTPException(status_code=400, detail="اختر منصة واحدة على الأقل")
    # Sanitize filename: only allow a basename that exists inside the upload
    # directory, no slashes, no traversal.
    raw_name = payload.media_filename or ""
    safe_name = os.path.basename(raw_name)
    if not safe_name or safe_name in {".", ".."} or safe_name != raw_name:
        raise HTTPException(status_code=400, detail="اسم الملف غير صالح")
    if Path(safe_name).suffix.lower() not in (ALLOWED_IMAGE_EXT | ALLOWED_VIDEO_EXT):
        raise HTTPException(status_code=400, detail="نوع الملف غير مدعوم")
    media_path = (SOCIAL_UPLOAD_DIR / safe_name).resolve()
    try:
        media_path.relative_to(SOCIAL_UPLOAD_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="مسار غير مسموح به")
    if not media_path.exists():
        raise HTTPException(status_code=404, detail="الملف المرفوع غير موجود")
    payload.media_filename = safe_name
    base = _public_base_url(request)
    public_url = f"{base}/uploads/social/{payload.media_filename}"
    # Path actually sent to the platform adapters; replaced with the cropped
    # output below if a video crop is requested.
    publish_path = media_path
    publish_url = public_url
    cropped_temp: Optional[Path] = None

    post_id = str(uuid.uuid4())
    media_kind = "video" if media_path.suffix.lower() in ALLOWED_VIDEO_EXT else "image"

    # Per-platform duration check. The upload endpoint already enforced the
    # global maximum, but each selected platform may have a stricter limit
    # (e.g. Instagram Reels 60s). Re-probe here to keep this endpoint
    # authoritative even when called independently of /uploads.
    if media_kind == "video":
        duration = await _probe_video_duration(media_path)
        exceeded = []
        for t in payload.targets:
            limit = PLATFORM_MAX_VIDEO_SECONDS.get(t.platform)
            if limit is not None and duration > limit:
                exceeded.append(f"{t.platform} (الحد {limit}ث)")
        if exceeded:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"مدة الفيديو ({int(duration)}ث) أطول من الحد المسموح في: "
                    + "، ".join(exceeded)
                ),
            )
        if payload.video_crop is not None or payload.video_edits is not None:
            processed = await _ffmpeg_process_video(
                media_path,
                crop=payload.video_crop,
                edits=payload.video_edits,
            )
            # Only treat the result as a derivative file when ffmpeg actually
            # wrote a new file; if it returned the original source (no-op
            # edits) we keep `cropped_temp` None so the persisted metadata
            # accurately reflects that no derivative exists.
            if processed != media_path:
                cropped_temp = processed
                publish_path = cropped_temp
                publish_url = f"{base}/uploads/social/{cropped_temp.name}"

    post_doc = {
        "id": post_id,
        "caption": payload.caption,
        "media_filename": payload.media_filename,
        "media_kind": media_kind,
        "public_url": public_url,
        "cropped_filename": cropped_temp.name if cropped_temp else None,
        "video_crop": payload.video_crop.model_dump() if payload.video_crop else None,
        "video_edits": payload.video_edits.model_dump() if payload.video_edits else None,
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
            res = await adapter_fn(account, str(publish_path), publish_url, caption)
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

    # The cropped video file is intentionally NOT deleted here. Some platform
    # adapters (notably TikTok and Meta video endpoints) ingest from the URL
    # asynchronously after this request returns. The file lives in the same
    # uploads directory as the original and is retained on the same lifecycle.

    return {"post_id": post_id, "results": results}


async def _refresh_insights_for_targets(targets: List[dict], delay_between: float = 0.0) -> List[dict]:
    """Shared insights-refresh routine used by both the manual endpoint and
    the background scheduler. Iterates targets and persists results on each
    `social_post_targets` document. `delay_between` seconds are awaited
    between consecutive platform calls to be gentle on rate limits.
    """
    from utils.social import INSIGHTS_ADAPTERS
    out: List[dict] = []
    now = datetime.now(timezone.utc).isoformat()
    for idx, t in enumerate(targets):
        target_id = t.get("id")
        platform = t.get("platform")
        platform_post_id = t.get("platform_post_id")
        if t.get("status") != "success" or not platform_post_id:
            out.append({
                "id": target_id, "platform": platform,
                "skipped": True, "reason": "no platform post id",
            })
            continue
        account = await db.social_accounts.find_one({"platform": platform}, {"_id": 0})
        if not account:
            update = {
                "insights_error": "الحساب غير مربوط",
                "insights_updated_at": now,
            }
            await db.social_post_targets.update_one({"id": target_id}, {"$set": update})
            out.append({"id": target_id, "platform": platform, **update})
            continue
        fn = INSIGHTS_ADAPTERS.get(platform)
        if fn is None:
            out.append({
                "id": target_id, "platform": platform,
                "skipped": True, "reason": "no insights adapter",
            })
            continue
        try:
            res = await fn(account, platform_post_id)
        except Exception as e:
            logger.exception("Insights failed for %s/%s", platform, platform_post_id)
            res = {"success": False, "error": str(e)}
        update: Dict[str, Any] = {"insights_updated_at": now}
        if res.get("success"):
            update["insights"] = {
                "views": res.get("views"),
                "likes": res.get("likes"),
                "comments": res.get("comments"),
            }
            update["insights_error"] = None
        else:
            update["insights_error"] = res.get("error") or "تعذر جلب الإحصائيات"
        await db.social_post_targets.update_one({"id": target_id}, {"$set": update})
        # Append a historical snapshot for every successful refresh so we keep
        # a time-series instead of overwriting the latest value only.
        if res.get("success"):
            await db.social_post_insights_history.insert_one({
                "id": str(uuid.uuid4()),
                "post_id": t.get("post_id"),
                "target_id": target_id,
                "platform": platform,
                "views": res.get("views"),
                "likes": res.get("likes"),
                "comments": res.get("comments"),
                "snapshot_at": now,
            })
        out.append({"id": target_id, "platform": platform, **update})
        if delay_between and idx < len(targets) - 1:
            await asyncio.sleep(delay_between)
    return out


@router.post("/posts/{post_id}/refresh-insights")
async def refresh_post_insights(
    post_id: str,
    current_user: dict = Depends(_require_social_publisher),
):
    """Pull fresh views/likes/comments from each platform for a published post.

    Iterates the post's successful targets, calls each platform's insights
    adapter, and persists `insights` (views/likes/comments) and
    `insights_updated_at` (plus an `insights_error` when the call failed)
    onto the matching `social_post_targets` document.
    """
    post = await db.social_posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
    targets = await db.social_post_targets.find(
        {"post_id": post_id}, {"_id": 0},
    ).to_list(50)
    if not targets:
        return {"results": []}
    results = await _refresh_insights_for_targets(targets)
    return {"results": results}


@router.get("/posts/{post_id}/insights-history")
async def get_post_insights_history(
    post_id: str,
    platform: Optional[str] = None,
    limit: int = 500,
    current_user: dict = Depends(_require_social_publisher),
):
    """Return the time-series of insight snapshots captured for a post.

    Optionally filter by `platform`. Results are ordered by `snapshot_at`
    ascending so charts can render directly without resorting.
    """
    post = await db.social_posts.find_one({"id": post_id}, {"_id": 0, "id": 1})
    if not post:
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
    query: Dict[str, Any] = {"post_id": post_id}
    if platform:
        if platform not in PLATFORMS:
            raise HTTPException(status_code=400, detail="منصة غير معروفة")
        query["platform"] = platform
    capped = max(1, min(int(limit or 500), 2000))
    cursor = db.social_post_insights_history.find(query, {"_id": 0}).sort("snapshot_at", 1)
    history = await cursor.to_list(capped)
    return {"post_id": post_id, "history": history}


# ────────────────── Auto-refresh insights scheduler ──────────────────

# Defaults applied when no document exists yet in `social_settings`.
DEFAULT_AUTO_REFRESH = {
    "enabled": True,
    "interval_minutes": 60,
    "lookback_days": 30,
    # Number of days to keep raw `social_post_insights_history` snapshots
    # before they are purged by the scheduler to keep the collection bounded.
    "history_retention_days": 90,
}
# Sane bounds the UI can write — keeps users from accidentally hammering
# the platforms or starving the loop.
AUTO_REFRESH_MIN_INTERVAL = 15
AUTO_REFRESH_MAX_INTERVAL = 24 * 60
AUTO_REFRESH_MIN_LOOKBACK = 1
AUTO_REFRESH_MAX_LOOKBACK = 365
AUTO_REFRESH_MIN_RETENTION = 7
AUTO_REFRESH_MAX_RETENTION = 3650
# Per-call delay between successive platform requests inside the scheduler,
# both for politeness and to spread API quota usage.
AUTO_REFRESH_PLATFORM_DELAY_SECONDS = 1.0


async def _get_auto_refresh_settings() -> Dict[str, Any]:
    doc = await db.social_settings.find_one({"key": "auto_refresh_insights"}, {"_id": 0})
    if not doc:
        return dict(DEFAULT_AUTO_REFRESH)
    return {
        "enabled": bool(doc.get("enabled", DEFAULT_AUTO_REFRESH["enabled"])),
        "interval_minutes": int(doc.get("interval_minutes", DEFAULT_AUTO_REFRESH["interval_minutes"])),
        "lookback_days": int(doc.get("lookback_days", DEFAULT_AUTO_REFRESH["lookback_days"])),
        "history_retention_days": int(doc.get(
            "history_retention_days", DEFAULT_AUTO_REFRESH["history_retention_days"],
        )),
    }


@router.get("/insights-settings")
async def get_insights_settings(current_user: dict = Depends(_require_social_publisher)):
    """Return the auto-refresh settings + last-run metadata."""
    settings = await _get_auto_refresh_settings()
    meta = await db.social_settings.find_one({"key": "auto_refresh_insights"}, {"_id": 0}) or {}
    return {
        **settings,
        "last_run_at": meta.get("last_run_at"),
        "last_run_status": meta.get("last_run_status"),
        "last_run_refreshed": meta.get("last_run_refreshed"),
        "last_purge_at": meta.get("last_purge_at"),
        "last_purge_deleted": meta.get("last_purge_deleted"),
        "last_purge_status": meta.get("last_purge_status"),
        "last_purge_error": meta.get("last_purge_error"),
    }


class InsightsSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    interval_minutes: Optional[int] = None
    lookback_days: Optional[int] = None
    history_retention_days: Optional[int] = None


@router.put("/insights-settings")
async def update_insights_settings(
    payload: InsightsSettingsUpdate,
    current_user: dict = Depends(_require_social_publisher),
):
    current = await _get_auto_refresh_settings()
    if payload.enabled is not None:
        current["enabled"] = bool(payload.enabled)
    if payload.interval_minutes is not None:
        iv = int(payload.interval_minutes)
        if iv < AUTO_REFRESH_MIN_INTERVAL or iv > AUTO_REFRESH_MAX_INTERVAL:
            raise HTTPException(
                status_code=400,
                detail=f"الفاصل الزمني يجب أن يكون بين {AUTO_REFRESH_MIN_INTERVAL} و{AUTO_REFRESH_MAX_INTERVAL} دقيقة",
            )
        current["interval_minutes"] = iv
    if payload.lookback_days is not None:
        lb = int(payload.lookback_days)
        if lb < AUTO_REFRESH_MIN_LOOKBACK or lb > AUTO_REFRESH_MAX_LOOKBACK:
            raise HTTPException(
                status_code=400,
                detail=f"عدد أيام التحديث يجب أن يكون بين {AUTO_REFRESH_MIN_LOOKBACK} و{AUTO_REFRESH_MAX_LOOKBACK}",
            )
        current["lookback_days"] = lb
    if payload.history_retention_days is not None:
        rd = int(payload.history_retention_days)
        if rd < AUTO_REFRESH_MIN_RETENTION or rd > AUTO_REFRESH_MAX_RETENTION:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"مدة الاحتفاظ بسجلات الإحصائيات يجب أن تكون بين "
                    f"{AUTO_REFRESH_MIN_RETENTION} و{AUTO_REFRESH_MAX_RETENTION} يوماً"
                ),
            )
        current["history_retention_days"] = rd
    await db.social_settings.update_one(
        {"key": "auto_refresh_insights"},
        {"$set": {**current, "key": "auto_refresh_insights",
                  "updated_at": datetime.now(timezone.utc).isoformat(),
                  "updated_by": current_user.get("user_id") or current_user.get("id")}},
        upsert=True,
    )
    return current


# ----------------------------------------------------------------------------
# Manual uploads cleanup (admin-only)
# ----------------------------------------------------------------------------


async def _get_uploads_cleanup_meta() -> dict:
    meta = await db.social_settings.find_one({"key": "uploads_cleanup"}, {"_id": 0}) or {}
    retention = await _get_uploads_retention_days()
    interval = await _get_uploads_cleanup_interval_seconds()
    enabled = await _get_uploads_cleanup_enabled()
    return {
        "last_run_at": meta.get("last_run_at"),
        "last_run_deleted": meta.get("last_run_deleted"),
        "last_run_status": meta.get("last_run_status"),
        "last_run_error": meta.get("last_run_error"),
        "last_run_retention_days": meta.get("last_run_retention_days"),
        "retention_days": retention,
        "retention_days_default": UPLOADS_RETENTION_DAYS,
        "retention_days_min": UPLOADS_RETENTION_MIN_DAYS,
        "retention_days_max": UPLOADS_RETENTION_MAX_DAYS,
        "interval_seconds": interval,
        "interval_seconds_default": UPLOADS_CLEANUP_INTERVAL_SECONDS,
        "interval_seconds_min": UPLOADS_CLEANUP_INTERVAL_MIN_SECONDS,
        "interval_seconds_max": UPLOADS_CLEANUP_INTERVAL_MAX_SECONDS,
        "enabled": enabled,
        "enabled_default": True,
        "enabled_updated_at": meta.get("enabled_updated_at"),
        "enabled_updated_by": meta.get("enabled_updated_by"),
    }


@router.get("/uploads-cleanup")
async def get_uploads_cleanup_status(current_user: dict = Depends(_require_admin)):
    """Return last-run metadata for the social uploads cleanup job."""
    return await _get_uploads_cleanup_meta()


@router.get("/uploads-cleanup-runs")
async def get_uploads_cleanup_runs(
    limit: int = 50,
    current_user: dict = Depends(_require_admin),
):
    """Return the most recent cleanup runs (newest first) so admins can
    review the scheduler's behaviour over time. Each entry includes the
    timestamp, status (``ok`` / ``error`` / ``skipped``), source
    (``scheduled`` / ``manual``), number of files deleted, and any error
    message recorded for that run."""
    try:
        n = int(limit)
    except (TypeError, ValueError):
        n = UPLOADS_CLEANUP_RUNS_API_DEFAULT
    if n < 1:
        n = 1
    if n > UPLOADS_CLEANUP_RUNS_API_MAX:
        n = UPLOADS_CLEANUP_RUNS_API_MAX
    try:
        runs = (
            await db.social_uploads_cleanup_runs.find({}, {"_id": 0})
            .sort("ts", -1)
            .to_list(n)
        )
    except Exception:
        logger.exception("Failed to read uploads cleanup run history")
        runs = []
    return {"runs": runs, "limit": n, "keep": UPLOADS_CLEANUP_RUNS_KEEP}


def _compute_uploads_usage() -> Dict[str, int]:
    """Return current disk usage for SOCIAL_UPLOAD_DIR as
    ``{files_count, total_bytes}``. Symlinks and subdirectories are skipped
    so the figure reflects only the regular media files we actually manage.
    """
    files_count = 0
    total_bytes = 0
    if SOCIAL_UPLOAD_DIR.exists():
        for entry in SOCIAL_UPLOAD_DIR.iterdir():
            try:
                if not entry.is_file() or entry.is_symlink():
                    continue
                total_bytes += entry.stat().st_size
                files_count += 1
            except OSError:
                # Race with cleanup or unreadable entry — just skip it.
                continue
    return {"files_count": files_count, "total_bytes": total_bytes}


@router.get("/uploads-usage")
async def get_uploads_usage(current_user: dict = Depends(_require_admin)):
    """Return the current number of files and total bytes stored under the
    social uploads directory. Used by the cleanup panel to show disk usage
    before/after manual cleanup runs."""
    return _compute_uploads_usage()


UPLOADS_LARGEST_DEFAULT = 10
UPLOADS_LARGEST_MAX = 100


@router.get("/uploads-largest")
async def get_uploads_largest(
    limit: int = UPLOADS_LARGEST_DEFAULT,
    current_user: dict = Depends(_require_admin),
):
    """Return the largest ``limit`` files in SOCIAL_UPLOAD_DIR sorted by size
    descending. Each entry includes filename, size in bytes, mtime ISO, and
    whether it is referenced by a recent post (within the active retention
    window). Used by the cleanup panel to surface the biggest space hogs so
    admins can decide on manual deletes."""
    try:
        n = int(limit)
    except (TypeError, ValueError):
        n = UPLOADS_LARGEST_DEFAULT
    if n < 1:
        n = 1
    if n > UPLOADS_LARGEST_MAX:
        n = UPLOADS_LARGEST_MAX

    entries: list = []
    if SOCIAL_UPLOAD_DIR.exists():
        for entry in SOCIAL_UPLOAD_DIR.iterdir():
            try:
                if not entry.is_file() or entry.is_symlink():
                    continue
                st = entry.stat()
            except OSError:
                continue
            entries.append({
                "filename": entry.name,
                "size_bytes": st.st_size,
                "mtime": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
            })

    entries.sort(key=lambda e: e["size_bytes"], reverse=True)
    top = entries[:n]

    retention_days = await _get_uploads_retention_days()
    recent_referenced = await _collect_recent_post_filenames(retention_days)
    for e in top:
        e["linked_to_recent_post"] = e["filename"] in recent_referenced

    return {
        "files": top,
        "limit": n,
        "retention_days": retention_days,
        "total_files_scanned": len(entries),
    }


@router.delete("/uploads/{filename}")
async def delete_upload_file(
    filename: str,
    current_user: dict = Depends(_require_admin),
):
    """Manually delete a single file from SOCIAL_UPLOAD_DIR. The filename is
    sanitised so callers cannot escape the directory. Returns the freed size
    so the UI can update its disk-usage figures."""
    safe = os.path.basename(filename or "")
    if not safe or safe in (".", ".."):
        raise HTTPException(status_code=400, detail="اسم ملف غير صالح")
    target = (SOCIAL_UPLOAD_DIR / safe).resolve()
    try:
        target.relative_to(SOCIAL_UPLOAD_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="اسم ملف غير صالح")
    if not target.exists() or not target.is_file() or target.is_symlink():
        raise HTTPException(status_code=404, detail="الملف غير موجود")
    try:
        size = target.stat().st_size
    except OSError:
        size = 0
    try:
        target.unlink()
    except OSError as e:
        logger.exception("Manual delete failed for %s", safe)
        raise HTTPException(status_code=500, detail=f"تعذر حذف الملف: {e}")
    logger.info("Manual social upload delete: %s (%d bytes) by %s",
                safe, size, current_user.get("user_id") or current_user.get("id"))
    return {"deleted": True, "filename": safe, "freed_bytes": size}


class UploadsBulkDeleteRequest(BaseModel):
    filenames: List[str]


@router.post("/uploads/bulk-delete")
async def bulk_delete_upload_files(
    payload: UploadsBulkDeleteRequest,
    current_user: dict = Depends(_require_admin),
):
    """Delete multiple files from SOCIAL_UPLOAD_DIR in one request. Filenames
    are sanitised and validated against the upload directory boundary so the
    caller cannot escape it. Returns a per-file summary plus aggregate
    counters so the UI can show a single toast for the whole operation."""
    if not payload.filenames:
        raise HTTPException(status_code=400, detail="لم يتم تحديد أي ملف")

    base = SOCIAL_UPLOAD_DIR.resolve()
    deleted: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    total_freed = 0
    seen: set = set()

    for raw in payload.filenames:
        safe = os.path.basename(raw or "")
        if not safe or safe in (".", "..") or safe in seen:
            failed.append({"filename": raw, "error": "اسم ملف غير صالح"})
            continue
        seen.add(safe)
        target = (SOCIAL_UPLOAD_DIR / safe).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            failed.append({"filename": safe, "error": "اسم ملف غير صالح"})
            continue
        if not target.exists() or not target.is_file() or target.is_symlink():
            failed.append({"filename": safe, "error": "الملف غير موجود"})
            continue
        try:
            size = target.stat().st_size
        except OSError:
            size = 0
        try:
            target.unlink()
        except OSError as e:
            logger.exception("Bulk delete failed for %s", safe)
            failed.append({"filename": safe, "error": str(e)})
            continue
        deleted.append({"filename": safe, "freed_bytes": size})
        total_freed += size

    logger.info(
        "Bulk social upload delete: %d deleted, %d failed, %d bytes freed by %s",
        len(deleted), len(failed), total_freed,
        current_user.get("user_id") or current_user.get("id"),
    )
    return {
        "deleted": deleted,
        "failed": failed,
        "deleted_count": len(deleted),
        "failed_count": len(failed),
        "freed_bytes": total_freed,
    }


class UploadsCleanupSettingsUpdate(BaseModel):
    retention_days: Optional[int] = None
    interval_seconds: Optional[int] = None
    enabled: Optional[bool] = None


@router.put("/uploads-cleanup-settings")
async def update_uploads_cleanup_settings(
    payload: UploadsCleanupSettingsUpdate,
    current_user: dict = Depends(_require_admin),
):
    """Update the retention window (in days) and/or the scheduled cleanup
    interval (in seconds). Both fields are optional so the UI can update them
    independently. Admin-only."""
    if (
        payload.retention_days is None
        and payload.interval_seconds is None
        and payload.enabled is None
    ):
        raise HTTPException(status_code=400, detail="لم يتم تمرير أي قيمة للتحديث")

    update_set: Dict[str, object] = {"key": "uploads_cleanup"}
    now_iso = datetime.now(timezone.utc).isoformat()
    actor = current_user.get("user_id") or current_user.get("id")

    if payload.retention_days is not None:
        try:
            rd = int(payload.retention_days)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="قيمة غير صالحة لعدد الأيام")
        if rd < UPLOADS_RETENTION_MIN_DAYS or rd > UPLOADS_RETENTION_MAX_DAYS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"عدد أيام الاحتفاظ يجب أن يكون بين {UPLOADS_RETENTION_MIN_DAYS} "
                    f"و{UPLOADS_RETENTION_MAX_DAYS} يوماً"
                ),
            )
        update_set["retention_days"] = rd
        update_set["retention_updated_at"] = now_iso
        update_set["retention_updated_by"] = actor

    if payload.interval_seconds is not None:
        try:
            iv = int(payload.interval_seconds)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="قيمة غير صالحة للفاصل الزمني")
        if iv < UPLOADS_CLEANUP_INTERVAL_MIN_SECONDS or iv > UPLOADS_CLEANUP_INTERVAL_MAX_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"الفاصل الزمني يجب أن يكون بين {UPLOADS_CLEANUP_INTERVAL_MIN_SECONDS} "
                    f"و{UPLOADS_CLEANUP_INTERVAL_MAX_SECONDS} ثانية"
                ),
            )
        update_set["interval_seconds"] = iv
        update_set["interval_updated_at"] = now_iso
        update_set["interval_updated_by"] = actor

    if payload.enabled is not None:
        update_set["enabled"] = bool(payload.enabled)
        update_set["enabled_updated_at"] = now_iso
        update_set["enabled_updated_by"] = actor

    await db.social_settings.update_one(
        {"key": "uploads_cleanup"},
        {"$set": update_set},
        upsert=True,
    )
    return await _get_uploads_cleanup_meta()


@router.get("/uploads-cleanup-preview")
async def preview_uploads_cleanup(
    retention_days: Optional[int] = None,
    current_user: dict = Depends(_require_admin),
):
    """Dry-run preview of how many files would be deleted by the cleanup job
    using the given ``retention_days`` (defaults to the saved value). Walks
    the same logic as ``_cleanup_social_uploads_once`` but does not touch
    any file. Returns counts and the total size that would be freed."""
    if retention_days is None:
        rd = await _get_uploads_retention_days()
    else:
        try:
            rd = int(retention_days)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="قيمة غير صالحة لعدد الأيام")
        if rd < UPLOADS_RETENTION_MIN_DAYS or rd > UPLOADS_RETENTION_MAX_DAYS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"عدد أيام الاحتفاظ يجب أن يكون بين {UPLOADS_RETENTION_MIN_DAYS} "
                    f"و{UPLOADS_RETENTION_MAX_DAYS} يوماً"
                ),
            )

    files_count = 0
    total_bytes = 0
    kept_recent = 0
    kept_recent_post_linked = 0
    if SOCIAL_UPLOAD_DIR.exists():
        cutoff_ts = datetime.now(timezone.utc).timestamp() - rd * 86400
        recent_referenced = await _collect_recent_post_filenames(rd)
        for entry in SOCIAL_UPLOAD_DIR.iterdir():
            try:
                if not entry.is_file() or entry.is_symlink():
                    continue
                if entry.name in recent_referenced:
                    kept_recent_post_linked += 1
                    continue
                try:
                    st = entry.stat()
                except OSError:
                    continue
                if st.st_mtime > cutoff_ts:
                    kept_recent += 1
                    continue
                files_count += 1
                total_bytes += st.st_size
            except OSError:
                continue
    return {
        "retention_days": rd,
        "files_count": files_count,
        "total_bytes": total_bytes,
        "kept_recent": kept_recent,
        "kept_recent_post_linked": kept_recent_post_linked,
    }


@router.post("/uploads-cleanup")
async def run_uploads_cleanup_now(current_user: dict = Depends(_require_admin)):
    """Run the uploads cleanup job once on demand. Returns the deleted count."""
    retention = await _get_uploads_retention_days()
    try:
        deleted = await _cleanup_social_uploads_once(retention, source="manual")
    except Exception as e:
        logger.exception("Manual uploads cleanup failed")
        await _record_cleanup_failure(str(e), retention, source="manual")
        raise HTTPException(status_code=500, detail=f"تعذر تشغيل التنظيف: {e}")
    meta = await _get_uploads_cleanup_meta()
    return {"deleted": deleted, **meta}


# ----------------------------------------------------------------------------
# Design templates (saved filter/logo/text presets per user)
# ----------------------------------------------------------------------------

MAX_TEMPLATE_NAME_LEN = 60
MAX_TEMPLATES_PER_USER = 50


class DesignTemplateIn(BaseModel):
    name: str
    settings: Dict[str, Any]


class DesignTemplateUpdate(BaseModel):
    name: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None


def _template_owner_id(current_user: dict) -> str:
    owner = current_user.get("user_id") or current_user.get("id")
    if not owner:
        raise HTTPException(status_code=400, detail="تعذر تحديد المستخدم")
    return str(owner)


@router.get("/design-templates")
async def list_design_templates(current_user: dict = Depends(_require_social_publisher)):
    owner = _template_owner_id(current_user)
    items = await (
        db.social_design_templates
        .find({"user_id": owner}, {"_id": 0})
        .sort("updated_at", -1)
        .to_list(MAX_TEMPLATES_PER_USER)
    )
    return {"templates": items}


@router.post("/design-templates")
async def create_design_template(
    payload: DesignTemplateIn,
    current_user: dict = Depends(_require_social_publisher),
):
    owner = _template_owner_id(current_user)
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم القالب مطلوب")
    if len(name) > MAX_TEMPLATE_NAME_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"اسم القالب يجب ألا يتجاوز {MAX_TEMPLATE_NAME_LEN} حرفاً",
        )
    if not isinstance(payload.settings, dict):
        raise HTTPException(status_code=400, detail="إعدادات القالب غير صالحة")
    count = await db.social_design_templates.count_documents({"user_id": owner})
    if count >= MAX_TEMPLATES_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=f"وصلت الحد الأقصى من القوالب ({MAX_TEMPLATES_PER_USER}). احذف قالباً قديماً.",
        )
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": owner,
        "name": name,
        "settings": payload.settings,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.social_design_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/design-templates/{template_id}")
async def update_design_template(
    template_id: str,
    payload: DesignTemplateUpdate,
    current_user: dict = Depends(_require_social_publisher),
):
    owner = _template_owner_id(current_user)
    update_doc: Dict[str, Any] = {}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="اسم القالب مطلوب")
        if len(name) > MAX_TEMPLATE_NAME_LEN:
            raise HTTPException(
                status_code=400,
                detail=f"اسم القالب يجب ألا يتجاوز {MAX_TEMPLATE_NAME_LEN} حرفاً",
            )
        update_doc["name"] = name
    if payload.settings is not None:
        if not isinstance(payload.settings, dict):
            raise HTTPException(status_code=400, detail="إعدادات القالب غير صالحة")
        update_doc["settings"] = payload.settings
    if not update_doc:
        raise HTTPException(status_code=400, detail="لا يوجد تغييرات لحفظها")
    update_doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.social_design_templates.find_one_and_update(
        {"id": template_id, "user_id": owner},
        {"$set": update_doc},
        return_document=True,
        projection={"_id": 0},
    )
    if not res:
        raise HTTPException(status_code=404, detail="القالب غير موجود")
    return res


@router.delete("/design-templates/{template_id}")
async def delete_design_template(
    template_id: str,
    current_user: dict = Depends(_require_social_publisher),
):
    owner = _template_owner_id(current_user)
    res = await db.social_design_templates.delete_one({"id": template_id, "user_id": owner})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="القالب غير موجود")
    return {"success": True}


async def _run_auto_refresh_once(lookback_days: int) -> Dict[str, Any]:
    """Refresh insights for every successful target on posts created in the
    last `lookback_days` days. Returns a summary dict for logging.

    Streams results from MongoDB instead of loading everything into memory at
    once so the lookback window is fully covered even when there are tens of
    thousands of historical posts/targets.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat()
    post_count = 0
    target_count = 0
    batch: List[dict] = []
    BATCH_SIZE = 200

    async def _flush(current_batch: List[dict]):
        if current_batch:
            await _refresh_insights_for_targets(
                current_batch, delay_between=AUTO_REFRESH_PLATFORM_DELAY_SECONDS,
            )

    cursor = db.social_posts.find({"created_at": {"$gte": cutoff}}, {"_id": 0, "id": 1})
    async for post in cursor:
        post_count += 1
        post_id = post.get("id")
        if not post_id:
            continue
        target_cursor = db.social_post_targets.find(
            {"post_id": post_id, "status": "success"}, {"_id": 0},
        )
        async for t in target_cursor:
            batch.append(t)
            target_count += 1
            if len(batch) >= BATCH_SIZE:
                await _flush(batch)
                batch = []
    await _flush(batch)
    return {"posts": post_count, "targets": target_count}


async def _purge_old_insights_history(retention_days: int) -> int:
    """Delete `social_post_insights_history` entries older than the cutoff.

    Snapshots are stored with an ISO-8601 timestamp string in `snapshot_at`,
    which sorts lexicographically when in UTC, so a `$lt` string compare is
    safe and uses no extra indexes beyond a single field index.
    Returns the number of documents removed for logging purposes.
    """
    if retention_days <= 0:
        return 0
    cutoff_iso = (
        datetime.now(timezone.utc) - timedelta(days=retention_days)
    ).isoformat()
    res = await db.social_post_insights_history.delete_many(
        {"snapshot_at": {"$lt": cutoff_iso}},
    )
    return int(getattr(res, "deleted_count", 0) or 0)


_insights_scheduler_started = False


async def _insights_scheduler_loop():
    """Background loop that periodically refreshes insights for recent posts.

    Sleeps in short ticks so the interval/enabled toggle takes effect quickly
    after the user changes it, without restarting the server.
    """
    logger.info("Auto-refresh insights scheduler started")
    # Ensure the purge query stays fast at scale by creating an index on
    # the timestamp field once. Safe to call repeatedly — Mongo no-ops if
    # the index already exists.
    try:
        await db.social_post_insights_history.create_index("snapshot_at")
    except Exception:
        logger.exception("Failed to create snapshot_at index")
    next_run_at: Optional[datetime] = None
    # Stagger first run to avoid coinciding with startup load.
    await asyncio.sleep(60)
    while True:
        try:
            settings = await _get_auto_refresh_settings()
            if not settings["enabled"]:
                next_run_at = None
                await asyncio.sleep(60)
                continue
            interval = settings["interval_minutes"]
            now = datetime.now(timezone.utc)
            if next_run_at is None:
                next_run_at = now  # first enabled tick triggers immediately
            if now < next_run_at:
                # Wake up at most every minute to react to settings changes.
                wait = min(60, (next_run_at - now).total_seconds())
                await asyncio.sleep(max(1, wait))
                continue
            try:
                summary = await _run_auto_refresh_once(settings["lookback_days"])
                status = "ok"
                logger.info(
                    "Auto-refresh insights run finished: %s posts / %s targets",
                    summary["posts"], summary["targets"],
                )
            except Exception as e:
                logger.exception("Auto-refresh insights run failed")
                summary = {"error": str(e)}
                status = "error"
            # Purge stale history snapshots after each tick so the collection
            # stays bounded even when the user never opens the settings page.
            purge_deleted = 0
            purge_status = "ok"
            purge_error: Optional[str] = None
            try:
                purge_deleted = await _purge_old_insights_history(
                    settings["history_retention_days"],
                )
                if purge_deleted:
                    logger.info(
                        "Purged %s old insights history snapshots (retention=%s days)",
                        purge_deleted, settings["history_retention_days"],
                    )
            except Exception as pe:
                logger.exception("Insights history purge failed")
                purge_status = "error"
                purge_error = str(pe)
            await db.social_settings.update_one(
                {"key": "auto_refresh_insights"},
                {"$set": {
                    "last_run_at": datetime.now(timezone.utc).isoformat(),
                    "last_run_status": status,
                    "last_run_refreshed": summary.get("targets", 0),
                    "last_purge_at": datetime.now(timezone.utc).isoformat(),
                    "last_purge_deleted": purge_deleted,
                    "last_purge_status": purge_status,
                    "last_purge_error": purge_error,
                }},
                upsert=True,
            )
            next_run_at = datetime.now(timezone.utc) + timedelta(minutes=interval)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.exception("Insights scheduler tick crashed: %s", e)
            await asyncio.sleep(60)


def start_insights_scheduler() -> None:
    """Start the background loop once. Safe to call multiple times."""
    global _insights_scheduler_started
    if _insights_scheduler_started:
        return
    _insights_scheduler_started = True
    asyncio.ensure_future(_insights_scheduler_loop())


# ────────────────── Uploads cleanup scheduler ──────────────────
#
# The publish flow intentionally leaves processed videos and custom logo
# uploads on disk because some platforms (notably Meta and TikTok) fetch
# the public URL asynchronously after the API call returns. Without a
# janitor, `uploads/social/` grows without bound. This scheduler removes
# files older than UPLOADS_RETENTION_DAYS that aren't referenced by any
# persisted post (original media, processed derivative, or custom logo).

UPLOADS_RETENTION_DAYS = 7  # default when no admin override exists
UPLOADS_RETENTION_MIN_DAYS = 1
UPLOADS_RETENTION_MAX_DAYS = 365
UPLOADS_CLEANUP_INTERVAL_SECONDS = 24 * 3600  # default when no admin override exists
UPLOADS_CLEANUP_INTERVAL_MIN_SECONDS = 3600          # 1 hour — lower bound to avoid hammering disk/db
UPLOADS_CLEANUP_INTERVAL_MAX_SECONDS = 7 * 24 * 3600  # 7 days — upper bound so cleanup can't be effectively disabled
# Cap how many cleanup-run history records we keep in
# ``social_uploads_cleanup_runs``. Older entries are pruned on each insert so
# the collection can't grow without bound on long-lived installs.
UPLOADS_CLEANUP_RUNS_KEEP = 500
# Max ``limit`` accepted by the runs-history API. Keeps response sizes
# predictable for the admin panel.
UPLOADS_CLEANUP_RUNS_API_MAX = 200
UPLOADS_CLEANUP_RUNS_API_DEFAULT = 50
_uploads_cleanup_started = False


async def _record_cleanup_run(
    *,
    status: str,
    source: str,
    deleted: int = 0,
    retention_days: Optional[int] = None,
    error: Optional[str] = None,
    duration_ms: Optional[int] = None,
    skipped_reason: Optional[str] = None,
) -> None:
    """Append a single cleanup run to ``db.social_uploads_cleanup_runs`` so
    admins can review the scheduler's behaviour over time. ``status`` is one
    of ``ok`` / ``error`` / ``skipped``. Older entries beyond
    ``UPLOADS_CLEANUP_RUNS_KEEP`` are pruned to keep the collection bounded.
    Failures are swallowed (and logged) so logging never breaks cleanup."""
    try:
        snippet = (error or "").strip()
        if len(snippet) > 500:
            snippet = snippet[:500] + "…"
        doc = {
            "id": str(uuid.uuid4()),
            "ts": datetime.now(timezone.utc).isoformat(),
            "status": status,
            "source": source,
            "deleted": int(deleted or 0),
            "retention_days": retention_days,
            "error": snippet or None,
            "duration_ms": duration_ms,
            "skipped_reason": skipped_reason,
        }
        await db.social_uploads_cleanup_runs.insert_one(doc)
    except Exception:
        logger.exception("Failed to record uploads cleanup run history entry")
        return
    # Prune older entries beyond the retention cap.
    try:
        total = await db.social_uploads_cleanup_runs.count_documents({})
        if total > UPLOADS_CLEANUP_RUNS_KEEP:
            excess = total - UPLOADS_CLEANUP_RUNS_KEEP
            cursor = db.social_uploads_cleanup_runs.find(
                {}, {"_id": 1}
            ).sort("ts", 1).limit(excess)
            old_ids = [d["_id"] async for d in cursor]
            if old_ids:
                await db.social_uploads_cleanup_runs.delete_many(
                    {"_id": {"$in": old_ids}}
                )
    except Exception:
        logger.exception("Failed to prune uploads cleanup run history")


async def _get_uploads_cleanup_interval_seconds() -> int:
    """Return the admin-configured cleanup interval (in seconds), falling back
    to UPLOADS_CLEANUP_INTERVAL_SECONDS. Out-of-range / corrupt values are
    clamped so a bad setting can't disable the scheduler entirely."""
    try:
        doc = await db.social_settings.find_one(
            {"key": "uploads_cleanup"}, {"_id": 0, "interval_seconds": 1},
        )
    except Exception:
        logger.exception("Failed to read uploads cleanup interval setting")
        return UPLOADS_CLEANUP_INTERVAL_SECONDS
    if not doc or doc.get("interval_seconds") is None:
        return UPLOADS_CLEANUP_INTERVAL_SECONDS
    try:
        iv = int(doc["interval_seconds"])
    except (TypeError, ValueError):
        return UPLOADS_CLEANUP_INTERVAL_SECONDS
    if iv < UPLOADS_CLEANUP_INTERVAL_MIN_SECONDS:
        return UPLOADS_CLEANUP_INTERVAL_MIN_SECONDS
    if iv > UPLOADS_CLEANUP_INTERVAL_MAX_SECONDS:
        return UPLOADS_CLEANUP_INTERVAL_MAX_SECONDS
    return iv


async def _get_uploads_cleanup_enabled() -> bool:
    """Return whether the scheduled uploads cleanup loop should run a tick.
    Defaults to True when no admin override exists so existing installs keep
    cleaning up automatically. Read errors also default to enabled so a
    transient DB failure can't silently disable the safety net."""
    try:
        doc = await db.social_settings.find_one(
            {"key": "uploads_cleanup"}, {"_id": 0, "enabled": 1},
        )
    except Exception:
        logger.exception("Failed to read uploads cleanup enabled setting")
        return True
    if not doc or doc.get("enabled") is None:
        return True
    return bool(doc.get("enabled"))


async def _get_uploads_retention_days() -> int:
    """Return the admin-configured retention window in days, falling back to
    UPLOADS_RETENTION_DAYS when nothing is stored. Values outside the allowed
    bounds are clamped so a stale/corrupt setting can't disable cleanup."""
    try:
        doc = await db.social_settings.find_one(
            {"key": "uploads_cleanup"}, {"_id": 0, "retention_days": 1},
        )
    except Exception:
        logger.exception("Failed to read uploads retention setting")
        return UPLOADS_RETENTION_DAYS
    if not doc or doc.get("retention_days") is None:
        return UPLOADS_RETENTION_DAYS
    try:
        rd = int(doc["retention_days"])
    except (TypeError, ValueError):
        return UPLOADS_RETENTION_DAYS
    if rd < UPLOADS_RETENTION_MIN_DAYS:
        return UPLOADS_RETENTION_MIN_DAYS
    if rd > UPLOADS_RETENTION_MAX_DAYS:
        return UPLOADS_RETENTION_MAX_DAYS
    return rd


async def _collect_recent_post_filenames(max_age_days: int) -> set:
    """Return the set of filenames referenced by social posts created within
    the last ``max_age_days``. Only these get protected from cleanup — files
    tied to older posts are treated as expired temp artifacts (the platforms
    have long since fetched them) and become eligible for deletion."""
    cutoff_iso = (
        datetime.now(timezone.utc) - timedelta(days=max_age_days)
    ).isoformat()
    referenced: set = set()
    cursor = db.social_posts.find(
        {"created_at": {"$gte": cutoff_iso}},
        {"_id": 0, "media_filename": 1, "cropped_filename": 1, "video_edits": 1},
    )
    async for post in cursor:
        for key in ("media_filename", "cropped_filename"):
            name = post.get(key)
            if isinstance(name, str) and name:
                referenced.add(name)
        edits = post.get("video_edits") or {}
        logo = edits.get("logo") if isinstance(edits, dict) else None
        if isinstance(logo, dict):
            logo_name = logo.get("filename")
            if isinstance(logo_name, str) and logo_name:
                referenced.add(logo_name)
    return referenced


async def _cleanup_social_uploads_once(
    max_age_days: int = UPLOADS_RETENTION_DAYS,
    *,
    source: str = "manual",
) -> int:
    """Delete files in SOCIAL_UPLOAD_DIR older than ``max_age_days`` that
    aren't tied to a recent post. Files linked to posts created within the
    retention window are kept so platforms that fetch the URL asynchronously
    (Meta, TikTok) still find them. Older files — even those referenced by
    older post records — are treated as expired and removed; the post row
    itself stays in the database, just with a dead asset URL."""
    started_at = datetime.now(timezone.utc)
    if not SOCIAL_UPLOAD_DIR.exists():
        await _record_cleanup_run(
            status="ok",
            source=source,
            deleted=0,
            retention_days=max_age_days,
            duration_ms=0,
        )
        return 0
    cutoff_ts = started_at.timestamp() - max_age_days * 86400
    recent_referenced = await _collect_recent_post_filenames(max_age_days)
    deleted = 0
    deleted_old_linked = 0
    kept_recent_post_linked = 0
    kept_recent = 0
    for entry in SOCIAL_UPLOAD_DIR.iterdir():
        try:
            # Skip symlinks so the dry-run preview and the real cleanup
            # agree on what's eligible (preview also skips symlinks).
            if not entry.is_file() or entry.is_symlink():
                continue
            if entry.name in recent_referenced:
                kept_recent_post_linked += 1
                continue
            try:
                mtime = entry.stat().st_mtime
            except OSError:
                continue
            if mtime > cutoff_ts:
                kept_recent += 1
                continue
            # Track separately whether the deleted file was linked to an
            # older post for operational visibility.
            was_linked_to_old_post = False
            try:
                if await db.social_posts.find_one(
                    {"$or": [
                        {"media_filename": entry.name},
                        {"cropped_filename": entry.name},
                        {"video_edits.logo.filename": entry.name},
                    ]},
                    {"_id": 1},
                ):
                    was_linked_to_old_post = True
            except Exception:
                logger.exception("Failed to check post linkage for %s", entry.name)
            entry.unlink()
            deleted += 1
            if was_linked_to_old_post:
                deleted_old_linked += 1
        except OSError:
            logger.exception("Failed to delete old social upload %s", entry)
    logger.info(
        "Social uploads cleanup: deleted=%d (of which old-post-linked=%d), "
        "kept_recent_post_linked=%d, kept_recent=%d (retention=%d days)",
        deleted, deleted_old_linked, kept_recent_post_linked, kept_recent, max_age_days,
    )
    try:
        await db.social_settings.update_one(
            {"key": "uploads_cleanup"},
            {"$set": {
                "key": "uploads_cleanup",
                "last_run_at": datetime.now(timezone.utc).isoformat(),
                "last_run_deleted": deleted,
                "last_run_status": "ok",
                "last_run_error": None,
                "last_run_retention_days": max_age_days,
                # Clear alert dedup tracking so the next failure (after a
                # successful run) reliably notifies admins again.
                "last_alert_error": None,
                "last_alert_at": None,
            }},
            upsert=True,
        )
    except Exception:
        logger.exception("Failed to record uploads cleanup last-run metadata")
    duration_ms = int(
        (datetime.now(timezone.utc) - started_at).total_seconds() * 1000
    )
    await _record_cleanup_run(
        status="ok",
        source=source,
        deleted=deleted,
        retention_days=max_age_days,
        duration_ms=duration_ms,
    )
    return deleted


async def _notify_admins_cleanup_failed(error_message: str) -> None:
    """Insert an in-app notification for admins describing a cleanup failure.

    The notification is written to ``db.notifications`` so it surfaces in the
    existing admin notification bell (admins receive notifications without a
    branch filter — see ``get_notifications``)."""
    try:
        snippet = (error_message or "").strip()
        if len(snippet) > 400:
            snippet = snippet[:400] + "…"
        notification_doc = {
            "id": str(uuid.uuid4()),
            "type": "social_cleanup_failed",
            "notification_type": "social_cleanup_failed",
            "title": "فشل التشغيل التلقائي لتنظيف الملفات",
            "message": (
                "تعذّر إكمال آخر تشغيل تلقائي لمهمة تنظيف ملفات النشر الاجتماعي. "
                f"السبب: {snippet}" if snippet else
                "تعذّر إكمال آخر تشغيل تلقائي لمهمة تنظيف ملفات النشر الاجتماعي."
            ),
            "action_url": "/admin/social-publisher",
            "is_read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.notifications.insert_one(notification_doc)
    except Exception:
        logger.exception("Failed to insert cleanup-failure admin notification")


async def _record_cleanup_failure(
    error_message: str, retention_days: int, *, source: str
) -> None:
    """Record a cleanup failure in ``social_settings`` and notify admins.

    To avoid alert spam, a notification is only emitted when this is a *new*
    failure — i.e. when the previous run was not in the same error state with
    the same error message. Successful runs reset the dedup tracking (see
    ``_cleanup_social_uploads_once``)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        prev = await db.social_settings.find_one(
            {"key": "uploads_cleanup"}, {"_id": 0}
        ) or {}
    except Exception:
        logger.exception("Failed to read previous uploads cleanup meta")
        prev = {}

    already_alerted = (
        prev.get("last_run_status") == "error"
        and prev.get("last_alert_error") == error_message
        and prev.get("last_alert_at")
    )

    update_set: Dict[str, Any] = {
        "key": "uploads_cleanup",
        "last_run_at": now_iso,
        "last_run_status": "error",
        "last_run_error": error_message,
        "last_run_retention_days": retention_days,
        "last_run_source": source,
    }
    # Only scheduled runs participate in alert dedup tracking — manual
    # failures shouldn't be able to suppress a later scheduled alert
    # carrying the same error message.
    if source == "scheduled" and not already_alerted:
        update_set["last_alert_error"] = error_message
        update_set["last_alert_at"] = now_iso

    try:
        await db.social_settings.update_one(
            {"key": "uploads_cleanup"},
            {"$set": update_set},
            upsert=True,
        )
    except Exception:
        logger.exception("Failed to record uploads cleanup failure")

    # Append the failure to the run-history collection regardless of source so
    # admins can review every failed attempt later.
    await _record_cleanup_run(
        status="error",
        source=source,
        deleted=0,
        retention_days=retention_days,
        error=error_message,
    )

    # Only the automatic (scheduled) runs raise an admin alert — manual
    # runs already surface the error to the admin who triggered them via
    # the HTTP response, so re-notifying would be noisy and could also
    # suppress a later identical scheduled-failure alert via dedup.
    if source != "scheduled":
        return
    if not already_alerted:
        await _notify_admins_cleanup_failed(error_message)
    else:
        logger.info(
            "Skipping duplicate cleanup-failure notification (same error as last run)"
        )


async def _uploads_cleanup_loop():
    logger.info(
        "Social uploads cleanup scheduler started (default retention=%d days, default interval=%ds)",
        UPLOADS_RETENTION_DAYS, UPLOADS_CLEANUP_INTERVAL_SECONDS,
    )
    # Stagger first run so it doesn't compete with startup work.
    await asyncio.sleep(300)
    while True:
        try:
            enabled = await _get_uploads_cleanup_enabled()
            if enabled:
                retention = await _get_uploads_retention_days()
                try:
                    await _cleanup_social_uploads_once(
                        retention, source="scheduled"
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.exception("Scheduled uploads cleanup failed")
                    try:
                        await _record_cleanup_failure(
                            str(e), retention, source="scheduled"
                        )
                    except Exception:
                        logger.exception(
                            "Failed to record scheduled cleanup failure"
                        )
            else:
                logger.info("Social uploads cleanup tick skipped (disabled by admin)")
                try:
                    await _record_cleanup_run(
                        status="skipped",
                        source="scheduled",
                        skipped_reason="disabled_by_admin",
                    )
                except Exception:
                    logger.exception(
                        "Failed to record skipped cleanup tick"
                    )
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Social uploads cleanup tick failed")
        # Read interval each tick so admin changes take effect on the next
        # sleep without requiring a server restart.
        try:
            interval = await _get_uploads_cleanup_interval_seconds()
        except Exception:
            logger.exception("Failed to read uploads cleanup interval; using default")
            interval = UPLOADS_CLEANUP_INTERVAL_SECONDS
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            break


def start_uploads_cleanup_scheduler() -> None:
    """Start the uploads cleanup loop once. Safe to call multiple times."""
    global _uploads_cleanup_started
    if _uploads_cleanup_started:
        return
    _uploads_cleanup_started = True
    asyncio.ensure_future(_uploads_cleanup_loop())


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
