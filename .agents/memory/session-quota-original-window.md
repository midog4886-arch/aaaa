---
name: Session quota total = original purchased window
description: How paid session totals must be computed vs deadline extensions (freezes/closures)
---

# Session quota total comes from the ORIGINAL window, not the extended deadline

`check_member_session_quota` (backend/routes/attendance.py) computes a member's
paid session total as `ceil((end - start)/7) * days_per_week`. The **total** must
be derived from the ORIGINAL purchased subscription window, NOT the (possibly
extended) deadline.

**Why:** Freezes (`member_freezes`) and holiday closures (`day_extensions`) push
the activity's `end_date` out so the member keeps time to use their sessions.
Computing the total from that extended `end_date` inflates the paid count (a real
case: 8 paid sessions displayed as 12 after a freeze + Eid closure). The academy
rule, confirmed by the owner: an extension extends the *deadline only*, never the
number of sessions paid for.

**How to apply:**
- `member.activities[].end_date` is the **extended deadline** — use it for display
  and for the attendance counting window (so attendances during the extension
  still count as used).
- The **total** uses the original window: look up the source invoice item's
  unmodified `end_date` via `(source_id, activity_id)`, fallback to a by-activity
  map. The invoice item dates are never rewritten by extensions, so they are the
  source of truth. Registration-form members (no invoice) have no extension, so
  their activity dates ARE original.
- A subscription can be tracked in BOTH `member.activities` and
  `level_subscriptions`, and `day_extensions` may carry `scope_type` `activity`
  and `level_sub` with diverging base dates — don't trust the extended date as the
  quota basis.
