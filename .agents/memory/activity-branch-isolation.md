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

# Level pickers must scope by branch too

Levels are branch-bound (`level.branch_id`) but `GET /levels` returns ALL
branches for admins (non-admins get own branch + no-branch via `$or`). Any
level picker UI must therefore filter client-side: keep levels whose
`branch_id` matches the picker's branch context PLUS no-branch (legacy)
levels. Branch context chain: selected member's `branch_id` → page branch
filter (if not "all") → user's own branch. Saved `level_id` display lookups
(`levels.find`) stay UNSCOPED on purpose so a stale cross-branch link still
renders its name. Pickers wired: THREE cascading pickers in
MembersPage (member add/edit dialog, edit-activity inline, add-activity
dialog — first and last share activityForm/memberLevelSelectorState), the
invoice form hook (grouped + by-days), registration-form sibling Select.
All member-page pickers mirror the invoice picker: day-filtered levels
(Arabic day -> level.days), hour-filtered time slots, day-aware member
counts (members_details + active-at-start-date). Keep them in parity —
users compare them directly.

# LevelsPage render guard (mixed branches on shared weekdays)

Even with `branch_filter` on every fetch, the Levels day/slot views could show
other branches' levels: an in-flight request from a previous branch selection
(or an initial 'all' state) resolves last and repaints unfiltered data.
Fix: render from a branch-filtered memo (branch match OR no-branch) instead of
raw levels state, plus a load-sequence counter in the loader so stale responses
are dropped. Any new levels-rendering path must consume the filtered array.

# Temporary branch-merge view (LevelsPage)

User can pick a second branch to VIEW alongside the selected branch on shared
days (mergeBranchId, session-only, cleared on branch switch). Merged levels are
strictly view-only: `isForeignLevel()` gates edit/delete/close buttons,
drag-drop (both source and target), per-member + bulk attendance, manage
members, scheduler shortcut, AND the bulk time-slot rename/delete handlers
(which otherwise iterate `getLevelsForTimeSlot` over the merged set).
**Why:** merged view would otherwise become a cross-branch mutation path.
**How to apply:** any new mutating action on level cards or slot groups must
check `isForeignLevel` first; weekday cards union both branches' working_days.
