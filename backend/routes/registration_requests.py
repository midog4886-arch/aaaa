"""
Public Self-Registration Requests
==================================
Lets a parent/guardian self-register through a public per-branch link
(no authentication). Submissions land in a review queue (status="pending")
as `registration_requests` documents and are NEVER auto-converted into
members — a supervisor reviews each one and completes it into an invoice
through the normal invoice flow.

Routes:
  Public (no auth, tenant resolved from X-Tenant-Slug / subdomain):
    GET  /public/registration/{branch_id}   -> branch name + its activities
    POST /public/registration/{branch_id}   -> create a pending request
  Admin/staff (auth + branch scope):
    GET    /registration-requests            -> list (branch-scoped)
    PUT    /registration-requests/{req_id}   -> update status
    DELETE /registration-requests/{req_id}   -> delete / reject
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import re
import uuid

from database import db
from utils.auth import get_current_user, require_branch_scope, resolve_branch_filter
from utils.tenant import get_current_tenant

router = APIRouter(tags=["RegistrationRequests"])

STAFF_CONTACT_FOLLOWUP_REASONS = {"contacted", "staff_contacted"}
# A registration request is considered converted when it has a real invoice
# document.  Payment is intentionally not part of this invariant: a pending
# invoice is still an invoice.  A cancelled/failed invoice, however, is not a
# successful conversion and must not hide the request from the pending queue.
INVALID_REGISTRATION_INVOICE_STATUSES = {
    "cancelled", "canceled", "failed", "error", "void",
}


def _safe_location_url(url) -> str:
    """Only expose http(s) links to the public page — the value is rendered
    as an <a href>, so any other scheme (javascript:, data:, ...) is dropped
    even if bad legacy data exists in the DB."""
    url = (url or "").strip()
    return url if url.lower().startswith(("http://", "https://")) else ""


def _mask_phone(phone):
    """Keep the same phone privacy boundary used by the members API."""
    if not phone:
        return phone
    value = str(phone).strip()
    if len(value) <= 5:
        return value
    return value[:3] + "•" * (len(value) - 5) + value[-2:]


async def _can_view_registration_request_phones(current_user: dict) -> bool:
    """Admins and users with the existing member-phones permission may see
    registration-request numbers.  Do not trust permissions from a stale
    client token; load them from the tenant user document when needed."""
    if current_user.get("is_admin", False):
        return True
    if "member-phones" in (current_user.get("permissions") or []):
        return True
    user_id = current_user.get("user_id") or current_user.get("id")
    if not user_id:
        return False
    user_doc = await db.users.find_one(
        {"id": user_id}, {"_id": 0, "permissions": 1}
    )
    return "member-phones" in ((user_doc or {}).get("permissions") or [])


def _timestamp_value(value):
    """Return a JSON-safe timestamp without inventing one for old data."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat()
    return value


def _latest_timestamp(*values):
    """Choose the latest known timestamp while retaining malformed legacy
    values rather than fabricating a fallback date."""
    known = [value for value in values if value not in (None, "")]
    if not known:
        return None
    parsed = []
    for value in known:
        timestamp = _timestamp_value(value)
        try:
            parsed_time = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
            if parsed_time.tzinfo is None:
                parsed_time = parsed_time.replace(tzinfo=timezone.utc)
            parsed.append((
                parsed_time,
                timestamp,
            ))
        except (TypeError, ValueError):
            pass
    if parsed:
        return max(parsed, key=lambda pair: pair[0])[1]
    return _timestamp_value(known[0])


def _search_registration_requests(query: dict, search: Optional[str]):
    """Apply the same name/phone/marketer/activity search on the server.

    The page still keeps its local filtering for an immediate UI response, but
    the API must constrain the result before pagination/limits so a followed
    request outside the first loaded page cannot disappear.
    """
    raw = str(search or "").strip()
    if not raw:
        return
    normalized = raw.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")).lower()
    terms = [
        {"customer_name": {"$regex": re.escape(normalized), "$options": "i"}},
        {"marketer_name": {"$regex": re.escape(normalized), "$options": "i"}},
        {"activity_name": {"$regex": re.escape(normalized), "$options": "i"}},
    ]
    digits = "".join(c for c in normalized if c.isdigit())
    if len(digits) >= 3:
        # Customer numbers are commonly stored with spaces/dashes.  Match the
        # requested digits while allowing formatting characters between them.
        phone_pattern = r"\D*".join(re.escape(char) for char in digits)
        terms.append({"customer_phone": {"$regex": phone_pattern}})
    query["$or"] = terms


