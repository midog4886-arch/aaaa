/**
 * Invoices Table Component
 * جدول الفواتير
 */
import React from 'react';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent } from '../../../components/ui/card';
import { 
  Eye, Printer, CheckCircle, XCircle, RotateCcw, 
  Trash2, Undo, QrCode, Loader2 
} from 'lucide-react';

const InvoicesTable = ({
  invoices,
  language = 'ar',
  t,
  onView,
  onPrint,
  onMarkPaid,
  onCancel,
  onRestore,
  onRefund,
  onPrintCard,
  onDelete,
  payingInvoiceId,
  cancellingInvoiceId,
  isAdmin = false,
}) => {
  const getStatusBadge = (status) => {
    const config = {
      paid: {
        variant: 'default',
        className: 'bg-green-100 text-green-700 border-green-300',
        label: language === 'ar' ? 'مدفوعة' : 'Paid'
      },
      pending: {
        variant: 'outline',
        className: 'bg-amber-100 text-amber-700 border-amber-300',
        label: language === 'ar' ? 'معلقة' : 'Pending'
      },
      cancelled: {
        variant: 'destructive',
        className: 'bg-red-100 text-red-700 border-red-300',
        label: language === 'ar' ? 'ملغاة' : 'Cancelled'
      },
      refunded: {
        variant: 'secondary',
        className: 'bg-purple-100 text-purple-700 border-purple-300',
        label: language === 'ar' ? 'مستردة' : 'Refunded'
      },
      partially_refunded: {
        variant: 'secondary',
        className: 'bg-orange-100 text-orange-700 border-orange-300',
        label: language === 'ar' ? 'مسترد جزئياً' : 'Partially Refunded'
      }
    };
    const { className, label } = config[status] || config.pending;
    return <Badge variant="outline" className={className}>{label}</Badge>;
  };

  const getPaymentMethodLabel = (method) => {
    const methods = {
      cash: language === 'ar' ? 'نقدي' : 'Cash',
      card: language === 'ar' ? 'بطاقة' : 'Card',
      bank_transfer: language === 'ar' ? 'تحويل بنكي' : 'Bank Transfer',
      mada: language === 'ar' ? 'مدى' : 'Mada',
    };
    return methods[method] || method;
  };

  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {language === 'ar' ? 'لا توجد فواتير' : 'No invoices found'}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{language === 'ar' ? 'رقم الفاتورة' : 'Invoice #'}</th>
                <th>{language === 'ar' ? 'العضو' : 'Member'}</th>
                <th>{language === 'ar' ? 'الفرع' : 'Branch'}</th>
                <th>{language === 'ar' ? 'الإجمالي' : 'Total'}</th>
                <th>{language === 'ar' ? 'الحالة' : 'Status'}</th>
                <th>{language === 'ar' ? 'طريقة الدفع' : 'Payment'}</th>
                <th>{t('invoice_date')}</th>
                <th>{language === 'ar' ? 'الإجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(invoice => (
                <tr key={invoice.id}>
                  <td className="font-mono text-sm font-bold text-orange-600">
                    #{invoice.invoice_number}
                  </td>
                  <td>
                    <div>
                      <span className="font-medium">
                        {invoice.customer_name_ar || invoice.member_name || '-'}
                      </span>
                      {invoice.customer_phone && (
                        <span className="block text-sm text-muted-foreground" dir="ltr">
                          {invoice.customer_phone}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-sm">{invoice.branch_name || '-'}</td>
                  <td className="font-bold text-primary">
                    {invoice.total?.toFixed(2)} {t('sar')}
                  </td>
                  <td>{getStatusBadge(invoice.status)}</td>
                  <td className="text-sm">
                    {getPaymentMethodLabel(invoice.payment_method)}
                  </td>
                  <td className="text-sm text-muted-foreground">
                    {new Date(invoice.created_at).toLocaleDateString(
                      language === 'ar' ? 'ar-SA' : 'en-US'
                    )}
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button 
                        className="action-button text-gray-600" 
                        onClick={() => onView(invoice)}
                        title={language === 'ar' ? 'عرض' : 'View'}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        className="action-button text-blue-600" 
                        onClick={() => onPrint(invoice)}
                        title={language === 'ar' ? 'طباعة' : 'Print'}
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      
                      {invoice.status === 'pending' && (
                        <>
                          <button 
                            className="action-button text-green-600" 
                            onClick={() => onMarkPaid(invoice.id)}
                            disabled={payingInvoiceId === invoice.id}
                            title={language === 'ar' ? 'تأكيد الدفع' : 'Mark as Paid'}
                          >
                            {payingInvoiceId === invoice.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <CheckCircle className="w-4 h-4" />
                            )}
                          </button>
                          <button 
                            className="action-button text-red-600" 
                            onClick={() => onCancel(invoice.id)}
                            disabled={cancellingInvoiceId === invoice.id}
                            title={language === 'ar' ? 'إلغاء' : 'Cancel'}
                          >
                            {cancellingInvoiceId === invoice.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <XCircle className="w-4 h-4" />
                            )}
                          </button>
                        </>
                      )}
                      
                      {invoice.status === 'cancelled' && (
                        <button 
                          className="action-button text-orange-600" 
                          onClick={() => onRestore(invoice.id)}
                          title={language === 'ar' ? 'استعادة' : 'Restore'}
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      
                      {invoice.status === 'paid' && (
                        <>
                          <button 
                            className="action-button text-purple-600" 
                            onClick={() => onRefund(invoice)}
                            title={language === 'ar' ? 'استرداد' : 'Refund'}
                          >
                            <Undo className="w-4 h-4" />
                          </button>
                          {invoice.member_id && (
                            <button 
                              className="action-button text-teal-600" 
                              onClick={() => onPrintCard(invoice)}
                              title={language === 'ar' ? 'طباعة كارت العضوية' : 'Print Member Card'}
                            >
                              <QrCode className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                      
                      {isAdmin && (
                        <button 
                          className="action-button text-red-600" 
                          onClick={() => onDelete(invoice.id, invoice.status)}
                          title={language === 'ar' ? 'حذف' : 'Delete'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};

export default InvoicesTable;
