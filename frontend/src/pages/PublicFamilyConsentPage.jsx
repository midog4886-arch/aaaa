import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

export default function PublicFamilyConsentPage() {
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
  const [form, setForm] = useState({ guardian_name: '', relationship: '', guardian_identity: '', signer_name: '', children: [], accepted: false });
  const endpoint = `/api/invoices/public/family-consent/${encodeURIComponent(token)}`;
  const request = async (method = 'GET', payload) => {
    const response = await fetch(endpoint, { method, credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': tenant },
      body: payload ? JSON.stringify(payload) : undefined });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'تعذر فتح الاستمارة العائلية');
    return result;
  };
  useEffect(() => {
    let active = true;
    fetch('/api/tenant/branding', { headers: { 'X-Tenant-Slug': tenant }, credentials: 'omit' })
      .then(response => response.json()).then(branding => {
        if (active && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(branding.logo_base64 || '')) setLogo(branding.logo_base64);
      }).catch(() => {});
    request().then(result => {
      if (!active) return;
      setData(result);
      setForm(previous => ({ ...previous, children: result.invoices.map(invoice => ({ invoice_id: invoice.id,
        child_name: invoice.customer_name_ar || invoice.member_name || '', birth_date: '',
        has_medical_condition: false, medical_details: '' })) }));
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
  const childChange = (id, key, value) => setForm(previous => ({ ...previous,
    children: previous.children.map(child => child.invoice_id === id ? { ...child, [key]: value } : child) }));
  const point = event => { const rect = canvas.current.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top]; };
  const start = event => { drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); const ctx = canvas.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...point(event)); };
  const move = event => { if (!drawing.current) return; const ctx = canvas.current.getContext('2d'); ctx.lineTo(...point(event)); ctx.stroke(); ink.current = true; };
  const clear = () => { const el = canvas.current; el.getContext('2d').clearRect(0, 0, el.width, el.height); ink.current = false; };
  const submit = async () => {
    if (!form.guardian_name.trim() || !form.relationship.trim() || !form.guardian_identity.trim() || !form.signer_name.trim()
        || form.children.some(child => !child.child_name.trim() || (child.has_medical_condition && !child.medical_details.trim()))
        || !form.accepted || !ink.current) {
      setError('أكمل بيانات ولي الأمر وكل طفل، وافق على البنود، ثم وقّع داخل المربع.'); return;
    }
    setBusy(true); setError('');
    try {
      await request('POST', { ...form, expected_group_hash: data.group_hash, expected_terms_version: data.terms_version,
        signature_png: canvas.current.toDataURL('image/png') });
      setData(previous => ({ ...previous, status: 'signed' }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const downloadCopy = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${endpoint}/pdf`, { credentials: 'omit', cache: 'no-store', headers: { 'X-Tenant-Slug': tenant } });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.detail || 'تعذر تنزيل النسخة'); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'استمارة_عائلية_موقعة.pdf';
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const inputClass = 'mt-1 block w-full rounded-xl border border-slate-200 bg-white p-3 outline-none focus:border-violet-500';
  return <main dir="rtl" className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-sky-50 px-3 py-6 text-slate-900 sm:px-6">
    <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-xl shadow-violet-100/60">
      <header className="border-b border-violet-100 bg-gradient-to-l from-violet-50 to-white px-5 py-7 text-center">
        <img src={logo} alt="شعار الأكاديمية" className="mx-auto h-24 w-24 rounded-2xl bg-white object-contain p-2 shadow-sm" />
        <h1 className="mt-3 text-xl font-bold text-violet-950">استمارة تسجيل عائلية وإقرار ولي الأمر</h1>
        {data && <p className="mt-2 font-medium">{data.company_name} · {data.invoices.length} أبناء</p>}
      </header>
      <div className="space-y-5 p-5 sm:p-7">
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!data && !error && <p>جارٍ تحميل الاستمارة…</p>}
        {data?.status === 'signed' && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center"><div className="text-4xl text-emerald-600">✓</div><h2 className="mt-2 text-lg font-bold">تم اعتماد الاستمارة العائلية</h2><p className="text-sm text-slate-600">حُفظ توقيع واحد لجميع الأبناء المدرجين، ويمكنك تنزيل نسختك الآن.</p><button type="button" disabled={busy} onClick={downloadCopy} className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white">تنزيل نسختي PDF</button></div>}
        {data?.status === 'pending' && <>
          <p className="rounded-xl bg-violet-50 p-3 text-sm">راجع بيانات كل طفل ونشاطه قبل التوقيع. الرابط صالح حتى {new Date(data.expires_at).toLocaleString('ar-SA')}.</p>
          <section className="grid gap-3 sm:grid-cols-2">{[['guardian_name', 'اسم ولي الأمر الرباعي'], ['relationship', 'صلة القرابة'], ['guardian_identity', 'رقم الهوية أو الإقامة']].map(([key, label]) => <label key={key} className="text-sm font-medium">{label}<input value={form[key]} onChange={e => change(key, e.target.value)} className={inputClass} /></label>)}</section>
          <section><h2 className="mb-3 font-bold text-violet-900">بيانات الأبناء والاشتراكات</h2><div className="space-y-4">{data.invoices.map((invoice, index) => { const child = form.children.find(item => item.invoice_id === invoice.id); return child && <div key={invoice.id} className="rounded-2xl border border-sky-200 bg-sky-50/50 p-4"><h3 className="font-bold text-sky-950">الطفل {index + 1} · فاتورة {invoice.invoice_number}</h3><p className="mt-1 text-sm">النشاط: {(invoice.items || []).filter(item => !item.is_product).map(item => item.activity_name).join('، ')}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">اسم الطفل<input value={child.child_name} onChange={e => childChange(invoice.id, 'child_name', e.target.value)} className={inputClass} /></label><label className="text-sm">تاريخ الميلاد<input type="date" value={child.birth_date} onChange={e => childChange(invoice.id, 'birth_date', e.target.value)} className={inputClass} /></label></div><label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={child.has_medical_condition} onChange={e => childChange(invoice.id, 'has_medical_condition', e.target.checked)} /> توجد حالة صحية أو حساسية أو إصابة سابقة لهذا الطفل</label>{child.has_medical_condition && <textarea value={child.medical_details} onChange={e => childChange(invoice.id, 'medical_details', e.target.value)} className={inputClass} placeholder="تفاصيل الحالة الصحية" />}</div>; })}</div></section>
          <section><h2 className="mb-2 font-bold text-violet-900">الشروط والإقرار</h2><ol className="list-decimal space-y-3 pr-5 text-sm">{data.terms.map((term, index) => <li key={index}>{term.text}<p dir="ltr" className="mt-1 text-left text-slate-600">{term.text_en}</p></li>)}</ol><p className="mt-4 font-semibold">{data.declaration}</p><p dir="ltr" className="mt-1 text-left text-sm text-slate-600">{data.declaration_en}</p></section>
          <label className="block text-sm font-medium">اسم الموقّع<input value={form.signer_name} onChange={e => change('signer_name', e.target.value)} className={inputClass} /></label>
          <div><p className="mb-2 font-bold text-violet-900">توقيع ولي الأمر لجميع الأبناء أعلاه</p><canvas ref={canvas} onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} className="h-40 w-full touch-none rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/40" /><button type="button" onClick={clear} className="mt-2 text-sm text-violet-700">مسح التوقيع</button></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.accepted} onChange={e => change('accepted', e.target.checked)} /> قرأت بيانات جميع الأبناء والشروط وأوافق عليها.</label>
          <button type="button" disabled={busy} onClick={submit} className="w-full rounded-xl bg-violet-800 p-4 font-bold text-white disabled:opacity-50">{busy ? 'جارٍ حفظ التوقيع…' : 'اعتماد التوقيع وحفظ الاستمارة العائلية'}</button>
        </>}
      </div>
    </div>
  </main>;
}
