import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { whatsappAPI } from '../services/api';
import { apiErrorMessage } from '../utils/apiErrorMessage';

const SUMMARY_KEYS = [
  ['total', 'Total', 'الإجمالي', 'bg-slate-100 text-slate-800'],
  ['pending', 'Pending', 'معلّق', 'bg-amber-100 text-amber-800'],
  ['accepted', 'Accepted', 'مقبول', 'bg-blue-100 text-blue-800'],
  ['delivered', 'Delivered', 'تم التسليم', 'bg-emerald-100 text-emerald-800'],
  ['read', 'Read', 'تمت القراءة', 'bg-indigo-100 text-indigo-800'],
  ['failed', 'Failed', 'فشل', 'bg-red-100 text-red-800'],
  ['unknown', 'Unknown', 'غير معروف', 'bg-gray-100 text-gray-800'],
  ['cancelled', 'Cancelled', 'ملغى', 'bg-gray-100 text-gray-800'],
];

const RECEIPT_STATES = new Set(['delivered', 'read']);
const NORMALIZED_STATES = new Set([
  'pending',
  'processing',
  'partial',
  'accepted',
  'sent',
  'delivered',
  'read',
  'failed',
  'unknown',
  'cancelled',
  'canceled',
]);

const normalizeStatus = value => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const firstValue = (...values) => values.find(value => value !== undefined && value !== null && value !== '');

const numberValue = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * A provider's "sent" event means that it accepted the message for dispatch.
 * It is not delivery confirmation. Delivery/read are only considered confirmed
 * when the receipt status is present in delivery_status (or an equivalent
 * receipt status supplied by the report API).
 */
export const recipientState = recipient => {
  const sendStatus = normalizeStatus(recipient?.status);
  const deliveryStatus = normalizeStatus(recipient?.delivery_status);
  const receiptStatus = RECEIPT_STATES.has(deliveryStatus)
    ? deliveryStatus
    : (RECEIPT_STATES.has(sendStatus) ? sendStatus : '');

  if (receiptStatus) return receiptStatus;
  if (sendStatus === 'processing' || sendStatus === 'pending') return 'pending';
  if (sendStatus === 'sent' || sendStatus === 'accepted') return 'accepted';
  if (sendStatus === 'canceled') return 'cancelled';
  if (NORMALIZED_STATES.has(sendStatus)) return sendStatus;
  if (deliveryStatus === 'sent' || deliveryStatus === 'accepted') return 'accepted';
  if (deliveryStatus === 'processing' || deliveryStatus === 'pending') return 'pending';
  return 'unknown';
};

const isConfirmedReceipt = recipient => {
  const deliveryStatus = normalizeStatus(recipient?.delivery_status);
  return RECEIPT_STATES.has(deliveryStatus);
};

const formatDateTime = (value, locale) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(locale);
};

const filenameFromHeaders = headers => {
  const disposition = headers?.['content-disposition'] || headers?.['Content-Disposition'] || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].replace(/^["']|["']$/g, ''));
    } catch (_) {
      // Fall through to the regular filename/default.
    }
  }
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  return plain?.[1] || '';
};

