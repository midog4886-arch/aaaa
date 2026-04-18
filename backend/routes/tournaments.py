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
    level_id: Optional[str] = None
    age: Optional[str] = ""
    weight: Optional[str] = ""
    # "1" / "2" / "3" / "participation" / None
    position: Optional[str] = None
    notes: Optional[str] = ""


class TournamentCreate(BaseModel):
    name: str
    place: Optional[str] = ""
    date: Optional[str] = ""  # YYYY-MM-DD
    activity_id: Optional[str] = None
    activity_name: Optional[str] = ""
    branch_id: Optional[str] = None
    description: Optional[str] = ""
    status: Optional[str] = "upcoming"  # upcoming | ongoing | completed


class ParticipantUpdate(BaseModel):
    level_id: Optional[str] = None
    age: Optional[str] = None
    weight: Optional[str] = None
    position: Optional[str] = None
    notes: Optional[str] = None


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
        })
    tournament["participants"] = enriched
    return tournament


# ============ ROUTES ============

@router.get("")
async def list_tournaments(
    branch_filter: Optional[str] = None,
    activity_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
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


@router.get("/{tournament_id}")
async def get_tournament(tournament_id: str, current_user: dict = Depends(get_current_user)):
    t = await _load_tournament_or_403(tournament_id, current_user)
    return await _enrich_participants(t)


@router.post("")
async def create_tournament(payload: TournamentCreate, current_user: dict = Depends(get_current_user)):
    is_admin = current_user.get("is_admin", False)
    if is_admin and payload.branch_id:
        final_branch_id = payload.branch_id if payload.branch_id != "all" else None
    else:
        final_branch_id = current_user.get("branch_id")

    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "place": payload.place or "",
        "date": payload.date or "",
        "activity_id": payload.activity_id,
        "activity_name": payload.activity_name or "",
        "branch_id": final_branch_id,
        "description": payload.description or "",
        "status": payload.status or "upcoming",
        "participants": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tournaments.insert_one(doc)
    cache_invalidate("tournaments:")
    await _log_activity("create_tournament", current_user, {
        "tournament_id": doc["id"], "name": doc["name"], "branch_id": final_branch_id
    })
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/{tournament_id}")
async def update_tournament(tournament_id: str, payload: TournamentCreate, current_user: dict = Depends(get_current_user)):
    await _load_tournament_or_403(tournament_id, current_user)
    update = {
        "name": payload.name,
        "place": payload.place or "",
        "date": payload.date or "",
        "activity_id": payload.activity_id,
        "activity_name": payload.activity_name or "",
        "description": payload.description or "",
        "status": payload.status or "upcoming",
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
async def delete_tournament(tournament_id: str, current_user: dict = Depends(get_current_user)):
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
async def add_participant(tournament_id: str, participant: Participant, current_user: dict = Depends(get_current_user)):
    t = await _load_tournament_or_403(tournament_id, current_user)

    existing = t.get("participants") or []
    if any(p.get("member_id") == participant.member_id for p in existing):
        raise HTTPException(status_code=400, detail="العضو مضاف بالفعل في هذه البطولة")

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

    new_part = participant.model_dump()
    new_part["position"] = _norm_pos(new_part.get("position"))

    # If position is a ranked one (1/2/3), it must be unique per level inside this tournament.
    # "participation" can be assigned to any number of members.
    if new_part["position"] in RANKED_POSITIONS:
        for p in existing:
            if p.get("level_id") == participant.level_id and _norm_pos(p.get("position")) == new_part["position"]:
                raise HTTPException(status_code=400, detail="هذا المركز محجوز لمشارك آخر في نفس المستوى")

    await db.tournaments.update_one(
        {"id": tournament_id},
        {"$push": {"participants": new_part}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await _log_activity("add_participant", current_user, {
        "tournament_id": tournament_id, "member_id": participant.member_id,
        "position": new_part["position"]
    })
    return {"message": "Participant added"}


@router.put("/{tournament_id}/participants/{member_id}")
async def update_participant(tournament_id: str, member_id: str, payload: ParticipantUpdate, current_user: dict = Depends(get_current_user)):
    t = await _load_tournament_or_403(tournament_id, current_user)

    parts = t.get("participants") or []
    target = next((p for p in parts if p.get("member_id") == member_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Participant not found")

    new_data = payload.model_dump(exclude_unset=True)
    if "position" in new_data:
        new_data["position"] = _norm_pos(new_data["position"])

    # Ranked position uniqueness per level (within this tournament).
    if new_data.get("position") in RANKED_POSITIONS:
        target_level = new_data.get("level_id", target.get("level_id"))
        for p in parts:
            if p.get("member_id") == member_id:
                continue
            if p.get("level_id") == target_level and _norm_pos(p.get("position")) == new_data["position"]:
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
    return {"message": "Participant updated"}


@router.delete("/{tournament_id}/participants/{member_id}")
async def remove_participant(tournament_id: str, member_id: str, current_user: dict = Depends(get_current_user)):
    await _load_tournament_or_403(tournament_id, current_user)
    res = await db.tournaments.update_one(
        {"id": tournament_id},
        {"$pull": {"participants": {"member_id": member_id}},
         "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=404, detail="Participant not found")
    await _log_activity("remove_participant", current_user, {
        "tournament_id": tournament_id, "member_id": member_id
    })
    return {"message": "Participant removed"}


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
    current_user: dict = Depends(get_current_user)
):
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
async def participant_certificate(tournament_id: str, member_id: str, current_user: dict = Depends(get_current_user)):
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
