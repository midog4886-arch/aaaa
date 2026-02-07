import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { User, CreditCard, Phone, Calendar, Download, Printer, ArrowRight, CheckCircle, XCircle } from 'lucide-react';
import { membersAPI } from '../services/api';

const MemberCardPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const searchMember = async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    setError('');
    setMember(null);
    
    try {
      const response = await membersAPI.getAll();
      const members = response.data;
      
      // Search by member_code or phone
      const found = members.find(m => 
        m.member_code === searchQuery.trim() || 
        m.phone === searchQuery.trim() ||
        m.name_ar?.includes(searchQuery.trim())
      );
      
      if (found) {
        setMember(found);
      } else {
        setError('لم يتم العثور على العضو');
      }
    } catch (err) {
      setError('حدث خطأ في البحث');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
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
          body * {
            visibility: hidden;
          }
          #member-card, #member-card * {
            visibility: visible;
          }
          #member-card {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 400px;
          }
        }
      `}</style>
    </div>
  );
};

export default MemberCardPage;
