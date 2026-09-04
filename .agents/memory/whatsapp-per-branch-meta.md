---
name: Per-branch Meta WhatsApp
description: Security and routing rules for separate Meta WhatsApp Cloud API senders per branch.
---

Server-side member messages must select WhatsApp Cloud credentials from the member's persisted `branch_id`, never merely the operator's active branch. Access tokens are write-only in the UI/API and encrypted at rest with the server session secret.

**Why:** Each branch owns a separate Meta sender number. Selecting credentials from UI state can send a member's data through the wrong branch, while returning stored tokens would expose every branch account.

**How to apply:** Any new automated or manual server send must route through the branch-aware sender. Proactive Meta messages use the branch's approved one-body-variable template. The legacy Baileys sender is only a temporary fallback for branches without an enabled Cloud configuration.

Bulk sends to pasted numbers have no member-derived branch context, so the operator must explicitly select the sending branch. Enable automatic bulk sending only after an admin confirms the approved Meta template has exactly one body variable and no required header/button variables. Preserve valid E.164 numbers; infer a country code only for recognized local Saudi or Egyptian formats.

Inbound Cloud chat webhooks are tenant-bound by a slug in the callback URL, then branch-bound by each event's Phone Number ID. Verify the raw-body HMAC before processing; a Meta batch may contain several branch phone IDs but they must share one App Secret. Compute the 24-hour reply window from Meta's customer-message timestamp, never webhook receipt time. Media proxying must stay authenticated, branch-scoped, HTTPS-only, redirect-disabled, and restricted to Meta CDN hosts.

Proactive bulk image/PDF sends require separate approved Meta templates: IMAGE or DOCUMENT header plus exactly one Body variable {{1}}. Upload media once per batch, then reuse its Meta media ID. Bound reads before buffering, validate magic bytes, normalize filenames, serialize per branch, and idempotency-key every batch.

Attendance WhatsApp alerts use a dedicated per-branch approved template with one Body variable {{1}}. Normalize local phones before Meta send, never block check-in on send failure, notify only present/new transitions, and use the scanning branch for VIP attendance.

Paid-invoice WhatsApp receipts use a dedicated one-variable template and a per-tenant durable outbox keyed uniquely by invoice. Queue only after the first paid transition; lease/fence claims so interrupted sends recover safely.