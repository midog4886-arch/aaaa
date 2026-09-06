import pytest
from pydantic import ValidationError

from routes.registration_requests import PublicRegistrationCreate


def test_public_registration_rejects_missing_age():
    with pytest.raises(ValidationError):
        PublicRegistrationCreate(
            customer_name="Test Member",
            customer_phone="0500000000",
            expected_start_date="2026-09-10",
        )


def test_public_registration_accepts_valid_age():
    payload = PublicRegistrationCreate(
        customer_name="Test Member",
        customer_phone="0500000000",
        age=12,
        expected_start_date="2026-09-10",
    )
    assert payload.age == 12