import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';

// This design is intentionally exclusive to the daily membership-cards page.
// Other print entry points retain their established card/sticker layouts.
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const cardText = (language) => language === 'ar'
  ? {
      direction: 'rtl',
      title: 'بطاقة عضوية دائمة',
      code: 'رقم العضوية',
      note: 'الاشتراك الحالي يُتحقق منه عند مسح الرمز',
      qr: 'رمز التحقق',
      activities: 'الأنشطة',
      guardianPhone: 'جوال ولي الأمر',
      branchPhone: 'رقم الفرع',
    }
  : {
      direction: 'ltr',
      title: 'Permanent Membership Card',
      code: 'Member code',
      note: 'Current subscription is verified when the code is scanned',
      qr: 'Verification code',
      activities: 'Activities',
      guardianPhone: 'Guardian phone',
      branchPhone: 'Branch phone',
    };

export const getPermanentMemberCardDetails = (member = {}) => ({
  activityNames: [...new Set((member.activities || member.active_activities || [])
    .map((activity) => typeof activity === 'string' ? activity : activity.activity_name || activity.name_ar || activity.name || '')
    .map((name) => name.trim()).filter(Boolean))],
  // Use only the contact data supplied by the authorized caller; never fetch
  // an unmasked phone or substitute the branch contact.
  guardianPhone: member.guardian_phone || member.parent_phone || member.phone || '',
});

/**
 * Creates the single-card document used for both the preview and printing.
 * Membership eligibility is deliberately verified by the system, rather than
 * printed as subscription data that would become stale after a renewal.
 */
