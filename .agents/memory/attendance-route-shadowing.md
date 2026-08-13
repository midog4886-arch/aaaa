---
name: Attendance route shadowing
description: Which handler actually serves each attendance endpoint (routes/attendance.py vs server.py duplicates)
---

`routes/attendance.py` is included in `api_router` BEFORE server.py's decorators run, so FastAPI dispatches to it first for duplicate paths.

- `POST /api/attendance` (manual) and `POST /api/attendance/qr-checkin` → **routes/attendance.py** handlers (lines ~196 and ~1384). The lookalike handlers in server.py for these two paths are DEAD CODE — edits there never execute.
- `POST /api/attendance/quick` (scanner) and `POST /api/attendance/bulk` → **server.py** (no collision).

**Why:** guardian attendance notifications were once added to the shadowed server.py handlers and silently never ran; architect review caught it.

**How to apply:** before editing any attendance endpoint, confirm which module's route actually wins (router include order), and put member_notifications/push logic in the live handler. Push helper: `_push_attendance_notice` in server.py (create_task + Semaphore(10)); in-app helper `_insert_attendance_inapp_notif` in routes/attendance.py.
