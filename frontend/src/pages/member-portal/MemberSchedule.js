import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Calendar, Clock, MapPin, Loader2, AlertCircle } from 'lucide-react';
import MemberLayout, { memberAPI } from './MemberLayout';

const MemberSchedule = () => {
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState({ schedules: [], activity_notes: [] });

  useEffect(() => {
    fetchSchedule();
  }, []);

  const fetchSchedule = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/schedule');
      setSchedule(res.data);
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

  return (
    <MemberLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">جدول التدريبات</h1>

        {/* My Training Schedule */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              مواعيد تدريباتي
            </CardTitle>
          </CardHeader>
          <CardContent>
            {schedule.schedules.length > 0 ? (
              <div className="space-y-4">
                {schedule.schedules.map((item, idx) => (
                  <div key={idx} className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-gray-800">{item.activity_name}</h3>
                        {item.schedule && (
                          <p className="mt-2 text-gray-600 flex items-center gap-2">
                            <Clock className="w-4 h-4 text-blue-600" />
                            {item.schedule}
                          </p>
                        )}
                      </div>
                      <div className="text-left">
                        <span className="text-sm text-gray-500">ينتهي في</span>
                        <p className="font-bold text-blue-700">{item.end_date}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد اشتراكات سارية حالياً</p>
                <p className="text-sm mt-2">يرجى تجديد اشتراكك لعرض جدول التدريبات</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Notes */}
        {schedule.activity_notes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-orange-600" />
                ملاحظات وتنبيهات الأنشطة
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {schedule.activity_notes.map((note, idx) => (
                  <div key={idx} className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center flex-shrink-0">
                        <AlertCircle className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-800">{note.title || 'تنبيه'}</p>
                        <p className="text-gray-600 mt-1">{note.content || note.note}</p>
                        {note.date && (
                          <p className="text-xs text-gray-400 mt-2">{note.date}</p>
                        )}
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
                <p className="text-blue-700 font-medium mt-1" dir="ltr">📞 0500000000</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MemberLayout>
  );
};

export default MemberSchedule;
