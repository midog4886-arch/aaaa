/**
 * Print utilities for invoices and member cards
 */

import { CARD_WIDTH, CARD_HEIGHT, TOP_MARGIN, RIGHT_MARGIN, GAP, VAT_RATE, COMPANY_INFO, INVOICE_TERMS } from './constants';

const _escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
import { getAcademyLogoUrl, getPrimaryColor } from '../../services/branding';

/**
 * Generate QR data for member - Just the member code number
 */
export const generateQRData = (member) => {
  return (member?.member_code || '').toString();
};

/**
 * Generate activities HTML for card
 */
export const generateActivitiesHTML = (activities = []) => {
  return activities.map(act => `
    <div class="activity-item ${act.status || 'active'}">
      <div class="activity-name">${act.status === 'active' ? '✓' : '✗'} ${act.activity_name || ''}</div>
      <div class="activity-status">${act.status === 'active' ? 'ساري' : 'منتهي'}</div>
    </div>
  `).join('');
};

/**
 * Get print CSS styles for member card
 */
export const getCardPrintStyles = () => {
  const _brand = getPrimaryColor();
  const _headerBg = _brand || 'linear-gradient(135deg, #F97316, #F59E0B)';
  const _accent = _brand || '#F97316';
  return `
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
  @page { size: A4; margin: 0mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Tajawal', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
  .screen-only { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
  @media print { .screen-only { display: none !important; } .print-area { display: flex !important; position: absolute; top: ${TOP_MARGIN}mm; right: ${RIGHT_MARGIN}mm; gap: ${GAP}mm; } }
  @media screen { .print-area { display: none; } }
  .sticker-preview { display: flex; gap: 15px; justify-content: center; margin-bottom: 20px; }
  .card { width: ${CARD_WIDTH}mm; height: ${CARD_HEIGHT}mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
  .card-header { background: ${_headerBg}; padding: 1.5mm 2mm; display: flex; justify-content: space-between; align-items: center; color: white; }
  .header-text h2 { font-size: 7pt; font-weight: 700; margin: 0; line-height: 1.3; }
  .header-text p { font-size: 5.5pt; opacity: 0.9; margin: 0; }
  .header-logo { width: 10mm; height: 10mm; border-radius: 50%; background: white; padding: 0.5mm; display: flex; align-items: center; justify-content: center; }
  .header-logo img { width: 100%; height: 100%; object-fit: contain; border-radius: 50%; }
  .card-body { padding: 2mm; display: flex; gap: 2mm; flex: 1; }
  .info-section { flex: 1; text-align: right; overflow: hidden; }
  .qr-container { display: flex; flex-direction: column; align-items: center; }
  .qr-section { width: 22mm; height: 22mm; background: white; border: 1px solid #eee; border-radius: 2mm; padding: 0.5mm; }
  .qr-section img { width: 100%; height: 100%; }
  .qr-dates { text-align: center; font-size: 8pt; color: #1f2937; margin-top: 1mm; line-height: 1.4; font-weight: 700; }
  .qr-dates span { display: block; }
  .schedule-info { text-align: center; font-size: 6pt; color: ${_accent}; margin-top: 1mm; font-weight: 600; background: #FFF7ED; padding: 1mm; border-radius: 2mm; }
  .member-name { font-size: 10pt; font-weight: 700; color: #1f2937; margin-bottom: 1mm; }
  .info-row { display: flex; align-items: center; gap: 1mm; margin-bottom: 0.8mm; font-size: 7pt; }
  .info-label { color: #6b7280; font-size: 6pt; }
  .member-code { color: ${_accent}; font-weight: 700; font-size: 10pt; }
  .activities { margin-top: 1mm; padding-top: 1mm; border-top: 1px dashed #e5e7eb; }
  .activities-label { font-size: 6pt; color: #6b7280; margin-bottom: 0.5mm; }
  .activity-item { padding: 1mm 1.5mm; margin-bottom: 0.5mm; border-radius: 1.5mm; font-size: 6pt; }
  .activity-item.active { background: #D1FAE5; border-right: 2px solid #10B981; }
  .activity-item.expired { background: #FEE2E2; border-right: 2px solid #EF4444; }
  .activity-name { font-weight: 600; color: #1f2937; font-size: 7pt; }
  .activity-status { font-size: 6pt; font-weight: 700; }
  .activity-item.active .activity-status { color: #059669; }
  .activity-item.expired .activity-status { color: #DC2626; }
  .card-footer { text-align: right; padding: 1.5mm 2mm; background: #f9fafb; font-size: 5pt; color: #374151; border-top: 1px dashed #e5e7eb; line-height: 1.4; }
  .card-footer .terms-title { font-weight: 700; color: #1f2937; font-size: 6pt; margin-bottom: 0.5mm; }
  .logo-card { width: ${CARD_WIDTH}mm; height: ${CARD_HEIGHT}mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3mm; }
  .logo-card img { max-width: 100%; max-height: 55%; object-fit: contain; }
  .logo-card .contact-info { font-size: 7pt; color: #374151; text-align: center; margin-top: 2mm; font-weight: 600; line-height: 1.6; }
  .logo-card .lost-card-notice { font-size: 7pt; color: #DC2626; text-align: center; margin-top: 2mm; font-weight: 700; line-height: 1.5; background: #FEF2F2; padding: 2mm 3mm; border-radius: 2mm; border: 1.5px solid #EF4444; }
  .print-btn { margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #F97316, #EA580C); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal', Arial, sans-serif; font-size: 16px; font-weight: bold; }
  .position-labels { display: flex; gap: 15px; justify-content: center; margin-top: 10px; }
  .position-label { padding: 8px 16px; background: #FEF3C7; border-radius: 8px; color: #92400E; font-size: 12px; }
`;
};

