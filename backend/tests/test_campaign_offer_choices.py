import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from routes import campaign_inquiries, whatsapp


@pytest.mark.parametrize("body,expected", [
    ("1", "details"), ("١", "details"), ("أرسلوا التفاصيل", "details"),
    ("2", "visit"), ("أريد زيارة", "visit"),
    ("3", "not_interested"), ("غير مهتم", "not_interested"),
    ("كم السعر؟", None), ("11", None), ("مهتم", None),
])
def test_offer_choice_requires_explicit_reply(body, expected):
    assert campaign_inquiries.parse_offer_choice(body) == expected


def test_footer_only_added_to_enabled_campaign(monkeypatch):
    class Campaigns:
        async def find_one(self, query, projection):
            return {"id": "enabled"} if query["id"] == "enabled" else None

    class Database:
        def __getitem__(self, name):
            assert name == "whatsapp_campaigns"
            return Campaigns()

    monkeypatch.setattr(whatsapp, "_db", Database())
    monkeypatch.setattr(whatsapp, "get_current_tenant_slug", lambda: "academy")
    enabled = [{"message": "عرض الاشتراك"}]
    asyncio.run(whatsapp._add_offer_choices("branch", "enabled", enabled))
    assert enabled[0]["message"].endswith("3- غير مهتم")
    asyncio.run(whatsapp._add_offer_choices("branch", "enabled", enabled))
    assert enabled[0]["message"].count("3- غير مهتم") == 1
    disabled = [{"message": "إعلان عام"}]
    asyncio.run(whatsapp._add_offer_choices("branch", "disabled", disabled))
    assert disabled[0]["message"] == "إعلان عام"
