from routes.attendance import _previous_scheduled_date, _next_scheduled_date

MON_WED = ["monday", "wednesday"]


def test_pulls_back_to_previous_scheduled_occurrence():
    # Schedule Mon/Wed. End date 2026-06-22 is a Monday -> previous occurrence is
    # Wednesday 2026-06-17.
    assert _previous_scheduled_date("2026-06-22", MON_WED) == "2026-06-17"


def test_same_weekday_schedule_steps_one_week_back():
    # Only Monday in schedule -> previous scheduled day is the Monday a week before.
    assert _previous_scheduled_date("2026-06-22", ["monday"]) == "2026-06-15"


def test_picks_nearest_earlier_scheduled_day():
    # End 2026-06-18 (Thursday), schedule Mon/Wed -> nearest earlier is Wed 06-17.
    assert _previous_scheduled_date("2026-06-18", MON_WED) == "2026-06-17"


def test_no_schedule_days_returns_none():
    assert _previous_scheduled_date("2026-06-22", []) is None
    assert _previous_scheduled_date("2026-06-22", None) is None


def test_missing_end_date_returns_none():
    assert _previous_scheduled_date("", ["monday"]) is None


def test_invalid_date_returns_none():
    assert _previous_scheduled_date("not-a-date", ["monday"]) is None


def test_next_picks_following_scheduled_occurrence():
    # End 2026-06-17 (Wednesday), schedule Mon/Wed -> next is Monday 06-22.
    assert _next_scheduled_date("2026-06-17", MON_WED) == "2026-06-22"
    assert _next_scheduled_date("2026-06-15", ["monday"]) == "2026-06-22"


def test_next_invalid_or_empty_returns_none():
    assert _next_scheduled_date("2026-06-22", []) is None
    assert _next_scheduled_date("", MON_WED) is None
    assert _next_scheduled_date("not-a-date", MON_WED) is None


def test_forward_then_reverse_is_identity_on_scheduled_end():
    # A forward shift always lands on a scheduled day, so stepping forward again
    # (the deletion reversal) returns the original end date exactly.
    for end in ["2026-06-22", "2026-06-17", "2026-07-01"]:
        prev = _previous_scheduled_date(end, MON_WED)
        assert _next_scheduled_date(prev, MON_WED) == end


def test_two_forward_steps_reverse_in_any_order():
    # Two off-schedule attendances pull back two occurrences; reversing one (push
    # forward one occurrence) yields the single-shift end date regardless of order.
    base = "2026-06-22"
    after_one = _previous_scheduled_date(base, MON_WED)        # 06-17
    after_two = _previous_scheduled_date(after_one, MON_WED)   # 06-15
    # Delete either record -> push forward one occurrence from the doubly-shifted end.
    assert _next_scheduled_date(after_two, MON_WED) == after_one
    # Delete the remaining record -> back to base.
    assert _next_scheduled_date(after_one, MON_WED) == base
