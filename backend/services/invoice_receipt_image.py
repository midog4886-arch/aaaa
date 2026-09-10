"""Render invoice data as an in-memory PNG receipt.

The renderer deliberately does not write temporary/public files.  Pillow builds
without libraqm are common in our deployment image, so the small Arabic shaper
below is used when RAQM is unavailable.  It keeps Arabic joined and in visual
right-to-left order while preserving embedded numbers.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path
import re
from typing import Any

from PIL import Image, ImageDraw, ImageFont, features


WIDTH = 900
MARGIN = 54
INK = "#172033"
MUTED = "#5d6678"
ACCENT = "#176b5b"
PALE = "#edf7f4"
RULE = "#d9e2e8"

# isolated, final, initial, medial Arabic presentation forms.  DejaVu Sans
# contains these glyphs.  None means that the letter cannot join on that side.
_FORMS = {
    "ء": ("\ufe80", None, None, None), "آ": ("\ufe81", "\ufe82", None, None),
    "أ": ("\ufe83", "\ufe84", None, None), "ؤ": ("\ufe85", "\ufe86", None, None),
    "إ": ("\ufe87", "\ufe88", None, None), "ئ": ("\ufe89", "\ufe8a", "\ufe8b", "\ufe8c"),
    "ا": ("\ufe8d", "\ufe8e", None, None), "ب": ("\ufe8f", "\ufe90", "\ufe91", "\ufe92"),
    "ة": ("\ufe93", "\ufe94", None, None), "ت": ("\ufe95", "\ufe96", "\ufe97", "\ufe98"),
    "ث": ("\ufe99", "\ufe9a", "\ufe9b", "\ufe9c"), "ج": ("\ufe9d", "\ufe9e", "\ufe9f", "\ufea0"),
    "ح": ("\ufea1", "\ufea2", "\ufea3", "\ufea4"), "خ": ("\ufea5", "\ufea6", "\ufea7", "\ufea8"),
    "د": ("\ufea9", "\ufeaa", None, None), "ذ": ("\ufeab", "\ufeac", None, None),
    "ر": ("\ufead", "\ufeae", None, None), "ز": ("\ufeaf", "\ufeb0", None, None),
    "س": ("\ufeb1", "\ufeb2", "\ufeb3", "\ufeb4"), "ش": ("\ufeb5", "\ufeb6", "\ufeb7", "\ufeb8"),
    "ص": ("\ufeb9", "\ufeba", "\ufebb", "\ufebc"), "ض": ("\ufebd", "\ufebe", "\ufebf", "\ufec0"),
    "ط": ("\ufec1", "\ufec2", "\ufec3", "\ufec4"), "ظ": ("\ufec5", "\ufec6", "\ufec7", "\ufec8"),
    "ع": ("\ufec9", "\ufeca", "\ufecb", "\ufecc"), "غ": ("\ufecd", "\ufece", "\ufecf", "\ufed0"),
    "ف": ("\ufed1", "\ufed2", "\ufed3", "\ufed4"), "ق": ("\ufed5", "\ufed6", "\ufed7", "\ufed8"),
    "ك": ("\ufed9", "\ufeda", "\ufedb", "\ufedc"), "ل": ("\ufedd", "\ufede", "\ufedf", "\ufee0"),
    "م": ("\ufee1", "\ufee2", "\ufee3", "\ufee4"), "ن": ("\ufee5", "\ufee6", "\ufee7", "\ufee8"),
    "ه": ("\ufee9", "\ufeea", "\ufeeb", "\ufeec"), "و": ("\ufeed", "\ufeee", None, None),
    "ى": ("\ufeef", "\ufef0", None, None), "ي": ("\ufef1", "\ufef2", "\ufef3", "\ufef4"),
    # Common Persian/Urdu characters (their contextual forms are encoded in
    # the Arabic Presentation Forms blocks and supported by DejaVu Sans).
    "پ": ("\ufb56", "\ufb57", "\ufb58", "\ufb59"), "چ": ("\ufb7a", "\ufb7b", "\ufb7c", "\ufb7d"),
    "ژ": ("\ufb8a", "\ufb8b", None, None), "ک": ("\ufb8e", "\ufb8f", "\ufb90", "\ufb91"),
    "گ": ("\ufb92", "\ufb93", "\ufb94", "\ufb95"), "ی": ("\ufbfc", "\ufbfd", "\ufbfe", "\ufbff"),
}
_ARABIC_RE = re.compile(r"[\u0600-\u06ff]")
_LTR_TOKEN = r"[A-Za-z0-9\u0660-\u0669\u06f0-\u06f9][A-Za-z0-9\u0660-\u0669\u06f0-\u06f9.,:/@+_%#-]*"
_LTR_RUN_RE = re.compile(rf"{_LTR_TOKEN}(?: +{_LTR_TOKEN})*")
_MARKS = set(chr(i) for i in range(0x064B, 0x0660))


def _shape_arabic(text: str) -> str:
    # Neighbour lookups must always use the immutable logical input.  Looking
    # back into the output would see a presentation-form code point rather
    # than the original Arabic letter and break every join after the first.
    original = list(text)
    shaped = original.copy()
    for i, char in enumerate(original):
        forms = _FORMS.get(char)
        if not forms:
            continue
        p = i - 1
        while p >= 0 and original[p] in _MARKS:
            p -= 1
        n = i + 1
        while n < len(original) and original[n] in _MARKS:
            n += 1
        previous = _FORMS.get(original[p]) if p >= 0 else None
        following = _FORMS.get(original[n]) if n < len(original) else None
        joins_previous = bool(previous and previous[2] and forms[1])
        joins_following = bool(following and forms[2] and following[1])
        if joins_previous and joins_following and forms[3]:
            shaped[i] = forms[3]
        elif joins_previous and forms[1]:
            shaped[i] = forms[1]
        elif joins_following and forms[2]:
            shaped[i] = forms[2]
        else:
            shaped[i] = forms[0]
    return "".join(shaped)


def _basic_rtl(text: str) -> str:
    """Convert logical Arabic to visual order for Pillow's BASIC layout."""
    if not _ARABIC_RE.search(text):
        return text
    visual = _shape_arabic(text)[::-1]
    # Re-reverse Latin/numeric runs so invoice numbers and amounts remain
    # readable after the containing RTL line was reversed.
    return _LTR_RUN_RE.sub(lambda match: match.group(0)[::-1], visual)


