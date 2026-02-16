import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { 
  Phone, 
  MessageCircle, 
  ArrowRight,
  Headphones,
  Clock,
  MapPin
} from 'lucide-react';

const MemberSupport = () => {
  const navigate = useNavigate();
  const phoneNumber = '0566238384';
  const whatsappNumber = '966566238384';

  const handleCall = () => {
    window.location.href = `tel:${phoneNumber}`;
  };

  const handleWhatsApp = () => {
    window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent('السلام عليكم، أحتاج مساعدة')}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white p-4 sticky top-0 z-10 shadow-lg">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/portal/dashboard')}
            className="text-white hover:bg-white/20"
          >
            <ArrowRight className="w-6 h-6" />
          </Button>
          <div className="flex items-center gap-2">
            <Headphones className="w-6 h-6" />
            <h1 className="text-xl font-bold">خدمة العملاء</h1>
          </div>
        </div>
      </div>

      <div className="p-4 max-w-lg mx-auto space-y-6">
        {/* Welcome Message */}
        <Card className="border-0 shadow-lg bg-white overflow-hidden">
          <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-6 text-white text-center">
            <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Headphones className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold mb-2">مرحباً بك!</h2>
            <p className="text-white/90">فريق خدمة العملاء جاهز لمساعدتك</p>
          </div>
        </Card>

        {/* Contact Options */}
        <div className="space-y-4">
          {/* Phone Call */}
          <Card 
            className="border-0 shadow-lg hover:shadow-xl transition-all cursor-pointer active:scale-[0.98]"
            onClick={handleCall}
          >
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                  <Phone className="w-7 h-7 text-green-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg text-gray-800">اتصال مباشر</h3>
                  <p className="text-gray-500 text-sm">تحدث مع فريق الدعم الآن</p>
                  <p className="text-green-600 font-bold text-lg mt-1 dir-ltr">{phoneNumber}</p>
                </div>
                <Button 
                  size="icon" 
                  className="bg-green-500 hover:bg-green-600 rounded-full h-12 w-12"
                >
                  <Phone className="w-5 h-5" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* WhatsApp */}
          <Card 
            className="border-0 shadow-lg hover:shadow-xl transition-all cursor-pointer active:scale-[0.98]"
            onClick={handleWhatsApp}
          >
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center">
                  <MessageCircle className="w-7 h-7 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg text-gray-800">واتساب</h3>
                  <p className="text-gray-500 text-sm">راسلنا عبر الواتساب</p>
                  <p className="text-emerald-600 font-bold text-lg mt-1 dir-ltr">{phoneNumber}</p>
                </div>
                <Button 
                  size="icon" 
                  className="bg-emerald-500 hover:bg-emerald-600 rounded-full h-12 w-12"
                >
                  <MessageCircle className="w-5 h-5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Working Hours */}
        <Card className="border-0 shadow-lg">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <Clock className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="font-bold text-lg text-gray-800">ساعات العمل</h3>
            </div>
            <div className="space-y-3 text-gray-600">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span>السبت - الخميس</span>
                <span className="font-semibold text-gray-800">8:00 ص - 10:00 م</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span>الجمعة</span>
                <span className="font-semibold text-gray-800">4:00 م - 10:00 م</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Location */}
        <Card className="border-0 shadow-lg">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <MapPin className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="font-bold text-lg text-gray-800">الموقع</h3>
            </div>
            <p className="text-gray-600">
              أكاديمية أداء الأبطال العالمية
            </p>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3 pb-6">
          <Button 
            onClick={handleCall}
            className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 h-14 text-base font-bold rounded-xl shadow-lg"
          >
            <Phone className="w-5 h-5 ml-2" />
            اتصل الآن
          </Button>
          <Button 
            onClick={handleWhatsApp}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 h-14 text-base font-bold rounded-xl shadow-lg"
          >
            <MessageCircle className="w-5 h-5 ml-2" />
            واتساب
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MemberSupport;
