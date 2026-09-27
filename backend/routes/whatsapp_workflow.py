"""Reviewed WhatsApp campaigns: immutable recipient snapshots and durable delivery."""
import asyncio
import logging
import io
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel, Field
from starlette.datastructures import Headers
from fastapi.responses import Response
from database import db
from utils.auth import get_current_user
from utils.phone import normalize_phone
from routes import whatsapp as wa
from services import whatsapp_bulk_jobs as jobs

router = APIRouter(prefix='/whatsapp/workflow', tags=['WhatsApp campaign review'])

class PreviewRequest(BaseModel):
    branch_id: str
    audience: str = 'pasted'
    recipients: list[dict] = Field(default_factory=list, max_length=200)
    message: str = Field(min_length=1, max_length=4096)
    default_name: str = Field(default='', max_length=200)
    group_id: str = ''
    excluded_phones: list[str] = Field(default_factory=list, max_length=200)

class SubmitRequest(PreviewRequest):
    campaign_id: str
    schedule_at: str | None = None

def schedule(value):
    if not value: return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None or parsed <= datetime.now(timezone.utc): raise ValueError()
        return parsed.astimezone(timezone.utc)
    except (ValueError, TypeError):
        raise HTTPException(400, 'اختر موعداً مستقبلياً مع المنطقة الزمنية')

async def access(user, branch):
    wa._require_bulk_whatsapp_access(user)
    await wa._require_campaign_branch(user, branch)
    await wa._require_campaign_phone_access(user)

async def prepare(data):
    if data.audience == 'expiring_members':
        today = datetime.now(wa.RIYADH_TZ).date()
        rows = await db.members.find({'branch_id': data.branch_id, 'activities': {'$elemMatch': {
            'end_date': {'$gte': today.isoformat(), '$lte': (today+timedelta(days=7)).isoformat()}
        }}}, {'_id':0}).to_list(201)
        source = [{'phone': r.get('phone'), 'member_id':r.get('id'), 'name':r.get('name_ar') or r.get('name')} for r in rows]
    else:
        source = data.recipients if data.audience == 'pasted' else await wa._campaign_audience_recipients(data.branch_id, data.audience)
    excluded = {normalize_phone(p) for p in data.excluded_phones}
    seen, result = set(), []
    counts = {'invalid':0, 'duplicates':0, 'opted_out':0, 'excluded':0}
    group = None
    if data.group_id:
        group = await db.levels.find_one({'id':data.group_id, 'branch_id':data.branch_id})
        if not group: raise HTTPException(404, 'المجموعة غير موجودة في هذا الفرع')
    for row in source:
        phone = normalize_phone(row.get('phone'))
        if not phone: counts['invalid']+=1; continue
        if phone in seen: counts['duplicates']+=1; continue
        seen.add(phone)
        if phone in excluded: counts['excluded']+=1; continue
        if await db.registration_followup_stops.find_one({'phone':phone, '$or':[{'reason':'opted_out'},{'persistent':True}]}):
            counts['opted_out']+=1; continue
        member = None
        member_id = row.get('member_id')
        if member_id is not None and (not isinstance(member_id,str) or len(member_id)>128):
            raise HTTPException(400,'معرّف المستلم غير صالح')
        if member_id:
            member = await db.members.find_one({'id':member_id, 'branch_id':data.branch_id}, {'_id':0})
            if not member or normalize_phone(member.get('phone'))!=phone: continue
        if group and (not member or not any(a.get('level_id')==data.group_id for a in member.get('activities',[]))): continue
        name = str((member or {}).get('name_ar') or (member or {}).get('name') or row.get('name') or data.default_name)[:200]
        ends = [a.get('end_date') for a in (member or {}).get('activities',[]) if wa._campaign_end_date(a.get('end_date'))]
        end = max(ends, default='')
        message = re.sub(r'\{\s*(الاسم|name)\s*\}', lambda _:str(name or ''), data.message, flags=re.I)
        message = re.sub(r'\{\s*(تاريخ_الانتهاء|expiry_date)\s*\}', lambda _:end, message, flags=re.I)
        if not message.strip() or len(message)>4096: raise HTTPException(400, 'الرسالة فارغة أو أطول من الحد المسموح')
        result.append({'phone':phone,'name':name,'member_id':member_id,'message':message})
    if len(result)>200: raise HTTPException(400, 'قسّم الجمهور إلى حملات لا تتجاوز 200 مستلم')
    return {'recipients':result,'count':len(result),'removed':counts}

@router.post('/preview')
async def preview(data:PreviewRequest, user:dict=Depends(get_current_user)):
    await access(user,data.branch_id)
    return await prepare(data)

