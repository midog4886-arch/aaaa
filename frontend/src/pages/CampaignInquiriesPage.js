import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Layout } from '../components/Layout';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { branchesAPI, campaignInquiriesAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { whatsappChatUrl } from '../utils/whatsapp';
import { toast } from 'sonner';
import { Archive, CalendarClock, ChevronDown, ClipboardPlus, MessageCircle, Pencil, Phone, Plus, Search, Users } from 'lucide-react';

const STATUSES = [
  ['new', 'جديد'], ['waiting', 'بانتظار الرد'], ['interested', 'مهتم'], ['visit', 'موعد زيارة'],
  ['invoiced', 'تمت الفاتورة'], ['paid', 'مدفوع'], ['not_interested', 'غير مهتم'], ['do_not_contact', 'لا تتواصل'],
];
const QUICK_OUTCOMES = [
  ['waiting', 'لم يرد'],
  ['interested', 'مهتم'],
  ['visit', 'حجز زيارة'],
  ['not_interested', 'غير مهتم'],
  ['do_not_contact', 'لا يرغب بالتواصل'],
];
const SOURCE_LABELS = { social_ad: 'إعلان سوشيال ميديا' };
const SAUDI_TIME_ZONE = 'Asia/Riyadh';
const TEMPLATES = {
  first: 'مرحباً {name}، معك فريق الأكاديمية. يسعدنا مساعدتك في معرفة التفاصيل المناسبة لك. ما النشاط أو العمر الذي تود الاستفسار عنه؟',
  day1: 'مرحباً {name}، نتابع معك بخصوص استفسارك لدى الأكاديمية. إذا رغبت، نشاركك المواعيد والرسوم المناسبة.',
  day3: 'مرحباً {name}، هذه متابعة أخيرة بخصوص استفسارك. يسعدنا خدمتك متى ما كان الوقت مناسباً لك.',
};
const emptyForm = (branchId = '') => ({ branch_id: branchId, name: '', phone: '', source: 'social_ad', campaign: '', activity: '', age: '', assigned_to: '', notes: '', status: 'new', followup_due_at: '', invoice_id: '' });
const datetimeInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
};
const toIso = (value) => value ? new Date(value).toISOString() : null;
const displayDate = (value) => value ? new Date(value).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short', timeZone: SAUDI_TIME_ZONE }) : '—';
const sourceLabel = value => SOURCE_LABELS[value] || value;
const saudiDateKey = value => new Intl.DateTimeFormat('en-CA', {
  timeZone: SAUDI_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value));
const saudiTime = value => new Date(value).toLocaleTimeString('ar-SA', {
  timeZone: SAUDI_TIME_ZONE, hour: 'numeric', minute: '2-digit',
});
const dueLabel = value => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  if (date < now) return `متأخرة منذ ${displayDate(value)}`;
  const today = saudiDateKey(now);
  const dueDay = saudiDateKey(value);
  const tomorrow = saudiDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (dueDay === today) return `اليوم ${saudiTime(value)}`;
  if (dueDay === tomorrow) return `غدًا ${saudiTime(value)}`;
  return displayDate(value);
};

