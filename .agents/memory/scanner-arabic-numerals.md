---
name: Hardware scanner Arabic numerals
description: Why hardware barcode scanners fail member lookup while the camera works, and where to normalize digits.
---

# Hardware scanner emits Arabic-Indic digits

A physical barcode/QR scanner device ("جهاز الماسح") acts as a USB/BT keyboard: it
emulates keystrokes, so the decoded digits pass through the OS keyboard layout. On
an Arabic layout the digits arrive as Arabic-Indic (٠-٩, U+0660-0669) or Persian
(۰-۹, U+06F0-06F9) numerals. Member codes are stored ASCII (e.g. DEFA-B7-0196), so
lookup returns 404 "العضو غير موجود". The **camera scanner works** because it
decodes QR text directly in JS — no keyboard layout involved.

**Why:** symptom is "scanner not found for ALL cards, but camera is fine." That
camera-vs-hardware split is the tell — it is a digit-encoding problem, not data.

**How to apply:** normalize Arabic/Persian digits → ASCII at EVERY entry point where
a scanned/typed member code reaches a lookup. Helpers: backend
`utils/text.py::normalize_digits`, frontend `utils/digits.js::toAsciiDigits`.
Covered paths: public member-card lookup, qr_checkin, quick-search,
quick-search-multi, quick attendance (backend); GlobalScanner keydown buffer,
CameraQRScanner.extractMemberCode, AttendancePage fetchMemberActivities /
handleQRCheckin / handleKioskCheckin / handleQuickSearch (frontend). Note Python
`"١٠".isdigit()` is True but the literal won't regex-match ASCII — normalize BEFORE
the `.isdigit()` suffix-matching branch.
