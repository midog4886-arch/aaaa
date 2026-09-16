import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';
import { membersAPI } from '../../services/api';

const text = (item, language, field) => item[`${field}_${language}`] || item[`${field}_${language === 'ar' ? 'en' : 'ar'}`] || '';
const format = (value, language) => value ? new Date(value).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-GB') : '—';
const safeValue = (value, language) => value === null || value === undefined || value === '' ? (language === 'ar' ? 'محجوب / غير متاح' : 'Withheld / not available') : typeof value === 'string' || typeof value === 'number' ? String(value) : (language === 'ar' ? 'غير متاح' : 'Not available');
const targetTabs = new Set(['overview', 'info', 'activities', 'invoices', 'history', 'attendance', 'purchases', 'tournaments', 'reminders', 'freeze', 'timeline', 'messages']);

export default function ProfileFeed({ memberId, kind, language, scopeKey, onTab }) {
  const [state, setState] = useState({ items: [], loading: true, error: false, more: false, offset: 0, errors: [] });
  const generation = useRef(0);
  const labels = kind === 'history'
    ? { title: language === 'ar' ? 'الخط الزمني للعضو' : 'Member timeline', empty: language === 'ar' ? 'لا توجد أحداث متاحة.' : 'No events available.' }
    : { title: language === 'ar' ? 'رسائل العضو والطلبات' : 'Member messages & requests', empty: language === 'ar' ? 'لا توجد رسائل أو طلبات متاحة.' : 'No messages or requests available.' };
  const load = async (offset = 0) => {
    const current = ++generation.current;
    setState(old => ({ ...old, loading: true, error: false }));
    try {
      const response = await (kind === 'history' ? membersAPI.getProfileHistory(memberId, { offset, limit: 20 }) : membersAPI.getProfileMessages(memberId, { offset, limit: 20 }));
      const data = response.data || {};
      if (current !== generation.current) return;
      setState(old => ({ items: offset ? [...old.items, ...(data.items || [])] : (data.items || []), loading: false, error: false, more: Boolean(data.has_more), offset: data.offset ?? offset, errors: data.errors || [] }));
    } catch (error) {
      if (current !== generation.current) return;
      setState(old => ({ ...old, loading: false, error: true }));
    }
  };
  useEffect(() => { generation.current += 1; setState({ items: [], loading: true, error: false, more: false, offset: 0, errors: [] }); load(0); /* generation clears member/branch/auth stale responses */ }, [memberId, kind, scopeKey]);
  return <section className="space-y-3" data-testid={`member-profile-${kind}`}>
    <h3 className="font-semibold">{labels.title}</h3>
    {state.loading && !state.items.length && <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div>}
    {state.error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><AlertTriangle className="me-2 inline h-4 w-4" />{language === 'ar' ? 'تعذر تحميل البيانات.' : 'Could not load data.'}<button type="button" onClick={() => load(0)} className="ms-3 font-medium underline">{language === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button></div>}
    {!state.loading && !state.error && state.errors.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="me-2 inline h-4 w-4" />{language === 'ar' ? 'بعض مصادر السجل غير متاحة حالياً.' : 'Some profile sources are currently unavailable.'}</div>}
    {!state.loading && !state.error && !state.items.length && <div className="rounded-lg border border-dashed p-7 text-center text-sm text-muted-foreground">{labels.empty}</div>}
    {state.items.map(item => <article key={item.id} className="border-s-2 border-primary/30 ps-4 py-2">
      <div className="flex items-start justify-between gap-3"><p className="font-medium">{kind === 'history' ? text(item, language, 'title') : item.subject}</p><span className="shrink-0 text-xs text-muted-foreground">{format(item.occurred_at || item.created_at, language)}</span></div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{kind === 'history' ? text(item, language, 'detail') : item.body}</p>
      {kind === 'history' && targetTabs.has(item.target_tab) && <button type="button" onClick={() => onTab && onTab(item.target_tab)} className="mt-2 text-xs font-medium text-primary hover:underline">{language === 'ar' ? 'فتح القسم المرتبط' : 'Open related section'}</button>}
      {kind === 'messages' && <><p className="mt-2 text-xs font-medium text-primary">{['change_request', 'profile_change_request'].includes(item.kind) ? (language === 'ar' ? `طلب تعديل: ${{ pending: 'قيد المراجعة', applied: 'تم التطبيق', rejected: 'مرفوض' }[item.status] || item.status || 'قيد المراجعة'}` : `Change request: ${item.status || 'pending'}`) : (language === 'ar' ? 'رسالة داخلية للعضو' : 'Internal member message')}</p>
        {item.changes && <dl className="mt-2 space-y-1 rounded bg-muted/60 p-2 text-xs text-muted-foreground"><div><dt className="font-medium">{language === 'ar' ? (item.changes.label_ar || item.changes.field || 'الحقل') : (item.changes.label_en || item.changes.field || 'Field')}</dt></div><div><dt className="inline font-medium">{language === 'ar' ? 'الحالي: ' : 'Current: '}</dt><dd className="inline">{safeValue(item.changes.current_value, language)}</dd></div><div><dt className="inline font-medium">{language === 'ar' ? 'المطلوب: ' : 'Requested: '}</dt><dd className="inline">{safeValue(item.changes.new_value, language)}</dd></div>{item.changes.reason !== undefined && <div><dt className="inline font-medium">{language === 'ar' ? 'السبب: ' : 'Reason: '}</dt><dd className="inline">{safeValue(item.changes.reason, language)}</dd></div>}</dl>}
      </>}
    </article>)}
    {state.more && <button type="button" disabled={state.loading} onClick={() => load(state.offset + 20)} className="mx-auto flex items-center gap-2 text-sm font-medium text-primary disabled:opacity-50">{state.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}{language === 'ar' ? 'تحميل المزيد' : 'Load more'}</button>}
  </section>;
}