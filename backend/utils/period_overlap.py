"""Keep paid renewal periods separate when an older period gains make-up sessions.

Invoice dates remain the purchased record.  Operational dates are stored in
subscription_effective_periods, so moving a renewal never changes its invoice
or its number of paid sessions.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

from utils.effective_periods import (
    effective_period_map, invoice_item_key, operational_window,
    original_window, source_key,
)


def _weekdays(item: dict, fallback: dict) -> set[int]:
    text = str(item.get("schedule") or " ".join(item.get("training_days") or [])
               or fallback.get("schedule") or " ".join(fallback.get("training_days") or []))
    variants = (
        (0, "الاثنين", "الإثنين", "اثنين", "إثنين", "monday"),
        (1, "الثلاثاء", "ثلاثاء", "tuesday"),
        (2, "الأربعاء", "الاربعاء", "أربعاء", "اربعاء", "wednesday"),
        (3, "الخميس", "خميس", "thursday"),
        (4, "الجمعة", "جمعة", "friday"),
        (5, "السبت", "سبت", "saturday"),
        (6, "الأحد", "الاحد", "أحد", "احد", "sunday"),
    )
    return {weekday for weekday, *names in variants
            if any((name in text if not name.isascii() else
                    re.search(r"\b" + name + r"\b", text, re.IGNORECASE))
                   for name in names)}


def _shift_window_after(anchor_end: str, base_start: str, base_end: str,
                        weekdays: set[int]) -> tuple[str, str]:
    """Move a paid window after its predecessor without shortening its span."""
    start, end, anchor = (date.fromisoformat(value) for value in
                          (base_start, base_end, anchor_end))
    if end < start:
        raise ValueError("Invalid paid period")
    if not weekdays:
        # Legacy items without a readable schedule keep their exact day span.
        shifted_start = anchor + timedelta(days=1)
        return shifted_start.isoformat(), (shifted_start + (end - start)).isoformat()
    cursor = anchor
    for _ in range(3660):
        cursor += timedelta(days=1)
        if cursor.weekday() in weekdays:
            shifted_start = cursor
            break
    else:
        raise ValueError("Could not locate next training day")
    return shifted_start.isoformat(), (shifted_start + (end - start)).isoformat()


async def reconcile_member_period_overlap(db, member: dict, activity: dict,
                                          *, persist: bool = True) -> list[dict]:
    """Persist non-overlapping dates for paid periods after ``activity``.

    Safe to repeat.  A later closure may replace an effective row; only shifts
    still owned by this reconciler can be reversed when a freeze is cancelled.
    """
    member_id = member.get("id")
    activity_id = activity.get("activity_id")
    current_start = str(activity.get("start_date") or "")[:10]
    current_end = str(activity.get("end_date") or "")[:10]
    if not all((member_id, activity_id, current_start, current_end)):
        return []
    date.fromisoformat(current_start)
    date.fromisoformat(current_end)
    invoices = await db.invoices.find({
        "status": "paid",
        "$or": [{"member_id": member_id}, {"items.member_id": member_id}],
    }, {"_id": 0, "id": 1, "member_id": 1, "branch_id": 1, "items": 1}).to_list(1000)
    invoices = [invoice for invoice in invoices
                if invoice.get("branch_id") == member.get("branch_id")]
    if not invoices:
        return []
    periods = await effective_period_map(db, invoices)
    paid = []
    for invoice in invoices:
        for index, item in enumerate(invoice.get("items") or []):
            if (item.get("is_product") or item.get("activity_id") != activity_id
                    or (item.get("member_id") or invoice.get("member_id")) != member_id):
                continue
            original_start, original_end = original_window(item)
            if not original_start or not original_end:
                continue
            key = source_key(invoice, item, index)
            paid.append((original_start, original_end, key, invoice, index, item))
    paid.sort(key=lambda row: (row[0], row[1], row[2]))
    current_key = activity.get("source_period_key")
    if not current_key:
        matches = [row for row in paid if row[3].get("id") == activity.get("source_id")
                   and row[0] <= current_start <= row[1]]
        if len(matches) == 1:
            current_key = matches[0][2]
    current_row = next((row for row in paid if row[2] == current_key), None)
    # Without an exact source, guessing which invoice is the older one could
    # move the wrong paid period. Leave the account untouched for review.
    if not current_row:
        return []

    writes = []
    current_original_start = current_row[0]
    current_period = periods.get(current_key) or {}
    if ((current_period and
         (current_period.get("effective_start_date"), current_period.get("effective_end_date"))
         != (current_start, current_end)) or
        (not current_period and (current_start, current_end) != current_row[:2])):
        _, _, _, invoice, index, item = current_row
        writes.append({
            "source_key": current_key, "source_invoice_id": invoice.get("id"),
            "source_item_id": invoice_item_key(invoice, item, index),
            "member_id": member_id, "activity_id": activity_id,
            "original_start_date": current_row[0],
            "original_end_date": current_row[1],
            "effective_start_date": current_start,
            "effective_end_date": current_end,
            "schedule": item.get("schedule") or activity.get("schedule") or "",
            "source_bound_quota": True,
        })

    anchor_end = current_end
    anchor_key = current_key
    for original_start, original_end, key, invoice, index, item in paid:
        if key == current_key or original_start <= current_original_start:
            continue
        effective_start, effective_end = operational_window(invoice, item, index, periods)
        previous = periods.get(key) or {}
        # A prior reconciliation recorded the dates before its own shift.
        # Re-evaluate against those dates when the predecessor changes.
        base_start = previous.get("overlap_base_start") or effective_start
        base_end = previous.get("overlap_base_end") or effective_end
        if not base_start or not base_end:
            continue
        if base_start <= anchor_end:
            new_start, new_end = _shift_window_after(
                anchor_end, base_start, base_end, _weekdays(item, activity)
            )
        else:
            new_start, new_end = base_start, base_end
        if (new_start, new_end) != (effective_start, effective_end):
            row = {
                "source_key": key, "source_invoice_id": invoice.get("id"),
                "source_item_id": invoice_item_key(invoice, item, index),
                "member_id": member_id, "activity_id": activity_id,
                "original_start_date": original_start,
                "original_end_date": original_end,
                "effective_start_date": new_start,
                "effective_end_date": new_end,
                "schedule": item.get("schedule") or activity.get("schedule") or "",
                "source_bound_quota": True,
            }
            if (new_start, new_end) != (base_start, base_end):
                row.update(overlap_base_start=base_start,
                           overlap_base_end=base_end,
                           overlap_anchor_key=anchor_key)
            writes.append(row)
        anchor_end, anchor_key = new_end, key

    if not persist:
        return writes
    for row in writes:
        key = row["source_key"]
        update = {"$set": row}
        if "overlap_base_start" not in row and (periods.get(key) or {}).get("overlap_anchor_key"):
            update["$unset"] = {
                "overlap_base_start": "", "overlap_base_end": "",
                "overlap_anchor_key": "",
            }
        await db.subscription_effective_periods.update_one(
            {"source_key": key}, update, upsert=True
        )
    return writes
