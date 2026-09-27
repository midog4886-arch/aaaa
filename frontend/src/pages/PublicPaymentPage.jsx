import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
const states = { pending: 'بانتظار الدفع', paid: 'مدفوع', expired: 'الرابط منتهي', cancelled: 'الرابط ملغى', review: 'العملية تحتاج مراجعة الإدارة' };

export default function PublicPaymentPage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const tenant = params.get('tenant') || 'default';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = async (path = '', method = 'GET') => {
    const response = await fetch(`/api/payment-links/public/${encodeURIComponent(token)}${path}`, { method, credentials: 'omit', headers: { 'X-Tenant-Slug': tenant }, cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || 'تعذّر تحميل الفاتورة');
    return body;
  };
  const load = async () => { try { setData(await request()); setError(''); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, tenant]);
  const verify = async () => { setBusy(true); try { await request('/verify', 'POST'); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  useEffect(() => {
    if (!data?.gateway_ready || data.state !== 'pending') return;
    verify(); /* eslint-disable-next-line */
  }, [data?.gateway_ready, token]);
  const pay = async () => {
    setBusy(true); setError('');
    try { const result = await request('/checkout', 'POST'); window.location.assign(result.url); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  return <main dir="rtl" className="min-h-screen bg-slate-50 px-4 py-10"><div className="mx-auto max-w-xl space-y-5 rounded-2xl bg-white p-6 shadow-sm">
    <header className="text-center"><img src={data?.logo || '/logo-new.png'} alt="شعار الأكاديمية" className="mx-auto h-28 w-28 object-contain" /><h1 className="mt-3 text-2xl font-bold">{data?.academy_name || 'فاتورة الاشتراك'}</h1><p className="mt-2 text-slate-500">صفحة دفع الاشتراك</p></header>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
    {!data && !error && <p>جارٍ تحميل الفاتورة…</p>}
    {data && <><p className="rounded bg-violet-50 p-3 text-center font-bold text-violet-800">{states[data.state]}</p>
      {data.invoices.map((invoice, index) => <section key={index} className="rounded-xl border p-4"><h2 className="font-bold">{invoice.name}</h2><p className="text-sm text-gray-500">فاتورة رقم {invoice.number}</p>
        {invoice.items.map((item, n) => <div key={n} className="mt-3 text-sm"><p>{item.activity} · {item.period}</p><p>من {item.start || '—'} إلى {item.end || '—'}</p></div>)}
        <p className="mt-3 font-bold">{invoice.total.toFixed(2)} ر.س</p>
        {invoice.status === 'paid' && <p className="mt-2 text-sm text-green-700">إيصال دفع · {invoice.paid_at ? new Date(invoice.paid_at).toLocaleString('ar-SA') : 'تم تأكيد الدفع'}</p>}
      </section>)}
      <p className="text-center text-2xl font-bold">الإجمالي: {data.total.toFixed(2)} ر.س</p>
      <p className="text-center text-sm text-gray-500">صلاحية الرابط حتى {new Date(data.expires_at).toLocaleString('ar-SA')}</p>
      {data.state === 'pending' && <>{data.gateway_ready ? <><p className="text-center text-sm">وسائل الدفع المتاحة حسب حساب الأكاديمية: مدى، Apple Pay والبطاقات.</p><button disabled={busy} onClick={pay} className="w-full rounded-xl bg-violet-800 p-3 text-white">{busy ? 'جارٍ التحقق…' : 'الانتقال للدفع الآمن'}</button><button disabled={busy} onClick={verify} className="w-full rounded border p-2">التحقق من حالة الدفع</button></> : <p className="rounded bg-amber-50 p-4 text-amber-800">الدفع الإلكتروني غير مفعّل بعد. يمكنك مراجعة الفاتورة والتواصل مع الأكاديمية لاستكمال الدفع.</p>}</>}
      {data.state === 'paid' && <button onClick={() => window.print()} className="w-full rounded border p-3">طباعة الإيصالات</button>}
      <p className="text-center text-xs text-gray-500">يُسجل الدفع بعد تأكيد البوابة. فتح الرابط أو العودة من صفحة الدفع لا يؤكد السداد.</p>
    </>}
  </div></main>;
}
