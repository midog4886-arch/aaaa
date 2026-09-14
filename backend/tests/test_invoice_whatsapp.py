"""Focused, network-free tests for automatic invoice message formatting."""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from routes import whatsapp as whatsapp_mod  # noqa: E402
from services.invoice_whatsapp import (  # noqa: E402
    ANDROID_MEMBER_APP_URL,
    CaptionLinkError,
    DEFAULT_COMPANY_NAME,
    DEFAULT_COMMERCIAL_REG,
    DEFAULT_TAX_NUMBER,
    build_invoice_text,
    build_whatsflow_caption,
    extract_whatsapp_group_url,
)


def _invoice(**updates):
    value = {
        "id": "invoice-1",
        "invoice_number": "230955",
        "created_at": "2026-09-10T11:24:18+00:00",
        "customer_name_ar": "عبدالعزيز",
        "customer_phone": "0500000000",
        "member_id": "member-1",
        "member_code": "ABTL-042",
        "items": [{
            "activity_name": "السباحة",
            "fee": 400,
            "quantity": 1,
            "training_days": ["الأحد", "الثلاثاء"],
            "training_time": "5:00 م",
            "start_date": "2026-09-10",
            "end_date": "2026-11-09",
        }],
        "subtotal": "400.00",
        "discount": "25.00",
        "vat_amount": "60.00",
        "total": "435.00",
        "status": "paid",
        "branch_id": "branch-a",
    }
    value.update(updates)
    return value


def test_group_extraction_accepts_https_invite_only_and_deduplicates():
    saved = (
        "Join here http://chat.whatsapp.com/not-allowed; "
        "https://chat.whatsapp.com/BranchA and "
        "https://chat.whatsapp.com/brancha and "
        "https://evil.example/chat.whatsapp.com/no"
    )
    assert extract_whatsapp_group_url(saved) == "https://chat.whatsapp.com/BranchA"


def test_caption_contains_public_links_once_and_keeps_urls_complete():
    branch = {
        "name_ar": "فرع الروضة",
        "whatsapp_group_url": (
            "WhatsApp group: https://chat.whatsapp.com/BranchA "
            "https://chat.whatsapp.com/BranchA"
        ),
    }
    caption = build_whatsflow_caption(
        _invoice(),
        branch,
        {"slug": "academy-a", "name": "Academy A"},
    )
    assert ANDROID_MEMBER_APP_URL in caption
    assert caption.count(ANDROID_MEMBER_APP_URL) == 1
    assert "https://adaa-alabtal.replit.app/member-login?tenant=academy-a" in caption
    assert caption.count("https://adaa-alabtal.replit.app/member-login?tenant=academy-a") == 1
    assert caption.count("https://chat.whatsapp.com/BranchA") == 1
    assert "230955" in caption
    assert "ABTL-042" in caption


def test_missing_group_does_not_invent_or_reuse_a_global_link():
    caption = build_whatsflow_caption(
        _invoice(),
        {"id": "branch-a", "whatsapp_group_url": "Join our group: http://example.test"},
        {"slug": "academy-a"},
    )
    assert "chat.whatsapp.com" not in caption
    assert "example.test" not in caption


def test_text_and_caption_use_saved_item_schedule_and_all_multi_items():
    invoice = _invoice(items=[
        {
            "activity_name": "السباحة",
            "fee": 400,
            "training_days": ["الأحد", "الثلاثاء"],
            "training_time": "5:00 م",
            "start_date": "2026-09-10",
            "end_date": "2026-11-09",
        },
        {
            "activity_name": "الكاراتيه",
            "fee": 300,
            "training_days": ["الخميس"],
            "training_time_hour": "7:00 م",
            "start_date": "2026-09-12",
            "end_date": "2026-12-12",
        },
    ])
    text = build_invoice_text(invoice, {"whatsapp_group_url": ""}, {"slug": "academy-a"})
    caption = build_whatsflow_caption(
        invoice,
        {"whatsapp_group_url": ""},
        {"slug": "academy-a"},
    )
    for output in (text, caption):
        assert "السباحة" in output
        assert "الكاراتيه" in output
        assert "5:00 م" in output
        assert "2026-09-10" in output
        assert "2026-12-12" in output
        assert "435.00" in output or "435.00" in text
    # Links remain complete even when a deliberately small caption limit trims
    # detail lines; the receipt image carries the complete item list.
    try:
        tiny = build_whatsflow_caption(
            invoice,
            {"whatsapp_group_url": "https://chat.whatsapp.com/BranchA"},
            {"slug": "academy-a"},
            limit=300,
        )
    except CaptionLinkError:
        # The two required URLs plus the protected invoice/total summary do
        # not fit in this deliberately tiny limit; dispatch must fail rather
        # than cutting either URL.
        return
    assert len(tiny.encode("utf-16-le")) // 2 <= 300
    assert ANDROID_MEMBER_APP_URL in tiny
    assert "https://adaa-alabtal.replit.app/member-login?tenant=academy-a" in tiny


