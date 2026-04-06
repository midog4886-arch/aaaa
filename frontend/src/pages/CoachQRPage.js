import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { LogIn, LogOut, CheckCircle, Clock, AlertCircle, Loader2, User } from 'lucide-react';

export default function CoachQRPage() {
  const { coachId } = useParams();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const res = await axios.get(`/api/coach-attendance/qr-status/${coachId}`);
      setStatus(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'حدث خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [coachId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleAction = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await axios.post(`/api/coach-attendance/qr-checkin/${coachId}`);
      setResult(res.data);
      await fetchStatus();
    } catch (e) {
      setResult({ action: 'error', message: e.response?.data?.detail || 'حدث خطأ' });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusColor = (s) => {
    if (s === 'present') return 'text-green-600 bg-green-50 border-green-200';
    if (s === 'checked_out') return 'text-blue-600 bg-blue-50 border-blue-200';
    if (s === 'absent') return 'text-red-600 bg-red-50 border-red-200';
    return 'text-gray-600 bg-gray-50 border-gray-200';
  };

  const getStatusLabel = (s) => {
    if (s === 'present') return 'حاضر';
    if (s === 'checked_out') return 'منصرف';
    if (s === 'absent') return 'غائب';
    return 'لم يُسجَّل بعد';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-3" />
          <p className="text-gray-600">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-800 mb-2">خطأ</h2>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  const canCheckIn = !status?.status || status?.status === 'absent' || status?.status === 'leave';
  const canCheckOut = status?.status === 'present';
  const alreadyOut = status?.status === 'checked_out';

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-l from-orange-500 to-amber-500 px-6 py-8 text-white text-center">
          <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4 text-3xl font-bold">
            {(status?.coach_name || '؟')[0]}
          </div>
          <h1 className="text-2xl font-bold">{status?.coach_name}</h1>
          {status?.coach_phone && (
            <p className="text-orange-100 text-sm mt-1 flex items-center justify-center gap-1">
              <User className="w-3.5 h-3.5" /> {status.coach_phone}
            </p>
          )}
          <p className="text-orange-100 text-xs mt-2">
            📅 {status?.today ? new Date(status.today + 'T00:00:00').toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : ''}
          </p>
        </div>

        {/* Status */}
        <div className="px-6 py-5">
          <div className={`rounded-xl border-2 px-5 py-4 mb-5 flex items-center justify-between ${getStatusColor(status?.status)}`}>
            <span className="font-bold text-lg">{getStatusLabel(status?.status)}</span>
            {status?.status === 'present' && <CheckCircle className="w-6 h-6" />}
            {status?.status === 'checked_out' && <LogOut className="w-6 h-6" />}
          </div>

          {/* Times */}
          {(status?.check_in_time || status?.check_out_time) && (
            <div className="flex gap-3 mb-5">
              {status.check_in_time && (
                <div className="flex-1 bg-green-50 rounded-xl p-3 text-center border border-green-100">
                  <p className="text-xs text-green-600 mb-1 flex items-center justify-center gap-1">
                    <LogIn className="w-3 h-3" /> وقت الحضور
                  </p>
                  <p className="text-xl font-bold text-green-700">{status.check_in_time}</p>
                </div>
              )}
              {status.check_out_time && (
                <div className="flex-1 bg-blue-50 rounded-xl p-3 text-center border border-blue-100">
                  <p className="text-xs text-blue-600 mb-1 flex items-center justify-center gap-1">
                    <LogOut className="w-3 h-3" /> وقت الانصراف
                  </p>
                  <p className="text-xl font-bold text-blue-700">{status.check_out_time}</p>
                </div>
              )}
            </div>
          )}

          {status?.total_hours != null && (
            <div className="bg-amber-50 rounded-xl p-3 text-center border border-amber-100 mb-5">
              <p className="text-xs text-amber-600 mb-1 flex items-center justify-center gap-1">
                <Clock className="w-3 h-3" /> إجمالي ساعات العمل
              </p>
              <p className="text-2xl font-bold text-amber-700">{status.total_hours} <span className="text-sm">ساعة</span></p>
            </div>
          )}

          {/* Action Result */}
          {result && (
            <div className={`rounded-xl p-4 mb-4 text-center border-2 ${
              result.action === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
              result.action === 'checked_in' ? 'bg-green-50 border-green-200 text-green-700' :
              result.action === 'checked_out' ? 'bg-blue-50 border-blue-200 text-blue-700' :
              'bg-gray-50 border-gray-200 text-gray-700'
            }`}>
              {result.action === 'checked_in' && <CheckCircle className="w-8 h-8 mx-auto mb-2" />}
              {result.action === 'checked_out' && <LogOut className="w-8 h-8 mx-auto mb-2" />}
              {result.action === 'error' && <AlertCircle className="w-8 h-8 mx-auto mb-2" />}
              <p className="font-bold text-base">{result.message}</p>
              {result.total_hours != null && result.action === 'checked_out' && (
                <p className="text-sm mt-1 opacity-80">مجموع ساعات العمل: {result.total_hours} ساعة</p>
              )}
            </div>
          )}

          {/* Action Button */}
          {canCheckIn && (
            <button
              onClick={handleAction}
              disabled={submitting}
              className="w-full bg-gradient-to-l from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold py-4 rounded-xl text-lg flex items-center justify-center gap-2 transition-all disabled:opacity-60 shadow-lg shadow-green-200"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
              {submitting ? 'جاري التسجيل...' : 'تسجيل الحضور'}
            </button>
          )}

          {canCheckOut && (
            <button
              onClick={handleAction}
              disabled={submitting}
              className="w-full bg-gradient-to-l from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-bold py-4 rounded-xl text-lg flex items-center justify-center gap-2 transition-all disabled:opacity-60 shadow-lg shadow-blue-200"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogOut className="w-5 h-5" />}
              {submitting ? 'جاري التسجيل...' : 'تسجيل الانصراف'}
            </button>
          )}

          {alreadyOut && !result && (
            <div className="text-center py-3 text-gray-500 text-sm">
              <CheckCircle className="w-5 h-5 mx-auto mb-1 text-blue-400" />
              تم تسجيل الحضور والانصراف لهذا اليوم
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 text-center">
          <p className="text-xs text-gray-400">شركة أداء الأبطال العالمية للرياضة</p>
        </div>
      </div>
    </div>
  );
}
