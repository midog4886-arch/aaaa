---
name: WhatsApp member association
description: Safe member identity matching for branch WhatsApp conversations.
---

Derive conversation/member associations from current member and guardian phones within the conversation's own branch, including for admins. Only a unique normalized match identifies a member automatically; shared family numbers require a chooser and must never permanently assign the chat to an arbitrary sibling.

**Why:** A guardian number can belong to several children, and admins can view multiple branches. Persisted matches become misleading when members move, phone numbers change, or another sibling registers.

**How to apply:** Recompute on inbox/thread reads and use minimal permission-gated member summaries. Always include legacy-formatted/Arabic-digit candidates even when an exact canonical match exists: an exact match does not prove uniqueness. Normalize every candidate and deduplicate by member ID before counting.