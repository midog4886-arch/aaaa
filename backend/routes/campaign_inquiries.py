"""Campaign-inquiry CRM routes.

The CRM/import paths remain manual-only.  Explicit automation preview and
confirmation paths delegate to the separate campaign-inquiry automation
service; imports never enroll contacts or enqueue provider work.
"""

from datetime import datetime, timezone
import hashlib
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from .common import db, get_current_user
from .registration_requests import _mask_phone
from utils.auth import (
    require_branch_scope,
    resolve_branch_filter,
    require_permission,
)
from utils.phone import normalize_phone
from services import campaign_inquiry_automation


router = APIRouter(prefix="/campaign-inquiries", tags=["CampaignInquiries"])

# Reuse the academy's existing messages permission; campaign inquiries are
# surfaced beside the manual messaging workspace and must not introduce a new
# permission that existing staff accounts cannot possess.
PERMISSION_KEY = "messages"
PHONE_PERMISSION = "member-phones"
MAX_PASTED_LINES = 500
MAX_LIST_ITEMS = 500
MAX_HISTORY = 100

ALLOWED_STATUSES = {
    "new",
    "waiting",
    "interested",
    "visit",
    "invoiced",
    "paid",
    "not_interested",
    "do_not_contact",
}
TERMINAL_STATUSES = {"invoiced", "paid", "not_interested", "do_not_contact"}
INVOICE_INVALID_STATUSES = {"cancelled", "canceled", "failed", "error", "void"}
INVOICE_DELETED_STATUSES = {"deleted", "archived"}
INVOICE_LINK_NOT_FOUND_ERROR = "Linked invoice was not found in this branch or was deleted"
INVOICE_LINK_BRANCH_ERROR = "Linked invoice belongs to another branch"
INVOICE_LINK_MISSING_ERROR = (
    "This inquiry has no linked invoice and cannot be marked invoiced or paid"
)
RIYADH_TZ = ZoneInfo("Asia/Riyadh")

# These limits keep accidental pastes and unbounded history from turning the
# tenant collection into an arbitrary document store.
MAX_NAME = 200
MAX_PHONE = 80
MAX_SHORT_TEXT = 200
MAX_AGE = 40
MAX_NOTES = 4000
MAX_PHONE_TEXT = 120000


class CampaignInquiryCreate(BaseModel):
    branch_id: str = Field(..., min_length=1, max_length=100)
    name: str = Field(default="", max_length=MAX_NAME)
    phone: str = Field(..., min_length=1, max_length=MAX_PHONE)
    source: str = Field(default="", max_length=MAX_SHORT_TEXT)
    campaign: str = Field(default="", max_length=MAX_SHORT_TEXT)
    activity: str = Field(default="", max_length=MAX_SHORT_TEXT)
    age: Optional[str] = Field(default=None, max_length=MAX_AGE)
    assigned_to: Optional[str] = Field(default=None, max_length=MAX_SHORT_TEXT)
    notes: Optional[str] = Field(default=None, max_length=MAX_NOTES)
    status: str = Field(default="new", max_length=32)
    followup_due_at: Optional[str] = None
    last_contact_at: Optional[str] = None
    invoice_id: Optional[str] = Field(default=None, max_length=200)


class CampaignInquiryImport(BaseModel):
    branch_id: str = Field(..., min_length=1, max_length=100)
    phones: str = Field(..., min_length=1, max_length=MAX_PHONE_TEXT)
    source: str = Field(default="", max_length=MAX_SHORT_TEXT)
    campaign: str = Field(default="", max_length=MAX_SHORT_TEXT)
    activity: str = Field(default="", max_length=MAX_SHORT_TEXT)


class CampaignInquiryPreview(BaseModel):
    branch_id: str = Field(..., min_length=1, max_length=100)
    phones: str = Field(..., min_length=1, max_length=MAX_PHONE_TEXT)


class CampaignInquiryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=MAX_NAME)
    phone: Optional[str] = Field(default=None, max_length=MAX_PHONE)
    source: Optional[str] = Field(default=None, max_length=MAX_SHORT_TEXT)
    campaign: Optional[str] = Field(default=None, max_length=MAX_SHORT_TEXT)
    activity: Optional[str] = Field(default=None, max_length=MAX_SHORT_TEXT)
    age: Optional[str] = Field(default=None, max_length=MAX_AGE)
    assigned_to: Optional[str] = Field(default=None, max_length=MAX_SHORT_TEXT)
    notes: Optional[str] = Field(default=None, max_length=MAX_NOTES)
    status: Optional[str] = Field(default=None, max_length=32)
    followup_due_at: Optional[str] = None
    last_contact_at: Optional[str] = None
    invoice_id: Optional[str] = Field(default=None, max_length=200)


class CampaignAutomationPreview(BaseModel):
    branch_id: str = Field(..., min_length=1, max_length=100)
    inquiry_ids: list[str] = Field(..., min_length=1, max_length=100)
    mode: str = Field(..., pattern="^(direct|followup)$")
    message: str = Field(default="", max_length=2000)
    first_message: str = Field(default="", max_length=2000)
    second_message: str = Field(default="", max_length=2000)


