/**
 * Registration Form List Component
 * Displays list of registration forms with actions
 */
import React from 'react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Eye, Printer, QrCode, Trash2 } from 'lucide-react';

const RegistrationFormList = ({
  forms,
  onView,
  onPrintCard,
  onDelete,
  language = 'ar',
  isAdmin = false
}) => {
  if (forms.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        {language === 'ar' ? 'لا توجد استمارات تسجيل' : 'No registration forms found'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full" dir="rtl">
        <thead className="bg-purple-50">
          <tr>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
              {language === 'ar' ? 'رقم العضوية' : 'Member #'}
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
              {language === 'ar' ? 'الاسم' : 'Name'}
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
              {language === 'ar' ? 'الجوال' : 'Phone'}
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
              {language === 'ar' ? 'الأنشطة' : 'Activities'}
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
          {forms.map((form) => (
            <tr key={form.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3">
                <span className="font-mono font-medium text-purple-600">
                  #{form.member_code || form.form_number || '-'}
                </span>
              </td>
              <td className="px-4 py-3">
                <div>
                  <p className="font-medium">{form.name_ar || '-'}</p>
                  {form.guardian_name_ar && (
                    <p className="text-sm text-gray-500">
                      {language === 'ar' ? 'ولي الأمر' : 'Guardian'}: {form.guardian_name_ar}
                    </p>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <span className="text-sm">{form.phone || '-'}</span>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {form.activities?.slice(0, 2).map((act, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {act.activity_name}
                    </Badge>
                  ))}
                  {form.activities?.length > 2 && (
                    <Badge variant="outline" className="text-xs">
                      +{form.activities.length - 2}
                    </Badge>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <span className="text-sm text-gray-600">
                  {form.created_at ? new Date(form.created_at).toLocaleDateString('ar-SA') : '-'}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-center gap-1">
                  {/* View */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onView(form)}
                    title={language === 'ar' ? 'عرض' : 'View'}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>

                  {/* Print Card */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onPrintCard(form)}
                    title={language === 'ar' ? 'طباعة البطاقة' : 'Print Card'}
                    className="text-purple-600"
                  >
                    <QrCode className="w-4 h-4" />
                  </Button>

                  {/* Delete - Admins only */}
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(form)}
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

export default RegistrationFormList;
