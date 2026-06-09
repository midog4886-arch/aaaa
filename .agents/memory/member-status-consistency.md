---
name: Member overall status consistency (active/expired)
description: How a member is classified active vs expired on the admin Members page, and the rule that all three surfaces must agree.
---

# Member active/expired status

A member's "expired/منتهي" status is decided purely by subscription **end_date**,
NOT by remaining session count. A member with unused (paid but unattended)
sessions is still "expired" once the period's end_date has passed.

Closures (توقف) and freezes (تجميد) DO extend `member.activities[].end_date`
(the extended deadline drives both status and the attendance/quota window). So an
extended subscription correctly stays "active". A member can still show under
"expired" because a *different* subscription/activity ended and was not renewed
(e.g. swimming active + karate ended) — that is renewal-needed, not an extension bug.

**Rule:** the three surfaces must stay consistent and all use the
"member is expired only when ALL activities are expired" semantics:
- the status **badge** next to the name (`getMemberOverallStatus`),
- the red **expired count** card,
- the **status filter** (all/active/expired).

**Why:** the filter once used a per-activity `.some(expired)` rule, so a member
with one active + one expired subscription wrongly appeared under the "expired"
filter while the badge said "active" — confusing. Aligning the filter to
`getMemberOverallStatus(member).status === filterStatus` fixed it.

**How to apply:** never reintroduce a per-activity `.some()` for the expired
filter. A "needs renewal / expiring soon" concept (any activity within N days /
just-ended) must be a SEPARATE filter, not folded into "expired".
