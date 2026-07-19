---
name: Scanner throughput flow (camera + hardware)
description: Rules for fast back-to-back check-in scanning without stale-response bleed
---

Both scanners (camera QR + hardware keyboard-wedge GlobalScanner, reused by the
scanner-station kiosk) are tuned for back-to-back member check-ins.

**Rules:**
- Member-card lookup must pass `lite=1` (skips base64 photo) everywhere the photo
  is not rendered. Pages that DO show the photo (attendance report, member card)
  must NOT get lite.
- Scan-lock/debounce must apply to the SAME code only (scanner double-reads);
  a different card must pass immediately.
- A different card scanned while a finished result dialog is open interrupts it
  and processes the new member at once — but ONLY when no lookup/check-in request
  is in flight (busy flag mirrored from loading + per-activity 'loading' states).
- Every await inside the scan handler needs a stale-scan guard
  (`lastScannedCodeRef !== memberCode → return`), including catch blocks, or a
  late response paints the previous member's data over the new dialog.
- Auto-close timing: clean success 2s; quota/wrong-day warnings or member notes
  stay longer (camera: stays open; hardware: 4s) so staff can read them.
- Hardware keydown handler must KEEP buffering (preventDefault only) while
  processing, or the interrupting card's code never reaches the scan handler.

**Why:** front-desk queues; the old flow forced ~3.3s minimum between members and
silently dropped scans made while the dialog was open.
