/**
 * Sticker Print Dialog Component
 * Handles printing member cards and academy logo on sticker sheets
 */
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Printer } from 'lucide-react';

// Print settings
const CARD_WIDTH = 90; // mm
const CARD_HEIGHT = 60; // mm
const TOP_MARGIN = 30; // mm
const RIGHT_MARGIN = 15; // mm
const GAP = 5; // mm

/**
 * Generate QR data for member - Just the member code number
 */
const generateQRData = (member) => {
  return (member?.member_code || '').toString();
};

/**
 * Generate activities HTML for card
 */
const generateActivitiesHTML = (activities = []) => {
  return activities.map(act => `
    <div class="activity-item ${act.status}">
      <div class="activity-name">${act.status === 'active' ? '✓' : '✗'} ${act.activity_name}</div>
      <div class="activity-status">${act.status === 'active' ? 'ساري' : 'منتهي'}</div>
    </div>
  `).join('');
};

/**
 * Get print CSS styles
 */
const getPrintStyles = () => `
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
  @page { size: A4; margin: 0mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Tajawal', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
  .screen-only { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
  @media print { .screen-only { display: none !important; } .print-area { display: flex !important; position: absolute; top: ${TOP_MARGIN}mm; right: ${RIGHT_MARGIN}mm; gap: ${GAP}mm; } }
  @media screen { .print-area { display: none; } }
  .sticker-preview { display: flex; gap: 15px; justify-content: center; margin-bottom: 20px; }
  .card { width: ${CARD_WIDTH}mm; height: ${CARD_HEIGHT}mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
  .card-header { background: linear-gradient(135deg, #F97316, #F59E0B); padding: 1.5mm 2mm; display: flex; justify-content: space-between; align-items: center; color: white; }
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
  .logo-card { width: ${CARD_WIDTH}mm; height: ${CARD_HEIGHT}mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3mm; }
  .logo-card img { max-width: 100%; max-height: 55%; object-fit: contain; }
  .logo-card .contact-info { font-size: 7pt; color: #374151; text-align: center; margin-top: 2mm; font-weight: 600; line-height: 1.6; }
  .logo-card .lost-card-notice { font-size: 7pt; color: #DC2626; text-align: center; margin-top: 2mm; font-weight: 700; line-height: 1.5; background: #FEF2F2; padding: 2mm 3mm; border-radius: 2mm; border: 1.5px solid #EF4444; }
  .print-btn { margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #F97316, #EA580C); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal', Arial, sans-serif; font-size: 16px; font-weight: bold; }
  .position-labels { display: flex; gap: 15px; justify-content: center; margin-top: 10px; }
  .position-label { padding: 8px 16px; background: #FEF3C7; border-radius: 8px; color: #92400E; font-size: 12px; }
`;

/**
 * Generate member card HTML
 */
const generateCardHTML = (member, qrData, schedule) => {
  const firstActivity = member?.activities?.[0];
  const startDate = firstActivity?.start_date || '';
  const endDate = firstActivity?.end_date || '';
  const activitiesHtml = generateActivitiesHTML(member?.activities);

  return `
    <div class="card">
      <div class="card-header">
        <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
        <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
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
        <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
        <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
      </div>
    </div>
  `;
};

/**
 * Open print window with card and logo
 */
export const openStickerPrint = (member) => {
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
        <style>${getPrintStyles()}</style>
      </head>
      <body>
        <div class="screen-only">
          <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة الطباعة - كرت العضوية + شعار الأكاديمية</p>
          <div class="sticker-preview">
            ${cardHTML}
            <div class="logo-card">
              <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
              <div class="contact-info">📞 0546218384</div>
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
            <div class="contact-info">📞 0546218384</div>
            <div class="lost-card-notice">⚠️ في حال فقدان كرت العضوية،<br/>يتم إصدار كرت جديد برسوم 10 ر.س</div>
          </div>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
};

/**
 * Sticker Print Dialog Component
 */
const StickerPrintDialog = ({ 
  open, 
  onOpenChange, 
  member,
  variant = 'orange' // orange, purple, blue
}) => {
  const handlePrint = () => {
    onOpenChange(false);
    openStickerPrint(member);
  };

  const colors = {
    orange: { border: 'border-orange-400', text: 'text-orange-500', bg: 'bg-orange-500 hover:bg-orange-600' },
    purple: { border: 'border-purple-400', text: 'text-purple-500', bg: 'bg-purple-500 hover:bg-purple-600' },
    blue: { border: 'border-blue-400', text: 'text-blue-500', bg: 'bg-blue-500 hover:bg-blue-600' }
  };

  const color = colors[variant] || colors.orange;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">🖨️ طباعة الملصقات</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-center text-gray-600 mb-2 font-bold">{member?.name_ar}</p>
          <p className="text-center text-sm text-orange-600 mb-4 font-bold">#{member?.member_code}</p>
          <p className="text-center text-sm text-gray-500 mb-4">سيتم طباعة كرت العضوية + شعار الأكاديمية معاً</p>
          
          <div className="bg-gray-100 p-4 rounded-lg">
            <div className="flex gap-3 justify-center max-w-[360px] mx-auto">
              {/* Preview Card 1 - Member Card */}
              <div className={`aspect-[9/6] w-[140px] bg-white border-2 ${color.border} rounded-lg flex flex-col items-center justify-center gap-2 p-3`}>
                <span className="text-3xl">📇</span>
                <span className="text-sm font-bold text-gray-700">كرت العضوية</span>
                <span className={`text-xs ${color.text}`}>خانة 1</span>
              </div>
              
              {/* Preview Card 2 - Academy Logo */}
              <div className={`aspect-[9/6] w-[140px] bg-white border-2 ${color.border} rounded-lg flex flex-col items-center justify-center gap-2 p-3 overflow-hidden`}>
                <img 
                  src="/images/academy-logo.png" 
                  alt="شعار الأكاديمية" 
                  className="w-14 h-14 object-contain"
                />
                <span className="text-sm font-bold text-gray-700">شعار الأكاديمية</span>
                <span className={`text-xs ${color.text}`}>خانة 2</span>
              </div>
            </div>
            <p className="text-center text-xs text-gray-500 mt-3">
              📐 حجم كل كرت: 9سم × 6سم
            </p>
          </div>
          
          <div className="mt-4 flex justify-center">
            <Button
              onClick={handlePrint}
              className={`${color.bg} text-white px-8 py-3 text-lg`}
            >
              <Printer className="w-5 h-5 ml-2" />
              طباعة الملصقات
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StickerPrintDialog;
