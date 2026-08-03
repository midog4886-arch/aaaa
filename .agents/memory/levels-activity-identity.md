---
name: Levels page activity identity
description: How the Levels/Schedule page identifies activity types and supports custom ones
---

# Levels page activity identity

On the Levels/Schedule builder, an activity has **no stored id**. Its identity is
derived by string-parsing each `level.activity_name`, which is stored as
`"<activity> - <time slot>"` (e.g. `"سباحة - الساعة 4"`).

`parseActivityName` splits on the FIRST `" - "`:
- prefix → maps to a built-in (swimming/football/karate) ONLY via EXACT name match
  (`matchBuiltInActivityExact` against `BUILT_IN_EXACT_NAMES`: the sport name itself,
  ± `ال`, common spellings), OR
- prefix → IS a custom activity id (the label itself, e.g. `"تنس"`, `"سباحه سيدات"`).
- No `" - "` separator = legacy data → OLD keyword-match the whole string, else `other`.

**Why exact, not keyword, for the prefix:** keyword matching (`سباح` substring)
absorbed qualified activities like `"سباحه سيدات"` into the built-in swimming card,
so ladies-swimming never got its own card. Qualified prefix = distinct custom
activity. Verified across tenant DBs: every existing built-in prefix (`سباحة`,
`كرة قدم`, `كاراتيه`) is in the exact whitelist, no accidental splits.

Legacy keyword matcher (`matchBuiltInActivity`, still used for separator-less
names and creation's no-double-prefix check): swimming=`سباح/swim`,
football=`قدم/foot`, karate=`كارات/karate`.

The level pickers in the invoice dialog, registration-form dialog, and Members
page (`useInvoiceForm.parseActivityForLevel` + `MembersPage.parseActivityForLevel`)
now MIRROR the exact-prefix rule (user asked "أين باقي الأنشطة الخاصة بالفرع"):
custom prefixes become their own group keys and all six activity-step render
sites list them as extra buttons (🎽, purple) before the `أخرى` bucket. Time/level
steps index `grouped[selectedActivity]` so arbitrary string keys work as-is.

The BACKEND also mirrors the parser now: the public registration endpoint
(`registration_requests.py` `_activities_from_levels` + exact/keyword matchers)
derives the form's activity chips from the branch's ACTIVE levels — branch-own
first, else shared/legacy — so visitors see the day-page activities, not
db.activities plan names ("سباحه 2"); db.activities is only the zero-levels
fallback. Any parser rule change must be applied in that Python copy too.

**Why bare `كرة` is NOT a football keyword:** app-generated football is always
`"كرة قدم - ..."` (matched via `قدم`), so dropping bare `كرة` lets custom ball
sports (`كرة السلة`, `كرة الطائرة`) be their own activities instead of collapsing
into football. Verified once across all tenant DBs: 0 football levels stored with
`كرة` but without `قدم`, so this is safe for existing data.

**How to apply:** any code that creates a level MUST mirror the parser — only
omit the activity prefix when the typed text already resolves to that same
activity (`matchBuiltInActivity(slot) === activityId`), otherwise always prefix,
or the level silently falls into `other` and disappears from its card. Custom
activity names must not contain the reserved `" - "` separator.

Custom activities are rendered purely from data: the activities view builds a card
for every `groupedLevels` key that isn't a built-in and isn't `other`.
`getMainActivityInfo(id)` synthesizes display info for unknown ids (label as name,
🏅 icon, name-derived stable color). `customActivityNames` (localStorage) only
overrides DISPLAY name/icon, never the stored `activity_name`.

**Manage-members dialog gotcha:** a custom-prefix level ("سباحه سيدات - الساعه 8") vs legacy member activity names without " - " ("سباحه سيدات 2") parse to different identities → dialog showed 0 members while cards showed 8. Membership filters must check `a.level_id === level.id` FIRST (authoritative), then fall back to name matching with containment for custom prefixes.