@router.get('/groups')
async def groups(branch_id:str, user:dict=Depends(get_current_user)):
    await access(user,branch_id)
    return await db.levels.find({'branch_id':branch_id},{'_id':0,'id':1,'custom_name':1,'level_number':1}).to_list(500)

@router.post('/submit')
async def submit(data:SubmitRequest, user:dict=Depends(get_current_user)):
    await access(user,data.branch_id)
    when=schedule(data.schedule_at)
    campaign=await db.whatsapp_campaigns.find_one({**wa._campaign_scope(data.branch_id),'id':data.campaign_id})
    if not campaign: raise HTTPException(404,'احفظ المسودة أولاً')
    snapshot=await prepare(data)
    if not snapshot['count']: raise HTTPException(400,'لا يوجد مستلمون صالحون')
    row={'id':str(uuid.uuid4()),'branch_id':data.branch_id,'campaign_id':data.campaign_id,
         'title':campaign['name'],'status':'pending_review','created_by':user['user_id'],
         'created_at':datetime.now(timezone.utc),'schedule_at':when,**snapshot,
         'attachments':wa._campaign_attachment_items(campaign)}
    await db.whatsapp_reviews.insert_one(row)
    return {'id':row['id'],'status':row['status']}

@router.get('')
async def list_reviews(branch_id:str, user:dict=Depends(get_current_user)):
    await access(user,branch_id)
    rows=await db.whatsapp_reviews.find({'branch_id':branch_id},{'_id':0}).sort('created_at',-1).to_list(100)
    for row in rows:
        row['media']=[{k:ref.get(k) for k in ('attachment_name','attachment_type','attachment_size')} for ref in row.pop('attachments',[])]
        if row.get('job_id'): row['job']=await jobs.get_job(row['job_id'],branch_id)
    return rows

async def load(review_id,branch,user):
    await access(user,branch)
    row=await db.whatsapp_reviews.find_one({'id':review_id,'branch_id':branch},{'_id':0})
    if not row: raise HTTPException(404,'الحملة غير موجودة')
    return row

@router.get('/{review_id}/media/{index}')
async def media(review_id:str,index:int,branch_id:str,user:dict=Depends(get_current_user)):
    row=await load(review_id,branch_id,user)
    refs=row.get('attachments',[])
    if index<0 or index>=len(refs): raise HTTPException(404,'المرفق غير موجود')
    ref=refs[index]
    return Response(await wa._load_bulk_attachment(branch_id,ref),media_type=ref['attachment_type'],headers={'Cache-Control':'private, no-store'})

@router.post('/{review_id}/approve')
async def approve(review_id:str, branch_id:str, user:dict=Depends(get_current_user)):
    row=await load(review_id,branch_id,user)
    if not user.get('is_admin'): raise HTTPException(403,'اعتماد المدير مطلوب')
    if row['status']!='pending_review': raise HTTPException(409,'تمت معالجة هذا الطلب')
    config=await wa._get_branch_cloud_config(branch_id)
    reason=wa._validate_bulk_job_config(wa._branch_provider(config),config)
    if reason: raise HTTPException(400,'خدمة الإرسال غير جاهزة: '+reason)
    when=row.get('schedule_at')
    if when and when.replace(tzinfo=timezone.utc)>datetime.now(timezone.utc):
        changed=await db.whatsapp_reviews.update_one({'id':review_id,'status':'pending_review'},
            {'$set':{'status':'scheduled','approved_by':user['user_id']}})
        if not changed.modified_count: raise HTTPException(409,'تمت معالجة هذا الطلب')
        return {'status':'scheduled'}
    return await dispatch(row,user)

async def dispatch(row,user):
    review_id,branch_id=row['id'],row['branch_id']
    changed=await db.whatsapp_reviews.update_one({'id':review_id,'status':row['status']},{'$set':{
        'status':'preparing','approved_by':user['user_id'],'started_at':datetime.now(timezone.utc)}})
    if not changed.modified_count: raise HTTPException(409,'تمت معالجة هذا الطلب')
    context={**user,'_approved_campaign':True}
    key='review_'+review_id.replace('-','')
    try:
        if row.get('attachments'):
            uploads=[]
            for ref in row['attachments']:
                content=await wa._load_bulk_attachment(branch_id,ref)
                uploads.append(UploadFile(io.BytesIO(content), filename=ref.get('attachment_name','attachment'),headers=Headers({'content-type':ref['attachment_type']})))
            try:
                job=await wa.send_branch_cloud_bulk_media(branch_id=branch_id,recipients_json=json.dumps(row['recipients']),idempotency_key=key,
                    campaign_title=row['title'],campaign_id=row['campaign_id'],branch_name='',attachment=None,attachments=uploads,current_user=context,response=None)
            finally:
                for upload in uploads: await upload.close()
        else:
            job=await wa.send_branch_cloud_bulk(wa.BulkCloudSendRequest(branch_id=branch_id,recipients=row['recipients'],idempotency_key=key,campaign_title=row['title'],campaign_id=row['campaign_id']),context)
        await db.whatsapp_reviews.update_one({'id':review_id},{'$set':{'status':'queued','job_id':job['id']}})
        return job
    except Exception:
        # Persisted idempotency key allows recovery without a second delivery.
        job=await jobs.get_job_by_key(branch_id,key)
        await db.whatsapp_reviews.update_one({'id':review_id},{'$set':{'status':'queued' if job else 'pending_review',**({'job_id':job['id']} if job else {}),'error':'تعذر تجهيز الإرسال؛ تحقق من خدمة الفرع والمرفقات ثم أعد الاعتماد'}})
        raise

