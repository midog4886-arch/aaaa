import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { membersAPI } from '../../services/api';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

const COPY = {
  ar: {
    title: 'سجل تعديلات العضو',
    description: 'سجل للقراءة فقط يعرض آخر 200 عملية محفوظة.',
    loading: 'جارٍ تحميل السجل…',
    error: 'تعذر تحميل سجل التعديلات.',
    retry: 'إعادة المحاولة',
    empty: 'لا توجد تعديلات مسجلة.',
    actor: 'بواسطة',
    unknownActor: 'مستخدم غير معروف',
    unavailableDate: 'الوقت غير متاح',
    unavailableDetails: 'التفاصيل التاريخية غير متاحة لهذه العملية.',
    before: 'قبل',
    after: 'بعد',
    notRecorded: 'غير مسجل',
    emptyValue: 'فارغ',
    unknownAction: 'عملية مسجلة',
  },
  en: {
    title: 'Member edit history',
    description: 'Read-only history showing the last 200 recorded operations.',
    loading: 'Loading history…',
    error: 'Could not load edit history.',
    retry: 'Retry',
    empty: 'No edits have been recorded.',
    actor: 'By',
    unknownActor: 'Unknown user',
    unavailableDate: 'Time unavailable',
    unavailableDetails: 'Historical details are unavailable for this operation.',
    before: 'Before',
    after: 'After',
    notRecorded: 'Not recorded',
    emptyValue: 'Empty',
    unknownAction: 'Recorded operation',
  },
};

const ACTIONS = {
  'subscription.add': ['إضافة اشتراك', 'Subscription added'],
  'subscription.update': ['تعديل اشتراك', 'Subscription updated'],
  'subscription.delete': ['حذف اشتراك', 'Subscription deleted'],
  'member.update': ['تعديل بيانات العضو', 'Member profile updated'],
  'member.transfer': ['نقل العضو', 'Member transferred'],
  'member.transfer_bulk': ['نقل العضو ضمن مجموعة', 'Member transferred in bulk'],
  'day_extension.apply': ['تطبيق تمديد أيام', 'Day extension applied'],
  'day_extension.manual': ['تمديد أيام يدوي', 'Manual day extension'],
};

const FIELDS = {
  name: ['الاسم بالإنجليزية', 'English name'],
  name_ar: ['الاسم بالعربية', 'Arabic name'],
  phone: ['رقم الجوال', 'Phone'],
  guardian_name: ['اسم ولي الأمر', 'Guardian name'],
  guardian_name_ar: ['اسم ولي الأمر بالعربية', 'Arabic guardian name'],
  guardian_phone: ['جوال ولي الأمر', 'Guardian phone'],
  email: ['البريد الإلكتروني', 'Email'],
  address: ['العنوان', 'Address'],
  age: ['العمر', 'Age'],
  is_vip: ['عضوية VIP', 'VIP membership'],
  photo: ['الصورة', 'Photo'],
  photo_url: ['رابط الصورة', 'Photo URL'],
  date_of_birth: ['تاريخ الميلاد', 'Date of birth'],
  gender: ['الجنس', 'Gender'],
  nationality: ['الجنسية', 'Nationality'],
  member_code: ['رقم العضوية', 'Member code'],
  branch_id: ['الفرع', 'Branch'],
  branch_name: ['اسم الفرع', 'Branch name'],
  new_branch_id: ['الفرع الجديد', 'New branch'],
  activity_id: ['النشاط', 'Activity'],
  activity_name: ['اسم النشاط', 'Activity name'],
  activities: ['الاشتراكات والأنشطة', 'Subscriptions and activities'],
  start_date: ['تاريخ البداية', 'Start date'],
  end_date: ['تاريخ النهاية', 'End date'],
  fee: ['الرسوم', 'Fee'],
  status: ['الحالة', 'Status'],
  coach_id: ['المدرب', 'Coach'],
  level_id: ['المستوى', 'Level'],
  schedule: ['الجدول', 'Schedule'],
  training_days: ['أيام التدريب', 'Training days'],
  training_time: ['وقت التدريب', 'Training time'],
  day_times: ['أوقات الأيام', 'Day times'],
  transfer_date: ['تاريخ النقل', 'Transfer date'],
  days: ['عدد الأيام', 'Days'],
  days_added: ['الأيام المضافة', 'Days added'],
  reason: ['السبب', 'Reason'],
  notes: ['ملاحظات', 'Notes'],
  created_at: ['تاريخ الإنشاء', 'Created at'],
  updated_at: ['تاريخ آخر تحديث', 'Updated at'],
};

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function valueText(change, side, text) {
  if (!change || typeof change !== 'object' || !own(change, side)) return text.notRecorded;
  const value = change[side];
  if (value === null || value === '') return text.emptyValue;
  if (typeof value === 'undefined') return text.notRecorded;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? text.notRecorded : serialized;
  } catch {
    return text.notRecorded;
  }
}

