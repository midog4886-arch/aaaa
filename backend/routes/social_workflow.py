"""Persisted editorial queue, reviewed scheduling and tenant-scoped media library."""
import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.requests import Request as BackgroundRequest
from .common import db
from .social_publisher import _require_social_publisher, PublishRequest, publish_post, SOCIAL_UPLOAD_DIR, PLATFORMS
from utils.auth import resolve_branch_filter
from utils.tenant import for_each_active_tenant

router = APIRouter(prefix='/social/workflow', tags=['Social editorial workflow'])
logger = logging.getLogger(__name__)
def now(): return datetime.now(timezone.utc).isoformat()
def scope(user, branch=None):
    branch = resolve_branch_filter(user, branch)
    return {'branch_id': branch} if branch else {}
async def get_plan(plan_id,user):
    row=await db.social_plans.find_one({'id':plan_id,**scope(user)},{'_id':0})
    if not row: raise HTTPException(404,'المسودة غير موجودة في الفرع المتاح')
    return row
class Plan(BaseModel):
    revision: int = Field(default=0,ge=0)
    title: str = Field(min_length=1,max_length=150)
    branch_id: Optional[str] = None
    payload: PublishRequest
    schedule_at: Optional[datetime] = None
    category: str = Field(default='',max_length=100)
class Review(BaseModel):
    approve: bool
    note: str = Field(default='',max_length=2000)
class MediaUpdate(BaseModel):
    category: str = Field(default='',max_length=100)
    activity: str = Field(default='',max_length=100)
    tournament: str = Field(default='',max_length=150)
    allowed_to_publish: bool = False
    branch_id: Optional[str] = None
    consent_note: str = Field(default='',max_length=2000)

def schedule_text(value):
    if value is None: return None
    if value.tzinfo is None: raise HTTPException(400,'موعد الجدولة يجب أن يتضمن المنطقة الزمنية')
    if value <= datetime.now(timezone.utc): raise HTTPException(400,'اختر موعدًا مستقبليًا')
    return value.astimezone(timezone.utc).isoformat()

def validate_targets(payload):
    targets=payload.targets
    if any(target.platform not in PLATFORMS for target in targets): raise HTTPException(400,'منصة غير مدعومة')
    if len({target.platform for target in targets})!=len(targets): raise HTTPException(400,'منصة مكررة')

async def usable_media(filename,user):
    row=await db.social_media.find_one({'filename':filename,**scope(user)},{'_id':0})
    if not row or not row.get('allowed_to_publish'): raise HTTPException(400,'الوسيط غير معتمد للنشر في هذا الفرع')
    if os.path.basename(filename)!=filename or not (SOCIAL_UPLOAD_DIR/filename).is_file(): raise HTTPException(400,'ملف الوسيط غير موجود')
    return row

@router.get('/plans')
async def list_plans(branch_filter:Optional[str]=None,user=Depends(_require_social_publisher)):
    return await db.social_plans.find(scope(user,branch_filter),{'_id':0}).sort('updated_at',-1).to_list(200)

@router.post('/plans')
async def create_plan(payload:Plan,user=Depends(_require_social_publisher)):
    branch=resolve_branch_filter(user,payload.branch_id)
    data=payload.model_dump(mode='json'); data.update(id=str(uuid.uuid4()),branch_id=branch,status='draft',revision=1,created_by=user.get('user_id') or user.get('id'),updated_at=now(),results={})
    data['schedule_at']=schedule_text(payload.schedule_at)
    validate_targets(payload.payload)
    await usable_media(payload.payload.media_filename,{**user,'_active_branch':branch})
    await db.social_plans.insert_one(data)
    return {k:v for k,v in data.items() if k!='_id'}

