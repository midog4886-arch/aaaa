---
name: Activity per-branch isolation
description: Why global (no-branch) activities leak into every branch and where to fix it
---

# Global activities leak across branches

`GET /activities` (backend/routes/activities.py) intentionally includes
no-branch activities in EVERY branch via a `$or` on `branch_id`
(`{branch_id: X} | {branch_id: None} | {branch_id missing}`). So any activity
created with `branch_id=None` (admin picking branch "all", or legacy/imported
rows) shows up in every branch's dropdowns.

**Why not fix the backend $or:** some tenants' entire catalog is global-only
(e.g. a single-branch tenant whose one activity has `branch_id=None`).
Stripping globals app-wide would leave those tenants with zero activities.
High blast-radius — avoid.

**Where to fix instead:** scope per-view in the frontend. For the invoice
dialog this is `scopeActivitiesToBranch(activities, branchId)` in
CreateEditInvoiceDialog.jsx: if the target branch has its own activities show
ONLY those (hide globals); fall back to globals only when the branch has none.
The branch context for invoices comes from the selected member's `branch_id`
(and the additional-members/siblings rows use each sibling's member branch).

**How to apply:** when a "each branch shows its own prices" request hits any
activity picker, prefer this branch-with-global-fallback heuristic at the
consuming UI, not a blanket backend change. Real per-branch isolation would
require every activity to carry a real `branch_id` (data cleanup), which the
default tenant declined — so code-side scoping is the chosen path.
