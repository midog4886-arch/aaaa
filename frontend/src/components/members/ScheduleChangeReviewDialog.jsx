import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

export default function ScheduleChangeReviewDialog({ review, busy, language, onCancel, onConfirm }) {
  const ar = language === 'ar';
  const plan = review?.preview;
  return (
    <Dialog open={!!review} onOpenChange={open => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir={ar ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle>{ar ? 'مراجعة تعديل الاشتراك' : 'Review subscription change'}</DialogTitle>
        </DialogHeader>
        {plan && (
          <div className="space-y-3 text-sm" data-testid="schedule-review">
            <div className="rounded-md border p-3 space-y-1">
              <div>{ar ? 'النشاط السابق' : 'Previous activity'}: <strong>{plan.before?.activity_name || '—'}</strong></div>
              <div>{ar ? 'النشاط الجديد' : 'New activity'}: <strong>{plan.after?.activity_name || '—'}</strong></div>
              <div>{ar ? 'المستوى السابق' : 'Previous level'}: <strong>{plan.old_level_name || plan.before?.level_id || '—'}</strong></div>
              <div>{ar ? 'المستوى الجديد' : 'New level'}: <strong>{plan.new_level_name || plan.after?.level_id || '—'}</strong></div>
              <div>{ar ? 'البداية السابقة' : 'Previous start'}: <strong>{plan.before?.start_date || '—'}</strong></div>
              <div>{ar ? 'البداية الجديدة' : 'New start'}: <strong>{plan.after?.start_date || '—'}</strong></div>
              <div>{ar ? 'الموعد السابق' : 'Previous schedule'}: <strong>{plan.old_schedule || '—'}</strong></div>
              <div>{ar ? 'الموعد الجديد' : 'New schedule'}: <strong>{plan.new_schedule || '—'}</strong></div>
              <div>{ar ? 'الانتهاء السابق' : 'Previous expiry'}: <strong>{plan.old_end_date || '—'}</strong></div>
              <div>{ar ? 'الانتهاء بعد التعديل' : 'New expiry'}: <strong>{plan.new_end_date || '—'}</strong></div>
              <div>{ar ? 'الإجمالي المدفوع' : 'Paid sessions'}: <strong>{plan.total_allowed ?? '—'}</strong></div>
              <div>{ar ? 'الحضور' : 'Attended'}: <strong>{plan.used_sessions ?? '—'}</strong></div>
              <div>{ar ? 'المتبقي' : 'Remaining'}: <strong>{plan.remaining ?? '—'}</strong></div>
              <div>{ar ? 'الرسوم السابقة' : 'Previous fee'}: <strong>{plan.before?.fee ?? '—'}</strong></div>
              <div>{ar ? 'الرسوم الجديدة' : 'New fee'}: <strong>{plan.after?.fee ?? '—'}</strong></div>
              <div>{ar ? 'الحالة بعد التعديل' : 'New status'}: <strong>{plan.after?.status || '—'}</strong></div>
              <div>{ar ? 'طريقة التعديل' : 'Change type'}: <strong>{review.request.mode === 'retrospective_correction' ? (ar ? 'تصحيح موعد سابق' : 'Correct previous schedule') : (ar ? 'تغيير من اليوم' : 'Change from today')}</strong></div>
            </div>
            {Array.isArray(plan.future_dates) && plan.future_dates.length > 0 && (
              <div>
                <strong>{ar ? 'المواعيد المتاحة المتوقعة' : 'Expected available dates'}:</strong>
                <div dir="ltr" className="text-sm mt-1">{plan.future_dates.join('، ')}</div>
              </div>
            )}
            <p className="rounded-md bg-amber-50 border border-amber-200 text-amber-900 p-2">
              {ar
                ? 'الفاتورة والحضور المسجل لا يتغيران. الحصص غير المستخدمة بسبب الغياب لا تُمدّد تلقائياً.'
                : 'The invoice and recorded attendance will not change. Missed sessions are not automatically extended.'}
            </p>
            {!!plan.warnings?.length && (
              <ul className="list-disc list-inside text-amber-800 space-y-1">
                {plan.warnings.map((warning, index) => <li key={index}>{typeof warning === 'string' ? warning : (warning.message || JSON.stringify(warning))}</li>)}
              </ul>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{ar ? 'إلغاء' : 'Cancel'}</Button>
          <Button type="button" onClick={onConfirm} disabled={busy || !plan?.preview_token} data-testid="schedule-confirm">
            {busy ? (ar ? 'جاري الحفظ...' : 'Saving...') : (ar ? 'تأكيد التعديل' : 'Confirm change')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
