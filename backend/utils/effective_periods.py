"""Operational subscription windows that leave paid invoice items immutable."""
from __future__ import annotations

import hashlib
import json


def invoice_item_key(invoice: dict, item: dict, index: int) -> str:
    """Return a stable identity for an item in an immutable invoice."""
    explicit = item.get("id") or item.get("item_id")
    if explicit:
        return str(explicit)
    original_start, original_end = original_window(item)
    identity = {
        "invoice_id": invoice.get("id"),
        "index": index,
        "member_id": item.get("member_id") or invoice.get("member_id"),
        "activity_id": item.get("activity_id"),
        "start_date": original_start,
        "end_date": original_end,
        "schedule": item.get("schedule"),
    }
    return hashlib.sha256(
        json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def source_key(invoice: dict, item: dict, index: int) -> str:
    member_id = item.get("member_id") or invoice.get("member_id") or ""
    return "|".join((
        str(invoice.get("id") or ""),
        invoice_item_key(invoice, item, index),
        str(member_id),
        str(item.get("activity_id") or ""),
    ))


def original_window(item: dict) -> tuple[str, str]:
    start = str(item.get("start_date") or "")[:10]
    end = str(item.get("end_date") or "")[:10]
    period = item.get("period") or ""
    if (not start or not end) and " - " in period:
        parts = period.split(" - ")
        if len(parts) == 2:
            start = start or parts[0].strip()[:10]
            end = end or parts[1].strip()[:10]
    return start, end


async def effective_period_map(db, invoices: list[dict], session=None) -> dict[str, dict]:
    keys = [
        source_key(inv, item, index)
        for inv in invoices
        for index, item in enumerate(inv.get("items") or [])
        if not item.get("is_product")
    ]
    if not keys:
        return {}
    # Lightweight unit-test databases and pre-migration adapters may not expose
    # the collection; no row means the immutable invoice window is effective.
    try:
        collection = db.subscription_effective_periods
    except AttributeError:
        return {}
    kwargs = {"session": session} if session is not None else {}
    rows = await collection.find(
        {"source_key": {"$in": keys}}, {"_id": 0}, **kwargs
    ).to_list(len(keys))
    return {row["source_key"]: row for row in rows}


def operational_window(invoice: dict, item: dict, index: int, periods: dict) -> tuple[str, str]:
    row = periods.get(source_key(invoice, item, index)) or {}
    original_start, original_end = original_window(item)
    return (
        str(row.get("effective_start_date") or original_start or "")[:10],
        str(row.get("effective_end_date") or original_end or "")[:10],
    )