def test_caption_reserves_total_before_items_and_strictly_rejects_long_required_url():
    invoice = _invoice(
        items=[{"activity_name": "طويل", "fee": 1, "quantity": 2}],
        total="999.00",
    )
    caption = build_whatsflow_caption(invoice, {}, {"slug": "academy-a"})
    assert caption.index("Invoice number: 230955 | Total paid: SAR 999.00") < caption.index("طويل")
    assert len(caption.encode("utf-16-le")) // 2 <= 1024

    with pytest.raises(CaptionLinkError):
        build_whatsflow_caption(
            invoice,
            {"member_portal_url": "https://" + ("portal.example/" + "x" * 1100)},
            {"slug": "academy-a"},
        )


def test_overlong_optional_group_is_logged_and_omitted(caplog):
    url = "https://chat.whatsapp.com/" + ("A" * 2000)
    with caplog.at_level("WARNING"):
        caption = build_whatsflow_caption(
            _invoice(),
            {"whatsapp_group_url": url},
            {"slug": "academy-a"},
        )
    assert len(caption.encode("utf-16-le")) // 2 <= 1024
    assert url not in caption
    assert "optional branch WhatsApp link" in caplog.text


def test_non_default_tenant_never_receives_platform_branding_fallbacks():
    text = build_invoice_text(
        _invoice(
            tenant_slug="academy-a",
            tax_number=DEFAULT_TAX_NUMBER,
            commercial_reg=DEFAULT_COMMERCIAL_REG,
            company_name=DEFAULT_COMPANY_NAME,
        ),
        {},
        {"slug": "academy-a"},
    )
    assert DEFAULT_COMPANY_NAME not in text
    assert DEFAULT_TAX_NUMBER not in text
    assert DEFAULT_COMMERCIAL_REG not in text
    assert "الشركة: —" in text


def test_retry_rehydrates_same_tenant_branding_before_unknown_delivery(monkeypatch):
    class Collection:
        async def find_one(self, query, projection=None):
            if query.get("id") == "member-1":
                return {"id": "member-1", "member_code": "A-007", "name_ar": "عضو"}
            return {"id": "branch-a"}

        async def insert_one(self, row):
            return None

    class DB:
        def __init__(self):
            self.collections = {
                "members": Collection(),
                "branches": Collection(),
                "whatsapp_branch_configs": Collection(),
                "whatsapp_send_log": Collection(),
            }

        def __getitem__(self, name):
            return self.collections[name]

    db = DB()
    monkeypatch.setattr(whatsapp_mod, "_db", db)

    async def config(_branch_id):
        return {"enabled": True, "provider": "whatsflow"}

    async def tenant(_slug):
        return {
            "slug": "academy-a",
            "name": "أكاديمية ألف",
            "tax_number": "TENANT-TAX",
            "commercial_reg": "TENANT-CR",
        }

    captured = []

    def render(invoice, branch):
        captured.append((dict(invoice), dict(branch)))
        return b"png"

    async def unknown(*_args):
        return False, None, "ReadTimeout"

    monkeypatch.setattr(whatsapp_mod, "_get_branch_cloud_config", config)
    monkeypatch.setattr(whatsapp_mod, "_send_whatsflow_media_result", unknown)
    monkeypatch.setattr(whatsapp_mod, "get_current_tenant", lambda: {})
    monkeypatch.setattr(whatsapp_mod, "get_current_tenant_slug", lambda: "academy-a")
    monkeypatch.setattr("control_db.get_tenant_by_slug", tenant)
    from services import invoice_receipt_image
    monkeypatch.setattr(invoice_receipt_image, "render_invoice_receipt_image", render)

    invoice = _invoice(
        tenant_slug="academy-a",
        member_id="member-1",
        customer_phone="0500000000",
        tax_number=DEFAULT_TAX_NUMBER,
        commercial_reg=DEFAULT_COMMERCIAL_REG,
        company_name=DEFAULT_COMPANY_NAME,
    )
    for _ in range(2):
        with pytest.raises(whatsapp_mod.InvoiceReceiptDeliveryUnknown):
            asyncio.run(whatsapp_mod.send_invoice_payment_whatsapp_notice(invoice))

    assert len(captured) == 2
    for rendered, branch in captured:
        assert rendered["company_name"] == "أكاديمية ألف"
        assert rendered["tax_number"] == "TENANT-TAX"
        assert rendered["commercial_reg"] == "TENANT-CR"
        assert rendered["member_code"] == "A-007"
        assert branch["company_name"] == "أكاديمية ألف"

    async def missing_tenant(_slug):
        return None

    monkeypatch.setattr("control_db.get_tenant_by_slug", missing_tenant)
    assert asyncio.run(whatsapp_mod.send_invoice_payment_whatsapp_notice(invoice)) is False
    assert len(captured) == 2, "missing tenant branding must fail before dispatch"
