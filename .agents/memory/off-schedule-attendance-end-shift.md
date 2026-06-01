---
name: Off-schedule attendance end-date shift
description: Rule + invariants for attending on a non-scheduled weekday — pulls subscription end date earlier and how it reverses.
---

# Off-schedule attendance shifts the subscription end date

When a member attends on a weekday that is NOT in their schedule (e.g. schedule
Mon/Wed but they come Tuesday), the attendance is recorded on its real date,
counts as a used session, AND the subscription `end_date` (on the matching
`member.activities[]` entry) is pulled **earlier by exactly one scheduled
occurrence** (the previous scheduled weekday before the current end date).

**Why:** business rule confirmed by the academy owner — an off-day session is
consumed "out of schedule," so the membership should end one scheduled slot
sooner rather than letting members gain extra calendar time by attending extra
days. Applies to BOTH live QR check-in and manual date registration.

**How to apply / invariants (all in `backend/routes/attendance.py`):**
- Forward shift = previous scheduled occurrence; reversal on delete = **next**
  scheduled occurrence. Stepping one occurrence forward/back on the fixed weekday
  grid is order-independent, so deleting any one of several off-schedule records
  restores correctly regardless of delete order. Do NOT reverse by restoring a
  stored "before" value (that is LIFO-only and wrong for multiple records); only
  use the stored value as a fallback when the schedule can't be resolved.
- The off-schedule shift is marked on the attendance record (`off_schedule`,
  `end_shift_from`, `end_shift_to`) so deletion knows to reverse it.
- **Quota counting must include off_schedule records regardless of the date
  window.** `check_member_session_quota` counts `date >= start AND (date <= end_date
  OR off_schedule == true)`. Without the `off_schedule` clause, an off-day session
  whose date falls AFTER the now-pulled-back end date silently drops out of
  `used_sessions` and the member appears to have more sessions than they used.
- Total allowed sessions is still computed from the ORIGINAL invoice window
  (`quota_end`), never the shifted/extended `end_date` — so the shift changes the
  displayed deadline and remaining, not the paid total.