async def _followed_up_evidence(scope: dict) -> dict:
    """Return read-only evidence for the Followed up tab.

    Staff evidence comes only from the explicit contact stop reasons.  The
    automatic evidence comes only from a registration-followup campaign item
    whose durable provider outcome is ``sent`` (provider accepted).  Pending,
    failed, unknown, cancelled and merely opened WhatsApp links are
    deliberately excluded.
    """
    evidence = {}
    contact_rows = await db.registration_requests.find(
        {
            **scope,
            "$or": [
                {"followup_stop_reason": {"$in": list(STAFF_CONTACT_FOLLOWUP_REASONS)}},
                {"followup_staff_contacted_at": {"$exists": True}},
            ],
        },
        {
            "_id": 0, "id": 1, "followup_stop_reason": 1,
            "followup_staff_contacted_at": 1, "followup_contacted_at": 1,
            "followup_stopped_at": 1,
        },
    ).to_list(10000)
    for row in contact_rows:
        request_id = row.get("id")
        if not request_id:
            continue
        entry = evidence.setdefault(request_id, {})
        entry["staff_contacted"] = True
        entry["staff_contacted_at"] = _latest_timestamp(
            row.get("followup_staff_contacted_at"),
            row.get("followup_contacted_at"),
            row.get("followup_stopped_at"),
        )

    # request_ids are written into every newly-created follow-up item.  Do not
    # infer a relationship from a phone number: that could attribute a send
    # to the wrong request, especially for shared household numbers.
    item_query = {
        **scope,
        "communication_kind": "registration_followup",
        "status": "sent",
    }
    items = await db["whatsapp_campaign_job_items"].find(
        item_query,
        {"_id": 0, "source_metadata": 1, "sent_at": 1, "completed_at": 1},
    ).to_list(10000)
    for item in items:
        metadata = item.get("source_metadata") or {}
        request_ids = metadata.get("request_ids") or []
        if isinstance(request_ids, str):
            request_ids = [request_ids]
        if not isinstance(request_ids, (list, tuple, set)):
            continue
        sent_at = _latest_timestamp(item.get("sent_at"), item.get("completed_at"))
        for request_id in request_ids:
            if not request_id:
                continue
            entry = evidence.setdefault(request_id, {})
            entry["automatic_sent"] = True
            entry["automatic_sent_at"] = _latest_timestamp(
                entry.get("automatic_sent_at"), sent_at
            )
    return evidence


async def _sanitize_registration_requests(rows: list, current_user: dict) -> list:
    if await _can_view_registration_request_phones(current_user):
        return rows
    for row in rows:
        row["customer_phone"] = _mask_phone(row.get("customer_phone"))
        row["customer_phone_masked"] = True
    return rows


def _attach_followed_evidence(row: dict, evidence: dict):
    details = evidence.get(row.get("id"))
    if not details:
        return
    types = []
    if details.get("staff_contacted"):
        types.append("staff_contacted")
    if details.get("automatic_sent"):
        types.append("automatic")
    row["followup_types"] = types
    row["followup_staff_contacted"] = bool(details.get("staff_contacted"))
    row["followup_staff_contacted_at"] = details.get("staff_contacted_at")
    row["followup_automatic_sent"] = bool(details.get("automatic_sent"))
    row["followup_automatic_sent_at"] = details.get("automatic_sent_at")


