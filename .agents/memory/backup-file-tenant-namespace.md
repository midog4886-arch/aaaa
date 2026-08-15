---
name: Backup file tenant namespace
description: Ownership rules for /backup/* files in the multi-tenant backups dir
---

Backup files in `backend/backups` are shared across tenants; endpoint access is gated by filename ownership, not directory separation.

**Rule:** everything written manually (create / upload / pre-restore snapshot) must live in the `backup_<slug>--<suffix>.json` namespace. Slugs are `^[a-z0-9_]+$`, so `--` is the only separator no slug can produce — plain `_` is ambiguous (tenant `foo` vs `foo_bar`, numeric slugs vs timestamps). Auto backups keep `auto_backup_<slug>_<YYYYMMDD>.json` (exact terminal date shape disambiguates). Legacy slug-less `backup_<digits/underscores>.json` belongs to the default tenant only.

**Why:** the original endpoints let any authenticated user (not just admins) restore/delete ANY tenant's file — cross-tenant data disclosure/destruction. Fixed Aug 2026.

**How to apply:** any new backup-writing code must use the `--` namespace and pass `_safe_backup_path` + `_backup_owned_by_current_tenant` (server.py, near the /backup routes). Restore also snapshots current data to `backup_<slug>--pre_restore_<ts>.json` (keeps 3) and validates collection shapes before wiping. Regression tests: `backend/tests/test_backup_tenant_scope.py`.
