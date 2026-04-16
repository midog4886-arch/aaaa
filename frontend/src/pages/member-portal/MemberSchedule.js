import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Calendar, Clock, MapPin, Loader2, CheckCircle, XCircle, FileText } from 'lucide-react';
import MemberLayout, { memberAPI, getDarkMode } from './MemberLayout';

const CoachAvatar = ({ photo, name, darkMode, size = 'md' }) => {
  const [imgError, setImgError] = React.useState(false);
  const initials = name
    ? name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('')
    : '?';
  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';

  if (photo && !imgError) {
    return (
      <img
        src={photo}
        alt={name || 'المدرب'}
        className={`${sizeClass} rounded-full object-cover border-2 border-green-400 flex-shrink-0`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className={`${sizeClass} rounded-full flex items-center justify-center flex-shrink-0 font-bold border-2 ${
      darkMode ? 'bg-green-800 border-green-500 text-green-200' : 'bg-green-100 border-green-400 text-green-700'
    }`}>
      {initials}
    </div>
  );
};

const MemberSchedule = () => {
  const [loading, setLoading] = useState(true);
  const [scheduleData, setScheduleData] = useState({ schedules: [], active_count: 0, expired_count: 0 });
  const darkMode = getDarkMode();

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
        <h1 className={`text-xl sm:text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>جدول التدريبات</h1>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <Card className={darkMode ? 'bg-green-900/30 border-green-700' : 'bg-green-50 border-green-200'}>
            <CardContent className="p-4 text-center">
              <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-700">{scheduleData.active_count}</p>
              <p className="text-sm text-green-600">جدول ساري</p>
            </CardContent>
          </Card>
          <Card className={darkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'}>
            <CardContent className="p-4 text-center">
              <XCircle className={`w-8 h-8 mx-auto mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
              <p className={`text-2xl font-bold ${darkMode ? 'text-gray-300' : 'text-gray-500'}`}>{scheduleData.expired_count}</p>
              <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-400'}`}>جدول منتهي</p>
            </CardContent>
          </Card>
        </div>

        {/* Active Training Schedule */}
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
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
                  <div key={idx} className={`p-4 rounded-lg border-2 ${darkMode ? 'bg-green-900/20 border-green-700' : 'bg-green-50 border-green-200'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        {/* Activity name with coach avatar */}
                        <div className="flex items-center gap-3">
                          {item.coach_name && (
                            <CoachAvatar photo={item.coach_photo} name={item.coach_name} darkMode={darkMode} />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>{item.activity_name}</h3>
                              <span className="px-2 py-0.5 bg-green-600 text-white text-xs rounded-full">ساري</span>
                            </div>
                            {item.coach_name && (
                              <p className={`text-sm mt-0.5 ${darkMode ? 'text-green-400' : 'text-green-700'}`}>
                                المدرب: {item.coach_name}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {item.schedule && (
                          <div className={`mt-3 p-3 rounded-lg border ${darkMode ? 'bg-gray-700 border-green-700' : 'bg-white border-green-200'}`}>
                            <p className="text-green-700 font-bold flex items-center gap-2">
                              <Clock className="w-5 h-5" />
                              {item.schedule}
                            </p>
                          </div>
                        )}
                        
                        <div className={`mt-3 flex items-center gap-4 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            من: {item.start_date}
                          </span>
                          <span className="flex items-center gap-1">
                            إلى: {item.end_date}
                          </span>
                        </div>
                        
                        {item.source === 'registration_form' && (
                          <p className={`text-xs mt-2 flex items-center gap-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
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
              <div className={`text-center py-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد جداول تدريب سارية حالياً</p>
                <p className="text-sm mt-2">يرجى تجديد اشتراكك لعرض جدول التدريبات</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expired Schedules */}
        {expiredSchedules.length > 0 && (
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardHeader>
              <CardTitle className={`text-lg flex items-center gap-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <XCircle className="w-5 h-5" />
                جداول منتهية ({expiredSchedules.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {expiredSchedules.slice(0, 5).map((item, idx) => (
                  <div key={idx} className={`p-3 rounded-lg border opacity-70 ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {item.coach_name && (
                          <CoachAvatar photo={item.coach_photo} name={item.coach_name} darkMode={darkMode} size="sm" />
                        )}
                        <div>
                          <p className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{item.activity_name}</p>
                          {item.schedule && (
                            <p className={`text-sm mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{item.schedule}</p>
                          )}
                          {item.coach_name && (
                            <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>المدرب: {item.coach_name}</p>
                          )}
                        </div>
                      </div>
                      <div className={`text-left text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
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
        <Card className={darkMode ? 'bg-blue-900/20 border-blue-700' : 'bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-200'}>
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                <MapPin className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className={`font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-800'}`}>موقع الأكاديمية</h3>
                <p className={darkMode ? 'text-gray-300' : 'text-gray-600'}>للاستفسارات والتواصل:</p>
                <p className="text-blue-500 font-medium mt-1 text-lg" dir="ltr">📞 +966 56 623 8384</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MemberLayout>
  );
};

export default MemberSchedule;
