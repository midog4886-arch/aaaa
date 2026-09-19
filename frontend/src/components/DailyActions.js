import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowUpRight, CalendarClock, ChevronRight, ClipboardCheck, MessageSquareText, RefreshCcw, ShieldAlert, UserRoundX, X } from 'lucide-react';
import { dashboardAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

const COPY = {
  expiring: { ar: ['تجديدات قريبة', 'اشتراكات تنتهي خلال ٧ أيام ولم تُجدّد بعد'], en: ['Renewals due', 'Subscriptions ending in the next 7 days that have not been renewed'] },
  absence: { ar: ['غياب يحتاج متابعة', '٣ حالات غياب مسجلة أو أكثر خلال آخر ٣٠ يوماً'], en: ['Attendance follow-up', '3 or more recorded absences in the last 30 days'] },
  registrations: { ar: ['طلبات تسجيل معلّقة', 'طلبات بانتظار المراجعة'], en: ['Pending registrations', 'Requests waiting for review'] },
  conversations: { ar: ['آخر المحادثات الواردة', 'آخر رسائل واردة — ليست عدّاد رسائل غير مقروءة'], en: ['Latest inbound', 'Latest inbound messages — not an unread counter'] },
  failures: { ar: ['عمليات فاشلة مؤكدة', 'مدفوعات أو عمليات إرسال فشلت خلال آخر ٧ أيام'], en: ['Confirmed failures', 'Failed payments or sends from the last 7 days'] },
};

const iconFor = key => ({ expiring: CalendarClock, absence: UserRoundX, registrations: ClipboardCheck, conversations: MessageSquareText, failures: ShieldAlert })[key] || AlertCircle;
// Requests are retained only while active. This prevents StrictMode and a
// quick unmount/remount from duplicating a scoped read without persisting any
// user or branch data beyond the request itself.
const inFlightActionRequests = new Map();

const getActionsRequest = (identity, params) => {
  let request = inFlightActionRequests.get(identity);
  if (!request) {
    request = Promise.resolve().then(() => dashboardAPI.getActions(params));
    inFlightActionRequests.set(identity, request);
    request.then(
      () => {
        if (inFlightActionRequests.get(identity) === request) inFlightActionRequests.delete(identity);
      },
      () => {
        if (inFlightActionRequests.get(identity) === request) inFlightActionRequests.delete(identity);
      },
    );
  }
  return request;
};

export const pageFor = (key, item) => {
  if (key === 'expiring') return '/admin/renewals';
  if (item?.kind === 'payment' || item?.kind === 'failed_payment' || item?.kind === 'billing_payment') return '/admin/settings#billing';
  if (item?.kind === 'whatsapp' || item?.kind === 'failed_send' || key === 'conversations') return '/admin/whatsapp';
  if (item?.kind === 'registration_request' || key === 'registrations') return '/admin/registration-requests';
  if (item?.kind === 'attendance' || key === 'absence') return '/admin/attendance';
  if (item?.kind === 'invoice' || key === 'failures') return '/admin/invoices';
  return '/admin/members';
};

export default function DailyActions() {
  const { language } = useLanguage();
  const { selectedBranchId, switchBranch, user, token } = useAuth();
  const branchKey = selectedBranchId && selectedBranchId !== 'all' ? selectedBranchId : 'all';
  const authKey = token || user?.id || user?.username || 'current';
  const identity = `${authKey}:${branchKey}`;
  const requestRef = useRef(0);
  const mountedRef = useRef(false);
  const [state, setState] = useState({ loading: true, error: false, groups: [], generatedAt: null });
  const [openKey, setOpenKey] = useState(null);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setState(previous => ({ ...previous, loading: true, error: false }));
    const params = branchKey === 'all' ? {} : { branch_filter: branchKey };
    getActionsRequest(identity, params)
      .then(res => {
        if (!mountedRef.current || request !== requestRef.current) return;
        const data = res?.data || {};
        setState({ loading: false, error: false, groups: Array.isArray(data.groups) ? data.groups : [], generatedAt: data.generated_at || null });
      })
      .catch(() => {
        if (mountedRef.current && request === requestRef.current) setState(previous => ({ ...previous, loading: false, error: true }));
      });
  }, [branchKey, identity]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);
  useEffect(() => {
    setOpenKey(null);
    // A branch/auth scope change must not leave the former scope's cards
    // visible while the new scoped request is loading.
    setState({ loading: true, error: false, groups: [], generatedAt: null });
    load();
    return () => { requestRef.current += 1; };
  }, [load, identity]);
  useEffect(() => {
    let interval;
    const updatePolling = () => {
      if (interval) clearInterval(interval);
      interval = undefined;
      if (document.visibilityState === 'visible') interval = setInterval(load, 60000);
    };
    updatePolling();
    document.addEventListener('visibilitychange', updatePolling);
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', updatePolling);
    };
  }, [load]);

  const go = item => {
    if (item.branch_id && branchKey === 'all' && typeof switchBranch === 'function') switchBranch(item.branch_id);
    window.location.assign(pageFor(openKey, item));
  };
  const label = (key, index) => COPY[key]?.[language] || COPY[key]?.en || [key, ''];
  const groups = state.groups;
  const openGroup = groups.find(group => group.key === openKey) || null;
  const hasGroupError = groups.some(group => group.status === 'error');
  const refreshLabel = hasGroupError
    ? (language === 'ar' ? 'إعادة المحاولة' : 'Retry unavailable')
    : (state.error ? (language === 'ar' ? 'إعادة التحديث' : 'Retry refresh') : (language === 'ar' ? 'تحديث' : 'Refresh'));

  return (
    <section className="daily-actions" aria-labelledby="daily-actions-title" data-testid="daily-actions">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">{language === 'ar' ? 'سير العمل اليومي' : 'Daily workflow'}</p>
          <h2 id="daily-actions-title" className="text-xl font-bold">{language === 'ar' ? 'ما الذي يحتاج انتباهك؟' : 'What needs attention?'}</h2>
        </div>
        <div className="flex items-center gap-2">{state.error && groups.length > 0 && <span role="status" className="text-xs text-destructive">{language === 'ar' ? 'تعذر التحديث؛ البيانات السابقة ما زالت معروضة.' : 'Refresh failed; previous data is still shown.'}</span>}<Button variant="outline" size="sm" onClick={load} disabled={state.loading} aria-label={hasGroupError || state.error ? refreshLabel : (language === 'ar' ? 'تحديث الإجراءات اليومية' : 'Refresh daily actions')}><RefreshCcw className={`w-4 h-4 mr-2 ${state.loading ? 'animate-spin' : ''}`} />{refreshLabel}</Button>{state.generatedAt && <span className="text-xs text-muted-foreground">{language === 'ar' ? 'تم التحديث' : 'Updated'} {new Date(state.generatedAt).toLocaleTimeString(language === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>}</div>
      </div>
      {state.loading && groups.length === 0 ? <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3" aria-label={language === 'ar' ? 'جارٍ تحميل الإجراءات' : 'Loading actions'}>{[1,2,3,4,5].map(n => <div key={n} className="h-28 rounded-xl bg-muted animate-pulse" />)}</div> : state.error && groups.length === 0 ? (
        <Card className="border-destructive/30"><CardContent className="py-5 flex flex-wrap gap-3 items-center justify-between"><span>{language === 'ar' ? 'تعذر تحميل الإجراءات اليومية.' : 'Daily actions could not be loaded.'}</span><Button variant="outline" size="sm" onClick={load}><RefreshCcw className="w-4 h-4 mr-2" />{language === 'ar' ? 'إعادة المحاولة' : 'Retry'}</Button></CardContent></Card>
      ) : groups.length === 0 ? <Card className="border-dashed"><CardContent className="py-6 text-sm text-muted-foreground">{language === 'ar' ? 'لا توجد إجراءات متاحة ضمن صلاحياتك أو نطاق الفرع الحالي.' : 'No daily actions are available for your permissions or current branch.'}</CardContent></Card> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {groups.map(group => {
            const Icon = iconFor(group.key); const text = label(group.key);
            const unavailable = group.status === 'error' || group.count === null;
            return <button type="button" key={group.key} onClick={() => !unavailable && setOpenKey(group.key)} className="text-start rounded-xl border bg-card p-4 hover:border-primary/50 hover:-translate-y-0.5 transition-transform disabled:opacity-60" disabled={unavailable} aria-label={`${text[0]}: ${unavailable ? (language === 'ar' ? 'غير متاح' : 'Unavailable') : group.count}`}>
              <div className="flex justify-between gap-2"><Icon className="w-5 h-5 text-primary" /><ChevronRight className="w-4 h-4 text-muted-foreground rtl:rotate-180" /></div>
              <strong className="block text-2xl mt-3">{unavailable ? '—' : group.count}</strong><span className="block text-sm font-semibold mt-1">{text[0]}</span><span className="block text-xs text-muted-foreground mt-1 leading-relaxed">{group.status === 'error' ? (language === 'ar' ? 'غير متاح حالياً — أعد المحاولة' : 'Unavailable right now — retry') : (group.note || text[1])}</span>
            </button>;
          })}
        </div>
      )}
      {openGroup && createPortal(<div role="dialog" aria-modal="true" aria-labelledby="daily-actions-dialog-title" dir={language === 'ar' ? 'rtl' : 'ltr'} className="fixed inset-0 z-50 bg-black/35 flex items-end md:items-center justify-center p-3" onMouseDown={() => setOpenKey(null)}>
        <Card className="w-full max-w-2xl max-h-[80dvh] flex flex-col overflow-hidden" onMouseDown={event => event.stopPropagation()}><CardContent className="p-0 flex flex-col min-h-0">
          <div className="shrink-0 bg-card border-b px-5 py-4 flex items-center justify-between"><div><h3 id="daily-actions-dialog-title" className="font-bold">{label(openGroup.key)[0]}</h3><p className="text-xs text-muted-foreground">{label(openGroup.key)[1]}</p></div><Button variant="ghost" size="icon" onClick={() => setOpenKey(null)} aria-label={language === 'ar' ? 'إغلاق' : 'Close'}><X className="w-4 h-4" /></Button></div>
          <div className="p-3 space-y-2 min-h-0 overflow-y-auto overscroll-contain" tabIndex={0} aria-label={label(openGroup.key)[0]}>{openGroup.items?.length ? openGroup.items.map(item => <div key={item.id} className="border rounded-lg p-3 flex gap-3 items-center justify-between"><div><strong className="text-sm">{item.title}</strong><span className="block text-xs text-muted-foreground mt-1">{item.detail}</span>{openGroup.key === 'failures' && ['payment', 'failed_payment', 'billing_payment'].includes(item.kind) && <span className="block text-xs text-amber-700 mt-1">{language === 'ar' ? 'حدث فوترة على مستوى الأكاديمية' : 'Academy-wide billing event'}</span>}</div><Button size="sm" variant="outline" onClick={() => go(item)}>{language === 'ar' ? 'فتح' : 'Open'}<ArrowUpRight className="w-3 h-3 ml-1" /></Button></div>) : <p className="p-5 text-sm text-muted-foreground">{language === 'ar' ? 'لا توجد عناصر لعرضها.' : 'There are no items to show.'}</p>}{openGroup.has_more && <p className="px-2 py-2 text-xs text-muted-foreground">{language === 'ar' ? 'هذه قائمة مختصرة من العناصر المطابقة.' : 'This is a shortened list of matching items.'}</p>}</div>
        </CardContent></Card>
      </div>, document.body)}
    </section>
  );
}