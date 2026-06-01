"""
Push Notifications API - نظام إشعارات Push
Web Push + Firebase Cloud Messaging for Android
"""
from fastapi import APIRouter, HTTPException, Depends

from .common import get_current_user
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import uuid
import os
import json
from pywebpush import webpush, WebPushException

router = APIRouter(prefix="/push-notifications", tags=["push-notifications"])

# Use centralized database connection
from database import db

VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', 'BLBx-hf2WrL2qEa0qKb-aCJbcxEvyn62GDTyyP9KTS5K7ZL0K7TfmOKSPqp8vQF0DaG8hgSFYHdBYq_VuaJSbxQ')
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', 'BQv3sSRJtUCFQiEZ6z9IXPKHFuJ6E9d0cL0pFQxXVgM')
VAPID_CLAIMS = {
    "sub": "mailto:admin@globalchampions.sa"
}

_firebase_initialized = False

def _init_firebase():
    global _firebase_initialized
    if _firebase_initialized:
        return True
    try:
        import firebase_admin
        from firebase_admin import credentials

        # Check if already initialized by another route/module
        try:
            firebase_admin.get_app()
            _firebase_initialized = True
            return True
        except ValueError:
            pass  # Not yet initialized

        firebase_creds = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
        if firebase_creds:
            cred_dict = json.loads(firebase_creds)
            cred = credentials.Certificate(cred_dict)
            try:
                firebase_admin.initialize_app(cred)
            except ValueError:
                pass  # Already initialized between our check and initialize
            _firebase_initialized = True
            print("Firebase Admin SDK initialized successfully")
            return True

        cred_path = os.path.join(os.path.dirname(__file__), '..', 'firebase-service-account.json')
        if os.path.exists(cred_path):
            cred = credentials.Certificate(cred_path)
            try:
                firebase_admin.initialize_app(cred)
            except ValueError:
                pass
            _firebase_initialized = True
            print("Firebase Admin SDK initialized from file")
            return True

        print("Firebase credentials not found - FCM notifications disabled")
        return False
    except Exception as e:
        print(f"Firebase initialization error: {e}")
        return False


class PushSubscription(BaseModel):
    endpoint: str
    keys: dict


class SubscriptionCreate(BaseModel):
    member_id: str
    subscription: PushSubscription
    language: Optional[str] = None  # 'ar' or 'en' — recipient's chosen UI language


class NotificationPayload(BaseModel):
    title: str
    body: str
    icon: Optional[str] = "/logo-new.png"
    badge: Optional[str] = "/images/icon-72x72.png"
    image: Optional[str] = None
    url: Optional[str] = "/portal/daily-videos"
    tag: Optional[str] = None
    data: Optional[dict] = None
    # Optional English variants. When the recipient's saved language is 'en'
    # and these are populated, send_push_notification swaps them in for the
    # default (Arabic) ``title``/``body``. Falls back to Arabic when missing.
    title_en: Optional[str] = None
    body_en: Optional[str] = None


def _public_base_url() -> str:
    """Resolve the app's public https origin for push-notification icon/image URLs.

    Push services — FCM's image CDN especially — fetch the logo URL themselves
    and CANNOT resolve a relative path, so the URL must be absolute. Pushes are
    almost always sent from background tasks with NO incoming request to read the
    host from, so we resolve the origin from environment variables in priority
    order rather than depending on a single manually-set variable:

      1. ``REACT_APP_BACKEND_URL`` — explicit override (kept first for back-compat)
      2. ``PUBLIC_BASE_URL``       — generic public-origin override used elsewhere
      3. ``REPLIT_DOMAINS``        — Replit-provided deployment domain (first entry)

    ``REPLIT_DOMAINS`` is always present on a Replit deployment, so branding no
    longer silently degrades just because ``REACT_APP_BACKEND_URL`` wasn't set
    by hand. Returns "" only when none resolve, leaving the caller to fall back
    to a relative URL (web push) or to drop the image (FCM).
    """
    for var in ("REACT_APP_BACKEND_URL", "PUBLIC_BASE_URL"):
        val = (os.environ.get(var, "") or "").strip().rstrip("/")
        if val:
            return val
    domain = (os.environ.get("REPLIT_DOMAINS", "") or "").split(",")[0].strip()
    if domain:
        return f"https://{domain.rstrip('/')}"
    return ""


def _tenant_logo_url(tenant_slug: Optional[str]) -> str:
    """Build the URL for an academy's web-push notification icon/badge.

    Points at the public ``/api/tenant/branding/logo`` endpoint with the
    academy ``slug`` in the query string (the browser fetches the icon without
    the X-Tenant-Slug header, so the academy must travel in the URL). Returns an
    absolute URL whenever a public base origin can be resolved (see
    ``_public_base_url``) so push services that can't resolve relative URLs still
    load the right logo; otherwise falls back to a root-relative URL that the
    service worker resolves against its own (single, fixed) origin. Returns ""
    only when no slug is available, leaving the caller's default icon in place.
    """
    slug = (tenant_slug or "").strip().lower()
    if not slug:
        return ""
    base = _public_base_url()
    path = f"/api/tenant/branding/logo?slug={slug}"
    return f"{base}{path}" if base else path