class CampaignAutomationConfirm(BaseModel):
    branch_id: str = Field(..., min_length=1, max_length=100)
    preview_id: str = Field(..., min_length=1, max_length=200)


class CampaignAutomationSettingsPatch(BaseModel):
    branch_id: str = Field(..., min_length=1, max_length=100)
    paused: Optional[bool] = None
    start_hour: Optional[int] = Field(default=None, ge=0, le=23)
    end_hour: Optional[int] = Field(default=None, ge=1, le=24)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value, *, allow_none=True) -> Optional[str]:
    if value is None and allow_none:
        return None
    return str(value or "").strip()


def _inquiry_id(branch_id: str, phone: str) -> str:
    """Stable identity for one branch and one normalized phone."""
    digest = hashlib.sha256(f"{branch_id}\x00{phone}".encode("utf-8")).hexdigest()
    return f"ci_{digest}"


def _validate_status(status: Optional[str]) -> str:
    status = (status or "new").strip()
    if status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid campaign inquiry status")
    return status


def _validate_iso(value: Optional[str], field_name: str) -> Optional[str]:
    if value in (None, ""):
        return None
    value = str(value).strip()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field_name} must be an ISO timestamp")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return value


def _parse_phone(raw: Optional[str]) -> str:
    # normalize_phone handles Arabic-Indic and Eastern Arabic digits, country
    # local forms, separators, and international +/00 prefixes.
    raw = str(raw or "").strip()
    if len(raw) > MAX_PHONE:
        return ""
    return normalize_phone(raw)


def _split_phone_lines(text: str) -> list[tuple[int, str]]:
    lines = str(text or "").splitlines()
    if len(lines) > MAX_PASTED_LINES:
        raise HTTPException(
            status_code=400,
            detail=f"No more than {MAX_PASTED_LINES} phone lines are allowed",
        )
    return [(number, line.strip()) for number, line in enumerate(lines, start=1)]


async def _require_campaign_access(current_user: dict):
    await require_permission(current_user, PERMISSION_KEY)


async def _require_phone_access(current_user: dict):
    await require_permission(current_user, PHONE_PERMISSION)


async def _branch_for_write(branch_id: str, current_user: dict) -> str:
    """Require an explicit, existing branch and enforce the caller scope."""
    branch_id = (branch_id or "").strip()
    if not branch_id:
        raise HTTPException(status_code=400, detail="branch_id is required")

    # Passing the explicit target is important for multi-branch users: the
    # resolver validates it against their allowed set instead of silently
    # falling back to the active branch.
    effective = require_branch_scope(current_user, branch_id)
    if effective and effective != branch_id:
        raise HTTPException(status_code=403, detail="No access to this branch")

    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0, "id": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return branch_id


def _base_document(
    *,
    branch_id: str,
    phone: str,
    name: str = "",
    source: str = "",
    campaign: str = "",
    activity: str = "",
    age: Optional[str] = None,
    assigned_to: Optional[str] = None,
    notes: Optional[str] = None,
    status: str = "new",
    followup_due_at: Optional[str] = None,
    last_contact_at: Optional[str] = None,
    invoice_id: Optional[str] = None,
) -> dict:
    status = _validate_status(status)
    if status in TERMINAL_STATUSES:
        followup_due_at = None
    now = _now()
    return {
        "_id": _inquiry_id(branch_id, phone),
        "id": _inquiry_id(branch_id, phone),
        "branch_id": branch_id,
        "name": _clean_text(name, allow_none=False),
        "phone": phone,
        "source": _clean_text(source, allow_none=False),
        "campaign": _clean_text(campaign, allow_none=False),
        "activity": _clean_text(activity, allow_none=False),
        "age": _clean_text(age),
        "assigned_to": _clean_text(assigned_to),
        "notes": _clean_text(notes),
        "status": status,
        "followup_due_at": followup_due_at,
        "last_contact_at": last_contact_at,
        "invoice_id": invoice_id,
        "created_at": now,
        "updated_at": now,
        "history": [],
    }


async def _invoice_for_inquiry(
    invoice_id: Optional[str],
    branch_id: str,
    *,
    required_status: Optional[str] = None,
) -> Optional[dict]:
    if not invoice_id:
        if required_status in {"invoiced", "paid"}:
            raise HTTPException(
                status_code=400,
                detail=f"{required_status} inquiries require invoice_id",
            )
        return None
    requested = str(invoice_id).strip()
    # The UI displays invoice_number, while older clients submit the UUID.
    # Resolve both as exact values, but only inside the target branch.  The
    # invoice-number index is not necessarily unique for legacy data, so do
    # not silently select one of several exact matches.
    candidates = await db.invoices.find(
        {
            "branch_id": branch_id,
            "$or": [
                {"id": requested},
                {"invoice_number": requested},
            ],
        },
        {"_id": 0, "id": 1, "branch_id": 1, "status": 1, "invoice_number": 1},
    ).to_list(20)
    unique_candidates = {}
    for candidate in candidates:
        candidate_id = candidate.get("id")
        if candidate_id:
            unique_candidates[candidate_id] = candidate
    candidates = list(unique_candidates.values())
    if not candidates:
        raise HTTPException(
            status_code=400,
            detail="Invoice not found in this branch",
        )
    if len(candidates) > 1:
        raise HTTPException(
            status_code=400,
            detail="Invoice number matches multiple invoices in this branch",
        )
    invoice = candidates[0]
    invoice_status = str(invoice.get("status") or "").lower()
    if invoice_status in INVOICE_INVALID_STATUSES | INVOICE_DELETED_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="The linked invoice is cancelled or invalid",
        )
    if required_status == "paid" and invoice_status != "paid":
        raise HTTPException(
            status_code=400,
            detail="A paid inquiry requires a paid invoice",
        )
    return invoice


