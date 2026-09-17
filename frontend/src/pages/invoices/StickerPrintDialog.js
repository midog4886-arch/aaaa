/**
 * Sticker Print Dialog Component
 * Handles printing the subscription card and academy logo on a sticker sheet.
 */
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { getAcademyLogoUrl, getPrimaryColor } from '../../services/branding';
import { fetchOriginalActivityDates, applyOriginalDates } from './cardDates';

const CARD_WIDTH = 90;
const CARD_HEIGHT = 60;
const TOP_MARGIN = 30;
const RIGHT_MARGIN = 15;
const GAP = 5;

const escapeHTML = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const generateActivitiesHTML = (activities = []) => activities.map((activity) => {
  const status = activity.status === 'active' ? 'active' : 'expired';
  return `
    <div class="activity-item ${status}">
      <div class="activity-name">${status === 'active' ? '✓' : '✗'} ${escapeHTML(activity.activity_name)}</div>
      <div class="activity-status">${status === 'active' ? 'ساري' : 'منتهي'}</div>
    </div>`;
}).join('');

const getPrintStyles = () => {
  const brand = getPrimaryColor();
  const headerBackground = brand || 'linear-gradient(135deg, #F97316, #F59E0B)';
  const accent = brand || '#F97316';
  return `
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f3f4f6; direction: rtl; font-family: Tajawal, Arial, sans-serif; }
    .screen-only { align-items: center; display: flex; flex-direction: column; justify-content: center; min-height: 100vh; padding: 20px; text-align: center; }
    .print-area { display: none; }
    .sticker-preview, .print-area { gap: 15px; justify-content: center; }
    .sticker-preview { display: flex; margin-bottom: 20px; }
    .card, .logo-card { background: #fff; border-radius: 4mm; box-shadow: 0 4px 15px rgba(0,0,0,.1); height: ${CARD_HEIGHT}mm; overflow: hidden; width: ${CARD_WIDTH}mm; }
    .card { display: flex; flex-direction: column; }
    .card-header { align-items: center; background: ${headerBackground}; color: #fff; display: flex; justify-content: space-between; padding: 1.5mm 2mm; }
    .header-text h2 { font-size: 7pt; line-height: 1.3; }
    .header-text p { font-size: 5.5pt; opacity: .9; }
    .header-logo { align-items: center; background: #fff; border-radius: 50%; display: flex; height: 10mm; justify-content: center; padding: .5mm; width: 10mm; }
    .header-logo img { height: 100%; object-fit: contain; width: 100%; }
    .card-body { display: flex; flex: 1; gap: 2mm; padding: 2mm; }
    .qr-container { align-items: center; display: flex; flex-direction: column; }
    .qr-section { border: 1px solid #eee; border-radius: 2mm; height: 22mm; padding: .5mm; width: 22mm; }
    .qr-section img { height: 100%; width: 100%; }
    .qr-dates { color: #1f2937; font-size: 8pt; font-weight: 700; line-height: 1.4; margin-top: 1mm; text-align: center; }
    .qr-dates span { display: block; }
    .schedule-info { background: #fff7ed; border-radius: 2mm; color: ${accent}; font-size: 6pt; font-weight: 600; margin-top: 1mm; padding: 1mm; text-align: center; }
    .info-section { flex: 1; overflow: hidden; text-align: right; }
    .info-label { color: #6b7280; font-size: 6pt; }
    .member-name { color: #1f2937; font-size: 10pt; font-weight: 700; margin-bottom: 1mm; }
    .info-row { align-items: center; display: flex; font-size: 7pt; gap: 1mm; margin-bottom: .8mm; }
    .member-code { color: ${accent}; font-weight: 700; }
    .activities { border-top: 1px dashed #ddd; margin-top: 1mm; padding-top: 1mm; }
    .activities-label { color: #6b7280; font-size: 5.5pt; margin-bottom: .5mm; }
    .activity-item { align-items: center; display: flex; font-size: 6pt; justify-content: space-between; }
    .activity-item.active { color: #16a34a; }
    .activity-item.expired { color: #dc2626; }
    .card-footer { background: #f9fafb; border-top: 1px solid #eee; color: #6b7280; font-size: 4.5pt; line-height: 1.4; padding: 1mm 2mm; }
    .terms-title { color: #374151; font-weight: 700; }
    .logo-card { align-items: center; display: flex; flex-direction: column; justify-content: center; padding: 4mm; text-align: center; }
    .logo-card img { height: 30mm; margin-bottom: 2mm; object-fit: contain; width: 50mm; }
    .contact-info { color: ${accent}; font-size: 12pt; font-weight: 700; }
    .lost-card-notice { color: #6b7280; font-size: 7pt; line-height: 1.5; margin-top: 2mm; }
    .logo-card .terms { color: #4b5563; font-size: 6pt; line-height: 1.6; margin-top: 2mm; text-align: right; width: 100%; }
    .position-labels { display: flex; gap: 80px; }
    .position-label { color: #6b7280; font-size: 13px; }
    .print-btn { background: ${accent}; border: 0; border-radius: 8px; color: #fff; cursor: pointer; font: inherit; font-size: 18px; margin-top: 20px; padding: 12px 30px; }
    @media print {
      .screen-only { display: none !important; }
      .print-area { display: flex !important; gap: ${GAP}mm; position: absolute; right: ${RIGHT_MARGIN}mm; top: ${TOP_MARGIN}mm; }
      .card, .logo-card { box-shadow: none; }
    }`;
};

