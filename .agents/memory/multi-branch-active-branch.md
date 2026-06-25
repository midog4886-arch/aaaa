---
name: Multi-branch non-admin active branch
description: How a non-admin user assigned several branches switches between them one-at-a-time and how the active branch propagates everywhere.
---

# Multi-branch non-admin (supervisor) active branch

A non-admin user can be assigned MULTIPLE branches via `user.branch_ids[]`
(JWT + login response carry it; `branch_id` stays as the primary = first). They
switch between branches **one at a time** like the admin switcher, but limited
to their allowed set (no "all" option for non-admins).

**Mechanism:** frontend sends the currently selected branch on EVERY request as
header `X-Branch-Id` (mirrors `X-Tenant-Slug` in the axios interceptor, value
from `localStorage.selectedBranchId`; omitted when `all`). Every
`get_current_user` dependency reads it into `payload["_active_branch"]`.

**Why the override trick:** there are dozens of branch-sensitive call sites that
read `current_user["branch_id"]` directly (lists, writes, transfer guards). To
make the active branch apply *everywhere* without touching them all,
`apply_active_branch(payload)` (in `utils/auth.py`) **pins
`current_user["branch_id"]` to the validated active branch — but only for
multi-branch non-admins** (`len(allowed) > 1`). `branch_ids` keeps the full set
for `resolve_branch_filter`/`require_branch_scope`. Admins and single-branch
users are left untouched → identical legacy behavior.

**How to apply / gotchas:**
- There are THREE `get_current_user` copies (server.py, utils/auth.py,
  routes/common.py) PLUS two `get_current_user_from_token`. ALL must read
  `X-Branch-Id` and call `apply_active_branch`, or some routes silently ignore
  the switch. Each takes `request: Request` as first param.
- Spoof-safe: an `X-Branch-Id` not in the user's allowed set (or missing) falls
  back to `allowed[0]` — a non-admin can never escape their assigned branches.
- New branch-sensitive non-admin code can keep reading `current_user["branch_id"]`
  directly; it transparently resolves to the active branch. Do NOT special-case
  multi-branch per endpoint.
- `GET /branches` returns ALL allowed branches for non-admins (so the switcher
  can list them), NOT just the active one — it bypasses `resolve_branch_filter`
  and uses `{"id": {"$in": allowed}}`.
- `routes/users.py` has its OWN `UserCreateAdmin`/`UserUpdateAdmin`; persist
  `branch_ids` THERE (update uses `model_fields_set`). UsersPage dialog uses
  checkboxes → sends `branch_ids[]`; user list shows `branch_names[]`.
