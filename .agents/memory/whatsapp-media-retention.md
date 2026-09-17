---
name: WhatsApp media retention
description: Retention, privacy, and concurrent deletion rules for the inbox attachment archive.
---

Archive ordinary inbound attachments independently of opening a conversation. Prefer the private archived bytes before checking provider configuration, and retain them until explicit authorized deletion rather than applying automatic time expiry.

**Why:** Provider media links expire; requiring an operator to open every message first defeats preservation. The chosen default preserves conversation history without silently deleting older attachments.

**How to apply:** Bound file sizes and validate actual bytes on both background and on-demand downloads. Preserve view-once exclusions. Retry only downloads, never outgoing sends. Report unavailable historical content honestly when the provider no longer has it.

Deletion must win over background archival and on-demand downloads. Lease losers must clean only their own staging objects, never another worker's saved copy, and shared or legacy storage needs an explicit ownership/reference check.

**Why:** A worker can finish after a user deletes an attachment or another worker takes over; naïve cleanup either resurrects deleted files or removes the winning copy.

**How to apply:** Retain deletion tombstones, use atomic lease/publish checks, reclaim interrupted staging records, and test blocked-download deletion races. Never treat a successful metadata update alone as proof that bytes were removed.