async def _atomic_create(document: dict) -> bool:
    """Create once without ever overwriting the existing inquiry.

    ``$setOnInsert`` is atomic in MongoDB.  The deterministic ``_id`` also
    makes concurrent imports converge even before the compound branch/phone
    index is present; the index is declared in db_indexes.py for the normal
    deployment path.
    """
    branch_id = document["branch_id"]
    phone = document["phone"]
    # Fast duplicate path for legacy rows (which may not have the deterministic
    # application id yet).  The write below remains the concurrency guard.
    if await _phone_already_exists(branch_id, phone):
        return False
    try:
        result = await db.campaign_inquiries.update_one(
            {
                "_id": document["_id"],
                "branch_id": branch_id,
                "phone": phone,
            },
            {"$setOnInsert": document},
            upsert=True,
        )
    except DuplicateKeyError:
        return False
    except Exception:
        # The Atlas Data API currently surfaces duplicate-key responses as a
        # generic exception.  If the competing insert is now visible, this
        # was a deterministic dedupe race; otherwise preserve the real error.
        if await _phone_already_exists(branch_id, phone):
            return False
        raise

    if getattr(result, "upserted_id", None) is not None:
        return True
    if getattr(result, "matched_count", 0):
        return False

    # A small number of test fakes and older HTTP proxies do not report
    # upserted_id.  Confirm the durable row before making a compatibility
    # insert; this fallback still never updates an existing row.
    existing = await db.campaign_inquiries.find_one(
        {"branch_id": branch_id, "phone": phone},
        {"_id": 1, "id": 1},
    )
    if existing:
        # Some small HTTP/fake collection implementations omit upserted_id.
        # The deterministic _id proves this operation inserted the row; an
        # older row with a different identity is still a duplicate.
        return existing.get("_id") == document["_id"] and (
            existing.get("id") in (None, document["id"])
        )
    try:
        await db.campaign_inquiries.insert_one(document)
        return True
    except DuplicateKeyError:
        return False
    except Exception:
        if await _phone_already_exists(branch_id, phone):
            return False
        raise


async def _phone_already_exists(branch_id: str, phone: str) -> bool:
    return bool(
        await db.campaign_inquiries.find_one(
            {"branch_id": branch_id, "phone": phone},
            {"_id": 0, "id": 1},
        )
    )


def _preview_reason(raw: str) -> str:
    if not raw:
        return "empty_phone"
    return "invalid_phone"


async def _preview_rows(branch_id: str, text: str) -> dict:
    rows = []
    seen: set[str] = set()
    valid_count = duplicate_count = invalid_count = 0
    for line_number, raw in _split_phone_lines(text):
        phone = _parse_phone(raw)
        if not phone:
            rows.append({
                "line": line_number,
                "phone": raw,
                "status": "invalid",
                "reason": _preview_reason(raw),
            })
            invalid_count += 1
            continue
        if phone in seen or await _phone_already_exists(branch_id, phone):
            reason = "duplicate_in_input" if phone in seen else "already_exists"
            rows.append({
                "line": line_number,
                "phone": phone,
                "status": "duplicate",
                "reason": reason,
            })
            duplicate_count += 1
            continue
        seen.add(phone)
        rows.append({
            "line": line_number,
            "phone": phone,
            "status": "valid",
            "reason": None,
        })
        valid_count += 1
    return {
        "rows": rows,
        "valid_count": valid_count,
        "invalid_count": invalid_count,
        "duplicate_count": duplicate_count,
    }


def _clean_row(row: dict) -> dict:
    result = {key: value for key, value in dict(row).items() if key != "_id"}
    if "history" in result and not isinstance(result["history"], list):
        result["history"] = []
    return result


def _parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)


def _is_overdue(row: dict, now: Optional[datetime] = None) -> bool:
    """Return whether a non-terminal follow-up is past its exact due time."""
    if row.get("status") in TERMINAL_STATUSES:
        return False
    due = _parse_timestamp(row.get("followup_due_at"))
    if due is None:
        return False
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None or current.utcoffset() is None:
        current = current.replace(tzinfo=timezone.utc)
    return due < current


