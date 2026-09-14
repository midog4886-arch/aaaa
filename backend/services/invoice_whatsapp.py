"""Invoice-specific WhatsApp formatting.

This module deliberately contains only deterministic formatting and link
normalisation.  Delivery, outbox claiming, provider routing, and database
access stay in ``routes.whatsapp`` so invoice notifications retain their
existing retry/idempotency behaviour.
"""

from __future__ import annotations

import os
import re
import logging
from typing import Any, Iterable, Mapping
from urllib.parse import quote, urlparse

from utils.tenant import DEFAULT_TENANT_SLUG, get_current_tenant_slug


logger = logging.getLogger(__name__)

ANDROID_MEMBER_APP_URL = (
    "https://play.google.com/store/apps/details?id=com.champions.academy.member"
)
DEFAULT_PUBLIC_BASE_URL = "https://adaa-alabtal.replit.app"
DEFAULT_COMPANY_NAME = "شركة اداء الابطال العالمية للرياضة"
DEFAULT_TAX_NUMBER = "312655637900003"
DEFAULT_COMMERCIAL_REG = "7043630230"
# WhatsApp media captions are limited to 1,024 characters.  The transport
# itself does not expose a configurable limit, so this is kept here (rather
# than an arbitrary slice in the sender) and URLs are always protected from
# truncation by ``fit_media_caption`` below.
WHATSFLOW_CAPTION_LIMIT = 1024


class CaptionLinkError(ValueError):
    """Required caption links/details cannot fit without corrupting a URL."""

_GROUP_URL_RE = re.compile(
    r"https://chat\.whatsapp\.com/[A-Za-z0-9_-]+", re.IGNORECASE
)
_DEV_HOST_RE = re.compile(
    r"(^localhost$|^127\.0\.0\.1$|\.replit\.dev$|\.repl\.co$)", re.IGNORECASE
)


def _as_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()


def _saved_number(value: Any) -> str:
    """Render a saved amount without recalculating or changing it."""
    if value in (None, ""):
        return "0"
    return str(value)


def _has_positive_amount(value: Any) -> bool:
    try:
        return float(str(value).replace(",", "")) > 0
    except (TypeError, ValueError):
        return bool(value not in (None, "", 0, "0", "0.0", "0.00"))


def format_invoice_date(value: Any) -> str:
    """Return the saved invoice date in a compact, stable form."""
    text = _as_text(value)
    if not text:
        return "—"
    # Keep the invoice's saved timezone/date text; this is not a live member
    # activity date and should not be reconstructed from current membership.
    return text.replace("T", " ")[:19]


def extract_whatsapp_group_urls(value: Any) -> list[str]:
    """Extract unique real HTTPS WhatsApp invite URLs from saved prose.

    Branch settings have historically accepted free-form text, so a value can
    contain labels, duplicate links, or a pasted ``http://`` URL.  Only the
    actual HTTPS invite host is accepted, and insertion order is preserved.
    """
    if not isinstance(value, str):
        return []
    seen: set[str] = set()
    urls: list[str] = []
    for match in _GROUP_URL_RE.finditer(value):
        url = match.group(0)
        key = url.lower()
        if key in seen:
            continue
        seen.add(key)
        urls.append(url)
    return urls


def extract_whatsapp_group_url(value: Any) -> str:
    """Return one branch invite URL, never a global/fallback group."""
    urls = extract_whatsapp_group_urls(value)
    return urls[0] if urls else ""


def public_base_url() -> str:
    """Resolve the same public-origin family used by existing app helpers."""
    fallback = ""
    for name in (
        "REACT_APP_PUBLIC_BASE_URL",
        "PUBLIC_BASE_URL",
        "APP_BASE_URL",
        "REACT_APP_BACKEND_URL",
    ):
        value = (os.environ.get(name) or "").strip().rstrip("/")
        if value and not fallback:
            fallback = value
        host = urlparse(value).hostname if value else None
        if value and host and not _DEV_HOST_RE.search(host):
            return value
    domains = (os.environ.get("REPLIT_DOMAINS") or "").split(",")
    if domains and domains[0].strip():
        domain = domains[0].strip().rstrip("/")
        if not _DEV_HOST_RE.search(domain):
            return f"https://{domain}"
    # Preview hosts are not useful to customers.  Keep the same published
    # fallback as frontend/utils/publicUrl.js rather than sharing a random
    # development origin in an invoice.
    return DEFAULT_PUBLIC_BASE_URL if not fallback or _DEV_HOST_RE.search(
        urlparse(fallback).hostname or ""
    ) else fallback


