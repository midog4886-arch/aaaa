---
name: Route Update models silently drop unlisted fields
description: A pydantic *Update* model that omits an editable field makes that field's edits no-ops, even when the UI sends it
---

# Update models must list every editable field

Each route's `*Update` pydantic model is the allow-list for a PUT/PATCH. Any field
the frontend sends that is NOT declared on the model is dropped by FastAPI before
the handler runs — so the edit silently does nothing and the UI still shows a
success toast.

**Why:** seen with marketer branch editing — `MarketerUpdate` was missing
`branch_id` while `MarketerCreate` had it, so admins could "change" a marketer's
branch but it never persisted ("لم يتغير الفرع"). Same class as the members route
having its own `MemberCreate` that drops extra fields.

**How to apply:**
- When a create-payload field becomes editable, add it to the `*Update` model too,
  not just the create model.
- For nullable/"all"→None fields, use `'<field>' in data.model_fields_set`
  (pydantic v2) to distinguish "explicitly set to null/all" from "omitted", or an
  explicit null clears nothing.
- Keep branch reassignment admin-only on the server (`current_user.is_admin`),
  mirroring the create flow and the admin-gated UI field — never trust UI gating
  alone for authz.
