---
name: Coach lifecycle (terminate / transfer)
description: How coach archive (terminate/reactivate) and cross-branch transfer behave, and the rule for current-month salary on transfer.
---

# Coach lifecycle: terminate / transfer

Lifecycle fields (`status`, `termination_date`, `termination_reason`, `transfers[]`) live on the Coach **response** model only, NOT on the editable CoachBase — so a normal coach edit can never reset them. Legacy/missing `status` is treated as active everywhere.

## Terminate / archive
- Terminate is an **archive**, not a delete. Hard `DELETE /coaches/{id}` still exists and is kept as a valid admin action ("instead of hard-delete" was read as "offer an alternative", not "remove delete").
- Default coach list excludes terminated; `only_terminated`/`include_terminated` params expose the archive. Cache key must include the status scope or the archive view serves stale active lists.
- **Why the attendance guard matters:** hiding terminated coaches in the UI is not enough — QR self-checkin endpoints are public (no auth) and the camera/scanner can still hit a terminated coach by code. So check-in / mark-absent / both qr-checkin endpoints must reject `status=='terminated'` server-side.

## Transfer (current-month salary → new branch)
- User rule: on transfer the **entire current month** salary goes to the NEW branch; past months stay with the old branch for history.
- **How it's achieved:** salary is computed from coach.branch_id + coach_attendance.branch_id (snapshotted at check-in) + any saved non-disbursed coach_salaries draft. Transfer re-tags coach.branch_id, the current month's coach_attendance, and non-disbursed current-month coach_salaries to the new branch. Already-**disbursed** salary is intentionally left on the old branch.
- The "current month" is derived from the client-supplied `transfer_date` (defaults to today) — this is intentional so an admin can set an effective transfer date; it is not a bug.
- Branches are within ONE tenant (tenant isolation is enforced separately via the tenant DB context / X-Tenant-Slug), so cross-branch transfer inside a tenant is the intended operation, not a tenant-boundary breach.