/**
 * Generate member card HTML
 */
export const generateCardHTML = (member, qrData, schedule) => {
  const firstActivity = member?.activities?.[0];
  const startDate = firstActivity?.start_date || '';
  const endDate = firstActivity?.end_date || '';
  const activitiesHtml = generateActivitiesHTML(member?.activities);

  return `
    <div class="card">
      <div class="card-header">
        <div class="header-text"><h2>${COMPANY_INFO.name_ar}</h2><p>${COMPANY_INFO.name_en}</p></div>
        <div class="header-logo"><img src="${getAcademyLogoUrl()}" alt="logo" /></div>
      </div>
      <div class="card-body">
        <div class="qr-container">
          <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
          <div class="qr-dates">
            <span>من: ${startDate || '----'}</span>
            <span>إلى: ${endDate || '----'}</span>
          </div>
          ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
        </div>
        <div class="info-section">
          <div class="info-label">الاسم</div>
          <div class="member-name">${member?.name_ar || ''}</div>
          <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${member?.member_code || ''}</span></div>
          <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${member?.phone || '-'}</span></div>
          ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
        </div>
      </div>
      <div class="card-footer">
        <div class="terms-title">شروط وأحكام:</div>
        ${(INVOICE_TERMS.ar || []).slice(0, 2).map(t => `<div>• ${_escapeHtml(t)}</div>`).join('')}
      </div>
    </div>
  `;
};

/**
 * Print member card with logo
 */
export const printMemberCard = (member) => {
  if (!member) return;
  
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  const qrData = generateQRData(member);
  const firstActivity = member?.activities?.[0];
  const schedule = firstActivity?.schedule || '';
  
  const cardHTML = generateCardHTML(member, qrData, schedule);
  
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>بطاقة العضوية - ${member?.member_code}</title>
        <style>${getCardPrintStyles()}</style>
      </head>
      <body>
        <div class="screen-only">
          <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة الطباعة - كرت العضوية + شعار الأكاديمية</p>
          <div class="sticker-preview">
            ${cardHTML}
            <div class="logo-card">
              <img src="${getAcademyLogoUrl()}" alt="شعار الأكاديمية" />
              <div class="contact-info">📞 0566238384</div>
              <div class="lost-card-notice">⚠️ في حال فقدان كرت العضوية،<br/>يتم إصدار كرت جديد برسوم 10 ر.س</div>
            </div>
          </div>
          <div class="position-labels">
            <div class="position-label">📍 خانة 1: كرت العضوية</div>
            <div class="position-label">📍 خانة 2: شعار الأكاديمية</div>
          </div>
          <p style="margin-top: 10px; color: #6b7280; font-size: 14px;">📐 حجم كل كرت: 9سم × 6سم</p>
          <button class="print-btn" onclick="window.print()">🖨️ طباعة الملصقات</button>
        </div>
        <div class="print-area">
          ${cardHTML}
          <div class="logo-card">
            <img src="${getAcademyLogoUrl()}" alt="شعار الأكاديمية" />
            <div class="contact-info">📞 0566238384</div>
            <div class="lost-card-notice">⚠️ في حال فقدان كرت العضوية،<br/>يتم إصدار كرت جديد برسوم 10 ر.س</div>
          </div>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
};

/**
 * Get invoice print styles
 */
