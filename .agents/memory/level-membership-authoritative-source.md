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

**Fix in place:** `delete_level` now clears the reference on delete via
`update_many({"activities.level_id": id}, {"$set": {"activities.$[elem].level_id": ""}}, array_filters=[{"elem.level_id": id}])`.
**Why:** a deleted level_id can never match again, so leaving it strands the member.
**Note (open):** `delete_level` itself still has no branch-scope authorization
(pre-existing) — a hardening worth doing separately.
