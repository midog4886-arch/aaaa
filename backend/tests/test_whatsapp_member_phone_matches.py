import asyncio
import copy
import re

from routes import whatsapp as mod


def run(coro):
    return asyncio.run(coro)


def _matches(row, query):
    for key, value in query.items():
        if key == "$or":
            if not any(_matches(row, branch) for branch in value):
                return False
            continue
        if isinstance(value, dict):
            if "$in" in value and row.get(key) not in value["$in"]:
                return False
            if "$regex" in value and not re.search(
                value["$regex"], str(row.get(key) or "")
            ):
                return False
            continue
        if row.get(key) != value:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return self.rows if length is None else self.rows[:length]


class _Collection:
    def __init__(self, rows=()):
        self.rows = [copy.deepcopy(row) for row in rows]
        self.queries = []

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if _matches(row, query):
                return copy.deepcopy(row)
        return None

    def find(self, query, projection=None):
        self.queries.append(copy.deepcopy(query))
        rows = [row for row in self.rows if _matches(row, query)]
        if projection:
            included = {
                key for key, enabled in projection.items()
                if enabled and key != "_id"
            }
            rows = [
                {key: copy.deepcopy(row[key]) for key in included if key in row}
                for row in rows
            ]
        return _Cursor(rows)


class _Database:
    def __init__(self, *, member_rows, user_rows=()):
        self.members = _Collection(member_rows)
        self.users = _Collection(user_rows)

    def __getitem__(self, name):
        return getattr(self, name)


def test_admin_member_link_never_crosses_conversation_branch(monkeypatch):
    db = _Database(member_rows=[{
        "id": "member-other-branch",
        "phone": "+966 50 123 4567",
        "branch_id": "branch-b",
        "name": "must not be returned",
        "photo": "must not be scanned",
    }])
    monkeypatch.setattr(mod, "_db", db)
    rows = [{
        "id": "branch-a:966501234567",
        "phone": "966501234567",
        "branch_id": "branch-a",
        "member_phone_match": "stale",
    }]

    enriched = run(mod._enrich_member_phone_matches(
        rows,
        {"is_admin": True, "branch_id": "branch-a"},
        member_branch="branch-a",
    ))

    assert enriched[0]["member_phone_match"] is False
    assert enriched[0]["member_link"] == {
        "status": "none",
        "member": None,
        "candidates": [],
        "candidate_count": 0,
    }
    assert db.members.queries[0]["branch_id"] == "branch-a"


def test_exact_phone_lookup_also_checks_legacy_formats_for_all_phones(monkeypatch):
    db = _Database(member_rows=[
        {"id": "member-1", "phone": "0501234567", "branch_id": "branch-a"},
        {"id": "member-2", "phone": "966501234568", "branch_id": "branch-a"},
    ])
    monkeypatch.setattr(mod, "_db", db)
    rows = [
        {"id": "branch-a:966501234567", "phone": "966501234567", "branch_id": "branch-a"},
        {"id": "branch-a:966501234568", "phone": "966501234568", "branch_id": "branch-a"},
        {"id": "branch-a:966501234569", "phone": "966501234569", "branch_id": "branch-a"},
    ]

    enriched = run(mod._enrich_member_phone_matches(
        rows,
        {"is_admin": True},
    ))

    assert [row["member_phone_match"] for row in enriched] == [True, True, False]
    # Exact records do not suppress legacy-format lookup: another current
    # sibling can use the same number with spaces/dashes or Unicode digits.
    assert len(db.members.queries) == 2
    assert "$in" in db.members.queries[0]["$or"][0]["phone"]
    assert len(db.members.queries[1]["$or"]) == 6


