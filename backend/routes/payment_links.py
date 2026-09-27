"""Capability links for academy invoices; gateway disabled until configured."""
import os
import uuid
import secrets
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from database import db
from routes.common import get_current_user
from utils.auth import resolve_branch_filter, require_branch_scope, require_permission
from utils.tenant import get_current_tenant_slug

router = APIRouter(prefix='/api/payment-links', tags=['Invoice payment links'])
BASE = os.environ.get('PUBLIC_BASE_URL', 'https://adaa-alabtal.com').rstrip('/')


def now():
    return datetime.now(timezone.utc)


def minor_units(value):
    try:
        amount = Decimal(str(value))
    except InvalidOperation:
        raise HTTPException(400, 'مبلغ الفاتورة غير صالح')
    if not amount.is_finite() or amount <= 0:
        raise HTTPException(400, 'مبلغ الفاتورة غير صالح')
    return int((amount * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def gateway_key():
    slug = get_current_tenant_slug()
    suffix = ''.join(c if c.isalnum() else '_' for c in slug.upper())
    return os.environ.get(f'MEMBER_MOYASAR_SECRET_{suffix}', '')


def link_url(link):
    return f"{BASE}/pay/{link['token']}?tenant={get_current_tenant_slug()}"


async def invoices_for(link):
    rows = await db.invoices.find({'id': {'$in': link['invoice_ids']}}, {'_id': 0}).to_list(len(link['invoice_ids']))
    return rows


def link_state(link, invoices):
    if link.get('gateway_creation_started') and not link.get('gateway_invoice_id'):
        return 'review'
    if link.get('settlement_state') in {'processing', 'review'}:
        return 'review'
    if invoices and len(invoices) == len(link['invoice_ids']) and all(i.get('status') == 'paid' for i in invoices):
        return 'paid'
    if link.get('cancelled_at') or len(invoices) != len(link['invoice_ids']) or any(i.get('status') != 'pending' for i in invoices):
        return 'cancelled'
    if datetime.fromisoformat(link['expires_at']) <= now():
        return 'expired'
    if any(minor_units(i['total']) != link['amounts'].get(i['id']) for i in invoices):
        return 'cancelled'
    return 'pending'


class CreateLink(BaseModel):
    invoice_ids: list[str] = Field(min_length=1, max_length=20)
    valid_days: int = Field(default=7, ge=1, le=30)
    reminders_enabled: bool = False
    request_id: uuid.UUID


@router.post('')
async def create_link(payload: CreateLink, user: dict = Depends(get_current_user)):
    await require_permission(user, 'invoices')
    ids = list(dict.fromkeys(payload.invoice_ids))
    scope = require_branch_scope(user)
    rows = await db.invoices.find({'id': {'$in': ids}}, {'_id': 0}).to_list(len(ids))
    if len(rows) != len(ids) or any(scope and i.get('branch_id') != scope for i in rows):
        raise HTTPException(404, 'الفواتير غير متاحة')
    from services.registration_followups import normalize_phone
    phones = {normalize_phone(i.get('customer_phone')) for i in rows}
    if len({i.get('branch_id') for i in rows}) != 1 or (len(ids) > 1 and (len(phones) != 1 or '' in phones)):
        raise HTTPException(400, 'رابط الأسرة يتطلب نفس رقم الجوال والفرع')
    if any(i.get('status') != 'pending' or any(item.get('is_product') for item in i.get('items', [])) for i in rows):
        raise HTTPException(400, 'اختر فواتير اشتراك معلقة فقط')
    identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f"paylink:{user.get('user_id') or user.get('id')}:{payload.request_id}"))
    existing = await db.payment_links.find_one({'_id': identity}, {'_id': 0})
    if existing:
        return {**existing, 'url': link_url(existing)}
    other_links = await db.payment_links.find({'invoice_ids': {'$in': ids}}, {'_id': 0}).to_list(None)
    for other in other_links:
        if link_state(other, await invoices_for(other)) in {'pending', 'review'}:
            raise HTTPException(409, 'توجد فاتورة ضمن رابط فعال؛ استخدم الرابط الحالي أو ألغِه أولًا')
    link = {'id': identity, 'token': secrets.token_urlsafe(32), 'invoice_ids': ids,
            'amounts': {i['id']: minor_units(i['total']) for i in rows},
            'branch_id': rows[0].get('branch_id'), 'phone': rows[0].get('customer_phone'),
            'created_at': now().isoformat(), 'expires_at': (now() + timedelta(days=payload.valid_days)).isoformat(),
            'created_by': user.get('name') or user.get('username') or 'موظف',
            'reminders_enabled': payload.reminders_enabled, 'sends': []}
    await db.payment_links.update_one({'_id': identity}, {'$setOnInsert': link}, upsert=True)
    saved = await db.payment_links.find_one({'_id': identity}, {'_id': 0})
    return {**saved, 'url': link_url(saved)}


