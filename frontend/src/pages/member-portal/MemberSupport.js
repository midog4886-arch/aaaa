import React from 'react';
import { Card, CardContent } from '../../components/ui/card';
import { Phone, MessageCircle } from 'lucide-react';
import MemberLayout, { getLanguage } from './MemberLayout';

const MemberSupport = () => {
  const language = getLanguage();
  const t = (ar, en) => language === 'ar' ? ar : en;
  const phoneNumber = '0566238384';
  const whatsappNumber = '966566238384';

  return (
    <MemberLayout>
      <div className="space-y-6 max-w-md mx-auto">
        <div className="text-center pt-4">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Phone className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">
            {t('خدمة العملاء', 'Customer Support')}
          </h1>
          <p className="text-gray-500 mt-2 text-sm">
            {t('تواصل معنا في أي وقت', 'Contact us anytime')}
          </p>
        </div>

        <Card className="border-2 border-green-200 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-green-500 to-emerald-500 px-4 py-3">
            <h2 className="text-white font-bold flex items-center gap-2">
              <MessageCircle className="w-5 h-5" />
              {t('واتساب', 'WhatsApp')}
            </h2>
          </div>
          <CardContent className="p-6 text-center">
            <p className="text-3xl font-bold text-gray-800 tracking-wider mb-4" dir="ltr">
              {phoneNumber}
            </p>
            <a
              href={`https://wa.me/${whatsappNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all hover:scale-105 w-full justify-center"
            >
              <MessageCircle className="w-6 h-6" />
              {t('تواصل عبر واتساب', 'Chat on WhatsApp')}
            </a>
          </CardContent>
        </Card>

        <Card className="border-2 border-blue-200 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-3">
            <h2 className="text-white font-bold flex items-center gap-2">
              <Phone className="w-5 h-5" />
              {t('اتصال هاتفي', 'Phone Call')}
            </h2>
          </div>
          <CardContent className="p-6 text-center">
            <p className="text-3xl font-bold text-gray-800 tracking-wider mb-4" dir="ltr">
              {phoneNumber}
            </p>
            <a
              href={`tel:${phoneNumber}`}
              className="inline-flex items-center gap-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all hover:scale-105 w-full justify-center"
            >
              <Phone className="w-6 h-6" />
              {t('اتصل الآن', 'Call Now')}
            </a>
          </CardContent>
        </Card>

        <div className="text-center pb-6">
          <p className="text-gray-400 text-xs">
            {t('شركة اداء الابطال العالمية للرياضة', 'Champions Academy')}
          </p>
        </div>
      </div>
    </MemberLayout>
  );
};

export default MemberSupport;