def _tenant_slug(
    invoice: Mapping[str, Any],
    branch: Mapping[str, Any],
    tenant: Mapping[str, Any],
) -> str:
    explicit = (
        tenant.get("slug")
        or invoice.get("tenant_slug")
        or branch.get("tenant_slug")
    )
    return str(explicit or get_current_tenant_slug() or DEFAULT_TENANT_SLUG).strip().lower()


def _allow_platform_branding_defaults(
    invoice: Mapping[str, Any],
    branch: Mapping[str, Any],
    tenant: Mapping[str, Any],
) -> bool:
    """Only the legacy/default tenant may use platform branding constants."""
    return _tenant_slug(invoice, branch, tenant) == DEFAULT_TENANT_SLUG


def _branding_value(
    values: Iterable[Any],
    *,
    default: str,
    allow_default: bool,
) -> str:
    for value in values:
        text = _as_text(value)
        if not text:
            continue
        # Historical invoices contain the platform defaults.  Those values
        # must not leak into a non-default academy after tenant migration.
        if not allow_default and text in {
            DEFAULT_COMPANY_NAME,
            DEFAULT_TAX_NUMBER,
            DEFAULT_COMMERCIAL_REG,
        }:
            continue
        return text
    return default if allow_default else "—"


def member_portal_url(
    invoice: Mapping[str, Any] | None = None,
    branch: Mapping[str, Any] | None = None,
    tenant: Mapping[str, Any] | None = None,
) -> str:
    """Build a public member-login URL carrying the tenant when available.

    A saved tenant-provided portal URL wins.  The query parameter is consumed
    by the member login page before it makes its tenant-scoped API request;
    it prevents a link opened on a phone with another academy cached from
    logging into the wrong tenant.
    """
    invoice = invoice or {}
    branch = branch or {}
    tenant = tenant or {}
    explicit = (
        invoice.get("member_portal_url")
        or branch.get("member_portal_url")
        or tenant.get("member_portal_url")
    )
    if explicit:
        return str(explicit).strip()
    base = (
        invoice.get("public_base_url")
        or branch.get("public_base_url")
        or tenant.get("public_base_url")
        or public_base_url()
    )
    base = str(base).strip().rstrip("/")
    url = f"{base}/member-login"
    tenant_slug = _tenant_slug(invoice, branch, tenant)
    if tenant_slug and tenant_slug != DEFAULT_TENANT_SLUG:
        url += f"?tenant={quote(tenant_slug, safe='')}"
    return url


def invoice_links(
    invoice: Mapping[str, Any] | None = None,
    branch: Mapping[str, Any] | None = None,
    tenant: Mapping[str, Any] | None = None,
) -> list[tuple[str, str]]:
    """Return the customer-facing links in manual-invoice order."""
    branch = branch or {}
    raw_group = branch.get("whatsapp_group_url")
    group_url = extract_whatsapp_group_url(raw_group)
    if raw_group and not group_url and "chat.whatsapp.com" in str(raw_group).lower():
        logger.warning("Omitting invalid branch WhatsApp invite from invoice caption")
    return [
        ("تطبيق الأعضاء للأندرويد / Android member app", ANDROID_MEMBER_APP_URL),
        ("بوابة الأعضاء للايفون / Member portal for iPhone", member_portal_url(
            invoice, branch, tenant
        )),
        *([("مجموعة الواتساب / Branch WhatsApp group", group_url)] if group_url else []),
    ]


