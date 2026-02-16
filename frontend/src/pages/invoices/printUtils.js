/**
 * Print utilities for invoices and member cards
 */

import { CARD_WIDTH, CARD_HEIGHT, TOP_MARGIN, RIGHT_MARGIN, GAP, VAT_RATE, COMPANY_INFO, INVOICE_TERMS } from './constants';

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
export const getCardPrintStyles = () => `
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
  @page { size: A4; margin: 0mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Tajawal', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
  .screen-only { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
  @media print { .screen-only { display: none !important; } .print-area { display: flex !important; position: absolute; top: ${TOP_MARGIN}mm; right: ${RIGHT_MARGIN}mm; gap: ${GAP}mm; } }
  @media screen { .print-area { display: none; } }
  .sticker-preview { display: flex; gap: 15px; justify-content: center; margin-bottom: 20px; }
  .card { width: ${CARD_WIDTH}mm; height: ${CARD_HEIGHT}mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
  .card-header { background: linear-gradient(135deg, #F97316, #F59E0B); padding: 2mm; display: flex; justify-content: space-between; align-items: center; color: white; }
  .header-text h2 { font-size: 9pt; font-weight: 700; margin: 0; }
  .header-text p { font-size: 6pt; opacity: 0.9; margin: 0; }
  .trophy { font-size: 16pt; }
  .card-body { padding: 2mm; display: flex; gap: 2mm; flex: 1; }
  .info-section { flex: 1; text-align: right; overflow: hidden; }
  .qr-container { display: flex; flex-direction: column; align-items: center; }
  .qr-section { width: 22mm; height: 22mm; background: white; border: 1px solid #eee; border-radius: 2mm; padding: 0.5mm; }
  .qr-section img { width: 100%; height: 100%; }
  .qr-dates { text-align: center; font-size: 8pt; color: #1f2937; margin-top: 1mm; line-height: 1.4; font-weight: 700; }
  .qr-dates span { display: block; }
  .schedule-info { text-align: center; font-size: 6pt; color: #F97316; margin-top: 1mm; font-weight: 600; background: #FFF7ED; padding: 1mm; border-radius: 2mm; }
  .member-name { font-size: 10pt; font-weight: 700; color: #1f2937; margin-bottom: 1mm; }
  .info-row { display: flex; align-items: center; gap: 1mm; margin-bottom: 0.8mm; font-size: 7pt; }
  .info-label { color: #6b7280; font-size: 6pt; }
  .member-code { color: #F97316; font-weight: 700; font-size: 10pt; }
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
  .logo-card { width: ${CARD_WIDTH}mm; height: ${CARD_HEIGHT}mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 5mm; }
  .logo-card img { max-width: 100%; max-height: 80%; object-fit: contain; }
  .logo-card .lost-card-notice { font-size: 7pt; color: #DC2626; text-align: center; margin-top: 3mm; font-weight: 600; line-height: 1.4; }
  .print-btn { margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #F97316, #EA580C); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal', Arial, sans-serif; font-size: 16px; font-weight: bold; }
  .position-labels { display: flex; gap: 15px; justify-content: center; margin-top: 10px; }
  .position-label { padding: 8px 16px; background: #FEF3C7; border-radius: 8px; color: #92400E; font-size: 12px; }
`;

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
        <div class="trophy">🏆</div>
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
        <div>• ${INVOICE_TERMS[0]}</div>
        <div>• ${INVOICE_TERMS[1]}</div>
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
              <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
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
            <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
            <div class="lost-card-notice">⚠️ في حال فقدان كرت العضوية،<br/>يتم إصدار كرت جديد برسوم 10 ر.س</div>
          </div>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
};

/**
 * Get invoice print styles - Modern style matching the app design
 */
