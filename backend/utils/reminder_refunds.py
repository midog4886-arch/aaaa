"""Identify subscriptions whose source invoice has a recorded refund."""


async def refunded_source_ids(db, members):
    source_ids = {
        activity.get("source_id")
        for member in members
        for activity in (member.get("activities") or [])
        if activity.get("source_id")
    }
    if not source_ids:
        return set()
    rows = await db.invoices.find(
        {"id": {"$in": list(source_ids)}},
        {"_id": 0, "id": 1, "status": 1, "has_refund": 1},
    ).to_list(None)
    return {row["id"] for row in rows
            if row.get("id") and (row.get("status") in ("refunded", "partially_refunded")
                                   or row.get("has_refund") is True)}
