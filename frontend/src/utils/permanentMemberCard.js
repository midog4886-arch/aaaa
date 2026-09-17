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
      note: 'بطاقة قابلة لإعادة الاستخدام بعد تحقق النظام من أهلية العضو الحالية.',
      qr: 'رمز التحقق',
    }
  : {
      direction: 'ltr',
      title: 'Permanent Membership Card',
      code: 'Member code',
      note: 'This reusable card is valid after the system verifies the member’s current eligibility.',
      qr: 'Verification code',
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
    .card { width: 54mm; height: 85.6mm; flex: none; overflow: hidden; display: flex; flex-direction: column; background: #ffffff; border: .35mm solid #45337d; border-radius: 3mm; break-inside: avoid; }
    .header { min-height: 13mm; padding: 2mm 2.5mm; display: flex; align-items: center; gap: 2mm; color: #ffffff; background: linear-gradient(135deg, #01193d, #45337d); }
    .logo-wrap { width: 9mm; height: 9mm; flex: 0 0 9mm; border-radius: 50%; padding: .7mm; background: #ffffff; }
    .logo { width: 100%; height: 100%; object-fit: contain; display: block; }
    .academy { min-width: 0; font-size: 8pt; font-weight: 700; line-height: 1.25; }
    .card-title { margin-top: .6mm; font-size: 5.5pt; font-weight: 500; opacity: .94; }
    .content { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5mm; padding: 2mm; text-align: center; }
    .identity { min-width: 0; width: 100%; }
    .name-label, .code-label { color: #6b7280; font-size: 5.5pt; }
    .name { margin: .5mm 0 1mm; color: #111827; font-size: 10pt; line-height: 1.2; font-weight: 700; overflow-wrap: anywhere; }
    .code { color: #45337d; font-size: 10pt; letter-spacing: .2mm; font-weight: 700; overflow-wrap: anywhere; }
    .member-details { font-size: 7pt; line-height: 1.25; margin-top: 1mm; overflow-wrap: anywhere; }
    .activity-names { font-weight: 700; margin-bottom: .7mm; }
    .guardian-phone { font-size: 9pt; font-weight: 700; direction: ltr; }
    .qr-wrap { width: 26mm; height: 26mm; flex: 0 0 26mm; padding: 2mm; border: .3mm solid #dcd5ef; border-radius: 2mm; background: #ffffff; }
    .qr { display: block; width: 100%; height: 100%; }
    .qr-missing { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; color: #b91c1c; text-align: center; font-size: 5pt; }
    .footer { min-height: 7.5mm; padding: 1.4mm 3mm; color: #45337d; background: #f5f3fa; border-top: .25mm solid #dcd5ef; font-size: 5.2pt; line-height: 1.35; }
    .qr-label { display: none; }
    .back { align-items: center; justify-content: center; text-align: center; gap: 3mm; padding: 2mm; background: linear-gradient(180deg, #ffffff, #f5f3fa); }
    .back-logo { width: 49mm; height: 60mm; object-fit: contain; flex-shrink: 0; }
    .branch-phone { font-size: 12pt; font-weight: 700; direction: ltr; color: #111827; }
    .contact-label { font-size: 8pt; color: #45337d; }
    @media screen { body { display: flex; flex-wrap: wrap; gap: 5mm; padding: 4mm; } .card { box-shadow: 0 3px 16px rgba(0,0,0,.18); } }
    @media print { html, body { width: 54mm; background: #ffffff; } body { display: block; } .card { border-radius: 0; break-after: page; page-break-after: always; print-color-adjust: exact; -webkit-print-color-adjust: exact; } .card:last-child { break-after: auto; page-break-after: auto; } }
  </style>
</head>
<body>
  <main class="card front" aria-label="${escapeHtml(labels.title)}">
    <header class="header">
      <div class="logo-wrap"><img class="logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(academyName)}" /></div>
      <div class="academy">${escapeHtml(academyName)}<div class="card-title">${escapeHtml(labels.title)}</div></div>
    </header>
    <section class="content">
      <div class="identity">
        <div class="name-label">${language === 'ar' ? 'الاسم' : 'Name'}</div>
        <div class="name">${escapeHtml(name)}</div>
        <div class="code-label">${escapeHtml(labels.code)}</div>
        <div class="code">${escapeHtml(code)}</div>
        <div class="member-details">
          <div class="activity-names">${escapeHtml(activityNames.join(' • ') || (language === 'ar' ? 'لا يوجد نشاط مسجل' : 'No activity registered'))}</div>
          <div class="code-label">${language === 'ar' ? 'جوال ولي الأمر' : 'Guardian phone'}</div>
          <div class="guardian-phone">${escapeHtml(guardianPhone || '—')}</div>
        </div>
      </div>
      <div class="qr-wrap">${qrMarkup}</div>
    </section>
    <footer class="footer">${escapeHtml(labels.note)}</footer>
  </main>
  <section class="card back" aria-label="${language === 'ar' ? 'ظهر البطاقة' : 'Card back'}">
    <img class="back-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(academyName)}" />
    <div class="contact-label">${language === 'ar' ? 'للتواصل مع الفرع' : 'Branch contact'}</div>
    <div class="branch-phone">${escapeHtml(branchPhone || (language === 'ar' ? 'رقم الفرع غير مسجل' : 'Branch phone not configured'))}</div>
  </section>
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