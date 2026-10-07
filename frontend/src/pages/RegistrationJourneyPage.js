import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, Clock3, RefreshCw } from 'lucide-react';
import { Layout } from '../components/Layout';
import { registrationRequestsAPI, branchesAPI } from '../services/api';

const STEPS = [
  { key: 'request_received', label: 'استلام طلب التسجيل', detail: 'بيانات ولي الأمر واللاعب وصلت إلى النظام.' },
  { key: 'contacted', label: 'التواصل والمراجعة', detail: 'تأكيد النشاط والفرع والموعد مع ولي الأمر.' },
  { key: 'member_linked', label: 'إنشاء ملف العضو', detail: 'ربط كل نشاط في الفاتورة بعضوه، بما في ذلك الإخوة.' },
  { key: 'invoice_created', label: 'إنشاء الفاتورة', detail: 'فاتورة مرتبطة بطلب التسجيل.' },
  { key: 'level_selected', label: 'اختيار المستوى', detail: 'تحديد مستوى لكل نشاط قبل إصدار الفاتورة.' },
  { key: 'paid', label: 'تأكيد السداد', detail: 'تسجيل الدفع في الفاتورة.' },
  { key: 'card_printed', label: 'طباعة كرت العضوية', detail: 'توثيق طباعة الكرت لكل عضو مرتبط.' },
];

