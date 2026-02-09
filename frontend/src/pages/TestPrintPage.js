import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Printer, RefreshCw, AlertCircle } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL;

const TestPrintPage = () => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`${API_URL}/api/members?limit=6`);
      const membersList = response.data.members || response.data || [];
      setMembers(membersList.slice(0, 6));
    } catch (err) {
      setError('حدث خطأ في جلب بيانات الأعضاء');
      console.error('Error fetching members:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Generate QR data for a member
  const getQRData = (member) => {
    return JSON.stringify({
      type: 'WCPA_MEMBER',
      id: member._id || member.id,
      code: member.member_code,
      name: member.name_ar || member.name
    });
  };

  // Get activities HTML for a member
  const getActivitiesHtml = (member) => {
    if (!member.activities || member.activities.length === 0) return '';
    return member.activities.map(act => `
      <span class="activity ${act.status === 'active' ? 'active' : 'inactive'}">
        ${act.status === 'active' ? '✓' : '✗'} ${act.activity_name || act.name || ''}
      </span>
    `).join('');
  };

  const openPrintWindow = () => {
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    
    // Generate cards HTML
    const cardsHtml = members.map((member, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const qrData = getQRData(member);
      const activitiesHtml = getActivitiesHtml(member);
      
      return `
        <div class="card" style="grid-column: ${col + 1}; grid-row: ${row + 1};">
          <div class="card-header">
            <div class="header-text">
              <h2>أكاديمية أداء الأبطال</h2>
              <p>World Champions Performance Academy</p>
            </div>
            <div class="trophy">🏆</div>
          </div>
          <div class="card-body">
            <div class="info-section">
              <div class="info-label">الاسم</div>
              <div class="member-name">${member.name_ar || member.name || ''}</div>
              
              <div class="info-row">
                <span class="info-label">رقم العضوية:</span>
                <span class="member-code">#${member.member_code || ''}</span>
              </div>
              
              <div class="info-row">
                <span class="info-label">رقم الجوال:</span>
                <span>${member.phone || '-'}</span>
              </div>
              
              ${activitiesHtml ? `
                <div class="activities">
                  <div class="activities-label">الأنشطة</div>
                  ${activitiesHtml}
                </div>
              ` : ''}
            </div>
            <div class="qr-section">
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" />
            </div>
          </div>
          <div class="card-footer">
            امسح الكود عند الدخول لتسجيل الحضور
          </div>
        </div>
      `;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl">
        <head>
          <meta charset="UTF-8">
          <title>طباعة تجريبية - 6 بطاقات</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
            
            @page {
              size: A4;
              margin: 0;
            }
            
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            html, body {
              font-family: 'Tajawal', Arial, sans-serif;
              direction: rtl;
            }
            
            body {
              background: #f3f4f6;
            }
            
            /* Screen Preview */
            .screen-preview {
              padding: 20px;
              text-align: center;
            }
            
            .screen-preview h1 {
              font-size: 24px;
              color: #1f2937;
              margin-bottom: 10px;
            }
            
            .screen-preview .subtitle {
              color: #6b7280;
              margin-bottom: 20px;
            }
            
            .preview-container {
              background: white;
              width: 210mm;
              height: 297mm;
              margin: 0 auto;
              box-shadow: 0 10px 40px rgba(0,0,0,0.15);
              position: relative;
              overflow: hidden;
            }
            
            .cards-grid {
              position: absolute;
              top: 30mm;
              right: 10mm;
              left: 10mm;
              display: grid;
              grid-template-columns: repeat(2, 100mm);
              grid-template-rows: repeat(3, 70mm);
              gap: 0;
            }
            
            .print-btn {
              margin-top: 20px;
              padding: 15px 40px;
              background: linear-gradient(135deg, #F97316, #EA580C);
              color: white;
              border: none;
              border-radius: 12px;
              cursor: pointer;
              font-family: 'Tajawal', Arial, sans-serif;
              font-size: 18px;
              font-weight: bold;
              display: inline-flex;
              align-items: center;
              gap: 8px;
            }
            
            .print-btn:hover {
              background: linear-gradient(135deg, #EA580C, #DC2626);
            }
            
            .info-box {
              margin-top: 15px;
              padding: 12px 20px;
              background: #FEF3C7;
              border-radius: 8px;
              color: #92400E;
              font-size: 14px;
              display: inline-block;
            }
            
            /* Card Styles */
            .card {
              width: 100mm;
              height: 70mm;
              background: white;
              border-radius: 4mm;
              overflow: hidden;
              box-shadow: 0 2px 8px rgba(0,0,0,0.08);
              border: 1px solid #e5e7eb;
            }
            
            .card-header {
              background: linear-gradient(135deg, #F97316, #F59E0B);
              padding: 3mm;
              display: flex;
              justify-content: space-between;
              align-items: center;
              color: white;
            }
            
            .header-text h2 {
              font-size: 10pt;
              font-weight: 700;
              margin: 0;
            }
            
            .header-text p {
              font-size: 6pt;
              opacity: 0.9;
              margin: 0;
            }
            
            .trophy {
              font-size: 18pt;
            }
            
            .card-body {
              padding: 3mm;
              display: flex;
              gap: 3mm;
              height: calc(70mm - 15mm - 8mm);
            }
            
            .info-section {
              flex: 1;
              text-align: right;
              overflow: hidden;
            }
            
            .qr-section {
              width: 30mm;
              height: 30mm;
              background: white;
              border: 1px solid #eee;
              border-radius: 2mm;
              padding: 1mm;
              flex-shrink: 0;
            }
            
            .qr-section img {
              width: 100%;
              height: 100%;
            }
            
            .member-name {
              font-size: 9pt;
              font-weight: 700;
              color: #1f2937;
              margin-bottom: 1.5mm;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            
            .info-row {
              display: flex;
              align-items: center;
              gap: 1mm;
              margin-bottom: 1mm;
              font-size: 7pt;
            }
            
            .info-label {
              color: #6b7280;
              font-size: 6pt;
            }
            
            .member-code {
              color: #F97316;
              font-weight: 700;
              font-size: 9pt;
            }
            
            .activities {
              margin-top: 1.5mm;
              padding-top: 1.5mm;
              border-top: 1px dashed #e5e7eb;
            }
            
            .activities-label {
              font-size: 5pt;
              color: #6b7280;
              margin-bottom: 0.5mm;
            }
            
            .activity {
              display: inline-block;
              padding: 0.3mm 1.5mm;
              border-radius: 1.5mm;
              font-size: 5pt;
              margin: 0.3mm;
            }
            
            .activity.active {
              background: #D1FAE5;
              color: #065F46;
            }
            
            .activity.inactive {
              background: #FEE2E2;
              color: #991B1B;
            }
            
            .card-footer {
              text-align: center;
              padding: 1.5mm;
              background: #f9fafb;
              font-size: 5pt;
              color: #9ca3af;
              border-top: 1px dashed #e5e7eb;
            }
            
            /* Print Styles */
            @media print {
              .screen-preview > *:not(.preview-container) {
                display: none !important;
              }
              
              body {
                background: white;
              }
              
              .preview-container {
                box-shadow: none;
                width: 210mm;
                height: 297mm;
              }
              
              .cards-grid {
                padding-top: 30mm;
                padding-right: 10mm;
                padding-left: 10mm;
              }
              
              .card {
                box-shadow: none;
                border: 0.5px solid #ccc;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              
              .card-header {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body>
          <div class="screen-preview">
            <h1>🖨️ معاينة طباعة 6 بطاقات</h1>
            <p class="subtitle">صفحة A4 كاملة - 2 أعمدة × 3 صفوف</p>
            
            <div class="preview-container">
              <div class="cards-grid">
                ${cardsHtml}
              </div>
            </div>
            
            <div class="info-box">
              📐 الهوامش: أعلى 3سم | جانبي 1سم | أسفل 2سم<br/>
              📏 حجم البطاقة: 10سم × 7سم
            </div>
            
            <br/>
            <button class="print-btn" onclick="window.print()">
              🖨️ طباعة الصفحة
            </button>
          </div>
        </body>
      </html>
    `);
    
    printWindow.document.close();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">جاري تحميل بيانات الأعضاء...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8" dir="rtl">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">🖨️ طباعة تجريبية - 6 بطاقات</h1>
          <p className="text-gray-600">اختبار تخطيط الطباعة على ورقة ملصقات A4</p>
        </div>

        {error && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <span className="text-red-700">{error}</span>
              <Button onClick={fetchMembers} variant="outline" size="sm" className="mr-auto">
                <RefreshCw className="w-4 h-4 ml-2" />
                إعادة المحاولة
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Info Card */}
        <Card className="mb-6 bg-amber-50 border-amber-200">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 justify-center text-sm">
              <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg">
                <span className="text-gray-500">📐 الهوامش:</span>
                <span className="font-medium">أعلى 3سم | جانبي 1سم | أسفل 2سم</span>
              </div>
              <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg">
                <span className="text-gray-500">📏 حجم البطاقة:</span>
                <span className="font-medium">10سم × 7سم</span>
              </div>
              <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg">
                <span className="text-gray-500">📋 التنسيق:</span>
                <span className="font-medium">2 أعمدة × 3 صفوف</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Members Preview */}
        {members.length > 0 ? (
          <>
            <Card className="mb-6">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-4 text-center">الأعضاء المحددين للطباعة ({members.length}/6)</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {members.map((member, index) => (
                    <div 
                      key={member._id || member.id || index} 
                      className="bg-gray-50 p-3 rounded-lg border text-center"
                    >
                      <div className="text-xs text-gray-400 mb-1">كرت {index + 1}</div>
                      <div className="font-medium text-gray-800 truncate">{member.name_ar || member.name}</div>
                      <div className="text-sm text-orange-600">#{member.member_code}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex gap-4 justify-center">
              <Button 
                onClick={openPrintWindow}
                className="bg-orange-500 hover:bg-orange-600 gap-2 text-lg px-8 py-6"
                data-testid="print-6-cards-btn"
              >
                <Printer className="w-5 h-5" />
                فتح نافذة الطباعة
              </Button>
              <Button 
                onClick={fetchMembers}
                variant="outline"
                className="gap-2"
                data-testid="refresh-members-btn"
              >
                <RefreshCw className="w-4 h-4" />
                تحديث الأعضاء
              </Button>
            </div>
          </>
        ) : (
          <Card className="text-center py-12">
            <CardContent>
              <AlertCircle className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 text-lg">لا يوجد أعضاء في قاعدة البيانات</p>
              <p className="text-gray-400 text-sm mt-2">قم بإضافة أعضاء أولاً لاختبار الطباعة</p>
            </CardContent>
          </Card>
        )}

        {/* Instructions */}
        <Card className="mt-8 bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <h4 className="font-semibold text-blue-800 mb-2">📝 تعليمات الاستخدام:</h4>
            <ol className="list-decimal list-inside text-sm text-blue-700 space-y-1">
              <li>اضغط على زر "فتح نافذة الطباعة" لفتح المعاينة</li>
              <li>تأكد من ظهور 6 بطاقات بتنسيق صحيح (2×3)</li>
              <li>اضغط على زر الطباعة أو Ctrl+P</li>
              <li>اختر الطابعة وتأكد من إعدادات الورق (A4)</li>
              <li>ألصق ورقة الملصقات وابدأ الطباعة</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default TestPrintPage;
