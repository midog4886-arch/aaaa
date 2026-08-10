"""Auto-activation of prepaid (future-window) subscriptions.

A member can pre-pay the next period: a paid invoice holds an item whose
start_date is AFTER the current activity window ends. Until that date the
member's activity subdoc keeps the current window; once the prepaid window's
start date arrives, the subdoc must roll forward so the profile stops showing
"منتهي" and the Renewals page stops flagging the member.

Rules (see member-activities dedupe + session-quota memories):
- Merge by activity_id: the existing subdoc is updated in place, never
  duplicated.
- Idempotent: an item only applies when it moves the window FORWARD
  (item.end_date > activity.end_date) and its start_date has arrived
  (start_date <= today). Re-running is a no-op.
- The invoice itself is never touched — session quota keeps reading the
  original purchased window from the invoice items.
"""

from datetime import datetime, timezone


def _item_window(item):
    start = item.get("start_date") or ""
    end = item.get("end_date") or ""
    period = item.get("period") or ""
    if (not start or not end) and " - " in period:
        parts = period.split(" - ")
        if len(parts) == 2:
            start = start or parts[0].strip()
            end = end or parts[1].strip()
    return start, end


async def roll_forward_member_prepaid(db, member, today=None):
    """Roll the member's activity subdocs forward onto any prepaid paid-invoice
    window whose start date has arrived. Returns list of applied changes
    (empty when nothing changed). Persists member.activities when changed."""
    today = today or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    acts = member.get("activities") or []
    if not acts:
        return []

    invoices = await db.invoices.find(
        {
            "$or": [
                {"member_id": member.get("id")},
                {"items.member_id": member.get("id")},
            ],
            # FULLY paid only — a partially paid invoice must not activate a
            # prepaid window (same predicate as the renewals prepaid badge).
            "status": "paid",
        },
        {"_id": 0, "id": 1, "member_id": 1, "items": 1},
    ).to_list(200)
    if not invoices:
        return []

    changes = []
    for act in acts:
        aid = act.get("activity_id")
        if not aid:
            continue
        cur_end = act.get("end_date") or ""
        best = None
        best_inv = None
        for inv in invoices:
            for it in inv.get("items") or []:
                if it.get("is_product"):
                    continue
                if (it.get("member_id") or inv.get("member_id")) != member.get("id"):
                    continue
                if it.get("activity_id") != aid:
                    continue
                s, e = _item_window(it)
                if not s or not e:
                    continue
                # Only prepaid windows that have ARRIVED and represent a NEW
                # LATER period: item start strictly after the current end.
                # NEVER same-period items with a later end — profile end dates
                # legitimately drift back from the invoice window via
                # off-schedule attendance, and that drift must be preserved.
                if not cur_end:
                    continue
                if s > today:
                    continue
                if s <= cur_end:
                    continue
                if best is None or e > _item_window(best)[1]:
                    best = it
                    best_inv = inv
        if best is None:
            continue
        s, e = _item_window(best)
        change = {
            "activity_id": aid,
            "from": {"start_date": act.get("start_date"), "end_date": cur_end},
            "to": {"start_date": s, "end_date": e},
            "invoice_id": best_inv.get("id"),
        }
        act["start_date"] = s
        act["end_date"] = e
        act["status"] = "active" if e >= today else "expired"
        act["source"] = "invoice"
        act["source_id"] = best_inv.get("id")
        # Carry schedule fields only when the prepaid item defines them —
        # otherwise keep the member's current (possibly admin-edited) schedule.
        for f in ("schedule", "training_days", "training_time", "day_times", "level_id"):
            v = best.get(f)
            if v:
                act[f] = v
        changes.append(change)

    if changes:
        await db.members.update_one(
            {"id": member.get("id")},
            {"$set": {"activities": acts}},
        )
    return changes


async def roll_forward_all_prepaid(db, today=None):
    """Tenant-wide sweep: roll forward every member whose active window has
    ended (candidates for a prepaid activation). Returns count of members
    updated."""
    today = today or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    updated = 0
    cursor = db.members.find(
        {"activities": {"$elemMatch": {"end_date": {"$lt": today, "$ne": ""}}}},
        {"_id": 0, "id": 1, "activities": 1},
    )
    async for member in cursor:
        try:
            if await roll_forward_member_prepaid(db, member, today=today):
                updated += 1
        except Exception:
            # One bad member must not abort the sweep.
            continue
    return updated