def _is_due(row: dict, now: Optional[datetime] = None) -> bool:
    if row.get("status") in TERMINAL_STATUSES:
        return False
    due = _parse_timestamp(row.get("followup_due_at"))
    if due is None:
        return False
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None or current.utcoffset() is None:
        current = current.replace(tzinfo=timezone.utc)
    # "Due today" is a Saudi-calendar concept in the UI: overdue follow-ups
    # remain due, and anything through 23:59:59.999999 Riyadh time is due.
    end_of_day = current.astimezone(RIYADH_TZ).replace(
        hour=23,
        minute=59,
        second=59,
        microsecond=999999,
    )
    return due.astimezone(RIYADH_TZ) <= end_of_day


async def _enrich_invoice_status(rows: list[dict]) -> list[dict]:
    """Read invoice state by explicit link only; never match by phone."""
    invoice_ids = list(dict.fromkeys(
        row.get("invoice_id") for row in rows if row.get("invoice_id")
    ))
    invoices = []
    if invoice_ids:
        invoices = await db.invoices.find(
            {"id": {"$in": invoice_ids}},
            {
                "_id": 0,
                "id": 1,
                "branch_id": 1,
                "status": 1,
                "invoice_number": 1,
                "total": 1,
                "total_amount": 1,
                "grand_total": 1,
                "final_total": 1,
                "amount": 1,
            },
        ).to_list(len(invoice_ids))
    by_id = {}
    for invoice in invoices:
        if invoice.get("id"):
            by_id.setdefault(invoice["id"], []).append(invoice)
    for row in rows:
        row["status"] = row.get("status") or "new"
        invoice_id = row.get("invoice_id")
        if not invoice_id:
            row.pop("invoice_status", None)
            row["invoice_number"] = None
            if row["status"] in {"invoiced", "paid"}:
                row["status"] = "interested"
                row["invoice_link_error"] = INVOICE_LINK_MISSING_ERROR
            else:
                row.pop("invoice_link_error", None)
            continue
        linked = by_id.get(invoice_id) or []
        invoice = next(
            (candidate for candidate in linked
             if candidate.get("branch_id") == row.get("branch_id")),
            None,
        )
        if not invoice:
            row["invoice_status"] = None
            row["invoice_number"] = None
            row["status"] = "interested"
            row["invoice_link_error"] = (
                INVOICE_LINK_BRANCH_ERROR
                if linked
                else INVOICE_LINK_NOT_FOUND_ERROR
            )
            continue
        invoice_status = str(invoice.get("status") or "").lower()
        row["invoice_status"] = invoice_status or None
        row["invoice_number"] = invoice.get("invoice_number")
        for amount_key in (
            "total",
            "total_amount",
            "grand_total",
            "final_total",
            "amount",
        ):
            if invoice.get(amount_key) is not None:
                row["invoice_total"] = invoice.get(amount_key)
                break
        if invoice_status in INVOICE_INVALID_STATUSES | INVOICE_DELETED_STATUSES:
            row["status"] = "interested"
            row["invoice_link_error"] = (
                f"Linked invoice is {invoice_status or 'invalid'} and cannot "
                "support an invoiced or paid inquiry"
            )
            continue
        if not invoice_status:
            row["status"] = "interested"
            row["invoice_link_error"] = (
                "Linked invoice has no usable status and cannot support "
                "an invoiced or paid inquiry"
            )
            continue
        row.pop("invoice_link_error", None)
        if invoice_status == "paid":
            row["status"] = "paid"
        else:
            row["status"] = "invoiced"
    return rows


async def _sanitize_rows(rows: list[dict], current_user: dict) -> list[dict]:
    # Keep the same tenant-user permission check as the member/registration
    # routes, but use this module's db handle so isolated unit tests and any
    # future route-level DB wiring cannot accidentally consult another handle.
    can_view = bool(
        current_user.get("is_admin", False)
        or PHONE_PERMISSION in (current_user.get("permissions") or [])
    )
    if not can_view and current_user.get("user_id"):
        user_doc = await db.users.find_one(
            {"id": current_user["user_id"]},
            {"_id": 0, "permissions": 1},
        )
        can_view = PHONE_PERMISSION in ((user_doc or {}).get("permissions") or [])
    output = []
    for original in rows:
        row = _clean_row(original)
        if not can_view:
            row["phone"] = _mask_phone(row.get("phone"))
            row["phone_masked"] = True
        output.append(row)
    return output


def _matches_search(row: dict, search: Optional[str]) -> bool:
    search = str(search or "").strip().casefold()
    if not search:
        return True
    fields = (
        row.get("name"),
        row.get("source"),
        row.get("campaign"),
        row.get("activity"),
        row.get("age"),
        row.get("assigned_to"),
        row.get("notes"),
        row.get("phone"),
    )
    if any(search in str(value or "").casefold() for value in fields):
        return True
    normalized = _parse_phone(search)
    return bool(normalized and normalized == row.get("phone"))


