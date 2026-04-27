import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { 
  Download, Printer, Loader2, QrCode, 
  Calendar, Clock, CheckCircle, ShieldCheck, Phone
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import MemberLayout, { memberAPI, getMemberData, getDarkMode, getLanguage } from './MemberLayout';

// ── Helpers ───────────────────────────────────────────────────────────────────

const getInitials = (name) => {
  if (!name) return '؟';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2);
  return words[0][0] + words[1][0];
};

const daysDiff = (a, b) => {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
};

const remainingColor = (days) => {
  if (days >= 30) return { bar: 'bg-green-500', badge: 'bg-green-100 text-green-700 border-green-300', text: 'text-green-600' };
  if (days >= 7)  return { bar: 'bg-yellow-500', badge: 'bg-yellow-100 text-yellow-700 border-yellow-300', text: 'text-yellow-600' };
  return             { bar: 'bg-red-500',    badge: 'bg-red-100 text-red-700 border-red-300',    text: 'text-red-600' };
};

// ── Print / Download Logic (unchanged from original) ──────────────────────────

const buildStickerHtml = (cardData) => {
  const qrData = cardData?.member_code?.toString() || '';
  const firstActivity = cardData?.active_activities?.[0];
  const startDate = firstActivity?.start_date || '';
  const endDate = firstActivity?.end_date || '';
  const schedule = firstActivity?.schedule || '';

  const activitiesHtml = cardData?.active_activities?.map(act => `
    <div class="activity-item active">
      <div class="activity-name">✓ ${act.activity_name}</div>
      ${act.schedule ? `<div style="font-size:5.5pt;color:#2563EB;margin-top:0.3mm;">📅 ${act.schedule}</div>` : ''}
      ${act.coach_name ? `
      <div class="coach-info">
        ${act.coach_photo ? `<img class="coach-photo" src="${act.coach_photo}" alt="${act.coach_name}" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<span style=\\"font-size:5pt;\\">🏋️</span>')" />` : `<span style="font-size:5pt;">🏋️</span>`}
        <span class="coach-name">${act.coach_name}</span>
      </div>` : ''}
    </div>
  `).join('') || '';

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>بطاقة العضوية - ${cardData?.member_code}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
      @page { size: A4; margin: 0mm; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Tajawal', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
      .screen-only { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
      @media print { .screen-only { display: none !important; } .print-area { display: flex !important; position: absolute; top: 10mm; right: 15mm; gap: 5mm; } }
      @media screen { .print-area { display: none; } }
      .sticker-preview { display: flex; gap: 15px; justify-content: center; margin-bottom: 20px; }
      .card { width: 90mm; height: 60mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
      .card-header { background: linear-gradient(135deg, #F97316, #F59E0B); padding: 1.5mm 2mm; display: flex; justify-content: space-between; align-items: center; color: white; }
      .header-text h2 { font-size: 7pt; font-weight: 700; margin: 0; line-height: 1.3; }
      .header-text p { font-size: 5.5pt; opacity: 0.9; margin: 0; }
      .header-logo { width: 10mm; height: 10mm; border-radius: 50%; background: white; padding: 0.5mm; display: flex; align-items: center; justify-content: center; }
      .header-logo img { width: 100%; height: 100%; object-fit: contain; border-radius: 50%; }
      .card-body { padding: 2mm; display: flex; gap: 2mm; flex: 1; }
      .info-section { flex: 1; text-align: right; overflow: hidden; }
      .qr-container { display: flex; flex-direction: column; align-items: center; }
      .qr-section { width: 26mm; height: 26mm; background: white; border: 1px solid #eee; border-radius: 2mm; padding: 0.5mm; }
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
      .activity-name { font-weight: 600; color: #1f2937; font-size: 7pt; }
      .coach-info { display: flex; align-items: center; gap: 1mm; margin-top: 0.5mm; }
      .coach-photo { width: 4mm; height: 4mm; border-radius: 50%; object-fit: cover; border: 0.3mm solid #d1d5db; flex-shrink: 0; }
      .coach-name { font-size: 5pt; color: #6b7280; }
      .card-footer { text-align: right; padding: 1.5mm 2mm; background: #f9fafb; font-size: 5pt; color: #374151; border-top: 1px dashed #e5e7eb; line-height: 1.4; }
      .card-footer .terms-title { font-weight: 700; color: #1f2937; font-size: 6pt; margin-bottom: 0.5mm; }
      .logo-card { width: 90mm; height: 60mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3mm; }
      .logo-card img { max-width: 100%; max-height: 55%; object-fit: contain; }
      .logo-card .contact-info { font-size: 7pt; color: #374151; text-align: center; margin-top: 2mm; font-weight: 600; line-height: 1.6; }
      .logo-card .terms { text-align: right; font-size: 5.5pt; color: #374151; margin-top: 2mm; line-height: 1.6; padding: 0 2mm; }
      .logo-card .terms-title { font-weight: 700; color: #1f2937; font-size: 6.5pt; margin-bottom: 1mm; text-align: center; }
      .print-btn { margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #3B82F6, #2563EB); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal', Arial, sans-serif; font-size: 16px; font-weight: bold; }
      .position-labels { display: flex; gap: 15px; justify-content: center; margin-top: 10px; }
      .position-label { padding: 8px 16px; background: #DBEAFE; border-radius: 8px; color: #1E40AF; font-size: 12px; }
    </style>
  </head>
  <body>
    <div class="screen-only">
      <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة الطباعة - كرت العضوية + شعار الأكاديمية</p>
      <div class="sticker-preview">
        <div class="card">
          <div class="card-header">
            <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
            <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
          </div>
          <div class="card-body">
            <div class="qr-container">
              <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
              <div class="qr-dates"><span>من: ${startDate || '----'}</span><span>إلى: ${endDate || '----'}</span></div>
              ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
            </div>
            <div class="info-section">
              <div class="info-label">الاسم</div>
              <div class="member-name">${cardData?.name_ar || ''}</div>
              <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${cardData?.member_code || ''}</span></div>
              <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${cardData?.phone || '-'}</span></div>
              ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
            </div>
          </div>
          <div class="card-footer">
            <div class="terms-title">شروط وأحكام:</div>
            <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
            <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
            <div>• في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</div>
          </div>
        </div>
        <div class="logo-card">
          <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
          <div class="contact-info">📞 0566238384</div>
          <div class="terms">
            <div class="terms-title">شروط وأحكام</div>
            <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
            <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
            <div>• في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</div>
          </div>
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
      <div class="card">
        <div class="card-header">
          <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
          <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
        </div>
        <div class="card-body">
          <div class="qr-container">
            <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
            <div class="qr-dates"><span>من: ${startDate || '----'}</span><span>إلى: ${endDate || '----'}</span></div>
            ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
          </div>
          <div class="info-section">
            <div class="info-label">الاسم</div>
            <div class="member-name">${cardData?.name_ar || ''}</div>
            <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${cardData?.member_code || ''}</span></div>
            <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${cardData?.phone || '-'}</span></div>
            ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
          </div>
        </div>
        <div class="card-footer">
          <div class="terms-title">شروط وأحكام:</div>
          <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
          <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
          <div>• في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</div>
        </div>
      </div>
      <div class="logo-card">
        <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
        <div class="contact-info">📞 0566238384</div>
        <div class="terms">
          <div class="terms-title">شروط وأحكام</div>
          <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
          <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
          <div>• في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</div>
        </div>
      </div>
    </div>
  </body>
</html>`;
};

// ── Sub-components ────────────────────────────────────────────────────────────

const SubscriptionCard = ({ act, darkMode, language, today }) => {
  const totalDays = daysDiff(act.start_date, act.end_date);
  const remaining = Math.max(0, daysDiff(today, act.end_date));
  const progressPct = totalDays > 0
    ? Math.min(100, Math.max(0, Math.round((remaining / totalDays) * 100)))
    : 0;
  const colors = remainingColor(remaining);

  return (
    <div className={`rounded-2xl border overflow-hidden ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-white border-gray-200'} shadow-sm`}>
      {/* Card top stripe */}
      <div className={`h-1.5 w-full ${colors.bar}`} />
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${darkMode ? 'bg-gray-600' : 'bg-gray-100'}`}>
              <CheckCircle className="w-5 h-5 text-green-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-bold text-sm truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>{act.activity_name}</p>
              {act.coach_name && (
                <div className="flex items-center gap-1.5 mt-1">
                  {act.coach_photo ? (
                    <img
                      src={act.coach_photo}
                      alt={act.coach_name}
                      className="w-5 h-5 rounded-full object-cover flex-shrink-0 border border-gray-200"
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <span className="text-xs">🏋️</span>
                  )}
                  <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{act.coach_name}</p>
                </div>
              )}
            </div>
          </div>
          {/* Remaining days badge */}
          <span className={`shrink-0 text-xs font-bold px-2.5 py-1.5 rounded-full border ${colors.badge}`}>
            {remaining > 0
              ? (language === 'ar' ? `${remaining} يوم` : `${remaining}d left`)
              : (language === 'ar' ? 'ينتهي اليوم' : 'ends today')
            }
          </span>
        </div>

        {/* Progress bar */}
        <div className={`w-full h-2 rounded-full mb-3 ${darkMode ? 'bg-gray-600' : 'bg-gray-100'} overflow-hidden`}>
          <div className={`h-full rounded-full transition-all duration-700 ${colors.bar}`} style={{ width: `${progressPct}%` }} />
        </div>

        {/* Date range */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Calendar className={`w-3.5 h-3.5 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
            <span className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{act.start_date}</span>
          </div>
          <span className={`text-[11px] font-medium ${colors.text}`}>
            {language === 'ar' ? 'ينتهي:' : 'Ends:'} {act.end_date}
          </span>
        </div>

        {/* Schedule */}
        {act.schedule && (
          <div className={`flex items-center gap-1.5 mt-1.5 px-2.5 py-1.5 rounded-lg ${darkMode ? 'bg-blue-900/30' : 'bg-blue-50'}`}>
            <Clock className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
            <span className={`text-xs ${darkMode ? 'text-blue-300' : 'text-blue-600'}`}>{act.schedule}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const MemberCard = () => {
  const [loading, setLoading] = useState(true);
  const [cardData, setCardData] = useState(null);
  const [selectedCardIdx, setSelectedCardIdx] = useState(0);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const member = getMemberData();
  const darkMode = getDarkMode();
  const language = getLanguage();
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => { fetchCardData(); }, []);

  const fetchCardData = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/qr-card');
      setCardData(res.data);
    } catch (error) {
      console.error('Failed to fetch card data');
    } finally {
      setLoading(false);
    }
  };

  // ── Build per-member cards list (siblings sharing a phone). Falls back to
  // the legacy single-card response shape for older API versions.
  const cards = (cardData?.cards && cardData.cards.length > 0)
    ? cardData.cards
    : (cardData ? [cardData] : []);
  const safeIdx = Math.min(selectedCardIdx, Math.max(0, cards.length - 1));
  const currentCard = cards[safeIdx] || null;

  const handleStickerPrint = () => {
    setShowPrintDialog(false);
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    printWindow.document.write(buildStickerHtml(currentCard));
    printWindow.document.close();
  };

  const handleDownload = async () => {
    const cardData = currentCard;
    const qrData = cardData?.member_code?.toString() || '';
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 450;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 400, 450);
    ctx.fillStyle = '#F97316';
    ctx.font = 'bold 18px Tajawal, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏆 شركة اداء الابطال العالمية للرياضة', 200, 35);
    const qrImg = new Image();
    qrImg.crossOrigin = 'anonymous';
    qrImg.onload = () => {
      ctx.drawImage(qrImg, 100, 60, 200, 200);
      ctx.fillStyle = '#1f2937';
      ctx.font = 'bold 20px Tajawal, sans-serif';
      ctx.fillText(cardData?.name_ar || '', 200, 300);
      ctx.fillStyle = '#F97316';
      ctx.font = 'bold 24px Tajawal, sans-serif';
      ctx.fillText(`#${cardData?.member_code || ''}`, 200, 340);
      const activities = cardData?.active_activities || [];
      if (activities.length > 0) {
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(40, 358);
        ctx.lineTo(360, 358);
        ctx.stroke();
        const availableHeight = 440 - 375;
        const lineHeight = Math.max(13, Math.floor(availableHeight / activities.length));
        const fontSize = Math.max(9, lineHeight - 4);
        const maxTextWidth = 340;
        const truncate = (text) => {
          ctx.font = `bold ${fontSize}px Tajawal, sans-serif`;
          if (ctx.measureText(text).width <= maxTextWidth) return text;
          let truncated = text;
          while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxTextWidth) {
            truncated = truncated.slice(0, -1);
          }
          return truncated + '…';
        };
        activities.forEach((act, i) => {
          const y = 375 + i * lineHeight;
          if (y > 443) return;
          ctx.fillStyle = '#374151';
          ctx.font = `bold ${fontSize}px Tajawal, sans-serif`;
          ctx.textAlign = 'center';
          const actText = act.activity_name || '';
          const coachText = act.coach_name ? ` · ${act.coach_name}` : '';
          ctx.fillText(truncate(actText + coachText), 200, y);
        });
      }
      const link = document.createElement('a');
      link.download = `membership-card-${cardData?.member_code}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
  };

  if (loading) {
    return (
      <MemberLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      </MemberLayout>
    );
  }

  const qrData = currentCard?.member_code?.toString() || '';
  const name = currentCard?.name_ar || member?.name_ar || '';
  const activeActivities = currentCard?.active_activities || [];

  return (
    <MemberLayout>
      <div className="max-w-lg mx-auto space-y-5">

        {/* ── Linked Members Switcher (siblings sharing this phone) ── */}
        {cards.length > 1 && (
          <div className={`rounded-2xl p-3 border ${darkMode ? 'bg-gray-800/60 border-gray-700' : 'bg-amber-50 border-amber-200'}`}>
            <p className={`text-xs font-bold mb-2 ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
              👥 {language === 'ar'
                ? `الأعضاء المرتبطون بنفس الرقم (${cards.length})`
                : `Linked members on this phone (${cards.length})`}
            </p>
            <div className="flex flex-wrap gap-2">
              {cards.map((c, idx) => {
                const active = idx === safeIdx;
                return (
                  <button
                    key={c.id || idx}
                    onClick={() => setSelectedCardIdx(idx)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border transition-all ${
                      active
                        ? 'bg-amber-500 text-gray-900 border-amber-500 shadow'
                        : darkMode
                          ? 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {c.photo ? (
                      <img
                        src={c.photo}
                        alt={c.name_ar || c.name || ''}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'flex';
                        }}
                        className="w-7 h-7 rounded-full object-cover border border-amber-300"
                      />
                    ) : null}
                    <span
                      className={`w-7 h-7 rounded-full items-center justify-center text-xs font-black ${
                        active ? 'bg-gray-900 text-amber-400' : 'bg-amber-100 text-amber-700'
                      }`}
                      style={{ display: c.photo ? 'none' : 'flex' }}
                    >
                      {getInitials(c.name_ar || c.name || '')}
                    </span>
                    <span className="flex flex-col items-start leading-tight">
                      <span className="truncate max-w-[120px]">{c.name_ar || c.name || ''}</span>
                      <span className={`text-[10px] font-mono ${active ? 'text-gray-700' : 'text-gray-400'}`}>
                        #{c.member_code}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Print Dialog ── */}
        <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
          <DialogContent className="max-w-lg" dir={language === 'ar' ? 'rtl' : 'ltr'}>
            <DialogHeader>
              <DialogTitle className="text-center text-xl">
                🖨️ {language === 'ar' ? 'طباعة الملصقات' : 'Print Stickers'}
              </DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-center text-gray-600 mb-2 font-bold">{currentCard?.name_ar}</p>
              <p className="text-center text-sm text-orange-600 mb-4 font-bold">#{currentCard?.member_code}</p>
              <p className="text-center text-sm text-gray-500 mb-4">
                {language === 'ar' ? 'سيتم طباعة كرت العضوية + شعار الأكاديمية معاً' : 'Print member card + academy logo together'}
              </p>
              <div className="bg-gray-100 p-4 rounded-lg">
                <div className="flex gap-3 justify-center max-w-[360px] mx-auto">
                  <div className="aspect-[9/6] w-[140px] bg-white border-2 border-blue-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3">
                    <span className="text-3xl">📇</span>
                    <span className="text-sm font-bold text-gray-700">{language === 'ar' ? 'كرت العضوية' : 'Member Card'}</span>
                    <span className="text-xs text-blue-500">{language === 'ar' ? 'خانة 1' : 'Slot 1'}</span>
                  </div>
                  <div className="aspect-[9/6] w-[140px] bg-white border-2 border-blue-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3 overflow-hidden">
                    <img src="/images/academy-logo.png" alt="logo" className="w-14 h-14 object-contain" />
                    <span className="text-sm font-bold text-gray-700">{language === 'ar' ? 'شعار الأكاديمية' : 'Academy Logo'}</span>
                    <span className="text-xs text-blue-500">{language === 'ar' ? 'خانة 2' : 'Slot 2'}</span>
                  </div>
                </div>
                <p className="text-center text-xs text-gray-500 mt-3">📐 {language === 'ar' ? 'حجم كل كرت: 9سم × 6سم' : 'Card size: 9cm × 6cm'}</p>
              </div>
              <div className="mt-4 flex justify-center">
                <Button onClick={handleStickerPrint} className="bg-blue-500 hover:bg-blue-600 text-white px-8 py-3 text-lg">
                  <Printer className="w-5 h-5 ml-2" />
                  {language === 'ar' ? 'طباعة الملصقات' : 'Print Stickers'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Profile Header ── */}
        <div className={`relative rounded-3xl overflow-hidden border shadow-xl ${
          darkMode
            ? 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 border-amber-500/10'
            : 'bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 border-amber-500/10'
        }`}>
          {/* Decorative circles */}
          <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500/10 rounded-full -translate-y-16 translate-x-16" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-orange-500/10 rounded-full translate-y-12 -translate-x-12" />

          <div className="relative p-6 pb-5">
            {/* Academy name */}
            <p className="text-amber-400 text-xs font-bold mb-4 text-center opacity-80">
              🏆 {language === 'ar' ? 'شركة اداء الابطال العالمية للرياضة' : 'Global Champions Sports Academy'}
            </p>

            {/* Avatar + Info */}
            <div className="flex items-center gap-4 mb-4">
              {currentCard?.photo ? (
                <img
                  src={currentCard.photo}
                  alt={name}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'flex';
                  }}
                  className="w-20 h-20 rounded-2xl object-cover flex-shrink-0 shadow-lg shadow-amber-500/30 border-2 border-amber-400"
                />
              ) : null}
              <div
                className="w-20 h-20 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-2xl items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/30"
                style={{ display: currentCard?.photo ? 'none' : 'flex' }}
              >
                <span className="text-gray-900 font-black text-2xl leading-none">{getInitials(name)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-white font-black text-xl leading-tight truncate">{name}</h1>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="bg-amber-500/20 border border-amber-500/30 text-amber-400 text-sm font-bold px-3 py-0.5 rounded-full">
                    #{currentCard?.member_code}
                  </span>
                </div>
                {currentCard?.phone && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <Phone className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-gray-400 text-sm" dir="ltr">{currentCard.phone}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Status badge */}
            {activeActivities.length > 0 && (
              <div className="flex items-center gap-2 bg-green-500/15 border border-green-500/25 rounded-xl px-3 py-2">
                <ShieldCheck className="w-4 h-4 text-green-400 flex-shrink-0" />
                <span className="text-green-300 text-xs font-medium">
                  {language === 'ar'
                    ? `عضو ساري — ${activeActivities.length} اشتراك نشط`
                    : `Active Member — ${activeActivities.length} active subscription${activeActivities.length > 1 ? 's' : ''}`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── QR Code Hero ── */}
        <Card className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} shadow-sm`}>
          <CardContent className="p-6">
            <div className="flex flex-col items-center text-center">
              {/* QR Label */}
              <div className="flex items-center gap-2 mb-4">
                <QrCode className={`w-4 h-4 ${darkMode ? 'text-amber-400' : 'text-amber-500'}`} />
                <span className={`text-sm font-bold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {language === 'ar' ? 'رمز المسح السريع' : 'Quick Scan Code'}
                </span>
              </div>

              {/* QR Code */}
              <div className={`p-4 rounded-2xl shadow-lg ${darkMode ? 'bg-white' : 'bg-white'} mb-4`} style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
                <QRCodeSVG
                  value={qrData || ' '}
                  size={240}
                  level="H"
                  includeMargin={false}
                />
              </div>

              {/* Member code under QR */}
              <p className={`text-2xl font-black mb-1 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                #{currentCard?.member_code}
              </p>
              <p className={`text-xs mb-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                📱 {language === 'ar' ? 'امسح هذا الرمز عند الدخول لتسجيل الحضور' : 'Scan this code at entry to record attendance'}
              </p>

              {/* Action buttons */}
              <div className="flex gap-3 w-full justify-center">
                <Button onClick={() => setShowPrintDialog(true)} className="flex-1 max-w-[140px] gap-2 bg-gray-900 hover:bg-gray-800 text-white">
                  <Printer className="w-4 h-4" />
                  {language === 'ar' ? 'طباعة' : 'Print'}
                </Button>
                <Button onClick={handleDownload} variant="outline" className={`flex-1 max-w-[140px] gap-2 ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : ''}`}>
                  <Download className="w-4 h-4" />
                  {language === 'ar' ? 'تحميل' : 'Download'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Active Subscriptions ── */}
        {activeActivities.length > 0 && (
          <div className="space-y-3">
            <h2 className={`text-base font-bold flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
              <CheckCircle className="w-4 h-4 text-green-500" />
              {language === 'ar' ? 'الاشتراكات السارية' : 'Active Subscriptions'}
            </h2>
            {activeActivities.map((act, idx) => (
              <SubscriptionCard
                key={idx}
                act={act}
                darkMode={darkMode}
                language={language}
                today={today}
              />
            ))}
          </div>
        )}

        {/* ── No Active Subscriptions ── */}
        {activeActivities.length === 0 && (
          <Card className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-orange-50 border-orange-200'}`}>
            <CardContent className="p-6 text-center">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${darkMode ? 'bg-gray-700' : 'bg-orange-100'}`}>
                <Calendar className="w-7 h-7 text-orange-500" />
              </div>
              <p className={`font-bold ${darkMode ? 'text-gray-300' : 'text-orange-800'}`}>
                {language === 'ar' ? 'لا توجد اشتراكات سارية' : 'No Active Subscriptions'}
              </p>
              <p className={`text-sm mt-1 ${darkMode ? 'text-gray-500' : 'text-orange-600'}`}>
                {language === 'ar' ? 'تواصل مع الأكاديمية لتجديد اشتراكك' : 'Contact the academy to renew your subscription'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Terms Notice ── */}
        <div className={`rounded-2xl p-4 text-xs leading-relaxed ${darkMode ? 'bg-gray-800/50 border border-gray-700 text-gray-400' : 'bg-gray-50 border border-gray-200 text-gray-500'}`}>
          <p className={`font-bold mb-1.5 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            {language === 'ar' ? '📋 شروط وأحكام' : '📋 Terms & Conditions'}
          </p>
          <p>• {language === 'ar' ? 'الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص الغياب' : 'Subscriptions are date-bound; missed sessions are not compensated'}</p>
          <p className="mt-1">• {language === 'ar' ? 'المبلغ المدفوع لا يُسترد بعد مرور أسبوع من الاشتراك' : 'Fees are non-refundable after one week from subscription date'}</p>
          <p className="mt-1">• {language === 'ar' ? 'في حال فقدان الكرت، يُصدر كرت جديد برسوم 10 ر.س' : 'Lost cards will be replaced for a fee of 10 SAR'}</p>
        </div>

      </div>
    </MemberLayout>
  );
};

export default MemberCard;
