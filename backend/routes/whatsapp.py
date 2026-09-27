import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import shutil
import tempfile
import uuid
from io import BytesIO
from pathlib import Path
from datetime import datetime, timedelta, date, timezone
from zoneinfo import ZoneInfo
from typing import Optional, List, Literal
from urllib.parse import quote, urlparse
import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError
from pymongo import ReturnDocument
from .common import get_current_user
from utils.auth import (
    require_branch_scope,
    resolve_branch_filter,
)
from utils.training_closures import closures_for_date, training_day_closed
from utils.tenant import (
    DEFAULT_TENANT_SLUG,
    get_current_tenant,
    get_current_tenant_slug,
    set_current_tenant,
    reset_current_tenant,
)
from services.waha import WAHAClient
from services.whatsflow import WhatsflowClient, parse_connection_state
from services import whatsapp_media_archive
from services import whatsapp_bulk_jobs
from services import campaign_inbox, registration_followups
from services import campaign_inquiry_automation
from services import whatsapp_phone_mirror
from utils.phone import normalize_phone, phone_lookup_values
from utils.member_photos import is_photo_url
from .global_search import _member_overall_status

logger = logging.getLogger("whatsapp")
_bulk_media_branch_locks: dict[str, asyncio.Lock] = {}

CAMPAIGN_IMAGE_LIMIT = 5 * 1024 * 1024
CAMPAIGN_PDF_LIMIT = 20 * 1024 * 1024
CAMPAIGN_MAX_PASTED_RECIPIENTS = 2000
CAMPAIGN_ATTACHMENT_CHUNK_SIZE = 1024 * 1024
CAMPAIGN_MAX_IMAGES = 10
# Direct inbox media is deliberately smaller than the provider's general
# limits.  It is stored in private tenant/branch-scoped chunks so a successful
# chat send can still be rendered after the provider's temporary media URL has
# expired.
CLOUD_CHAT_IMAGE_LIMIT = 5 * 1024 * 1024
CLOUD_CHAT_AUDIO_LIMIT = 10 * 1024 * 1024
CLOUD_CHAT_AUDIO_MAX_SECONDS = 120
CLOUD_CHAT_AUDIO_DURATION_TOLERANCE = 0.25
CLOUD_CHAT_AUDIO_PROBE_TIMEOUT = 15
CLOUD_CHAT_MEDIA_CHUNK_SIZE = 1024 * 1024
CLOUD_INBOX_SEARCH_MAX_LENGTH = 100
BILINGUAL_ENGLISH_MARKER = "— English —"


def _append_english_section(message: str, english_text: str) -> str:
    """Append the standard English section once, preserving saved Arabic text."""
    if BILINGUAL_ENGLISH_MARKER.lower() in (message or "").lower():
        return message
    return f"{message.rstrip()}\n\n{BILINGUAL_ENGLISH_MARKER}\n{english_text.strip()}"


def _ensure_renewal_arabic_date(message: str, end_date: str) -> str:
    """Keep custom text, but ensure the Arabic section states the expiry date."""
    arabic, marker, english = message.partition(BILINGUAL_ENGLISH_MARKER)
    if end_date and end_date not in arabic:
        arabic = f"{arabic.rstrip()}\nتاريخ انتهاء الاشتراك: {end_date}"
    if marker:
        return f"{arabic.rstrip()}\n\n{marker}{english}"
    return arabic


def _renewal_english_summary(
    *, name: str, activity: str, end_date: str, days_remaining: int
) -> str:
    """Build an English renewal summary solely from structured reminder data."""
    if days_remaining < 0:
        timing = (
            f"expired on {end_date} "
            f"({abs(days_remaining)} day(s) ago)"
        )
    elif days_remaining == 0:
        timing = f"expires today, {end_date}"
    else:
        timing = (
            f"expires on {end_date} "
            f"({days_remaining} day(s) remaining)"
        )
    return (
        f"Hello {name},\n"
        f"Your subscription for {activity} {timing}.\n"
        f"Please contact us to renew. 🏆"
    )


def _require_whatsapp_access(current_user: dict):
    if current_user.get("is_admin", False):
        return
    if "whatsapp" not in (current_user.get("permissions") or []):
        raise HTTPException(status_code=403, detail="WhatsApp access required")


def _require_bulk_whatsapp_access(current_user: dict):
    if current_user.get("is_admin", False):
        return
    permissions = current_user.get("permissions") or []
    if "messages" not in permissions and "whatsapp" not in permissions:
        raise HTTPException(status_code=403, detail="Messages access required")


async def _can_view_member_phone_matches(current_user: dict) -> bool:
    """Return whether the caller may receive member-existence indicators.

    The inbox only needs a boolean match indicator, but that is still member
    PII.  Check the tenant-local user document rather than trusting a client
    supplied flag.  Admins are tenant-wide; non-admins need the same
    ``member-phones`` permission used by the member lookup endpoint.
    """
    if current_user.get("is_admin", False):
        return True
    if _db is None or not current_user.get("user_id"):
        return False
    user = await _db["users"].find_one(
        {"id": current_user["user_id"]},
        {"_id": 0, "permissions": 1},
    )
    return "member-phones" in ((user or {}).get("permissions") or [])


def _member_phone_regex(canonical: str) -> str:
    """Match a legacy phone value whose digits normalize to ``canonical``.

    The final Python normalization below is authoritative.  This regex only
    narrows one batched Mongo query to values containing the canonical local
    number, including records imported with spaces/dashes/parentheses or
    Arabic/Persian numerals.
    """
    significant = (
        canonical[3:] if canonical.startswith("966")
        else canonical[2:] if canonical.startswith("20")
        else canonical
    )
    arabic_indic = "٠١٢٣٤٥٦٧٨٩"
    persian = "۰۱۲۳۴۵۶۷۸۹"
    digit_patterns = {
        str(index): f"[{index}{arabic_indic[index]}{persian[index]}]"
        for index in range(10)
    }
    return r"\D*".join(digit_patterns[digit] for digit in significant)


async def _enrich_member_phone_matches(
    rows: list,
    current_user: dict,
    member_branch: Optional[str] = None,
    include_candidates: bool = False,
) -> list:
    """Derive the current member association for scoped inbox conversations.

    This is deliberately a read-time association, not a saved conversation
    link: moving/deleting a member, changing either of their phone fields, or
    adding a same-phone sibling is reflected by the next inbox read.  A
    candidate must always be in the *conversation's* branch, including for
    admins.  The legacy boolean remains for older inbox consumers, while
    ``member_link`` is the authoritative, ambiguity-safe representation.
    """
    def empty_link(status: str = "none") -> dict:
        return {
            "status": status,
            "member": None,
            "candidates": [],
            "candidate_count": 0,
        }

    can_view = await _can_view_member_phone_matches(current_user)
    if not can_view:
        # Do not leak a stale or user-controlled match flag, and do not query
        # members at all.  ``restricted`` lets the new UI distinguish this
        # permission state without disclosing member data.
        for row in rows:
            row.pop("member_phone_match", None)
            row["member_link"] = empty_link("restricted")
        return rows

    normalized_row_phones = [
        normalize_phone(row.get("phone"))
        for row in rows
    ]
    row_branches = [
        row.get("branch_id") or member_branch
        for row in rows
    ]

    # Non-admin rows are already route-scoped, but retain that constraint in
    # this helper as a defence in depth for its other callers.  Admins may see
    # many branches, never a member from a different branch than a row.
    authorized_branch = None
    if not current_user.get("is_admin", False):
        authorized_branch = member_branch or resolve_branch_filter(
            current_user, None
        )

    lookup_pairs = {
        (branch, phone)
        for branch, phone in zip(row_branches, normalized_row_phones)
        if branch
        and phone
        and (
            current_user.get("is_admin", False)
            or branch == authorized_branch
        )
    }
    if not lookup_pairs:
        for row in rows:
            row["member_phone_match"] = False
            row["member_link"] = empty_link()
        return rows

    normalized_phones = {phone for _, phone in lookup_pairs}
    lookup_branches = list({
        branch for branch, _ in lookup_pairs
    })
    exact_values = list(dict.fromkeys(
        value
        for phone in normalized_phones
        for value in phone_lookup_values(phone)
    ))
    member_scope = {
        "branch_id": (
            lookup_branches[0]
            if len(lookup_branches) == 1
            else {"$in": lookup_branches}
        ),
    }
    projection = {
        "_id": 0,
        "id": 1,
        "name": 1,
        "name_ar": 1,
        "member_code": 1,
        "photo": 1,
        "activities": 1,
        "phone": 1,
        "guardian_phone": 1,
        "branch_id": 1,
        "status": 1,
        "archived": 1,
        "deleted": 1,
    }

    # Most records use one of the canonical/local forms covered by the exact
    # lookup values.  We still run the legacy-format query for every requested
    # phone below: an exact sibling (or a match in another branch) must not
    # suppress a formatted sibling and turn a genuinely ambiguous association
    # into an arbitrary unique one.
    exact_rows = await _db["members"].find(
        {
            **member_scope,
            "$or": [
                {"phone": {"$in": exact_values}},
                {"guardian_phone": {"$in": exact_values}},
            ],
        },
        projection,
    ).to_list(length=None)
    legacy_query = {
        **member_scope,
        "$or": [
            {field: {"$regex": _member_phone_regex(phone)}}
            for phone in normalized_phones
            for field in ("phone", "guardian_phone")
        ],
    }
    legacy_rows = await _db["members"].find(
        legacy_query,
        projection,
    ).to_list(length=None)

    # The two batched queries can overlap in legacy data.  De-duplicate by
    # member ID before grouping so a number recorded as both member and
    # guardian phone never turns one member into a false ambiguity.
    members_by_id = {}
    for member in [*exact_rows, *legacy_rows]:
        member_id = member.get("id")
        status = str(member.get("status") or "").lower()
        if (
            not member_id
            or status in {"archived", "deleted"}
            or member.get("archived") is True
            or member.get("deleted") is True
        ):
            continue
        members_by_id[member_id] = member

    candidates_by_pair = {}
    for member in members_by_id.values():
        branch = member.get("branch_id")
        if not branch:
            continue
        for field in ("phone", "guardian_phone"):
            phone = normalize_phone(member.get(field))
            pair = (branch, phone)
            if phone and pair in lookup_pairs:
                candidates_by_pair.setdefault(pair, {})[member["id"]] = member

    def member_summary(member: dict) -> dict:
        photo = member.get("photo")
        return {
            "id": member.get("id"),
            "name": member.get("name") or "",
            "name_ar": member.get("name_ar") or "",
            "member_code": member.get("member_code") or "",
            # Never return legacy base64 photo payloads in the inbox list.
            "photo": photo if is_photo_url(photo) else None,
            "subscription_status": _member_overall_status(
                member.get("activities") or []
            ),
        }

    for row, branch, normalized_phone in zip(
        rows, row_branches, normalized_row_phones
    ):
        pair = (branch, normalized_phone)
        members = list((candidates_by_pair.get(pair) or {}).values())
        members.sort(key=lambda member: (
            str(member.get("id") or ""),
            str(member.get("name_ar") or member.get("name") or ""),
        ))
        summaries = [member_summary(member) for member in members]
        count = len(summaries)
        if count == 1:
            link = {
                "status": "unique",
                "member": summaries[0],
                "candidates": summaries if include_candidates else [],
                "candidate_count": 1,
            }
        elif count > 1:
            link = {
                "status": "ambiguous",
                "member": None,
                "candidates": summaries if include_candidates else [],
                "candidate_count": count,
            }
        else:
            link = empty_link()
        row["member_link"] = link
        # Compatibility only.  New clients must use member_link to avoid
        # treating shared family phones as an arbitrary member selection.
        row["member_phone_match"] = count > 0
    return rows


def _require_renewals_or_whatsapp_access(current_user: dict):
    """Renewals page needs read/send without full WhatsApp settings access."""
    if current_user.get("is_admin", False):
        return
    perms = current_user.get("permissions") or []
    if "whatsapp" in perms or "renewals" in perms:
        return
    raise HTTPException(status_code=403, detail="Renewals or WhatsApp access required")

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3001")
RIYADH_TZ = ZoneInfo("Asia/Riyadh")

DEFAULT_SETTINGS = {
    "enabled": False,
    # Forward NEW admin bell notifications (رسائل الأعضاء، تنبيهات التجديد…)
    # to the manager's WhatsApp. Checked every minute by _admin_alert_loop.
    "admin_alert_enabled": False,
    "admin_alert_phone": "",
    "days_before": 3,
    "days_before_2": 1,
    "reminder_2_enabled": True,
    # Multi-offset list: each item {days: int, enabled: bool}.
    # Includes T-0 (day of expiry) and longer offsets like T-7.
    "offsets": [
        {"days": 7, "enabled": True},
        {"days": 3, "enabled": True},
        {"days": 1, "enabled": True},
        {"days": 0, "enabled": True},
    ],
    "message_template": "مرحباً {name}،\nنذكركم بأن اشتراككم في نشاط {activity} سينتهي بعد {days} يوم/أيام.\nيرجى التواصل معنا للتجديد. 🏆",
    # Per-offset overrides keyed by stringified days; empty falls back to message_template
    "templates": {},
    "manual_reminder_template": "السلام عليكم {name}،\nنود تذكيركم بأن اشتراك ({activity}) في شركة اداء الابطال العالمية للرياضة قارب على الانتهاء بتاريخ {end_date}.\nنرجو التواصل معنا للتجديد.\nشكراً لكم 🏆",
    # Used instead of manual_reminder_template when the subscription end date
    # has already passed (past-tense wording: "انتهى" not "قارب على الانتهاء").
    "manual_reminder_expired_template": "السلام عليكم {name}،\nنود إعلامكم بأن اشتراك ({activity}) في شركة اداء الابطال العالمية للرياضة قد انتهى بتاريخ {end_date}.\nنرجو التواصل معنا للتجديد.\nشكراً لكم 🏆",
    # Welcome message for NEW members (first subscription) — sent manually via the
    # Members page WhatsApp button. Empty per-branch override falls back to this.
    "welcome_template": "أهلاً وسهلاً {name} 🎉\nيسعدنا انضمامك إلى شركة اداء الابطال العالمية للرياضة في نشاط ({activity}).\nنتمنى لك تجربة رياضية ممتعة ومفيدة. 🏆",
    "send_hour": 9,
    "push_enabled": True,
    "portal_enabled": True,
    "push_title_template": "تنبيه: اشتراكك ينتهي قريباً 🔔",
    "push_body_template": "اشتراكك في {activity} ينتهي خلال {days} أيام ({end_date})",
    # English copies of the renewal-reminder push templates. send_push_notification
    # swaps these in for recipients whose saved language is 'en'. Admins can
    # override either language via the WhatsApp settings panel.
    "push_title_template_en": "Reminder: your subscription expires soon 🔔",
    "push_body_template_en": "Your {activity} subscription expires in {days} days ({end_date})",
}

SEND_NOW_PREVIEW_TTL_SECONDS = 300


def _normalize_offsets(settings: dict) -> List[dict]:
    """Return a deduplicated, validated list of {days, enabled} for the scheduler.

    If the stored doc has no `offsets` key at all, fall back to the legacy
    days_before/days_before_2/extra_offsets fields. An explicit empty list
    means "no offsets enabled" and is honoured as-is.
    """
    items: list = []
    if "offsets" in settings:
        raw = settings.get("offsets") or []
        if isinstance(raw, list):
            for o in raw:
                if isinstance(o, dict) and "days" in o:
                    try:
                        d = int(o["days"])
                    except Exception:
                        continue
                    if 0 <= d <= 60:
                        items.append({"days": d, "enabled": bool(o.get("enabled", True))})
    else:
        # Legacy fallback fields: clamp to the same 0..60 range as the offsets
        # model so a malformed doc can never schedule post-expiry auto-reminders.
        try:
            d1 = int(settings.get("days_before", 3))
            if 0 <= d1 <= 60:
                items.append({"days": d1, "enabled": True})
        except Exception:
            pass
        if settings.get("reminder_2_enabled", True):
            try:
                d2 = int(settings.get("days_before_2", 1))
                if 0 <= d2 <= 60:
                    items.append({"days": d2, "enabled": True})
            except Exception:
                pass
        for d in settings.get("extra_offsets", []) or []:
            try:
                dv = int(d)
                if 0 <= dv <= 60:
                    items.append({"days": dv, "enabled": True})
            except Exception:
                continue
    seen: set = set()
    out: list = []
    for it in items:
        if it["days"] in seen:
            continue
        seen.add(it["days"])
        out.append(it)
    return out

_db = None
_scheduler_started = False
_reminders_running = False
_invoice_payment_outbox_started = False
_class_reminder_started = False


def set_database(db):
    global _db
    _db = db
    campaign_inquiry_automation.configure(db, _get_branch_cloud_config)
    whatsapp_bulk_jobs.configure(
        db, get_config=_get_branch_cloud_config,
        validate_config=_validate_bulk_job_config,
        validate_closure_config=_validate_closure_job_config,
        reserve_quota=_reserve_waha_campaign_quota,
        release_quota=_release_waha_campaign_quota,
        send=_dispatch_bulk_job_item,
        authorize_dispatch=_authorize_bulk_dispatch,
        recheck_dispatch=_recheck_bulk_dispatch,
        completed=_completed_bulk_dispatch,
    )
    registration_followups.configure(db, _get_branch_cloud_config)


async def _authorize_bulk_dispatch(item: dict):
    """Route queue safety callbacks without creating a second send path."""
    if item.get("communication_kind") == campaign_inquiry_automation.KIND:
        return await campaign_inquiry_automation.authorize_dispatch(item)
    return await registration_followups.authorize_dispatch(item)


async def _recheck_bulk_dispatch(item: dict):
    if item.get("communication_kind") == campaign_inquiry_automation.KIND:
        return await campaign_inquiry_automation.recheck_dispatch(item)
    return await registration_followups.recheck_dispatch(item)


async def _completed_bulk_dispatch(item: dict, status: str):
    if item.get("communication_kind") == campaign_inquiry_automation.KIND:
        await campaign_inquiry_automation.completed(item, status)
        return
    await registration_followups.completed(item, status)


def _format_phone(phone: str) -> str:
    if not phone:
        return ""
    digits = "".join(filter(str.isdigit, phone))
    if digits.startswith("0"):
        digits = "966" + digits[1:]
    elif not digits.startswith("966"):
        digits = "966" + digits
    return digits + "@s.whatsapp.net"


def _format_cloud_phone(phone: str) -> str:
    """Normalize local Saudi/Egyptian input without corrupting E.164 numbers."""
    if not phone:
        return ""
    normalized = str(phone).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    digits = "".join(filter(str.isdigit, normalized))
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("05") and len(digits) == 10:
        digits = "966" + digits[1:]
    elif digits.startswith("5") and len(digits) == 9:
        digits = "966" + digits
    elif digits.startswith("01") and len(digits) == 11:
        digits = "20" + digits[1:]
    if not (9 <= len(digits) <= 15) or digits.startswith("0"):
        return ""
    return digits + "@s.whatsapp.net"


async def _get_wa_status() -> dict:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{WA_SERVICE_URL}/status")
            return r.json()
    except Exception:
        return {"connected": False, "qr": None, "error": "WhatsApp service not running"}


async def _send_wa_message(phone: str, message: str) -> bool:
    return await _send_wa_message_for_branch(
        phone, message, None, automated=False
    )


def _token_cipher():
    secret = os.environ.get("SESSION_SECRET", "")
    if not secret:
        raise RuntimeError("SESSION_SECRET is required for WhatsApp token encryption")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


def _encrypt_access_token(token: str) -> str:
    return _token_cipher().encrypt(token.encode("utf-8")).decode("ascii")


def _decrypt_access_token(encrypted: str) -> str:
    try:
        return _token_cipher().decrypt(encrypted.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Stored WhatsApp access token cannot be decrypted") from exc


def _webhook_verify_token(tenant_slug: str) -> str:
    secret = os.environ.get("SESSION_SECRET", "")
    if not secret:
        raise RuntimeError("SESSION_SECRET is required")
    return hmac.new(
        secret.encode("utf-8"),
        f"meta-webhook:{tenant_slug}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:40]


async def _get_branch_cloud_config(branch_id: Optional[str]) -> Optional[dict]:
    if _db is None or not branch_id:
        return None
    return await _db["whatsapp_branch_configs"].find_one(
        {"branch_id": branch_id}, {"_id": 0}
    )


def _branch_provider(config: Optional[dict]) -> str:
    """Resolve old branch documents without changing their historical meaning."""
    if not config:
        return "legacy"
    provider = config.get("provider")
    if provider in {"meta_cloud", "waha", "whatsflow", "legacy", "disabled"}:
        return provider
    return "meta_cloud" if config.get("enabled") else "legacy"


def _waha_physical_session_id(branch_id: str, alias: str = "", tenant_slug: Optional[str] = None) -> str:
    slug = tenant_slug or get_current_tenant_slug()
    prefix = re.sub(r"[^a-z0-9_-]", "-", (alias or "waha").lower()).strip("-_")[:24] or "waha"
    suffix = hashlib.sha256(f"{slug}:{branch_id}".encode("utf-8")).hexdigest()[:20]
    return f"{prefix}-{suffix}"


def _canonical_waha_message_id(value) -> Optional[str]:
    if isinstance(value, dict):
        key = value.get("key")
        if isinstance(key, dict):
            nested = _canonical_waha_message_id(key)
            if nested:
                return nested
        for candidate in (value.get("_serialized"), value.get("id"), value.get("messageId")):
            if isinstance(candidate, dict):
                nested = _canonical_waha_message_id(candidate)
                if nested:
                    return nested
            elif candidate not in (None, ""):
                return str(candidate)
        return None
    return str(value) if value not in (None, "") else None


def _waha_message_id_variants(value) -> list[str]:
    """Return literal WAHA full/stanza identifiers without constructing IDs.

    WAHA responses sometimes contain both ``_serialized`` (the canonical full
    key) and the stanza ``id``; acknowledgement events may contain only one.
    Keeping both as explicit aliases lets receipt evidence reconcile them
    without a phone/body heuristic.  The primary stored provider ID remains
    the canonical value selected by ``_canonical_waha_message_id``.
    """
    values = []

    def visit(candidate):
        if not isinstance(candidate, dict):
            if candidate not in (None, ""):
                values.append(str(candidate))
            return
        key = candidate.get("key")
        if isinstance(key, dict):
            visit(key)
        for name in ("_serialized", "id", "messageId"):
            nested = candidate.get(name)
            if isinstance(nested, dict):
                visit(nested)
            elif nested not in (None, ""):
                values.append(str(nested))

    visit(value)
    canonical = _canonical_waha_message_id(value)
    if canonical:
        values.insert(0, canonical)
    return list(dict.fromkeys(value.strip() for value in values if value.strip()))


def _normalize_waha_ack(payload: dict) -> str:
    named = payload.get("ackName") or payload.get("status")
    if named not in (None, ""):
        normalized = str(named).strip().lower().removeprefix("ack_")
        return {
            "server": "sent",
            "sent": "sent",
            "device": "delivered",
            "delivered": "delivered",
            "read": "read",
            "played": "read",
            "pending": "pending",
            "error": "error",
            "failed": "error",
        }.get(normalized, normalized)
    mapping = {-1: "error", 0: "pending", 1: "sent", 2: "delivered", 3: "read", 4: "read"}
    try:
        return mapping.get(int(payload.get("ack")), "unknown")
    except (TypeError, ValueError):
        return "unknown"


def _waha_chat_id(phone: str) -> str:
    digits = "".join(filter(str.isdigit, phone or ""))
    return f"{digits}@c.us" if digits else ""


async def _send_waha_message_result(phone: str, message: str, config: dict):
    """Compatibility tuple wrapper for existing text-send callers."""
    ok, message_id, error, _aliases = await _send_waha_message_evidence_result(
        phone, message, config
    )
    return ok, message_id, error


async def _send_waha_message_evidence_result(phone: str, message: str, config: dict):
    """Return the normal WAHA result plus literal full/stanza ID aliases."""
    chat_id = _waha_chat_id(phone)
    session = config.get("waha_physical_session_id") or _waha_physical_session_id(
        str(config.get("branch_id") or ""), str(config.get("waha_session_name") or "")
    )
    if not chat_id or not session:
        return False, None, "invalid_waha_config", []
    ok, response, error = await WAHAClient().send_text(session, chat_id, message)
    message_id = None
    aliases = []
    if isinstance(response, dict):
        message_id = _canonical_waha_message_id(response)
        aliases = _waha_message_id_variants(response)
    return ok, message_id, error, aliases


def _whatsflow_client(config: dict) -> WhatsflowClient:
    encrypted = config.get("whatsflow_api_key_encrypted") or ""
    api_key = _decrypt_access_token(encrypted) if encrypted else ""
    return WhatsflowClient(config.get("whatsflow_instance") or "", api_key)


def _strict_provider_bool(value: object) -> Optional[bool]:
    """Accept only JSON booleans and Evolution's canonical string form."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized == "true":
            return True
        if normalized == "false":
            return False
    return None


def _provider_from_me(key: dict, data: dict) -> Optional[bool]:
    """Resolve duplicate provider fields only when all evidence agrees."""
    values = []
    if "fromMe" in key:
        values.append(key.get("fromMe"))
    if "fromMe" in data:
        values.append(data.get("fromMe"))
    if not values:
        return None
    normalized = [_strict_provider_bool(value) for value in values]
    if any(value is None for value in normalized) or len(set(normalized)) != 1:
        return None
    return normalized[0]


def _normalize_whatsflow_message(message: dict) -> dict:
    """Unwrap non-private Evolution message containers.

    Evolution nests captioned documents and disappearing messages one level
    down.  View-once containers are intentionally not traversed: retrieving
    their media later would defeat the sender's privacy choice.
    """
    current = message if isinstance(message, dict) else {}
    for _ in range(4):
        if any(key in current for key in (
            "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension",
        )):
            return current
        nested = None
        for container in ("ephemeralMessage", "documentWithCaptionMessage"):
            value = current.get(container)
            if isinstance(value, dict) and isinstance(value.get("message"), dict):
                nested = value["message"]
                break
        if nested is None:
            return current
        current = nested
    return current


WHATSFLOW_TEXT_MAX_CHARS = 65536


def _bounded_message_text(value: object) -> str:
    """Return text only; provider objects must never become stored body text."""
    if not isinstance(value, str):
        return ""
    return value[:WHATSFLOW_TEXT_MAX_CHARS]


def _whatsflow_text_field(value: object) -> str:
    """Accept Evolution's explicit text forms, without recursive traversal."""
    if isinstance(value, str):
        return _bounded_message_text(value)
    if isinstance(value, dict):
        return _bounded_message_text(value.get("body"))
    return ""


def _extract_whatsflow_body(raw_message: object, data: object = None) -> str:
    """Extract only documented, non-private Evolution text locations.

    Only ephemeral/document caption wrappers are normalized.  In particular,
    this deliberately does not recurse through quoted/context messages and
    refuses all view-once wrappers.
    """
    if not isinstance(raw_message, dict):
        raw_message = {}
    if _provider_marks_view_once(raw_message):
        return ""
    message = _normalize_whatsflow_message(raw_message)
    if any(key in message for key in (
        "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension",
    )):
        return ""

    extended = message.get("extendedTextMessage")
    extended_text = (
        _bounded_message_text(extended.get("text"))
        if isinstance(extended, dict)
        else ""
    )
    media_caption = ""
    for key in ("imageMessage", "documentMessage", "audioMessage", "videoMessage"):
        media = message.get(key)
        if isinstance(media, dict):
            media_caption = _bounded_message_text(media.get("caption"))
            if media_caption:
                break

    data = data if isinstance(data, dict) else {}
    candidates = (
        _bounded_message_text(message.get("conversation")),
        extended_text,
        _whatsflow_text_field(message.get("text")),
        media_caption,
        _whatsflow_text_field(data.get("text")),
        _bounded_message_text(data.get("body")),
    )
    return next((text for text in candidates if text), "")


def _whatsflow_media_headers(filename: str, mime_type: str) -> dict:
    """Build an RFC 5987 disposition without reflecting unsafe filenames."""
    name = Path(str(filename or "attachment").replace("\\", "/")).name
    name = "".join(char for char in name if char.isprintable() and char not in "\r\n")
    name = name.strip()[:180] or "attachment"
    ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", name).strip("._") or "attachment"
    disposition = "inline" if (
        mime_type.startswith(("audio/", "video/"))
        or mime_type in {"image/jpeg", "image/png", "image/gif", "image/webp"}
    ) else "attachment"
    return {
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Content-Disposition": (
            f"{disposition}; filename=\"{ascii_name}\"; "
            f"filename*=UTF-8''{quote(name, safe='')}"
        ),
    }


def _is_inbound_attachment(message: dict) -> bool:
    """Only ordinary inbound media is eligible; view-once never enters storage."""
    return bool(
        message.get("direction") == "inbound"
        and message.get("type") in {"image", "audio", "video", "document"}
        and (message.get("media_id") or message.get("media_url")
             or (message.get("provider") == "whatsflow" and message.get("provider_message_id")))
        and not message.get("view_once")
    )


def _provider_marks_view_once(value: object, depth: int = 0) -> bool:
    """Read provider view-once wrappers without traversing arbitrary payloads."""
    if not isinstance(value, dict) or depth > 4:
        return False
    if any(value.get(key) is True for key in ("view_once", "viewOnce", "isViewOnce")):
        return True
    if any(key in value for key in (
        "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension",
    )):
        return True
    return any(_provider_marks_view_once(value.get(key), depth + 1)
               for key in ("message", "_data", "media", "imageMessage",
                           "videoMessage", "audioMessage", "documentMessage"))


def _archive_pending_fields(message: dict) -> dict:
    if not _is_inbound_attachment(message):
        return message
    return {
        **message, "archive_status": "pending", "archive_error": None,
    }


def _whatsflow_webhook_secret(tenant_slug: str, branch_id: str) -> str:
    secret = os.environ.get("SESSION_SECRET", "")
    if not secret:
        raise RuntimeError("SESSION_SECRET is required")
    return hmac.new(
        secret.encode("utf-8"),
        f"whatsflow-webhook:{tenant_slug}:{branch_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


async def _send_whatsflow_message_result(
    phone: str, message: str, config: dict, *, automated: bool = True
):
    digits = "".join(filter(str.isdigit, phone or ""))
    if not digits:
        return False, None, "invalid_phone"
    if not automated:
        ok, response, error = await _whatsflow_client(config).send_text(
            digits, message, delay=0, link_preview=False
        )
        return ok, _provider_message_id(response), error
    evidence_id = await _start_whatsflow_automation_evidence(digits, config)
    try:
        ok, response, error = await _whatsflow_client(config).send_text(
            digits, message, delay=0, link_preview=False
        )
    except Exception as exc:
        await _finish_whatsflow_automation_evidence(
            evidence_id, status="unknown", error=type(exc).__name__
        )
        raise
    message_id = _provider_message_id(response)
    await _finish_whatsflow_automation_evidence(
        evidence_id,
        status="sent" if ok and message_id else "unknown",
        provider_message_id=message_id,
        error=error,
    )
    return ok, message_id, error


def _provider_message_id(response) -> Optional[str]:
    if not isinstance(response, dict):
        return None
    key = response.get("key")
    message_id = (
        (key.get("id") if isinstance(key, dict) else None)
        or response.get("id")
    )
    return str(message_id) if message_id else None


async def _start_whatsflow_automation_evidence(phone: str, config: dict):
    """Record an automated session-provider send before it can echo it."""
    if _db is None or not config.get("branch_id"):
        raise RuntimeError("whatsflow_automation_evidence_unavailable")
    evidence_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    try:
        await _db["whatsapp_automated_outbound"].insert_one({
            "id": evidence_id,
            "branch_id": config["branch_id"],
            "provider": _branch_provider(config),
            "phone": normalize_phone(phone),
            "status": "in_flight",
            "created_at": now.isoformat(),
        })
        return evidence_id
    except Exception as exc:
        raise RuntimeError(
            "whatsflow_automation_evidence_unavailable"
        ) from exc


async def _finish_whatsflow_automation_evidence(
    evidence_id: Optional[str],
    *,
    status: str,
    provider_message_id: Optional[str] = None,
    error: Optional[str] = None,
):
    if not evidence_id or _db is None:
        return
    update = {
        "status": status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if provider_message_id:
        update["provider_message_id"] = provider_message_id
    if error:
        update["error"] = error
    try:
        await _db["whatsapp_automated_outbound"].update_one(
            {"id": evidence_id}, {"$set": update}
        )
    except Exception as exc:
        logger.warning(
            "Could not finalize Whatsflow automation evidence: %s",
            type(exc).__name__,
        )


async def _send_whatsflow_media_result(
    phone: str,
    media_type: str,
    mime_type: str,
    caption: str,
    media: str,
    filename: str,
    config: dict,
):
    """Send automated Whatsflow media with the same echo evidence as text."""
    digits = "".join(filter(str.isdigit, phone or ""))
    if not digits:
        return False, None, "invalid_phone"
    evidence_id = await _start_whatsflow_automation_evidence(digits, config)
    try:
        ok, response, error = await _whatsflow_client(config).send_media(
            digits, media_type, mime_type, caption, media, filename
        )
    except Exception as exc:
        await _finish_whatsflow_automation_evidence(
            evidence_id, status="unknown", error=type(exc).__name__
        )
        raise
    message_id = _provider_message_id(response)
    await _finish_whatsflow_automation_evidence(
        evidence_id,
        status="sent" if ok and message_id else "unknown",
        provider_message_id=message_id,
        error=error,
    )
    return ok, message_id, error


async def _send_session_provider_result(
    phone: str, message: str, config: dict, *, automated: bool = True
):
    if _branch_provider(config) == "whatsflow":
        if automated:
            return await _send_whatsflow_message_result(phone, message, config)
        digits = "".join(filter(str.isdigit, phone or ""))
        if not digits:
            return False, None, "invalid_phone"
        ok, response, error = await _whatsflow_client(config).send_text(
            digits, message, delay=0, link_preview=False
        )
        return ok, _provider_message_id(response), error
    if not automated:
        return await _send_waha_message_result(phone, message, config)
    # WAHA also emits linked-phone echoes.  Persist exact evidence before
    # dispatch so an automated reminder/campaign can never be mistaken for a
    # staff reply merely because its echo arrived first.
    digits = "".join(filter(str.isdigit, phone or ""))
    evidence_id = await _start_whatsflow_automation_evidence(digits, config)
    try:
        ok, message_id, error = await _send_waha_message_result(
            phone, message, config
        )
    except Exception as exc:
        await _finish_whatsflow_automation_evidence(
            evidence_id, status="unknown", error=type(exc).__name__
        )
        raise
    await _finish_whatsflow_automation_evidence(
        evidence_id,
        status="sent" if ok and message_id else "unknown",
        provider_message_id=message_id,
        error=error,
    )
    return ok, message_id, error


def _campaign_quota_id(branch_id: str) -> str:
    return f"{branch_id}:{datetime.now(RIYADH_TZ).date().isoformat()}"


async def _reserve_waha_campaign_quota(branch_id: str, limit: int, amount: int) -> dict:
    if amount <= 0 or amount > limit:
        raise HTTPException(status_code=429, detail="WAHA daily campaign limit exceeded")
    coll = _db["whatsapp_waha_campaign_quota"]
    quota_id = _campaign_quota_id(branch_id)
    try:
        doc = await coll.find_one_and_update(
            {"_id": quota_id, "used": {"$lte": limit - amount}},
            {"$setOnInsert": {"branch_id": branch_id, "date": quota_id.rsplit(":", 1)[-1], "limit": limit},
             "$inc": {"used": amount}},
            upsert=True, return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        doc = None
    if not doc:
        raise HTTPException(status_code=429, detail="WAHA daily campaign limit exceeded")
    return doc


async def _release_waha_campaign_quota(
    reservation_id: str, amount: int, refund_key: Optional[str] = None
) -> None:
    if amount <= 0:
        return
    query = {"_id": reservation_id}
    update = {"$inc": {"used": -amount}}
    if refund_key:
        query["refund_keys"] = {"$ne": refund_key}
        update["$addToSet"] = {"refund_keys": refund_key}
    await _db["whatsapp_waha_campaign_quota"].update_one(query, update)


async def _get_waha_campaign_quota(branch_id: str, limit: int) -> dict:
    doc = await _db["whatsapp_waha_campaign_quota"].find_one(
        {"_id": _campaign_quota_id(branch_id)}, {"_id": 0}
    ) or {}
    used = max(0, int(doc.get("used") or 0))
    return {"used": used, "remaining": max(0, limit - used)}


async def _has_enabled_cloud_config() -> bool:
    if _db is None:
        return False
    if await _db["whatsapp_branch_configs"].find_one(
        {"enabled": True, "access_token_encrypted": {"$exists": True, "$ne": ""}},
        {"_id": 1},
    ):
        return True
    if await _db["whatsapp_branch_configs"].find_one(
        {"enabled": True, "provider": "waha", "waha_session_name": {"$exists": True, "$ne": ""}},
        {"_id": 1},
    ):
        return True
    return bool(await _db["whatsapp_branch_configs"].find_one(
        {"enabled": True, "provider": "whatsflow",
         "whatsflow_api_key_encrypted": {"$exists": True, "$ne": ""}},
        {"_id": 1},
    ))


async def _send_meta_cloud_message_result(
    phone: str, message: str, config: dict
) -> tuple[bool, Optional[str], Optional[str]]:
    digits = "".join(filter(str.isdigit, phone or ""))
    if not digits:
        return False, None, "invalid_phone"
    try:
        token = _decrypt_access_token(config["access_token_encrypted"])
        version = (config.get("graph_api_version") or "v23.0").strip()
        url = f"https://graph.facebook.com/{version}/{config['phone_number_id']}/messages"
        template_name = (config.get("message_template_name") or "").strip()
        if template_name:
            components = [{
                "type": "body",
                "parameters": [{"type": "text", "text": message}],
            }]
            quick_reply_payload = (config.get("_quick_reply_payload") or "").strip()
            if quick_reply_payload:
                components.append({
                    "type": "button",
                    "sub_type": "quick_reply",
                    "index": "0",
                    "parameters": [{
                        "type": "payload",
                        "payload": quick_reply_payload,
                    }],
                })
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": digits,
                "type": "template",
                "template": {
                    "name": template_name,
                    "language": {
                        "code": (config.get("template_language") or "ar").strip()
                    },
                    "components": components,
                },
            }
        else:
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": digits,
                "type": "text",
                "text": {"preview_url": False, "body": message},
            }
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
            )
        if 200 <= response.status_code < 300:
            try:
                response_data = response.json()
                message_id = ((response_data.get("messages") or [{}])[0]).get("id")
            except Exception:
                message_id = None
            return True, str(message_id) if message_id not in (None, "") else None, None
        logger.error(
            "Meta WhatsApp send failed for branch %s: HTTP %s",
            config.get("branch_id"),
            response.status_code,
        )
        return False, None, f"http_{response.status_code}"
    except Exception as exc:
        logger.error(
            "Meta WhatsApp send failed for branch %s: %s",
            config.get("branch_id"),
            type(exc).__name__,
        )
        return False, None, type(exc).__name__


async def _send_meta_cloud_message(phone: str, message: str, config: dict) -> bool:
    success, _, _ = await _send_meta_cloud_message_result(phone, message, config)
    return success


async def send_attendance_whatsapp_notice(
    member: dict,
    activity_name: str,
    date_str: str,
    check_in_time: str,
    branch_id: Optional[str] = None,
) -> bool:
    """Best-effort attendance notice using the receiving branch's Meta template."""
    try:
        target_branch = branch_id or member.get("branch_id")
        phone = _format_cloud_phone(member.get("phone") or "")
        config = await _get_branch_cloud_config(target_branch)
        provider = _branch_provider(config)
        if not phone or not config or not config.get("enabled"):
            return False
        member_name = member.get("name_ar") or member.get("name") or ""
        message = (
            f"تم تسجيل حضور {member_name} في {activity_name} "
            f"بتاريخ {date_str} الساعة {check_in_time} ✅"
        )
        message = _append_english_section(
            message,
            f"Attendance recorded for {member_name} in {activity_name} "
            f"on {date_str} at {check_in_time} ✅",
        )
        if provider in {"waha", "whatsflow"}:
            success, _, _ = await _send_session_provider_result(phone, message, config)
        else:
            if not (provider == "meta_cloud" and config.get("phone_number_id")
                    and config.get("access_token_encrypted") and config.get("attendance_template_name")
                    and config.get("attendance_template_confirmed")):
                return False
            attendance_config = dict(config)
            attendance_config["message_template_name"] = config["attendance_template_name"]
            success = await _send_meta_cloud_message(phone, message, attendance_config)
        try:
            await _db["whatsapp_send_log"].insert_one({
                "phone": phone.split("@")[0],
                "message": message,
                "success": success,
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "type": "attendance_cloud",
                "branch_id": target_branch,
                "member_id": member.get("id"),
                "transport": provider,
            })
        except Exception as exc:
            logger.warning("Could not save attendance WhatsApp log: %s", type(exc).__name__)
        return success
    except Exception as exc:
        logger.warning("Attendance WhatsApp notice failed: %s", type(exc).__name__)
        return False


async def send_freeze_whatsapp_notice(
    member: dict,
    freeze: dict,
    *,
    event_type: str,
) -> bool:
    """Best-effort freeze notice through the member branch's configured provider.

    Session providers can send this transactional text directly. Meta is
    deliberately fail-closed unless a dedicated, confirmed freeze template is
    configured; an attendance or other unrelated template must never be reused.
    Every call records one attempt, including pre-dispatch failures.
    """
    branch_id = (member or {}).get("branch_id") or ""
    member_id = (member or {}).get("id") or freeze.get("member_id") or ""
    freeze_id = freeze.get("id") or ""
    raw_phone = (member or {}).get("phone") or ""
    phone = _format_cloud_phone(raw_phone)
    provider = "unconfigured"
    success = False
    error = None
    message = ""
    provider_message_id = None

    try:
        branch_name = ""
        if _db is None:
            error = "whatsapp_database_unconfigured"
        elif not phone:
            error = "invalid_phone" if raw_phone else "no_phone"
        elif not branch_id:
            error = "no_branch"
        else:
            config = await _get_branch_cloud_config(branch_id)
            provider = _branch_provider(config)
            if not config or not config.get("enabled"):
                error = "provider_unconfigured_or_disabled"
            else:
                branch = await _db["branches"].find_one(
                    {"id": branch_id},
                    {"_id": 0, "name": 1, "name_ar": 1},
                )
                branch_name = (
                    (branch or {}).get("name_ar")
                    or (branch or {}).get("name")
                    or ""
                )
                name = (
                    (member or {}).get("name_ar")
                    or (member or {}).get("name")
                    or ""
                )
                start_date = str(freeze.get("start_date") or "")
                end_date = str(freeze.get("end_date") or "")
                duration = int(freeze.get("duration_days") or 0)
                branch_ar = f"\nالفرع: {branch_name}" if branch_name else ""
                branch_en = f"\nBranch: {branch_name}" if branch_name else ""
                if event_type == "freeze_created":
                    message = (
                        f"مرحباً {name}، تم تسجيل تجميد عضويتك للفترة التالية.\n"
                        f"الفترة (شاملة): من {start_date} إلى {end_date}\n"
                        f"المدة: {duration} يوم{branch_ar}"
                    )
                    english = (
                        f"Hello {name}, your membership freeze has been recorded for the following period.\n"
                        f"Inclusive period: {start_date} to {end_date}\n"
                        f"Duration: {duration} day(s){branch_en}"
                    )
                elif event_type == "freeze_cancelled":
                    message = (
                        f"مرحباً {name}، تم إلغاء تجميد عضويتك.\n"
                        f"الفترة الملغاة (شاملة): من {start_date} إلى {end_date}\n"
                        f"المدة: {duration} يوم{branch_ar}"
                    )
                    english = (
                        f"Hello {name}, your membership freeze has been cancelled.\n"
                        f"Cancelled inclusive period: {start_date} to {end_date}\n"
                        f"Duration: {duration} day(s){branch_en}"
                    )
                else:
                    error = "unsupported_freeze_event"
                    english = ""
                if not error:
                    message = _append_english_section(message, english)
                    if provider in {"waha", "whatsflow"}:
                        success, provider_message_id, error = (
                            await _send_session_provider_result(phone, message, config)
                        )
                        if not success and not error:
                            error = "provider_send_failed"
                    elif provider == "meta_cloud":
                        template_name = (
                            config.get("freeze_template_name") or ""
                        ).strip()
                        if not (
                            config.get("phone_number_id")
                            and config.get("access_token_encrypted")
                            and template_name
                            and config.get("freeze_template_confirmed")
                        ):
                            error = "unsupported_meta_freeze_template"
                        else:
                            send_config = dict(config)
                            send_config["message_template_name"] = template_name
                            success, provider_message_id, error = (
                                await _send_meta_cloud_message_result(
                                    phone, message, send_config
                                )
                            )
                            if not success and not error:
                                error = "provider_send_failed"
                    else:
                        error = f"unsupported_provider:{provider}"
    except Exception as exc:
        error = f"notice_exception:{type(exc).__name__}"
        logger.warning(
            "Freeze WhatsApp notice failed before completion for freeze %s: %s",
            freeze_id,
            type(exc).__name__,
        )

    attempt = {
        "phone": phone.split("@")[0] if phone else "",
        "message": message,
        "success": success,
        "error": error,
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "type": event_type,
        "branch_id": branch_id,
        "member_id": member_id,
        "freeze_id": freeze_id,
        "transport": provider,
    }
    if provider_message_id:
        attempt["provider_message_id"] = provider_message_id
    try:
        if _db is None:
            raise RuntimeError("WhatsApp database is not configured")
        await _db["whatsapp_send_log"].insert_one(attempt)
    except Exception as exc:
        logger.warning(
            "Could not save %s WhatsApp attempt for freeze %s (%s): %s",
            event_type,
            freeze_id,
            error or "provider_result",
            type(exc).__name__,
        )
    if not success:
        logger.warning(
            "%s WhatsApp attempt failed for branch=%s member=%s freeze=%s: %s",
            event_type,
            branch_id,
            member_id,
            freeze_id,
            error or "unknown_error",
        )
    return success


_WEEKDAY_NAMES = {
    0: ("monday", "الاثنين", "الإثنين"),
    1: ("tuesday", "الثلاثاء"),
    2: ("wednesday", "الأربعاء"),
    3: ("thursday", "الخميس"),
    4: ("friday", "الجمعة"),
    5: ("saturday", "السبت"),
    6: ("sunday", "الأحد"),
}


def _parse_class_time(raw: str, on_date: date) -> Optional[datetime]:
    """Parse the Arabic/English 12-hour values saved by member schedule forms."""
    text = str(raw or "").translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")).strip()
    match = re.search(r"(\d{1,2})(?::(\d{1,2}))?\s*(ص|م|am|pm)?", text, re.IGNORECASE)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    suffix = (match.group(3) or "").lower()
    if minute > 59 or hour > 23:
        return None
    if suffix in ("م", "pm") and hour < 12:
        hour += 12
    elif suffix in ("ص", "am") and hour == 12:
        hour = 0
    elif suffix and hour > 12:
        return None
    return datetime.combine(on_date, datetime.min.time(), RIYADH_TZ).replace(
        hour=hour, minute=minute
    )


def _class_occurrence_for_date(activity: dict, on_date: date) -> Optional[datetime]:
    names = _WEEKDAY_NAMES[on_date.weekday()]
    days = [str(day or "").strip().lower() for day in (activity.get("training_days") or [])]
    schedule = str(activity.get("schedule") or "")
    if days:
        if not any(name.lower() in days for name in names):
            return None
    elif not any(name in schedule.lower() for name in names):
        return None

    day_times = activity.get("day_times") or {}
    raw_time = ""
    for name in names:
        raw_time = day_times.get(name) or day_times.get(name.lower()) or ""
        if raw_time:
            break
    raw_time = raw_time or activity.get("training_time") or schedule
    return _parse_class_time(raw_time, on_date)


def _activity_is_current(activity: dict, on_date: date) -> bool:
    if activity.get("status") in ("inactive", "expired", "cancelled"):
        return False
    start = str(activity.get("start_date") or "")[:10]
    end = str(activity.get("end_date") or "")[:10]
    day = on_date.isoformat()
    return (not start or start <= day) and (not end or end >= day)


async def send_class_reminder_whatsapp_notice(
    member: dict, activity_name: str, class_time: datetime, branch_name: str
) -> bool:
    """Send one two-hour class reminder through the member branch's Meta template."""
    branch_id = member.get("branch_id")
    phone = _format_cloud_phone(member.get("phone") or "")
    config = await _get_branch_cloud_config(branch_id)
    provider = _branch_provider(config)
    if not (phone and branch_id and config and config.get("enabled")):
        return False
    # Re-read after configuration lookup: a closure may have been created while
    # this agenda waited behind other recipients. No provider call precedes this.
    closures = await closures_for_date(_db, class_time.astimezone(RIYADH_TZ).date().isoformat())
    daily_classes = member.get("_daily_classes") or []
    if daily_classes:
        daily_classes = [
            entry for entry in daily_classes
            if not training_day_closed(closures, branch_id, entry.get("activity_id"))
        ]
        if not daily_classes:
            return False
        class_time = daily_classes[0]["class_time"]
        activity_name = daily_classes[0]["activity_name"]
        reminder_now = member.get("_reminder_now")
        if reminder_now is not None:
            reminder_time = class_time - timedelta(hours=2)
            if not (reminder_time <= reminder_now < reminder_time + timedelta(minutes=5)):
                return False
    else:
        activity_id = next((
            act.get("activity_id") for act in member.get("activities", [])
            if act.get("activity_name") == activity_name
        ), None)
        if training_day_closed(closures, branch_id, activity_id):
            return False
    name = member.get("name_ar") or member.get("name") or ""
    time_text = class_time.strftime("%I:%M %p").lstrip("0").replace("AM", "ص").replace("PM", "م")
    time_text_en = class_time.strftime("%I:%M %p").lstrip("0")
    message = (
        f"تذكير بموعد حصة {name} بعد ساعتين ⏰\n"
        f"النشاط: {activity_name}\n"
        f"الوقت: {time_text}\n"
        f"الفرع: {branch_name}"
    )
    message = _append_english_section(
        message,
        f"Class reminder for {name}: the class starts in two hours ⏰\n"
        f"Activity: {activity_name}\n"
        f"Time: {time_text_en}\n"
        f"Branch: {branch_name}",
    )
    if len(daily_classes) > 1:
        ar_lines, en_lines = [], []
        for entry in daily_classes:
            at = entry["class_time"]
            ar_time = at.strftime("%I:%M %p").lstrip("0").replace("AM", "ص").replace("PM", "م")
            en_time = at.strftime("%I:%M %p").lstrip("0")
            label = entry["activity_name"]
            member_label = entry.get("member_name") or ""
            prefix = f"{member_label} — " if member_label else ""
            ar_lines.append(f"• {prefix}{label}: {ar_time}")
            en_lines.append(f"• {prefix}{label}: {en_time}")
        date_text = class_time.strftime("%Y/%m/%d")
        message = _append_english_section(
            f"تذكير بأنشطة يوم {date_text} ⏰\nأول نشاط بعد ساعتين.\n"
            + "\n".join(ar_lines) + f"\nالفرع: {branch_name}",
            f"Activities for {date_text} ⏰\nThe first class starts in two hours.\n"
            + "\n".join(en_lines) + f"\nBranch: {branch_name}",
        )
    if provider in {"waha", "whatsflow"}:
        success, _, _ = await _send_session_provider_result(phone, message, config)
    else:
        if not (provider == "meta_cloud" and config.get("phone_number_id") and config.get("access_token_encrypted")
                and config.get("class_reminder_template_name") and config.get("class_reminder_template_confirmed")):
            return False
        send_config = dict(config)
        send_config["message_template_name"] = config["class_reminder_template_name"]
        success = await _send_meta_cloud_message(phone, message, send_config)
    try:
        await _db["whatsapp_send_log"].insert_one({"phone": phone.split("@")[0], "message": message, "success": success,
            "sent_at": datetime.now(timezone.utc).isoformat(), "type": "class_reminder", "branch_id": branch_id,
            "member_id": member.get("id"), "transport": provider})
    except Exception:
        pass
    return success


async def send_schedule_update_whatsapp_notice(
    member: dict,
    message: str,
    *,
    notice_type: str,
    dedup_key: Optional[str] = None,
) -> bool:
    """Send a member schedule-change/cancellation notice using their branch template."""
    try:
        branch_id = member.get("branch_id")
        phone = _format_cloud_phone(member.get("phone") or "")
        config = await _get_branch_cloud_config(branch_id)
        provider = _branch_provider(config)
        if not (phone and branch_id and message and config and config.get("enabled")):
            return False
        branch = await _db["branches"].find_one(
            {"id": branch_id}, {"_id": 0, "name": 1, "name_ar": 1}
        )
        branch_name = (branch or {}).get("name_ar") or (branch or {}).get("name") or ""
        if branch_name:
            if "الفرع:" not in message:
                message = f"{message}\nالفرع: {branch_name}"
            if not re.search(r"(?im)^\s*branch\s*:", message):
                message = f"{message}\nBranch: {branch_name}"
        log = _db["whatsapp_schedule_update_log"]
        if dedup_key:
            await log.create_index("dedup_key", unique=True)
            try:
                await log.insert_one({
                    "dedup_key": dedup_key,
                    "status": "processing",
                    "notice_type": notice_type,
                    "member_id": member.get("id"),
                    "branch_id": branch_id,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            except DuplicateKeyError:
                return False
        if provider in {"waha", "whatsflow"}:
            success, _, _ = await _send_session_provider_result(phone, message, config)
        else:
            if not (provider == "meta_cloud" and config.get("phone_number_id") and config.get("access_token_encrypted")
                    and config.get("schedule_update_template_name") and config.get("schedule_update_template_confirmed")):
                return False
            send_config = dict(config)
            send_config["message_template_name"] = config["schedule_update_template_name"]
            success = await _send_meta_cloud_message(phone, message, send_config)
        if dedup_key:
            if success:
                await log.update_one(
                    {"dedup_key": dedup_key},
                    {"$set": {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat()}},
                )
            else:
                await log.delete_one({"dedup_key": dedup_key, "status": "processing"})
        try:
            await _db["whatsapp_send_log"].insert_one({
                "phone": phone.split("@")[0],
                "message": message,
                "success": success,
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "type": notice_type,
                "branch_id": branch_id,
                "member_id": member.get("id"),
                "transport": provider,
            })
        except Exception:
            pass
        return success
    except Exception as exc:
        logger.warning("Schedule update WhatsApp notice failed: %s", type(exc).__name__)
        return False


async def process_class_reminders(now: Optional[datetime] = None) -> int:
    """One daily agenda per branch/phone, two hours before its first class."""
    if _db is None:
        return 0
    current = now or datetime.now(RIYADH_TZ)
    if current.tzinfo is None:
        current = current.replace(tzinfo=RIYADH_TZ)
    else:
        current = current.astimezone(RIYADH_TZ)
    target_date = (current + timedelta(hours=2)).date()
    closures = await closures_for_date(_db, target_date.isoformat())
    branch_rows = await _db["branches"].find(
        {}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1}
    ).to_list(length=None)
    branch_names = {
        row["id"]: row.get("name_ar") or row.get("name") or ""
        for row in branch_rows if row.get("id")
    }
    members = await _db["members"].find(
        {"phone": {"$nin": [None, ""]}, "activities": {"$exists": True, "$ne": []}},
        {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "phone": 1, "branch_id": 1, "activities": 1},
    ).to_list(length=None)
    log = _db["whatsapp_class_reminder_log"]
    await log.create_index("dedup_key", unique=True)
    sent = 0
    groups = {}
    for member in members:
        branch_id = member.get("branch_id")
        phone = _format_phone(member.get("phone") or "")
        if not branch_id or not phone:
            continue
        for activity in member.get("activities") or []:
            if training_day_closed(closures, branch_id, activity.get("activity_id")):
                continue
            if not _activity_is_current(activity, target_date):
                continue
            class_time = _class_occurrence_for_date(activity, target_date)
            if not class_time:
                continue
            activity_key = activity.get("activity_id") or activity.get("activity_name") or "activity"
            group = groups.setdefault((branch_id, phone), {"member": member, "entries": {}})
            legacy_key = f"{member.get('id')}:{activity_key}:{class_time.isoformat()}"
            group["entries"][legacy_key] = {
                "activity_id": activity.get("activity_id"),
                "activity_name": activity.get("activity_name") or "التدريب",
                "class_time": class_time, "member_id": member.get("id"),
                "member_name": member.get("name_ar") or member.get("name") or "",
            }
    for (branch_id, phone), group in groups.items():
        entries = sorted(group["entries"].values(), key=lambda entry: entry["class_time"])
        first_time = entries[0]["class_time"]
        reminder_time = first_time - timedelta(hours=2)
        if not (reminder_time <= current < reminder_time + timedelta(minutes=5)):
            continue
        # Avoid repeating a reminder already handled by the old per-class worker.
        legacy_handled = False
        for legacy_key in group["entries"]:
            if await log.find_one({"dedup_key": legacy_key}):
                legacy_handled = True
                break
        if legacy_handled:
            continue
        dedup_key = f"daily:{branch_id}:{phone}:{target_date.isoformat()}"
        try:
            await log.insert_one({
                "dedup_key": dedup_key, "status": "processing",
                "member_id": group["member"].get("id"), "branch_id": branch_id,
                "activity_name": "، ".join(entry["activity_name"] for entry in entries),
                "class_time": first_time.isoformat(),
                "activities": [{**entry, "class_time": entry["class_time"].isoformat()} for entry in entries],
                "created_at": current.isoformat(),
            })
        except DuplicateKeyError:
            continue
        success = await send_class_reminder_whatsapp_notice(
            {**group["member"], "_daily_classes": entries, "_reminder_now": current},
            entries[0]["activity_name"], first_time, branch_names.get(branch_id, ""),
        )
        if success:
            sent += 1
            await log.update_one(
                {"dedup_key": dedup_key},
                {"$set": {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat()}},
            )
        else:
            await log.delete_one({"dedup_key": dedup_key, "status": "processing"})
    return sent


class InvoiceReceiptDeliveryUnknown(RuntimeError):
    """The provider may have accepted the receipt; never automatically resend."""


async def send_invoice_payment_whatsapp_notice(invoice: dict) -> bool:
    """Send one invoice notice using the branch's configured provider.

    Whatsflow intentionally receives one receipt image with a caption.  WAHA
    retains its text transport, while Meta continues to use the approved
    branch template (the expanded text is only its template body parameter).
    """
    try:
        branch_id = invoice.get("branch_id")
        if not branch_id:
            return False
        member = None
        # Always resolve the linked member by ID *and branch*, even when the
        # invoice already has a phone.  The phone is a delivery snapshot; it
        # is not a safe substitute for the member relationship/code.
        if invoice.get("member_id"):
            member = await _db["members"].find_one(
                {"id": invoice["member_id"], "branch_id": branch_id},
                {"_id": 0, "phone": 1, "member_code": 1, "name_ar": 1, "name": 1},
            )
        phone = invoice.get("customer_phone") or ""
        if not phone and member:
            phone = (member or {}).get("phone") or ""
        phone = _format_cloud_phone(phone)
        config = await _get_branch_cloud_config(branch_id)
        provider = _branch_provider(config)
        if not (phone and config and config.get("enabled")):
            return False
        from services.invoice_whatsapp import (
            DEFAULT_COMPANY_NAME,
            DEFAULT_COMMERCIAL_REG,
            DEFAULT_TAX_NUMBER,
            CaptionLinkError,
            build_invoice_text,
            build_whatsflow_caption,
        )

        branch = await _db["branches"].find_one({"id": branch_id}, {"_id": 0}) or {}
        tenant = get_current_tenant() or {}
        tenant_slug = str(
            tenant.get("slug")
            or invoice.get("tenant_slug")
            or get_current_tenant_slug()
            or DEFAULT_TENANT_SLUG
        ).strip().lower()
        # Background workers receive a deliberately small tenant projection.
        # Hydrate the exact tenant from the control plane for branding instead
        # of falling back to another academy's defaults.
        needs_branding_hydration = (
            tenant_slug != DEFAULT_TENANT_SLUG
            or bool(
                tenant
                and not all(
                    tenant.get(field)
                    for field in ("name", "tax_number", "commercial_reg")
                )
            )
        )
        if needs_branding_hydration:
            try:
                from control_db import get_tenant_by_slug

                full_tenant = await get_tenant_by_slug(tenant_slug)
            except Exception:
                logger.exception(
                    "Could not hydrate tenant branding for invoice tenant=%s",
                    tenant_slug,
                )
                if tenant_slug != DEFAULT_TENANT_SLUG:
                    return False
                full_tenant = None
            if not full_tenant:
                logger.error(
                    "Missing tenant branding record for invoice tenant=%s",
                    tenant_slug,
                )
                if tenant_slug != DEFAULT_TENANT_SLUG:
                    return False
            else:
                tenant = {**tenant, **full_tenant}
        tenant = {**tenant, "slug": tenant_slug}
        image_branch = (
            {**branch, "tenant_slug": tenant_slug}
            if tenant_slug != DEFAULT_TENANT_SLUG
            else branch
        )
        branch_company = branch.get("company_name")
        if (
            tenant.get("name")
            and branch_company in (None, "", DEFAULT_COMPANY_NAME)
        ):
            image_branch = {**image_branch, "company_name": tenant.get("name")}
        # Preserve the issued invoice snapshot, only filling a missing member
        # code/name from the branch-authorized linked member for this notice.
        # Item schedules/dates are never read from the live member activities.
        render_invoice = invoice
        if member and (
            member.get("member_code")
            and member.get("member_code") != invoice.get("member_code")
        ):
            render_invoice = {
                **invoice,
                "member_code": member.get("member_code"),
            }
        if member and not render_invoice.get("member_name") and member.get("name_ar"):
            if render_invoice is invoice:
                render_invoice = {**invoice}
            render_invoice["member_name"] = member.get("name_ar") or member.get("name")
        # Invoice creation historically stored platform defaults.  When a
        # tenant has since configured its own saved branding, use it for those
        # default-valued records while preserving an explicitly issued custom
        # value on older invoices.
        tenant_branding = {}
        custom_tax_number = branch.get("tax_number") or tenant.get("tax_number")
        if custom_tax_number == DEFAULT_TAX_NUMBER:
            custom_tax_number = tenant.get("tax_number") or None
        custom_commercial_reg = (
            branch.get("commercial_reg") or tenant.get("commercial_reg")
        )
        if custom_commercial_reg == DEFAULT_COMMERCIAL_REG:
            custom_commercial_reg = tenant.get("commercial_reg") or None
        if custom_tax_number and invoice.get("tax_number") in (
            None, "", DEFAULT_TAX_NUMBER
        ):
            tenant_branding["tax_number"] = custom_tax_number
        if custom_commercial_reg and invoice.get("commercial_reg") in (
            None, "", DEFAULT_COMMERCIAL_REG
        ):
            tenant_branding["commercial_reg"] = custom_commercial_reg
        if tenant_slug != DEFAULT_TENANT_SLUG:
            if (
                render_invoice.get("company_name") in (None, "", DEFAULT_COMPANY_NAME)
            ):
                tenant_branding["company_name"] = (
                    (
                        branch.get("company_name")
                        if branch.get("company_name") != DEFAULT_COMPANY_NAME
                        else None
                    )
                    or tenant.get("name")
                    or "—"
                )
            if render_invoice.get("tax_number") in (None, "", DEFAULT_TAX_NUMBER):
                tenant_branding["tax_number"] = custom_tax_number or "—"
            if render_invoice.get("commercial_reg") in (None, "", DEFAULT_COMMERCIAL_REG):
                tenant_branding["commercial_reg"] = custom_commercial_reg or "—"
            tenant_branding["tenant_slug"] = tenant_slug
        if tenant_branding:
            if render_invoice is invoice:
                render_invoice = {**invoice}
            render_invoice.update(tenant_branding)
        message = build_invoice_text(render_invoice, branch, tenant)
        if provider == "whatsflow":
            from services.invoice_receipt_image import render_invoice_receipt_image

            try:
                caption = build_whatsflow_caption(render_invoice, branch, tenant)
            except CaptionLinkError:
                logger.exception(
                    "Invoice Whatsflow caption required content did not fit "
                    "for invoice=%s tenant=%s",
                    invoice.get("id") or invoice.get("invoice_number"),
                    tenant_slug,
                )
                return False
            image = await asyncio.to_thread(
                render_invoice_receipt_image, render_invoice, image_branch
            )
            # One media message, not a text followed by a separate attachment.
            # The formatter keeps all app/portal/branch URLs intact and trims
            # only detail lines when the provider's 1,024-character caption
            # limit requires it.  Full details remain in the image.
            try:
                success, _, error = await _send_whatsflow_media_result(
                    phone, "image", "image/png", caption,
                    base64.b64encode(image).decode("ascii"), "invoice.png",
                    config,
                )
            except Exception as exc:
                raise InvoiceReceiptDeliveryUnknown(type(exc).__name__) from exc
            if not success and not (
                error and re.fullmatch(r"http_4\d\d", error)
                and error not in {"http_408", "http_409"}
            ):
                raise InvoiceReceiptDeliveryUnknown(error or "unconfirmed_delivery")
        elif provider == "waha":
            success, _, _ = await _send_session_provider_result(phone, message, config)
        else:
            if not (provider == "meta_cloud" and config.get("phone_number_id") and config.get("access_token_encrypted")
                    and config.get("payment_template_name") and config.get("payment_template_confirmed")):
                return False
            payment_config = dict(config)
            payment_config["message_template_name"] = config["payment_template_name"]
            success = await _send_meta_cloud_message(phone, message, payment_config)
        try:
            await _db["whatsapp_send_log"].insert_one({
                "phone": phone.split("@")[0],
                "message": message,
                "success": success,
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "type": "invoice_payment_cloud",
                "branch_id": branch_id,
                "member_id": invoice.get("member_id"),
                "invoice_id": invoice.get("id"),
                "transport": provider,
            })
        except Exception as exc:
            logger.warning("Could not save payment WhatsApp log: %s", type(exc).__name__)
        return success
    except InvoiceReceiptDeliveryUnknown:
        raise
    except Exception as exc:
        logger.warning("Invoice payment WhatsApp notice failed: %s", type(exc).__name__)
        return False


async def _deliver_invoice_payment_outbox_item(item: dict) -> bool:
    coll = _db["whatsapp_invoice_payment_outbox"]
    claim_token = str(uuid.uuid4())
    if item.get("status") == "processing":
        # A worker can die after the provider accepts a receipt. Reclaiming and
        # sending again would duplicate a customer's payment notification.
        await coll.update_one(
            {
                "invoice_id": item["invoice_id"],
                "status": "processing",
                "claim_token": item.get("claim_token"),
                "claimed_at": item.get("claimed_at"),
            },
            {"$set": {
                "status": "unknown",
                "last_error": "worker_interrupted_delivery",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return False
    else:
        claim_filter = {
            "invoice_id": item["invoice_id"],
            "status": {"$in": ["pending", "failed"]},
            "attempts": {"$lt": 5},
        }
    claim = await coll.update_one(
        claim_filter,
        {"$set": {
            "status": "processing",
            "claim_token": claim_token,
            "claimed_at": datetime.now(timezone.utc).isoformat(),
            "last_attempt_at": datetime.now(timezone.utc).isoformat(),
        }, "$inc": {"attempts": 1}},
    )
    if getattr(claim, "modified_count", 0) == 0:
        return False
    error = None
    try:
        success = await send_invoice_payment_whatsapp_notice(item.get("invoice") or {})
    except InvoiceReceiptDeliveryUnknown as exc:
        success = False
        error = str(exc)
    await coll.update_one(
        {
            "invoice_id": item["invoice_id"],
            "status": "processing",
            "claim_token": claim_token,
        },
        {"$set": {
            "status": "unknown" if error else ("delivered" if success else "failed"),
            "last_error": error,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return success


async def process_invoice_payment_whatsapp_outbox() -> int:
    """Deliver/retry durable paid-invoice notices for the current tenant."""
    if _db is None:
        return 0
    coll = _db["whatsapp_invoice_payment_outbox"]
    await coll.create_index("invoice_id", unique=True)
    lease_cutoff = (
        datetime.now(timezone.utc) - timedelta(minutes=2)
    ).isoformat()
    items = await coll.find(
        {
            "attempts": {"$lt": 5},
            "$or": [
                {"status": {"$in": ["pending", "failed"]}},
                {"status": "processing", "claimed_at": {"$lt": lease_cutoff}},
            ],
        },
        {"_id": 0},
    ).sort("created_at", 1).to_list(20)
    delivered = 0
    for item in items:
        if await _deliver_invoice_payment_outbox_item(item):
            delivered += 1
    return delivered


async def queue_invoice_payment_whatsapp_notice(invoice: dict) -> bool:
    """Durably claim one receipt notice per invoice, then dispatch in background."""
    if _db is None or not invoice.get("id") or not invoice.get("branch_id"):
        return False
    config = await _get_branch_cloud_config(invoice["branch_id"])
    provider = _branch_provider(config)
    session_ready = provider in {"waha", "whatsflow"} and bool(
        config and config.get("enabled")
    )
    meta_ready = provider == "meta_cloud" and bool(
        config and config.get("enabled") and config.get("phone_number_id")
        and config.get("access_token_encrypted") and config.get("payment_template_name")
        and config.get("payment_template_confirmed")
    )
    if not (session_ready or meta_ready):
        return False
    coll = _db["whatsapp_invoice_payment_outbox"]
    await coll.create_index("invoice_id", unique=True)
    now = datetime.now(timezone.utc).isoformat()
    try:
        await coll.insert_one({
            "invoice_id": invoice["id"],
            "invoice": dict(invoice),
            "status": "pending",
            "attempts": 0,
            "created_at": now,
            "updated_at": now,
        })
    except DuplicateKeyError:
        return False
    asyncio.create_task(process_invoice_payment_whatsapp_outbox())
    return True


async def _send_wa_message_for_branch(
    phone: str,
    message: str,
    branch_id: Optional[str],
    quick_reply_payload: Optional[str] = None,
    *,
    automated: bool = True,
) -> bool:
    cloud_config = await _get_branch_cloud_config(branch_id)
    provider = _branch_provider(cloud_config)
    if provider == "disabled":
        return False
    if provider in {"waha", "whatsflow"}:
        success, _, _ = await _send_session_provider_result(
            phone, message, cloud_config or {}, automated=automated
        )
        return success
    if provider == "meta_cloud" and cloud_config and cloud_config.get("enabled"):
        if quick_reply_payload and cloud_config.get("renewal_contact_button_confirmed"):
            cloud_config = dict(cloud_config)
            cloud_config["_quick_reply_payload"] = quick_reply_payload
        return await _send_meta_cloud_message(phone, message, cloud_config)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(f"{WA_SERVICE_URL}/send", json={"phone": phone, "message": message})
            return r.status_code == 200 and r.json().get("success", False)
    except Exception as e:
        logger.error(f"Failed to send WhatsApp message: {e}")
        return False


async def _get_settings() -> dict:
    if _db is None:
        return DEFAULT_SETTINGS.copy()
    coll = _db["whatsapp_settings"]
    doc = await coll.find_one({})
    if doc:
        doc.pop("_id", None)
        # Merge defaults but DO NOT inject the default `offsets` for legacy
        # docs that never stored that field — otherwise the legacy
        # days_before/days_before_2/extra_offsets fallback in
        # `_normalize_offsets` is silently overridden.
        defaults = DEFAULT_SETTINGS.copy()
        if "offsets" not in doc:
            defaults.pop("offsets", None)
        return {**defaults, **doc}
    return DEFAULT_SETTINGS.copy()


async def _get_branch_templates() -> dict:
    """Load per-branch WhatsApp template overrides keyed by branch id.

    Returns {branch_id: {"renewal": str, "manual": str}} containing only
    non-empty overrides. Branches without an override (or members without a
    branch) fall back to the shared global templates at send time.
    """
    if _db is None:
        return {}
    out: dict = {}
    try:
        async for b in _db["branches"].find(
            {}, {"_id": 0, "id": 1, "whatsapp_renewal_template": 1, "whatsapp_manual_template": 1, "whatsapp_manual_expired_template": 1}
        ):
            bid = b.get("id")
            if not bid:
                continue
            entry = {}
            renewal = (b.get("whatsapp_renewal_template") or "").strip()
            manual = (b.get("whatsapp_manual_template") or "").strip()
            manual_expired = (b.get("whatsapp_manual_expired_template") or "").strip()
            if renewal:
                entry["renewal"] = renewal
            if manual:
                entry["manual"] = manual
            if manual_expired:
                entry["manual_expired"] = manual_expired
            if entry:
                out[bid] = entry
    except Exception as e:
        logger.error(f"Failed to load branch WhatsApp templates: {e}")
    return out


def _resolve_branch_template(branch_templates: dict, branch_id, kind: str, fallback: str) -> str:
    """Pick a branch's override for `kind` ('renewal'|'manual'), else fallback."""
    return ((branch_templates or {}).get(branch_id) or {}).get(kind) or fallback


async def _run_daily_reminders():
    global _reminders_running
    if _reminders_running:
        logger.info("WhatsApp reminders already running, skipping duplicate run")
        return
    _reminders_running = True
    try:
        await _do_daily_reminders()
    finally:
        _reminders_running = False


async def _get_expiring_members(days_before: int) -> list:
    """Return list of dicts {member, activity_name, end_date_str, end_date_fmt} for members expiring in exactly days_before days."""
    today = datetime.now(RIYADH_TZ).date()
    target_date = today + timedelta(days=days_before)
    target_str = target_date.strftime("%Y-%m-%d")
    target_fmt = target_date.strftime("%Y/%m/%d")

    members_coll = _db["members"]
    members = await members_coll.find({
        "activities": {
            "$elemMatch": {
                "status": "active",
                "end_date": {"$regex": f"^{target_str}"}
            }
        }
    }).to_list(length=None)

    results = []
    for member in members:
        expiring_activities = []
        fees = []
        for act in member.get("activities", []):
            if act.get("status") != "active":
                continue
            raw_end = act.get("end_date", "")
            end_date = str(raw_end)[:10] if raw_end else ""
            if end_date == target_str:
                expiring_activities.append(act.get("activity_name", ""))
                fee_val = act.get("fee") or act.get("amount") or 0
                try:
                    fees.append(float(fee_val))
                except Exception:
                    fees.append(0.0)
        if not expiring_activities:
            continue
        total_fee = sum(fees) if fees else 0.0
        # Show as int when no decimals (most fees are whole-number SAR)
        fee_str = str(int(total_fee)) if total_fee.is_integer() else f"{total_fee:.2f}"
        results.append({
            "member": member,
            "activity_name": "، ".join(filter(None, expiring_activities)),
            "expiring_activities": expiring_activities,
            "end_date_str": target_str,
            "end_date_fmt": target_fmt,
            "fee_str": fee_str,
        })
    return results


def _send_now_settings_fingerprint(settings: dict) -> str:
    """Fingerprint only settings that affect this send-now cohort/delivery."""
    relevant = {
        "enabled": bool(settings.get("enabled")),
        "offsets": _normalize_offsets(settings),
        "message_template": settings.get("message_template", ""),
        "templates": settings.get("templates") or {},
        "push_enabled": bool(settings.get("push_enabled", True)),
        "portal_enabled": bool(settings.get("portal_enabled", True)),
        "push_title_template": settings.get("push_title_template", ""),
        "push_body_template": settings.get("push_body_template", ""),
        "push_title_template_en": settings.get("push_title_template_en", ""),
        "push_body_template_en": settings.get("push_body_template_en", ""),
    }
    encoded = json.dumps(relevant, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _mapping_fingerprint(value: dict) -> str:
    encoded = json.dumps(value or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


async def _build_send_now_candidates(branch_id: Optional[str], enabled_offsets: list[int]) -> list:
    """Build activity-level candidates and use attendance's quota source of truth."""
    from .attendance import check_member_session_quota

    today = datetime.now(RIYADH_TZ).date()
    target_to_offset = {
        (today + timedelta(days=days)).strftime("%Y-%m-%d"): days
        for days in enabled_offsets
    }
    # Some older activities store an ISO timestamp rather than a bare date. A
    # single anchored regex handles both forms while keeping the DB-side cohort
    # narrow before the quota helper performs its more involved invoice reads.
    target_pattern = "^(" + "|".join(re.escape(day) for day in target_to_offset) + ")"
    query: dict = {
        "activities": {
            "$elemMatch": {
                "status": "active",
                "end_date": {"$regex": target_pattern},
            }
        }
    }
    if branch_id:
        query["branch_id"] = branch_id
    members = await _db["members"].find(query).to_list(length=None)
    members = [
        member for member in members
        if any(
            activity.get("status") == "active"
            and str(activity.get("end_date") or "")[:10] in target_to_offset
            for activity in (member.get("activities") or [])
        )
    ]

    branch_ids = {m.get("branch_id") for m in members if m.get("branch_id")}
    branch_names: dict = {}
    if branch_ids:
        async for branch in _db["branches"].find(
            {"id": {"$in": list(branch_ids)}}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1}
        ):
            branch_names[branch.get("id")] = branch.get("name_ar") or branch.get("name") or ""

    # One quota calculation per member obtains all activity cards. This reuses the
    # authoritative invoice-window/off-schedule logic instead of a raw attendance count.
    quota_lists = await asyncio.gather(*[
        check_member_session_quota(m.get("id", "")) for m in members
    ])
    quotas_by_member = {
        m.get("id", ""): quotas for m, quotas in zip(members, quota_lists)
    }

    candidates = []
    for member in members:
        member_id = member.get("id", "")
        quotas = quotas_by_member.get(member_id, [])
        for activity in member.get("activities", []) or []:
            raw_end = str(activity.get("end_date") or "")[:10]
            if activity.get("status") != "active" or raw_end not in target_to_offset:
                continue
            activity_id = activity.get("activity_id", "")
            start_date = str(activity.get("start_date") or "")[:10]
            exact_quota = next((
                q for q in quotas
                if q.get("activity_id") == activity_id
                and (
                    not start_date
                    or str(q.get("start_date") or "")[:10] == start_date
                )
                and str(q.get("end_date") or "")[:10] == raw_end
            ), None)
            if exact_quota is None:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"تعذر حساب حضور الاشتراك الحالي للعضو "
                        f"{member.get('name_ar') or member.get('name') or member_id}"
                    ),
                )
            fee_value = activity.get("fee") or activity.get("amount") or 0
            try:
                fee_value = float(fee_value)
            except (TypeError, ValueError):
                fee_value = 0.0
            candidates.append({
                "member_id": member_id,
                "member_name": member.get("name_ar") or member.get("name") or "",
                "phone": member.get("phone") or "",
                "activity_id": activity_id,
                "activity_name": activity.get("activity_name", ""),
                "start_date": start_date,
                "end_date": raw_end,
                "attended_sessions": int(exact_quota.get("used_sessions", 0)),
                "fee": fee_value,
                "branch_id": member.get("branch_id"),
                "branch_name": branch_names.get(member.get("branch_id"), ""),
                "days_before": target_to_offset[raw_end],
            })
    candidates.sort(key=lambda row: (
        row["end_date"], row["member_name"], row["member_id"], row["activity_id"]
    ))
    return candidates


def _candidate_identity(rows: list) -> list:
    """Canonical full send/render snapshot; any recipient mutation makes it stale."""
    fields = (
        "member_id", "member_name", "phone", "activity_id", "activity_name",
        "start_date", "end_date", "attended_sessions", "fee", "branch_id",
        "branch_name", "days_before",
    )
    return sorted(
        tuple(row.get(field) for field in fields)
        for row in rows
    )


def _send_now_reminder_count(rows: list) -> int:
    """One WhatsApp destination per branch, including shared family numbers."""
    return len({
        (row.get("branch_id"), _format_phone(row.get("phone") or "") or row.get("member_id"))
        for row in rows
    })


def _as_utc(value: datetime) -> datetime:
    """Mongo may return legacy naive UTC datetimes despite timezone-aware writes."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


async def _dispatch_send_now_snapshot(snapshot: dict, settings: dict):
    """Dispatch exactly the consumed activity cohort, grouped like the scheduler."""
    rows = snapshot.get("candidates") or []
    branch_templates = snapshot.get("branch_templates") or {}
    shared_template = settings.get("message_template", DEFAULT_SETTINGS["message_template"])
    per_offset_templates = settings.get("templates") or {}
    manual_settings = {**settings, "_manual_run": True}
    whatsapp_items = []

    for days in sorted({int(row["days_before"]) for row in rows}, reverse=True):
        grouped: dict = {}
        for row in rows:
            if int(row["days_before"]) != days:
                continue
            key = row["member_id"]
            item = grouped.setdefault(key, {
                # Use the validated frozen snapshot, not an unscoped live reload.
                "member": {
                    "id": row["member_id"],
                    "name": row["member_name"],
                    "name_ar": row["member_name"],
                    "phone": row["phone"],
                    "branch_id": row["branch_id"],
                },
                "activity_name": "",
                "expiring_activities": [],
                "end_date_str": row["end_date"],
                "end_date_fmt": row["end_date"].replace("-", "/"),
                "_fee": 0.0,
            })
            if row["activity_name"]:
                item["expiring_activities"].append(row["activity_name"])
            item["_fee"] += float(row.get("fee") or 0)
        members_data = []
        for item in grouped.values():
            item["activity_name"] = "، ".join(item["expiring_activities"])
            item["fee_str"] = (
                str(int(item["_fee"]))
                if item["_fee"].is_integer()
                else f"{item['_fee']:.2f}"
            )
            item.pop("_fee", None)
            members_data.append(item)
        if not members_data:
            continue
        channels = snapshot.get("channels") or []
        if "whatsapp" in channels:
            template = per_offset_templates.get(str(days)) or shared_template
            whatsapp_items.extend({**item, "_days_before": days, "_template": template} for item in members_data)
        if "push" in channels:
            await _send_push_for_members(members_data, days, manual_settings)
        if "portal" in channels:
            await _send_portal_for_members(members_data, days, manual_settings)
    if whatsapp_items:
        await _send_wa_for_members(
            whatsapp_items, 0, shared_template, manual=True, branch_templates=branch_templates
        )


def _render_template(template: str, *, name: str, activity: str, days, end_date: str, fee: str = "") -> str:
    """Interpolate the standard reminder placeholders, including {fee}."""
    return (
        (template or "")
        .replace("{name}", name or "")
        .replace("{activity}", activity or "")
        .replace("{days}", str(days) if days is not None else "")
        .replace("{end_date}", end_date or "")
        .replace("{fee}", fee or "")
    )


async def _record_renewal_reminder(
    member_id: str,
    activity_name: str,
    channel: str,
    days_before: Optional[int],
    manual: bool,
    success: bool,
    sent_by: Optional[dict] = None,
):
    """Insert an audit row into renewal_reminder_log for last-reminder tracking.

    `sent_by` is the actor that triggered the reminder (admin user dict for
    manual sends, or None/{"system": True} for the daily scheduler).
    """
    if _db is None or not member_id:
        return
    try:
        actor = None
        if sent_by:
            actor = {
                "id": sent_by.get("id") or sent_by.get("_id"),
                "username": sent_by.get("username"),
                "name": sent_by.get("name") or sent_by.get("full_name"),
            }
        elif not manual:
            actor = {"system": True}
        await _db["renewal_reminder_log"].insert_one({
            "member_id": member_id,
            "activity_name": activity_name or "",
            "channel": channel,
            "days_before": days_before,
            "manual": bool(manual),
            "success": bool(success),
            "sent_by": actor,
            "timestamp": datetime.now(RIYADH_TZ).isoformat(),
        })
    except Exception as e:
        logger.error(f"Failed to record reminder log: {e}")


async def _send_wa_for_members(members_data: list, days_before: int, template: str, manual: bool = False, branch_templates: dict = None) -> int:
    """Send WhatsApp reminder messages. Returns count of successful sends.

    `branch_templates` (from `_get_branch_templates`) lets each member's branch
    override the renewal text; members without an override use `template`.
    """
    sent_count = 0
    groups = {}
    for item in members_data:
        phone_key = _format_phone(item["member"].get("phone", ""))
        if phone_key:
            groups.setdefault((item["member"].get("branch_id"), phone_key), []).append(item)
    for (_, phone_key), source_items in groups.items():
        item = source_items[0]
        member = item["member"]
        phone = member.get("phone", "")
        if not phone:
            continue
        name = member.get("name", "")
        activity_name = item["activity_name"]
        end_date_fmt = item["end_date_fmt"]
        member_template = _resolve_branch_template(
            branch_templates, member.get("branch_id"), "renewal", template
        )
        arabic_parts, english_parts = [], []
        seen_parts = set()
        for source in source_items:
            source_member = source["member"]
            source_days = source.get("_days_before", days_before)
            source_template = _resolve_branch_template(
                branch_templates, source_member.get("branch_id"), "renewal",
                source.get("_template", template),
            )
            source_name = source_member.get("name_ar") or source_member.get("name", "")
            part = _render_template(
                source_template, name=source_name, activity=source["activity_name"],
                days=source_days, end_date=source["end_date_fmt"], fee=source.get("fee_str", ""),
            )
            part = _append_english_section(
                _ensure_renewal_arabic_date(part, source["end_date_fmt"]),
                _renewal_english_summary(name=source_name, activity=source["activity_name"],
                    end_date=source["end_date_fmt"], days_remaining=source_days),
            )
            if part in seen_parts:
                continue
            seen_parts.add(part)
            ar, _, en = part.partition(BILINGUAL_ENGLISH_MARKER)
            arabic_parts.append(ar.strip())
            english_parts.append(en.strip())
        message = _append_english_section(
            "\n\n".join(arabic_parts), "\n\n".join(english_parts)
        )
        wa_phone = _format_phone(phone)
        if wa_phone:
            branch_id = member.get("branch_id")
            success = await _send_wa_message_for_branch(
                wa_phone,
                message,
                branch_id,
                quick_reply_payload="CONTACT_US",
            )
            log_entry = {
                "timestamp": datetime.now(RIYADH_TZ).isoformat(),
                "member_id": member.get("id", ""),
                "member_name": name,
                "phone": phone,
                "activities": "، ".join(dict.fromkeys(s["activity_name"] for s in source_items)),
                "success": success,
                "days_before": days_before,
                "manual": manual,
                "type": "renewal_reminder",
                "branch_id": branch_id,
                "transport": _branch_provider(await _get_branch_cloud_config(branch_id)),
            }
            await _db["whatsapp_send_log"].insert_one(log_entry)
            # Log per-individual-activity so the Renewals page can match
            # last-reminder badges by (member_id, activity_name) precisely.
            logged = set()
            for source in source_items:
                for act_name in (source.get("expiring_activities") or [source["activity_name"]]):
                    identity = (source["member"].get("id", ""), act_name)
                    if identity in logged:
                        continue
                    logged.add(identity)
                    await _record_renewal_reminder(
                        member_id=identity[0], activity_name=act_name,
                        channel="whatsapp", days_before=source.get("_days_before", days_before),
                        manual=manual, success=success,
                    )
            if success:
                sent_count += 1
                logger.info(f"WhatsApp reminder ({days_before}d) sent to {name} ({phone})")
            await asyncio.sleep(30)
    return sent_count


async def _send_push_for_members(members_data: list, days_before: int, settings: dict) -> int:
    """Send push notifications to members with expiring subscriptions. Returns count of successful sends."""
    from .push_notifications import send_push_notification, NotificationPayload

    push_title_tmpl = settings.get("push_title_template", DEFAULT_SETTINGS["push_title_template"])
    push_body_tmpl = settings.get("push_body_template", DEFAULT_SETTINGS["push_body_template"])
    push_title_tmpl_en = settings.get("push_title_template_en", DEFAULT_SETTINGS["push_title_template_en"])
    push_body_tmpl_en = settings.get("push_body_template_en", DEFAULT_SETTINGS["push_body_template_en"])

    sent_count = 0
    for item in members_data:
        member = item["member"]
        member_id = member.get("id", "")
        if not member_id:
            continue
        name = member.get("name", "")
        activity_name = item["activity_name"]
        end_date_fmt = item["end_date_fmt"]

        fee_str = item.get("fee_str", "")
        title = _render_template(push_title_tmpl, name=name, activity=activity_name,
                                 days=days_before, end_date=end_date_fmt, fee=fee_str)
        body = _render_template(push_body_tmpl, name=name, activity=activity_name,
                                days=days_before, end_date=end_date_fmt, fee=fee_str)
        # Render English variants too — send_push_notification swaps them in
        # for subscribers whose saved language is 'en'. Falls back to the
        # Arabic copy when the recipient's language is unknown.
        title_en = _render_template(push_title_tmpl_en, name=name, activity=activity_name,
                                    days=days_before, end_date=end_date_fmt, fee=fee_str)
        body_en = _render_template(push_body_tmpl_en, name=name, activity=activity_name,
                                   days=days_before, end_date=end_date_fmt, fee=fee_str)

        payload = NotificationPayload(
            title=title,
            body=body,
            title_en=title_en,
            body_en=body_en,
            url="/portal/notifications",
            tag=f"expiry-{member_id}-{item['end_date_str']}",
        )

        subscriptions = await _db["push_subscriptions"].find(
            {"member_id": member_id, "is_active": True},
            {"_id": 0}
        ).to_list(20)

        any_ok = False
        for sub in subscriptions:
            try:
                ok = await send_push_notification(sub, payload)
                if ok:
                    sent_count += 1
                    any_ok = True
            except Exception as e:
                logger.error(f"Push expiry reminder failed for {name}: {e}")
        if subscriptions:
            for act_name in (item.get("expiring_activities") or [activity_name]):
                await _record_renewal_reminder(
                    member_id=member_id,
                    activity_name=act_name,
                    channel="push",
                    days_before=days_before,
                    manual=settings.get("_manual_run", False),
                    success=any_ok,
                )
    return sent_count


async def _send_portal_for_members(members_data: list, days_before: int, settings: dict) -> int:
    """Insert portal (member_notifications) entries for expiring members. Returns count inserted."""
    inserted_count = 0
    for item in members_data:
        member = item["member"]
        member_id = member.get("id", "")
        if not member_id:
            continue
        name = member.get("name", "")
        activity_name = item["activity_name"]
        end_date_str = item["end_date_str"]

        dedup_key = f"expiry-{member_id}-{end_date_str}-{days_before}"
        existing = await _db["member_notifications"].find_one({"dedup_key": dedup_key})
        if existing:
            continue

        if days_before == 0:
            title_ar = "⚠️ اشتراكك ينتهي اليوم!"
        elif days_before == 1:
            title_ar = "🔴 اشتراكك ينتهي غداً!"
        else:
            title_ar = f"🔔 اشتراكك ينتهي خلال {days_before} أيام"

        notification = {
            "id": str(uuid.uuid4()),
            "member_id": member_id,
            "type": "expiry_reminder",
            "title_ar": title_ar,
            "title": title_ar,
            "message_ar": f"اشتراكك في {activity_name} سينتهي في {end_date_str}",
            "message": f"اشتراكك في {activity_name} سينتهي في {end_date_str}",
            "priority": "warning",
            "dedup_key": dedup_key,
            "is_read": False,
            "created_at": datetime.now(RIYADH_TZ).isoformat(),
        }
        await _db["member_notifications"].insert_one(notification)
        for act_name in (item.get("expiring_activities") or [activity_name]):
            await _record_renewal_reminder(
                member_id=member_id,
                activity_name=act_name,
                channel="portal",
                days_before=days_before,
                manual=settings.get("_manual_run", False),
                success=True,
            )
        inserted_count += 1
    return inserted_count


async def _do_daily_reminders():
    if _db is None:
        return
    settings = await _get_settings()
    if not settings.get("enabled"):
        return

    template = settings.get("message_template", DEFAULT_SETTINGS["message_template"])
    per_offset_templates = settings.get("templates") or {}
    branch_templates = await _get_branch_templates()

    wa_status = await _get_wa_status()
    wa_connected = wa_status.get("connected", False) or await _has_enabled_cloud_config()
    push_enabled = settings.get("push_enabled", True)
    portal_enabled = settings.get("portal_enabled", True)

    if not wa_connected:
        logger.info("WhatsApp not connected — skipping WhatsApp channel (push/portal still active)")

    # Iterate every enabled offset (includes T-0 day-of-expiry)
    days_set = [it["days"] for it in _normalize_offsets(settings) if it.get("enabled")]

    total_wa = 0
    total_push = 0
    total_portal = 0
    whatsapp_items = []

    for days in days_set:
        members_data = await _get_expiring_members(days)
        if not members_data:
            continue

        if wa_connected:
            # Per-offset override falls back to the shared template.
            tpl_for_offset = per_offset_templates.get(str(days)) or template
            whatsapp_items.extend({**item, "_days_before": days, "_template": tpl_for_offset} for item in members_data)

        if push_enabled:
            try:
                total_push += await _send_push_for_members(members_data, days, settings)
            except Exception as e:
                logger.error(f"Push expiry reminders error (days={days}): {e}")

        if portal_enabled:
            try:
                total_portal += await _send_portal_for_members(members_data, days, settings)
            except Exception as e:
                logger.error(f"Portal expiry reminders error (days={days}): {e}")

    if whatsapp_items:
        total_wa = await _send_wa_for_members(whatsapp_items, 0, template, branch_templates=branch_templates)
    logger.info(f"Daily reminders done — WhatsApp={total_wa}, Push={total_push}, Portal={total_portal}")


async def _scheduler_loop():
    global _scheduler_started
    _scheduler_started = True
    logger.info("WhatsApp scheduler started (timezone: Asia/Riyadh)")
    from utils.tenant import list_active_tenants, set_current_tenant, reset_current_tenant
    while True:
        try:
            now = datetime.now(RIYADH_TZ)
            scheduled = []
            for tenant in await list_active_tenants():
                token = set_current_tenant(tenant)
                try:
                    settings = await _get_settings()
                    send_hour = max(0, min(23, int(settings.get("send_hour", 9))))
                except Exception as exc:
                    logger.error(
                        "WhatsApp scheduler tenant=%s settings error: %s",
                        tenant.get("slug"), type(exc).__name__,
                    )
                    continue
                finally:
                    reset_current_tenant(token)
                next_run = now.replace(
                    hour=send_hour, minute=0, second=0, microsecond=0
                )
                if next_run <= now:
                    next_run += timedelta(days=1)
                scheduled.append((next_run, tenant))

            if not scheduled:
                await asyncio.sleep(300)
                continue

            next_run = min(item[0] for item in scheduled)
            wait_seconds = max(0, (next_run - now).total_seconds())
            logger.info(
                "WhatsApp scheduler: next tenant run in %.0fs at %s Riyadh time",
                wait_seconds, next_run.strftime("%H:%M"),
            )
            # Re-read tenant settings periodically so a changed send hour or a
            # newly-created tenant takes effect without restarting the app.
            if wait_seconds > 300:
                await asyncio.sleep(300)
                continue
            await asyncio.sleep(wait_seconds)
            for tenant_run, tenant in scheduled:
                if abs((tenant_run - next_run).total_seconds()) > 1:
                    continue
                token = set_current_tenant(tenant)
                try:
                    await _run_daily_reminders()
                except Exception as exc:
                    logger.error(
                        "WhatsApp scheduler tenant=%s run error: %s",
                        tenant.get("slug"), type(exc).__name__,
                    )
                finally:
                    reset_current_tenant(token)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"WhatsApp scheduler error: {e}")
            await asyncio.sleep(3600)


_admin_alert_started = False

# Max notifications forwarded to the manager per tenant per cycle; anything
# older in the same batch is dropped (cursor advances past it) so a backlog
# can never flood the manager's WhatsApp.
ADMIN_ALERT_BATCH_LIMIT = 5


async def _forward_admin_alerts_for_current_tenant():
    """Forward NEW admin bell notifications to the manager's WhatsApp.

    Cursor (`admin_alert_last_ts` on the whatsapp_settings doc) tracks the
    last forwarded notification's created_at. First run initializes it to now
    so history is never replayed. When WhatsApp is disconnected nothing is
    sent and the cursor doesn't move; on reconnect only the newest
    ADMIN_ALERT_BATCH_LIMIT items go out and the cursor jumps past the rest.
    """
    settings = await _get_settings()
    if not settings.get("admin_alert_enabled"):
        return
    phone = (settings.get("admin_alert_phone") or "").strip()
    if not phone:
        return

    coll = _db["whatsapp_settings"]
    last_ts = settings.get("admin_alert_last_ts")
    now_iso = datetime.now(timezone.utc).isoformat()
    if not last_ts:
        await coll.update_one({}, {"$set": {"admin_alert_last_ts": now_iso}}, upsert=True)
        return

    fresh = await _db["notifications"].find(
        {"created_at": {"$gt": last_ts}},
        {"_id": 0, "title_ar": 1, "title": 1, "message_ar": 1, "message": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(200)
    if not fresh:
        return

    wa_status = await _get_wa_status()
    if not wa_status.get("connected", False):
        return  # keep cursor; retry when the bot reconnects

    newest_ts = max(str(n.get("created_at") or "") for n in fresh)
    to_send = fresh[-ADMIN_ALERT_BATCH_LIMIT:]
    dropped = len(fresh) - len(to_send)

    wa_phone = _format_phone(phone)
    sent = 0
    for n in to_send:
        title = n.get("title_ar") or n.get("title") or "إشعار جديد"
        body = n.get("message_ar") or n.get("message") or ""
        message = f"🔔 {title}\n{body}".strip()
        if await _send_wa_message(wa_phone, message):
            sent += 1
            # Advance cursor per success so a mid-batch failure retries the
            # rest. $max keeps advancement monotonic (ISO strings compare
            # lexicographically) even if another writer raced us.
            await coll.update_one(
                {}, {"$max": {"admin_alert_last_ts": str(n.get("created_at") or now_iso)}}, upsert=True
            )
        else:
            logger.error("Admin WA alert send failed — will retry next cycle")
            return
    if dropped:
        await coll.update_one({}, {"$max": {"admin_alert_last_ts": newest_ts}}, upsert=True)
        logger.info(f"Admin WA alerts: sent {sent}, skipped {dropped} older backlog items")


async def _admin_alert_loop():
    global _admin_alert_started
    _admin_alert_started = True
    logger.info("WhatsApp admin-alert forwarder started (every 60s)")
    from utils.tenant import list_active_tenants, set_current_tenant, reset_current_tenant
    while True:
        try:
            await asyncio.sleep(60)
            tenants = await list_active_tenants()
            for tenant in tenants:
                token = set_current_tenant(tenant)
                try:
                    await _forward_admin_alerts_for_current_tenant()
                except Exception as e:
                    logger.error(f"Admin WA alert tenant={tenant.get('slug')} error: {e}")
                finally:
                    reset_current_tenant(token)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Admin WA alert loop error: {e}")
            await asyncio.sleep(300)


async def _invoice_payment_outbox_loop():
    global _invoice_payment_outbox_started
    _invoice_payment_outbox_started = True
    logger.info("WhatsApp invoice-payment outbox started (every 60s)")
    from utils.tenant import list_active_tenants, set_current_tenant, reset_current_tenant
    while True:
        try:
            await asyncio.sleep(60)
            tenants = await list_active_tenants()
            for tenant in tenants:
                token = set_current_tenant(tenant)
                try:
                    await process_invoice_payment_whatsapp_outbox()
                except Exception as exc:
                    logger.error(
                        "Payment WhatsApp outbox tenant=%s error: %s",
                        tenant.get("slug"), type(exc).__name__,
                    )
                finally:
                    reset_current_tenant(token)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("Payment WhatsApp outbox loop error: %s", type(exc).__name__)
            await asyncio.sleep(60)


async def _class_reminder_loop():
    global _class_reminder_started
    _class_reminder_started = True
    logger.info("WhatsApp class-reminder worker started (every 60s)")
    from utils.tenant import for_each_active_tenant
    while True:
        try:
            await for_each_active_tenant(
                lambda _tenant: process_class_reminders(),
                label="whatsapp-class-reminders",
            )
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("Class reminder loop error: %s", type(exc).__name__)
            await asyncio.sleep(60)


def start_scheduler():
    global _scheduler_started
    if not _scheduler_started:
        asyncio.ensure_future(_scheduler_loop())
    # This queue covers automatic campaign text and media only. Transactional
    # reminders/notices retain their existing delivery paths and are not gated.
    whatsapp_bulk_jobs.start_worker()
    registration_followups.start_worker()
    campaign_inquiry_automation.start_worker()
    if not _admin_alert_started:
        asyncio.ensure_future(_admin_alert_loop())
    if not _invoice_payment_outbox_started:
        asyncio.ensure_future(_invoice_payment_outbox_loop())
    if not _class_reminder_started:
        asyncio.ensure_future(_class_reminder_loop())
    start_media_archive_worker()


@router.get("/status")
async def get_status(current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    return await _get_wa_status()


@router.get("/settings")
async def get_settings_endpoint(current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    return await _get_settings()


class WhatsAppSettings(BaseModel):
    enabled: Optional[bool] = None
    days_before: Optional[int] = None
    days_before_2: Optional[int] = None
    reminder_2_enabled: Optional[bool] = None
    # New offsets model: list of {days: 0..60, enabled: bool}.
    offsets: Optional[List[dict]] = None
    message_template: Optional[str] = None
    # Per-offset overrides: {"<days>": "<template>"} — empty/missing falls
    # back to the shared `message_template`.
    templates: Optional[dict] = None
    manual_reminder_template: Optional[str] = None
    manual_reminder_expired_template: Optional[str] = None
    welcome_template: Optional[str] = None
    send_hour: Optional[int] = None
    push_enabled: Optional[bool] = None
    portal_enabled: Optional[bool] = None
    push_title_template: Optional[str] = None
    push_body_template: Optional[str] = None
    admin_alert_enabled: Optional[bool] = None
    admin_alert_phone: Optional[str] = None


@router.put("/settings")
async def update_settings(data: WhatsAppSettings, current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    if data.days_before is not None and not (1 <= data.days_before <= 30):
        raise HTTPException(status_code=400, detail="days_before must be between 1 and 30")
    if data.days_before_2 is not None and not (1 <= data.days_before_2 <= 30):
        raise HTTPException(status_code=400, detail="days_before_2 must be between 1 and 30")
    if data.send_hour is not None and not (0 <= data.send_hour <= 23):
        raise HTTPException(status_code=400, detail="send_hour must be between 0 and 23")
    if data.message_template is not None and len(data.message_template) > 1000:
        raise HTTPException(status_code=400, detail="message_template must not exceed 1000 characters")
    if data.manual_reminder_template is not None and len(data.manual_reminder_template) > 1000:
        raise HTTPException(status_code=400, detail="manual_reminder_template must not exceed 1000 characters")
    if data.manual_reminder_expired_template is not None and len(data.manual_reminder_expired_template) > 1000:
        raise HTTPException(status_code=400, detail="manual_reminder_expired_template must not exceed 1000 characters")
    if data.welcome_template is not None and len(data.welcome_template) > 1000:
        raise HTTPException(status_code=400, detail="welcome_template must not exceed 1000 characters")
    if data.templates is not None:
        cleaned_tpl: dict = {}
        for k, v in data.templates.items():
            try:
                kd = int(k)
            except Exception:
                raise HTTPException(status_code=400, detail="templates keys must be integer offset days")
            if not (0 <= kd <= 60):
                raise HTTPException(status_code=400, detail="templates keys must be between 0 and 60")
            if v is None or v == "":
                continue  # Empty/missing -> falls back to shared template
            if not isinstance(v, str):
                raise HTTPException(status_code=400, detail="templates values must be strings")
            if len(v) > 1000:
                raise HTTPException(status_code=400, detail="templates entry must not exceed 1000 characters")
            cleaned_tpl[str(kd)] = v
        data.templates = cleaned_tpl
    if data.offsets is not None:
        cleaned: list = []
        seen: set = set()
        for o in data.offsets:
            if not isinstance(o, dict) or "days" not in o:
                continue
            try:
                di = int(o["days"])
            except Exception:
                continue
            if not (0 <= di <= 60):
                raise HTTPException(status_code=400, detail="offsets.days must be between 0 and 60")
            if di in seen:
                continue
            seen.add(di)
            cleaned.append({"days": di, "enabled": bool(o.get("enabled", True))})
        # Sort descending so longer offsets fire first (T-7, T-3, T-1, T-0)
        cleaned.sort(key=lambda x: -x["days"])
        data.offsets = cleaned[:10]  # cap at 10 offsets
    # Manager-alert destination is sensitive (receives every bell notification,
    # incl. member messages) — only academy admins may change it. Non-admin
    # saves that merely echo the stored values back (the settings form sends
    # the whole object) are allowed; actual changes are rejected.
    if not current_user.get("is_admin") and (
        data.admin_alert_enabled is not None or data.admin_alert_phone is not None
    ):
        stored = await _get_settings()
        changed = (
            (data.admin_alert_enabled is not None
             and bool(data.admin_alert_enabled) != bool(stored.get("admin_alert_enabled")))
            or (data.admin_alert_phone is not None
                and data.admin_alert_phone.strip() != (stored.get("admin_alert_phone") or "").strip())
        )
        if changed:
            raise HTTPException(status_code=403, detail="تغيير تنبيهات المدير متاح للمدير فقط")
        data.admin_alert_enabled = None
        data.admin_alert_phone = None
    coll = _db["whatsapp_settings"]
    update = {k: v for k, v in data.dict().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    if data.admin_alert_enabled:
        # Baseline at enable time: forward only notifications created from now
        # on; never replay history produced before/while the feature was off.
        update["admin_alert_last_ts"] = datetime.now(timezone.utc).isoformat()
    await coll.update_one({}, {"$set": update}, upsert=True)
    return await _get_settings()


class SendTestRequest(BaseModel):
    phone: str
    message: Optional[str] = None
    branch_id: Optional[str] = None


class BranchCloudConfigUpdate(BaseModel):
    enabled: bool = True
    provider: Optional[str] = None
    phone_number_id: str = ""
    waha_session_name: Optional[str] = ""
    waha_daily_limit: int = 30
    whatsflow_instance: Optional[str] = ""
    whatsflow_api_key: Optional[str] = None
    whatsapp_business_account_id: Optional[str] = ""
    access_token: Optional[str] = None
    graph_api_version: str = "v23.0"
    message_template_name: Optional[str] = ""
    template_language: str = "ar"
    single_variable_template_confirmed: bool = False
    renewal_contact_button_confirmed: bool = False
    app_secret: Optional[str] = None
    inbox_enabled: bool = False
    image_template_name: Optional[str] = ""
    document_template_name: Optional[str] = ""
    media_templates_confirmed: bool = False
    attendance_template_name: Optional[str] = ""
    attendance_template_confirmed: bool = False
    payment_template_name: Optional[str] = ""
    payment_template_confirmed: bool = False
    class_reminder_template_name: Optional[str] = ""
    class_reminder_template_confirmed: bool = False
    schedule_update_template_name: Optional[str] = ""
    schedule_update_template_confirmed: bool = False


class WAHABranchTestRequest(BaseModel):
    phone: str
    message: Optional[str] = None


def _require_admin(current_user: dict):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")


@router.get("/branch-cloud/jobs")
async def list_branch_cloud_jobs(
    branch_id: str, current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    _assert_branch_access(current_user, branch_id)
    return await whatsapp_bulk_jobs.list_jobs(branch_id)


@router.get("/branch-cloud/{branch_id}")
async def get_branch_cloud_config(
    branch_id: str, current_user: dict = Depends(get_current_user)
):
    _require_admin(current_user)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    branch = await _db["branches"].find_one({"id": branch_id}, {"_id": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    config = await _get_branch_cloud_config(branch_id)
    if not config:
        return {
            "branch_id": branch_id,
            "enabled": False,
            "provider": "legacy",
            "waha_session_name": "",
            "waha_daily_limit": 30,
            "whatsflow_instance": "",
            "whatsflow_api_key_configured": False,
            "whatsflow_webhook_secret_configured": False,
            "phone_number_id": "",
            "whatsapp_business_account_id": "",
            "graph_api_version": "v23.0",
            "message_template_name": "",
            "template_language": "ar",
            "single_variable_template_confirmed": False,
            "renewal_contact_button_confirmed": False,
            "app_secret_configured": False,
            "inbox_enabled": False,
            "image_template_name": "",
            "document_template_name": "",
            "media_templates_confirmed": False,
            "attendance_template_name": "",
            "attendance_template_confirmed": False,
            "payment_template_name": "",
            "payment_template_confirmed": False,
            "class_reminder_template_name": "",
            "class_reminder_template_confirmed": False,
            "schedule_update_template_name": "",
            "schedule_update_template_confirmed": False,
            "token_configured": False,
        }
    return {
        "branch_id": branch_id,
        "enabled": bool(config.get("enabled")),
        "provider": _branch_provider(config),
        "waha_session_name": config.get("waha_session_name") or "",
        "waha_daily_limit": int(config.get("waha_daily_limit") or 30),
        "whatsflow_instance": config.get("whatsflow_instance") or "",
        "whatsflow_api_key_configured": bool(config.get("whatsflow_api_key_encrypted")),
        "whatsflow_webhook_secret_configured": _branch_provider(config) == "whatsflow",
        "phone_number_id": config.get("phone_number_id") or "",
        "whatsapp_business_account_id": config.get("whatsapp_business_account_id") or "",
        "graph_api_version": config.get("graph_api_version") or "v23.0",
        "message_template_name": config.get("message_template_name") or "",
        "template_language": config.get("template_language") or "ar",
        "single_variable_template_confirmed": bool(
            config.get("single_variable_template_confirmed")
        ),
        "renewal_contact_button_confirmed": bool(
            config.get("renewal_contact_button_confirmed")
        ),
        "app_secret_configured": bool(config.get("app_secret_encrypted")),
        "inbox_enabled": bool(config.get("inbox_enabled")),
        "image_template_name": config.get("image_template_name") or "",
        "document_template_name": config.get("document_template_name") or "",
        "media_templates_confirmed": bool(config.get("media_templates_confirmed")),
        "attendance_template_name": config.get("attendance_template_name") or "",
        "attendance_template_confirmed": bool(config.get("attendance_template_confirmed")),
        "payment_template_name": config.get("payment_template_name") or "",
        "payment_template_confirmed": bool(config.get("payment_template_confirmed")),
        "class_reminder_template_name": config.get("class_reminder_template_name") or "",
        "class_reminder_template_confirmed": bool(config.get("class_reminder_template_confirmed")),
        "schedule_update_template_name": config.get("schedule_update_template_name") or "",
        "schedule_update_template_confirmed": bool(config.get("schedule_update_template_confirmed")),
        "token_configured": bool(config.get("access_token_encrypted")),
        "updated_at": config.get("updated_at"),
    }


@router.put("/branch-cloud/{branch_id}")
async def update_branch_cloud_config(
    branch_id: str,
    data: BranchCloudConfigUpdate,
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    branch = await _db["branches"].find_one({"id": branch_id}, {"_id": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    existing = await _get_branch_cloud_config(branch_id) or {}
    # A legacy settings form posting Meta fields remains a Meta configuration.
    provider_was_explicit = data.provider is not None
    if provider_was_explicit:
        provider = data.provider
    elif existing.get("provider_explicit") and existing.get("provider") in {
        "meta_cloud", "waha", "whatsflow", "legacy", "disabled"
    }:
        provider = existing["provider"]
    elif existing.get("provider") in {"meta_cloud", "waha", "whatsflow", "disabled"}:
        provider = existing["provider"]
    elif (
        data.phone_number_id or data.access_token
        or existing.get("phone_number_id") or existing.get("access_token_encrypted")
    ):
        provider = "meta_cloud"
    else:
        provider = "legacy"
    if provider not in {"meta_cloud", "waha", "whatsflow", "legacy", "disabled"}:
        raise HTTPException(status_code=400, detail="Invalid WhatsApp provider")
    if not 1 <= data.waha_daily_limit <= 1000:
        raise HTTPException(status_code=400, detail="waha_daily_limit must be between 1 and 1000")
    phone_number_id = "".join(filter(str.isdigit, data.phone_number_id or ""))
    waba_id = "".join(filter(str.isdigit, data.whatsapp_business_account_id or ""))
    version = (data.graph_api_version or "v23.0").strip()
    if provider == "meta_cloud" and not phone_number_id:
        raise HTTPException(status_code=400, detail="Phone Number ID is required")
    if provider == "meta_cloud" and (not version.startswith("v") or not version[1:].replace(".", "").isdigit()):
        raise HTTPException(status_code=400, detail="Invalid Graph API version")
    session_name = (data.waha_session_name or "").strip()
    if provider == "waha" and not session_name:
        raise HTTPException(status_code=400, detail="WAHA session name is required")
    if session_name and not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", session_name):
        raise HTTPException(status_code=400, detail="Invalid WAHA session name")
    whatsflow_instance = (data.whatsflow_instance or "").strip()
    if provider == "whatsflow" and not whatsflow_instance:
        raise HTTPException(status_code=400, detail="Whatsflow instance is required")
    if whatsflow_instance and not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", whatsflow_instance):
        raise HTTPException(status_code=400, detail="Invalid Whatsflow instance")
    update = {
        "branch_id": branch_id,
        "enabled": bool(data.enabled),
        "provider": provider,
        "provider_explicit": bool(provider_was_explicit or existing.get("provider_explicit")),
        "waha_session_name": session_name,
        "waha_physical_session_id": (
            _waha_physical_session_id(branch_id, session_name) if provider == "waha" else
            existing.get("waha_physical_session_id")
        ),
        "waha_daily_limit": data.waha_daily_limit,
        "whatsflow_instance": whatsflow_instance,
        "phone_number_id": phone_number_id,
        "whatsapp_business_account_id": waba_id,
        "graph_api_version": version,
        "message_template_name": (data.message_template_name or "").strip(),
        "template_language": (data.template_language or "ar").strip(),
        "single_variable_template_confirmed": bool(
            data.single_variable_template_confirmed
        ),
        "renewal_contact_button_confirmed": bool(
            data.renewal_contact_button_confirmed
        ),
        "inbox_enabled": bool(data.inbox_enabled),
        "image_template_name": (data.image_template_name or "").strip(),
        "document_template_name": (data.document_template_name or "").strip(),
        "media_templates_confirmed": bool(data.media_templates_confirmed),
        "attendance_template_name": (data.attendance_template_name or "").strip(),
        "attendance_template_confirmed": bool(data.attendance_template_confirmed),
        "payment_template_name": (data.payment_template_name or "").strip(),
        "payment_template_confirmed": bool(data.payment_template_confirmed),
        "class_reminder_template_name": (data.class_reminder_template_name or "").strip(),
        "class_reminder_template_confirmed": bool(data.class_reminder_template_confirmed),
        "schedule_update_template_name": (data.schedule_update_template_name or "").strip(),
        "schedule_update_template_confirmed": bool(data.schedule_update_template_confirmed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": current_user.get("user_id") or current_user.get("id"),
    }
    if data.access_token and data.access_token.strip():
        update["access_token_encrypted"] = _encrypt_access_token(data.access_token.strip())
    elif existing.get("access_token_encrypted"):
        update["access_token_encrypted"] = existing["access_token_encrypted"]
    elif data.enabled and provider == "meta_cloud":
        raise HTTPException(status_code=400, detail="Access Token is required")
    if data.app_secret and data.app_secret.strip():
        update["app_secret_encrypted"] = _encrypt_access_token(data.app_secret.strip())
    elif existing.get("app_secret_encrypted"):
        update["app_secret_encrypted"] = existing["app_secret_encrypted"]
    elif data.inbox_enabled and provider == "meta_cloud":
        raise HTTPException(
            status_code=400,
            detail="Meta App Secret is required to enable the inbox",
        )
    if data.whatsflow_api_key and data.whatsflow_api_key.strip():
        update["whatsflow_api_key_encrypted"] = _encrypt_access_token(
            data.whatsflow_api_key.strip()
        )
    elif existing.get("whatsflow_api_key_encrypted"):
        update["whatsflow_api_key_encrypted"] = existing["whatsflow_api_key_encrypted"]
    elif data.enabled and provider == "whatsflow":
        raise HTTPException(status_code=400, detail="Whatsflow API key is required")
    await _db["whatsapp_branch_configs"].update_one(
        {"branch_id": branch_id}, {"$set": update}, upsert=True
    )
    return await get_branch_cloud_config(branch_id, current_user)


def _waha_config_for_branch(config: Optional[dict]) -> bool:
    return bool(config and config.get("enabled") and _branch_provider(config) == "waha"
                and config.get("waha_session_name"))


async def _require_waha_branch(branch_id: str) -> dict:
    config = await _get_branch_cloud_config(branch_id)
    if not _waha_config_for_branch(config):
        raise HTTPException(status_code=400, detail="WAHA is not configured for this branch")
    if not config.get("waha_physical_session_id"):
        physical = _waha_physical_session_id(branch_id, config.get("waha_session_name") or "")
        await _db["whatsapp_branch_configs"].update_one(
            {"branch_id": branch_id}, {"$set": {"waha_physical_session_id": physical}}
        )
        config["waha_physical_session_id"] = physical
    return config


async def _require_session_provider_branch(branch_id: str) -> dict:
    config = await _get_branch_cloud_config(branch_id)
    provider = _branch_provider(config)
    if provider == "waha":
        return await _require_waha_branch(branch_id)
    if not (
        provider == "whatsflow" and config and config.get("enabled")
        and config.get("whatsflow_instance")
        and config.get("whatsflow_api_key_encrypted")
    ):
        raise HTTPException(status_code=400, detail="WhatsApp provider is not configured for this branch")
    return config


@router.get("/branch-provider/{branch_id}/status")
async def branch_provider_status(branch_id: str, current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    config = await _require_session_provider_branch(branch_id)
    if _branch_provider(config) == "whatsflow":
        ok, data, error = await _whatsflow_client(config).connection_state()
        status = parse_connection_state(ok, data, error)
        if status["check_ok"]:
            await _db["whatsapp_branch_configs"].update_one(
                {"branch_id": branch_id},
                {"$set": {"whatsflow_state": status["status"], "whatsflow_status_updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        return {"provider": "whatsflow", "configured": True,
                "instance": config["whatsflow_instance"],
                **status}
    client = WAHAClient()
    if not client.configured:
        return {"provider": "waha", "configured": False, "connected": False, "session": config["waha_session_name"]}
    ok, data, error = await client.session(config["waha_physical_session_id"])
    status = data.get("status") if isinstance(data, dict) else None
    if ok and status:
        await _db["whatsapp_branch_configs"].update_one(
            {"branch_id": branch_id},
            {"$set": {
                "waha_session_status": status,
                "waha_status_updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
    return {"provider": "waha", "configured": True, "connected": bool(ok and status in ("WORKING", "CONNECTED")),
            "session": config["waha_session_name"], "status": status or ("unavailable" if not ok else "unknown"),
            "error": error if not ok else None}


@router.post("/branch-provider/{branch_id}/session/{action}")
async def branch_provider_lifecycle(branch_id: str, action: str, request: Request,
                                    current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    config = await _require_session_provider_branch(branch_id)
    if _branch_provider(config) != "waha":
        raise HTTPException(status_code=400, detail="Whatsflow has no lifecycle controls")
    if action not in {"start", "stop", "restart", "logout"}:
        raise HTTPException(status_code=404, detail="Unknown session action")
    client = WAHAClient()
    if not client.configured:
        raise HTTPException(status_code=503, detail="WAHA is not configured")
    if action == "start":
        webhook_secret = os.environ.get("WAHA_WEBHOOK_SECRET", "")
        if not webhook_secret:
            raise HTTPException(status_code=503, detail="WAHA webhook secret is not configured")
        physical_session = config["waha_physical_session_id"]
        exists, _, error = await client.session(physical_session)
        if not exists and error == "http_404":
            payload = {"name": physical_session, "config": {
                "metadata": {"branch_id": branch_id},
                "webhooks": [{"url": str(request.base_url).rstrip("/") + f"/api/whatsapp/waha-webhook/{get_current_tenant_slug()}",
                    "events": ["message", "message.ack", "session.status"],
                    "hmac": {"key": webhook_secret},
                    "retries": {"policy": "constant", "delaySeconds": 2, "attempts": 15}}]}}
            ok, _, error = await client.create_session(payload)
            if not ok:
                raise HTTPException(status_code=502, detail=f"WAHA session create failed ({error})")
        elif not exists:
            raise HTTPException(status_code=502, detail=f"WAHA session lookup failed ({error})")
    physical_session = config["waha_physical_session_id"]
    ok, _, error = (await client.logout(physical_session)) if action == "logout" else await client.lifecycle(physical_session, action)
    if not ok:
        raise HTTPException(status_code=502, detail=f"WAHA session {action} failed ({error})")
    await _db["whatsapp_branch_configs"].update_one({"branch_id": branch_id}, {"$set": {"waha_session_status": action, "waha_status_updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"success": True, "provider": "waha", "action": action}


@router.get("/branch-provider/{branch_id}/qr")
async def branch_provider_qr(branch_id: str, current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    config = await _require_session_provider_branch(branch_id)
    if _branch_provider(config) == "whatsflow":
        ok, image, error = await _whatsflow_client(config).qr()
    else:
        ok, image, error = await WAHAClient().qr(config["waha_physical_session_id"])
    if not ok:
        raise HTTPException(status_code=502, detail=f"WhatsApp QR failed ({error})")
    if isinstance(image, bytes):
        return Response(content=image, media_type="image/png")
    return image


@router.post("/branch-provider/{branch_id}/test")
async def branch_provider_test(branch_id: str, data: WAHABranchTestRequest,
                               current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    config = await _require_session_provider_branch(branch_id)
    phone = _format_cloud_phone(data.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    body = data.message or "رسالة تجريبية من نظام إدارة الأكاديمية"
    # An explicit staff action stops automation before touching the provider,
    # closing the webhook-echo race even if the provider call later fails.
    await registration_followups.stop_phone(branch_id, phone, "staff_contacted")
    ok, message_id, error = await _send_session_provider_result(
        phone, body, config, automated=False
    )
    if not ok:
        raise HTTPException(status_code=502, detail=f"WhatsApp test failed ({error or 'unknown'})")
    await _record_branch_test_message(branch_id, phone, body, config, message_id, current_user)
    return {"success": True, "provider": _branch_provider(config)}


async def _record_branch_test_message(branch_id, phone, body, config, message_id, actor):
    """Persist accepted test sends without relying on a provider webhook echo."""
    phone = "".join(filter(str.isdigit, phone.split("@", 1)[0]))
    provider = _branch_provider(config)
    now = datetime.now(timezone.utc).isoformat()
    conversation_id = f"{branch_id}:{phone}"
    message = {
        "id": str(uuid.uuid4()), "conversation_id": conversation_id,
        "branch_id": branch_id, "provider": provider, "phone": phone,
        "direction": "outbound", "type": "text", "body": body,
        "status": "sent", "created_at": now, "source": "connection_test",
        "sent_by": actor.get("user_id") or actor.get("id"),
    }
    if message_id:
        message["provider_message_id"] = message_id
        if provider == "waha":
            message["waha_message_id"] = message_id
    messages = _db["whatsapp_cloud_messages"]
    if message_id:
        # Atomic with the webhook's branch/provider/message-id deduplication.
        await messages.create_index(
            [("branch_id", 1), ("provider", 1), ("provider_message_id", 1)],
            unique=True,
            partialFilterExpression={
                "provider": "whatsflow", "provider_message_id": {"$exists": True}
            },
        )
        try:
            await messages.update_one(
                {"branch_id": branch_id, "provider": provider,
                 "provider_message_id": message_id},
                {"$setOnInsert": message}, upsert=True,
            )
        except DuplicateKeyError:
            pass  # A concurrent authenticated webhook already saved this message.
    else:
        await messages.insert_one(message)
    conversations = _db["whatsapp_cloud_conversations"]
    await conversations.update_one(
        {"id": conversation_id},
        {"$setOnInsert": {
            "id": conversation_id, "branch_id": branch_id, "provider": provider,
            "phone": phone, "contact_name": phone, "created_at": now, "unread_count": 0,
        }}, upsert=True,
    )
    await conversations.update_one(
        {"id": conversation_id, "$or": [
            {"last_message_at": {"$lte": now}},
            {"last_message_at": {"$exists": False}},
        ]},
        {"$set": {"last_message": body, "last_message_at": now, "last_direction": "outbound"}},
    )


async def _note_cloud_inbound_needs_reply(
    conversation_id: str, branch_id: str, inbound_at: str
):
    """Record an inbound as awaiting a person, unless a later person replied.

    This is deliberately independent of ``unread_count``.  A delayed webhook
    for an old customer message must not reopen a conversation after a newer
    reply, while an inbound arriving after a reply must always reopen it.
    """
    await _db["whatsapp_cloud_conversations"].update_one(
        {
            "id": conversation_id,
            "branch_id": branch_id,
            "$or": [
                {"last_human_reply_at": {"$exists": False}},
                {"last_human_reply_at": {"$lte": inbound_at}},
            ],
        },
        {"$set": {"needs_reply": True}},
    )


async def _note_cloud_human_reply(
    conversation_id: str, branch_id: str, reply_at: str,
    provider_message_id: Optional[str] = None,
):
    """Resolve only an inbound older than a successful human response.

    The two guarded writes are safe if an inbound webhook races this method:
    either this write sees that inbound and leaves the conversation open, or
    the inbound sees this reply and opens it again.  Automated messages never
    call this helper.
    """
    conversations = _db["whatsapp_cloud_conversations"]
    await conversations.update_one(
        {
            "id": conversation_id,
            "branch_id": branch_id,
            "$or": [
                {"last_human_reply_at": {"$exists": False}},
                {"last_human_reply_at": {"$lt": reply_at}},
            ],
        },
        {"$set": {
            "last_human_reply_at": reply_at,
            **(
                {"last_human_reply_message_id": provider_message_id}
                if provider_message_id else {}
            ),
        }},
    )
    await conversations.update_one(
        {
            "id": conversation_id,
            "branch_id": branch_id,
            "$or": [
                {"last_inbound_at": {"$exists": False}},
                {"last_inbound_at": {"$lt": reply_at}},
            ],
        },
        {"$set": {"needs_reply": False}},
    )


async def _reopen_failed_human_reply(
    branch_id: str, provider: str, provider_message_id: str,
):
    """Undo a latest human-reply resolution on a definitive failed receipt."""
    messages = _db["whatsapp_cloud_messages"]
    message_id_field = (
        "meta_message_id" if provider == "meta_cloud"
        else "waha_message_id" if provider == "waha"
        else "provider_message_id"
    )
    message = await messages.find_one(
        {
            "branch_id": branch_id, "provider": provider,
            message_id_field: provider_message_id, "human_reply": True,
        },
        {"_id": 0, "conversation_id": 1},
    )
    if not message or not message.get("conversation_id"):
        return
    conversation_id = message["conversation_id"]
    conversations = _db["whatsapp_cloud_conversations"]
    conversation = await conversations.find_one(
        {
            "id": conversation_id, "branch_id": branch_id,
            "last_human_reply_message_id": provider_message_id,
        },
        {"_id": 0},
    )
    if not conversation:
        return
    cas_query = {
        "id": conversation_id, "branch_id": branch_id,
        "last_human_reply_message_id": provider_message_id,
    }
    # A new inbound increments the generation even where a provider timestamp
    # is equal/invalid.  Include both durable observations in the final CAS so
    # a failed-receipt scan can never overwrite that later inbound.
    if conversation.get("inbound_generation") is not None:
        cas_query["inbound_generation"] = conversation["inbound_generation"]
    if "last_inbound_at" in conversation:
        cas_query["last_inbound_at"] = conversation.get("last_inbound_at")
    cursor = messages.find(
        {"conversation_id": conversation_id, "branch_id": branch_id},
        {
            "_id": 0, "direction": 1, "created_at": 1, "status": 1,
            "human_reply": 1, "echo_source": 1, "sent_by": 1, "source": 1,
            "provider_message_id": 1, "meta_message_id": 1,
            "waha_message_id": 1,
        },
    )
    if hasattr(cursor, "sort"):
        cursor = cursor.sort("created_at", -1)
    if hasattr(cursor, "limit"):
        cursor = cursor.limit(CLOUD_INBOX_LEGACY_MESSAGE_SCAN_LIMIT + 1)
    rows = await cursor.to_list(
        length=CLOUD_INBOX_LEGACY_MESSAGE_SCAN_LIMIT + 1
    )
    if len(rows) > CLOUD_INBOX_LEGACY_MESSAGE_SCAN_LIMIT:
        # A failed latest reply must never leave a large, uninspectable thread
        # resolved.  Leave it visibly needing attention rather than guessing.
        await conversations.update_one(
            cas_query,
            {"$set": {"needs_reply": True}},
        )
        return
    newest_inbound = None
    newest_reply = None
    for row in rows:
        occurred_at = _parse_cloud_message_time(row.get("created_at"))
        if not occurred_at:
            continue
        if row.get("direction") == "inbound":
            newest_inbound = max(newest_inbound, occurred_at) if newest_inbound else occurred_at
        elif (
            row.get("direction") == "outbound"
            and _is_successful_human_reply_message(row)
            and (not newest_reply or occurred_at > newest_reply[0])
        ):
            newest_reply = (
                occurred_at,
                row.get(message_id_field) or row.get("provider_message_id"),
            )
    update = {
        "needs_reply": bool(
            newest_inbound
            and (not newest_reply or newest_inbound >= newest_reply[0])
        ),
    }
    if newest_reply:
        update["last_human_reply_at"] = newest_reply[0].isoformat()
        if newest_reply[1]:
            update["last_human_reply_message_id"] = newest_reply[1]
    await conversations.update_one(
        cas_query,
        {
            "$set": update,
            **(
                {"$unset": {
                    "last_human_reply_at": "",
                    "last_human_reply_message_id": "",
                }}
                if not newest_reply else {}
            ),
        },
    )


async def _remember_unmatched_outbound_failure(
    branch_id: str, provider: str, provider_message_id: str, status: str,
):
    """Keep a failed receipt that arrived before its outgoing echo."""
    if not provider_message_id:
        return
    await _db["whatsapp_cloud_outbound_failures"].update_one(
        {
            "branch_id": branch_id,
            "provider": provider,
            "provider_message_id": provider_message_id,
        },
        {"$set": {
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )


async def _remembered_outbound_failure(
    branch_id: str, provider: str, provider_message_id: str,
) -> Optional[str]:
    receipt = await _db["whatsapp_cloud_outbound_failures"].find_one(
        {
            "branch_id": branch_id,
            "provider": provider,
            "provider_message_id": provider_message_id,
        },
        {"_id": 0, "status": 1},
    )
    status = str((receipt or {}).get("status") or "").lower()
    return status if status in _UNSUCCESSFUL_OUTBOUND_STATUSES else None


@router.post("/branch-provider/{branch_id}/webhook")
async def configure_branch_provider_webhook(
    branch_id: str, request: Request, current_user: dict = Depends(get_current_user)
):
    _require_admin(current_user)
    config = await _require_session_provider_branch(branch_id)
    if _branch_provider(config) != "whatsflow":
        raise HTTPException(status_code=400, detail="Webhook setup is only available for Whatsflow")
    tenant_slug = get_current_tenant_slug()
    url = (
        str(request.base_url).rstrip("/")
        + f"/api/whatsapp/whatsflow-webhook/{tenant_slug}/{branch_id}"
    )
    ok, _, error = await _whatsflow_client(config).set_webhook(
        url, _whatsflow_webhook_secret(tenant_slug, branch_id)
    )
    if not ok:
        raise HTTPException(status_code=502, detail=f"Whatsflow webhook setup failed ({error})")
    return {"success": True, "provider": "whatsflow", "configured": True}


@router.get("/branch-provider/{branch_id}/quality")
async def branch_provider_quality(branch_id: str, current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    config = await _require_session_provider_branch(branch_id)
    provider = _branch_provider(config)
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    today = datetime.now(timezone.utc).date().isoformat()
    logs = _db["whatsapp_send_log"]
    messages = _db["whatsapp_cloud_messages"]
    success = await logs.count_documents({"branch_id": branch_id, "transport": provider, "success": True, "sent_at": {"$gte": since}})
    failure = await logs.count_documents({"branch_id": branch_id, "transport": provider, "success": False, "sent_at": {"$gte": since}})
    today_sent = await logs.count_documents({"branch_id": branch_id, "transport": provider, "success": True, "sent_at": {"$gte": today, "$lt": today + "T99"}})
    replies = await messages.count_documents({"branch_id": branch_id, "provider": provider, "direction": "inbound", "created_at": {"$gte": since}})
    delivered = await messages.count_documents({"branch_id": branch_id, "provider": provider, "direction": "outbound",
        "status": {"$in": ["delivered", "DELIVERED"]}, "created_at": {"$gte": since}})
    read = await messages.count_documents({"branch_id": branch_id, "provider": provider, "direction": "outbound",
        "status": {"$in": ["read", "READ"]}, "created_at": {"$gte": since}})
    opt_outs = 0
    stop_terms = {"إلغاء", "الغاء", "توقف", "stop", "unsubscribe"}
    cursor = messages.find({"branch_id": branch_id, "provider": provider, "direction": "inbound", "created_at": {"$gte": since}},
                           {"body": 1})
    async for row in cursor:
        body = " ".join(str(row.get("body") or "").strip().lower().split())
        if body in stop_terms:
            opt_outs += 1
    disconnected = (
        str(config.get("whatsflow_state") or "") == "close" if provider == "whatsflow"
        else str(config.get("waha_session_status") or "").upper() in {"STOPPED", "DISCONNECTED", "FAILED"}
    )
    total = success + failure
    failure_ratio = failure / total if total else None
    rating = "unknown" if not total else ("risk" if disconnected or failure_ratio > .10 or opt_outs > 0
        else "watch" if failure_ratio > .02 else "good")
    return {"label": "internal (not official WhatsApp quality)", "rating": rating,
            "seven_day": {"success": success, "failure": failure, "delivery": delivered, "read": read,
                           "failure_ratio": failure_ratio},
            "today_sent": today_sent, "inbound_replies": replies, "opt_outs": opt_outs,
            "session_status": config.get("waha_session_status") or "unknown",
            "disconnected": disconnected,
            "failure_rate": round(failure_ratio * 100, 1) if failure_ratio is not None else None}


@router.get("/meta-webhook-info")
async def get_meta_webhook_info(
    request: Request, current_user: dict = Depends(get_current_user)
):
    _require_admin(current_user)
    slug = get_current_tenant_slug()
    return {
        "callback_url": str(request.base_url).rstrip("/") + f"/api/whatsapp/meta-webhook/{slug}",
        "verify_token": _webhook_verify_token(slug),
    }


async def _with_webhook_tenant(tenant_slug: str):
    from control_db import get_tenant_by_slug
    tenant = await get_tenant_by_slug(tenant_slug)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return set_current_tenant(tenant)


@router.get("/meta-webhook/{tenant_slug}")
async def verify_meta_webhook(
    tenant_slug: str,
    hub_mode: Optional[str] = Query(None, alias="hub.mode"),
    hub_verify_token: Optional[str] = Query(None, alias="hub.verify_token"),
    hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
):
    if (
        hub_mode != "subscribe"
        or not hmac.compare_digest(
            hub_verify_token or "", _webhook_verify_token(tenant_slug)
        )
    ):
        raise HTTPException(status_code=403, detail="Webhook verification failed")
    return Response(content=hub_challenge or "", media_type="text/plain")


@router.post("/meta-webhook/{tenant_slug}")
async def receive_meta_webhook(tenant_slug: str, request: Request):
    raw = await request.body()
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    token = await _with_webhook_tenant(tenant_slug)
    try:
        await _db["whatsapp_cloud_messages"].create_index(
            "meta_message_id", unique=True, sparse=True
        )
        await _db["whatsapp_cloud_conversations"].create_index("id", unique=True)
        values = [
            change.get("value") or {}
            for entry in payload.get("entry") or []
            for change in entry.get("changes") or []
            if change.get("field") == "messages"
        ]
        if len(values) > 100:
            raise HTTPException(status_code=413, detail="Webhook batch is too large")
        phone_ids = {
            str(value.get("metadata", {}).get("phone_number_id") or "")
            for value in values
        } - {""}
        if not phone_ids:
            raise HTTPException(status_code=400, detail="Missing Phone Number ID")
        configs_by_phone_id = {}
        app_secrets = set()
        for phone_number_id in phone_ids:
            config = await _db["whatsapp_branch_configs"].find_one(
                {
                    "phone_number_id": phone_number_id,
                    "enabled": True,
                    "inbox_enabled": True,
                    "app_secret_encrypted": {"$exists": True, "$ne": ""},
                },
                {"_id": 0},
            )
            if not config:
                raise HTTPException(status_code=403, detail="Webhook branch not configured")
            configs_by_phone_id[phone_number_id] = config
            app_secrets.add(_decrypt_access_token(config["app_secret_encrypted"]))
        if len(app_secrets) != 1:
            raise HTTPException(
                status_code=403,
                detail="Webhook batch contains phone numbers from different Meta apps",
            )
        app_secret = next(iter(app_secrets))
        expected = "sha256=" + hmac.new(
            app_secret.encode("utf-8"), raw, hashlib.sha256
        ).hexdigest()
        supplied = request.headers.get("x-hub-signature-256") or ""
        if not hmac.compare_digest(supplied, expected):
            raise HTTPException(status_code=403, detail="Invalid webhook signature")

        received_at = datetime.now(timezone.utc)
        now = received_at.isoformat()
        for value in values:
            phone_number_id = str(
                value.get("metadata", {}).get("phone_number_id") or ""
            )
            config = configs_by_phone_id[phone_number_id]
            contacts = {
                str(contact.get("wa_id")): (contact.get("profile") or {}).get("name")
                for contact in value.get("contacts") or []
            }
            for message in value.get("messages") or []:
                meta_id = str(message.get("id") or "")
                if not meta_id or await _db["whatsapp_cloud_messages"].find_one(
                    {"meta_message_id": meta_id}, {"_id": 1}
                ):
                    continue
                phone = str(message.get("from") or "")
                conversation_id = f"{config['branch_id']}:{phone}"
                try:
                    event_dt = datetime.fromtimestamp(
                        int(message.get("timestamp")), tz=timezone.utc
                    )
                    if event_dt > received_at + timedelta(minutes=5):
                        raise ValueError("future timestamp")
                except Exception:
                    event_dt = None
                event_at = event_dt.isoformat() if event_dt else now
                message_type = message.get("type") or "unknown"
                body = ""
                if message_type == "text":
                    body = (message.get("text") or {}).get("body") or ""
                elif message_type == "button":
                    body = (message.get("button") or {}).get("text") or ""
                elif message_type == "interactive":
                    interactive = message.get("interactive") or {}
                    body = (
                        (interactive.get("button_reply") or {}).get("title")
                        or (interactive.get("list_reply") or {}).get("title")
                        or ""
                    )
                media = message.get(message_type) or {}
                try:
                    await _db["whatsapp_cloud_messages"].insert_one(_archive_pending_fields({
                        "id": str(uuid.uuid4()),
                        "conversation_id": conversation_id,
                        "branch_id": config["branch_id"],
                        "meta_message_id": meta_id,
                        "direction": "inbound",
                        "phone": phone,
                        "type": message_type,
                        "body": body,
                        "media_id": media.get("id") if isinstance(media, dict) else None,
                        "mime_type": media.get("mime_type") if isinstance(media, dict) else None,
                        "status": "received",
                        "unread": True,
                        "created_at": event_at,
                        "received_at": now,
                        "meta_timestamp": message.get("timestamp"),
                        "view_once": _provider_marks_view_once(message)
                        or _provider_marks_view_once(media),
                    }))
                except DuplicateKeyError:
                    continue
                await registration_followups.note_customer_message(
                    config["branch_id"], phone, body
                )
                await campaign_inquiry_automation.note_customer_message(
                    config["branch_id"], phone, body
                )
                await _db["whatsapp_cloud_conversations"].update_one(
                    {"id": conversation_id},
                    {
                        "$set": {
                            "id": conversation_id,
                            "branch_id": config["branch_id"],
                            "phone": phone,
                            "contact_name": contacts.get(phone) or phone,
                            "last_message": body or f"[{message_type}]",
                            "last_message_at": event_at,
                            "last_inbound_message_id": meta_id,
                            "last_direction": "inbound",
                        },
                        "$inc": {"unread_count": 1, "inbound_generation": 1},
                        "$max": {"last_inbound_at": event_at},
                        "$setOnInsert": {"created_at": now},
                    },
                    upsert=True,
                )
                await _note_cloud_inbound_needs_reply(
                    conversation_id, config["branch_id"], event_at
                )
            for status in value.get("statuses") or []:
                meta_id = str(status.get("id") or "")
                if not meta_id:
                    continue
                status_name = status.get("status") or "unknown"
                errors = status.get("errors") or []
                receipt_at = received_at
                try:
                    receipt_at = datetime.fromtimestamp(
                        float(status.get("timestamp")), tz=timezone.utc
                    )
                except (TypeError, ValueError, OSError, OverflowError):
                    pass
                await _db["whatsapp_cloud_messages"].update_one(
                    {"branch_id": config["branch_id"], "meta_message_id": meta_id},
                    {"$set": {
                        "status": status_name,
                        "status_updated_at": now,
                        "error": errors[0].get("title") if errors else None,
                    }},
                )
                if str(status_name).lower() in _UNSUCCESSFUL_OUTBOUND_STATUSES:
                    await _remember_unmatched_outbound_failure(
                        config["branch_id"], "meta_cloud", meta_id, status_name
                    )
                    await _reopen_failed_human_reply(
                        config["branch_id"], "meta_cloud", meta_id
                    )
                await whatsapp_bulk_jobs.record_receipt(
                    config["branch_id"], "meta_cloud", meta_id, status_name,
                    timestamp=receipt_at,
                    error=(errors[0].get("title") if errors else None),
                    tenant_slug=tenant_slug,
                )
        return {"received": True}
    finally:
        reset_current_tenant(token)


@router.post("/waha-webhook/{tenant_slug}")
async def receive_waha_webhook(tenant_slug: str, request: Request):
    """Accept authenticated WAHA events, keeping their records in the cloud inbox."""
    raw = await request.body()
    secret = os.environ.get("WAHA_WEBHOOK_SECRET", "")
    supplied = request.headers.get("x-webhook-hmac") or ""
    expected = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest() if secret else ""
    if not secret or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")
    try:
        envelope = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    token = await _with_webhook_tenant(tenant_slug)
    try:
        event = envelope.get("event") or envelope.get("type") or ""
        payload = envelope.get("payload") if isinstance(envelope.get("payload"), dict) else {}
        session = str(envelope.get("session") or "")
        config = await _db["whatsapp_branch_configs"].find_one(
            {"provider": "waha", "enabled": True, "waha_physical_session_id": session}, {"_id": 0}
        )
        if not config:
            raise HTTPException(status_code=403, detail="Webhook session is not configured")
        now = datetime.now(timezone.utc).isoformat()
        if event in {"session.status", "session.status.changed"}:
            await _db["whatsapp_branch_configs"].update_one({"branch_id": config["branch_id"]}, {"$set": {
                "waha_session_status": payload.get("status") or payload.get("state") or "unknown",
                "waha_status_updated_at": now,
            }})
            return {"received": True}
        message = payload.get("message") if isinstance(payload.get("message"), dict) else payload
        if event in {"message.ack", "message_ack"}:
            message_id = _canonical_waha_message_id(payload)
            if message_id:
                ack_status = _normalize_waha_ack(payload)
                await _db["whatsapp_cloud_messages"].update_one({"branch_id": config["branch_id"], "provider": "waha", "waha_message_id": message_id}, {"$set": {
                    "status": ack_status, "status_updated_at": now,
                }})
                if ack_status in _UNSUCCESSFUL_OUTBOUND_STATUSES:
                    await _remember_unmatched_outbound_failure(
                        config["branch_id"], "waha", message_id, ack_status
                    )
                    await _reopen_failed_human_reply(
                        config["branch_id"], "waha", message_id
                    )
                await whatsapp_bulk_jobs.record_receipt(
                    config["branch_id"], "waha", message_id, ack_status,
                    timestamp=datetime.now(timezone.utc),
                    tenant_slug=tenant_slug,
                    aliases=_waha_message_id_variants(payload),
                )
            return {"received": True}
        if event not in {"message", "message.any"}:
            return {"received": True}
        chat_id = str(message.get("chatId") or message.get("from") or "")
        if "@g.us" in chat_id:
            return {"received": True}
        phone = "".join(filter(str.isdigit, chat_id))
        message_id = _canonical_waha_message_id(message)
        if not phone or not message_id:
            return {"received": True}
        if message.get("fromMe") or message.get("from_me"):
            await registration_followups.note_outbound(
                config["branch_id"], phone, message_id, "waha"
            )
            await campaign_inquiry_automation.note_outbound(
                config["branch_id"], phone, message_id, "waha"
            )
            # WAHA reports all linked-phone sends as ``fromMe``.  Campaigns
            # have an exact durable item ID; without that evidence this is a
            # human linked-phone reply.  Do not use a phone/body heuristic.
            campaign_item = await _db["whatsapp_campaign_job_items"].find_one(
                {
                    "branch_id": config["branch_id"],
                    "provider": "waha",
                    "provider_message_id": message_id,
                },
                {"_id": 1},
            )
            automated = await _db["whatsapp_automated_outbound"].find_one(
                {
                    "branch_id": config["branch_id"],
                    "provider": "waha",
                    "provider_message_id": message_id,
                },
                {"_id": 1},
            )
            if not automated:
                # A provider response without an ID cannot later be matched
                # exactly.  Treat its echo as automation while that durable
                # unknown-send evidence exists rather than incorrectly
                # resolving a customer question.
                automated = await _db["whatsapp_automated_outbound"].find_one(
                    {
                        "branch_id": config["branch_id"],
                        "provider": "waha",
                        "phone": normalize_phone(phone),
                        "status": {"$in": ["in_flight", "unknown"]},
                        "created_at": {
                            "$gte": (
                                datetime.now(timezone.utc)
                                - timedelta(seconds=SESSION_ECHO_AMBIGUITY_SECONDS)
                            ).isoformat(),
                        },
                    },
                    {"_id": 1},
                )
            if not campaign_item and not automated:
                # Preserve the durable form used by failed-receipt rollback and
                # legacy needs-reply reconstruction.  A duplicate of a direct
                # inbox send already has this marker, so it is left intact.
                conversation_id = f"{config['branch_id']}:{phone}"
                await _db["whatsapp_cloud_conversations"].update_one(
                    {"id": conversation_id},
                    {"$setOnInsert": {
                        "id": conversation_id,
                        "branch_id": config["branch_id"],
                        "provider": "waha", "phone": phone,
                        "contact_name": phone, "created_at": now,
                        "unread_count": 0,
                    }},
                    upsert=True,
                )
                existing_echo = await _db["whatsapp_cloud_messages"].find_one(
                    {
                        "branch_id": config["branch_id"], "provider": "waha",
                        "waha_message_id": message_id,
                    },
                    {"_id": 1},
                )
                if not existing_echo:
                    failed_status = await _remembered_outbound_failure(
                        config["branch_id"], "waha", message_id
                    )
                    try:
                        await _db["whatsapp_cloud_messages"].insert_one({
                            "id": str(uuid.uuid4()),
                            "conversation_id": f"{config['branch_id']}:{phone}",
                            "branch_id": config["branch_id"], "provider": "waha",
                            "provider_message_id": message_id,
                            "waha_message_id": message_id,
                            "direction": "outbound", "phone": phone,
                            "type": "text", "body": "",
                            "status": failed_status or "sent",
                            "created_at": now, "received_at": now,
                            "source": "linked_phone", "human_reply": True,
                        })
                    except DuplicateKeyError:
                        pass
                if not await _remembered_outbound_failure(
                    config["branch_id"], "waha", message_id
                ):
                    await _note_cloud_human_reply(
                        conversation_id,
                        config["branch_id"],
                        now,
                        message_id,
                    )
            return {"received": True}
        await _db["whatsapp_cloud_messages"].create_index(
            [("branch_id", 1), ("provider", 1), ("waha_message_id", 1)],
            unique=True,
            partialFilterExpression={"provider": "waha", "waha_message_id": {"$exists": True}},
        )
        text = message.get("text")
        body = message.get("body") or (text.get("body") if isinstance(text, dict) else text if isinstance(text, str) else "") or ""
        kind = message.get("type") or "text"
        conversation_id = f"{config['branch_id']}:{phone}"
        try:
            await _db["whatsapp_cloud_messages"].insert_one(_archive_pending_fields({"id": str(uuid.uuid4()), "conversation_id": conversation_id,
                "branch_id": config["branch_id"], "provider": "waha", "waha_message_id": message_id,
                "direction": "inbound", "phone": phone, "type": kind, "body": body,
                "media_id": (message.get("media") or {}).get("url") if isinstance(message.get("media"), dict) else message.get("mediaId"),
                "media_url": (message.get("media") or {}).get("url") if isinstance(message.get("media"), dict) else None,
                "mime_type": (message.get("media") or {}).get("mimetype") if isinstance(message.get("media"), dict) else message.get("mimetype") or message.get("mimeType"),
                "filename": (message.get("media") or {}).get("filename") if isinstance(message.get("media"), dict) else None,
                "status": "received", "unread": True,
                "created_at": now, "received_at": now,
                "view_once": _provider_marks_view_once(message)}))
        except DuplicateKeyError:
            return {"received": True}
        await registration_followups.note_customer_message(
            config["branch_id"], phone, body
        )
        await campaign_inquiry_automation.note_customer_message(
            config["branch_id"], phone, body
        )
        await _db["whatsapp_cloud_conversations"].update_one({"id": conversation_id}, {"$set": {
            "id": conversation_id, "branch_id": config["branch_id"], "provider": "waha", "phone": phone,
            "contact_name": message.get("pushName") or message.get("name") or phone,
            "last_message": body or f"[{kind}]", "last_message_at": now,
            "last_inbound_message_id": message_id,
            "last_direction": "inbound",
        }, "$inc": {"unread_count": 1, "inbound_generation": 1},
        "$max": {"last_inbound_at": now},
        "$setOnInsert": {"created_at": now}}, upsert=True)
        await _note_cloud_inbound_needs_reply(
            conversation_id, config["branch_id"], now
        )
        return {"received": True}
    finally:
        reset_current_tenant(token)


WHATSFLOW_REPLY_UNREAD_SCAN_LIMIT = 1000


def _parse_cloud_message_time(value):
    """Return an aware UTC datetime for inbox ordering comparisons."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


async def _cloud_message_rows(query: dict, limit: int):
    """Read a bounded set of inbox messages, tolerating small test doubles."""
    collection = _db["whatsapp_cloud_messages"]
    finder = getattr(collection, "find", None)
    if not finder:
        return None
    cursor = finder(query, {
        "_id": 0, "id": 1, "provider_message_id": 1,
        "created_at": 1, "direction": 1, "unread": 1,
    })
    if hasattr(cursor, "sort"):
        cursor = cursor.sort("created_at", 1)
    if hasattr(cursor, "limit"):
        cursor = cursor.limit(limit + 1)
    if hasattr(cursor, "to_list"):
        return await cursor.to_list(length=limit + 1)
    try:
        rows = [row async for row in cursor]
    except TypeError:
        rows = list(cursor)
    return rows[: limit + 1]


async def _mark_cloud_inbound_read(
    conversation_id: str,
    branch_id: str,
    fetched_messages: list[dict],
    *,
    provider: Optional[str] = None,
    fetched_complete: Optional[bool] = None,
):
    """Mark only inbound rows included in the fetched thread as read.

    ``unread_count`` predates per-message unread markers. New webhook rows carry
    ``unread=True``. Marking only fetched IDs keeps a later webhook arrival out
    of the read operation. Legacy rows without markers can clear the aggregate
    only when this fetch was complete through the stored latest inbound cutoff
    and the aggregate's inbound identity/generation still matches the snapshot.
    """
    fetched_inbound = [
        row for row in (fetched_messages or [])
        if row.get("direction") == "inbound"
        and (row.get("id") or row.get("provider_message_id"))
    ]
    if not fetched_inbound:
        return False

    conversations = _db["whatsapp_cloud_conversations"]
    snapshot = await conversations.find_one(
        {"id": conversation_id, "branch_id": branch_id},
        {
            "_id": 0,
            "unread_count": 1,
            "last_inbound_at": 1,
            "last_inbound_message_id": 1,
            "inbound_generation": 1,
        },
    )
    if not snapshot:
        return False
    snapshot_count = int(snapshot.get("unread_count") or 0)

    message_ids = [
        row.get("id") or row.get("provider_message_id")
        for row in fetched_inbound
    ]
    query = {
        "id": {"$in": message_ids},
        "conversation_id": conversation_id,
        "branch_id": branch_id,
        "direction": "inbound",
        "unread": True,
    }
    if provider:
        query["provider"] = provider
    collection = _db["whatsapp_cloud_messages"]
    transitioned = 0
    updater = getattr(collection, "update_many", None)
    if updater:
        result = await updater(query, {"$set": {"unread": False}})
        transitioned = int(getattr(result, "modified_count", 0) or 0)
    else:
        for row in fetched_inbound:
            message_id = row.get("id") or row.get("provider_message_id")
            key = {
                "id": message_id,
                "branch_id": branch_id,
                "direction": "inbound",
                "unread": True,
            }
            if provider:
                key["provider"] = provider
            result = await collection.update_one(
                key, {"$set": {"unread": False}}
            )
            transitioned += int(getattr(result, "modified_count", 0) or 0)

    fetched_times = [
        moment for moment in (
            _parse_cloud_message_time(row.get("created_at"))
            for row in fetched_inbound
        ) if moment
    ]
    if not fetched_times:
        return False
    cutoff = max(fetched_times)
    latest_inbound = _parse_cloud_message_time(snapshot.get("last_inbound_at"))
    # The thread query is capped at 500 rows. A short result proves that the
    # fetched set is complete; otherwise only a cutoff reaching the last row
    # can safely clear legacy aggregate state.
    fetch_complete = (
        len(fetched_messages) < 500
        if fetched_complete is None
        else fetched_complete
    )
    safe_full_clear = fetch_complete and (
        not latest_inbound or latest_inbound <= cutoff
    )
    conversations = _db["whatsapp_cloud_conversations"]
    if safe_full_clear:
        cas_query = {
            "id": conversation_id,
            "branch_id": branch_id,
            "unread_count": snapshot_count,
        }
        # Old conversation rows predate both identity fields.  Matching their
        # absence explicitly is what makes clearing their legacy aggregate
        # safe: a concurrent first inbound creates these fields and invalidates
        # this CAS instead of having its increment overwritten by the clear.
        for field in (
            "last_inbound_message_id",
            "inbound_generation",
            "last_inbound_at",
        ):
            cas_query[field] = (
                snapshot[field]
                if field in snapshot
                else {"$exists": False}
            )
        result = await conversations.update_one(
            cas_query,
            {"$set": {"unread_count": 0}},
        )
        if getattr(result, "matched_count", 0):
            return True

    if transitioned:
        await conversations.update_one(
            {
                "id": conversation_id,
                "branch_id": branch_id,
                "unread_count": {"$gte": transitioned},
            },
            {"$inc": {"unread_count": -transitioned}},
        )
    return False


async def _mark_whatsflow_inbound_message_read(
    branch_id: str, provider_message_id: str
) -> bool:
    """Mark one authenticated Whatsflow inbound message read.

    Evolution API's ``MESSAGES_UPDATE`` event identifies the changed message
    with ``keyId`` and ``fromMe``.  The aggregate unread count is maintained
    separately by this inbox, so only a transition of the exact stored inbound
    row may decrement it.  In particular, this must not be implemented as a
    chat-wide or timestamp-based clear: another inbound message can arrive
    before or after either atomic update.  The pre-transition aggregate
    identity is required for the decrement, so a concurrent thread read leaves
    a mismatched count untouched.
    """
    if not branch_id or not provider_message_id:
        return False

    messages = _db["whatsapp_cloud_messages"]
    conversations = _db["whatsapp_cloud_conversations"]
    query = {
        "branch_id": branch_id,
        "provider": "whatsflow",
        "provider_message_id": provider_message_id,
        "direction": "inbound",
        "unread": True,
    }
    row = await messages.find_one(query, {"_id": 0, "conversation_id": 1})
    if not row or not row.get("conversation_id"):
        return False
    snapshot = await conversations.find_one(
        {"id": row["conversation_id"], "branch_id": branch_id},
        {
            "_id": 0,
            "unread_count": 1,
            "last_inbound_message_id": 1,
            "inbound_generation": 1,
        },
    )
    if not snapshot:
        return False
    try:
        snapshot_count = int(snapshot.get("unread_count") or 0)
    except (TypeError, ValueError):
        snapshot_count = 0
    snapshot_message_id = snapshot.get("last_inbound_message_id")
    snapshot_generation = snapshot.get("inbound_generation")

    # The unread predicate makes duplicate delivery idempotent and ensures
    # that a thread read race cannot decrement the aggregate twice.
    result = await messages.update_one(
        query,
        {"$set": {"unread": False}},
    )
    if not getattr(result, "modified_count", 0):
        return False

    # The aggregate may be concurrently cleared by a thread read.  Requiring
    # the complete pre-transition identity (including the count) makes this
    # operation own only the count snapshot it observed.  On any mismatch,
    # leave the count alone: a later inbound event must never be hidden by a
    # blanket retry or a chat-wide decrement.
    if (
        snapshot_count < 1
        or snapshot_message_id in (None, "")
        or snapshot_generation is None
    ):
        return True
    counter_query = {
        "id": row["conversation_id"],
        "branch_id": branch_id,
        "unread_count": snapshot_count,
        "last_inbound_message_id": snapshot_message_id,
        "inbound_generation": snapshot_generation,
    }
    await conversations.update_one(
        counter_query,
        {"$inc": {"unread_count": -1}},
    )
    return True


async def _classify_whatsflow_echo(
    branch_id: str, phone: str, provider_message_id: str
) -> str:
    """Classify an echo without guessing through an automation race.

    ``automated`` requires an exact durable provider ID. ``ambiguous_*`` means
    an automatic send is currently in flight for this phone, so unread state is
    preserved; registration follow-ups additionally need their unresolved
    observation persisted by ``note_outbound``. A phone match alone never
    becomes proof of automation.
    """
    if not provider_message_id:
        item = None
    else:
        item = await _db["whatsapp_campaign_job_items"].find_one(
            {
                "branch_id": branch_id,
                "provider": "whatsflow",
                "provider_message_id": provider_message_id,
            },
            {"_id": 1},
        )
        if not item:
            evidence = await _db["whatsapp_automated_outbound"].find_one(
                {
                    "branch_id": branch_id,
                    "provider": "whatsflow",
                    "provider_message_id": provider_message_id,
                },
                {"_id": 1},
            )
            if evidence:
                return "automated"
    if item:
        # Exact provider IDs are the only safe way to classify a completed
        # campaign echo. In particular, do not infer automation from body text
        # or from a delivery receipt, since either can belong to an operator's
        # phone reply.
        return "automated"

    # A provider echo may beat persistence of the returned ID. A dispatching
    # campaign item for the exact branch/provider/phone is durable evidence of
    # that race; do not classify that ambiguous event as a human reply.
    normalized_phone = normalize_phone(phone)
    jobs = _db["whatsapp_campaign_job_items"]
    finder = getattr(jobs, "find", None)
    if finder and normalized_phone:
        cursor = finder(
            {
                "branch_id": branch_id,
                "provider": "whatsflow",
                "status": "dispatching",
            },
            {"_id": 0, "phone": 1, "communication_kind": 1},
        )
        if hasattr(cursor, "limit"):
            cursor = cursor.limit(1000)
        if hasattr(cursor, "to_list"):
            rows = await cursor.to_list(length=1000)
        else:
            try:
                rows = [row async for row in cursor]
            except TypeError:
                rows = list(cursor)
        matching = [
            row for row in rows
            if normalize_phone(row.get("phone")) == normalized_phone
        ]
        if matching:
            if any(
                row.get("communication_kind") == "registration_followup"
                for row in matching
            ):
                return "ambiguous_registration"
            return "ambiguous_automation"

    # A text/media send can echo before its wrapper receives the provider ID.
    # This short-lived evidence is intentionally phone-scoped only while the
    # send is unresolved; it is never used to classify a historical echo.
    evidence = _db["whatsapp_automated_outbound"]
    finder = getattr(evidence, "find", None)
    if finder and normalized_phone:
        cursor = finder(
            {
                "branch_id": branch_id,
                "provider": "whatsflow",
                "phone": normalized_phone,
                "status": {"$in": ["in_flight", "unknown"]},
                "created_at": {
                    "$gte": (
                        datetime.now(timezone.utc)
                        - timedelta(seconds=SESSION_ECHO_AMBIGUITY_SECONDS)
                    ).isoformat(),
                },
            },
            {"_id": 0, "status": 1},
        )
        if hasattr(cursor, "limit"):
            cursor = cursor.limit(1000)
        if hasattr(cursor, "to_list"):
            rows = await cursor.to_list(length=1000)
        else:
            try:
                rows = [row async for row in cursor]
            except TypeError:
                rows = list(cursor)
        for row in rows:
            if row.get("status") in {"in_flight", "unknown"}:
                return "ambiguous_automation"

    # Payment receipts have a durable processing claim but historically did not
    # retain their provider ID. It is still safe to suppress only this exact
    # branch/phone race; completed rows are deliberately not guessed.
    outbox = _db["whatsapp_invoice_payment_outbox"]
    finder = getattr(outbox, "find", None)
    if finder and normalized_phone:
        cursor = finder(
            {"status": "processing"},
            {"_id": 0, "invoice": 1},
        )
        if hasattr(cursor, "limit"):
            cursor = cursor.limit(1000)
        if hasattr(cursor, "to_list"):
            rows = await cursor.to_list(length=1000)
        else:
            try:
                rows = [row async for row in cursor]
            except TypeError:
                rows = list(cursor)
        if any(
            (row.get("invoice") or {}).get("branch_id") == branch_id
            and normalize_phone((row.get("invoice") or {}).get("customer_phone"))
            == normalized_phone
            for row in rows
        ):
            return "ambiguous_automation"
    return "human"


async def _reconcile_whatsflow_phone_reply_unread(
    conversation_id: str, branch_id: str, event_at: str
):
    """Clear only proven old inbound notifications for a human phone reply.

    New inbound rows have an ``unread`` marker, allowing partial reconciliation
    when a newer customer message arrived after the reply. Older rows may not
    have that marker, so a legacy conversation is only fully cleared when its
    stored latest inbound identity/generation is unchanged and strictly older
    than the reply. Equal timestamps remain unread.
    """
    conversations = _db["whatsapp_cloud_conversations"]
    conversation = await conversations.find_one(
        {"id": conversation_id, "branch_id": branch_id},
        {
            "_id": 0,
            "unread_count": 1,
            "last_inbound_at": 1,
            "last_inbound_message_id": 1,
            "inbound_generation": 1,
        },
    )
    if not conversation:
        return
    try:
        current_count = max(int(conversation.get("unread_count") or 0), 0)
    except (TypeError, ValueError):
        current_count = 0
    snapshot_count = current_count
    snapshot_message_id = conversation.get("last_inbound_message_id")
    snapshot_generation = conversation.get("inbound_generation")
    if not current_count:
        return
    reply_time = _parse_cloud_message_time(event_at)
    if not reply_time:
        return

    rows = await _cloud_message_rows(
        {
            "conversation_id": conversation_id,
            "branch_id": branch_id,
            "provider": "whatsflow",
            "direction": "inbound",
        },
        WHATSFLOW_REPLY_UNREAD_SCAN_LIMIT,
    )
    if rows is not None and len(rows) > WHATSFLOW_REPLY_UNREAD_SCAN_LIMIT:
        # A partial scan cannot prove which unread rows are older than this
        # reply. Leave the count untouched instead of making a broad guess.
        return

    inbound_rows = []
    if rows is not None:
        for row in rows:
            message_time = _parse_cloud_message_time(row.get("created_at"))
            if message_time:
                inbound_rows.append((row, message_time))

    latest_inbound = _parse_cloud_message_time(conversation.get("last_inbound_at"))
    has_newer_inbound = any(moment >= reply_time for _, moment in inbound_rows)
    if latest_inbound and latest_inbound >= reply_time:
        has_newer_inbound = True

    # Only rows explicitly marked unread can be partially reconciled. Rows
    # without the marker belong to the legacy schema and are intentionally not
    # guessed when a newer inbound exists.
    old_unread = [
        row for row, moment in inbound_rows
        if moment < reply_time and row.get("unread") is True
    ]
    messages = _db["whatsapp_cloud_messages"]
    transitioned = 0
    for row in old_unread:
        message_id = row.get("id") or row.get("provider_message_id")
        if not message_id:
            continue
        result = await messages.update_one(
            {
                "id": message_id,
                "branch_id": branch_id,
                "provider": "whatsflow",
                "conversation_id": conversation_id,
                "direction": "inbound",
                "unread": True,
            },
            {"$set": {"unread": False}},
        )
        transitioned += int(
            getattr(result, "modified_count", 0) or 0
        )

    newer_unread = sum(
        1 for row, moment in inbound_rows
        if moment >= reply_time and row.get("unread") is True
    )

    def _cas_query(*, minimum_count: Optional[int] = None):
        query = {"id": conversation_id, "branch_id": branch_id}
        if minimum_count is None:
            query["unread_count"] = snapshot_count
        else:
            query["unread_count"] = {"$gte": minimum_count}
        if snapshot_message_id:
            query["last_inbound_message_id"] = snapshot_message_id
        if snapshot_generation is not None:
            query["inbound_generation"] = snapshot_generation
        return query

    # A mixed legacy/new snapshot can be fully cleared only with a durable
    # inbound identity or generation and a strictly older latest inbound. The
    # aggregate CAS prevents a new inbound from being zeroed between snapshot
    # and update.
    observed_latest = max(
        (moment for _, moment in inbound_rows), default=latest_inbound
    )
    can_full_clear = bool(
        (snapshot_message_id or snapshot_generation is not None)
        and observed_latest
        and observed_latest < reply_time
        and not has_newer_inbound
    )
    if can_full_clear:
        result = await conversations.update_one(
            _cas_query(), {"$set": {"unread_count": 0}}
        )
        if getattr(result, "matched_count", 0):
            return

    if not transitioned:
        return
    if has_newer_inbound:
        clear_count = min(
            transitioned,
            max(0, snapshot_count - newer_unread),
        )
    else:
        clear_count = min(transitioned, snapshot_count)
    # The decrement carries the same snapshot identity/generation, so a
    # concurrent inbound cannot be mistaken for this old snapshot.
    if clear_count:
        await conversations.update_one(
            _cas_query(minimum_count=clear_count),
            {"$inc": {"unread_count": -clear_count}},
        )
    return

@router.post("/whatsflow-webhook/{tenant_slug}/{branch_id}")
async def receive_whatsflow_webhook(tenant_slug: str, branch_id: str, request: Request):
    """Accept one branch's authenticated Whatsflow events into the unified inbox."""
    raw = await request.body()
    try:
        envelope = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    instance = str(
        envelope.get("instance")
        or (envelope.get("data") or {}).get("instance")
        or ""
    )
    if not instance:
        raise HTTPException(status_code=403, detail="Webhook instance is missing")
    token = await _with_webhook_tenant(tenant_slug)
    try:
        config = await _db["whatsapp_branch_configs"].find_one(
            {"branch_id": branch_id, "provider": "whatsflow", "enabled": True,
             "whatsflow_instance": instance},
            {"_id": 0},
        )
        if not config:
            raise HTTPException(status_code=403, detail="Webhook instance is not configured")
        supplied = request.headers.get("x-webhook-secret") or ""
        expected = _whatsflow_webhook_secret(tenant_slug, branch_id)
        if not hmac.compare_digest(supplied, expected):
            raise HTTPException(status_code=403, detail="Invalid webhook secret")
        event = str(envelope.get("event") or envelope.get("type") or "").lower()
        data = envelope.get("data") if isinstance(envelope.get("data"), dict) else {}
        now = datetime.now(timezone.utc).isoformat()
        if event == "connection.update":
            state = data.get("state") or (data.get("instance") or {}).get("state") or "unknown"
            await _db["whatsapp_branch_configs"].update_one(
                {"branch_id": config["branch_id"]},
                {"$set": {"whatsflow_state": state, "whatsflow_status_updated_at": now}},
            )
            return {"received": True}
        key = data.get("key") if isinstance(data.get("key"), dict) else {}
        # Evolution API 2.3.7 emits MESSAGES_UPDATE data as the flattened
        # ``message`` object (keyId/remoteJid/fromMe/status), while some
        # compatible gateways retain the nested key shape used by upserts.
        # Accept both shapes, but never infer an ID or direction.
        message_id = str(
            key.get("id") or data.get("keyId") or data.get("id") or ""
        )
        if event == "messages.update":
            update_data = data.get("update") if isinstance(data.get("update"), dict) else {}
            status = str(data.get("status") or update_data.get("status") or "unknown").lower()
            if message_id:
                # Evolution provides the provider event timestamp in seconds
                # (some compatible gateways use milliseconds).  It is receipt
                # evidence, unlike a client/browser clock; reject only clearly
                # future values and otherwise retain its actual ordering.
                receipt_at = datetime.now(timezone.utc)
                try:
                    raw_receipt_at = (
                        data.get("messageTimestamp")
                        or data.get("timestamp")
                        or update_data.get("messageTimestamp")
                        or update_data.get("timestamp")
                    )
                    receipt_epoch = float(raw_receipt_at)
                    if receipt_epoch > 1e12:
                        receipt_epoch /= 1000
                    candidate = datetime.fromtimestamp(
                        receipt_epoch, timezone.utc
                    )
                    if candidate <= receipt_at + timedelta(minutes=5):
                        receipt_at = candidate
                except (ValueError, TypeError, OverflowError, OSError):
                    pass
                from_me = _provider_from_me(key, data)
                await _db["whatsapp_cloud_messages"].update_one(
                    {"branch_id": config["branch_id"], "provider": "whatsflow",
                     "provider_message_id": message_id},
                    {"$set": {"status": status, "status_updated_at": now}},
                )
                if status in _UNSUCCESSFUL_OUTBOUND_STATUSES:
                    await _remember_unmatched_outbound_failure(
                        config["branch_id"], "whatsflow", message_id, status
                    )
                    await _reopen_failed_human_reply(
                        config["branch_id"], "whatsflow", message_id
                    )
                # A receipt for an inbound message (notably the linked device
                # reading it) is not evidence about an outbound campaign.
                if from_me is not False:
                    await whatsapp_bulk_jobs.record_receipt(
                        config["branch_id"], "whatsflow", message_id, status,
                        timestamp=receipt_at,
                        tenant_slug=tenant_slug,
                    )

                # A READ for fromMe=true is the customer reading our
                # outbound message.  It must never affect inbox unread state.
                # Evolution API 2.3.7 documents the inverse path in its
                # messages.update handler: fromMe=false + READ is the linked
                # phone reading an inbound message.  Scope the operation to
                # that exact stored inbound provider ID.
                if status == "read" and from_me is False:
                    await _mark_whatsflow_inbound_message_read(
                        config["branch_id"], message_id
                    )
            return {"received": True}
        if event != "messages.upsert":
            return {"received": True}
        outbound = _provider_from_me(key, data)
        if outbound is None:
            return {"received": True}
        remote_jid = str(key.get("remoteJid") or data.get("remoteJid") or "")
        if remote_jid.endswith(("@g.us", "@broadcast", "@newsletter")):
            return {"received": True}
        # LID identifiers are not phone numbers; use the provider's phone JID.
        if remote_jid.endswith("@lid"):
            key_alt = key.get("remoteJidAlt")
            data_alt = data.get("remoteJidAlt")
            if (
                ("remoteJidAlt" in key and not isinstance(key_alt, str))
                or ("remoteJidAlt" in data and not isinstance(data_alt, str))
            ):
                return {"received": True}
            documented_alts = [
                value for value in (key_alt, data_alt)
                if isinstance(value, str) and value
            ]
            if (
                not documented_alts
                or len(set(documented_alts)) != 1
                or not documented_alts[0].endswith(("@s.whatsapp.net", "@c.us"))
            ):
                return {"received": True}
            remote_jid = documented_alts[0]
        if not re.fullmatch(r"\d+@(?:s\.whatsapp\.net|c\.us)", remote_jid):
            return {"received": True}
        event_at = now
        try:
            timestamp = float(data.get("messageTimestamp") or 0)
            if timestamp > 1e12:
                timestamp /= 1000
            if timestamp > 0:
                event_at = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
        except (ValueError, TypeError, OverflowError, OSError):
            pass
        phone = "".join(filter(str.isdigit, remote_jid))
        if not phone or not message_id:
            return {"received": True}
        raw_message = data.get("message") if isinstance(data.get("message"), dict) else {}
        view_once = _provider_marks_view_once(raw_message)
        message = _normalize_whatsflow_message(raw_message)
        image_message = (
            message.get("imageMessage")
            if isinstance(message.get("imageMessage"), dict)
            else {}
        )
        document_message = (
            message.get("documentMessage")
            if isinstance(message.get("documentMessage"), dict)
            else {}
        )
        audio_message = (
            message.get("audioMessage")
            if isinstance(message.get("audioMessage"), dict)
            else {}
        )
        video_message = (
            message.get("videoMessage")
            if isinstance(message.get("videoMessage"), dict)
            else {}
        )
        media_message = image_message or document_message or audio_message or video_message
        media_type = (
            "image" if image_message
            else "document" if document_message
            else "audio" if audio_message
            else "video" if video_message
            else None
        )
        body = _extract_whatsflow_body(raw_message, data)
        conversation_id = f"{config['branch_id']}:{phone}"
        echo_class = (
            await _classify_whatsflow_echo(
                config["branch_id"], phone, message_id
            )
            if outbound else "inbound"
        )
        failed_outbound_status = (
            await _remembered_outbound_failure(
                config["branch_id"], "whatsflow", message_id
            )
            if outbound else None
        )
        messages = _db["whatsapp_cloud_messages"]
        await messages.create_index(
            [("branch_id", 1), ("provider", 1), ("provider_message_id", 1)],
            unique=True,
            partialFilterExpression={
                "provider": "whatsflow", "provider_message_id": {"$exists": True}
            },
        )
        try:
            await messages.insert_one(_archive_pending_fields({
                "id": str(uuid.uuid4()), "conversation_id": conversation_id,
                "branch_id": config["branch_id"], "provider": "whatsflow",
                "provider_message_id": message_id,
                "direction": "outbound" if outbound else "inbound",
                "phone": phone, "type": media_type or "text", "body": body,
                # Evolution's media URL is an encrypted WhatsApp CDN blob.
                # Keep the provider message ID so the supported decrypt API can
                # retrieve media even when no URL is included in the webhook.
                "media_id": media_message.get("url") or (message_id if media_type else None),
                "media_url": media_message.get("url"),
                "mime_type": media_message.get("mimetype"),
                "filename": (
                    media_message.get("fileName")
                    or media_message.get("filename")
                ),
                "status": (
                    failed_outbound_status or "sent"
                    if outbound else "received"
                ),
                "unread": not outbound,
                **(
                    {"human_reply": True}
                    if outbound and echo_class == "human" else {}
                ),
                **(
                    {"echo_source": echo_class}
                    if outbound else {}
                ),
                "created_at": event_at, "received_at": now, "view_once": view_once,
            }))
        except DuplicateKeyError:
            existing = await messages.find_one(
                {
                    "branch_id": config["branch_id"],
                    "provider": "whatsflow",
                    "provider_message_id": message_id,
                },
                {"_id": 0, "echo_source": 1},
            ) if outbound else None
            duplicate_class = (
                (existing or {}).get("echo_source")
                or echo_class
            )
            if (
                outbound
                and duplicate_class == "human"
            ):
                await _reconcile_whatsflow_phone_reply_unread(
                    conversation_id, config["branch_id"], event_at
                )
            return {"received": True}
        if outbound:
            if echo_class in {"human", "ambiguous_registration"}:
                await registration_followups.note_outbound(
                    config["branch_id"], phone, message_id, "whatsflow"
                )
            # An ambiguous provider echo is retained as automation evidence;
            # only the already-classified human path can stop inquiry work.
            if echo_class == "human" and not failed_outbound_status:
                await campaign_inquiry_automation.note_outbound(
                    config["branch_id"], phone, message_id, "whatsflow"
                )
            if echo_class == "human" and not failed_outbound_status:
                await _reconcile_whatsflow_phone_reply_unread(
                    conversation_id, config["branch_id"], event_at
                )
                await _note_cloud_human_reply(
                    conversation_id, config["branch_id"], event_at, message_id
                )
            conversations = _db["whatsapp_cloud_conversations"]
            # Never use outgoing pushName: it is the branch's own profile name.
            await conversations.update_one(
                {"id": conversation_id},
                {"$setOnInsert": {
                    "id": conversation_id, "branch_id": config["branch_id"],
                    "provider": "whatsflow", "phone": phone, "contact_name": phone,
                    "created_at": now, "unread_count": 0,
                }}, upsert=True,
            )
            await conversations.update_one(
                {"id": conversation_id, "$or": [
                    {"last_message_at": {"$lte": event_at}},
                    {"last_message_at": {"$exists": False}},
                ]},
                {"$set": {
                    "last_message": body or "[message]", "last_message_at": event_at,
                    "last_direction": "outbound",
                }},
            )
            return {"received": True}
        await registration_followups.note_customer_message(
            config["branch_id"], phone, body
        )
        await campaign_inquiry_automation.note_customer_message(
            config["branch_id"], phone, body
        )
        await _db["whatsapp_cloud_conversations"].update_one(
            {"id": conversation_id},
            {"$set": {
                "id": conversation_id, "branch_id": config["branch_id"],
                "provider": "whatsflow", "phone": phone,
                "contact_name": data.get("pushName") or phone,
                "last_message": body or "[message]", "last_message_at": event_at,
                "last_inbound_message_id": message_id,
                "last_direction": "inbound",
            }, "$inc": {"unread_count": 1, "inbound_generation": 1},
            "$max": {"last_inbound_at": event_at},
            "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        await _note_cloud_inbound_needs_reply(
            conversation_id, config["branch_id"], event_at
        )
        return {"received": True}
    finally:
        reset_current_tenant(token)


class CloudInboxReplyRequest(BaseModel):
    body: str


_UNSUCCESSFUL_OUTBOUND_STATUSES = {
    "error", "failed", "fail", "undelivered", "rejected",
}
CLOUD_INBOX_LEGACY_BACKFILL_LIMIT = 250
CLOUD_INBOX_LEGACY_MESSAGE_SCAN_LIMIT = 10000
SESSION_ECHO_AMBIGUITY_SECONDS = 300


def _is_successful_human_reply_message(message: dict) -> bool:
    """Return true only for durable evidence of a person answering a thread."""
    if str(message.get("status") or "").lower() in _UNSUCCESSFUL_OUTBOUND_STATUSES:
        return False
    if message.get("human_reply") is True:
        return True
    if message.get("echo_source") == "human":
        return True
    # Older direct-inbox sends predate ``human_reply``.  ``sent_by`` is the
    # durable staff identity, unlike campaign rows or a provider delivery echo.
    return bool(
        message.get("sent_by")
        and message.get("source") not in {"campaign", "connection_test"}
    )


async def _hydrate_cloud_conversation_needs_reply(rows: list[dict]) -> bool:
    """Set response-only needs-reply flags with one legacy message read.

    New writes maintain last_inbound_at/last_human_reply_at.  For conversations
    created before those fields existed, this uses only persisted inbound rows
    and positively identified, successful human outbound rows.  It never
    treats a campaign, an automated echo, or an outbound preview as a reply.
    Historical linked-phone echoes that were never persisted cannot be safely
    inferred. A capped legacy scan also leaves its batch unmaterialized rather
    than making a partial-history guess.
    """
    if not rows:
        return True
    conversation_ids = list({
        row.get("id") for row in rows if row.get("id")
    })
    inbound_by_conversation = {}
    human_reply_by_conversation = {}
    if conversation_ids:
        cursor = _db["whatsapp_cloud_messages"].find(
            {"conversation_id": {"$in": conversation_ids}},
            {
                "_id": 0, "conversation_id": 1, "direction": 1,
                "created_at": 1, "status": 1, "human_reply": 1,
                "echo_source": 1, "sent_by": 1, "source": 1,
            },
        )
        if hasattr(cursor, "sort"):
            cursor = cursor.sort("created_at", -1)
        if hasattr(cursor, "limit"):
            cursor = cursor.limit(CLOUD_INBOX_LEGACY_MESSAGE_SCAN_LIMIT + 1)
        messages = await cursor.to_list(
            length=CLOUD_INBOX_LEGACY_MESSAGE_SCAN_LIMIT + 1
        )
        if len(messages) > CLOUD_INBOX_LEGACY_MESSAGE_SCAN_LIMIT:
            logger.warning(
                "Cloud inbox legacy needs-reply backfill is capped; "
                "conversation flags were not inferred"
            )
            return False
        for message in messages:
            conversation_id = message.get("conversation_id")
            occurred_at = _parse_cloud_message_time(message.get("created_at"))
            if not conversation_id or not occurred_at:
                continue
            if message.get("direction") == "inbound":
                previous = inbound_by_conversation.get(conversation_id)
                if not previous or occurred_at > previous:
                    inbound_by_conversation[conversation_id] = occurred_at
            elif (
                message.get("direction") == "outbound"
                and _is_successful_human_reply_message(message)
            ):
                previous = human_reply_by_conversation.get(conversation_id)
                if not previous or occurred_at > previous:
                    human_reply_by_conversation[conversation_id] = occurred_at

    for row in rows:
        conversation_id = row.get("id")
        inbound_at = _parse_cloud_message_time(row.get("last_inbound_at"))
        human_reply_at = _parse_cloud_message_time(
            row.get("last_human_reply_at")
        )
        # Persisted message rows are the legacy fallback, and can also repair
        # an old conversation projection that lacks one of the timestamps.
        inbound_at = max(
            (value for value in (
                inbound_at, inbound_by_conversation.get(conversation_id)
            ) if value),
            default=None,
        )
        human_reply_at = max(
            (value for value in (
                human_reply_at, human_reply_by_conversation.get(conversation_id)
            ) if value),
            default=None,
        )
        # Equal timestamps are intentionally unresolved: webhook timestamps
        # have second precision and cannot prove the reply followed the inbound.
        row["needs_reply"] = bool(
            inbound_at and (not human_reply_at or inbound_at >= human_reply_at)
        )
    return True


async def _backfill_cloud_needs_reply(scope_query: dict):
    """Lazily materialize a bounded page of legacy conversations.

    Normal inbox polling only reads materialized flags/counts.  This bounded
    migration is intentionally the sole historical-message read and eventually
    drains old records without an unbounded per-poll scan.
    """
    conversations = _db["whatsapp_cloud_conversations"]
    legacy_query = {
        **scope_query,
        "needs_reply": {"$exists": False},
    }
    legacy_rows = await conversations.find(
        legacy_query, {"_id": 0}
    ).sort("last_message_at", -1).limit(
        CLOUD_INBOX_LEGACY_BACKFILL_LIMIT
    ).to_list(length=CLOUD_INBOX_LEGACY_BACKFILL_LIMIT)
    if not legacy_rows:
        return
    conversation_ids = [row["id"] for row in legacy_rows if row.get("id")]
    message_aggregate = getattr(
        _db["whatsapp_cloud_messages"], "aggregate", None
    )
    if message_aggregate:
        # Mongo reduces historical rows to two timestamps per conversation;
        # unlike a Python scan this remains bounded even for old busy threads.
        grouped = await message_aggregate([
            {"$match": {"conversation_id": {"$in": conversation_ids}}},
            {"$group": {
                "_id": "$conversation_id",
                "last_inbound_at": {"$max": {"$cond": [
                    {"$eq": ["$direction", "inbound"]}, "$created_at", None,
                ]}},
                "last_human_reply_at": {"$max": {"$cond": [
                    {"$and": [
                        {"$eq": ["$direction", "outbound"]},
                        {"$not": [{"$in": [
                            {"$toLower": {"$ifNull": ["$status", ""]}},
                            list(_UNSUCCESSFUL_OUTBOUND_STATUSES),
                        ]}]},
                        {"$or": [
                            {"$eq": ["$human_reply", True]},
                            {"$eq": ["$echo_source", "human"]},
                            {"$and": [
                                {"$ne": [{"$ifNull": ["$sent_by", ""]}, ""]},
                                {"$ne": ["$source", "campaign"]},
                                {"$ne": ["$source", "connection_test"]},
                            ]},
                        ]},
                    ]},
                    "$created_at",
                    None,
                ]}},
            }},
        ]).to_list(length=CLOUD_INBOX_LEGACY_BACKFILL_LIMIT)
        timestamps = {row.get("_id"): row for row in grouped}
        for row in legacy_rows:
            aggregate_row = timestamps.get(row.get("id")) or {}
            inbound_at = max(
                (
                    value for value in (
                        _parse_cloud_message_time(row.get("last_inbound_at")),
                        _parse_cloud_message_time(
                            aggregate_row.get("last_inbound_at")
                        ),
                    ) if value
                ),
                default=None,
            )
            human_reply_at = max(
                (
                    value for value in (
                        _parse_cloud_message_time(
                            row.get("last_human_reply_at")
                        ),
                        _parse_cloud_message_time(
                            aggregate_row.get("last_human_reply_at")
                        ),
                    ) if value
                ),
                default=None,
            )
            row["needs_reply"] = bool(
                inbound_at and (
                    not human_reply_at or inbound_at >= human_reply_at
                )
            )
    elif not await _hydrate_cloud_conversation_needs_reply(legacy_rows):
        return
    # Writes are bounded and conditional, so concurrent inbound/reply updates
    # always win over this old-data backfill.
    for row in legacy_rows:
        await conversations.update_one(
            {
                "id": row["id"],
                "needs_reply": {"$exists": False},
            },
            {"$set": {"needs_reply": row["needs_reply"]}},
        )


async def _scoped_cloud_unread_count(scope_query: dict) -> int:
    """Return the full scoped unread total, never the visible-page subtotal."""
    conversations = _db["whatsapp_cloud_conversations"]
    aggregate = getattr(conversations, "aggregate", None)
    if aggregate:
        rows = await aggregate([
            {"$match": scope_query},
            {"$group": {
                "_id": None,
                "count": {"$sum": {"$ifNull": ["$unread_count", 0]}},
            }},
        ]).to_list(length=1)
        return int((rows[0] if rows else {}).get("count") or 0)
    raise RuntimeError("Cloud inbox unread aggregation is unavailable")


def _phone_message_builder(branch_id):
    return lambda identity, record: whatsapp_phone_mirror.message_document(
        branch_id, identity, record, _normalize_whatsflow_message,
        _extract_whatsflow_body, _whatsflow_history_timestamp,
        _provider_marks_view_once, _whatsflow_history_status, _archive_pending_fields,
    )


async def _phone_client(branch_id):
    config = await _db['whatsapp_branch_configs'].find_one(
        {'branch_id': branch_id, 'provider': 'whatsflow', 'enabled': True}, {'_id': 0}
    )
    client = _whatsflow_client(config or {})
    if not client.configured:
        raise HTTPException(409, 'Complete the branch Whatsflow connection first')
    return client


_phone_snapshot_locks = {}


async def _refresh_phone_snapshot(branch_id, force=False):
    lock_key = (get_current_tenant_slug(), branch_id)
    lock = _phone_snapshot_locks.setdefault(lock_key, asyncio.Lock())
    async with lock:
        previous = await _db['whatsapp_phone_sync'].find_one({'branch_id': branch_id}, {'_id': 0})
        if not force and previous:
            try:
                if (datetime.now(timezone.utc) - datetime.fromisoformat(previous['synced_at'])).total_seconds() < 30:
                    return previous
            except (ValueError, KeyError):
                pass
        try:
            client = await _phone_client(branch_id)
            ok, rows, error = await client.find_chats()
            if not ok:
                raise HTTPException(502, 'Phone chat list is unavailable from the provider')
            await whatsapp_phone_mirror.store_snapshot(_db, branch_id, rows, _phone_message_builder(branch_id))
        except (HTTPException, ValueError):
            if previous and not force:
                return {**previous, 'stale': True}
            raise HTTPException(502, 'Provider chat identities or unread counts are unavailable')
        return await _db['whatsapp_phone_sync'].find_one({'branch_id': branch_id}, {'_id': 0})


@router.post('/cloud-inbox/phone-sync/{branch_id}')
async def enable_phone_mirror(branch_id: str, current_user: dict = Depends(get_current_user)):
    _require_bulk_whatsapp_access(current_user)
    _assert_branch_access(current_user, branch_id)
    snapshot = await _refresh_phone_snapshot(branch_id, force=True)
    return {'success': True, **snapshot}


async def _import_phone_history(conversation, page=1):
    branch_id = conversation['branch_id']
    client = await _phone_client(branch_id)
    ok, result, error = await client.history_page(conversation['remote_jid'], page)
    if not ok:
        raise HTTPException(502, 'Phone message history is unavailable from the provider')
    recent_records = [r for r in result['records']
                      if whatsapp_phone_mirror.recent_timestamp(_whatsflow_history_timestamp(r))]
    result = {**result, 'records': recent_records,
              'has_more': result['has_more'] and len(recent_records) == len(result['records'])}
    build = _phone_message_builder(branch_id)
    documents = [d for d in (build(conversation, r) for r in result['records']) if d]
    recent = [d for d in documents if whatsapp_phone_mirror.recent_timestamp(d.get('created_at'))]
    if len(recent) < len(documents):
        result = {**result, 'has_more': False}
    documents = recent
    await whatsapp_phone_mirror.store_messages(_db, documents)
    ids = [d['provider_message_id'] for d in documents]
    stored = await _db['whatsapp_cloud_messages'].find({
        'branch_id': branch_id, 'conversation_id': conversation['id'],
        'provider': 'whatsflow', 'provider_message_id': {'$in': ids},
    }, {'_id': 0}).sort('created_at', 1).to_list(length=50)
    return client, result, stored


@router.get('/cloud-inbox/conversations/{conversation_id}/phone-history')
async def get_phone_history(conversation_id: str, page: int = Query(1, ge=1, le=100000),
                            current_user: dict = Depends(get_current_user)):
    _require_bulk_whatsapp_access(current_user)
    conversation = await _db['whatsapp_cloud_conversations'].find_one({'id': conversation_id}, {'_id': 0})
    if not conversation:
        raise HTTPException(404, 'Conversation not found')
    _assert_branch_access(current_user, conversation['branch_id'])
    if not conversation.get('phone_mirrored'):
        raise HTTPException(409, 'Enable phone synchronization for this branch first')
    _, result, stored = await _import_phone_history(conversation, page)
    return {'messages': stored, 'has_more': result['has_more'], 'page': page, 'total': result['total'], 'history_days': 30}


@router.get("/cloud-inbox/conversations")
async def list_cloud_inbox_conversations(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    unread_only: bool = False,
    needs_reply_only: bool = False,
    search: Optional[str] = None,
):
    _require_bulk_whatsapp_access(current_user)
    # Resolve the selected branch for both views.  In particular, unread must
    # not silently turn a selected branch into a cross-branch aggregation.
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    scope_query = {"branch_id": effective_branch} if effective_branch else {}
    phone_snapshot = None
    if effective_branch:
        phone_snapshot = await _db['whatsapp_phone_sync'].find_one({'branch_id': effective_branch, 'enabled': True}, {'_id': 0})
        if phone_snapshot:
            phone_snapshot = await _refresh_phone_snapshot(effective_branch)
            scope_query['phone_snapshot'] = phone_snapshot['snapshot']
    # The focused needs-reply view must see its bounded backfill before its
    # materialized predicate runs.  Other polling views run it concurrently so
    # a legacy migration never serializes the cloud/campaign reads.
    backfill_request = None
    if needs_reply_only:
        await _backfill_cloud_needs_reply(scope_query)
        backfill_request = asyncio.sleep(0)
    else:
        backfill_request = _backfill_cloud_needs_reply(scope_query)
    conversations = _db["whatsapp_cloud_conversations"]
    query = dict(scope_query)
    if unread_only:
        # Apply this predicate before Mongo's sort/limit so an old unread
        # conversation cannot be hidden behind newer read conversations.
        query["unread_count"] = {"$gt": 0}
    if needs_reply_only:
        query["needs_reply"] = True

    search_text = (search or "").strip()[:CLOUD_INBOX_SEARCH_MAX_LENGTH]
    if search_text:
        # Treat user input as plain text rather than a Mongo expression. Search
        # message history separately, then apply the authorized conversation
        # scope below; a message can therefore never widen branch access.
        escaped_search = re.escape(search_text)
        message_query = {
            "body": {"$regex": escaped_search, "$options": "i"},
            "view_once": {"$ne": True},
            "archive_status": {"$ne": "deleted"},
        }
        if effective_branch:
            message_query["branch_id"] = effective_branch
        # ``distinct`` searches the whole stored history without loading message
        # bodies into application memory. The final conversation read remains
        # sorted and capped to the normal 200-row inbox page.
        message_conversation_ids = [
            value for value in await _db["whatsapp_cloud_messages"].distinct(
                "conversation_id", message_query
            )
            if value
        ]
        identity_predicates = [
            {"contact_name": {"$regex": escaped_search, "$options": "i"}},
            {"phone": {"$regex": escaped_search, "$options": "i"}},
        ]
        if message_conversation_ids:
            identity_predicates.append({"id": {"$in": message_conversation_ids}})
        query["$or"] = identity_predicates

    # All regular polling reads are bounded.  The full scoped counts use
    # server-side aggregation/counting, not the 200-row response page.
    cloud_rows_request = (
        conversations
        .find(query, {"_id": 0})
        .sort("last_message_at", -1)
        .limit(20000 if phone_snapshot else 200)
        .to_list(length=20000 if phone_snapshot else 200)
    )
    needs_reply_count_request = conversations.count_documents({
        **scope_query, "needs_reply": True,
    })
    unread_count_request = _scoped_cloud_unread_count(scope_query)
    if phone_snapshot or unread_only or needs_reply_only or search_text:
        # Campaign sends are outbound projections and always have
        # ``unread_count == 0`` and never resolve a human response. Keep them
        # out of focused/search views entirely. In particular, search must not
        # expose an unsent campaign queue projection as conversation history.
        gathered = await asyncio.gather(
            cloud_rows_request, needs_reply_count_request, unread_count_request,
            backfill_request,
        )
        rows, needs_reply_count, unread_count, _ = gathered
        campaign_rows = []
    else:
        gathered = await asyncio.gather(
            cloud_rows_request,
            campaign_inbox.conversations(_db, query),
            needs_reply_count_request,
            unread_count_request,
            backfill_request,
        )
        rows, campaign_rows, needs_reply_count, unread_count, _ = gathered
    for row in rows:
        row["needs_reply"] = row.get("needs_reply") is True
    merged = {row["id"]: row for row in rows}
    for campaign in campaign_rows:
        campaign["needs_reply"] = False
        existing = merged.get(campaign["id"])
        if not existing:
            merged[campaign["id"]] = campaign
        elif campaign["last_message_at"] > campaign_inbox.iso(existing.get("last_message_at")):
            # These fields describe one selected message.  Update them as a
            # unit so a queued campaign preview cannot inherit a stale source,
            # status, or timestamp kind from the stored conversation.
            existing.update({
                key: campaign[key] for key in campaign_inbox.PREVIEW_FIELDS
            })
    rows = sorted(merged.values(), key=lambda row: campaign_inbox.iso(row.get("last_message_at")), reverse=True)[:20000 if phone_snapshot else 200]
    rows = await _enrich_member_phone_matches(
        rows,
        current_user,
        # Associations stay inside each conversation's branch, even when
        # an admin views conversations across multiple branches.
        member_branch=effective_branch,
    )
    branch_ids = {
        row.get("branch_id")
        for row in rows
        if row.get("branch_id")
    }
    branch_names = {}
    if branch_ids:
        branch_rows = await _db["branches"].find(
            {"id": {"$in": list(branch_ids)}},
            {"_id": 0, "id": 1, "name": 1},
        ).to_list(length=None)
        branch_names = {
            branch.get("id"): branch.get("name") or branch.get("id")
            for branch in branch_rows
            if branch.get("id")
        }
    for row in rows:
        branch_id = row.get("branch_id")
        row["branch_name"] = branch_names.get(branch_id) or branch_id
    return {
        "conversations": rows,
        "unread_count": phone_snapshot['unread_chats'] if phone_snapshot else unread_count,
        **({'phone_sync': phone_snapshot} if phone_snapshot else {}),
        "needs_reply_count": int(needs_reply_count or 0),
    }


@router.get("/cloud-inbox/conversations/{conversation_id}")
async def get_cloud_inbox_thread(
    conversation_id: str, current_user: dict = Depends(get_current_user)
):
    _require_bulk_whatsapp_access(current_user)
    conversation = await _db["whatsapp_cloud_conversations"].find_one(
        {"id": conversation_id}, {"_id": 0}
    )
    if not conversation:
        conversation = await _campaign_conversation(conversation_id, current_user)
    _assert_branch_access(current_user, conversation.get("branch_id"))
    phone_history = None
    if conversation.get('phone_mirrored'):
        try:
            phone_client, phone_history, phone_messages = await _import_phone_history(conversation)
            cloud_rows, campaign_messages = list(reversed(phone_messages)), []
        except HTTPException as exc:
            if exc.status_code not in (409, 502):
                raise
            cloud_rows = await _db['whatsapp_cloud_messages'].find({
                'conversation_id': conversation_id, 'branch_id': conversation['branch_id'],
                'created_at': {'$gte': (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()},
            }, {'_id': 0}).sort('created_at', -1).limit(50).to_list(length=50)
            campaign_messages = []
            conversation['phone_history_stale'] = True
    else:
        cloud_rows, campaign_messages = await asyncio.gather(
        _db["whatsapp_cloud_messages"]
        .find({"conversation_id": conversation_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(501)
        .to_list(length=501),
        campaign_inbox.thread(
            _db, conversation["branch_id"], conversation["phone"]
        ),
    )
    # Load the newest page, then restore chronological order for rendering.
    # The extra row is only a completeness sentinel and is never marked read.
    fetched_complete = len(cloud_rows) <= 500
    cloud_messages = list(reversed(cloud_rows[:500]))
    messages = campaign_inbox.merge_messages(
        cloud_messages, campaign_messages
    )
    if phone_history:
        # Send read receipts for exact inbound keys on the fetched provider page.
        # Never infer that the customer reading an outbound message read our inbox.
        keys = [r['key'] for r in phone_history['records']
                if isinstance(r.get('key'), dict) and r['key'].get('fromMe') is False]
        if keys and conversation.get('unread_count', 0) > 0:
            ok, _, _ = await phone_client.mark_messages_read(keys)
            if not ok:
                raise HTTPException(502, 'Could not synchronize read state with the phone')
            await _refresh_phone_snapshot(conversation['branch_id'], force=True)
        else:
            await _refresh_phone_snapshot(conversation['branch_id'])
    elif not conversation.get('phone_mirrored'):
        await _mark_cloud_inbound_read(
            conversation_id, conversation.get("branch_id") or "", cloud_messages,
            provider=None, fetched_complete=fetched_complete,
        )
    branch = await _db["branches"].find_one(
        {"id": conversation.get("branch_id")}, {"_id": 0, "name": 1}
    )
    conversation["branch_name"] = (branch or {}).get("name")
    conversation = (
        await _enrich_member_phone_matches(
            [conversation],
            current_user,
            member_branch=conversation.get("branch_id"),
            include_candidates=True,
        )
    )[0]
    return {"conversation": conversation, "messages": messages,
            "phone_history": {'has_more': phone_history['has_more'], 'total': phone_history['total']} if phone_history else None}


def _whatsflow_history_timestamp(record: dict) -> Optional[str]:
    raw = record.get("messageTimestamp")
    if raw is None:
        raw = record.get("timestamp")
    try:
        epoch = float(raw)
        if epoch > 1e12:
            epoch /= 1000
        if epoch <= 0:
            return None
        return datetime.fromtimestamp(epoch, timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def _whatsflow_history_status(record: dict) -> str:
    """Use only a persisted provider receipt as delivery evidence."""
    raw = record.get("status")
    if not isinstance(raw, str):
        return "accepted"
    normalized = raw.strip().lower()
    return {
        "sent": "sent",
        "server_ack": "sent",
        "delivered": "delivered",
        "delivery_ack": "delivered",
        "read": "read",
        "played": "read",
        "failed": "failed",
        "error": "failed",
        "pending": "pending",
    }.get(normalized, "accepted")


@router.post("/cloud-inbox/conversations/{conversation_id}/sync-phone-replies")
async def sync_cloud_inbox_phone_replies(
    conversation_id: str, current_user: dict = Depends(get_current_user)
):
    """Import a bounded, read-only page of exact Whatsflow outbound text."""
    _require_bulk_whatsapp_access(current_user)
    conversation = await _db["whatsapp_cloud_conversations"].find_one(
        {"id": conversation_id}, {"_id": 0}
    )
    if not conversation:
        conversation = await _campaign_conversation(conversation_id, current_user)
    branch_id = conversation.get("branch_id")
    _assert_branch_access(current_user, branch_id)
    if conversation.get("provider") != "whatsflow":
        raise HTTPException(
            status_code=400,
            detail="Phone reply sync is only available for Whatsflow",
        )
    phone = str(conversation.get("phone") or "")
    if not phone.isdigit():
        raise HTTPException(status_code=400, detail="Conversation phone is invalid")
    remote_jid = f"{phone}@s.whatsapp.net"
    config = await _db["whatsapp_branch_configs"].find_one(
        {
            "branch_id": branch_id,
            "provider": "whatsflow",
            "enabled": True,
        },
        {"_id": 0},
    )
    if not config or not config.get("whatsflow_instance"):
        raise HTTPException(
            status_code=409,
            detail="Whatsflow is not configured for this branch",
        )

    ok, records, error = await _whatsflow_client(config).find_messages(
        remote_jid, True, limit=50
    )
    if not ok:
        logger.warning(
            "Whatsflow phone reply history unavailable for branch %s: %s",
            branch_id,
            error,
        )
        raise HTTPException(
            status_code=502,
            detail="Phone reply history is unavailable from the provider",
        )

    messages = _db["whatsapp_cloud_messages"]
    await messages.create_index(
        [("branch_id", 1), ("provider", 1), ("provider_message_id", 1)],
        unique=True,
        partialFilterExpression={
            "provider": "whatsflow", "provider_message_id": {"$exists": True}
        },
    )
    imported = 0
    existing_count = 0
    excluded = 0
    now = datetime.now(timezone.utc).isoformat()
    for record in records:
        if not isinstance(record, dict):
            excluded += 1
            continue
        key = record.get("key")
        if not isinstance(key, dict):
            excluded += 1
            continue
        provider_id = key.get("id")
        record_jid = key.get("remoteJid")
        from_me = _strict_provider_bool(key.get("fromMe"))
        if (
            not isinstance(provider_id, str)
            or not provider_id
            or record_jid != remote_jid
            or from_me is not True
        ):
            excluded += 1
            continue
        raw_message = record.get("message")
        if (
            not isinstance(raw_message, dict)
            or _provider_marks_view_once(raw_message)
        ):
            excluded += 1
            continue
        normalized = _normalize_whatsflow_message(raw_message)
        if any(
            isinstance(normalized.get(kind), dict)
            for kind in (
                "imageMessage", "documentMessage", "audioMessage",
                "videoMessage", "stickerMessage",
            )
        ):
            excluded += 1
            continue
        body = _extract_whatsflow_body(raw_message, record)
        created_at = _whatsflow_history_timestamp(record)
        if not body or not created_at:
            excluded += 1
            continue

        scope = {
            "branch_id": branch_id,
            "provider": "whatsflow",
            "provider_message_id": provider_id,
        }
        existing = await messages.find_one(
            scope, {"_id": 0, "body": 1, "conversation_id": 1}
        )
        if existing:
            existing_count += 1
            # Never rewrite known evidence. The sole safe repair is filling an
            # empty body on the same provider identity and conversation.
            if (
                existing.get("conversation_id") == conversation_id
                and not existing.get("body")
            ):
                await messages.update_one(
                    {
                        **scope,
                        "conversation_id": conversation_id,
                        "$or": [
                            {"body": ""},
                            {"body": None},
                            {"body": {"$exists": False}},
                        ],
                    },
                    {"$set": {"body": body}},
                )
            continue
        historical = {
            "id": str(uuid.uuid4()),
            "conversation_id": conversation_id,
            "branch_id": branch_id,
            "provider": "whatsflow",
            "provider_message_id": provider_id,
            "direction": "outbound",
            "phone": phone,
            "type": "text",
            "body": body,
            "status": _whatsflow_history_status(record),
            "unread": False,
            "source": "history",
            "echo_source": "history",
            "created_at": created_at,
            "received_at": now,
            "view_once": False,
        }
        try:
            await messages.insert_one(historical)
            imported += 1
        except DuplicateKeyError:
            existing_count += 1

    outcome = (
        "partial" if excluded
        else "empty" if imported == 0 and existing_count == 0
        else "unchanged" if imported == 0
        else "imported"
    )
    return {
        "success": True,
        "outcome": outcome,
        "imported": imported,
        "existing": existing_count,
        "excluded": excluded,
        "scanned": len(records),
    }


async def _campaign_conversation(conversation_id, current_user):
    branch_id, sep, phone = conversation_id.partition(":")
    if not sep or not phone.isdigit():
        raise HTTPException(status_code=404, detail="Conversation not found")
    _assert_branch_access(current_user, branch_id)
    messages = await campaign_inbox.thread(_db, branch_id, phone)
    if not messages:
        raise HTTPException(status_code=404, detail="Conversation not found")
    latest = max(messages, key=lambda m: m["created_at"])
    return {"id": conversation_id, "branch_id": branch_id, "phone": phone,
            "provider": latest["provider"], "contact_name": phone, "unread_count": 0}


def _cloud_media_scope(branch_id: str, media_id: str) -> dict:
    """Build the complete scope for a private direct-chat media object.

    Tenant databases are already isolated by the database proxy, but retaining
    the tenant slug in these records makes accidental cross-tenant reads
    fail closed if a proxy or test double is ever misconfigured.
    """
    return {
        "tenant_slug": get_current_tenant_slug(),
        "branch_id": branch_id,
        "media_id": media_id,
    }


async def _download_inbound_archive_media(message: dict) -> tuple[bytes, str, str]:
    """Provider retrieval used only by the durable archive worker.

    Credentials remain in this route/provider integration and are never
    included in archive errors.  In particular Whatsflow is always asked to
    decrypt its stored message rather than fetching its encrypted CDN URL.
    """
    provider = message.get("provider")
    branch_id = str(message.get("branch_id") or "")
    fallback_name = message.get("filename") or "attachment"
    if provider == "whatsflow":
        config = await _get_branch_cloud_config(branch_id)
        client = _whatsflow_client(config or {})
        if not client.configured:
            raise whatsapp_media_archive.ArchiveError("unavailable", "Whatsflow attachment is unavailable")
        ok, media, error = await client.get_base64_from_media_message(
            str(message.get("provider_message_id") or message.get("whatsflow_message_id") or ""))
        if not ok or not isinstance(media, dict):
            status = "unsupported" if error == "media_too_large" else "unavailable" if error in {
                "http_404", "http_410", "missing_message_id"} else "failed"
            raise whatsapp_media_archive.ArchiveError(status, "Whatsflow attachment is unavailable" if status == "unavailable" else "Attachment download failed")
        return media["content"], media["mime_type"], media.get("filename") or fallback_name
    if provider == "waha":
        url = str(message.get("media_url") or "")
        waha = WAHAClient()
        base = urlparse(waha.base_url)
        def host_ok(candidate: str) -> bool:
            parsed = urlparse(candidate)
            return bool(waha.configured and parsed.scheme in {"http", "https"}
                        and parsed.scheme == base.scheme and parsed.hostname
                        and parsed.hostname == base.hostname and parsed.port == base.port)
        content = await whatsapp_media_archive.stream_download(
            url, {"X-Api-Key": waha.api_key}, host_ok)
        return content, str(message.get("mime_type") or ""), fallback_name
    config = await _get_branch_cloud_config(branch_id)
    if not config or not config.get("access_token_encrypted") or not message.get("media_id"):
        raise whatsapp_media_archive.ArchiveError("unavailable", "Meta attachment is unavailable")
    token = _decrypt_access_token(config["access_token_encrypted"])
    version = (config.get("graph_api_version") or "v23.0").strip()
    headers = {"Authorization": f"Bearer {token}"}
    graph_url = (
        f"https://graph.facebook.com/{quote(version, safe='.')}/"
        f"{quote(str(message['media_id']), safe='')}"
    )
    metadata_raw = await whatsapp_media_archive.stream_download(
        graph_url, headers,
        lambda candidate: (
            urlparse(candidate).scheme == "https"
            and (urlparse(candidate).hostname or "").lower() == "graph.facebook.com"
        ),
        max_bytes=256 * 1024,
    )
    try:
        metadata = json.loads(metadata_raw.decode("utf-8"))
        url = str((metadata or {}).get("url") or "")
    except Exception:
        raise whatsapp_media_archive.ArchiveError("failed", "Attachment metadata is unavailable")
    def meta_host_ok(candidate: str) -> bool:
        parsed = urlparse(candidate)
        hostname = (parsed.hostname or "").lower()
        return parsed.scheme == "https" and (
            hostname == "lookaside.fbsbx.com" or hostname.endswith(".fbcdn.net")
            or hostname.endswith(".fbsbx.com"))
    content = await whatsapp_media_archive.stream_download(url, headers, meta_host_ok)
    return content, str(message.get("mime_type") or metadata.get("mime_type") or ""), fallback_name


async def _archive_one_cloud_message(message_id: str) -> str:
    return await whatsapp_media_archive.process_message(
        _db, get_current_tenant_slug(), message_id, _download_inbound_archive_media)


async def _archive_current_tenant_batch(limit: int = 20) -> int:
    """Resume newest queued work while steadily enrolling legacy history."""
    now = datetime.now(timezone.utc).isoformat()
    messages = _db["whatsapp_cloud_messages"]
    # Stored copies are a repair-only lane: mark legacy/pending projections
    # archived from metadata without placing them in the provider backlog.
    stored_rows = await messages.find({
        "direction": "inbound", "media_storage_id": {"$exists": True},
        "archive_status": {"$nin": ["archived", "deleted"]},
    }, {"_id": 0}).sort("received_at", -1).limit(4).to_list(4)
    query = {
        "direction": "inbound",
        "type": {"$in": ["image", "audio", "video", "document"]},
        "archive_status": {"$in": ["pending", "failed"]},
        "media_storage_id": {"$exists": False},
        "$or": [{"archive_next_at": {"$exists": False}}, {"archive_next_at": {"$lte": now}}],
    }
    legacy_slots = min(4, max(0, limit - len(stored_rows)))
    rows = await messages.find(query, {"_id": 0}).sort("received_at", -1).limit(
        max(0, limit - legacy_slots - len(stored_rows))).to_list(
            max(0, limit - legacy_slots - len(stored_rows)))
    # Historical rows are gradually enrolled oldest-first across all dates;
    # reserving a few slots prevents an active inbox from starving backfill.
    legacy = await messages.find({
        "direction": "inbound", "type": {"$in": ["image", "audio", "video", "document"]},
        "archive_status": {"$exists": False},
    }, {"_id": 0}).sort("received_at", 1).limit(legacy_slots).to_list(legacy_slots)
    for message in legacy:
        if _is_inbound_attachment(message):
            await messages.update_one({"id": message["id"], "archive_status": {"$exists": False}},
                                      {"$set": {"archive_status": "pending", "archive_error": None}})
            message["archive_status"] = "pending"
            rows.append(message)
        else:
            # Do not let an old malformed/view-once/no-reference row occupy
            # every oldest-first reservation forever.  It is deliberately
            # terminal rather than retried or downloaded.
            await messages.update_one(
                {"id": message["id"], "archive_status": {"$exists": False}},
                {"$set": {"archive_status": "unsupported",
                          "archive_error": "Attachment is not eligible for archive"}},
            )
    for message in (stored_rows + rows)[:limit]:
        await _archive_one_cloud_message(message["id"])
    return min(len(stored_rows) + len(rows), limit)


_media_archive_started = False


async def _media_archive_loop():
    global _media_archive_started
    _media_archive_started = True
    from utils.tenant import for_each_active_tenant
    while True:
        try:
            await for_each_active_tenant(
                lambda _tenant: _archive_current_tenant_batch(),
                label="whatsapp-media-archive",
            )
            await asyncio.sleep(15)
        except asyncio.CancelledError:
            return
        except Exception:
            logger.warning("WhatsApp media archive worker cycle failed")
            await asyncio.sleep(15)


def start_media_archive_worker():
    if not _media_archive_started:
        asyncio.ensure_future(_media_archive_loop())


async def _read_cloud_chat_image(upload: UploadFile) -> tuple[bytes, str, str]:
    """Read and validate one direct-chat JPG/PNG upload.

    The browser's MIME type is only a hint.  The signature and bounded read are
    authoritative, so a renamed HTML/JS file cannot become an image message.
    """
    mime = (upload.content_type or "").split(";", 1)[0].strip().lower()
    if mime not in {"image/jpeg", "image/png"}:
        raise HTTPException(status_code=400, detail="Only JPG and PNG images are supported")

    content = bytearray()
    while True:
        chunk = await upload.read(CLOUD_CHAT_MEDIA_CHUNK_SIZE)
        if not chunk:
            break
        content.extend(chunk)
        if len(content) > CLOUD_CHAT_IMAGE_LIMIT:
            raise HTTPException(status_code=413, detail="Image exceeds the 5 MB limit")
    raw = bytes(content)
    if not raw:
        raise HTTPException(status_code=400, detail="Image is empty")
    signature_ok = (
        raw.startswith(b"\xff\xd8\xff")
        if mime == "image/jpeg"
        else raw.startswith(b"\x89PNG\r\n\x1a\n")
    )
    if not signature_ok:
        raise HTTPException(status_code=400, detail="Image content does not match its type")
    extension = ".jpg" if mime == "image/jpeg" else ".png"
    filename = Path(upload.filename or f"image{extension}").name[:180]
    if not filename or filename in {".", ".."}:
        filename = f"image{extension}"
    return raw, mime, filename


async def _run_audio_tool(arguments: list[str]) -> tuple[int, bytes]:
    """Run a fixed ffmpeg/ffprobe argument vector with a hard wall-clock limit."""
    process = await asyncio.create_subprocess_exec(
        *arguments,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        stdout, _ = await asyncio.wait_for(
            process.communicate(), timeout=CLOUD_CHAT_AUDIO_PROBE_TIMEOUT
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        raise HTTPException(status_code=400, detail="Audio processing timed out")
    return process.returncode or 0, stdout


def _cloud_audio_kind(raw: bytes, mime: str) -> str:
    """Require the claimed browser format and a matching container signature."""
    if mime == "audio/ogg" and raw.startswith(b"OggS") and b"OpusHead" in raw[:512]:
        return "ogg"
    if mime == "audio/opus" and raw.startswith(b"OggS") and b"OpusHead" in raw[:512]:
        return "ogg"
    if mime == "audio/webm" and raw.startswith(b"\x1aE\xdf\xa3") and b"webm" in raw[:4096].lower():
        return "webm"
    if mime == "audio/mp4" and len(raw) >= 12 and raw[4:8] == b"ftyp":
        return "mp4"
    if mime == "audio/aac" and len(raw) >= 2 and raw[0] == 0xff and raw[1] & 0xf6 == 0xf0:
        return "aac"
    raise HTTPException(status_code=400, detail="Audio content does not match its type")


async def _read_cloud_chat_audio(upload: UploadFile) -> tuple[bytes, str, str]:
    """Bound, probe and normalize browser audio to an OGG/Opus voice note.

    The upload stays in a 10 MiB memory bound.  Files which need transcoding
    are placed in a private temporary directory and all subprocess arguments
    are fixed values/paths (never shell-interpolated).
    """
    mime = (upload.content_type or "").split(";", 1)[0].strip().lower()
    allowed = {"audio/webm", "audio/ogg", "audio/opus", "audio/mp4", "audio/aac"}
    if mime not in allowed:
        raise HTTPException(
            status_code=400,
            detail="Only WebM/Opus, OGG/Opus, MP4/AAC, or AAC audio is supported",
        )
    content = bytearray()
    while True:
        chunk = await upload.read(CLOUD_CHAT_MEDIA_CHUNK_SIZE)
        if not chunk:
            break
        content.extend(chunk)
        if len(content) > CLOUD_CHAT_AUDIO_LIMIT:
            raise HTTPException(status_code=413, detail="Audio exceeds the 10 MiB limit")
    raw = bytes(content)
    if not raw:
        raise HTTPException(status_code=400, detail="Audio is empty")
    kind = _cloud_audio_kind(raw, mime)
    ffprobe = shutil.which("ffprobe")
    ffmpeg = shutil.which("ffmpeg")
    # Container/header durations are frequently unavailable for MediaRecorder's
    # non-seekable WebM output.  Decode every input fully into a local OGG Opus
    # file, then inspect that file's actual duration instead.  This also means
    # an input longer than 120 seconds is rejected rather than silently cut.
    if not ffprobe or not ffmpeg:
        raise HTTPException(
            status_code=503,
            detail="Audio validation requires ffmpeg and ffprobe on this server",
        )
    suffix = {"ogg": ".ogg", "webm": ".webm", "mp4": ".m4a", "aac": ".aac"}[kind]
    with tempfile.TemporaryDirectory(prefix="cloud-voice-") as temp_dir:
        source = os.path.join(temp_dir, f"input{suffix}")
        with open(source, "wb") as source_file:
            source_file.write(raw)
        code, probe = await _run_audio_tool([
            ffprobe, "-protocol_whitelist", "file,pipe", "-v", "error",
            "-select_streams", "a:0", "-show_entries", "stream=codec_name",
            "-of", "default=noprint_wrappers=1:nokey=1", source,
        ])
        lines = probe.decode("ascii", "ignore").strip().splitlines()
        expected_codec = {"ogg": "opus", "webm": "opus", "mp4": "aac", "aac": "aac"}[kind]
        if code or not lines or lines[0].strip().lower() != expected_codec:
            raise HTTPException(
                status_code=400,
                detail=f"{kind.upper()} audio does not use its required {expected_codec.upper()} codec",
            )
        normalized = os.path.join(temp_dir, "voice.ogg")
        code, _ = await _run_audio_tool([
            ffmpeg, "-nostdin", "-xerror", "-v", "error", "-threads", "1",
            "-protocol_whitelist", "file,pipe", "-i", source, "-map", "0:a:0",
            "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus",
            "-f", "ogg", "-fs", str(CLOUD_CHAT_AUDIO_LIMIT), normalized,
        ])
        try:
            with open(normalized, "rb") as normalized_file:
                voice = normalized_file.read(CLOUD_CHAT_AUDIO_LIMIT + 1)
        except OSError:
            voice = b""
        if code or not voice or len(voice) >= CLOUD_CHAT_AUDIO_LIMIT or not (
            voice.startswith(b"OggS") and b"OpusHead" in voice[:512]
        ):
            raise HTTPException(status_code=400, detail="Audio could not be normalized to OGG Opus")
        code, normalized_probe = await _run_audio_tool([
            ffprobe, "-protocol_whitelist", "file,pipe", "-v", "error",
            "-show_entries", "stream=codec_name:format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", normalized,
        ])
        normalized_lines = normalized_probe.decode("ascii", "ignore").strip().splitlines()
        try:
            duration = float(normalized_lines[-1])
        except (ValueError, IndexError):
            duration = 0
        if (
            code or len(normalized_lines) < 2
            or normalized_lines[0].strip().lower() != "opus"
            or duration != duration or duration <= 0
            # libopus writes whole 20ms frames, so a recorder stopped exactly
            # at 120.000 seconds can serialize as ~120.014.  The small
            # tolerance permits codec padding only, never a 121-second note.
            or duration > (
                CLOUD_CHAT_AUDIO_MAX_SECONDS + CLOUD_CHAT_AUDIO_DURATION_TOLERANCE
            )
        ):
            raise HTTPException(
                status_code=400,
                detail="Audio must be a valid recording no longer than 120 seconds",
            )
    return voice, "audio/ogg", "voice.ogg"


async def _store_cloud_chat_image(branch_id: str, content: bytes, mime: str, filename: str) -> dict:
    """Store direct-chat bytes privately before provider dispatch."""
    media_id = str(uuid.uuid4())
    scope = _cloud_media_scope(branch_id, media_id)
    chunks = _db["whatsapp_cloud_media_chunks"]
    meta = _db["whatsapp_cloud_media"]
    try:
        for index, offset in enumerate(
            range(0, len(content), CLOUD_CHAT_MEDIA_CHUNK_SIZE)
        ):
            await chunks.insert_one({
                **scope,
                "index": index,
                "data": content[offset:offset + CLOUD_CHAT_MEDIA_CHUNK_SIZE],
            })
        await meta.insert_one({
            **scope,
            "name": filename,
            "mime_type": mime,
            "size": len(content),
            "chunk_count": (
                len(content) + CLOUD_CHAT_MEDIA_CHUNK_SIZE - 1
            ) // CLOUD_CHAT_MEDIA_CHUNK_SIZE,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        await _delete_cloud_chat_image(branch_id, media_id)
        raise
    return {
        "media_id": media_id,
        "mime_type": mime,
        "filename": filename,
        "size": len(content),
    }


async def _delete_cloud_chat_image(branch_id: str, media_id: Optional[str]):
    if not media_id:
        return
    scope = _cloud_media_scope(branch_id, media_id)
    chunks = _db["whatsapp_cloud_media_chunks"]
    meta = _db["whatsapp_cloud_media"]
    if hasattr(chunks, "delete_many"):
        await chunks.delete_many(scope)
    if hasattr(meta, "delete_one"):
        await meta.delete_one(scope)


async def _delete_unshared_cloud_chat_media(
    branch_id: str, media_id: Optional[str], message_id: str,
):
    """Remove a legacy direct-chat object only when this is its sole message.

    Archive-owned chunks are handled by the archive service.  Old sent image
    and voice copies have no archive ownership marker, so leaving them here
    would make the delete action a misleading tombstone-only operation.
    """
    if not media_id:
        return
    try:
        references = await _db["whatsapp_cloud_messages"].find(
            {"branch_id": branch_id, "media_storage_id": media_id}, {"_id": 0, "id": 1}
        ).limit(2).to_list(length=2)
        if references and all(row.get("id") == message_id for row in references):
            await _delete_cloud_chat_image(branch_id, media_id)
    except Exception:
        # Fail closed: a reference lookup failure must not remove shared bytes.
        logger.warning("Could not verify direct-chat media ownership for deletion")


async def _persist_fetched_inbound_archive(message: dict, content: bytes, mime_type: str, filename: str):
    """A successful on-demand provider fetch takes the same archive path as worker."""
    if not _is_inbound_attachment(message) or message.get("archive_status") == "deleted":
        return
    if not message.get("archive_status"):
        await _db["whatsapp_cloud_messages"].update_one(
            {"id": message["id"], "archive_status": {"$exists": False}},
            {"$set": {"archive_status": "pending", "archive_error": None}},
        )
    await whatsapp_media_archive.process_message(
        _db, get_current_tenant_slug(), message["id"],
        lambda _message: _ready_media(content, mime_type, filename),
    )


async def _ready_media(content: bytes, mime_type: str, filename: str):
    return content, mime_type, filename


async def _load_cloud_chat_image(branch_id: str, media_id: str) -> tuple[bytes, str, str]:
    scope = _cloud_media_scope(branch_id, media_id)
    meta = await _db["whatsapp_cloud_media"].find_one(scope, {"_id": 0})
    if not meta:
        raise HTTPException(status_code=404, detail="Media not found")
    if meta.get("archive_owner_message_id"):
        # Archive-owned inbound media must use the same integrity checks as
        # the archive worker. Legacy outbound objects keep their existing path.
        try:
            return await whatsapp_media_archive.load(
                _db, scope["tenant_slug"], branch_id, media_id,
            )
        except whatsapp_media_archive.ArchiveError as exc:
            raise HTTPException(status_code=500, detail=exc.detail) from exc
    expected_chunks = int(meta.get("chunk_count") or 0)
    cursor = _db["whatsapp_cloud_media_chunks"].find(scope).sort("index", 1)
    chunks = await cursor.to_list(length=expected_chunks + 1)
    if (
        len(chunks) != expected_chunks
        or any(chunk.get("index") != index for index, chunk in enumerate(chunks))
        or sum(len(chunk.get("data") or b"") for chunk in chunks)
        != int(meta.get("size") or 0)
    ):
        raise HTTPException(status_code=500, detail="Stored image data is incomplete")
    content = b"".join(chunk.get("data") or b"" for chunk in chunks)
    if len(content) > whatsapp_media_archive.MAX_MEDIA_BYTES:
        raise HTTPException(status_code=500, detail="Stored media exceeds the allowed size")
    return content, str(meta.get("mime_type") or "application/octet-stream"), str(
        meta.get("name") or "image"
    )


@router.post("/cloud-inbox/media/{message_id}/archive-retry")
async def retry_cloud_inbox_media_archive(
    message_id: str, current_user: dict = Depends(get_current_user)
):
    _require_bulk_whatsapp_access(current_user)
    message = await _db["whatsapp_cloud_messages"].find_one({"id": message_id}, {"_id": 0})
    if not message:
        raise HTTPException(status_code=404, detail="Media not found")
    _assert_branch_access(current_user, message.get("branch_id"))
    if message.get("archive_status") == "deleted":
        raise HTTPException(status_code=410, detail="Media was deleted")
    if not _is_inbound_attachment(message):
        raise HTTPException(status_code=400, detail="Only inbound attachments can be archived")
    now = datetime.now(timezone.utc).isoformat()
    if str(message.get("archive_lease_until") or "") > now:
        raise HTTPException(status_code=409, detail="Attachment archive is already in progress")
    await _db["whatsapp_cloud_messages"].update_one(
        {
            "id": message_id, "archive_status": {"$ne": "deleted"},
            "$or": [{"archive_lease_until": {"$exists": False}},
                    {"archive_lease_until": {"$lte": now}}],
        },
        {"$set": {"archive_status": "pending", "archive_error": None,
                  "archive_next_at": now,
                  "archive_attempts": 0},
         "$unset": {"archive_lease_until": "", "archive_leased_at": ""}},
    )
    return {"success": True, "status": "pending"}


@router.post("/cloud-inbox/messages/{message_id}/recover-text")
async def recover_cloud_inbox_message_text(
    message_id: str, current_user: dict = Depends(get_current_user)
):
    """Explicitly recover one missing Whatsflow body from read-only history."""
    _require_bulk_whatsapp_access(current_user)
    message = await _db["whatsapp_cloud_messages"].find_one(
        {"id": message_id}, {"_id": 0}
    )
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    _assert_branch_access(current_user, message.get("branch_id"))
    if message.get("provider") != "whatsflow":
        raise HTTPException(status_code=400, detail="Text recovery is only available for Whatsflow")
    if message.get("type") != "text" or message.get("media_id") or message.get("media_storage_id"):
        raise HTTPException(status_code=400, detail="Only text messages can be recovered")
    if isinstance(message.get("body"), str) and message["body"]:
        return {"success": True, "body": message["body"], "recovered": False}
    if message.get("view_once"):
        raise HTTPException(status_code=400, detail="View-once text cannot be recovered")
    provider_message_id = message.get("provider_message_id")
    if not isinstance(provider_message_id, str) or not provider_message_id:
        raise HTTPException(status_code=400, detail="Provider message ID is unavailable")

    branch_id = message.get("branch_id")
    config = await _db["whatsapp_branch_configs"].find_one(
        {
            "branch_id": branch_id,
            "provider": "whatsflow",
            "enabled": True,
        },
        {"_id": 0},
    )
    if not config or not config.get("whatsflow_instance"):
        raise HTTPException(status_code=409, detail="Whatsflow is not configured for this branch")
    ok, record, error = await _whatsflow_client(config).find_message(
        provider_message_id, message.get("direction") == "outbound"
    )
    if not ok:
        raise HTTPException(status_code=502, detail="تعذر استرجاع النص من مزود واتساب")
    body = _extract_whatsflow_body(record.get("message"), record)
    if not body:
        raise HTTPException(status_code=404, detail="Message text is unavailable in provider history")

    # Scope the write to the same branch/provider/provider ID and only fill a
    # still-missing body.  Reply, unread and delivery fields are never touched.
    result = await _db["whatsapp_cloud_messages"].update_one(
        {
            "id": message_id,
            "branch_id": branch_id,
            "provider": "whatsflow",
            "provider_message_id": provider_message_id,
            "$or": [{"body": ""}, {"body": {"$exists": False}}, {"body": None}],
        },
        {"$set": {"body": body}},
    )
    if not getattr(result, "matched_count", 0):
        current = await _db["whatsapp_cloud_messages"].find_one(
            {
                "id": message_id,
                "branch_id": branch_id,
                "provider": "whatsflow",
                "provider_message_id": provider_message_id,
            },
            {"_id": 0, "body": 1},
        )
        current_body = (current or {}).get("body")
        if not isinstance(current_body, str) or not current_body:
            raise HTTPException(status_code=409, detail="Message changed during text recovery")
        body = current_body
    return {"success": True, "body": body, "recovered": True}


@router.delete("/cloud-inbox/media/{message_id}/archive")
async def delete_cloud_inbox_media_archive(
    message_id: str, current_user: dict = Depends(get_current_user)
):
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access is required")
    message = await _db["whatsapp_cloud_messages"].find_one({"id": message_id}, {"_id": 0})
    if not message:
        raise HTTPException(status_code=404, detail="Media not found")
    _assert_branch_access(current_user, message.get("branch_id"))
    if message.get("archive_status") == "deleted":
        return {"success": True}
    # Tombstone before removal ensures a concurrent GET can never fall back to
    # a provider after an authorized delete.
    await _db["whatsapp_cloud_messages"].update_one(
        {"id": message_id}, {"$set": {
            "archive_status": "deleted", "archive_error": None,
            "deleted_at": datetime.now(timezone.utc).isoformat(),
        }, "$unset": {"archive_lease_until": "", "archive_leased_at": ""}},
    )
    # Re-read after tombstoning: a worker may have allocated a staging key
    # between the initial authorization read and this update.
    tombstone = await _db["whatsapp_cloud_messages"].find_one(
        {"id": message_id}, {"_id": 0, "archive_storage_id": 1,
         "archive_staging_storage_id": 1, "media_storage_id": 1}
    )
    await whatsapp_media_archive.delete(
        _db, get_current_tenant_slug(), message["branch_id"],
        (tombstone or {}).get("archive_storage_id")
        or (tombstone or {}).get("archive_staging_storage_id")
        or (tombstone or {}).get("media_storage_id")
        or message.get("archive_storage_id") or message.get("media_storage_id"),
        message_id,
        cleanup_owner=True,
    )
    await _delete_unshared_cloud_chat_media(
        message["branch_id"],
        (tombstone or {}).get("media_storage_id") or message.get("media_storage_id"),
        message_id,
    )
    return {"success": True}


@router.get("/cloud-inbox/media/{message_id}")
async def get_cloud_inbox_media(
    message_id: str, current_user: dict = Depends(get_current_user)
):
    _require_bulk_whatsapp_access(current_user)
    if message_id.startswith("campaign:"):
        item = await _db["whatsapp_campaign_job_items"].find_one(
            {"id": message_id.partition(":")[2]}, {"_id": 0})
        if not item or not item.get("attachment"):
            raise HTTPException(status_code=404, detail="Media not found")
        _assert_branch_access(current_user, item["branch_id"])
        content = await _load_bulk_attachment(item["branch_id"], item["attachment"])
        return Response(content=content, media_type=item["attachment"]["mime_type"],
                        headers={"Cache-Control": "private, max-age=300"})
    message = await _db["whatsapp_cloud_messages"].find_one(
        {"id": message_id}, {"_id": 0}
    )
    if message and message.get("archive_status") == "deleted":
        _assert_branch_access(current_user, message.get("branch_id"))
        raise HTTPException(status_code=410, detail="Media was deleted")
    # Older Whatsflow voice notes were saved before media type normalization as
    # text with an empty/[message] body.  The UI will not request these by
    # itself, but an explicit media request may use the durable provider ID.
    legacy_whatsflow_media = (
        message
        and message.get("provider") == "whatsflow"
        and (
            message.get("provider_message_id")
            or message.get("whatsflow_message_id")
        )
        and message.get("type") == "text"
        and str(message.get("body") or "") in {"", "[message]"}
    )
    if not message or not (
        message.get("media_storage_id")
        or message.get("media_id")
        or message.get("media_url")
        or legacy_whatsflow_media
    ):
        raise HTTPException(status_code=404, detail="Media not found")
    _assert_branch_access(current_user, message.get("branch_id"))
    if message.get("media_storage_id"):
        content, mime_type, filename = await _load_cloud_chat_image(
            message["branch_id"], message["media_storage_id"]
        )
        return Response(
            content=content,
            media_type=mime_type,
            headers=_whatsflow_media_headers(filename, mime_type),
        )
    try:
        content, provider_mime, provider_name = await _download_inbound_archive_media(message)
        mime_type, filename = whatsapp_media_archive.validate_media(
            content, provider_mime or message.get("mime_type"),
            provider_name or message.get("filename"),
        )
    except whatsapp_media_archive.ArchiveError as exc:
        # Do not render a provider body that failed archive validation.  The
        # details are deliberately generic and never include provider URLs/key.
        # When a provider did return bytes, run them through the normal archive
        # state transition too so unsafe/oversize items become `unsupported`
        # rather than remaining indefinitely pending.
        if "content" in locals():
            await _persist_fetched_inbound_archive(
                message, content, provider_mime or message.get("mime_type") or "",
                provider_name or message.get("filename") or "attachment",
            )
        if exc.status == "unsupported":
            raise HTTPException(status_code=413, detail=exc.detail)
        raise HTTPException(status_code=502, detail="Attachment is unavailable")
    await _persist_fetched_inbound_archive(message, content, mime_type, filename)
    # An authorized delete can race this provider fetch.  Bytes already sent
    # cannot be revoked, but do not knowingly begin a new response after its
    # tombstone has committed.
    final_state = await _db["whatsapp_cloud_messages"].find_one(
        {"id": message_id}, {"_id": 0, "archive_status": 1}
    )
    if (final_state or {}).get("archive_status") == "deleted":
        raise HTTPException(status_code=410, detail="Media was deleted")
    return StreamingResponse(
        iter([content]),
        media_type=mime_type,
        headers=_whatsflow_media_headers(filename, mime_type),
    )


def _cloud_send_response(message: dict, *, used_template: bool = False) -> dict:
    # Motor mutates insert_one's input by adding a BSON _id. Returning that
    # value makes FastAPI fail AFTER the provider has already sent the message,
    # so the composer retains the draft and users can accidentally send twice.
    return {
        "success": True,
        "message": {key: value for key, value in message.items() if key != "_id"},
        "used_template": used_template,
    }


@router.post("/cloud-inbox/conversations/{conversation_id}/reply")
async def reply_to_cloud_inbox_thread(
    conversation_id: str,
    data: CloudInboxReplyRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    body = (data.body or "").strip()
    if not body or len(body) > 4096:
        raise HTTPException(status_code=400, detail="Message must be 1-4096 characters")
    conversation = await _db["whatsapp_cloud_conversations"].find_one(
        {"id": conversation_id}, {"_id": 0}
    )
    if not conversation:
        conversation = await _campaign_conversation(conversation_id, current_user)
    branch_id = conversation.get("branch_id")
    _assert_branch_access(current_user, branch_id)
    config = await _get_branch_cloud_config(branch_id)
    if _branch_provider(config) in {"waha", "whatsflow"}:
        provider = _branch_provider(config)
        await registration_followups.stop_phone(
            branch_id, conversation.get("phone") or "", "staff_contacted"
        )
        await campaign_inquiry_automation.stop_phone(
            branch_id, conversation.get("phone") or "", "staff_contacted"
        )
        success, provider_message_id, error = await _send_session_provider_result(
            conversation.get("phone") or "", body, config or {}, automated=False
        )
        if not success:
            raise HTTPException(status_code=502, detail=f"{provider} send failed ({error or 'unknown'})")
        now = datetime.now(timezone.utc).isoformat()
        message = {
            "id": str(uuid.uuid4()), "conversation_id": conversation_id,
            "branch_id": branch_id, "provider": provider,
            "provider_message_id": provider_message_id,
            **({"waha_message_id": provider_message_id} if provider == "waha" else {}),
            "direction": "outbound", "phone": conversation.get("phone"), "type": "text",
            "body": body, "status": "sent", "created_at": now,
            "sent_by": current_user.get("user_id") or current_user.get("id"),
            "human_reply": True,
        }
        try:
            await _db["whatsapp_cloud_messages"].insert_one(message)
        except DuplicateKeyError:
            # The authenticated outgoing webhook may arrive before send returns.
            if not provider_message_id:
                raise
            existing = await _db["whatsapp_cloud_messages"].find_one({
                "branch_id": branch_id, "provider": provider,
                "provider_message_id": provider_message_id,
            }, {"_id": 0})
            if not existing:
                raise
            message = existing
        await _db["whatsapp_cloud_conversations"].update_one({"id": conversation_id}, {"$set": {
            "last_message": body, "last_message_at": now, "last_direction": "outbound",
        }})
        await _note_cloud_human_reply(
            conversation_id, branch_id, now, provider_message_id
        )
        return _cloud_send_response(message)
    if not (
        config
        and config.get("enabled")
        and config.get("phone_number_id")
        and config.get("access_token_encrypted")
    ):
        raise HTTPException(status_code=400, detail="Branch Meta API is not configured")

    now_dt = datetime.now(timezone.utc)
    try:
        last_inbound = datetime.fromisoformat(
            str(conversation.get("last_inbound_at") or "").replace("Z", "+00:00")
        )
        if last_inbound.tzinfo is None:
            last_inbound = last_inbound.replace(tzinfo=timezone.utc)
        inside_service_window = now_dt - last_inbound <= timedelta(hours=24)
    except Exception:
        inside_service_window = False

    send_config = dict(config)
    if inside_service_window:
        send_config["message_template_name"] = ""
    elif not (
        config.get("message_template_name")
        and config.get("single_variable_template_confirmed")
    ):
        raise HTTPException(
            status_code=400,
            detail="The 24-hour window ended; configure an approved Meta template",
        )

    await registration_followups.stop_phone(
        branch_id, conversation.get("phone") or "", "staff_contacted"
    )
    await campaign_inquiry_automation.stop_phone(
        branch_id, conversation.get("phone") or "", "staff_contacted"
    )
    success, meta_message_id, error = await _send_meta_cloud_message_result(
        conversation.get("phone"), body, send_config
    )
    if not success:
        raise HTTPException(status_code=502, detail=f"Meta send failed ({error or 'unknown'})")
    now = now_dt.isoformat()
    message = {
        "id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "branch_id": branch_id,
        "meta_message_id": meta_message_id,
        "direction": "outbound",
        "phone": conversation.get("phone"),
        "type": "template" if not inside_service_window else "text",
        "body": body,
        "status": "sent",
        "created_at": now,
        "sent_by": current_user.get("user_id") or current_user.get("id"),
        "human_reply": True,
    }
    await _db["whatsapp_cloud_messages"].insert_one(message)
    await _db["whatsapp_cloud_conversations"].update_one(
        {"id": conversation_id},
        {"$set": {
            "last_message": body,
            "last_message_at": now,
            "last_direction": "outbound",
        }},
    )
    await _note_cloud_human_reply(
        conversation_id, branch_id, now, meta_message_id
    )
    return _cloud_send_response(message, used_template=not inside_service_window)


@router.post("/cloud-inbox/conversations/{conversation_id}/media")
async def send_cloud_inbox_media(
    conversation_id: str,
    caption: str = Form(""),
    # Keep this as a plain list: production FastAPI's multipart parser does
    # not correctly unwrap Optional[List[UploadFile]].
    attachments: List[UploadFile] = File(default=[]),
    current_user: dict = Depends(get_current_user),
):
    """Send one private JPG/PNG image from the authenticated branch thread."""
    _require_bulk_whatsapp_access(current_user)
    uploads = list(attachments) if isinstance(attachments, (list, tuple)) else []
    if len(uploads) != 1:
        raise HTTPException(status_code=400, detail="Attach exactly one JPG or PNG image")
    caption = (caption if isinstance(caption, str) else "").strip()
    if len(caption) > 4096:
        raise HTTPException(status_code=400, detail="Caption must be 4096 characters or fewer")

    conversation = await _db["whatsapp_cloud_conversations"].find_one(
        {"id": conversation_id}, {"_id": 0}
    )
    if not conversation:
        conversation = await _campaign_conversation(conversation_id, current_user)
    branch_id = conversation.get("branch_id")
    _assert_branch_access(current_user, branch_id)
    config = await _get_branch_cloud_config(branch_id)
    provider = _branch_provider(config)

    now_dt = datetime.now(timezone.utc)
    inside_service_window = False
    if provider == "meta_cloud":
        try:
            last_inbound = datetime.fromisoformat(
                str(conversation.get("last_inbound_at") or "").replace("Z", "+00:00")
            )
            if last_inbound.tzinfo is None:
                last_inbound = last_inbound.replace(tzinfo=timezone.utc)
            inside_service_window = now_dt - last_inbound <= timedelta(hours=24)
        except Exception:
            inside_service_window = False
    if provider not in {"meta_cloud", "waha", "whatsflow"}:
        raise HTTPException(
            status_code=400,
            detail="No active WhatsApp provider is configured for this branch",
        )
    if provider == "waha" and not _waha_config_for_branch(config):
        raise HTTPException(status_code=400, detail="WAHA is not configured for this branch")
    if provider == "whatsflow" and not (
        config
        and config.get("enabled")
        and config.get("whatsflow_instance")
        and config.get("whatsflow_api_key_encrypted")
    ):
        raise HTTPException(status_code=400, detail="Whatsflow is not configured for this branch")
    if provider == "meta_cloud" and not (
        config
        and config.get("enabled")
        and config.get("phone_number_id")
        and config.get("access_token_encrypted")
    ):
        raise HTTPException(status_code=400, detail="Branch Meta API is not configured")
    if provider == "meta_cloud" and not inside_service_window:
        if not (
            config.get("image_template_name")
            and config.get("media_templates_confirmed")
        ):
            raise HTTPException(
                status_code=400,
                detail="The 24-hour window ended; configure an approved Meta image template",
            )
        if not caption:
            raise HTTPException(
                status_code=400,
                detail="A caption is required when Meta uses the approved image template",
            )

    # Validate and store before dispatch.  This avoids a sent message pointing
    # at missing bytes if the provider accepts it immediately.  Failed sends
    # remove the private object and return an explicit error; nothing retries.
    content, mime_type, filename = await _read_cloud_chat_image(uploads[0])
    if provider == "whatsflow":
        # Match the webhook's existing index exactly, and prepare it before
        # dispatch so index failures cannot follow a successful external send.
        await _db["whatsapp_cloud_messages"].create_index(
            [("branch_id", 1), ("provider", 1), ("provider_message_id", 1)],
            unique=True,
            partialFilterExpression={
                "provider": "whatsflow", "provider_message_id": {"$exists": True}
            },
        )
    media_ref = None
    media_owned_by_message = False
    try:
        media_ref = await _store_cloud_chat_image(
            branch_id, content, mime_type, filename
        )
        # Explicit staff contact stops registration follow-up before touching
        # the provider, preserving the existing webhook-echo race guard.
        await registration_followups.stop_phone(
            branch_id, conversation.get("phone") or "", "staff_contacted"
        )
        await campaign_inquiry_automation.stop_phone(
            branch_id, conversation.get("phone") or "", "staff_contacted"
        )
        (
            success,
            provider_message_id,
            error,
            used_template,
            provider_media_id,
        ) = await _send_cloud_chat_image_result(
            conversation.get("phone") or "",
            content,
            mime_type,
            filename,
            caption,
            config or {},
            inside_service_window,
            branch_id,
        )
        if not success:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"{provider} image delivery outcome is unknown "
                    f"({error or 'unknown'}); no automatic retry was attempted"
                ),
            )
        now = now_dt.isoformat()
        message = {
            "id": str(uuid.uuid4()),
            "conversation_id": conversation_id,
            "branch_id": branch_id,
            "provider": provider,
            "provider_message_id": provider_message_id,
            "direction": "outbound",
            "phone": conversation.get("phone"),
            "type": "image",
            "body": caption,
            # media_id remains present for the existing inbox renderer, while
            # media_storage_id makes retrieval unambiguously private.
            "media_id": media_ref["media_id"],
            "media_storage_id": media_ref["media_id"],
            "provider_media_id": provider_media_id,
            "mime_type": mime_type,
            "filename": filename,
            "status": "sent",
            "created_at": now,
            "sent_by": current_user.get("user_id") or current_user.get("id"),
            "source": "cloud_inbox",
            "human_reply": True,
        }
        if provider == "waha" and provider_message_id:
            message["waha_message_id"] = provider_message_id
        if provider == "meta_cloud" and provider_message_id:
            message["meta_message_id"] = provider_message_id
        messages = _db["whatsapp_cloud_messages"]
        try:
            await messages.insert_one(message)
            media_owned_by_message = True
        except DuplicateKeyError:
            existing = await messages.find_one(
                {
                    "branch_id": branch_id,
                    "provider": provider,
                    "provider_message_id": provider_message_id,
                },
                {"_id": 0},
            )
            if not existing:
                raise
            # Attach the authenticated upload to the already-recorded echo so
            # the image remains private and visible after refresh.
            await messages.update_one(
                {"id": existing["id"], "branch_id": branch_id},
                {"$set": {
                    "media_id": media_ref["media_id"],
                    "media_storage_id": media_ref["media_id"],
                    "mime_type": mime_type,
                    "filename": filename,
                    "body": caption,
                    "type": "image",
                }},
            )
            media_owned_by_message = True
            message = {**existing, **{
                "media_id": media_ref["media_id"],
                "media_storage_id": media_ref["media_id"],
                "mime_type": mime_type,
                "filename": filename,
                "body": caption,
                "type": "image",
            }}
        await _db["whatsapp_cloud_conversations"].update_one(
            {"id": conversation_id, "branch_id": branch_id},
            {"$set": {
                "last_message": caption or "[image]",
                "last_message_at": now,
                "last_direction": "outbound",
            }},
        )
        await _note_cloud_human_reply(
            conversation_id, branch_id, now, provider_message_id
        )
        return _cloud_send_response(message, used_template=used_template)
    except HTTPException:
        if media_ref and not media_owned_by_message:
            await _delete_cloud_chat_image(branch_id, media_ref["media_id"])
        raise
    except Exception as exc:
        if media_ref and not media_owned_by_message:
            await _delete_cloud_chat_image(branch_id, media_ref["media_id"])
        logger.error("Cloud inbox image send failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="Image delivery outcome is unknown; no automatic retry was attempted",
        )


@router.post("/cloud-inbox/conversations/{conversation_id}/voice")
async def send_cloud_inbox_voice(
    conversation_id: str,
    audio: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Send one authenticated staff voice note, privately retained as OGG Opus."""
    _require_bulk_whatsapp_access(current_user)
    conversation = await _db["whatsapp_cloud_conversations"].find_one(
        {"id": conversation_id}, {"_id": 0}
    )
    if not conversation:
        conversation = await _campaign_conversation(conversation_id, current_user)
    branch_id = conversation.get("branch_id")
    _assert_branch_access(current_user, branch_id)
    config = await _get_branch_cloud_config(branch_id)
    provider = _branch_provider(config)
    now_dt = datetime.now(timezone.utc)
    inside_service_window = False
    if provider == "meta_cloud":
        try:
            last_inbound = datetime.fromisoformat(
                str(conversation.get("last_inbound_at") or "").replace("Z", "+00:00")
            )
            if last_inbound.tzinfo is None:
                last_inbound = last_inbound.replace(tzinfo=timezone.utc)
            inside_service_window = now_dt - last_inbound <= timedelta(hours=24)
        except Exception:
            inside_service_window = False
    if provider not in {"meta_cloud", "waha", "whatsflow"}:
        raise HTTPException(
            status_code=400,
            detail="No active WhatsApp provider is configured for this branch",
        )
    if provider == "waha" and not _waha_config_for_branch(config):
        raise HTTPException(status_code=400, detail="WAHA is not configured for this branch")
    if provider == "whatsflow" and not (
        config and config.get("enabled") and config.get("whatsflow_instance")
        and config.get("whatsflow_api_key_encrypted")
    ):
        raise HTTPException(status_code=400, detail="Whatsflow is not configured for this branch")
    if provider == "meta_cloud" and not (
        config and config.get("enabled") and config.get("phone_number_id")
        and config.get("access_token_encrypted")
    ):
        raise HTTPException(status_code=400, detail="Branch Meta API is not configured")
    # Meta does not permit audio in a template header, so unlike image there is
    # no outside-window template fallback.
    if provider == "meta_cloud" and not inside_service_window:
        raise HTTPException(
            status_code=400,
            detail="The 24-hour window ended; Meta voice messages cannot use a template",
        )

    content, mime_type, filename = await _read_cloud_chat_audio(audio)
    if provider == "whatsflow":
        await _db["whatsapp_cloud_messages"].create_index(
            [("branch_id", 1), ("provider", 1), ("provider_message_id", 1)],
            unique=True,
            partialFilterExpression={
                "provider": "whatsflow", "provider_message_id": {"$exists": True}
            },
        )
    media_ref = None
    media_owned_by_message = False
    try:
        media_ref = await _store_cloud_chat_image(branch_id, content, mime_type, filename)
        await registration_followups.stop_phone(
            branch_id, conversation.get("phone") or "", "staff_contacted"
        )
        await campaign_inquiry_automation.stop_phone(
            branch_id, conversation.get("phone") or "", "staff_contacted"
        )
        success, provider_message_id, error, provider_media_id = (
            await _send_cloud_chat_voice_result(
                conversation.get("phone") or "", content, mime_type, filename,
                config or {}, branch_id,
            )
        )
        # No message identity means the request may have been accepted but the
        # outgoing echo cannot be safely deduplicated.  Treat it as uncertain.
        if not success or not provider_message_id:
            raise HTTPException(
                status_code=502,
                detail={
                    "message": (
                        f"{provider} voice delivery outcome is unknown "
                        f"({error or 'missing_message_id'}); no automatic retry was attempted"
                    ),
                    "delivery_uncertain": True,
                },
            )
        now = now_dt.isoformat()
        message = {
            "id": str(uuid.uuid4()),
            "conversation_id": conversation_id,
            "branch_id": branch_id,
            "provider": provider,
            "provider_message_id": provider_message_id,
            "direction": "outbound",
            "phone": conversation.get("phone"),
            "type": "audio",
            "body": "[voice message]",
            "media_id": media_ref["media_id"],
            "media_storage_id": media_ref["media_id"],
            "provider_media_id": provider_media_id,
            "mime_type": mime_type,
            "filename": filename,
            "status": "sent",
            "created_at": now,
            "sent_by": current_user.get("user_id") or current_user.get("id"),
            "source": "cloud_inbox",
            "human_reply": True,
        }
        if provider == "waha":
            message["waha_message_id"] = provider_message_id
        elif provider == "meta_cloud":
            message["meta_message_id"] = provider_message_id
        messages = _db["whatsapp_cloud_messages"]
        try:
            await messages.insert_one(message)
            media_owned_by_message = True
        except DuplicateKeyError:
            existing = await messages.find_one({
                "branch_id": branch_id, "provider": provider,
                "provider_message_id": provider_message_id,
            }, {"_id": 0})
            if not existing:
                raise
            await messages.update_one(
                {"id": existing["id"], "branch_id": branch_id},
                {"$set": {
                    "media_id": media_ref["media_id"],
                    "media_storage_id": media_ref["media_id"],
                    "provider_media_id": provider_media_id,
                    "mime_type": mime_type, "filename": filename,
                    "body": "[voice message]", "type": "audio",
                }},
            )
            media_owned_by_message = True
            message = {**existing, **{
                "media_id": media_ref["media_id"],
                "media_storage_id": media_ref["media_id"],
                "provider_media_id": provider_media_id,
                "mime_type": mime_type, "filename": filename,
                "body": "[voice message]", "type": "audio",
            }}
        await _db["whatsapp_cloud_conversations"].update_one(
            {"id": conversation_id, "branch_id": branch_id},
            {"$set": {
                "last_message": "[voice message]", "last_message_at": now,
                "last_direction": "outbound",
            }},
        )
        # This is intentionally after a provider acceptance with identity and
        # durable message persistence; uncertain sends never clear needs_reply.
        await _note_cloud_human_reply(
            conversation_id, branch_id, now, provider_message_id
        )
        return _cloud_send_response(message)
    except HTTPException:
        if media_ref and not media_owned_by_message:
            await _delete_cloud_chat_image(branch_id, media_ref["media_id"])
        raise
    except Exception as exc:
        if media_ref and not media_owned_by_message:
            await _delete_cloud_chat_image(branch_id, media_ref["media_id"])
        logger.error("Cloud inbox voice send failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Voice delivery outcome is unknown; no automatic retry was attempted",
                "delivery_uncertain": True,
            },
        )


class BranchCloudTestRequest(BaseModel):
    phone: str
    message: Optional[str] = None


class BulkCloudRecipient(BaseModel):
    phone: str
    message: str
    id: Optional[str] = None
    member_id: Optional[str] = None
    name: Optional[str] = None
    source_metadata: Optional[dict] = None


class BulkCloudSendRequest(BaseModel):
    branch_id: str
    recipients: List[BulkCloudRecipient]
    idempotency_key: str
    campaign_title: Optional[str] = Field(default=None, max_length=160)
    campaign_id: Optional[str] = Field(default=None, max_length=128)
    branch_name: Optional[str] = Field(default=None, max_length=200)
    dispatch_source: Literal['campaign', 'branch_bulk'] = 'campaign'


def _bulk_campaign_metadata(
    campaign_title: Optional[str] = None,
    campaign_id: Optional[str] = None,
    branch_name: Optional[str] = None,
) -> dict:
    """Validate report metadata without changing dispatch payload semantics."""
    title = campaign_title.strip() if isinstance(campaign_title, str) else ""
    if len(title) > 160:
        raise HTTPException(status_code=400, detail="Campaign title is too long")
    identifier = campaign_id.strip() if isinstance(campaign_id, str) else ""
    if len(identifier) > 128:
        raise HTTPException(status_code=400, detail="Campaign ID is too long")
    branch = branch_name.strip() if isinstance(branch_name, str) else ""
    if len(branch) > 200:
        raise HTTPException(status_code=400, detail="Branch name is too long")
    return {
        key: value
        for key, value in (
            ("campaign_title", title),
            ("campaign_id", identifier),
            ("branch_name", branch),
        )
        if value
    }


def _bulk_recipient_payload(recipient: BulkCloudRecipient) -> dict:
    payload = {"phone": recipient.phone, "message": recipient.message.strip()}
    if recipient.id:
        payload["recipient_id"] = recipient.id
    if recipient.member_id:
        payload["member_id"] = recipient.member_id
    if recipient.name:
        payload["name"] = recipient.name.strip()[:200]
    if recipient.source_metadata:
        payload["source_metadata"] = recipient.source_metadata
    return payload


def _campaign_scope(branch_id: str) -> dict:
    return {"tenant_slug": get_current_tenant_slug(), "branch_id": branch_id}


def _campaign_public(doc: dict, include_recipients: bool = True) -> dict:
    excluded = {"_id", "tenant_slug", "attachment_id", "attachment_ids"}
    if not include_recipients:
        excluded.add("recipients")
    result = {k: v for k, v in doc.items() if k not in excluded}
    stored = doc.get("attachments") or []
    if not stored and doc.get("attachment_id"):
        stored = [{
            "attachment_id": doc.get("attachment_id"),
            "attachment_name": doc.get("attachment_name"),
            "attachment_type": doc.get("attachment_type"),
            "attachment_size": doc.get("attachment_size"),
        }]
    result["attachments"] = [
        {k: item.get(k) for k in ("attachment_name", "attachment_type", "attachment_size")}
        for item in stored
    ]
    result["attachment_count"] = len(stored)
    result["has_attachment"] = bool(stored)
    result["recipient_count"] = len(doc.get("recipients") or [])
    return result


async def _read_campaign_attachment(attachment: UploadFile) -> tuple[bytes, str, str]:
    mime = (attachment.content_type or "").lower()
    limits = {
        "image/jpeg": CAMPAIGN_IMAGE_LIMIT,
        "image/png": CAMPAIGN_IMAGE_LIMIT,
        "application/pdf": CAMPAIGN_PDF_LIMIT,
    }
    if mime not in limits:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, and PDF are supported")
    content = bytearray()
    while True:
        chunk = await attachment.read(1024 * 1024)
        if not chunk:
            break
        content.extend(chunk)
        if len(content) > limits[mime]:
            raise HTTPException(status_code=413, detail="Attachment exceeds the allowed size")
    if not content:
        raise HTTPException(status_code=400, detail="Attachment is empty")
    valid_signature = (
        bytes(content).startswith(b"\xff\xd8\xff")
        if mime == "image/jpeg"
        else bytes(content).startswith(b"\x89PNG\r\n\x1a\n")
        if mime == "image/png"
        else bytes(content).startswith(b"%PDF-")
    )
    if not valid_signature:
        raise HTTPException(status_code=400, detail="Attachment content does not match its type")
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf"}[mime]
    safe_name = Path(attachment.filename or f"attachment{extension}").name[:180]
    return bytes(content), mime, safe_name


async def _store_campaign_attachment(branch_id: str, attachment: UploadFile) -> dict:
    content, mime, filename = await _read_campaign_attachment(attachment)
    attachment_id = str(uuid.uuid4())
    scope = {**_campaign_scope(branch_id), "attachment_id": attachment_id}
    try:
        for index, offset in enumerate(range(0, len(content), CAMPAIGN_ATTACHMENT_CHUNK_SIZE)):
            await _db["whatsapp_campaign_attachment_chunks"].insert_one({
                **scope,
                "index": index,
                "data": content[offset:offset + CAMPAIGN_ATTACHMENT_CHUNK_SIZE],
            })
        await _db["whatsapp_campaign_attachments"].insert_one({
            **scope,
            "name": filename,
            "mime_type": mime,
            "size": len(content),
            "chunk_count": (len(content) + CAMPAIGN_ATTACHMENT_CHUNK_SIZE - 1) // CAMPAIGN_ATTACHMENT_CHUNK_SIZE,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        await _delete_campaign_attachment(branch_id, attachment_id)
        raise
    return {
        "attachment_id": attachment_id,
        "attachment_name": filename,
        "attachment_type": mime,
        "attachment_size": len(content),
    }


async def _store_campaign_attachments(branch_id: str, uploads: list[UploadFile]) -> list[dict]:
    if len(uploads) > CAMPAIGN_MAX_IMAGES:
        raise HTTPException(status_code=400, detail="A campaign may contain at most 10 images")
    stored = []
    try:
        for upload in uploads:
            item = await _store_campaign_attachment(branch_id, upload)
            stored.append(item)
    except Exception:
        for item in stored:
            await _delete_campaign_attachment(branch_id, item.get("attachment_id"))
        raise
    if len(stored) > 1 and any(item["attachment_type"] == "application/pdf" for item in stored):
        for item in stored:
            await _delete_campaign_attachment(branch_id, item.get("attachment_id"))
        raise HTTPException(status_code=400, detail="PDF cannot be mixed with images; attach one PDF only")
    return stored


def _campaign_attachment_items(doc: dict) -> list[dict]:
    if doc.get("attachments"):
        return doc["attachments"]
    if doc.get("attachment_id"):
        return [{
            "attachment_id": doc.get("attachment_id"),
            "attachment_name": doc.get("attachment_name"),
            "attachment_type": doc.get("attachment_type"),
            "attachment_size": doc.get("attachment_size"),
        }]
    return []


async def _delete_campaign_attachment(branch_id: str, attachment_id: Optional[str]):
    if not attachment_id:
        return
    if await _db['whatsapp_reviews'].find_one({'branch_id':branch_id,
            'attachments.attachment_id':attachment_id}, {'_id':1}):
        return
    scope = {**_campaign_scope(branch_id), "attachment_id": attachment_id}
    await _db["whatsapp_campaign_attachment_chunks"].delete_many(scope)
    await _db["whatsapp_campaign_attachments"].delete_one(scope)


def _parse_campaign_recipients(raw: str) -> list[dict]:
    try:
        values = json.loads(raw or "[]")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid pasted recipients")
    if not isinstance(values, list) or len(values) > CAMPAIGN_MAX_PASTED_RECIPIENTS:
        raise HTTPException(status_code=400, detail="A draft may contain at most 2000 pasted recipients")
    clean = []
    seen = set()
    for value in values:
        if not isinstance(value, dict):
            raise HTTPException(status_code=400, detail="Invalid pasted recipient")
        phone = re.sub(r"\D", "", str(value.get("phone") or ""))[:15]
        if len(phone) < 9 or phone in seen:
            continue
        seen.add(phone)
        clean.append({"phone": phone, "name": str(value.get("name") or "").strip()[:200]})
    return clean


def _validate_proposed_send_at(value: str) -> str:
    proposed = (value or "").strip()
    if not proposed:
        return ""
    try:
        datetime.fromisoformat(proposed.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid proposed send datetime")
    return proposed


def _campaign_end_date(value):
    """Unknown/malformed dates must never qualify a member for expiry outreach."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date() if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else None
    except ValueError:
        return None


async def _campaign_expired_members(branch_id: str) -> list[dict]:
    # _db is the tenant-aware database; never activate/modify subscriptions here.
    from utils.effective_periods import effective_period_map, operational_window

    today = datetime.now(RIYADH_TZ).date()
    candidates = {}
    async for member in _db["members"].find(
        {"branch_id": branch_id},
        {"_id": 0, "id": 1, "phone": 1, "name": 1, "name_ar": 1, "activities": 1},
    ):
        activities = member.get("activities")
        if not isinstance(activities, list) or not activities:
            continue
        ends = [
            _campaign_end_date(activity.get("end_date")) if isinstance(activity, dict) else None
            for activity in activities
        ]
        if member.get("id") and all(end is not None and end < today for end in ends):
            candidates[member["id"]] = member
    if not candidates:
        return []

    # Paid later periods can exist only on invoices until activation. Honor
    # their operational (closure-shifted) dates without mutating either source.
    invoices = await _db["invoices"].find(
        {
            "branch_id": branch_id, "status": "paid",
            "$or": [
                {"member_id": {"$in": list(candidates)}},
                {"items.member_id": {"$in": list(candidates)}},
            ],
        },
        {"_id": 0, "id": 1, "member_id": 1, "items": 1},
    ).to_list(length=None)
    periods = await effective_period_map(_db, invoices)
    for invoice in invoices:
        for index, item in enumerate(invoice.get("items") or []):
            member_id = item.get("member_id") or invoice.get("member_id")
            member = candidates.get(member_id)
            if not member or item.get("is_product"):
                continue
            start, end = operational_window(invoice, item, index, periods)
            start, end = _campaign_end_date(start), _campaign_end_date(end)
            # Do not resurrect a same-period purchased end that operational
            # attendance legitimately pulled back. Only a genuinely later
            # period is renewal evidence. Unknown purchased dates fail closed.
            current_ends = [
                _campaign_end_date(activity.get("end_date"))
                for activity in member["activities"]
                if activity.get("activity_id") == item.get("activity_id")
            ]
            if start is None or end is None or end < start or (
                end >= today and (not current_ends or start > max(current_ends))
            ):
                candidates.pop(member_id, None)
    return list(candidates.values())


async def _campaign_audience_recipients(branch_id: str, audience: str) -> list[dict]:
    if audience == "pasted":
        return []
    if audience == "expired_members":
        rows = await _campaign_expired_members(branch_id)
    elif audience == "registration_requests":
        query = {"branch_id": branch_id, "status": "pending"}
        collection = _db["registration_requests"]
    elif audience in {"active_members", "all_members"}:
        query = {"branch_id": branch_id}
        if audience == "active_members":
            # Mirror Members/global-search status consistency: any subscription
            # ending today or later is active; an undated subscription is active
            # only when explicitly marked active. Academy dates use Riyadh time.
            today = datetime.now(RIYADH_TZ).strftime("%Y-%m-%d")
            query["activities"] = {"$elemMatch": {"$or": [
                {"end_date": {"$gte": today}},
                {"status": "active", "$or": [
                    {"end_date": {"$exists": False}},
                    {"end_date": None},
                    {"end_date": ""},
                ]},
            ]}}
        collection = _db["members"]
    else:
        raise HTTPException(status_code=400, detail="Invalid campaign audience")
    if audience != "expired_members":
        cursor = collection.find(
            query,
            {"_id": 0, "id": 1, "phone": 1, "name": 1, "name_ar": 1, "customer_phone": 1, "customer_name": 1},
        ).limit(
            CAMPAIGN_MAX_PASTED_RECIPIENTS
        )
        rows = await cursor.to_list(length=CAMPAIGN_MAX_PASTED_RECIPIENTS)
    recipients, seen = [], set()
    for row in rows:
        raw_phone = row.get("phone") or row.get("customer_phone") or ""
        phone = (
            normalize_phone(raw_phone) if audience == "expired_members"
            else re.sub(r"\D", "", str(raw_phone))
        )
        if len(phone) < 9 or len(phone) > 15 or phone in seen:
            continue
        seen.add(phone)
        recipients.append({
            "phone": phone,
            "name": row.get("name_ar") or row.get("name") or row.get("customer_name") or "",
            **({"member_id": row["id"]} if audience != 'registration_requests' and row.get('id') else {}),
        })
        if len(recipients) >= CAMPAIGN_MAX_PASTED_RECIPIENTS:
            break
    return recipients


async def _require_campaign_branch(current_user: dict, branch_id: str):
    _assert_branch_access(current_user, branch_id)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    if not await _db["branches"].find_one({"id": branch_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Branch not found")


async def _require_campaign_phone_access(current_user: dict):
    if current_user.get("is_admin", False):
        return
    user_doc = await _db["users"].find_one(
        {"id": current_user.get("user_id")}, {"_id": 0, "permissions": 1}
    )
    if "member-phones" not in ((user_doc or {}).get("permissions") or []):
        raise HTTPException(status_code=403, detail="Member phone access required")


@router.get("/campaigns")
async def list_campaigns(
    branch_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    await _require_campaign_branch(current_user, branch_id)
    cursor = _db["whatsapp_campaigns"].find(
        _campaign_scope(branch_id)
    ).sort("updated_at", -1).limit(200)
    return [_campaign_public(row, include_recipients=False) async for row in cursor]


@router.get("/campaigns/audience-preview")
async def campaign_audience_preview(
    branch_id: str,
    audience: str,
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    await _require_campaign_branch(current_user, branch_id)
    await _require_campaign_phone_access(current_user)
    recipients = await _campaign_audience_recipients(branch_id, audience)
    return {"count": len(recipients), "recipients": recipients}


@router.get("/campaigns/{campaign_id}")
async def get_campaign(
    campaign_id: str,
    branch_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    await _require_campaign_branch(current_user, branch_id)
    await _require_campaign_phone_access(current_user)
    doc = await _db["whatsapp_campaigns"].find_one(
        {**_campaign_scope(branch_id), "id": campaign_id}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return _campaign_public(doc)


@router.get("/campaigns/{campaign_id}/attachment")
async def get_campaign_attachment(
    campaign_id: str,
    branch_id: str,
    current_user: dict = Depends(get_current_user),
    index: int = 0,
):
    _require_bulk_whatsapp_access(current_user)
    await _require_campaign_branch(current_user, branch_id)
    doc = await _db["whatsapp_campaigns"].find_one(
        {**_campaign_scope(branch_id), "id": campaign_id}
    )
    items = _campaign_attachment_items(doc or {})
    if index < 0 or index >= len(items):
        raise HTTPException(status_code=404, detail="Campaign attachment not found")
    attachment_id = items[index].get("attachment_id")
    attachment_doc = await _db["whatsapp_campaign_attachments"].find_one({
        **_campaign_scope(branch_id), "attachment_id": attachment_id
    })
    if not doc or not attachment_doc:
        raise HTTPException(status_code=404, detail="Campaign attachment not found")
    expected_chunks = int(attachment_doc.get("chunk_count") or 0)
    cursor = _db["whatsapp_campaign_attachment_chunks"].find({
        **_campaign_scope(branch_id), "attachment_id": attachment_id
    }).sort("index", 1)
    stored_chunks = await cursor.to_list(length=expected_chunks + 1)
    if (
        len(stored_chunks) != expected_chunks
        or any(chunk.get("index") != index for index, chunk in enumerate(stored_chunks))
        or sum(len(chunk.get("data") or b"") for chunk in stored_chunks) != int(attachment_doc.get("size") or 0)
    ):
        raise HTTPException(status_code=500, detail="Campaign attachment data is incomplete")
    async def chunks():
        for chunk in stored_chunks:
            yield chunk.get("data") or b""
    safe_filename = str(attachment_doc.get("name") or "attachment").replace('"', "")
    return StreamingResponse(
        chunks(),
        media_type=attachment_doc.get("mime_type"),
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@router.post("/campaigns")
async def create_campaign(
    branch_id: str = Form(...),
    name: str = Form(...),
    message: str = Form(""),
    audience: str = Form("pasted"),
    proposed_send_at: str = Form(""),
    default_name: str = Form(""),
    recipients_json: str = Form("[]"),
    attachment: Optional[UploadFile] = File(None),
    attachments: List[UploadFile] = File(default=[]),
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    await _require_campaign_branch(current_user, branch_id)
    await _require_campaign_phone_access(current_user)
    campaign_name = name.strip()
    if not campaign_name or len(campaign_name) > 160 or len(message) > 4096:
        raise HTTPException(status_code=400, detail="Campaign name or message is invalid")
    if audience not in {"pasted", "registration_requests", "active_members", "all_members", "expired_members"}:
        raise HTTPException(status_code=400, detail="Invalid campaign audience")
    recipients = _parse_campaign_recipients(recipients_json) if audience == "pasted" else []
    now = datetime.now(timezone.utc).isoformat()
    campaign_id = str(uuid.uuid4())
    doc = {
        **_campaign_scope(branch_id), "id": campaign_id, "name": campaign_name,
        "message": message, "audience": audience, "proposed_send_at": _validate_proposed_send_at(proposed_send_at),
        "default_name": default_name[:200], "recipients": recipients,
        "created_at": now, "updated_at": now,
        "created_by": current_user.get("user_id") or current_user.get("id"),
    }
    uploads = list(attachments) if isinstance(attachments, (list, tuple)) else []
    if attachment:
        uploads.insert(0, attachment)
    new_attachments = await _store_campaign_attachments(branch_id, uploads) if uploads else []
    if new_attachments:
        doc["attachments"] = new_attachments
        doc["attachment_ids"] = [item["attachment_id"] for item in new_attachments]
        doc.update(new_attachments[0])
    try:
        await _db["whatsapp_campaigns"].insert_one(doc)
    except Exception:
        for item in new_attachments:
            await _delete_campaign_attachment(branch_id, item["attachment_id"])
        raise
    return _campaign_public(doc)


@router.put("/campaigns/{campaign_id}")
async def update_campaign(
    campaign_id: str,
    branch_id: str = Form(...),
    name: str = Form(...),
    message: str = Form(""),
    audience: str = Form("pasted"),
    proposed_send_at: str = Form(""),
    default_name: str = Form(""),
    recipients_json: str = Form("[]"),
    remove_attachment: bool = Form(False),
    attachment: Optional[UploadFile] = File(None),
    attachments: List[UploadFile] = File(default=[]),
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    await _require_campaign_branch(current_user, branch_id)
    await _require_campaign_phone_access(current_user)
    scope = {**_campaign_scope(branch_id), "id": campaign_id}
    existing = await _db["whatsapp_campaigns"].find_one(scope)
    if not existing:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign_name = name.strip()
    if not campaign_name or len(campaign_name) > 160 or len(message) > 4096:
        raise HTTPException(status_code=400, detail="Campaign name or message is invalid")
    if audience not in {"pasted", "registration_requests", "active_members", "all_members", "expired_members"}:
        raise HTTPException(status_code=400, detail="Invalid campaign audience")
    update = {
        "name": campaign_name, "message": message, "audience": audience,
        "proposed_send_at": _validate_proposed_send_at(proposed_send_at), "default_name": default_name[:200],
        "recipients": _parse_campaign_recipients(recipients_json) if audience == "pasted" else [],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    old_attachments = _campaign_attachment_items(existing)
    uploads = list(attachments) if isinstance(attachments, (list, tuple)) else []
    if attachment:
        uploads.insert(0, attachment)
    new_attachments = []
    if uploads:
        new_attachments = await _store_campaign_attachments(branch_id, uploads)
        update["attachments"] = new_attachments
        update["attachment_ids"] = [item["attachment_id"] for item in new_attachments]
        update.update(new_attachments[0])
    elif remove_attachment:
        update.update(
            attachments=[], attachment_ids=[], attachment_id=None,
            attachment_name=None, attachment_type=None, attachment_size=None,
        )
    try:
        await _db["whatsapp_campaigns"].update_one(scope, {"$set": update})
    except Exception:
        for item in new_attachments:
            await _delete_campaign_attachment(branch_id, item["attachment_id"])
        raise
    if new_attachments or remove_attachment:
        for item in old_attachments:
            await _delete_campaign_attachment(branch_id, item.get("attachment_id"))
    return _campaign_public({**existing, **update})


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(
    campaign_id: str,
    branch_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    await _require_campaign_branch(current_user, branch_id)
    scope = {**_campaign_scope(branch_id), "id": campaign_id}
    existing = await _db["whatsapp_campaigns"].find_one(scope)
    if not existing:
        raise HTTPException(status_code=404, detail="Campaign not found")
    await _db["whatsapp_campaigns"].delete_one(scope)
    for item in _campaign_attachment_items(existing):
        await _delete_campaign_attachment(branch_id, item.get("attachment_id"))
    return {"success": True}


def _assert_branch_access(current_user: dict, branch_id: str):
    if current_user.get("is_admin", False):
        return
    effective_branch = require_branch_scope(current_user, branch_id)
    if effective_branch != branch_id:
        raise HTTPException(status_code=403, detail="Branch access denied")


def _report_phone_key(value: str) -> str:
    digits = re.sub(r"\D", "", str(value or "").split("@", 1)[0])
    return "966" + digits[1:] if len(digits) == 10 and digits.startswith("0") else digits


def _report_name(value) -> Optional[str]:
    if value in (None, ""):
        return None
    name = str(value).strip()
    digits = re.sub(r"\D", "", name)
    if len(digits) >= 7:
        return None
    return name[:200] or None


async def _report_names_by_phone(branch_id: str) -> dict[str, str]:
    """Resolve only exact phone matches within the requested branch."""
    candidates = {}
    members = _db["members"]
    if not hasattr(members, "find"):
        return names
    cursor = members.find(
        {"branch_id": branch_id},
        {
            "_id": 0, "phone": 1, "customer_phone": 1,
            "name": 1, "name_ar": 1, "name_en": 1, "customer_name": 1,
        },
    )
    rows = (
        await cursor.to_list(length=10000)
        if hasattr(cursor, "to_list")
        else [row async for row in cursor]
    )
    for member in rows:
        name = (
            member.get("name_ar") or member.get("name")
            or member.get("name_en") or member.get("customer_name")
        )
        name = _report_name(name)
        for phone_value in (member.get("phone"), member.get("customer_phone")):
            phone = _report_phone_key(phone_value)
            if phone and name:
                candidates.setdefault(phone, set()).add(name)
    return {
        phone: " / ".join(sorted(names))
        for phone, names in candidates.items()
    }


async def _report_can_view_phones(current_user: dict) -> bool:
    if current_user.get("is_admin", False):
        return True
    if "member-phones" in (current_user.get("permissions") or []):
        return True
    user_id = current_user.get("user_id") or current_user.get("id")
    user = await _db["users"].find_one(
        {"id": user_id}, {"_id": 0, "permissions": 1}
    )
    return "member-phones" in ((user or {}).get("permissions") or [])


def _sanitize_report_error(value, *, phone_visible: bool) -> Optional[str]:
    if value in (None, ""):
        return None
    if not phone_visible:
        return "Provider error"
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value)).strip()
    # Provider error payloads must never become an HTML/Excel injection vector.
    text = re.sub(r"https?://\S+", "[link]", text, flags=re.IGNORECASE)
    return text[:500] or None


async def _campaign_report(job_id: str, branch_id: str, current_user: dict) -> dict:
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    phone_visible = await _report_can_view_phones(current_user)
    names = await _report_names_by_phone(branch_id)
    report = await whatsapp_bulk_jobs.get_report(
        job_id, branch_id, phone_visible=phone_visible, names_by_phone=names
    )
    if not report:
        raise HTTPException(status_code=404, detail="Campaign job not found")

    # Keep branch metadata best-effort and historical-safe.  No inferred title
    # or timestamps are manufactured when old jobs did not store them.
    branch = await _db["branches"].find_one(
        {"id": branch_id}, {"_id": 0, "name": 1, "name_ar": 1, "name_en": 1}
    )
    branch_name = (branch or {}).get("name") or (branch or {}).get("name_ar") or (branch or {}).get("name_en")
    if branch_name and not report["job"].get("branch_name"):
        report["job"]["branch_name"] = branch_name
    elif not report["job"].get("branch_name"):
        report["notes"].append("Branch name was unavailable for this historical job.")
    if not report["job"].get("campaign_title"):
        report["job"]["campaign_title"] = (
            report["job"].get("campaign_name")
            or report["job"].get("name")
            or report["job"].get("title")
        )
    if not report["job"].get("campaign_title"):
        report["job"]["campaign_title"] = None
        report["notes"].append("Campaign title was unavailable for this historical job.")
    for field in ("branch_name", "created_at", "started_at", "completed_at"):
        report["job"].setdefault(field, None)
    for field in ("pause_reason", "error"):
        if field in report["job"]:
            report["job"][field] = _sanitize_report_error(
                report["job"].get(field), phone_visible=phone_visible
            )
    for recipient in report["recipients"]:
        recipient["error"] = _sanitize_report_error(
            recipient.get("error"), phone_visible=phone_visible
        )
    return report


def _excel_safe(value):
    """Prevent formula interpretation for every user/provider-supplied cell."""
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    text = str(value)
    if text.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def _campaign_report_xlsx(report: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    workbook = Workbook()
    summary_sheet = workbook.active
    summary_sheet.title = "Summary"
    summary_sheet.append(["Campaign report", ""])
    summary_sheet["A1"].font = Font(bold=True, size=14)
    job = report.get("job") or {}
    summary_sheet.append(["Campaign title", _excel_safe(job.get("campaign_title"))])
    summary_sheet.append(["Branch", _excel_safe(job.get("branch_name"))])
    summary_sheet.append(["Job ID", _excel_safe(job.get("id"))])
    summary_sheet.append(["Created", _excel_safe(job.get("created_at"))])
    summary_sheet.append(["Started", _excel_safe(job.get("started_at"))])
    summary_sheet.append(["Completed", _excel_safe(job.get("completed_at"))])
    summary_sheet.append([])
    summary_sheet.append(["Metric", "Count"])
    for cell in summary_sheet[9]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="D9EAF7")
    for key, value in (report.get("summary") or {}).items():
        summary_sheet.append([_excel_safe(key), _excel_safe(value)])
    if report.get("notes"):
        summary_sheet.append([])
        summary_sheet.append(["Notes", ""])
        for note in report["notes"]:
            summary_sheet.append(["", _excel_safe(note)])

    recipients_sheet = workbook.create_sheet("Recipients")
    columns = [
        "id", "name", "phone", "status", "delivery_status",
        "sent_at", "delivered_at", "read_at", "error",
    ]
    recipients_sheet.append(columns)
    for cell in recipients_sheet[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="D9EAF7")
    for recipient in report.get("recipients") or []:
        recipients_sheet.append([
            _excel_safe(recipient.get(column)) for column in columns
        ])
    for sheet in workbook.worksheets:
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for column in sheet.columns:
            letter = column[0].column_letter
            sheet.column_dimensions[letter].width = min(
                60, max(12, max(len(str(cell.value or "")) for cell in column) + 2)
            )
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


@router.get("/branch-cloud/{branch_id}/availability")
async def get_branch_cloud_availability(
    branch_id: str, current_user: dict = Depends(get_current_user)
):
    _require_bulk_whatsapp_access(current_user)
    _assert_branch_access(current_user, branch_id)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    branch = await _db["branches"].find_one({"id": branch_id}, {"_id": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    config = await _get_branch_cloud_config(branch_id)
    provider = _branch_provider(config)
    waha_used = 0
    waha_remaining = None
    if provider in {"waha", "whatsflow"} and config:
        quota = await _get_waha_campaign_quota(branch_id, int(config.get("waha_daily_limit") or 30))
        waha_used, waha_remaining = quota["used"], quota["remaining"]
    return {
        "provider": provider,
        "enabled": bool(
            (_waha_config_for_branch(config) if provider == "waha" else bool(
                config.get("enabled") and config.get("whatsflow_instance")
                and config.get("whatsflow_api_key_encrypted")
            )) if provider in {"waha", "whatsflow"} else
            config and config.get("enabled") and config.get("phone_number_id")
            and config.get("access_token_encrypted")
        ),
        "configured": (WAHAClient().configured if provider == "waha" else bool(
            config and config.get("whatsflow_api_key_encrypted")
        )) if provider in {"waha", "whatsflow"} else bool(config and config.get("access_token_encrypted")),
        "connected": (
            bool(config and config.get("waha_session_status") in ("WORKING", "CONNECTED"))
            if provider == "waha" else bool(config and config.get("whatsflow_state") == "open")
        ) if provider in {"waha", "whatsflow"} else None,
        "daily_limit": int(config.get("waha_daily_limit") or 30) if provider in {"waha", "whatsflow"} and config else None,
        "daily_used": waha_used if provider in {"waha", "whatsflow"} else None,
        "daily_remaining": waha_remaining if provider in {"waha", "whatsflow"} else None,
        "template_configured": bool(
            config
            and config.get("message_template_name")
            and config.get("single_variable_template_confirmed")
        ),
        "image_template_configured": bool(
            config and config.get("image_template_name")
            and config.get("media_templates_confirmed")
        ),
        "document_template_configured": bool(
            config and config.get("document_template_name")
            and config.get("media_templates_confirmed")
        ),
    }


@router.post("/branch-cloud/send-bulk")
async def send_branch_cloud_bulk(
    data: BulkCloudSendRequest,
    current_user: dict = Depends(get_current_user),
    response: Response = None,
):
    _require_bulk_whatsapp_access(current_user)
    if not current_user.get('is_admin') and not current_user.get('_approved_campaign'):
        raise HTTPException(403, detail='جهّز الحملة وأرسلها لاعتماد المدير قبل الإرسال')
    _assert_branch_access(current_user, data.branch_id)
    if not data.recipients:
        raise HTTPException(status_code=400, detail="No recipients supplied")
    if len(data.recipients) > 200:
        raise HTTPException(status_code=400, detail="Maximum 200 recipients per batch")
    metadata = _bulk_campaign_metadata(
        data.campaign_title, data.campaign_id, data.branch_name
    )
    config = await _get_branch_cloud_config(data.branch_id)
    provider = _branch_provider(config)
    if provider not in {"meta_cloud", "waha", "whatsflow"}:
        raise HTTPException(status_code=400, detail="No active WhatsApp provider is configured for this branch")
    if provider == "waha" and not _waha_config_for_branch(config):
        raise HTTPException(status_code=400, detail="WAHA is not configured for this branch")
    if provider == "whatsflow" and not (
        config and config.get("enabled") and config.get("whatsflow_instance")
        and config.get("whatsflow_api_key_encrypted")
    ):
        raise HTTPException(status_code=400, detail="Whatsflow is not configured for this branch")
    if provider == "meta_cloud" and not (
        config
        and config.get("enabled")
        and config.get("phone_number_id")
        and config.get("access_token_encrypted")
    ):
        raise HTTPException(status_code=400, detail="Meta WhatsApp is not configured for this branch")
    if provider == "meta_cloud" and not (
        config.get("message_template_name")
        and config.get("single_variable_template_confirmed")
    ):
        raise HTTPException(
            status_code=400,
            detail="Confirm an approved Meta template with exactly one body variable",
        )

    key = re.sub(r"[^A-Za-z0-9_-]", "", data.idempotency_key or "")[:100]
    if len(key) < 12:
        raise HTTPException(status_code=400, detail="Invalid idempotency key")
    recipients = [_bulk_recipient_payload(r) for r in data.recipients]
    if current_user.get('_campaign_schedule'):
        for recipient in recipients:
            recipient['next_attempt_at'] = current_user['_campaign_schedule']
    if any(not _format_cloud_phone(r["phone"]) or not r["message"] or len(r["message"]) > 4096
           for r in recipients):
        raise HTTPException(status_code=400, detail="Invalid phone or message")
    enqueue_args = (data.branch_id, provider, recipients, key)
    is_campaign = data.dispatch_source == 'campaign' or data.campaign_id or current_user.get('_approved_campaign')
    enqueue_options = {} if is_campaign else {'source': 'branch_bulk'}
    if metadata:
        job, _created = await whatsapp_bulk_jobs.enqueue(
            *enqueue_args, metadata=metadata, **enqueue_options
        )
    else:
        job, _created = await whatsapp_bulk_jobs.enqueue(*enqueue_args, **enqueue_options)
    if response is not None:
        response.status_code = 202
    return job


async def _upload_meta_bulk_media(
    content: bytes, filename: str, mime_type: str, config: dict
) -> str:
    token = _decrypt_access_token(config["access_token_encrypted"])
    version = (config.get("graph_api_version") or "v23.0").strip()
    url = (
        f"https://graph.facebook.com/{version}/"
        f"{config['phone_number_id']}/media"
    )
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}"},
            data={"messaging_product": "whatsapp"},
            files={"file": (filename, content, mime_type)},
        )
    if response.status_code >= 300:
        logger.error("Meta media upload failed: HTTP %s", response.status_code)
        raise HTTPException(status_code=502, detail="Meta media upload failed")
    media_id = response.json().get("id")
    if not media_id:
        raise HTTPException(status_code=502, detail="Meta did not return a media ID")
    return media_id


async def _send_meta_media_template_result(
    phone: str,
    message: str,
    media_id: str,
    media_type: str,
    filename: str,
    config: dict,
) -> tuple[bool, Optional[str], Optional[str]]:
    wa_phone = _format_cloud_phone(phone)
    if not wa_phone:
        return False, None, "invalid_phone"
    template_name = (
        config.get("image_template_name")
        if media_type == "image"
        else config.get("document_template_name")
    )
    media_parameter = {"id": media_id}
    if media_type == "document":
        media_parameter["filename"] = filename
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": wa_phone.split("@")[0],
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": config.get("template_language") or "ar"},
            "components": [
                {
                    "type": "header",
                    "parameters": [{
                        "type": media_type,
                        media_type: media_parameter,
                    }],
                },
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": message}],
                },
            ],
        },
    }
    token = _decrypt_access_token(config["access_token_encrypted"])
    version = (config.get("graph_api_version") or "v23.0").strip()
    url = (
        f"https://graph.facebook.com/{version}/"
        f"{config['phone_number_id']}/messages"
    )
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if 200 <= response.status_code < 300:
            provider_message_id = None
            try:
                provider_message_id = (
                    (response.json().get("messages") or [{}])[0].get("id")
                )
            except Exception:
                pass
            return (
                True,
                str(provider_message_id)
                if provider_message_id not in (None, "") else None,
                None,
            )
        logger.error("Meta media template send failed: HTTP %s", response.status_code)
    except Exception as exc:
        logger.error("Meta media template send failed: %s", type(exc).__name__)
        raise
    return False, None, (
        f"http_{response.status_code}" if "response" in locals() else "send_failed"
    )


async def _send_meta_chat_image_result(
    phone: str, caption: str, media_id: str, config: dict
) -> tuple[bool, Optional[str], Optional[str]]:
    """Send an uploaded image as a normal Meta media message.

    This path is only used inside Meta's customer-service window.  Outside
    that window the caller uses the branch's explicitly approved image
    template instead.
    """
    digits = "".join(filter(str.isdigit, phone or ""))
    if not digits:
        return False, None, "invalid_phone"
    token = _decrypt_access_token(config["access_token_encrypted"])
    version = (config.get("graph_api_version") or "v23.0").strip()
    url = f"https://graph.facebook.com/{version}/{config['phone_number_id']}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": wa_phone.split("@")[0],
        "type": "image",
        "image": {
            "id": media_id,
            **({"caption": caption} if caption else {}),
        },
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
            )
        provider_message_id = None
        if 200 <= response.status_code < 300:
            try:
                provider_message_id = (
                    (response.json().get("messages") or [{}])[0].get("id")
                )
            except Exception:
                pass
            return (
                True,
                str(provider_message_id)
                if provider_message_id not in (None, "") else None,
                None,
            )
        logger.error("Meta chat image send failed: HTTP %s", response.status_code)
        return False, None, f"http_{response.status_code}"
    except Exception as exc:
        logger.error("Meta chat image send failed: %s", type(exc).__name__)
        return False, None, type(exc).__name__


async def _send_cloud_chat_image_result(
    phone: str,
    content: bytes,
    mime_type: str,
    filename: str,
    caption: str,
    config: dict,
    inside_service_window: bool,
    branch_id: Optional[str] = None,
) -> tuple[bool, Optional[str], Optional[str], bool, Optional[str]]:
    """Dispatch one inbox image through exactly the configured branch provider.

    The final two return values are whether a Meta template was used and the
    provider's uploaded media ID (if one exists).  No provider call is retried
    here; callers surface all failures to the operator.
    """
    provider = _branch_provider(config)
    if provider == "waha":
        session = config.get("waha_physical_session_id") or _waha_physical_session_id(
            str(branch_id or config.get("branch_id") or ""),
            str(config.get("waha_session_name") or ""),
        )
        wa_phone = _format_cloud_phone(phone)
        if not wa_phone or not session:
            return False, None, "invalid_waha_config", False, None
        success, response, error = await WAHAClient().send_media(
            session,
            _waha_chat_id(wa_phone),
            content,
            mime_type,
            filename,
            caption,
            image=True,
        )
        return (
            success,
            _canonical_waha_message_id(response),
            error,
            False,
            None,
        )
    if provider == "whatsflow":
        wa_phone = _format_cloud_phone(phone)
        if not wa_phone:
            return False, None, "invalid_phone", False, None
        success, response, error = await _whatsflow_client(config).send_media(
            wa_phone,
            "image",
            mime_type,
            caption,
            base64.b64encode(content).decode("ascii"),
            filename,
        )
        provider_message_id = None
        if isinstance(response, dict):
            key = response.get("key")
            provider_message_id = (
                (key.get("id") if isinstance(key, dict) else None)
                or response.get("id")
            )
        return success, provider_message_id, error, False, None
    if provider != "meta_cloud":
        return False, None, "image_not_supported_for_branch_provider", False, None
    if not (
        config.get("enabled")
        and config.get("phone_number_id")
        and config.get("access_token_encrypted")
    ):
        return False, None, "meta_not_configured", False, None
    if not inside_service_window and not (
        config.get("image_template_name")
        and config.get("media_templates_confirmed")
    ):
        return False, None, "approved_meta_image_template_required", False, None
    if not inside_service_window and not caption:
        return False, None, "caption_required_for_meta_image_template", False, None
    media_id = await _upload_meta_bulk_media(content, filename, mime_type, config)
    if inside_service_window:
        success, provider_message_id, error = await _send_meta_chat_image_result(
            phone, caption, media_id, config
        )
        return success, provider_message_id, error, False, media_id
    success, provider_message_id, error = await _send_meta_media_template_result(
        phone, caption, media_id, "image", filename, config
    )
    return success, provider_message_id, error, True, media_id


async def _send_meta_chat_audio_result(
    phone: str, media_id: str, config: dict
) -> tuple[bool, Optional[str], Optional[str]]:
    """Send an already-uploaded OGG/Opus file as Meta's native audio type."""
    digits = "".join(filter(str.isdigit, phone or ""))
    if not digits:
        return False, None, "invalid_phone"
    try:
        token = _decrypt_access_token(config["access_token_encrypted"])
        version = (config.get("graph_api_version") or "v23.0").strip()
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"https://graph.facebook.com/{version}/{config['phone_number_id']}/messages",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": digits,
                    "type": "audio",
                    "audio": {"id": media_id},
                },
            )
        if not 200 <= response.status_code < 300:
            logger.error("Meta chat audio send failed: HTTP %s", response.status_code)
            return False, None, f"http_{response.status_code}"
        try:
            provider_message_id = (response.json().get("messages") or [{}])[0].get("id")
        except Exception:
            provider_message_id = None
        return True, str(provider_message_id) if provider_message_id else None, None
    except Exception as exc:
        logger.error("Meta chat audio send failed: %s", type(exc).__name__)
        return False, None, type(exc).__name__


async def _send_cloud_chat_voice_result(
    phone: str,
    content: bytes,
    mime_type: str,
    filename: str,
    config: dict,
    branch_id: Optional[str] = None,
) -> tuple[bool, Optional[str], Optional[str], Optional[str]]:
    """Dispatch an OGG Opus PTT message once through the selected provider."""
    provider = _branch_provider(config)
    try:
        if provider == "waha":
            session = config.get("waha_physical_session_id") or _waha_physical_session_id(
                str(branch_id or config.get("branch_id") or ""),
                str(config.get("waha_session_name") or ""),
            )
            wa_phone = _format_cloud_phone(phone)
            if not wa_phone or not session:
                return False, None, "invalid_waha_config", None
            ok, response, error = await WAHAClient().send_voice(
                session, _waha_chat_id(wa_phone), content,
                "audio/ogg; codecs=opus", filename,
            )
            return ok, _canonical_waha_message_id(response), error, None
        if provider == "whatsflow":
            wa_phone = _format_cloud_phone(phone)
            if not wa_phone:
                return False, None, "invalid_phone", None
            ok, response, error = await _whatsflow_client(config).send_whatsapp_audio(
                wa_phone, base64.b64encode(content).decode("ascii"), delay=0
            )
            return ok, _provider_message_id(response), error, None
        if provider != "meta_cloud":
            return False, None, "voice_not_supported_for_branch_provider", None
        if not (
            config.get("enabled") and config.get("phone_number_id")
            and config.get("access_token_encrypted")
        ):
            return False, None, "meta_not_configured", None
        try:
            media_id = await _upload_meta_bulk_media(
                content, filename, "audio/ogg; codecs=opus", config
            )
        except Exception as exc:
            # The upload may have reached Meta even if its response did not;
            # return an uncertain result and never issue a second upload.
            return False, None, type(exc).__name__, None
        ok, provider_message_id, error = await _send_meta_chat_audio_result(
            phone, media_id, config
        )
        return ok, provider_message_id, error, media_id
    except Exception as exc:
        # The caller deliberately represents transport/parser failures as
        # uncertain rather than retrying a potentially accepted voice note.
        return False, None, type(exc).__name__, None


async def _send_meta_media_template(
    phone: str,
    message: str,
    media_id: str,
    media_type: str,
    filename: str,
    config: dict,
) -> bool:
    """Backward-compatible bool wrapper for non-campaign callers."""
    success, _, _ = await _send_meta_media_template_result(
        phone, message, media_id, media_type, filename, config
    )
    return success


async def _validate_closure_job_config(provider: str, config: dict) -> Optional[str]:
    """Use current positive evidence for closures, never a speculative cache write."""
    reason = _validate_bulk_job_config(provider, config)
    if provider != "whatsflow" or reason not in (None, "Whatsflow is not connected"):
        return reason
    try:
        status = parse_connection_state(
            *await _whatsflow_client(config).connection_state()
        )
    except Exception as exc:
        return f"Whatsflow status unavailable: {type(exc).__name__}"
    if not status["check_ok"]:
        return f"Whatsflow status unavailable: {status['error']}"
    if not status["connected"]:
        return f"Whatsflow is not connected (state: {status['status']})"
    return None


def _validate_bulk_job_config(provider: str, config: dict) -> Optional[str]:
    if provider != _branch_provider(config):
        return "The branch WhatsApp provider changed; job paused"
    if provider == "waha":
        if not _waha_config_for_branch(config):
            return "WAHA is not configured"
        if config.get("waha_session_status") not in ("WORKING", "CONNECTED"):
            return "WAHA session is not connected"
    elif provider == "whatsflow":
        if not (config and config.get("enabled") and config.get("whatsflow_instance")
                and config.get("whatsflow_api_key_encrypted")):
            return "Whatsflow is not configured"
        if config.get("whatsflow_state") != "open":
            return "Whatsflow is not connected"
    elif not (config and config.get("enabled") and config.get("phone_number_id")
              and config.get("access_token_encrypted")):
        return "Meta WhatsApp is not configured"
    return None


async def _load_bulk_attachment(branch_id: str, ref: dict) -> bytes:
    scope = {**_campaign_scope(branch_id), "attachment_id": ref["attachment_id"]}
    meta = await _db["whatsapp_campaign_attachments"].find_one(scope)
    if not meta:
        raise RuntimeError("Stored campaign attachment is missing")
    chunks = await _db["whatsapp_campaign_attachment_chunks"].find(scope).sort(
        "index", 1).to_list(length=int(meta.get("chunk_count") or 0) + 1)
    if len(chunks) != int(meta.get("chunk_count") or 0):
        raise RuntimeError("Stored campaign attachment is incomplete")
    return b"".join(chunk.get("data") or b"" for chunk in chunks)


async def _dispatch_bulk_job_item(item: dict, config: dict, assert_fence) -> bool:
    provider = item["provider"]
    provider_message_id = None
    provider_message_id_aliases = []
    wa_phone = _format_cloud_phone(item["phone"])
    attachment = item.get("attachment")
    caption = item["message"] if item.get("media_index", 0) == 0 or provider == "meta_cloud" else ""
    if not attachment:
        await assert_fence()
        if provider == "waha":
            # Keep WAHA's full and stanza IDs as literal evidence.  The public
            # text helper retains its historical three-value tuple for other
            # callers; campaigns additionally need the alias for receipts.
            evidence_id = await _start_whatsflow_automation_evidence(
                wa_phone, config
            )
            try:
                (
                    success,
                    provider_message_id,
                    error,
                    provider_message_id_aliases,
                ) = await _send_waha_message_evidence_result(
                    wa_phone, item["message"], config
                )
            except Exception as exc:
                await _finish_whatsflow_automation_evidence(
                    evidence_id, status="unknown", error=type(exc).__name__
                )
                raise
            await _finish_whatsflow_automation_evidence(
                evidence_id,
                status="sent" if success and provider_message_id else "unknown",
                provider_message_id=provider_message_id,
                error=error,
            )
            if not success and error and not error.startswith("http_") and error != "invalid_phone":
                raise RuntimeError(f"uncertain_provider_outcome:{error}")
        elif provider == "whatsflow":
            success, provider_message_id, error = await _send_session_provider_result(wa_phone, item["message"], config)
            if not success and error and not error.startswith("http_") and error != "invalid_phone":
                raise RuntimeError(f"uncertain_provider_outcome:{error}")
        else:
            success, provider_message_id, error = await _send_meta_cloud_message_result(
                wa_phone, item["message"], config)
            if not success and error and not error.startswith("http_") and error != "invalid_phone":
                raise RuntimeError(f"uncertain_provider_outcome:{error}")
    else:
        content = await _load_bulk_attachment(item["branch_id"], attachment)
        mime = attachment["mime_type"]
        media_type = attachment["media_type"]
        filename = attachment["filename"]
        if provider == "waha":
            await assert_fence()
            session = config.get("waha_physical_session_id") or _waha_physical_session_id(
                item["branch_id"], config.get("waha_session_name") or "")
            # Campaign media has the same linked-phone echo race as text.
            # Establish durable automation evidence before dispatch.
            evidence_id = await _start_whatsflow_automation_evidence(
                wa_phone, config
            )
            try:
                success, provider_response, error = await WAHAClient().send_media(
                    session, _waha_chat_id(wa_phone), content, mime, filename, caption,
                    image=media_type == "image")
            except Exception as exc:
                await _finish_whatsflow_automation_evidence(
                    evidence_id, status="unknown", error=type(exc).__name__
                )
                raise
            provider_message_id = _canonical_waha_message_id(provider_response)
            provider_message_id_aliases = _waha_message_id_variants(
                provider_response
            )
            await _finish_whatsflow_automation_evidence(
                evidence_id,
                status="sent" if success and provider_message_id else "unknown",
                provider_message_id=provider_message_id,
                error=error,
            )
            if not success and error and not error.startswith("http_"):
                raise RuntimeError(f"uncertain_provider_outcome:{error}")
        elif provider == "whatsflow":
            await assert_fence()
            success, provider_message_id, error = await _send_whatsflow_media_result(
                wa_phone, media_type, mime, caption,
                base64.b64encode(content).decode("ascii"), filename, config
            )
            if not success and error and not error.startswith("http_"):
                raise RuntimeError(f"uncertain_provider_outcome:{error}")
        else:
            media_id = await _upload_meta_bulk_media(content, filename, mime, config)
            await assert_fence()
            success, provider_message_id, _error = await _send_meta_media_template_result(
                item["phone"], caption, media_id, media_type, filename, config
            )
    # Receipt evidence has to be tied to the provider's actual message ID for
    # every transport (including Meta templates/media).  A 2xx response with
    # no reliable identity may already have dispatched, so it is deliberately
    # unknown rather than a confirmed send and is never retried by the worker.
    if success and not provider_message_id:
        raise RuntimeError("uncertain_provider_outcome:missing_message_id")
    try:
        if isinstance(provider_message_id, str) and provider_message_id:
            evidence = {"provider_message_id": provider_message_id}
            if provider_message_id_aliases:
                evidence["provider_message_id_aliases"] = (
                    provider_message_id_aliases
                )
            await _db["whatsapp_campaign_job_items"].update_one(
                {"id": item["id"], "branch_id": item["branch_id"]},
                {"$set": evidence},
            )
            # A verified receipt can precede the provider response.  Reconcile
            # only by this literal provider ID (or an explicit WAHA alias),
            # never by recipient phone, and never by issuing another send.
            await whatsapp_bulk_jobs.reconcile_receipt(
                item["branch_id"],
                provider,
                provider_message_id,
                tenant_slug=get_current_tenant_slug(),
                aliases=provider_message_id_aliases,
            )
        if success:
            await _db["whatsapp_campaign_job_items"].update_one(
                {"id": item["id"], "branch_id": item["branch_id"]},
                {"$set": {"sent_at": datetime.now(timezone.utc)}},
            )
    except Exception as exc:
        # Recording inbox metadata must never change a send result or cause retry.
        logger.warning("Campaign inbox metadata failed: %s", type(exc).__name__)
    try:
        await _db["whatsapp_send_log"].insert_one({
            "phone": wa_phone.split("@")[0], "message": caption if attachment else item["message"],
            "success": success, "sent_at": datetime.now(timezone.utc).isoformat(),
            "manual": True, "type": f"bulk_cloud_{attachment['media_type']}" if attachment else "bulk_cloud",
            "branch_id": item["branch_id"], "transport": provider,
        })
    except Exception as exc:
        logger.warning("Provider result recorded but bulk send log failed: %s", type(exc).__name__)
    return success


@router.post("/branch-cloud/send-bulk-media")
async def send_branch_cloud_bulk_media(
    branch_id: str = Form(...),
    recipients_json: str = Form(...),
    idempotency_key: str = Form(...),
    campaign_title: str = Form(""),
    campaign_id: str = Form(""),
    branch_name: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
    attachments: List[UploadFile] = File(default=[]),
    current_user: dict = Depends(get_current_user),
    response: Response = None,
):
    _require_bulk_whatsapp_access(current_user)
    if not current_user.get('is_admin') and not current_user.get('_approved_campaign'):
        raise HTTPException(403, detail='جهّز الحملة وأرسلها لاعتماد المدير قبل الإرسال')
    _assert_branch_access(current_user, branch_id)
    metadata = _bulk_campaign_metadata(campaign_title, campaign_id, branch_name)
    try:
        raw_recipients = json.loads(recipients_json)
        recipients = [BulkCloudRecipient(**item) for item in raw_recipients]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid recipients")
    if not recipients or len(recipients) > 200:
        raise HTTPException(status_code=400, detail="Supply 1-200 recipients")
    config = await _get_branch_cloud_config(branch_id)
    provider = _branch_provider(config)
    if provider not in {"meta_cloud", "waha", "whatsflow"}:
        raise HTTPException(status_code=400, detail="No active WhatsApp provider is configured for this branch")
    if provider == "waha" and not _waha_config_for_branch(config):
        raise HTTPException(status_code=400, detail="WAHA is not configured")
    if provider == "whatsflow":
        if not (config and config.get("enabled") and config.get("whatsflow_instance")
                and config.get("whatsflow_api_key_encrypted")):
            raise HTTPException(status_code=400, detail="Whatsflow is not configured")
    if provider == "meta_cloud" and not (
        config and config.get("enabled") and config.get("phone_number_id")
        and config.get("access_token_encrypted")
    ):
        raise HTTPException(status_code=400, detail="Meta WhatsApp is not configured")

    uploads = list(attachments) if isinstance(attachments, (list, tuple)) else []
    if attachment:
        uploads.insert(0, attachment)
    if not uploads:
        raise HTTPException(status_code=400, detail="No attachment supplied")
    if len(uploads) > CAMPAIGN_MAX_IMAGES:
        raise HTTPException(status_code=400, detail="At most 10 images may be sent")
    media_items = []
    for upload in uploads:
        mime_type = (upload.content_type or "").lower()
        if mime_type in {"image/jpeg", "image/png"}:
            media_type = "image"
            template_name = config.get("image_template_name")
            max_size = CAMPAIGN_IMAGE_LIMIT
            extension = ".jpg" if mime_type == "image/jpeg" else ".png"
        elif mime_type == "application/pdf":
            media_type = "document"
            template_name = config.get("document_template_name")
            max_size = CAMPAIGN_PDF_LIMIT
            extension = ".pdf"
        else:
            raise HTTPException(status_code=400, detail="Only JPG, PNG, and PDF are supported")
        if len(uploads) > 1 and media_type != "image":
            raise HTTPException(status_code=400, detail="PDF cannot be mixed with images; send one PDF only")
        content_buffer = bytearray()
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            content_buffer.extend(chunk)
            if len(content_buffer) > max_size:
                raise HTTPException(status_code=400, detail="Attachment is too large")
        content = bytes(content_buffer)
        valid_signature = (
            content.startswith(b"\xff\xd8\xff")
            if mime_type == "image/jpeg"
            else content.startswith(b"\x89PNG\r\n\x1a\n")
            if mime_type == "image/png"
            else content.startswith(b"%PDF-")
        )
        if not content or not valid_signature:
            raise HTTPException(status_code=400, detail="Invalid or oversized attachment")
        raw_name = os.path.basename(
            (upload.filename or f"attachment{extension}").replace("\\", "_")
        )
        safe_stem = re.sub(
            r"[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]+", "", raw_name
        )
        safe_stem = re.sub(r"[^A-Za-z0-9._ -]+", "_", safe_stem)
        safe_stem = os.path.splitext(safe_stem)[0].strip(" ._")[:100] or "attachment"
        filename = safe_stem + extension
        if provider == "meta_cloud" and (not template_name or not config.get("media_templates_confirmed")):
            raise HTTPException(
                status_code=400,
                detail=f"Configure the approved Meta {media_type} template for this branch",
            )
        media_items.append({
            "content": content, "mime_type": mime_type, "media_type": media_type,
            "filename": filename,
        })
    if any(
        not (recipient.message or "").strip()
        or len(recipient.message.strip()) > 1024
        for recipient in recipients
    ):
        raise HTTPException(status_code=400, detail="Message text must be 1-1024 characters")
    idempotency_key = re.sub(r"[^A-Za-z0-9_-]", "", idempotency_key or "")[:100]
    if len(idempotency_key) < 12:
        raise HTTPException(status_code=400, detail="Invalid idempotency key")
    # Completed records from the synchronous implementation remain authoritative:
    # retries return their old result and can never enqueue duplicate sends.
    legacy = await _db["whatsapp_bulk_media_batches"].find_one({
        "branch_id": branch_id, "idempotency_key": idempotency_key,
        "result": {"$exists": True}}, {"_id": 0})
    if legacy and legacy.get("result"):
        return legacy["result"]
    legacy_inflight = await _db["whatsapp_bulk_media_batches"].find_one({
        "branch_id": branch_id, "idempotency_key": idempotency_key,
        "status": {"$in": ["processing", "unknown"]}})
    if legacy_inflight:
        raise HTTPException(
            status_code=409,
            detail="A legacy send with this key has an uncertain outcome; reconcile it before retrying",
        )
    existing = await whatsapp_bulk_jobs.get_job_by_key(branch_id, idempotency_key)
    if existing:
        if response is not None:
            response.status_code = 202
        return existing

    # Reuse the campaign attachment chunk collections; job documents only keep
    # tenant/branch-scoped references and no media touches the filesystem.
    stored = []
    try:
        for upload, item in zip(uploads, media_items):
            await upload.seek(0)
            ref = await _store_campaign_attachment(branch_id, upload)
            ref.update({"media_type": item["media_type"], "filename": item["filename"],
                        "mime_type": item["mime_type"]})
            stored.append(ref)
        prepared_recipients = [_bulk_recipient_payload(r) for r in recipients]
        if current_user.get('_campaign_schedule'):
            for recipient in prepared_recipients:
                recipient['next_attempt_at'] = current_user['_campaign_schedule']
        enqueue_args = (
            branch_id, provider,
            prepared_recipients,
            idempotency_key, stored,
        )
        if metadata:
            job, created = await whatsapp_bulk_jobs.enqueue(
                *enqueue_args, metadata=metadata
            )
        else:
            job, created = await whatsapp_bulk_jobs.enqueue(*enqueue_args)
        if not created:
            for ref in stored:
                await _delete_campaign_attachment(branch_id, ref.get("attachment_id"))
            stored = []
    except Exception:
        # Once enqueue persisted the authoritative idempotency/job record, its
        # media remains owned by that retained failed/initializing job. Only
        # clean up when no job was committed at all.
        owner = await whatsapp_bulk_jobs.get_job_by_key(branch_id, idempotency_key)
        if not owner:
            for ref in stored:
                await _delete_campaign_attachment(branch_id, ref.get("attachment_id"))
        raise
    if response is not None:
        response.status_code = 202
    return job


@router.get("/branch-cloud/jobs/{job_id}")
async def get_branch_cloud_job(
    job_id: str, branch_id: str, current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    _assert_branch_access(current_user, branch_id)
    job = await whatsapp_bulk_jobs.get_job(job_id, branch_id)
    if not job:
        raise HTTPException(status_code=404, detail="Campaign job not found")
    return job


@router.get("/branch-cloud/jobs/{job_id}/report")
async def get_branch_cloud_job_report(
    job_id: str, branch_id: str, current_user: dict = Depends(get_current_user),
):
    """Return a read-only, recipient-grouped delivery report."""
    _require_bulk_whatsapp_access(current_user)
    _assert_branch_access(current_user, branch_id)
    return await _campaign_report(job_id, branch_id, current_user)


@router.get("/branch-cloud/jobs/{job_id}/report.xlsx")
async def export_branch_cloud_job_report(
    job_id: str, branch_id: str, current_user: dict = Depends(get_current_user),
):
    """Export the same privacy-filtered report as a real XLSX workbook."""
    _require_bulk_whatsapp_access(current_user)
    _assert_branch_access(current_user, branch_id)
    report = await _campaign_report(job_id, branch_id, current_user)
    content = _campaign_report_xlsx(report)
    safe_job_id = re.sub(r"[^A-Za-z0-9_-]", "", job_id)[:80] or "job"
    return StreamingResponse(
        iter([content]),
        media_type=(
            "application/vnd.openxmlformats-officedocument."
            "spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": (
                f'attachment; filename="campaign_report_{safe_job_id}.xlsx"'
            ),
        },
    )


@router.post("/branch-cloud/jobs/{job_id}/cancel")
async def cancel_branch_cloud_job(
    job_id: str, branch_id: str, current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    _assert_branch_access(current_user, branch_id)
    job = await whatsapp_bulk_jobs.cancel(job_id, branch_id)
    if not job:
        raise HTTPException(status_code=404, detail="Campaign job not found")
    return job


@router.post("/branch-cloud/jobs/reconcile-lane")
async def reconcile_branch_cloud_lane(
    branch_id: str, confirmed_no_dispatch_risk: bool = False,
    current_user: dict = Depends(get_current_user),
):
    _require_bulk_whatsapp_access(current_user)
    _assert_branch_access(current_user, branch_id)
    reconciled = await whatsapp_bulk_jobs.reconcile_lane(
        branch_id, confirmed_no_dispatch_risk=confirmed_no_dispatch_risk)
    if not reconciled:
        raise HTTPException(status_code=409, detail="This branch lane is not frozen")
    return {"success": True, "cooldown_seconds": whatsapp_bulk_jobs.MIN_INTERVAL_SECONDS}


@router.post("/branch-cloud/{branch_id}/test")
async def test_branch_cloud_config(
    branch_id: str,
    data: BranchCloudTestRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_admin(current_user)
    config = await _get_branch_cloud_config(branch_id)
    if _branch_provider(config) in {"waha", "whatsflow"}:
        return await branch_provider_test(
            branch_id, WAHABranchTestRequest(phone=data.phone, message=data.message),
            current_user,
        )
    if not config or not config.get("enabled") or not config.get("access_token_encrypted"):
        raise HTTPException(status_code=400, detail="Meta WhatsApp is not configured for this branch")
    message = data.message or "رسالة تجريبية من نظام إدارة الأكاديمية"
    wa_phone = _format_cloud_phone(data.phone)
    if not wa_phone:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    await registration_followups.stop_phone(
        branch_id, wa_phone, "staff_contacted"
    )
    await campaign_inquiry_automation.stop_phone(
        branch_id, wa_phone, "staff_contacted"
    )
    if await _send_meta_cloud_message(wa_phone, message, config):
        return {"success": True}
    raise HTTPException(status_code=502, detail="Meta WhatsApp test failed")


@router.post("/test")
async def send_test(data: SendTestRequest, current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    now_riyadh = datetime.now(RIYADH_TZ)
    message = data.message or f"رسالة تجريبية من نظام إدارة أكاديمية الأبطال 🏆\nالوقت: {now_riyadh.strftime('%Y-%m-%d %H:%M')}"
    wa_phone = _format_phone(data.phone)
    if not wa_phone:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    await registration_followups.stop_phone(
        data.branch_id, wa_phone, "staff_contacted"
    )
    await campaign_inquiry_automation.stop_phone(
        data.branch_id, wa_phone, "staff_contacted"
    )
    if data.branch_id:
        if not current_user.get("is_admin"):
            require_branch_scope(current_user, data.branch_id)
        success = await _send_wa_message_for_branch(
            wa_phone, message, data.branch_id, automated=False
        )
    else:
        wa_status = await _get_wa_status()
        if not wa_status.get("connected"):
            raise HTTPException(status_code=400, detail="WhatsApp not connected. Please scan the QR code first.")
        success = await _send_wa_message(wa_phone, message)
    if success:
        return {"success": True, "message": "Message sent successfully"}
    raise HTTPException(status_code=500, detail="Failed to send message")


class SendNowPreviewRequest(BaseModel):
    branch_id: Optional[str] = None


class SendNowConfirmRequest(BaseModel):
    preview_id: str
    confirm: bool


def _send_now_actor_id(current_user: dict) -> str:
    return str(current_user.get("user_id") or current_user.get("id") or "")


async def _validated_send_now_settings() -> tuple[dict, list[int]]:
    if _db is None:
        raise HTTPException(status_code=503, detail="قاعدة البيانات غير متاحة")
    settings = await _get_settings()
    if not settings.get("enabled"):
        raise HTTPException(status_code=400, detail="يجب تفعيل تذكيرات التجديد أولاً")
    offsets = [
        int(item["days"]) for item in _normalize_offsets(settings) if item.get("enabled")
    ]
    if not offsets:
        raise HTTPException(status_code=400, detail="يجب تفعيل موعد تذكير واحد على الأقل")
    return settings, offsets


@router.post("/send-now/preview")
async def preview_reminders_now(
    data: SendNowPreviewRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_whatsapp_access(current_user)
    effective_branch = resolve_branch_filter(current_user, data.branch_id)
    settings, offsets = await _validated_send_now_settings()
    candidates = await _build_send_now_candidates(effective_branch, offsets)
    all_branch_templates = await _get_branch_templates()
    candidate_branch_ids = {row.get("branch_id") for row in candidates}
    branch_templates = {
        branch_id: templates
        for branch_id, templates in all_branch_templates.items()
        if branch_id in candidate_branch_ids
    }
    channels = ["whatsapp"]
    if settings.get("push_enabled", True):
        channels.append("push")
    if settings.get("portal_enabled", True):
        channels.append("portal")

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=SEND_NOW_PREVIEW_TTL_SECONDS)
    preview_id = str(uuid.uuid4())
    tenant_slug = get_current_tenant_slug()
    snapshot = {
        "preview_id": preview_id,
        "tenant_slug": tenant_slug,
        "actor_id": _send_now_actor_id(current_user),
        "branch_id": effective_branch,
        "settings_fingerprint": _send_now_settings_fingerprint(settings),
        "branch_templates_fingerprint": _mapping_fingerprint(branch_templates),
        "branch_templates": branch_templates,
        "offsets": offsets,
        "channels": channels,
        "candidates": candidates,
        "candidate_identity": _candidate_identity(candidates),
        "created_at": now,
        "expires_at": expires_at,
        "consumed_at": None,
    }
    previews = _db["whatsapp_send_previews"]
    await previews.create_index("expires_at", expireAfterSeconds=0)
    await previews.create_index(
        [("tenant_slug", 1), ("preview_id", 1)], unique=True
    )
    await previews.insert_one(snapshot)

    public_recipients = [{
        key: row[key] for key in (
            "member_id", "member_name", "activity_id", "activity_name",
            "end_date", "attended_sessions", "branch_name",
        )
    } for row in candidates]
    return {
        "preview_id": preview_id,
        "expires_at": expires_at.isoformat(),
        "recipients": public_recipients,
        "member_count": len({row["member_id"] for row in candidates}),
        "channels": channels,
        "count": _send_now_reminder_count(candidates),
        "row_count": len(candidates),
    }


@router.post("/send-now")
async def send_reminders_now(
    data: SendNowConfirmRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_whatsapp_access(current_user)
    if data.confirm is not True:
        raise HTTPException(status_code=400, detail="يجب تأكيد الإرسال صراحةً")
    if _db is None:
        raise HTTPException(status_code=503, detail="قاعدة البيانات غير متاحة")

    tenant_slug = get_current_tenant_slug()
    actor_id = _send_now_actor_id(current_user)
    previews = _db["whatsapp_send_previews"]
    preview = await previews.find_one({
        "preview_id": data.preview_id,
        "tenant_slug": tenant_slug,
        "actor_id": actor_id,
    })
    if not preview:
        raise HTTPException(status_code=404, detail="معاينة الإرسال غير موجودة")
    effective_branch = resolve_branch_filter(current_user, preview.get("branch_id"))
    if effective_branch != preview.get("branch_id"):
        raise HTTPException(status_code=403, detail="لم تعد لديك صلاحية هذا الفرع")
    now = datetime.now(timezone.utc)
    if preview.get("consumed_at") is not None:
        raise HTTPException(status_code=409, detail="تم استخدام هذه المعاينة مسبقاً")
    expires_at = preview.get("expires_at")
    if not isinstance(expires_at, datetime) or _as_utc(expires_at) <= now:
        raise HTTPException(status_code=409, detail="انتهت صلاحية المعاينة، يرجى إنشاؤها مجدداً")

    # Claim first: even concurrent confirmations can only produce one dispatcher.
    consumed = await previews.find_one_and_update(
        {
            "preview_id": data.preview_id,
            "tenant_slug": tenant_slug,
            "actor_id": actor_id,
            "consumed_at": None,
            "expires_at": {"$gt": now},
        },
        {"$set": {"consumed_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    if not consumed:
        raise HTTPException(status_code=409, detail="تم استخدام المعاينة أو انتهت صلاحيتها")

    settings, offsets = await _validated_send_now_settings()
    current_candidates = await _build_send_now_candidates(effective_branch, offsets)
    all_branch_templates = await _get_branch_templates()
    candidate_branch_ids = {row.get("branch_id") for row in current_candidates}
    current_branch_templates = {
        branch_id: templates
        for branch_id, templates in all_branch_templates.items()
        if branch_id in candidate_branch_ids
    }
    if (
        _send_now_settings_fingerprint(settings) != consumed.get("settings_fingerprint")
        or _mapping_fingerprint(current_branch_templates)
        != consumed.get("branch_templates_fingerprint")
        or offsets != consumed.get("offsets")
        or _candidate_identity(current_candidates) != consumed.get("candidate_identity")
    ):
        await previews.update_one(
            {"preview_id": data.preview_id},
            {"$set": {"stale": True}},
        )
        raise HTTPException(
            status_code=409,
            detail="تغيّرت الإعدادات أو بيانات الاشتراكات، يرجى إنشاء معاينة جديدة",
        )

    asyncio.ensure_future(_dispatch_send_now_snapshot(consumed, settings))
    return {
        "success": True,
        "preview_id": data.preview_id,
        "count": _send_now_reminder_count(consumed.get("candidates") or []),
        "row_count": len(consumed.get("candidates") or []),
        "message": "تم تأكيد الإرسال",
    }


@router.post("/disconnect")
async def disconnect(current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(f"{WA_SERVICE_URL}/disconnect")
            return r.json()
    except Exception:
        raise HTTPException(status_code=503, detail="WhatsApp service not available")


@router.get("/logs")
async def get_send_logs(
    limit: int = 50, branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    _require_whatsapp_access(current_user)
    branch_id = resolve_branch_filter(current_user, branch_filter)
    if _db is None:
        return []
    logs = await _db["whatsapp_send_log"].find(
        {"branch_id": branch_id} if branch_id else {}, {"_id": 0}
    ).sort("timestamp", -1).limit(max(1, min(limit, 200))).to_list(length=max(1, min(limit, 200)))
    return logs


@router.get("/target-count")
async def get_target_count(current_user: dict = Depends(get_current_user)):
    _require_whatsapp_access(current_user)
    if _db is None:
        return {"count": 0, "count_today": 0, "target_date": "", "count_2": 0, "count_today_2": 0, "target_date_2": ""}
    settings = await _get_settings()
    today = datetime.now(RIYADH_TZ).date()
    today_str = today.strftime("%Y-%m-%d")

    enabled_offsets = sorted({
        int(it["days"]) for it in _normalize_offsets(settings) if it.get("enabled")
    })
    if not enabled_offsets:
        enabled_offsets = [int(settings.get("days_before", 3))]

    offset_dates = {d: (today + timedelta(days=d)).strftime("%Y-%m-%d") for d in enabled_offsets}

    all_members = await _db["members"].find(
        {"activities": {"$elemMatch": {"status": "active"}}}
    ).to_list(length=10000)

    per_offset_today: dict = {d: 0 for d in enabled_offsets}
    max_days = max(enabled_offsets)
    max_date = (today + timedelta(days=max_days)).strftime("%Y-%m-%d")
    count_within = 0
    count_today_any = 0

    for m in all_members:
        matched_window = False
        matched_today = False
        per_offset_matched: dict = {d: False for d in enabled_offsets}
        for a in m.get("activities", []):
            if a.get("status") != "active":
                continue
            ed = a.get("end_date", "")
            if not ed:
                continue
            if not matched_window and today_str <= ed <= max_date:
                count_within += 1
                matched_window = True
            for d, target_str_d in offset_dates.items():
                if not per_offset_matched[d] and ed.startswith(target_str_d):
                    per_offset_today[d] += 1
                    per_offset_matched[d] = True
                    if not matched_today:
                        count_today_any += 1
                        matched_today = True

    offsets_breakdown = [
        {"days": d, "target_date": offset_dates[d], "count_today": per_offset_today[d]}
        for d in enabled_offsets
    ]

    # Backward-compat: legacy fields use first/second enabled offset.
    primary = enabled_offsets[0]
    secondary = enabled_offsets[1] if len(enabled_offsets) > 1 else None
    target_str = offset_dates[primary]
    count_today_primary = per_offset_today[primary]
    if secondary is not None:
        target_str_2 = offset_dates[secondary]
        count_today_2 = per_offset_today[secondary]
        reminder_2_enabled = True
    else:
        target_str_2 = ""
        count_today_2 = 0
        reminder_2_enabled = False

    return {
        "count": count_within,
        "count_today": count_today_primary,
        "count_today_any": count_today_any,
        "target_date": target_str,
        "count_2": count_today_2,
        "count_today_2": count_today_2,
        "target_date_2": target_str_2,
        "reminder_2_enabled": reminder_2_enabled,
        "offsets": offsets_breakdown,
    }


# ===================== Renewal-reminder log endpoints =====================

class BulkReminderItem(BaseModel):
    member_id: str
    activity_name: Optional[str] = ""
    end_date: Optional[str] = ""
    days_remaining: Optional[int] = None
    fee: Optional[float] = None


class LastReminderFilterItem(BaseModel):
    member_id: str
    activity_name: Optional[str] = ""


class LastReminderFilterRequest(BaseModel):
    items: List[LastReminderFilterItem] = []


class BulkReminderRequest(BaseModel):
    items: List[BulkReminderItem]


async def _aggregate_last_renewal_reminders(
    current_user: dict,
    filter_pairs: Optional[List[LastReminderFilterItem]] = None,
):
    """Shared aggregation used by both GET and POST variants."""
    # Renewals page admins (with `renewals` permission) need this badge data
    # without being granted full WhatsApp settings access.
    _require_renewals_or_whatsapp_access(current_user)
    if _db is None:
        return []

    # Branch scoping: non-admins only see reminders for their branch's members.
    # Fail-closed via resolve_branch_filter: a non-admin without a branch_id
    # is denied entirely (HTTP 403).
    effective_branch_id = resolve_branch_filter(current_user, None)
    allowed_member_ids: Optional[set] = None
    if effective_branch_id:
        try:
            cursor_m = _db["members"].find({"branch_id": effective_branch_id}, {"id": 1, "_id": 0})
            allowed_member_ids = {row["id"] async for row in cursor_m if row.get("id")}
        except Exception as e:
            logger.error(f"Branch scoping query failed: {e}")
            allowed_member_ids = set()

    try:
        match_stage: dict = {}
        if allowed_member_ids is not None:
            if not allowed_member_ids:
                return []
            match_stage["member_id"] = {"$in": list(allowed_member_ids)}

        # Optional explicit pair filter — narrows the aggregation to just the
        # cards visible on the Renewals page (cheaper than the global scan).
        if filter_pairs:
            pair_or = []
            requested_member_ids = set()
            for it in filter_pairs:
                if not it.member_id:
                    continue
                # Re-enforce branch scoping per-pair when applicable.
                if allowed_member_ids is not None and it.member_id not in allowed_member_ids:
                    continue
                requested_member_ids.add(it.member_id)
                pair_or.append({
                    "member_id": it.member_id,
                    "activity_name": it.activity_name or "",
                })
            if not pair_or:
                return []
            # Use $or on full pairs so we only fetch rows we'll actually return.
            match_stage = {"$and": [match_stage, {"$or": pair_or}]} if match_stage else {"$or": pair_or}

        pipeline = []
        if match_stage:
            pipeline.append({"$match": match_stage})
        pipeline.extend([
            {"$sort": {"timestamp": -1}},
            {
                "$group": {
                    "_id": {"member_id": "$member_id", "activity_name": "$activity_name"},
                    # `last_*` fields capture the most recent reminder event
                    # exactly, while `channels` aggregates the set of channels
                    # ever used so the tooltip can list "via WhatsApp + push".
                    "last_sent": {"$first": "$timestamp"},
                    "last_channel": {"$first": "$channel"},
                    "channels": {"$addToSet": "$channel"},
                    "manual": {"$first": "$manual"},
                    "days_before": {"$first": "$days_before"},
                    "sent_by": {"$first": "$sent_by"},
                }
            },
            # Promote the composite _id back to top-level fields. The Atlas
            # HTTP Data API does not include `_id` in aggregate results, so
            # we project the grouped keys explicitly to remain driver-agnostic.
            {
                "$project": {
                    "_id": 0,
                    "member_id": "$_id.member_id",
                    "activity_name": "$_id.activity_name",
                    "last_sent": 1,
                    "last_channel": 1,
                    "channels": 1,
                    "manual": 1,
                    "days_before": 1,
                    "sent_by": 1,
                }
            },
            {"$limit": 5000},
        ])
        cursor = _db["renewal_reminder_log"].aggregate(pipeline)
        results = []
        async for row in cursor:
            results.append({
                "member_id": row.get("member_id"),
                "activity_name": row.get("activity_name"),
                "last_sent": row.get("last_sent"),
                "last_channel": row.get("last_channel"),
                "channels": row.get("channels", []),
                "manual": row.get("manual"),
                "days_before": row.get("days_before"),
                "sent_by": row.get("sent_by"),
            })
        return results
    except Exception as e:
        logger.error(f"Failed to aggregate renewal reminder log: {e}")
        return []


@router.get("/renewal-reminders/last")
async def get_last_renewal_reminders(current_user: dict = Depends(get_current_user)):
    """Return the most-recent reminder timestamp per (member_id, activity_name)."""
    return await _aggregate_last_renewal_reminders(current_user)


@router.post("/renewal-reminders/last")
async def post_last_renewal_reminders(
    payload: LastReminderFilterRequest,
    current_user: dict = Depends(get_current_user),
):
    """Filtered variant — returns only the (member_id, activity_name) pairs sent.

    Lets the Renewals page request just the badges it actually needs to render,
    avoiding a global scan of renewal_reminder_log on large deployments.
    """
    return await _aggregate_last_renewal_reminders(current_user, payload.items)


@router.get("/renewal-reminders/template")
async def get_renewal_reminder_template(current_user: dict = Depends(get_current_user)):
    """Return only the manual reminder template + per-offset overrides.

    Renewals admins (with `renewals` permission) can read the manual template
    used by the per-card "Remind" buttons without being granted full
    WhatsApp settings access (which exposes WA tokens). Sensitive auto/push
    configuration is intentionally NOT included in the response.
    """
    _require_renewals_or_whatsapp_access(current_user)
    settings = await _get_settings()
    return {
        "manual_reminder_template": settings.get(
            "manual_reminder_template",
            DEFAULT_SETTINGS["manual_reminder_template"],
        ),
        "manual_reminder_expired_template": settings.get(
            "manual_reminder_expired_template",
            DEFAULT_SETTINGS["manual_reminder_expired_template"],
        ),
        "message_template": settings.get(
            "message_template", DEFAULT_SETTINGS["message_template"]
        ),
        "templates": settings.get("templates") or {},
    }


@router.get("/welcome-template")
async def get_welcome_template(current_user: dict = Depends(get_current_user)):
    """Return only the global welcome template (for new members).

    Used by the Members page manual welcome button. Any authenticated staff
    member can read it — it contains no tokens or sensitive WhatsApp config.
    Per-branch overrides live on the branch document and are resolved client-side.
    """
    settings = await _get_settings()
    return {
        "welcome_template": settings.get(
            "welcome_template", DEFAULT_SETTINGS["welcome_template"]
        ),
    }


@router.get("/renewal-reminders/history")
async def get_renewal_reminder_history(
    member_id: Optional[str] = None,
    activity_name: Optional[str] = None,
    channel: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    manual: Optional[str] = None,
    branch_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """Paginated audit log of every renewal reminder. Used by the history page."""
    eff_limit = max(1, min(int(limit), 500))
    eff_offset = max(0, int(offset))
    rows, total = await _query_reminder_history(
        current_user=current_user,
        member_id=member_id,
        activity_name=activity_name,
        channel=channel,
        start_date=start_date,
        end_date=end_date,
        manual=manual,
        branch_id=branch_id,
        limit=eff_limit,
        offset=eff_offset,
    )
    return {"rows": rows, "total": total, "limit": eff_limit, "offset": eff_offset}


@router.get("/renewal-reminders/history/export")
async def export_renewal_reminder_history(
    member_id: Optional[str] = None,
    activity_name: Optional[str] = None,
    channel: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    manual: Optional[str] = None,
    branch_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Excel export of the same filtered history list (no pagination)."""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="غير مصرح: التصدير متاح للمدير فقط")
    from io import BytesIO
    from fastapi.responses import StreamingResponse

    rows, _ = await _query_reminder_history(
        current_user=current_user,
        member_id=member_id,
        activity_name=activity_name,
        channel=channel,
        start_date=start_date,
        end_date=end_date,
        manual=manual,
        branch_id=branch_id,
        limit=10000,
        offset=0,
    )

    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill

    def _safe_excel_cell(value):
        """Defuse Excel/CSV formula injection on string cells.

        If a cell starts with `=`, `+`, `-`, `@`, tab or CR/LF, prefix with `'`
        so spreadsheet apps treat it as text. Non-strings are returned as-is.
        """
        if not isinstance(value, str) or not value:
            return value
        if value[0] in ("=", "+", "-", "@", "\t", "\r", "\n"):
            return "'" + value
        return value

    wb = Workbook()
    ws = wb.active
    ws.title = "Renewal Reminders"

    headers = [
        "التاريخ والوقت", "اسم العضو", "النشاط", "القناة",
        "أيام قبل الانتهاء", "يدوي/تلقائي", "ناجح", "أُرسل بواسطة",
    ]
    ws.append(headers)
    header_fill = PatternFill("solid", fgColor="F97316")
    header_font = Font(bold=True, color="FFFFFF")
    center = Alignment(horizontal='center', vertical='center', wrap_text=True)
    for col_idx in range(1, len(headers) + 1):
        c = ws.cell(row=1, column=col_idx)
        c.fill = header_fill
        c.font = header_font
        c.alignment = center

    for r in rows:
        sent_by = r.get("sent_by") or {}
        if isinstance(sent_by, dict) and sent_by.get("system"):
            sender = "النظام"
        else:
            sender = (sent_by.get("name") or sent_by.get("username") or "") if isinstance(sent_by, dict) else ""
        ws.append([
            _safe_excel_cell(r.get("timestamp", "")),
            _safe_excel_cell(r.get("member_name", "")),
            _safe_excel_cell(r.get("activity_name", "")),
            _safe_excel_cell(r.get("channel", "")),
            r.get("days_before") if r.get("days_before") is not None else "",
            "يدوي" if r.get("manual") else "تلقائي",
            "نعم" if r.get("success") else "لا",
            _safe_excel_cell(sender),
        ])

    for letter, width in zip(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], [22, 26, 22, 14, 16, 12, 8, 24]):
        ws.column_dimensions[letter].width = width

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"renewal_reminders_{datetime.now(RIYADH_TZ).strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


async def _query_reminder_history(
    current_user: dict,
    member_id: Optional[str],
    activity_name: Optional[str],
    channel: Optional[str],
    start_date: Optional[str],
    end_date: Optional[str],
    manual: Optional[str],
    branch_id: Optional[str],
    limit: int,
    offset: int,
):
    """Shared query/enrichment used by both JSON and Excel history endpoints."""
    _require_renewals_or_whatsapp_access(current_user)
    if _db is None:
        return [], 0

    # Branch filtering — fail-closed for non-admins without a branch_id
    effective_branch_id = resolve_branch_filter(current_user, branch_id)

    allowed_member_ids: Optional[set] = None
    if effective_branch_id:
        try:
            cursor_m = _db["members"].find(
                {"branch_id": effective_branch_id}, {"id": 1, "_id": 0}
            )
            allowed_member_ids = {row["id"] async for row in cursor_m if row.get("id")}
        except Exception as e:
            logger.error(f"Branch scoping query failed: {e}")
            allowed_member_ids = set()
        if not allowed_member_ids:
            return [], 0

    match: dict = {}
    if allowed_member_ids is not None:
        match["member_id"] = {"$in": list(allowed_member_ids)}
    if member_id:
        if allowed_member_ids is not None and member_id not in allowed_member_ids:
            return [], 0
        match["member_id"] = member_id
    if activity_name:
        match["activity_name"] = activity_name
    if channel:
        match["channel"] = channel
    if manual in ("true", "True", "1"):
        match["manual"] = True
    elif manual in ("false", "False", "0"):
        match["manual"] = False
    ts_clause: dict = {}
    if start_date:
        ts_clause["$gte"] = start_date
    if end_date:
        ts_clause["$lte"] = end_date + "T23:59:59"
    if ts_clause:
        match["timestamp"] = ts_clause

    coll = _db["renewal_reminder_log"]
    try:
        total = await coll.count_documents(match)
        cursor = coll.find(match, {"_id": 0}).sort("timestamp", -1).skip(offset).limit(limit)
        rows = await cursor.to_list(length=limit)
    except Exception as e:
        logger.error(f"Reminder history query failed: {e}")
        return [], 0

    member_ids = list({r.get("member_id") for r in rows if r.get("member_id")})
    name_by_id: dict = {}
    if member_ids:
        try:
            cursor_n = _db["members"].find(
                {"id": {"$in": member_ids}},
                {"id": 1, "name": 1, "name_ar": 1, "_id": 0},
            )
            async for m in cursor_n:
                name_by_id[m["id"]] = m.get("name_ar") or m.get("name") or ""
        except Exception as e:
            logger.error(f"Member name lookup failed: {e}")

    for r in rows:
        r["member_name"] = name_by_id.get(r.get("member_id"), "")

    return rows, total


@router.post("/renewal-reminders/send")
async def send_bulk_renewal_reminders(
    payload: BulkReminderRequest,
    log_only: bool = False,
    current_user: dict = Depends(get_current_user),
):
    """Send manual renewal reminders for an explicit list of (member, activity) pairs.

    Sends WhatsApp (if connected), push (if enabled), and creates portal
    notifications (if enabled). Always logs into renewal_reminder_log so the
    Renewals page can update its "last reminder" indicator.

    Set ``log_only=true`` to skip all dispatch (WhatsApp/push/portal) and only
    record reminder log entries — used by the per-card "Remind" button which
    opens wa.me directly in the browser to avoid double sends.
    """
    # Renewals page admins (with `renewals` permission) need to dispatch
    # reminders without holding full WhatsApp settings access.
    _require_renewals_or_whatsapp_access(current_user)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    if not payload.items:
        raise HTTPException(status_code=400, detail="No items provided")

    settings = await _get_settings()
    settings = {**settings, "_manual_run": True}
    template = settings.get("manual_reminder_template", DEFAULT_SETTINGS["manual_reminder_template"])
    expired_template = settings.get(
        "manual_reminder_expired_template",
        DEFAULT_SETTINGS["manual_reminder_expired_template"],
    )
    branch_templates = await _get_branch_templates()
    push_enabled = settings.get("push_enabled", True)
    portal_enabled = settings.get("portal_enabled", True)

    wa_status = await _get_wa_status()
    wa_connected = (
        wa_status.get("connected", False) or await _has_enabled_cloud_config()
    ) and not log_only

    # Branch scoping: non-admins can only target members in their own branch.
    # Fail-closed via require_branch_scope: a non-admin without a branch_id
    # is denied entirely (HTTP 403).
    is_admin = current_user.get("is_admin", False)
    user_branch_id = require_branch_scope(current_user)

    # Build per-member groups so we send one WhatsApp message per phone covering
    # all selected activities (less spammy).
    member_ids = list({i.member_id for i in payload.items if i.member_id})
    members_by_id: dict = {}
    if member_ids:
        async for m in _db["members"].find({"id": {"$in": member_ids}}):
            members_by_id[m["id"]] = m

    # Hard-reject cross-branch member IDs for non-admin callers (no silent drops).
    if not is_admin:
        offenders = [
            mid for mid, m in members_by_id.items()
            if m.get("branch_id") != user_branch_id
        ]
        # Also flag any requested ids that don't exist (treated as forbidden too)
        missing = [mid for mid in member_ids if mid not in members_by_id]
        if offenders or missing:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Cross-branch member IDs not allowed",
                    "out_of_branch": offenders,
                    "missing": missing,
                },
            )

    today = datetime.now(RIYADH_TZ).date()
    wa_sent = 0
    push_sent = 0
    portal_inserted = 0
    skipped = 0
    # WhatsApp is buffered separately from the per-member channels below.
    # A family may share one phone number, and the same number may legitimately
    # be configured in different branches (which can use different senders).
    wa_buffers: dict = {}

    # Group by member_id for WhatsApp
    groups: dict = {}
    for it in payload.items:
        groups.setdefault(it.member_id, []).append(it)

    for mid, items in groups.items():
        member = members_by_id.get(mid)
        if not member:
            skipped += len(items)
            continue
        member_logged = False
        name = member.get("name_ar") or member.get("name") or ""
        phone = member.get("phone", "")
        activities_text = "، ".join(filter(None, [i.activity_name for i in items]))
        # Use earliest end date for display
        end_dates = sorted([i.end_date for i in items if i.end_date])
        end_date_raw = end_dates[0] if end_dates else ""
        end_date_fmt = end_date_raw.replace("-", "/") if end_date_raw else ""
        # Compute days remaining for placeholder
        try:
            days_calc = (datetime.strptime(end_date_raw[:10], "%Y-%m-%d").date() - today).days
        except Exception:
            days_calc = items[0].days_remaining if items[0].days_remaining is not None else 0

        # Reminders sent AFTER the end date use the past-tense "expired"
        # wording (الاشتراك انتهى بتاريخ...) instead of "قارب على الانتهاء".
        # Decided by the same (earliest) end date shown in the message.
        is_expired_reminder = days_calc < 0

        # Compute total fee for {fee} placeholder (sum of selected items' fees)
        total_fee = 0.0
        for it in items:
            try:
                if it.fee is not None:
                    total_fee += float(it.fee)
            except Exception:
                pass
        fee_str = str(int(total_fee)) if float(total_fee).is_integer() else f"{total_fee:.2f}"

        # ── WhatsApp ──
        if wa_connected and phone:
            wa_phone = _format_phone(phone)
            if wa_phone:
                if is_expired_reminder:
                    member_template = _resolve_branch_template(
                        branch_templates, member.get("branch_id"), "manual_expired", expired_template
                    )
                else:
                    member_template = _resolve_branch_template(
                        branch_templates, member.get("branch_id"), "manual", template
                    )
                message = _render_template(
                    member_template,
                    name=name,
                    activity=activities_text,
                    days=days_calc,
                    end_date=end_date_fmt,
                    fee=fee_str,
                )

                # Templates only expose one {end_date}, while a bulk selection
                # can contain subscriptions ending on different dates. Keep the
                # custom template as the introduction and add an explicit line
                # for every selected activity. Insert this in the Arabic portion
                # when the custom template already contains an English section.
                activity_details = []
                english_details = []
                item_days = []
                for it in items:
                    item_end_raw = it.end_date or ""
                    item_end_fmt = item_end_raw.replace("-", "/") if item_end_raw else ""
                    try:
                        item_day_count = (
                            datetime.strptime(item_end_raw[:10], "%Y-%m-%d").date() - today
                        ).days
                    except Exception:
                        item_day_count = (
                            it.days_remaining if it.days_remaining is not None else 0
                        )
                    item_days.append(item_day_count)
                    activity_label = it.activity_name or ""
                    activity_details.append(
                        f"- {activity_label}: {item_end_fmt}"
                    )
                    english_details.append(
                        _renewal_english_summary(
                            name=name,
                            activity=activity_label,
                            end_date=item_end_fmt,
                            days_remaining=item_day_count,
                        )
                    )

                details_ar = (
                    f"تفاصيل اشتراكات {name}:\n" + "\n".join(activity_details)
                )
                arabic_part, marker, english_part = message.partition(
                    BILINGUAL_ENGLISH_MARKER
                )
                arabic_part = f"{arabic_part.rstrip()}\n\n{details_ar}"
                if marker:
                    message = (
                        f"{arabic_part}\n\n{marker}{english_part}"
                    )
                else:
                    message = arabic_part
                message = _append_english_section(
                    _ensure_renewal_arabic_date(message, end_date_fmt),
                    "\n\n".join(english_details),
                )
                branch_id = member.get("branch_id")
                buffer_key = (wa_phone, branch_id or "")
                buffer = wa_buffers.setdefault(
                    buffer_key,
                    {
                        "wa_phone": wa_phone,
                        "phone": phone,
                        "branch_id": branch_id,
                        "sections": [],
                        "entries": [],
                    },
                )
                buffer["sections"].append(message)
                for it, item_day_count in zip(items, item_days):
                    buffer["entries"].append({
                        "member_id": mid,
                        "member_name": name,
                        "activity_name": it.activity_name or "",
                        "days_before": item_day_count,
                    })
                member_logged = True
        elif log_only and phone:
            # In log-only mode the browser opens wa.me directly. We still record
            # the manual reminder so the "Last reminder" badge updates.
            for it in items:
                await _record_renewal_reminder(
                    member_id=mid,
                    activity_name=it.activity_name or "",
                    channel="whatsapp",
                    days_before=days_calc,
                    manual=True,
                    success=True,
                    sent_by=current_user,
                )
            member_logged = True

        # ── Push ──
        if push_enabled and not log_only:
            try:
                from .push_notifications import send_push_notification, NotificationPayload
                push_title_tmpl = settings.get("push_title_template", DEFAULT_SETTINGS["push_title_template"])
                push_body_tmpl = settings.get("push_body_template", DEFAULT_SETTINGS["push_body_template"])
                push_title_tmpl_en = settings.get("push_title_template_en", DEFAULT_SETTINGS["push_title_template_en"])
                push_body_tmpl_en = settings.get("push_body_template_en", DEFAULT_SETTINGS["push_body_template_en"])
                title = _render_template(push_title_tmpl, name=name, activity=activities_text,
                                         days=days_calc, end_date=end_date_fmt, fee=fee_str)
                body = _render_template(push_body_tmpl, name=name, activity=activities_text,
                                        days=days_calc, end_date=end_date_fmt, fee=fee_str)
                # English variants used when the recipient's saved push
                # language is 'en'. Arabic remains the fallback otherwise.
                title_en = _render_template(push_title_tmpl_en, name=name, activity=activities_text,
                                            days=days_calc, end_date=end_date_fmt, fee=fee_str)
                body_en = _render_template(push_body_tmpl_en, name=name, activity=activities_text,
                                           days=days_calc, end_date=end_date_fmt, fee=fee_str)
                payload_obj = NotificationPayload(
                    title=title,
                    body=body,
                    title_en=title_en,
                    body_en=body_en,
                    url="/portal/notifications",
                    tag=f"manual-renewal-{mid}-{end_date_raw}",
                )
                subs = await _db["push_subscriptions"].find(
                    {"member_id": mid, "is_active": True}, {"_id": 0}
                ).to_list(20)
                any_ok = False
                for sub in subs:
                    try:
                        if await send_push_notification(sub, payload_obj):
                            push_sent += 1
                            any_ok = True
                    except Exception as e:
                        logger.error(f"Manual push reminder failed for {name}: {e}")
                if subs:
                    for it in items:
                        await _record_renewal_reminder(
                            member_id=mid,
                            activity_name=it.activity_name or "",
                            channel="push",
                            days_before=days_calc,
                            manual=True,
                            success=any_ok,
                            sent_by=current_user,
                        )
                    member_logged = True
            except Exception as e:
                logger.error(f"Manual push reminder error for {name}: {e}")

        # ── Portal (member_notifications) ──
        if portal_enabled and not log_only:
            try:
                title_ar = "🔔 تذكير بتجديد الاشتراك"
                if is_expired_reminder:
                    msg_ar = f"اشتراكك في {activities_text} انتهى بتاريخ {end_date_raw}. نرجو التواصل معنا للتجديد."
                else:
                    msg_ar = f"اشتراكك في {activities_text} سينتهي بتاريخ {end_date_raw}. نرجو التواصل معنا للتجديد."
                dedup_key = f"manual-renewal-{mid}-{end_date_raw}-{datetime.now(RIYADH_TZ).strftime('%Y%m%d%H%M')}"
                await _db["member_notifications"].insert_one({
                    "id": str(uuid.uuid4()),
                    "member_id": mid,
                    "type": "expiry_reminder",
                    "title_ar": title_ar,
                    "title": title_ar,
                    "message_ar": msg_ar,
                    "message": msg_ar,
                    "priority": "warning",
                    "dedup_key": dedup_key,
                    "is_read": False,
                    "created_at": datetime.now(RIYADH_TZ).isoformat(),
                })
                portal_inserted += 1
                for it in items:
                    await _record_renewal_reminder(
                        member_id=mid,
                        activity_name=it.activity_name or "",
                        channel="portal",
                        days_before=days_calc,
                        manual=True,
                        success=True,
                        sent_by=current_user,
                    )
                member_logged = True
            except Exception as e:
                logger.error(f"Manual portal reminder error for {name}: {e}")

        # Record bulk-remind intent if no channel logged (so the badge updates).
        if not member_logged:
            for it in items:
                await _record_renewal_reminder(
                    member_id=mid,
                    activity_name=it.activity_name or "",
                    channel="intent",
                    days_before=days_calc,
                    manual=True,
                    success=False,
                    sent_by=current_user,
                )

    # One physical WhatsApp dispatch per normalized phone and branch. Renewal
    # history remains one row per selected member/activity even when several
    # members share the recipient number.
    wa_groups = list(wa_buffers.values())
    for group_index, buffer in enumerate(wa_groups):
        message = "\n\n──────────\n\n".join(buffer["sections"])
        ok = await _send_wa_message_for_branch(
            buffer["wa_phone"], message, buffer["branch_id"]
        )
        entries = buffer["entries"]
        await _db["whatsapp_send_log"].insert_one({
            "timestamp": datetime.now(RIYADH_TZ).isoformat(),
            "member_id": entries[0]["member_id"] if entries else "",
            "member_ids": list(dict.fromkeys(e["member_id"] for e in entries)),
            "member_name": entries[0]["member_name"] if entries else "",
            "member_names": list(dict.fromkeys(e["member_name"] for e in entries)),
            "phone": buffer["phone"],
            "activities": "، ".join(
                e["activity_name"] for e in entries if e["activity_name"]
            ),
            "success": ok,
            "days_before": min(
                (e["days_before"] for e in entries), default=0
            ),
            "manual": True,
            "type": "renewal_reminder",
            "branch_id": buffer["branch_id"],
        })
        for entry in entries:
            await _record_renewal_reminder(
                member_id=entry["member_id"],
                activity_name=entry["activity_name"],
                channel="whatsapp",
                days_before=entry["days_before"],
                manual=True,
                success=ok,
                sent_by=current_user,
            )
        if ok:
            wa_sent += 1
        # Match non-campaign bulk pacing, without delaying after the final recipient.
        if group_index < len(wa_groups) - 1:
            await asyncio.sleep(30)

    return {
        "success": True,
        "wa_sent": wa_sent,
        "push_sent": push_sent,
        "portal_inserted": portal_inserted,
        "skipped": skipped,
        "wa_connected": wa_connected,
        "groups_processed": len(groups),
    }
