import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { 
  CheckCircle, Calendar, TrendingUp, Clock, Loader2, 
  CalendarDays, Activity, Award
} from 'lucide-react';
import MemberLayout, { memberAPI, getDarkMode } from './MemberLayout';

const MemberAttendance = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const darkMode = getDarkMode();

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/attendance-stats');
      setStats(res.data);
    } catch (error) {
      console.error('Failed to fetch attendance stats');
    } finally {
      setLoading(false);
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

  const getArabicMonth = (monthStr) => {
    const months = {
      'January': 'يناير', 'February': 'فبراير', 'March': 'مارس',
      'April': 'أبريل', 'May': 'مايو', 'June': 'يونيو',
      'July': 'يوليو', 'August': 'أغسطس', 'September': 'سبتمبر',
      'October': 'أكتوبر', 'November': 'نوفمبر', 'December': 'ديسمبر'
    };
    const parts = monthStr?.split(' ') || [];
    if (parts.length === 2) {
      return `${months[parts[0]] || parts[0]} ${parts[1]}`;
    }
    return monthStr;
  };

  return (
    <MemberLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">سجل الحضور</h1>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* This Month */}
          <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm">هذا الشهر</p>
                  <p className="text-4xl font-bold mt-1">{stats?.this_month?.count || 0}</p>
                  <p className="text-green-100 text-sm mt-1">حصة</p>
                </div>
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                  <CalendarDays className="w-8 h-8" />
                </div>
              </div>
              <p className="text-green-100 text-xs mt-3">
                {getArabicMonth(stats?.this_month?.month_name)}
              </p>
            </CardContent>
          </Card>

          {/* Last Month */}
          <Card className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-sm">الشهر الماضي</p>
                  <p className="text-4xl font-bold mt-1">{stats?.last_month?.count || 0}</p>
                  <p className="text-blue-100 text-sm mt-1">حصة</p>
                </div>
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                  <Calendar className="w-8 h-8" />
                </div>
              </div>
              <p className="text-blue-100 text-xs mt-3">
                {getArabicMonth(stats?.last_month?.month_name)}
              </p>
            </CardContent>
          </Card>

          {/* Total */}
          <Card className="bg-gradient-to-br from-orange-500 to-amber-600 text-white border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-orange-100 text-sm">إجمالي الحضور</p>
                  <p className="text-4xl font-bold mt-1">{stats?.total || 0}</p>
                  <p className="text-orange-100 text-sm mt-1">حصة</p>
                </div>
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                  <Award className="w-8 h-8" />
                </div>
              </div>
              <p className="text-orange-100 text-xs mt-3">منذ الاشتراك</p>
            </CardContent>
          </Card>
        </div>

        {/* Activities Breakdown */}
        {stats?.this_month?.activities && Object.keys(stats.this_month.activities).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-green-600" />
                حضور هذا الشهر حسب النشاط
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(stats.this_month.activities).map(([activity, count], idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                        <CheckCircle className="w-5 h-5 text-white" />
                      </div>
                      <span className="font-medium">{activity}</span>
                    </div>
                    <div className="text-left">
                      <span className="text-2xl font-bold text-green-600">{count}</span>
                      <span className="text-sm text-gray-500 mr-1">حصة</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Attendance */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              آخر الحضور
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.recent && stats.recent.length > 0 ? (
              <div className="space-y-2">
                {stats.recent.map((att, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                        <CheckCircle className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium">{att.activity_name || 'نشاط'}</p>
                        <p className="text-xs text-gray-500">{att.time || ''}</p>
                      </div>
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-gray-700">{att.date}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا يوجد سجل حضور</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Motivational Card */}
        {stats?.this_month?.count > 0 && (
          <Card className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0">
            <CardContent className="p-6 text-center">
              <Award className="w-12 h-12 mx-auto mb-3" />
              <h3 className="text-xl font-bold">
                {stats.this_month.count >= 12 ? '🏆 ممتاز! أداء رائع هذا الشهر!' :
                 stats.this_month.count >= 8 ? '💪 جيد جداً! استمر!' :
                 stats.this_month.count >= 4 ? '👍 بداية جيدة!' :
                 '🎯 حاول زيادة حضورك!'}
              </h3>
              <p className="text-purple-100 mt-2">
                حضرت {stats.this_month.count} حصة هذا الشهر
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </MemberLayout>
  );
};

export default MemberAttendance;
