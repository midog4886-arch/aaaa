---
name: Member-card scan failures — scanner prefix/suffix + legacy renumber
description: Why scanning printed member cards returns "العضو غير موجود" or a cross-branch 409 even though the member exists.
---

# Member-card QR scans fail from two compounding causes

A member-card QR encodes the member's CURRENT `member_code` (no extra prefix).
Two things break the public lookup (`/api/public/member-card/{code}`):

1. **Scanner wraps every scan.** The hardware scanner is configured to PREFIX a
   fixed letter (observed `q`/`Q`) and APPEND a `#`. So a card encoding the valid
   `DEFA-B7-0025` arrives as `qDEFA-B7-0025#`. The leading letter defeats the
   exact match and pushes lookup into the ambiguous trailing-sequence path.
2. **Global member renumber.** Old printed cards encode a pre-renumber code:
   `DEFA-7-0025` (no `B`) or `QDEFA-7-0025`, now stored as `DEFA-B7-0025`. The
   DB has zero codes starting with `Q`; all current codes are `DEFA-B{n}-{seq}`.

**Tell it apart:** a `Q`/`q` prefix or missing-`B` is a structural format/wrapper
change, NOT keyboard mangling (that's a 1:1 layout swap of chars) and NOT an RTL
display artifact (bidi reorders, never invents a `Q`).

## Durable rules for the lookup endpoint

- **Strip scanner wrapping defensively, server-side.** Strip a leading/trailing
  `#`, and on exact-match FAILURE retry the exact match after dropping a single
  leading ASCII letter. Doing it backend-side fixes every client (incl. the
  native app and old published frontends) without a frontend rebuild. Only retry
  on failure so a valid code is never mutated; guard on ASCII so Arabic name
  searches are untouched.
- **Prefer recovering the FULL code over a trailing-seq match.** The seq alone
  (e.g. `0025`) is ambiguous across branches → 409. The full code carries the
  branch (`B7`), so stripping the wrapper to get an exact match is unambiguous.
- **Disambiguate a duplicate seq by the branch embedded in the code itself,**
  before relying on the scanner's `branch_id` param — a super-admin scans with
  no branch context, so branch_id is often absent. The legacy code's middle
  number is the branch hint.
- **Why backend not frontend:** the frontend can't reconstruct `DEFA-B7-` from a
  legacy/wrapped code without DB+branch knowledge; the backend has both.
