"""Guard against inverted subscription windows (end date before start date).

Inverted windows corrupt the member card, attendance quotas, and renewal
logic downstream, so every write path that accepts item/activity dates
(invoice create/edit, registration forms, member activity add/edit) must
reject them with a clear Arabic error.
"""
from datetime import date

from fastapi import HTTPException


def _field(obj, key, default=""):
    if isinstance(obj, dict):
        return obj.get(key) or default
    return getattr(obj, key, None) or default


def _parse(d):
    """Parse a date string tolerantly (ISO, optional non-zero-padded parts).

    Returns a ``date`` or None when the value is empty/unparseable —
    unparseable values are skipped rather than rejected, to avoid breaking
    legacy free-text data.
    """
    d = str(d or "").strip()
    if not d:
        return None
    try:
        return date.fromisoformat(d)
    except ValueError:
        pass
    parts = d.replace("/", "-").split("-")
    if len(parts) == 3:
        try:
            y, m, dd = (int(p) for p in parts)
            if y > 1900:
                return date(y, m, dd)
        except ValueError:
            pass
    return None


def _window_of(item):
    """Effective (start, end) of an item: explicit dates, else its period."""
    s = _parse(_field(item, "start_date"))
    e = _parse(_field(item, "end_date"))
    if s or e:
        return s, e
    period = str(_field(item, "period")).strip()
    if " - " in period:
        p_start, _, p_end = period.partition(" - ")
        return _parse(p_start), _parse(p_end)
    return None, None


def validate_subscription_windows(items, name_key="activity_name"):
    """Raise 422 if any item/activity window has end before start.

    Accepts a list of dicts or pydantic models. Empty/unparseable dates are
    ignored. Items carrying nested ``items`` lists (e.g. additional_members)
    are validated recursively.
    """
    for item in items or []:
        s, e = _window_of(item)
        if s and e and e < s:
            name = str(_field(item, name_key)).strip() or "الاشتراك"
            raise HTTPException(
                status_code=422,
                detail=f"تاريخ نهاية الاشتراك ({e.isoformat()}) قبل تاريخ البداية ({s.isoformat()}) في «{name}» — صحّح التواريخ",
            )
        nested = _field(item, "items", None)
        if isinstance(nested, list) and nested:
            validate_subscription_windows(nested, name_key=name_key)


def validate_invoice_payload_windows(payload):
    """Validate a full invoice/registration payload: primary items plus
    additional_members[].items."""
    validate_subscription_windows(_field(payload, "items", None) or [])
    for am in _field(payload, "additional_members", None) or []:
        validate_subscription_windows(_field(am, "items", None) or [])
