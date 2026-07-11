---
name: Split payment on invoices
description: How split (cash/card/transfer) invoice payments are stored and surfaced in reports and UI
---
# Split payment on invoices

An invoice can be paid partly cash + partly card (network/شبكة) + partly bank transfer.

- Storage: when `payment_split` (dict, keys limited to `cash`/`card`/`transfer`) is present and its non-zero legs sum to the invoice `total` (±0.5), the create handler sets `payment_method="split"` and stores `payment_split`. Backend whitelists keys and safely parses numbers (400 on bad key/value/sum-mismatch).
- Reports MUST distribute each leg to its own method, never the whole total under "split": sales report `by_payment_method` and daily ledger `income_by_method` both branch on `payment_split` first, add each leg to its method, and `continue`.
- Frontend split leg keys MUST match report method keys exactly (`cash`/`card`/`transfer`), or per-method report totals drift.
- Screen-only display: the split breakdown in ViewInvoiceDialog must live OUTSIDE the `printRef` container. `printRef` is captured by html2canvas for print/PDF/WhatsApp image — CSS `print:hidden` does NOT hide content from html2canvas, only real @media print. Only real placement outside `printRef` keeps it screen-only.

**Known gap (not yet fixed):** sales report `payment_method` query filter matches `payment_method` field only, so filtering by e.g. `card` excludes split invoices that have a card leg. Fixing requires leg-level distribution under filter, which changes totals math.
