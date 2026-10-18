"""VAT review, source details and export must use one calendar-period scope."""

import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from server import _vat_excluded_query, _vat_period_query  # noqa: E402


def test_end_day_includes_timestamped_sales_and_refunds():
    sales, purchases, refunds = _vat_period_query(
        "2026-10-01", "2026-10-31", "branch-a", {"is_admin": True})
    assert sales == {"branch_id": "branch-a", "status": "paid",
                     "paid_at": {"$gte": "2026-10-01", "$lt": "2026-11-01"}}
    assert purchases["invoice_date"] == {"$gte": "2026-10-01", "$lte": "2026-10-31"}
    assert refunds["created_at"]["$lt"] == "2026-11-01"
    excluded = _vat_excluded_query(sales, refunds)
    assert excluded == {"branch_id": "branch-a", "status": {"$ne": "paid"},
                        "created_at": {"$gte": "2026-10-01", "$lt": "2026-11-01"}}


def test_non_admin_cannot_request_another_branch():
    sales, purchases, refunds = _vat_period_query(
        branch_filter="other", current_user={"is_admin": False, "branch_id": "own"})
    assert all(query["branch_id"] == "own" for query in (sales, purchases, refunds))
    with pytest.raises(HTTPException) as error:
        _vat_period_query(current_user={"is_admin": False})
    assert error.value.status_code == 403


@pytest.mark.parametrize("start,end", [("2026-10-31", "2026-10-01"), ("invalid", "2026-10-31")])
def test_invalid_period_is_rejected(start, end):
    with pytest.raises(HTTPException) as error:
        _vat_period_query(start, end, current_user={"is_admin": True})
    assert error.value.status_code == 400
