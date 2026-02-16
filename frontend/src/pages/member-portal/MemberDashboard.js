import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { 
  CreditCard, Calendar, FileText, QrCode, Bell, CheckCircle, 
  AlertTriangle, Clock, ChevronLeft, Trophy, Loader2, RefreshCw, Headphones
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import MemberLayout, { memberAPI, getMemberData, getDarkMode } from './MemberLayout';
import { HeroBannerAds, InlineAds, PopupAd, StoriesAds } from './MemberAds';
import PullToRefresh from '../../components/PullToRefresh';

// Skeleton Components
const StatCardSkeleton = ({ darkMode }) => (
  <div className={`rounded-xl p-4 ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-sm`}>
    <div className="flex items-center gap-3">
      <div className={`w-12 h-12 rounded-full animate-pulse ${darkMode ? 'bg-gray-700' : 'bg-gray-300'}`} />
      <div className="flex-1">
        <div className={`h-3 w-20 rounded animate-pulse mb-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-300'}`} />
        <div className={`h-6 w-16 rounded animate-pulse ${darkMode ? 'bg-gray-700' : 'bg-gray-300'}`} />
      </div>
    </div>
  </div>
);

const BannerSkeleton = ({ darkMode }) => (
  <div className={`rounded-xl overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
    <div className="aspect-[21/9] animate-pulse bg-gradient-to-r from-gray-300 via-gray-200 to-gray-300 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700" 
      style={{ backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
  </div>
);

const QuickLinkSkeleton = ({ darkMode }) => (
  <div className={`rounded-xl p-4 ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-sm`}>
    <div className={`w-10 h-10 rounded-lg animate-pulse mb-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-300'}`} />
    <div className={`h-4 w-20 rounded animate-pulse ${darkMode ? 'bg-gray-700' : 'bg-gray-300'}`} />
  </div>
);

const MemberDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subscriptions, setSubscriptions] = useState({ active: [], expired: [] });
  const [notifications, setNotifications] = useState({ notifications: [], unread_count: 0 });
  const member = getMemberData();
  const darkMode = getDarkMode();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = useCallback(async (showToast = false) => {
    try {
      const [subsRes, notifRes] = await Promise.all([
        memberAPI.get('/api/member-portal/subscriptions'),
        memberAPI.get('/api/member-portal/notifications')
      ]);
      setSubscriptions(subsRes.data);
      setNotifications(notifRes.data);
      if (showToast) {
        toast.success('تم تحديث البيانات بنجاح');
      }
    } catch (error) {
      console.error('Failed to fetch data');
      if (showToast) {
        toast.error('فشل في تحديث البيانات');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData(true);
  }, [fetchData]);

  const quickLinks = [
    { to: '/portal/subscriptions', icon: CreditCard, label: 'اشتراكاتي', color: 'bg-blue-500' },
    { to: '/portal/schedule', icon: Calendar, label: 'جدول التدريبات', color: 'bg-green-500' },
    { to: '/portal/card', icon: QrCode, label: 'بطاقة العضوية', color: 'bg-orange-500' },
    { to: '/portal/support', icon: Headphones, label: 'خدمة العملاء', color: 'bg-purple-500' },
  ];

  if (loading) {
    return (
      <MemberLayout>
        <div className="space-y-6">
          {/* Welcome Skeleton */}
          <div className={`rounded-xl p-6 ${darkMode ? 'bg-gray-800' : 'bg-gradient-to-r from-blue-600 to-indigo-600'}`}>
            <div className={`h-8 w-48 rounded animate-pulse mb-2 ${darkMode ? 'bg-gray-700' : 'bg-white/30'}`} />
            <div className={`h-4 w-32 rounded animate-pulse ${darkMode ? 'bg-gray-700' : 'bg-white/30'}`} />
          </div>
          
          {/* Banner Skeleton */}
          <BannerSkeleton darkMode={darkMode} />
          
          {/* Stats Skeleton */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <StatCardSkeleton key={i} darkMode={darkMode} />)}
          </div>
          
          {/* Quick Links Skeleton */}
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <QuickLinkSkeleton key={i} darkMode={darkMode} />)}
          </div>
        </div>
      </MemberLayout>
    );
  }

  return (
    <MemberLayout>
      <PullToRefresh onRefresh={handleRefresh} disabled={refreshing} className="min-h-[calc(100vh-200px)]">
      <div className="space-y-6">
        {/* Stories Ads - Instagram Style */}
        <StoriesAds branchId={member?.branch_id} />
        
        {/* Hero Banner Carousel */}
        <HeroBannerAds branchId={member?.branch_id} />
        
        {/* Popup Ad */}
        <PopupAd branchId={member?.branch_id} />
        
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

        {/* Inline Ads */}
        <InlineAds branchId={member?.branch_id} maxAds={2} />

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
                  <motion.div 
                    key={idx}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
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
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      </PullToRefresh>
    </MemberLayout>
  );
};

export default MemberDashboard;