@router.put('/plans/{plan_id}')
async def edit_plan(plan_id:str,payload:Plan,user=Depends(_require_social_publisher)):
    row=await get_plan(plan_id,user)
    if row['status'] not in ('draft','pending_review','approved','scheduled'): raise HTTPException(409,'لا يمكن تعديل منشور بدأ نشره')
    await usable_media(payload.payload.media_filename,user)
    validate_targets(payload.payload)
    data=payload.model_dump(mode='json');data.update(branch_id=row.get('branch_id'),revision=payload.revision+1,status='draft',approved_by=None,updated_at=now(),results={})
    data['schedule_at']=schedule_text(payload.schedule_at)
    result=await db.social_plans.update_one({'id':plan_id,'revision':payload.revision,'status':row['status']},{'$set':data})
    if not result.modified_count: raise HTTPException(409,'تغيرت المسودة؛ أعد التحميل')
    return {**row,**data}

@router.post('/plans/{plan_id}/submit')
async def submit(plan_id:str,user=Depends(_require_social_publisher)):
    row=await get_plan(plan_id,user)
    if not row['payload']['targets']: raise HTTPException(400,'اختر منصة واحدة على الأقل')
    await usable_media(row['payload']['media_filename'],user)
    result=await db.social_plans.update_one({'id':plan_id,'status':'draft','revision':row['revision']},{'$set':{'status':'pending_review','updated_at':now()},'$inc':{'revision':1}})
    if not result.modified_count: raise HTTPException(409,'المسودة ليست جاهزة للإرسال للمراجعة')
    return {'success':True}

@router.post('/plans/{plan_id}/review')
async def review(plan_id:str,payload:Review,request:Request,user=Depends(_require_social_publisher)):
    if not user.get('is_admin'): raise HTTPException(403,'اعتماد المنشورات للمسؤول فقط')
    row=await get_plan(plan_id,user)
    await usable_media(row['payload']['media_filename'],user)
    base=os.environ.get('PUBLIC_BASE_URL') or os.environ.get('APP_BASE_URL') or str(request.base_url).rstrip('/')
    if payload.approve and not base.startswith('https://'): raise HTTPException(400,'اضبط عنوان الموقع العام HTTPS قبل جدولة النشر')
    update={'status':('scheduled' if row.get('schedule_at') else 'approved') if payload.approve else 'draft','review_note':payload.note,'approved_by':(user.get('user_id') or user.get('id')) if payload.approve else None,'public_base_url':base,'updated_at':now()}
    result=await db.social_plans.update_one({'id':plan_id,'status':'pending_review','revision':row['revision']},{'$set':update,'$inc':{'revision':1}})
    if not result.modified_count: raise HTTPException(409,'المنشور ليس بانتظار المراجعة أو تغير أثناء المراجعة')
    return {'success':True}

@router.post('/plans/{plan_id}/publish')
async def publish_now(plan_id:str,user=Depends(_require_social_publisher)):
    row=await get_plan(plan_id,user)
    if row['status']!='approved': raise HTTPException(409,'اعتمد المنشور أولًا؛ المنشور المجدول يُنشر في موعده')
    await dispatch(row)
    return await get_plan(plan_id,user)

@router.post('/plans/{plan_id}/retry')
async def retry(plan_id:str,user=Depends(_require_social_publisher)):
    row=await get_plan(plan_id,user)
    if row['status'] not in ('failed','partial'): raise HTTPException(409,'لا توجد نتائج فاشلة قابلة لإعادة المحاولة')
    results={key:({'status':'pending'} if value.get('status')=='failed' else value) for key,value in row.get('results',{}).items()}
    result=await db.social_plans.update_one({'id':plan_id,'status':row['status'],'revision':row['revision']},{'$set':{'results':results,'status':'scheduled','schedule_at':now(),'updated_at':now()},'$inc':{'revision':1}})
    if not result.modified_count: raise HTTPException(409,'تغير المنشور؛ أعد التحميل')
    return {'success':True}

@router.post('/plans/{plan_id}/cancel')
async def cancel(plan_id:str,user=Depends(_require_social_publisher)):
    row=await get_plan(plan_id,user)
    result=await db.social_plans.update_one({'id':plan_id,'status':{'$in':['draft','pending_review','approved','scheduled']}},{'$set':{'status':'cancelled','updated_at':now()},'$inc':{'revision':1}})
    if not result.modified_count: raise HTTPException(409,'بدأ النشر أو انتهى ولا يمكن إلغاؤه')
    return {'success':True}

