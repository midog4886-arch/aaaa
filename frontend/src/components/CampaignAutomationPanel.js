import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { toast } from 'sonner';

/*
 * This component deliberately owns the preview/confirm dialogs.  A campaign
 * inquiry can still be opened in WhatsApp by the parent page, but this
 * component never treats that manual action as a sent or read message.
 */

export const TERMINAL_INQUIRY_STATUSES = new Set([
  'do_not_contact',
  'not_interested',
  'invoiced',
  'paid',
  'closed',
  'converted',
  'cancelled',
  'visit',
  'terminal',
  'archived',
  'lost',
  'won',
  'completed',
]);

export const isAutomationEligible = (item, branch) => Boolean(
  item
  && branch
  && branch !== 'all'
  && String(item.branch_id) === String(branch)
  && !TERMINAL_INQUIRY_STATUSES.has(String(item.status || '').toLowerCase()),
);

const asHour = value => {
  const hour = Number(value);
  return Number.isFinite(hour) ? Math.max(0, Math.min(24, Math.round(hour))) : 9;
};

const dateLabel = value => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  });
};

const RECIPIENT_REASONS = {
  whatsflow_unavailable: 'واتس فلو غير متاح لهذا الفرع',
  branch_paused: 'الإرسال الآلي متوقف للفرع',
  invalid_phone: 'رقم الجوال غير صالح',
  crm_status: 'حالة الاستفسار لا تسمح بالمتابعة',
  manual_stop: 'إيقاف يدوي',
  already_enrolled: 'المتابعة مفعلة مسبقاً',
  already_confirmed: 'تم قبول الإرسال مسبقاً',
  provider_outcome_unknown: 'نتيجة الإرسال السابقة غير معروفة',
  not_found: 'الاستفسار غير موجود في الفرع',
};
const recipientReason = recipient => RECIPIENT_REASONS[recipient?.reason] || recipient?.reason || 'غير مؤهل';
const recipientName = recipient => recipient?.name || recipient?.phone || recipient?.id || 'بدون اسم';

const deliveryLabel = value => {
  const status = String(value || '').toLowerCase();
  if (['delivered', 'delivery_success', 'success'].includes(status)) return 'تم التسليم';
  if (['accepted', 'queued', 'pending', 'scheduled'].includes(status)) return 'مقبول للجدولة';
  if (['failed', 'error', 'rejected'].includes(status)) return 'فشل';
  if (!status || ['unknown', 'undetermined', 'sent'].includes(status)) return 'غير معروفة';
  return value;
};

const jobLabel = value => {
  const status = String(value || '').toLowerCase();
  if (['accepted', 'queued', 'scheduled', 'running'].includes(status)) return 'مقبولة';
  if (['completed', 'done', 'finished'].includes(status)) return 'مكتملة';
  if (['stopped', 'cancelled', 'canceled'].includes(status)) return 'متوقفة';
  if (['failed', 'error'].includes(status)) return 'فشل';
  if (!status || ['unknown', 'undetermined'].includes(status)) return 'غير معروفة';
  return value;
};

const automationLabel = value => {
  const status = String(value || '').toLowerCase();
  if (status === 'not_enrolled') return 'غير مفعّلة';
  if (['scheduled', 'first_queued', 'second_queued'].includes(status)) return 'مجدولة';
  if (['first_sent', 'direct_queued'].includes(status)) return 'قيد المتابعة';
  if (status === 'completed') return 'مكتملة';
  if (status === 'stopped') return 'متوقفة';
  if (status === 'failed') return 'فشل';
  if (status === 'unknown') return 'غير معروفة';
  return value || 'غير معروفة';
};

const ACTIVE_AUTOMATION_STATUSES = new Set([
  'scheduled',
  'first_queued',
  'first_sent',
  'second_queued',
  'direct_queued',
  'active',
  'enrolled',
]);

