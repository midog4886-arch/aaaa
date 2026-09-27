"""Durable member reminders, called once per tenant by daily checks."""
import logging
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

STAGES = (7, 3, 1)


def reminder_stage(end_date, today):
    try:
        days = (datetime.strptime(str(end_date)[:10], '%Y-%m-%d').date() - today).days
    except (ValueError, TypeError):
        return None
    if days < 0 or days > 7:
        return None
    return 7 if days > 3 else 3 if days > 1 else 1


async def send_member_expiry_reminders(db, today=None):
    today = today or datetime.now(ZoneInfo('Asia/Riyadh')).date()
    created = 0
    cursor = db.members.find({'is_active': {'$ne': False}}, {'_id': 0})
    async for member in cursor:
        for activity in member.get('activities') or []:
            if activity.get('status') in ('cancelled', 'inactive', 'refunded') or str(activity.get('start_date') or '')[:10] > today.isoformat():
                continue
            end = str(activity.get('end_date') or '')[:10]
            stage = reminder_stage(end, today)
            if stage is None or not activity.get('activity_id'):
                continue
            # A prepaid later period suppresses a reminder for the old period.
            later = any(a.get('activity_id') == activity['activity_id'] and
                        str(a.get('start_date') or '')[:10] > end and
                        a.get('status') not in ('cancelled', 'refunded', 'inactive')
                        for a in member.get('activities') or [])
            if later:
                continue
            identity = f"expiry:{member['id']}:{activity['activity_id']}:{end}:{stage}"
            nid = str(uuid.uuid5(uuid.NAMESPACE_URL, identity))
            days = (datetime.strptime(end, '%Y-%m-%d').date() - today).days
            name = activity.get('activity_name') or 'التدريب'
            message = f"اشتراك {name} ينتهي بتاريخ {end} (متبقي {days} يوم). يمكنك مراجعة اشتراكاتك والتواصل مع الفرع للتجديد."
            notification = {
                'id': nid, 'member_id': member['id'], 'branch_id': member.get('branch_id'),
                'type': 'subscription_expiry', 'title_ar': 'تذكير بانتهاء الاشتراك',
                'title': 'Subscription expiry reminder', 'message_ar': message,
                'message': f'Your {name} subscription expires on {end} ({days} days remaining).',
                'end_date': end, 'reminder_days': stage, 'activity_id': activity['activity_id'],
                'is_read': False, 'link': '/subscriptions', 'created_at': datetime.now(ZoneInfo('UTC')).isoformat(),
            }
            # _id is unique even if two schedulers run concurrently.
            from pymongo.errors import DuplicateKeyError
            try:
                result = await db.member_notifications.update_one({'_id': nid}, {'$setOnInsert': notification}, upsert=True)
            except DuplicateKeyError:
                continue
            if not result.upserted_id:
                continue
            created += 1
            try:
                from routes.push_notifications import NotificationPayload, send_push_to_members
                await send_push_to_members(NotificationPayload(
                    title=notification['title_ar'], body=message,
                    title_en=notification['title'], body_en=notification['message'],
                    url='/subscriptions', tag=identity, data={'type': 'subscription_expiry', 'end_date': end},
                ), [member['id']])
            except Exception:
                logging.getLogger(__name__).exception('Member expiry push failed')
    return created
