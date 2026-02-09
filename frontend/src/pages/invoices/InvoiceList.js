/**
 * Invoice List Component
 * Displays list of invoices with filtering and actions
 */
import React from 'react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { 
  Eye, Printer, CheckCircle, XCircle, RotateCcw, 
  Trash2, CreditCard, QrCode 
} from 'lucide-react';
import { getStatusInfo, getPaymentMethodLabel } from './constants';

const InvoiceList = ({
  invoices,
  onView,
  onPrint,
  onPay,
  onCancel,
  onRestore,
  onDelete,
  onRefund,
  onPrintCard,
  language = 'ar',
  isAdmin = false
}) => {
  const getStatusBadge = (status) => {
    const info = getStatusInfo(status, language);
    const colorMap = {
      green: 'bg-green-100 text-green-800',
      yellow: 'bg-yellow-100 text-yellow-800',
      red: 'bg-red-100 text-red-800',
      orange: 'bg-orange-100 text-orange-800',
      gray: 'bg-gray-100 text-gray-800'
    };
    return (
      <Badge className={colorMap[info.color] || colorMap.gray}>
        {info.label}
      </Badge>
    );
  };

  if (invoices.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        {language === 'ar' ? 'لا توجد فواتير' : 'No invoices found'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full" dir="rtl">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
              {language === 'ar' ? 'رقم الفاتورة' : 'Invoice #'}
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
              {language === 'ar' ? 'العضو' : 'Member'}
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
              {language === 'ar' ? 'المبلغ' : 'Amount'}
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
              {language === 'ar' ? 'الحالة' : 'Status'}
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
              {language === 'ar' ? 'طريقة الدفع' : 'Payment'}
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
              {language === 'ar' ? 'التاريخ' : 'Date'}
            </th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">
              {language === 'ar' ? 'الإجراءات' : 'Actions'}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3">
                <span className="font-mono font-medium text-orange-600">
                  #{invoice.invoice_number}
                </span>
              </td>
              <td className="px-4 py-3">
                <div>
                  <p className="font-medium">{invoice.customer_name_ar || invoice.member_name || '-'}</p>
                  <p className="text-sm text-gray-500">{invoice.customer_phone || '-'}</p>
                </div>
              </td>
              <td className="px-4 py-3">
                <span className="font-bold">{invoice.total?.toFixed(2)} ر.س</span>
              </td>
              <td className="px-4 py-3">
                {getStatusBadge(invoice.status)}
              </td>
              <td className="px-4 py-3">
                <span className="text-sm">
                  {getPaymentMethodLabel(invoice.payment_method, language)}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="text-sm text-gray-600">
                  {new Date(invoice.created_at).toLocaleDateString('ar-SA')}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-center gap-1 flex-wrap">
                  {/* View */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onView(invoice)}
                    title={language === 'ar' ? 'عرض' : 'View'}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>

                  {/* Print Invoice */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onPrint(invoice)}
                    title={language === 'ar' ? 'طباعة الفاتورة' : 'Print Invoice'}
                  >
                    <Printer className="w-4 h-4" />
                  </Button>

                  {/* Print Card - Only for paid invoices with member */}
                  {invoice.status === 'paid' && invoice.member_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onPrintCard(invoice)}
                      title={language === 'ar' ? 'طباعة البطاقة' : 'Print Card'}
                      className="text-purple-600"
                    >
                      <QrCode className="w-4 h-4" />
                    </Button>
                  )}

                  {/* Pay - Only for pending invoices */}
                  {invoice.status === 'pending' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onPay(invoice)}
                      title={language === 'ar' ? 'تأكيد الدفع' : 'Confirm Payment'}
                      className="text-green-600"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </Button>
                  )}

                  {/* Cancel - Only for pending invoices */}
                  {invoice.status === 'pending' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onCancel(invoice)}
                      title={language === 'ar' ? 'إلغاء' : 'Cancel'}
                      className="text-red-600"
                    >
                      <XCircle className="w-4 h-4" />
                    </Button>
                  )}

                  {/* Restore - Only for cancelled invoices */}
                  {invoice.status === 'cancelled' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRestore(invoice)}
                      title={language === 'ar' ? 'استعادة' : 'Restore'}
                      className="text-blue-600"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  )}

                  {/* Refund - Only for paid invoices */}
                  {invoice.status === 'paid' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRefund(invoice)}
                      title={language === 'ar' ? 'استرداد' : 'Refund'}
                      className="text-orange-600"
                    >
                      <CreditCard className="w-4 h-4" />
                    </Button>
                  )}

                  {/* Delete - Only for non-paid invoices and admins */}
                  {invoice.status !== 'paid' && isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(invoice)}
                      title={language === 'ar' ? 'حذف' : 'Delete'}
                      className="text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default InvoiceList;
