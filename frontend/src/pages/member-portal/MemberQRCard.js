import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { QrCode, Download, Printer, User, Phone, Loader2, CheckCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import MemberLayout, { memberAPI, getMemberData } from './MemberLayout';

const MemberCard = () => {
  const [loading, setLoading] = useState(true);
  const [cardData, setCardData] = useState(null);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const member = getMemberData();

  useEffect(() => {
    fetchCardData();
  }, []);

  const fetchCardData = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/qr-card');
      setCardData(res.data);
    } catch (error) {
      console.error('Failed to fetch card data');
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
    // QR data is just the member code number
    const qrData = cardData?.member_code?.toString() || '';
    
    // Get first activity dates for display under QR
    const firstActivity = cardData?.active_activities?.[0];
    const startDate = firstActivity?.start_date || '';
    const endDate = firstActivity?.end_date || '';
    
    // Get schedule info
    const schedule = firstActivity?.schedule || '';
    
    const activitiesHtml = cardData?.active_activities?.map(act => `
      <div class="activity-item active">
        <div class="activity-name">✓ ${act.activity_name}</div>
        ${act.schedule ? `<div style="font-size:5.5pt;color:#2563EB;margin-top:0.3mm;">📅 ${act.schedule}</div>` : ''}
        <div class="activity-status">ساري</div>
      </div>
    `).join('') || '';
    
    // Print BOTH card and logo together
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>بطاقة العضوية - ${cardData?.member_code}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
            @page { size: A4; margin: 0mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Tajawal', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
            .screen-only { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
            @media print { .screen-only { display: none !important; } .print-area { display: flex !important; position: absolute; top: 10mm; right: 15mm; gap: 5mm; } }
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
            .logo-card .contact-info { font-size: 7pt; color: #374151; text-align: center; margin-top: 2mm; font-weight: 600; line-height: 1.6; }
            .logo-card .lost-card-notice { font-size: 7pt; color: #DC2626; text-align: center; margin-top: 2mm; font-weight: 700; line-height: 1.5; background: #FEF2F2; padding: 2mm 3mm; border-radius: 2mm; border: 1.5px solid #EF4444; }
            .print-btn { margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #3B82F6, #2563EB); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal', Arial, sans-serif; font-size: 16px; font-weight: bold; }
            .position-labels { display: flex; gap: 15px; justify-content: center; margin-top: 10px; }
            .position-label { padding: 8px 16px; background: #DBEAFE; border-radius: 8px; color: #1E40AF; font-size: 12px; }
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
                    <div class="member-name">${cardData?.name_ar || ''}</div>
                    <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${cardData?.member_code || ''}</span></div>
                    <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${cardData?.phone || '-'}</span></div>
                    ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                  </div>
                </div>
                <div class="card-footer">
                  <div class="terms-title">شروط وأحكام:</div>
                  <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                  <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
                  <div>• في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</div>
                </div>
              </div>
              <!-- Logo Card - Position 2 -->
              <div class="logo-card">
                <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
                <div class="contact-info">📞 0566238384</div>
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
                  <div class="member-name">${cardData?.name_ar || ''}</div>
                  <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${cardData?.member_code || ''}</span></div>
                  <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${cardData?.phone || '-'}</span></div>
                  ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                </div>
              </div>
              <div class="card-footer">
                <div class="terms-title">شروط وأحكام:</div>
                <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
                <div>• في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</div>
              </div>
            </div>
            <!-- Logo Card - Position 2 -->
            <div class="logo-card">
              <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
              <div class="contact-info">📞 0566238384</div>
              <div class="lost-card-notice">⚠️ في حال فقدان كرت العضوية،<br/>يتم إصدار كرت جديد برسوم 10 ر.س</div>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownload = async () => {
    // QR data is just the member code number
    const qrData = cardData?.member_code?.toString() || '';
    
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 450;
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 400, 450);
    
    // Header
    ctx.fillStyle = '#F97316';
    ctx.font = 'bold 18px Tajawal, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏆 شركة اداء الابطال العالمية للرياضة', 200, 35);
    
    // QR Code
    const qrImg = new Image();
    qrImg.crossOrigin = 'anonymous';
    qrImg.onload = () => {
      ctx.drawImage(qrImg, 100, 60, 200, 200);
      
      // Name
      ctx.fillStyle = '#1f2937';
      ctx.font = 'bold 20px Tajawal, sans-serif';
      ctx.fillText(cardData?.name_ar || '', 200, 300);
      
      // Code
      ctx.fillStyle = '#F97316';
      ctx.font = 'bold 24px Tajawal, sans-serif';
      ctx.fillText(`#${cardData?.member_code || ''}`, 200, 340);
      
      // Download
      const link = document.createElement('a');
      link.download = `membership-card-${cardData?.member_code}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
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

  // QR data is just the member code number
  const qrData = cardData?.member_code?.toString() || '';

  return (
    <MemberLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">بطاقة العضوية</h1>

        {/* Print Position Dialog */}
        <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
          <DialogContent className="max-w-lg" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-center text-xl">🖨️ طباعة الملصقات</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-center text-gray-600 mb-2 font-bold">{cardData?.name_ar}</p>
              <p className="text-center text-sm text-orange-600 mb-4 font-bold">#{cardData?.member_code}</p>
              <p className="text-center text-sm text-gray-500 mb-4">سيتم طباعة كرت العضوية + شعار الأكاديمية معاً</p>
              
              {/* Preview Cards */}
              <div className="bg-gray-100 p-4 rounded-lg">
                <div className="flex gap-3 justify-center max-w-[360px] mx-auto">
                  {/* Preview Card 1 - Member Card */}
                  <div className="aspect-[9/6] w-[140px] bg-white border-2 border-blue-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3">
                    <span className="text-3xl">📇</span>
                    <span className="text-sm font-bold text-gray-700">كرت العضوية</span>
                    <span className="text-xs text-blue-500">خانة 1</span>
                  </div>
                  
                  {/* Preview Card 2 - Academy Logo */}
                  <div className="aspect-[9/6] w-[140px] bg-white border-2 border-blue-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3 overflow-hidden">
                    <img 
                      src="/images/academy-logo.png" 
                      alt="شعار الأكاديمية" 
                      className="w-14 h-14 object-contain"
                    />
                    <span className="text-sm font-bold text-gray-700">شعار الأكاديمية</span>
                    <span className="text-xs text-blue-500">خانة 2</span>
                  </div>
                </div>
                <p className="text-center text-xs text-gray-500 mt-3">
                  📐 حجم كل كرت: 9سم × 6سم
                </p>
              </div>
              
              <div className="mt-4 flex justify-center">
                <Button
                  onClick={handleStickerPrint}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-8 py-3 text-lg"
                >
                  <Printer className="w-5 h-5 ml-2" />
                  طباعة الملصقات
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* QR Card */}
        <Card className="max-w-md mx-auto">
          <CardContent className="p-6">
            <div className="text-center space-y-4">
              {/* Card Preview */}
              <div className="bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-6 rounded-xl text-white">
                <p className="text-orange-400 font-bold mb-4">🏆 شركة اداء الابطال العالمية للرياضة</p>
                
                <div className="bg-white p-4 rounded-lg inline-block">
                  <QRCodeSVG
                    value={qrData}
                    size={180}
                    level="H"
                    includeMargin={true}
                  />
                </div>
                
                <p className="text-xl font-bold mt-4">{cardData?.name_ar}</p>
                <p className="text-2xl font-bold text-orange-400">#{cardData?.member_code}</p>
                
                {cardData?.phone && (
                  <p className="text-sm text-gray-300 mt-2" dir="ltr">{cardData.phone}</p>
                )}

                {cardData?.active_activities?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {cardData.active_activities.map((act, idx) => (
                      <div key={idx} className="bg-white/10 rounded-lg p-2 text-sm">
                        <p className="font-bold text-orange-300">{act.activity_name}</p>
                        {act.schedule && (
                          <p className="text-blue-200 text-xs mt-1">📅 {act.schedule}</p>
                        )}
                        <p className="text-gray-300 text-xs mt-1">
                          من {act.start_date || '----'} إلى {act.end_date || '----'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Action Buttons */}
              <div className="flex gap-3 justify-center">
                <Button onClick={handlePrint} className="gap-2">
                  <Printer className="w-4 h-4" />
                  طباعة
                </Button>
                <Button onClick={handleDownload} variant="outline" className="gap-2">
                  <Download className="w-4 h-4" />
                  تحميل
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Member Info */}
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="w-5 h-5 text-blue-600" />
              بيانات العضوية
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">الاسم:</span>
              <span className="font-medium">{cardData?.name_ar}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">رقم العضوية:</span>
              <span className="font-bold text-orange-600">#{cardData?.member_code}</span>
            </div>
            {cardData?.phone && (
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">الجوال:</span>
                <span dir="ltr">{cardData.phone}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Activities */}
        {cardData?.active_activities?.length > 0 && (
          <Card className="max-w-md mx-auto">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                الأنشطة السارية
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {cardData.active_activities.map((act, idx) => (
                  <div key={idx} className="p-3 bg-green-50 rounded-lg">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{act.activity_name}</span>
                      <span className="text-sm text-gray-500">حتى {act.end_date}</span>
                    </div>
                    {act.schedule && (
                      <p className="text-xs text-blue-600 mt-1">📅 {act.schedule}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Instructions */}
        <Card className="max-w-md mx-auto bg-orange-50 border-orange-200">
          <CardContent className="p-4">
            <p className="text-orange-800 text-center">
              📱 امسح هذا الكود عند الدخول لتسجيل الحضور
            </p>
          </CardContent>
        </Card>

        {/* Lost Card Notice */}
        <Card className="max-w-md mx-auto bg-red-50 border-red-200">
          <CardContent className="p-4">
            <p className="text-red-700 text-center font-medium">
              ⚠️ في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم قدرها <span className="font-bold">10 ر.س</span>
            </p>
          </CardContent>
        </Card>
      </div>
    </MemberLayout>
  );
};

export default MemberCard;
