import React from 'react';
import { Badge } from './ui/badge';

export const statusCheckFailed = (status) => Boolean(status && (
  status.check_ok === false || status.error ||
  ['unavailable', 'unknown'].includes(status.status)
));

export function providerStatusError(status, language) {
  const ar = language === 'ar';
  const code = status?.error || 'status_check_failed';
  if (['http_401', 'http_403'].includes(code)) {
    return ar ? 'رفض المزود طلب التحقق؛ راجع مفتاح API وصلاحياته.' : 'The provider denied the check. Review the API key and its permissions.';
  }
  if (code === 'http_404') return ar ? 'لم يعثر المزود على المورد المطلوب؛ راجع اسم INSTANCE وإعدادات الخدمة.' : 'The provider could not find the resource. Review the INSTANCE name and service settings.';
  if (code === 'http_429') return ar ? 'تم تجاوز حد الطلبات لدى المزود؛ حاول لاحقاً.' : 'Provider request limit reached. Try again later.';
  if (code.includes('Timeout')) return ar ? 'انتهت مهلة الاتصال بالمزود؛ حاول مجدداً.' : 'The provider connection timed out. Try again.';
  if (code === 'ConnectError') return ar ? 'تعذّر الوصول إلى خدمة Whatsflow.' : 'Could not reach Whatsflow.';
  if (code === 'invalid_status_response') return ar ? 'استجاب المزود دون حالة اتصال معروفة.' : 'The provider returned no recognized connection state.';
  return ar ? 'تعذّر التحقق من حالة الاتصال لدى المزود؛ حاول لاحقاً.' : 'Could not verify the connection with the provider. Try again later.';
}

export default function WhatsAppProviderStatus({ status, language }) {
  if (!status) return null;
  const ar = language === 'ar';
  const failed = statusCheckFailed(status);
  const label = failed
    ? (ar ? 'تعذّر التحقق من الاتصال' : 'Could not verify connection')
    : status.connected
      ? (ar ? 'متصل' : 'Connected')
      : status.status === 'not_started'
        ? (ar ? 'الجلسة لم تبدأ' : 'Session not started')
      : ['connecting', 'STARTING'].includes(status.status)
        ? (ar ? 'جارٍ الاتصال' : 'Connecting')
        : (ar ? 'غير متصل' : 'Not connected');
  return <div className="text-sm" role="status">
    <Badge variant={failed ? 'destructive' : status.connected ? 'default' : 'secondary'}>{label}</Badge>
    {status.status === 'not_started' ? <p className="mt-2 text-muted-foreground">{ar ? 'اضغط «بدء» لإنشاء الجلسة، ثم اعرض رمز QR لربط الهاتف.' : 'Select Start to create the session, then show the QR code to link the phone.'}</p> : failed ? <p className="mt-2 text-destructive">{providerStatusError(status, language)}
      {status.error && /^(http_\d{3}|[A-Za-z_]+)$/.test(status.error) &&
        <span className="ms-2" dir="ltr">({status.error})</span>}
    </p> : <span className="ms-2 text-muted-foreground">{status.status || ''}</span>}
  </div>;
}