const generateCardHTML = (member) => {
  const activities = member?.activities || [];
  const firstActivity = activities[0] || {};
  const logoUrl = escapeHTML(getAcademyLogoUrl());
  const schedule = firstActivity.schedule
    ? `<div class="schedule-info">📅 ${escapeHTML(firstActivity.schedule)}</div>`
    : '';
  return `
    <div class="card">
      <div class="card-header">
        <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
        <div class="header-logo"><img src="${logoUrl}" alt="logo" /></div>
      </div>
      <div class="card-body">
        <div class="qr-container">
          <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&amp;data=${encodeURIComponent(member?.member_code || '')}" alt="QR" /></div>
          <div class="qr-dates"><span>من: ${escapeHTML(firstActivity.start_date || '----')}</span><span>إلى: ${escapeHTML(firstActivity.end_date || '----')}</span></div>
          ${schedule}
        </div>
        <div class="info-section">
          <div class="info-label">الاسم</div>
          <div class="member-name">${escapeHTML(member?.name_ar || member?.name)}</div>
          <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">${escapeHTML(member?.member_code)}</span></div>
          <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${escapeHTML(member?.phone || '-')}</span></div>
          ${activities.length ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${generateActivitiesHTML(activities)}</div>` : ''}
        </div>
      </div>
      <div class="card-footer"><div class="terms-title">شروط وأحكام:</div><div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div><div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div></div>
    </div>`;
};

const writePrintDocument = (printWindow, member) => {
  if (!printWindow || printWindow.closed) return;
  const logoUrl = escapeHTML(getAcademyLogoUrl());
  const phone = escapeHTML(
    member?.branch_phone || (member?.strict_branch_contact ? '' : '0566238384'),
  );
  const card = generateCardHTML(member);
  const notice = member?.show_terms_on_logo
    ? '<div class="terms"><div class="terms-title">شروط وأحكام</div><div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div><div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div><div>• في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</div></div>'
    : '<div class="lost-card-notice">⚠️ في حال فقدان كرت العضوية،<br/>يتم إصدار كرت جديد برسوم 10 ر.س</div>';
  const logoCard = `<div class="logo-card"><img src="${logoUrl}" alt="شعار الأكاديمية" /><div class="contact-info">📞 ${phone}</div>${notice}</div>`;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="ar"><head><meta charset="UTF-8"><title>بطاقة العضوية - ${escapeHTML(member?.member_code)}</title><style>${getPrintStyles()}</style></head><body>
    <div class="screen-only"><p style="font-size:18px;margin-bottom:20px">📋 معاينة الطباعة - كرت العضوية + شعار الأكاديمية</p><div class="sticker-preview">${card}${logoCard}</div><div class="position-labels"><div class="position-label">📍 خانة 1: كرت العضوية</div><div class="position-label">📍 خانة 2: شعار الأكاديمية</div></div><p style="color:#6b7280;font-size:14px;margin-top:10px">📐 حجم كل كرت: 9سم × 6سم</p><button class="print-btn" onclick="window.print()">🖨️ طباعة الملصقات</button></div>
    <div class="print-area">${card}${logoCard}</div></body></html>`);
  printWindow.document.close();
};

