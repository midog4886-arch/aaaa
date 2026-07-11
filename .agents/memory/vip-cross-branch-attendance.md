---
name: VIP cross-branch attendance
description: How the VIP membership (attend any branch) works and the summary/board enrichment it depends on.
---

VIP members (`member.is_vip`) may check in at ANY branch. On check-in the attendance
record is tagged to the **scanning user's branch** (`current_user.branch_id`), not the
member's home branch — so reports show where the VIP actually went. Regular members
still record under their own `member.branch_id`.

**Why:** the check-in write path (create_attendance + qr_checkin) picks
`current_user.branch_id or member.branch_id` when `is_vip`, else the reverse.

**The gotcha — branch-scoped summaries drop foreign visitors:** `get_today_summary`
and `get_levels_board` build `active_member_ids` / `members_by_id` from members fetched
with the branch query, then gate present-counting on `mid in active_member_ids`. A VIP
whose record is tagged to branch B but whose member doc lives under branch A would be
silently dropped from B's counts/board. Both endpoints now, after building
`members_by_id` and when `effective_branch` is set, pull member_ids that appear in the
(already branch-filtered) `today_records` but are missing from `members_by_id`, fetch
those docs, and add active ones to `active_member_ids`. Foreign VIP land in the board's
`unassigned` bucket (their level is bound to their home branch).

**How to apply:** any new branch-scoped attendance view/report that derives "present"
from an active-member set built off the branch member query must apply the same
enrichment, or cross-branch VIP visits vanish. The "expected today" list correctly still
iterates only the branch's own members (foreign VIP are a bonus present, never "expected/absent").

VIP is set via manual toggle on the member add/edit form AND the invoice quick-create
member dialog. `is_vip` lives in routes/members.py own MemberCreate/MemberUpdate/Member
models (the authoritative ones) — not just models/member.py. No auto-discount and no
loyalty multiplier were wired (user declined both); VIP is attendance-scope + badge/filter only.
