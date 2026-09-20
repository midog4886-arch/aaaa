---
name: Renewals are paid invoices, not member docs
description: How to detect "who renewed on day X" and why member.created_at views never show renewals
---

# Renewal detection rule

A subscription renewal NEVER creates or timestamps a member document — it is a
paid invoice for an EXISTING member (`/invoices/{id}/pay` merges the new
start/end dates into `member.activities` by activity_id). There is no
`db.renewals` collection for members (`tenant.renewal_history` is the SaaS
billing of the academy itself, unrelated).

**Why:** the daily membership-cards page filtered members by `created_at` and
users reported "renewals don't show"; any per-day member view has the same
blind spot.

**How to apply:** to list "who renewed on day X", query
`db.invoices {status:"paid"}` with `paid_at` in the day window, plus a legacy
fallback `{paid_at: None}` (matches missing AND null) on `created_at`; skip
`is_product` items; member id = `item.member_id or invoice.member_id`
(multi-member invoices carry per-item member_id); exclude members created the
same day (those are "new", not renewals). Refunds can't leak in: credit notes
live in the separate `db.credit_notes`, and cancelling sets
`status:"cancelled"`.

## Renewals board policy

The “تم التجديد” tab is not limited to renewals performed during the current
page session. Include still-active renewed subscriptions paid through either
the renewal page or ordinary invoices; an expired subscription returns to the
expired group despite historical renewal evidence.

**Why:** The owner expects a persistent follow-up classification across both
payment entry points, not a temporary success list or a lifetime renewed flag.

**How to apply:** Require paid renewal evidence, exclude initial purchases,
and separate the current subscription deadline from future prepaid dates.
