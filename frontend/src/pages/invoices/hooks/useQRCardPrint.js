import { useState } from 'react';
import { toast } from 'sonner';

export const useQRCardPrint = ({ language }) => {
  const [isQRCardDialogOpen, setIsQRCardDialogOpen] = useState(false);
  const [qrCardMember, setQrCardMember] = useState(null);
  const [qrCardSubscription, setQrCardSubscription] = useState(null);

  const handleOpenQRCard = (invoice) => {
    setQrCardMember({
      id: invoice.member_id,
      name_ar: invoice.customer_name_ar || invoice.member_name,
      member_code: invoice.member_code,
      phone: invoice.customer_phone
    });
    setIsQRCardDialogOpen(true);
  };

  const handlePrintQRCard = async () => {
    if (!qrCardMember) return;
    const qrData = qrCardMember.member_code.toString();
    let qrImageUrl = '';
    try {
      const QRCode = await import('qrcode');
      qrImageUrl = await QRCode.toDataURL(qrData, { width: 200, margin: 1, errorCorrectionLevel: 'H' });
    } catch (err) {
      console.error('QR generation error:', err);
      toast.error('خطأ في إنشاء QR Code');
      return;
    }
    const printWindow = window.open('', '_blank', 'width=450,height=600');
    printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>بطاقة العضوية - ${qrCardMember.member_code}</title><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');@page{size:A4;margin:0mm}*{margin:0;padding:0;box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:'Tajawal',Arial,sans-serif;background:#f3f4f6;direction:rtl}.screen-only{padding:20px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh}@media print{.screen-only{display:none!important}.print-area{display:block!important;position:absolute;top:0;right:0;margin:2mm}}@media screen{.print-area{display:none}}.preview-title{font-size:18px;font-weight:bold;color:#1f2937;margin-bottom:10px}.size-badge{display:inline-block;padding:10px 20px;background:linear-gradient(135deg,#FEF3C7,#FDE68A);border:2px dashed #F59E0B;border-radius:10px;font-size:16px;font-weight:bold;color:#92400E;margin-bottom:20px}.card-wrapper{display:inline-block;background:white;padding:15px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.15);border:2px solid #e5e7eb}.card{width:6cm;height:6cm;display:flex;flex-direction:column;align-items:center;justify-content:center;background:white;padding:3mm}.print-card{width:6cm;height:6cm;display:flex;flex-direction:column;align-items:center;justify-content:center;background:white;padding:3mm;border:1px solid #ddd}.logo{font-size:9pt;font-weight:bold;color:#F97316;margin-bottom:2mm}.qr-img{width:35mm;height:35mm}.name{font-size:9pt;font-weight:bold;margin-top:2mm;text-align:center;color:#1f2937}.code{font-size:11pt;font-weight:bold;color:#F97316;margin-top:1mm}.print-btn{margin-top:20px;padding:12px 30px;background:linear-gradient(135deg,#3B82F6,#2563EB);color:white;border:none;border-radius:10px;cursor:pointer;font-family:'Tajawal',Arial,sans-serif;font-size:16px;font-weight:bold;box-shadow:0 4px 15px rgba(59,130,246,0.4)}.note{margin-top:15px;font-size:13px;color:#6b7280}</style></head><body><div class="screen-only"><div class="preview-title">📋 معاينة بطاقة العضوية</div><div class="size-badge">📐 مقاس البطاقة: 6 سم × 6 سم</div><div class="card-wrapper"><div class="card"><div class="logo">🏆 شركة اداء الابطال العالمية للرياضة</div><img src="${qrImageUrl}" class="qr-img" alt="QR Code" /><div class="name">${qrCardMember.name_ar || ''}</div><div class="code">#${qrCardMember.member_code || ''}</div></div></div><button class="print-btn" onclick="window.print()">🖨️ طباعة البطاقة</button><p class="note">البطاقة ستُطبع في أعلى الصفحة</p></div><div class="print-area"><div class="print-card"><div class="logo">🏆 شركة اداء الابطال العالمية للرياضة</div><img src="${qrImageUrl}" class="qr-img" alt="QR Code" /><div class="name">${qrCardMember.name_ar || ''}</div><div class="code">#${qrCardMember.member_code || ''}</div></div></div></body></html>`);
    printWindow.document.close();
  };

  const handleSendQRCardWhatsApp = async () => {
    if (!qrCardMember) return;
    const phone = qrCardMember.phone?.replace(/^0/, '966') || '';
    if (!phone) { toast.error(language === 'ar' ? 'لا يوجد رقم جوال' : 'No phone number'); return; }
    const qrData = qrCardMember.member_code.toString();
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 500;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 400, 500);
      ctx.fillStyle = '#F97316'; ctx.font = 'bold 18px Tajawal, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🏆 شركة اداء الابطال العالمية للرياضة', 200, 35);
      const QRCode = await import('qrcode');
      const qrDataUrl = await QRCode.toDataURL(qrData, { width: 280, margin: 2 });
      const qrImg = new Image();
      qrImg.onload = () => {
        ctx.drawImage(qrImg, 60, 60, 280, 280);
        ctx.fillStyle = '#1f2937'; ctx.font = 'bold 22px Tajawal, sans-serif';
        ctx.fillText(qrCardMember.name_ar || '', 200, 380);
        ctx.fillStyle = '#F97316'; ctx.font = 'bold 28px Tajawal, sans-serif';
        ctx.fillText('#' + qrCardMember.member_code, 200, 420);
        ctx.fillStyle = '#9ca3af'; ctx.font = '14px Tajawal, sans-serif';
        ctx.fillText('امسح الكود عند الدخول لتسجيل الحضور', 200, 470);
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url; link.download = `qr-${qrCardMember.member_code}.png`; link.click();
          URL.revokeObjectURL(url);
          const message = `🏆 *شركة اداء الابطال العالمية للرياضة*\n━━━━━━━━━━━━━━\n🎫 *بطاقة العضوية*\n\n👤 *الاسم:* ${qrCardMember.name_ar}\n🔢 *رقم العضوية:* #${qrCardMember.member_code}\n\n📎 تم إرفاق صورة QR Code\nامسح الكود عند الدخول للأكاديمية ✅`;
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
          toast.success(language === 'ar' ? 'تم تحميل الصورة - أرسلها في الواتساب' : 'Image downloaded - send it on WhatsApp');
        }, 'image/png');
      };
      qrImg.src = qrDataUrl;
    } catch (err) {
      console.error('Error generating QR:', err);
      toast.error(language === 'ar' ? 'خطأ في إنشاء الصورة' : 'Error creating image');
    }
    setIsQRCardDialogOpen(false);
  };

  return {
    isQRCardDialogOpen, setIsQRCardDialogOpen,
    qrCardMember, setQrCardMember,
    qrCardSubscription, setQrCardSubscription,
    handleOpenQRCard, handlePrintQRCard, handleSendQRCardWhatsApp
  };
};
