import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { 
  Clock, LogIn, LogOut, UserX, Calendar, ChevronLeft, ChevronRight,
  FileText, Download, Edit2, Trash2, Save, X, AlertCircle, CheckCircle,
  Users, Timer, CalendarDays
} from 'lucide-react';
import axios from 'axios';

const CoachAttendancePage = () => {
  const [coaches, setCoaches] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('daily');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [monthlyReport, setMonthlyReport] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAbsentModal, setShowAbsentModal] = useState(null);
  const [absentReason, setAbsentReason] = useState('');
  const [absentStatus, setAbsentStatus] = useState('absent');
  const [toast, setToast] = useState(null);
  const branchFilter = localStorage.getItem('selectedBranch') || 'all';

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [coachesRes, recordsRes] = await Promise.all([
        axios.get('/api/coaches', { params: { branch_filter: branchFilter } }),
        axios.get('/api/coach-attendance', { params: { date: selectedDate, branch_filter: branchFilter } })
      ]);
      setCoaches(coachesRes.data);
      setRecords(recordsRes.data);
    } catch (err) {
      showToast('حدث خطأ في تحميل البيانات', 'error');
    }
    setLoading(false);
  }, [selectedDate, branchFilter]);

  const fetchMonthlyReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/coach-attendance/monthly-report', {
        params: { month: selectedMonth, branch_filter: branchFilter }
      });
      setMonthlyReport(res.data);
    } catch (err) {
      showToast('حدث خطأ في تحميل التقرير', 'error');
    }
    setLoading(false);
  }, [selectedMonth, branchFilter]);

  useEffect(() => {
    if (view === 'daily') fetchData();
    else fetchMonthlyReport();
  }, [view, fetchData, fetchMonthlyReport]);

  const handleCheckIn = async (coachId) => {
    try {
      await axios.post('/api/coach-attendance/check-in', {
        coach_id: coachId,
        date: selectedDate
      });
      showToast('تم تسجيل الحضور بنجاح');
      fetchData();
    } catch (err) {
      showToast(err.response?.data?.detail || 'حدث خطأ', 'error');
    }
  };

  const handleCheckOut = async (recordId) => {
    try {
      await axios.post(`/api/coach-attendance/${recordId}/check-out`, {});
      showToast('تم تسجيل الانصراف بنجاح');
      fetchData();
    } catch (err) {
      showToast(err.response?.data?.detail || 'حدث خطأ', 'error');
    }
  };

  const handleMarkAbsent = async () => {
    if (!showAbsentModal) return;
    try {
      await axios.post('/api/coach-attendance/mark-absent', {
        coach_id: showAbsentModal,
        date: selectedDate,
        status: absentStatus,
        reason: absentReason
      });
      showToast(absentStatus === 'leave' ? 'تم تسجيل الإجازة' : 'تم تسجيل الغياب');
      setShowAbsentModal(null);
      setAbsentReason('');
      setAbsentStatus('absent');
      fetchData();
    } catch (err) {
      showToast(err.response?.data?.detail || 'حدث خطأ', 'error');
    }
  };

  const handleUpdateRecord = async (recordId) => {
    try {
      await axios.put(`/api/coach-attendance/${recordId}`, editForm);
      showToast('تم التحديث بنجاح');
      setEditingRecord(null);
      setEditForm({});
      fetchData();
    } catch (err) {
      showToast('حدث خطأ في التحديث', 'error');
    }
  };

  const handleDeleteRecord = async (recordId) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا السجل؟')) return;
    try {
      await axios.delete(`/api/coach-attendance/${recordId}`);
      showToast('تم الحذف بنجاح');
      fetchData();
    } catch (err) {
      showToast('حدث خطأ في الحذف', 'error');
    }
  };

  const changeDate = (days) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const getCoachRecord = (coachId) => records.find(r => r.coach_id === coachId);

  const getStatusBadge = (status) => {
    const styles = {
      present: { bg: 'bg-green-100', text: 'text-green-700', label: 'حاضر' },
      checked_out: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'انصرف' },
      absent: { bg: 'bg-red-100', text: 'text-red-700', label: 'غائب' },
      leave: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'إجازة' }
    };
    const s = styles[status] || styles.absent;
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>{s.label}</span>;
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const isToday = selectedDate === todayStr;
  const presentCount = records.filter(r => r.status === 'present' || r.status === 'checked_out').length;
  const absentCount = records.filter(r => r.status === 'absent').length;
  const leaveCount = records.filter(r => r.status === 'leave').length;

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return `${days[d.getDay()]} ${d.toLocaleDateString('ar-SA')}`;
  };

  const exportCSV = () => {
    if (!monthlyReport) return;
    const rows = [['المدرب', 'أيام الحضور', 'أيام الغياب', 'أيام الإجازة', 'إجمالي الساعات']];
    monthlyReport.report.forEach(r => {
      rows.push([r.coach_name, r.present_days, r.absent_days, r.leave_days, r.total_hours]);
    });
    const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coach-attendance-${selectedMonth}.csv`;
    a.click();
  };

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
        {toast && (
          <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
            toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
          }`}>
            {toast.type === 'error' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
            {toast.message}
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Clock className="w-7 h-7 text-orange-500" />
            حضور المدربين
          </h1>
          <div className="flex gap-2">
            <button
              onClick={() => setView('daily')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === 'daily' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Calendar className="w-4 h-4 inline ml-1" />
              يومي
            </button>
            <button
              onClick={() => setView('monthly')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === 'monthly' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <CalendarDays className="w-4 h-4 inline ml-1" />
              تقرير شهري
            </button>
          </div>
        </div>

        {view === 'daily' ? (
          <>
            <div className="flex items-center justify-center gap-3 mb-6">
              <button onClick={() => changeDate(-1)} className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200">
                <ChevronRight className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-center"
                />
                {!isToday && (
                  <button onClick={() => setSelectedDate(todayStr)} className="px-3 py-2 bg-orange-100 text-orange-600 rounded-lg text-sm hover:bg-orange-200">
                    اليوم
                  </button>
                )}
              </div>
              <button onClick={() => changeDate(1)} className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200">
                <ChevronLeft className="w-5 h-5" />
              </button>
            </div>

            <p className="text-center text-gray-500 text-sm mb-4">{formatDate(selectedDate)}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="bg-white rounded-xl p-4 border text-center">
                <Users className="w-6 h-6 text-gray-400 mx-auto mb-1" />
                <p className="text-2xl font-bold text-gray-800">{coaches.length}</p>
                <p className="text-xs text-gray-500">إجمالي المدربين</p>
              </div>
              <div className="bg-white rounded-xl p-4 border text-center">
                <CheckCircle className="w-6 h-6 text-green-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-green-600">{presentCount}</p>
                <p className="text-xs text-gray-500">حاضر</p>
              </div>
              <div className="bg-white rounded-xl p-4 border text-center">
                <UserX className="w-6 h-6 text-red-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-red-600">{absentCount}</p>
                <p className="text-xs text-gray-500">غائب</p>
              </div>
              <div className="bg-white rounded-xl p-4 border text-center">
                <Calendar className="w-6 h-6 text-yellow-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-yellow-600">{leaveCount}</p>
                <p className="text-xs text-gray-500">إجازة</p>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-400">جاري التحميل...</div>
            ) : coaches.length === 0 ? (
              <div className="text-center py-12 text-gray-400">لا يوجد مدربين</div>
            ) : (
              <div className="space-y-3">
                {coaches.map(coach => {
                  const record = getCoachRecord(coach.id);
                  const isEditing = editingRecord === record?.id;

                  return (
                    <div key={coach.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                      <div className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
                              record?.status === 'present' ? 'bg-green-500' :
                              record?.status === 'checked_out' ? 'bg-blue-500' :
                              record?.status === 'absent' ? 'bg-red-400' :
                              record?.status === 'leave' ? 'bg-yellow-500' : 'bg-gray-300'
                            }`}>
                              {(coach.name_ar || coach.name || '؟')[0]}
                            </div>
                            <div>
                              <p className="font-bold text-gray-800">{coach.name_ar || coach.name}</p>
                              <p className="text-xs text-gray-400">{coach.phone}</p>
                            </div>
                          </div>
                        </div>

                        {record ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            {getStatusBadge(record.status)}
                            {record.check_in_time && (
                              <span className="text-xs text-gray-500 flex items-center gap-1">
                                <LogIn className="w-3 h-3" /> {record.check_in_time}
                              </span>
                            )}
                            {record.check_out_time && (
                              <span className="text-xs text-gray-500 flex items-center gap-1">
                                <LogOut className="w-3 h-3" /> {record.check_out_time}
                              </span>
                            )}
                            {record.total_hours != null && (
                              <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <Timer className="w-3 h-3" /> {record.total_hours} ساعة
                              </span>
                            )}
                            {record.status === 'present' && (
                              <button
                                onClick={() => handleCheckOut(record.id)}
                                className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs hover:bg-blue-600 flex items-center gap-1"
                              >
                                <LogOut className="w-3 h-3" /> انصراف
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setEditingRecord(record.id);
                                setEditForm({
                                  check_in_time: record.check_in_time || '',
                                  check_out_time: record.check_out_time || '',
                                  notes: record.notes || ''
                                });
                              }}
                              className="p-1.5 text-gray-400 hover:text-orange-500 rounded-lg hover:bg-orange-50"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteRecord(record.id)}
                              className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleCheckIn(coach.id)}
                              className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600 flex items-center gap-1"
                            >
                              <LogIn className="w-4 h-4" /> تسجيل حضور
                            </button>
                            <button
                              onClick={() => setShowAbsentModal(coach.id)}
                              className="px-3 py-1.5 bg-red-100 text-red-600 rounded-lg text-sm hover:bg-red-200 flex items-center gap-1"
                            >
                              <UserX className="w-4 h-4" /> غياب/إجازة
                            </button>
                          </div>
                        )}
                      </div>

                      {record?.reason && (
                        <div className="px-4 pb-3">
                          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-1.5">
                            السبب: {record.reason}
                          </p>
                        </div>
                      )}
                      {record?.notes && !isEditing && (
                        <div className="px-4 pb-3">
                          <p className="text-xs text-gray-500 bg-yellow-50 rounded-lg px-3 py-1.5">
                            ملاحظات: {record.notes}
                          </p>
                        </div>
                      )}

                      {isEditing && (
                        <div className="px-4 pb-4 border-t bg-gray-50">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                            <div>
                              <label className="text-xs text-gray-500 mb-1 block">وقت الدخول</label>
                              <input
                                type="time"
                                value={editForm.check_in_time || ''}
                                onChange={(e) => setEditForm({...editForm, check_in_time: e.target.value})}
                                className="w-full border rounded-lg px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 mb-1 block">وقت الخروج</label>
                              <input
                                type="time"
                                value={editForm.check_out_time || ''}
                                onChange={(e) => setEditForm({...editForm, check_out_time: e.target.value})}
                                className="w-full border rounded-lg px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 mb-1 block">ملاحظات</label>
                              <input
                                type="text"
                                value={editForm.notes || ''}
                                onChange={(e) => setEditForm({...editForm, notes: e.target.value})}
                                className="w-full border rounded-lg px-3 py-2 text-sm"
                                placeholder="ملاحظات..."
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3 justify-end">
                            <button
                              onClick={() => { setEditingRecord(null); setEditForm({}); }}
                              className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-300 flex items-center gap-1"
                            >
                              <X className="w-4 h-4" /> إلغاء
                            </button>
                            <button
                              onClick={() => handleUpdateRecord(record.id)}
                              className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 flex items-center gap-1"
                            >
                              <Save className="w-4 h-4" /> حفظ
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-center gap-3 mb-6">
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="border rounded-lg px-3 py-2"
              />
              <button
                onClick={exportCSV}
                className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600 flex items-center gap-1"
              >
                <Download className="w-4 h-4" /> تصدير CSV
              </button>
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-400">جاري التحميل...</div>
            ) : !monthlyReport || monthlyReport.report.length === 0 ? (
              <div className="text-center py-12 text-gray-400">لا توجد بيانات للشهر المحدد</div>
            ) : (
              <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="px-4 py-3 text-right font-medium text-gray-600">المدرب</th>
                        <th className="px-4 py-3 text-center font-medium text-green-600">أيام الحضور</th>
                        <th className="px-4 py-3 text-center font-medium text-red-600">أيام الغياب</th>
                        <th className="px-4 py-3 text-center font-medium text-yellow-600">أيام الإجازة</th>
                        <th className="px-4 py-3 text-center font-medium text-blue-600">إجمالي الساعات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyReport.report.map(r => (
                        <tr key={r.coach_id} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">{r.coach_name}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-bold">
                              {r.present_days}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold">
                              {r.absent_days}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs font-bold">
                              {r.leave_days}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-bold">
                              {r.total_hours}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {showAbsentModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-6 w-full max-w-md" dir="rtl">
              <h3 className="text-lg font-bold mb-4">تسجيل غياب / إجازة</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-600 mb-2 block">النوع</label>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value="absent"
                        checked={absentStatus === 'absent'}
                        onChange={(e) => setAbsentStatus(e.target.value)}
                        className="text-orange-500"
                      />
                      <span className="text-sm">غياب</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value="leave"
                        checked={absentStatus === 'leave'}
                        onChange={(e) => setAbsentStatus(e.target.value)}
                        className="text-orange-500"
                      />
                      <span className="text-sm">إجازة</span>
                    </label>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">السبب (اختياري)</label>
                  <textarea
                    value={absentReason}
                    onChange={(e) => setAbsentReason(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    rows={3}
                    placeholder="سبب الغياب أو الإجازة..."
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-6 justify-end">
                <button
                  onClick={() => { setShowAbsentModal(null); setAbsentReason(''); setAbsentStatus('absent'); }}
                  className="px-4 py-2 bg-gray-200 text-gray-600 rounded-lg text-sm"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleMarkAbsent}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600"
                >
                  تأكيد
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default CoachAttendancePage;
