---
name: Marketer referral discount on invoices
description: How the affiliate/marketer referral discount is computed, shown live in the invoice dialog, and kept consistent with the backend
---

# Marketer referral discount on invoices

The marketer (affiliate) referral discount auto-applies on a referred member's
FIRST invoice. Backend `resolve_marketer_discount(member, current_discount, subtotal)`
computes `subtotal * marketer.discount_percent / 100` ONLY when: member has
`marketer_id`, no prior invoice exists, AND `current_discount == 0`. It returns the
incoming discount unchanged when `current_discount > 0`.

**Why this matters:** because the backend respects an already-sent discount, the
frontend can compute the same marketer discount, display it live in the create-invoice
dialog, and send it as the invoice `discount` WITHOUT double-applying. The backend sees
`current_discount > 0` and keeps the frontend value verbatim.

**How to apply:**
- Keep the frontend formula identical to the backend: base is the **subtotal**
  (pre-VAT), `subtotal * percent / 100`. (VAT is 15%, so subtotal != totalBeforeDiscount —
  do NOT base the marketer discount on the VAT-inclusive total.)
- Do NOT stack marketer discount with a coupon: skip the marketer discount when
  `couponDiscount > 0`, matching the backend's "respect manual discount" rule.
- The referral data (`marketer_id`, `marketer_discount_percent`, `marketer_name`) reaches
  the invoice page via `sessionStorage['prefill_registration']` set by the
  registration-request "process → create invoice" flow.
- `record_first_invoice_commission` uses `subtotal - discount` as the commission base and
  is idempotent per member (unique index on `member_id`).
