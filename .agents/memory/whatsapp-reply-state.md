---
name: WhatsApp reply-state evidence
description: Keep staff reply obligations separate from reading and automated outbound traffic.
---

Treat “needs reply” as a human-response obligation, not as unread status or the direction of the latest message. Opening a conversation does not resolve it; automated reminders and campaigns are not staff replies.

**Why:** Provider echoes can arrive before the send response, older incoming events can arrive after newer ones, and failure receipts can precede the echoed outgoing message. A last-direction shortcut silently hides unanswered conversations.

**How to apply:** Require durable human-send evidence, correlate automation before dispatch, preserve unmatched failure receipts, and keep inbound boundaries monotonic. Test reversed event ordering and concurrent inbound arrivals whenever changing reply-state logic. Do not infer historical phone replies that were never persisted.

Legacy state must be backfilled with bounded queries that always make progress.

**Why:** A shared message cap across a batch can repeatedly select the same dense conversations and permanently exclude them and older records from the filter.

**How to apply:** Aggregate the latest relevant evidence per conversation or split work without scanning whole histories on every inbox poll.