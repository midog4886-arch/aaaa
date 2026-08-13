"""Regression tests for the inverted subscription-window guard (Task: keep
the inverted-dates protection from breaking with future changes).

Covers backend/utils/subscription_dates.py:
  - inverted dates on primary invoice items are rejected (422, Arabic message)
  - inverted dates inside additional_members[].items are rejected
  - a window derived from the ``period`` field only ("start - end") is validated
  - empty / unparseable dates are tolerated (legacy free-text data must pass)
  - correct windows pass untouched
  - pydantic-style objects (attribute access) are supported like dicts
  - nested ``items`` lists are validated recursively
"""
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.subscription_dates import (  # noqa: E402
    validate_invoice_payload_windows,
    validate_subscription_windows,
)


def _item(**kw):
    base = {"activity_name": "سباحة", "start_date": "", "end_date": "", "period": ""}
    base.update(kw)
    return base


# ── primary items ────────────────────────────────────────────────────────────

def test_inverted_primary_item_rejected():
    with pytest.raises(HTTPException) as exc:
        validate_subscription_windows([
            _item(start_date="2026-08-10", end_date="2026-08-01"),
        ])
    assert exc.value.status_code == 422
    assert "قبل تاريخ البداية" in exc.value.detail
    assert "سباحة" in exc.value.detail


def test_valid_primary_item_passes():
    validate_subscription_windows([
        _item(start_date="2026-08-01", end_date="2026-09-01"),
        _item(start_date="2026-08-01", end_date="2026-08-01"),  # same-day OK
    ])


def test_inverted_among_many_items_rejected():
    with pytest.raises(HTTPException):
        validate_subscription_windows([
            _item(start_date="2026-08-01", end_date="2026-09-01"),
            _item(activity_name="كاراتيه", start_date="2026-09-01", end_date="2026-08-15"),
        ])


# ── period-only window ───────────────────────────────────────────────────────

def test_period_only_inverted_rejected():
    with pytest.raises(HTTPException) as exc:
        validate_subscription_windows([_item(period="2026-08-10 - 2026-08-01")])
    assert exc.value.status_code == 422


def test_period_only_valid_passes():
    validate_subscription_windows([_item(period="2026-08-01 - 2026-09-01")])


def test_explicit_dates_win_over_period():
    # Explicit (valid) dates present → the inverted period text is ignored.
    validate_subscription_windows([
        _item(start_date="2026-08-01", end_date="2026-09-01",
              period="2026-08-10 - 2026-08-01"),
    ])


# ── tolerant parsing: empty / unparseable dates are accepted ────────────────

@pytest.mark.parametrize("start,end", [
    ("", ""),
    (None, None),
    ("", "2026-08-01"),
    ("2026-08-10", ""),
    ("شهر كامل", "بلا نهاية"),          # free-text legacy values
    ("2026-08-10", "غير محدد"),
    ("13/08/2026", "not-a-date"),
])
def test_empty_or_unparseable_dates_pass(start, end):
    validate_subscription_windows([_item(start_date=start, end_date=end)])


def test_slash_and_unpadded_dates_are_parsed():
    # 2026/8/10 → 2026/8/1 is a real inversion and must still be caught.
    with pytest.raises(HTTPException):
        validate_subscription_windows([
            _item(start_date="2026/8/10", end_date="2026/8/1"),
        ])


def test_period_without_separator_ignored():
    validate_subscription_windows([_item(period="شهري")])


# ── additional_members + full payload ────────────────────────────────────────

def test_payload_additional_members_inverted_rejected():
    payload = {
        "items": [_item(start_date="2026-08-01", end_date="2026-09-01")],
        "additional_members": [
            {"items": [_item(activity_name="جمباز",
                             start_date="2026-09-05", end_date="2026-09-01")]},
        ],
    }
    with pytest.raises(HTTPException) as exc:
        validate_invoice_payload_windows(payload)
    assert "جمباز" in exc.value.detail


def test_payload_all_valid_passes():
    validate_invoice_payload_windows({
        "items": [_item(start_date="2026-08-01", end_date="2026-09-01")],
        "additional_members": [
            {"items": [_item(period="2026-08-01 - 2026-09-01")]},
            {"items": []},
        ],
    })


def test_payload_missing_sections_pass():
    validate_invoice_payload_windows({})
    validate_invoice_payload_windows({"items": None, "additional_members": None})


def test_nested_items_validated_recursively():
    with pytest.raises(HTTPException):
        validate_subscription_windows([
            {"activity_name": "أب", "items": [
                _item(activity_name="ابن", start_date="2026-08-10", end_date="2026-08-01"),
            ]},
        ])


# ── pydantic-style objects (attribute access) ────────────────────────────────

def test_object_items_supported():
    class Obj:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    with pytest.raises(HTTPException):
        validate_subscription_windows([
            Obj(activity_name="سباحة", start_date="2026-08-10",
                end_date="2026-08-01", period=""),
        ])

    payload = Obj(
        items=[Obj(activity_name="سباحة", start_date="2026-08-01",
                   end_date="2026-09-01", period="")],
        additional_members=[
            Obj(items=[Obj(activity_name="جري", start_date="", end_date="",
                           period="2026-08-01 - 2026-09-01")]),
        ],
    )
    validate_invoice_payload_windows(payload)