def _normalize_language(lang: Optional[str]) -> str:
    """Normalize a language code to the 'ar'/'en' set used across the app.

    Anything we don't recognise (including ``None``) falls back to Arabic so
    existing subscribers keep receiving Arabic pushes — Arabic is the product's
    default language and the safest choice when the preference is unknown.
    """
    if not lang:
        return "ar"
    code = str(lang).strip().lower()
    if code.startswith("en"):
        return "en"
    return "ar"


def _localize_payload(payload: NotificationPayload, language: Optional[str]) -> NotificationPayload:
    """Return a copy of ``payload`` with title/body swapped to the requested
    language when an English variant is available. Always returns a new
    payload so the caller's object is not mutated (it may be reused across
    many subscriptions with different language preferences)."""
    lang = _normalize_language(language)
    if lang != "en":
        # Arabic / unknown — keep payload as-is (defaults are Arabic).
        return payload.copy()
    title = payload.title_en or payload.title
    body = payload.body_en or payload.body
    return payload.copy(update={"title": title, "body": body})


@router.get("/vapid-public-key")
async def get_vapid_public_key():
    return {"publicKey": VAPID_PUBLIC_KEY}


async def _deactivate_endpoint_in_other_tenants(
    endpoint: str,
    fcm_token: str,
    is_fcm: bool,
):
    """Deactivate this browser/device's push endpoint in EVERY other academy's DB.

    A browser's web-push endpoint (and a device's FCM token) is tied to the
    browser/app install, not to whoever is logged in. On a SHARED device a
    member of academy B may subscribe (endpoint stored + active in academy B's
    DB), then later an academy A member logs in on the same browser and
    subscribes — the endpoint then also lives in academy A's DB but stays
    ``is_active`` in academy B's DB too, so academy B can keep pushing to a
    browser that now belongs to academy A: a real cross-tenant leak.

    Whenever a subscription is (re)claimed under the current academy we walk
    every OTHER active tenant and flip any matching endpoint/token to
    ``is_active: False`` so only the current academy can push to it. The current
    tenant's own row is left untouched (it was just (re)activated by the
    caller). Best-effort: per-tenant failures are logged and skipped so a single
    bad tenant DB never breaks the subscribe call.
    """
    import logging
    logger = logging.getLogger(__name__)

    from utils.tenant import (
        get_current_tenant_slug,
        list_active_tenants,
        set_current_tenant,
        reset_current_tenant,
    )

    current_slug = (get_current_tenant_slug() or "").strip().lower()

    if is_fcm and fcm_token:
        match = {
            "$or": [
                {"endpoint": endpoint},
                {"keys.fcm_token": fcm_token, "platform": {"$in": ["android", "ios"]}},
            ]
        }
    else:
        match = {"endpoint": endpoint}

    try:
        tenants = await list_active_tenants()
    except Exception as exc:
        logger.error(f"_deactivate_endpoint_in_other_tenants: list tenants failed: {exc}")
        return

    for tenant in tenants:
        slug = (tenant.get("slug") or "").strip().lower()
        if not slug or slug == current_slug:
            continue
        token = set_current_tenant(tenant)
        try:
            await db.push_subscriptions.update_many(
                {**match, "is_active": True},
                {"$set": {
                    "is_active": False,
                    "deactivated_reason": "claimed_by_other_academy",
                    "deactivated_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
        except Exception as exc:
            logger.error(
                f"_deactivate_endpoint_in_other_tenants: tenant={slug} failed: {exc}"
            )
        finally:
            reset_current_tenant(token)


def _parse_sub_ts(sub: dict) -> str:
    """Return a sortable timestamp string for a subscription row.

    Prefers ``updated_at`` (set whenever the row is (re)claimed) and falls back
    to ``created_at`` for legacy rows that were never updated. The stored values
    are ISO-8601 UTC strings (``datetime.now(timezone.utc).isoformat()``), which
    sort correctly lexicographically, so we compare the raw strings — no parsing
    needed and unknown/missing values sort oldest (empty string)."""
    return str(sub.get("updated_at") or sub.get("created_at") or "")


async def cleanup_superseded_subscriptions() -> dict:
    """Deactivate cross-tenant duplicate push subscriptions left on shared devices.

    A browser web-push endpoint (and a device FCM token) is tied to the
    browser/app install, not to whoever is logged in. On a SHARED device,
    member of academy B subscribes (row active in B's DB), then later an academy
    A member subscribes on the same browser (row active in A's DB). The inline
    dedup in ``subscribe_to_push`` deactivates B's row AT THAT MOMENT, but if the
    academy B member never returns to re-claim the endpoint, an old active row in
    some other tenant can linger forever as a dead/duplicate that wastes send
    attempts.

    This sweep walks every active tenant, groups all ``is_active`` subscriptions
    by the device identity (FCM token for android/ios, endpoint for web), and
    keeps only the most-recently-updated row active per device — deactivating the
    older duplicates in their own tenant DBs. It complements (does not replace)
    the inline 404/410/UNREGISTERED deactivation, which only fires when a send
    actually errors.

    Returns a summary dict suitable for logging / status display. Best-effort:
    per-tenant failures are logged and skipped so one bad DB never aborts the
    whole sweep.
    """
    import logging
    logger = logging.getLogger(__name__)

    from utils.tenant import (
        list_active_tenants,
        set_current_tenant,
        reset_current_tenant,
    )

    summary = {
        "tenants_scanned": 0,
        "active_subscriptions": 0,
        "duplicate_devices": 0,
        "deactivated": 0,
        "errors": [],
    }

    try:
        tenants = await list_active_tenants()
    except Exception as exc:
        logger.error(f"cleanup_superseded_subscriptions: list tenants failed: {exc}")
        summary["errors"].append(f"list tenants failed: {exc}")
        return summary

    # device key -> list of {slug, tenant, id, ts}
    groups: dict = {}

    for tenant in tenants:
        slug = (tenant.get("slug") or "").strip().lower()
        if not slug:
            continue
        summary["tenants_scanned"] += 1
        token = set_current_tenant(tenant)
        try:
            cursor = db.push_subscriptions.find(
                {"is_active": True},
                {"_id": 0, "id": 1, "endpoint": 1, "keys": 1, "platform": 1,
                 "updated_at": 1, "created_at": 1},
            )
            async for sub in cursor:
                summary["active_subscriptions"] += 1
                platform = sub.get("platform", "web")
                fcm_token = (sub.get("keys") or {}).get("fcm_token", "")
                if platform in ("android", "ios") and fcm_token:
                    key = ("fcm", fcm_token)
                else:
                    key = ("web", sub.get("endpoint", ""))
                if not key[1]:
                    continue
                groups.setdefault(key, []).append({
                    "slug": slug,
                    "tenant": tenant,
                    "id": sub.get("id"),
                    "endpoint": sub.get("endpoint", ""),
                    "ts": _parse_sub_ts(sub),
                })
        except Exception as exc:
            logger.error(f"cleanup_superseded_subscriptions: scan tenant={slug} failed: {exc}")
            summary["errors"].append(f"[{slug}] scan failed: {exc}")
        finally:
            reset_current_tenant(token)

    # For each device seen active in more than one tenant, keep the newest row
    # active and deactivate the rest in their own tenant DB.
    now_iso = datetime.now(timezone.utc).isoformat()
    for key, rows in groups.items():
        slugs = {r["slug"] for r in rows}
        if len(slugs) < 2:
            # Only one tenant holds this device active — nothing superseded.
            continue
        summary["duplicate_devices"] += 1
        # Newest first (lexicographic ISO compare). Ties keep an arbitrary but
        # stable winner; the losers are still safe to deactivate because the
        # device can only belong to one academy at a time anyway.
        rows.sort(key=lambda r: r["ts"], reverse=True)
        winner = rows[0]
        for loser in rows[1:]:
            if loser["slug"] == winner["slug"]:
                # Same tenant as the winner — leave its (own) active row alone.
                continue
            token = set_current_tenant(loser["tenant"])
            try:
                match = {"is_active": True}
                if loser.get("id"):
                    match["id"] = loser["id"]
                elif loser.get("endpoint"):
                    match["endpoint"] = loser["endpoint"]
                else:
                    continue
                res = await db.push_subscriptions.update_one(
                    match,
                    {"$set": {
                        "is_active": False,
                        "deactivated_reason": "superseded_cross_tenant",
                        "deactivated_at": now_iso,
                        "updated_at": now_iso,
                    }},
                )
                summary["deactivated"] += int(getattr(res, "modified_count", 0) or 0)
            except Exception as exc:
                logger.error(
                    f"cleanup_superseded_subscriptions: deactivate "
                    f"tenant={loser['slug']} failed: {exc}"
                )
                summary["errors"].append(f"[{loser['slug']}] deactivate failed: {exc}")
            finally:
                reset_current_tenant(token)

    logger.info(
        "cleanup_superseded_subscriptions: scanned=%s active=%s dup_devices=%s deactivated=%s errors=%s",
        summary["tenants_scanned"], summary["active_subscriptions"],
        summary["duplicate_devices"], summary["deactivated"], len(summary["errors"]),
    )
    return summary


@router.post("/cleanup-superseded")
async def cleanup_superseded(current_user: dict = Depends(get_current_user)):
    """Admin-only: trigger the cross-tenant push-subscription cleanup on demand.

    Deactivates stale duplicate sign-ups left on shared browsers/devices where
    the same endpoint/FCM token is active under a more-recently-updated row in
    another academy. Safe to run repeatedly — already-deactivated rows are
    skipped. Returns the sweep summary.
    """
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return await cleanup_superseded_subscriptions()


# Default retention window (in days) for permanently deleting subscriptions that
# have been deactivated (``is_active: False``). Overridable via env so an
# academy can tune how long dead rows linger before being pruned.
DEFAULT_INACTIVE_RETENTION_DAYS = 90


def _inactive_retention_days(override: Optional[int] = None) -> int:
    """Resolve the retention window for pruning inactive subscriptions.

    Order of precedence: explicit ``override`` arg > ``PUSH_SUBSCRIPTION_RETENTION_DAYS``
    env var > ``DEFAULT_INACTIVE_RETENTION_DAYS``. Always at least 1 day so a
    misconfiguration can never delete rows that were just deactivated.
    """
    if override is not None:
        try:
            return max(1, int(override))
        except (TypeError, ValueError):
            pass
    raw = os.environ.get("PUSH_SUBSCRIPTION_RETENTION_DAYS")
    if raw:
        try:
            return max(1, int(raw))
        except (TypeError, ValueError):
            pass
    return DEFAULT_INACTIVE_RETENTION_DAYS


def _inactive_sub_age_ts(sub: dict) -> str:
    """Return the timestamp used to judge how long a row has been inactive.

    Prefers ``deactivated_at`` (set whenever a row is flipped inactive), falling
    back to ``updated_at`` then ``created_at`` for legacy rows that predate the
    ``deactivated_at`` field. Values are ISO-8601 UTC strings that sort/compare
    correctly lexicographically (same format + ``+00:00`` offset everywhere),
    so we compare the raw strings — no parsing needed. Missing values return an
    empty string so such rows are treated as un-judgeable and skipped.
    """
    return str(
        sub.get("deactivated_at")
        or sub.get("updated_at")
        or sub.get("created_at")
        or ""
    )


async def prune_inactive_subscriptions(retention_days: Optional[int] = None) -> dict:
    """Permanently delete push subscriptions inactive for longer than the window.

    The cross-tenant cleanup only flips duplicate/stale sign-ups to
    ``is_active: False`` (with a ``deactivated_reason``); it never deletes them,
    so the ``push_subscriptions`` collection grows with dead rows over time. This
    sweep walks every active tenant (via ``for_each_active_tenant``) and
    permanently removes rows that have been inactive for longer than the
    retention window (default ~90 days), judging age from ``deactivated_at`` /
    ``updated_at`` / ``created_at``.

    Best-effort: per-tenant failures are isolated and logged so one bad DB never
    aborts the whole sweep. Rows with no usable timestamp are left untouched
    (we can't prove they're old). Returns a summary suitable for logging.
    """
    import logging
    logger = logging.getLogger(__name__)

    from utils.tenant import for_each_active_tenant

    days = _inactive_retention_days(retention_days)
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    async def _prune_one_tenant(tenant: dict) -> dict:
        scanned = 0
        delete_ids: list = []
        cursor = db.push_subscriptions.find(
            {"is_active": False},
            {"_id": 0, "id": 1, "deactivated_at": 1, "updated_at": 1, "created_at": 1},
        )
        async for sub in cursor:
            scanned += 1
            ts = _inactive_sub_age_ts(sub)
            if not ts or ts >= cutoff_iso:
                continue
            sid = sub.get("id")
            if sid:
                delete_ids.append(sid)
        deleted = 0
        if delete_ids:
            res = await db.push_subscriptions.delete_many(
                {"is_active": False, "id": {"$in": delete_ids}}
            )
            deleted = int(getattr(res, "deleted_count", 0) or 0)
        return {"scanned_inactive": scanned, "deleted": deleted}

    per_tenant = await for_each_active_tenant(_prune_one_tenant, label="push_prune")

    summary = {
        "retention_days": days,
        "cutoff": cutoff_iso,
        "tenants_processed": per_tenant.get("processed", 0),
        "tenants_failed": per_tenant.get("failed", 0),
        "scanned_inactive": 0,
        "deleted": 0,
        "errors": [],
    }
    for slug, res in (per_tenant.get("results") or {}).items():
        if isinstance(res, dict):
            summary["scanned_inactive"] += int(res.get("scanned_inactive", 0) or 0)
            summary["deleted"] += int(res.get("deleted", 0) or 0)
    for slug, err in (per_tenant.get("errors") or {}).items():
        summary["errors"].append(f"[{slug}] {err}")

    logger.info(
        "prune_inactive_subscriptions: retention_days=%s tenants=%s deleted=%s scanned=%s errors=%s",
        days, summary["tenants_processed"], summary["deleted"],
        summary["scanned_inactive"], len(summary["errors"]),
    )
    return summary


@router.post("/prune-inactive")
async def prune_inactive(
    retention_days: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
):
    """Admin-only: permanently delete push sign-ups inactive past the retention window.

    Removes ``push_subscriptions`` rows that have been ``is_active: False`` for
    longer than ``retention_days`` (defaults to the configured window, ~90 days),
    across every active academy. Safe to run repeatedly. Returns the sweep
    summary.
    """
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return await prune_inactive_subscriptions(retention_days)


@router.post("/subscribe")
async def subscribe_to_push(data: SubscriptionCreate):
    try:
        is_fcm = data.subscription.endpoint.startswith('fcm://')
        platform = data.subscription.keys.get('platform', 'web')
        
        # Persist the recipient's chosen UI language so push notifications
        # can be delivered in their preferred language. Defaults to Arabic
        # when not provided (matches the product default).
        sub_language = _normalize_language(data.language)
        subscription_data = {
            "id": str(uuid.uuid4()),
            "member_id": data.member_id,
            "endpoint": data.subscription.endpoint,
            "keys": data.subscription.keys,
            "platform": platform if is_fcm else "web",
            "language": sub_language,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "is_active": True
        }
        
        fcm_token = data.subscription.keys.get('fcm_token', '') if is_fcm else ''
        if is_fcm:
            existing = await db.push_subscriptions.find_one({
                "$or": [
                    {"endpoint": data.subscription.endpoint},
                    {"keys.fcm_token": fcm_token, "platform": {"$in": ["android", "ios"]}}
                ]
            })
        else:
            existing = await db.push_subscriptions.find_one({"endpoint": data.subscription.endpoint})
        
        if existing:
            await db.push_subscriptions.update_one(
                {"_id": existing["_id"]},
                {"$set": {
                    "member_id": data.member_id,
                    "endpoint": data.subscription.endpoint,
                    "keys": data.subscription.keys,
                    "platform": platform if is_fcm else "web",
                    "language": sub_language,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "is_active": True
                }}
            )
            status = "updated"
            message = "تم تحديث الاشتراك بنجاح"
        else:
            await db.push_subscriptions.insert_one(subscription_data)
            status = "created"
            message = "تم الاشتراك في الإشعارات بنجاح"

        # Now that this endpoint/token is (re)claimed for the CURRENT academy,
        # deactivate it in every OTHER academy's DB so a previously-used academy
        # on this same shared browser/device can no longer push to it. Wrapped so
        # a failure here never fails the (already-persisted) subscription.
        try:
            await _deactivate_endpoint_in_other_tenants(
                data.subscription.endpoint, fcm_token, is_fcm
            )
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error(
                f"subscribe_to_push: cross-tenant dedup failed: {exc}"
            )

        return {"message": message, "status": status}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل في حفظ الاشتراك: {str(e)}")


class LanguageUpdate(BaseModel):
    member_id: str
    language: str


@router.post("/language")
async def update_subscription_language(
    data: LanguageUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update the saved UI language for all of a member's active push
    subscriptions. The frontend calls this whenever the user toggles the
    language so subsequent pushes are delivered in the new language.

    Auth: only the owner of the subscription (matching ``member_id``) or an
    admin may update the language preference. This prevents one logged-in
    user from flipping someone else's push language as a prank or to hide
    alerts from them.
    """
    caller_id = current_user.get("id") or current_user.get("user_id") or current_user.get("member_id")
    if not (current_user.get("is_admin") or caller_id == data.member_id):
        raise HTTPException(status_code=403, detail="Not allowed to update this subscription")
    lang = _normalize_language(data.language)
    result = await db.push_subscriptions.update_many(
        {"member_id": data.member_id, "is_active": True},
        {"$set": {"language": lang, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"updated": result.modified_count, "language": lang}


@router.post("/unsubscribe")
async def unsubscribe_from_push(endpoint: str):
    result = await db.push_subscriptions.update_one(
        {"endpoint": endpoint},
        {"$set": {"is_active": False}}
    )
    
    if result.modified_count == 0:
        return {"message": "الاشتراك غير موجود", "status": "not_found"}
    
    return {"message": "تم إلغاء الاشتراك بنجاح", "status": "unsubscribed"}


@router.get("/subscription-status/{member_id}")
async def get_subscription_status(member_id: str):
    subscription = await db.push_subscriptions.find_one({
        "member_id": member_id,
        "is_active": True
    })
    
    return {
        "subscribed": subscription is not None,
        "endpoint": subscription.get("endpoint") if subscription else None,
        "platform": subscription.get("platform", "web") if subscription else None
    }


async def send_fcm_notification(token: str, payload: NotificationPayload):
    import logging
    logger = logging.getLogger(__name__)
    try:
        if not _init_firebase():
            logger.error("Firebase not initialized, skipping FCM notification")
            return False

        from firebase_admin import messaging

        # Resolve a per-academy logo URL so each academy's Android members see
        # their OWN logo in the notification instead of the single static
        # launcher icon baked into the APK. FCM's image service fetches the URL
        # itself (no X-Tenant-Slug header and no member session), so the academy
        # slug is embedded in the query string of the public branding-logo
        # endpoint. FCM can only fetch an ABSOLUTE https URL, so we only set the
        # image when _tenant_logo_url resolved one (an absolute origin is now
        # derived from REACT_APP_BACKEND_URL / PUBLIC_BASE_URL / REPLIT_DOMAINS,
        # so this works on any Replit deployment without a hand-set env var); a
        # relative URL is dropped so we degrade to the launcher icon rather than
        # send a broken image. An explicit payload.image (e.g. an announcement
        # banner) still wins. The endpoint itself falls back to the default
        # academy logo, so any absolute URL is always safe to send. The small
        # status-bar icon stays ic_launcher because it is APK-baked and cannot be
        # made per-tenant.
        from utils.tenant import get_current_tenant_slug
        tenant_slug = get_current_tenant_slug()
        logo_url = _tenant_logo_url(tenant_slug)
        image_url = payload.image or (logo_url if logo_url.startswith("http") else None)
        if logo_url and not logo_url.startswith("http") and not payload.image:
            # We have a tenant logo to show but no public base URL to make it
            # absolute, so FCM will drop it and the member sees the generic
            # launcher icon. Warn loudly so an operator can set a base URL env
            # var (REACT_APP_BACKEND_URL / PUBLIC_BASE_URL) to restore branding.
            logger.warning(
                "FCM push: tenant logo dropped (no public base URL resolved); "
                "set REACT_APP_BACKEND_URL or PUBLIC_BASE_URL to restore per-academy branding"
            )

        notif_kwargs = {"title": payload.title, "body": payload.body}
        if image_url:
            notif_kwargs["image"] = image_url

        message = messaging.Message(
            notification=messaging.Notification(**notif_kwargs),
            data={
                "url": payload.url or "/",
                "tag": payload.tag or "",
                "type": (payload.data or {}).get("type", "general"),
            },
            token=token,
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    icon="ic_launcher",
                    color="#1e40af",
                    sound="default",
                    channel_id="default",
                    image=image_url,
                ),
            ),
        )

        result = messaging.send(message)
        logger.info(f"FCM sent OK: {result}")
        return True

    except Exception as e:
        error_str = str(e)
        logger.error(f"FCM notification failed: {type(e).__name__}: {error_str}")
        if 'NOT_FOUND' in error_str or 'UNREGISTERED' in error_str or 'INVALID_ARGUMENT' in error_str:
            await db.push_subscriptions.update_one(
                {"keys.fcm_token": token},
                {"$set": {"is_active": False}}
            )
        return False


@router.get("/test-send")
async def test_send_notification():
    """Debug endpoint - test FCM send directly"""
    import logging
    logger = logging.getLogger(__name__)
    subs = await db.push_subscriptions.find(
        {"is_active": True, "platform": "android"}, {"_id": 0}
    ).to_list(10)
    if not subs:
        return {"error": "No active Android subscriptions found"}
    results = []
    for sub in subs:
        token = sub.get("keys", {}).get("fcm_token", "")
        payload = NotificationPayload(
            title="🔔 اختبار مباشر",
            body="اختبار إشعار مباشر من السيرفر",
            url="/",
            tag="debug-test"
        )
        try:
            ok = await send_fcm_notification(token, payload)
            results.append({"member": sub.get("member_id", "")[:8], "success": ok})
        except Exception as e:
            results.append({"member": sub.get("member_id", "")[:8], "error": str(e)})
    return {"results": results}


async def send_push_notification(subscription: dict, payload: NotificationPayload):
    platform = subscription.get("platform", "web")

    # Pick the right language variant based on the recipient's saved
    # preference (stored on the subscription doc when they subscribed).
    # Falls back to Arabic for unknown / legacy subscriptions.
    payload = _localize_payload(payload, subscription.get("language"))

    if platform in ["android", "ios"]:
        fcm_token = subscription.get("keys", {}).get("fcm_token")
        if fcm_token:
            return await send_fcm_notification(fcm_token, payload)
        return False
    
    try:
        # Stamp the recipient's academy (tenant) onto the web-push payload.
        # The browser service worker has no localStorage and is shared across
        # academies on a single fixed domain, so it cannot otherwise know which
        # academy a push belongs to. Including the slug lets the SW namespace
        # the notification tag per academy (so one academy's push can't replace
        # another's on a shared device) and gives any SW-side logic an
        # authoritative tenant for this notification. Routing itself is already
        # guaranteed because the subscription lives in this academy's DB.
        from utils.tenant import get_current_tenant_slug
        tenant_slug = get_current_tenant_slug()

        # Resolve a per-academy icon/badge so each academy's members see their
        # OWN logo in the notification instead of the single shared/default
        # logo baked into the build. The icon points at a tenant-scoped backend
        # endpoint (slug in the query string) because the browser fetches the
        # notification icon WITHOUT the X-Tenant-Slug header, so the academy
        # must be encoded in the URL itself. The endpoint falls back to the
        # default academy logo when the academy has no custom logo, so this is
        # always safe to send.
        icon_url = _tenant_logo_url(tenant_slug)
        notification_data = {
            "title": payload.title,
            "body": payload.body,
            "icon": icon_url or payload.icon,
            "badge": icon_url or payload.badge,
            "image": payload.image or None,
            "url": payload.url,
            "tenant": tenant_slug,
            "tag": payload.tag or str(uuid.uuid4()),
            "data": payload.data or {}
        }
        
        webpush(
            subscription_info={
                "endpoint": subscription["endpoint"],
                "keys": subscription["keys"]
            },
            data=json.dumps(notification_data),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS
        )
        return True
        
    except WebPushException as e:
        print(f"Push notification failed: {e}")
        if e.response and e.response.status_code in [404, 410]:
            await db.push_subscriptions.update_one(
                {"endpoint": subscription["endpoint"]},
                {"$set": {"is_active": False}}
            )
        return False


async def send_push_to_admins(payload: NotificationPayload, branch_id: Optional[str] = None) -> dict:
    """Send a push notification to every admin user (optionally restricted to
    one branch). Admin push subscriptions are stored in
    ``push_subscriptions`` keyed by ``member_id == user_id`` (the same channel
    the onboarding-welcome push uses), so we resolve admin user ids first and
    then fan out via ``send_push_notification`` so each recipient gets the
    payload in their saved language. Best-effort — failures are swallowed."""
    import logging
    logger = logging.getLogger(__name__)
    try:
        query = {"is_admin": True}
        if branch_id:
            # Branch-scoped: include admins explicitly assigned to the branch
            # plus global admins (no branch_id) so cross-branch admins still
            # receive the alert.
            query = {
                "is_admin": True,
                "$or": [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": ""}],
            }
        admins = await db.users.find(query, {"_id": 0, "id": 1}).to_list(500)
        admin_ids = [u["id"] for u in admins if u.get("id")]
        if not admin_ids:
            return {"total": 0, "success": 0, "failed": 0}
        subs = await db.push_subscriptions.find(
            {"member_id": {"$in": admin_ids}, "is_active": True}, {"_id": 0}
        ).to_list(2000)
        success_count = 0
        fail_count = 0
        for sub in subs:
            try:
                ok = await send_push_notification(sub, payload)
                if ok:
                    success_count += 1
                else:
                    fail_count += 1
            except Exception as exc:
                fail_count += 1
                logger.error(f"send_push_to_admins: push send failed: {exc}")
        return {"total": len(subs), "success": success_count, "failed": fail_count}
    except Exception as exc:
        logger.error(f"send_push_to_admins: pipeline error: {exc}")
        return {"total": 0, "success": 0, "failed": 0}


async def send_push_to_members(payload: NotificationPayload, member_ids: List[str]) -> dict:
    """Send a push notification to a specific list of member ids. Each
    recipient's saved language is honoured by ``send_push_notification``.
    Best-effort — failures are swallowed."""
    import logging
    logger = logging.getLogger(__name__)
    if not member_ids:
        return {"total": 0, "success": 0, "failed": 0}
    try:
        subs = await db.push_subscriptions.find(
            {"member_id": {"$in": list(member_ids)}, "is_active": True}, {"_id": 0}
        ).to_list(10000)
        success_count = 0
        fail_count = 0
        for sub in subs:
            try:
                ok = await send_push_notification(sub, payload)
                if ok:
                    success_count += 1
                else:
                    fail_count += 1
            except Exception as exc:
                fail_count += 1
                logger.error(f"send_push_to_members: push send failed: {exc}")
        return {"total": len(subs), "success": success_count, "failed": fail_count}
    except Exception as exc:
        logger.error(f"send_push_to_members: pipeline error: {exc}")
        return {"total": 0, "success": 0, "failed": 0}


async def send_notification_to_all_members(payload: NotificationPayload, branch_id: Optional[str] = None):
    query = {"is_active": True}
    
    if branch_id:
        members = await db.members.find(
            {"branch_id": branch_id}, 
            {"_id": 0, "id": 1}
        ).to_list(10000)
        member_ids = [m["id"] for m in members]
        query["member_id"] = {"$in": member_ids}
    
    subscriptions = await db.push_subscriptions.find(query, {"_id": 0}).to_list(10000)
    
    success_count = 0
    fail_count = 0
    
    for sub in subscriptions:
        result = await send_push_notification(sub, payload)
        if result:
            success_count += 1
        else:
            fail_count += 1
    
    return {
        "total": len(subscriptions),
        "success": success_count,
        "failed": fail_count
    }


async def notify_new_video(video_title: str, video_id: str, branch_id: Optional[str] = None, youtube_id: Optional[str] = None, activity_id: Optional[str] = None):
    from utils.i18n import t, get_member_languages_map
    thumbnail = f"https://img.youtube.com/vi/{youtube_id}/hqdefault.jpg" if youtube_id else None

    query = {"is_active": True}
    # Target only members the video concerns: enrolled in its activity AND
    # in its branch. A video without an activity falls back to branch-only.
    member_filter = {}
    if branch_id:
        member_filter["branch_id"] = branch_id
    if activity_id:
        member_filter["activities.activity_id"] = activity_id
    if member_filter:
        members = await db.members.find(
            member_filter,
            {"_id": 0, "id": 1}
        ).to_list(10000)
        query["member_id"] = {"$in": [m["id"] for m in members]}

    subscriptions = await db.push_subscriptions.find(query, {"_id": 0}).to_list(10000)
    if not subscriptions:
        return {"total": 0, "success": 0, "failed": 0}

    member_ids = {s.get("member_id") for s in subscriptions if s.get("member_id")}
    lang_map = await get_member_languages_map(db, member_ids)

    success_count = 0
    fail_count = 0
    payloads_by_lang = {}
    for sub in subscriptions:
        lang = lang_map.get(sub.get("member_id"), "ar")
        if lang not in payloads_by_lang:
            payloads_by_lang[lang] = NotificationPayload(
                title=t("new_video_title", lang),
                body=video_title,
                icon="/logo-new.png",
                image=thumbnail,
                url="/portal/daily-videos",
                tag=f"video-{video_id}",
                data={"video_id": video_id, "type": "new_video"}
            )
        ok = await send_push_notification(sub, payloads_by_lang[lang])
        if ok:
            success_count += 1
        else:
            fail_count += 1

    return {"total": len(subscriptions), "success": success_count, "failed": fail_count}


def get_notify_new_video_function():
    return notify_new_video


class BroadcastPayload(BaseModel):
    title: str
    body: str
    # Optional English variants. When provided, recipients whose saved
    # subscription language is 'en' receive the English copy; otherwise
    # they fall back to the Arabic title/body above.
    title_en: Optional[str] = None
    body_en: Optional[str] = None
    url: Optional[str] = "/"
    image: Optional[str] = None
    branch_id: Optional[str] = None
    member_ids: Optional[List[str]] = None
    activity_id: Optional[str] = None      # legacy / kept for compatibility
    activity_name: Optional[str] = None    # preferred: filter levels by activity_name
    level_id: Optional[str] = None


async def _resolve_activity_member_ids(
    activity_id: Optional[str],
    level_id: Optional[str],
    activity_name: Optional[str] = None,
) -> Optional[List[str]]:
    """Resolve activity / level targeting to a list of member_ids. Returns None if nothing provided."""
    if not activity_id and not activity_name and not level_id:
        return None
    if level_id:
        level = await db.levels.find_one({"id": level_id}, {"_id": 0, "members": 1})
        if not level:
            return []
        return level.get("members", [])
    # activity filter — prefer activity_name (how levels are actually stored)
    if activity_name:
        levels = await db.levels.find({"activity_name": activity_name}, {"_id": 0, "members": 1}).to_list(500)
    else:
        levels = await db.levels.find({"activity_id": activity_id}, {"_id": 0, "members": 1}).to_list(500)
    ids = list({mid for lvl in levels for mid in lvl.get("members", [])})
    return ids


@router.post("/broadcast")
async def broadcast_notification(data: BroadcastPayload):
    payload = NotificationPayload(
        title=data.title,
        body=data.body,
        title_en=data.title_en or None,
        body_en=data.body_en or None,
        image=data.image or None,
        url=data.url or "/",
        tag=f"broadcast-{uuid.uuid4()}"
    )

    # Resolve activity/level targeting to member_ids
    resolved_ids = await _resolve_activity_member_ids(data.activity_id, data.level_id, data.activity_name)
    effective_member_ids = resolved_ids if resolved_ids is not None else data.member_ids

    if effective_member_ids is not None:
        query = {"is_active": True, "member_id": {"$in": effective_member_ids}}
        subscriptions = await db.push_subscriptions.find(query, {"_id": 0}).to_list(10000)
        success_count = 0
        fail_count = 0
        for sub in subscriptions:
            result = await send_push_notification(sub, payload)
            if result:
                success_count += 1
            else:
                fail_count += 1
        return {"total": len(subscriptions), "success": success_count, "failed": fail_count}
    else:
        return await send_notification_to_all_members(payload, data.branch_id)


@router.get("/subscribers-count")
async def get_subscribers_count():
    total = await db.push_subscriptions.count_documents({"is_active": True})
    web_count = await db.push_subscriptions.count_documents({"is_active": True, "platform": "web"})
    android_count = await db.push_subscriptions.count_documents({"is_active": True, "platform": "android"})
    return {"count": total, "web": web_count, "android": android_count}


@router.get("/subscribers-list")
async def get_subscribers_list():
    subscriptions = await db.push_subscriptions.find(
        {"is_active": True},
        {"_id": 0, "member_id": 1, "created_at": 1, "updated_at": 1, "platform": 1}
    ).to_list(10000)

    member_ids = list(set(s["member_id"] for s in subscriptions if s.get("member_id")))

    members = await db.members.find(
        {"id": {"$in": member_ids}},
        {"_id": 0, "id": 1, "name": 1, "phone": 1, "branch_id": 1}
    ).to_list(10000)
    members_map = {m["id"]: m for m in members}

    result = []
    for sub in subscriptions:
        mid = sub.get("member_id", "")
        member = members_map.get(mid, {})
        name = member.get("name", "") or member.get("phone", "") or mid
        result.append({
            "member_id": mid,
            "name": name,
            "phone": member.get("phone", ""),
            "branch_id": member.get("branch_id", ""),
            "platform": sub.get("platform", "web"),
            "subscribed_at": sub.get("updated_at") or sub.get("created_at", "")
        })

    return {"subscribers": result}
