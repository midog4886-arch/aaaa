---
name: Invoice paid status & coupon used_count
description: Invoice create always inserts status "pending" (payload status ignored); coupon used_count increments only at PUT /invoices/{id}/pay.
---

The invoice create route hardcodes `status: "pending"` on insert — any `status: 'paid'` sent from the frontend (renewal dialogs do this) is silently ignored. Invoices are marked paid later via `PUT /invoices/{id}/pay` (InvoicesPage "mark paid" action), which is also where stock deduction, loyalty points, audit log, AND the coupon `used_count` $inc happen.

**Why:** an architect review of the renewal-coupon feature flagged "coupon count never increments" — but this is the same semantics as the main invoice coupon flow (create pending → mark paid → count++). Auto-paying on create would be a behavior change touching stock/loyalty/ledger.

**How to apply:** when adding coupon/discount support to any new invoice-creating flow, sending `discount` + `discount_code` in the create payload is enough; do NOT add a client-side `invoicesAPI.pay()` call just to bump the coupon counter unless the user explicitly wants auto-paid invoices.
