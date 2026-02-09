import { COMPANY_INFO, INVOICE_TERMS } from './constants';

/**
 * Generate print HTML for member card (9cm x 7cm)
 * @param {Object} member - Member data (name_ar, member_code, phone, activities)
 * @param {number} position - Sticker position (0-5)
 * @returns {string} HTML content for print window
 */
export const generateMemberCardPrintHtml = (member, position) => {
  // Calculate position offsets (2 columns x 3 rows, each card 9cm width x 7cm height)
  const col = position % 2;
  const row = Math.floor(position / 2);
  const leftOffset = 10 + (col * 90); // 90mm card width
  const cardHeight = 70; // mm
  const rowGap = 18.5; // mm between rows for exact 20mm bottom margin
  const topOffset = 30 + (row * (cardHeight + rowGap));
  
  // Get first activity dates for display under QR
  const firstActivity = member?.activities?.[0];
  const startDate = firstActivity?.start_date || '';
  const endDate = firstActivity?.end_date || '';
  
  // Generate QR data
  const qrData = JSON.stringify({
    type: 'WCPA_MEMBER',
    member_code: member?.member_code,
    phone: member?.phone,
    name: member?.name_ar
  });
  
  // Generate activities HTML
  const activitiesHtml = member?.activities?.map(act => `
    <div class="activity-item ${act.status === 'active' ? 'active' : 'expired'}">
      <div class="activity-name">${act.status === 'active' ? '✓' : '✗'} ${act.activity_name}</div>
      <div class="activity-status">${act.status === 'active' ? 'ساري' : 'منتهي'}</div>
    </div>
  `).join('') || '';

  const cardHtml = `
    <div class="card">
      <div class="card-header">
        <div class="header-text"><h2>أكاديمية أداء الأبطال</h2><p>World Champions Performance Academy</p></div>
        <div class="trophy">🏆</div>
      </div>
      <div class="card-body">
        <div class="qr-container">
          <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
          <div class="qr-dates">
            <span>من: ${startDate || '----'}</span>
            <span>إلى: ${endDate || '----'}</span>
          </div>
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
        <div>• ${INVOICE_TERMS.ar[0]}</div>
        <div>• ${INVOICE_TERMS.ar[1]}</div>
      </div>
    </div>
  `;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>بطاقة العضوية - ${member?.member_code}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
          @page { size: A4; margin: 0mm; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Tajawal', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
          .screen-only { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
          @media print { .screen-only { display: none !important; } .print-area { display: block !important; position: absolute; top: ${topOffset}mm; right: ${leftOffset}mm; } }
          @media screen { .print-area { display: none; } }
          .card { width: 90mm; height: 70mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
          .card-header { background: linear-gradient(135deg, #F97316, #F59E0B); padding: 2mm; display: flex; justify-content: space-between; align-items: center; color: white; }
          .header-text h2 { font-size: 9pt; font-weight: 700; margin: 0; }
          .header-text p { font-size: 6pt; opacity: 0.9; margin: 0; }
          .trophy { font-size: 16pt; }
          .card-body { padding: 2mm; display: flex; gap: 2mm; flex: 1; }
          .info-section { flex: 1; text-align: right; overflow: hidden; }
          .qr-container { display: flex; flex-direction: column; align-items: center; }
          .qr-section { width: 26mm; height: 26mm; background: white; border: 1px solid #eee; border-radius: 2mm; padding: 0.5mm; }
          .qr-section img { width: 100%; height: 100%; }
          .qr-dates { text-align: center; font-size: 6pt; color: #1f2937; margin-top: 1mm; line-height: 1.3; font-weight: 600; }
          .qr-dates span { display: block; }
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
          .print-btn { margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #F97316, #EA580C); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal', Arial, sans-serif; font-size: 16px; font-weight: bold; }
          .position-info { margin-top: 15px; padding: 10px 20px; background: #FEF3C7; border-radius: 8px; color: #92400E; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="screen-only">
          <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة بطاقة العضوية</p>
          ${cardHtml}
          <div class="position-info">📍 موقع الطباعة: الصف ${row + 1} - العمود ${col + 1} (الكرت رقم ${position + 1})</div>
          <button class="print-btn" onclick="window.print()">🖨️ طباعة البطاقة</button>
        </div>
        <div class="print-area">
          ${cardHtml}
        </div>
      </body>
    </html>
  `;
};

/**
 * Open print window with member card
 * @param {Object} member - Member data
 * @param {number} position - Sticker position (0-5)
 */
export const printMemberCard = (member, position) => {
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  const html = generateMemberCardPrintHtml(member, position);
  printWindow.document.write(html);
  printWindow.document.close();
};