def _link_block(
    invoice: Mapping[str, Any],
    branch: Mapping[str, Any] | None,
    tenant: Mapping[str, Any] | None,
    limit: int = WHATSFLOW_CAPTION_LIMIT,
    include_optional: bool = True,
) -> str:
    links = invoice_links(invoice, branch, tenant)
    required = links[:2]
    if any(not url.lower().startswith("https://") for _, url in required):
        raise CaptionLinkError("required invoice link is not HTTPS")

    def render(rows: list[tuple[str, str]]) -> str:
        return "\n".join(
            line
            for label, url in rows
            for line in (f"{label}:", url)
        )

    required_block = render(required)
    if _caption_units(required_block) > limit:
        raise CaptionLinkError("required invoice links exceed caption limit")

    if include_optional and len(links) > len(required):
        optional = links[len(required):]
        optional_block = render(optional)
        candidate = f"{required_block}\n{optional_block}"
        if _caption_units(candidate) <= limit:
            return candidate
        logger.warning(
            "Omitting optional branch WhatsApp link from invoice caption: "
            "links exceed %d UTF-16 units",
            limit,
        )
    return required_block


def _item_days(item: Mapping[str, Any]) -> str:
    days = item.get("training_days")
    if isinstance(days, (list, tuple, set)):
        days_text = ", ".join(_as_text(day) for day in days if _as_text(day))
    elif days:
        days_text = _as_text(days)
    else:
        days_text = ""
    day_times = item.get("day_times")
    if isinstance(day_times, Mapping):
        timed = ", ".join(
            f"{_as_text(day)}: {_as_text(time)}"
            for day, time in day_times.items()
            if _as_text(day) and _as_text(time)
        )
        if timed:
            days_text = f"{days_text} ({timed})" if days_text else timed
    return days_text


def _item_detail_lines(item: Mapping[str, Any], language: str = "ar") -> list[str]:
    """Read only purchased item snapshots; never query/live-merge activities."""
    name = (
        item.get("activity_name")
        or item.get("product_name")
        or item.get("name")
        or "بند"
    )
    quantity = item.get("quantity", 1) or 1
    fee = item.get("fee", item.get("price", 0))
    days = _item_days(item)
    schedule = _as_text(item.get("schedule"))
    training_time = _as_text(item.get("training_time") or item.get("training_time_hour"))
    start = format_invoice_date(item.get("start_date"))
    end = format_invoice_date(item.get("end_date"))
    period = _as_text(item.get("period"))
    quantity_text = f" × {quantity}" if quantity != 1 else ""
    if language == "en":
        lines = [f"• {name}{quantity_text}: SAR {fee}"]
        if period:
            lines.append(f"  Period: {period}")
        if schedule:
            lines.append(f"  Schedule: {schedule}")
        if days:
            lines.append(f"  Days: {days}")
        if training_time:
            lines.append(f"  Training time: {training_time}")
        if item.get("start_date"):
            lines.append(f"  Start: {start}")
        if item.get("end_date"):
            lines.append(f"  End: {end}")
        return lines
    lines = [f"• {name}{quantity_text}: {fee} ر.س"]
    if period:
        lines.append(f"  المدة: {period}")
    if schedule:
        lines.append(f"  الجدول: {schedule}")
    if days:
        lines.append(f"  الأيام: {days}")
    if training_time:
        lines.append(f"  وقت التدريب: {training_time}")
    if item.get("start_date"):
        lines.append(f"  البداية: {start}")
    if item.get("end_date"):
        lines.append(f"  النهاية: {end}")
    return lines


def _item_lines(items: Iterable[Any], language: str) -> list[str]:
    lines: list[str] = []
    for raw in items:
        item = raw if isinstance(raw, Mapping) else {}
        lines.extend(_item_detail_lines(item, language))
    return lines


