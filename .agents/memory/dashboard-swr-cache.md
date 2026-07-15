---
name: Dashboard SWR cache over Atlas throughput wall
description: Why dashboard endpoints use stale-while-revalidate caching and how invalidation must be wired
---

# Dashboard SWR cache (Atlas free-tier throughput wall)

**Rule:** The heavy dashboard trio (today-summary, dashboard stats, expiring subscriptions) must serve from the in-process stale-while-revalidate cache (`cache_swr` in `utils/cache.py`); cold loads are bounded by the DB wire, not code.

**Why:** MongoDB Atlas free tier caps wire throughput around ~100KB/s per connection and its server offers NO compression negotiation (verified via handshake). Large result sets (members with activities, invoices with items) therefore take many seconds no matter how the query is written. Lean projections help but cannot beat the wall; only avoiding the wire (cache) makes repeat loads fast (~0.1–0.5s warm vs 2.5–15s+ cold).

**How to apply:**
- `cache_swr(key, fresh_ttl, stale_ttl, loader)`: fresh → cached; stale → return stale AND kick a deduped background asyncio refresh (contextvars carry tenant; keep strong task refs).
- Truly live data (today's attendance records) is always fetched fresh in parallel; only the heavy, slow-changing inputs go through SWR.
- Any mutation that changes what the dashboard shows (invoice pay, member create/update/delete, activity add/edit/remove, transfers, freezes create/cancel) MUST call `invalidate_dashboard_caches()` (drops `todaysum:`/`dashstats:`/`expiring:` prefixes for the current tenant) or admins see stale numbers for up to stale_ttl.
- New dashboard-affecting write endpoints must be wired the same way.
- Cache keys are tenant- and branch-scoped; never share across tenants.
