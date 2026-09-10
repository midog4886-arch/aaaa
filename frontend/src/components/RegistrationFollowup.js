import React, { useState } from 'react';
import { Button } from './ui/button';
import { registrationRequestsAPI } from '../services/api';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const labels = {
  scheduled: 'متابعة مجدولة',
  first_sent: 'أُرسلت المتابعة الأولى',
  completed: 'اكتملت المتابعتان',
  stopped: 'المتابعة متوقفة',
  blocked: 'المتابعة متعذّرة مؤقتاً',
  unknown: 'نتيجة الإرسال غير مؤكدة — لن يُعاد تلقائياً',
};
const reasons = {
  contacted: 'تم التواصل مع العميل',
  opted_out: 'طلب عدم التواصل',
  replied: 'ردّ العميل',
  customer_replied: 'ردّ العميل',
  staff_contacted: 'تم التواصل مع العميل',
  request_closed: 'تمت معالجة الطلب أو إغلاقه',
  request_deleted: 'تم حذف الطلب',
  compatible_provider_unavailable: 'الفرع يحتاج ربط Whatsflow أو WAHA',
  branch_send_lane_frozen: 'الإرسال متوقف في هذا الفرع للتحقق من محاولة سابقة',
  provider_unavailable: 'تعذّر الاتصال بمزود واتساب',
  provider_rejected: 'رفض المزود محاولة الإرسال',
  provider_outcome_unknown: 'لن تُعاد المحاولة لتجنّب التكرار',
  processed: 'تمت معالجة الطلب',
  archived: 'الطلب مؤرشف',
  rejected: 'الطلب مرفوض',
  deleted: 'تم حذف الطلب',
};

export default function RegistrationFollowup({ request, onChanged }) {
  const [busy, setBusy] = useState(false);
  const status = request.followup_status;
  const canStop = request.followup_enrolled === true && request.status === 'pending' && !['completed', 'stopped'].includes(status);
  const stop = async (reason) => {
    if (reason === 'opted_out' && !window.confirm('تأكيد أن العميل طلب عدم التواصل؟ ستتوقف متابعة هذا الرقم.')) return;
    setBusy(true);
    try {
      await registrationRequestsAPI.stopFollowup(request.id, reason);
      toast.success(reason === 'contacted' ? 'تم تسجيل التواصل وإيقاف المتابعة الآلية' : 'تم إيقاف المتابعة بناءً على طلب العميل');
      await onChanged();
    } catch {
      toast.error('تعذّر إيقاف المتابعة. لم يتم تأكيد الحفظ؛ حاول مجدداً.');
    } finally {
      setBusy(false);
    }
  };
  return <div className="mt-3 border-t pt-3 text-xs" data-testid={`followup-${request.id}`}>
    <p className={status === 'blocked' || status === 'unknown' ? 'text-amber-700' : 'text-gray-600'} role="status">
      {labels[status] || 'غير مشمول بالمتابعة الآلية'}
      {request.followup_stop_reason && ` — ${reasons[request.followup_stop_reason] || 'توقفت المتابعة لهذا الرقم'}`}
    </p>
    {canStop && <div className="flex flex-wrap gap-2 mt-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => stop('contacted')}>
        {busy && <Loader2 className="w-3 h-3 animate-spin ms-1" />} تم التواصل — إيقاف المتابعة
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => stop('opted_out')}>
        طلب عدم التواصل
      </Button>
    </div>}
  </div>;
}