function actionText(action, isArabic, text) {
  const translated = ACTIONS[action];
  if (translated) return translated[isArabic ? 0 : 1];
  return action ? `${text.unknownAction}: ${action}` : text.unknownAction;
}

function fieldText(field, isArabic) {
  const translated = FIELDS[field];
  return translated ? translated[isArabic ? 0 : 1] : field;
}

function formattedDate(value, language, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA' : 'en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export default function MemberEditHistoryDialog({
  open,
  onOpenChange,
  member,
  language = 'ar',
  isAdmin = false,
  activeBranchId,
}) {
  const isArabic = language === 'ar';
  const text = isArabic ? COPY.ar : COPY.en;
  const memberId = member?.id;
  const requestKey = `${memberId || ''}:${activeBranchId || ''}`;
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState({ key: '', status: 'idle', rows: [], error: null });

  useEffect(() => {
    const currentGeneration = ++generation.current;
    if (!open || !isAdmin || !memberId) {
      setResult({ key: '', status: 'idle', rows: [], error: null });
      return undefined;
    }

    setResult({ key: requestKey, status: 'loading', rows: [], error: null });
    membersAPI.getSubscriptionAudit(memberId).then(
      response => {
        if (generation.current !== currentGeneration) return;
        if (!Array.isArray(response?.data)) {
          setResult({ key: requestKey, status: 'error', rows: [], error: new Error('Invalid audit response') });
          return;
        }
        setResult({
          key: requestKey,
          status: 'success',
          rows: response.data,
          error: null,
        });
      },
      error => {
        if (generation.current !== currentGeneration) return;
        setResult({ key: requestKey, status: 'error', rows: [], error });
      }
    );

    return () => {
      if (generation.current === currentGeneration) generation.current += 1;
    };
  }, [open, isAdmin, memberId, activeBranchId, requestKey, retry]);

  const visibleResult = useMemo(() => {
    if (result.key !== requestKey) return { status: 'loading', rows: [] };
    return result;
  }, [requestKey, result]);

  if (!isAdmin) return null;

  return (
    <Dialog open={Boolean(open && memberId)} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] max-w-3xl overflow-y-auto"
        dir={isArabic ? 'rtl' : 'ltr'}
        data-testid="member-edit-history-dialog"
      >
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>

        {visibleResult.status === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-10" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span>{text.loading}</span>
          </div>
        )}

        {visibleResult.status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-8" role="alert">
            <p>{text.error}</p>
            <Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>
              <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
              {text.retry}
            </Button>
          </div>
        )}

        {visibleResult.status === 'success' && visibleResult.rows.length === 0 && (
          <p className="py-10 text-center text-muted-foreground">{text.empty}</p>
        )}

        {visibleResult.status === 'success' && visibleResult.rows.length > 0 && (
          <div className="space-y-4">
            {visibleResult.rows.map((row, rowIndex) => {
              const diffs = row?.diff && typeof row.diff === 'object' && !Array.isArray(row.diff)
                ? Object.entries(row.diff)
                : [];
              return (
                <article className="rounded-lg border p-4" key={row?.id || `${row?.created_at || 'row'}-${rowIndex}`}>
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-semibold">{actionText(row?.action, isArabic, text)}</h3>
                    <time className="text-sm text-muted-foreground">
                      {formattedDate(row?.created_at, language, text.unavailableDate)}
                    </time>
                  </div>
                  <p className="mb-3 text-sm text-muted-foreground">
                    {text.actor}: {row?.actor_username || text.unknownActor}
                  </p>
                  {diffs.length === 0 ? (
                    <p className="rounded-md bg-muted p-3 text-sm">{text.unavailableDetails}</p>
                  ) : (
                    <div className="space-y-3">
                      {diffs.map(([field, change]) => (
                        <section className="rounded-md bg-muted/50 p-3" key={field}>
                          <h4 className="mb-2 text-sm font-medium">{fieldText(field, isArabic)}</h4>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div>
                              <span className="block text-xs text-muted-foreground">{text.before}</span>
                              <span className="break-words whitespace-pre-wrap text-sm">
                                {valueText(change, 'before', text)}
                              </span>
                            </div>
                            <div>
                              <span className="block text-xs text-muted-foreground">{text.after}</span>
                              <span className="break-words whitespace-pre-wrap text-sm">
                                {valueText(change, 'after', text)}
                              </span>
                            </div>
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}