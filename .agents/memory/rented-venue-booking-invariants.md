---
name: Rented venue booking invariants
description: Rules for preserving rented-court booking links across branch and level mutations.
---

Every mutation that can change a level's day, time, active status, venue, or booking slot must revalidate the complete candidate level against the rented branch booking. This applies to bulk cleanup and schedule-builder routes, not only the main level create/update endpoints.

An active level's venue and slot reference locks the slot's identity, weekday, time window, and validity dates. Do not delete, move, or redefine that booking—or convert the branch to permanent—until the level is closed or remapped.

**Why:** Alternate schedule mutation paths and edits to reserved slots can silently leave active levels outside their paid rental window or create collisions, even when the primary level form is correctly validated.

**How to apply:** Centralize server-side validation and invoke it before every relevant write. Treat legacy `days=null` levels as all weekdays for collision detection. UI disabling is helpful, but the server remains authoritative.

Time matching must preserve explicit AM/PM and 24-hour values. Only bare legacy hours such as `الساعة 5` are ambiguous and may match either 05:00 or 17:00.