---
name: Free manual level placement (تسكين يدوي حر)
description: How the override path that assigns any member to any branch level works without the membership reverting.
---

# Free manual level placement

The Levels assign picker normally filters levels by branch + activity name/group + time slot. A "free placement" toggle (`showAllLevels`) shows ALL branch levels so an admin can place stuck members (stale level link / no schedule / no matching hour) anywhere.

## Rule
Free placement MUST send `force=true` plus the member's own `activity_id`/`activity_name` to `POST /levels/{level_id}/members/{member_id}`.

**Why:** assigning a member to a level whose activity differs from theirs leaves no `level_id` on any of the member's activities, so `get_levels()` strips them as a stale link on the next refetch — the membership silently reverts. The backend `_force_link_member_activity` force-sets `level_id` on the named activity so it sticks.

**How to apply:**
- `force=true` turns the same-activity duplicate guard into a MOVE (`$pull` from other same-activity levels) and SKIPS the same-time clash guard — deliberate admin override.
- If the named activity isn't found on the member, the endpoint rolls back the `$addToSet` and returns 400 instead of faking success (a non-sticky add would be cleaned later).
- Regular (non-force) assigns pass `{}` and keep all original guards + name/group auto-match backfill.

## Known gap (follow-up)
`add_member_to_level` has no server-side branch-scope check — branch isolation is enforced only by the frontend picker filter. Pre-existing; not widened by force. Direct API calls could cross-branch assign.
