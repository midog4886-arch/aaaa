---
name: Invoice–member linkage invariant
description: Activity (subscription) invoices must be linked to a member; where the guards live and which flows create invoices.
---

Rule: every non-product (activity) invoice item must resolve to a member — top-level `invoice.member_id` for primary items, per-item `member_id` for `additional_members` items. The membership-card (QR) button in the invoices table only renders for `status=paid && invoice.member_id`.

**Why:** invoices created from the registration-request prefill flow (and the old reg-form convert endpoint that hardcoded `member_id: None`) produced paid invoices with no member → no membership card, and attendance/renewals lost the subscriber.

**How to apply:**
- Frontend guard: `useInvoiceForm.handleCreateInvoice` blocks create (not edit) when any non-product item exists and no `selectedMember`. Product-only invoices (walk-ins) stay member-less by design.
- Backend guards: `POST /invoices` 422s on unlinked primary activity items; client-supplied per-item `member_id` that differs from `invoice.member_id` is validated via the branch-scoped member filter (never trust it raw). Reg-form convert now carries `form.member_id`/`member_code` and 422s if an activity form has no member.
- Raw-API edge (accepted): valid per-item member_ids with null top-level member_id is data-linked but hides the card button; UI never sends this shape.
- Matching customers to members by phone alone is unsafe — siblings share phones; only exact-name matches were auto-linked in the backfill.
