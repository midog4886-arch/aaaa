---
name: Per-branch WhatsApp templates
description: How branch-level WhatsApp renewal/manual reminder text overrides the global template, and the gotchas in resolving them.
---

# Per-branch WhatsApp message templates

Branches can override two WhatsApp reminder texts: renewal (automatic) and
manual. Stored on the branch doc as `whatsapp_renewal_template` and
`whatsapp_manual_template`. Empty/missing = use the shared global template in
`whatsapp_settings` (backward compatible).

**Resolution rule:** branch override (if non-empty) wins over the global/
per-offset template. Keyed by `member.branch_id` → branch doc `id`. Members with
no branch, or branches with no override, fall back to global.

**Where it's applied:**
- Backend automatic scheduler and manual bulk-send both call
  `_get_branch_templates()` once per run and resolve per member via
  `_resolve_branch_template(branch_templates, branch_id, kind, fallback)` in
  `routes/whatsapp.py`. kind = "renewal" (scheduler) or "manual" (bulk send).
- Frontend `RenewalsPage.buildReminderText` resolves the *manual* template
  client-side from the already-loaded `branches` array (for the per-card Remind
  button + the wa.me fallback when the WA service is disconnected). It MUST be
  kept in sync with the backend manual resolution, otherwise the wa.me text and
  the service-sent text diverge.

**Why two resolution sites:** when the WA service is connected the backend
renders+sends; when disconnected the browser opens wa.me with frontend-rendered
text. Both paths must honor the branch override.

**Gotchas:**
- Branch has TWO pydantic models (routes/branches.py BranchBase is the live one,
  models/branch.py mirrors it) — add new branch fields to BOTH.
- push/portal reminder templates are intentionally global, NOT per-branch.
- Template length capped at 1000 chars in branch create/update to match the
  global template limits.
