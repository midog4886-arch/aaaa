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
