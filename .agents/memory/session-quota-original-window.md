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
  unmodified `end_date`. The invoice item dates are never rewritten by extensions,
  so they are the source of truth. Registration-form members (no invoice) have no
  extension, so their activity dates ARE original.
- **`activity_id` can DIVERGE between member.activities and the invoice item.**
  Level-based assignment writes the *level's* activity record onto
  `member.activities[]`, whose `activity_id` differs from the invoiced item's. So
  a pure `(source_id, activity_id)` lookup MISSES and the code wrongly fell back
  to the extended deadline (real case: showed 10 instead of 8). Fix = join on the
  never-rewritten `start_date` too. Lookup order: `(source_id, activity_id)` →
  `(source_id, start_date, schedule)` → `(source_id, start_date)` → by-activity →
  else extended end. `start_date`/`schedule` are NEVER mutated by freezes or
  day_extensions (only `end_date` is), so they are stable join keys.
- **Disambiguate, never guess.** A multi-item invoice can share one `start_date`
  across items with different end dates. Key the loose `(source_id, start_date)`
  map to `None` when two items under it disagree, so an ambiguous match falls
  through to the extended-deadline fallback instead of silently picking a wrong
  original end. `schedule` separates co-purchased items that share a start_date.
- **`used_sessions` must count across ALL diverged activity_ids of the same
  subscription, not just the current one.** When a level rename changes the
  activity_id mid-subscription, older check-ins keep the original invoiced
  activity_id while new ones use the level id, so counting only the current id
  under-counts (real case: showed 1/8 when she attended karate 3× in-window).
  Fix = count attendances with `activity_id: {$in: [...]}` over the set
  {current id} ∪ {invoice item ids matched by the SAME `(source_id, start_date,
  schedule)` key}. The existing `date >= start_date` window keeps a PREVIOUS
  subscription's records (same invoiced id, earlier dates) out. Use the
  schedule-precise key only — never the loose `(source_id, start_date)` set — so
  a co-purchased different activity sharing a start_date is not merged in.
- A subscription can be tracked in BOTH `member.activities` and
  `level_subscriptions`, and `day_extensions` may carry `scope_type` `activity`
  and `level_sub` with diverging base dates — don't trust the extended date as the
  quota basis.