@router.post('/{review_id}/cancel')
async def cancel(review_id:str,branch_id:str,user:dict=Depends(get_current_user)):
    row=await load(review_id,branch_id,user)
    if not user.get('is_admin') and row['created_by']!=user['user_id']: raise HTTPException(403,'لا يمكنك إلغاء حملة موظف آخر')
    if row['status']=='preparing': raise HTTPException(409,'انتظر اكتمال اعتماد الحملة')
    changed=await db.whatsapp_reviews.update_one({'id':review_id,'status':{'$in':['pending_review','scheduled','queued']}},{'$set':{'status':'cancelled'}})
    if not changed.modified_count: raise HTTPException(409,'الحملة ملغاة بالفعل')
    if row.get('job_id'): await jobs.cancel(row['job_id'],branch_id)
    return {'status':'cancelled'}

@router.post('/{review_id}/retry')
async def retry(review_id:str,branch_id:str,user:dict=Depends(get_current_user)):
    row=await load(review_id,branch_id,user)
    if not user.get('is_admin'): raise HTTPException(403,'صلاحية المدير مطلوبة')
    if row['status']!='queued' or not row.get('job_id'): raise HTTPException(409,'الحملة غير قابلة لإعادة المحاولة')
    job=await jobs.get_job(row['job_id'],branch_id)
    if not job or job.get('pending') or job.get('cancel_requested'): raise HTTPException(409,'انتظر انتهاء الحملة أو أنشئ حملة جديدة بعد الإلغاء')
    changed=await db.whatsapp_campaign_job_items.update_many({'job_id':row['job_id'],'branch_id':branch_id,'status':'failed'},
        {'$set':{'status':'pending','next_attempt_at':datetime.now(timezone.utc)},'$unset':{'error':'','completed_at':'','claim_token':'','claim_until':'','quota_reservation_id':''}})
    await jobs._refresh_job(row['job_id'])
    return {'retried':changed.modified_count}

async def tick(tenant):
    now=datetime.now(timezone.utc)
    # Recover an interrupted enqueue from its authoritative key; never enqueue
    # a second job when the first was persisted with an uncertain outcome.
    stale=await db.whatsapp_reviews.find({'status':'preparing','started_at':{'$lt':now-timedelta(minutes=10)}},{'_id':0}).to_list(100)
    for row in stale:
        job=await jobs.get_job_by_key(row['branch_id'],'review_'+row['id'].replace('-',''))
        await db.whatsapp_reviews.update_one({'id':row['id'],'status':'preparing'},{'$set':{
            'status':'queued' if job else 'pending_review',**({'job_id':job['id']} if job else {})}})
    rows=await db.whatsapp_reviews.find({'status':'scheduled','schedule_at':{'$lte':now}},{'_id':0}).to_list(20)
    for row in rows:
        try: await dispatch(row,{'user_id':row['approved_by'],'is_admin':True})
        except Exception: logging.getLogger(__name__).exception('Reviewed WhatsApp enqueue failed')

async def loop():
    from utils.tenant import for_each_active_tenant, set_current_tenant, reset_current_tenant, slug_to_db_name
    from control_db import control_db
    while True:
        try:
            await for_each_active_tenant(tick,label='whatsapp-reviewed-campaigns')
            if not await control_db.tenants.find_one({'slug':'default'},{'_id':1}):
                token=set_current_tenant({'slug':'default','db_name':slug_to_db_name('default')})
                try:
                    await tick({'slug':'default'})
                    await jobs._tenant_tick({'slug':'default'})
                finally: reset_current_tenant(token)
        except Exception: logging.getLogger(__name__).exception('WhatsApp review schedule tick failed')
        await asyncio.sleep(30)

def start_scheduler():
    return asyncio.create_task(loop())
