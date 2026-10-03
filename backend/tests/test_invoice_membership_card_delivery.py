import asyncio

from routes import whatsapp
from services.membership_card_image import render_membership_card_image


def run(coro):
    return asyncio.run(coro)


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args):
        return self

    async def to_list(self, limit):
        return [dict(row) for row in self.rows[:limit]]


class Collection:
    def __init__(self, rows=()):
        self.rows = [dict(row) for row in rows]

    async def create_index(self, *_args, **_kwargs):
        return None

    def find(self, query, projection=None):
        return Cursor([row for row in self.rows if all(row.get(k) == v for k, v in query.items())])

    async def find_one(self, query, projection=None):
        return next((dict(row) for row in self.rows if all(row.get(k) == v for k, v in query.items())), None)

    async def insert_one(self, row):
        if any(existing.get("key") == row.get("key") for existing in self.rows):
            raise whatsapp.DuplicateKeyError("duplicate")
        self.rows.append(dict(row))

    async def update_one(self, query, update):
        for row in self.rows:
            if all(row.get(k) == v for k, v in query.items()):
                row.update(update.get("$set", {}))
                return type("Result", (), {"modified_count": 1})()
        return type("Result", (), {"modified_count": 0})()


class DB(dict):
    def __getitem__(self, name):
        return self.setdefault(name, Collection())


def test_membership_image_is_png_and_uses_member_code():
    image = render_membership_card_image({"member_code": "DEFA-B10-2472", "name_ar": "أميرة"})
    assert image.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(image) > 1000


def test_sibling_cards_send_once_only_after_receipt(monkeypatch):
    invoice = {
        "id": "inv-1", "branch_id": "branch-a", "customer_phone": "0501234567",
        "member_id": "one", "items": [{"member_id": "one"}, {"member_id": "two"}],
        "additional_members": [{"member_id": "two"}],
    }
    db = DB({
        "whatsapp_invoice_payment_outbox": Collection([{
            "invoice_id": "inv-1", "invoice": invoice, "status": "pending",
            "membership_cards_pending": True,
        }]),
        "members": Collection([
            {"id": "one", "branch_id": "branch-a", "name_ar": "الأول", "member_code": "A1"},
            {"id": "two", "branch_id": "branch-a", "name_ar": "الثاني", "member_code": "A2"},
        ]),
        "branches": Collection([{"id": "branch-a", "company_name": "الأكاديمية"}]),
    })
    monkeypatch.setattr(whatsapp, "_db", db)
    async def config(_branch):
        return {"provider": "whatsflow", "enabled": True}
    monkeypatch.setattr(whatsapp, "_get_branch_cloud_config", config)
    sent = []
    async def send(*args):
        sent.append(args)
        return True, "provider-id", None
    monkeypatch.setattr(whatsapp, "_send_whatsflow_media_result", send)

    assert run(whatsapp.process_invoice_membership_card_outbox()) == 0
    assert sent == []
    db["whatsapp_invoice_payment_outbox"].rows[0]["status"] = "delivered"
    assert run(whatsapp.process_invoice_membership_card_outbox()) == 2
    assert len(db["whatsapp_invoice_membership_card_outbox"].rows) == 2
    assert all(item["status"] == "delivered" for item in db["whatsapp_invoice_membership_card_outbox"].rows)
    assert run(whatsapp.process_invoice_membership_card_outbox()) == 0
    assert len(sent) == 2
