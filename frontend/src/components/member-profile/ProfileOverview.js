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
  const latestByActivity = Object.values((member.activities || []).reduce((acc, item) => {
    if (!acc[item.activity_id] || new Date(item.end_date || 0) > new Date(acc[item.activity_id].end_date || 0)) acc[item.activity_id] = item;
    return acc;
  }, {}));
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const todayRiyadh = `${parts.year}-${parts.month}-${parts.day}`;
  const active = latestByActivity.filter(item => item.status === 'active' && (!item.start_date || item.start_date <= todayRiyadh) && (!item.end_date || item.end_date >= todayRiyadh));
  const nextEnd = active.sort((a, b) => new Date(a.end_date || '9999-12-31') - new Date(b.end_date || '9999-12-31'))[0];
  const quick = [
    { key: 'activities', icon: Activity, label: copy('الاشتراكات', 'Subscriptions', language), value: active.length ? `${active.length} ${copy('نشط', 'active', language)}` : copy('لا يوجد اشتراك نشط', 'No active subscription', language) },
    { key: 'attendance', icon: CalendarDays, label: copy('الحضور', 'Attendance', language), value: canViewAttendance ? (attendance?.summary ? `${attendance.summary.present_count ?? attendance.summary.attendance_count ?? 0} ${copy('حضور', 'present', language)}` : '—') : copy('غير متاح', 'Not available', language), allowed: canViewAttendance },
    { key: 'invoices', icon: Receipt, label: copy('الفواتير المدفوعة المرتبطة', 'Linked paid invoices', language), value: canViewFinancial ? (summary?.paid_invoice_count == null ? '—' : `${summary.paid_invoice_count} ${copy('فاتورة', 'invoices', language)}`) : copy('غير متاح', 'Not available', language), allowed: canViewFinancial },
  ];
  return <div className="space-y-5" data-testid="member-profile-overview">
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{copy('لقطة العضو', 'Member snapshot', language)}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><p className="text-sm text-muted-foreground">{copy('أقرب انتهاء', 'Next expiry', language)}</p><p className="font-semibold">{nextEnd ? date(nextEnd.end_date, language) : copy('لا يوجد', 'None', language)}</p></div>
        <div><p className="text-sm text-muted-foreground">{copy('الجدول الحالي', 'Current schedule', language)}</p><p className="font-semibold">{active.map(a => a.schedule || a.activity_name).filter(Boolean).join(' · ') || '—'}</p></div>
      </div>
    </section>
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