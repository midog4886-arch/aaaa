---
name: Marketer multi-branch scoping
description: Marketers can belong to several branches (branch_ids[]); every branch-scoped read path must use the shared visibility helper, not the legacy branch_id-only filter.
---

Marketers are branch-or-shared, and can now be scoped to MULTIPLE specific branches via `branch_ids[]` (empty/`["all"]` = shared everywhere). Legacy single `branch_id` is kept for backward-compat and set ONLY when exactly one branch is picked (None when multiple or shared).

**The trap:** a multi-branch marketer is stored with `branch_id=None` + `branch_ids=[...]`. Any code that still filters by legacy `branch_id` alone (null/empty = shared) will treat every multi-branch marketer as globally shared → cross-branch data leak.

**Rule:** EVERY branch-scoped read path must use `_branch_visibility_or(effective_branch)` (in routes/marketers.py), which matches `effective_branch in branch_ids` OR legacy `branch_id == effective_branch` OR fully-shared. This includes `/marketers` list, `_scoped_marketer_query` (object guard), AND `/marketers/analytics` (this one was missed on the first pass and leaked). Referral-attach in registration_requests.py checks `branch_ids` first, then legacy fallback.

**Why:** list scoping alone leaks via a known id; and analytics is a separate query that must mirror the list scoping exactly or branch users see totals/marketers outside their branch.

**How to apply:** when adding any new marketer read/query, reuse `_branch_visibility_or`; never re-hand-roll a `branch_id`-only $or. Referral link is single-branch by nature, so multi-branch marketers get a picker limited to their `branch_ids`.
