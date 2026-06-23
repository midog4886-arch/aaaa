---
name: Member create branch assignment
description: Why admin-created members must use the UI-selected branch (payload), not the admin's own branch_id
---

# Member creation branch assignment

When an admin creates a member, the member's `branch_id` must come from the
UI-selected branch (sent in the create payload), NOT from the admin's own
`current_user.branch_id`.

**Why:** Invoices already honored the admin-selected branch
(`if is_admin and invoice.branch_id ...`), but member creation used
`require_branch_scope(current_user) or current_user.get("branch_id")`. For an
admin that resolves to the admin's *personal* branch (or None), so members
created while branch X was selected silently landed on the admin's own branch.
The invoice went to X, the member went elsewhere → the member never appears in
X's Members list (filter `{branch_id: X}` misses it), and the selected branch
looks "empty" even though invoices show. This is an invoice/member branch
divergence, not data loss.

**How to apply:**
- `MemberCreate` must include `branch_id` (otherwise the frontend-sent value is
  dropped by Pydantic and the override path silently wins).
- In `_create_member_core`: admins → use payload `branch_id` (ignore `"all"`,
  fall back to own branch); non-admins → still pinned via `require_branch_scope`
  (fail-closed) so payload can't override their scope (no cross-branch leak).
- Same divergence class can affect any create flow that defaults to the actor's
  branch instead of the selected one. Check activities/other entities if a
  freshly-selected branch shows empty while invoices populate.
- Repairing a mis-assigned member can be as small as fixing `branch_id` alone:
  if their activity's level and invoice already point to the destination branch
  (levels are branch-bound), do NOT clear level_id/coach_id — only the member
  doc's branch_id was wrong.
