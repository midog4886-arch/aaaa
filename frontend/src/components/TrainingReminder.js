import React, { useState, useEffect, useCallback } from 'react';
import { Bell, Calendar, Clock, CheckCircle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { memberAPI } from '../pages/member-portal/MemberLayout';

const TrainingReminder = ({ language = 'ar' }) => {
  const [reminders, setReminders] = useState([]);
  const [dayName, setDayName] = useState('');
  const [visible, setVisible] = useState(true);
  const [expanded, setExpanded] = useState(true);

  const t = useCallback((ar, en) => language === 'ar' ? ar : en, [language]);

  useEffect(() => {
    fetchReminders();
  }, []);

  const fetchReminders = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/training-reminders');
      const data = res.data;
      setReminders(data.reminders || []);
      setDayName(language === 'ar' ? data.day_name_ar : data.day_name_en);
    } catch (error) {
      console.error('Failed to fetch training reminders');
    }
  };

  if (!visible || reminders.length === 0) return null;

  const activeReminders = reminders.filter(r => !r.already_attended);
  const attendedReminders = reminders.filter(r => r.already_attended);

  return (
    <div className="rounded-xl overflow-hidden border-2 border-blue-300 bg-gradient-to-r from-blue-50 to-cyan-50 shadow-lg animate-in slide-in-from-top-2 duration-500">
      <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <p className="font-bold text-sm">
              {t('🔔 تذكير بمواعيد التدريب اليوم', '🔔 Today\'s Training Reminder')}
            </p>
            <p className="text-xs text-blue-100">{dayName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded-full hover:bg-white/20 text-white transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button 
            onClick={() => setVisible(false)}
            className="p-1 rounded-full hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {expanded && (
        <div className="p-3 space-y-2">
          {activeReminders.map((reminder) => (
            <div 
              key={reminder.id}
              className="flex items-center gap-3 p-3 bg-white rounded-lg border border-blue-200 shadow-sm"
            >
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-800 text-sm">{reminder.activity_name}</p>
                {reminder.schedule && (
                  <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" />
                    {reminder.schedule}
                  </p>
                )}
              </div>
              <div className="flex-shrink-0">
                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                  {t('اليوم', 'Today')}
                </span>
              </div>
            </div>
          ))}

          {attendedReminders.map((reminder) => (
            <div 
              key={reminder.id}
              className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200 opacity-80"
            >
              <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-600 text-sm">{reminder.activity_name}</p>
                <p className="text-xs text-green-600 mt-0.5">
                  {t('✅ تم تسجيل الحضور', '✅ Attendance recorded')}
                </p>
              </div>
            </div>
          ))}

          {activeReminders.length > 0 && (
            <p className="text-center text-xs text-gray-400 pt-1">
              {t('لا تنسَ حضور تدريبك! 💪', 'Don\'t forget your training! 💪')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default TrainingReminder;
