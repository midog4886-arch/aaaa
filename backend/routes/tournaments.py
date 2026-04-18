"""
Tournaments API Routes
Manage tournaments tied to academy levels: create tournaments, add member
participants per level, record results (1st/2nd/3rd), and export reports.
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import uuid

from database import db
from utils.auth import get_current_user
from utils.cache import cache_invalidate

router = APIRouter(prefix="/tournaments", tags=["Tournaments"])

PERMISSION_KEY = "tournaments"


def require_tournaments_permission(current_user: dict = Depends(get_current_user)) -> dict:
    """Defense-in-depth: verify the caller has the `tournaments` permission
    (or is admin) before any tournaments endpoint executes."""
    if current_user.get("is_admin"):
        return current_user
    perms = current_user.get("permissions") or []
    if PERMISSION_KEY in perms:
        return current_user
    raise HTTPException(status_code=403, detail="Permission denied: tournaments")

# ============ Lazy imports for heavy libs ============

def _get_openpyxl():
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
    return type('XL', (), {
        'Workbook': Workbook, 'Font': Font, 'Alignment': Alignment,
        'Border': Border, 'Side': Side, 'PatternFill': PatternFill,
    })()


def _get_reportlab():
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    return type('RL', (), {
        'colors': colors, 'A4': A4, 'landscape': landscape,
        'SimpleDocTemplate': SimpleDocTemplate, 'Table': Table,
        'TableStyle': TableStyle, 'Paragraph': Paragraph, 'Spacer': Spacer,
        'ParagraphStyle': ParagraphStyle,
        'mm': mm, 'pdfmetrics': pdfmetrics, 'TTFont': TTFont,
    })()


def _register_arabic_font():
    rl = _get_reportlab()
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/nix/store/dejavu-fonts/share/fonts/truetype/DejaVuSans.ttf",
    ]
    for fp in font_paths:
        try:
            if Path(fp).exists():
                rl.pdfmetrics.registerFont(rl.TTFont('ArabicFont', fp))
                return 'ArabicFont'
        except Exception:
            continue
    return 'Helvetica'


# ============ MODELS ============

class Participant(BaseModel):
    member_id: str
    # Which of the tournament's activities this participant competes in.
    # Optional: tournaments without any activities accept any participant.
    activity_id: Optional[str] = None
    level_id: Optional[str] = None
    # Sub-category within the tournament (e.g. swimming strokes:
    # حر/ظهر/صدر/فراشة). When the tournament defines `subcategories`, the
    # SAME member can be added once per subcategory.
    subcategory: Optional[str] = None
    age: Optional[str] = ""
    weight: Optional[str] = ""
    # "1" / "2" / "3" / "participation" / None
    position: Optional[str] = None
    notes: Optional[str] = ""
    notify: Optional[bool] = False  # send direct notification to the member


class TournamentCreate(BaseModel):
    name: str
    place: Optional[str] = ""
    date: Optional[str] = ""  # YYYY-MM-DD
    # NEW: a tournament can span multiple activities (e.g. swimming + football
    # + karate). The legacy single-activity fields below are kept for backward
    # compatibility and are auto-derived from the first item in activity_ids.
    activity_ids: Optional[List[str]] = None
    activity_names: Optional[List[str]] = None
    activity_id: Optional[str] = None        # legacy / fallback
    activity_name: Optional[str] = ""        # legacy / fallback
    branch_id: Optional[str] = None
    description: Optional[str] = ""
    status: Optional[str] = "upcoming"  # upcoming | ongoing | completed
    # Sub-categories (e.g. swimming strokes). When set, the SAME member can
    # be added once per subcategory and capacity is enforced per
    # (subcategory, level_id).
    subcategories: Optional[List[str]] = None
    subcategory_capacity: Optional[int] = 6
    notify: Optional[bool] = False  # broadcast announcement to members on create


class ParticipantUpdate(BaseModel):
    activity_id: Optional[str] = None
    level_id: Optional[str] = None
    subcategory: Optional[str] = None
    age: Optional[str] = None
    weight: Optional[str] = None
    position: Optional[str] = None
    notes: Optional[str] = None
    notify: Optional[bool] = False  # send congrats notification on result


# ============ HELPERS ============

def _branch_query(current_user: dict, branch_filter: Optional[str]):
    is_admin = current_user.get("is_admin", False)
    branch_id = current_user.get("branch_id")
    q = {}
    if is_admin:
        if branch_filter and branch_filter != "all":
            q["$or"] = [
                {"branch_id": branch_filter},
                {"branch_id": None},
                {"branch_id": {"$exists": False}},
            ]
    else:
        q["$or"] = [
            {"branch_id": branch_id},
            {"branch_id": None},
            {"branch_id": {"$exists": False}},
        ]
    return q


def _can_access(tournament: dict, current_user: dict) -> bool:
    """Branch ownership check. Admins can access anything; non-admins can
    only access tournaments in their branch (or shared/branch-less ones)."""
    if current_user.get("is_admin", False):
        return True
    user_branch = current_user.get("branch_id")
    t_branch = tournament.get("branch_id")
    # Branch-less / shared tournaments are visible to everyone
    if not t_branch:
        return True
    return t_branch == user_branch


def _tournament_activity_ids(tournament: dict) -> List[str]:
    """Return the list of activity IDs a tournament covers, transparently
    handling both the new `activity_ids` array and the legacy single
    `activity_id` field. Empty list means "no activity restriction"."""
    ids = tournament.get("activity_ids")
    if isinstance(ids, list) and ids:
        return [a for a in ids if a]
    legacy = tournament.get("activity_id")
    return [legacy] if legacy else []


def _tournament_activity_names(tournament: dict) -> List[str]:
    names = tournament.get("activity_names")
    if isinstance(names, list) and names:
        return [n for n in names if n]
    legacy = tournament.get("activity_name")
    return [legacy] if legacy else []


async def _load_tournament_or_403(tournament_id: str, current_user: dict, projection: Optional[dict] = None):
    """Fetch tournament by id and validate the current user is allowed to access it."""
    t = await db.tournaments.find_one({"id": tournament_id}, projection or {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Tournament not found")
    if not _can_access(t, current_user):
        # Return 404 (not 403) to avoid leaking existence across branches
        raise HTTPException(status_code=404, detail="Tournament not found")
    return t


async def _enrich_participants(tournament: dict) -> dict:
    """Attach member details to each participant for client display."""
    parts = tournament.get("participants") or []
    if not parts:
        tournament["participants"] = []
        return tournament

    member_ids = list({p.get("member_id") for p in parts if p.get("member_id")})
    members = await db.members.find(
        {"id": {"$in": member_ids}},
        {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "phone": 1, "member_code": 1}
    ).to_list(len(member_ids) + 10) if member_ids else []
    members_map = {m["id"]: m for m in members}

    level_ids = list({p.get("level_id") for p in parts if p.get("level_id")})
    levels = await db.levels.find(
        {"id": {"$in": level_ids}},
        {"_id": 0, "id": 1, "level_number": 1, "custom_name": 1, "activity_name": 1}
    ).to_list(len(level_ids) + 10) if level_ids else []
    levels_map = {l["id"]: l for l in levels}

    # Map participant.activity_id -> activity_name using the tournament's
    # own activity_ids/activity_names arrays so the UI can display which
    # activity each participant competes in (multi-activity tournaments).
    t_aids = _tournament_activity_ids(tournament)
    t_anames = _tournament_activity_names(tournament)
    activity_name_map = {aid: (t_anames[i] if i < len(t_anames) else "")
                         for i, aid in enumerate(t_aids)}

    enriched = []
    for p in parts:
        m = members_map.get(p.get("member_id")) or {}
        l = levels_map.get(p.get("level_id")) or {}
        lvl_label = ""
        if l:
            cn = (l.get("custom_name") or "").strip()
            lvl_label = cn if cn else f"المستوى {l.get('level_number', '')}"
        enriched.append({
            **p,
            "member_name": m.get("name_ar") or m.get("name") or "",
            "phone": m.get("phone") or "",
            "member_code": m.get("member_code") or "",
            "level_label": lvl_label,
            "level_number": l.get("level_number"),
            "activity_name": activity_name_map.get(p.get("activity_id")) or "",
        })
    tournament["participants"] = enriched
    return tournament


# ============ NOTIFICATION HELPERS ============

async def _send_member_notification(
    member_id: str,
    title_ar: str,
    message_ar: str,
    title_en: str = "",
    message_en: str = "",
    notif_type: str = "tournament",
    link: Optional[str] = None,
    tag: Optional[str] = None,
) -> dict:
    """Insert in-app member notification + send push (best-effort, never raises).

    Returns a delivery summary dict so callers can surface what actually
    happened to the admin: ``{"in_app": bool, "push_total": int,
    "push_success": int, "push_failed": int}``.
    """
    result = {"in_app": False, "push_total": 0, "push_success": 0, "push_failed": 0}
    try:
        await db.member_notifications.insert_one({
            "id": str(uuid.uuid4()),
            "member_id": member_id,
            "title_ar": title_ar,
            "title_en": title_en or title_ar,
            "message_ar": message_ar,
            "message_en": message_en or message_ar,
            "type": notif_type,
            "link": link,
            "is_read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        result["in_app"] = True
    except Exception:
        pass

    try:
        from routes.push_notifications import (
            send_push_notification, NotificationPayload,
        )
        subs = await db.push_subscriptions.find(
            {"is_active": True, "member_id": member_id}, {"_id": 0}
        ).to_list(20)
        result["push_total"] = len(subs)
        if not subs:
            return result
        payload = NotificationPayload(
            title=title_ar,
            body=message_ar,
            url=link or "/portal",
            tag=tag or f"tournament-{uuid.uuid4()}",
            data={"type": notif_type},
        )
        for sub in subs:
            try:
                ok = await send_push_notification(sub, payload)
                if ok:
                    result["push_success"] += 1
                else:
                    result["push_failed"] += 1
            except Exception:
                result["push_failed"] += 1
                continue
    except Exception:
        pass
    return result


async def _record_notification_log(
    tournament_id: str,
    notif_type: str,
    summary: dict,
    current_user: dict,
    member_id: Optional[str] = None,
    member_name: Optional[str] = None,
) -> None:
    """Persist a per-tournament delivery log entry (best-effort)."""
    try:
        await db.tournament_notification_logs.insert_one({
            "id": str(uuid.uuid4()),
            "tournament_id": tournament_id,
            "type": notif_type,  # announcement | registration | result
            "member_id": member_id,
            "member_name": member_name or "",
            "members_count": int(summary.get("members_count", 1 if member_id else 0)),
            "in_app": int(summary.get("in_app", 0)),
            "push_success": int(summary.get("push_success", 0)),
            "push_failed": int(summary.get("push_failed", 0)),
            "no_push": int(summary.get("no_push", 0)),
            "sent_by_user_id": current_user.get("id") or str(current_user.get("_id", "")),
            "sent_by_user_name": current_user.get("username") or current_user.get("name") or "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass


async def _broadcast_tournament_announcement(tournament: dict) -> dict:
    """Best-effort broadcast: notify members of the tournament's branch
    (and activity, when set) about the new tournament.

    Returns an aggregate delivery summary so callers can show admins how
    many members were reached / failed.
    """
    summary = {
        "members_count": 0,
        "in_app": 0,
        "push_success": 0,
        "push_failed": 0,
        "no_push": 0,  # members with no active push subscription
    }
    try:
        branch_id = tournament.get("branch_id")
        activity_ids = _tournament_activity_ids(tournament)
        activity_names = _tournament_activity_names(tournament)

        # Resolve target member IDs: members enrolled in ANY of the
        # tournament's activities, within the branch.
        member_query: dict = {}
        if branch_id:
            member_query["branch_id"] = branch_id
        if activity_ids:
            member_query["activities"] = {"$elemMatch": {
                "status": "active",
                "activity_id": {"$in": activity_ids},
            }}
        elif activity_names:
            member_query["activities"] = {"$elemMatch": {
                "status": "active",
                "activity_name": {"$in": activity_names},
            }}
        members = await db.members.find(
            member_query, {"_id": 0, "id": 1}
        ).to_list(10000)
        member_ids = [m["id"] for m in members if m.get("id")]
        summary["members_count"] = len(member_ids)
        if not member_ids:
            return summary

        t_name = tournament.get("name", "")
        t_date = tournament.get("date") or ""
        t_place = tournament.get("place") or ""
        bits_ar = [f"بطولة جديدة: {t_name}"]
        bits_en = [f"New tournament: {t_name}"]
        if t_date:
            bits_ar.append(f"التاريخ: {t_date}")
            bits_en.append(f"Date: {t_date}")
        if t_place:
            bits_ar.append(f"المكان: {t_place}")
            bits_en.append(f"Place: {t_place}")
        msg_ar = " — ".join(bits_ar)
        msg_en = " — ".join(bits_en)

        for mid in member_ids:
            res = await _send_member_notification(
                member_id=mid,
                title_ar="🏆 بطولة جديدة",
                title_en="🏆 New Tournament",
                message_ar=msg_ar,
                message_en=msg_en,
                notif_type="tournament_announcement",
                link="/portal/my-tournaments",
                tag=f"tournament-new-{tournament.get('id')}",
            )
            if res.get("in_app"):
                summary["in_app"] += 1
            summary["push_success"] += res.get("push_success", 0)
            summary["push_failed"] += res.get("push_failed", 0)
            if res.get("push_total", 0) == 0:
                summary["no_push"] += 1
    except Exception:
        pass
    return summary


async def _notify_participant_added(tournament: dict, member_id: str) -> dict:
    """Direct notification: member was added to a tournament. Returns delivery summary."""
    t_name = tournament.get("name", "")
    t_date = tournament.get("date") or "-"
    t_place = tournament.get("place") or "-"
    return await _send_member_notification(
        member_id=member_id,
        title_ar="🎯 تم تسجيلك في بطولة",
        title_en="🎯 Registered for a tournament",
        message_ar=f"تم تسجيلك في بطولة \"{t_name}\" — التاريخ: {t_date} — المكان: {t_place}",
        message_en=f"You've been registered for \"{t_name}\" — Date: {t_date} — Place: {t_place}",
        notif_type="tournament_registration",
        link="/portal/my-tournaments",
        tag=f"tournament-reg-{tournament.get('id')}-{member_id}",
    )


async def _notify_result(tournament: dict, member_id: str, position: str) -> Optional[dict]:
    """Congratulatory direct notification when a ranked result is recorded.

    Returns ``None`` when the position is not a ranked one (1/2/3) and no
    notification is appropriate; otherwise returns the delivery summary.
    """
    pos_ar = {"1": "الأول 🥇", "2": "الثاني 🥈", "3": "الثالث 🥉"}.get(position, "")
    pos_en = {"1": "1st 🥇", "2": "2nd 🥈", "3": "3rd 🥉"}.get(position, "")
    if not pos_ar:
        return None
    t_name = tournament.get("name", "")
    return await _send_member_notification(
        member_id=member_id,
        title_ar="🏆 مبروك! حققت إنجازاً",
        title_en="🏆 Congratulations!",
        message_ar=f"مبروك! حصلت على المركز {pos_ar} في بطولة \"{t_name}\".",
        message_en=f"Congratulations! You won {pos_en} place in \"{t_name}\".",
        notif_type="tournament_result",
        link="/portal/my-tournaments",
        tag=f"tournament-result-{tournament.get('id')}-{member_id}",
    )


async def _resolve_member_name(member_id: str) -> str:
    try:
        m = await db.members.find_one({"id": member_id}, {"_id": 0, "name_ar": 1, "name": 1})
        if m:
            return m.get("name_ar") or m.get("name") or ""
    except Exception:
        pass
    return ""


# ============ ROUTES ============

@router.get("")
async def list_tournaments(
    branch_filter: Optional[str] = None,
    activity_id: Optional[str] = None,
    current_user: dict = Depends(require_tournaments_permission)
):
    """List tournaments — branch-scoped for non-admins."""
    query = _branch_query(current_user, branch_filter)
    if activity_id:
        query["activity_id"] = activity_id
    items = await db.tournaments.find(query, {"_id": 0}).sort("date", -1).to_list(500)
    # Add participant count per tournament for the list view
    for t in items:
        t["participants_count"] = len(t.get("participants") or [])
    return items


@router.get("/by-member/{member_id}")
async def list_tournaments_for_member(
    member_id: str,
    current_user: dict = Depends(require_tournaments_permission),
):
    """Return every tournament this member participated in (branch-scoped),
    with that participant's level/age/weight/position attached. Sorted by
    tournament date descending."""
    # Restrict to tournaments the caller is allowed to see
    base_query = _branch_query(current_user, None)
    query = {**base_query, "participants.member_id": member_id}
    items = await db.tournaments.find(
        query,
        {"_id": 0}
    ).sort("date", -1).to_list(500)

    # Pre-fetch level labels for any level_id used by this member's records
    level_ids = []
    for t in items:
        for p in (t.get("participants") or []):
            if p.get("member_id") == member_id and p.get("level_id"):
                level_ids.append(p.get("level_id"))
    level_ids = list({lid for lid in level_ids if lid})
    levels_map = {}
    if level_ids:
        lvls = await db.levels.find(
            {"id": {"$in": level_ids}},
            {"_id": 0, "id": 1, "level_number": 1, "custom_name": 1, "activity_name": 1}
        ).to_list(len(level_ids) + 10)
        for l in lvls:
            cn = (l.get("custom_name") or "").strip()
            levels_map[l["id"]] = cn if cn else f"المستوى {l.get('level_number', '')}"

    results = []
    for t in items:
        member_part = next(
            (p for p in (t.get("participants") or []) if p.get("member_id") == member_id),
            None
        )
        if not member_part:
            continue
        results.append({
            "id": t.get("id"),
            "name": t.get("name", ""),
            "date": t.get("date", ""),
            "place": t.get("place", ""),
            "activity_name": t.get("activity_name", ""),
            "status": t.get("status", ""),
            "level_id": member_part.get("level_id"),
            "level_label": levels_map.get(member_part.get("level_id"), ""),
            "age": member_part.get("age", ""),
            "weight": member_part.get("weight", ""),
            "position": _norm_pos(member_part.get("position")),
            "notes": member_part.get("notes", ""),
        })
    return results


@router.get("/recent-medalists")
async def list_recent_medalists(
    limit: int = Query(5, ge=1, le=50),
    branch_filter: Optional[str] = None,
    current_user: dict = Depends(require_tournaments_permission),
):
    """Return the latest medalists (1st/2nd/3rd) across tournaments the
    caller can access. Branch-scoped via the same rules as the listing endpoint.
    Used by the admin dashboard "Recent Champions" widget.
    """
    query = _branch_query(current_user, branch_filter)
    # Only consider tournaments that have any participants — small optimization.
    query["participants"] = {"$exists": True, "$ne": []}

    tournaments = await db.tournaments.find(
        query,
        {"_id": 0, "id": 1, "name": 1, "date": 1, "branch_id": 1, "participants": 1},
    ).sort("date", -1).to_list(200)

    # Collect medalists with their tournament context
    medalists: List[dict] = []
    member_ids: set = set()
    for t in tournaments:
        for p in (t.get("participants") or []):
            pos = _norm_pos(p.get("position"))
            if pos not in RANKED_POSITIONS:
                continue
            mid = p.get("member_id")
            if not mid:
                continue
            member_ids.add(mid)
            medalists.append({
                "tournament_id": t.get("id"),
                "tournament_name": t.get("name") or "",
                "tournament_date": t.get("date") or "",
                "branch_id": t.get("branch_id"),
                "member_id": mid,
                "position": pos,
                "position_label": POSITION_LABEL.get(pos, pos),
            })

    # Sort by tournament date desc then position asc (1 before 2 before 3)
    medalists.sort(key=lambda m: (m.get("tournament_date") or "", -_pos_sort_key(m["position"])), reverse=True)
    medalists = medalists[:limit]

    if member_ids:
        members = await db.members.find(
            {"id": {"$in": list({m["member_id"] for m in medalists})}},
            {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "member_code": 1},
        ).to_list(len(medalists) + 5)
        m_map = {m["id"]: m for m in members}
        for entry in medalists:
            mm = m_map.get(entry["member_id"]) or {}
            entry["member_name"] = mm.get("name_ar") or mm.get("name") or ""
            entry["member_code"] = mm.get("member_code") or ""

    return medalists


@router.get("/recipients-preview")
async def preview_announcement_recipients(
    branch_id: Optional[str] = None,
    activity_id: Optional[str] = None,
    activity_ids: Optional[str] = None,        # comma-separated list (multi-activity)
    activity_name: Optional[str] = None,
    current_user: dict = Depends(require_tournaments_permission),
):
    """Preview the members who would receive a tournament announcement
    broadcast for the given branch/activity. Mirrors the targeting logic
    used by `_broadcast_tournament_announcement` so the admin can see the
    audience before sending."""
    is_admin = current_user.get("is_admin", False)
    if is_admin:
        # "all" or empty means no branch restriction
        effective_branch = branch_id if (branch_id and branch_id != "all") else None
    else:
        # Non-admins are always scoped to their own branch
        effective_branch = current_user.get("branch_id")

    # Normalise activity inputs into a list.
    aid_list: List[str] = []
    if activity_ids:
        aid_list = [a.strip() for a in activity_ids.split(",") if a.strip()]
    if activity_id and activity_id not in aid_list:
        aid_list.append(activity_id)

    member_query: dict = {}
    if effective_branch:
        member_query["branch_id"] = effective_branch
    if aid_list:
        member_query["activities"] = {"$elemMatch": {
            "status": "active",
            "activity_id": {"$in": aid_list},
        }}
    elif activity_name:
        member_query["activities"] = {"$elemMatch": {
            "status": "active",
            "activity_name": activity_name,
        }}

    members = await db.members.find(
        member_query,
        {"_id": 0, "id": 1, "name_ar": 1, "name": 1, "member_code": 1},
    ).to_list(10000)

    items = [
        {
            "id": m.get("id"),
            "name": m.get("name_ar") or m.get("name") or "",
            "member_code": m.get("member_code") or "",
        }
        for m in members
        if m.get("id")
    ]
    items.sort(key=lambda x: x["name"])
    return {"count": len(items), "members": items}


@router.get("/{tournament_id}")
async def get_tournament(tournament_id: str, current_user: dict = Depends(require_tournaments_permission)):
    t = await _load_tournament_or_403(tournament_id, current_user)
    return await _enrich_participants(t)


@router.post("")
async def create_tournament(payload: TournamentCreate, current_user: dict = Depends(require_tournaments_permission)):
    is_admin = current_user.get("is_admin", False)
    if is_admin and payload.branch_id:
        final_branch_id = payload.branch_id if payload.branch_id != "all" else None
    else:
        final_branch_id = current_user.get("branch_id")

    # Normalise the multi-activity inputs. We always persist `activity_ids`
    # (list) as the source of truth, and mirror the first one into the legacy
    # single-activity fields so older code paths and existing UI continue to
    # work without changes.
    aid_list = [a for a in (payload.activity_ids or []) if a]
    aname_list = [n for n in (payload.activity_names or []) if n]
    if not aid_list and payload.activity_id:
        aid_list = [payload.activity_id]
    if not aname_list and payload.activity_name:
        aname_list = [payload.activity_name]
    legacy_aid = aid_list[0] if aid_list else None
    legacy_aname = aname_list[0] if aname_list else ""

    sub_list = [s.strip() for s in (payload.subcategories or []) if s and s.strip()]
    sub_capacity = int(payload.subcategory_capacity) if payload.subcategory_capacity else 6

    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "place": payload.place or "",
        "date": payload.date or "",
        "activity_ids": aid_list,
        "activity_names": aname_list,
        "activity_id": legacy_aid,
        "activity_name": legacy_aname,
        "branch_id": final_branch_id,
        "description": payload.description or "",
        "status": payload.status or "upcoming",
        "subcategories": sub_list,
        "subcategory_capacity": sub_capacity,
        "participants": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tournaments.insert_one(doc)
    cache_invalidate("tournaments:")
    await _log_activity("create_tournament", current_user, {
        "tournament_id": doc["id"], "name": doc["name"], "branch_id": final_branch_id
    })
    notification_summary = None
    if payload.notify:
        notification_summary = await _broadcast_tournament_announcement(doc)
        await _record_notification_log(
            tournament_id=doc["id"],
            notif_type="announcement",
            summary=notification_summary,
            current_user=current_user,
        )
    out = {k: v for k, v in doc.items() if k != "_id"}
    if notification_summary is not None:
        out["notification_summary"] = notification_summary
    return out


@router.put("/{tournament_id}")
async def update_tournament(tournament_id: str, payload: TournamentCreate, current_user: dict = Depends(require_tournaments_permission)):
    await _load_tournament_or_403(tournament_id, current_user)
    aid_list = [a for a in (payload.activity_ids or []) if a]
    aname_list = [n for n in (payload.activity_names or []) if n]
    if not aid_list and payload.activity_id:
        aid_list = [payload.activity_id]
    if not aname_list and payload.activity_name:
        aname_list = [payload.activity_name]
    legacy_aid = aid_list[0] if aid_list else None
    legacy_aname = aname_list[0] if aname_list else ""

    sub_list = [s.strip() for s in (payload.subcategories or []) if s and s.strip()]
    sub_capacity = int(payload.subcategory_capacity) if payload.subcategory_capacity else 6

    update = {
        "name": payload.name,
        "place": payload.place or "",
        "date": payload.date or "",
        "activity_ids": aid_list,
        "activity_names": aname_list,
        "activity_id": legacy_aid,
        "activity_name": legacy_aname,
        "description": payload.description or "",
        "status": payload.status or "upcoming",
        "subcategories": sub_list,
        "subcategory_capacity": sub_capacity,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if current_user.get("is_admin", False) and payload.branch_id is not None:
        update["branch_id"] = payload.branch_id if payload.branch_id != "all" else None

    result = await db.tournaments.find_one_and_update(
        {"id": tournament_id},
        {"$set": update},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Tournament not found")
    cache_invalidate("tournaments:")
    await _log_activity("update_tournament", current_user, {
        "tournament_id": tournament_id, "name": payload.name
    })
    return {k: v for k, v in result.items() if k != "_id"}


@router.delete("/{tournament_id}")
async def delete_tournament(tournament_id: str, current_user: dict = Depends(require_tournaments_permission)):
    t = await _load_tournament_or_403(tournament_id, current_user)
    res = await db.tournaments.delete_one({"id": tournament_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tournament not found")
    cache_invalidate("tournaments:")
    await _log_activity("delete_tournament", current_user, {
        "tournament_id": tournament_id, "name": t.get("name")
    })
    return {"message": "Tournament deleted"}


# ─── Participants ────────────────────────────────

@router.post("/{tournament_id}/participants")
async def add_participant(tournament_id: str, participant: Participant, current_user: dict = Depends(require_tournaments_permission)):
    t = await _load_tournament_or_403(tournament_id, current_user)

    existing = t.get("participants") or []
    t_subs = [s for s in (t.get("subcategories") or []) if s]
    sub = (participant.subcategory or "").strip() or None

    # When the tournament defines subcategories, every participant MUST be
    # tagged with one of them.
    if t_subs and not sub:
        raise HTTPException(status_code=400, detail="يجب اختيار التصنيف الفرعي")
    if t_subs and sub and sub not in t_subs:
        raise HTTPException(status_code=400, detail="التصنيف الفرعي غير موجود في هذه البطولة")

    # Identity is (member_id, subcategory): same member can be added once per
    # subcategory, but only once when no subcategory is in play.
    if any(p.get("member_id") == participant.member_id and (p.get("subcategory") or None) == sub for p in existing):
        raise HTTPException(status_code=400, detail="العضو مضاف بالفعل في هذا التصنيف")

    # Capacity per (subcategory, level_id) when subcategories are defined.
    if t_subs and sub and participant.level_id:
        cap = int(t.get("subcategory_capacity") or 6)
        used = sum(
            1 for p in existing
            if (p.get("subcategory") or None) == sub and p.get("level_id") == participant.level_id
        )
        if used >= cap:
            raise HTTPException(
                status_code=400,
                detail=f"السعة القصوى لهذا المستوى في هذا التصنيف ({cap}) ممتلئة",
            )

    # Verify member exists; if tournament has an activity, prefer members
    # subscribed to that activity (soft warning – allow staff override only
    # when member belongs to the same branch as the tournament).
    member = await db.members.find_one({"id": participant.member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="العضو غير موجود")
    t_branch = t.get("branch_id")
    m_branch = member.get("branch_id")
    if t_branch and m_branch and t_branch != m_branch:
        raise HTTPException(status_code=400, detail="العضو ليس من نفس فرع البطولة")

    # If the tournament is bound to one or more activities, the member must
    # be currently enrolled in AT LEAST ONE of them (or, when the client
    # specified `participant.activity_id`, in that exact one). Enrollment is
    # detected from either `members.activities` (registration form flow) or
    # paid/partial invoices (normal flow). A subscription counts as active
    # while its end_date is today or later.
    tournament_aids = _tournament_activity_ids(t)
    if tournament_aids:
        from datetime import date as _date
        today_str = _date.today().isoformat()

        # If a specific activity was selected for this participant, restrict
        # validation to it; otherwise accept enrollment in any of the
        # tournament's activities.
        if participant.activity_id:
            if participant.activity_id not in tournament_aids:
                raise HTTPException(
                    status_code=400,
                    detail="النشاط المختار لا ينتمي لهذه البطولة",
                )
            target_activities = {participant.activity_id}
        else:
            target_activities = set(tournament_aids)

        is_enrolled = False
        for act in (member.get("activities") or []):
            if act.get("activity_id") not in target_activities:
                continue
            if act.get("status", "active") != "active":
                continue
            end = (act.get("end_date") or "")
            if not end or end >= today_str:
                is_enrolled = True
                break

        if not is_enrolled:
            invoices = await db.invoices.find(
                {
                    "member_id": participant.member_id,
                    "status": {"$in": ["paid", "partial"]},
                },
                {"_id": 0, "items": 1},
            ).to_list(100)
            for inv in invoices:
                for item in inv.get("items", []) or []:
                    if item.get("is_product"):
                        continue
                    if item.get("activity_id") not in target_activities:
                        continue
                    end = item.get("end_date") or ""
                    if not end or end >= today_str:
                        is_enrolled = True
                        break
                if is_enrolled:
                    break

        if not is_enrolled:
            raise HTTPException(
                status_code=400,
                detail="العضو ليس مسجلاً في نشاط البطولة أو انتهى اشتراكه",
            )

    new_part = participant.model_dump()
    notify_member = bool(new_part.pop("notify", False))
    new_part["position"] = _norm_pos(new_part.get("position"))

    # If position is a ranked one (1/2/3), it must be unique per level inside this tournament.
    # When subcategories are defined, uniqueness is per (subcategory, level).
    # "participation" can be assigned to any number of members.
    if new_part["position"] in RANKED_POSITIONS:
        for p in existing:
            if (
                p.get("level_id") == participant.level_id
                and (p.get("subcategory") or None) == sub
                and _norm_pos(p.get("position")) == new_part["position"]
            ):
                raise HTTPException(status_code=400, detail="هذا المركز محجوز لمشارك آخر في نفس المستوى")

    await db.tournaments.update_one(
        {"id": tournament_id},
        {"$push": {"participants": new_part}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await _log_activity("add_participant", current_user, {
        "tournament_id": tournament_id, "member_id": participant.member_id,
        "position": new_part["position"]
    })
    notification_summary = None
    if notify_member:
        notification_summary = await _notify_participant_added(t, participant.member_id)
        await _record_notification_log(
            tournament_id=tournament_id,
            notif_type="registration",
            summary=notification_summary,
            current_user=current_user,
            member_id=participant.member_id,
            member_name=await _resolve_member_name(participant.member_id),
        )
    out = {"message": "Participant added"}
    if notification_summary is not None:
        out["notification_summary"] = notification_summary
    return out


@router.put("/{tournament_id}/participants/{member_id}")
async def update_participant(
    tournament_id: str,
    member_id: str,
    payload: ParticipantUpdate,
    subcategory: Optional[str] = None,
    current_user: dict = Depends(require_tournaments_permission),
):
    t = await _load_tournament_or_403(tournament_id, current_user)

    parts = t.get("participants") or []
    sub_filter = (subcategory or "").strip() or None
    # Locate the participant. When subcategory query param is supplied, match
    # both (member_id + subcategory). Otherwise match the first record by
    # member_id (legacy behavior).
    if sub_filter is not None:
        target = next(
            (p for p in parts
             if p.get("member_id") == member_id and (p.get("subcategory") or None) == sub_filter),
            None,
        )
    else:
        target = next((p for p in parts if p.get("member_id") == member_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Participant not found")

    new_data = payload.model_dump(exclude_unset=True)
    notify_member = bool(new_data.pop("notify", False))
    prev_position = _norm_pos(target.get("position"))
    if "position" in new_data:
        new_data["position"] = _norm_pos(new_data["position"])

    # Normalise subcategory in the payload (treat empty string as None).
    if "subcategory" in new_data:
        s = (new_data.get("subcategory") or "").strip()
        new_data["subcategory"] = s or None

    # Compute the EFFECTIVE final state for uniqueness validation.
    # If the payload omits position/level_id/subcategory, fall back to the
    # participant's current value so that moving an already-ranked participant
    # into a different level still validates against the destination's
    # existing winners.
    effective_position = (
        new_data["position"] if "position" in new_data else _norm_pos(target.get("position"))
    )
    effective_level = (
        new_data["level_id"] if "level_id" in new_data else target.get("level_id")
    )
    effective_sub = (
        new_data["subcategory"] if "subcategory" in new_data else target.get("subcategory")
    )
    effective_sub = (effective_sub or None)

    # Validate subcategory: when the tournament defines them, the effective
    # subcategory must be one of them (and non-empty).
    t_subs = [s for s in (t.get("subcategories") or []) if s]
    if t_subs:
        if not effective_sub:
            raise HTTPException(status_code=400, detail="يجب اختيار التصنيف الفرعي")
        if effective_sub not in t_subs:
            raise HTTPException(status_code=400, detail="التصنيف الفرعي غير موجود في هذه البطولة")

    # Identity uniqueness on (member_id, subcategory) — only relevant when
    # subcategory actually changed. Block conflicts with another row.
    if "subcategory" in new_data and effective_sub != (target.get("subcategory") or None):
        for p in parts:
            if p is target:
                continue
            if p.get("member_id") == member_id and (p.get("subcategory") or None) == effective_sub:
                raise HTTPException(status_code=400, detail="العضو مضاف بالفعل في هذا التصنيف")

    # Capacity per (subcategory, level) on moves between groups.
    moved_group = (
        ("subcategory" in new_data and effective_sub != (target.get("subcategory") or None))
        or ("level_id" in new_data and effective_level != target.get("level_id"))
    )
    if t_subs and moved_group and effective_sub and effective_level:
        cap = int(t.get("subcategory_capacity") or 6)
        used = sum(
            1 for p in parts
            if p is not target
            and (p.get("subcategory") or None) == effective_sub
            and p.get("level_id") == effective_level
        )
        if used >= cap:
            raise HTTPException(
                status_code=400,
                detail=f"السعة القصوى لهذا المستوى في هذا التصنيف ({cap}) ممتلئة",
            )

    # Ranked position uniqueness per (subcategory, level).
    if effective_position in RANKED_POSITIONS:
        for p in parts:
            if p is target:
                continue
            if (
                p.get("level_id") == effective_level
                and (p.get("subcategory") or None) == (effective_sub or None)
                and _norm_pos(p.get("position")) == effective_position
            ):
                raise HTTPException(status_code=400, detail="هذا المركز محجوز لمشارك آخر في نفس المستوى")

    target.update(new_data)
    await db.tournaments.update_one(
        {"id": tournament_id},
        {"$set": {"participants": parts, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await _log_activity("update_participant", current_user, {
        "tournament_id": tournament_id, "member_id": member_id,
        "changes": new_data
    })
    # Congratulate when a ranked position is freshly assigned/changed
    notification_summary = None
    if notify_member and "position" in new_data:
        new_pos = new_data.get("position")
        if new_pos in RANKED_POSITIONS and new_pos != prev_position:
            notification_summary = await _notify_result(t, member_id, new_pos)
            if notification_summary is not None:
                await _record_notification_log(
                    tournament_id=tournament_id,
                    notif_type="result",
                    summary=notification_summary,
                    current_user=current_user,
                    member_id=member_id,
                    member_name=await _resolve_member_name(member_id),
                )
    out = {"message": "Participant updated"}
    if notification_summary is not None:
        out["notification_summary"] = notification_summary
    return out


@router.delete("/{tournament_id}/participants/{member_id}")
async def remove_participant(
    tournament_id: str,
    member_id: str,
    subcategory: Optional[str] = None,
    current_user: dict = Depends(require_tournaments_permission),
):
    t = await _load_tournament_or_403(tournament_id, current_user)
    parts = t.get("participants") or []
    sub_filter = (subcategory or "").strip() or None

    # Confirm the participant exists *before* the update — `$set(updated_at)`
    # always changes the document, so `modified_count` alone cannot tell us
    # whether the `$pull` actually removed anything.
    if sub_filter is not None:
        match = any(
            p.get("member_id") == member_id and (p.get("subcategory") or None) == sub_filter
            for p in parts
        )
    else:
        match = any(p.get("member_id") == member_id for p in parts)
    if not match:
        raise HTTPException(status_code=404, detail="Participant not found")

    if sub_filter is not None:
        # Manual filter + $set so we can scope to (member_id, subcategory).
        new_parts = [
            p for p in parts
            if not (p.get("member_id") == member_id and (p.get("subcategory") or None) == sub_filter)
        ]
        await db.tournaments.update_one(
            {"id": tournament_id},
            {"$set": {"participants": new_parts, "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
    else:
        await db.tournaments.update_one(
            {"id": tournament_id},
            {"$pull": {"participants": {"member_id": member_id}},
             "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
        )
    await _log_activity("remove_participant", current_user, {
        "tournament_id": tournament_id, "member_id": member_id, "subcategory": sub_filter,
    })
    return {"message": "Participant removed"}


# ─── Notifications: resend & logs ────────────────

@router.post("/{tournament_id}/resend-announcement")
async def resend_announcement(
    tournament_id: str,
    current_user: dict = Depends(require_tournaments_permission),
):
    """Re-broadcast the tournament announcement to eligible members and
    return how many in-app/push deliveries succeeded or failed."""
    t = await _load_tournament_or_403(tournament_id, current_user)
    summary = await _broadcast_tournament_announcement(t)
    await _record_notification_log(
        tournament_id=tournament_id,
        notif_type="announcement",
        summary=summary,
        current_user=current_user,
    )
    await _log_activity("resend_announcement", current_user, {
        "tournament_id": tournament_id, "summary": summary,
    })
    return {"message": "Announcement resent", "notification_summary": summary}


@router.post("/{tournament_id}/resend-participant/{member_id}")
async def resend_participant_notification(
    tournament_id: str,
    member_id: str,
    kind: str = Query("auto", description="auto | registration | result"),
    current_user: dict = Depends(require_tournaments_permission),
):
    """Resend a direct notification to a single participant.

    ``kind`` controls which message: ``registration`` always re-sends the
    "you've been registered" DM; ``result`` re-sends the congratulations DM
    if the participant has a ranked position; ``auto`` (default) chooses
    ``result`` when a ranked position exists, otherwise ``registration``.
    """
    t = await _load_tournament_or_403(tournament_id, current_user)
    parts = t.get("participants") or []
    target = next((p for p in parts if p.get("member_id") == member_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Participant not found")

    pos = _norm_pos(target.get("position"))
    if kind == "auto":
        kind = "result" if pos in RANKED_POSITIONS else "registration"

    if kind == "result":
        if pos not in RANKED_POSITIONS:
            raise HTTPException(
                status_code=400,
                detail="لا يمكن إرسال إشعار نتيجة لمشارك بدون مركز مصنّف",
            )
        summary = await _notify_result(t, member_id, pos)
    elif kind == "registration":
        summary = await _notify_participant_added(t, member_id)
    else:
        raise HTTPException(status_code=400, detail="kind must be 'registration', 'result' or 'auto'")

    if summary is None:
        # Defensive: _notify_result can return None for non-ranked positions
        raise HTTPException(status_code=400, detail="Notification could not be sent")

    await _record_notification_log(
        tournament_id=tournament_id,
        notif_type=kind,
        summary=summary,
        current_user=current_user,
        member_id=member_id,
        member_name=await _resolve_member_name(member_id),
    )
    await _log_activity("resend_participant_notification", current_user, {
        "tournament_id": tournament_id, "member_id": member_id,
        "kind": kind, "summary": summary,
    })
    return {"message": "Notification resent", "kind": kind, "notification_summary": summary}


@router.get("/{tournament_id}/notification-logs")
async def list_notification_logs(
    tournament_id: str,
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(require_tournaments_permission),
):
    """Return delivery log entries for a tournament (most recent first)."""
    await _load_tournament_or_403(tournament_id, current_user)
    items = await db.tournament_notification_logs.find(
        {"tournament_id": tournament_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    return items


# ─── Exports ─────────────────────────────────────

POSITION_LABEL = {"1": "الأول", "2": "الثاني", "3": "الثالث", "participation": "مشاركة"}
RANKED_POSITIONS = ("1", "2", "3")


def _norm_pos(v):
    """Normalize a position value to canonical string form ('1'|'2'|'3'|'participation'|None)."""
    if v is None or v == "":
        return None
    if isinstance(v, int):
        return str(v) if v in (1, 2, 3) else None
    s = str(v).strip().lower()
    if s in ("1", "2", "3", "participation"):
        return s
    return None


def _pos_sort_key(v):
    n = _norm_pos(v)
    if n in RANKED_POSITIONS:
        return int(n)
    if n == "participation":
        return 50
    return 99


async def _log_activity(action: str, current_user: dict, details: dict) -> None:
    """Best-effort activity log; never raises."""
    try:
        await db.activity_logs.insert_one({
            "id": str(uuid.uuid4()),
            "category": "tournaments",
            "action": action,
            "user_id": current_user.get("id") or str(current_user.get("_id", "")),
            "user_name": current_user.get("username") or current_user.get("name") or "",
            "details": details or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass


@router.get("/{tournament_id}/export")
async def export_tournament(
    tournament_id: str,
    format: str = Query("xlsx", description="xlsx or pdf"),
    current_user: dict = Depends(require_tournaments_permission)
):
    if format not in ("xlsx", "pdf"):
        raise HTTPException(status_code=400, detail="format must be 'xlsx' or 'pdf'")
    t = await _load_tournament_or_403(tournament_id, current_user)
    t = await _enrich_participants(t)
    parts = t.get("participants") or []
    # Group by level for nicer output
    grouped: dict = {}
    for p in parts:
        key = p.get("level_label") or "بدون مستوى"
        grouped.setdefault(key, []).append(p)
    # Sort each group by position (1,2,3, then None)
    for k, lst in grouped.items():
        lst.sort(key=lambda x: (_pos_sort_key(x.get("position")), x.get("member_name") or ""))

    export_date = datetime.now().strftime("%Y-%m-%d")

    if format == "xlsx":
        xl = _get_openpyxl()
        wb = xl.Workbook()
        ws = wb.active
        ws.title = "كشف البطولة"

        orange_fill = xl.PatternFill("solid", fgColor="F97316")
        white_bold = xl.Font(bold=True, color="FFFFFF")
        bold = xl.Font(bold=True, size=12)
        alt_fill = xl.PatternFill("solid", fgColor="FFF7ED")
        thin = xl.Side(style='thin', color='DDDDDD')
        border = xl.Border(left=thin, right=thin, top=thin, bottom=thin)
        center = xl.Alignment(horizontal='center', vertical='center', wrap_text=True)
        right_align = xl.Alignment(horizontal='right', vertical='center', wrap_text=True)

        # Header block
        ws.append(["شركة اداء الابطال العالمية للرياضة"])
        ws.append([f"بطولة: {t.get('name','')}"])
        ws.append([
            f"التاريخ: {t.get('date') or '-'}    "
            f"المكان: {t.get('place') or '-'}    "
            f"النشاط: {t.get('activity_name') or '-'}"
        ])
        ws.append([f"تاريخ التصدير: {export_date}"])
        ws.append([])
        for r in range(1, 5):
            ws.cell(row=r, column=1).font = bold
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=7)
            ws.cell(row=r, column=1).alignment = right_align

        headers = ["م", "الاسم", "الهاتف", "كود العضو", "العمر", "الوزن", "المركز"]
        cur_row = 6
        for level_label, lst in grouped.items():
            ws.cell(row=cur_row, column=1, value=f"المستوى: {level_label}   (عدد المشاركين: {len(lst)})")
            ws.cell(row=cur_row, column=1).font = bold
            ws.merge_cells(start_row=cur_row, start_column=1, end_row=cur_row, end_column=7)
            ws.cell(row=cur_row, column=1).alignment = right_align
            cur_row += 1

            for c, h in enumerate(headers, 1):
                cell = ws.cell(row=cur_row, column=c, value=h)
                cell.fill = orange_fill
                cell.font = white_bold
                cell.alignment = center
                cell.border = border
            cur_row += 1

            for idx, p in enumerate(lst, 1):
                pos = _norm_pos(p.get("position"))
                pos_label = POSITION_LABEL.get(pos, "-") if pos else "-"
                row_vals = [
                    idx,
                    p.get("member_name", ""),
                    p.get("phone", ""),
                    p.get("member_code", ""),
                    p.get("age", ""),
                    p.get("weight", ""),
                    pos_label,
                ]
                for c, v in enumerate(row_vals, 1):
                    cell = ws.cell(row=cur_row, column=c, value=v)
                    cell.border = border
                    cell.alignment = center if c != 2 else right_align
                    if idx % 2 == 0:
                        cell.fill = alt_fill
                cur_row += 1

            cur_row += 1  # spacer between groups

        widths = [6, 28, 16, 14, 10, 10, 14]
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[chr(64 + i)].width = w

        buffer = BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        filename = f"tournament_{t.get('name','')}_{export_date}.xlsx"
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    # ── PDF ───────────────────────────
    rl = _get_reportlab()
    font_name = _register_arabic_font()
    buffer = BytesIO()
    doc = rl.SimpleDocTemplate(buffer, pagesize=rl.A4,
                               topMargin=15 * rl.mm, bottomMargin=15 * rl.mm,
                               leftMargin=12 * rl.mm, rightMargin=12 * rl.mm)
    title = rl.ParagraphStyle('T', fontName=font_name, fontSize=15, leading=20, alignment=1)
    sub = rl.ParagraphStyle('S', fontName=font_name, fontSize=10, leading=14,
                            textColor=rl.colors.HexColor('#555555'), alignment=2)
    section = rl.ParagraphStyle('Sec', fontName=font_name, fontSize=12, leading=16,
                                textColor=rl.colors.HexColor('#F97316'), alignment=2, spaceBefore=6, spaceAfter=4)
    cell = rl.ParagraphStyle('C', fontName=font_name, fontSize=9, leading=12, alignment=1)
    hdr = rl.ParagraphStyle('H', fontName=font_name, fontSize=9, leading=12,
                            textColor=rl.colors.white, alignment=1)

    elements = []
    elements.append(rl.Paragraph("شركة اداء الابطال العالمية للرياضة", title))
    elements.append(rl.Paragraph(f"بطولة: {t.get('name','')}", title))
    elements.append(rl.Paragraph(
        f"التاريخ: {t.get('date') or '-'} — المكان: {t.get('place') or '-'} — النشاط: {t.get('activity_name') or '-'}",
        sub
    ))
    elements.append(rl.Paragraph(f"تاريخ التصدير: {export_date}", sub))
    elements.append(rl.Spacer(1, 6 * rl.mm))

    pdf_headers = ["المركز", "الوزن", "العمر", "الهاتف", "الاسم", "م"]
    for level_label, lst in grouped.items():
        elements.append(rl.Paragraph(f"المستوى: {level_label}  ({len(lst)} مشاركين)", section))
        data = [[rl.Paragraph(h, hdr) for h in pdf_headers]]
        for idx, p in enumerate(lst, 1):
            pos = _norm_pos(p.get("position"))
            pos_label = POSITION_LABEL.get(pos, "-") if pos else "-"
            data.append([
                rl.Paragraph(pos_label, cell),
                rl.Paragraph(str(p.get("weight", "")), cell),
                rl.Paragraph(str(p.get("age", "")), cell),
                rl.Paragraph(str(p.get("phone", "")), cell),
                rl.Paragraph(str(p.get("member_name", "")), cell),
                rl.Paragraph(str(idx), cell),
            ])
        col_widths = [22 * rl.mm, 18 * rl.mm, 18 * rl.mm, 30 * rl.mm, 70 * rl.mm, 12 * rl.mm]
        table = rl.Table(data, colWidths=col_widths, repeatRows=1)
        table.setStyle(rl.TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), rl.colors.HexColor('#F97316')),
            ('TEXTCOLOR', (0, 0), (-1, 0), rl.colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.4, rl.colors.HexColor('#DDDDDD')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [rl.colors.white, rl.colors.HexColor('#FFF7ED')]),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        elements.append(table)
        elements.append(rl.Spacer(1, 4 * rl.mm))

    elements.append(rl.Spacer(1, 4 * rl.mm))
    elements.append(rl.Paragraph(f"إجمالي المشاركين: {len(parts)}", sub))

    doc.build(elements)
    buffer.seek(0)
    filename = f"tournament_{t.get('name','')}_{export_date}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/{tournament_id}/certificate/{member_id}")
async def participant_certificate(tournament_id: str, member_id: str, current_user: dict = Depends(require_tournaments_permission)):
    t = await _load_tournament_or_403(tournament_id, current_user)
    t = await _enrich_participants(t)
    p = next((x for x in (t.get("participants") or []) if x.get("member_id") == member_id), None)
    if not p:
        raise HTTPException(status_code=404, detail="Participant not found")

    rl = _get_reportlab()
    font_name = _register_arabic_font()
    buffer = BytesIO()
    page = rl.landscape(rl.A4)
    doc = rl.SimpleDocTemplate(buffer, pagesize=page,
                               topMargin=20 * rl.mm, bottomMargin=20 * rl.mm,
                               leftMargin=20 * rl.mm, rightMargin=20 * rl.mm)
    title = rl.ParagraphStyle('CT', fontName=font_name, fontSize=34, leading=44, alignment=1,
                              textColor=rl.colors.HexColor('#F97316'))
    sub = rl.ParagraphStyle('CS', fontName=font_name, fontSize=18, leading=24, alignment=1,
                            textColor=rl.colors.HexColor('#333333'))
    big = rl.ParagraphStyle('CN', fontName=font_name, fontSize=42, leading=54, alignment=1,
                            textColor=rl.colors.HexColor('#0F172A'))
    body = rl.ParagraphStyle('CB', fontName=font_name, fontSize=16, leading=24, alignment=1,
                             textColor=rl.colors.HexColor('#444444'))
    accent = rl.ParagraphStyle('CA', fontName=font_name, fontSize=22, leading=28, alignment=1,
                               textColor=rl.colors.HexColor('#F59E0B'))

    pos = _norm_pos(p.get("position"))
    pos_text = ""
    if pos in RANKED_POSITIONS:
        pos_text = f"المركز {POSITION_LABEL[pos]} 🏆"
    elif pos == "participation":
        pos_text = "شهادة مشاركة"

    elements = [
        rl.Spacer(1, 8 * rl.mm),
        rl.Paragraph("شهادة تقدير", title),
        rl.Spacer(1, 4 * rl.mm),
        rl.Paragraph("شركة اداء الابطال العالمية للرياضة", sub),
        rl.Spacer(1, 12 * rl.mm),
        rl.Paragraph("تُمنح هذه الشهادة إلى", body),
        rl.Spacer(1, 4 * rl.mm),
        rl.Paragraph(p.get("member_name", ""), big),
        rl.Spacer(1, 8 * rl.mm),
        rl.Paragraph(
            f"تقديراً لمشاركته في بطولة <b>{t.get('name','')}</b>"
            f" — {t.get('activity_name','')} — {p.get('level_label','')}",
            body
        ),
    ]
    if pos_text:
        elements.append(rl.Spacer(1, 6 * rl.mm))
        elements.append(rl.Paragraph(pos_text, accent))
    elements.append(rl.Spacer(1, 12 * rl.mm))
    elements.append(rl.Paragraph(
        f"بتاريخ {t.get('date') or datetime.now().strftime('%Y-%m-%d')}"
        f"  —  المكان: {t.get('place') or '-'}",
        sub
    ))

    doc.build(elements)
    buffer.seek(0)
    filename = f"certificate_{p.get('member_name','')}_{t.get('name','')}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
