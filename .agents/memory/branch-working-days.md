---
name: Branch working days
description: Per-branch operating days and how they scope the Levels/Schedule day cards
---

# Branch working days

Branches can operate only specific weekdays (not the whole week). Stored on the
branch as `working_days: Optional[List[str]]` (ids: saturday..friday).

**Backward compat rule:** `None`/empty `working_days` = open all week. Legacy
branches (no field) must keep showing all 7 days; the edit form maps
missing/empty -> all 7 so saving an old branch never silently restricts it.

**Levels/Schedule day cards** are filtered by the SELECTED branch's working days
(`visibleWeekdays` in LevelsPage). `selectedBranchId === 'all'` or a branch with
missing/empty working_days -> full week.

**Why LevelsPage must fetch branches for EVERYONE (not just admins):** non-admin
users have `selectedBranchId` = their own branch_id (set at login), so the day
filter needs that branch record to resolve working_days. The `/branches` GET is
scoped by `resolve_branch_filter`, so non-admins only ever get their own branch
back — fetching it is safe and does NOT expose the admin-only branch <Select>
(that stays gated on `isAdmin && branches.length > 0`).

Note: the branch settings model actually used by the routes is the one defined
INSIDE `backend/routes/branches.py` (its own BranchBase), not
`backend/models/branch.py`. Keep both in sync but edit the route's model to
change real behavior.
