import React, { useState } from 'react';
import { Layout } from '../components/Layout';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { User, CreditCard, Phone, Download, Printer, CheckCircle, XCircle } from 'lucide-react';
import axios from 'axios';

const API_URL = '';

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
    
    // Get schedule info
    const schedule = firstActivity?.schedule || '';
    
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
            @media print { .screen-only { display: none !important; } .print-area { display: flex !important; position: absolute; top: 10mm; right: 10mm; gap: 5mm; } }
            @media screen { .print-area { display: none; } }
            .sticker-preview { display: flex; gap: 15px; justify-content: center; margin-bottom: 20px; }
            .card { width: 90mm; height: 60mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
            .card-header { background: linear-gradient(135deg, #F97316, #F59E0B); padding: 1.5mm 2mm; display: flex; justify-content: space-between; align-items: center; color: white; }
            .header-text h2 { font-size: 7pt; font-weight: 700; margin: 0; line-height: 1.3; }
            .header-text p { font-size: 5.5pt; opacity: 0.9; margin: 0; }
            .header-logo { width: 10mm; height: 10mm; border-radius: 50%; background: white; padding: 0.5mm; display: flex; align-items: center; justify-content: center; }
            .header-logo img { width: 100%; height: 100%; object-fit: contain; border-radius: 50%; }
            .card-body { padding: 2mm; display: flex; gap: 2mm; flex: 1; }
            .info-section { flex: 1; text-align: right; overflow: hidden; }
            .qr-container { display: flex; flex-direction: column; align-items: center; }
            .qr-section { width: 26mm; height: 26mm; background: white; border: 1px solid #eee; border-radius: 2mm; padding: 0.5mm; }
            .qr-section img { width: 100%; height: 100%; }
            .qr-dates { text-align: center; font-size: 8pt; color: #1f2937; margin-top: 1mm; line-height: 1.4; font-weight: 700; }
            .qr-dates span { display: block; }
            .schedule-info { text-align: center; font-size: 6pt; color: #F97316; margin-top: 1mm; font-weight: 600; background: #FFF7ED; padding: 1mm; border-radius: 2mm; }
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
            .logo-card { width: 90mm; height: 60mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3mm; }
            .logo-card img { max-width: 100%; max-height: 55%; object-fit: contain; }
            .logo-card .lost-card-notice { font-size: 7pt; color: #DC2626; text-align: center; margin-top: 2mm; font-weight: 700; line-height: 1.5; background: #FEF2F2; padding: 2mm 3mm; border-radius: 2mm; border: 1.5px solid #EF4444; }
            .logo-card .contact-info { font-size: 7pt; color: #374151; text-align: center; margin-top: 2mm; font-weight: 600; line-height: 1.6; }
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
                  <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
                  <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
                </div>
                <div class="card-body">
                  <div class="qr-container">
                    <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
                    <div class="qr-dates">
                      <span>من: ${startDate || '----'}</span>
                      <span>إلى: ${endDate || '----'}</span>
                    </div>
                    ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
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
                <div class="contact-info">📞 0546218384</div>
                <div class="lost-card-notice">⚠️ في حال فقدان كرت العضوية،<br/>يتم إصدار كرت جديد برسوم 10 ر.س</div>
              </div>
            </div>
            <div class="position-labels">
              <div class="position-label">📍 خانة 1: كرت العضوية</div>
              <div class="position-label">📍 خانة 2: شعار الأكاديمية</div>
            </div>
            <p style="margin-top: 10px; color: #6b7280; font-size: 14px;">📐 حجم كل كرت: 9سم × 6سم</p>
            <button class="print-btn" onclick="window.print()">🖨️ طباعة الملصقات</button>
          </div>
          <div class="print-area">
            <!-- Member Card - Position 1 -->
            <div class="card">
              <div class="card-header">
                <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
                <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
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
              <div class="contact-info">📞 0546218384</div>
              <div class="lost-card-notice">⚠️ في حال فقدان كرت العضوية،<br/>يتم إصدار كرت جديد برسوم 10 ر.س</div>
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

  // Generate QR data - Just the member code number for easy scanning
  const getQRData = () => {
    if (!member) return '';
    return member.member_code.toString();
  };

  return (
    <Layout>
    <div className="bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8 min-h-[80vh]">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">🏆 بطاقة العضوية</h1>
          <p className="text-gray-600">شركة اداء الابطال العالمية للرياضة العالمية</p>
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
              <DialogContent className="max-w-lg" dir="rtl">
                <DialogHeader>
                  <DialogTitle className="text-center text-xl">🖨️ طباعة الملصقات</DialogTitle>
                </DialogHeader>
                <div className="py-4">
                  <p className="text-center text-gray-600 mb-2 font-bold">{member?.name_ar || member?.name}</p>
                  <p className="text-center text-sm text-orange-600 mb-4 font-bold">#{member?.member_code}</p>
                  <p className="text-center text-sm text-gray-500 mb-4">سيتم طباعة كرت العضوية + شعار الأكاديمية معاً</p>
                  
                  {/* Preview Cards */}
                  <div className="bg-gray-100 p-4 rounded-lg">
                    <div className="flex gap-3 justify-center max-w-[360px] mx-auto">
                      {/* Preview Card 1 - Member Card */}
                      <div className="aspect-[9/6] w-[140px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3">
                        <span className="text-3xl">📇</span>
                        <span className="text-sm font-bold text-gray-700">كرت العضوية</span>
                        <span className="text-xs text-orange-500">خانة 1</span>
                      </div>
                      
                      {/* Preview Card 2 - Academy Logo */}
                      <div className="aspect-[9/6] w-[140px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3 overflow-hidden">
                        <img 
                          src="/images/academy-logo.png" 
                          alt="شعار الأكاديمية" 
                          className="w-14 h-14 object-contain"
                        />
                        <span className="text-sm font-bold text-gray-700">شعار الأكاديمية</span>
                        <span className="text-xs text-orange-500">خانة 2</span>
                      </div>
                    </div>
                    <p className="text-center text-xs text-gray-500 mt-3">
                      📐 حجم كل كرت: 9سم × 6سم
                    </p>
                  </div>
                  
                  <div className="mt-4 flex justify-center">
                    <Button
                      onClick={handleStickerPrint}
                      className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-3 text-lg"
                    >
                      <Printer className="w-5 h-5 ml-2" />
                      طباعة الملصقات
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Printable Card */}
            <Card className="shadow-2xl overflow-hidden print:shadow-none" id="member-card">
              <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-4 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">شركة اداء الابطال العالمية للرياضة</h2>
                    <p className="text-orange-100 text-sm">Global Champions Sports Performance</p>
                  </div>
                  <div className="text-4xl">🏆</div>
                </div>
              </div>
              
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-6 items-center">
                  {/* QR Code with Dates and Schedule */}
                  <div className="flex flex-col items-center">
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
                    {/* Dates under QR */}
                    {member.activities && member.activities[0] && (
                      <div className="mt-3 text-center">
                        <div className="text-lg font-bold text-gray-800">
                          <span>من: {member.activities[0].start_date || '----'}</span>
                          <span className="mx-2">|</span>
                          <span>إلى: {member.activities[0].end_date || '----'}</span>
                        </div>
                        {member.activities[0].schedule && (
                          <div className="mt-2 px-4 py-2 bg-orange-50 rounded-lg text-orange-600 font-semibold">
                            📅 {member.activities[0].schedule}
                          </div>
                        )}
                      </div>
                    )}
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

            <div className="text-center p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 font-semibold text-sm">⚠️ في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</p>
            </div>

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
    </Layout>
  );
};

export default MemberCardPage;
