import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { CheckCircle, XCircle, Clock, Calendar, Loader2 } from 'lucide-react';
import MemberLayout, { memberAPI, getDarkMode } from './MemberLayout';

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
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-green-700">
              <CheckCircle className="w-5 h-5" />
              الاشتراكات السارية ({subscriptions.total_active})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscriptions.active.length > 0 ? (
              <div className="space-y-4">
                {subscriptions.active.map((sub, idx) => (
                  <div key={idx} className="p-4 bg-green-50 rounded-lg border-2 border-green-200">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-gray-800">{sub.activity_name}</h3>
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          <p className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            من: {sub.start_date || '-'}
                          </p>
                          <p className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            إلى: {sub.end_date || '-'}
                          </p>
                          {sub.coach_name && (
                            <p className="text-gray-500 mt-1">👨‍🏫 المدرب: {sub.coach_name}</p>
                          )}
                          {sub.schedule && (
                            <p className="text-gray-500 mt-1">📅 {sub.schedule}</p>
                          )}
                        </div>
                      </div>
                      <span className="px-4 py-2 bg-green-600 text-white rounded-full text-sm font-bold">
                        ساري ✓
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد اشتراكات سارية</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expired Subscriptions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-red-700">
              <XCircle className="w-5 h-5" />
              الاشتراكات المنتهية ({subscriptions.total_expired})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscriptions.expired.length > 0 ? (
              <div className="space-y-4">
                {subscriptions.expired.map((sub, idx) => (
                  <div key={idx} className="p-4 bg-red-50 rounded-lg border-2 border-red-200 opacity-75">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-gray-800">{sub.activity_name}</h3>
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          <p className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            من: {sub.start_date || '-'}
                          </p>
                          <p className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            إلى: {sub.end_date || '-'}
                          </p>
                          {sub.coach_name && (
                            <p className="text-gray-500 mt-1">👨‍🏫 المدرب: {sub.coach_name}</p>
                          )}
                        </div>
                      </div>
                      <span className="px-4 py-2 bg-red-600 text-white rounded-full text-sm font-bold">
                        منتهي ✗
                      </span>
                    </div>
                    <div className="mt-3 pt-3 border-t border-red-200">
                      <p className="text-red-700 text-center font-medium">
                        ⚠️ يرجى التواصل للتجديد
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
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
