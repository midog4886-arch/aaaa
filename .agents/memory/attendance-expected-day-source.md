---
name: Expected-attendance day source
description: How "expected/absent today" decides a member trains today — personal schedule vs level days[]
---

# Expected-attendance day matching (today-summary)

The member's OWN recorded training days (parsed from their activity
`schedule` text, e.g. "الأحد و الأربعاء") are authoritative for deciding
whether they are "expected" today. A level's `days[]` is the level's full
weekly timetable, which is frequently **every day of the week** because one
level hosts different sub-groups on different days.

**Rule:** match today against the member's parsed personal days when those
exist; only fall back to the level's `days[]` when the schedule text has NO
parseable day names. Never OR the two together.

**Why:** ORing personal-days with level-days made a Sun/Wed swimmer count as
"expected" (and therefore "absent") every single day, inflating the dashboard
"غائب اليوم" count massively (observed 84 vs the correct ~16 for one tenant,
because nearly all swimming levels had all 7 weekdays in `days[]`).

**How to apply:** any expected/scheduled-today computation (today-summary and
any similar per-day expectation logic) must prefer parsed personal schedule
days; treat `level.days[]` strictly as a fallback for members whose schedule
text lacks day names.

# Expected-attendance HOUR source (same rule)

The displayed/grouping hour must follow the same authority order: member's
`day_times` entry for TODAY's weekday → hour parsed from the member's own
`schedule` text → level `time_slot` hour (fallback only) → None. A level's
`time_slot` describes the level's slot; a member can be placed in a level
whose hour differs from their booked موعد (observed: موعد "8:00 م" shown as
"expected at 7" because the linked level was "الساعه 7").