export const CampaignInquiriesPage = () => {
  const { user, selectedBranchId } = useAuth();
  const isAdmin = user?.is_admin;
  const canViewPhones = isAdmin || (user?.permissions || []).includes('member-phones');
  const [branches, setBranches] = useState([]);
  const allowedBranch = selectedBranchId && selectedBranchId !== 'all' ? selectedBranchId : (user?.branch_id || user?.branch_ids?.[0] || 'all');
  const [branch, setBranch] = useState(allowedBranch);
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [campaigns, setCampaigns] = useState([]);
  const [paidStats, setPaidStats] = useState({ count: 0, amount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: 'all', due: false, search: '', campaign: '' });
  const [form, setForm] = useState(null);
  const [contact, setContact] = useState(null);
  const [composer, setComposer] = useState(null);
  const [bulk, setBulk] = useState(false);
  const [bulkData, setBulkData] = useState({ phones: '', source: 'social_ad', campaign: '', activity: '' });
  const [preview, setPreview] = useState(null);
  const loadSeq = useRef(0);
  const previewSeq = useRef(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => { branchesAPI.getAll().then(r => setBranches(r.data || [])).catch(() => toast.error('تعذّر تحميل الفروع')); }, []);
  useEffect(() => { if (!isAdmin) setBranch(allowedBranch); }, [isAdmin, allowedBranch]);
  const load = useCallback(async () => {
    const token = ++loadSeq.current; setLoading(true); setError('');
    try {
      const params = { status: filters.status, due_only: filters.due };
      if (filters.campaign) params.campaign_exact = filters.campaign;
      if (branch !== 'all') params.branch_filter = branch;
      if (filters.search.trim()) params.search = filters.search.trim();
      const r = await campaignInquiriesAPI.getAll(params);
      if (token !== loadSeq.current) return;
       setItems(r.data?.items || []);
       setCounts(r.data?.counts || {});
       setCampaigns(r.data?.campaigns || []);
       setPaidStats(r.data?.paid_stats || { count: 0, amount: 0 });
    } catch { if (token === loadSeq.current) { setError('تعذّر تحميل الاستفسارات.'); setItems([]); setCampaigns([]); setPaidStats({ count: 0, amount: 0 }); } }
    finally { if (token === loadSeq.current) setLoading(false); }
  }, [branch, filters]);
  useEffect(() => { loadSeq.current += 1; const id = setTimeout(load, 180); return () => clearTimeout(id); }, [load]);
  const branchName = id => branches.find(b => b.id === id)?.name_ar || branches.find(b => b.id === id)?.name || '—';
  const setField = (setter, key, value) => setter(old => ({ ...old, [key]: value }));
  const resetPreview = () => { previewSeq.current += 1; setPreview(null); };

  const saveForm = async (e) => {
    e.preventDefault();
    if (busy) return;
    const payload = { ...form, followup_due_at: toIso(form.followup_due_at), invoice_id: form.invoice_id || null };
    // A normal inquiry edit is not evidence of contact.  Only the explicit
    // contact editor below is allowed to write last_contact_at.
    delete payload.last_contact_at;
    if (!canViewPhones && form.id) delete payload.phone;
    if (form.id) delete payload.branch_id;
    setBusy(true);
    try {
      if (form.id) await campaignInquiriesAPI.update(form.id, payload); else await campaignInquiriesAPI.create(payload);
      toast.success(form.id ? 'تم حفظ التعديلات' : 'تمت إضافة الاستفسار'); setForm(null); load();
    } catch (err) { toast.error(err.response?.data?.detail || 'تعذّر الحفظ. تأكد من الفاتورة والفرع.'); } finally { setBusy(false); }
  };
  const saveContact = async (e) => {
    e.preventDefault();
    if (busy) return; setBusy(true);
    try { await campaignInquiriesAPI.update(contact.id, { notes: contact.notes, followup_due_at: toIso(contact.followup_due_at), last_contact_at: new Date().toISOString(), status: contact.status }); toast.success('تم تسجيل التواصل يدوياً'); setContact(null); load(); }
    catch { toast.error('تعذّر تسجيل التواصل'); } finally { setBusy(false); }
  };
  const previewPhones = async () => {
    if (!bulkData.phones.trim() || branch === 'all') return toast.error('اختر فرعاً وأدخل الأرقام أولاً');
    const token = ++previewSeq.current;
    try { const r = await campaignInquiriesAPI.preview({ branch_id: branch, phones: bulkData.phones }); if (token === previewSeq.current) setPreview({ ...r.data, branch, phones: bulkData.phones }); }
    catch { toast.error('تعذّرت معاينة الأرقام'); }
  };
  const importPhones = async () => {
    if (!preview?.valid_count || preview.branch !== branch || preview.phones !== bulkData.phones || busy) return toast.error('حدّث المعاينة قبل الاستيراد');
    setBusy(true);
    try { const r = await campaignInquiriesAPI.import({ branch_id: branch, ...bulkData }); toast.success(`تمت إضافة ${r.data?.created || 0} استفسار`); setBulk(false); setBulkData({ phones: '', source: 'social_ad', campaign: '', activity: '' }); resetPreview(); load(); }
    catch { toast.error('تعذّر الاستيراد'); } finally { setBusy(false); }
  };
  const archive = async (item) => {
    if (!window.confirm(`أرشفة استفسار ${item.name || item.phone}؟`)) return;
    try { await campaignInquiriesAPI.delete(item.id); toast.success('تمت الأرشفة'); load(); } catch { toast.error('تعذّرت الأرشفة'); }
  };
  const canOpenChat = item => canViewPhones && item.status !== 'do_not_contact' && /^\+?\d[\d\s()-]{7,}$/.test(String(item.phone || ''));
  const openWhatsApp = item => { window.open(whatsappChatUrl(item.phone, composer.text), '_blank', 'noopener,noreferrer'); setComposer(null); };
  const startContact = (item, status = item.status) => {
    const next = { ...item, status, followup_due_at: datetimeInput(item.followup_due_at) };
    if (status === 'waiting') {
      next.followup_due_at = new Date(Date.now() + 24 * 3600000).toISOString().slice(0, 16);
    }
    setContact(next);
  };
  const activeBranch = branch === 'all' ? '' : branch;

  return <Layout><main className="p-4 md:p-6 max-w-6xl mx-auto" dir="rtl">
    <header className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div><div className="flex items-center gap-2"><Users className="w-6 h-6 text-emerald-600" /><h1 className="text-xl font-bold">متابعة استفسارات الحملات</h1></div><p className="text-xs text-muted-foreground mt-1">متابعة شخصية لاستفسارات الإعلانات — لا توجد رسائل أو جدولة تلقائية.</p></div>
      {canViewPhones && <div className="flex gap-2"><Button variant="outline" onClick={() => { setBulk(true); resetPreview(); }}><ClipboardPlus className="w-4 h-4 ml-1" /> لصق أرقام</Button><Button onClick={() => setForm(emptyForm(activeBranch))}><Plus className="w-4 h-4 ml-1" /> إضافة استفسار</Button></div>}
    </header>
    <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-5">
      {[['total','الكل'],['new','جديد'],['waiting','بانتظار رد'],['interested','مهتم'],['visit','زيارة'],['invoiced','تمت الفاتورة'],['paid','مدفوع'],['due','مستحق اليوم']].map(([key,label]) => <button key={key} onClick={() => key === 'due' ? setFilters(f => ({ ...f, due: !f.due })) : setFilters(f => ({ ...f, status: key === 'total' ? 'all' : key, due: false }))} className={`text-right rounded-lg border p-3 transition-colors ${((key === 'due' && filters.due) || filters.status === key) ? 'border-emerald-400 bg-emerald-50' : 'bg-card hover:border-emerald-200'}`}><span className="block text-lg font-bold">{counts[key] || 0}</span><span className="text-[11px] text-muted-foreground">{label}</span></button>)}
    </section>
    <Card className="mb-4"><CardContent className="p-3 flex flex-wrap gap-2">
       <select value={branch} onChange={e => { setBranch(e.target.value); setFilters(f => ({ ...f, campaign: '' })); resetPreview(); setForm(null); setBulk(false); setContact(null); }} className="h-9 rounded-md border px-2 text-sm" disabled={!isAdmin && branches.length <= 1}>{isAdmin && <option value="all">كل الفروع</option>}{branches.map(b => <option key={b.id} value={b.id}>{b.name_ar || b.name}</option>)}</select>
      <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="h-9 rounded-md border px-2 text-sm"><option value="all">كل الحالات</option>{STATUSES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
       <select aria-label="الحملة" value={filters.campaign} onChange={e => setFilters(f => ({ ...f, campaign: e.target.value }))} className="h-9 rounded-md border px-2 text-sm"><option value="">كل الحملات</option>{campaigns.map(name => <option key={name} value={name}>{name}</option>)}</select>
      <label className="flex items-center gap-1 text-xs px-2"><input type="checkbox" checked={filters.due} onChange={e => setFilters(f => ({ ...f, due: e.target.checked }))} /> مستحق اليوم (السعودية)</label>
      <div className="relative flex-1 min-w-[190px]"><Search className="absolute right-2 top-2.5 w-4 h-4 text-muted-foreground" /><input value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} className="w-full h-9 pr-8 border rounded-md px-2 text-sm" placeholder="بحث بالاسم أو الهاتف أو الحملة" /></div>
    </CardContent></Card>
     <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
       <span>المدفوع: <strong className="text-foreground">{paidStats.count}</strong></span>
       {paidStats.amount > 0 && <span>قيمة المدفوع: <strong className="text-foreground">{paidStats.amount.toLocaleString('ar-SA')} ر.س</strong></span>}
     </div>
    {!canViewPhones && <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">صلاحية عرض أرقام الأعضاء غير متاحة لديك؛ تم إخفاء إجراءات الهاتف وواتساب.</div>}
    {loading ? <div className="space-y-3">{[1,2,3].map(n => <div key={n} className="h-28 rounded-lg bg-muted animate-pulse" />)}</div> : error ? <div className="text-center py-16"><p className="text-destructive mb-3">{error}</p><Button variant="outline" onClick={load}>إعادة المحاولة</Button></div> : !items.length ? <div className="text-center py-16 text-muted-foreground"><Users className="mx-auto mb-3 opacity-40" /><p>لا توجد استفسارات ضمن هذه الفلاتر.</p><p className="text-xs mt-1">أضفها يدوياً أو الصق أرقام حملة بعد معاينتها.</p></div> :
       <div className="space-y-3">{items.map(item => <Card key={item.id}><CardContent className="p-4 flex flex-wrap justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex gap-2 items-center flex-wrap"><h2 className="font-semibold">{item.name || (canViewPhones ? (item.phone || 'بدون اسم') : 'بدون اسم')}</h2><Status status={item.status} />{isAdmin && <span className="text-[11px] bg-muted px-2 py-0.5 rounded">{branchName(item.branch_id)}</span>}</div><div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">{canViewPhones && <span dir="ltr"><Phone className="inline w-3 h-3 ml-1" />{item.phone}</span>}{item.source && <span>المصدر: {sourceLabel(item.source)}</span>}{item.campaign && <span>الحملة: {item.campaign}</span>}{item.activity && <span>النشاط: {item.activity}</span>}{item.assigned_to && <span>المسؤول: {item.assigned_to}</span>}{(item.invoice_number || item.invoice_id) && <span>فاتورة: {item.invoice_number || item.invoice_id}</span>}<span title={displayDate(item.followup_due_at)} aria-label={displayDate(item.followup_due_at)}><CalendarClock className="inline w-3 h-3 ml-1" />المتابعة: {dueLabel(item.followup_due_at)}</span></div>{item.invoice_link_error && <p className="mt-2 text-xs text-destructive">مشكلة ربط الفاتورة: {item.invoice_link_error}</p>}{item.notes && <p className="mt-2 text-xs bg-muted/60 rounded p-2 whitespace-pre-wrap">{item.notes}</p>}{item.last_contact_at ? <p className="mt-2 text-[11px] text-muted-foreground">آخر تواصل مسجل: {displayDate(item.last_contact_at)}</p> : <p className="mt-2 text-[11px] text-muted-foreground">لم تتم متابعته بعد</p>}</div><div className="flex flex-wrap content-start gap-2">{canOpenChat(item) && <Button size="sm" variant="outline" onClick={() => setComposer({ item, template: 'first', text: TEMPLATES.first.replace('{name}', item.name || '') })}><MessageCircle className="w-3.5 h-3.5 ml-1" /> تجهيز واتساب</Button>}{canOpenChat(item) && <Button size="sm" variant="outline" onClick={() => startContact(item)}>تسجيل تواصل</Button>}{canOpenChat(item) && <div className="flex flex-wrap gap-1 w-full" aria-label="نتائج التواصل">{QUICK_OUTCOMES.map(([statusValue, label]) => <Button key={statusValue} size="sm" variant="ghost" onClick={() => startContact(item, statusValue)}>{label}</Button>)}</div>}<Button size="sm" variant="outline" onClick={() => setForm({ ...item, followup_due_at: datetimeInput(item.followup_due_at), invoice_id: item.invoice_number || item.invoice_id || '' })}><Pencil className="w-3.5 h-3.5 ml-1" /> تعديل</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => archive(item)}><Archive className="w-3.5 h-3.5" /></Button></div></CardContent></Card>)}</div>}
    {form && <InquiryForm value={form} setValue={setForm} branches={branches} isAdmin={isAdmin} canViewPhones={canViewPhones} onChange={setField} onSubmit={saveForm} busy={busy} onClose={() => setForm(null)} />}
    {contact && <ContactForm value={contact} setValue={setContact} onChange={setField} onSubmit={saveContact} busy={busy} onClose={() => setContact(null)} />}
    {composer && <Composer value={composer} setValue={setComposer} onOpen={openWhatsApp} onClose={() => setComposer(null)} />}
    {bulk && <BulkDialog branch={branch} data={bulkData} setData={setBulkData} preview={preview} busy={busy} onEdit={resetPreview} onPreview={previewPhones} onImport={importPhones} onClose={() => setBulk(false)} />}
  </main></Layout>;
};

const Status = ({ status }) => <span className={`text-[11px] rounded-full px-2 py-0.5 ${status === 'do_not_contact' ? 'bg-red-100 text-red-700' : status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{STATUSES.find(x => x[0] === status)?.[1] || status}</span>;
const Modal = ({ children }) => <div className="fixed inset-0 z-50 bg-black/40 p-3 flex items-center justify-center" dir="rtl"><div className="w-full max-w-xl max-h-[92dvh] overflow-auto rounded-xl bg-background shadow-xl">{children}</div></div>;
const InquiryForm = ({ value, setValue, branches, isAdmin, canViewPhones, onChange, onSubmit, onClose, busy }) => <Modal><form onSubmit={onSubmit} className="p-5 space-y-3"><h2 className="font-bold">{value.id ? 'تعديل الاستفسار' : 'إضافة استفسار'}</h2><div className="grid sm:grid-cols-2 gap-3">{[['name','الاسم'],...((!value.id || canViewPhones) ? [['phone','رقم الجوال']] : []),['source','المصدر'],['campaign','الحملة'],['activity','النشاط'],['age','العمر'],['assigned_to','اسم المسؤول'],['invoice_id','رقم/معرّف الفاتورة المرتبطة']].map(([key,label]) => <label key={key} className="text-xs">{label}<input required={key === 'phone'} dir={key === 'phone' ? 'ltr' : undefined} value={value[key] || ''} onChange={e => onChange(setValue,key,e.target.value)} className="mt-1 w-full h-9 border rounded px-2 text-sm" /></label>)}{isAdmin && !value.id && <label className="text-xs">الفرع<select required value={value.branch_id} onChange={e => onChange(setValue,'branch_id',e.target.value)} className="mt-1 w-full h-9 border rounded px-2"><option value="" disabled>اختر الفرع</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name_ar || b.name}</option>)}</select></label>}<label className="text-xs">الحالة<select value={value.status} onChange={e => onChange(setValue,'status',e.target.value)} className="mt-1 w-full h-9 border rounded px-2">{STATUSES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label><label className="text-xs">موعد المتابعة<input type="datetime-local" value={value.followup_due_at || ''} onChange={e => onChange(setValue,'followup_due_at',e.target.value)} className="mt-1 w-full h-9 border rounded px-2" /></label></div><p className="text-[11px] text-muted-foreground">يمكن إدخال رقم الفاتورة الظاهر أو معرّفها. حالة «مدفوع» تُستمد وتتحقق من فاتورة صحيحة في الفرع.</p><label className="text-xs block">ملاحظات<textarea value={value.notes || ''} onChange={e => onChange(setValue,'notes',e.target.value)} className="mt-1 w-full border rounded p-2 text-sm min-h-20" /></label><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button><Button disabled={busy} type="submit">حفظ</Button></div></form></Modal>;
const ContactForm = ({ value, setValue, onChange, onSubmit, onClose, busy }) => {
  const suggest = hours => onChange(setValue, 'followup_due_at', new Date(Date.now() + hours * 3600000).toISOString().slice(0, 16));
  const setOutcome = status => {
    onChange(setValue, 'status', status);
    if (status === 'waiting') suggest(24);
  };
  return <Modal><form onSubmit={onSubmit} className="p-5 space-y-3"><h2 className="font-bold">تسجيل تواصل شخصي</h2><p className="text-xs text-muted-foreground">فتح واتساب لا يسجل تواصلاً. احفظ هنا فقط بعد التواصل الفعلي.</p><div className="flex flex-wrap gap-1" aria-label="نتيجة التواصل">{QUICK_OUTCOMES.map(([statusValue, label]) => <Button key={statusValue} type="button" size="sm" variant={value.status === statusValue ? 'default' : 'outline'} onClick={() => setOutcome(statusValue)}>{label}</Button>)}</div><select value={value.status} onChange={e => setOutcome(e.target.value)} className="w-full h-9 border rounded px-2">{STATUSES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select><label className="text-xs block">موعد متابعة لاحق<input type="datetime-local" value={value.followup_due_at || ''} onChange={e => onChange(setValue,'followup_due_at',e.target.value)} className="mt-1 w-full h-9 border rounded px-2" /></label><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => suggest(24)}>اقتراح بعد 24 ساعة</Button><Button type="button" size="sm" variant="outline" onClick={() => suggest(72)}>اقتراح بعد 3 أيام</Button></div><textarea value={value.notes || ''} onChange={e => onChange(setValue,'notes',e.target.value)} placeholder="ماذا تم في التواصل؟" className="w-full min-h-28 border rounded p-2 text-sm" /><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button><Button disabled={busy} type="submit">حفظ تسجيل التواصل</Button></div></form></Modal>;
};
const Composer = ({ value, setValue, onOpen, onClose }) => <Modal><div className="p-5 space-y-3"><h2 className="font-bold">رسالة واتساب شخصية</h2><p className="text-xs text-muted-foreground">ستُفتح محادثة واحدة فقط. لا يتم تسجيل تواصل أو إرسال شيء من النظام.</p><div className="flex gap-2 flex-wrap">{Object.entries(TEMPLATES).map(([key, text]) => <Button key={key} type="button" size="sm" variant={value.template === key ? 'default' : 'outline'} onClick={() => setValue(v => ({ ...v, template: key, text: text.replace('{name}', v.item.name || '') }))}>{key === 'first' ? 'الرد الأول' : key === 'day1' ? 'قالب 24 ساعة' : 'قالب 3 أيام'}</Button>)}</div><textarea value={value.text} onChange={e => setValue(v => ({ ...v, text: e.target.value }))} className="w-full min-h-32 border rounded p-2 text-sm" /><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>إلغاء</Button><Button onClick={() => onOpen(value.item)}>فتح المحادثة</Button></div></div></Modal>;
const BulkDialog = ({ branch, data, setData, preview, busy, onEdit, onPreview, onImport, onClose }) => <Modal><div className="p-5 space-y-3"><h2 className="font-bold">استيراد استفسارات من قائمة</h2><p className="text-xs text-muted-foreground">رقم واحد في كل سطر. المعاينة مطلوبة قبل الاستيراد، ولا يتم إرسال أي رسالة.</p>{branch === 'all' && <p className="text-sm text-destructive">اختر فرعاً محدداً من الفلاتر أولاً.</p>}<textarea value={data.phones} onChange={e => { setData(d => ({...d,phones:e.target.value})); onEdit(); }} placeholder={'9665xxxxxxxx\n9665xxxxxxxx'} dir="ltr" className="w-full min-h-32 border rounded p-2 text-sm" />{[['source','المصدر'],['campaign','الحملة'],['activity','النشاط']].map(([key,label]) => <label key={key} className="text-xs inline-block ml-3">{label}<input value={data[key]} onChange={e => { setData(d => ({...d,[key]:e.target.value})); onEdit(); }} className="block h-8 border rounded px-2 mt-1" /></label>)}{preview && <div className="rounded bg-muted p-3 text-xs"><strong>المعاينة:</strong> صالح {preview.valid_count}، غير صالح {preview.invalid_count}، مكرر {preview.duplicate_count}<div className="mt-2 max-h-28 overflow-auto">{preview.rows?.filter(r => r.status !== 'valid').map(r => <div key={r.line}>سطر {r.line}: {r.phone} — {r.reason}</div>)}</div></div>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>إلغاء</Button>{!preview ? <Button onClick={onPreview} disabled={branch === 'all' || busy}>معاينة الأرقام</Button> : <Button onClick={onImport} disabled={!preview.valid_count || busy}>استيراد الأرقام الصالحة فقط</Button>}</div></div></Modal>;
export default CampaignInquiriesPage;