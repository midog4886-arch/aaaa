---
name: Prepaid subscription auto-activation
description: Rules for rolling member.activities forward onto a paid future-window invoice item
---
A shared helper rolls a member's activity subdoc forward onto a prepaid invoice window (on-demand at profile load + daily per-tenant sweep).

**Rule:** activate ONLY when the item's start_date is STRICTLY AFTER the activity's current end_date (a genuinely new later period), start_date <= today, and the invoice is FULLY paid (partial never activates or badges). Family invoices: the item's own member_id wins over the invoice payer. Merge by activity_id in place; idempotent; never touch the invoice (session quota reads the original purchased window).

**Why:** the naive rule "item end > profile end" matched ~150 members whose profile end_date had legitimately drifted BACK from the invoice window via off-schedule attendance/freeze — a sweep with that rule bulk-destroyed the drift and had to be reverted from the daily backup. Same-period items must never re-extend a pulled-back end date.

**How to apply:** any new activation path (scan, portal, scheduler) must reuse roll_forward_member_prepaid, not re-derive the comparison. Renewals list flags (not hides) such members via `prepaid`/`prepaid_start` from /notifications/expiring-subscriptions.
