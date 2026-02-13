import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { 
  CreditCard, Calendar, FileText, QrCode, Bell, CheckCircle, 
  AlertTriangle, Clock, ChevronLeft, Trophy, Loader2
} from 'lucide-react';
import MemberLayout, { memberAPI, getMemberData } from './MemberLayout';
import { HeroBannerAds, InlineAds, PopupAd } from './MemberAds';

const MemberDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState({ active: [], expired: [] });
  const [notifications, setNotifications] = useState({ notifications: [], unread_count: 0 });
  const member = getMemberData();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [subsRes, notifRes] = await Promise.all([
        memberAPI.get('/api/member-portal/subscriptions'),
        memberAPI.get('/api/member-portal/notifications')
      ]);
      setSubscriptions(subsRes.data);
      setNotifications(notifRes.data);
    } catch (error) {
      console.error('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const quickLinks = [
    { to: '/portal/subscriptions', icon: CreditCard, label: 'اشتراكاتي', color: 'bg-blue-500' },
    { to: '/portal/schedule', icon: Calendar, label: 'جدول التدريبات', color: 'bg-green-500' },
    { to: '/portal/card', icon: QrCode, label: 'بطاقة العضوية', color: 'bg-orange-500' },
  ];

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
        {/* Welcome Card */}
        <Card className="bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 text-white border-0">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-amber-500 rounded-full flex items-center justify-center">
                <Trophy className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">مرحباً {member?.name_ar}</h1>
                <p className="text-gray-300">رقم العضوية: #{member?.member_code}</p>
              </div>
            </div>
            
            {/* Terms Notice */}
            <div className="mt-4 p-3 bg-amber-500/20 border border-amber-400/50 rounded-lg">
              <p className="text-amber-200 text-sm flex items-start gap-2">
                <span className="text-amber-400">⚠️</span>
                <span>
                  <strong>تنبيه:</strong> عرض عدد الحصص لا يعني أن الاشتراك ما زال فعّالًا بعد تاريخ الانتهاء، ويُعتد فقط بتاريخ بداية ونهاية الاشتراك الموضّح في الفاتورة.
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-4 text-center">
              <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-700">{subscriptions.total_active}</p>
              <p className="text-sm text-green-600">اشتراك ساري</p>
            </CardContent>
          </Card>
          
          <Card className="bg-red-50 border-red-200">
            <CardContent className="p-4 text-center">
              <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-red-700">{subscriptions.total_expired}</p>
              <p className="text-sm text-red-600">اشتراك منتهي</p>
            </CardContent>
          </Card>
          
          <Card className="bg-orange-50 border-orange-200">
            <CardContent className="p-4 text-center">
              <Bell className="w-8 h-8 text-orange-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-orange-700">{notifications.unread_count}</p>
              <p className="text-sm text-orange-600">إشعار جديد</p>
            </CardContent>
          </Card>
          
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4 text-center">
              <QrCode className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-blue-700">#{member?.member_code}</p>
              <p className="text-sm text-blue-600">رقم العضوية</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {quickLinks.map((link) => (
            <Link key={link.to} to={link.to}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardContent className="p-6 text-center">
                  <div className={`w-14 h-14 ${link.color} rounded-full flex items-center justify-center mx-auto mb-3`}>
                    <link.icon className="w-7 h-7 text-white" />
                  </div>
                  <p className="font-medium text-gray-800">{link.label}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Active Subscriptions */}
        {subscriptions.active.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                الاشتراكات السارية
              </CardTitle>
              <Link to="/portal/subscriptions" className="text-blue-600 text-sm flex items-center gap-1">
                عرض الكل <ChevronLeft className="w-4 h-4" />
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {subscriptions.active.slice(0, 3).map((sub, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                    <div>
                      <p className="font-bold text-gray-800">{sub.activity_name}</p>
                      <p className="text-sm text-gray-500">
                        <Clock className="w-3 h-3 inline ml-1" />
                        ينتهي: {sub.end_date}
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-green-600 text-white text-sm rounded-full">ساري</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Notifications */}
        {notifications.notifications.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Bell className="w-5 h-5 text-orange-600" />
                آخر الإشعارات
              </CardTitle>
              <Link to="/portal/notifications" className="text-blue-600 text-sm flex items-center gap-1">
                عرض الكل <ChevronLeft className="w-4 h-4" />
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {notifications.notifications.slice(0, 3).map((notif, idx) => (
                  <div 
                    key={idx} 
                    className={`flex items-start gap-3 p-3 rounded-lg border ${
                      notif.priority === 'danger' ? 'bg-red-50 border-red-200' :
                      notif.priority === 'warning' ? 'bg-orange-50 border-orange-200' :
                      'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      notif.priority === 'danger' ? 'bg-red-500' :
                      notif.priority === 'warning' ? 'bg-orange-500' :
                      'bg-blue-500'
                    }`}>
                      {notif.priority === 'danger' ? <AlertTriangle className="w-4 h-4 text-white" /> :
                       notif.priority === 'warning' ? <Clock className="w-4 h-4 text-white" /> :
                       <Bell className="w-4 h-4 text-white" />}
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{notif.title}</p>
                      <p className="text-sm text-gray-600">{notif.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </MemberLayout>
  );
};

export default MemberDashboard;
