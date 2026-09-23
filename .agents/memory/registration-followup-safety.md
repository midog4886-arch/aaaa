---
name: Registration follow-up boundaries
description: New-only authorization, phone-level contact limits and safe classification of outbound echoes.
---

Only newly submitted public registration requests are authorized for automated follow-up. Existing requests must never be enrolled by a scheduler scan, date cutoff or backfill.

Registration requests are independent per person, including siblings sharing a guardian's phone. Never archive or convert requests based on phone matching.

**Why:** The owner superseded the previous phone-archive policy after one person's invoice archived other family members' requests. Only an explicit request-to-invoice link identifies the converted request.

**How to apply:** Close only the explicitly linked request. Member creation, list reads, restoration and scheduled scans must not archive shared-phone siblings. Do not bulk restore historical records or re-enroll old outreach without authorization. Retain phone-wide contact/opt-out suppression and pacing; closing one request alone is not household contact.

**Why:** The user explicitly chose “نفّذ للطلبات الجديدة فقط” to avoid contacting the old pending backlog.

**How to apply:** Require enrollment explicitly written at creation. First follow-up is AFTER 24 hours, not within the first 24 hours; final is day three. Advance quiet-hour sends into 10:00–20:00 Riyadh and never catch up both on the same day.

Phone-level contact limits and suppression apply across the tenant, but message contents remain branch-isolated. Use the earliest enrolled request's branch for a shared number, without adding other branches' names/activities.

**Why:** The same household submitting multiple requests must not receive a separate sequence from each branch. Customer replies, explicit staff contact, closure and opt-out end the sequence.

**How to apply:** Keep a durable phone/day gate shared with marketing dispatch. Unknown outcomes never retry; displayed status must also reflect crash recovery. Provider-unavailable conditions may wait, but provider attempts with terminal outcomes must not silently restart.

An authenticated outbound echo can arrive before the provider's send response supplies its ID.

**Why:** Immediately treating an unmatched outbound echo as a human reply can stop the reminder's own final follow-up; treating every message during dispatch as automated can ignore a real employee's contact.

**How to apply:** Correlate exact provider IDs, not message text or phone alone. Persist unresolved observations and pause automation until they are resolved; explicit staff actions should stop automation before calling the provider.

Unread reconciliation must not treat automatic outbound echoes as human phone replies, or infer ordering within the same provider timestamp.

**Why:** Mobile replies and automated notices share the echo channel; provider timestamps can have only second precision. Clearing counters by timestamp alone can hide an unseen arrival.

**How to apply:** Retain durable automation evidence, keep unresolved echoes conservative, and use atomic inbound identity/generation checks for full clears. Preserve ambiguous legacy counts instead of guessing.