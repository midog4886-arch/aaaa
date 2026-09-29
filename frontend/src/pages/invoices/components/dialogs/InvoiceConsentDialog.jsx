import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { invoicesAPI } from '../../../../services/api';
import { toast } from 'sonner';
import html2pdf from 'html2pdf.js';
import { getAcademyLogoUrl } from '../../../../services/branding';

const empty = { child_name: '', birth_date: '', guardian_name: '', relationship: '', guardian_identity: '', has_medical_condition: false, medical_details: '', signer_name: '', accepted: false };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function InvoiceConsentDialog({ invoice, open, onOpenChange, isAdmin }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const ink = useRef(false);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingTerms, setEditingTerms] = useState(false);
  const [termsDraft, setTermsDraft] = useState(null);
  const [shareLink, setShareLink] = useState('');
  const [sharePhone, setSharePhone] = useState('');
  const [shareLinkId, setShareLinkId] = useState('');
  const [linkHistory, setLinkHistory] = useState([]);
  useEffect(() => {
    if (!invoice || !open) return;
    setLoading(true);
    setData(null);
    setEditingTerms(false);
    setShareLink('');
    setShareLinkId('');
    setForm({ ...empty, child_name: invoice.customer_name_ar || invoice.member_name || '' });
    ink.current = false;
    invoicesAPI.getRegistrationConsent(invoice.id).then(r => { setData(r.data); setTermsDraft({ form_type: r.data.form_type, title: r.data.title, title_en: r.data.title_en, company_name: r.data.company_name, company_name_en: r.data.company_name_en, terms: r.data.terms.map(item => ({ ...item })), declaration: r.data.declaration, declaration_en: r.data.declaration_en }); }).catch(() => toast.error('تعذر تحميل الاستمارة')).finally(() => setLoading(false));
    invoicesAPI.getRegistrationConsentLinks(invoice.id).then(r => setLinkHistory(r.data.links || [])).catch(() => setLinkHistory([]));
  }, [invoice?.id, open]);
  useEffect(() => {
    if (!open || !data || (data.signed && !data.needs_resign)) return;
    const el = canvas.current;
    if (!el) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = Math.max(300, el.clientWidth) * ratio;
    el.height = 160 * ratio;
    const ctx = el.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#183f79';
  }, [open, data]);
  useEffect(() => {
    if (!open || !shareLink || !invoice?.id) return;
    const timer = window.setInterval(() => {
      invoicesAPI.getRegistrationConsent(invoice.id).then(response => {
        if (response.data.signed && !response.data.needs_resign) {
          setData(response.data);
          setShareLink('');
          invoicesAPI.getRegistrationConsentLinks(invoice.id).then(r => setLinkHistory(r.data.links || [])).catch(() => {});
          toast.success('تم اعتماد الاستمارة من جوال ولي الأمر');
        }
      }).catch(() => {});
    }, 10000);
    return () => window.clearInterval(timer);
  }, [open, shareLink, invoice?.id]);
  if (!invoice) return null;
  const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const point = event => { const r = canvas.current.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
  const start = event => { drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); const p = point(event); const ctx = canvas.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = event => { if (!drawing.current) return; const p = point(event); const ctx = canvas.current.getContext('2d'); ctx.lineTo(p.x, p.y); ctx.stroke(); ink.current = true; };
  const clear = () => { const el = canvas.current; el?.getContext('2d').clearRect(0, 0, el.width, el.height); ink.current = false; };
  const submit = async () => {
    if (!ink.current || !form.accepted || !form.child_name.trim() || !form.guardian_name.trim() || !form.relationship.trim() || !form.guardian_identity.trim() || !form.signer_name.trim()) {
      toast.error('أكمل بيانات وليّ الأمر والموافقة والتوقيع'); return;
    }
    if (form.has_medical_condition && !form.medical_details.trim()) { toast.error('أدخل التفاصيل الصحية'); return; }
    setBusy(true);
    try {
      const signed = await invoicesAPI.signRegistrationConsent(invoice.id, { ...form, expected_invoice_hash: data.invoice_hash, expected_terms_version: data.terms_version, signature_png: canvas.current.toDataURL('image/png') });
      setData(previous => ({ ...previous, signed: signed.data, needs_resign: false }));
      toast.success('حُفظت الاستمارة الموقّعة');
    } catch (error) { toast.error(error.response?.data?.detail || 'تعذر حفظ التوقيع'); }
    finally { setBusy(false); }
  };
  const saveTerms = async () => {
    if (!termsDraft?.title.trim() || !termsDraft.title_en.trim() || !termsDraft.company_name.trim() || !termsDraft.company_name_en.trim() || !termsDraft.declaration.trim() || !termsDraft.declaration_en.trim() || !termsDraft.terms.length || termsDraft.terms.some(item => !item.section.trim() || !item.text.trim() || !item.section_en.trim() || !item.text_en.trim())) {
      toast.error('أكمل عنوان الاستمارة والبنود والإقرار'); return;
    }
    setBusy(true);
    try {
      await invoicesAPI.updateRegistrationConsentTerms(termsDraft);
      const refreshed = await invoicesAPI.getRegistrationConsent(invoice.id);
      setData(refreshed.data);
      setEditingTerms(false);
      toast.success('حُفظ إصدار جديد من بنود الاستمارة');
    } catch (error) { toast.error(error.response?.data?.detail || 'تعذر حفظ البنود'); }
    finally { setBusy(false); }
  };
  const createShareLink = async () => {
    setBusy(true);
    try {
      const { data: link } = await invoicesAPI.createRegistrationConsentLink(invoice.id);
      const tenant = localStorage.getItem('tenant_slug') || 'default';
      setShareLink(`${window.location.origin}/consent/${encodeURIComponent(link.token)}?tenant=${encodeURIComponent(tenant)}`);
      setShareLinkId(link.id);
      setSharePhone((link.customer_phone || '').replace(/\D/g, '').replace(/^0/, '966'));
      invoicesAPI.getRegistrationConsentLinks(invoice.id).then(r => setLinkHistory(r.data.links || [])).catch(() => {});
      toast.success('الرابط جاهز للإرسال، وصلاحيته 7 أيام');
    } catch (error) { toast.error(error.response?.data?.detail || 'تعذر إنشاء الرابط'); }
    finally { setBusy(false); }
  };
  const markWhatsAppOpened = () => {
    if (!shareLinkId) return;
    invoicesAPI.markRegistrationConsentWhatsAppOpened(invoice.id, shareLinkId)
      .then(() => invoicesAPI.getRegistrationConsentLinks(invoice.id))
      .then(r => setLinkHistory(r.data.links || []))
      .catch(() => {});
  };
  const linkStatus = { created: 'الرابط أُنشئ', awaiting_signature: 'بانتظار التوقيع', signed: 'تم التوقيع', expired: 'انتهت الصلاحية', invalid: 'الرابط غير صالح' };
  const dateTime = value => value ? new Date(value).toLocaleString('ar-SA') : '—';
  const printSigned = async () => {
    const signed = data?.signed;
    if (!signed) return;
    const inv = signed.invoice_snapshot || {};
    const fields = signed.fields || {};
    const rows = (inv.items || []).map(item => `<tr><td>${esc(item.activity_name)}</td><td>${esc(item.schedule)}</td><td>${esc(item.start_date)} — ${esc(item.end_date)}</td><td>${esc(item.fee)}</td></tr>`).join('');
    const terms = (signed.terms || []).map(item => `<li><strong>${esc(item.section)}:</strong> ${esc(item.text)}<div dir="ltr" style="text-align:left;color:#536478">${esc(item.section_en)}: ${esc(item.text_en)}</div></li>`).join('');
    const element = document.createElement('div');
    element.dir = 'rtl';
    element.style.cssText = 'width:750px;background:#fff;color:#172744;padding:22px;font:13px/1.8 Arial,sans-serif';
    element.innerHTML = `<div style="text-align:center;border-bottom:2px solid #493493;padding-bottom:12px"><img style="width:95px;height:95px;object-fit:contain" src="${esc(getAcademyLogoUrl())}" alt="شعار الأكاديمية"><h1 style="color:#31257e;font-size:22px;margin:4px 0">${esc(signed.company_name)}<br><span style="font-size:15px">${esc(signed.company_name_en)}</span><br>${esc(signed.title)}<br><span style="font-size:15px">${esc(signed.title_en)}</span></h1>${inv.commercial_reg ? `<p style="margin:4px 0">السجل التجاري / Commercial Registration: ${esc(inv.commercial_reg)}</p>` : ''}</div><p style="background:#f2efff;padding:10px">رقم الفاتورة: ${esc(inv.invoice_number)} · رقم النسخة: ${esc(signed.version)} · تاريخ التوقيع: ${esc(new Date(signed.signed_at).toLocaleString('ar-SA'))}</p><h2>بيانات التسجيل / Registration details</h2><p>الطفل / Child: ${esc(fields.child_name)} · تاريخ الميلاد / Date of birth: ${esc(fields.birth_date || '—')} · ولي الأمر / Guardian: ${esc(fields.guardian_name)} · صلة القرابة / Relationship: ${esc(fields.relationship)}</p><p>رقم الهوية / ID: ${esc(fields.guardian_identity)} · الجوال / Phone: ${esc(inv.customer_phone)}${fields.emergency_phone ? ` · طوارئ / Emergency: ${esc(fields.emergency_phone)}` : ""}</p><p>الحالة الصحية / Health: ${fields.has_medical_condition ? esc(fields.medical_details) : 'لا توجد حالة مُفصح عنها / No condition disclosed'}</p><table style="width:100%;border-collapse:collapse"><thead><tr><th>النشاط</th><th>المواعيد</th><th>الفترة</th><th>الرسوم</th></tr></thead><tbody>${rows}</tbody></table><p>إجمالي الفاتورة وقت التوقيع / Invoice total at signing: ${esc(inv.total)} ر.س</p><h2>الشروط والإقرار / Terms and acknowledgment</h2><ol>${terms}</ol><p>${esc(signed.declaration)}</p><p dir="ltr" style="text-align:left">${esc(signed.declaration_en)}</p><h2>التوقيع / Signature</h2><p>الموقّع / Signer: ${esc(signed.signer_name)} · سُجّل بواسطة / Recorded by: ${esc(signed.recorded_by)}</p><img style="height:80px;max-width:250px" src="${signed.signature_png}" alt="توقيع ولي الأمر">`;
    document.body.appendChild(element);
    try {
      await html2pdf().set({ margin: 10, filename: `استمارة_موقعة_${inv.invoice_number || invoice.id}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(element).save();
      toast.success('تم حفظ نسخة PDF');
    } catch { toast.error('تعذر حفظ PDF'); }
    finally { document.body.removeChild(element); }
  };
  const signed = data?.signed;
  const canSign = !signed || data?.needs_resign;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" dir="rtl">
    <DialogHeader><DialogTitle>{data?.title || 'استمارة تسجيل نشاط وإقرار ولي الأمر'} · فاتورة {invoice.invoice_number}</DialogTitle></DialogHeader>
    {loading ? <p>جارٍ تحميل الاستمارة...</p> : data && <div className="space-y-4 text-sm">
      <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-gradient-to-l from-violet-50 to-white p-3"><img src={getAcademyLogoUrl()} alt="شعار الأكاديمية" className="h-16 w-16 rounded-lg bg-white object-contain p-1" /><p className="font-semibold text-violet-900">{data.company_name} <span dir="ltr" className="block text-xs font-normal">{data.company_name_en}</span></p></div>
      {data.invoice.commercial_reg && <p className="text-xs text-slate-600">السجل التجاري / Commercial Registration: {data.invoice.commercial_reg}</p>}
      <p className="rounded-lg bg-slate-50 p-3 text-slate-700">التوقيع اختياري حاليًا. يمكنك إنشاء الفاتورة ومتابعة الدفع دون توقيع الاستمارة، ثم توقيعها لاحقًا عند الحاجة.</p>
      {canSign && <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3"><p className="font-semibold text-violet-900">التوقيع من جوال ولي الأمر</p><Button variant="outline" disabled={busy} onClick={createShareLink}>إنشاء رابط توقيع لمدة 7 أيام</Button>{shareLink && <><Input dir="ltr" readOnly value={shareLink} aria-label="رابط توقيع الاستمارة" /><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => navigator.clipboard.writeText(shareLink).then(() => toast.success('نُسخ الرابط')).catch(() => toast.error('تعذر نسخ الرابط'))}>نسخ الرابط</Button><a onClick={markWhatsAppOpened} className="rounded-md bg-emerald-600 px-4 py-2 text-white" href={`https://wa.me/${sharePhone}?text=${encodeURIComponent(`يرجى مراجعة استمارة تسجيل النشاط والتوقيع عليها من الرابط التالي:\n${shareLink}`)}`} target="_blank" rel="noopener noreferrer">فتح واتساب للإرسال</a></div><p className="text-xs text-slate-600">فتح واتساب لا يؤكد الإرسال؛ الاعتماد يظهر بعد توقيع ولي الأمر وحفظه.</p></>}</div>}
      <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="mb-2 flex items-center justify-between"><strong>سجل روابط التوقيع</strong><Button variant="outline" size="sm" onClick={() => invoicesAPI.getRegistrationConsentLinks(invoice.id).then(r => setLinkHistory(r.data.links || [])).catch(() => toast.error('تعذر تحديث السجل'))}>تحديث الحالة</Button></div>{linkHistory.length ? <div className="space-y-2">{linkHistory.map(link => <div key={link.id} className="rounded-lg bg-slate-50 p-2 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong className={link.status === 'signed' ? 'text-emerald-700' : link.status === 'expired' || link.status === 'invalid' ? 'text-red-700' : 'text-violet-700'}>{linkStatus[link.status] || link.status}</strong><span>أنشأه: {link.created_by || '—'}</span></div><p>الإنشاء: {dateTime(link.created_at)} · الصلاحية حتى: {dateTime(link.expires_at)}</p>{link.whatsapp_opened_at && <p>فُتح واتساب: {dateTime(link.whatsapp_opened_at)} (لا يؤكد إرسال الرسالة)</p>}{link.signed_at && <p>اعتماد التوقيع: {dateTime(link.signed_at)}</p>}</div>)}</div> : <p className="text-xs text-slate-500">لا توجد روابط توقيع لهذه الفاتورة بعد.</p>}</div>
      {isAdmin && <Button variant="outline" onClick={() => setEditingTerms(value => !value)}>{editingTerms ? 'إغلاق تحرير البنود' : 'تعديل بنود الاستمارة'}</Button>}
      {editingTerms && isAdmin && termsDraft && <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="font-semibold">تعديل النص ينشئ إصدارًا جديدًا. النسخ الموقّعة سابقًا تحتفظ بنصها الأصلي.</p>
        <label className="block">عنوان الاستمارة<Input value={termsDraft.title} onChange={e => setTermsDraft(previous => ({ ...previous, title: e.target.value }))} /></label>
        <label className="block">Form title in English<Input dir="ltr" value={termsDraft.title_en} onChange={e => setTermsDraft(previous => ({ ...previous, title_en: e.target.value }))} /></label>
        <label className="block">اسم الشركة<Input value={termsDraft.company_name} onChange={e => setTermsDraft(previous => ({ ...previous, company_name: e.target.value }))} /></label>
        <label className="block">Company name in English<Input dir="ltr" value={termsDraft.company_name_en} onChange={e => setTermsDraft(previous => ({ ...previous, company_name_en: e.target.value }))} /></label>
        {termsDraft.terms.map((item, index) => <div key={index} className="grid gap-2 rounded-lg border bg-white p-3 md:grid-cols-[170px_1fr_auto]">
          <Input aria-label="القسم" value={item.section} onChange={e => setTermsDraft(previous => ({ ...previous, terms: previous.terms.map((row, i) => i === index ? { ...row, section: e.target.value } : row) }))} />
          <textarea aria-label="نص البند" className="min-h-20 rounded-md border p-2" value={item.text} onChange={e => setTermsDraft(previous => ({ ...previous, terms: previous.terms.map((row, i) => i === index ? { ...row, text: e.target.value } : row) }))} />
          <Input aria-label="Section in English" dir="ltr" value={item.section_en} onChange={e => setTermsDraft(previous => ({ ...previous, terms: previous.terms.map((row, i) => i === index ? { ...row, section_en: e.target.value } : row) }))} />
          <textarea aria-label="Term in English" dir="ltr" className="min-h-20 rounded-md border p-2" value={item.text_en} onChange={e => setTermsDraft(previous => ({ ...previous, terms: previous.terms.map((row, i) => i === index ? { ...row, text_en: e.target.value } : row) }))} />
          <Button variant="outline" onClick={() => setTermsDraft(previous => ({ ...previous, terms: previous.terms.filter((_, i) => i !== index) }))}>حذف</Button>
        </div>)}
        <Button variant="outline" onClick={() => setTermsDraft(previous => ({ ...previous, terms: [...previous.terms, { section: 'شروط النشاط', section_en: 'Activity terms', text: '', text_en: '' }] }))}>إضافة بند</Button>
        <label className="block">الإقرار<textarea className="mt-1 min-h-24 w-full rounded-md border p-2" value={termsDraft.declaration} onChange={e => setTermsDraft(previous => ({ ...previous, declaration: e.target.value }))} /></label>
        <label className="block">Acknowledgment in English<textarea dir="ltr" className="mt-1 min-h-24 w-full rounded-md border p-2" value={termsDraft.declaration_en} onChange={e => setTermsDraft(previous => ({ ...previous, declaration_en: e.target.value }))} /></label>
        <Button disabled={busy} onClick={saveTerms}>حفظ إصدار البنود</Button>
      </div>}
      {signed && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><strong>{data.needs_resign ? 'تغيّرت بيانات الفاتورة أو بنود الاستمارة بعد التوقيع؛ يمكنك توقيع نسخة جديدة' : 'الاستمارة موقّعة ومحفوظة'}</strong><div className="mt-2"><Button variant="outline" onClick={printSigned}>تنزيل PDF للنسخة الموقّعة</Button></div></div>}
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3"><div>العضو: <strong>{data.invoice.customer_name_ar || data.invoice.member_name}</strong></div><div>المبلغ: <strong>{data.invoice.total} ر.س</strong></div><div className="col-span-2">الأنشطة: {(data.invoice.items || []).map(item => item.activity_name).join('، ')}</div></div>
      {canSign && <>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{[
          ['child_name', 'اسم الطفل الرباعي'], ['birth_date', 'تاريخ الميلاد'], ['guardian_name', 'اسم ولي الأمر الرباعي'],
          ['relationship', 'صلة القرابة'], ['guardian_identity', 'رقم الهوية / الإقامة'],
        ].map(([key, label]) => <label key={key} className="space-y-1"><span>{label}</span><Input type={key === 'birth_date' ? 'date' : 'text'} value={form[key]} onChange={e => update(key, e.target.value)} /></label>)}</div>
        <div className="rounded-xl border p-3"><label className="flex gap-2"><input type="checkbox" checked={form.has_medical_condition} onChange={e => update('has_medical_condition', e.target.checked)} /> توجد حالة صحية أو حساسية أو إصابة سابقة</label>{form.has_medical_condition && <Input className="mt-2" placeholder="التفاصيل الصحية" value={form.medical_details} onChange={e => update('medical_details', e.target.value)} />}</div>
        <div className="max-h-60 overflow-y-auto rounded-xl border p-4"><h3 className="font-bold">الشروط والإقرار / Terms and acknowledgment</h3><ol className="list-decimal space-y-2 pr-5">{data.terms.map((term, i) => <li key={i}><strong>{term.section}: </strong>{term.text}<p dir="ltr" className="text-left text-slate-600">{term.section_en}: {term.text_en}</p></li>)}</ol><p className="mt-3 font-medium">{data.declaration}</p><p dir="ltr" className="text-left text-slate-600">{data.declaration_en}</p></div>
        <label className="block space-y-1">اسم الموقّع<Input value={form.signer_name} onChange={e => update('signer_name', e.target.value)} /></label>
        <canvas ref={canvas} className="h-40 w-full rounded-xl border-2 border-dashed border-slate-300 bg-white touch-none" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} aria-label="التوقيع على الشاشة" />
        <label className="flex items-start gap-2"><input type="checkbox" checked={form.accepted} onChange={e => update('accepted', e.target.checked)} /> قرأت بيانات الاستمارة وجميع الشروط والإقرار وأوافق عليها.</label>
        <div className="flex gap-2"><Button variant="outline" onClick={clear}>مسح التوقيع</Button><Button disabled={busy} onClick={submit}>اعتماد التوقيع وحفظ الاستمارة</Button></div>
      </>}
      <p className="text-xs text-muted-foreground">التوقيع لا يغيّر حالة دفع الفاتورة. يمكن تنزيل PDF من النسخة الموقّعة.</p>
    </div>}
  </DialogContent></Dialog>;
}
