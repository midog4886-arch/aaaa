"""Staff renewal follow-up and level waiting lists, scoped to tenant and branch."""
from datetime import date, datetime, timezone
from typing import Optional, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from .common import db, get_current_user
from utils.auth import require_permission, resolve_branch_filter

router = APIRouter(prefix='/operations', tags=['Operations follow-up'])


async def scoped(collection, entity_id, user):
    query = {'id': entity_id}
    branch = resolve_branch_filter(user)
    if branch:
        query['branch_id'] = branch
    row = await collection.find_one(query, {'_id': 0})
    if not row:
        raise HTTPException(404, 'العنصر غير موجود في الفرع المتاح')
    return row


class Followup(BaseModel):
    status: Literal['pending', 'contacted', 'promised', 'renewed', 'closed'] = 'pending'
    next_date: Optional[date] = None
    notes: str = Field(default='', max_length=2000)


@router.get('/renewals/{member_id}')
async def get_followup(member_id: str, user=Depends(get_current_user)):
    await require_permission(user, 'renewals')
    member = await scoped(db.members, member_id, user)
    return member.get('renewal_followup') or {}


@router.put('/renewals/{member_id}')
async def save_followup(member_id: str, payload: Followup, user=Depends(get_current_user)):
    await require_permission(user, 'renewals')
    member = await scoped(db.members, member_id, user)
    actor = await db.users.find_one({'id': user['user_id']}, {'_id': 0, 'name': 1, 'username': 1}) or {}
    record = {'status': payload.status, 'next_date': payload.next_date.isoformat() if payload.next_date else None,
              'notes': payload.notes, 'owner_id': user['user_id'], 'owner_name': actor.get('name') or actor.get('username') or user.get('username'),
              'updated_at': datetime.now(timezone.utc).isoformat()}
    await db.members.update_one({'id': member_id, 'branch_id': member.get('branch_id')}, {'$set': {'renewal_followup': record}})
    return record


def capacity_summary(level):
    ids = {entry if isinstance(entry, str) else entry.get('member_id') or entry.get('id') for entry in level.get('members', []) if isinstance(entry, (str, dict))}
    ids.discard(None)
    ids.discard('')
    name = str(level.get('activity_name') or '')
    default = 6 if 'سباح' in name or 'swim' in name.lower() else 10
    try:
        maximum = max(1, int(level.get('capacity') or default))
    except (TypeError, ValueError):
        maximum = default
    return {'used': len(ids), 'capacity': maximum, 'available': max(0, maximum - len(ids)), 'full': len(ids) >= maximum}


@router.get('/groups')
async def groups(branch_filter: Optional[str] = None, user=Depends(get_current_user)):
    await require_permission(user, 'levels')
    branch = resolve_branch_filter(user, branch_filter)
    query = {'branch_id': branch} if branch else {}
    rows = await db.levels.find(query, {'_id': 0, 'id': 1, 'activity_name': 1, 'custom_name': 1, 'level_number': 1, 'branch_id': 1, 'members': 1, 'capacity': 1, 'waiting_list': 1, 'time_slot': 1, 'days': 1}).to_list(None)
    return [{**{key: value for key, value in row.items() if key != 'members'}, **capacity_summary(row)} for row in rows]


class WaitingMember(BaseModel):
    member_id: str = Field(min_length=1, max_length=100)


@router.post('/groups/{level_id}/waiting')
async def add_waiting(level_id: str, payload: WaitingMember, user=Depends(get_current_user)):
    await require_permission(user, 'levels')
    level = await scoped(db.levels, level_id, user)
    member = await db.members.find_one({'branch_id': level.get('branch_id'), '$or': [{'id': payload.member_id}, {'member_code': payload.member_id}]}, {'_id': 0})
    if not member:
        raise HTTPException(404, 'رقم العضوية غير موجود في فرع المجموعة')
    if member.get('branch_id') != level.get('branch_id'):
        raise HTTPException(400, 'العضو والمجموعة يجب أن يكونا في الفرع نفسه')
    existing = {entry if isinstance(entry, str) else entry.get('member_id') or entry.get('id') for entry in level.get('members', []) if isinstance(entry, (str, dict))}
    member_id = member['id']
    if member_id in existing:
        raise HTTPException(409, 'العضو مسجل بالفعل في المجموعة')
    record = {'member_id': member_id, 'name': member.get('name_ar') or member.get('name'), 'created_at': datetime.now(timezone.utc).isoformat(), 'created_by': user['user_id']}
    result = await db.levels.update_one({'id': level_id, 'branch_id': level.get('branch_id'), 'waiting_list.member_id': {'$ne': member_id}}, {'$push': {'waiting_list': record}})
    if not result.modified_count:
        raise HTTPException(409, 'العضو موجود بالفعل في قائمة الانتظار')
    return record


@router.delete('/groups/{level_id}/waiting/{member_id}')
async def remove_waiting(level_id: str, member_id: str, user=Depends(get_current_user)):
    await require_permission(user, 'levels')
    level = await scoped(db.levels, level_id, user)
    await db.levels.update_one({'id': level_id, 'branch_id': level.get('branch_id')}, {'$pull': {'waiting_list': {'member_id': member_id}}})
    return {'success': True}
