import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

export default function PublicConsentPage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const tenant = params.get('tenant') || 'default';
  const canvas = useRef(null);
  const drawing = useRef(false);
  const ink = useRef(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [logo, setLogo] = useState('/images/academy-logo.png');
  const [form, setForm] = useState({ child_name: '', birth_date: '', guardian_name: '', relationship: '', guardian_identity: '', emergency_phone: '', has_medical_condition: false, medical_details: '', signer_name: '', accepted: false });
  const request = async (method = 'GET', payload) => {
    const response = await fetch(`/api/invoices/public/registration-consent/${encodeURIComponent(token)}`, {
      method, credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': tenant },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'تعذر فتح الاستمارة');
    return result;
  };
  useEffect(() => {
    let active = true;
    fetch('/api/tenant/branding', { headers: { 'X-Tenant-Slug': tenant }, credentials: 'omit' })
      .then(response => response.json())
      .then(branding => { if (active && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(branding.logo_base64 || '')) setLogo(branding.logo_base64); })
      .catch(() => {});
    request().then(result => {
      if (!active) return;
      setData(result);
      setForm(previous => ({ ...previous,
        child_name: result.invoice.customer_name_ar || result.invoice.member_name || '',
        guardian_name: result.guardian_name || '',
      }));
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tenant]);
  useEffect(() => {
    if (data?.status !== 'pending' || !canvas.current) return;
    const el = canvas.current;
    const ratio = window.devicePixelRatio || 1;
    el.width = Math.max(280, el.clientWidth) * ratio;
    el.height = 165 * ratio;
    const context = el.getContext('2d');
    context.scale(ratio, ratio);
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.strokeStyle = '#372980';
  }, [data?.status]);
  const change = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const point = event => { const rect = canvas.current.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top]; };
  const start = event => { drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); const ctx = canvas.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...point(event)); };
  const move = event => { if (!drawing.current) return; const ctx = canvas.current.getContext('2d'); ctx.lineTo(...point(event)); ctx.stroke(); ink.current = true; };
  const clear = () => { const el = canvas.current; el.getContext('2d').clearRect(0, 0, el.width, el.height); ink.current = false; };
  const submit = async () => {
    if (!form.child_name.trim() || !form.guardian_name.trim() || !form.relationship.trim() || !form.guardian_identity.trim() || !form.emergency_phone.trim() || !form.signer_name.trim() || !form.accepted || !ink.current) {
      setError('أكمل بيانات ولي الأمر، وافق على البنود، ثم وقّع داخل المربع.'); return;
    }
    if (form.has_medical_condition && !form.medical_details.trim()) { setError('أدخل تفاصيل الحالة الصحية.'); return; }
    setBusy(true); setError('');
    try {
      await request('POST', { ...form, expected_invoice_hash: data.invoice_hash, expected_terms_version: data.terms_version, signature_png: canvas.current.toDataURL('image/png') });
      setData(previous => ({ ...previous, status: 'signed' }));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <main dir="rtl" className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-sky-50 px-3 py-6 text-slate-900 sm:px-6">
    <div className="mx-auto max-w-2xl overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-xl shadow-violet-100/60">
      <div className="border-b border-violet-100 bg-gradient-to-l from-violet-50 to-white px-5 py-7 text-center">
        <img src={logo} alt="شعار الأكاديمية" className="mx-auto h-24 w-24 rounded-2xl bg-white object-contain p-2 shadow-sm" />
        <h1 className="mt-3 text-xl font-bold text-violet-950">{data?.title || 'استمارة تسجيل نشاط وإقرار ولي الأمر'}</h1>
        <p dir="ltr" className="text-sm text-violet-700">{data?.title_en || 'Activity Registration and Guardian Acknowledgment Form'}</p>
        {data && <><p className="mt-2 font-medium">{data.company_name}</p><p dir="ltr" className="text-xs text-slate-500">{data.company_name_en}</p>{data.invoice.commercial_reg && <p className="text-xs text-slate-500">السجل التجاري / Commercial Registration: {data.invoice.commercial_reg}</p>}</>}
      </div>
      <div className="space-y-5 p-5 sm:p-7">
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!data && !error && <p>جارٍ تحميل الاستمارة…</p>}
        {data?.status === 'signed' && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center"><div className="text-4xl text-emerald-600">✓</div><h2 className="mt-2 text-lg font-bold">تم اعتماد الاستمارة</h2><p className="text-sm text-slate-600">حُفظ توقيعك بنجاح، ويمكن للأكاديمية الاطلاع على النسخة المعتمدة.</p></div>}
        {data?.status === 'pending' && <>
          <div className="rounded-2xl bg-violet-50 p-4"><h2 className="font-bold text-violet-900">بيانات الفاتورة / Invoice details</h2><p>الطفل: {data.invoice.customer_name_ar || data.invoice.member_name}</p><p>فاتورة رقم: {data.invoice.invoice_number}</p><p>النشاط: {(data.invoice.items || []).map(item => item.activity_name).join('، ')}</p><p>المبلغ: {data.invoice.total} ر.س</p><p className="mt-2 text-xs text-slate-500">الرابط صالح حتى {new Date(data.expires_at).toLocaleString('ar-SA')}</p></div>
          <div className="grid gap-3 sm:grid-cols-2">{[['child_name', 'اسم الطفل الرباعي / Child name'], ['birth_date', 'تاريخ الميلاد / Birth date'], ['guardian_name', 'اسم ولي الأمر / Guardian name'], ['relationship', 'صلة القرابة / Relationship'], ['guardian_identity', 'رقم الهوية أو الإقامة / ID'], ['emergency_phone', 'رقم الطوارئ / Emergency phone']].map(([key, label]) => <label key={key} className="block text-sm font-medium"><span>{label}</span><input type={key === 'birth_date' ? 'date' : 'text'} value={form[key]} onChange={e => change(key, e.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white p-3 outline-none focus:border-violet-500" /></label>)}</div>
          <div className="rounded-xl border p-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={form.has_medical_condition} onChange={e => change('has_medical_condition', e.target.checked)} /> توجد حالة صحية أو حساسية أو إصابة سابقة</label>{form.has_medical_condition && <textarea value={form.medical_details} onChange={e => change('medical_details', e.target.value)} placeholder="تفاصيل الحالة الصحية" className="mt-3 w-full rounded-xl border p-3" />}</div>
          <section><h2 className="mb-2 font-bold text-violet-900">الشروط والإقرار / Terms and acknowledgment</h2><ol className="list-decimal space-y-3 pr-5 text-sm">{data.terms.map((term, index) => <li key={index}>{term.text}<p dir="ltr" className="mt-1 text-left text-slate-600">{term.text_en}</p></li>)}</ol><p className="mt-4 font-semibold">{data.declaration}</p><p dir="ltr" className="mt-1 text-left text-sm text-slate-600">{data.declaration_en}</p></section>
          <label className="block text-sm font-medium">اسم الموقّع / Signer name<input value={form.signer_name} onChange={e => change('signer_name', e.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 p-3" /></label>
          <div><p className="mb-2 font-bold text-violet-900">التوقيع بالإصبع أو القلم / Sign here</p><canvas ref={canvas} onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} className="h-40 w-full touch-none rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/40" /><button type="button" onClick={clear} className="mt-2 text-sm text-violet-700">مسح التوقيع</button></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.accepted} onChange={e => change('accepted', e.target.checked)} /> <span>قرأت بيانات الاستمارة وجميع الشروط والإقرار وأوافق عليها. / I have read and agree.</span></label>
          <button type="button" disabled={busy} onClick={submit} className="w-full rounded-xl bg-violet-800 p-4 font-bold text-white disabled:opacity-50">{busy ? 'جارٍ حفظ التوقيع…' : 'اعتماد التوقيع وحفظ الاستمارة'}</button>
          <p className="text-center text-xs text-slate-500">فتح الرابط لا يعدّ اعتمادًا. لا تُحفظ الاستمارة إلا بعد الضغط على زر الاعتماد.</p>
        </>}
      </div>
    </div>
  </main>;
}
