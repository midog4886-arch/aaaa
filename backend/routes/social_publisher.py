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


# ────────────────── Publishing ──────────────────

class PublishTarget(BaseModel):
    platform: str
    caption_override: Optional[str] = None


class VideoCrop(BaseModel):
    x: int
    y: int
    width: int
    height: int


class PublishRequest(BaseModel):
    media_filename: str
    caption: str = ""
    targets: List[PublishTarget]
    video_crop: Optional[VideoCrop] = None


async def _ffmpeg_crop_video(src: Path, crop: VideoCrop) -> Path:
    """Run ffmpeg to crop a video; returns the path of the cropped output.

    Raises HTTPException(500) on failure. Caller is responsible for unlinking
    the output file once done.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(status_code=500, detail="ffmpeg غير مثبت على الخادم.")
    if crop.width <= 0 or crop.height <= 0:
        raise HTTPException(status_code=400, detail="أبعاد القص غير صالحة.")
    out_path = src.with_name(f"{src.stem}-cropped-{uuid.uuid4().hex[:8]}{src.suffix}")
    # Use even-aligned dimensions: most codecs require width/height divisible by 2.
    w = max(2, crop.width - (crop.width % 2))
    h = max(2, crop.height - (crop.height % 2))
    x = max(0, crop.x)
    y = max(0, crop.y)
    filter_expr = f"crop={w}:{h}:{x}:{y}"
    try:
        proc = await asyncio.create_subprocess_exec(
            ffmpeg, "-y", "-i", str(src), "-vf", filter_expr,
            "-c:a", "copy", "-preset", "veryfast", "-movflags", "+faststart",
            str(out_path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        if proc.returncode != 0:
            logger.warning("ffmpeg crop failed: %s", (stderr or b"")[-400:].decode(errors="ignore"))
            out_path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail="فشل قص الفيديو.")
    except HTTPException:
        raise
    except Exception:
        logger.exception("ffmpeg crop crashed")
        out_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="تعذر تنفيذ قص الفيديو.")
    return out_path


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
        if payload.video_crop is not None:
            cropped_temp = await _ffmpeg_crop_video(media_path, payload.video_crop)
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
}
# Sane bounds the UI can write — keeps users from accidentally hammering
# the platforms or starving the loop.
AUTO_REFRESH_MIN_INTERVAL = 15
AUTO_REFRESH_MAX_INTERVAL = 24 * 60
AUTO_REFRESH_MIN_LOOKBACK = 1
AUTO_REFRESH_MAX_LOOKBACK = 365
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
    }


class InsightsSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    interval_minutes: Optional[int] = None
    lookback_days: Optional[int] = None


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
    await db.social_settings.update_one(
        {"key": "auto_refresh_insights"},
        {"$set": {**current, "key": "auto_refresh_insights",
                  "updated_at": datetime.now(timezone.utc).isoformat(),
                  "updated_by": current_user.get("user_id") or current_user.get("id")}},
        upsert=True,
    )
    return current


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


_insights_scheduler_started = False


async def _insights_scheduler_loop():
    """Background loop that periodically refreshes insights for recent posts.

    Sleeps in short ticks so the interval/enabled toggle takes effect quickly
    after the user changes it, without restarting the server.
    """
    logger.info("Auto-refresh insights scheduler started")
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
            await db.social_settings.update_one(
                {"key": "auto_refresh_insights"},
                {"$set": {
                    "last_run_at": datetime.now(timezone.utc).isoformat(),
                    "last_run_status": status,
                    "last_run_refreshed": summary.get("targets", 0),
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
