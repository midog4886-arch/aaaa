import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { User, CreditCard, Phone, Download, Printer, CheckCircle, XCircle } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL;

const MemberCardPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPrintDialog, setShowPrintDialog] = useState(false);

  const searchMember = async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    setError('');
    setMember(null);
    
    try {
      // Use public API (no auth required)
      const response = await axios.get(`${API_URL}/api/public/member-card/${encodeURIComponent(searchQuery.trim())}`);
      setMember(response.data);
    } catch (err) {
      if (err.response?.status === 404) {
        setError('لم يتم العثور على العضو');
      } else {
        setError('حدث خطأ في البحث');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    setShowPrintDialog(true);
  };

  const handleStickerPrint = () => {
    setShowPrintDialog(false);
    
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    const qrData = getQRData();
    
    // Get first activity dates for display under QR
    const firstActivity = member?.activities?.[0];
    const startDate = firstActivity?.start_date || '';
    const endDate = firstActivity?.end_date || '';
    
    // Get activities list
    const activitiesHtml = member?.activities?.map(act => `
      <div class="activity-item ${act.status === 'active' ? 'active' : 'expired'}">
        <div class="activity-name">${act.status === 'active' ? '✓' : '✗'} ${act.activity_name}</div>
        <div class="activity-status">${act.status === 'active' ? 'ساري' : 'منتهي'}</div>
      </div>
    `).join('') || '';
    
    // Print BOTH card and logo together
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>بطاقة العضوية - ${member?.member_code}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
            @page { size: A4; margin: 0mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Tajawal', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
            .screen-only { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
            @media print { .screen-only { display: none !important; } .print-area { display: flex !important; position: absolute; top: 30mm; right: 15mm; gap: 10mm; } }
            @media screen { .print-area { display: none; } }
            .sticker-preview { display: flex; gap: 15px; justify-content: center; margin-bottom: 20px; }
            .card { width: 90mm; height: 70mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
            .card-header { background: linear-gradient(135deg, #F97316, #F59E0B); padding: 2mm; display: flex; justify-content: space-between; align-items: center; color: white; }
            .header-text h2 { font-size: 9pt; font-weight: 700; margin: 0; }
            .header-text p { font-size: 6pt; opacity: 0.9; margin: 0; }
            .trophy { font-size: 16pt; }
            .card-body { padding: 2mm; display: flex; gap: 2mm; flex: 1; }
            .info-section { flex: 1; text-align: right; overflow: hidden; }
            .qr-container { display: flex; flex-direction: column; align-items: center; }
            .qr-section { width: 26mm; height: 26mm; background: white; border: 1px solid #eee; border-radius: 2mm; padding: 0.5mm; }
            .qr-section img { width: 100%; height: 100%; }
            .qr-dates { text-align: center; font-size: 6pt; color: #1f2937; margin-top: 1mm; line-height: 1.3; font-weight: 600; }
            .qr-dates span { display: block; }
            .member-name { font-size: 10pt; font-weight: 700; color: #1f2937; margin-bottom: 1mm; }
            .info-row { display: flex; align-items: center; gap: 1mm; margin-bottom: 0.8mm; font-size: 7pt; }
            .info-label { color: #6b7280; font-size: 6pt; }
            .member-code { color: #F97316; font-weight: 700; font-size: 10pt; }
            .activities { margin-top: 1mm; padding-top: 1mm; border-top: 1px dashed #e5e7eb; }
            .activities-label { font-size: 6pt; color: #6b7280; margin-bottom: 0.5mm; }
            .activity-item { padding: 1mm 1.5mm; margin-bottom: 0.5mm; border-radius: 1.5mm; font-size: 6pt; }
            .activity-item.active { background: #D1FAE5; border-right: 2px solid #10B981; }
            .activity-item.expired { background: #FEE2E2; border-right: 2px solid #EF4444; }
            .activity-name { font-weight: 600; color: #1f2937; font-size: 7pt; }
            .activity-status { font-size: 6pt; font-weight: 700; }
            .activity-item.active .activity-status { color: #059669; }
            .activity-item.expired .activity-status { color: #DC2626; }
            .card-footer { text-align: right; padding: 1.5mm 2mm; background: #f9fafb; font-size: 5pt; color: #374151; border-top: 1px dashed #e5e7eb; line-height: 1.4; }
            .card-footer .terms-title { font-weight: 700; color: #1f2937; font-size: 6pt; margin-bottom: 0.5mm; }
            .logo-card { width: 90mm; height: 70mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: center; padding: 5mm; }
            .logo-card img { max-width: 100%; max-height: 100%; object-fit: contain; }
            .print-btn { margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #F97316, #EA580C); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal', Arial, sans-serif; font-size: 16px; font-weight: bold; }
            .position-labels { display: flex; gap: 15px; justify-content: center; margin-top: 10px; }
            .position-label { padding: 8px 16px; background: #FEF3C7; border-radius: 8px; color: #92400E; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="screen-only">
            <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة الطباعة - كرت العضوية + شعار الأكاديمية</p>
            <div class="sticker-preview">
              <!-- Member Card - Position 1 -->
              <div class="card">
                <div class="card-header">
                  <div class="header-text"><h2>أكاديمية أداء الأبطال</h2><p>World Champions Performance Academy</p></div>
                  <div class="trophy">🏆</div>
                </div>
                <div class="card-body">
                  <div class="qr-container">
                    <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
                    <div class="qr-dates">
                      <span>من: ${startDate || '----'}</span>
                      <span>إلى: ${endDate || '----'}</span>
                    </div>
                  </div>
                  <div class="info-section">
                    <div class="info-label">الاسم</div>
                    <div class="member-name">${member?.name_ar || member?.name || ''}</div>
                    <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${member?.member_code || ''}</span></div>
                    <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${member?.phone || '-'}</span></div>
                    ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                  </div>
                </div>
                <div class="card-footer">
                  <div class="terms-title">شروط وأحكام:</div>
                  <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                  <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
                </div>
              </div>
              <!-- Logo Card - Position 2 -->
              <div class="logo-card">
                <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
              </div>
            </div>
            <div class="position-labels">
              <div class="position-label">📍 خانة 1: كرت العضوية</div>
              <div class="position-label">📍 خانة 2: شعار الأكاديمية</div>
            </div>
            <p style="margin-top: 10px; color: #6b7280; font-size: 14px;">📐 حجم كل كرت: 9سم × 7سم</p>
            <button class="print-btn" onclick="window.print()">🖨️ طباعة الملصقات</button>
          </div>
          <div class="print-area">
            <!-- Member Card - Position 1 -->
            <div class="card">
              <div class="card-header">
                <div class="header-text"><h2>أكاديمية أداء الأبطال</h2><p>World Champions Performance Academy</p></div>
                <div class="trophy">🏆</div>
              </div>
              <div class="card-body">
                <div class="qr-container">
                  <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
                  <div class="qr-dates">
                    <span>من: ${startDate || '----'}</span>
                    <span>إلى: ${endDate || '----'}</span>
                  </div>
                </div>
                <div class="info-section">
                  <div class="info-label">الاسم</div>
                  <div class="member-name">${member?.name_ar || member?.name || ''}</div>
                  <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${member?.member_code || ''}</span></div>
                  <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${member?.phone || '-'}</span></div>
                  ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                </div>
              </div>
              <div class="card-footer">
                <div class="terms-title">شروط وأحكام:</div>
                <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
              </div>
            </div>
            <!-- Logo Card - Position 2 -->
            <div class="logo-card">
              <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownload = () => {
    const svg = document.getElementById('member-qr-code');
    if (!svg) return;
    
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      const link = document.createElement('a');
      link.download = `member-${member.member_code}-qr.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  // Generate QR data
  const getQRData = () => {
    if (!member) return '';
    return JSON.stringify({
      type: 'WCPA_MEMBER',
      id: member.id,
      code: member.member_code,
      name: member.name_ar || member.name
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">🏆 بطاقة العضوية</h1>
          <p className="text-gray-600">أكاديمية أداء الأبطال العالمية</p>
        </div>

        {/* Search */}
        <Card className="mb-6 shadow-lg">
          <CardContent className="p-6">
            <div className="flex gap-3">
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchMember()}
                placeholder="رقم العضوية أو رقم الجوال أو الاسم"
                className="text-lg"
                dir="auto"
              />
              <Button 
                onClick={searchMember} 
                disabled={loading}
                className="bg-orange-500 hover:bg-orange-600 px-6"
              >
                {loading ? '...' : 'بحث'}
              </Button>
            </div>
            {error && (
              <p className="text-red-500 mt-3 text-center">{error}</p>
            )}
          </CardContent>
        </Card>

        {/* Member Card */}
        {member && (
          <div className="space-y-4">
            {/* Print Position Dialog */}
            <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
              <DialogContent className="max-w-md" dir="rtl">
                <DialogHeader>
                  <DialogTitle className="text-center text-xl">🖨️ اختر موقع الطباعة</DialogTitle>
                </DialogHeader>
                <div className="py-4">
                  <p className="text-center text-gray-600 mb-4">اختر الخانة المطلوبة على ورقة الاستيكر</p>
                  
                  {/* Sticker Sheet Grid - 2 columns x 3 rows */}
                  <div className="bg-gray-100 p-4 rounded-lg">
                    <div className="grid grid-cols-2 gap-2 max-w-[280px] mx-auto">
                      {[0, 1, 2, 3, 4, 5].map((position) => (
                        <button
                          key={position}
                          onClick={() => handleStickerPrint(position)}
                          className="aspect-square bg-white border-2 border-dashed border-gray-300 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition-all flex flex-col items-center justify-center gap-1 p-2"
                        >
                          <span className="text-2xl">📇</span>
                          <span className="text-xs text-gray-500">كرت {position + 1}</span>
                          <span className="text-[10px] text-gray-400">
                            صف {Math.floor(position / 2) + 1} - عمود {(position % 2) + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="text-center text-xs text-gray-500 mt-3">
                      📐 حجم كل كرت: 9سم × 7سم
                    </p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Printable Card */}
            <Card className="shadow-2xl overflow-hidden print:shadow-none" id="member-card">
              <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-4 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">أكاديمية أداء الأبطال</h2>
                    <p className="text-orange-100 text-sm">World Champions Performance Academy</p>
                  </div>
                  <div className="text-4xl">🏆</div>
                </div>
              </div>
              
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-6 items-center">
                  {/* QR Code */}
                  <div className="bg-white p-4 rounded-xl shadow-inner border-2 border-orange-100">
                    <QRCodeSVG
                      id="member-qr-code"
                      value={getQRData()}
                      size={180}
                      level="H"
                      includeMargin={true}
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                  </div>
                  
                  {/* Member Info */}
                  <div className="flex-1 space-y-4 text-right">
                    <div>
                      <p className="text-gray-500 text-sm">الاسم</p>
                      <p className="text-2xl font-bold text-gray-800">{member.name_ar || member.name}</p>
                    </div>
                    
                    <div className="flex items-center gap-3 justify-end">
                      <div>
                        <p className="text-gray-500 text-sm">رقم العضوية</p>
                        <p className="text-xl font-bold text-orange-600">#{member.member_code}</p>
                      </div>
                      <CreditCard className="w-8 h-8 text-orange-400" />
                    </div>
                    
                    <div className="flex items-center gap-3 justify-end">
                      <div>
                        <p className="text-gray-500 text-sm">رقم الجوال</p>
                        <p className="text-lg font-medium text-gray-700" dir="ltr">{member.phone || '-'}</p>
                      </div>
                      <Phone className="w-6 h-6 text-gray-400" />
                    </div>

                    {/* Activities Status */}
                    {member.activities && member.activities.length > 0 && (
                      <div className="pt-3 border-t">
                        <p className="text-gray-500 text-sm mb-2">الأنشطة المسجلة</p>
                        <div className="flex flex-wrap gap-2 justify-end">
                          {member.activities.map((act, idx) => (
                            <span 
                              key={idx}
                              className={`px-3 py-1 rounded-full text-sm ${
                                act.status === 'active' 
                                  ? 'bg-green-100 text-green-700' 
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {act.status === 'active' ? <CheckCircle className="w-4 h-4 inline ml-1" /> : <XCircle className="w-4 h-4 inline ml-1" />}
                              {act.activity_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Footer */}
                <div className="mt-6 pt-4 border-t border-dashed text-center text-gray-400 text-sm">
                  امسح الكود عند الدخول لتسجيل الحضور
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons - Hidden when printing */}
            <div className="flex gap-3 justify-center print:hidden">
              <Button onClick={handlePrint} variant="outline" className="gap-2">
                <Printer className="w-4 h-4" />
                طباعة البطاقة
              </Button>
              <Button onClick={handleDownload} variant="outline" className="gap-2">
                <Download className="w-4 h-4" />
                تحميل QR
              </Button>
            </div>
          </div>
        )}

        {/* Instructions */}
        {!member && !error && (
          <Card className="bg-white/50 border-dashed">
            <CardContent className="p-8 text-center text-gray-500">
              <User className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-lg mb-2">ابحث عن العضو لعرض بطاقته</p>
              <p className="text-sm">يمكنك البحث برقم العضوية أو رقم الجوال أو الاسم</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          @page {
            margin: 0;
            padding: 0;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
          }
          body * {
            visibility: hidden;
          }
          #member-card, #member-card * {
            visibility: visible;
          }
          #member-card {
            position: fixed !important;
            left: 50% !important;
            top: 0 !important;
            transform: translateX(-50%) !important;
            width: 400px !important;
            margin: 10px auto !important;
            padding-top: 10px !important;
          }
        }
      `}</style>
    </div>
  );
};

export default MemberCardPage;