const safeFilenamePart = value => String(value || 'whatsapp-campaign-report')
  .replace(/[^\w\u0600-\u06FF.-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'whatsapp-campaign-report';

export function WhatsAppCampaignReport({
  branchId,
  job,
  open,
  onOpenChange,
  language = 'en',
  branchName,
  campaignName,
}) {
  const ar = language === 'ar';
  const t = (arabic, english) => ar ? arabic : english;
  const locale = ar ? 'ar-SA' : 'en-US';
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const jobId = job?.id || job?.job_id;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setReport(null);
    setError('');
    setDownloadError('');
    setSearch('');
    setStatusFilter('all');
    if (!branchId || !jobId) {
      setError(t('لا يمكن تحديد حملة الإرسال.', 'This campaign could not be identified.'));
      return undefined;
    }
    if (typeof whatsappAPI.getBranchCloudJobReport !== 'function') {
      setError(t('واجهة تقرير الحملة غير متاحة.', 'The campaign report service is unavailable.'));
      return undefined;
    }
    setLoading(true);
    whatsappAPI.getBranchCloudJobReport(branchId, jobId)
      .then(response => {
        if (cancelled) return;
        const data = response?.data || {};
        setReport({
          job: { ...(job || {}), ...(data.job || {}) },
          summary: data.summary || {},
          recipients: Array.isArray(data.recipients) ? data.recipients : [],
          notes: Array.isArray(data.notes) ? data.notes : [],
        });
      })
      .catch(reportError => {
        if (cancelled) return;
        const message = apiErrorMessage(
          reportError,
          t('تعذر تحميل تقرير الحملة.', 'Could not load the campaign report.'),
        );
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The report is intentionally fetched each time the dialog opens so that
    // a report opened immediately after queueing can later show receipt updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branchId, jobId]);

  const reportJob = report?.job || job || {};
  const recipients = report?.recipients || [];
  const summary = report?.summary || {};

  const filteredRecipients = useMemo(() => {
    const query = search.trim().toLowerCase();
    return recipients.filter(recipient => {
      const state = recipientState(recipient);
      if (statusFilter !== 'all' && state !== statusFilter) return false;
      if (!query) return true;
      return [
        recipient?.id,
        recipient?.name,
        recipient?.phone,
        recipient?.status,
        recipient?.delivery_status,
        recipient?.error,
      ].some(value => String(value || '').toLowerCase().includes(query));
    });
  }, [recipients, search, statusFilter]);

  const campaignTitle = firstValue(
    reportJob.campaign_name,
    reportJob.campaign_title,
    reportJob.name,
    reportJob.title,
    job?.campaign_name,
    job?.campaign_title,
    job?.name,
    campaignName,
    t('حملة تلقائية', 'Automatic campaign'),
  );
  const branchTitle = firstValue(
    reportJob.branch_name,
    typeof reportJob.branch === 'object' ? reportJob.branch?.name : reportJob.branch,
    job?.branch_name,
    typeof job?.branch === 'object' ? job?.branch?.name : job?.branch,
    branchName,
    reportJob.branch_id,
    job?.branch_id,
  );
  const timestampFields = [
    ['created_at', 'Created', 'أُنشئت'],
    ['queued_at', 'Queued', 'أضيفت للطابور'],
    ['started_at', 'Started', 'بدأت'],
    ['completed_at', 'Completed', 'اكتملت'],
    ['finished_at', 'Finished', 'انتهت'],
    ['updated_at', 'Updated', 'حُدّثت'],
  ];
  const timestamps = timestampFields
    .map(([key, english, arabic]) => ({
      key,
      label: t(arabic, english),
      value: firstValue(reportJob[key], job?.[key]),
    }))
    .filter(timestamp => timestamp.value);

  const getSummaryCount = key => {
    if (key === 'total') return numberValue(firstValue(summary.total, recipients.length));
    if (key === 'accepted') return numberValue(firstValue(summary.accepted, summary.sent));
    if (key === 'pending') return numberValue(firstValue(summary.pending, summary.processing));
    return numberValue(summary[key]);
  };

  const statusLabel = state => ({
    pending: t('معلّق', 'Pending'),
    accepted: t('مقبول من المزود', 'Accepted by provider'),
    partial: t('جزئي', 'Partial'),
    delivered: t('تم التسليم', 'Delivered'),
    read: t('تمت القراءة', 'Read'),
    failed: t('فشل', 'Failed'),
    unknown: t('غير معروف', 'Unknown'),
    cancelled: t('ملغى', 'Cancelled'),
  }[state] || t('غير معروف', 'Unknown'));

  const statusClass = state => ({
    pending: 'bg-amber-100 text-amber-800',
    accepted: 'bg-blue-100 text-blue-800',
    partial: 'bg-amber-100 text-amber-800',
    delivered: 'bg-emerald-100 text-emerald-800',
    read: 'bg-indigo-100 text-indigo-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-800',
    unknown: 'bg-gray-100 text-gray-800',
  }[state] || 'bg-gray-100 text-gray-800');

  const downloadReport = async () => {
    if (!branchId || !jobId) return;
    setDownloadLoading(true);
    setDownloadError('');
    try {
      if (typeof whatsappAPI.downloadBranchCloudJobReport !== 'function') {
        throw new Error('Report download service is unavailable');
      }
      const response = await whatsappAPI.downloadBranchCloudJobReport(branchId, jobId);
      const blob = response?.data;
      if (!blob) throw new Error('Report download returned no file');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const filename = filenameFromHeaders(response.headers)
        || `${safeFilenamePart(campaignTitle)}-${safeFilenamePart(jobId)}.xlsx`;
      anchor.href = url;
      anchor.download = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadException) {
      const message = apiErrorMessage(
        downloadException,
        t('تعذر تنزيل ملف Excel.', 'Could not download the Excel report.'),
      );
      setDownloadError(message);
      toast.error(message);
    } finally {
      setDownloadLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[96vw] max-w-6xl max-h-[90vh] overflow-hidden flex flex-col"
        dir={ar ? 'rtl' : 'ltr'}
        data-testid="whatsapp-campaign-report"
      >
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3 pe-8">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-600" />
                {t('تقرير حملة واتساب', 'WhatsApp campaign report')}
              </DialogTitle>
              <DialogDescription className="mt-2">
                <span className="font-medium text-foreground">{campaignTitle}</span>
                {branchTitle && <span> · {branchTitle}</span>}
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={downloadReport}
              disabled={loading || downloadLoading || Boolean(error)}
              aria-label={t('تنزيل تقرير Excel', 'Download Excel report')}
            >
              {downloadLoading
                ? <Loader2 className="w-4 h-4 me-1 animate-spin" />
                : <Download className="w-4 h-4 me-1" />}
              {t('تنزيل Excel', 'Download Excel')}
            </Button>
          </div>
          {timestamps.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1" data-testid="report-timestamps">
              {timestamps.map(timestamp => (
                <span key={timestamp.key}>
                  <span className="font-medium">{timestamp.label}:</span>{' '}
                  <time dateTime={String(timestamp.value)}>{formatDateTime(timestamp.value, locale)}</time>
                </span>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="overflow-y-auto min-h-0 space-y-4 pe-1">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status">
              <Loader2 className="w-5 h-5 animate-spin" />
              {t('جاري تحميل التقرير…', 'Loading report…')}
            </div>
          )}
          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
              {error}
            </div>
          )}
          {!loading && !error && report && (
            <>
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
                {t(
                  'مقبول من المزود يعني أن المزود قبل الطلب فقط. لا نعرض الرسالة على أنها تم تسليمها أو قراءتها إلا عند وصول إثبات حالة من المزود.',
                  'Accepted by provider means the provider accepted the request only. A message is not shown as delivered or read unless the provider supplies receipt proof.',
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {SUMMARY_KEYS.map(([key, english, arabic, classes]) => (
                  <div key={key} className={`rounded-lg p-3 ${classes}`} data-testid={`report-summary-${key}`}>
                    <div className="text-xs font-medium">{t(arabic, english)}</div>
                    <div className="text-xl font-bold mt-1">{getSummaryCount(key).toLocaleString(locale)}</div>
                  </div>
                ))}
              </div>

              {report.notes.length > 0 && (
                <div className="rounded-lg border bg-muted/20 p-3 space-y-1" data-testid="report-notes">
                  <p className="text-sm font-semibold">{t('ملاحظات', 'Notes')}</p>
                  <ul className="list-disc ps-5 text-xs text-muted-foreground space-y-1">
                    {report.notes.map((note, index) => (
                      <li key={`${index}-${String(note)}`}>{typeof note === 'string' ? note : (note?.message || JSON.stringify(note))}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder={t('ابحث بالاسم أو الرقم أو الخطأ', 'Search name, phone, or error')}
                    aria-label={t('البحث في المستلمين', 'Search recipients')}
                    className="ps-9"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={event => setStatusFilter(event.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  aria-label={t('تصفية حسب الحالة', 'Filter by status')}
                >
                  <option value="all">{t('كل الحالات', 'All statuses')}</option>
                  <option value="pending">{t('معلّق', 'Pending')}</option>
                  <option value="accepted">{t('مقبول', 'Accepted')}</option>
                  <option value="partial">{t('جزئي', 'Partial')}</option>
                  <option value="delivered">{t('تم التسليم', 'Delivered')}</option>
                  <option value="read">{t('تمت القراءة', 'Read')}</option>
                  <option value="failed">{t('فشل', 'Failed')}</option>
                  <option value="unknown">{t('غير معروف', 'Unknown')}</option>
                  <option value="cancelled">{t('ملغى', 'Cancelled')}</option>
                </select>
              </div>

              {downloadError && <p className="text-sm text-red-600" role="alert">{downloadError}</p>}
              {recipients.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="report-empty">
                  {t('لا يوجد مستلمون في هذا التقرير.', 'No recipients in this report.')}
                </div>
              ) : filteredRecipients.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="report-no-matches">
                  {t('لا توجد نتائج مطابقة.', 'No matching recipients.')}
                </div>
              ) : (
                <div className="border rounded-lg overflow-auto max-h-[42vh]">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-start p-2">{t('المستلم', 'Recipient')}</th>
                        <th className="text-start p-2">{t('الرقم', 'Phone')}</th>
                        <th className="text-start p-2">{t('الحالة', 'Status')}</th>
                        <th className="text-start p-2">{t('حالة التسليم', 'Delivery')}</th>
                        <th className="text-start p-2">{t('الأوقات', 'Timestamps')}</th>
                        <th className="text-start p-2">{t('الخطأ', 'Error')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecipients.map((recipient, index) => {
                        const state = recipientState(recipient);
                        const confirmed = isConfirmedReceipt(recipient);
                        return (
                          <tr key={recipient.id || `${recipient.phone}-${index}`} className="border-t align-top">
                            <td className="p-2">{recipient.name || t('— بدون اسم', '— No name')}</td>
                            <td className="p-2 font-mono">{recipient.phone || '—'}</td>
                            <td className="p-2">
                              <Badge className={`text-xs ${statusClass(state)}`}>{statusLabel(state)}</Badge>
                            </td>
                            <td className="p-2 text-xs">
                              {confirmed
                                ? statusLabel(normalizeStatus(recipient.delivery_status))
                                : t('غير مؤكد', 'Unconfirmed')}
                            </td>
                            <td className="p-2 text-xs text-muted-foreground space-y-1">
                              {recipient.sent_at && <div>{t('قبول', 'Accepted')}: {formatDateTime(recipient.sent_at, locale)}</div>}
                              {recipient.delivered_at && <div>{t('تسليم', 'Delivered')}: {formatDateTime(recipient.delivered_at, locale)}</div>}
                              {recipient.read_at && <div>{t('قراءة', 'Read')}: {formatDateTime(recipient.read_at, locale)}</div>}
                              {!recipient.sent_at && !recipient.delivered_at && !recipient.read_at && '—'}
                            </td>
                            <td className="p-2 text-xs text-red-700 max-w-[220px] break-words">{recipient.error || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {t(
                  `عرض ${filteredRecipients.length} من ${recipients.length} مستلم`,
                  `Showing ${filteredRecipients.length} of ${recipients.length} recipient(s)`,
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default WhatsAppCampaignReport;