export const openStickerPrint = (member) => {
  if (!member?.member_code) return null;
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (!printWindow) return null;
  printWindow.document.write('<!doctype html><html lang="ar"><body dir="rtl" style="font-family:Arial;padding:30px">جاري تجهيز بيانات البطاقة…</body></html>');
  printWindow.document.close();
  fetchOriginalActivityDates(member.id)
    .then((dates) => writePrintDocument(printWindow, { ...member, activities: applyOriginalDates(member.activities, dates) }))
    .catch(() => writePrintDocument(printWindow, member));
  return printWindow;
};

const StickerPrintDialog = ({ open, onOpenChange, member, variant = 'orange' }) => {
  const colors = {
    orange: { border: 'border-orange-400', text: 'text-orange-500', bg: 'bg-orange-500 hover:bg-orange-600' },
    purple: { border: 'border-purple-400', text: 'text-purple-500', bg: 'bg-purple-500 hover:bg-purple-600' },
    blue: { border: 'border-blue-400', text: 'text-blue-500', bg: 'bg-blue-500 hover:bg-blue-600' },
  };
  const color = colors[variant] || colors.orange;
  const handlePrint = () => {
    if (openStickerPrint(member)) onOpenChange(false);
    else toast.error('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader><DialogTitle className="text-center text-xl">🖨️ طباعة الملصقات</DialogTitle></DialogHeader>
        <div className="py-4">
          <p className="text-center text-gray-600 mb-2 font-bold">{member?.name_ar || member?.name}</p>
          <p className={`text-center text-sm ${color.text} mb-4 font-bold`}>{member?.member_code}</p>
          <p className="text-center text-sm text-gray-500 mb-4">سيتم طباعة كرت العضوية + شعار الأكاديمية معاً</p>
          <div className="bg-gray-100 p-4 rounded-lg">
            <div className="flex gap-3 justify-center max-w-[360px] mx-auto">
              <div className={`aspect-[9/6] w-[140px] bg-white border-2 ${color.border} rounded-lg flex flex-col items-center justify-center gap-2 p-3`}><span className="text-3xl">📇</span><span className="text-sm font-bold text-gray-700">كرت العضوية</span><span className={`text-xs ${color.text}`}>خانة 1</span></div>
              <div className={`aspect-[9/6] w-[140px] bg-white border-2 ${color.border} rounded-lg flex flex-col items-center justify-center gap-2 p-3 overflow-hidden`}><img src={getAcademyLogoUrl()} alt="شعار الأكاديمية" className="w-14 h-14 object-contain" /><span className="text-sm font-bold text-gray-700">شعار الأكاديمية</span><span className={`text-xs ${color.text}`}>خانة 2</span></div>
            </div>
            <p className="text-center text-xs text-gray-500 mt-3">📐 حجم كل كرت: 9سم × 6سم</p>
          </div>
          <div className="mt-4 flex justify-center"><Button onClick={handlePrint} className={`${color.bg} text-white px-8 py-3 text-lg`}><Printer className="w-5 h-5 ml-2" />طباعة الملصقات</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StickerPrintDialog;