import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { FileText, Download, Eye, Loader2, Receipt, Calendar, Clock, CheckCircle, XCircle, Printer, ClipboardList } from 'lucide-react';
import MemberLayout, { memberAPI, getDarkMode } from './MemberLayout';
import { getPrimaryColor } from '../../services/branding';
import jsPDF from 'jspdf';

const MemberInvoices = () => {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [registrationForms, setRegistrationForms] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [primary, setPrimary] = useState(getPrimaryColor());
  const darkMode = getDarkMode();
  useEffect(() => {
    const onUpdate = () => setPrimary(getPrimaryColor());
    window.addEventListener('branding:updated', onUpdate);
    return () => window.removeEventListener('branding:updated', onUpdate);
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [invoicesRes, formsRes] = await Promise.all([
        memberAPI.get('/api/member-portal/invoices'),
        memberAPI.get('/api/member-portal/registration-forms')
      ]);
      setInvoices(invoicesRes.data.invoices || []);
      setRegistrationForms(formsRes.data.forms || []);
    } catch (error) {
      console.error('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const today = new Date().toISOString().split('T')[0];

  const getItemStatus = (item) => {
    const hasActiveActivity = item.items?.some(i => {
      let endDate = i.end_date || '';
      if (!endDate && i.period) {
        const parts = i.period.split(' - ');
        if (parts.length === 2) endDate = parts[1].trim();
      }
      return endDate && endDate >= today;
    });
    return hasActiveActivity ? 'active' : 'expired';
  };

  const handleViewItem = (item, type) => {
    setSelectedItem({ ...item, type });
    setViewDialogOpen(true);
  };

  const handleDownloadPDF = (item, type) => {
    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.setTextColor(249, 115, 22);
    doc.text('World Champions Performance Academy', 105, 20, { align: 'center' });
    
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text(type === 'form' ? 'Registration Form' : 'Invoice', 105, 30, { align: 'center' });
    
    doc.setFontSize(12);
    doc.text(`#${type === 'form' ? item.form_number : item.invoice_number}`, 105, 40, { align: 'center' });
    doc.text(`Date: ${new Date(item.created_at).toLocaleDateString('en-GB')}`, 105, 48, { align: 'center' });
    
    doc.setFontSize(10);
    doc.text('Customer Information:', 20, 65);
    doc.text(`Name: ${item.customer_name || item.member_name || '-'}`, 25, 73);
    doc.text(`Phone: ${item.customer_phone || '-'}`, 25, 81);
    
    doc.setFillColor(249, 115, 22);
    doc.rect(20, 95, 170, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.text('Activity', 25, 102);
    doc.text('Schedule', 70, 102);
    doc.text('Period', 110, 102);
    doc.text('Amount', 165, 102);
    
    doc.setTextColor(0, 0, 0);
    let y = 115;
    item.items?.forEach((i) => {
      const schedule = i.schedule || '-';
      const startDate = i.start_date || '';
      const endDate = i.end_date || '';
      const period = startDate && endDate ? `${startDate} - ${endDate}` : (i.period || '-');
      
      doc.text(i.activity_name || i.description || 'Item', 25, y);
      doc.text(schedule.substring(0, 25), 70, y);
      doc.text(period.substring(0, 25), 110, y);
      doc.text(`${i.fee || i.price || 0} SAR`, 165, y);
      y += 10;
    });
    
    y += 10;
    doc.line(20, y, 190, y);
    y += 10;
    doc.text(`Subtotal: ${item.subtotal || 0} SAR`, 140, y);
    y += 8;
    if (item.discount > 0) {
      doc.text(`Discount: -${item.discount} SAR`, 140, y);
      y += 8;
    }
    doc.text(`VAT (15%): ${item.vat_amount || 0} SAR`, 140, y);
    y += 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(249, 115, 22);
    doc.text(`Total: ${item.total || 0} SAR`, 140, y);
    
    y += 20;
    doc.setFillColor(254, 243, 199);
    doc.rect(20, y, 170, 35, 'F');
    doc.setDrawColor(245, 158, 11);
    doc.rect(20, y, 170, 35, 'S');
    
    y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text('Terms & Conditions:', 25, y);
    
    y += 8;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 53, 15);
    doc.text('- Session count does not mean subscription is active after end date.', 25, y);
    y += 6;
    doc.text('- Only start and end dates shown in this document are valid.', 25, y);
    y += 6;
    doc.text('- No claims for sessions after subscription period ends.', 25, y);
    
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(128, 128, 128);
    doc.text('Thank you for choosing World Champions Performance Academy!', 105, 280, { align: 'center' });
    doc.text('Phone: +966 56 623 8384', 105, 286, { align: 'center' });
    
    const fileName = type === 'form' ? `registration-${item.form_number}.pdf` : `invoice-${item.invoice_number}.pdf`;
    doc.save(fileName);
  };

  const handlePrintForm = (form) => {
    const itemsRows = form.items?.map(item => {
      let endDate = item.end_date || '';
      let startDate = item.start_date || '';
      if (!endDate && item.period) {
        const parts = item.period.split(' - ');
        if (parts.length === 2) {
          startDate = parts[0].trim();
          endDate = parts[1].trim();
        }
      }
      const isActive = endDate && endDate >= today;
      
      return `
        <tr>
          <td style="padding: 12px; border: 1px solid #ddd;">${item.activity_name || '-'}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center; background: ${isActive ? '#dcfce7' : '#fee2e2'}; color: ${isActive ? '#166534' : '#991b1b'}; font-weight: bold;">
            ${isActive ? '✓ ساري' : '✗ منتهي'}
          </td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center; background: #fff7ed; color: #c2410c; font-weight: bold;">${item.schedule || '-'}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">${startDate || '-'}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">${endDate || '-'}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">${item.fee || 0} ر.س</td>
        </tr>
      `;
    }).join('') || '';

    const printWindow = window.open('', '_blank', 'width=900,height=900');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl">
        <head>
          <meta charset="UTF-8">
          <title>استمارة تسجيل - ${form.form_number}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Tajawal', Arial, sans-serif; padding: 20px; background: white; }
            .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid #F97316; }
            .logo { font-size: 24px; font-weight: bold; color: #F97316; }
            .form-number { font-size: 18px; color: #666; margin-top: 10px; }
            .section { margin-bottom: 25px; }
            .section-title { font-size: 16px; font-weight: bold; color: #1f2937; margin-bottom: 12px; padding: 10px; background: #f3f4f6; border-radius: 8px; border-right: 4px solid #F97316; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
            .info-item { padding: 12px; background: #fafafa; border-radius: 8px; }
            .info-label { font-size: 12px; color: #666; margin-bottom: 4px; }
            .info-value { font-size: 14px; font-weight: bold; color: #1f2937; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th { padding: 12px; background: #F97316; color: white; text-align: center; font-weight: bold; }
            .totals { margin-top: 25px; background: #f9fafb; padding: 20px; border-radius: 10px; }
            .total-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
            .grand-total { font-size: 20px; font-weight: bold; color: #F97316; padding-top: 12px; border-top: 2px solid #F97316; margin-top: 10px; }
            .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #999; }
            @media print { body { padding: 0; } .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">🏆 شركة اداء الابطال العالمية للرياضة</div>
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
            <div class="section-title">📋 الأنشطة المسجلة وجدول التدريب</div>
            <table>
              <thead>
                <tr>
                  <th>النشاط</th>
                  <th>الحالة</th>
                  <th>جدول التدريب</th>
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

          <div style="margin-top: 25px; padding: 15px; background: #fef3c7; border: 2px solid #f59e0b; border-radius: 10px;">
            <div style="font-weight: bold; color: #92400e; margin-bottom: 10px; font-size: 14px;">⚠️ شروط وأحكام:</div>
            <ul style="font-size: 12px; color: #78350f; padding-right: 20px; line-height: 1.8;">
              <li>عرض عدد الحصص لا يعني أن الاشتراك ما زال فعّالًا بعد تاريخ الانتهاء.</li>
              <li><strong>يُعتد فقط بتاريخ بداية ونهاية الاشتراك</strong> الموضّح في هذه الاستمارة/الفاتورة.</li>
              <li>لا يحق للمشترك المطالبة بالحصص بعد انتهاء فترة الاشتراك.</li>
              <li>في حال الرغبة بالتجديد، يرجى التواصل مع إدارة الأكاديمية قبل انتهاء الاشتراك.</li>
            </ul>
          </div>

          <div class="footer">
            <p>شكراً لاختياركم شركة اداء الابطال العالمية للرياضة</p>
            <p style="margin-top: 5px;">📞 +966 56 623 8384</p>
          </div>

          <div class="no-print" style="text-align: center; margin-top: 30px;">
            <button onclick="window.print()" style="padding: 12px 30px; background: #F97316; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; margin-left: 10px;">
              🖨️ طباعة
            </button>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const getStatusBadge = (status) => {
    if (status === 'active') {
      return <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold flex items-center gap-1"><CheckCircle className="w-3 h-3" /> ساري</span>;
    }
    return <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold flex items-center gap-1"><XCircle className="w-3 h-3" /> منتهي</span>;
  };

  const getPaymentStatusBadge = (status) => {
    const styles = {
      paid: 'bg-green-100 text-green-700',
      partial: 'bg-orange-100 text-orange-700',
      pending: 'bg-yellow-100 text-yellow-700',
      cancelled: 'bg-red-100 text-red-700'
    };
    const labels = {
      paid: 'مدفوعة',
      partial: 'جزئي',
      pending: 'معلقة',
      cancelled: 'ملغية'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-700'}`}>
        {labels[status] || status}
      </span>
    );
  };

  const allItems = [
    ...registrationForms.map(f => ({ ...f, type: 'form', number: f.form_number })),
    ...invoices.map(i => ({ ...i, type: 'invoice', number: i.invoice_number }))
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const filteredItems = activeTab === 'all' ? allItems :
    activeTab === 'forms' ? allItems.filter(i => i.type === 'form') :
    allItems.filter(i => i.type === 'invoice');

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
        <h1 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>فواتيري واستماراتي</h1>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className={`cursor-pointer hover:shadow-md ${darkMode ? 'bg-orange-900/20 border-orange-700' : 'bg-orange-50 border-orange-200'}`} onClick={() => setActiveTab('forms')}>
            <CardContent className="p-4 text-center">
              <ClipboardList className="w-8 h-8 text-orange-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-orange-700">{registrationForms.length}</p>
              <p className="text-sm text-orange-600">استمارة تسجيل</p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer hover:shadow-md ${darkMode ? 'bg-purple-900/20 border-purple-700' : 'bg-purple-50 border-purple-200'}`} onClick={() => setActiveTab('invoices')}>
            <CardContent className="p-4 text-center">
              <Receipt className="w-8 h-8 text-purple-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-purple-700">{invoices.length}</p>
              <p className="text-sm text-purple-600">فاتورة</p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer hover:shadow-md ${darkMode ? 'bg-blue-900/20 border-blue-700' : 'bg-blue-50 border-blue-200'}`} onClick={() => setActiveTab('all')}>
            <CardContent className="p-4 text-center">
              <FileText className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-blue-700">{allItems.length}</p>
              <p className="text-sm text-blue-600">الكل</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <Button variant={activeTab === 'all' ? 'default' : 'outline'} onClick={() => setActiveTab('all')} size="sm">
            الكل ({allItems.length})
          </Button>
          <Button variant={activeTab === 'forms' ? 'default' : 'outline'} onClick={() => setActiveTab('forms')} size="sm" className="gap-1">
            <ClipboardList className="w-4 h-4" /> الاستمارات ({registrationForms.length})
          </Button>
          <Button variant={activeTab === 'invoices' ? 'default' : 'outline'} onClick={() => setActiveTab('invoices')} size="sm" className="gap-1">
            <Receipt className="w-4 h-4" /> الفواتير ({invoices.length})
          </Button>
        </div>

        {/* Items List */}
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
          <CardHeader>
            <CardTitle className={`text-lg flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
              <FileText className="w-5 h-5 text-blue-600" />
              {activeTab === 'all' ? 'جميع المستندات' : activeTab === 'forms' ? 'استمارات التسجيل' : 'الفواتير'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredItems.length > 0 ? (
              <div className="space-y-4">
                {filteredItems.map((item, idx) => {
                  const itemStatus = getItemStatus(item);
                  const isForm = item.type === 'form';
                  
                  return (
                    <div 
                      key={idx} 
                      className={`p-4 rounded-lg border-2 ${
                        darkMode
                          ? isForm
                            ? 'bg-orange-900/10 border-orange-700'
                            : 'bg-purple-900/10 border-purple-700'
                          : isForm 
                            ? 'bg-gradient-to-l from-orange-50 to-white border-orange-200' 
                            : 'bg-gradient-to-l from-purple-50 to-white border-purple-200'
                      }`}
                    >
                      <div className="flex items-start justify-between flex-wrap gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isForm ? (
                              <ClipboardList className="w-5 h-5 text-orange-600" />
                            ) : (
                              <Receipt className="w-5 h-5 text-purple-600" />
                            )}
                            <span className={`font-bold text-lg ${darkMode ? 'text-white' : ''}`}>{item.number}</span>
                            {getStatusBadge(itemStatus)}
                            {!isForm && getPaymentStatusBadge(item.status)}
                            <span className={`text-xs px-2 py-0.5 rounded ${isForm ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'}`}>
                              {isForm ? 'استمارة' : 'فاتورة'}
                            </span>
                            {item._owner_name && (
                              <span className={`text-xs ps-0.5 pe-2 py-0.5 rounded-full font-bold inline-flex items-center gap-1 ${darkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                                {item._owner_photo ? (
                                  <img
                                    src={item._owner_photo}
                                    alt={item._owner_name}
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                      if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'inline';
                                    }}
                                    className="w-4 h-4 rounded-full object-cover"
                                  />
                                ) : null}
                                <span aria-hidden style={{ display: item._owner_photo ? 'none' : 'inline' }}>👤</span>
                                {item._owner_name}
                              </span>
                            )}
                          </div>
                          
                          <p className={`text-sm mt-1 flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            <Calendar className="w-4 h-4" />
                            {new Date(item.created_at).toLocaleDateString('ar-SA')}
                          </p>
                          
                          {/* Activities with Schedule */}
                          <div className="mt-3 space-y-2">
                            {item.items?.map((activity, i) => {
                              let endDate = activity.end_date || '';
                              if (!endDate && activity.period) {
                                const parts = activity.period.split(' - ');
                                if (parts.length === 2) endDate = parts[1].trim();
                              }
                              const isActive = endDate && endDate >= today;
                              
                              return (
                                <div key={i} className={`p-2 rounded-lg ${
                                  darkMode
                                    ? isActive ? 'bg-green-900/20 border border-green-700' : 'bg-red-900/20 border border-red-700'
                                    : isActive ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                                }`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      {isActive ? (
                                        <CheckCircle className="w-4 h-4 text-green-600" />
                                      ) : (
                                        <XCircle className="w-4 h-4 text-red-500" />
                                      )}
                                      <span className={`font-medium ${darkMode ? 'text-gray-200' : ''}`}>{activity.activity_name}</span>
                                    </div>
                                    <span className={`text-xs ${isActive ? 'text-green-600' : 'text-red-600'}`}>
                                      {isActive ? 'ساري' : 'منتهي'}
                                    </span>
                                  </div>
                                  {activity.schedule && (
                                    <p className="text-sm text-orange-600 mt-1 flex items-center gap-1 mr-6">
                                      <Clock className="w-4 h-4" />
                                      <strong>{activity.schedule}</strong>
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        
                        <div className="text-left">
                          <p className={`text-2xl font-bold ${isForm ? 'text-orange-600' : 'text-purple-600'}`}>
                            {item.total} <span className="text-sm">ر.س</span>
                          </p>
                          <div className="flex gap-2 mt-2">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleViewItem(item, item.type)}
                              className={`gap-1 ${darkMode ? 'border-gray-600 text-gray-200 hover:bg-gray-700' : ''}`}
                            >
                              <Eye className="w-4 h-4" />
                              عرض
                            </Button>
                            {isForm ? (
                              <Button 
                                size="sm" 
                                onClick={() => handlePrintForm(item)}
                                className={`gap-1 text-white ${primary ? 'hover:opacity-90' : 'bg-orange-600 hover:bg-orange-700'}`}
                                style={primary ? { backgroundColor: primary } : undefined}
                              >
                                <Printer className="w-4 h-4" />
                                طباعة
                              </Button>
                            ) : (
                              <Button 
                                size="sm" 
                                onClick={() => handleDownloadPDF(item, 'invoice')}
                                className="gap-1 bg-purple-600 hover:bg-purple-700"
                              >
                                <Download className="w-4 h-4" />
                                PDF
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={`text-center py-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد مستندات</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className={`max-w-lg max-h-[90vh] overflow-y-auto ${darkMode ? 'bg-gray-800 border-gray-700' : ''}`} dir="rtl">
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
              {selectedItem?.type === 'form' ? (
                <><ClipboardList className="w-5 h-5 text-orange-600" /> استمارة {selectedItem?.form_number}</>
              ) : (
                <><Receipt className="w-5 h-5 text-purple-600" /> فاتورة {selectedItem?.invoice_number}</>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {selectedItem && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>التاريخ:</span>
                <span className={darkMode ? 'text-gray-200' : ''}>{new Date(selectedItem.created_at).toLocaleDateString('ar-SA')}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>حالة الاشتراك:</span>
                {getStatusBadge(getItemStatus(selectedItem))}
              </div>
              
              <div className="border-t pt-4 border-gray-700">
                <p className={`font-medium mb-3 ${darkMode ? 'text-gray-200' : ''}`}>الأنشطة وجدول التدريب:</p>
                {selectedItem.items?.map((item, idx) => {
                  let endDate = item.end_date || '';
                  let startDate = item.start_date || '';
                  if (!endDate && item.period) {
                    const parts = item.period.split(' - ');
                    if (parts.length === 2) {
                      startDate = parts[0].trim();
                      endDate = parts[1].trim();
                    }
                  }
                  const isActive = endDate && endDate >= today;
                  
                  return (
                    <div key={idx} className={`p-3 rounded-lg mb-2 ${
                      darkMode
                        ? isActive ? 'bg-green-900/20 border border-green-700' : 'bg-red-900/20 border border-red-700'
                        : isActive ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                    }`}>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          {isActive ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-red-500" />}
                          <span className={`font-bold ${darkMode ? 'text-gray-200' : ''}`}>{item.activity_name || item.description}</span>
                        </div>
                        <span className={`font-bold ${darkMode ? 'text-gray-200' : ''}`}>{item.fee || item.price} ر.س</span>
                      </div>
                      {item.schedule && (
                        <div className={`mt-2 p-2 rounded border ${darkMode ? 'bg-orange-900/20 border-orange-700' : 'bg-orange-50 border-orange-200'}`}>
                          <p className="text-orange-600 font-bold flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {item.schedule}
                          </p>
                        </div>
                      )}
                      <p className={`text-xs mt-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        من: {startDate || '-'} | إلى: {endDate || '-'}
                      </p>
                      <p className={`text-xs mt-1 font-bold ${isActive ? 'text-green-600' : 'text-red-600'}`}>
                        {isActive ? '✓ اشتراك ساري' : '✗ اشتراك منتهي'}
                      </p>
                    </div>
                  );
                })}
              </div>
              
              <div className={`p-4 rounded-lg space-y-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                <div className={`flex justify-between ${darkMode ? 'text-gray-200' : ''}`}>
                  <span>المجموع الفرعي:</span>
                  <span>{selectedItem.subtotal} ر.س</span>
                </div>
                {selectedItem.discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>الخصم:</span>
                    <span>-{selectedItem.discount} ر.س</span>
                  </div>
                )}
                <div className={`flex justify-between ${darkMode ? 'text-gray-200' : ''}`}>
                  <span>الضريبة (15%):</span>
                  <span>{selectedItem.vat_amount} ر.س</span>
                </div>
                <div className={`flex justify-between font-bold text-lg pt-2 border-t ${darkMode ? 'border-gray-600' : ''} ${selectedItem.type === 'form' ? 'text-orange-600' : 'text-purple-600'}`}>
                  <span>الإجمالي:</span>
                  <span>{selectedItem.total} ر.س</span>
                </div>
              </div>
              
              {/* Terms and Conditions */}
              <div className={`border-2 rounded-lg p-4 ${darkMode ? 'bg-amber-900/20 border-amber-700' : 'bg-amber-50 border-amber-400'}`}>
                <p className={`font-bold mb-2 flex items-center gap-1 ${darkMode ? 'text-amber-400' : 'text-amber-800'}`}>
                  <span>⚠️</span> شروط وأحكام:
                </p>
                <ul className={`text-sm space-y-1 list-disc list-inside ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>
                  <li>عرض عدد الحصص لا يعني أن الاشتراك ما زال فعّالًا بعد تاريخ الانتهاء.</li>
                  <li><strong>يُعتد فقط بتاريخ بداية ونهاية الاشتراك</strong> الموضّح في هذه الاستمارة/الفاتورة.</li>
                  <li>لا يحق للمشترك المطالبة بالحصص بعد انتهاء فترة الاشتراك.</li>
                </ul>
              </div>
              
              <div className="flex gap-2">
                {selectedItem.type === 'form' ? (
                  <Button 
                    className={`flex-1 gap-2 text-white ${primary ? 'hover:opacity-90' : 'bg-orange-600 hover:bg-orange-700'}`}
                    style={primary ? { backgroundColor: primary } : undefined}
                    onClick={() => handlePrintForm(selectedItem)}
                  >
                    <Printer className="w-4 h-4" />
                    طباعة الاستمارة
                  </Button>
                ) : (
                  <Button 
                    className="flex-1 gap-2 bg-purple-600 hover:bg-purple-700"
                    onClick={() => handleDownloadPDF(selectedItem, 'invoice')}
                  >
                    <Download className="w-4 h-4" />
                    تحميل PDF
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MemberLayout>
  );
};

export default MemberInvoices;