def test_non_admin_match_is_limited_to_authorized_branch(monkeypatch):
    db = _Database(
        member_rows=[
            {"id": "member-a", "phone": "0501234567", "branch_id": "branch-a"},
            {"id": "member-b", "phone": "0501234567", "branch_id": "branch-b"},
        ],
        user_rows=[{"id": "staff-1", "permissions": ["member-phones"]}],
    )
    monkeypatch.setattr(mod, "_db", db)
    rows = [
        {"id": "branch-a:966501234567", "phone": "966501234567", "branch_id": "branch-a"},
        {"id": "branch-b:966501234567", "phone": "966501234567", "branch_id": "branch-b"},
    ]

    enriched = run(mod._enrich_member_phone_matches(
        rows,
        {"is_admin": False, "user_id": "staff-1", "branch_id": "branch-a"},
        member_branch="branch-a",
    ))

    assert [row["member_phone_match"] for row in enriched] == [True, False]
    assert db.members.queries[0]["branch_id"] == "branch-a"
    assert len(db.members.queries) == 2


def test_unauthorized_user_receives_no_match_flag_or_member_query(monkeypatch):
    db = _Database(
        member_rows=[{"phone": "0501234567", "branch_id": "branch-a"}],
        user_rows=[{"id": "staff-1", "permissions": []}],
    )
    monkeypatch.setattr(mod, "_db", db)
    rows = [{
        "id": "branch-a:966501234567",
        "phone": "966501234567",
        "branch_id": "branch-a",
        "member_phone_match": True,
    }]

    enriched = run(mod._enrich_member_phone_matches(
        rows,
        {"is_admin": False, "user_id": "staff-1", "branch_id": "branch-a"},
        member_branch="branch-a",
    ))

    assert "member_phone_match" not in enriched[0]
    assert enriched[0]["member_link"] == {
        "status": "restricted",
        "member": None,
        "candidates": [],
        "candidate_count": 0,
    }
    assert db.members.queries == []


def test_member_link_matches_guardian_and_returns_only_safe_summary(monkeypatch):
    db = _Database(member_rows=[{
        "id": "guardian-match",
        "phone": "0500000000",
        "guardian_phone": "+966 (50) 123-4567",
        "branch_id": "branch-a",
        "name": "Sarah",
        "name_ar": "سارة",
        "member_code": "A-7",
        "photo": "/api/public/member-photo/default/guardian-match?v=hash&sig=sig",
        "activities": [
            {"end_date": "2000-01-01", "status": "expired"},
            {"end_date": "9999-01-01", "status": "expired"},
        ],
    }])
    monkeypatch.setattr(mod, "_db", db)

    row = run(mod._enrich_member_phone_matches(
        [{"phone": "966501234567", "branch_id": "branch-a"}],
        {"is_admin": True},
    ))[0]

    assert row["member_phone_match"] is True
    assert row["member_link"]["status"] == "unique"
    assert row["member_link"]["candidate_count"] == 1
    assert row["member_link"]["candidates"] == []
    assert row["member_link"]["member"] == {
        "id": "guardian-match",
        "name": "Sarah",
        "name_ar": "سارة",
        "member_code": "A-7",
        "photo": "/api/public/member-photo/default/guardian-match?v=hash&sig=sig",
        # One valid subscription means the member is not all-expired.
        "subscription_status": "active",
    }


def test_shared_phone_is_ambiguous_and_thread_gets_all_candidates(monkeypatch):
    db = _Database(member_rows=[
        {
            "id": "sibling-1", "phone": "0501234567",
            "branch_id": "branch-a", "name_ar": "الأول",
        },
        {
            "id": "sibling-2", "guardian_phone": "0501234567",
            "branch_id": "branch-a", "name_ar": "الثاني",
        },
    ])
    monkeypatch.setattr(mod, "_db", db)

    row = run(mod._enrich_member_phone_matches(
        [{"phone": "966501234567", "branch_id": "branch-a"}],
        {"is_admin": True},
        include_candidates=True,
    ))[0]

    assert row["member_phone_match"] is True
    assert row["member_link"]["status"] == "ambiguous"
    assert row["member_link"]["member"] is None
    assert row["member_link"]["candidate_count"] == 2
    assert [candidate["id"] for candidate in row["member_link"]["candidates"]] == [
        "sibling-1", "sibling-2",
    ]
    assert all(set(candidate) == {
        "id", "name", "name_ar", "member_code", "photo",
        "subscription_status",
    } for candidate in row["member_link"]["candidates"])


