---
name: Permission enforcement is per-endpoint
description: Adding a key to ALL_PERMISSIONS + frontend ProtectedRoute is NOT server-side authz; every route handler must call require_permission explicitly.
---

**Rule:** A new permission key (e.g. `rentals`) only becomes real security when EVERY backend endpoint of that feature calls `await require_permission(current_user, "<key>")` (from `utils/auth.py`). Registering the key in `ALL_PERMISSIONS` (routes/users.py) and gating the frontend route/sidebar only affects UI visibility.

**Why:** The rentals feature initially shipped with the key in ALL_PERMISSIONS + frontend guards but no server-side checks — any authenticated user could hit `/api/rentals/*` directly. Architect review flagged it as broken access control.

**How to apply:** When creating a new permission-gated module, add the `require_permission` call as the first line of every handler (list, create, update, delete, reports, helper endpoints like check-conflicts). Admin bypass is inside the helper. Also remember admin-only destructive ops (delete) still need the permission call for non-admin 403 consistency.

Related conventions used in the rentals module (`routes/rentals.py`):
- Conflict checks must run on UPDATE too (schedule fields changed OR cancelled→booked reactivation), self-excluded, same 409 {message, conflicts} shape as create.
- Cross-branch reference guard: entity referenced in a create payload (coach) must belong to the effective branch or be rejected.
