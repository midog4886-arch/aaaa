---
name: Tenant context required in one-off scripts
description: Backend helpers (member codes, counters) misbehave without tenant context; how to set it in maintenance scripts.
---

Rule: any one-off script that imports backend helpers touching prefixes/counters (e.g. `utils.member_code.generate_member_code`) MUST set the tenant context first — fetch the tenant doc from `control_db.tenants` (slug `default` for champions_default) and call `utils.tenant.set_current_tenant(tenant)`. Do NOT just run with `STRICT_TENANT_CONTEXT=0`.

**Why:** with no tenant set, `get_current_tenant()` returns None → the academy prefix resolves to a fresh default ("ACAD") with a brand-new global counter starting at 1. That issues member codes with the wrong prefix AND numeric suffixes that collide with legacy codes, breaking short-suffix card-scan lookups. Had to regenerate codes and delete the bogus `branch_counters` doc (`member:global:ACAD`).

**How to apply:** in scripts run from `backend/`: `sys.path.insert(0,'.')`, import `database.db`, `control_db.control_db`, `utils.tenant.set_current_tenant`, set the tenant BEFORE importing/calling code-generation helpers. Plain reads/writes on `db` are fine with strict mode off, but anything that derives tenant-level identity (prefixes, counters, plan limits) needs the real tenant doc.