def _font_path(bold: bool = False) -> str:
    filename = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    candidates = (
        Path(__file__).with_name("fonts") / filename,
        Path("/usr/share/fonts/truetype/dejavu") / filename,
        Path("/usr/local/share/fonts") / filename,
    )
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    # Pillow/fontconfig can resolve this on platforms where it is not at one
    # of the Linux paths above.
    return filename


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(_font_path(bold), size)
    except OSError as exc:
        raise RuntimeError("An Arabic-capable DejaVu Sans font is required") from exc


_HAS_RAQM = bool(features.check("raqm"))

STATUS_LABELS = {
    "paid": ("مدفوعة", "Paid"),
    "pending": ("غير مدفوعة", "Pending"),
    "partial": ("مدفوعة جزئياً", "Partially paid"),
    "cancelled": ("ملغاة", "Cancelled"),
    "refunded": ("مستردة", "Refunded"),
    "draft": ("مسودة", "Draft"),
}
PAYMENT_LABELS = {
    "cash": ("نقدي", "Cash"),
    "card": ("بطاقة", "Card"),
    "transfer": ("تحويل بنكي", "Bank transfer"),
    "bank_transfer": ("تحويل بنكي", "Bank transfer"),
    "stripe": ("دفع إلكتروني", "Online payment"),
    "split": ("دفع مقسّم", "Split payment"),
}


def _display(text: Any) -> tuple[str, dict[str, str]]:
    value = "" if text is None else str(text)
    if _HAS_RAQM:
        return value, {"direction": "rtl" if _ARABIC_RE.search(value) else "ltr"}
    return _basic_rtl(value), {}


def _translated_value(value: Any, labels: dict[str, tuple[str, str]],
                      empty: str = "—") -> tuple[str, str]:
    """Return Arabic/English display values without changing unknown saved data."""
    raw = empty if value in (None, "") else str(value)
    return labels.get(raw.lower(), (raw, raw))


