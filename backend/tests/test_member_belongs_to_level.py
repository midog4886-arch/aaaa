from routes.levels import member_belongs_to_level

LVL_A = "level-aaa"
LVL_B = "level-bbb"


def test_no_level_id_anywhere_is_kept():
    # Legacy/un-backfilled member: keep wherever they currently sit.
    activities = [{"activity_name": "سباحة", "level_id": ""}, {"activity_name": "كاراتيه"}]
    assert member_belongs_to_level(activities, LVL_A) is True
    assert member_belongs_to_level(activities, LVL_B) is True


def test_linked_to_this_level_is_kept():
    activities = [{"activity_name": "سباحة", "level_id": LVL_A}]
    assert member_belongs_to_level(activities, LVL_A) is True


def test_linked_only_to_other_level_is_stale():
    # The بدر case: activity links to LVL_A, leftover id still sits in LVL_B.
    activities = [{"activity_name": "سباحة", "level_id": LVL_A}]
    assert member_belongs_to_level(activities, LVL_B) is False


def test_multi_activity_member_kept_in_each_linked_level():
    activities = [
        {"activity_name": "سباحة", "level_id": LVL_A},
        {"activity_name": "كاراتيه", "level_id": LVL_B},
    ]
    assert member_belongs_to_level(activities, LVL_A) is True
    assert member_belongs_to_level(activities, LVL_B) is True


def test_empty_activities_is_kept():
    assert member_belongs_to_level([], LVL_A) is True
    assert member_belongs_to_level(None, LVL_A) is True


def test_mixed_blank_and_other_level_is_stale():
    # One activity has no level_id, another links elsewhere -> still belongs
    # only where linked, so this level (LVL_B) is stale.
    activities = [{"activity_name": "سباحة", "level_id": LVL_A}, {"activity_name": "كاراتيه", "level_id": ""}]
    assert member_belongs_to_level(activities, LVL_B) is False
    assert member_belongs_to_level(activities, LVL_A) is True
