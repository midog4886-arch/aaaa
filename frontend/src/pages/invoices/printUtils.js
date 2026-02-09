import { COMPANY_INFO, INVOICE_TERMS } from './constants';

// Academy logo URL
const ACADEMY_LOGO_URL = '/images/academy-logo.png';

/**
 * Generate print HTML for member card (9cm x 7cm) - 2 horizontal cards layout
 * @param {Object} member - Member data (name_ar, member_code, phone, activities)
 * @param {number} position - Sticker position (0 = member card, 1 = logo)
 * @returns {string} HTML content for print window
 */
export const generateMemberCardPrintHtml = (member, position) => {
  // 2 horizontal cards layout on A4
  // A4 page: 210mm width x 297mm height
  // 2 cards side by side: each 90mm width x 70mm height
  // Centered horizontally: (210 - 180) / 2 = 15mm margins
  // Centered vertically: (297 - 70) / 2 = 113.5mm from top
  
  const cardWidth = 90; // mm
  const cardHeight = 70; // mm
  const horizontalMargin = 15; // mm from sides
  const topMargin = 30; // mm from top
  const gap = 10; // mm between cards
  
  // Position 0 = left card (member card), Position 1 = right card (logo)
  const col = position;
  const leftOffset = horizontalMargin + (col * (cardWidth + gap));
  const topOffset = topMargin;
  
  // Get first activity dates for display under QR
  const firstActivity = member?.activities?.[0];
  const startDate = firstActivity?.start_date || '';
  const endDate = firstActivity?.end_date || '';
  
  // Generate QR data
  const qrData = JSON.stringify({
    type: 'WCPA_MEMBER',
    code: member?.member_code,
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

  // Member card HTML
  const memberCardHtml = `
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

  // Logo card HTML
  const logoCardHtml = `
    <div class="logo-card">
      <img src="${window.location.origin}${ACADEMY_LOGO_URL}" alt="شعار الأكاديمية" />
    </div>
  `;

  // Select which card to show based on position
  const cardContent = position === 0 ? memberCardHtml : logoCardHtml;
  const previewContent = position === 0 ? memberCardHtml : logoCardHtml;

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
          .logo-card { width: 90mm; height: 70mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: center; padding: 5mm; }
          .logo-card img { max-width: 100%; max-height: 100%; object-fit: contain; }
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
          <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة ${position === 0 ? 'بطاقة العضوية' : 'شعار الأكاديمية'}</p>
          ${previewContent}
          <div class="position-info">📍 موقع الطباعة: خانة ${position + 1} (${position === 0 ? 'كرت العضوية' : 'شعار الأكاديمية'})</div>
          <button class="print-btn" onclick="window.print()">🖨️ طباعة</button>
        </div>
        <div class="print-area">
          ${cardContent}
        </div>
      </body>
    </html>
  `;
};

/**
 * Open print window with member card
 * @param {Object} member - Member data
 * @param {number} position - Sticker position (0 = member card, 1 = logo)
 */
export const printMemberCard = (member, position) => {
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  const html = generateMemberCardPrintHtml(member, position);
  printWindow.document.write(html);
  printWindow.document.close();
};