async def _registration_invoice_links(rows: list) -> dict:
    """Resolve actual invoice links for registration requests, read-only.

    ``invoice_id`` is the request-side link, while
    ``registration_request_id`` is the invoice-side link written by the
    invoice creation path.  Looking up both makes this safe during recovery
    from an interrupted link write and lets old processed rows be repaired by
    the next normal invoice creation without a bulk migration.

    The returned map contains only invoices that still represent a successful
    conversion.  Cancelled/failed invoices deliberately do not count.
    """
    request_ids = [row.get("id") for row in rows if row.get("id")]
    request_invoice_ids = [
        row.get("invoice_id") for row in rows if row.get("invoice_id")
    ]
    if not request_ids and not request_invoice_ids:
        return {}

    terms = []
    if request_ids:
        terms.append({"registration_request_id": {"$in": request_ids}})
    if request_invoice_ids:
        terms.append({"id": {"$in": request_invoice_ids}})
    invoices = await db.invoices.find(
        {"$or": terms},
        {
            "_id": 0,
            "id": 1,
            "registration_request_id": 1,
            "status": 1,
            "branch_id": 1,
        },
    ).to_list(max(len(request_ids) + len(request_invoice_ids), 100))

    by_request_id = {}
    request_by_invoice_id = {
        row.get("invoice_id"): row
        for row in rows
        if row.get("invoice_id")
    }
    request_by_id = {row.get("id"): row for row in rows if row.get("id")}
    for invoice in invoices:
        if invoice.get("status") in INVALID_REGISTRATION_INVOICE_STATUSES:
            continue
        invoice_id = invoice.get("id")
        request_id = invoice.get("registration_request_id")
        request = request_by_id.get(request_id) or request_by_invoice_id.get(invoice_id)
        if not request or not invoice_id:
            continue
        # A link from another branch must never satisfy this request.  This is
        # defense in depth for admin reads and protects a future cross-branch
        # invoice import from changing queue state.
        request_branch = request.get("branch_id")
        if request_branch and invoice.get("branch_id") != request_branch:
            continue
        by_request_id[request["id"]] = invoice
    return by_request_id


async def _normalize_registration_request_rows(rows: list) -> list:
    """Normalize queue status from the authoritative invoice relationship.

    This is intentionally a safe read normalization: no historical document
    is mutated.  It fixes the old ``process -> prefill`` behavior where a
    request could say ``processed`` even though staff cancelled the invoice
    dialog or invoice creation failed.
    """
    links = await _registration_invoice_links(rows)
    normalized = []
    for source in rows:
        row = dict(source)
        request_id = row.get("id")
        invoice = links.get(request_id)
        raw_status = row.get("status") or "pending"
        if invoice:
            row["invoice_id"] = invoice.get("id")
            row["invoice_status"] = invoice.get("status") or "pending"
            # Archived is a user-controlled terminal view and must stay
            # archived even when an invoice was created afterwards.
            if raw_status not in {"archived", "rejected"}:
                row["status"] = "processed"
        elif raw_status == "processed":
            # Do not expose a stale processed state for an orphaned historical
            # request.  Leave archived/rejected untouched below.
            row.pop("invoice_id", None)
            row.pop("invoice_status", None)
            row["status"] = "pending"
        elif raw_status in {"pending", "archived", "rejected"}:
            row["status"] = raw_status
        if (
            raw_status == "archived"
            and row.get("archived_from") == "processed"
            and not invoice
        ):
            # Restoring a legacy processed-without-invoice archive must return
            # to Pending, not attempt the forbidden direct processed state.
            row["archived_from"] = "pending"
        normalized.append(row)
    return normalized


def _academy_name() -> str:
    """Public display name of the current tenant (resolved by middleware from
    X-Tenant-Slug / subdomain). Only the name is exposed on public pages."""
    t = get_current_tenant() or {}
    return t.get("name", "") or ""


# ---- Activities derived from the Levels day pages -------------------------
# The public form should offer the REAL activities the academy runs, exactly
# as they appear on the Levels/Schedule day pages. There, an activity has no
# stored id: it is the prefix of `level.activity_name`, stored as
# "<activity> - <time slot>". These tables/functions MIRROR the frontend
# parser in LevelsPage.js (parseActivityName / matchBuiltInActivityExact):
# keep them in sync or the form will show different activities than the app.

