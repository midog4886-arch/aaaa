"""Member-owned support requests with branch-scoped staff management."""
import uuid
import logging
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from database import db
from routes.member_portal import get_current_member
from routes.common import get_current_user
from utils.auth import require_permission, resolve_branch_filter

router = APIRouter(prefix='/api/member-portal/support-requests', tags=['Member support'])


class SupportRequestCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=160)
    body: str = Field(min_length=5, max_length=4000)
    request_id: uuid.UUID


class SupportRequestUpdate(BaseModel):
    status: Literal['open', 'in_progress', 'resolved', 'closed']
    reply: str = Field(default='', max_length=4000)
    request_id: uuid.UUID


@router.post('')
async def create_support_request(payload: SupportRequestCreate, member: dict = Depends(get_current_member)):
    subject, body = payload.subject.strip(), payload.body.strip()
    if len(subject) < 3 or len(body) < 5:
        raise HTTPException(status_code=400, detail='اكتب عنوانًا ووصفًا واضحًا للطلب')
    ticket_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"support:{member['id']}:{payload.request_id}"))
    now = datetime.now(timezone.utc).isoformat()
    ticket = {
        'id': ticket_id, 'number': f"SUP-{datetime.now(timezone.utc):%Y%m%d}-{ticket_id[:8].upper()}",
        'member_id': member['id'], 'member_name': member.get('name_ar') or member.get('name', ''),
        'branch_id': member.get('branch_id'), 'subject': subject, 'body': body,
        'status': 'open', 'messages': [], 'created_at': now, 'updated_at': now,
    }
    from pymongo.errors import DuplicateKeyError
    try:
        result = await db.support_requests.update_one({'_id': ticket_id}, {'$setOnInsert': ticket}, upsert=True)
    except DuplicateKeyError:
        result = None
    if result and result.upserted_id:
        try:
            await db.notifications.insert_one({
                'id': str(uuid.uuid4()), 'type': 'support_request', 'title': 'طلب دعم جديد',
                'message': f"{ticket['number']} — {subject}", 'branch_id': ticket['branch_id'],
                'link': '/admin/support', 'is_read': False, 'created_at': now,
            })
        except Exception:
            logging.getLogger(__name__).exception('Support admin notification failed')
    return await db.support_requests.find_one({'_id': ticket_id, 'member_id': member['id']}, {'_id': 0})


@router.get('')
async def list_member_support_requests(member: dict = Depends(get_current_member)):
    return await db.support_requests.find({'member_id': member['id']}, {'_id': 0}).sort('updated_at', -1).to_list(100)


@router.get('/admin')
async def list_staff_support_requests(user: dict = Depends(get_current_user)):
    await require_permission(user, 'settings')
    branch = resolve_branch_filter(user, None)
    query = {'branch_id': branch} if branch else {}
    return await db.support_requests.find(query, {'_id': 0}).sort('updated_at', -1).to_list(200)


@router.patch('/admin/{ticket_id}')
async def update_support_request(ticket_id: str, payload: SupportRequestUpdate, user: dict = Depends(get_current_user)):
    await require_permission(user, 'settings')
    branch = resolve_branch_filter(user, None)
    query = {'id': ticket_id}
    if branch:
        query['branch_id'] = branch
    now = datetime.now(timezone.utc).isoformat()
    action_id = str(payload.request_id)
    update = {'$set': {'status': payload.status, 'updated_at': now}, '$push': {'action_ids': {'$each': [action_id], '$slice': -100}}}
    reply = payload.reply.strip()
    if reply:
        update['$push']['messages'] = {'$each': [{'id': action_id, 'body': reply, 'sender': 'staff', 'created_at': now}], '$slice': -100}
    ticket = await db.support_requests.find_one(query, {'_id': 0})
    if not ticket:
        raise HTTPException(status_code=404, detail='طلب الدعم غير موجود')
    result = await db.support_requests.update_one({**query, 'action_ids': {'$ne': action_id}}, update)
    if result.matched_count and (ticket['status'] != payload.status or reply):
        try:
            notification_id = f'support:{ticket_id}:{action_id}'
            await db.member_notifications.update_one({'_id': notification_id}, {'$setOnInsert': {
            'id': notification_id, 'member_id': ticket['member_id'], 'type': 'support_update',
            'title_ar': 'تحديث طلب الدعم', 'title': 'Support request updated',
            'message_ar': f"تم تحديث طلبك {ticket['number']}. {reply}".strip(),
            'message': f"Your support request {ticket['number']} has been updated.",
            'link': '/support', 'is_read': False, 'created_at': now,
            }}, upsert=True)
        except Exception:
            logging.getLogger(__name__).exception('Support member notification failed')
    return await db.support_requests.find_one(query, {'_id': 0})
