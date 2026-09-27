import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, CalendarDays, FileText, Receipt, StickyNote } from 'lucide-react';
import { membersAPI } from '../../services/api';

const copy = (ar, en, language) => language === 'ar' ? ar : en;
const date = (value, language) => value ? new Date(`${value}`.includes('T') ? value : `${value}T00:00:00`).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-GB') : '—';

export default function ProfileOverview({ member, attendance, canViewFinancial, canViewAttendance, language, onTab, scopeKey }) {
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    const generation = ++request.current;
    setSummary(null); setSummaryError(false);
    if (!canViewFinancial) return undefined;
    membersAPI.getProfileSummary(member.id).then(response => {
      if (generation === request.current) setSummary(response.data || {});
    }).catch(() => { if (generation === request.current) setSummaryError(true); });
    return () => { request.current += 1; };
  }, [member.id, scopeKey, canViewFinancial]);
  const latestByActivity = items => Object.values(items.reduce((acc, item) => {
    const key = item.activity_id || item.activity_name;
    if (!acc[key] || new Date(item.end_date || 0) > new Date(acc[key].end_date || 0)) acc[key] = item;
    return acc;
  }, {}));
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const todayRiyadh = `${parts.year}-${parts.month}-${parts.day}`;
  const day = value => String(value || '').slice(0, 10);
  const available = (member.activities || []).filter(item => item.status === 'active' && (!item.end_date || day(item.end_date) >= todayRiyadh));
  const active = latestByActivity(available.filter(item => !item.start_date || day(item.start_date) <= todayRiyadh));
  const upcoming = latestByActivity(available.filter(item => day(item.start_date) > todayRiyadh)).sort((a, b) => day(a.start_date).localeCompare(day(b.start_date)));
  const nextEnd = active.sort((a, b) => new Date(a.end_date || '9999-12-31') - new Date(b.end_date || '9999-12-31'))[0];
  const subscriptionLabel = [
    active.length ? `${active.length} ${copy('نشط', 'active', language)}` : '',
    upcoming.length ? `${upcoming.length} ${copy('قادم — لم يبدأ بعد', 'upcoming — not started yet', language)}` : '',
  ].filter(Boolean).join(' · ') || copy('لا يوجد اشتراك نشط', 'No active subscription', language);
  const quick = [
    { key: 'activities', icon: Activity, label: copy('الاشتراكات', 'Subscriptions', language), value: subscriptionLabel },
    { key: 'attendance', icon: CalendarDays, label: copy('الحضور', 'Attendance', language), value: canViewAttendance ? (attendance?.summary ? `${attendance.summary.present_count ?? attendance.summary.attendance_count ?? 0} ${copy('حضور', 'present', language)}` : '—') : copy('غير متاح', 'Not available', language), allowed: canViewAttendance },
    { key: 'invoices', icon: Receipt, label: copy('الفواتير المدفوعة المرتبطة', 'Linked paid invoices', language), value: canViewFinancial ? (summary?.paid_invoice_count == null ? '—' : `${summary.paid_invoice_count} ${copy('فاتورة', 'invoices', language)}`) : copy('غير متاح', 'Not available', language), allowed: canViewFinancial },
  ];
  return <div className="space-y-5" data-testid="member-profile-overview">
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{copy('لقطة العضو', 'Member snapshot', language)}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><p className="text-sm text-muted-foreground">{nextEnd || !upcoming.length ? copy('أقرب انتهاء', 'Next expiry', language) : copy('بداية الاشتراك القادم', 'Next subscription starts', language)}</p><p className="font-semibold">{nextEnd ? date(nextEnd.end_date, language) : upcoming.length ? date(upcoming[0].start_date, language) : copy('لا يوجد', 'None', language)}</p></div>
        <div><p className="text-sm text-muted-foreground">{active.length || !upcoming.length ? copy('الجدول الحالي', 'Current schedule', language) : copy('الجدول القادم', 'Upcoming schedule', language)}</p><p className="font-semibold">{(active.length ? active : upcoming).map(a => a.schedule || a.activity_name).filter(Boolean).join(' · ') || '—'}</p></div>
      </div>
      {upcoming.length > 0 && <div className="mt-4 space-y-2 border-t border-primary/20 pt-3">
        <p className="text-sm font-semibold">{copy('الاشتراكات القادمة — لم تبدأ بعد', 'Upcoming subscriptions — not started yet', language)}</p>
        {upcoming.map((item, index) => <div key={`${item.activity_id}-${index}`} className="text-sm">
          <p className="font-semibold">{item.activity_name}</p>
          <p className="text-muted-foreground">{copy('البداية', 'Starts', language)}: {date(item.start_date, language)} · {copy('النهاية', 'Ends', language)}: {date(item.end_date, language)}</p>
          {item.schedule && <p>{item.schedule}</p>}
        </div>)}
      </div>}
    </section>
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={() => onTab('timeline')} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">{copy('عرض التسلسل الزمني', 'View timeline', language)}</button>
      <button type="button" onClick={() => onTab('info')} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">{copy('بيانات العضو', 'Member details', language)}</button>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      {quick.map(({ key, icon: Icon, label, value, allowed = true }) => <button key={key} type="button" disabled={!allowed} onClick={() => allowed && onTab(key)} className="rounded-xl border bg-card p-4 text-start transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-65">
        <Icon className="mb-3 h-4 w-4 text-primary" /><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p>
      </button>)}
    </div>
    {canViewFinancial && (summaryError || summary?.errors?.length > 0) && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="me-2 inline h-4 w-4" />{copy('بعض بيانات الملخص المالي غير متاحة.', 'Some financial summary data is unavailable.', language)}</div>}
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3"><div><p className="font-semibold">{copy('ملاحظات الاستقبال', 'Reception notes', language)}</p><p className="mt-1 text-sm text-muted-foreground">{member.notes || copy('لا توجد ملاحظات مسجلة.', 'No notes recorded.', language)}</p></div>
        <button type="button" onClick={() => onTab('info')} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"><StickyNote className="h-4 w-4" />{copy('فتح وتعديل', 'Open & edit', language)}</button>
      </div>
    </section>
    <button type="button" onClick={() => onTab('history')} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><FileText className="h-4 w-4" />{copy('عرض سجل التجديدات الكامل', 'View full renewal history', language)}</button>
  </div>;
}
