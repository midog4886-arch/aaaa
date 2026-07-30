---
name: Attendance records must stamp branch_id
description: Any attendance write path missing branch_id makes records invisible to every branch-filtered view (today board, reports).
---

Every write to `db.attendance` MUST stamp `branch_id`. Branch-filtered reads
(today-summary board, reports) query `{branch_id: <branch>, date: ...}`, so a
record without the field silently disappears for branch-scoped users — the
member's own history page still shows it (queries by member_id), which is
exactly the confusing "حضر لكنه ما يظهر في حضور اليوم" symptom.

**Why:** the quick-attendance path wrote records with no branch for months
(~157 records); the member page showed them but the today board didn't.

**How to apply:**
- Branch precedence (mirror the manual-attendance route): VIP member →
  scanning user's branch first, else member's branch; regular member →
  member's branch first, else user's branch; final fallback `""`.
- `/attendance` and `/attendance/qr-checkin` have DUPLICATE handlers in
  server.py that are dead (the attendance router is included first), but
  paths that exist ONLY in server.py (`/attendance/quick`, `/attendance/bulk`)
  are live THERE — fix the copy that actually serves the path.
- Old branch-less records were backfilled from the member's branch; records
  whose member is gone stay branch-less and only show in unfiltered views.
