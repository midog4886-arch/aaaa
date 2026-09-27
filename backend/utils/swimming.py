"""Internal academy swimming meet planning; times are integer hundredths."""
import re
from datetime import date

def parse_time(value):
    if value in (None, ''):
        return None
    match = re.fullmatch(r'(?:(\d{1,3}):)?(\d{1,2})[.](\d{2})', str(value).strip())
    if not match or int(match[2]) >= 60:
        raise ValueError('الزمن بصيغة دقيقة:ثانية.جزء من مئة، مثال 01:23.45')
    total = (int(match[1] or 0) * 60 + int(match[2])) * 100 + int(match[3])
    if total <= 0:
        raise ValueError('الزمن يجب أن يكون أكبر من صفر')
    return total

def format_time(value):
    if value is None:
        return '—'
    minutes, remainder = divmod(value, 6000)
    seconds, hundredths = divmod(remainder, 100)
    return f'{minutes:02d}:{seconds:02d}.{hundredths:02d}'

def ranked(entries):
    ordered = sorted(entries, key=lambda entry: (entry.get('status') != 'finished', entry.get('time_cs') or 10**10, entry['id']))
    last, place = None, None
    for index, entry in enumerate(ordered, 1):
        entry = dict(entry)
        entry['place'] = None
        if entry.get('status') == 'finished':
            if entry['time_cs'] != last:
                place = index
                last = entry['time_cs']
            entry['place'] = place
        ordered[index - 1] = entry
    return ordered

def seed(entries, lanes):
    # Slowest heats first; fastest seeded swimmers occupy central lanes.
    ordered = sorted(entries, key=lambda row: (row.get('seed_cs') is not None, -(row.get('seed_cs') or 0), row['id']))
    lane_order = sorted(range(1, lanes + 1), key=lambda lane: (abs(lane - (lanes + 1) / 2), lane))
    result = []
    for start in range(0, len(ordered), lanes):
        heat = sorted(ordered[start:start + lanes], key=lambda row: (row.get('seed_cs') is None, row.get('seed_cs') or 10**10))
        result.extend([{**entry, 'heat': start // lanes + 1, 'lane': lane_order[index]} for index, entry in enumerate(heat)])
    return result

def validate_meet(meet, tournament_date):
    swimmers = {row['id']: row for row in meet['swimmers']}
    races = {row['id']: row for row in meet['races']}
    if len(swimmers) != len(meet['swimmers']) or len(races) != len(meet['races']):
        raise ValueError('معرّفات مكررة')
    seen, slots, windows = set(), set(), {}
    for entry in meet['entries']:
        if entry['swimmer_id'] not in swimmers or entry['race_id'] not in races:
            raise ValueError('المشارك أو السباق غير موجود')
        key = (entry['swimmer_id'], entry['race_id'])
        if key in seen:
            raise ValueError('السباح مسجل مرتين في السباق نفسه')
        seen.add(key)
        swimmer, race = swimmers[entry['swimmer_id']], races[entry['race_id']]
        birthday = date.fromisoformat(swimmer['birth_date'])
        day = date.fromisoformat(tournament_date)
        age = day.year - birthday.year - ((day.month, day.day) < (birthday.month, birthday.day))
        if not race['min_age'] <= age <= race['max_age'] or (race['gender'] != 'mixed' and race['gender'] != swimmer['gender']):
            raise ValueError(f"السباح {swimmer['name']} خارج فئة السباق")
        if birthday > day:
            raise ValueError('تاريخ الميلاد بعد تاريخ البطولة')
        entry['time_cs'] = parse_time(entry.get('time')) if entry['status'] == 'finished' else None
        entry['seed_cs'] = parse_time(entry.get('seed_time'))
        if entry['status'] == 'finished' and entry['time_cs'] is None:
            raise ValueError('أدخل زمن السباح الذي أكمل السباق')
        if entry['status'] == 'dq' and not entry.get('reason', '').strip():
            raise ValueError('أدخل سبب الاستبعاد')
        if bool(entry.get('heat')) != bool(entry.get('lane')):
            raise ValueError('أدخل رقم الشوط والحارة معًا')
        if entry.get('lane', 0) > meet['lanes']:
            raise ValueError('رقم الحارة أكبر من عدد حارات المسبح')
        if entry.get('heat'):
            slot = (entry['race_id'], entry['heat'], entry['lane'])
            if slot in slots:
                raise ValueError('حارة مكررة داخل الشوط')
            slots.add(slot)
            if race.get('start_time'):
                hours, minutes = map(int, race['start_time'].split(':'))
                start = hours * 60 + minutes + (entry['heat'] - 1) * race['heat_minutes']
                if start + race['heat_minutes'] > 1440:
                    raise ValueError('جدول الأشواط يتجاوز يوم البطولة؛ عدّل الوقت أو مدة الشوط')
                windows.setdefault(entry['swimmer_id'], []).append((start, start + race['heat_minutes']))
    conflicts = []
    for swimmer_id, times in windows.items():
        times.sort()
        if any(right[0] < left[1] for left, right in zip(times, times[1:])):
            conflicts.append(swimmers[swimmer_id]['name'])
    return conflicts
