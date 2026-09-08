---
name: WAHA tenant isolation and campaign quota
description: Durable isolation and concurrency rules for the per-branch WAHA provider.
---

The WAHA session identifier sent to the provider must be derived from both the tenant and branch. A user-entered session name is display-only and must never become the provider session identifier.

**Why:** WAHA sessions live outside tenant databases. Reusing a friendly alias can accidentally connect two academies or branches to the same WhatsApp device.

**How to apply:** Every WAHA lifecycle, QR, send, status, media, and webhook path must resolve the same derived identifier and reject webhook events for any other session.

Campaign allowance must be reserved atomically by tenant, branch, and Riyadh calendar day before dispatch. Text and media campaigns share the same allowance; automatic transactional notifications are logged for quality but do not consume it.

**Why:** Counting first and recording later lets simultaneous campaigns exceed the configured daily limit.

**How to apply:** Keep all campaign entry points on the shared reservation path, reject the whole request when insufficient allowance remains, and release only the exact same-day reservation if dispatch setup fails before work is accepted.