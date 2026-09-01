---
name: Rented venue booking invariants
description: Rules for preserving rented-court booking links across branch and level mutations.
---

Rented venues are optional attachments inside any normal branch; they are not a mutually exclusive branch type. A level may remain a normal unlinked level, or select both a venue and booking slot together.

Admins manage these attachments from the independent **Rented Venues** page under Administration. Ordinary branch edits must preserve venue data but must not duplicate the venue editor.

The monthly calendar stores one-off hourly reservations as ordinary booking slots with identical start/end dates and the weekday derived from that date. Existing recurring weekly slots remain valid and are expanded into the month view.

Every mutation that can change a linked level's day, time, active status, venue, or booking slot must revalidate the complete candidate level against the selected booking. This applies to bulk cleanup and schedule-builder routes, not only the main level create/update endpoints.

An active level's venue and slot reference locks the slot's identity, weekday, time window, and validity dates. Do not delete, move, or redefine that booking—or convert the branch to permanent—until the level is closed or remapped.

**Why:** Alternate schedule mutation paths and edits to reserved slots can silently leave active levels outside their paid rental window or create collisions, even when the primary level form is correctly validated.

**How to apply:** Validate bookings based on venue/slot selection, never branch type. Neither ID is valid for a normal level; exactly one ID is invalid; both IDs require full validation. Treat legacy `days=null` levels as all weekdays for collision detection. A calendar booking must stay inside the venue contract and must not overlap another slot for the same venue/date. UI disabling is helpful, but the server remains authoritative.

Time matching must preserve explicit AM/PM and 24-hour values. Only bare legacy hours such as `الساعة 5` are ambiguous and may match either 05:00 or 17:00.