---
name: Supplier branch scoping
description: How suppliers (الموردين) are isolated per branch with a shared option, and where object-level auth is required.
---
Suppliers can belong to one branch OR be shared across all branches.

- **Shared = falsy branch_id** (None, "", or missing field). Shared suppliers must appear in EVERY branch's view, so list/report queries use an `$or` of `[branch_id==X, None, "", {$exists:false}]` (helper `_supplier_branch_or_shared`). Legacy suppliers predate the field, so they are naturally treated as shared — this matched the user's choice to keep existing suppliers visible to all branches.
- **Create:** admin picks branch (empty => shared/None); non-admin forced to own branch.
- **Update:** must NOT blindly `$set` the whole model — `branch_id` defaults None in the create model, so a naive update silently wipes the branch. Admin may reassign (empty=>shared); non-admin keeps the existing branch_id.

**Why:** "كل فرع وليه موردين" with a "مشترك (كل الفروع)" option for vendors used by all branches.

**How to apply (security):** List scoping is NOT enough. Every by-id endpoint (GET/PUT/DELETE/statement) needs an explicit object-level guard (`_can_access_supplier`: admin OR shared OR same branch), or a non-admin who learns another branch's supplier id can read/modify it. Reports must pin non-admins to their own branch and ignore any client-supplied `branch_filter`. Same recurring gap noted for credit-note read endpoints.
