---
name: Member create permission split
description: Two member-creation endpoints with different permission gating; which UI uses which.
---
Member creation has two backend endpoints sharing `_create_member_core` (tenant plan limit + `require_branch_scope` branch isolation + code gen + insert):
- `POST /api/members` — calls `require_permission(current_user, "members-create")`. Used by the Members page (`membersAPI.create`).
- `POST /api/members/quick-create` — skips the permission check (still authenticated, branch-scoped, plan-limited). Used by the invoice flow (`membersAPI.quickCreate`).

**Why:** Non-admin staff who create invoices must be able to quick-add a member, but the academy wants the `members-create` restriction to apply only on the Members page.

**How to apply:** Any "add new member" entry point inside the invoice/registration-form flow must use `membersAPI.quickCreate`, NOT `create`. There are 3 such entry points: InvoicesPage main add-member dialog, CreateEditInvoiceDialog additional-member, RegistrationFormDialog additional-member. Keep the Members page on `create` so its restriction stays page-specific.
