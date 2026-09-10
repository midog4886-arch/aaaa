---
name: Campaign pacing safety
description: Why automatic campaigns must remain paced and uncertain delivery must not be retried.
---

Keep automatic campaign delivery paced across all jobs for one branch, counting each image as a separate send. A daily quota alone is not a rate limit.

**Why:** A user observed twenty recipients receiving messages in one minute with the prior parallel sender and explicitly objected to that burst.

**How to apply:** Preserve server-side inter-message spacing when adding campaign paths or providers. Do not describe any interval as protection guaranteed to prevent WhatsApp bans.

An uncertain provider outcome must not automatically retry. Stop the lane for explicit review rather than risk duplicate delivery.

**Why:** External sends are not atomic with database state. A timeout or worker crash can occur after WhatsApp accepts a message but before the app records success.

**How to apply:** Test suspended-worker and cancellation races, not just normal sequential sends. Unknown outcomes must remain distinguishable from proven failures.

Day-extension notices should have one explicit send action, separate from applying subscription changes.

**Why:** An automatic post-apply notice alongside preview sending would duplicate notifications and bypass the shared paced queue.

**How to apply:** Do not restore automatic post-apply sending without a shared event-level deduplication design. Preserve the ability to send notices before or after applying an extension.

Campaign history in the inbox is a read-only view of queue records, not a backfill that dispatches messages.

**Why:** Existing campaigns must become visible without resending or marking unread. Queue success means accepted for sending, not verified delivery.

**How to apply:** Keep queue state authoritative for pending/failed/unknown; use provider receipts only when available. Deduplicate known provider IDs, never guess that two historical sends are identical just because their text matches.