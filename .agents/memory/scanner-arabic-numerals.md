---
name: Hardware scanner Arabic keyboard mangling
description: Why a hardware barcode scanner fails member lookup while the camera works, and how to recover codes mangled by an Arabic keyboard layout.
---

# Hardware scanner is a keyboard wedge — Arabic layout mangles the WHOLE code

A physical barcode/QR scanner ("جهاز الماسح") acts as a USB/BT keyboard: it emulates
keystrokes, so the decoded text passes through the OS/tablet keyboard layout. When the
input language is Arabic, an ASCII member code (e.g. `DEFA-B7-0047`) arrives mangled —
**not just digits, the letters too**:
- digits → Arabic-Indic (٠-٩) / Persian (۰-۹);
- lowercase letters → Arabic letters (Arabic-101 positions: ب=F, ص=W, لا=B …);
- UPPERCASE letters (scanner sends Shift) → shifted Arabic forms: brackets/diacritics
  (Shift+D=`]`, Shift+F=`[`, Shift+E=damma, Shift+A=kasra), lam-alef ligatures (لآ/لأ/لإ).

The **camera scanner works** because it decodes QR text directly in JS — no keyboard
layout involved. That camera-vs-hardware split is the tell: it's an input-encoding
problem, not missing data.

**Why:** symptom is "scanner finds NO card, camera is fine," and the displayed code
shows Arabic letters/brackets mixed with the right digits.

**How to apply (durable rule):** treat any scanned/typed code as possibly typed through
the Arabic layout. Two-step recovery, both gated on the string actually containing
Arabic-script chars (`[\u0600-\u06FF]`) so clean ASCII (camera) is never touched:
1. digit-normalize (Arabic/Persian → ASCII);
2. reverse the Arabic-101 layout (ligatures first, then per-char map of Arabic-script
   + shifted-ASCII chars → Latin), uppercase the result.

Helpers: backend `utils/text.py` (`normalize_digits`, `dearabize_keyboard`); frontend
`utils/digits.js` (`toAsciiDigits`, `deArabizeKeyboard`, `normalizeScannedCode`).

Wiring rules that matter:
- On the backend apply de-arabization as a **member_code/phone-only FALLBACK after the
  exact lookup and BEFORE any fuzzy name search**, so a mangled code can't false-match an
  Arabic name and a real Arabic name search is never corrupted.
- **Always `re.escape` user/scanner input used in a Mongo `$regex`** — mangled output
  routinely contains regex metacharacters (`[` `]`) that otherwise break the query.
- On the frontend de-arabize only in scanner paths (GlobalScanner buffer, kiosk,
  CameraQRScanner) — NOT in manual name search. For QR JSON payloads, `JSON.parse` the
  raw text first, then normalize only the extracted code field.
- Python `"١٠".isdigit()` is True but the literal won't regex-match ASCII — normalize
  BEFORE any `.isdigit()` suffix-matching branch.
