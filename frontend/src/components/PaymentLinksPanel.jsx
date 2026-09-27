import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
const states = { pending: 'بانتظار الدفع', paid: 'مدفوع', expired: 'منتهي', cancelled: 'ملغى', review: 'تحتاج مراجعة' };
export default function PaymentLinksPanel({ invoices, branchId }) {
  const [selected, setSelected] = useState([]);
  const [days, setDays] = useState(7);
  const [reminders, setReminders] = useState(false);
  const [links, setLinks] = useState([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(null);
  const load = async () => { try { const { data } = await axios.get('/api/payment-links', { params: branchId && branchId !== 'all' ? { branch_filter: branchId } : {}, timeout: 15000 }); setLinks(data.links); setReady(data.gateway_ready); } catch { toast.error('تعذّر تحميل روابط الدفع'); } };
  useEffect(() => { setSelected([]); load(); /* eslint-disable-next-line */ }, [branchId]);
  const create = async () => {
    setBusy(true);
    const id = requestId || crypto.randomUUID(); setRequestId(id);
    try { await axios.post('/api/payment-links', { invoice_ids: selected, valid_days: Number(days), reminders_enabled: reminders, request_id: id }, { timeout: 15000 }); setSelected([]); setRequestId(null); await load(); toast.success('تم إنشاء رابط الفاتورة'); }
    catch (e) { toast.error(e.response?.data?.detail || 'تعذّر إنشاء الرابط'); } finally { setBusy(false); }
  };
  const action = async (link, kind) => {
    setBusy(true);
    try { const { data } = await axios.post(`/api/payment-links/${link.id}/${kind}`, {}, { timeout: 25000 }); toast.success(kind === 'cancel' ? 'تم إلغاء الرابط' : kind === 'verify' ? (data.paid ? 'تم تأكيد الدفع' : 'لم يتأكد الدفع بعد؛ راجع حالة الرابط') : data.sent ? 'أُرسل الرابط عبر واتساب' : 'لم يتأكد الإرسال؛ راجع اتصال واتساب وسجل المحادثة قبل إعادة المحاولة'); await load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'تعذّر إكمال العملية'); } finally { setBusy(false); }
  };
  return <details className="rounded-xl border bg-white p-4" dir="rtl"><summary className="cursor-pointer text-lg font-bold text-violet-800">روابط دفع الاشتراكات والأسرة</summary>
    <p className="mt-3 rounded bg-amber-50 p-3 text-sm">{ready ? 'بوابة الدفع موصولة. الدفع يُؤكد من الخادم بعد التحقق.' : 'جاهز لإنشاء روابط الفواتير. الدفع الإلكتروني والتذكيرات الآلية ينتظران ربط بوابة الدفع.'}</p>
    <div className="mt-3 max-h-48 overflow-auto space-y-2">{invoices.filter(i => i.status === 'pending' && !(i.items || []).some(item => item.is_product)).map(i => <label key={i.id} className="block rounded border p-2 text-sm"><input type="checkbox" disabled={busy} checked={selected.includes(i.id)} onChange={e => { setSelected(s => e.target.checked ? [...s, i.id] : s.filter(id => id !== i.id)); setRequestId(null); }} /> {i.customer_name_ar || i.customer_name} · فاتورة {i.invoice_number} · {Number(i.total).toFixed(2)} ر.س</label>)}</div>
    <p className="mt-2 text-xs text-gray-500">اختر فاتورة واحدة، أو عدة فواتير للأسرة بنفس رقم الجوال والفرع.</p>
    <div className="mt-3 flex flex-wrap gap-3 items-center"><label>الصلاحية بالأيام <input aria-label="صلاحية رابط الدفع" type="number" min="1" max="30" disabled={busy} value={days} onChange={e => { setDays(e.target.value); setRequestId(null); }} className="w-16 rounded border p-2" /></label><label><input type="checkbox" disabled={busy || !ready} checked={reminders} onChange={e => { setReminders(e.target.checked); setRequestId(null); }} /> تذكيران بعد يوم وثلاثة أيام</label><button disabled={busy || !selected.length} onClick={create} className="rounded bg-violet-800 p-2 text-white">إنشاء رابط دفع</button><button disabled={busy} onClick={load} className="rounded border p-2">تحديث الروابط</button></div>
    <div className="mt-4 space-y-3">{links.map(link => <section key={link.id} className="rounded border p-3 text-sm"><p className="font-bold">{states[link.state]} · {link.total.toFixed(2)} ر.س · {link.invoice_ids.length} فاتورة</p><p>صالح حتى {new Date(link.expires_at).toLocaleString('ar-SA')}</p><div className="mt-2 flex flex-wrap gap-2"><a href={link.url} target="_blank" rel="noopener noreferrer" className="rounded border p-2">فتح الرابط</a><button onClick={() => navigator.clipboard.writeText(link.url).then(() => toast.success('تم نسخ الرابط')).catch(() => toast.error('تعذّر النسخ'))} className="rounded border p-2">نسخ الرابط</button>{link.state === 'pending' && <><button disabled={busy} onClick={() => action(link, 'send')} className="rounded border p-2">إرسال عبر واتساب</button><button disabled={busy} onClick={() => action(link, 'cancel')} className="rounded border p-2 text-red-600">إلغاء الرابط</button></>}</div>
      {link.gateway_invoice_id && link.state !== 'paid' && <button disabled={busy} onClick={() => action(link, 'verify')} className="mt-2 rounded border p-2">التحقق من الدفع</button>}{link.state === 'expired' && <button disabled={busy} onClick={() => action(link, 'cancel')} className="mt-2 rounded border p-2">إلغاء الرابط المنتهي</button>}<details className="mt-2"><summary>رسالة واتساب وسجل الإرسال</summary><p className="mt-2 whitespace-pre-wrap">فاتورة اشتراك الأكاديمية · المبلغ {link.total.toFixed(2)} ر.س{`\n${link.url}`}</p>{(link.sends || []).map(e => <p key={e.id} className="mt-2">{e.actor} · {new Date(e.at).toLocaleString('ar-SA')} · {e.status === 'sent' ? 'أُرسل' : 'الإرسال غير مؤكد'}</p>)}</details>
    </section>)}</div>
  </details>;
}
