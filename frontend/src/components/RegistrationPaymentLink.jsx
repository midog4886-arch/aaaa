import React, { useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';

const states = { pending: 'بانتظار الدفع', paid: 'مدفوع', expired: 'منتهي', cancelled: 'ملغى', review: 'تحتاج مراجعة' };
export default function RegistrationPaymentLink({ request, links, loaded, gatewayReady, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(7);
  const [created, setCreated] = useState(null);
  const requestId = useRef(null);
  const matches = links.filter(l => l.invoice_ids.includes(request.invoice_id));
  const link = matches.find(l => ['pending', 'review', 'paid'].includes(l.state)) || (created && (matches.find(l => l.id === created.id) || created)) || matches[0];
  const canCreate = loaded && request.workflow_stage !== 'registered' && (!link || ['expired', 'cancelled'].includes(link.state));
  const send = async (target) => {
    const { data } = await axios.post(`/api/payment-links/${target.id}/send`, {}, { timeout: 25000 });
    if (data.sent) toast.success('أُرسل رابط الدفع عبر واتساب');
    else toast.error('لم يتأكد الإرسال؛ راجع اتصال واتساب وسجل المحادثة قبل إعادة المحاولة');
  };
  const create = async (sendNow) => {
    setBusy(true);
    requestId.current ||= crypto.randomUUID();
    try {
      const { data } = await axios.post('/api/payment-links', { invoice_ids: [request.invoice_id], valid_days: Number(days), reminders_enabled: false, request_id: requestId.current }, { timeout: 15000 });
      setCreated({ ...data, state: 'pending' });
      requestId.current = null;
      toast.success('تم إنشاء رابط الدفع');
      if (sendNow) await send(data);
    } catch (e) { toast.error(e.response?.data?.detail || 'تعذّر إكمال العملية؛ حدّث حالة الرابط قبل إعادة المحاولة'); }
    finally { await onChanged(); setBusy(false); }
  };
  const action = async (kind) => {
    setBusy(true);
    try {
      if (kind === 'send') await send(link);
      else {
        const { data } = await axios.post(`/api/payment-links/${link.id}/${kind}`, {}, { timeout: 25000 });
        toast.success(kind === 'cancel' ? 'تم إلغاء الرابط' : data.paid ? 'تم تأكيد الدفع' : 'لم يتأكد الدفع بعد');
      }
    } catch (e) { toast.error(e.response?.data?.detail || 'تعذّر إكمال العملية'); }
    finally { await onChanged(); setBusy(false); }
  };
  return <div className="mt-2 rounded border border-violet-200 p-2 text-xs" dir="rtl">
    <p className="font-bold text-violet-800">رابط دفع طلب التسجيل: {link ? states[link.state] : loaded ? 'لم يُنشأ بعد' : 'تعذّر تحميل الحالة'}</p>
    <details className="mt-2"><summary className="cursor-pointer text-violet-700">إنشاء وإرسال رابط الدفع</summary>
      {!gatewayReady && <p className="mt-2 text-amber-700">التحصيل الإلكتروني ينتظر ربط بوابة الدفع.</p>}
      {canCreate && <><label className="mt-2 block">الصلاحية بالأيام <input aria-label="صلاحية رابط طلب التسجيل" type="number" min="1" max="30" value={days} disabled={busy} onChange={e => { setDays(e.target.value); requestId.current = null; setCreated(null); }} className="w-16 rounded border p-1" /></label>
        <div className="mt-2 flex flex-wrap gap-2"><button disabled={busy} onClick={() => create(false)} className="rounded border p-2">إنشاء الرابط فقط</button><button disabled={busy} onClick={() => create(true)} className="rounded bg-violet-700 p-2 text-white">إنشاء وإرسال عبر واتساب</button></div></>}
      {link && <><p className="mt-2">صالح حتى {new Date(link.expires_at).toLocaleString('ar-SA')}</p><div className="mt-2 flex flex-wrap gap-2">
        <a href={link.url} target="_blank" rel="noopener noreferrer" className="rounded border p-2">فتح الرابط</a>
        <button onClick={() => navigator.clipboard.writeText(link.url).then(() => toast.success('تم نسخ الرابط')).catch(() => toast.error('تعذّر النسخ'))} className="rounded border p-2">نسخ الرابط</button>
        {link.state === 'pending' && <button disabled={busy} onClick={() => action('send')} className="rounded border p-2">إرسال عبر واتساب</button>}
        {['pending', 'expired'].includes(link.state) && <button disabled={busy} onClick={() => action('cancel')} className="rounded border p-2 text-red-600">إلغاء الرابط</button>}
        {link.gateway_invoice_id && link.state !== 'paid' && <button disabled={busy} onClick={() => action('verify')} className="rounded border p-2">التحقق من الدفع</button>}
      </div>{(link.sends || []).map(s => <p key={s.id} className="mt-2">{s.actor} · {new Date(s.at).toLocaleString('ar-SA')} · {s.status === 'sent' ? 'أُرسل' : 'الإرسال غير مؤكد'}</p>)}</>}
      <button disabled={busy} onClick={onChanged} className="mt-2 rounded border p-2">تحديث حالة الدفع</button>
    </details>
  </div>;
}