def build_invoice_text(
    invoice: Mapping[str, Any],
    branch: Mapping[str, Any] | None = None,
    tenant: Mapping[str, Any] | None = None,
) -> str:
    """Build the expanded bilingual text used by WAHA and Meta templates."""
    branch = branch or {}
    tenant = tenant or {}
    customer = (
        invoice.get("customer_name_ar")
        or invoice.get("customer_name")
        or invoice.get("member_name")
        or "—"
    )
    number = invoice.get("invoice_number") or invoice.get("id") or "—"
    member_code = invoice.get("member_code") or "—"
    date = format_invoice_date(invoice.get("created_at") or invoice.get("paid_at"))
    allow_default_branding = _allow_platform_branding_defaults(invoice, branch, tenant)
    company = _branding_value(
        (
            branch.get("company_name"),
            tenant.get("name"),
            invoice.get("company_name"),
        ),
        default=DEFAULT_COMPANY_NAME,
        allow_default=allow_default_branding,
    )
    tax_number = _branding_value(
        (invoice.get("tax_number"), branch.get("tax_number"), tenant.get("tax_number")),
        default=DEFAULT_TAX_NUMBER,
        allow_default=allow_default_branding,
    )
    commercial_reg = _branding_value(
        (
            invoice.get("commercial_reg"),
            branch.get("commercial_reg"),
            tenant.get("commercial_reg"),
        ),
        default=DEFAULT_COMMERCIAL_REG,
        allow_default=allow_default_branding,
    )
    items = _item_lines(invoice.get("items") or [], "ar")
    items_en = _item_lines(invoice.get("items") or [], "en")
    if not items:
        items = ["• تفاصيل الفاتورة محفوظة في حسابك"]
        items_en = ["• Invoice details are saved in your account"]
    discount = (
        f"\nالخصم: {_saved_number(invoice.get('discount'))} ر.س"
        if _has_positive_amount(invoice.get("discount"))
        else ""
    )
    discount_en = (
        f"\nDiscount: SAR {_saved_number(invoice.get('discount'))}"
        if _has_positive_amount(invoice.get("discount"))
        else ""
    )
    links = _link_block(invoice, branch, tenant)
    arabic = (
        f"{links}\n\n"
        f"الشركة: {company}\n"
        f"رقم الفاتورة: {number}\n"
        f"التاريخ: {date}\n"
        f"العميل: {customer}\n"
        f"رقم العضوية: {member_code}\n\n"
        f"البنود:\n" + "\n".join(items) + "\n\n"
        f"المجموع الفرعي: {_saved_number(invoice.get('subtotal'))} ر.س"
        f"{discount}\n"
        f"ضريبة القيمة المضافة: {_saved_number(invoice.get('vat_amount'))} ر.س\n"
        f"الإجمالي المدفوع: {_saved_number(invoice.get('total'))} ر.س\n"
        f"الرقم الضريبي: {tax_number}\nالسجل التجاري: {commercial_reg}"
    )
    english = (
        f"Your payment has been received successfully\n"
        f"Company: {company}\n"
        f"Invoice number: {number}\n"
        f"Date: {date}\n"
        f"Customer: {customer}\n"
        f"Member code: {member_code}\n\n"
        f"Items:\n" + "\n".join(items_en) + "\n\n"
        f"Subtotal: SAR {_saved_number(invoice.get('subtotal'))}"
        f"{discount_en}\n"
        f"VAT: SAR {_saved_number(invoice.get('vat_amount'))}\n"
        f"Total paid: SAR {_saved_number(invoice.get('total'))}\n"
        f"Tax No.: {tax_number}\nCR: {commercial_reg}"
    )
    return f"{arabic}\n\n— English —\n{english}"


def _caption_detail(
    invoice: Mapping[str, Any],
    branch: Mapping[str, Any] | None,
    tenant: Mapping[str, Any] | None,
) -> str:
    branch = branch or {}
    tenant = tenant or {}
    allow_default_branding = _allow_platform_branding_defaults(invoice, branch, tenant)
    company = _branding_value(
        (branch.get("company_name"), tenant.get("name"), invoice.get("company_name")),
        default=DEFAULT_COMPANY_NAME,
        allow_default=allow_default_branding,
    )
    customer = (
        invoice.get("customer_name_ar")
        or invoice.get("customer_name")
        or invoice.get("member_name")
        or "—"
    )
    number = invoice.get("invoice_number") or invoice.get("id") or "—"
    member_code = invoice.get("member_code") or "—"
    date = format_invoice_date(invoice.get("created_at") or invoice.get("paid_at"))
    tax_number = _branding_value(
        (invoice.get("tax_number"), branch.get("tax_number"), tenant.get("tax_number")),
        default=DEFAULT_TAX_NUMBER,
        allow_default=allow_default_branding,
    )
    commercial_reg = _branding_value(
        (
            invoice.get("commercial_reg"),
            branch.get("commercial_reg"),
            tenant.get("commercial_reg"),
        ),
        default=DEFAULT_COMMERCIAL_REG,
        allow_default=allow_default_branding,
    )
    items = _item_lines(invoice.get("items") or [], "ar") or ["• —"]
    return (
        "Your payment has been received successfully\n"
        f"Invoice number: {number} | Total paid: SAR {_saved_number(invoice.get('total'))}\n"
        f"الشركة: {company}\n"
        f"التاريخ: {date}\n"
        f"العميل: {customer}\n"
        f"رقم العضوية: {member_code}\n"
        "تفاصيل البنود:\n"
        + "\n".join(items)
        + "\n"
        f"المجموع الفرعي: {_saved_number(invoice.get('subtotal'))} SAR\n"
        f"الخصم: {_saved_number(invoice.get('discount'))} SAR\n"
        f"الضريبة: {_saved_number(invoice.get('vat_amount'))} SAR\n"
        f"الرقم الضريبي: {tax_number}\n"
        f"السجل التجاري: {commercial_reg}\n"
        "English:\n"
        f"Invoice number: {number}\n"
        "Items: see the detailed Arabic item lines above."
    )


