/**
 * Refund Dialog Component
 * نافذة الاسترداد
 */
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Undo, Loader2 } from 'lucide-react';

const RefundDialog = ({
  isOpen,
  onClose,
  invoice,
  refundType,
  onRefundTypeChange,
  refundAmount,
  onRefundAmountChange,
  refundReason,
  onRefundReasonChange,
  onRefund,
  saving = false,
  language = 'ar',
  t
}) => {
  if (!invoice) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-purple-600">
            <Undo className="w-5 h-5" />
            {language === 'ar' ? 'استرداد الفاتورة' : 'Refund Invoice'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Invoice Info */}
          <div className="p-3 bg-gray-50 rounded-lg space-y-1">
            <p className="text-sm">
              <span className="text-muted-foreground">{language === 'ar' ? 'رقم الفاتورة:' : 'Invoice #:'}</span>
              <span className="font-mono font-bold text-orange-600 mx-2">#{invoice.invoice_number}</span>
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">{language === 'ar' ? 'العميل:' : 'Customer:'}</span>
              <span className="font-medium mx-2">{invoice.customer_name_ar || invoice.member_name}</span>
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">{language === 'ar' ? 'المبلغ:' : 'Amount:'}</span>
              <span className="font-bold text-primary mx-2">{invoice.total?.toFixed(2)} {t?.('sar') || 'SAR'}</span>
            </p>
          </div>

          {/* Refund Type */}
          <div className="space-y-2">
            <Label>{language === 'ar' ? 'نوع الاسترداد' : 'Refund Type'}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={refundType === 'full' ? 'default' : 'outline'}
                onClick={() => {
                  onRefundTypeChange('full');
                  onRefundAmountChange(invoice.total);
                }}
                className="flex-1"
              >
                {language === 'ar' ? 'كامل' : 'Full'}
              </Button>
              <Button
                type="button"
                variant={refundType === 'partial' ? 'default' : 'outline'}
                onClick={() => onRefundTypeChange('partial')}
                className="flex-1"
              >
                {language === 'ar' ? 'جزئي' : 'Partial'}
              </Button>
            </div>
          </div>

          {/* Refund Amount */}
          <div className="space-y-2">
            <Label>{language === 'ar' ? 'مبلغ الاسترداد' : 'Refund Amount'}</Label>
            <Input
              type="number"
              value={refundAmount}
              onChange={(e) => onRefundAmountChange(parseFloat(e.target.value) || 0)}
              max={invoice.total}
              disabled={refundType === 'full'}
              dir="ltr"
            />
            {refundType === 'partial' && (
              <p className="text-xs text-muted-foreground">
                {language === 'ar' 
                  ? `الحد الأقصى: ${invoice.total?.toFixed(2)} ر.س`
                  : `Maximum: ${invoice.total?.toFixed(2)} SAR`}
              </p>
            )}
          </div>

          {/* Refund Reason */}
          <div className="space-y-2">
            <Label>{language === 'ar' ? 'سبب الاسترداد' : 'Refund Reason'}</Label>
            <Textarea
              value={refundReason}
              onChange={(e) => onRefundReasonChange(e.target.value)}
              placeholder={language === 'ar' ? 'اختياري...' : 'Optional...'}
              rows={2}
            />
          </div>

          {/* Warning */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-700">
              ⚠️ {language === 'ar' 
                ? 'سيتم إنشاء إشعار دائن (Credit Note) بقيمة الاسترداد'
                : 'A Credit Note will be created for the refund amount'}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onClose(false)}
            disabled={saving}
          >
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button
            onClick={onRefund}
            disabled={saving || refundAmount <= 0 || refundAmount > invoice.total}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 me-2 animate-spin" />{language === 'ar' ? 'جاري المعالجة...' : 'Processing...'}</>
            ) : (
              <><Undo className="w-4 h-4 me-2" />{language === 'ar' ? 'تأكيد الاسترداد' : 'Confirm Refund'}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RefundDialog;
