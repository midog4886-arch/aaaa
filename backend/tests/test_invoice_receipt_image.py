"""Isolated tests for the in-memory invoice receipt renderer."""

from io import BytesIO
import os
import sys

from PIL import Image, ImageChops

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.invoice_receipt_image import (  # noqa: E402
    PAYMENT_LABELS,
    STATUS_LABELS,
    _basic_rtl,
    _font,
    _shape_arabic,
    _translated_value,
    _wrap,
    render_invoice_receipt_image,
)


def _invoice(items=None, **updates):
    value = {
        "invoice_number": "INV-230955",
        "created_at": "2026-09-10T11:24:18+00:00",
        "customer_name_ar": "عبدالعزيز محمد",
        "customer_phone": "0500000000",
        "items": items or [{
            "activity_name": "اشتراك السباحة",
            "fee": 400,
            "quantity": 2,
            "period": "شهران",
            "start_date": "2026-09-10",
            "end_date": "2026-11-09",
        }],
        "subtotal": "800.00",
        "discount": "50.00",
        "vat_amount": "120.00",
        "total": "870.00",
        "status": "paid",
    }
    value.update(updates)
    return value


def test_returns_valid_rgb_png_without_mutating_invoice():
    invoice = _invoice()
    original = repr(invoice)
    data = render_invoice_receipt_image(
        invoice, {"name_ar": "فرع الرياض", "tax_number": "312655637900003"}
    )
    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    with Image.open(BytesIO(data)) as image:
        assert image.format == "PNG"
        assert image.mode == "RGB"
        assert image.width == 900
        assert image.height >= 720
    assert repr(invoice) == original


def test_arabic_fallback_is_joined_rtl_and_preserves_numbers():
    visual = _basic_rtl("فاتورة رقم INV-230955")
    assert visual != "فاتورة رقم INV-230955"
    assert any("\ufe70" <= char <= "\ufeff" for char in visual)
    assert "INV-230955" in visual


def test_arabic_shaping_uses_context_for_every_joined_letter():
    # بسم consists of initial, medial and final forms.  This exact regression
    # catches neighbour lookup against already-shaped output characters.
    assert _shape_arabic("بسم") == "\ufe91\ufeb4\ufee2"


def test_status_and_payment_labels_are_bilingual_and_unknown_values_preserved():
    assert STATUS_LABELS["partial"] == ("مدفوعة جزئياً", "Partially paid")
    assert PAYMENT_LABELS["transfer"] == ("تحويل بنكي", "Bank transfer")
    assert PAYMENT_LABELS["stripe"] == ("دفع إلكتروني", "Online payment")
    assert _translated_value("custom ledger state", STATUS_LABELS) == (
        "custom ledger state", "custom ledger state"
    )


def test_multiword_english_payment_label_is_not_reordered_by_basic_shaper():
    # English payment text is rendered on its own explicit LTR line. This
    # documents why it must not be interpolated into an Arabic label.
    arabic, english = _translated_value("bank_transfer", PAYMENT_LABELS)
    assert arabic == "تحويل بنكي"
    assert english == "Bank transfer"
    assert "Bank transfer" not in _basic_rtl(f"طريقة الدفع: {arabic}")


def test_multiword_english_saved_value_stays_ltr_inside_arabic_fallback():
    visual = _basic_rtl("اشتراك Sample training subscription")
    assert "Sample training subscription" in visual
    assert "subscription training Sample" not in visual


def test_wrap_splits_an_overwide_first_token():
    canvas = Image.new("RGB", (300, 100), "white")
    draw = __import__("PIL.ImageDraw", fromlist=["ImageDraw"]).Draw(canvas)
    font = _font(24)
    token = "اشتراك" * 20
    lines = _wrap(draw, token, font, 150)
    assert len(lines) > 1
    assert "".join(lines) == token
    assert all(draw.textlength(_basic_rtl(line), font=font) <= 150 for line in lines)


def test_height_grows_for_all_items_and_long_text_is_not_truncated():
    short = render_invoice_receipt_image(_invoice())
    many_items = [{
        "activity_name": f"اشتراك رياضي طويل جداً للمتدرب رقم {index} مع وصف إضافي",
        "fee": 125.25,
        "quantity": index % 3 + 1,
        "member_name": f"المشترك {index}",
        "period": "ثلاثة أشهر كاملة",
        "schedule": "الأحد والثلاثاء والخميس مساءً",
        "start_date": "2026-09-10",
        "end_date": "2026-12-10",
    } for index in range(1, 26)]
    long = render_invoice_receipt_image(_invoice(items=many_items))
    with Image.open(BytesIO(short)) as short_image, Image.open(BytesIO(long)) as long_image:
        assert long_image.height > short_image.height + 25 * 150
        # Footer/totals produce non-white pixels near the dynamically allocated
        # bottom, proving content was drawn rather than clipped at a fixed page.
        bottom = long_image.crop((0, long_image.height - 140, 900, long_image.height))
        white = Image.new("RGB", bottom.size, "white")
        assert ImageChops.difference(bottom, white).getbbox() is not None


def test_stored_totals_change_output_without_item_recalculation():
    invoice = _invoice(items=[{"activity_name": "منتج", "fee": 1, "quantity": 1}])
    first = render_invoice_receipt_image(invoice)
    invoice.update(subtotal="9,999.91", discount="111.12",
                   vat_amount="222.23", total="10,111.02")
    second = render_invoice_receipt_image(invoice)
    assert first != second


def test_stored_item_total_is_preserved_instead_of_recalculated():
    base = _invoice(items=[{
        "activity_name": "Custom adjustment",
        "fee": "100.00",
        "quantity": 2,
        "line_total": "175.50",
    }])
    stored = render_invoice_receipt_image(base)
    recalculated = render_invoice_receipt_image(
        _invoice(items=[{
            "activity_name": "Custom adjustment",
            "fee": "100.00",
            "quantity": 2,
            "line_total": "200.00",
        }])
    )
    assert stored != recalculated


def test_very_long_saved_total_expands_canvas_without_clipping():
    normal = render_invoice_receipt_image(_invoice())
    long_value = "9" * 180
    expanded = render_invoice_receipt_image(_invoice(total=long_value))
    with Image.open(BytesIO(normal)) as normal_image, Image.open(BytesIO(expanded)) as image:
        assert image.height > normal_image.height
        bottom = image.crop((0, image.height - 130, image.width, image.height))
        assert ImageChops.difference(
            bottom, Image.new("RGB", bottom.size, "white")
        ).getbbox() is not None


def test_empty_items_and_missing_optional_fields_still_render():
    data = render_invoice_receipt_image({
        "invoice_number": "1", "items": [], "subtotal": 0,
        "discount": 0, "vat_amount": 0, "total": 0,
    })
    with Image.open(BytesIO(data)) as image:
        image.verify()