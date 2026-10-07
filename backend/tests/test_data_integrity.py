from routes.data_integrity import classify_invoice, missing_level_references


def test_product_only_invoice_does_not_require_member():
    assert classify_invoice({"items": [{"is_product": True}]}, set()) is None


def test_family_invoice_uses_each_activity_member():
    invoice = {"member_id": "parent", "items": [
        {"is_product": False, "member_id": "child"},
        {"is_product": False},
    ]}
    assert classify_invoice(invoice, {"parent", "child"}) is None
    assert classify_invoice(invoice, {"parent"}) == "invoice_member_not_found"


def test_subscription_invoice_without_member_is_flagged():
    assert classify_invoice({"items": [{"is_product": False}]}, set()) == "invoice_without_member"


def test_only_current_missing_level_reference_is_flagged():
    members = [{"id": "member", "activities": [
        {"status": "active", "level_id": "gone", "end_date": "2026-12-31"},
        {"status": "active", "level_id": "real", "end_date": "2026-12-31"},
        {"status": "active", "level_id": "old", "end_date": "2026-01-01"},
    ]}]
    issues = missing_level_references(members, {"real"}, "2026-10-07")
    assert [issue["level_id"] for issue in issues] == ["gone"]
