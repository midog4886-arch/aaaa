import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { invoicesAPI } from '../../../../services/api';
import { toast } from 'sonner';
import { getAcademyLogoUrl } from '../../../../services/branding';

const empty = { child_name: '', birth_date: '', guardian_name: '', relationship: '', guardian_identity: '', has_medical_condition: false, medical_details: '', signer_name: '', accepted: false };

export function InvoiceConsentDialog({ invoice, open, onOpenChange, onStatusChange, isAdmin }) {
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
  const [versions, setVersions] = useState([]);
  const statusChangeRef = useRef(onStatusChange);
  statusChangeRef.current = onStatusChange;
  const refreshHistory = useCallback(() => {
    if (!invoice?.id) return;
    invoicesAPI.getRegistrationConsentLinks(invoice.id).then(r => setLinkHistory(r.data.links || [])).catch(() => {});
    invoicesAPI.getRegistrationConsentHistory(invoice.id).then(r => setVersions(r.data.versions || [])).catch(() => {});
    invoicesAPI.getRegistrationConsent(invoice.id).then(r => {
      setData(r.data);
      statusChangeRef.current?.(invoice.id, r.data);
    }).catch(() => {});
  }, [invoice?.id]);
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
    setLinkHistory([]);
    setVersions([]);
    refreshHistory();
  }, [invoice?.id, open, refreshHistory]);
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
          statusChangeRef.current?.(invoice.id, response.data);
          setShareLink('');
          refreshHistory();
          toast.success('تم اعتماد الاستمارة من جوال ولي الأمر');
        }
      }).catch(() => {});
    }, 10000);
    return () => window.clearInterval(timer);
  }, [open, shareLink, invoice?.id, refreshHistory]);
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
      statusChangeRef.current?.(invoice.id, { signed: signed.data, needs_resign: false });
      refreshHistory();
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
      statusChangeRef.current?.(invoice.id, refreshed.data);
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
      refreshHistory();
      toast.success('الرابط جاهز للإرسال، وصلاحيته 7 أيام');
    } catch (error) { toast.error(error.response?.data?.detail || 'تعذر إنشاء الرابط'); }
    finally { setBusy(false); }
  };
  const markWhatsAppOpened = () => {
    if (!shareLinkId) return;
    invoicesAPI.markRegistrationConsentWhatsAppOpened(invoice.id, shareLinkId)
      .then(refreshHistory)
      .catch(() => {});
  };
  const markSent = linkId => invoicesAPI.markRegistrationConsentSent(invoice.id, linkId).then(refreshHistory).catch(() => toast.error('تعذر تحديث حالة الإرسال'));
  const linkStatus = { created: 'لم يُرسل', sent: 'الرابط مُرسل', opened: 'فُتح الرابط', signed: 'موقّع', expired: 'منتهي الصلاحية', invalid: 'الرابط غير صالح؛ أُنشئ إصدار جديد' };
  const dateTime = value => value ? new Date(value).toLocaleString('ar-SA') : '—';
  const printSigned = async (version) => {
    setBusy(true);
    try {
      const response = await invoicesAPI.downloadRegistrationConsentPdf(invoice.id, version);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `استمارة_موقعة_${invoice.invoice_number || invoice.id}${version ? `_نسخة_${version}` : ''}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success('بدأ تنزيل نسخة PDF الموقّعة');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'تعذر تنزيل PDF. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const signed = data?.signed;
  const canSign = !signed || data?.needs_resign;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" dir="rtl">
    <DialogHeader><DialogTitle>{data?.title || 'استمارة تسجيل نشاط وإقرار ولي الأمر'} · فاتورة {invoice.invoice_number}</DialogTitle></DialogHeader>
    {loading ? <p>جارٍ تحميل الاستمارة...</p> : data && <div className="space-y-4 text-sm">
      <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-gradient-to-l from-violet-50 to-white p-3"><img src={getAcademyLogoUrl()} alt="شعار الأكاديمية" className="h-16 w-16 rounded-lg bg-white object-contain p-1" /><p className="font-semibold text-violet-900">{data.company_name} <span dir="ltr" className="block text-xs font-normal">{data.company_name_en}</span></p></div>
      {data.invoice.commercial_reg && <p className="text-xs text-slate-600">السجل التجاري / Commercial Registration: {data.invoice.commercial_reg}</p>}
      <p className="rounded-lg bg-slate-50 p-3 text-slate-700">التوقيع اختياري حاليًا. يمكنك إنشاء الفاتورة ومتابعة الدفع دون توقيع الاستمارة، ثم توقيعها لاحقًا عند الحاجة.</p>
      {canSign && <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3"><p className="font-semibold text-violet-900">التوقيع من جوال ولي الأمر</p><Button variant="outline" disabled={busy} onClick={createShareLink}>إنشاء رابط توقيع لمدة 7 أيام</Button>{shareLink && <><Input dir="ltr" readOnly value={shareLink} aria-label="رابط توقيع الاستمارة" /><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => navigator.clipboard.writeText(shareLink).then(() => toast.success('نُسخ الرابط')).catch(() => toast.error('تعذر نسخ الرابط'))}>نسخ الرابط</Button><a onClick={markWhatsAppOpened} className="rounded-md bg-emerald-600 px-4 py-2 text-white" href={`https://wa.me/${sharePhone}?text=${encodeURIComponent(`يرجى مراجعة استمارة تسجيل النشاط والتوقيع عليها من الرابط التالي:\n${shareLink}`)}`} target="_blank" rel="noopener noreferrer">فتح واتساب للإرسال</a></div><p className="text-xs text-slate-600">بعد إرسال الرسالة، اضغط «تأكيد إرسال الرابط» في السجل. فتح واتساب وحده لا يؤكد الإرسال.</p></>}</div>}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between"><strong>سجل روابط التوقيع</strong><Button variant="outline" size="sm" onClick={refreshHistory}>تحديث الحالة</Button></div>
        {linkHistory.length ? <div className="space-y-2">{linkHistory.map(link => <div key={link.id} className="rounded-lg bg-slate-50 p-2 text-xs">
          <div className="flex flex-wrap justify-between gap-2"><strong className={link.status === 'signed' ? 'text-emerald-700' : link.status === 'expired' || link.status === 'invalid' ? 'text-red-700' : 'text-violet-700'}>{linkStatus[link.status] || link.status}</strong><span>أنشأه: {link.created_by || '—'}</span></div>
          <p>إنشاء الرابط: {dateTime(link.created_at)} · انتهاء الصلاحية: {dateTime(link.expires_at)}</p>
          {link.whatsapp_opened_at && <p>فتح الموظف واتساب: {dateTime(link.whatsapp_opened_at)}</p>}
          {link.sent_at && <p>تأكيد الإرسال بواسطة {link.sent_by || 'الموظف'}: {dateTime(link.sent_at)}</p>}
          {link.opened_at && <p>فتح رابط الاستمارة: {dateTime(link.opened_at)}</p>}
          {link.signed_at && <p>التوقيع: {dateTime(link.signed_at)} · نسخة {link.signed_version}</p>}
          {!link.sent_at && !link.signed_at && link.status !== 'invalid' && link.status !== 'expired' && <Button variant="outline" size="sm" onClick={() => markSent(link.id)}>تأكيد إرسال الرابط</Button>}
        </div>)}</div> : <p className="text-xs text-slate-500">لم يُنشأ رابط توقيع لهذه الفاتورة.</p>}
      </div>
      {versions.length > 0 && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><strong>النسخ الموقّعة المحفوظة</strong><div className="mt-2 space-y-2">{versions.map(item => <div key={item.version} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 text-xs"><span>النسخة {item.version} · {item.signer_name || '—'} · {dateTime(item.signed_at)} · سُجّلت بواسطة {item.recorded_by || '—'}</span><Button variant="outline" size="sm" disabled={busy} onClick={() => printSigned(item.version)}>تنزيل PDF</Button></div>)}</div></div>}
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
      {signed && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><strong>{data.needs_resign ? 'تغيّرت بيانات الفاتورة أو بنود الاستمارة بعد التوقيع؛ يمكنك توقيع نسخة جديدة' : 'الاستمارة موقّعة ومحفوظة'}</strong><div className="mt-2"><Button variant="outline" disabled={busy} onClick={() => printSigned(signed.version)}>{busy ? 'جارٍ تجهيز PDF…' : 'تنزيل PDF للنسخة الموقّعة'}</Button></div></div>}
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
