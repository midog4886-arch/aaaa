---
name: Manual campaign inquiry boundaries
description: Why social-ad inquiry follow-up stays separate from automated registration follow-ups
---

Importing social-ad inquiries never authorizes sending. Tracking stays separate from registration follow-up automation; the user explicitly approved optional Whatsflow direct sends and two-step inquiry follow-ups only after recipient/message preview and confirmation. Opening WhatsApp is not evidence of contact.

**Why:** The user requested organized follow-up for existing social-media inquiries, including branches without Whatsflow. Importing numbers authorizes storage for review, not automated outreach.

**How to apply:** Preserve this separation when adding import sources or messaging features. Bind approval to immutable recipient identity and message snapshots; changing the phone/name or archiving invalidates queued work. Deduplicate contacts within a branch, not across branches. Use the shared branch campaign pacing lane, never a separate fast path. Uncertain outcomes must stop continuation rather than retry. Keep stop/pause controls available through provider outages. Invoice conversion must use an explicitly linked invoice, never phone matching, because families can share numbers.