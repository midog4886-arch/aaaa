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