from datetime import datetime, timezone, date
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from .common import db, get_current_user
from utils.auth import require_permission, resolve_branch_filter
from utils.swimming import validate_meet, ranked, seed, format_time

router = APIRouter(prefix='/tournaments', tags=['Swimming meets'])
class Race(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    distance: int = Field(ge=25, le=10000)
    stroke: Literal['freestyle', 'backstroke', 'breaststroke', 'butterfly', 'medley']
    min_age: int = Field(default=0, ge=0, le=120)
    max_age: int = Field(default=120, ge=0, le=120)
    gender: Literal['male', 'female', 'mixed'] = 'mixed'
    start_time: str = Field(default='', pattern=r'^(?:|(?:[01]\d|2[0-3]):[0-5]\d)$')
    heat_minutes: int = Field(default=5, ge=1, le=120)
class Swimmer(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    member_id: Optional[str] = None
    name: str = Field(min_length=1, max_length=150)
    birth_date: date
    gender: Literal['male', 'female']
    team: str = Field(default='', max_length=150)
    external_reference: str = Field(default='', max_length=100)
class Entry(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    swimmer_id: str
    race_id: str
    seed_time: str = Field(default='', max_length=20)
    time: str = Field(default='', max_length=20)
    status: Literal['pending', 'finished', 'dns', 'dnf', 'dq'] = 'pending'
    reason: str = Field(default='', max_length=500)
    heat: int = Field(default=0, ge=0, le=10000)
    lane: int = Field(default=0, ge=0, le=10)
class Meet(BaseModel):
    revision: int = Field(default=0, ge=0)
    pool_length: Literal[25, 50] = 25
    lanes: int = Field(default=6, ge=1, le=10)
    races: list[Race] = Field(default_factory=list, max_length=200)
    swimmers: list[Swimmer] = Field(default_factory=list, max_length=5000)
    entries: list[Entry] = Field(default_factory=list, max_length=20000)
    approved: bool = False

async def load(tid, user):
    await require_permission(user, 'tournaments')
    tournament = await db.tournaments.find_one({'id': tid}, {'_id': 0})
    branch = resolve_branch_filter(user)
    if not tournament or (branch and tournament.get('branch_id') not in (None, branch)):
        raise HTTPException(404, 'البطولة غير موجودة')
    return tournament

@router.get('/{tid}/swimming')
async def get_meet(tid: str, user=Depends(get_current_user)):
    tournament = await load(tid, user)
    meet = tournament.get('swimming_meet') or Meet().model_dump(mode='json')
    return {**meet, 'name': tournament['name'], 'date': tournament.get('date'), 'place': tournament.get('place'), 'rankings': {race['id']: ranked([e for e in meet['entries'] if e['race_id'] == race['id']]) for race in meet['races']}}

@router.put('/{tid}/swimming')
async def save_meet(tid: str, payload: Meet, auto_seed: bool = False, user=Depends(get_current_user)):
    tournament = await load(tid, user)
    data = payload.model_dump(mode='json')
    try:
        if len({e['id'] for e in data['entries']}) != len(data['entries']):
            raise ValueError('معرّف مشاركة مكرر')
        if any(r['max_age'] < r['min_age'] or r['distance'] % data['pool_length'] for r in data['races']):
            raise ValueError('راجع حدود العمر والمسافة؛ يجب أن تكون المسافة مضاعفًا لطول المسبح')
        # Member identity and name are authoritative, never taken from client text.
        for swimmer in data['swimmers']:
            if swimmer['member_id']:
                query = {'$or': [{'id': swimmer['member_id']}, {'member_code': swimmer['member_id']}]}
                branch = tournament.get('branch_id') or resolve_branch_filter(user)
                if branch:
                    query['branch_id'] = branch
                member = await db.members.find_one(query, {'_id': 0, 'id': 1, 'name': 1, 'name_ar': 1})
                if not member:
                    raise ValueError('رقم عضوية غير موجود في فرع البطولة')
                swimmer['member_id'] = member['id']
                swimmer['name'] = member.get('name_ar') or member.get('name') or swimmer['name']
        keys = [s['member_id'] for s in data['swimmers'] if s['member_id']]
        if len(set(keys)) != len(keys):
            raise ValueError('عضو مكرر ضمن السباحين')
        external_keys = [(s['team'].strip(), s['external_reference'].strip()) for s in data['swimmers'] if not s['member_id'] and s['external_reference'].strip()]
        if len(set(external_keys)) != len(external_keys):
            raise ValueError('رقم مشارك خارجي مكرر ضمن الفريق نفسه')
        conflicts = validate_meet(data, tournament.get('date') or '')
        if auto_seed:
            data['entries'] = [entry for race in data['races'] for entry in seed([e for e in data['entries'] if e['race_id'] == race['id']], data['lanes'])]
            conflicts = validate_meet(data, tournament.get('date') or '')
        if data['approved'] and (not data['entries'] or any(e['status'] == 'pending' for e in data['entries'])):
            raise ValueError('أكمل نتائج جميع المشاركات قبل الاعتماد')
    except ValueError as error:
        raise HTTPException(400, str(error))
    revision = payload.revision
    data['revision'] = revision + 1
    data['updated_by'] = user['user_id']
    data['updated_at'] = datetime.now(timezone.utc).isoformat()
    data['approved_by'] = user['user_id'] if data['approved'] else None
    data['approved_at'] = data['updated_at'] if data['approved'] else None
    query = {'id': tid, 'swimming_meet.revision': revision} if revision else {'id': tid, '$or': [{'swimming_meet': {'$exists': False}}, {'swimming_meet.revision': 0}, {'swimming_meet': None}]}
    result = await db.tournaments.update_one(query, {'$set': {'swimming_meet': data}})
    if not result.modified_count:
        raise HTTPException(409, 'عدّل موظف آخر البطولة؛ أعد التحميل قبل الحفظ')
    return {**data, 'conflicts': conflicts}

@router.get('/{tid}/swimming/bests')
async def bests(tid: str, user=Depends(get_current_user)):
    tournament = await load(tid, user)
    meet = tournament.get('swimming_meet') or {}
    branch = resolve_branch_filter(user)
    query = {'id': {'$ne': tid}, 'swimming_meet.approved': True, 'swimming_meet.pool_length': meet.get('pool_length', 25), 'date': {'$lt': tournament.get('date') or ''}}
    if branch:
        query['branch_id'] = branch
    elif tournament.get('branch_id'):
        query['branch_id'] = tournament['branch_id']
    previous = await db.tournaments.find(query, {'_id': 0, 'swimming_meet': 1}).to_list(None)
    output = {}
    current_swimmers = {s['id']: s for s in meet.get('swimmers', [])}
    for entry in meet.get('entries', []):
        current = current_swimmers[entry['swimmer_id']]
        member_id = current.get('member_id')
        race = next(r for r in meet['races'] if r['id'] == entry['race_id'])
        times = []
        for old in previous:
            past = old['swimming_meet']
            swimmers = {s['id'] for s in past['swimmers'] if (member_id and s.get('member_id') == member_id) or (not member_id and current.get('external_reference') and not s.get('member_id') and s.get('external_reference') == current['external_reference'] and s.get('team') == current.get('team') and s.get('birth_date') == current['birth_date'])}
            races = {r['id'] for r in past['races'] if r['stroke'] == race['stroke'] and r['distance'] == race['distance']}
            times.extend(e['time_cs'] for e in past['entries'] if e['swimmer_id'] in swimmers and e['race_id'] in races and e['status'] == 'finished' and e.get('time_cs'))
        best = min(times) if times else None
        output[entry['id']] = {'previous_best': format_time(best), 'improvement_cs': best - entry['time_cs'] if best and entry.get('time_cs') else None}
    return output
