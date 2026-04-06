import React, { useState, useEffect, useCallback, useRef } from 'react';
import Layout from '../components/Layout';
import { 
  Clock, LogIn, LogOut, UserX, Calendar, ChevronLeft, ChevronRight,
  FileText, Download, Edit2, Trash2, Save, X, AlertCircle, CheckCircle,
  Users, Timer, CalendarDays, UserPlus, Phone, Mail, QrCode, Printer
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
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
  const [showAddCoach, setShowAddCoach] = useState(false);
  const [addCoachForm, setAddCoachForm] = useState({ name: '', phone: '', email: '', specialization: '', name_en: '' });
  const [addingCoach, setAddingCoach] = useState(false);
  const [editingCoach, setEditingCoach] = useState(null);
  const [editCoachForm, setEditCoachForm] = useState({ name: '', phone: '', email: '', specialization: '', name_en: '' });
  const [savingCoach, setSavingCoach] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [qrCoach, setQrCoach] = useState(null); // coach whose QR is being shown
  const qrRef = useRef(null);
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

  const handleAddCoach = async () => {
    if (!addCoachForm.name.trim()) {
      showToast('يرجى إدخال اسم المدرب', 'error');
      return;
    }
    if (!addCoachForm.phone.trim()) {
      showToast('يرجى إدخال رقم الجوال', 'error');
      return;
    }
    setAddingCoach(true);
    try {
      const token = localStorage.getItem('token');
      const branchId = branchFilter !== 'all' ? branchFilter : null;
      await axios.post('/api/coaches', {
        name: addCoachForm.name_en.trim() || addCoachForm.name.trim(),
        name_ar: addCoachForm.name.trim(),
        phone: addCoachForm.phone.trim(),
        email: addCoachForm.email.trim(),
        activities: addCoachForm.specialization ? [addCoachForm.specialization.trim()] : [],
        notes: '',
        branch_id: branchId
      }, { headers: { Authorization: `Bearer ${token}` } });
      showToast('تم إضافة المدرب بنجاح');
      setShowAddCoach(false);
      setAddCoachForm({ name: '', phone: '', email: '', specialization: '', name_en: '' });
      fetchData();
    } catch (error) {
      showToast(error.response?.data?.detail || 'حدث خطأ أثناء إضافة المدرب', 'error');
    } finally {
      setAddingCoach(false);
    }
  };

  const openEditCoach = (coach) => {
    setEditingCoach(coach);
    setEditCoachForm({
      name: coach.name_ar || coach.name || '',
      name_en: coach.name || '',
      phone: coach.phone || '',
      email: coach.email || '',
      specialization: (coach.activities || []).join(', ')
    });
  };

  const handleEditCoach = async () => {
    if (!editCoachForm.name.trim()) {
      showToast('يرجى إدخال اسم المدرب', 'error');
      return;
    }
    setSavingCoach(true);
    try {
      const token = localStorage.getItem('token');
      await axios.put(`/api/coaches/${editingCoach.id}`, {
        name: editCoachForm.name_en.trim() || editCoachForm.name.trim(),
        name_ar: editCoachForm.name.trim(),
        phone: editCoachForm.phone.trim(),
        email: editCoachForm.email.trim(),
        activities: editCoachForm.specialization ? editCoachForm.specialization.split(',').map(s => s.trim()).filter(Boolean) : [],
        notes: editingCoach.notes || '',
        branch_id: editingCoach.branch_id || null
      }, { headers: { Authorization: `Bearer ${token}` } });
      showToast('تم تعديل بيانات المدرب بنجاح');
      setEditingCoach(null);
      fetchData();
    } catch (error) {
      showToast(error.response?.data?.detail || 'حدث خطأ أثناء تعديل المدرب', 'error');
    } finally {
      setSavingCoach(false);
    }
  };

  const handleDeleteCoach = async (coachId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/coaches/${coachId}`, { headers: { Authorization: `Bearer ${token}` } });
      showToast('تم حذف المدرب بنجاح');
      setDeleteConfirm(null);
      fetchData();
    } catch (error) {
      showToast(error.response?.data?.detail || 'حدث خطأ أثناء حذف المدرب', 'error');
    }
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

        {showAddCoach && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAddCoach(false)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-orange-500" />
                  إضافة مدرب جديد
                </h2>
                <button onClick={() => setShowAddCoach(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">اسم المدرب (عربي) *</label>
                  <input
                    type="text"
                    value={addCoachForm.name}
                    onChange={e => setAddCoachForm({...addCoachForm, name: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="مثال: أحمد محمد"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">اسم المدرب (إنجليزي)</label>
                  <input
                    type="text"
                    value={addCoachForm.name_en}
                    onChange={e => setAddCoachForm({...addCoachForm, name_en: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="مثال: Ahmed Mohammed"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Phone className="w-4 h-4 inline ml-1" />
                    رقم الجوال *
                  </label>
                  <input
                    type="tel"
                    value={addCoachForm.phone}
                    onChange={e => setAddCoachForm({...addCoachForm, phone: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="05XXXXXXXX"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Mail className="w-4 h-4 inline ml-1" />
                    البريد الإلكتروني
                  </label>
                  <input
                    type="email"
                    value={addCoachForm.email}
                    onChange={e => setAddCoachForm({...addCoachForm, email: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="coach@example.com"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">التخصص</label>
                  <input
                    type="text"
                    value={addCoachForm.specialization}
                    onChange={e => setAddCoachForm({...addCoachForm, specialization: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="مثال: كرة قدم، سباحة، لياقة بدنية"
                  />
                </div>
              </div>
              <div className="flex gap-3 p-5 border-t bg-gray-50 rounded-b-xl">
                <button
                  onClick={handleAddCoach}
                  disabled={addingCoach}
                  className="flex-1 bg-orange-500 text-white py-2.5 rounded-lg font-medium hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {addingCoach ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <UserPlus className="w-5 h-5" />
                  )}
                  {addingCoach ? 'جاري الإضافة...' : 'إضافة المدرب'}
                </button>
                <button
                  onClick={() => setShowAddCoach(false)}
                  className="px-6 py-2.5 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        )}

        {editingCoach && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingCoach(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <Edit2 className="w-5 h-5 text-blue-500" />
                  تعديل بيانات المدرب
                </h2>
                <button onClick={() => setEditingCoach(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">اسم المدرب (عربي) *</label>
                  <input
                    type="text"
                    value={editCoachForm.name}
                    onChange={e => setEditCoachForm({...editCoachForm, name: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">اسم المدرب (إنجليزي)</label>
                  <input
                    type="text"
                    value={editCoachForm.name_en}
                    onChange={e => setEditCoachForm({...editCoachForm, name_en: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">رقم الجوال *</label>
                  <input
                    type="tel"
                    value={editCoachForm.phone}
                    onChange={e => setEditCoachForm({...editCoachForm, phone: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">البريد الإلكتروني</label>
                  <input
                    type="email"
                    value={editCoachForm.email}
                    onChange={e => setEditCoachForm({...editCoachForm, email: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">التخصص</label>
                  <input
                    type="text"
                    value={editCoachForm.specialization}
                    onChange={e => setEditCoachForm({...editCoachForm, specialization: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="مثال: كرة قدم, سباحة"
                  />
                </div>
              </div>
              <div className="flex gap-3 p-5 border-t bg-gray-50 rounded-b-xl">
                <button
                  onClick={handleEditCoach}
                  disabled={savingCoach}
                  className="flex-1 bg-blue-500 text-white py-2.5 rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {savingCoach ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save className="w-5 h-5" />
                  )}
                  {savingCoach ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
                <button
                  onClick={() => setEditingCoach(null)}
                  className="px-6 py-2.5 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="p-6 text-center">
                <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-7 h-7 text-red-500" />
                </div>
                <h3 className="text-lg font-bold text-gray-800 mb-2">حذف المدرب</h3>
                <p className="text-gray-500 text-sm mb-1">هل أنت متأكد من حذف المدرب:</p>
                <p className="font-bold text-gray-800 mb-4">{deleteConfirm.name_ar || deleteConfirm.name}؟</p>
                <p className="text-xs text-red-500 mb-4">سيتم حذف المدرب نهائياً ولن يمكن استرجاعه</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDeleteCoach(deleteConfirm.id)}
                    className="flex-1 bg-red-500 text-white py-2.5 rounded-lg font-medium hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    نعم، احذف
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="flex-1 bg-gray-200 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Clock className="w-7 h-7 text-orange-500" />
              حضور المدربين
            </h1>
            <button
              onClick={() => setShowAddCoach(true)}
              className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-green-600 transition-colors flex items-center gap-1"
            >
              <UserPlus className="w-4 h-4" />
              إضافة مدرب
            </button>
          </div>
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
                            <div className="flex items-center gap-1 mr-2">
                              <button
                                onClick={() => setQrCoach(coach)}
                                className="p-1 text-gray-400 hover:text-orange-500 rounded hover:bg-orange-50"
                                title="رمز QR للمدرب"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => openEditCoach(coach)}
                                className="p-1 text-gray-400 hover:text-blue-500 rounded hover:bg-blue-50"
                                title="تعديل المدرب"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(coach)}
                                className="p-1 text-gray-400 hover:text-red-500 rounded hover:bg-red-50"
                                title="حذف المدرب"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
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

      {/* ══ QR Card Modal (member-card style) ══ */}
      {qrCoach && (() => {
        const qrUrl = `${window.location.origin}/coach-qr/${qrCoach.id}`;
        const coachName = qrCoach.name_ar || qrCoach.name;
        const origin = window.location.origin;

        const handlePrint = () => {
          const win = window.open('', '_blank', 'width=900,height=700');
          win.document.write(`<!DOCTYPE html><html><head>
            <meta charset="UTF-8">
            <title>كارت المدرب - ${coachName}</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
              @page { size: A4; margin: 0mm; }
              * { margin:0; padding:0; box-sizing:border-box; }
              body { font-family:'Tajawal',Arial,sans-serif; background:#f3f4f6; direction:rtl; }
              .screen-only { padding:20px; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; }
              @media print { .screen-only { display:none !important; } .print-area { display:flex !important; position:absolute; top:10mm; right:15mm; gap:5mm; } }
              @media screen { .print-area { display:none; } }
              .sticker-preview { display:flex; gap:15px; justify-content:center; margin-bottom:20px; }
              .card { width:90mm; height:60mm; background:white; border-radius:4mm; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,.1); display:flex; flex-direction:column; }
              .card-header { background:linear-gradient(135deg,#F97316,#F59E0B); padding:1.5mm 2mm; display:flex; justify-content:space-between; align-items:center; color:white; }
              .header-text h2 { font-size:7pt; font-weight:700; margin:0; line-height:1.3; }
              .header-text p { font-size:5.5pt; opacity:.9; margin:0; }
              .header-logo { width:10mm; height:10mm; border-radius:50%; background:white; padding:.5mm; display:flex; align-items:center; justify-content:center; }
              .header-logo img { width:100%; height:100%; object-fit:contain; border-radius:50%; }
              .card-body { padding:2mm; display:flex; gap:2mm; flex:1; }
              .info-section { flex:1; text-align:right; overflow:hidden; }
              .qr-container { display:flex; flex-direction:column; align-items:center; }
              .qr-section { width:28mm; height:28mm; background:white; border:1px solid #eee; border-radius:2mm; padding:.5mm; }
              .qr-section img { width:100%; height:100%; }
              .qr-label { text-align:center; font-size:5.5pt; color:#F97316; margin-top:1mm; font-weight:600; }
              .coach-name { font-size:10pt; font-weight:700; color:#1f2937; margin-bottom:1.5mm; }
              .coach-label { color:#6b7280; font-size:6pt; margin-bottom:.3mm; }
              .info-row { display:flex; align-items:center; gap:1mm; margin-bottom:.8mm; font-size:7pt; }
              .info-label { color:#6b7280; font-size:6pt; }
              .badge { background:#FFF7ED; color:#F97316; font-weight:700; font-size:7pt; padding:.5mm 1.5mm; border-radius:2mm; border:1px solid #FED7AA; display:inline-block; margin-bottom:1mm; }
              .card-footer { text-align:center; padding:1.5mm 2mm; background:#FFF7ED; font-size:6pt; color:#92400E; border-top:1px solid #FED7AA; font-weight:600; }
              .logo-card { width:90mm; height:60mm; background:white; border-radius:4mm; overflow:hidden; box-shadow:0 4px 15px rgba(0,0,0,.1); display:flex; flex-direction:column; align-items:center; justify-content:center; padding:3mm; }
              .logo-card img { max-width:100%; max-height:55%; object-fit:contain; }
              .logo-card .contact-info { font-size:7pt; color:#374151; text-align:center; margin-top:2mm; font-weight:600; line-height:1.6; }
              .print-btn { margin-top:20px; padding:12px 30px; background:linear-gradient(135deg,#F97316,#EA580C); color:white; border:none; border-radius:10px; cursor:pointer; font-family:'Tajawal',Arial,sans-serif; font-size:16px; font-weight:bold; }
              .position-labels { display:flex; gap:15px; justify-content:center; margin-top:10px; }
              .position-label { padding:8px 16px; background:#FEF3C7; border-radius:8px; color:#92400E; font-size:12px; }
            </style></head><body>
            <div class="screen-only">
              <p style="font-size:18px;margin-bottom:20px;">📋 معاينة الطباعة - كارت المدرب + شعار الأكاديمية</p>
              <div class="sticker-preview">
                <div class="card">
                  <div class="card-header">
                    <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
                    <div class="header-logo"><img src="${origin}/images/academy-logo.png" alt="logo"/></div>
                  </div>
                  <div class="card-body">
                    <div class="qr-container">
                      <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}" /></div>
                      <div class="qr-label">تسجيل الحضور/الانصراف</div>
                    </div>
                    <div class="info-section">
                      <div class="coach-label">المدرب</div>
                      <div class="coach-name">${coachName}</div>
                      ${qrCoach.phone ? `<div class="info-row"><span class="info-label">الجوال:</span><span>${qrCoach.phone}</span></div>` : ''}
                      ${qrCoach.specialization ? `<div class="badge">🏅 ${qrCoach.specialization}</div>` : ''}
                    </div>
                  </div>
                  <div class="card-footer">امسح رمز QR لتسجيل الحضور أو الانصراف</div>
                </div>
                <div class="logo-card">
                  <img src="${origin}/images/academy-logo.png" alt="شعار الأكاديمية"/>
                  <div class="contact-info">📞 0566238384</div>
                </div>
              </div>
              <div class="position-labels">
                <div class="position-label">📍 خانة 1: كارت المدرب</div>
                <div class="position-label">📍 خانة 2: شعار الأكاديمية</div>
              </div>
              <p style="margin-top:10px;color:#6b7280;font-size:14px;">📐 حجم كل كرت: 9سم × 6سم</p>
              <button class="print-btn" onclick="window.print()">🖨️ طباعة الكارت</button>
            </div>
            <div class="print-area">
              <div class="card">
                <div class="card-header">
                  <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
                  <div class="header-logo"><img src="${origin}/images/academy-logo.png" alt="logo"/></div>
                </div>
                <div class="card-body">
                  <div class="qr-container">
                    <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}" /></div>
                    <div class="qr-label">تسجيل الحضور/الانصراف</div>
                  </div>
                  <div class="info-section">
                    <div class="coach-label">المدرب</div>
                    <div class="coach-name">${coachName}</div>
                    ${qrCoach.phone ? `<div class="info-row"><span class="info-label">الجوال:</span><span>${qrCoach.phone}</span></div>` : ''}
                    ${qrCoach.specialization ? `<div class="badge">🏅 ${qrCoach.specialization}</div>` : ''}
                  </div>
                </div>
                <div class="card-footer">امسح رمز QR لتسجيل الحضور أو الانصراف</div>
              </div>
              <div class="logo-card">
                <img src="${origin}/images/academy-logo.png" alt="شعار الأكاديمية"/>
                <div class="contact-info">📞 0566238384</div>
              </div>
            </div>
          </body></html>`);
          win.document.close();
        };

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" dir="rtl">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              {/* Dialog Header */}
              <div className="bg-gradient-to-l from-orange-500 to-amber-500 px-5 py-4 flex items-center justify-between">
                <h2 className="text-white font-bold text-lg flex items-center gap-2">
                  <QrCode className="w-5 h-5" /> كارت المدرب
                </h2>
                <button onClick={() => setQrCoach(null)} className="text-white/80 hover:text-white rounded-full p-1 hover:bg-white/20">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Card Preview — matches the printed card exactly */}
              <div className="p-5" ref={qrRef}>
                <div className="border-2 border-orange-200 rounded-xl overflow-hidden shadow-md" style={{ direction: 'rtl' }}>
                  {/* Card Header */}
                  <div className="flex items-center justify-between px-3 py-2" style={{ background: 'linear-gradient(135deg,#F97316,#F59E0B)' }}>
                    <div>
                      <p className="text-white font-bold text-xs leading-tight">شركة اداء الابطال العالمية للرياضة</p>
                      <p className="text-orange-100 text-[10px]">Global Champions Sports Performance</p>
                    </div>
                    <img src="/images/academy-logo.png" alt="logo" className="w-10 h-10 rounded-full bg-white p-0.5 object-contain" />
                  </div>

                  {/* Card Body */}
                  <div className="flex gap-3 p-3 bg-white">
                    {/* QR Side */}
                    <div className="flex flex-col items-center shrink-0">
                      <div className="border border-gray-200 rounded-lg p-1 bg-white">
                        <QRCodeSVG value={qrUrl} size={100} level="M" includeMargin={false} fgColor="#1a1a1a" />
                      </div>
                      <p className="text-[10px] text-orange-500 font-semibold mt-1 text-center">تسجيل الحضور/الانصراف</p>
                    </div>

                    {/* Info Side */}
                    <div className="flex-1 text-right">
                      <p className="text-[10px] text-gray-400">المدرب</p>
                      <p className="font-bold text-gray-800 text-sm leading-tight mb-1">{coachName}</p>
                      {qrCoach.phone && (
                        <div className="text-[11px] text-gray-600 mb-1">
                          <span className="text-gray-400 text-[10px]">الجوال: </span>{qrCoach.phone}
                        </div>
                      )}
                      {qrCoach.specialization && (
                        <span className="inline-block bg-orange-50 border border-orange-200 text-orange-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                          🏅 {qrCoach.specialization}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="bg-orange-50 px-3 py-1.5 text-center text-[10px] text-orange-700 font-medium border-t border-orange-100">
                    امسح رمز QR لتسجيل الحضور أو الانصراف
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="px-5 pb-5 flex gap-3">
                <button
                  onClick={handlePrint}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors"
                >
                  <Printer className="w-4 h-4" /> طباعة الكارت
                </button>
                <button
                  onClick={() => setQrCoach(null)}
                  className="px-5 py-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </Layout>
  );
};

export default CoachAttendancePage;
