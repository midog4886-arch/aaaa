---
name: Prepaid subscription auto-activation
description: Rules for rolling member.activities forward onto a paid future-window invoice item
---
A shared helper rolls a member's activity subdoc forward onto a prepaid invoice window (on-demand at profile load + daily per-tenant sweep).

**Rule:** activate ONLY when the item's start_date is STRICTLY AFTER the activity's current end_date (a genuinely new later period), start_date <= today, and the invoice is FULLY paid (partial never activates or badges). Family invoices: the item's own member_id wins over the invoice payer. Merge by activity_id in place; idempotent; never touch the invoice (session quota reads the original purchased window).

**Why:** the naive rule "item end > profile end" matched ~150 members whose profile end_date had legitimately drifted BACK from the invoice window via off-schedule attendance/freeze — a sweep with that rule bulk-destroyed the drift and had to be reverted from the daily backup. Same-period items must never re-extend a pulled-back end date.

**How to apply:** any new activation path (scan, portal, scheduler) must reuse roll_forward_member_prepaid, not re-derive the comparison. Renewals list flags (not hides) such members via `prepaid`/`prepaid_start` from /notifications/expiring-subscriptions.

**Payment-time rule:** paying a future period for an existing activity is not permission to replace its current subscription or move its current level placement; keep the new period on the invoice until activation.

**Why:** premature payment-time replacement can discard a freeze-compensated current period and make its attendance appear historical. Compensation awards also are not necessarily remaining sessions: a replacement date can itself be frozen again.

**How to apply:** preserve current dates, source and placement together. For historical repairs, reconstruct the old window from invoice and freeze evidence rather than turning the number of freeze records into a new remaining-session allowance.

**Closure overlap rule:** compensation can postpone paid future periods, but never rewrite their invoice dates or amounts. Use separately stored effective dates for activation/display and original source-item dates for quota. Consume periods in chronological order, not by greatest end date.

**Why:** rewriting invoices destroys purchased-quota evidence; selecting the furthest prepaid end can skip a paid month. The user explicitly approved cascading only overlapping periods, leaving separated periods unchanged.

**How to apply:** preserve the exact invoice-item source identity across payment, compensation, activation and quota lookup. Closure application requires a fresh preview and atomic writes; unknown schedules must not result in guessed or partial compensation.
