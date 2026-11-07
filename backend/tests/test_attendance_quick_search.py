from utils.attendance_quick_search import candidate_query, match_rank


def test_exact_identifiers_rank_before_partial_matches():
    exact = {"member_code": "DEFA-B13-2601", "name_ar": "محمد أحمد", "phone": "0504820756"}
    partial = {"member_code": "DEFA-B13-26012", "name_ar": "أحمد محمد علي"}
    assert match_rank(exact, "DEFA-B13-2601") == 0
    assert match_rank(partial, "DEFA-B13-2601") > 0
    assert match_rank(exact, "٠٥٠٤٨٢٠٧٥٦") == 1


def test_arabic_name_words_match_in_any_order_and_with_alef_variants():
    member = {"name_ar": "محمد أحمد جمال"}
    assert match_rank(member, "احمد محمد") == 5
    assert match_rank(member, "محمد احمد جمال") == 2
    query = candidate_query("احمد محمد")
    assert "$or" in query
    assert any("name_ar" in clause for clause in query["$or"])


def test_phone_search_accepts_international_format_and_partial_digits():
    member = {"phone": "+966 50 482 0756"}
    assert match_rank(member, "0504820756") == 1
    assert match_rank(member, "4820756") == 6
    assert any("phone" in clause for clause in candidate_query("0504820756")["$or"])


def test_unrelated_member_does_not_match():
    assert match_rank({"member_code": "ABC123", "name_ar": "علي", "phone": "0551111111"}, "أحمد") is None
