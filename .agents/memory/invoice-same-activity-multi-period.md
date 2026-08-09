---
name: Invoice with multiple periods for the same activity
description: How /pay handles two+ prepaid periods of one activity on a single invoice
---
Rule: member.activities holds ONE subdoc per activity_id. When one paid invoice carries several non-product items for the same activity (e.g. two prepaid months), pay_invoice dedupes BEFORE merging: pick the period covering today, else the earliest upcoming, else the latest. The other prepaid periods live only on the invoice.

**Why:** previously the last item silently overwrote the current period with the future one, so the member's profile showed the next month's dates while the current subscription "disappeared" (seen as «يوجد اشتراك واحد» with wrong dates).

**How to apply:** any new write path that merges invoice items into member.activities must apply the same per-activity dedupe. Auto-activating the prepaid future period when its start date arrives is a separate mechanism (prepaid-activation task); dates are zero-padded ISO strings so lexical compare is safe — keep it that way.