def _sort_key(row: dict, now: Optional[datetime] = None):
    """Prioritize actionable work before applying the response page bound.

    An overdue follow-up is more urgent than a never-contacted inquiry.  A
    terminal record is deliberately treated as ordinary even if legacy data
    contains an old due date or no contact timestamp.
    """
    if _is_overdue(row, now):
        priority = 0
    elif (
        row.get("status") not in TERMINAL_STATUSES
        and not row.get("last_contact_at")
    ):
        priority = 1
    else:
        priority = 2
    created = _parse_timestamp(row.get("created_at"))
    created_timestamp = created.timestamp() if created else 0
    return (priority, -created_timestamp)


def _numeric_amount(value) -> float:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return 0.0
    return amount if amount == amount else 0.0


@router.get("")
async def list_campaign_inquiries(
    branch_filter: Optional[str] = None,
    status: Optional[str] = None,
    due_only: bool = False,
    search: Optional[str] = None,
    campaign_exact: Optional[str] = None,
    campaign: Optional[str] = None,
    campaign_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    await _require_campaign_access(current_user)
    effective_branch = resolve_branch_filter(current_user, branch_filter)
    query = {"branch_id": effective_branch} if effective_branch else {}
    # Read all matching rows so totals and status counts are not silently
    # capped at the public page size.  The response still bounds ``items`` to
    # keep a single CRM response manageable.
    stored_rows = await db.campaign_inquiries.find(query, {"_id": 0}).to_list(None)
    branch_rows = [
        _clean_row(row)
        for row in stored_rows
        if not row.get("archived_at") and not row.get("archived")
    ]
    available_campaigns = sorted({
        str(row.get("campaign") or "").strip()
        for row in branch_rows
        if str(row.get("campaign") or "").strip()
    }, key=str.casefold)
    rows = [row for row in branch_rows if _matches_search(row, search)]
    rows = await _enrich_invoice_status(rows)
    selected_campaign = (
        str(
            campaign_exact
            if campaign_exact is not None
            else campaign if campaign is not None else campaign_filter or ""
        ).strip()
    )
    if selected_campaign:
        rows = [row for row in rows if row.get("campaign") == selected_campaign]
    rows.sort(key=_sort_key)

    counts = {key: 0 for key in (
        "total",
        "new",
        "waiting",
        "interested",
        "visit",
        "invoiced",
        "paid",
        "not_interested",
        "do_not_contact",
        "due",
    )}
    counts["total"] = len(rows)
    for row in rows:
        row_status = row.get("status")
        if row_status in ALLOWED_STATUSES:
            counts[row_status] += 1
        if _is_due(row):
            counts["due"] += 1

    paid_rows = [row for row in rows if row.get("status") == "paid"]
    paid_amount = sum(_numeric_amount(row.get("invoice_total")) for row in paid_rows)
    paid_stats = {
        "count": len(paid_rows),
        "amount": paid_amount,
    }

    if status and status != "all":
        _validate_status(status)
        filtered = [row for row in rows if row.get("status") == status]
    else:
        filtered = rows
    if due_only:
        filtered = [row for row in filtered if _is_due(row)]

    bounded = filtered[:MAX_LIST_ITEMS]
    sanitized = await _sanitize_rows(bounded, current_user)
    return {
        "items": sanitized,
        "counts": counts,
        "campaigns": available_campaigns,
        "selected_campaign": selected_campaign or None,
        "paid_stats": paid_stats,
        # Keep the aggregate shape explicit for clients that want to render a
        # compact campaign summary without interpreting status counts.
        "stats": {
            "total": len(rows),
            "paid_count": paid_stats["count"],
            "paid_amount": paid_stats["amount"],
        },
        "total": len(filtered),
        "returned": len(sanitized),
        "has_more": len(filtered) > len(sanitized),
    }


def _ensure_automation_service():
    """Bind the service to the route's tenant-local DB (also test doubles)."""
    if campaign_inquiry_automation._db is db:
        return
    async def branch_config(branch_id):
        return await db["whatsapp_branch_configs"].find_one(
            {"branch_id": branch_id}, {"_id": 0}
        )

    campaign_inquiry_automation.configure(db, branch_config)


async def _require_automation_access(current_user: dict):
    await _require_campaign_access(current_user)


async def _require_automation_branch(branch_id: str, current_user: dict) -> str:
    return await _branch_for_write(branch_id, current_user)


@router.get("/automation/settings")
async def get_campaign_automation_settings(
    branch_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return branch availability and the bounded Riyadh sending window."""
    await _require_automation_access(current_user)
    branch_id = await _require_automation_branch(branch_id, current_user)
    _ensure_automation_service()
    return await campaign_inquiry_automation.get_settings(branch_id)


@router.patch("/automation/settings")
async def patch_campaign_automation_settings(
    payload: CampaignAutomationSettingsPatch,
    current_user: dict = Depends(get_current_user),
):
    await _require_automation_access(current_user)
    branch_id = await _require_automation_branch(payload.branch_id, current_user)
    _ensure_automation_service()
    try:
        return await campaign_inquiry_automation.update_settings(
            branch_id,
            paused=payload.paused,
            start_hour=payload.start_hour,
            end_hour=payload.end_hour,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/automation/status")
async def get_campaign_automation_status(
    branch_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _require_automation_access(current_user)
    branch_id = await _require_automation_branch(branch_id, current_user)
    _ensure_automation_service()
    rows = await db.campaign_inquiries.find(
        {"branch_id": branch_id}, {"_id": 0}
    ).to_list(None)
    job_items = await db.whatsapp_campaign_job_items.find(
        {"branch_id": branch_id}, {"_id": 0}
    ).to_list(None)
    jobs = {}
    for item in job_items:
        inquiry_id = (item.get("source_metadata") or {}).get("inquiry_id")
        if inquiry_id:
            previous = jobs.get(inquiry_id)
            sequence = int((item.get("source_metadata") or {}).get("sequence") or 0)
            old_sequence = int(
                ((previous or {}).get("source_metadata") or {}).get("sequence") or 0
            )
            if previous is None or sequence >= old_sequence:
                jobs[inquiry_id] = item
    job_ids = {
        item.get("job_id")
        for item in jobs.values()
        if item.get("job_id")
    }
    if job_ids:
        job_rows = await db.whatsapp_campaign_jobs.find(
            {"branch_id": branch_id}, {"_id": 0}
        ).to_list(None)
        jobs_by_id = {row.get("id"): row for row in job_rows}
    else:
        jobs_by_id = {}
    items = []
    for row in rows:
        inquiry_id = row.get("id")
        item = jobs.get(inquiry_id) or {}
        parent = jobs_by_id.get(item.get("job_id")) or {}
        item_status = item.get("status")
        delivery = (
            item.get("delivery_status")
            or item.get("receipt_status")
            or (
                "accepted"
                if item_status == "sent"
                else "unknown"
                if item_status == "unknown"
                else item_status
            )
        )
        items.append(
            {
                "inquiry_id": inquiry_id,
                "status": row.get("automation_status") or "not_enrolled",
                "stop_reason": row.get("automation_stop_reason"),
                "next_due_at": row.get("automation_next_due_at"),
                "job_status": item_status or parent.get("status"),
                "delivery_status": delivery,
            }
        )
    return {
        "items": items,
        "settings": await campaign_inquiry_automation.get_settings(branch_id),
    }


@router.post("/automation/preview")
async def preview_campaign_automation(
    payload: CampaignAutomationPreview,
    current_user: dict = Depends(get_current_user),
):
    """Preview only the explicitly selected inquiry IDs; never writes inquiries."""
    await _require_automation_access(current_user)
    await _require_phone_access(current_user)
    branch_id = await _require_automation_branch(payload.branch_id, current_user)
    _ensure_automation_service()
    try:
        return await campaign_inquiry_automation.preview(
            branch_id,
            payload.inquiry_ids,
            mode=payload.mode,
            message=payload.message,
            first_message=payload.first_message,
            second_message=payload.second_message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/automation/confirm")
async def confirm_campaign_automation(
    payload: CampaignAutomationConfirm,
    current_user: dict = Depends(get_current_user),
):
    await _require_automation_access(current_user)
    await _require_phone_access(current_user)
    branch_id = await _require_automation_branch(payload.branch_id, current_user)
    _ensure_automation_service()
    try:
        return await campaign_inquiry_automation.confirm(branch_id, payload.preview_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except TimeoutError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/{inquiry_id}/automation/stop")
async def stop_campaign_inquiry_automation(
    inquiry_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _require_automation_access(current_user)
    row, branch_id = await _load_inquiry(inquiry_id, current_user)
    _ensure_automation_service()
    await campaign_inquiry_automation.stop_phone(
        branch_id, row.get("phone") or "", "manual_stop"
    )
    # Keep a person-level stop explicit even for a legacy/ineligible row with
    # no currently queued sequence.
    await db.campaign_inquiries.update_one(
        {"id": inquiry_id, "branch_id": branch_id},
        {
            "$set": {
                "automation_status": "stopped",
                "automation_stop_reason": "manual_stop",
                "automation_next_due_at": None,
                "updated_at": _now(),
            }
        },
    )
    updated = await db.campaign_inquiries.find_one(
        {"id": inquiry_id, "branch_id": branch_id}, {"_id": 0}
    )
    return {
        "inquiry_id": inquiry_id,
        "status": (updated or {}).get("automation_status") or "stopped",
        "stop_reason": (updated or {}).get("automation_stop_reason") or "manual_stop",
        "next_due_at": (updated or {}).get("automation_next_due_at"),
    }


@router.post("/preview")
async def preview_campaign_inquiries(
    payload: CampaignInquiryPreview,
    current_user: dict = Depends(get_current_user),
):
    await _require_campaign_access(current_user)
    await _require_phone_access(current_user)
    branch_id = await _branch_for_write(payload.branch_id, current_user)
    return await _preview_rows(branch_id, payload.phones)


@router.post("/import")
async def import_campaign_inquiries(
    payload: CampaignInquiryImport,
    current_user: dict = Depends(get_current_user),
):
    await _require_campaign_access(current_user)
    await _require_phone_access(current_user)
    branch_id = await _branch_for_write(payload.branch_id, current_user)
    lines = _split_phone_lines(payload.phones)
    seen: set[str] = set()
    created = duplicates = invalid = 0
    source = _clean_text(payload.source, allow_none=False)
    campaign = _clean_text(payload.campaign, allow_none=False)
    activity = _clean_text(payload.activity, allow_none=False)
    for _line_number, raw in lines:
        phone = _parse_phone(raw)
        if not phone:
            invalid += 1
            continue
        if phone in seen:
            duplicates += 1
            continue
        seen.add(phone)
        document = _base_document(
            branch_id=branch_id,
            phone=phone,
            source=source,
            campaign=campaign,
            activity=activity,
        )
        if await _atomic_create(document):
            created += 1
        else:
            duplicates += 1
    return {"created": created, "duplicates": duplicates, "invalid": invalid}


@router.post("")
async def create_campaign_inquiry(
    payload: CampaignInquiryCreate,
    current_user: dict = Depends(get_current_user),
):
    await _require_campaign_access(current_user)
    await _require_phone_access(current_user)
    branch_id = await _branch_for_write(payload.branch_id, current_user)
    phone = _parse_phone(payload.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    status = _validate_status(payload.status)
    due = _validate_iso(payload.followup_due_at, "followup_due_at")
    last_contact = _validate_iso(payload.last_contact_at, "last_contact_at")
    requested_invoice_id = (payload.invoice_id or "").strip() or None
    invoice = await _invoice_for_inquiry(
        requested_invoice_id,
        branch_id,
        required_status=status,
    )
    document = _base_document(
        branch_id=branch_id,
        phone=phone,
        name=payload.name,
        source=payload.source,
        campaign=payload.campaign,
        activity=payload.activity,
        age=payload.age,
        assigned_to=payload.assigned_to,
        notes=payload.notes,
        status=status,
        followup_due_at=due,
        last_contact_at=last_contact,
        invoice_id=invoice.get("id") if invoice else requested_invoice_id,
    )
    if not await _atomic_create(document):
        raise HTTPException(
            status_code=409,
            detail="An inquiry already exists for this branch and phone",
        )
    enriched = await _enrich_invoice_status([document])
    return _clean_row(enriched[0])


async def _load_inquiry(inquiry_id: str, current_user: dict) -> tuple[dict, str]:
    row = await db.campaign_inquiries.find_one(
        {"id": inquiry_id},
        {"_id": 0},
    )
    if not row or row.get("archived_at") or row.get("archived"):
        raise HTTPException(status_code=404, detail="Campaign inquiry not found")
    branch_id = row.get("branch_id")
    if not branch_id:
        raise HTTPException(status_code=403, detail="Inquiry has no branch")
    effective = require_branch_scope(current_user, branch_id)
    if effective and effective != branch_id:
        raise HTTPException(status_code=403, detail="No access to this inquiry")
    return row, branch_id


@router.patch("/{inquiry_id}")
async def update_campaign_inquiry(
    inquiry_id: str,
    payload: CampaignInquiryUpdate,
    current_user: dict = Depends(get_current_user),
):
    await _require_campaign_access(current_user)
    row, branch_id = await _load_inquiry(inquiry_id, current_user)
    # Invoice-backed statuses are read-time derived.  Refresh before applying
    # a patch so a cancelled/deleted link cannot leave this handler treating a
    # stale stored ``paid`` value as authoritative (and so restoring the
    # invoice is reflected by the response immediately).
    enriched_current = await _enrich_invoice_status([row])
    row = enriched_current[0]
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        enriched = await _enrich_invoice_status([row])
        return (await _sanitize_rows(enriched, current_user))[0]
    if "branch_id" in changes:
        raise HTTPException(status_code=400, detail="branch_id cannot be changed")

    if "phone" in changes:
        await _require_phone_access(current_user)
        normalized = _parse_phone(changes["phone"])
        if not normalized:
            raise HTTPException(status_code=400, detail="Invalid phone number")
        changes["phone"] = normalized
        if normalized != row.get("phone") and await _phone_already_exists(branch_id, normalized):
            raise HTTPException(
                status_code=409,
                detail="An inquiry already exists for this branch and phone",
            )

    if "status" in changes:
        if changes["status"] is None:
            raise HTTPException(status_code=400, detail="Invalid campaign inquiry status")
        changes["status"] = _validate_status(changes["status"])
    new_status = changes.get("status", row.get("status") or "new")
    if "followup_due_at" in changes:
        changes["followup_due_at"] = _validate_iso(
            changes["followup_due_at"], "followup_due_at"
        )
    if "last_contact_at" in changes:
        changes["last_contact_at"] = _validate_iso(
            changes["last_contact_at"], "last_contact_at"
        )
    if new_status in TERMINAL_STATUSES:
        changes["followup_due_at"] = None

    invoice_id = changes.get("invoice_id", row.get("invoice_id"))
    if "invoice_id" in changes:
        changes["invoice_id"] = (
            str(changes["invoice_id"]).strip()
            if changes["invoice_id"] is not None
            else None
        ) or None
        invoice_id = changes["invoice_id"]
    # A broken historical link should not block ordinary follow-up edits or
    # changing the inquiry back to a non-invoice status.  Explicit link
    # changes, and any attempt to claim invoiced/paid, still resolve and
    # validate the invoice before writing.
    skip_broken_link_validation = (
        bool(row.get("invoice_link_error"))
        and "invoice_id" not in changes
        and new_status not in {"invoiced", "paid"}
    )
    invoice = None if skip_broken_link_validation else await _invoice_for_inquiry(
        invoice_id,
        branch_id,
        required_status=new_status,
    )
    if invoice and "invoice_id" in changes:
        # Always persist the canonical UUID, even when the UI submitted the
        # human-visible invoice number.
        changes["invoice_id"] = invoice.get("id")
    elif invoice and "invoice_id" not in changes:
        # No client change is needed; this lookup only enforces a paid/invoiced
        # status transition against the authoritative linked invoice.
        pass
    elif "invoice_id" in changes and changes["invoice_id"] is None:
        if new_status in {"invoiced", "paid"}:
            raise HTTPException(
                status_code=400,
                detail=f"{new_status} inquiries require invoice_id",
            )

    update = {}
    for field in (
        "name",
        "phone",
        "source",
        "campaign",
        "activity",
        "age",
        "assigned_to",
        "notes",
        "status",
        "followup_due_at",
        "last_contact_at",
        "invoice_id",
    ):
        if field in changes:
            value = changes[field]
            if field in {
                "name",
                "source",
                "campaign",
                "activity",
                "age",
                "assigned_to",
                "notes",
            }:
                value = _clean_text(value)
            update[field] = value
    update["updated_at"] = _now()

    changed_manual_fields = set(changes) & {
        "notes",
        "status",
        "last_contact_at",
    }
    if changed_manual_fields:
        history = row.get("history")
        if not isinstance(history, list):
            history = []
        history_entry = {
            "at": update["updated_at"],
            "actor_id": current_user.get("user_id") or current_user.get("id"),
            "type": "manual_followup",
        }
        if "status" in changes:
            history_entry["status"] = changes["status"]
        if "notes" in changes:
            history_entry["note"] = update.get("notes")
        history = (history + [history_entry])[-MAX_HISTORY:]
        update["history"] = history

    phone_changed = "phone" in update and update["phone"] != row.get("phone")
    try:
        result = await db.campaign_inquiries.update_one(
            {"id": inquiry_id, "branch_id": branch_id},
            {"$set": update},
        )
    except DuplicateKeyError:
        if phone_changed and await _phone_already_exists(branch_id, update["phone"]):
            raise HTTPException(
                status_code=409,
                detail="An inquiry already exists for this branch and phone",
            )
        raise
    except Exception:
        # The Atlas Data API may not preserve pymongo's DuplicateKeyError
        # type.  Convert only a confirmed branch/phone collision.
        if phone_changed and await _phone_already_exists(branch_id, update["phone"]):
            raise HTTPException(
                status_code=409,
                detail="An inquiry already exists for this branch and phone",
            )
        raise
    if getattr(result, "matched_count", 1) == 0:
        raise HTTPException(status_code=404, detail="Campaign inquiry not found")
    updated = await db.campaign_inquiries.find_one(
        {"id": inquiry_id, "branch_id": branch_id},
        {"_id": 0},
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Campaign inquiry not found")
    if "status" in changes:
        _ensure_automation_service()
        await campaign_inquiry_automation.note_crm_status(
            branch_id, updated.get("phone") or "", changes["status"]
        )
        updated = await db.campaign_inquiries.find_one(
            {"id": inquiry_id, "branch_id": branch_id}, {"_id": 0}
        ) or updated
    if {"phone", "name"} & set(changes):
        _ensure_automation_service()
        await campaign_inquiry_automation.note_identity_edit(branch_id, inquiry_id)
        updated = await db.campaign_inquiries.find_one(
            {"id": inquiry_id, "branch_id": branch_id}, {"_id": 0}
        ) or updated
    updated_rows = await _enrich_invoice_status([updated])
    return (await _sanitize_rows(updated_rows, current_user))[0]


@router.delete("/{inquiry_id}")
async def archive_campaign_inquiry(
    inquiry_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _require_campaign_access(current_user)
    row, branch_id = await _load_inquiry(inquiry_id, current_user)
    archived_at = _now()
    result = await db.campaign_inquiries.update_one(
        {"id": inquiry_id, "branch_id": branch_id, "archived_at": {"$exists": False}},
        {"$set": {"archived_at": archived_at, "archived": True, "updated_at": archived_at}},
    )
    if getattr(result, "matched_count", 1) == 0:
        raise HTTPException(status_code=404, detail="Campaign inquiry not found")
    _ensure_automation_service()
    await campaign_inquiry_automation.stop_inquiry(
        branch_id, inquiry_id, "archived"
    )
    return {"id": inquiry_id, "archived": True, "archived_at": archived_at}