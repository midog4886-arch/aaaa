---
name: Reports activity filter & groups
description: Financial report activity_id accepts comma-separated ids; frontend groups activities by keyword (swimming/football/karate)
---

# Reports activity filter & activity groups

The reports activity filter supports "group" options (كل السباحة / كل كرة القدم /
كل الكاراتيه) built from keyword matching on activity names — same keyword
convention as the Levels page (`ACTIVITY_GROUPS`). A group selection is sent to
the backend as a comma-separated `activity_id` list.

**Why:** activities are many near-duplicates per schedule ("سباحه 2", "سباحه 3"…);
the owner wants type-level filtering. Also, `/reports/financial` originally
ACCEPTED `activity_id` but never applied it — a silently dead query param.

**How to apply:** backend splits `activity_id` on commas → `items.activity_id $in`,
and `revenue_by_activity` skips non-selected items. When adding filter params to
report endpoints, verify they're actually used in the query — a param in the
signature is no guarantee. Keep the keyword lists in ReportsPage and LevelsPage
consistent if activity types are added.
