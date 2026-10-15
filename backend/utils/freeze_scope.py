def freeze_applies_to_activity(freeze: dict, activity_id: str) -> bool:
    """Older freezes without an activity_id cover the whole membership."""
    frozen_activity = (freeze or {}).get("activity_id")
    return not frozen_activity or frozen_activity == activity_id