export const getInvoicePrintStyles = () => `
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
  @page { size: A4; margin: 10mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Tajawal', Arial, sans-serif; direction: rtl; font-size: 12pt; }
  .invoice { max-width: 210mm; margin: 0 auto; padding: 15mm; }
  .invoice-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #F97316; padding-bottom: 15px; }
  .company-info h1 { color: #F97316; font-size: 18pt; margin-bottom: 5px; }
  .company-info p { color: #666; font-size: 10pt; }
  .invoice-number { text-align: left; }
  .invoice-number h2 { color: #333; font-size: 14pt; }
  .invoice-number p { color: #666; font-size: 10pt; }
  .customer-info { background: #f9fafb; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
  .customer-info h3 { color: #333; margin-bottom: 10px; font-size: 12pt; }
  .customer-info p { color: #666; font-size: 10pt; margin-bottom: 5px; }
  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  .items-table th { background: #F97316; color: white; padding: 10px; text-align: right; font-size: 10pt; }
  .items-table td { padding: 10px; border-bottom: 1px solid #eee; font-size: 10pt; }
  .items-table tr:nth-child(even) { background: #f9fafb; }
  .totals { text-align: left; margin-top: 20px; }
  .totals p { font-size: 11pt; margin-bottom: 5px; }
  .totals .total { font-size: 14pt; font-weight: bold; color: #F97316; }
  .terms { margin-top: 30px; padding-top: 15px; border-top: 1px dashed #ccc; }
  .terms h4 { color: #333; margin-bottom: 10px; font-size: 11pt; }
  .terms ul { color: #666; font-size: 9pt; padding-right: 20px; }
  .terms li { margin-bottom: 5px; }
  .qr-section { text-align: center; margin-top: 20px; }
  .qr-section img { width: 100px; height: 100px; }
  .footer { text-align: center; margin-top: 30px; color: #999; font-size: 9pt; }
`;

/**
 * Print invoice
 */
export const printInvoice = (invoice, items) => {
  if (!invoice) return;
  
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  
  const itemsHTML = items.map((item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${item.activity_name || item.name || ''}</td>
      <td>${item.period || '-'}</td>
      <td>${item.fee?.toFixed(2) || '0.00'} ر.س</td>
      <td>${item.quantity || 1}</td>
      <td>${((item.fee || 0) * (item.quantity || 1)).toFixed(2)} ر.س</td>
    </tr>
  `).join('');
  
  const subtotal = items.reduce((sum, item) => sum + (item.fee || 0) * (item.quantity || 1), 0);
  const discount = invoice.discount || 0;
  const taxableAmount = subtotal - discount;
  const vatAmount = taxableAmount * (VAT_RATE / 100);
  const total = taxableAmount + vatAmount;
  
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>فاتورة رقم ${invoice.invoice_number}</title>
        <style>${getInvoicePrintStyles()}</style>
      </head>
      <body>
        <div class="invoice">
          <div class="invoice-header">
            <div class="company-info">
              <h1>🏆 ${COMPANY_INFO.name_ar}</h1>
              <p>${COMPANY_INFO.name_en}</p>
              <p>الرقم الضريبي: ${COMPANY_INFO.tax_number}</p>
              <p>السجل التجاري: ${COMPANY_INFO.commercial_reg}</p>
            </div>
            <div class="invoice-number">
              <h2>فاتورة ضريبية</h2>
              <p>رقم الفاتورة: ${invoice.invoice_number}</p>
              <p>التاريخ: ${new Date(invoice.created_at).toLocaleDateString('ar-SA')}</p>
              <p>الحالة: ${invoice.status === 'paid' ? 'مدفوع' : 'معلق'}</p>
            </div>
          </div>
          
          <div class="customer-info">
            <h3>بيانات العميل</h3>
            <p><strong>الاسم:</strong> ${invoice.customer_name_ar || invoice.member_name || '-'}</p>
            <p><strong>رقم العضوية:</strong> ${invoice.member_code || '-'}</p>
            <p><strong>الجوال:</strong> ${invoice.customer_phone || '-'}</p>
          </div>
          
          <table class="items-table">
            <thead>
              <tr>
                <th>#</th>
                <th>البند</th>
                <th>المدة</th>
                <th>السعر</th>
                <th>الكمية</th>
                <th>الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHTML}
            </tbody>
          </table>
          
          <div class="totals">
            <p>المجموع الفرعي: ${subtotal.toFixed(2)} ر.س</p>
            ${discount > 0 ? `<p>الخصم: -${discount.toFixed(2)} ر.س</p>` : ''}
            <p>ضريبة القيمة المضافة (15%): ${vatAmount.toFixed(2)} ر.س</p>
            <p class="total">الإجمالي: ${total.toFixed(2)} ر.س</p>
          </div>
          
          <div class="terms">
            <h4>الشروط والأحكام:</h4>
            <ul>
              ${(INVOICE_TERMS.ar || []).map(term => `<li>${_escapeHtml(term)}</li>`).join('')}
            </ul>
          </div>
          
          <div class="footer">
            <p>شكراً لاختياركم ${COMPANY_INFO.name_ar}</p>
          </div>
        </div>
        <script>window.onload = function() { window.print(); }</script>
      </body>
    </html>
  `);
  printWindow.document.close();
};