export const getInvoicePrintStyles = () => `
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
  @page { size: A4; margin: 10mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Tajawal', Arial, sans-serif; direction: rtl; font-size: 12pt; background: #fff; }
  
  .invoice { max-width: 210mm; margin: 0 auto; padding: 20mm; background: white; }
  
  /* Header Section */
  .invoice-header { 
    display: flex; 
    justify-content: space-between; 
    align-items: flex-start; 
    margin-bottom: 25px; 
    padding-bottom: 20px;
    border-bottom: 3px solid #0ea5e9;
  }
  
  .company-info { text-align: right; }
  .company-info h1 { 
    color: #0ea5e9; 
    font-size: 22pt; 
    font-weight: 700;
    margin-bottom: 8px; 
  }
  .company-info .tax-info { 
    color: #6b7280; 
    font-size: 10pt; 
    line-height: 1.6;
  }
  
  .invoice-meta { text-align: left; }
  .invoice-meta .invoice-number-label {
    color: #0ea5e9;
    font-size: 11pt;
    font-weight: 600;
    margin-bottom: 5px;
  }
  .invoice-meta .invoice-number-value {
    color: #1f2937;
    font-size: 14pt;
    font-weight: 700;
    margin-bottom: 10px;
  }
  .invoice-meta .invoice-date {
    color: #6b7280;
    font-size: 10pt;
    margin-bottom: 8px;
  }
  
  .status-badge {
    display: inline-block;
    padding: 5px 15px;
    border-radius: 20px;
    font-size: 10pt;
    font-weight: 600;
  }
  .status-paid { background: #dcfce7; color: #16a34a; border: 1px solid #86efac; }
  .status-pending { background: #fef3c7; color: #d97706; border: 1px solid #fcd34d; }
  .status-cancelled { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }
  
  .branch-info {
    margin-top: 15px;
    padding: 10px 15px;
    background: #fef3c7;
    border-radius: 8px;
    color: #92400e;
    font-size: 11pt;
    font-weight: 600;
    display: inline-block;
  }
  
  /* Customer Section */
  .customer-section {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 25px;
  }
  .customer-section h3 {
    color: #0ea5e9;
    font-size: 14pt;
    font-weight: 700;
    margin-bottom: 15px;
    text-align: right;
  }
  .customer-details {
    display: flex;
    justify-content: space-between;
    gap: 20px;
  }
  .customer-details .detail-item {
    font-size: 11pt;
    color: #374151;
  }
  .customer-details .detail-label {
    color: #6b7280;
    margin-left: 5px;
  }
  .customer-details .member-code {
    color: #0ea5e9;
    font-weight: 700;
  }
  
  /* Items Table */
  .items-table { 
    width: 100%; 
    border-collapse: collapse; 
    margin-bottom: 25px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #e2e8f0;
  }
  .items-table th { 
    background: #f1f5f9; 
    color: #1e293b; 
    padding: 15px; 
    text-align: center; 
    font-size: 11pt;
    font-weight: 700;
    border-bottom: 2px solid #e2e8f0;
  }
  .items-table td { 
    padding: 15px; 
    text-align: center;
    font-size: 11pt;
    color: #374151;
    border-bottom: 1px solid #e2e8f0;
  }
  .items-table td.activity-name {
    text-align: right;
    font-weight: 600;
    color: #1f2937;
  }
  .items-table td.amount {
    font-weight: 600;
    color: #1f2937;
  }
  .items-table tr:last-child td {
    border-bottom: none;
  }
  
  /* Totals Section */
  .totals-section {
    margin-bottom: 25px;
  }
  .totals-row {
    display: flex;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid #e2e8f0;
    font-size: 12pt;
  }
  .totals-row .label { color: #374151; }
  .totals-row .value { color: #1f2937; font-weight: 600; }
  
  .totals-row.vat .label { color: #16a34a; font-weight: 600; }
  .totals-row.vat .value { color: #16a34a; }
  
  .totals-row.total {
    border-bottom: none;
    border-top: 3px solid #0ea5e9;
    margin-top: 10px;
    padding-top: 15px;
  }
  .totals-row.total .label { 
    color: #0ea5e9; 
    font-size: 16pt; 
    font-weight: 700; 
  }
  .totals-row.total .value { 
    color: #0ea5e9; 
    font-size: 18pt; 
    font-weight: 700; 
  }
  
  /* Footer Section */
  .footer-section {
    background: #f8fafc;
    border-radius: 12px;
    padding: 15px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 20px;
  }
  .footer-item {
    font-size: 11pt;
  }
  .footer-item .label {
    color: #6b7280;
    margin-left: 8px;
  }
  .footer-item .value {
    color: #1f2937;
    font-weight: 600;
  }
  .footer-item .status-icon {
    color: #16a34a;
    margin-left: 5px;
  }
  
  @media print {
    body { background: white; }
    .invoice { padding: 10mm; }
  }
`;

/**
 * Print invoice - Modern style matching the app design
 */
