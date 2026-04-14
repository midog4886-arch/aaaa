import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { CheckCircle, Edit, FileText, Loader2, MessageSquare, Printer, Receipt, RefreshCcw, RotateCcw, Trash2 } from 'lucide-react';
import { COMPANY_INFO, INVOICE_TERMS } from '../../constants';

export const ViewInvoiceDialog = ({
  isOpen, onOpenChange, selectedInvoice, qrCode, printRef,
  getBranchName, getStatusBadge,
  onPrint, onShareWhatsApp, onSaveAsPdf, onSaveAsPdfOnly,
  onPrintRegistrationForm, onEdit, onMarkPaid, onRestoreInvoice,
  onOpenRefund, onDelete,
  sharingWhatsApp, savingPdf, saving, isAdmin,
  language, t
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Receipt className="w-5 h-5 text-primary" />{t('invoice_number')}: #{selectedInvoice?.id.slice(0, 8)}</DialogTitle></DialogHeader>
        {selectedInvoice && (
          <div ref={printRef} className="p-4">
            <div className="flex justify-between items-start border-b-2 border-primary pb-4 mb-4">
              <div>
                <div className="text-lg font-bold text-blue-900">{COMPANY_INFO.name_ar}</div>
                <div className="text-xs text-muted-foreground">{language === 'ar' ? 'الرقم الضريبي' : 'Tax No'}: {COMPANY_INFO.tax_number}<br/>{language === 'ar' ? 'السجل التجاري' : 'CR'}: {COMPANY_INFO.commercial_reg}</div>
                <div className="mt-2 text-sm font-semibold text-orange-600 bg-orange-50 px-2 py-1 rounded inline-block">
                  🏢 {language === 'ar' ? 'الفرع:' : 'Branch:'} {getBranchName(selectedInvoice.branch_id)}
                </div>
              </div>
              <div className="text-sm text-end">
                <p><strong>{t('invoice_number')}:</strong> #{selectedInvoice.invoice_number || selectedInvoice.id.slice(0, 8)}</p>
                <p><strong>{t('invoice_date')}:</strong> {new Date(selectedInvoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</p>
                <div className="mt-2">{getStatusBadge(selectedInvoice.status)}</div>
              </div>
            </div>

            <div className="mb-4 p-3 bg-muted/50 rounded-lg">
              <h4 className="font-semibold mb-2 text-blue-900">{language === 'ar' ? 'بيانات العميل' : 'Customer'}</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p><strong>{language === 'ar' ? 'الاسم' : 'Name'}:</strong> {selectedInvoice.customer_name_ar || selectedInvoice.member_name} {selectedInvoice.member_code && <span className="text-primary font-bold">(#{selectedInvoice.member_code})</span>}</p>
                <p><strong>{t('phone')}:</strong> <span dir="ltr">{selectedInvoice.customer_phone || '-'}</span></p>
                {selectedInvoice.customer_address && <p className="col-span-2"><strong>{language === 'ar' ? 'العنوان' : 'Address'}:</strong> {selectedInvoice.customer_address}</p>}
              </div>
            </div>

            <table className="w-full border-collapse mb-4">
              <thead><tr className="bg-muted">
                {selectedInvoice.additional_members?.length > 0 && <th className="border p-2 text-start">{language === 'ar' ? 'العضو' : 'Member'}</th>}
                <th className="border p-2 text-start">{t('activity_name')}</th><th className="border p-2 text-start">{language === 'ar' ? 'الفترة' : 'Period'}</th><th className="border p-2 text-start">{language === 'ar' ? 'المواعيد' : 'Schedule'}</th><th className="border p-2 text-start">{language === 'ar' ? 'المبلغ' : 'Amount'}</th></tr></thead>
              <tbody>{(selectedInvoice.items || []).map((item, idx) => <tr key={idx}>
                {selectedInvoice.additional_members?.length > 0 && <td className="border p-2 text-xs text-blue-700 font-medium">{item.member_name || selectedInvoice.customer_name_ar || '-'}</td>}
                <td className="border p-2">{item.activity_name}</td><td className="border p-2 text-sm">{item.period}</td><td className="border p-2 text-sm text-blue-700 schedule-cell font-medium">{item.schedule || '-'}</td><td className="border p-2">{item.fee} {t('sar')}</td></tr>)}</tbody>
            </table>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1 border-b"><span>{t('subtotal')}:</span><span>{selectedInvoice.subtotal} {t('sar')}</span></div>
              {selectedInvoice.discount > 0 && <div className="flex justify-between py-1 border-b text-muted-foreground"><span>{t('discount')}:</span><span>- {selectedInvoice.discount} {t('sar')}</span></div>}
              <div className="flex justify-between py-1 border-b text-green-600"><span>{language === 'ar' ? `ضريبة القيمة المضافة (${COMPANY_INFO.vat_rate}%)` : `VAT (${COMPANY_INFO.vat_rate}%)`}:</span><span>{selectedInvoice.vat_amount || 0} {t('sar')}</span></div>
              <div className="flex justify-between py-2 text-xl font-bold text-primary border-t-2 border-blue-900"><span>{t('total')}:</span><span>{selectedInvoice.total} {t('sar')}</span></div>
            </div>

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><strong>{language === 'ar' ? 'طريقة الدفع:' : 'Payment Method:'}</strong> {
                  selectedInvoice.payment_method === 'cash' ? (language === 'ar' ? 'نقداً' : 'Cash') :
                  selectedInvoice.payment_method === 'card' ? (language === 'ar' ? 'بطاقة' : 'Card') :
                  selectedInvoice.payment_method === 'transfer' ? (language === 'ar' ? 'تحويل بنكي' : 'Transfer') :
                  selectedInvoice.payment_method === 'tabby' ? (language === 'ar' ? 'تابي' : 'Tabby') :
                  selectedInvoice.payment_method === 'tamara' ? (language === 'ar' ? 'تمارا' : 'Tamara') :
                  selectedInvoice.payment_method
                }</div>
                <div><strong>{language === 'ar' ? 'الحالة:' : 'Status:'}</strong> {selectedInvoice.status === 'paid' ? (language === 'ar' ? '✅ مدفوعة' : '✅ Paid') : selectedInvoice.status === 'pending' ? (language === 'ar' ? '⏳ غير مدفوعة' : '⏳ Pending') : (language === 'ar' ? '❌ ملغاة' : '❌ Cancelled')}</div>
                {selectedInvoice.supervisor_name && (
                  <div className="col-span-2 mt-2 pt-2 border-t border-blue-200"><strong>{language === 'ar' ? '👤 مشرف الفاتورة:' : '👤 Invoice Supervisor:'}</strong> {selectedInvoice.supervisor_name}</div>
                )}
              </div>
            </div>

            {selectedInvoice.notes && (
              <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-sm"><strong>{language === 'ar' ? 'ملاحظات:' : 'Notes:'}</strong> {selectedInvoice.notes}</p>
              </div>
            )}

            {selectedInvoice?.status === 'paid' && qrCode && <div className="qr-code text-center mt-4 pt-4 border-t"><p className="text-xs text-muted-foreground mb-2">{language === 'ar' ? 'رمز QR للفاتورة الإلكترونية' : 'E-Invoice QR Code'}</p><img src={qrCode} alt="QR Code" className="w-20 h-20 mx-auto" /></div>}

            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs font-bold text-amber-800 mb-2">{language === 'ar' ? '⚠️ شروط وأحكام:' : '⚠️ Terms & Conditions:'}</p>
              <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
                {(language === 'ar' ? INVOICE_TERMS.ar : INVOICE_TERMS.en).map((term, idx) => (
                  <li key={idx}>{term}</li>
                ))}
              </ul>
            </div>

            <div className="mt-4 p-3 border-2 border-purple-400 rounded-lg" style={{WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact'}}>
              <p className="text-xs font-bold text-purple-800 mb-2" style={{color: '#6b21a8'}}>🏆 {language === 'ar' ? 'برنامج نقاط الولاء' : 'Loyalty Points Program'}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" style={{color: '#7e22ce'}}>
                <span>✅ {language === 'ar' ? 'كل حضور: 10 نقاط' : 'Each attendance: 10 pts'}</span>
                <span>🔥 {language === 'ar' ? 'سلسلة 5 أيام: 50 نقطة' : '5-day streak: 50 pts'}</span>
                <span>📺 {language === 'ar' ? 'مشاهدة فيديو: 3 نقاط' : 'Watch video: 3 pts'}</span>
                <span>👥 {language === 'ar' ? 'إحالة صديق: 200 نقطة' : 'Referral: 200 pts'}</span>
                <span>🔄 {language === 'ar' ? 'تجديد شهري: 100 نقطة' : 'Monthly renewal: 100 pts'}</span>
                <span>🎂 {language === 'ar' ? 'عيد ميلاد: 100 نقطة' : 'Birthday: 100 pts'}</span>
              </div>
              <div className="mt-2 pt-2 border-t border-purple-400">
                <p className="text-xs font-bold mb-1" style={{color: '#6b21a8'}}>{language === 'ar' ? 'المستويات والمزايا:' : 'Levels & Benefits:'}</p>
                <div className="flex justify-between text-xs" style={{color: '#7e22ce'}}>
                  <span>🥉 {language === 'ar' ? 'برونزي: 0+' : 'Bronze: 0+'}</span>
                  <span>🥈 {language === 'ar' ? 'فضي: 500+ (خصم 3%)' : 'Silver: 500+ (3% off)'}</span>
                  <span>🥇 {language === 'ar' ? 'ذهبي: 1500+ (خصم 5%)' : 'Gold: 1500+ (5% off)'}</span>
                  <span>💎 {language === 'ar' ? 'ماسي: 3000+ (خصم 10%)' : 'Diamond: 3000+ (10% off)'}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t text-center text-xs text-muted-foreground">
              <p>{COMPANY_INFO.name_ar} | {COMPANY_INFO.name_en}</p>
              <p className="mt-1 font-semibold text-orange-600">🏢 {getBranchName(selectedInvoice.branch_id)}</p>
              <div className="flex justify-center gap-6 mt-2"><span>{language === 'ar' ? 'الرقم الضريبي' : 'Tax Number'}: {COMPANY_INFO.tax_number}</span><span>{language === 'ar' ? 'السجل التجاري' : 'Commercial Reg'}: {COMPANY_INFO.commercial_reg}</span></div>
            </div>
          </div>
        )}
        <DialogFooter className="flex flex-col gap-3 sm:flex-col">
          <div className="flex flex-wrap gap-2 justify-center border-b pb-3">
            <Button variant="outline" onClick={onPrint} size="sm"><Printer className="w-4 h-4 me-1" />{t('print')}</Button>
            <Button variant="outline" onClick={onShareWhatsApp} disabled={sharingWhatsApp} size="sm" className="bg-green-50 border-green-400 text-green-700 hover:bg-green-100">
              {sharingWhatsApp ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <MessageSquare className="w-4 h-4 me-1" />}
              {language === 'ar' ? 'واتساب' : 'WhatsApp'}
            </Button>
            <Button variant="outline" onClick={onSaveAsPdfOnly} disabled={savingPdf} size="sm" className="bg-blue-50 border-blue-400 text-blue-700 hover:bg-blue-100">
              {savingPdf ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <FileText className="w-4 h-4 me-1" />}
              PDF
            </Button>
            <Button variant="outline" onClick={onSaveAsPdf} disabled={savingPdf} size="sm" className="bg-emerald-50 border-emerald-400 text-emerald-700 hover:bg-emerald-100">
              {savingPdf ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <MessageSquare className="w-4 h-4 me-1" />}
              PDF + {language === 'ar' ? 'واتساب' : 'WA'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            <Button variant="outline" onClick={onPrintRegistrationForm} size="sm" className="bg-gray-800 border-gray-700 text-white hover:bg-gray-900">
              <FileText className="w-4 h-4 me-1" />
              {language === 'ar' ? 'استمارة تسجيل' : 'Registration Form'}
            </Button>
            {selectedInvoice?.status === 'pending' && <Button variant="outline" size="sm" className="text-blue-600 border-blue-300" onClick={() => onEdit(selectedInvoice)}><Edit className="w-4 h-4 me-1" />{language === 'ar' ? 'تعديل' : 'Edit'}</Button>}
            {selectedInvoice?.status === 'pending' && <Button size="sm" onClick={() => onMarkPaid(selectedInvoice.id)}><CheckCircle className="w-4 h-4 me-1" />{language === 'ar' ? 'تم الدفع' : 'Mark Paid'}</Button>}
            {selectedInvoice?.status === 'cancelled' && <Button variant="outline" size="sm" onClick={() => onRestoreInvoice(selectedInvoice.id)}><RotateCcw className="w-4 h-4 me-1" />{language === 'ar' ? 'استرجاع' : 'Restore'}</Button>}
            {selectedInvoice?.status === 'paid' && <Button variant="outline" size="sm" className="text-purple-600 border-purple-300" onClick={() => { onOpenChange(false); onOpenRefund(selectedInvoice); }}><RefreshCcw className="w-4 h-4 me-1" />{language === 'ar' ? 'استرجاع مبلغ' : 'Refund'}</Button>}
            {isAdmin && <Button variant="destructive" size="sm" onClick={() => onDelete(selectedInvoice?.id, selectedInvoice?.status)}><Trash2 className="w-4 h-4 me-1" />{language === 'ar' ? 'حذف' : 'Delete'}</Button>}
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t('close')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
