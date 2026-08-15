---
name: Member photo store
description: Member photos live in member_photos collection, not member docs; signed public URL contract
---

Member photos are NOT stored in `members.photo` anymore. The image (recompressed 512px JPEG) lives in the `member_photos` collection; `members.photo` holds only a small signed URL: `/api/public/member-photo/<tenant_slug>/<member_id>?v=<hash>&sig=<hmac>` (helpers in `backend/utils/member_photos.py`).

**Why:** base64-in-doc bloated every list/report to MBs on a wire-bound Atlas free tier; this fixes the root cause instead of per-screen exclude_photo patches.

**How to apply:**
- Any new photo WRITE path must go through `store_member_photo` (never write data URLs into member docs). Empty string clears via `delete_member_photo`.
- The serve route is public-but-signed because `<img>` can't send JWT/X-Tenant-Slug headers (native portal app = fixed domain); tenant resolves from the URL path. HMAC uses SESSION_SECRET — rotating it breaks all stored URLs (would need re-migration to regenerate).
- Consumers that need PIXELS (XLSX/PDF export embedding) must bulk-load via `load_photo_data_map`; a URL string in `member_photo` is not embeddable.
- Legacy inline data URLs may still exist in old attendance copies of other tenants; `scripts/migrate_member_photos.py` is idempotent and rewrites them.
- Coach/supervisor photos are still inline base64 (same old bloat) — not yet migrated.