@router.get('')
async def list_links(branch_filter: str = None, user: dict = Depends(get_current_user)):
    await require_permission(user, 'invoices')
    branch = resolve_branch_filter(user, branch_filter)
    rows = await db.payment_links.find({'branch_id': branch} if branch else {}, {'_id': 0}).sort('created_at', -1).to_list(200)
    for row in rows:
        row['state'] = link_state(row, await invoices_for(row))
        row['url'] = link_url(row)
        row['total'] = sum(row['amounts'].values()) / 100
        row.pop('callback_token', None)
    return {'links': rows, 'gateway_ready': bool(gateway_key())}


async def scoped_link(link_id, user):
    await require_permission(user, 'invoices')
    link = await db.payment_links.find_one({'id': link_id}, {'_id': 0})
    scope = require_branch_scope(user)
    if not link or (scope and link['branch_id'] != scope):
        raise HTTPException(404, 'الرابط غير متاح')
    return link


async def send_link(link, actor, automated=False):
    if link_state(link, await invoices_for(link)) != 'pending':
        raise HTTPException(409, 'الرابط لم يعد ينتظر الدفع')
    previous = link.get('last_send_attempt_at')
    if previous and (now() - datetime.fromisoformat(previous)).total_seconds() < 60:
        raise HTTPException(429, 'انتظر دقيقة وراجع سجل الإرسال قبل إعادة المحاولة')
    claim = await db.payment_links.update_one({'id': link['id'], 'last_send_attempt_at': previous}, {'$set': {'last_send_attempt_at': now().isoformat()}})
    if not claim.modified_count:
        raise HTTPException(409, 'بدأ موظف آخر إرسال الرابط؛ حدّث السجل')
    from routes.whatsapp import _send_wa_message_for_branch
    message = f"أكاديمية أداء الأبطال — رابط فاتورة الاشتراك\nالمبلغ: {sum(link['amounts'].values()) / 100:.2f} ر.س\n{link_url(link)}\nصالح حتى: {link['expires_at'][:10]}"
    event = {'id': str(uuid.uuid4()), 'at': now().isoformat(), 'actor': actor, 'status': 'attempted'}
    # Record before transport; an uncertain send must never be silently repeated.
    await db.payment_links.update_one({'id': link['id']}, {'$push': {'sends': event}})
    try:
        sent = await _send_wa_message_for_branch(link['phone'], message, link['branch_id'], automated=automated)
    except Exception:
        sent = False
    await db.payment_links.update_one({'id': link['id'], 'sends.id': event['id']}, {'$set': {'sends.$.status': 'sent' if sent else 'unconfirmed'}})
    return {'sent': bool(sent), 'message': message}


@router.post('/{link_id}/send')
async def send_payment_link(link_id: str, user: dict = Depends(get_current_user)):
    return await send_link(await scoped_link(link_id, user), user.get('name') or user.get('username') or 'موظف')


async def gateway_request(method, path, **kwargs):
    key = gateway_key()
    if not key:
        raise HTTPException(503, 'الدفع الإلكتروني غير مفعّل بعد')
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            response = await client.request(method, f'https://api.moyasar.com/v1/invoices{path}', auth=(key, ''), **kwargs)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(502, 'تعذّر تأكيد العملية من بوابة الدفع. لم يتم تسجيل الدفع')


@router.post('/{link_id}/cancel')
async def cancel_link(link_id: str, user: dict = Depends(get_current_user)):
    link = await scoped_link(link_id, user)
    if link.get('gateway_creation_started') and not link.get('gateway_invoice_id'):
        raise HTTPException(409, 'نتيجة إنشاء العملية غير مؤكدة؛ يلزم مراجعة البوابة قبل إلغاء الحجز')
    if link.get('settlement_state') in {'processing', 'review', 'done'}:
        raise HTTPException(409, 'الدفع مؤكد أو قيد المراجعة؛ لا يمكن إلغاء الحجز')
    if link.get('gateway_invoice_id'):
        record = await gateway_request('GET', '/' + link['gateway_invoice_id'])
        if record.get('status') == 'paid':
            raise HTTPException(409, 'تم الدفع لدى البوابة؛ تحقق من الدفع أولًا')
        if record.get('status') == 'initiated':
            await gateway_request('PUT', '/' + link['gateway_invoice_id'] + '/cancel')
    cancel_query = {'id': link_id}
    if not link.get('gateway_invoice_id'):
        cancel_query['checkout_claimed'] = {'$ne': True}
    cancelled = await db.payment_links.update_one(cancel_query, {'$set': {'cancelled_at': now().isoformat()}})
    if not cancelled.matched_count:
        raise HTTPException(409, 'بدأ تجهيز الدفع؛ تحقق من العملية قبل الإلغاء')
    await db.invoices.update_many({'online_payment_link_id': link_id, 'status': 'pending'}, {'$unset': {'online_payment_link_id': ''}})
    return {'success': True}


