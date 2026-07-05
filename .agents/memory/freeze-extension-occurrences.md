---
name: Freeze extension by training-day occurrences
description: Extending a subscription end_date to compensate frozen sessions must step to the n-th schedule-weekday occurrence, never add n calendar days.
---

**Rule:** Any compensation that extends `member.activities[].end_date` by "n lost training days" must walk forward to the n-th occurrence of the member's schedule weekdays (`extend_end_by_training_days` in `routes/freezes.py`). Adding `timedelta(days=n)` lands on arbitrary weekdays (e.g. Sun+Tue member + 1 day onto a Tuesday → Wednesday) and the member gains zero attendable sessions.

**Why:** Real bug: freeze on Sunday 07-05 extended end 07-07→07-08 (Wed) — session lost with no make-up; user reported "الحصص المرحلة لم تعوض". Closures (`day_extensions.py find_new_end_date`) already did this correctly; freezes did not.

**How to apply:** New freeze `extension_records` carry `old_end_date`/`new_end_date`; cancel rebuilds end = extend(old_end, consumed) + drift (drift = current_end − recorded new_end, preserving later renewals/closures). Records WITHOUT `old_end_date` are legacy calendar-day extensions and must be reversed by calendar subtraction. A one-time audit found ~60 legacy under-compensated active records (heuristic: corrected = extend(cur_end − days, days)).
