import { useState } from 'react';
import { toast } from 'sonner';
import { invoicesAPI, creditNotesAPI, exportAPI } from '../../../services/api';
import { COMPANY_INFO } from '../constants';
import { verifyOperationPassword } from '../../../utils/operationPassword';

export const useInvoiceActions = ({ loadData, language, t, isAdmin, getBranchName, setInvoices }) => {
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);

  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [refundType, setRefundType] = useState('full');
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReason, setRefundReason] = useState('');
  const [refundSaving, setRefundSaving] = useState(false);

  const [isViewCreditNoteDialogOpen, setIsViewCreditNoteDialogOpen] = useState(false);
  const [selectedCreditNote, setSelectedCreditNote] = useState(null);

  const loadQRCode = async (invoiceId, status) => {
    if (status !== 'paid') { setQrCode(null); return; }
    try { const res = await invoicesAPI.getQR(invoiceId); setQrCode(res.data.qr_image); } catch { setQrCode(null); }
  };

  const handleViewInvoice = async (invoice) => {
    setSelectedInvoice(invoice);
    setIsViewDialogOpen(true);
    loadQRCode(invoice.id, invoice.status);
  };

  const handleMarkPaid = async (id) => {
    try {
      const res = await invoicesAPI.pay(id);
      const loyaltyAwarded = res.data?.loyalty_awarded || [];
      if (loyaltyAwarded.length > 0) {
        const totalPoints = loyaltyAwarded.reduce((sum, r) => sum + (r.points || 0), 0);
        const typeLabels = {
          monthly_renewal: language === 'ar' ? 'شهري' : 'monthly',
          quarterly_renewal: language === 'ar' ? 'ربع سنوي' : 'quarterly',
          yearly_renewal: language === 'ar' ? 'سنوي' : 'yearly',
        };
        let msg;
        if (loyaltyAwarded.length === 1) {
          const typeLabel = typeLabels[loyaltyAwarded[0]?.renewal_type] || (language === 'ar' ? 'شهري' : 'monthly');
          msg = language === 'ar'
            ? `تم الدفع بنجاح ✓ — تم منح ${totalPoints} نقطة ولاء (${typeLabel})`
            : `Payment successful ✓ — ${totalPoints} loyalty points awarded (${typeLabel})`;
        } else {
          msg = language === 'ar'
            ? `تم الدفع بنجاح ✓ — تم منح ${totalPoints} نقطة ولاء لـ ${loyaltyAwarded.length} أعضاء`
            : `Payment successful ✓ — ${totalPoints} loyalty points awarded across ${loyaltyAwarded.length} members`;
        }
        toast.success(msg);
      } else {
        toast.success(t('success'));
      }
      loadData();
    } catch { toast.error(t('error')); }
  };

  const handleRestoreInvoice = async (id) => {
    try { await invoicesAPI.restore(id); toast.success(language === 'ar' ? 'تم استرجاع الفاتورة' : 'Invoice restored'); loadData(); } catch { toast.error(t('error')); }
  };

  const handleCancelInvoice = async (id) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من إلغاء الفاتورة؟' : 'Cancel this invoice?')) return;
    try { await invoicesAPI.cancel(id); toast.success(language === 'ar' ? 'تم إلغاء الفاتورة' : 'Invoice cancelled'); loadData(); } catch { toast.error(t('error')); }
  };

  const handleDeleteInvoice = async (id, status, branchId) => {
    if (!isAdmin) { toast.error(language === 'ar' ? 'الحذف متاح للمدير فقط' : 'Delete is admin only'); return; }
    if (status === 'paid') {
      const pw = window.prompt(language === 'ar' ? 'أدخل كلمة المرور لحذف الفاتورة المدفوعة:' : 'Enter password to delete paid invoice:');
      if (pw === null) return;
      const ok = await verifyOperationPassword('delete_invoice', pw, branchId);
      if (!ok) { toast.error(language === 'ar' ? 'كلمة المرور غير صحيحة' : 'Incorrect password'); return; }
    }
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف الفاتورة نهائياً؟' : 'Are you sure you want to permanently delete this invoice?')) return;
    try { await invoicesAPI.delete(id); toast.success(language === 'ar' ? 'تم حذف الفاتورة' : 'Invoice deleted'); loadData(); setIsViewDialogOpen(false); } catch { toast.error(t('error')); }
  };

  const openRefundDialog = (invoice) => {
    setSelectedInvoice(invoice);
    setRefundType('full');
    setRefundAmount(invoice.total);
    setRefundReason('');
    setIsRefundDialogOpen(true);
  };

  const handleRefund = async () => {
    if (!selectedInvoice) return;
    const amount = refundType === 'full' ? selectedInvoice.total : parseFloat(refundAmount);
    if (amount <= 0 || amount > selectedInvoice.total) { toast.error(language === 'ar' ? 'مبلغ الاسترجاع غير صحيح' : 'Invalid refund amount'); return; }
    setRefundSaving(true);
    try {
      const res = await invoicesAPI.refund(selectedInvoice.id, { amount, reason: refundReason, refund_type: refundType });
      toast.success(language === 'ar' ? `تم إنشاء إشعار دائن رقم ${res.data.credit_note?.credit_note_number} بمبلغ ${amount} ر.س` : `Credit note ${res.data.credit_note?.credit_note_number} created for ${amount} SAR`);
      setIsRefundDialogOpen(false); setIsViewDialogOpen(false); loadData();
      if (res.data.credit_note) { setSelectedCreditNote(res.data.credit_note); setIsViewCreditNoteDialogOpen(true); }
    } catch { toast.error(language === 'ar' ? 'خطأ في إنشاء إشعار الدائن' : 'Failed to create credit note'); } finally { setRefundSaving(false); }
  };

  const handleViewCreditNote = (cn) => { setSelectedCreditNote(cn); setIsViewCreditNoteDialogOpen(true); };

  const handleDeleteCreditNote = async (id) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف إشعار الدائن؟' : 'Delete this credit note?')) return;
    try { await creditNotesAPI.delete(id); toast.success(language === 'ar' ? 'تم حذف إشعار الدائن' : 'Credit note deleted'); loadData(); } catch { toast.error(language === 'ar' ? 'خطأ في حذف إشعار الدائن' : 'Failed to delete credit note'); }
  };

  const handlePrintCreditNote = async (cn) => {
    const branchName = getBranchName(cn.branch_id);
    let qrDataUrl = '';
    try { const qrRes = await creditNotesAPI.getQR(cn.id); qrDataUrl = qrRes.data?.qr_image || ''; } catch {}
    const pw = window.open('', '', 'width=800,height=600');
    pw.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>إشعار دائن ${cn.credit_note_number}</title><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');@page{size:A4;margin:10mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Tajawal',Arial,sans-serif;direction:rtl;padding:20px;max-width:800px;margin:0 auto;font-size:12px}.header{background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;padding:20px;text-align:center;margin:-20px -20px 20px -20px}.header .company-name{font-size:22px;font-weight:bold}.header .doc-type{font-size:18px;margin-top:10px;background:rgba(255,255,255,0.2);display:inline-block;padding:5px 20px;border-radius:20px}.info-section{margin-bottom:15px;padding:15px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2}.info-section h4{font-size:14px;font-weight:bold;margin-bottom:10px;color:#dc2626;border-bottom:2px solid #dc2626;padding-bottom:5px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.info-row{display:flex;gap:8px;padding:5px 0}.info-label{font-weight:bold;min-width:100px;color:#374151}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:10px;border:1px solid #fecaca;text-align:right;font-size:11px}th{background:#dc2626;color:white;font-weight:bold}.totals-section{margin-top:15px;border:2px solid #dc2626;padding:15px;border-radius:8px;background:#fef2f2}.totals-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #fecaca}.totals-row.total{font-size:18px;font-weight:bold;border-top:2px solid #dc2626;border-bottom:none;margin-top:8px;padding-top:12px;color:#dc2626}.footer{margin-top:20px;text-align:center;font-size:10px;color:#6b7280;border-top:2px solid #fecaca;padding-top:15px}</style></head><body><div class="header"><div class="company-name">${COMPANY_INFO.name_ar}</div><div class="doc-type">📄 إشعار دائن (مرتجع)</div>${branchName ? `<div style="font-size:14px;margin-top:8px">🏢 ${branchName}</div>` : ''}<div style="font-size:10px;opacity:0.9;margin-top:5px">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div></div><div class="info-section"><h4>📋 بيانات إشعار الدائن</h4><div class="info-grid"><div class="info-row"><span class="info-label">رقم الإشعار:</span><span style="font-weight:bold;color:#dc2626">${cn.credit_note_number}</span></div><div class="info-row"><span class="info-label">التاريخ:</span><span>${new Date(cn.created_at).toLocaleDateString('ar-SA')}</span></div><div class="info-row"><span class="info-label">الفاتورة الأصلية:</span><span>${cn.original_invoice_number}</span></div><div class="info-row"><span class="info-label">المحرر:</span><span>${cn.created_by || '-'}</span></div></div></div><div class="info-section"><h4>👤 بيانات العميل</h4><div class="info-grid"><div class="info-row"><span class="info-label">الاسم:</span><span>${cn.customer_name_ar}</span></div><div class="info-row"><span class="info-label">الجوال:</span><span dir="ltr">${cn.customer_phone || '-'}</span></div></div></div><div class="info-section"><h4>📝 البنود المرتجعة</h4><table><thead><tr><th>#</th><th>البند</th><th>الكمية</th><th>المبلغ</th></tr></thead><tbody>${cn.items?.map((item, i) => `<tr><td>${i+1}</td><td>${item.activity_name}${item.is_product ? ' (منتج)' : ''}</td><td>${item.quantity || 1}</td><td>${((item.fee||0)*(item.quantity||1)).toFixed(2)} ر.س</td></tr>`).join('') || '<tr><td colspan="4">لا توجد بنود</td></tr>'}</tbody></table></div><div class="totals-section"><div class="totals-row"><span>المجموع الفرعي:</span><span>${cn.subtotal?.toFixed(2)} ر.س</span></div><div class="totals-row"><span>ضريبة القيمة المضافة (15%):</span><span>${cn.vat_amount?.toFixed(2)} ر.س</span></div><div class="totals-row total"><span>💰 إجمالي المرتجع:</span><span>${cn.refund_amount?.toFixed(2)} ر.س</span></div></div>${cn.reason ? `<div class="info-section"><strong>📌 سبب المرتجع:</strong> ${cn.reason}</div>` : ''}${qrDataUrl ? `<div style="margin-top:20px;text-align:center"><img src="${qrDataUrl}" style="width:120px;height:120px" /></div>` : ''}<div class="footer">${COMPANY_INFO.name_ar} - جميع الحقوق محفوظة © ${new Date().getFullYear()}</div></body></html>`);
    pw.document.close(); pw.print();
  };

  const handleExportAllData = () => {
    const token = localStorage.getItem('token');
    window.open(exportAPI.allData() + `?token=${token}`, '_blank');
  };

  const handleToggleInvoiceCheck = async (id) => {
    try { const res = await invoicesAPI.toggleCheck(id); setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, is_checked: res.data.is_checked } : inv)); } catch (e) { console.error(e); }
  };

  return {
    selectedInvoice, setSelectedInvoice,
    qrCode, setQrCode,
    isViewDialogOpen, setIsViewDialogOpen,
    isRefundDialogOpen, setIsRefundDialogOpen,
    refundType, setRefundType,
    refundAmount, setRefundAmount,
    refundReason, setRefundReason,
    refundSaving,
    isViewCreditNoteDialogOpen, setIsViewCreditNoteDialogOpen,
    selectedCreditNote, setSelectedCreditNote,
    loadQRCode,
    handleViewInvoice,
    handleMarkPaid,
    handleRestoreInvoice,
    handleCancelInvoice,
    handleDeleteInvoice,
    openRefundDialog,
    handleRefund,
    handleViewCreditNote,
    handleDeleteCreditNote,
    handlePrintCreditNote,
    handleExportAllData,
    handleToggleInvoiceCheck,
  };
};
