---
name: Activity update replaces whole subdocument
description: Any updateActivity payload must carry ALL structured schedule fields, because the backend replaces the entire activity subdoc, not merges it.
---

`PUT /members/{member_id}/activities/{activity_id}` replaces the full activity
subdocument via `activity.model_dump()`. Any field omitted from the payload falls
back to the pydantic model default (empty), so it is silently wiped on update.

**Why:** Renewal flows (both MembersPage.handleRenewal and RenewalsPage bulk/single
renewal) rebuilt the activity from a partial payload and dropped the structured
schedule fields (`schedule`, `training_days`, `training_time`, `day_times`, `level_id`).
This destroyed a member's per-day training times (and even the schedule string) on renew.

**How to apply:** When constructing any updateActivity/addActivity renewal payload,
carry forward the full set: `level_id, schedule, training_days, training_time, day_times`
(plus coach_id, fee, dates). RenewalsPage gets these from the renewal item, which is
sourced from `GET /notifications/expiring-subscriptions` — that endpoint must return
those fields or the page has nothing to carry forward. The same fields must be reset
together on any "clear activity" UI path (Trash button AND dropdown "none" selection).
