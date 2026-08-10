---
name: Member card dates = original invoice window
description: Printed membership cards must show the invoice's original period, not live activity dates
---

# Member card dates = original invoice window

Printed/sticker member cards (and the members-page card dialog preview) must
display the ORIGINAL purchased period from the member's PAID invoices, not
`member.activities[].start/end_date`.

**Why:** live activity dates drift — off-schedule attendance pulls end_date
back, freezes/closures extend it — and the owner decided the card must match
the invoice (الفترة الأصلية زي الفاتورة).

**Window selection:** per activity, prefer the paid window COVERING today,
else the earliest upcoming, else the latest ended — never "latest end", which
shows a prepaid future period while the current one is still running (invoice
card print dedupes multi-period items the same way).

**How to apply:** use `fetchOriginalActivityDates` + `applyOriginalDates`
(frontend/src/pages/invoices/cardDates.js): map activity_id → latest paid
invoice item window (falls back to item `period` string), override activity
dates for display only. Card print flows open `window.open` BEFORE the await
(popup blockers). NOTE: the member-portal digital card still prefers live
dates on purpose (backend member_portal.py) — if the owner wants those to
match too, change that path deliberately.
