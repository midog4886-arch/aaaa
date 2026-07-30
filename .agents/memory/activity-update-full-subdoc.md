---
name: Activity update replaces whole subdocument
description: Any updateActivity payload must carry ALL structured schedule fields, because the backend replaces the entire activity subdoc, not merges it.
---

`PUT /members/{member_id}/activities/{activity_id}` replaces the full activity
subdocument via `activity.model_dump()`. Any field omitted from the payload falls
back to the pydantic model default (empty), so it is silently wiped on update.

**Why:** Renewal flows (both MembersPage.handleRenewal and RenewalsPage bulk/single
renewal) rebuilt the activity from a partial payload and dropped the structured
schedule fields (`schedule`, `training_days`, `training_time`, `day_times`, `level_id`).
This destroyed a member's per-day training times (and even the schedule string) on renew.

**How to apply:** When constructing any updateActivity/addActivity renewal payload,
carry forward the full set: `level_id, schedule, training_days, training_time, day_times`
(plus coach_id, fee, dates). RenewalsPage gets these from the renewal item, which is
sourced from `GET /notifications/expiring-subscriptions` — that endpoint must return
those fields or the page has nothing to carry forward. The same fields must be reset
together on any "clear activity" UI path (Trash button AND dropdown "none" selection).

## Invoice /pay re-merges activities FROM the invoice items

Marking an invoice paid rebuilds the member's matching activity subdoc from the
invoice ITEM (start/end/fee/schedule/training_days/training_time/day_times/level_id;
only coach_id is preserved from the existing entry) and stamps
`source='invoice'`, `source_id=<that invoice id>`.

**Why:** renewal dialogs create a PENDING invoice then updateActivity with the edited
days/level. If the invoice items don't also carry the structured fields, the later
"mark paid" re-merge wipes those edits back to empty.

**How to apply:**
- Any renewal/subscription invoice item must include `training_days, training_time,
  day_times, level_id` alongside `schedule` (the local `InvoiceItem` model in the
  invoices route accepts them; the copy in models/ does not — route uses its local one).
- updateActivity renewal payloads must also set `source: 'invoice'` and
  `source_id: <new invoice id>` — attendance/session-quota joins the original purchased
  window via (source_id, activity_id); omitting them blanks the fields until payment.

## Renew in place, never stack

Member-page renewal renews IN PLACE via updateActivity (same as RenewalsPage);
`addActivity` ($push) is only a fallback for legacy entries lacking `activity_id`.
Stacked copies were the root cause of duplicate activities on printed cards. Level
change during renewal: removeMember(old) and addMember(new, force + member's own
activity_id/name) as INDEPENDENT try/catch ops — a failed detach must not block
the new placement.
