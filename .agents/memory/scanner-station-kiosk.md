---
name: Scanner-station locked kiosk user
description: How the dedicated tablet scanner user/page is wired and why the redirect is exact-match
---

A dedicated tablet "scanner station" is a normal non-admin user granted EXACTLY one
permission: `scanner-station`. It logs in and is dropped on a full-screen kiosk page
(`/admin/scanner-station`, ScannerStationPage) that renders OUTSIDE the admin Layout
(no sidebar) and reuses `GlobalScanner` for USB/Bluetooth keyboard-wedge check-in.

**Why exact-match redirect:** `getFirstAllowedRoute` sends to the kiosk only when
`permissions === ['scanner-station']` (length 1). An earlier version used
`permissions.includes('scanner-station')` which forced ANY user holding that perm
(even mixed-permission staff) onto the kiosk — a regression. Keep it exact-match so
only scanner-only profiles are locked to the kiosk.

**How to apply / gotchas:**
- A new permission key must be added in 4 synced places: backend `ALL_PERMISSIONS`
  (users.py), frontend UsersPage permission list, App.js route `ProtectedRoute`, and
  (optional nav) Layout navGroups + a LanguageContext label.
- `GlobalScanner` is mounted ONLY in Layout; the kiosk page (no Layout) can mount it
  itself without double-mounting elsewhere.
- Branch scoping is automatic: AuthContext sets `selectedBranchId = user.branch_id`
  for non-admins on login, and GlobalScanner reads it.
- Lock-down relies on per-route permission gating; auth-only routes (e.g.
  `/admin/onboarding`) must also carry a permission or scanner-only users can reach them.