# A prefix is a built-in ONLY when it IS the sport name itself (exact match,
# after whitespace-normalization). Qualified names like "سباحه سيدات" are
# distinct custom activities and must stay their own choice.
_BUILTIN_EXACT_NAMES = {
    "swimming": ["سباحة", "سباحه", "السباحة", "السباحه", "swimming", "swim"],
    "football": ["كرة القدم", "كرة قدم", "كره القدم", "كره قدم", "القدم", "قدم", "football"],
    "karate": ["كاراتيه", "الكاراتيه", "كاراتية", "الكاراتية", "كارتيه", "الكارتيه", "karate"],
}
# Canonical display labels for the built-ins (what the Levels cards show).
_BUILTIN_DISPLAY = {
    "swimming": {"name_ar": "السباحة", "name": "Swimming"},
    "football": {"name_ar": "كرة القدم", "name": "Football"},
    "karate": {"name_ar": "الكاراتيه", "name": "Karate"},
}


def _match_builtin_exact(prefix: str):
    s = " ".join((prefix or "").strip().lower().split())
    for act_id, names in _BUILTIN_EXACT_NAMES.items():
        if s in names:
            return act_id
    return None


def _match_builtin_keyword(name: str):
    """Legacy matcher for separator-less names only (mirrors the frontend)."""
    s = (name or "").lower()
    if "سباح" in s or "swim" in s:
        return "swimming"
    if "قدم" in s or "foot" in s:
        return "football"
    if "كارات" in s or "karate" in s:
        return "karate"
    return None


def _activities_from_levels(activity_names) -> list:
    """Distinct activities (as shown on the Levels day pages) from raw
    level.activity_name values. Same shape the endpoint already returns for
    db.activities entries ({id, name, name_ar}) so the frontend needs no
    change. Separator-less legacy names only count via the keyword matcher
    (never promoted to a custom activity, e.g. a bare "الساعة 4")."""
    seen = set()
    out = []
    for raw in activity_names:
        nm = (raw or "").strip()
        if not nm:
            continue
        if " - " in nm:
            prefix = nm.split(" - ", 1)[0].strip()
            built_in = _match_builtin_exact(prefix)
            if built_in:
                key, disp = built_in, _BUILTIN_DISPLAY[built_in]
            elif prefix:
                key, disp = prefix, {"name_ar": prefix, "name": prefix}
            else:
                continue
        else:
            built_in = _match_builtin_keyword(nm)
            if not built_in:
                continue
            key, disp = built_in, _BUILTIN_DISPLAY[built_in]
        if key in seen:
            continue
        seen.add(key)
        out.append({"id": "", "name": disp["name"], "name_ar": disp["name_ar"]})
    out.sort(key=lambda a: a["name_ar"])
    return out

# ============ MODELS ============

class PublicRegistrationCreate(BaseModel):
    customer_name: str
    customer_phone: str
    age: int
    expected_start_date: str
    nationality: Optional[str] = ""
    activity_id: Optional[str] = ""
    activity_name: Optional[str] = ""
    preferred_days: List[str] = []
    preferred_time: Optional[str] = ""
    notes: Optional[str] = ""
    referral_code: Optional[str] = ""
    source: Optional[str] = ""

class RegistrationRequestUpdate(BaseModel):
    status: str


class RegistrationFollowupStop(BaseModel):
    reason: str


# ============ PUBLIC ROUTES (no auth) ============

@router.get("/public/branches")
async def public_list_branches():
    """Return all branches for the tenant so the public form can let the
    visitor pick a branch. Tenant is resolved by the middleware from the
    X-Tenant-Slug header / subdomain."""
    branches = await db.branches.find(
        {}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "public_name": 1, "phone": 1, "location_url": 1}
    ).to_list(500)
    # Only expose a public-facing label. When a branch has a custom public_name we
    # return it as the name so the internal branch name is never sent to the public
    # page; otherwise we fall back to the normal branch name.
    public_branches = []
    for b in branches:
        label = (b.get("public_name") or "").strip()
        public_branches.append({
            "id": b["id"],
            "name": label or b.get("name") or "",
            "name_ar": label or b.get("name_ar") or b.get("name") or "",
            "phone": (b.get("phone") or "").strip(),
            "location_url": _safe_location_url(b.get("location_url")),
        })
    return {"branches": public_branches, "academy_name": _academy_name()}


