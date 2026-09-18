---
name: Tenant lookup performance boundaries
description: Reduce duplicate registry reads without caching stale academy suspension or losing branding.
---

Coalesce concurrent tenant-registry reads, but do not retain completed tenant results as a TTL cache without an explicit revocation/invalidation design.

**Why:** The registry controls suspension and academy routing. A general cache can keep granting access after those values change. Keeping the full tenant document also preserves less-obvious branding consumers, including delayed invoice notices.

**How to apply:** Share only an outstanding same-slug read, isolate waiter cancellation and returned mutable documents, and read again on subsequent requests. Public compiled JS/CSS can avoid tenant lookup; do not extend that exemption to dynamic academy logos, API routes, or authentication.