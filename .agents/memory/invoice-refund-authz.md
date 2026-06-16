---
name: Invoice refund authorization
description: Permission + branch scoping rules for the invoice refund (credit-note) operation.
---
The refund operation `POST /api/invoices/{id}/refund` (defined in backend/server.py, NOT routes/invoices.py — credit-note CRUD lives in server.py) is authorized as:
- Admins bypass all checks.
- Non-admins must have the `invoices-refund` permission (separate from `invoices`), checked via `_load_user_permissions`.
- Non-admins must ALSO own the invoice's branch: `invoice.branch_id == current_user.branch_id`, else 403 (prevents IDOR by guessing invoice IDs).

Frontend gate: `canRefund = isAdmin || user.permissions.includes('invoices-refund')` hides the refund buttons (InvoicesPage inline table + ViewInvoiceDialog). The UI hide is UX-only; the server is the real gate.

**Why:** Refunds create credit notes that reduce reported income; the academy wanted refunds restricted to specific staff, and cross-branch refunding was a security gap.

**How to apply:** Any new refund/credit-note WRITE entry point must reuse both checks. KNOWN GAP (follow-up): credit-note READ endpoints `/credit-notes/{id}` and `/credit-notes/{id}/qr` still lack non-admin branch scoping.
