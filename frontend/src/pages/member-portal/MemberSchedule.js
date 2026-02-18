import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Calendar, Clock, MapPin, Loader2, AlertCircle, CheckCircle, XCircle, FileText } from 'lucide-react';
import MemberLayout, { memberAPI } from './MemberLayout';

const MemberSchedule = () => {
  const [loading, setLoading] = useState(true);
  const [scheduleData, setScheduleData] = useState({ schedules: [], active_count: 0, expired_count: 0 });

  useEffect(() => {
    fetchSchedule();
  }, []);

  const fetchSchedule = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/my-schedule');
      setScheduleData(res.data);
    } catch (error) {
      console.error('Failed to fetch schedule');
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

  const activeSchedules = scheduleData.schedules.filter(s => s.status === 'active');
  const expiredSchedules = scheduleData.schedules.filter(s => s.status === 'expired');

  return (
    <MemberLayout>
      <div className="space-y-6 page-enter">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800">جدول التدريبات</h1>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-4 text-center">
              <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-700">{scheduleData.active_count}</p>
              <p className="text-sm text-green-600">جدول ساري</p>
            </CardContent>
          </Card>
          <Card className="bg-gray-50 border-gray-200">
            <CardContent className="p-4 text-center">
              <XCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-gray-500">{scheduleData.expired_count}</p>
              <p className="text-sm text-gray-400">جدول منتهي</p>
            </CardContent>
          </Card>
        </div>

        {/* Active Training Schedule */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-green-700">
              <Calendar className="w-5 h-5" />
              مواعيد تدريباتي الحالية ({activeSchedules.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeSchedules.length > 0 ? (
              <div className="space-y-4">
                {activeSchedules.map((item, idx) => (
                  <div key={idx} className="p-4 bg-green-50 rounded-lg border-2 border-green-200">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-bold text-gray-800">{item.activity_name}</h3>
                          <span className="px-2 py-0.5 bg-green-600 text-white text-xs rounded-full">ساري</span>
                        </div>
                        
                        {item.schedule && (
                          <div className="mt-3 p-3 bg-white rounded-lg border border-green-200">
                            <p className="text-green-700 font-bold flex items-center gap-2">
                              <Clock className="w-5 h-5" />
                              {item.schedule}
                            </p>
                          </div>
                        )}
                        
                        <div className="mt-3 flex items-center gap-4 text-sm text-gray-600">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            من: {item.start_date}
                          </span>
                          <span className="flex items-center gap-1">
                            إلى: {item.end_date}
                          </span>
                        </div>
                        
                        {item.source === 'registration_form' && (
                          <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            من استمارة: {item.form_number}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد جداول تدريب سارية حالياً</p>
                <p className="text-sm mt-2">يرجى تجديد اشتراكك لعرض جدول التدريبات</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expired Schedules */}
        {expiredSchedules.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-gray-500">
                <XCircle className="w-5 h-5" />
                جداول منتهية ({expiredSchedules.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {expiredSchedules.slice(0, 5).map((item, idx) => (
                  <div key={idx} className="p-3 bg-gray-50 rounded-lg border border-gray-200 opacity-70">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-600">{item.activity_name}</p>
                        {item.schedule && (
                          <p className="text-sm text-gray-400 mt-1">{item.schedule}</p>
                        )}
                      </div>
                      <div className="text-left text-sm text-gray-400">
                        <p>انتهى في</p>
                        <p>{item.end_date}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info Card */}
        <Card className="bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                <MapPin className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 mb-2">موقع الأكاديمية</h3>
                <p className="text-gray-600">للاستفسارات والتواصل:</p>
                <p className="text-blue-700 font-medium mt-1 text-lg" dir="ltr">📞 +966 56 623 8384</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MemberLayout>
  );
};

export default MemberSchedule;
