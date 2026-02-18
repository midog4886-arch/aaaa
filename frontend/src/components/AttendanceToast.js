import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle, X } from 'lucide-react';
import { memberAPI } from '../pages/member-portal/MemberLayout';

const AttendanceToast = ({ language = 'ar' }) => {
  const [toasts, setToasts] = useState([]);
  const lastCheckRef = useRef(null);
  const seenIdsRef = useRef(new Set());
  const intervalRef = useRef(null);

  const checkNewAttendance = useCallback(async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/notifications');
      const notifications = res.data.notifications || [];
      
      const attendanceNotifs = notifications.filter(n => 
        n.type === 'attendance_recorded' && 
        !n.is_read &&
        !seenIdsRef.current.has(n.id || n.created_at)
      );

      if (lastCheckRef.current === null) {
        attendanceNotifs.forEach(n => seenIdsRef.current.add(n.id || n.created_at));
        lastCheckRef.current = Date.now();
        return;
      }
      
      if (attendanceNotifs.length > 0) {
        const newToasts = attendanceNotifs.map(n => {
          const nId = n.id || n.created_at || Date.now() + Math.random();
          seenIdsRef.current.add(nId);
          return {
            id: nId,
            title: language === 'ar' ? (n.title_ar || n.title) : (n.title_en || n.title),
            message: language === 'ar' ? (n.message_ar || n.message) : (n.message_en || n.message),
            visible: true
          };
        });
        
        setToasts(prev => [...prev, ...newToasts]);
        lastCheckRef.current = Date.now();
        
        newToasts.forEach(toast => {
          setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== toast.id));
          }, 8000);
        });
      }
    } catch (error) {
      // silent
    }
  }, [language]);

  useEffect(() => {
    checkNewAttendance();
    intervalRef.current = setInterval(checkNewAttendance, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkNewAttendance]);

  const dismissToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-20 left-4 right-4 z-50 space-y-2 pointer-events-none" style={{ maxWidth: '400px', margin: '0 auto' }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto animate-in slide-in-from-top-2 duration-500 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl shadow-2xl p-4 flex items-start gap-3"
        >
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm">{toast.title}</p>
            <p className="text-xs text-green-100 mt-0.5">{toast.message}</p>
          </div>
          <button 
            onClick={() => dismissToast(toast.id)}
            className="p-1 rounded-full hover:bg-white/20 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default AttendanceToast;
