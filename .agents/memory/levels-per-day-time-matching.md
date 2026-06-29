---
name: Levels per-day time matching
description: How Levels auto-assign/picker match members who train at a different hour per weekday
---

A member can train at a DIFFERENT hour per weekday (e.g. Sat@5pm, Fri@3pm),
stored as `member.activities[].day_times` ({arabic_day_name: "5:00 م"}) plus the
free-text `schedule`. Level matching must consider the hour for the RIGHT day,
not the first hour of the schedule string.

**Rule:** a level matches a member if, for at least one weekday they share
(level.days ∩ member days), the member's hour on THAT day == the level's hour
(`time_slot`). Backend: `_member_day_hours()` builds {weekday_id -> hour12}
(seed common schedule hour, override per day from day_times); `_level_day_time_match()`
applies the overlap rule with a fallback to the common hour for uniform-time
members and legacy day-less levels. Both live in levels.py and feed the
auto-assign endpoint (validation helper + main candidate loop).

**Why Option A (one level per member):** a member's level link is a single
scalar `member.activities[].level_id`, so a member CANNOT be placed in two
levels for the same activity. Multi-level would need a schema change. Smart
per-day matching keeps the member in ONE level while still surfacing the right
level for each day in the picker.

**Entry points that write day_times:** the shared `ScheduleDaysTimeEditor`
component is used in BOTH MembersPage (3 forms) AND the invoice
create/edit dialog. The invoice flow carries day_times through invoice items →
backend invoices.py member.activities write (update + append branches) and
through InvoicesPage quick-create mapping. When adding a NEW schedule-entry path,
carry day_times alongside schedule/training_days/training_time, and load it in
any edit-dialog mapping (openEditDialog dropped it once → per-day overrides lost
on re-save).

**How to apply:** any new place that filters levels by time for a member must use
per-day hours, never `_times_match`/first-hour-of-schedule (that helper is now
dead code, kept only as a reference). Frontend `matchingLevelsForAssign` replicates
the rule inline (its shared DAY map/hour helper are declared later in the file →
TDZ, so the logic is duplicated inside the useMemo). Hour normalization must match
on both sides: 0→12, 13-23→ −12 (12h).
