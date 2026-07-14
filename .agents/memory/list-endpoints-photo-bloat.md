---
name: List endpoints photo bloat
description: Base64 photos embedded in member/coach docs make list endpoints huge and slow; use exclude_photo=true where avatars aren't needed.
---

Members and coaches store their photo as a base64 string INSIDE the document (no separate collection/URL). A branch of ~200 members ≈ 2.3 MB list response; 39 coaches ≈ 9 MB raw (~25s under Atlas latency). This caused NetworkTimeout 500s and "stuck spinner" pages (invoices page Promise.all fails if any call fails).

**Rule:** GET /api/members and GET /api/coaches accept `exclude_photo=true` which projects out `photo`. Any page that only needs names/codes (pickers, invoice page, dropdowns) must pass it. Pages showing avatars (MembersPage, AttendancePage, CoachAttendancePage) keep full fetch.

**Why:** photos can't become URLs easily — `<img>` tags can't send the JWT Authorization header, so a photo endpoint would need to be public or token-in-query.

Note: coaches list is cached; cache key includes a full/nophoto suffix — keep it in sync if adding more projection variants.
