---
name: Invoice discount applied after tax
description: Discounts (coupon/manual/marketer) subtract from the VAT-inclusive grand total, not the taxable base
---

# Invoice discount applied after tax

Rule: invoice math is `vat = subtotal * 15%`, `total = max(subtotal + vat - discount, 0)`.
The discount (coupon, manual, or marketer) does NOT reduce the taxable base.

**Why:** user requirement (July 2026): total 400 incl. VAT with a 50 coupon must
yield exactly 350. The old backend formula (`taxable = subtotal - discount`, VAT
on taxable) shaved off `discount * 1.15` and disagreed with the frontend live
preview, which was ALREADY after-tax.

**How to apply:**
- Both invoice create (routes/invoices.py) and update (server.py) must keep the
  same formula; split-payment validation compares against this recomputed total.
- Discount AMOUNT is still computed on the subtotal (percentage coupons and the
  marketer pct) — only the subtraction point is after VAT.
- Print/exports must render STORED subtotal/vat_amount/discount/total (recompute
  only as fallback) so historical pre-tax-discount invoices keep their saved
  numbers. Display order: subtotal → VAT → discount → total.
- Registration forms are a separate NO-VAT flow (`vat_amount: 0`,
  `total = subtotal - discount`) — leave unchanged.
