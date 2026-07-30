---
name: member.activities dedupe by activity_id
description: Every write path to member.activities must dedupe by activity_id, else duplicates stack
---

# member.activities must dedupe by activity_id on every write path

`member.activities[]` is meant to hold ONE entry per activity (one subscription
per activity_id). Multiple code paths write to it and they MUST all merge by
`activity_id` (replace the existing same-activity entry, preserving `coach_id`
and `level_id` if the incoming item lacks them), never blind-append.

**The bug that happened:** the invoice path (`routes/invoices.py`) correctly
dedupes by `activity_id`, but registration-form conversion
(`convert_registration_form` in `server.py`, both the main-member and the
additional-members/siblings sub-paths) used `$push`/`$push $each` with NO dedupe.
Re-converting a form (or several forms) for the same activity stacked identical
copies — one member ended up with 4 identical swimming entries, which the members
list renders verbatim (it just maps `member.activities`), so it looked like the
same activity 3-4 times. Members with no invoice and no converted form simply
have an empty `activities[]` → "لا يوجد أنشطة" (expected, not a bug).

**Why:** the frontend members list maps `member.activities` directly with no
client-side dedupe, so any duplicate in the array is shown.

**How to apply:** when adding any new write path to `member.activities`, mirror
the invoice merge: read existing, for each incoming item replace the entry with
the same `activity_id` (carry over `coach_id`/`level_id` when missing) else
append, then `$set` the whole array. The read-only member-card endpoint already
dedupes its response, so the trap is specifically the persisted-write paths.

**Card prints dedupe at render (display-level):** membership-card HTML builders must not render `member.activities` verbatim — legacy dup copies (same name, different end_date, e.g. after a renewal merged by activity_id into only one copy) print "✓ swimming ✓ swimming". Shared helper `dedupeCardActivities` in `frontend/src/utils/printLang.js` dedupes by whitespace-normalized lowercased activity_name keeping the latest-end copy (tie → status active); use it in EVERY card/print surface that lists activities. Data itself is left untouched (no safe way to know which dup is authoritative).
