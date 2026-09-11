---
name: Campaign reporting evidence
description: Preserve recipient-level reporting and distinguish provider acceptance from confirmed delivery.
---

Report acceptance separately from delivery/read, using exact tenant/branch/provider message identity only. Receipt progress must not regress when callbacks arrive out of order.

**Why:** Provider success only acknowledges a send request, delayed callbacks can arrive after read receipts, and a campaign with several attachments creates multiple outbound items per recipient. Counting outbound items as people exaggerates campaign reach.

**How to apply:** Keep recipient totals separate from message totals and expose partial outcomes. Historical missing metadata or receipt evidence must remain explicitly unavailable, not inferred from the current form. Never replay messages to populate a report.