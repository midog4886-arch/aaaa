from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from routes import marketers


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_visit_is_idempotent_and_branch_scoped(monkeypatch):
    db = SimpleNamespace(
        marketers=SimpleNamespace(find_one=AsyncMock(return_value={
            "id": "marketer-1", "branch_ids": ["branch-1"],
        })),
        marketer_link_visits=SimpleNamespace(update_one=AsyncMock()),
    )
    monkeypatch.setattr(marketers, "db", db)
    data = marketers.MarketerLinkVisit(
        visit_id="752cf1a4-73a3-4471-8663-948fb430bc95", branch_id="branch-1",
    )
    assert await marketers.record_marketer_link_visit("CODE1", data) == {"tracked": True}
    assert await marketers.record_marketer_link_visit("CODE1", data) == {"tracked": True}
    first_query = db.marketer_link_visits.update_one.call_args.args[0]
    assert first_query == {"_id": "marketer-1:752cf1a4-73a3-4471-8663-948fb430bc95"}
    assert db.marketer_link_visits.update_one.call_args.kwargs["upsert"] is True

    with pytest.raises(HTTPException) as error:
        await marketers.record_marketer_link_visit("CODE1", data.model_copy(update={"branch_id": "branch-2"}))
    assert error.value.status_code == 400


@pytest.mark.anyio
async def test_funnel_counts_real_requests_and_first_invoices(monkeypatch):
    marketers_cursor = SimpleNamespace(to_list=AsyncMock(return_value=[{"id": "marketer-1"}]))
    visit_collection = SimpleNamespace(aggregate=Mock(return_value=SimpleNamespace(
        to_list=AsyncMock(return_value=[{"_id": "marketer-1", "count": 3}]),
    )))
    request_collection = SimpleNamespace(aggregate=Mock(return_value=SimpleNamespace(
        to_list=AsyncMock(return_value=[{"_id": "marketer-1", "count": 2}]),
    )))
    commission_collection = SimpleNamespace(aggregate=Mock(return_value=SimpleNamespace(
        to_list=AsyncMock(return_value=[{"_id": "marketer-1", "count": 1, "invoice_total": 500, "commission_total": 50}]),
    )))
    monkeypatch.setattr(marketers, "db", SimpleNamespace(
        marketers=SimpleNamespace(find=Mock(return_value=marketers_cursor)),
        marketer_link_visits=visit_collection,
        registration_requests=request_collection,
        marketer_commissions=commission_collection,
    ))
    result = await marketers.marketers_funnel(branch_filter="branch-1", current_user={"is_admin": True})
    assert result["by_marketer"]["marketer-1"] == {
        "link_visits": 3,
        "registration_requests": 2,
        "linked_invoices": 1,
        "invoice_base_amount": 500,
        "recorded_commission": 50,
    }
    assert request_collection.aggregate.call_args.args[0][0]["$match"]["branch_id"] == "branch-1"
    assert "branch_id" not in visit_collection.aggregate.call_args.args[0][0]["$match"]


@pytest.mark.anyio
async def test_payout_rejects_changed_preview(monkeypatch):
    due_cursor = SimpleNamespace(to_list=AsyncMock(return_value=[
        {"id": "commission-1", "commission_amount": 50},
    ]))
    monkeypatch.setattr(marketers, "db", SimpleNamespace(
        marketers=SimpleNamespace(find_one=AsyncMock(return_value={"id": "marketer-1"})),
        marketer_commissions=SimpleNamespace(find=Mock(return_value=due_cursor)),
        payment_vouchers=SimpleNamespace(insert_one=AsyncMock()),
    ))
    with pytest.raises(HTTPException) as error:
        await marketers.payout_marketer(
            "marketer-1",
            marketers.MarketerPayout(commission_ids=["commission-2"], expected_total=50),
            {"is_admin": True},
        )
    assert error.value.status_code == 409
    marketers.db.payment_vouchers.insert_one.assert_not_awaited()
