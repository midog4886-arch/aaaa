"""Read-only queue presentation derived from durable request evidence."""
import hashlib
from datetime import datetime, timedelta, timezone
from services.registration_followups import normalize_phone, _parse, _quiet_adjust, RIYADH


def enrich_queue(rows, now=None):
    now = now or datetime.now(timezone.utc)
    groups = {}
    for row in rows:
        phone = normalize_phone(row.get('customer_phone'))
        key = f"{row.get('branch_id')}:{phone}" if phone else row['id']
        groups.setdefault(key, []).append(row)
    for key, family in groups.items():
        live = [r for r in family if r.get('status') == 'pending' and r.get('followup_enrolled')]
        created = min(filter(None, (_parse(r.get('created_at')) for r in live)), default=None)
        sent_count = max((int(r.get('followup_sent_count') or 0) for r in live), default=0)
        due = None
        if created and sent_count < 2:
            target = created + timedelta(days=3 if sent_count else 1)
            first = max(filter(None, (_parse(r.get('followup_first_sent_at')) for r in live)), default=None)
            if sent_count and first:
                target = max(target, (first.astimezone(RIYADH) + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0).astimezone(timezone.utc))
            due = _quiet_adjust(target)
        for row in family:
            row['family_key'] = hashlib.sha256(key.encode()).hexdigest()[:24]
            row['last_contact_at'] = max(filter(None, (_parse(row.get(k)) for k in ['followup_staff_contacted_at', 'followup_first_sent_at', 'followup_second_sent_at', 'followup_automatic_sent_at'])), default=None)
            if row['last_contact_at']:
                row['last_contact_at'] = row['last_contact_at'].isoformat()
            eligible = row.get('status') == 'pending' and row.get('followup_enrolled') and row.get('followup_status') in {'scheduled', 'first_sent', 'blocked'}
            row['next_followup_at'] = due.isoformat() if due and eligible else None
            row['followup_overdue'] = bool(due and eligible and due < now)
    return rows
