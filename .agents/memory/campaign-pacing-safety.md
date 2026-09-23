---
name: Campaign pacing safety
description: Why automatic campaigns must remain paced and uncertain delivery must not be retried.
---

Keep automatic campaign delivery paced across all jobs for one branch, counting each image as a separate send. A daily quota alone is not a rate limit.

**Why:** A user observed twenty recipients receiving messages in one minute with the prior parallel sender and explicitly objected to that burst.

On 2026-09-11, the user chose a three-minute minimum after confirming that actual 67–71-second intervals still felt too fast.

**Why:** This is an explicit campaign operating constraint, not a throughput target to optimize away. Preserve it unless the user requests a different interval.

**How to apply:** Preserve server-side inter-message spacing when adding campaign paths or providers. Do not describe any interval as protection guaranteed to prevent WhatsApp bans.

Day-extension notices have a one-minute minimum, while ordinary campaigns retain their longer interval.

**Why:** On 2026-09-23 the user explicitly requested one minute between closure/extension messages, not a global campaign speedup.

**How to apply:** Keep the shared branch gate and existing cooldowns. Mixed traffic must preserve the longer campaign interval; count spacing from completion, not the start of a slow send.

An uncertain provider outcome must not automatically retry. Stop the lane for explicit review rather than risk duplicate delivery.

**Why:** External sends are not atomic with database state. A timeout or worker crash can occur after WhatsApp accepts a message but before the app records success.

**How to apply:** Test suspended-worker and cancellation races, not just normal sequential sends. Unknown outcomes must remain distinguishable from proven failures.

Day-extension notices should have one explicit send action, separate from applying subscription changes.

Invalid contact numbers exclude only notice delivery, never subscription compensation.

**Why:** a single malformed stored number blocked an entire closure-notice batch. Compensating a missed class does not depend on the guardian's contact details.

**How to apply:** disclose skipped recipients and validate eligible counts; preserve fail-before-enqueue behavior for authorization or missing-member failures. Never repair phone numbers by guessing.

**Why:** An automatic post-apply notice alongside preview sending would duplicate notifications and bypass the shared paced queue.

**How to apply:** Do not restore automatic post-apply sending without a shared event-level deduplication design. Preserve the ability to send notices before or after applying an extension.

Campaign history in the inbox is a read-only view of queue records, not a backfill that dispatches messages.

**Why:** Existing campaigns must become visible without resending or marking unread. Queue success means accepted for sending, not verified delivery.

**How to apply:** Keep queue state authoritative for pending/failed/unknown; use provider receipts only when available. Deduplicate known provider IDs, never guess that two historical sends are identical just because their text matches.

Each branch must progress independently, including across later scheduler ticks when another branch's provider call is slow.

**Why:** A frozen branch with an expired retry timestamp monopolized global oldest-item selection and blocked unrelated campaigns. Batch concurrency alone still blocks later ticks until the slowest request finishes.

**How to apply:** Preserve branch-local FIFO and tenant isolation with bounded independent work. Test a healthy branch's second paced send while another branch remains blocked. Never clear safety freezes merely to restore queue progress.