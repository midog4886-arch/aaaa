from routes.registration_journey import summarize_journey
from routes.registration_requests import _search_registration_requests


def test_journey_stays_open_until_payment_and_all_family_cards_printed():
    request = {"id": "request", "customer_name": "Family", "branch_id": "branch"}
    invoice = {"id": "invoice", "status": "pending", "member_id": "first", "items": [
        {"member_id": "first", "level_id": "level-1", "is_product": False},
        {"member_id": "second", "level_id": "level-2", "is_product": False},
    ]}
    members = [
        {"id": "first", "card_printed_at": "2026-10-07"},
        {"id": "second"},
    ]
    steps = summarize_journey(request, invoice, members)["steps"]
    assert steps["member_linked"] and steps["level_selected"] and steps["invoice_created"]
    assert not steps["paid"] and not steps["card_printed"]
    invoice["status"] = "paid"
    members[1]["card_printed_at"] = "2026-10-07"
    completed = summarize_journey(request, invoice, members)["steps"]
    assert completed["paid"] and completed["card_printed"]


def test_cancelled_invoice_does_not_advance_registration():
    result = summarize_journey({"id": "request"}, {"id": "invoice", "status": "cancelled", "items": []}, [])
    assert result["invoice"] is None
    assert not result["steps"]["invoice_created"]


def test_request_link_can_find_its_reference_prefix():
    query = {}
    _search_registration_requests(query, "#a1b2c3d4")
    assert {"id": {"$regex": "^a1b2c3d4", "$options": "i"}} in query["$or"]
