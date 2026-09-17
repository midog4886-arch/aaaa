---
name: Campaign reporting evidence
description: Preserve recipient-level reporting and distinguish provider acceptance from confirmed delivery.
---

Report acceptance separately from delivery/read, using exact tenant/branch/provider message identity only. Receipt progress must not regress when callbacks arrive out of order.

**Why:** Provider success only acknowledges a send request, delayed callbacks can arrive after read receipts, and a campaign with several attachments creates multiple outbound items per recipient. Counting outbound items as people exaggerates campaign reach.

**How to apply:** Keep recipient totals separate from message totals and expose partial outcomes. Historical missing metadata or receipt evidence must remain explicitly unavailable, not inferred from the current form. Never replay messages to populate a report.

Queue insertion time is not send time. Project a campaign preview's source, state, and explicit event timestamps together, and label the time according to the event it actually represents.

**Why:** Several campaign items created together can show identical timestamps even when paced dispatch happens minutes apart; showing them as sent wrongly suggests a burst.

**How to apply:** Pending messages show queue time, accepted messages show evidence-backed acceptance/send time, and delivery/read require exact correlated receipts. Preserve event metadata from the same winning preview when merging stored conversations and projected campaign items.

Persist authenticated receipt evidence before trying to attach it to a campaign item; reconcile both immediately and when the send response supplies the provider ID. Clear buffered receipts only with a matching version token.

**Why:** Callbacks can beat the send response, or a newer read event can arrive during reconciliation. Apply-first buffering and unconditional deletion can silently lose either event.

**How to apply:** Scope receipt identities to tenant, branch, provider and literal provider ID; use only explicit provider aliases, never phone/body guesses. Keep idempotence and reversed-order race tests whenever changing receipt handling.