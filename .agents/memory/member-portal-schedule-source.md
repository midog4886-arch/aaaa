---
name: Member portal schedule data source
description: Where the member portal schedule page gets its data, and the activities-vs-invoices mismatch
---

# Member portal schedule page data source

The portal schedule page (`MemberSchedule.js` → `GET /api/member-portal/my-schedule`
= `get_member_full_schedule` in `routes/member_portal.py`) historically sourced
schedules ONLY from `registration_forms` + `invoices` items (each item needs
`activity_id` + `schedule`).

**The trap:** admins edit a member's training time (الموعد) on
`member.activities[]` (via `update_member_activity`, PUT
`/members/{id}/activities/{aid}`). That field is a DIFFERENT source than what the
portal schedule page reads. So a member whose schedule lives only in
`member.activities` (no invoice/form carrying a `schedule` string) sees an EMPTY
schedule page, and admin edits to their time never appear there.

**Why it matters:** any feature about "show the member's schedule / schedule
changes in the portal" must read from `member.activities`, treating it as the
authoritative source and deduping invoice/form entries for the same
`activity_id`.

**How to apply:** `get_member_full_schedule` now adds a `member.activities` loop
FIRST (source `"activity"`), collects `activity_source_ids`, and both the forms
and invoices loops skip items whose `activity_id` is already covered. Schedule
string = activity `schedule` else `training_days` joined with " و " + `training_time`.

Note the sibling endpoint `GET /api/member-portal/schedule`
(`get_member_schedule`, ~line 511) is invoice-only and is NOT what the frontend
schedule page uses — don't confuse the two.
