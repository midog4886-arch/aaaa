import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Bell, AlertTriangle, Clock, Info, Loader2, CheckCircle, Play } from 'lucide-react';
import MemberLayout, { memberAPI, getLanguage } from './MemberLayout';

const MemberNotifications = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState({ notifications: [], unread_count: 0 });
  const language = getLanguage();
  const t = (ar, en) => language === 'ar' ? ar : en;

  const handleNotificationClick = (notif) => {
    if (notif.type === 'new_video') {
      const videoId = notif.video_id;
      navigate(videoId ? `/videos?videoId=${videoId}` : '/videos');
      return;
    }
    if (notif.link) {
      navigate(notif.link);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/notifications');
      setNotifications(res.data);
    } catch (error) {
      console.error('Failed to fetch notifications');
    } finally {
      setLoading(false);
    }
  };

  const getNotificationIcon = (priority) => {
    switch (priority) {
      case 'danger':
        return <AlertTriangle className="w-5 h-5 text-white" />;
      case 'warning':
        return <Clock className="w-5 h-5 text-white" />;
      default:
        return <Info className="w-5 h-5 text-white" />;
    }
  };

  const getNotificationStyle = (priority) => {
    switch (priority) {
      case 'danger':
        return {
          bg: 'bg-red-50 border-red-200',
          icon: 'bg-red-500',
          title: 'text-red-800'
        };
      case 'warning':
        return {
          bg: 'bg-orange-50 border-orange-200',
          icon: 'bg-orange-500',
          title: 'text-orange-800'
        };
      default:
        return {
          bg: 'bg-blue-50 border-blue-200',
          icon: 'bg-blue-500',
          title: 'text-blue-800'
        };
    }
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

  // Group notifications by type
  const expiringNotifications = notifications.notifications.filter(n => n.type === 'expiring_soon');
  const expiredNotifications = notifications.notifications.filter(n => n.type === 'expired');
  const attendanceNotifications = notifications.notifications.filter(n => n.type === 'attendance_recorded');
  const otherNotifications = notifications.notifications.filter(n => !['expiring_soon', 'expired', 'attendance_recorded'].includes(n.type));

  return (
    <MemberLayout>
      <div className="space-y-6 page-enter">
        <div className="flex items-center justify-between">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">الإشعارات</h1>
          {notifications.unread_count > 0 && (
            <span className="px-3 py-1 bg-red-500 text-white rounded-full text-sm">
              {notifications.unread_count} جديد
            </span>
          )}
        </div>

        {/* Expiring Soon */}
        {expiringNotifications.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-orange-700">
                <Clock className="w-5 h-5" />
                اشتراكات على وشك الانتهاء
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {expiringNotifications.map((notif, idx) => {
                  const style = getNotificationStyle(notif.priority);
                  return (
                    <div key={idx} className={`flex items-start gap-3 p-4 rounded-lg border tap-highlight ${style.bg}`}>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${style.icon}`}>
                        {getNotificationIcon(notif.priority)}
                      </div>
                      <div>
                        <p className={`font-bold ${style.title}`}>{notif.title}</p>
                        <p className="text-gray-600 mt-1">{notif.message}</p>
                        {notif.end_date && (
                          <p className="text-sm text-gray-400 mt-2">📅 تاريخ الانتهاء: {notif.end_date}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Expired */}
        {expiredNotifications.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-5 h-5" />
                اشتراكات منتهية
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {expiredNotifications.map((notif, idx) => {
                  const style = getNotificationStyle(notif.priority);
                  return (
                    <div key={idx} className={`flex items-start gap-3 p-4 rounded-lg border tap-highlight ${style.bg}`}>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${style.icon}`}>
                        {getNotificationIcon(notif.priority)}
                      </div>
                      <div>
                        <p className={`font-bold ${style.title}`}>{notif.title}</p>
                        <p className="text-gray-600 mt-1">{notif.message}</p>
                        <p className="text-sm text-red-600 mt-2 font-medium">
                          ⚠️ يرجى التواصل مع الأكاديمية للتجديد
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Attendance Notifications */}
        {attendanceNotifications.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-green-700">
                <CheckCircle className="w-5 h-5" />
                {t('سجل الحضور', 'Attendance Records')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {attendanceNotifications.slice(0, 10).map((notif, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-4 rounded-lg border bg-green-50 border-green-200 tap-highlight">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-green-500">
                      <CheckCircle className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-green-800">{language === 'ar' ? (notif.title_ar || notif.title) : (notif.title_en || notif.title)}</p>
                      <p className="text-gray-600 mt-1">{language === 'ar' ? (notif.message_ar || notif.message) : (notif.message_en || notif.message)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Other Notifications */}
        {otherNotifications.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Bell className="w-5 h-5 text-blue-600" />
                إشعارات أخرى
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {otherNotifications.map((notif, idx) => {
                  const style = getNotificationStyle(notif.priority);
                  const isClickable = notif.type === 'new_video' || !!notif.link;
                  const isVideo = notif.type === 'new_video';
                  return (
                    <div
                      key={idx}
                      onClick={isClickable ? () => handleNotificationClick(notif) : undefined}
                      role={isClickable ? 'button' : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      onKeyDown={isClickable ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleNotificationClick(notif);
                        }
                      } : undefined}
                      className={`flex items-start gap-3 p-4 rounded-lg border tap-highlight ${style.bg} ${isClickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isVideo ? 'bg-purple-500' : style.icon}`}>
                        {isVideo ? <Play className="w-5 h-5 text-white" /> : getNotificationIcon(notif.priority)}
                      </div>
                      <div className="flex-1">
                        <p className={`font-bold ${isVideo ? 'text-purple-800' : style.title}`}>{notif.title}</p>
                        <p className="text-gray-600 mt-1">{notif.message}</p>
                        {isVideo && (
                          <p className="text-xs text-purple-600 mt-2 font-medium">
                            {t('▶️ اضغط لمشاهدة الفيديو', '▶️ Tap to watch the video')}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {notifications.notifications.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <CheckCircle className="w-16 h-16 text-green-300 mx-auto mb-4" />
              <p className="text-xl font-medium text-gray-600">لا توجد إشعارات جديدة</p>
              <p className="text-gray-400 mt-2">جميع اشتراكاتك سارية ولا توجد تنبيهات</p>
            </CardContent>
          </Card>
        )}
      </div>
    </MemberLayout>
  );
};

export default MemberNotifications;