export const printInvoice = (invoice, items) => {
  if (!invoice) return;
  
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  
  const getStatusBadge = (status) => {
    switch(status) {
      case 'paid': return '<span class="status-badge status-paid">✓ مدفوعة</span>';
      case 'pending': return '<span class="status-badge status-pending">⏳ معلقة</span>';
      case 'cancelled': return '<span class="status-badge status-cancelled">✗ ملغاة</span>';
      default: return '<span class="status-badge status-pending">معلقة</span>';
    }
  };

  const getPaymentMethodText = (method) => {
    switch(method) {
      case 'cash': return 'نقدي';
      case 'card': return 'بطاقة';
      case 'bank_transfer': return 'تحويل بنكي';
      case 'tabby': return 'تابي';
      case 'tamara': return 'تمارا';
      default: return method || 'نقدي';
    }
  };
  
  const itemsHTML = items.map((item) => `
    <tr>
      <td class="activity-name">${item.activity_name || item.name || ''}</td>
      <td>${item.start_date || ''} - ${item.end_date || ''}</td>
      <td>${item.schedule || '-'}</td>
      <td class="amount">${(item.fee || 0).toFixed(0)} ر.س</td>
    </tr>
  `).join('');
  
  const subtotal = items.reduce((sum, item) => sum + (item.fee || 0) * (item.quantity || 1), 0);
  const discount = invoice.discount || 0;
  const taxableAmount = subtotal - discount;
  const vatAmount = taxableAmount * VAT_RATE;
  const total = taxableAmount + vatAmount;
  
  printWindow.document.write(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>فاتورة رقم ${invoice.invoice_number}</title>
        <style>${getInvoicePrintStyles()}</style>
      </head>
      <body>
        <div class="invoice">
          <!-- Header -->
          <div class="invoice-header">
            <div class="company-info">
              <h1>${COMPANY_INFO.name_ar}</h1>
              <div class="tax-info">
                الرقم الضريبي: ${COMPANY_INFO.tax_number}<br/>
                السجل التجاري: ${COMPANY_INFO.commercial_reg}
              </div>
              ${invoice.branch_name ? `<div class="branch-info">🏢 الفرع: ${invoice.branch_name}</div>` : ''}
            </div>
            <div class="invoice-meta">
              <div class="invoice-number-label">💰 رقم الفاتورة:</div>
              <div class="invoice-number-value">#${invoice.invoice_number || invoice.id?.slice(0, 8)}</div>
              <div class="invoice-date">رقم الفاتورة: #${invoice.invoice_number || ''}</div>
              <div class="invoice-date">تاريخ الفاتورة: ${new Date(invoice.created_at).toLocaleDateString('ar-SA')}</div>
              ${getStatusBadge(invoice.status)}
            </div>
          </div>
          
          <!-- Customer Info -->
          <div class="customer-section">
            <h3>بيانات العميل</h3>
            <div class="customer-details">
              <div class="detail-item">
                <span class="detail-label">الاسم:</span>
                ${invoice.customer_name_ar || invoice.member_name || '-'}
                ${invoice.member_code ? `<span class="member-code">(#${invoice.member_code})</span>` : ''}
              </div>
              <div class="detail-item">
                <span class="detail-label">رقم الجوال:</span>
                ${invoice.customer_phone || '-'}
              </div>
            </div>
          </div>
          
          <!-- Items Table -->
          <table class="items-table">
            <thead>
              <tr>
                <th>اسم النشاط</th>
                <th>الفترة</th>
                <th>المواعيد</th>
                <th>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHTML}
            </tbody>
          </table>
          
          <!-- Totals -->
          <div class="totals-section">
            <div class="totals-row">
              <span class="label">المجموع الفرعي:</span>
              <span class="value">${subtotal.toFixed(0)} ر.س</span>
            </div>
            ${discount > 0 ? `
            <div class="totals-row">
              <span class="label">الخصم:</span>
              <span class="value">-${discount.toFixed(0)} ر.س</span>
            </div>
            ` : ''}
            <div class="totals-row vat">
              <span class="label">ضريبة القيمة المضافة (15%):</span>
              <span class="value">${vatAmount.toFixed(0)} ر.س</span>
            </div>
            <div class="totals-row total">
              <span class="label">الإجمالي:</span>
              <span class="value">${total.toFixed(0)} ر.س</span>
            </div>
          </div>
          
          <!-- Footer -->
          <div class="footer-section">
            <div class="footer-item">
              <span class="label">طريقة الدفع:</span>
              <span class="value">${getPaymentMethodText(invoice.payment_method)}</span>
            </div>
            <div class="footer-item">
              <span class="label">الحالة:</span>
              <span class="value">
                ${invoice.status === 'paid' ? '<span class="status-icon">✓</span> مدفوعة' : 
                  invoice.status === 'pending' ? '⏳ معلقة' : '✗ ملغاة'}
              </span>
            </div>
          </div>
        </div>
        
        <script>
          window.onload = function() { 
            setTimeout(function() { window.print(); }, 500);
          }
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
};