@router.get("/public/registration/{branch_id}")
async def public_get_registration_branch(branch_id: str):
    """Return the branch name and the activities available for that branch so
    the public form can present activity choices. Tenant is resolved by the
    middleware from the X-Tenant-Slug header / subdomain."""
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "public_name": 1, "phone": 1, "location_url": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    # Preferred source: the REAL activities the branch runs, exactly as they
    # appear on the Levels/Schedule day pages (derived from the branch's
    # levels). Branch-own levels win; shared/legacy (branch_id null/missing)
    # levels are the fallback pool — mirrors the per-branch rule below.
    level_rows = await db.levels.find(
        {
            "$or": [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": {"$exists": False}}],
            # Closed levels don't offer registration (missing field = active).
            "is_active": {"$ne": False},
        },
        {"_id": 0, "activity_name": 1, "branch_id": 1},
    ).to_list(3000)
    own_rows = [r for r in level_rows if (r.get("branch_id") or "") == branch_id]
    pool = own_rows if own_rows else [r for r in level_rows if not (r.get("branch_id") or "")]
    activities = _activities_from_levels(r.get("activity_name") for r in pool)

    if not activities:
        # Fallback (branch has no levels yet): the activities collection.
        # Branch-scoped + shared/legacy (branch_id null/missing); when the
        # branch has activities of its own show ONLY those. Only names are
        # exposed to the public page (no fees or internal data).
        acts = await db.activities.find(
            {
                "$or": [{"branch_id": branch_id}, {"branch_id": None}, {"branch_id": {"$exists": False}}],
                "is_active": {"$ne": False},
            },
            {"_id": 0, "id": 1, "name": 1, "name_ar": 1, "branch_id": 1},
        ).to_list(200)
        branch_own = [a for a in acts if (a.get("branch_id") or "") == branch_id]
        activities = branch_own if branch_own else [a for a in acts if not (a.get("branch_id") or "")]
        for a in activities:
            a.pop("branch_id", None)

    # Expose only the public-facing label so the internal branch name is never
    # sent to the public page; fall back to the normal name when no public_name.
    _label = (branch.get("public_name") or "").strip()
    return {
        "branch": {
            "id": branch["id"],
            "name": _label or branch.get("name", ""),
            "name_ar": _label or branch.get("name_ar", "") or branch.get("name", ""),
            "phone": (branch.get("phone") or "").strip(),
            "location_url": _safe_location_url(branch.get("location_url")),
        },
        "activities": activities,
        "academy_name": _academy_name(),
    }


@router.post("/public/registration/{branch_id}")
async def public_create_registration(branch_id: str, payload: PublicRegistrationCreate):
    """Public submission -> pending review request. No member is created."""
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0, "id": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    name = (payload.customer_name or "").strip()
    phone = (payload.customer_phone or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="الاسم مطلوب")
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) < 8:
        raise HTTPException(status_code=400, detail="رقم الموبايل غير صحيح")
    nationality = (payload.nationality or "").strip()
    if not nationality:
        raise HTTPException(status_code=400, detail="الجنسية مطلوبة")
    if payload.age < 1 or payload.age > 100:
        raise HTTPException(status_code=400, detail="العمر يجب أن يكون بين سنة و100 سنة")
    try:
        datetime.strptime(payload.expected_start_date, "%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="تاريخ البداية المتوقع مطلوب وغير صحيح")

    # Light anti-spam: cap repeated submissions from the same phone+branch.
    one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    recent = await db.registration_requests.count_documents({
        "branch_id": branch_id,
        "customer_phone": phone,
        "age": payload.age,
        "expected_start_date": payload.expected_start_date,
        "created_at": {"$gte": one_hour_ago},
    })
    if recent >= 3:
        raise HTTPException(status_code=429, detail="تم استلام طلبك بالفعل. برجاء الانتظار قبل إرسال طلب جديد.")

    from services import registration_followups
    followup_fields = await registration_followups.enrollment_fields_for_new(
        branch_id, phone
    )
    doc = {
        "id": str(uuid.uuid4()),
        "customer_name": name,
        "customer_phone": phone,
        "age": payload.age,
        "nationality": nationality,
        "activity_id": (payload.activity_id or "").strip(),
        "activity_name": (payload.activity_name or "").strip(),
        "preferred_days": [d for d in (payload.preferred_days or []) if d],
        "preferred_time": (payload.preferred_time or "").strip(),
        "notes": (payload.notes or "").strip(),
        "branch_id": branch_id,
        "status": "pending",
        # Track where the request came from. "social_ad" = the all-branches
        # link shared in social-media ads; anything else falls back to the
        # normal public link so we never store arbitrary client-supplied values.
        "source": "social_ad" if (payload.source or "").strip().lower() in ("social", "social_ad") else "public_link",
        "created_at": datetime.now(timezone.utc).isoformat(),
        **followup_fields,
    }

    # Marketer (affiliate) referral: attach the marketer if the link carried a
    # valid, active referral code so the supervisor sees it and the discount +
    # commission flow through to the first invoice.
    ref_code = (payload.referral_code or "").strip()
    if ref_code:
        marketer = await db.marketers.find_one(
            {"referral_code": ref_code, "status": {"$ne": "inactive"}},
            {"_id": 0, "id": 1, "name": 1, "discount_percent": 1, "commission_percent": 1, "branch_id": 1, "branch_ids": 1},
        )
        # Only attach if the marketer belongs to this branch or is shared
        # (no branch restriction). Prevents cross-branch referral attribution.
        m_branch_ids = (marketer or {}).get("branch_ids") or []
        m_branch = (marketer or {}).get("branch_id")
        if m_branch_ids:
            branch_ok = branch_id in m_branch_ids
        else:
            branch_ok = (not m_branch) or (m_branch == branch_id)
        if marketer and branch_ok:
            doc["marketer_id"] = marketer["id"]
            doc["referral_code"] = ref_code
            doc["marketer_name"] = marketer.get("name", "")
            doc["marketer_discount_percent"] = marketer.get("discount_percent", 0)
            doc["marketer_commission_percent"] = marketer.get("commission_percent", 0)

    await db.registration_requests.insert_one(doc)

    # Notify admins (branch-scoped) that a new self-registration request arrived.
    # Best-effort: a push failure must never break the public submission.
    try:
        from routes.push_notifications import send_push_to_admins, NotificationPayload
        activity_txt = doc["activity_name"] or "بدون نشاط محدد"
        payload = NotificationPayload(
            title="طلب تسجيل جديد",
            body=f"{name} — {activity_txt}",
            url="/admin/registration-requests",
            tag="registration-request",
            title_en="New registration request",
            body_en=f"{name} — {doc['activity_name'] or 'no activity'}",
        )
        await send_push_to_admins(payload, branch_id=branch_id)
    except Exception:
        pass

    return {"success": True, "message": "تم استلام طلب التسجيل بنجاح"}


# ============ ADMIN ROUTES (auth + branch scope) ============

@router.get("/registration-requests/count")
async def count_pending_registration_requests(
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Lightweight count of pending requests for the sidebar badge."""
    # Historical rows may still say "processed" even though the old
    # prefill-only flow never produced an invoice.  Include both candidate
    # states, then apply the same authoritative read normalization as the list
    # endpoint.  This deliberately performs no data migration.
    query: dict = {"status": {"$in": ["pending", "processed"]}}
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch
    rows = await db.registration_requests.find(query, {"_id": 0}).to_list(2000)
    normalized = await _normalize_registration_request_rows(rows)
    count = sum(1 for row in normalized if row.get("status") == "pending")
    return {"count": count}


@router.get("/registration-requests")
async def list_registration_requests(
    branch_filter: Optional[str] = None,
    status: Optional[str] = "pending",
    current_user: dict = Depends(get_current_user),
    search: Optional[str] = None,
):
    query: dict = {}
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    if effective_branch:
        query["branch_id"] = effective_branch
    followed_evidence = {}
    if status == "followed_up":
        followed_evidence = await _followed_up_evidence(
            {"branch_id": effective_branch} if effective_branch else {}
        )
        # This intentionally does not constrain request status.  A follow-up
        # can be recorded while pending and the request can later be
        # processed, rejected, or archived; all such rows belong in this
        # history tab.
        query["id"] = {"$in": list(followed_evidence)}
    elif status and status != "all":
        if status in {"pending", "processed"}:
            # The status filter is applied after read normalization so an old
            # processed-without-invoice row appears in Pending.
            query["status"] = {"$in": ["pending", "processed"]}
        else:
            query["status"] = status
    elif status == "all":
        # "الكل" tab shows active requests only; archived ones live in their own tab
        # and historical processed-without-invoice rows are normalized below.
        query["status"] = {"$in": ["pending", "processed", "rejected"]}

    _search_registration_requests(query, search)
    requests = await db.registration_requests.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    requests = await _normalize_registration_request_rows(requests)
    if status and status != "all" and status != "followed_up":
        requests = [request for request in requests if request.get("status") == status]
    elif status == "all":
        requests = [request for request in requests if request.get("status") != "archived"]
    if followed_evidence:
        for request in requests:
            _attach_followed_evidence(request, followed_evidence)
    return await _sanitize_registration_requests(requests, current_user)


@router.put("/registration-requests/{req_id}")
async def update_registration_request(
    req_id: str,
    payload: RegistrationRequestUpdate,
    current_user: dict = Depends(get_current_user),
):
    allowed_statuses = {"pending", "processed", "rejected", "archived"}
    if payload.status not in allowed_statuses:
        raise HTTPException(status_code=400, detail="حالة غير صحيحة")

    req = await db.registration_requests.find_one(
        {"id": req_id}, {"_id": 0, "id": 1, "branch_id": 1, "customer_phone": 1,
                         "status": 1, "archived_from": 1, "invoice_id": 1}
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    scope = require_branch_scope(current_user)
    if scope and req.get("branch_id") != scope:
        raise HTTPException(status_code=403, detail="غير مصرح لك بهذا الطلب")

    if payload.status == "processed":
        if req.get("status") == "archived":
            raise HTTPException(
                status_code=409,
                detail="الطلب مؤرشف؛ أعده من الأرشيف أولاً",
            )
        linked = await _registration_invoice_links([req])
        if req_id not in linked:
            raise HTTPException(
                status_code=409,
                detail="لا يمكن إنهاء الطلب قبل إنشاء فاتورة مرتبطة به",
            )

    update: dict = {"status": payload.status}
    if payload.status == "archived":
        # Remember what it was so restoring puts it back in the right tab.
        if req.get("status") != "archived":
            update["archived_from"] = req.get("status") or "pending"
        update["archived_at"] = datetime.now(timezone.utc).isoformat()
    await db.registration_requests.update_one({"id": req_id}, {"$set": update})
    if payload.status in {"processed", "rejected", "archived"}:
        from services import registration_followups
        await registration_followups.stop_request(req, "request_closed")
    return {"success": True}


@router.post("/registration-requests/{req_id}/followup-stop")
async def stop_registration_followup(
    req_id: str,
    payload: RegistrationFollowupStop,
    current_user: dict = Depends(get_current_user),
):
    if payload.reason not in {"contacted", "opted_out"}:
        raise HTTPException(status_code=400, detail="Invalid follow-up stop reason")
    req = await db.registration_requests.find_one({"id": req_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    scope = require_branch_scope(current_user)
    if scope and req.get("branch_id") != scope:
        raise HTTPException(status_code=403, detail="غير مصرح لك بهذا الطلب")
    from services import registration_followups
    await registration_followups.stop_request(req, payload.reason)
    updated = await db.registration_requests.find_one({"id": req_id}, {"_id": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Request not found")
    sanitized = await _sanitize_registration_requests([updated], current_user)
    return sanitized[0]


@router.delete("/registration-requests/{req_id}")
async def delete_registration_request(
    req_id: str,
    current_user: dict = Depends(get_current_user),
):
    req = await db.registration_requests.find_one(
        {"id": req_id}, {"_id": 0, "id": 1, "branch_id": 1, "customer_phone": 1})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    scope = require_branch_scope(current_user)
    if scope and req.get("branch_id") != scope:
        raise HTTPException(status_code=403, detail="غير مصرح لك بهذا الطلب")

    from services import registration_followups
    await registration_followups.stop_request(req, "request_deleted")
    await db.registration_requests.delete_one({"id": req_id})
    return {"success": True}
