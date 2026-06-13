---
name: Legacy member-card QR codes after global renumber
description: Why scanning some printed member cards returns "العضو غير موجود" even though the member exists — old QR encodes a pre-renumber member_code.
---

# Old printed QR cards encode a pre-renumber member_code

A member-card QR is generated from the member's CURRENT `member_code`
(`utils/memberQR.js` → trimmed code, no prefix). There was a **global member
renumber**: old codes looked like `QDEFA-{branch}-{seq}` (e.g. `QDEFA-7-0025`) and
were rewritten to the current `DEFA-B{branch}-{seq}` (e.g. `DEFA-B7-0025`). Cards
printed BEFORE the renumber still carry the OLD code in their QR, so scanning them
hits `/api/public/member-card/{code}` with a code that no longer matches any
`member_code` → "العضو غير موجود", even though the member exists.

**Tell:** the scanned/displayed code starts with `Q` and/or is missing the `B`
branch letter, while the DB has zero codes starting with `Q` and all current codes
are `DEFA-B{n}-{seq}`. This is a DATA/renumber mismatch, NOT keyboard mangling
(the chars `Q`/missing-`B` are a structural format change, not a 1:1 layout swap)
and NOT an RTL display artifact (bidi reorders chars, never invents a `Q`).

**Fix (backend, `get_member_card_public`):** after exact + numeric-suffix +
dearabize lookups fail and BEFORE the name search, recover by the **trailing
numeric sequence**: for a non-numeric input ending in a `\d{3,}` group, match
`member_code` regex `-{seq}[^0-9]*$`; single match wins, multiple matches
disambiguate by the scanner's `branch_id` query param, else 409 "use full number".
This works whether the card is an old `QDEFA-...` code OR a scanner that drops/adds
chars, since only seq+branch are trusted. Also strip a scanner `#` terminator
(`^#+|#+$`) in the same endpoint — the frontend `normalizeScannedCode` strips it
too, but doing it backend-side fixes every client without a frontend rebuild.

**Why backend not frontend:** the frontend can't reconstruct `DEFA-B7-` from
`QDEFA-7-` without DB/branch knowledge; the backend has both. A backend-only fix
also reaches the native app and old published frontends after a single republish.
