import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { Loader2, RefreshCcw } from 'lucide-react';

export const RefundDialog = ({
  isOpen, onOpenChange, selectedInvoice, refundType, setRefundType,
  refundAmount, setRefundAmount, refundReason, setRefundReason,
  saving, onRefund, language, t
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCcw className="w-5 h-5 text-purple-600" />
            {language === 'ar' ? 'استرجاع مبلغ' : 'Refund Invoice'}
          </DialogTitle>
        </DialogHeader>
        {selectedInvoice && (
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm"><strong>{language === 'ar' ? 'رقم الفاتورة:' : 'Invoice #:'}</strong> #{selectedInvoice.invoice_number || selectedInvoice.id.slice(0, 8)}</p>
              <p className="text-sm"><strong>{language === 'ar' ? 'العميل:' : 'Customer:'}</strong> {selectedInvoice.customer_name_ar || selectedInvoice.member_name}</p>
              <p className="text-sm"><strong>{language === 'ar' ? 'المبلغ الكلي:' : 'Total Amount:'}</strong> {selectedInvoice.total} {t('sar')}</p>
            </div>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'نوع الاسترجاع' : 'Refund Type'}</Label>
              <Select value={refundType} onValueChange={(val) => {
                setRefundType(val);
                if (val === 'full') setRefundAmount(selectedInvoice.total);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">{language === 'ar' ? 'استرجاع كامل' : 'Full Refund'}</SelectItem>
                  <SelectItem value="partial">{language === 'ar' ? 'استرجاع جزئي' : 'Partial Refund'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {refundType === 'partial' && (
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'مبلغ الاسترجاع (ر.س)' : 'Refund Amount (SAR)'}</Label>
                <Input type="number" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} max={selectedInvoice.total} min="0" step="0.01" />
                <p className="text-xs text-muted-foreground">
                  {language === 'ar' ? `الحد الأقصى: ${selectedInvoice.total} ر.س` : `Max: ${selectedInvoice.total} SAR`}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'سبب الاسترجاع (اختياري)' : 'Refund Reason (optional)'}</Label>
              <Textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder={language === 'ar' ? 'أدخل سبب الاسترجاع...' : 'Enter refund reason...'} />
            </div>
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <p className="text-sm font-semibold text-purple-800">
                {language === 'ar' ? 'مبلغ الاسترجاع:' : 'Refund Amount:'} {refundType === 'full' ? selectedInvoice.total : refundAmount} {t('sar')}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button onClick={onRefund} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
            {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            <RefreshCcw className="w-4 h-4 me-2" />
            {language === 'ar' ? 'تأكيد الاسترجاع' : 'Confirm Refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
