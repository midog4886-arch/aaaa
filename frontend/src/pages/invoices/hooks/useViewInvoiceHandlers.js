import { useState } from 'react';
import html2canvas from 'html2canvas';
import html2pdf from 'html2pdf.js';
import { toast } from 'sonner';
import { COMPANY_INFO, INVOICE_TERMS, getPaymentMethodLabel } from '../constants';

export const useViewInvoiceHandlers = ({
  selectedInvoice, printRef, qrCode, loyaltySettings, loyaltyLevelSettings,
  language, t, getBranchName, setIsViewDialogOpen
}) => {
  const [savingImage, setSavingImage] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const [sharingWhatsApp, setSharingWhatsApp] = useState(false);

  const handleSaveAsImage = async () => {
    if (!printRef.current) return;
    setSavingImage(true);
    try {
      const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const link = document.createElement('a');
      link.download = `invoice_${selectedInvoice.id.slice(0, 8)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast.success(language === 'ar' ? 'تم حفظ الصورة! يمكنك الآن مشاركتها على الواتساب' : 'Image saved! You can now share it on WhatsApp');
      const phone = selectedInvoice.customer_phone?.replace(/^0/, '966') || '';
      if (phone) {
        const message = `مرحباً، مرفق فاتورتكم من ${COMPANY_INFO.name_ar} رقم #${selectedInvoice.id.slice(0, 8)}`;
        setTimeout(() => { window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank'); }, 500);
      }
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حفظ الصورة' : 'Error saving image');
    } finally { setSavingImage(false); }
  };

  const handleSaveAsPdfOnly = async () => {
    if (!printRef.current) return;
    setSavingPdf(true);
    try {
      const invoiceNum = selectedInvoice.invoice_number || selectedInvoice.id.slice(0, 8);
      const customerName = selectedInvoice.customer_name_ar || selectedInvoice.member_name || 'invoice';
      const filename = `فاتورة_${invoiceNum}_${customerName}.pdf`;
      const opt = { margin: 10, filename, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
      await html2pdf().from(printRef.current).set(opt).save();
      toast.success(language === 'ar' ? 'تم حفظ الفاتورة كـ PDF' : 'Invoice saved as PDF');
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حفظ PDF' : 'Failed to save PDF');
    } finally { setSavingPdf(false); }
  };

  const handleSaveAsPdf = async () => {
    if (!printRef.current) return;
    setSavingPdf(true);
    try {
      const invoiceNum = selectedInvoice.invoice_number || selectedInvoice.id.slice(0, 8);
      const customerName = selectedInvoice.customer_name_ar || selectedInvoice.member_name || 'invoice';
      const filename = `فاتورة_${invoiceNum}_${customerName}.pdf`;
      const opt = { margin: 10, filename, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
      const pdfBlob = await html2pdf().from(printRef.current).set(opt).outputPdf('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = pdfUrl; link.download = filename; link.click();
      toast.success(language === 'ar' ? 'تم حفظ الفاتورة كـ PDF! يمكنك إرفاقها في الواتساب' : 'Invoice saved as PDF! You can attach it in WhatsApp');
      const phone = selectedInvoice.customer_phone?.replace(/^0/, '966') || '';
      if (phone) {
        const pdfItemsList = selectedInvoice.items?.map((item, i) => { let line = `${i + 1}. ${item.activity_name} - ${item.fee} ر.س`; if (item.schedule) line += `\n   📅 ${item.schedule}`; const startDate = item.start_date || ((item.period || '').split(' - ')[0] || '').trim(); const startTs = startDate ? new Date(startDate).getTime() : NaN; if (!isNaN(startTs)) line += `\n   ▶️ تاريخ البداية: ${new Date(startTs).toLocaleDateString('ar-SA')}`; const endDate = item.end_date || ((item.period || '').split(' - ')[1] || '').trim(); const endTs = endDate ? new Date(endDate).getTime() : NaN; if (!isNaN(endTs)) line += `\n   ⏳ تاريخ الانتهاء: ${new Date(endTs).toLocaleDateString('ar-SA')}`; return line; }).join('\n') || '';
        const pdfTerms = INVOICE_TERMS.ar.map(t => `• ${t}`).join('\n');
        const pdfVat = selectedInvoice.vat_amount || 0;
        const message = `📲 *لتحميل أيقونة تطبيق الأعضاء اندرويد اضغط على الرابط:*\nhttps://play.google.com/store/apps/details?id=com.champions.academy.member\n🍎 *لتحميل الأيفون اضغط على الرابط:*\nhttps://adaa-alabtal.replit.app/member-login\n👥 *انضم لمجموعتنا على الواتساب:*\nhttps://chat.whatsapp.com/JDf5d5mwAcxBy6nXA9gvhs\n━━━━━━━━━━━━━━\n🏆 *${COMPANY_INFO.name_ar}*\n━━━━━━━━━━━━━━\n📄 *فاتورة رقم:* #${invoiceNum}\n📅 *التاريخ:* ${new Date(selectedInvoice.created_at).toLocaleDateString('ar-SA')}\n👤 *العميل:* ${selectedInvoice.customer_name_ar || selectedInvoice.member_name}\n🔢 *رقم العضوية:* #${selectedInvoice.member_code || '-'}\n━━━━━━━━━━━━━━\n*الأنشطة والمواعيد:*\n${pdfItemsList}\n━━━━━━━━━━━━━━\n💰 *المجموع:* ${selectedInvoice.subtotal} ر.س\n${selectedInvoice.discount > 0 ? `🎁 *الخصم:* ${selectedInvoice.discount} ر.س\n` : ''}📊 *ضريبة القيمة المضافة (15%):* ${pdfVat} ر.س\n━━━━━━━━━━━━━━\n✨ *الإجمالي:* ${selectedInvoice.total} ر.س\n📌 *الحالة:* ${selectedInvoice.status === 'paid' ? '✅ مدفوعة' : '⏳ غير مدفوعة'}\n━━━━━━━━━━━━━━\n⚠️ *شروط وأحكام:*\n${pdfTerms}\n━━━━━━━━━━━━━━\n🏛️ الرقم الضريبي: ${COMPANY_INFO.tax_number}\n📋 السجل التجاري: ${COMPANY_INFO.commercial_reg}`;
        setTimeout(() => { window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank'); }, 500);
      } else { toast.info(language === 'ar' ? 'لا يوجد رقم جوال للعميل' : 'No phone number for customer'); }
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حفظ PDF' : 'Failed to save PDF');
    } finally { setSavingPdf(false); }
  };

  const handleShareWhatsApp = async () => {
    if (!selectedInvoice || !printRef.current) return;
    setSharingWhatsApp(true);
    try {
      const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const invoiceNum = selectedInvoice.invoice_number || selectedInvoice.id.slice(0, 8);
      const fileName = `فاتورة_${invoiceNum}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      const message = `📄 فاتورة رقم #${invoiceNum} - الإجمالي: ${selectedInvoice.total} ر.س\nشركة اداء الابطال العالمية للرياضة`;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ text: message, files: [file] });
        toast.success(language === 'ar' ? 'تمت المشاركة بنجاح' : 'Shared successfully');
      } else {
        const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = fileName; link.click();
        const phone = selectedInvoice.customer_phone?.replace(/^0/, '966') || '';
        if (phone) { window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank'); }
        else { window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank'); }
        toast.success(language === 'ar' ? 'تم تحميل صورة الفاتورة! أرفقها في الواتساب' : 'Invoice image downloaded! Attach it in WhatsApp');
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        const phone = selectedInvoice.customer_phone?.replace(/^0/, '966') || '';
        const invoiceNum = selectedInvoice.invoice_number || selectedInvoice.id.slice(0, 8);
        const items = selectedInvoice.items?.map(item => `• ${item.activity_name}: ${item.fee} ر.س`).join('\n') || '';
        const message = `السلام عليكم،\n\n📄 *فاتورة رقم #${invoiceNum}*\n\n${items}\n\n✅ *الإجمالي: ${selectedInvoice.total} ر.س*\n\nشكراً لكم،\nشركة اداء الابطال العالمية للرياضة`;
        if (phone) { window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank'); }
        else { navigator.clipboard?.writeText(message); toast.info(language === 'ar' ? 'تم نسخ الرسالة' : 'Message copied'); }
      }
    } finally { setSharingWhatsApp(false); }
  };

  const handleSendWhatsApp = (invoice) => {
    const phone = invoice.customer_phone || '';
    if (!phone) { toast.error(language === 'ar' ? 'لا يوجد رقم جوال' : 'No phone number'); return; }
    const formattedPhone = phone.replace(/^0/, '966');
    const vatAmount = invoice.vat_amount || 0;
    const itemsList = invoice.items?.map((item, i) => { let line = `${i + 1}. ${item.activity_name} - ${item.fee} ر.س`; if (item.schedule) line += `\n   📅 ${item.schedule}`; const startDate = item.start_date || ((item.period || '').split(' - ')[0] || '').trim(); const startTs = startDate ? new Date(startDate).getTime() : NaN; if (!isNaN(startTs)) line += `\n   ▶️ تاريخ البداية: ${new Date(startTs).toLocaleDateString('ar-SA')}`; const endDate = item.end_date || ((item.period || '').split(' - ')[1] || '').trim(); const endTs = endDate ? new Date(endDate).getTime() : NaN; if (!isNaN(endTs)) line += `\n   ⏳ تاريخ الانتهاء: ${new Date(endTs).toLocaleDateString('ar-SA')}`; return line; }).join('\n') || '';
    const termsText = INVOICE_TERMS.ar.map(t => `• ${t}`).join('\n');
    const message = `📲 *لتحميل أيقونة تطبيق الأعضاء اندرويد اضغط على الرابط:*\nhttps://play.google.com/store/apps/details?id=com.champions.academy.member\n🍎 *لتحميل الأيفون اضغط على الرابط:*\nhttps://adaa-alabtal.replit.app/member-login\n👥 *انضم لمجموعتنا على الواتساب:*\nhttps://chat.whatsapp.com/JDf5d5mwAcxBy6nXA9gvhs\n━━━━━━━━━━━━━━\n🏆 *${COMPANY_INFO.name_ar}*\n━━━━━━━━━━━━━━\n📄 *فاتورة رقم:* #${invoice.id.slice(0, 8)}\n📅 *التاريخ:* ${new Date(invoice.created_at).toLocaleDateString('ar-SA')}\n👤 *العميل:* ${invoice.customer_name_ar || invoice.member_name}\n🔢 *رقم العضوية:* #${invoice.member_code || '-'}\n━━━━━━━━━━━━━━\n*الأنشطة والمواعيد:*\n${itemsList}\n━━━━━━━━━━━━━━\n💰 *المجموع:* ${invoice.subtotal} ر.س\n${invoice.discount > 0 ? `🎁 *الخصم:* ${invoice.discount} ر.س\n` : ''}📊 *ضريبة القيمة المضافة (15%):* ${vatAmount} ر.س\n━━━━━━━━━━━━━━\n✨ *الإجمالي:* ${invoice.total} ر.س\n📌 *الحالة:* ${invoice.status === 'paid' ? '✅ مدفوعة' : '⏳ غير مدفوعة'}\n━━━━━━━━━━━━━━\n⚠️ *شروط وأحكام:*\n${termsText}\n━━━━━━━━━━━━━━\n🏛️ الرقم الضريبي: ${COMPANY_INFO.tax_number}\n📋 السجل التجاري: ${COMPANY_INFO.commercial_reg}`;
    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handlePrint = () => {
    if (!selectedInvoice) return;
    const inv = selectedInvoice;
    const branchName = getBranchName(inv.branch_id);
    const dateStr = new Date(inv.created_at).toLocaleDateString('ar-SA');
    const itemsRows = (inv.items || []).map((item, idx) => `<tr><td style="text-align:center">${idx + 1}</td><td>${item.activity_name || ''}</td><td>${item.period || '-'}</td><td class="schedule-cell">${item.schedule || '-'}</td><td style="text-align:left">${(item.fee || 0).toFixed(2)} ر.س</td></tr>`).join('');
    const qrImg = qrCode ? `<div class="qr-section"><img src="${qrCode}" /><p>رمز QR للفاتورة الإلكترونية</p></div>` : '';
    const notesBlock = inv.notes ? `<div class="notes-box"><strong>ملاحظات:</strong> ${inv.notes}</div>` : '';
    const printWindow = window.open('', '', 'width=800,height=900');
    printWindow.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>فاتورة #${inv.invoice_number || inv.id.slice(0,8)}</title><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}@page{size:A4;margin:12mm}body{font-family:'Tajawal',Arial,sans-serif;direction:rtl;color:#1f2937;font-size:12px;line-height:1.5}.invoice-page{max-width:760px;margin:0 auto;padding:20px}.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1E3A8A;padding-bottom:12px;margin-bottom:15px}.header-right h1{font-size:20px;color:#1E3A8A;margin-bottom:2px}.header-right .sub{font-size:10px;color:#6b7280}.header-right .branch{display:inline-block;margin-top:6px;background:#FFF7ED;border:1px solid #FDBA74;color:#C2410C;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700}.header-left{text-align:left;font-size:11px}.header-left .inv-num{font-size:14px;font-weight:700;color:#1E3A8A}.header-left .status{display:inline-block;padding:3px 12px;border-radius:12px;font-size:10px;font-weight:700;margin-top:4px}.status-paid{background:#DEF7EC;color:#03543F}.status-pending{background:#FEF3C7;color:#92400E}.status-cancelled{background:#FDE8E8;color:#9B1C1C}.customer-box{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;margin-bottom:15px}.customer-box h3{font-size:13px;color:#1E3A8A;margin-bottom:6px}.customer-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px}.customer-grid strong{color:#374151}.member-code{color:#F97316;font-weight:800}table{width:100%;border-collapse:collapse;margin:12px 0}thead th{background:#1E3A8A;color:#fff;padding:8px 10px;font-size:11px;font-weight:600;text-align:right}tbody td{padding:7px 10px;border-bottom:1px solid #E5E7EB;font-size:11px}tbody tr:nth-child(even){background:#F9FAFB}.schedule-cell{color:#1D4ED8;font-weight:600;font-size:10px}.totals-section{margin-top:10px;border-top:2px solid #E5E7EB;padding-top:10px}.total-row{display:flex;justify-content:space-between;padding:4px 12px;font-size:12px}.total-row.discount{color:#DC2626}.total-row.vat{color:#059669}.total-row.grand{font-size:16px;font-weight:800;color:#F97316;border-top:2px solid #1E3A8A;margin-top:6px;padding-top:8px}.payment-box{margin-top:12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px;font-size:11px}.payment-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.notes-box{margin-top:10px;background:#F3F4F6;border:1px solid #D1D5DB;border-radius:6px;padding:8px;font-size:10px}.terms-box{margin-top:12px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:6px;padding:10px}.terms-box h4{font-size:10px;color:#92400E;margin-bottom:5px}.terms-box ul{font-size:9px;color:#A16207;padding-right:16px;margin:0}.terms-box li{margin-bottom:2px}.qr-section{text-align:center;margin-top:12px}.qr-section img{width:90px;height:90px}.qr-section p{font-size:8px;color:#9CA3AF;margin-top:3px}.footer{margin-top:15px;border-top:2px solid #1E3A8A;padding-top:10px;text-align:center}.footer p{font-size:9px;color:#6B7280;margin-bottom:2px}.footer .company{font-size:11px;font-weight:700;color:#1E3A8A}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><div class="invoice-page"><div class="header"><div class="header-right"><h1>🏆 ${COMPANY_INFO.name_ar}</h1><div class="sub">${COMPANY_INFO.name_en}</div><div class="sub">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div><div class="branch">🏢 ${branchName}</div></div><div class="header-left"><div class="inv-num">فاتورة #${inv.invoice_number || inv.id.slice(0,8)}</div><div>📅 ${dateStr}</div><span class="status ${inv.status === 'paid' ? 'status-paid' : inv.status === 'cancelled' ? 'status-cancelled' : 'status-pending'}">${inv.status === 'paid' ? '✅ مدفوعة' : inv.status === 'cancelled' ? '❌ ملغاة' : '⏳ غير مدفوعة'}</span></div></div><div class="customer-box"><h3>👤 بيانات العميل</h3><div class="customer-grid"><div><strong>الاسم:</strong> ${inv.customer_name_ar || inv.member_name || '-'}${inv.member_code ? ` <span class="member-code">(#${inv.member_code})</span>` : ''}</div><div><strong>الجوال:</strong> <span dir="ltr">${inv.customer_phone || '-'}</span></div>${inv.customer_address ? `<div style="grid-column:span 2"><strong>العنوان:</strong> ${inv.customer_address}</div>` : ''}</div></div><table><thead><tr><th style="width:40px;text-align:center">#</th><th>النشاط</th><th>الفترة</th><th>المواعيد</th><th style="text-align:left">المبلغ</th></tr></thead><tbody>${itemsRows}</tbody></table><div class="totals-section"><div class="total-row"><span>المجموع الفرعي:</span><span>${(inv.subtotal || 0).toFixed(2)} ر.س</span></div>${inv.discount > 0 ? `<div class="total-row discount"><span>الخصم:</span><span>- ${(inv.discount || 0).toFixed(2)} ر.س</span></div>` : ''}<div class="total-row vat"><span>ضريبة القيمة المضافة (${COMPANY_INFO.vat_rate}%):</span><span>${(inv.vat_amount || 0).toFixed(2)} ر.س</span></div><div class="total-row grand"><span>الإجمالي:</span><span>${(inv.total || 0).toFixed(2)} ر.س</span></div></div><div class="payment-box"><div class="payment-grid"><div><strong>طريقة الدفع:</strong> ${getPaymentMethodLabel(inv.payment_method, 'ar')}</div><div><strong>الحالة:</strong> ${inv.status === 'paid' ? '✅ مدفوعة' : '⏳ غير مدفوعة'}</div>${inv.supervisor_name ? `<div style="grid-column:span 2"><strong>👤 مشرف الفاتورة:</strong> ${inv.supervisor_name}</div>` : ''}</div></div>${notesBlock}<div class="terms-box"><h4>⚠️ شروط وأحكام:</h4><ul>${INVOICE_TERMS.ar.map(t => `<li>${t}</li>`).join('')}</ul></div>${qrImg}<div style="margin-top:12px;padding:10px;border:2px solid #9333EA;border-radius:8px"><p style="font-size:11px;font-weight:700;color:#6b21a8;margin-bottom:6px">🏆 برنامج نقاط الولاء</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:10px;color:#7e22ce">${loyaltySettings?.attendance_points != null ? `<span>✅ كل حضور: ${loyaltySettings.attendance_points} نقاط</span>` : ''}${loyaltySettings?.streak_5_days_bonus != null ? `<span>🔥 سلسلة 5 أيام: ${loyaltySettings.streak_5_days_bonus} نقطة</span>` : ''}${loyaltySettings?.video_watch_points != null ? `<span>📺 مشاهدة فيديو: ${loyaltySettings.video_watch_points} نقاط</span>` : ''}${loyaltySettings?.referral_points != null ? `<span>👥 إحالة صديق: ${loyaltySettings.referral_points} نقطة</span>` : ''}${loyaltySettings?.monthly_renewal_points != null ? `<span>🔄 تجديد شهري: ${loyaltySettings.monthly_renewal_points} نقطة</span>` : ''}${loyaltySettings?.birthday_points != null ? `<span>🎂 عيد ميلاد: ${loyaltySettings.birthday_points} نقطة</span>` : ''}</div><div style="margin-top:6px;padding-top:6px;border-top:1px solid #9333EA"><p style="font-size:10px;font-weight:700;color:#6b21a8;margin-bottom:4px">المستويات والمزايا:</p><div style="display:flex;justify-content:space-between;font-size:9px;color:#7e22ce"><span>🥉 برونزي: ${loyaltyLevelSettings?.bronze_min ?? 0}+</span><span>🥈 فضي: ${loyaltyLevelSettings?.silver_min ?? 500}+ (خصم ${loyaltyLevelSettings?.silver_discount ?? 3}%)</span><span>🥇 ذهبي: ${loyaltyLevelSettings?.gold_min ?? 1500}+ (خصم ${loyaltyLevelSettings?.gold_discount ?? 5}%)</span><span>💎 ماسي: ${loyaltyLevelSettings?.diamond_min ?? 3000}+ (خصم ${loyaltyLevelSettings?.diamond_discount ?? 10}%)</span></div></div></div><div class="footer"><p class="company">${COMPANY_INFO.name_ar} | ${COMPANY_INFO.name_en}</p><p>🏢 ${branchName}</p><p>الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</p></div></div></body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 300);
  };

  const handlePrintRegistrationForm = () => {
    if (!selectedInvoice) return;
    const branchName = getBranchName(selectedInvoice.branch_id);
    const printWindow = window.open('', '', 'width=800,height=600');
    const itemsRows = selectedInvoice.items?.map((item, idx) => `<tr><td>${idx + 1}</td><td>${item.activity_name || ''}</td><td>${item.period || '-'}</td><td>${item.schedule || '-'}</td><td>${item.fee?.toFixed(2) || '0.00'} ر.س</td></tr>`).join('') || '';
    const content = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>استمارة تسجيل</title><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');@page{size:A4;margin:10mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Tajawal',Arial,sans-serif;direction:rtl;padding:20px;max-width:800px;margin:0 auto;color:#000;font-size:12px}.header{text-align:center;border-bottom:2px solid #000;padding-bottom:15px;margin-bottom:15px}.company-name{font-size:20px;font-weight:bold;margin-bottom:5px}.company-info{font-size:10px;color:#333}.form-title{font-size:18px;font-weight:bold;text-align:center;margin:15px 0;padding:8px;background:#f0f0f0;border:1px solid #000}.info-section{margin-bottom:15px;padding:10px;border:1px solid #000}.info-section h4{font-size:13px;font-weight:bold;margin-bottom:8px;border-bottom:1px solid #ccc;padding-bottom:5px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.info-row{display:flex;gap:5px}.info-label{font-weight:bold;min-width:80px}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:8px;border:1px solid #000;text-align:right;font-size:11px}th{background:#e0e0e0;font-weight:bold}.totals-section{margin-top:10px;border:1px solid #000;padding:10px}.totals-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #ccc}.totals-row.total{font-size:14px;font-weight:bold;border-top:2px solid #000;border-bottom:none;margin-top:5px;padding-top:8px}.payment-section{margin-top:10px;padding:10px;border:1px solid #000}.terms-section{margin-top:15px;padding:10px;border:1px solid #000}.terms-section h4{font-weight:bold;margin-bottom:8px}.terms-section ul{padding-right:20px;font-size:10px}.signature-section{margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:20px}.signature-box{border:1px solid #000;padding:10px;text-align:center}.signature-box p{font-weight:bold;margin-bottom:30px}.signature-line{border-top:1px solid #000;margin-top:20px;padding-top:5px;font-size:10px;color:#555}.footer{margin-top:20px;border-top:1px solid #000;padding-top:10px;text-align:center;font-size:10px;color:#555}</style></head><body><div class="header"><div class="company-name">${COMPANY_INFO.name_ar}</div>${branchName ? `<div style="font-size:12px;margin-top:4px">🏢 فرع: ${branchName}</div>` : ''}<div class="company-info">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div></div><div class="form-title">📋 استمارة تسجيل</div><div class="info-section"><h4>👤 بيانات العميل</h4><div class="info-grid"><div class="info-row"><span class="info-label">الاسم:</span><span>${selectedInvoice.customer_name_ar || selectedInvoice.member_name || '_______________'}</span></div><div class="info-row"><span class="info-label">رقم الجوال:</span><span dir="ltr">${selectedInvoice.customer_phone || '_______________'}</span></div><div class="info-row"><span class="info-label">رقم العضوية:</span><span>${selectedInvoice.member_code ? '#' + selectedInvoice.member_code : '_______________'}</span></div><div class="info-row"><span class="info-label">التاريخ:</span><span>${new Date(selectedInvoice.created_at).toLocaleDateString('ar-SA')}</span></div></div></div><div class="info-section"><h4>📝 الأنشطة والمنتجات</h4><table><thead><tr><th>#</th><th>النشاط</th><th>الفترة</th><th>المواعيد</th><th>الرسوم</th></tr></thead><tbody>${itemsRows}</tbody></table></div><div class="totals-section"><div class="totals-row"><span>المجموع الفرعي:</span><span>${selectedInvoice.subtotal || 0} ر.س</span></div>${selectedInvoice.discount > 0 ? `<div class="totals-row" style="color:#dc2626"><span>الخصم:</span><span>- ${selectedInvoice.discount} ر.س</span></div>` : ''}<div class="totals-row total"><span>💰 الإجمالي:</span><span>${selectedInvoice.total} ر.س</span></div></div><div class="payment-section"><div class="info-row"><span class="info-label">💳 طريقة الدفع:</span><span>${selectedInvoice.payment_method === 'cash' ? 'نقداً' : selectedInvoice.payment_method === 'card' ? 'بطاقة' : selectedInvoice.payment_method === 'transfer' ? 'تحويل بنكي' : selectedInvoice.payment_method || '-'}</span></div></div>${selectedInvoice.notes ? `<div style="margin-top:10px;padding:10px;border:1px solid #000;"><strong>📌 ملاحظات:</strong> ${selectedInvoice.notes}</div>` : ''}<div class="terms-section"><h4>⚠️ شروط وأحكام:</h4><ul>${INVOICE_TERMS.ar.map(t => `<li>${t}</li>`).join('')}</ul></div><div class="signature-section"><div class="signature-box"><p>✍️ توقيع العميل / ولي الأمر</p><div class="signature-line">التاريخ: _______________</div></div><div class="signature-box"><p>✍️ توقيع الموظف</p><div class="signature-line">التاريخ: _______________</div></div></div><div class="footer">${COMPANY_INFO.name_ar} - جميع الحقوق محفوظة © ${new Date().getFullYear()}</div></body></html>`;
    printWindow.document.write(content);
    printWindow.document.close();
    printWindow.print();
  };

  return {
    savingImage, savingPdf, sharingWhatsApp,
    handleSaveAsImage, handleSaveAsPdfOnly, handleSaveAsPdf, handleShareWhatsApp,
    handleSendWhatsApp, handlePrint, handlePrintRegistrationForm
  };
};
