---
name: Push subscription cross-tenant dedup
description: Why subscribing must deactivate the same browser/device endpoint in every OTHER tenant DB.
---

# Push endpoint cross-tenant leak

A web-push endpoint (and an FCM token) is tied to the browser/app install, NOT to who is
logged in. Each academy has its own per-tenant DB (`champions_<slug>`), and `push_subscriptions`
lives in the tenant DB. On a SHARED device, member of academy B subscribes (endpoint stored +
`is_active` in B's DB), then later an academy A member logs in on the same browser and
subscribes — the endpoint also lands in A's DB but stays active in B's, so B keeps pushing to a
browser now used by A. Single-academy users are unaffected.

**Rule:** Whenever a subscription is (re)claimed for the current academy, deactivate that same
endpoint/token in EVERY other active tenant's `push_subscriptions` (`is_active: False`). Routing
is purely by `is_active` rows in each tenant DB, so deactivation is what actually stops the leak.

**How to apply:**
- Backend `subscribe_to_push` calls `_deactivate_endpoint_in_other_tenants` after the upsert,
  iterating `list_active_tenants()` and switching tenant context via `set_current_tenant`/
  `reset_current_tenant` (works for both Motor and Atlas clients because `db` proxy resolves
  db_name from the ContextVar). Best-effort: per-tenant failures are logged, never fatal.
- Frontend `PushNotificationManager` re-claims an EXISTING browser pushManager subscription on
  mount (web branch of checkSubscription) so the "logs in under a different academy" case also
  triggers backend dedup without requiring an explicit re-subscribe click.

**Periodic sweep (complements inline dedup):** inline dedup only fires when a device is
re-claimed; a device that never returns leaves a stale active row in the old tenant forever.
`cleanup_superseded_subscriptions` (push_notifications.py) walks every active tenant, groups all
`is_active` rows by device identity (FCM token for android/ios, endpoint for web), keeps the
most-recently-updated row active per device, deactivates older cross-tenant duplicates
(`deactivated_reason: superseded_cross_tenant`). Runs once globally inside the daily-checks run
(NOT inside for_each_active_tenant — it needs a cross-tenant view) and via admin endpoint
`POST /push-notifications/cleanup-superseded`. Comparison is lexicographic on the ISO
`updated_at`/`created_at` strings — relies on them being UTC isoformat.
