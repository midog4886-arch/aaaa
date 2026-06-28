---
name: Level capacity is frontend-only
description: Where the "level full" limit is actually enforced and how to allow overrides
---

Level capacity ("ممتلئ / Level full", e.g. 6/6) is enforced ONLY in the
frontend. The backend `POST /levels/{level_id}/members/{member_id}`
(add_member_to_level) has duplicate-membership and same-time-slot clash guards
but NO max-capacity rejection — an over-capacity add always succeeds server-side.
The `/count` endpoint exposes `is_full`/`max_capacity` for display only; the
auto-assign endpoint is the one place capacity actually gates (it skips full
levels when auto-distributing).

**Why:** product wants manual placement to be able to override a full level
(admin judgement), while auto-assign should respect it. So the limit lives in UI
guards, not the API.

**How to apply:** Manual placement/move into a full level is allowed via a
`window.confirm` prompt (the file's confirm convention) in all four manual flows:
handleDrop (drag-drop), handleAddMember (Manage Members), handleQuickTransfer
(quick-transfer picker), handleAssignToLevel (unassigned assign picker). Each
picker BUTTON must also be clickable when full (don't `disabled={isFull}` /
`!isFull &&` in onClick) or the confirm is unreachable — keep the "Full" badge +
amber style for the visual cue. Capacity default = 6 for swimming, 10 otherwise.
If you ever want a hard server limit, it must be ADDED to the backend; it isn't
there today.
