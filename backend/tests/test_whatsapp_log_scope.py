import asyncio
import pytest
from fastapi import HTTPException
from routes import whatsapp as mod


class Logs:
    def __init__(self):
        self.query = None

    def find(self, query, projection):
        self.query = query
        return self

    def sort(self, *_args):
        return self

    def limit(self, *_args):
        return self

    async def to_list(self, **_kwargs):
        rows = [{"branch_id": "a"}, {"branch_id": "b"}, {}]
        return [r for r in rows if all(r.get(k) == v for k, v in self.query.items())]


@pytest.mark.parametrize("user,selected,expected", [
    ({"is_admin": True}, "a", [{"branch_id": "a"}]),
    ({"is_admin": True}, "all", [{"branch_id": "a"}, {"branch_id": "b"}, {}]),
    ({"permissions": ["whatsapp"], "branch_id": "a"}, "b", [{"branch_id": "a"}]),
    ({"permissions": ["whatsapp"], "branch_id": "a"}, "all", [{"branch_id": "a"}]),
    ({"permissions": ["whatsapp"], "branch_id": "a", "branch_ids": ["a", "b"]}, "b", [{"branch_id": "b"}]),
])
def test_logs_scoped_server_side(monkeypatch, user, selected, expected):
    monkeypatch.setattr(mod, "_db", {"whatsapp_send_log": Logs()})
    assert asyncio.run(mod.get_send_logs(branch_filter=selected, current_user=user)) == expected


def test_unassigned_staff_cannot_read_global_logs(monkeypatch):
    monkeypatch.setattr(mod, "_db", {"whatsapp_send_log": Logs()})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(mod.get_send_logs(current_user={"permissions": ["whatsapp"]}))
    assert exc.value.status_code == 403