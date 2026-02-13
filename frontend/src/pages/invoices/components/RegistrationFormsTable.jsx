/**
 * Registration Forms Table Component
 * جدول استمارات التسجيل
 */
import React from 'react';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent } from '../../../components/ui/card';
import { Eye, FileText, QrCode, Edit, ArrowRightCircle, Trash2 } from 'lucide-react';

const RegistrationFormsTable = ({
  forms,
  language = 'ar',
  t,
  onView,
  onSavePdf,
  onPrintCard,
  onEdit,
  onConvert,
  onDelete,
}) => {
  const getStatusBadge = (status) => {
    const config = {
      converted: { 
        className: 'bg-green-100 text-green-700 border-green-300',
        label: language === 'ar' ? 'تم تحويلها' : 'Converted'
      },
      cancelled: {
        className: 'bg-red-100 text-red-700 border-red-300',
        label: language === 'ar' ? 'ملغاة' : 'Cancelled'
      },
      pending: {
        className: 'bg-amber-100 text-amber-700 border-amber-300',
        label: language === 'ar' ? 'قيد الانتظار' : 'Pending'
      }
    };
    const { className, label } = config[status] || config.pending;
    return <Badge variant="outline" className={className}>{label}</Badge>;
  };

  if (forms.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {language === 'ar' ? 'لا توجد استمارات تسجيل' : 'No registration forms'}
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
                <th>{language === 'ar' ? 'رقم الاستمارة' : 'Form Number'}</th>
                <th>{language === 'ar' ? 'رقم العضوية' : 'Member ID'}</th>
                <th>{language === 'ar' ? 'العميل' : 'Customer'}</th>
                <th>{t('phone')}</th>
                <th>{language === 'ar' ? 'الإجمالي' : 'Total'}</th>
                <th>{language === 'ar' ? 'الحالة' : 'Status'}</th>
                <th>{t('invoice_date')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {forms.map(form => (
                <tr key={form.id}>
                  <td className="font-mono text-sm font-bold">#{form.form_number}</td>
                  <td className="font-mono text-sm font-bold text-orange-600">
                    {form.member_code ? `#${form.member_code}` : '-'}
                  </td>
                  <td className="font-medium">{form.customer_name}</td>
                  <td dir="ltr" className="text-sm">{form.customer_phone || '-'}</td>
                  <td className="font-bold text-primary">{form.total?.toFixed(2)} {t('sar')}</td>
                  <td>{getStatusBadge(form.status)}</td>
                  <td className="text-sm text-muted-foreground">
                    {new Date(form.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button 
                        className="action-button text-gray-600" 
                        onClick={() => onView(form)}
                        title={language === 'ar' ? 'عرض' : 'View'}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        className="action-button text-teal-600" 
                        onClick={() => onSavePdf(form)}
                        title={language === 'ar' ? 'حفظ PDF' : 'Save PDF'}
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                      <button 
                        className="action-button text-purple-600" 
                        onClick={() => onPrintCard(form)}
                        title={language === 'ar' ? 'طباعة كارت العضوية' : 'Print Member Card'}
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                      {form.status === 'pending' && (
                        <>
                          <button 
                            className="action-button text-orange-600" 
                            onClick={() => onEdit(form)}
                            title={language === 'ar' ? 'تعديل' : 'Edit'}
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button 
                            className="action-button text-blue-600" 
                            onClick={() => onConvert(form.id)}
                            title={language === 'ar' ? 'تحويل إلى فاتورة' : 'Convert to Invoice'}
                          >
                            <ArrowRightCircle className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      <button 
                        className="action-button text-red-600" 
                        onClick={() => onDelete(form.id)}
                        title={language === 'ar' ? 'حذف' : 'Delete'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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

export default RegistrationFormsTable;
