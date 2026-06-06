---
name: Member branch transfer
description: Rules for transferring members between branches (what's cleared/kept, who's allowed)
---

# Member branch transfer

Transfer endpoints live in `backend/routes/members.py`: `POST /members/{id}/transfer` (single) and `POST /members/transfer-bulk` (bulk), with shared helper `_transfer_member_doc`.

## What changes on transfer
- Set `member.branch_id` to the new branch.
- Clear each `activities[].level_id` and `coach_id` (levels & coaches are branch-bound, so old links are meaningless at the new branch).
- KEEP `training_days` / `training_time` / `schedule` / activity dates / subscription / sessions — the member is re-assigned to a level at the new branch (via Levels Schedule Builder auto-assign on branch+day+hour) but keeps their schedule and remaining time.
- Push an audit entry to `member.transfers[]` (from/to/date/by/at).
- `$pull` the member id from old `levels.members[]` cache, then `cache_invalidate("levels:")` (levels are cached 5min; members are not).

## Authorization (important)
**Cross-branch transfer is admin-only.** Guard: `if not current_user.get("is_admin") and new_branch != current_user.branch_id: 403`.
**Why:** non-admins are pinned to their own branch by `resolve_branch_filter`; without this guard a branch user could move members OUT to any branch id, breaking branch isolation. Same-branch is already rejected, so this effectively makes any real move admin-only.
**How to apply:** any new endpoint that lets a user change a record's `branch_id` needs the same destination-branch guard — scoping the *source* query alone is not enough.