def test_member_with_phone_and_guardian_phone_counts_once(monkeypatch):
    db = _Database(member_rows=[{
        "id": "one-member",
        "phone": "0501234567",
        "guardian_phone": "966501234567",
        "branch_id": "branch-a",
    }])
    monkeypatch.setattr(mod, "_db", db)

    row = run(mod._enrich_member_phone_matches(
        [{"phone": "0501234567", "branch_id": "branch-a"}],
        {"is_admin": True},
    ))[0]

    assert row["member_link"]["status"] == "unique"
    assert row["member_link"]["candidate_count"] == 1


def test_exact_and_formatted_same_branch_siblings_are_ambiguous(monkeypatch):
    db = _Database(member_rows=[
        {"id": "exact", "phone": "0501234567", "branch_id": "branch-a"},
        {"id": "formatted", "phone": "050 123-4567", "branch_id": "branch-a"},
    ])
    monkeypatch.setattr(mod, "_db", db)

    row = run(mod._enrich_member_phone_matches(
        [{"phone": "966501234567", "branch_id": "branch-a"}],
        {"is_admin": True},
    ))[0]

    assert row["member_link"]["status"] == "ambiguous"
    assert row["member_link"]["candidate_count"] == 2


def test_exact_one_branch_does_not_suppress_formatted_other_branch(monkeypatch):
    db = _Database(member_rows=[
        {"id": "exact-a", "phone": "0501234567", "branch_id": "branch-a"},
        {"id": "formatted-b", "phone": "050 123-4567", "branch_id": "branch-b"},
    ])
    monkeypatch.setattr(mod, "_db", db)

    rows = run(mod._enrich_member_phone_matches(
        [
            {"phone": "966501234567", "branch_id": "branch-a"},
            {"phone": "966501234567", "branch_id": "branch-b"},
        ],
        {"is_admin": True},
    ))

    assert [(row["member_link"]["status"], row["member_link"]["member"]["id"])
            for row in rows] == [
        ("unique", "exact-a"),
        ("unique", "formatted-b"),
    ]


def test_arabic_indic_legacy_phone_digits_match_after_normalization(monkeypatch):
    db = _Database(member_rows=[{
        "id": "arabic-digits",
        "phone": "٠٥٠ ١٢٣-٤٥٦٧",
        "branch_id": "branch-a",
    }])
    monkeypatch.setattr(mod, "_db", db)

    row = run(mod._enrich_member_phone_matches(
        [{"phone": "966501234567", "branch_id": "branch-a"}],
        {"is_admin": True},
    ))[0]

    assert row["member_link"]["status"] == "unique"
    assert row["member_link"]["member"]["id"] == "arabic-digits"


def test_member_link_uses_current_phone_and_branch_records(monkeypatch):
    db = _Database(member_rows=[{
        "id": "moved",
        "phone": "0501234567",
        "branch_id": "branch-a",
    }])
    monkeypatch.setattr(mod, "_db", db)
    row = {"phone": "0501234567", "branch_id": "branch-a"}

    assert run(mod._enrich_member_phone_matches(
        [dict(row)], {"is_admin": True},
    ))[0]["member_link"]["status"] == "unique"

    # A subsequent read does not retain stale associations after a phone
    # change or transfer; it derives the new branch/phone pair from members.
    db.members.rows[0]["phone"] = "0507654321"
    db.members.rows[0]["branch_id"] = "branch-b"
    assert run(mod._enrich_member_phone_matches(
        [dict(row)], {"is_admin": True},
    ))[0]["member_link"]["status"] == "none"
    assert run(mod._enrich_member_phone_matches(
        [{"phone": "0507654321", "branch_id": "branch-b"}],
        {"is_admin": True},
    ))[0]["member_link"]["status"] == "unique"

    # Deleted records no longer participate on the following read.
    db.members.rows.clear()
    assert run(mod._enrich_member_phone_matches(
        [{"phone": "0507654321", "branch_id": "branch-b"}],
        {"is_admin": True},
    ))[0]["member_link"]["status"] == "none"