def _caption_units(value: str) -> int:
    """Count WhatsApp caption units (UTF-16 code units, not Python codepoints)."""
    return len(value.encode("utf-16-le")) // 2


def fit_media_caption(
    links: str,
    details: str,
    limit: int = WHATSFLOW_CAPTION_LIMIT,
) -> str:
    """Fit a caption without ever cutting an invite/app/portal URL.

    ``links`` is kept as a complete prefix.  Details are shortened only at a
    line boundary; the full detail set remains in the attached receipt image.
    """
    if limit <= 0:
        raise CaptionLinkError("caption limit must be positive")
    links = links.rstrip()
    details = details.strip()
    if _caption_units(links) > limit:
        raise CaptionLinkError("required invoice links exceed caption limit")
    if not details:
        return links
    detail_lines = details.splitlines()
    # Keep payment confirmation and invoice/total summary together before any
    # item lines.  If even this required summary cannot fit, fail rather than
    # dispatching a caption that hides the amount being paid.
    required_detail = "\n".join(detail_lines[:2])
    required_candidate = f"{links}\n\n{required_detail}"
    if _caption_units(required_candidate) > limit:
        raise CaptionLinkError("invoice number/total summary cannot fit caption")
    if _caption_units(f"{links}\n\n{details}") <= limit:
        return f"{links}\n\n{details}"
    marker = "\n… Full invoice details are in the image."
    lines = detail_lines[:2]
    for line in detail_lines[2:]:
        candidate = f"{links}\n\n{chr(10).join(lines + [line])}{marker}"
        if _caption_units(candidate) > limit:
            break
        lines.append(line)
    candidate = f"{links}\n\n{chr(10).join(lines)}{marker}"
    if _caption_units(candidate) <= limit:
        return candidate
    # The summary itself fits by construction; omit optional detail lines and
    # the marker if necessary, never cutting a URL or sending over the limit.
    return required_candidate


def build_whatsflow_caption(
    invoice: Mapping[str, Any],
    branch: Mapping[str, Any] | None = None,
    tenant: Mapping[str, Any] | None = None,
    limit: int = WHATSFLOW_CAPTION_LIMIT,
) -> str:
    branch = branch or {}
    tenant = tenant or {}
    links = _link_block(invoice, branch, tenant, limit=limit)
    details = _caption_detail(invoice, branch, tenant)
    try:
        return fit_media_caption(links, details, limit=limit)
    except CaptionLinkError:
        # A valid optional group link may fit by itself but leave no room for
        # the required invoice/total summary.  Omit that optional URL before
        # considering a hard failure for the required app/portal links.
        if extract_whatsapp_group_url(branch.get("whatsapp_group_url")):
            required_links = _link_block(
                invoice,
                branch,
                tenant,
                limit=limit,
                include_optional=False,
            )
            if required_links != links:
                logger.warning(
                    "Omitting optional branch WhatsApp link to reserve "
                    "invoice summary caption space"
                )
                return fit_media_caption(required_links, details, limit=limit)
        raise