@router.get('/media')
async def list_media(branch_filter:Optional[str]=None,user=Depends(_require_social_publisher)):
    return await db.social_media.find(scope(user,branch_filter),{'_id':0}).sort('created_at',-1).to_list(500)

@router.put('/media/{filename}')
async def update_media(filename:str,payload:MediaUpdate,user=Depends(_require_social_publisher)):
    row=await db.social_media.find_one({'filename':filename,**scope(user)},{'_id':0})
    if not row: raise HTTPException(404,'الوسيط غير موجود')
    data=payload.model_dump();data['branch_id']=row.get('branch_id');data['updated_by']=user.get('user_id') or user.get('id')
    await db.social_media.update_one({'filename':filename,**scope(user)},{'$set':data})
    return {**row,**data}

async def dispatch(row):
    claim=await db.social_plans.update_one({'id':row['id'],'status':{'$in':['approved','scheduled']},'revision':row['revision']},{'$set':{'status':'publishing','started_at':now()}})
    if not claim.modified_count: return
    results=dict(row.get('results') or {})
    payload=row['payload'];base=row['public_base_url'].rstrip('/')
    request=BackgroundRequest({'type':'http','method':'POST','path':'/api/social/posts','headers':[(b'host',base.split('://',1)[1].encode())],'scheme':'https','server':(base.split('://',1)[1],443),'query_string':b''})
    try:
        media=await db.social_media.find_one({'filename':payload['media_filename'],'allowed_to_publish':True},{'_id':0})
        if not media: raise RuntimeError('تم سحب السماح بنشر الوسيط')
        for target in payload['targets']:
            platform=target['platform']
            if results.get(platform,{}).get('status')=='success': continue
            results[platform]={'status':'publishing','attempted_at':now()}
            await db.social_plans.update_one({'id':row['id']},{'$set':{'results':results}})
            try:
                response=await publish_post(PublishRequest(**{**payload,'targets':[target]}),request,{'user_id':row['created_by'],'_approved_plan':True})
                results[platform]={**response['results'][0],'post_id':response['post_id']}
            except Exception:
                logger.exception('Social queue publication failed')
                results[platform]={'status':'failed','error_message':'تعذر النشر؛ راجع الاتصال والحساب وملف الوسيط قبل إعادة المحاولة'}
            await db.social_plans.update_one({'id':row['id']},{'$set':{'results':results}})
        successes=sum(r.get('status')=='success' for r in results.values())
        status='done' if successes==len(payload['targets']) else 'partial' if successes else 'failed'
        await db.social_plans.update_one({'id':row['id']},{'$set':{'status':status,'results':results,'updated_at':now()}})
    except Exception as error:
        await db.social_plans.update_one({'id':row['id']},{'$set':{'status':'failed','error':str(error),'updated_at':now()}})

async def tick(tenant):
    # A process interrupted during publication must not silently send duplicates.
    await db.social_plans.update_many({'status':'publishing','started_at':{'$lt':(datetime.now(timezone.utc)-timedelta(minutes=30)).isoformat()}},{'$set':{'status':'unknown','error':'انقطع النشر؛ تحقق من المنصات قبل أي إعادة إرسال'}})
    rows=await db.social_plans.find({'status':'scheduled','schedule_at':{'$lte':now()}},{'_id':0}).to_list(20)
    for row in rows: await dispatch(row)
async def loop():
    while True:
        try:
            await for_each_active_tenant(tick,label='social_editorial_queue')
            # Legacy default academies may predate a control-plane tenant record.
            from control_db import control_db
            from utils.tenant import set_current_tenant, reset_current_tenant, slug_to_db_name
            if not await control_db.tenants.find_one({'slug':'default'},{'_id':0,'slug':1}):
                token=set_current_tenant({'slug':'default','db_name':slug_to_db_name('default')})
                try: await tick({'slug':'default'})
                finally: reset_current_tenant(token)
        except Exception: logger.exception('Social queue tick failed')
        await asyncio.sleep(30)
def start_scheduler():
    return asyncio.create_task(loop())
