/**
 * Credit Notes Table Component
 * جدول سندات الدائن
 */
import React from 'react';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent } from '../../../components/ui/card';
import { Eye, Printer, FileText } from 'lucide-react';

const CreditNotesTable = ({
  creditNotes,
  language = 'ar',
  t,
  onView,
  onPrint,
}) => {
  if (creditNotes.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {language === 'ar' ? 'لا توجد سندات دائن' : 'No credit notes'}
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
                <th>{language === 'ar' ? 'رقم السند' : 'Credit Note #'}</th>
                <th>{language === 'ar' ? 'رقم الفاتورة' : 'Invoice #'}</th>
                <th>{language === 'ar' ? 'العضو' : 'Member'}</th>
                <th>{language === 'ar' ? 'المبلغ المسترد' : 'Refunded Amount'}</th>
                <th>{language === 'ar' ? 'السبب' : 'Reason'}</th>
                <th>{t('invoice_date')}</th>
                <th>{language === 'ar' ? 'الإجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {creditNotes.map(note => (
                <tr key={note.id}>
                  <td className="font-mono text-sm font-bold text-purple-600">
                    #{note.credit_note_number}
                  </td>
                  <td className="font-mono text-sm font-bold text-orange-600">
                    #{note.invoice_number}
                  </td>
                  <td className="font-medium">
                    {note.member_name_ar || note.member_name || '-'}
                  </td>
                  <td className="font-bold text-red-600">
                    -{note.refund_amount?.toFixed(2)} {t('sar')}
                  </td>
                  <td className="text-sm max-w-[200px] truncate" title={note.reason}>
                    {note.reason || '-'}
                  </td>
                  <td className="text-sm text-muted-foreground">
                    {new Date(note.created_at).toLocaleDateString(
                      language === 'ar' ? 'ar-SA' : 'en-US'
                    )}
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button 
                        className="action-button text-gray-600" 
                        onClick={() => onView(note)}
                        title={language === 'ar' ? 'عرض' : 'View'}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        className="action-button text-blue-600" 
                        onClick={() => onPrint(note)}
                        title={language === 'ar' ? 'طباعة' : 'Print'}
                      >
                        <Printer className="w-4 h-4" />
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

export default CreditNotesTable;