export const AutomationStatusSummary = ({ status }) => {
  if (!status) return null;
  return (
    <div className="mt-2 rounded bg-muted/60 p-2 text-[11px] text-muted-foreground">
      <span>المتابعة: {automationLabel(status.status)}</span>
      <span className="mx-2">·</span>
      <span>الأتمتة: {jobLabel(status.job_status)}</span>
      <span className="mx-2">·</span>
      <span>التسليم: {deliveryLabel(status.delivery_status)}</span>
      {status.stop_reason && <span className="mr-2">· سبب الإيقاف: {RECIPIENT_REASONS[status.stop_reason] || status.stop_reason}</span>}
      {status.next_due_at && <span className="mr-2">· الموعد التالي: {dateLabel(status.next_due_at)}</span>}
    </div>
  );
};

const AutomationModal = ({ children, onClose }) => (
  <div className="fixed inset-0 z-50 bg-black/40 p-3 flex items-center justify-center" dir="rtl">
    <div className="w-full max-w-xl max-h-[92dvh] overflow-auto rounded-xl bg-background shadow-xl">
      {children}
      <div className="px-5 pb-4">
        <Button type="button" variant="outline" onClick={onClose}>إلغاء</Button>
      </div>
    </div>
  </div>
);

const PreviewRecipients = ({ preview }) => {
  const recipients = Array.isArray(preview?.recipients) ? preview.recipients : [];
  return (
    <div className="rounded-md border p-3 text-xs space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <strong>المستلمون ({recipients.length})</strong>
        <span>المؤهلون: {preview?.eligible_count || 0}</span>
        {preview?.first_due_at && <span>الأولى: {dateLabel(preview.first_due_at)}</span>}
        {preview?.second_due_at && <span>الثانية: {dateLabel(preview.second_due_at)}</span>}
        {preview?.expires_at && <span>تنتهي المعاينة: {dateLabel(preview.expires_at)}</span>}
      </div>
      <div className="max-h-44 overflow-auto divide-y">
        {recipients.length === 0 && <p className="py-2 text-muted-foreground">لم تُعد المعاينة أي مستلمين.</p>}
        {recipients.map((recipient, index) => (
          <div key={`${recipient.id || recipient.phone || 'recipient'}-${index}`} className="py-2 flex items-start justify-between gap-3">
            <span className="min-w-0">{recipientName(recipient)}</span>
            <span className={recipient.eligible ? 'text-emerald-700' : 'text-destructive'}>
              {recipient.eligible ? 'مؤهل' : `مستبعد: ${recipientReason(recipient)}`}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">سيتم إرسال الرسائل للمؤهلين فقط، ويُستبعد كل مستلم محجوب أو غير مؤهل.</p>
    </div>
  );
};

export const CampaignAutomationPanel = ({
  api,
  branch,
  items = [],
  settings,
  statusMap = {},
  statusError = '',
  canAutomate = false,
  selectedIds = [],
  onSelectedIdsChange,
  onSettingsChange,
  onRefresh,
  filterKey = '',
  emptyContent = null,
  children,
}) => {
  const [dialog, setDialog] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewContext, setPreviewContext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settingsDialog, setSettingsDialog] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState({ paused: false, start_hour: 9, end_hour: 21 });
  const [stopDialog, setStopDialog] = useState(null);
  const [stopReason, setStopReason] = useState('');
  const operationSeq = useRef(0);

  const eligibleItems = useMemo(
    () => items.filter(item => isAutomationEligible(item, branch)),
    [items, branch],
  );
  const eligibleIds = useMemo(() => eligibleItems.map(item => item.id), [eligibleItems]);
  // Availability describes whether new Whatsflow work may be created.  It
  // must not hide durable status, stop, or branch configuration controls:
  // those remain useful while a provider is disconnected.
  const automationVisible = Boolean(
    canAutomate
    && branch
    && branch !== 'all'
    && (settings || Object.keys(statusMap || {}).length),
  );
  const automationAvailable = Boolean(automationVisible && settings?.available === true);

  const resetDialog = () => {
    operationSeq.current += 1;
    setDialog(null);
    setPreview(null);
    setPreviewContext(null);
    setError('');
    setBusy(false);
  };

  // A preview is bound to the branch and current result set.  Never allow a
  // stale preview to be confirmed after a branch/filter change.
  useEffect(() => {
    resetDialog();
    setStopDialog(null);
    setStopReason('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, filterKey]);

  useEffect(() => {
    // A disconnect invalidates any new-send preview.  Existing status and
    // stop/configuration actions intentionally remain rendered below.
    if (!automationAvailable && dialog) resetDialog();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automationAvailable]);

  useEffect(() => {
    const valid = new Set(eligibleIds);
    const next = selectedIds.filter(id => valid.has(id)).slice(0, 100);
    if (next.length !== selectedIds.length && onSelectedIdsChange) onSelectedIdsChange(next);
  }, [eligibleIds, selectedIds, onSelectedIdsChange]);

  const updateSelection = ids => {
    if (onSelectedIdsChange) onSelectedIdsChange(Array.from(new Set(ids)).slice(0, 100));
  };

  const openDirect = item => {
    if (!automationAvailable || !isAutomationEligible(item, branch)) return;
    operationSeq.current += 1;
    setError('');
    setPreview(null);
    setPreviewContext(null);
    setDialog({
      mode: 'direct',
      ids: [item.id],
      message: `مرحباً ${item.name || ''}، معك فريق الأكاديمية. يسعدنا مساعدتك في معرفة التفاصيل المناسبة لك.`,
    });
  };

  const openFollowup = () => {
    const ids = selectedIds.filter(id => eligibleIds.includes(id)).slice(0, 100);
    if (!automationAvailable) return;
    if (!ids.length) {
      toast.error('اختر استفساراً مؤهلاً واحداً على الأقل');
      return;
    }
    operationSeq.current += 1;
    setError('');
    setPreview(null);
    setPreviewContext(null);
    setDialog({
      mode: 'followup',
      ids,
      firstMessage: 'مرحباً {name}، نتابع معك بخصوص استفسارك لدى الأكاديمية. إذا رغبت، نشاركك المواعيد والرسوم المناسبة.',
      secondMessage: 'مرحباً {name}، هذه متابعة أخيرة بخصوص استفسارك. يسعدنا خدمتك متى ما كان الوقت مناسباً لك.',
    });
  };

  const requestPreview = async () => {
    if (busy || !dialog || !automationAvailable) return;
    const requestToken = ++operationSeq.current;
    setBusy(true);
    setError('');
    try {
      if (typeof api?.previewAutomation !== 'function') throw new Error('واجهة الأتمتة غير متاحة');
      const payload = dialog.mode === 'direct'
        ? {
          branch_id: branch,
          inquiry_ids: dialog.ids,
          mode: 'direct',
          message: dialog.message,
        }
        : {
          branch_id: branch,
          inquiry_ids: dialog.ids,
          mode: 'followup',
          first_message: dialog.firstMessage,
          second_message: dialog.secondMessage,
        };
      const response = await api.previewAutomation(payload);
      if (requestToken !== operationSeq.current) return;
      setPreview(response.data || {});
      setPreviewContext({
        branch,
        filterKey,
        mode: dialog.mode,
        ids: [...dialog.ids],
      });
    } catch (err) {
      if (requestToken === operationSeq.current) {
        const message = err?.response?.data?.detail || err?.message || 'تعذّرت معاينة الإرسال الآلي';
        setError(message);
        toast.error(message);
      }
    } finally {
      if (requestToken === operationSeq.current) setBusy(false);
    }
  };

  const previewIsCurrent = Boolean(
    preview
    && preview.preview_id
    && previewContext
    && previewContext.branch === branch
    && previewContext.filterKey === filterKey
    && dialog
    && previewContext.mode === dialog.mode
    && JSON.stringify(previewContext.ids) === JSON.stringify(dialog.ids),
  );

  const confirmPreview = async () => {
    if (busy || !previewIsCurrent || !preview?.eligible_count) return;
    const requestToken = ++operationSeq.current;
    setBusy(true);
    setError('');
    try {
      if (typeof api?.confirmAutomation !== 'function') throw new Error('واجهة الأتمتة غير متاحة');
      const response = await api.confirmAutomation({ branch_id: branch, preview_id: preview.preview_id });
      const accepted = response?.data?.accepted;
      const skipped = response?.data?.skipped;
      const result = accepted !== undefined || skipped !== undefined
        ? `مقبول: ${accepted ?? 0}، مستبعد: ${skipped ?? 0}`
        : (dialog.mode === 'direct' ? 'تم قبول الإرسال الآلي' : 'تم تفعيل المتابعة الآلية');
      toast.success(result);
      resetDialog();
      if (dialog.mode === 'followup' && onSelectedIdsChange) onSelectedIdsChange([]);
      if (onRefresh) onRefresh();
    } catch (err) {
      if (requestToken === operationSeq.current) {
        const message = err?.response?.data?.detail || err?.message || 'تعذّر تأكيد الإرسال الآلي';
        setError(message);
        toast.error(message);
      }
    } finally {
      if (requestToken === operationSeq.current) setBusy(false);
    }
  };

  const openSettings = pauseChange => {
    if (!settings) return;
    setSettingsDraft({
      paused: pauseChange === undefined ? Boolean(settings.paused) : pauseChange,
      start_hour: asHour(settings.start_hour ?? 9),
      end_hour: asHour(settings.end_hour ?? 21),
    });
    setSettingsDialog({ pauseChange });
    setError('');
  };

  const saveSettings = async event => {
    event.preventDefault();
    if (busy || !settings || typeof api?.updateAutomationSettings !== 'function') return;
    const start = asHour(settingsDraft.start_hour);
    const end = asHour(settingsDraft.end_hour);
    if (start >= end) {
      setError('يجب أن تكون ساعة النهاية بعد ساعة البداية');
      return;
    }
    const requestToken = ++operationSeq.current;
    setBusy(true);
    setError('');
    try {
      const payload = {
        branch_id: branch,
        paused: Boolean(settingsDraft.paused),
        start_hour: start,
        end_hour: end,
      };
      const response = await api.updateAutomationSettings(payload);
      onSettingsChange?.({ ...settings, ...payload, ...(response?.data || {}) });
      toast.success(settingsDraft.paused ? 'تم إيقاف الإرسال الآلي' : 'تم حفظ إعدادات الإرسال الآلي');
      setSettingsDialog(null);
      onRefresh?.();
    } catch (err) {
      if (requestToken === operationSeq.current) {
        const message = err?.response?.data?.detail || err?.message || 'تعذّر حفظ إعدادات الإرسال الآلي';
        setError(message);
        toast.error(message);
      }
    } finally {
      if (requestToken === operationSeq.current) setBusy(false);
    }
  };

  const openStop = item => {
    const current = statusMap[item.id];
    if (!automationVisible || !current) return;
    setStopDialog(item);
    setStopReason('');
    setError('');
  };

  const confirmStop = async event => {
    event.preventDefault();
    if (busy || !stopDialog || !stopReason.trim()) {
      if (!stopReason.trim()) setError('اكتب سبب إيقاف المتابعة');
      return;
    }
    const requestToken = ++operationSeq.current;
    setBusy(true);
    setError('');
    try {
      if (typeof api?.stopAutomation !== 'function') throw new Error('واجهة الأتمتة غير متاحة');
      // The fixed endpoint contract intentionally accepts an empty object.
      // The reason remains an explicit operator acknowledgement in this UI;
      // the refreshed status is the source of truth for the resulting state.
      await api.stopAutomation(stopDialog.id);
      toast.success('تم إيقاف المتابعة الآلية');
      setStopDialog(null);
      setStopReason('');
      onRefresh?.();
    } catch (err) {
      if (requestToken === operationSeq.current) {
        const message = err?.response?.data?.detail || err?.message || 'تعذّر إيقاف المتابعة الآلية';
        setError(message);
        toast.error(message);
      }
    } finally {
      if (requestToken === operationSeq.current) setBusy(false);
    }
  };

  const rowProps = item => {
    const eligible = isAutomationEligible(item, branch);
    const checked = selectedIds.includes(item.id);
    return {
      eligible,
      status: statusMap[item.id],
      selectionControl: automationAvailable && eligible ? (
        <label className="inline-flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            aria-label={`اختيار ${item.name || item.phone || item.id}`}
            checked={checked}
            onChange={event => {
              if (event.target.checked) {
                if (!checked && selectedIds.length >= 100) {
                  toast.error('يمكن اختيار 100 استفسار كحد أقصى');
                  return;
                }
                updateSelection([...selectedIds, item.id]);
              } else updateSelection(selectedIds.filter(id => id !== item.id));
            }}
          />
          اختيار
        </label>
      ) : null,
      directButton: automationAvailable && eligible ? (
        <Button type="button" size="sm" variant="outline" onClick={() => openDirect(item)}>
          إرسال آلي مباشر
        </Button>
      ) : null,
      stopButton: automationVisible && statusMap[item.id]
        && ACTIVE_AUTOMATION_STATUSES.has(String(statusMap[item.id].status || '').toLowerCase()) ? (
        <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => openStop(item)}>
          إيقاف المتابعة الآلية
        </Button>
      ) : null,
      statusSummary: automationVisible ? <AutomationStatusSummary status={statusMap[item.id]} /> : null,
    };
  };

  return (
    <>
      {automationVisible && (
        <section className={`mb-4 rounded-lg border p-3 ${automationAvailable ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/60'}`} aria-label="الأتمتة">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <strong className="text-sm">واتساب الآلي للاستفسارات</strong>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {automationAvailable
                  ? (settings?.paused ? 'متوقف لهذا الفرع.' : 'متاح لهذا الفرع.')
                  : `لا يمكن إنشاء إرسال آلي جديد حالياً: ${settings?.reason || 'الخدمة غير متصلة لهذا الفرع.'}`}
                {' '}كل الرسائل الآلية فقط تتأثر بهذا الإعداد، ولا يتم إيقاف الحملات القائمة.
              </p>
            </div>
            {settings && <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => openSettings()}>
                  إعدادات ساعات الإرسال
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => openSettings(!settings?.paused)}>
                  {settings?.paused ? 'استئناف الإرسال الآلي' : 'إيقاف الإرسال الآلي'}
                </Button>
              </div>}
          </div>
          {automationAvailable && <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-emerald-200 pt-3 text-xs">
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                aria-label="تحديد كل المؤهلين"
                checked={eligibleIds.length > 0 && eligibleIds.every(id => selectedIds.includes(id))}
                onChange={event => {
                  if (event.target.checked) updateSelection(eligibleIds.slice(0, 100));
                  else updateSelection([]);
                }}
              />
              تحديد المؤهلين ({Math.min(eligibleIds.length, 100)})
            </label>
            {eligibleIds.length > 100 && <span className="text-amber-700">سيتم اختيار أول 100 فقط.</span>}
            {selectedIds.length > 0 && (
              <Button type="button" size="sm" onClick={openFollowup} disabled={busy}>
                تفعيل المتابعة الآلية ({selectedIds.length})
              </Button>
            )}
            <span className="text-muted-foreground">الساعات: {asHour(settings?.start_hour ?? 9)}:00–{asHour(settings?.end_hour ?? 21)}:00 بتوقيت السعودية.</span>
          </div>}
          {statusError && <p className="mt-2 text-xs text-destructive" role="alert">{statusError}</p>}
        </section>
      )}

      <div className="space-y-3">
        {items.length ? items.map(item => (
          <React.Fragment key={item.id}>
            {children?.({ item, ...rowProps(item) })}
          </React.Fragment>
        )) : emptyContent}
      </div>

      {dialog && (
        <AutomationModal onClose={resetDialog}>
          <div className="p-5 space-y-3">
            <h2 className="font-bold">{dialog.mode === 'direct' ? 'إرسال واتساب آلي مباشر' : 'تفعيل المتابعة الآلية'}</h2>
            <p className="text-xs text-muted-foreground">
              لا يتم الإرسال عند فتح هذه النافذة. عدّل الرسالة ثم اطلب المعاينة، وبعدها أكد العملية بشكل صريح.
            </p>
            {dialog.mode === 'direct' ? (
              <label className="block text-xs">
                الرسالة
                <textarea
                  value={dialog.message}
                  onChange={event => {
                    setDialog(value => ({ ...value, message: event.target.value }));
                    setPreview(null);
                    setPreviewContext(null);
                  }}
                  className="mt-1 w-full min-h-32 border rounded p-2 text-sm"
                />
              </label>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">ستُقترح المواعيد من وقت التفعيل، لا من آخر فتح يدوي لواتساب.</p>
                <label className="block text-xs">
                  رسالة المتابعة بعد 24 ساعة
                  <textarea
                    value={dialog.firstMessage}
                    onChange={event => {
                      setDialog(value => ({ ...value, firstMessage: event.target.value }));
                      setPreview(null);
                      setPreviewContext(null);
                    }}
                    className="mt-1 w-full min-h-24 border rounded p-2 text-sm"
                  />
                </label>
                <label className="block text-xs">
                  رسالة المتابعة بعد 3 أيام
                  <textarea
                    value={dialog.secondMessage}
                    onChange={event => {
                      setDialog(value => ({ ...value, secondMessage: event.target.value }));
                      setPreview(null);
                      setPreviewContext(null);
                    }}
                    className="mt-1 w-full min-h-24 border rounded p-2 text-sm"
                  />
                </label>
                <p className="rounded bg-amber-50 p-2 text-[11px] text-amber-800">
                  تُراعى ساعات الهدوء للفرع، مع فاصل لا يقل عن 3 دقائق بين الإرسالات الآلية عبر حملات هذا الفرع.
                </p>
              </>
            )}
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            {previewIsCurrent && <PreviewRecipients preview={preview} />}
            <div className="flex flex-wrap justify-end gap-2">
              {!previewIsCurrent ? (
                <Button type="button" onClick={requestPreview} disabled={busy || (dialog.mode === 'direct' ? !dialog.message.trim() : (!dialog.firstMessage.trim() || !dialog.secondMessage.trim()))}>
                  {busy ? 'جارٍ التحميل…' : 'معاينة الإرسال'}
                </Button>
              ) : (
                <Button type="button" onClick={confirmPreview} disabled={busy || !preview.eligible_count}>
                  {busy ? 'جارٍ التأكيد…' : dialog.mode === 'direct' ? 'تأكيد الإرسال' : 'تأكيد تفعيل المتابعة'}
                </Button>
              )}
            </div>
          </div>
        </AutomationModal>
      )}

      {settingsDialog && (
        <AutomationModal onClose={() => { if (!busy) setSettingsDialog(null); }}>
          <form onSubmit={saveSettings} className="p-5 space-y-3">
            <h2 className="font-bold">إعدادات الإرسال الآلي للفرع</h2>
            <p className="text-xs text-muted-foreground">
              هذه الإعدادات تخص إرسال استفسارات الحملات الآلي فقط، ولا توقف الحملات القائمة أو الإرسال اليدوي.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs">من الساعة
                <input type="number" min="0" max="23" value={settingsDraft.start_hour} onChange={event => setSettingsDraft(value => ({ ...value, start_hour: event.target.value }))} className="mt-1 w-full h-9 border rounded px-2" />
              </label>
              <label className="text-xs">إلى الساعة
                <input type="number" min="1" max="24" value={settingsDraft.end_hour} onChange={event => setSettingsDraft(value => ({ ...value, end_hour: event.target.value }))} className="mt-1 w-full h-9 border rounded px-2" />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(settingsDraft.paused)} onChange={event => setSettingsDraft(value => ({ ...value, paused: event.target.checked }))} />
              إيقاف كل الإرسالات الآلية لهذا الفرع
            </label>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={busy}>
                {settingsDraft.paused
                  ? (settings?.paused ? 'حفظ إعدادات الإيقاف' : 'تأكيد الإيقاف وحفظ الإعدادات')
                  : (settings?.paused ? 'تأكيد الاستئناف وحفظ الإعدادات' : 'حفظ إعدادات الساعات')}
              </Button>
            </div>
          </form>
        </AutomationModal>
      )}

      {stopDialog && (
        <AutomationModal onClose={() => { if (!busy) setStopDialog(null); }}>
          <form onSubmit={confirmStop} className="p-5 space-y-3">
            <h2 className="font-bold">إيقاف المتابعة الآلية</h2>
            <p className="text-xs text-muted-foreground">سيتم تحديث الحالة من الخادم بعد الإيقاف. لا يتم اعتبار فتح واتساب أو قراءة الرسالة تواصلاً.</p>
            <label className="block text-xs">
              سبب الإيقاف
              <textarea required value={stopReason} onChange={event => setStopReason(event.target.value)} className="mt-1 w-full min-h-20 border rounded p-2 text-sm" />
            </label>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="submit" variant="destructive" disabled={busy}>تأكيد الإيقاف</Button>
            </div>
          </form>
        </AutomationModal>
      )}
    </>
  );
};

export default CampaignAutomationPanel;