def _measure(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> float:
    shown, kwargs = _display(text)
    return draw.textlength(shown, font=font, **kwargs)


def _wrap(draw: ImageDraw.ImageDraw, value: Any, font: ImageFont.FreeTypeFont,
          max_width: int) -> list[str]:
    text = " ".join(str(value or "").replace("\n", " ").split())
    if not text:
        return []
    lines: list[str] = []
    current = ""
    for word in text.split(" "):
        # Handle an over-wide token before attempting to add it to a line.
        # This is also required for the very first token, when ``current`` is
        # empty (the old implementation only split later tokens).
        if _measure(draw, word, font) > max_width:
            if current:
                lines.append(current)
                current = ""
            remainder = word
            while _measure(draw, remainder, font) > max_width and len(remainder) > 1:
                cut = 1
                while (cut < len(remainder)
                       and _measure(draw, remainder[:cut + 1], font) <= max_width):
                    cut += 1
                lines.append(remainder[:cut])
                remainder = remainder[cut:]
            current = remainder
            continue
        candidate = f"{current} {word}".strip()
        if current and _measure(draw, candidate, font) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def _money(value: Any) -> str:
    try:
        amount = Decimal(str(0 if value in (None, "") else value))
        return f"{amount:,.2f}"
    except (InvalidOperation, ValueError):
        return str(value)


def _date(value: Any) -> str:
    text = str(value or "")
    return text.replace("T", " ")[:19] if text else "—"


def render_invoice_receipt_image(invoice: dict, branch: dict | None = None) -> bytes:
    """Return a professional, dynamically-sized invoice receipt as PNG bytes.

    Monetary totals are read directly from ``invoice``; they are intentionally
    never recalculated from line items, preserving the issued invoice record.
    """
    if not isinstance(invoice, dict):
        raise TypeError("invoice must be a dict")
    branch = branch or {}
    items = invoice.get("items") or []
    if not isinstance(items, list):
        raise ValueError("invoice items must be a list")

    regular, small = _font(29), _font(24)
    bold, title = _font(30, True), _font(43, True)
    scratch = Image.new("RGB", (WIDTH, 100), "white")
    measure = ImageDraw.Draw(scratch)
    usable = WIDTH - 2 * MARGIN

    branch_name = (branch.get("name_ar") or branch.get("name")
                   or invoice.get("branch_name") or "")
    tax_number = (branch.get("tax_number") or branch.get("vat_number")
                  or invoice.get("tax_number") or "")
    customer = (invoice.get("customer_name_ar") or invoice.get("customer_name")
                or invoice.get("member_name") or "—")

    status_ar, status_en = _translated_value(invoice.get("status"), STATUS_LABELS)
    payment_raw = invoice.get("payment_method")
    payment_ar, payment_en = _translated_value(payment_raw, PAYMENT_LABELS, "")
    meta = [
        ("رقم الفاتورة", "Invoice number",
         invoice.get("invoice_number") or invoice.get("id") or "—"),
        ("التاريخ", "Date", _date(invoice.get("created_at") or invoice.get("paid_at"))),
        ("العميل", "Customer", customer),
    ]
    if payment_raw not in (None, ""):
        # Keep the English phrase out of the Arabic BASIC shaping path: without
        # RAQM, reversing a mixed line would turn "Bank transfer" into
        # "transfer Bank".
        meta.append(("طريقة الدفع", "Payment method", (payment_ar, payment_en)))
    if invoice.get("customer_phone"):
        meta.append(("الجوال", "Phone", invoice["customer_phone"]))
    if invoice.get("customer_address"):
        meta.append(("العنوان", "Address", invoice["customer_address"]))

    item_rows: list[dict[str, Any]] = []
    for index, raw in enumerate(items, 1):
        item = raw if isinstance(raw, dict) else {}
        quantity = 1 if item.get("quantity") is None else item.get("quantity")
        name = item.get("activity_name") or item.get("product_name") or item.get("name") or "بند"
        name_lines = _wrap(measure, f"{index}. {name}", bold, usable - 36)
        details: list[tuple[str, str, Any]] = []
        if item.get("member_name"):
            details.append(("المشترك", "Member", item["member_name"]))
        if item.get("level_name"):
            details.append(("المستوى", "Level", item["level_name"]))
        if item.get("period"):
            details.append(("المدة", "Period", item["period"]))
        if item.get("schedule"):
            details.append(("الجدول", "Schedule", item["schedule"]))
        if item.get("start_date") or item.get("end_date"):
            details.append(("بداية الاشتراك", "Subscription start",
                            _date(item.get("start_date"))))
            details.append(("نهاية الاشتراك", "Subscription end",
                            _date(item.get("end_date"))))
        if item.get("training_time") or item.get("training_time_hour"):
            details.append(("وقت التدريب", "Training time",
                            item.get("training_time") or item.get("training_time_hour")))
        detail_rows = []
        for ar_label, en_label, detail_value in details:
            value_lines = _wrap(measure, detail_value, small, usable - 210) or ["—"]
            detail_rows.append((ar_label, en_label, value_lines))
        fee = item.get("fee", item.get("price", 0))
        stored_line_total = next(
            (item[key] for key in ("total", "line_total", "amount")
             if key in item and item[key] is not None),
            None,
        )
        if stored_line_total is None:
            try:
                line_total = Decimal(str(fee or 0)) * Decimal(str(quantity))
            except (InvalidOperation, ValueError):
                line_total = fee
        else:
            line_total = stored_line_total
        amount_rows = [
            ("الكمية", "Quantity", str(quantity)),
            ("سعر الوحدة", "Unit price", f"{_money(fee)} SAR"),
            ("الإجمالي", "Total", f"{_money(line_total)} SAR"),
        ]
        detail_height = sum(max(1, len(lines)) * 31 + 27
                            for _, _, lines in detail_rows)
        amount_height = len(amount_rows) * 58
        height = 28 + len(name_lines) * 39 + detail_height + amount_height
        item_rows.append({"name": name_lines, "details": detail_rows,
                          "amount": amount_rows, "height": height})

    is_paid = str(invoice.get("status", "")).lower() == "paid"
    totals = [
        ("المجموع الفرعي", "Subtotal", invoice.get("subtotal", 0)),
        ("الخصم", "Discount",
         invoice.get("discount_amount", invoice.get("discount", 0))),
        ("ضريبة القيمة المضافة", "VAT", invoice.get("vat_amount", invoice.get("vat", 0))),
        ("الإجمالي المدفوع" if is_paid else "الإجمالي المستحق",
         "Total paid" if is_paid else "Total due", invoice.get("total", 0)),
    ]
    meta_rows = []
    for ar_label, en_label, value in meta:
        if isinstance(value, tuple):
            ar_lines = _wrap(measure, value[0], regular, usable // 2 - 30) or ["—"]
            en_lines = _wrap(measure, value[1], regular, usable // 2 - 30) or ["—"]
            lines: Any = (ar_lines, en_lines)
            line_count = max(len(ar_lines), len(en_lines))
        else:
            lines = _wrap(measure, value, regular, usable - 220) or ["—"]
            line_count = len(lines)
        meta_rows.append((ar_label, en_label, lines))
        meta_rows[-1] = (ar_label, en_label, lines, line_count)
    total_rows = []
    for label_ar, label_en, value in totals:
        amount_lines = _wrap(measure, f"{_money(value)} SAR", bold,
                             usable // 2 - 20) or ["—"]
        total_rows.append((label_ar, label_en, amount_lines,
                           max(70, len(amount_lines) * 35)))
    meta_height = sum(line_count * 36 + 30
                      for _, _, _, line_count in meta_rows)
    heading_height = 210 + (44 if branch_name else 0) + (66 if tax_number else 0)
    height = (MARGIN + heading_height + meta_height + 62
              + sum(row["height"] + 16 for row in item_rows)
              + sum(row_height for _, _, _, row_height in total_rows) + 115)

    image = Image.new("RGB", (WIDTH, max(height, 720)), "white")
    draw = ImageDraw.Draw(image)

    def rtl(x: int, y: int, text: Any, font: ImageFont.FreeTypeFont,
            fill: str = INK) -> None:
        shown, kwargs = _display(text)
        draw.text((x, y), shown, font=font, fill=fill, anchor="ra", **kwargs)

    def ltr(x: int, y: int, text: Any, font: ImageFont.FreeTypeFont,
            fill: str = INK) -> None:
        value = "" if text is None else str(text)
        kwargs = {"direction": "ltr"} if _HAS_RAQM else {}
        draw.text((x, y), value, font=font, fill=fill, anchor="la", **kwargs)

    def ltr_right(x: int, y: int, text: Any, font: ImageFont.FreeTypeFont,
                  fill: str = INK) -> None:
        value = "" if text is None else str(text)
        kwargs = {"direction": "ltr"} if _HAS_RAQM else {}
        draw.text((x, y), value, font=font, fill=fill, anchor="ra", **kwargs)

    def value_line(y_pos: int, value: Any, font: ImageFont.FreeTypeFont,
                   fill: str = INK) -> None:
        if _ARABIC_RE.search(str(value)):
            rtl(WIDTH - MARGIN - 18, y_pos, value, font, fill)
        else:
            ltr(MARGIN + 18, y_pos, value, font, fill)

    y = MARGIN
    draw.rounded_rectangle((MARGIN, y, WIDTH - MARGIN, y + 142), 22, fill=PALE)
    rtl(WIDTH - MARGIN - 24, y + 14, "إيصال دفع", title, ACCENT)
    ltr(MARGIN + 24, y + 14, "PAYMENT RECEIPT", title, ACCENT)
    rtl(WIDTH - MARGIN - 24, y + 75, f"الحالة: {status_ar}", small, MUTED)
    ltr(MARGIN + 24, y + 75, f"Status: {status_en}", small, MUTED)
    y += 162
    if branch_name:
        rtl(WIDTH - MARGIN, y, branch_name, bold)
        y += 44
    if tax_number:
        rtl(WIDTH - MARGIN, y, "الرقم الضريبي", small, MUTED)
        ltr(MARGIN, y, "Tax number", small, MUTED)
        ltr(MARGIN, y + 31, tax_number, small)
        y += 66
    draw.line((MARGIN, y + 8, WIDTH - MARGIN, y + 8), fill=RULE, width=2)
    y += 28
    for ar_label, en_label, lines, line_count in meta_rows:
        rtl(WIDTH - MARGIN, y, ar_label, small, MUTED)
        ltr(MARGIN, y, en_label, small, MUTED)
        y += 30
        if isinstance(lines, tuple):
            ar_lines, en_lines = lines
            for line_index in range(line_count):
                if line_index < len(ar_lines):
                    rtl(WIDTH - MARGIN - 18, y, ar_lines[line_index], regular)
                if line_index < len(en_lines):
                    ltr(MARGIN + 18, y, en_lines[line_index], regular)
                y += 36
        else:
            for line in lines:
                value_line(y, line, regular)
                y += 36
    y += 14
    rtl(WIDTH - MARGIN, y, "تفاصيل البنود", bold, ACCENT)
    ltr(MARGIN, y, "ITEM DETAILS", bold, ACCENT)
    y += 48

    for row in item_rows:
        top = y
        bottom = y + row["height"]
        draw.rounded_rectangle((MARGIN, top, WIDTH - MARGIN, bottom), 14,
                               fill="#fafcfd", outline=RULE, width=2)
        line_y = top + 15
        for line in row["name"]:
            rtl(WIDTH - MARGIN - 18, line_y, line, bold)
            line_y += 39
        for ar_label, en_label, lines in row["details"]:
            rtl(WIDTH - MARGIN - 18, line_y, ar_label, small, MUTED)
            ltr(MARGIN + 18, line_y, en_label, small, MUTED)
            line_y += 27
            for line in lines:
                value_line(line_y, line, small)
                line_y += 31
        for ar_label, en_label, amount_value in row["amount"]:
            rtl(WIDTH - MARGIN - 18, line_y, ar_label, small, MUTED)
            ltr(MARGIN + 18, line_y, en_label, small, MUTED)
            line_y += 27
            ltr(MARGIN + 18, line_y, amount_value, small, ACCENT)
            line_y += 31
        y = bottom + 16

    draw.line((MARGIN, y, WIDTH - MARGIN, y), fill=RULE, width=2)
    y += 18
    for index, (label_ar, label_en, amount_lines, row_height) in enumerate(total_rows):
        is_total = index == len(total_rows) - 1
        if is_total:
            draw.rounded_rectangle(
                (MARGIN, y - 7, WIDTH - MARGIN, y + row_height - 9), 10, fill=PALE
            )
        rtl(WIDTH - MARGIN - 16, y, label_ar, bold if is_total else regular,
            ACCENT if is_total else INK)
        ltr_right(WIDTH - MARGIN - 16, y + 33, label_en, small,
                  ACCENT if is_total else MUTED)
        amount_y = y
        for amount_line in amount_lines:
            ltr(MARGIN + 16, amount_y, amount_line, bold if is_total else regular,
                ACCENT if is_total else INK)
            amount_y += 35
        y += row_height
    rtl(WIDTH - MARGIN, y + 12, "شكراً لكم", small, MUTED)
    ltr(MARGIN, y + 12, "Thank you", small, MUTED)

    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()