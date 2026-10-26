import React from 'react';
import { ArrowRightLeft } from 'lucide-react';

export default function MemberSessionTransfers({ memberId, transfers, loading, error, language }) {
  const ar = language === 'ar';
  return <section data-testid="member-session-transfers" className="space-y-4">
    <h3 className="flex items-center gap-2 text-lg font-semibold">
      <ArrowRightLeft className="h-5 w-5 text-primary" />
      {ar ? 'الحصص المنقولة' : 'Transferred sessions'}
    </h3>
    {loading ? <p className="text-sm text-muted-foreground">{ar ? 'جارٍ تحميل عمليات النقل...' : 'Loading transfers...'}</p>
      : error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{ar ? 'تعذر تحميل عمليات النقل. أغلق الملف وافتحه مجددًا.' : 'Could not load transfers. Reopen the member profile.'}</p>
      : transfers.length === 0 ? <p className="rounded-lg border p-4 text-sm text-muted-foreground">{ar ? 'لا توجد حصص منقولة لهذا العضو.' : 'No session transfers for this member.'}</p>
      : transfers.map(row => {
        const incoming = row.recipient_id === memberId;
        const before = incoming ? row.recipient_before : row.sender_before;
        const after = incoming ? row.recipient_after : row.sender_after;
        const other = incoming ? row.sender_name : row.recipient_name;
        const date = row.created_at ? new Date(row.created_at).toLocaleString(ar ? 'ar-SA-u-ca-gregory' : 'en-US', { timeZone: 'Asia/Riyadh' }) : '—';
        return <article key={row.id} className="rounded-xl border bg-white p-4 shadow-sm" data-testid={`session-transfer-${row.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${incoming ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
                {incoming ? (ar ? 'واردة' : 'Received') : (ar ? 'صادرة' : 'Sent')}
              </span>
              <strong className="text-base">{row.sessions} {ar ? 'حصة' : 'sessions'}</strong>
              <span className="text-sm text-muted-foreground">{row.activity_name || '—'}</span>
            </div>
            <time className="text-xs text-muted-foreground">{date}</time>
          </div>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <p>{incoming ? (ar ? 'من: ' : 'From: ') : (ar ? 'إلى: ' : 'To: ')}<span className="font-medium">{other || '—'}</span></p>
            <p>{ar ? 'الرصيد وقت النقل: ' : 'Balance at transfer: '}<span className="font-medium" dir="ltr">{before ?? '—'} → {after ?? '—'}</span></p>
            {row.reason && <p className="sm:col-span-2">{ar ? 'السبب: ' : 'Reason: '}{row.reason}</p>}
            {incoming && row.end_date && <p className="sm:col-span-2 text-muted-foreground">{row.added_dates?.length ? (ar ? 'آخر تاريخ مضاف: ' : 'Last added date: ') : (ar ? 'نهاية الفترة وقت النقل: ' : 'Period end when transferred: ')}{row.end_date}</p>}
          </div>
        </article>;
      })}
  </section>;
}
