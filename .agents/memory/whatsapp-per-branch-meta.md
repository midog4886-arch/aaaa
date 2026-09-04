---
name: Per-branch Meta WhatsApp
description: Security and routing rules for separate Meta WhatsApp Cloud API senders per branch.
---

Server-side member messages must select WhatsApp Cloud credentials from the member's persisted `branch_id`, never merely the operator's active branch. Access tokens are write-only in the UI/API and encrypted at rest with the server session secret.

**Why:** Each branch owns a separate Meta sender number. Selecting credentials from UI state can send a member's data through the wrong branch, while returning stored tokens would expose every branch account.

**How to apply:** Any new automated or manual server send must route through the branch-aware sender. Proactive Meta messages use the branch's approved one-body-variable template. The legacy Baileys sender is only a temporary fallback for branches without an enabled Cloud configuration.