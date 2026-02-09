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
  const [selectedPosition, setSelectedPosition] = useState(null);
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

  const handleStickerPrint = (position) => {
    setSelectedPosition(position);
    setShowPrintDialog(false);
    
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    const qrData = JSON.stringify(cardData?.qr_data || {});
    
    // Calculate position offsets (2 columns x 3 rows, each card 10cm width x 7cm height)
    // Top margin: 30mm, Bottom margin: 20mm
    const col = position % 2; // 0 or 1
    const row = Math.floor(position / 2); // 0, 1, or 2
    const leftOffset = col * 100; // mm (card width 100mm)
    const topOffset = 30 + (row * 70); // mm (30mm top margin + 70mm per row)
    
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
            html, body { margin: 0; padding: 0; }
            body { 
              font-family: 'Tajawal', Arial, sans-serif; 
              background: #f3f4f6;
              direction: rtl;
            }
            .screen-only {
              padding: 20px;
              text-align: center;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
            }
            @media print {
              .screen-only { display: none !important; }
              .print-area {
                display: block !important;
                position: absolute;
                top: ${topOffset}mm;
                right: ${leftOffset}mm;
              }
            }
            @media screen { .print-area { display: none; } }
            
            .card {
              width: 100mm;
              height: 70mm;
              background: white;
              border-radius: 4mm;
              overflow: hidden;
              box-shadow: 0 4px 15px rgba(0,0,0,0.1);
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
            }
            .info-section {
              flex: 1;
              text-align: right;
            }
            .qr-section {
              width: 35mm;
              height: 35mm;
              background: white;
              border: 1px solid #eee;
              border-radius: 2mm;
              padding: 1mm;
            }
            .qr-section img {
              width: 100%;
              height: 100%;
            }
            .member-name {
              font-size: 10pt;
              font-weight: 700;
              color: #1f2937;
              margin-bottom: 2mm;
            }
            .info-row {
              display: flex;
              align-items: center;
              gap: 1mm;
              margin-bottom: 1.5mm;
              font-size: 8pt;
            }
            .info-label {
              color: #6b7280;
              font-size: 6pt;
            }
            .member-code {
              color: #F97316;
              font-weight: 700;
              font-size: 11pt;
            }
            .card-footer {
              text-align: center;
              padding: 1.5mm;
              background: #f9fafb;
              font-size: 5pt;
              color: #9ca3af;
              border-top: 1px dashed #e5e7eb;
            }
            
            .print-btn {
              margin-top: 20px;
              padding: 12px 30px;
              background: linear-gradient(135deg, #3B82F6, #2563EB);
              color: white;
              border: none;
              border-radius: 10px;
              cursor: pointer;
              font-family: 'Tajawal', Arial, sans-serif;
              font-size: 16px;
              font-weight: bold;
            }
            .position-info {
              margin-top: 15px;
              padding: 10px 20px;
              background: #FEF3C7;
              border-radius: 8px;
              color: #92400E;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="screen-only">
            <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة بطاقة العضوية</p>
            <div class="card">
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
                  <div class="member-name">${cardData?.name_ar || ''}</div>
                  
                  <div class="info-row">
                    <span class="info-label">رقم العضوية:</span>
                    <span class="member-code">#${cardData?.member_code || ''}</span>
                  </div>
                  
                  <div class="info-row">
                    <span class="info-label">رقم الجوال:</span>
                    <span>${cardData?.phone || '-'}</span>
                  </div>
                </div>
                <div class="qr-section">
                  <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" />
                </div>
              </div>
              <div class="card-footer">
                امسح الكود عند الدخول لتسجيل الحضور
              </div>
            </div>
            <div class="position-info">
              📍 موقع الطباعة: الصف ${row + 1} - العمود ${col + 1} (الكرت رقم ${position + 1})
            </div>
            <button class="print-btn" onclick="window.print()">🖨️ طباعة البطاقة</button>
          </div>
          <div class="print-area">
            <div class="card">
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
                  <div class="member-name">${cardData?.name_ar || ''}</div>
                  
                  <div class="info-row">
                    <span class="info-label">رقم العضوية:</span>
                    <span class="member-code">#${cardData?.member_code || ''}</span>
                  </div>
                  
                  <div class="info-row">
                    <span class="info-label">رقم الجوال:</span>
                    <span>${cardData?.phone || '-'}</span>
                  </div>
                </div>
                <div class="qr-section">
                  <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" />
                </div>
              </div>
              <div class="card-footer">
                امسح الكود عند الدخول لتسجيل الحضور
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownload = async () => {
    const qrData = JSON.stringify(cardData?.qr_data || {});
    
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
    ctx.fillText('🏆 أكاديمية أداء الأبطال', 200, 35);
    
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

  const qrData = JSON.stringify(cardData?.qr_data || {});

  return (
    <MemberLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">بطاقة العضوية</h1>

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
                      className="aspect-square bg-white border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all flex flex-col items-center justify-center gap-1 p-2"
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
                  📐 حجم كل كرت: 10سم × 7سم
                </p>
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
                <p className="text-orange-400 font-bold mb-4">🏆 أكاديمية أداء الأبطال</p>
                
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
                  <div key={idx} className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                    <span className="font-medium">{act.activity_name}</span>
                    <span className="text-sm text-gray-500">حتى {act.end_date}</span>
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
      </div>
    </MemberLayout>
  );
};

export default MemberCard;
