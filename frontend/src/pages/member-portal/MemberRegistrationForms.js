import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { FileText, Eye, Loader2, Calendar, Clock, User, Phone, CreditCard, Printer } from 'lucide-react';
import MemberLayout, { memberAPI } from './MemberLayout';

const MemberRegistrationForms = () => {
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState([]);
  const [selectedForm, setSelectedForm] = useState(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);

  useEffect(() => {
    fetchForms();
  }, []);

  const fetchForms = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/registration-forms');
      setForms(res.data.forms);
    } catch (error) {
      console.error('Failed to fetch forms');
    } finally {
      setLoading(false);
    }
  };

  const handleViewForm = (form) => {
    setSelectedForm(form);
    setViewDialogOpen(true);
  };

  const handlePrintForm = (form) => {
    const printWindow = window.open('', '_blank', 'width=800,height=900');
    
    const itemsRows = form.items?.map(item => `
      <tr>
        <td style="padding: 10px; border: 1px solid #ddd;">${item.activity_name || '-'}</td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${item.schedule || '-'}</td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${item.start_date || '-'}</td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${item.end_date || '-'}</td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${item.fee || 0} ر.س</td>
      </tr>
    `).join('') || '';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl">
        <head>
          <meta charset="UTF-8">
          <title>استمارة تسجيل - ${form.form_number}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Tajawal', Arial, sans-serif; 
              padding: 20px;
              background: white;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
              padding-bottom: 20px;
              border-bottom: 3px solid #F97316;
            }
            .logo { font-size: 24px; font-weight: bold; color: #F97316; }
            .form-number { font-size: 18px; color: #666; margin-top: 10px; }
            .section { margin-bottom: 20px; }
            .section-title { 
              font-size: 16px; 
              font-weight: bold; 
              color: #1f2937;
              margin-bottom: 10px;
              padding: 8px;
              background: #f3f4f6;
              border-radius: 5px;
            }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
            .info-item { padding: 10px; background: #fafafa; border-radius: 5px; }
            .info-label { font-size: 12px; color: #666; margin-bottom: 4px; }
            .info-value { font-size: 14px; font-weight: bold; color: #1f2937; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th { 
              padding: 12px; 
              background: #F97316; 
              color: white; 
              text-align: center;
              font-weight: bold;
            }
            .totals { margin-top: 20px; text-align: left; }
            .total-row { 
              display: flex; 
              justify-content: space-between; 
              padding: 8px 0; 
              border-bottom: 1px solid #eee;
            }
            .grand-total { 
              font-size: 18px; 
              font-weight: bold; 
              color: #F97316;
              padding-top: 10px;
              border-top: 2px solid #F97316;
            }
            .footer {
              margin-top: 30px;
              text-align: center;
              font-size: 12px;
              color: #999;
            }
            @media print {
              body { padding: 0; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">🏆 أكاديمية أداء الأبطال العالمية</div>
            <div class="form-number">استمارة تسجيل رقم: ${form.form_number}</div>
            <div style="font-size: 12px; color: #999; margin-top: 5px;">
              تاريخ: ${new Date(form.created_at).toLocaleDateString('ar-SA')}
            </div>
          </div>

          <div class="section">
            <div class="section-title">👤 بيانات المشترك</div>
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">الاسم</div>
                <div class="info-value">${form.customer_name || '-'}</div>
              </div>
              <div class="info-item">
                <div class="info-label">رقم الجوال</div>
                <div class="info-value" dir="ltr">${form.customer_phone || '-'}</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">📋 الأنشطة المسجلة</div>
            <table>
              <thead>
                <tr>
                  <th>النشاط</th>
                  <th>الجدول</th>
                  <th>من</th>
                  <th>إلى</th>
                  <th>الرسوم</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows}
              </tbody>
            </table>
          </div>

          <div class="totals">
            <div class="total-row">
              <span>المجموع الفرعي:</span>
              <span>${form.subtotal || 0} ر.س</span>
            </div>
            ${form.discount > 0 ? `
            <div class="total-row" style="color: green;">
              <span>الخصم:</span>
              <span>-${form.discount} ر.س</span>
            </div>
            ` : ''}
            <div class="total-row">
              <span>الضريبة (15%):</span>
              <span>${form.vat_amount || 0} ر.س</span>
            </div>
            <div class="total-row grand-total">
              <span>الإجمالي:</span>
              <span>${form.total || 0} ر.س</span>
            </div>
          </div>

          <div class="footer">
            <p>شكراً لاختياركم أكاديمية أداء الأبطال العالمية</p>
            <p style="margin-top: 5px;">📞 +966 56 623 8384</p>
          </div>

          <div class="no-print" style="text-align: center; margin-top: 30px;">
            <button onclick="window.print()" style="padding: 12px 30px; background: #F97316; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer;">
              🖨️ طباعة الاستمارة
            </button>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const getStatusBadge = (status) => {
    if (status === 'converted') {
      return <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">تم التحويل لفاتورة</span>;
    }
    return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs">قيد المعالجة</span>;
  };

  if (loading) {
    return (
      <MemberLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </MemberLayout>
    );
  }

  return (
    <MemberLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">استمارات التسجيل</h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5 text-orange-600" />
              جميع الاستمارات ({forms.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {forms.length > 0 ? (
              <div className="space-y-4">
                {forms.map((form, idx) => (
                  <div key={idx} className="p-4 bg-gradient-to-l from-orange-50 to-white rounded-lg border border-orange-200 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <FileText className="w-5 h-5 text-orange-600" />
                          <span className="font-bold text-lg">{form.form_number}</span>
                          {getStatusBadge(form.status)}
                        </div>
                        <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          {new Date(form.created_at).toLocaleDateString('ar-SA')}
                        </p>
                        <div className="mt-2">
                          {form.items?.slice(0, 2).map((item, i) => (
                            <div key={i} className="text-sm text-gray-600 flex items-center gap-2">
                              <span>• {item.activity_name}</span>
                              {item.schedule && (
                                <span className="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded">
                                  {item.schedule}
                                </span>
                              )}
                            </div>
                          ))}
                          {form.items?.length > 2 && (
                            <span className="text-sm text-gray-400">+{form.items.length - 2} المزيد</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-left">
                        <p className="text-2xl font-bold text-orange-600">{form.total} <span className="text-sm">ر.س</span></p>
                        <div className="flex gap-2 mt-2">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => handleViewForm(form)}
                            className="gap-1"
                          >
                            <Eye className="w-4 h-4" />
                            عرض
                          </Button>
                          <Button 
                            size="sm" 
                            onClick={() => handlePrintForm(form)}
                            className="gap-1 bg-orange-600 hover:bg-orange-700"
                          >
                            <Printer className="w-4 h-4" />
                            طباعة
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد استمارات تسجيل</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Form View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-orange-600" />
              استمارة {selectedForm?.form_number}
            </DialogTitle>
          </DialogHeader>
          
          {selectedForm && (
            <div className="space-y-4">
              {/* Customer Info */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  بيانات المشترك
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">الاسم:</span>
                    <p className="font-medium">{selectedForm.customer_name}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">الجوال:</span>
                    <p className="font-medium" dir="ltr">{selectedForm.customer_phone}</p>
                  </div>
                </div>
              </div>
              
              {/* Activities */}
              <div>
                <h3 className="font-bold text-gray-700 mb-3">📋 الأنشطة</h3>
                {selectedForm.items?.map((item, idx) => (
                  <div key={idx} className="p-3 bg-orange-50 rounded-lg border border-orange-200 mb-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold">{item.activity_name}</p>
                        {item.schedule && (
                          <p className="text-sm text-orange-600 flex items-center gap-1 mt-1">
                            <Clock className="w-4 h-4" />
                            {item.schedule}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">
                          {item.start_date} → {item.end_date}
                        </p>
                      </div>
                      <span className="font-bold text-orange-600">{item.fee} ر.س</span>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Totals */}
              <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span>المجموع الفرعي:</span>
                  <span>{selectedForm.subtotal} ر.س</span>
                </div>
                {selectedForm.discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>الخصم:</span>
                    <span>-{selectedForm.discount} ر.س</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>الضريبة (15%):</span>
                  <span>{selectedForm.vat_amount} ر.س</span>
                </div>
                <div className="flex justify-between font-bold text-lg pt-2 border-t text-orange-600">
                  <span>الإجمالي:</span>
                  <span>{selectedForm.total} ر.س</span>
                </div>
              </div>
              
              <Button 
                className="w-full gap-2 bg-orange-600 hover:bg-orange-700"
                onClick={() => handlePrintForm(selectedForm)}
              >
                <Printer className="w-4 h-4" />
                طباعة الاستمارة
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MemberLayout>
  );
};

export default MemberRegistrationForms;
