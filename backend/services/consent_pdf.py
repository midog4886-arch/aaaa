"""Render an immutable signed activity consent as a downloadable PDF."""

import base64
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


FONT_PATH = Path(__file__).resolve().parent / "fonts" / "DejaVuSans.ttf"
FONT_BOLD_PATH = Path(__file__).resolve().parent / "fonts" / "DejaVuSans-Bold.ttf"


def _font():
    if "ConsentArabic" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("ConsentArabic", str(FONT_PATH)))
        pdfmetrics.registerFont(TTFont("ConsentArabicBold", str(FONT_BOLD_PATH)))
    return "ConsentArabic"


def _ar(value):
    return escape(get_display(arabic_reshaper.reshape(str(value or ""))))


def _en(value):
    return escape(str(value or ""))


def _arabic_paragraph(value, style, max_width):
    """Wrap logical words before bidi shaping so PDF line order stays correct."""
    lines = []
    current = ""
    for word in str(value or "").split():
        candidate = f"{current} {word}" if current else word
        visual = get_display(arabic_reshaper.reshape(candidate))
        if current and pdfmetrics.stringWidth(visual, style.fontName, style.fontSize) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return Paragraph("<br/>".join(_ar(line) for line in lines) or "—", style)


def render_signed_consent_pdf(signed):
    """Use the stored signed snapshot, never the mutable current invoice or terms."""
    font = _font()
    snapshot = signed.get("invoice_snapshot") or {}
    fields = signed.get("fields") or {}
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=17 * mm, rightMargin=17 * mm,
        topMargin=16 * mm, bottomMargin=17 * mm,
        title=str(signed.get("title") or "استمارة تسجيل نشاط"),
    )
    width = A4[0] - 34 * mm
    title = ParagraphStyle("ConsentTitle", fontName="ConsentArabicBold", fontSize=16, leading=23, alignment=2, textColor=colors.HexColor("#302475"), spaceAfter=3 * mm)
    heading = ParagraphStyle("ConsentHeading", fontName="ConsentArabicBold", fontSize=11, leading=17, alignment=2, textColor=colors.HexColor("#302475"), spaceBefore=4 * mm, spaceAfter=2 * mm)
    arabic = ParagraphStyle("ConsentArabicText", fontName=font, fontSize=8.5, leading=13, alignment=2, spaceAfter=1 * mm)
    english = ParagraphStyle("ConsentEnglishText", fontName=font, fontSize=7.5, leading=10.5, alignment=0, textColor=colors.HexColor("#52617b"), spaceAfter=1 * mm)
    small = ParagraphStyle("ConsentSmall", fontName=font, fontSize=8, leading=12, alignment=2)

    story = []
    if signed.get("invoice_snapshots"):
        family_logo = Path("/app/static/images/academy-logo.png")
        if not family_logo.exists():
            family_logo = Path(__file__).resolve().parents[2] / "frontend/public/images/academy-logo.png"
        if family_logo.exists():
            logo = Image(str(family_logo), width=15 * mm, height=15 * mm, kind="proportional")
            logo.hAlign = "RIGHT"
            story.append(logo)
        story.append(Paragraph(_ar(signed.get("company_name")), title))
        story.append(Paragraph(_en(signed.get("company_name_en")), english))
        story.append(Paragraph(_ar(signed.get("title")), heading))
        story.append(_arabic_paragraph(f"وقت التوقيع: {signed.get('signed_at', '—')} | إصدار البنود: {signed.get('terms_version', '—')}", small, width))
        fields = signed.get("fields") or {}
        story.append(Paragraph(_ar("بيانات ولي الأمر"), heading))
        for label, value in (("الاسم", fields.get("guardian_name")), ("صلة القرابة", fields.get("relationship")),
                             ("رقم الهوية أو الإقامة", fields.get("guardian_identity"))):
            story.append(_arabic_paragraph(f"{label}: {value or '—'}", arabic, width))
        children = {row.get("invoice_id"): row for row in fields.get("children", [])}
        for index, snapshot in enumerate(signed["invoice_snapshots"], 1):
            child = children.get(snapshot.get("id"), {})
            section = [Paragraph(_ar(f"الطفل {index}: {child.get('child_name') or snapshot.get('customer_name_ar') or '—'}"), heading),
                       _arabic_paragraph(f"تاريخ الميلاد: {child.get('birth_date') or '—'} | فاتورة رقم: {snapshot.get('invoice_number') or '—'}", arabic, width)]
            for item in snapshot.get("items") or []:
                if not item.get("is_product"):
                    section.append(_arabic_paragraph(f"النشاط: {item.get('activity_name') or '—'} | {item.get('schedule') or '—'} | {item.get('start_date') or '—'} - {item.get('end_date') or '—'}", arabic, width))
            section.append(_arabic_paragraph(f"الحالة الصحية: {child.get('medical_details') if child.get('has_medical_condition') else 'لا توجد حالة مُفصح عنها'}", arabic, width))
            story.append(KeepTogether(section))
        story.append(Paragraph(_ar("الشروط والإقرار"), heading))
        for index, term in enumerate(signed.get("terms") or [], 1):
            story.append(_arabic_paragraph(f"{index}. {term.get('section', '')}: {term.get('text', '')}", arabic, width))
            story.append(Paragraph(_en(f"{term.get('section_en', '')}: {term.get('text_en', '')}"), english))
        story.append(_arabic_paragraph(signed.get("declaration"), arabic, width))
        story.append(Paragraph(_en(signed.get("declaration_en")), english))
        signature_bytes = base64.b64decode((signed.get("signature_png") or "").partition(",")[2], validate=True)
        story.append(KeepTogether([Paragraph(_ar("توقيع ولي الأمر"), heading),
                                   _arabic_paragraph(f"الموقّع: {signed.get('signer_name') or '—'}", arabic, width),
                                   Image(BytesIO(signature_bytes), width=60 * mm, height=20 * mm, kind="proportional")]))
        doc.build(story)
        buffer.seek(0)
        return buffer
    logo_path = Path("/app/static/images/academy-logo.png")
    if not logo_path.exists():
        logo_path = Path(__file__).resolve().parents[2] / "frontend/public/images/academy-logo.png"
    if logo_path.exists():
        logo = Image(str(logo_path), width=15 * mm, height=15 * mm, kind="proportional")
        logo.hAlign = "RIGHT"
        story.append(logo)
    story.extend([Paragraph(_ar(signed.get("company_name")), title),
             Paragraph(_en(signed.get("company_name_en")), english),
             Paragraph(_ar(signed.get("title")), heading),
             Paragraph(_en(signed.get("title_en")), english)])
    if snapshot.get("commercial_reg"):
        story.append(Paragraph(_ar(f"السجل التجاري: {snapshot['commercial_reg']}"), small))
    story.append(Paragraph(_ar(f"فاتورة رقم {snapshot.get('invoice_number', '—')}  |  النسخة {signed.get('version', '—')}  |  وقت التوقيع UTC: {signed.get('signed_at', '—')}"), small))
    story.append(Paragraph(_ar(f"معرّف الفاتورة المحفوظة: {str(signed.get('invoice_hash') or '—')[:20]}  |  إصدار البنود: {signed.get('terms_version', '—')}"), small))
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph(_ar("بيانات التسجيل"), heading))
    details = [
        ("الطفل", fields.get("child_name")),
        ("تاريخ الميلاد", fields.get("birth_date") or "—"),
        ("ولي الأمر", fields.get("guardian_name")),
        ("صلة القرابة", fields.get("relationship")),
        ("رقم الهوية أو الإقامة", fields.get("guardian_identity")),
        ("الجوال", snapshot.get("customer_phone")),
    ]
    if fields.get("emergency_phone"):
        details.append(("رقم الطوارئ", fields["emergency_phone"]))
    table = Table([[_arabic_paragraph(value or "—", arabic, width * .72 - 14), Paragraph(_ar(label), small)] for label, value in details], colWidths=[width * .72, width * .28], hAlign="RIGHT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f5f3ff")),
        ("LINEBELOW", (0, 0), (-1, -2), .3, colors.HexColor("#e1dcf3")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(table)

    story.append(Paragraph(_ar("الأنشطة والفاتورة"), heading))
    for item in snapshot.get("items") or []:
        line = " | ".join(str(value) for value in (
            item.get("activity_name") or item.get("name") or "—",
            item.get("schedule") or "—",
            f"{item.get('start_date') or '—'} - {item.get('end_date') or '—'}",
            f"{item.get('fee') or 0} ر.س",
        ))
        story.append(_arabic_paragraph(line, arabic, width))
    story.append(Paragraph(_ar(f"الإجمالي وقت التوقيع: {snapshot.get('total', 0)} ر.س"), small))

    story.append(Paragraph(_ar("الحالة الصحية"), heading))
    health = fields.get("medical_details") if fields.get("has_medical_condition") else "لا توجد حالة مُفصح عنها"
    story.append(_arabic_paragraph(health or "—", arabic, width))

    story.append(Paragraph(_ar("الشروط والإقرار"), heading))
    for index, term in enumerate(signed.get("terms") or [], 1):
        arabic_term = _arabic_paragraph(f"{index}. {term.get('section', '')}: {term.get('text', '')}", arabic, width)
        english_term = Paragraph(_en(f"{term.get('section_en', '')}: {term.get('text_en', '')}"), english)
        height = arabic_term.wrap(width, A4[1])[1] + english_term.wrap(width, A4[1])[1]
        pair = [arabic_term, english_term]
        story.extend(pair if height > A4[1] - 50 * mm else [KeepTogether(pair)])
    story.append(_arabic_paragraph(signed.get("declaration"), arabic, width))
    story.append(Paragraph(_en(signed.get("declaration_en")), english))

    signature = signed.get("signature_png") or ""
    signature_bytes = base64.b64decode(signature.partition(",")[2], validate=True)
    signature_image = Image(BytesIO(signature_bytes), width=60 * mm, height=20 * mm, kind="proportional")
    story.append(KeepTogether([
        Paragraph(_ar("التوقيع"), heading),
        _arabic_paragraph(f"الموقّع: {signed.get('signer_name') or '—'}", arabic, width),
        signature_image,
    ]))

    def footer(canvas, page_doc):
        canvas.setFont(font, 8)
        canvas.setFillColor(colors.HexColor("#6b7280"))
        canvas.drawCentredString(A4[0] / 2, 9 * mm, str(page_doc.page))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)
    return buffer
