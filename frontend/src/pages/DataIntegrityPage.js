import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw, Search, ShieldCheck, ExternalLink } from 'lucide-react';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { dataIntegrityAPI, branchesAPI } from '../services/api';

const reasonText = {
  level_deleted: 'حُذف المستوى السابق',
  removed_from_level: 'أُزيل العضو من المستوى',
  renewal_reset: 'أُلغي ربط المستوى عند تجديد الاشتراك',
  branch_transfer: 'نُقل العضو إلى فرع آخر',
  new_subscription: 'اشتراك جديد لم يُعيَّن له مستوى',
  invoice_not_linked: 'مستوى مذكور بالفاتورة ولم يُربط بالاشتراك',
  never_assigned: 'لا يظهر تعيين سابق للمستوى',
};
const invoiceReason = {
  invoice_without_member: 'فاتورة نشاط بلا عضو مرتبط',
  invoice_item_without_member: 'أحد أنشطة الفاتورة بلا عضو مرتبط',
  invoice_member_not_found: 'رقم العضو المرتبط بالفاتورة غير موجود',
};

export default function DataIntegrityPage() {
  const { selectedBranchId, isAdmin } = useAuth();
  const { language } = useLanguage();
  const ar = language === 'ar';
  const [data, setData] = useState(null);
  const [branches, setBranches] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('unassigned');
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const response = await dataIntegrityAPI.get(params);
      setData(response.data);
    } catch (err) {
      setError(err.response?.data?.detail || (ar ? 'تعذّر تحميل فحص البيانات' : 'Could not load data checks'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, ar]);

  useEffect(() => { if (isAdmin) refresh(); }, [isAdmin, refresh]);
  useEffect(() => {
    branchesAPI.getAll().then(({ data: rows }) => {
      const byId = {};
      (Array.isArray(rows) ? rows : rows?.branches || []).forEach(row => { byId[row.id] = row.name_ar || row.name || row.id; });
      setBranches(byId);
    }).catch(() => {});
  }, []);

  const unassigned = data?.unassigned_members || [];
  const invoices = data?.invoice_issues || [];
  const references = data?.level_reference_issues || [];
  const counts = { unassigned: unassigned.length, invoices: invoices.length, references: references.length };
  const rows = useMemo(() => {
    const source = tab === 'unassigned' ? unassigned : tab === 'invoices' ? invoices : references;
    const q = search.trim().toLowerCase();
    return q ? source.filter(row => JSON.stringify(row).toLowerCase().includes(q)) : source;
  }, [tab, search, unassigned, invoices, references]);
  const branchName = id => branches[id] || (id || (ar ? 'غير محدد' : 'Unspecified'));
  const tabs = [
    { id: 'unassigned', ar: 'اشتراكات بلا مستوى', en: 'Subscriptions without level' },
    { id: 'invoices', ar: 'روابط الفواتير', en: 'Invoice links' },
    { id: 'references', ar: 'مراجع مستويات غير موجودة', en: 'Missing level references' },
  ];

  return <Layout><main className="max-w-6xl mx-auto p-4 md:p-8 space-y-5" dir={ar ? 'rtl' : 'ltr'}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="text-orange-600" />{ar ? 'سلامة البيانات' : 'Data integrity'}</h1>
        <p className="text-sm text-slate-500 mt-1">{ar ? 'مراجعة المشكلات المؤكدة في الاشتراكات والفواتير، مع فتح السجل لتصحيحها يدويًا.' : 'Review subscription and invoice issues, then open the affected record to correct it.'}</p>
      </div>
      <button type="button" onClick={refresh} disabled={loading} className="inline-flex items-center gap-2 border rounded-lg px-4 py-2 bg-white hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={16} />{ar ? 'تحديث الفحص' : 'Refresh check'}</button>
    </div>
    {!isAdmin && <div className="bg-amber-50 p-4 rounded-lg">{ar ? 'هذه الصفحة للمدير فقط.' : 'Administrator access required.'}</div>}
    {error && <div className="border border-red-200 bg-red-50 text-red-800 rounded-lg p-3">{String(error)}</div>}
    {loading && <div className="text-slate-500">{ar ? 'جارٍ فحص السجلات...' : 'Checking records...'}</div>}
    {!loading && data && <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {tabs.map(item => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`text-start rounded-xl border p-4 bg-white ${tab === item.id ? 'border-orange-500 ring-1 ring-orange-500' : 'border-slate-200'}`}>
          <div className="text-sm text-slate-500">{ar ? item.ar : item.en}</div><div className="text-3xl font-bold mt-1">{counts[item.id]}</div>
        </button>)}
      </div>
      <p className="text-xs text-slate-500">{ar ? 'الفحص للقراءة فقط. سبب عدم التعيين مستنتج من سجل التعديلات وقد يحتاج تأكيدًا قبل التصحيح.' : 'Read-only check. Assignment reasons are inferred from history and should be confirmed before correction.'}</p>
      <div className="relative"><Search size={16} className={`absolute top-3 text-slate-400 ${ar ? 'right-3' : 'left-3'}`} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder={ar ? 'ابحث باسم العضو أو الرقم أو النشاط...' : 'Search name, code, activity...'} className={`w-full rounded-lg border bg-white py-2 ${ar ? 'pr-10 pl-3' : 'pl-10 pr-3'}`} /></div>
      <div className="space-y-3">
        {!rows.length && <div className="rounded-xl bg-white border p-10 text-center text-slate-500">{ar ? 'لا توجد مشكلات مطابقة لهذا العرض' : 'No matching issues'}</div>}
        {tab === 'unassigned' && rows.map(member => <article key={member.id} className="rounded-xl border bg-white p-4 flex flex-wrap justify-between gap-3">
          <div><div className="font-semibold">{member.name || member.member_code}</div><div className="text-xs text-slate-500">{member.member_code} · {branchName(member.branch_id)}</div>
            {(member.unassigned_activities || []).map((activity, index) => <div key={`${activity.activity_id || activity.activity_name}-${index}`} className="mt-2 text-sm"><span className="font-medium">{activity.activity_name || (ar ? 'نشاط' : 'Activity')}</span> — {ar ? 'اشتراك ساري بلا مستوى' : 'Active subscription without a level'}<span className="block text-xs text-amber-700">{reasonText[activity.reason?.code] || (ar ? 'لم يتضح سبب التعيين المفقود' : 'Assignment reason unknown')}{activity.reason?.date ? ` · ${activity.reason.date}` : ''}</span></div>)}
          </div><div className="flex gap-2 items-start"><Link className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm" to={`/admin/members?focus=${encodeURIComponent(member.id)}`}><ExternalLink size={14} />{ar ? 'عرض العضو' : 'Open member'}</Link><Link className="rounded-lg bg-orange-600 text-white px-3 py-2 text-sm" to="/admin/levels">{ar ? 'تعيين مستوى' : 'Assign level'}</Link></div>
        </article>)}
        {tab === 'invoices' && rows.map((invoice, index) => <article key={`${invoice.invoice_id}-${index}`} className="rounded-xl border bg-white p-4 flex flex-wrap justify-between gap-3"><div><div className="font-semibold">{ar ? 'فاتورة' : 'Invoice'} {invoice.invoice_number || invoice.invoice_id}</div><div className="text-xs text-slate-500">{invoice.name} · {branchName(invoice.branch_id)} · {invoice.created_at}</div><p className="text-sm text-amber-700 mt-2 flex items-center gap-1"><AlertTriangle size={14} />{invoiceReason[invoice.kind] || invoice.kind}</p></div><Link className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm h-fit" to={`/admin/invoices?view=${encodeURIComponent(invoice.invoice_id)}`}><ExternalLink size={14} />{ar ? 'عرض الفاتورة' : 'Open invoice'}</Link></article>)}
        {tab === 'references' && rows.map((item, index) => <article key={`${item.member_id}-${index}`} className="rounded-xl border bg-white p-4 flex flex-wrap justify-between gap-3"><div><div className="font-semibold">{item.member_name || item.member_code}</div><div className="text-xs text-slate-500">{item.member_code} · {branchName(item.branch_id)}</div><p className="text-sm text-amber-700 mt-2">{ar ? `النشاط «${item.activity_name}» يشير إلى مستوى غير موجود (${item.level_id})` : `Activity ${item.activity_name} references a missing level (${item.level_id})`}</p></div><Link className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm h-fit" to={`/admin/members?focus=${encodeURIComponent(item.member_id)}`}><ExternalLink size={14} />{ar ? 'عرض العضو' : 'Open member'}</Link></article>)}
      </div>
    </>}
  </main></Layout>;
}