export const buildPermanentMemberCardHtml = ({
  member = {},
  qrValue,
  logoUrl = '',
  academyName = '',
  language = 'ar',
  branchPhone = member.branch_phone || '',
} = {}) => {
  const labels = cardText(language);
  const name = member.name_ar ?? member.name ?? '';
  const code = member.member_code ?? member.id ?? '';
  const { activityNames, guardianPhone } = getPermanentMemberCardDetails(member);
  const activityText = activityNames.join(' • ') || (language === 'ar' ? 'لا يوجد نشاط مسجل' : 'No activity registered');
  const contactText = branchPhone || (language === 'ar' ? 'رقم الفرع غير مسجل' : 'Branch phone not configured');
  // Do not normalize, trim, or otherwise change the encoded QR value.
  const qrPayload = String(qrValue ?? '');
  const qrMarkup = qrPayload
    ? renderToStaticMarkup(createElement(QRCodeSVG, {
        value: qrPayload,
        size: 240,
        level: 'M',
        includeMargin: false,
        className: 'qr',
        'aria-label': labels.qr,
      }))
    : `<div class="qr-missing">${escapeHtml(language === 'ar' ? 'رمز التحقق غير متاح' : 'Verification code unavailable')}</div>`;

  return `<!doctype html>
<html lang="${language === 'ar' ? 'ar' : 'en'}" dir="${labels.direction}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(labels.title)} — ${escapeHtml(code)}</title>
  <style>
    @page { size: 54mm 85.6mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, "Tajawal", sans-serif; background: #f5f3fa; color: #1f2937; }
    .card { width: 54mm; height: 85.6mm; flex: none; overflow: hidden; display: flex; flex-direction: column; background: #ffffff; border-radius: 3mm; break-inside: avoid; }
    .header { min-height: 19mm; padding: 2mm 2.5mm; display: flex; align-items: center; gap: 2mm; color: #ffffff; background: linear-gradient(115deg, #122d67, #314ca5); }
    .logo-wrap { width: 15mm; height: 15mm; flex: 0 0 15mm; border-radius: 2.5mm; padding: .8mm; background: #ffffff; }
    .logo { width: 100%; height: 100%; object-fit: contain; display: block; }
    .academy { min-width: 0; font-size: 7.5pt; font-weight: 700; line-height: 1.25; }
    .card-title { margin-top: .7mm; font-size: 5.5pt; font-weight: 500; opacity: .94; }
    .content { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; gap: .7mm; padding: 2mm 2.5mm 1mm; text-align: center; }
    .identity { min-width: 0; width: 100%; }
    .name-label, .code-label { color: #73809a; font-size: 5.5pt; }
    .name { margin: .4mm 0 .7mm; color: #10244d; font-size: 10pt; line-height: 1.16; font-weight: 700; overflow-wrap: anywhere; }
    .code { color: #10244d; font-size: 11pt; letter-spacing: .15mm; font-weight: 700; overflow-wrap: anywhere; direction: ltr; }
    .member-details { width: 100%; margin-top: auto; margin-bottom: 1mm; padding-top: 1.2mm; border-top: .25mm solid #e4e9f3; display: flex; flex-direction: column; gap: 1mm; font-size: 6pt; line-height: 1.2; overflow-wrap: anywhere; }
    .detail-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1.5mm; text-align: start; }
    .detail-row.phone-detail { flex-direction: column; align-items: center; gap: .2mm; text-align: center; }
    .detail-row.phone-detail .detail-value { text-align: center; }
    .detail-label { color: #56627b; flex: 0 0 auto; }
    .detail-value { color: #10244d; font-weight: 700; text-align: end; min-width: 0; }
    .guardian-phone, .branch-phone { direction: ltr; unicode-bidi: isolate; white-space: nowrap; }
    .qr-wrap { width: 23mm; height: 23mm; flex: 0 0 23mm; padding: 1mm; margin-top: .6mm; border: .25mm solid #dce3f0; background: #ffffff; }
    .qr { display: block; width: 100%; height: 100%; }
    .qr-missing { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; color: #b91c1c; text-align: center; font-size: 5pt; }
    .footer { min-height: 6mm; display: flex; align-items: center; justify-content: center; padding: 1mm 2mm; color: #274383; background: #eaf0ff; font-size: 5pt; line-height: 1.2; text-align: center; }
    @media screen { body { display: flex; flex-wrap: wrap; gap: 5mm; padding: 4mm; } .card { box-shadow: 0 3px 16px rgba(0,0,0,.18); } }
    @media print { html, body { width: 54mm; background: #ffffff; } body { display: block; } .card { border-radius: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <main class="card front" aria-label="${escapeHtml(labels.title)}">
    <header class="header">
      <div class="logo-wrap"><img class="logo" src="${escapeHtml(logoUrl || '/images/academy-logo.png')}" alt="${escapeHtml(academyName)}" /></div>
      <div class="academy">${escapeHtml(academyName)}<div class="card-title">${escapeHtml(labels.title)}</div></div>
    </header>
    <section class="content">
      <div class="identity">
        <div class="name-label">${language === 'ar' ? 'الاسم' : 'Name'}</div>
        <div class="name">${escapeHtml(name)}</div>
        <div class="code-label">${escapeHtml(labels.code)}</div>
        <div class="code">${escapeHtml(code)}</div>
      </div>
      <div class="qr-wrap">${qrMarkup}</div>
      <div class="member-details">
        <div class="detail-row"><span class="detail-label">${labels.activities}</span><strong class="detail-value activity-names">${escapeHtml(activityText)}</strong></div>
        <div class="detail-row phone-detail"><span class="detail-label">${labels.guardianPhone}</span><strong class="detail-value guardian-phone">${escapeHtml(guardianPhone || '—')}</strong></div>
        <div class="detail-row phone-detail"><span class="detail-label">${labels.branchPhone}</span><strong class="detail-value branch-phone">${escapeHtml(contactText)}</strong></div>
      </div>
    </section>
    <footer class="footer">${escapeHtml(labels.note)}</footer>
  </main>
</body>
</html>`;
};

const waitForImages = (document) => {
  const images = Array.from(document.images || []);
  if (!images.length) return Promise.resolve();

  return Promise.all(images.map((image) => new Promise((resolve) => {
    if (image.complete) {
      resolve();
      return;
    }
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', resolve, { once: true });
  })));
};

/**
 * Opens the print window immediately (to satisfy popup blockers), then waits
 * for the academy logo to settle before asking the browser to print. The QR
 * is inline SVG, so it is fully present before the document is written.
 */
export const openPermanentMemberCardPrint = (options = {}) => {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null;
  if (options.qrValue === null || options.qrValue === undefined || String(options.qrValue) === '') return null;

  const printWindow = window.open('', '_blank', 'width=540,height=480');
  if (!printWindow) return null;

  try {
    printWindow.document.open();
    printWindow.document.write(buildPermanentMemberCardHtml(options));
    printWindow.document.close();
    const resourcesReady = waitForImages(printWindow.document);
    const maxWait = new Promise((resolve) => window.setTimeout(resolve, 5000));

    Promise.race([resourcesReady, maxWait]).then(() => {
      if (!printWindow.closed) {
        printWindow.focus?.();
        printWindow.print?.();
      }
    });
  } catch (_error) {
    printWindow.close?.();
    return null;
  }

  return printWindow;
};
