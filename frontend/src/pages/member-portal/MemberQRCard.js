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
    const printWindow = window.open('', '_blank', 'width=450,height=600');
    const qrData = JSON.stringify(cardData?.qr_data || {});
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>بطاقة العضوية - ${cardData?.member_code}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');
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
                top: 0;
                right: 0;
                margin: 2mm;
              }
            }
            @media screen { .print-area { display: none; } }
            .card-wrapper {
              display: inline-block;
              background: white;
              padding: 15px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.15);
              border: 2px solid #e5e7eb;
            }
            .card {
              width: 6cm;
              height: 6cm;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              background: white;
              padding: 3mm;
            }
            .print-card {
              width: 6cm;
              height: 6cm;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              background: white;
              padding: 3mm;
              border: 1px solid #ddd;
            }
            .logo { font-size: 9pt; font-weight: bold; color: #F97316; margin-bottom: 2mm; }
            .qr-img { width: 35mm; height: 35mm; }
            .name { font-size: 9pt; font-weight: bold; margin-top: 2mm; text-align: center; color: #1f2937; }
            .code { font-size: 11pt; font-weight: bold; color: #F97316; margin-top: 1mm; }
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
          </style>
        </head>
        <body>
          <div class="screen-only">
            <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة بطاقة العضوية</p>
            <div class="card-wrapper">
              <div class="card">
                <div class="logo">🏆 أكاديمية أداء الأبطال</div>
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}" class="qr-img" />
                <div class="name">${cardData?.name_ar || ''}</div>
                <div class="code">#${cardData?.member_code || ''}</div>
              </div>
            </div>
            <button class="print-btn" onclick="window.print()">🖨️ طباعة البطاقة</button>
          </div>
          <div class="print-area">
            <div class="print-card">
              <div class="logo">🏆 أكاديمية أداء الأبطال</div>
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}" class="qr-img" />
              <div class="name">${cardData?.name_ar || ''}</div>
              <div class="code">#${cardData?.member_code || ''}</div>
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
