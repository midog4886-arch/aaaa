---
name: Level membership authoritative source
description: Why a member can show in two activity levels at once, and the rule that fixes it
---

# Level membership: source of truth

A member's link to an activity level is authoritatively stored on the member side
in `member.activities[].level_id` (each activity points to exactly one level).
The level side keeps a denormalized `level.members[]` array of member ids, and the
level cards / counts are drawn straight from that array.

**The bug pattern:** when a member is reassigned to a different level (auto-assign,
schedule builder, or any path that writes `level.members[]` directly), their id is
left behind in the OLD level's `members[]`. The old auto-cleanup only dropped ids
of members that no longer exist — it did NOT drop members whose authoritative
`activity.level_id` now points elsewhere. Result: the same member shows in two
level cards at the same hour, inflating counts. Made worse by near-duplicate level
cards for the same slot (same name/branch/hour, overlapping days, `activity_id`
null) so a member matches more than one on branch+day+hour.

**The rule (idempotent, safe) — `member_belongs_to_level(activities, level_id)`:**
- no activity has a populated `level_id` → KEEP (un-backfilled legacy rows).
- at least one activity links to THIS level → KEEP (covers multi-activity members
  who legitimately appear in several levels).
- activities link only to OTHER levels → STALE, drop from this level.

**Why:** `activity.level_id` is the single source of truth; `level.members[]` is a
cache that drifts on reassignment. Never delete un-backfilled members (no level_id
anywhere) — that would lose legitimate assignments.

**How to apply:** `get_levels` filters with this helper before building
`members_details`/`valid_ids`, and the existing `stale_updates` path persists the
pruned `members[]`. Any future write path that reassigns a level should also pull
the member from other levels' `members[]`, or rely on this on-fetch self-heal.

## Deleting a level orphans the member link

When a level is deleted, members keep `activities[].level_id` pointing at the now
non-existent level. On the live board (attendance `/levels-board`) the lookup
`(member_id, activity_id) -> level_id` then fails to resolve, so the member lands
in "حضور بدون مستوى" (present-without-level). This is the dominant real-world cause
of that bucket — not unassigned members.

**Critical gotcha:** the `/auto-assign` tool deliberately does NOT rewrite a stale
`level_id` (one pointing to a deleted/non-matching level) — it reports those as
`unmatched` (`reason_key: "stale_link"`) for manual review. So to actually
re-place such members you must FIRST blank the orphaned `level_id` (set to `""`)
so the member becomes net-new, THEN run auto-assign.

**Fix in place:** `delete_level` clears the orphaned reference on delete (blanks
`activities[].level_id`). **Why:** a deleted level_id can never match again, so
leaving it strands the member. Deleting a level is also branch-scoped (same
fail-closed pattern as cleanup/bulk): non-admins can only delete their own-branch
or shared-branchless levels; foreign-branch attempts are rejected.

## Manual add/remove must backfill level_id, and exact-name match is not enough

Manually adding a member to a level (`add_member_to_level`) does TWO writes:
`$addToSet` into `level.members[]` AND backfill `activity.level_id` on the member.
If only the first happens, the very next `get_levels` refetch runs
`member_belongs_to_level`, sees the member's activities link to no/other levels,
and STRIPS the id back out via the `stale_updates` self-heal — so the add shows a
success toast but silently reverts (member stays in "available", level shows 0).

**The trap:** the backfill matched the member's activity to the level ONLY by exact
`activity_id` or exact `activity_name`. Academy naming is inconsistent — a level is
`"سباحة - الساعة 7"` while the member's subscription is `"السباحة 4 ايام في الاسبوع"`,
so neither matches and no backfill happens → revert.

**Fix:** added module-level `_activity_group_name()` (maps names → swimming/
football/karate) and a GROUP fallback: when no exact activity matches, link the
member's same-group activity (preferring an active, non-expired one). `remove`
mirrors the same group fallback when clearing `level_id`, else a stale link is left
and the member never returns to the unassigned list. **Why:** the admin's explicit
click is unambiguous intent to assign; the link must actually stick. Keep add and
remove symmetric on the matching strategy.
