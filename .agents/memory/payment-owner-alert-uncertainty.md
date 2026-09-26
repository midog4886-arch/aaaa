---
name: Owner payment alert delivery uncertainty
description: Why duplicate failure webhooks must not automatically resend an uncertain owner alert.
---

Deduplicate the owner's payment-failure alert independently from payment processing and receipt delivery. A transport timeout or interrupted send is not proof that no email arrived.

**Why:** providers retry failed events. Releasing the alert claim after an uncertain transport failure can repeatedly email the owner even though the first message was delivered.

**How to apply:** allow payment processing to retry without repeating the alert. A proven pre-send configuration skip may release its claim; failed/unknown delivery requires explicit review rather than automatic resend. Do not apply this decision indiscriminately to payment receipts.