async def public_link(token):
    link = await db.payment_links.find_one({'token': token}, {'_id': 0})
    if not link:
        raise HTTPException(404, 'رابط الدفع غير موجود')
    return link


@router.get('/public/{token}')
async def get_public_link(token: str):
    link = await public_link(token)
    rows = await invoices_for(link)
    settings = await db.settings.find_one({}, {'_id': 0}) or {}
    return {'state': link_state(link, rows), 'academy_name': settings.get('academy_name') or settings.get('company_name') or 'أكاديمية أداء الأبطال',
            'logo': '/logo-new.png', 'total': sum(link['amounts'].values()) / 100, 'expires_at': link['expires_at'],
            'gateway_ready': bool(gateway_key()), 'invoices': [
                {'number': i.get('invoice_number'), 'name': i.get('customer_name_ar') or i.get('customer_name'), 'total': link['amounts'][i['id']] / 100,
                 'status': i.get('status'), 'paid_at': i.get('paid_at'),
                 'items': [{'activity': item.get('activity_name'), 'period': item.get('period'), 'start': item.get('start_date'), 'end': item.get('end_date')} for item in i.get('items', [])]}
                for i in rows]}


@router.post('/public/{token}/checkout')
async def checkout(token: str):
    link = await public_link(token)
    rows = await invoices_for(link)
    if link_state(link, rows) != 'pending':
        raise HTTPException(409, 'الرابط غير متاح للدفع')
    if not gateway_key():
        raise HTTPException(503, 'الدفع الإلكتروني غير مفعّل بعد')
    if link.get('gateway_url'):
        return {'url': link['gateway_url']}
    lock = await db.payment_links.update_one({'id': link['id'], 'checkout_claimed': {'$ne': True}, 'cancelled_at': {'$exists': False}}, {'$set': {'checkout_claimed': True}})
    if not lock.modified_count:
        raise HTTPException(409, 'جارٍ تجهيز العملية أو تحتاج مراجعة الإدارة؛ لا تُعد المحاولة')
    # Reserve each invoice across overlapping family links before creating a charge.
    for invoice in rows:
        reserved = await db.invoices.update_one({'id': invoice['id'], 'status': 'pending', 'total': invoice['total'], 'online_payment_link_id': None}, {'$set': {'online_payment_link_id': link['id']}})
        if not reserved.modified_count:
            await db.invoices.update_many({'online_payment_link_id': link['id']}, {'$unset': {'online_payment_link_id': ''}})
            await db.payment_links.update_one({'id': link['id']}, {'$set': {'checkout_claimed': False}})
            raise HTTPException(409, 'توجد عملية دفع أخرى لهذه الفاتورة؛ راجع الإدارة')
    callback = secrets.token_urlsafe(32)
    await db.payment_links.update_one({'id': link['id']}, {'$set': {'callback_token': callback, 'gateway_creation_started': True}})
    record = await gateway_request('POST', '', json={'amount': sum(link['amounts'].values()), 'currency': 'SAR',
        'description': 'اشتراك أكاديمية أداء الأبطال', 'expired_at': link['expires_at'],
        'metadata': {'academy_link_id': link['id']}, 'success_url': link_url(link), 'back_url': link_url(link),
        'callback_url': f"{BASE}/api/payment-links/callback/{get_current_tenant_slug()}/{callback}"})
    if record.get('amount') != sum(link['amounts'].values()) or record.get('currency') != 'SAR' or not record.get('id'):
        raise HTTPException(502, 'بيانات العملية غير مطابقة؛ راجع الإدارة')
    parsed = urlparse(record.get('url', ''))
    if parsed.scheme != 'https' or parsed.hostname not in {'checkout.moyasar.com', 'api.moyasar.com'}:
        raise HTTPException(502, 'عنوان بوابة الدفع غير صالح')
    await db.payment_links.update_one({'id': link['id']}, {'$set': {'gateway_invoice_id': record['id'], 'gateway_url': record['url']}})
    return {'url': record['url']}


