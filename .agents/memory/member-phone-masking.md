---
name: Member phone permission masking
description: Phone numbers are permission-gated; every member-returning endpoint must mask consistently or it becomes a bypass.
---

Member phone numbers are gated by the `member-phones` permission (admins always allowed). Without it, phones are shown MASKED keeping first 3 + last 2 digits (e.g. `0551991992` -> `055•••••92`), enforced SERVER-SIDE in `backend/routes/members.py` via `_mask_phone()` + `_can_view_member_phones()`.

**Rule:** EVERY endpoint that returns a member document to the UI must run the same mask check — not just the obvious GET list/detail. `PUT /members/{id}` (`update_member`) returns the updated doc and was an initial bypass (an unauthorized user could edit notes and read the full phone back). Mask the response there too.

**Why:** masking only the list/detail GETs leaves write-then-read responses (and any future member-returning route) leaking the real number.

**How to apply:**
- New member-returning routes → mask `phone` and `guardian_phone` when `not await _can_view_member_phones(current_user)`.
- `update_member` also DROPS incoming `phone`/`guardian_phone` from the update payload for unauthorized callers, and drops any value containing the bullet `•`, so a masked UI value never overwrites the real stored number.
- Frontend (`MembersPage.js`): `canViewPhones` gates the WhatsApp buttons (a masked number makes `wa.me` links broken), display itself just renders whatever the backend sends.
- Exports (`/export/members*` in server.py) are already admin-only (`_require_export_admin_token`), so no masking needed there — non-admins can't reach them.
- Internal logic (WhatsApp reminders, invoices) reads phones directly from DB, NOT through these masked GET responses, so masking does not break them.
