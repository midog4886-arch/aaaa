import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { CheckCircle, XCircle, Clock, Calendar, Loader2 } from 'lucide-react';
import MemberLayout, { memberAPI, getDarkMode } from './MemberLayout';

const CoachCard = ({ name, photo, darkMode }) => {
  const [imgError, setImgError] = useState(false);
  const initials = name
    ? name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('')
    : '?';

  return (
    <div className={`mt-4 pt-4 border-t flex items-center gap-3 ${darkMode ? 'border-green-800' : 'border-green-200'}`}>
      {photo && !imgError ? (
        <img
          src={photo}
          alt={name}
          className="w-12 h-12 rounded-full object-cover border-2 border-green-400 flex-shrink-0"
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-bold border-2 flex-shrink-0 ${
            darkMode ? 'bg-green-800 border-green-500 text-green-200' : 'bg-green-100 border-green-400 text-green-700'
          }`}
        >
          {initials}
        </div>
      )}
      <div>
        <p className={`text-xs font-medium uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>المدرب المسؤول</p>
        <p className={`font-bold text-base ${darkMode ? 'text-green-300' : 'text-green-800'}`}>{name}</p>
      </div>
    </div>
  );
};

const MemberSubscriptions = () => {
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState({ active: [], expired: [] });
  const darkMode = getDarkMode();

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/subscriptions');
      setSubscriptions(res.data);
    } catch (error) {
      console.error('Failed to fetch subscriptions');
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
      <div className="space-y-6 page-enter">
        <h1 className={`text-xl sm:text-2xl font-bold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>اشتراكاتي</h1>

        {/* Active Subscriptions */}
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
          <CardHeader>
            <CardTitle className={`text-lg flex items-center gap-2 ${darkMode ? 'text-green-400' : 'text-green-700'}`}>
              <CheckCircle className="w-5 h-5" />
              الاشتراكات السارية ({subscriptions.total_active})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscriptions.active.length > 0 ? (
              <div className="space-y-4">
                {subscriptions.active.map((sub, idx) => (
                  <div key={idx} className={`p-4 rounded-lg border-2 ${darkMode ? 'bg-green-900/20 border-green-700' : 'bg-green-50 border-green-200'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className={`text-lg font-bold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>{sub.activity_name}</h3>
                        <div className={`mt-2 space-y-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          <p className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            من: {sub.start_date || '-'}
                          </p>
                          <p className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            إلى: {sub.end_date || '-'}
                          </p>
                          {sub.schedule && (
                            <p className={`mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>📅 {sub.schedule}</p>
                          )}
                        </div>
                        {/* Coach Card */}
                        {sub.coach_name && (
                          <CoachCard name={sub.coach_name} photo={sub.coach_photo} darkMode={darkMode} />
                        )}
                      </div>
                      <span className="px-4 py-2 bg-green-600 text-white rounded-full text-sm font-bold flex-shrink-0 mr-3">
                        ساري ✓
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center py-8 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد اشتراكات سارية</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expired Subscriptions */}
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
          <CardHeader>
            <CardTitle className={`text-lg flex items-center gap-2 ${darkMode ? 'text-red-400' : 'text-red-700'}`}>
              <XCircle className="w-5 h-5" />
              الاشتراكات المنتهية ({subscriptions.total_expired})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscriptions.expired.length > 0 ? (
              <div className="space-y-4">
                {subscriptions.expired.map((sub, idx) => (
                  <div key={idx} className={`p-4 rounded-lg border-2 opacity-75 ${darkMode ? 'bg-red-900/20 border-red-700' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className={`text-lg font-bold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>{sub.activity_name}</h3>
                        <div className={`mt-2 space-y-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          <p className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            من: {sub.start_date || '-'}
                          </p>
                          <p className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            إلى: {sub.end_date || '-'}
                          </p>
                          {sub.coach_name && (
                            <p className={`mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>👨‍🏫 المدرب: {sub.coach_name}</p>
                          )}
                        </div>
                      </div>
                      <span className="px-4 py-2 bg-red-600 text-white rounded-full text-sm font-bold">
                        منتهي ✗
                      </span>
                    </div>
                    <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-red-700' : 'border-red-200'}`}>
                      <p className={`text-center font-medium ${darkMode ? 'text-red-400' : 'text-red-700'}`}>
                        ⚠️ يرجى التواصل للتجديد
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center py-8 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                <XCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد اشتراكات منتهية</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MemberLayout>
  );
};

export default MemberSubscriptions;