export default function RegistrationJourneyPage() {
  const { requestId } = useParams();
  const [journey, setJourney] = useState(null);
  const [branchName, setBranchName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await registrationRequestsAPI.getJourney(requestId);
      setJourney(data);
    } catch (err) {
      setError(err.response?.data?.detail || 'تعذّر فتح مسار التسجيل');
      setJourney(null);
    } finally {
      setLoading(false);
    }
  }, [requestId]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    branchesAPI.getAll().then(({ data }) => {
      const rows = Array.isArray(data) ? data : data?.branches || [];
      const branch = rows.find(row => row.id === journey?.request?.branch_id);
      setBranchName(branch?.name_ar || branch?.name || '');
    }).catch(() => {});
  }, [journey?.request?.branch_id]);

  const invoice = journey?.invoice;
  const steps = journey?.steps || {};
  const finished = Boolean(steps.paid && steps.level_selected && steps.member_linked && steps.card_printed);
  const requestSearch = (journey?.request?.id || requestId).slice(0, 8);
  const requestUrl = `/admin/registration-requests?status=all&search=${encodeURIComponent(requestSearch)}`;
  const nextStep = STEPS.find(step => !steps[step.key] && !(step.key === 'contacted' && steps.invoice_created));
  const nextAction = !invoice || !steps.member_linked || (!steps.contacted && !steps.invoice_created)
    ? { url: requestUrl, label: 'فتح الطلب وإكمال البيانات' }
    : !steps.level_selected
      ? { url: '/admin/levels', label: 'فتح المستويات' }
      : !steps.paid
        ? { url: `/admin/invoices?view=${encodeURIComponent(invoice.id)}`, label: 'فتح الفاتورة وتسجيل الدفع' }
        : { url: '/admin/daily-new-cards', label: 'فتح صفحة الكروت' };

  return <Layout><main className="max-w-5xl mx-auto p-4 md:p-8 space-y-5" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><Link to={requestUrl} className="text-sm text-blue-700 inline-flex items-center gap-1"><ArrowRight size={15} />طلبات التسجيل</Link>
        <h1 className="text-2xl font-bold mt-2">مسار التسجيل من البداية للنهاية</h1>
        <p className="text-sm text-slate-500 mt-1">ملف واحد يوضح ما تم وما الخطوة التالية، اعتمادًا على الطلب والفاتورة والكرت الفعلي.</p>
      </div>
      <button type="button" onClick={refresh} disabled={loading} className="rounded-lg border bg-white px-4 py-2 inline-flex items-center gap-2 disabled:opacity-50"><RefreshCw size={16} />تحديث الحالة</button>
    </div>
    {loading && <div className="rounded-xl border bg-white p-8 text-slate-500">جارٍ تحميل مسار التسجيل...</div>}
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{String(error)}</div>}
    {!loading && journey && <>
      <div className="rounded-xl border bg-white p-5 flex flex-wrap justify-between gap-4">
        <div><div className="text-xs text-slate-500">اللاعب</div><div className="text-xl font-bold">{journey.request.customer_name || '—'}</div><div className="text-sm text-slate-500 mt-1">{branchName || journey.request.branch_id} · {journey.request.activity_name || 'لم يُحدد النشاط'}</div></div>
        <div className="text-sm text-slate-600"><div>طلب #{requestSearch.toUpperCase()}</div><div>{journey.request.created_at?.slice(0, 10)}</div>{invoice && <div>فاتورة #{invoice.invoice_number || invoice.id?.slice(0, 8)}</div>}</div>
      </div>
      {finished && <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 font-semibold">اكتمل التسجيل والسداد وتوثيق طباعة كرت العضوية.</div>}
      {!finished && <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-900 flex flex-wrap items-center justify-between gap-3"><span>الخطوة التالية: <strong>{nextStep?.label || 'راجع بيانات الطلب'}</strong></span><Link to={nextAction.url} className="rounded-lg bg-amber-700 text-white px-4 py-2 text-sm">{nextAction.label}</Link></div>}
      <div className="rounded-xl border bg-white divide-y">
        {STEPS.map((step, index) => {
          const done = Boolean(steps[step.key]);
          const skipped = step.key === 'contacted' && !done && steps.invoice_created;
          return <div key={step.key} className="flex gap-3 p-4 items-start">
            <span className={`shrink-0 rounded-full w-8 h-8 inline-flex items-center justify-center ${done ? 'bg-emerald-100 text-emerald-700' : skipped ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'}`}>{done ? <CheckCircle2 size={18} /> : skipped ? <Clock3 size={18} /> : <Circle size={18} />}</span>
            <div className="flex-1"><div className="font-semibold">{index + 1}. {step.label}</div><div className="text-sm text-slate-500">{step.detail}</div></div>
            <span className={`text-xs rounded-full px-2 py-1 ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{done ? 'تم' : skipped ? 'تم الانتقال للفاتورة' : 'بانتظار الإكمال'}</span>
          </div>;
        })}
      </div>
      {journey.members.length > 0 && <section className="rounded-xl border bg-white p-5"><h2 className="font-bold mb-3">الأعضاء المرتبطون</h2><div className="space-y-2">{journey.members.map(member => <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3"><div><strong>{member.name || member.member_code}</strong><span className="text-sm text-slate-500 mr-2">{member.member_code}</span><div className="text-xs text-slate-500">{member.card_printed_at ? `طُبع الكرت: ${member.card_printed_at.slice(0, 10)}` : 'لم تُسجّل طباعة الكرت بعد'}</div></div><Link className="rounded-lg border px-3 py-2 text-sm" to={`/admin/members?focus=${encodeURIComponent(member.id)}`}>فتح العضو</Link></div>)}</div></section>}
      <div className="flex flex-wrap gap-2">
        <Link to={requestUrl} className="rounded-lg bg-blue-700 text-white px-4 py-2 text-sm">فتح الطلب والمتابعة</Link>
        {invoice && <Link to={`/admin/invoices?view=${encodeURIComponent(invoice.id)}`} className="rounded-lg border bg-white px-4 py-2 text-sm">فتح الفاتورة والدفع</Link>}
        {invoice && <Link to="/admin/levels" className="rounded-lg border bg-white px-4 py-2 text-sm">فتح المستويات</Link>}
        {steps.paid && <Link to="/admin/daily-new-cards" className="rounded-lg border bg-white px-4 py-2 text-sm">فتح كروت العضوية اليومية</Link>}
      </div>
      <p className="text-xs text-slate-500">تظهر حالة «طُبع الكرت» بعد توثيق الطباعة من صفحة الكروت. هذه الشاشة لا تغيّر بيانات العضو أو الفاتورة تلقائيًا.</p>
    </>}
  </main></Layout>;
}
