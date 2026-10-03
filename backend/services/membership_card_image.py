"""Render the same member-code QR used by the printable membership card."""

from io import BytesIO

import qrcode
from PIL import Image, ImageDraw

from services.invoice_receipt_image import _display, _font


def render_membership_card_image(member: dict, company_name: str = "") -> bytes:
    code = str(member.get("member_code") or "").strip()
    if not code:
        raise ValueError("member_code_required")
    name = str(member.get("name_ar") or member.get("name") or "").strip()
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=10, border=2)
    qr.add_data(code)
    qr.make(fit=True)
    qr_image = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    qr_image = qr_image.resize((380, 380), Image.Resampling.NEAREST)
    image = Image.new("RGB", (600, 620), "white")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((18, 18, 582, 602), radius=25, outline="#e2e8f0", width=3)
    draw.text((300, 53), _display(company_name or "أكاديمية أداء الأبطال")[0],
              font=_font(22, True), fill="#ea580c", anchor="mm", **_display(company_name or "أكاديمية أداء الأبطال")[1])
    draw.text((300, 97), _display("كرت العضوية")[0], font=_font(24, True),
              fill="#172033", anchor="mm", **_display("كرت العضوية")[1])
    image.paste(qr_image, (110, 130))
    draw.text((300, 540), _display(name)[0], font=_font(24, True), fill="#172033",
              anchor="mm", **_display(name)[1])
    draw.text((300, 574), code, font=_font(20, True), fill="#ea580c", anchor="mm")
    out = BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()