async def verify_link(link):
    if not link.get('gateway_invoice_id'):
        return {'paid': False}
    if link.get('settlement_state') == 'done':
        return {'paid': True}
    record = await gateway_request('GET', '/' + link['gateway_invoice_id'])
    if record.get('status') != 'paid':
        return {'paid': False}
    if (record.get('id') != link['gateway_invoice_id'] or record.get('amount') != sum(link['amounts'].values()) or record.get('currency') != 'SAR' or (record.get('metadata') or {}).get('academy_link_id') != link['id']):
        raise HTTPException(409, 'فشل التحقق من مبلغ ومرجع الدفع')
    rows = await invoices_for(link)
    if len(rows) != len(link['invoice_ids']) or any(minor_units(i['total']) != link['amounts'][i['id']] or i.get('status') not in {'pending', 'paid'} for i in rows):
        await db.payment_links.update_one({'id': link['id']}, {'$set': {'settlement_state': 'review'}})
        raise HTTPException(409, 'تغيّرت الفاتورة؛ الدفعة تحتاج مراجعة الإدارة')
    claim = await db.payment_links.update_one({'id': link['id'], 'settlement_state': None}, {'$set': {'settlement_state': 'processing'}})
    if not claim.modified_count:
        return {'paid': link.get('settlement_state') == 'done', 'state': 'review' if link.get('settlement_state') != 'done' else 'paid'}
    try:
        from routes.invoices import pay_invoice
        for invoice in rows:
            if invoice.get('status') == 'paid':
                continue
            await pay_invoice(invoice['id'], {'is_admin': True, 'name': 'بوابة الدفع الموثقة', '_verified_gateway_link': link['id']})
            await db.invoices.update_one({'id': invoice['id']}, {'$set': {'payment_method': 'card', 'gateway_invoice_id': record['id'], 'online_payment_confirmed_at': now().isoformat()}})
        await db.payment_links.update_one({'id': link['id']}, {'$set': {'settlement_state': 'done', 'paid_at': now().isoformat()}})
    except Exception:
        await db.payment_links.update_one({'id': link['id']}, {'$set': {'settlement_state': 'review'}})
        raise HTTPException(409, 'تم استلام تأكيد البوابة وتحتاج الفاتورة مراجعة الإدارة')
    return {'paid': True}


@router.post('/public/{token}/verify')
async def verify_public(token: str):
    return await verify_link(await public_link(token))


@router.post('/{link_id}/verify')
async def verify_staff(link_id: str, user: dict = Depends(get_current_user)):
    return await verify_link(await scoped_link(link_id, user))


@router.post('/callback/{tenant_slug}/{callback_token}')
async def callback(tenant_slug: str, callback_token: str):
    from control_db import get_tenant_by_slug
    from utils.tenant import set_current_tenant, reset_current_tenant, slug_to_db_name
    tenant = await get_tenant_by_slug(tenant_slug)
    if not tenant and tenant_slug == 'default':
        tenant = {'slug': 'default', 'db_name': slug_to_db_name('default')}
    if not tenant or tenant.get('status', 'active') != 'active':
        raise HTTPException(404, 'غير متاح')
    context = set_current_tenant(tenant)
    try:
        link = await db.payment_links.find_one({'callback_token': callback_token}, {'_id': 0})
        if not link:
            raise HTTPException(404, 'غير متاح')
        # Callback body and redirect query parameters are never trusted as proof.
        return await verify_link(link)
    finally:
        reset_current_tenant(context)


async def payment_link_reminders():
    if not gateway_key():
        return
    rows = await db.payment_links.find({'reminders_enabled': True, 'cancelled_at': {'$exists': False}}, {'_id': 0}).to_list(None)
    for link in rows:
        if link_state(link, await invoices_for(link)) != 'pending':
            continue
        days = (now() - datetime.fromisoformat(link['created_at'])).days
        stage = '3' if days >= 3 else '1' if days >= 1 else None
        if not stage or stage in link.get('reminder_attempts', []):
            continue
        claim = await db.payment_links.update_one({'id': link['id'], 'reminder_attempts': {'$ne': stage}}, {'$addToSet': {'reminder_attempts': stage}})
        if claim.modified_count:
            await send_link(link, 'تذكير آلي', automated=True)
