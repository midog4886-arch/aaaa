---
name: Renewal can switch activity/level/days
description: Renewal dialogs allow changing activity, level, and training days — switch replaces the SAME activity subdoc in place
---

# Renewal can switch activity / level / days

Both renewal dialogs (Renewals page + member view) let the admin change the
activity, the level, and training days/times while renewing.

**Why:** owner request — members sometimes move to a different program on
renewal, and stacking a new activity subdoc leaks duplicates onto cards.

**How to apply:** on activity change, `updateActivity` is called with the OLD
activity_id in the URL and the NEW activity_id in the payload — backend
`$set activities.$` replaces the same subdoc in place (no duplicate).
Coupon validation must use the NEW (form) activity id. The schedule string is
rebuilt with `buildMemberSchedule` (respects per-day day_times). Level change
syncs via removeMember(old) + addMember(new, force:true + new activity
id/name). Bulk renew keeps everything unchanged by design.
