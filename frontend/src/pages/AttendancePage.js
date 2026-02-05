import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';
import { activitiesAPI, attendanceAPI, branchesAPI, schedulesAPI } from '../services/api';
import { QRCodeSVG } from 'qrcode.react';
import { Check, X, Users, Calendar, QrCode, FileSpreadsheet, Search, Clock, UserCheck, UserX, CalendarDays } from 'lucide-react';

export default function AttendancePage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const t = (ar, en) => language === 'ar' ? ar : en;

  // State
  const [activities, setActivities] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedActivityId, setSelectedActivityId] = useState(searchParams.get('activity_id') || '');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceData, setAttendanceData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState({});
  const [todaySessions, setTodaySessions] = useState([]);
  
  // QR Scanner Dialog
  const [isQRDialogOpen, setIsQRDialogOpen] = useState(false);
  const [qrActivityId, setQrActivityId] = useState('');
  const [qrScanResult, setQrScanResult] = useState(null);
  const [manualMemberId, setManualMemberId] = useState('');
  
  // Report Dialog
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [reportType, setReportType] = useState('activity');
  const [reportDateRange, setReportDateRange] = useState({ start: '', end: '' });

  // Tab state
  const [activeTab, setActiveTab] = useState('record'); // record, qr, reports

  // Day mapping for today's sessions
  const dayMap = {
    0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
    4: 'thursday', 5: 'friday', 6: 'saturday'
  };

  // Fetch today's sessions from schedule
  const fetchTodaySessions = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId) params.branch_id = selectedBranchId;
      const res = await schedulesAPI.getWeekly(params);
      const today = dayMap[new Date().getDay()];
      setTodaySessions(res.data[today] || []);
    } catch (error) {
      console.error('Error fetching today sessions:', error);
    }
  }, [selectedBranchId]);

  // Fetch activities and branches
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [activitiesRes, branchesRes] = await Promise.all([
          activitiesAPI.getAll(),
          branchesAPI.getAll()
        ]);
        setActivities(activitiesRes.data);
        setBranches(branchesRes.data);
        
        // Set default branch if user has one
        if (user?.branch_id) {
          setSelectedBranchId(user.branch_id);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    fetchData();
  }, [user]);

  // Fetch attendance for selected activity and date
  const fetchAttendance = useCallback(async () => {
    if (!selectedActivityId || !selectedDate) return;
    
    setLoading(true);
    try {
      const res = await attendanceAPI.getByActivity(selectedActivityId, selectedDate);
      setAttendanceData(res.data);
      
      // Initialize local state for attendance records
      const initialRecords = {};
      res.data.members.forEach(m => {
        initialRecords[m.member_id] = {
          status: m.status || null,
          notes: m.notes || ''
        };
      });
      setAttendanceRecords(initialRecords);
    } catch (error) {
      toast.error(t('خطأ في جلب بيانات الحضور', 'Error fetching attendance'));
    } finally {
      setLoading(false);
    }
  }, [selectedActivityId, selectedDate]);

  // Remove auto-fetch - only fetch when button is clicked
  // This prevents infinite loop caused by useCallback dependency changes

  // Handle attendance status change
  const handleStatusChange = (memberId, status) => {
    setAttendanceRecords(prev => ({
      ...prev,
      [memberId]: { ...prev[memberId], status }
    }));
  };

  // Save all attendance
  const handleSaveAttendance = async () => {
    const records = Object.entries(attendanceRecords)
      .filter(([_, rec]) => rec.status !== null)
      .map(([memberId, rec]) => ({
        member_id: memberId,
        status: rec.status,
        notes: rec.notes
      }));

    if (records.length === 0) {
      toast.error(t('لم يتم تحديد أي حضور', 'No attendance selected'));
      return;
    }

    try {
      await attendanceAPI.recordBulk({
        activity_id: selectedActivityId,
        date: selectedDate,
        records
      });
      toast.success(t(`تم حفظ حضور ${records.length} عضو`, `Saved attendance for ${records.length} members`));
      fetchAttendance();
    } catch (error) {
      toast.error(t('خطأ في حفظ الحضور', 'Error saving attendance'));
    }
  };

  // Mark all as present
  const handleMarkAllPresent = () => {
    if (!attendanceData?.members) return;
    const newRecords = {};
    attendanceData.members.forEach(m => {
      newRecords[m.member_id] = { status: 'present', notes: '' };
    });
    setAttendanceRecords(newRecords);
  };

  // Mark all as absent
  const handleMarkAllAbsent = () => {
    if (!attendanceData?.members) return;
    const newRecords = {};
    attendanceData.members.forEach(m => {
      newRecords[m.member_id] = { status: 'absent', notes: '' };
    });
    setAttendanceRecords(newRecords);
  };

  // QR Check-in
  const handleQRCheckin = async () => {
    if (!manualMemberId || !qrActivityId) {
      toast.error(t('يرجى إدخال رقم العضو واختيار النشاط', 'Please enter member ID and select activity'));
      return;
    }

    try {
      const res = await attendanceAPI.qrCheckin(manualMemberId, qrActivityId);
      setQrScanResult(res.data);
      if (res.data.already_checked_in) {
        toast.info(t('تم تسجيل الحضور مسبقاً', 'Already checked in'));
      } else {
        toast.success(t('تم تسجيل الحضور بنجاح', 'Check-in successful'));
      }
      setManualMemberId('');
    } catch (error) {
      toast.error(error.response?.data?.detail || t('خطأ في التسجيل', 'Check-in error'));
      setQrScanResult({ error: true, message: error.response?.data?.detail });
    }
  };

  // Fetch report
  const handleFetchReport = async () => {
    if (!selectedActivityId) {
      toast.error(t('يرجى اختيار النشاط', 'Please select activity'));
      return;
    }

    try {
      const params = {};
      if (reportDateRange.start) params.start_date = reportDateRange.start;
      if (reportDateRange.end) params.end_date = reportDateRange.end;
      
      const res = await attendanceAPI.getActivityReport(selectedActivityId, params);
      setReportData(res.data);
      setIsReportDialogOpen(true);
    } catch (error) {
      toast.error(t('خطأ في جلب التقرير', 'Error fetching report'));
    }
  };

  // Export attendance
  const handleExportAttendance = () => {
    const params = {};
    if (selectedActivityId) params.activity_id = selectedActivityId;
    if (selectedBranchId) params.branch_id = selectedBranchId;
    if (reportDateRange.start) params.start_date = reportDateRange.start;
    if (reportDateRange.end) params.end_date = reportDateRange.end;
    
    const url = attendanceAPI.export(params);
    window.open(url, '_blank');
    toast.success(t('جاري تحميل التقرير...', 'Downloading report...'));
  };

  // Get activity name
  const getActivityName = (id) => activities.find(a => a.id === id)?.name || '';

  // Filter activities by branch
  const filteredActivities = selectedBranchId 
    ? activities.filter(a => a.branch_id === selectedBranchId || !a.branch_id)
    : activities;

  return (
    <Layout>
      <div className="p-6 max-w-7xl mx-auto" data-testid="attendance-page">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              📋 {t('تتبع الحضور', 'Attendance Tracking')}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {t('تسجيل ومتابعة حضور الأعضاء', 'Record and track member attendance')}
            </p>
          </div>
          <Button onClick={handleExportAttendance} variant="outline" className="gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            {t('تصدير Excel', 'Export Excel')}
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b pb-2">
          <Button
            variant={activeTab === 'record' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('record')}
            className="gap-2"
          >
            <Users className="w-4 h-4" />
            {t('تسجيل الحضور', 'Record Attendance')}
          </Button>
          <Button
            variant={activeTab === 'qr' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('qr')}
            className="gap-2"
          >
            <QrCode className="w-4 h-4" />
            {t('تسجيل سريع QR', 'QR Check-in')}
          </Button>
          <Button
            variant={activeTab === 'reports' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('reports')}
            className="gap-2"
          >
            <Calendar className="w-4 h-4" />
            {t('التقارير', 'Reports')}
          </Button>
        </div>

        {/* Record Attendance Tab */}
        {activeTab === 'record' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Branch Select */}
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('الفرع', 'Branch')}
                  </label>
                  <select
                    value={selectedBranchId}
                    onChange={e => setSelectedBranchId(e.target.value)}
                    className="w-full border rounded-lg p-2"
                  >
                    <option value="">{t('كل الفروع', 'All Branches')}</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                {/* Activity Select */}
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('النشاط', 'Activity')} *
                  </label>
                  <select
                    value={selectedActivityId}
                    onChange={e => setSelectedActivityId(e.target.value)}
                    className="w-full border rounded-lg p-2"
                    data-testid="activity-select"
                  >
                    <option value="">{t('اختر النشاط', 'Select Activity')}</option>
                    {filteredActivities.map(a => (
                      <option key={a.id} value={a.id}>{a.name_ar || a.name}</option>
                    ))}
                  </select>
                </div>

                {/* Date */}
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('التاريخ', 'Date')} *
                  </label>
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={e => setSelectedDate(e.target.value)}
                    data-testid="date-input"
                  />
                </div>

                {/* Load Button */}
                <div className="flex items-end">
                  <Button 
                    onClick={fetchAttendance} 
                    disabled={!selectedActivityId}
                    className="w-full gap-2"
                    data-testid="load-attendance-btn"
                  >
                    <Search className="w-4 h-4" />
                    {t('تحميل القائمة', 'Load List')}
                  </Button>
                </div>
              </div>
            </div>

            {/* Attendance List */}
            {loading ? (
              <div className="text-center py-10">
                <div className="spinner mx-auto"></div>
                <p className="mt-2 text-gray-500">{t('جاري التحميل...', 'Loading...')}</p>
              </div>
            ) : attendanceData ? (
              <div className="bg-white rounded-lg border shadow-sm">
                {/* Summary Header */}
                <div className="p-4 border-b bg-gray-50 flex justify-between items-center flex-wrap gap-4">
                  <div>
                    <h2 className="font-bold text-lg">{attendanceData.activity?.name}</h2>
                    <p className="text-sm text-gray-500">
                      {selectedDate} • {attendanceData.total_members} {t('عضو', 'members')}
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <div className="text-center px-4 py-2 bg-green-100 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">{attendanceData.present_count}</div>
                      <div className="text-xs text-green-700">{t('حاضر', 'Present')}</div>
                    </div>
                    <div className="text-center px-4 py-2 bg-red-100 rounded-lg">
                      <div className="text-2xl font-bold text-red-600">{attendanceData.absent_count}</div>
                      <div className="text-xs text-red-700">{t('غائب', 'Absent')}</div>
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="p-4 border-b flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={handleMarkAllPresent} className="gap-1 text-green-600 border-green-300">
                    <UserCheck className="w-4 h-4" />
                    {t('الكل حاضر', 'All Present')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleMarkAllAbsent} className="gap-1 text-red-600 border-red-300">
                    <UserX className="w-4 h-4" />
                    {t('الكل غائب', 'All Absent')}
                  </Button>
                </div>

                {/* Members List */}
                <div className="divide-y max-h-[500px] overflow-y-auto">
                  {attendanceData.members?.map((member, idx) => (
                    <div 
                      key={member.member_id} 
                      className={`p-4 flex items-center justify-between hover:bg-gray-50 ${
                        attendanceRecords[member.member_id]?.status === 'present' ? 'bg-green-50' :
                        attendanceRecords[member.member_id]?.status === 'absent' ? 'bg-red-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold">
                          {idx + 1}
                        </span>
                        <div>
                          <div className="font-medium">{member.member_name}</div>
                          <div className="text-xs text-gray-500">{member.phone}</div>
                        </div>
                        {member.subscription_status !== 'active' && (
                          <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">
                            {t('اشتراك غير نشط', 'Inactive')}
                          </span>
                        )}
                        {member.recorded && (
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                            {t('مسجل', 'Recorded')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant={attendanceRecords[member.member_id]?.status === 'present' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => handleStatusChange(member.member_id, 'present')}
                          className={`gap-1 ${attendanceRecords[member.member_id]?.status === 'present' ? 'bg-green-600 hover:bg-green-700' : 'text-green-600 border-green-300'}`}
                          data-testid={`present-btn-${member.member_id}`}
                        >
                          <Check className="w-4 h-4" />
                          {t('حاضر', 'Present')}
                        </Button>
                        <Button
                          variant={attendanceRecords[member.member_id]?.status === 'absent' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => handleStatusChange(member.member_id, 'absent')}
                          className={`gap-1 ${attendanceRecords[member.member_id]?.status === 'absent' ? 'bg-red-600 hover:bg-red-700' : 'text-red-600 border-red-300'}`}
                          data-testid={`absent-btn-${member.member_id}`}
                        >
                          <X className="w-4 h-4" />
                          {t('غائب', 'Absent')}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {attendanceData.members?.length === 0 && (
                    <div className="p-8 text-center text-gray-500">
                      {t('لا يوجد أعضاء مسجلين في هذا النشاط', 'No members enrolled in this activity')}
                    </div>
                  )}
                </div>

                {/* Save Button */}
                {attendanceData.members?.length > 0 && (
                  <div className="p-4 border-t bg-gray-50">
                    <Button onClick={handleSaveAttendance} className="w-full gap-2" data-testid="save-attendance-btn">
                      <Check className="w-4 h-4" />
                      {t('حفظ الحضور', 'Save Attendance')}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg border p-10 text-center text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t('اختر النشاط والتاريخ لعرض قائمة الأعضاء', 'Select activity and date to view members list')}</p>
              </div>
            )}
          </div>
        )}

        {/* QR Check-in Tab */}
        {activeTab === 'qr' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* QR Scanner Section */}
            <div className="bg-white p-6 rounded-lg border shadow-sm">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <QrCode className="w-5 h-5" />
                {t('تسجيل سريع', 'Quick Check-in')}
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('النشاط', 'Activity')} *
                  </label>
                  <select
                    value={qrActivityId}
                    onChange={e => setQrActivityId(e.target.value)}
                    className="w-full border rounded-lg p-2"
                  >
                    <option value="">{t('اختر النشاط', 'Select Activity')}</option>
                    {activities.map(a => (
                      <option key={a.id} value={a.id}>{a.name_ar || a.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('رقم العضوية', 'Member ID')}
                  </label>
                  <Input
                    value={manualMemberId}
                    onChange={e => setManualMemberId(e.target.value)}
                    placeholder={t('أدخل رقم العضوية أو امسح QR', 'Enter member ID or scan QR')}
                    onKeyPress={e => e.key === 'Enter' && handleQRCheckin()}
                  />
                </div>

                <Button 
                  onClick={handleQRCheckin} 
                  disabled={!qrActivityId || !manualMemberId}
                  className="w-full gap-2"
                >
                  <UserCheck className="w-4 h-4" />
                  {t('تسجيل الحضور', 'Check-in')}
                </Button>
              </div>

              {/* Result */}
              {qrScanResult && (
                <div className={`mt-4 p-4 rounded-lg ${qrScanResult.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                  {qrScanResult.error ? (
                    <div className="flex items-center gap-2">
                      <X className="w-5 h-5" />
                      <span>{qrScanResult.message}</span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Check className="w-5 h-5" />
                        <span className="font-bold">{qrScanResult.message}</span>
                      </div>
                      <div className="text-sm">
                        <p>{t('العضو', 'Member')}: {qrScanResult.member_name}</p>
                        <p>{t('النشاط', 'Activity')}: {qrScanResult.activity_name}</p>
                        <p>{t('الوقت', 'Time')}: {qrScanResult.check_in_time}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* QR Code Generator */}
            <div className="bg-white p-6 rounded-lg border shadow-sm">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <QrCode className="w-5 h-5" />
                {t('رمز QR للنشاط', 'Activity QR Code')}
              </h2>
              
              {qrActivityId ? (
                <div className="text-center">
                  <div className="bg-white p-4 inline-block rounded-lg border">
                    <QRCodeSVG 
                      value={JSON.stringify({ activity_id: qrActivityId, type: 'attendance' })}
                      size={200}
                      level="H"
                    />
                  </div>
                  <p className="mt-3 font-medium">{getActivityName(qrActivityId)}</p>
                  <p className="text-sm text-gray-500">
                    {t('امسح هذا الرمز لتسجيل الحضور', 'Scan this code to check-in')}
                  </p>
                </div>
              ) : (
                <div className="text-center py-10 text-gray-500">
                  <QrCode className="w-16 h-16 mx-auto mb-3 opacity-30" />
                  <p>{t('اختر النشاط لإنشاء رمز QR', 'Select activity to generate QR code')}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div className="space-y-4">
            {/* Report Filters */}
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h2 className="font-bold mb-4">{t('تقرير الحضور', 'Attendance Report')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('النشاط', 'Activity')}
                  </label>
                  <select
                    value={selectedActivityId}
                    onChange={e => setSelectedActivityId(e.target.value)}
                    className="w-full border rounded-lg p-2"
                  >
                    <option value="">{t('اختر النشاط', 'Select Activity')}</option>
                    {activities.map(a => (
                      <option key={a.id} value={a.id}>{a.name_ar || a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('من تاريخ', 'From Date')}
                  </label>
                  <Input
                    type="date"
                    value={reportDateRange.start}
                    onChange={e => setReportDateRange(prev => ({ ...prev, start: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('إلى تاريخ', 'To Date')}
                  </label>
                  <Input
                    type="date"
                    value={reportDateRange.end}
                    onChange={e => setReportDateRange(prev => ({ ...prev, end: e.target.value }))}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleFetchReport} disabled={!selectedActivityId} className="w-full gap-2">
                    <Search className="w-4 h-4" />
                    {t('عرض التقرير', 'Show Report')}
                  </Button>
                </div>
                <div className="flex items-end">
                  <Button onClick={handleExportAttendance} variant="outline" className="w-full gap-2">
                    <FileSpreadsheet className="w-4 h-4" />
                    {t('تصدير', 'Export')}
                  </Button>
                </div>
              </div>
            </div>

            {/* Report Data */}
            {reportData && (
              <div className="bg-white rounded-lg border shadow-sm">
                {/* Summary */}
                <div className="p-4 border-b bg-gray-50">
                  <h3 className="font-bold text-lg mb-3">{reportData.activity?.name}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 p-3 rounded-lg text-center">
                      <div className="text-2xl font-bold text-blue-600">{reportData.total_records}</div>
                      <div className="text-xs text-gray-600">{t('إجمالي السجلات', 'Total Records')}</div>
                    </div>
                    <div className="bg-green-50 p-3 rounded-lg text-center">
                      <div className="text-2xl font-bold text-green-600">{reportData.total_present}</div>
                      <div className="text-xs text-gray-600">{t('حضور', 'Present')}</div>
                    </div>
                    <div className="bg-red-50 p-3 rounded-lg text-center">
                      <div className="text-2xl font-bold text-red-600">{reportData.total_absent}</div>
                      <div className="text-xs text-gray-600">{t('غياب', 'Absent')}</div>
                    </div>
                    <div className="bg-purple-50 p-3 rounded-lg text-center">
                      <div className="text-2xl font-bold text-purple-600">
                        {reportData.total_records > 0 
                          ? Math.round(reportData.total_present / reportData.total_records * 100) 
                          : 0}%
                      </div>
                      <div className="text-xs text-gray-600">{t('نسبة الحضور', 'Attendance Rate')}</div>
                    </div>
                  </div>
                </div>

                {/* Member Stats */}
                <div className="p-4">
                  <h4 className="font-semibold mb-3">{t('إحصائيات الأعضاء', 'Member Statistics')}</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="p-3 text-right">{t('العضو', 'Member')}</th>
                          <th className="p-3 text-center">{t('حضور', 'Present')}</th>
                          <th className="p-3 text-center">{t('غياب', 'Absent')}</th>
                          <th className="p-3 text-center">{t('الإجمالي', 'Total')}</th>
                          <th className="p-3 text-center">{t('النسبة', 'Rate')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {reportData.member_stats?.map(stat => (
                          <tr key={stat.member_id} className="hover:bg-gray-50">
                            <td className="p-3">{stat.member_name}</td>
                            <td className="p-3 text-center text-green-600 font-medium">{stat.present}</td>
                            <td className="p-3 text-center text-red-600 font-medium">{stat.absent}</td>
                            <td className="p-3 text-center">{stat.total}</td>
                            <td className="p-3 text-center">
                              <span className={`px-2 py-1 rounded text-sm font-medium ${
                                stat.attendance_rate >= 80 ? 'bg-green-100 text-green-700' :
                                stat.attendance_rate >= 50 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {stat.attendance_rate}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Daily Stats */}
                {reportData.date_stats?.length > 0 && (
                  <div className="p-4 border-t">
                    <h4 className="font-semibold mb-3">{t('إحصائيات يومية', 'Daily Statistics')}</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                      {reportData.date_stats?.slice(0, 12).map(stat => (
                        <div key={stat.date} className="border rounded p-2 text-center text-sm">
                          <div className="font-medium">{stat.date}</div>
                          <div className="flex justify-center gap-2 mt-1">
                            <span className="text-green-600">{stat.present}✓</span>
                            <span className="text-red-600">{stat.absent}✗</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
