---
name: New-video notification targeting
description: How "new training video" notifications must be scoped so members don't get videos for activities they aren't enrolled in
---

New-video notifications (in-app `member_notifications` + web push) must be scoped to members **enrolled in the video's activity AND in its branch**; a video with no activity falls back to **branch-only**.

**Why:** historically the create-video flow fetched ALL members (every branch, every activity) and inserted a `new_video` notification for each, so a swimming-only member got karate/football/other-hour videos ("الإشعار ده مش بتاعه"). Push scoped by branch only, which still leaked within the same branch.

**How to apply:**
- Enrollment lives on the member doc as `members.activities[].activity_id` (membership), NOT the `levels` collection. Filter recipients with `{"branch_id": <branch or omit>, "activities.activity_id": <activity or omit>}`.
- The video doc stores `activity_id` / `activity_name` / `branch_id` (branch `"all"` → stored as `None`). Pass `activity_id` through to the push fn too.
- **Data caveat:** admins type the activity/hour into the free-text video title (e.g. "السباحة الساعة 5") and historically left the structured `activity_id` empty (~87/99 videos). So accurate targeting depends on the upload form making activity selection required — keep it required, otherwise everything falls back to branch-wide.
- The data model has no per-hour/level field on videos, so targeting granularity stops at activity (a member gets all videos for their activity, across hours).
