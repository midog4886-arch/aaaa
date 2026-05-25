import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, Plus, Trash2, FileText, CheckCircle, RotateCcw, Save, Loader, X, AlertTriangle, BarChart3, Download, FileSpreadsheet, ChevronDown, ChevronLeft } from 'lucide-react';
import { coachSalariesAPI, coachAdvancesAPI, coachesAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';

const todayMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const todayDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Toast = ({ msg, type, onClose }) => {
  if (!msg) return null;
  const bg = type === 'error' ? 'bg-red-500' : 'bg-green-500';
  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 ${bg} text-white px-5 py-3 rounded-lg shadow-lg z-[1000]`}>
      <div className="flex items-center gap-3">
        <span>{msg}</span>
        <button onClick={onClose} className="hover:opacity-80"><X className="w-4 h-4" /></button>
      </div>
    </div>
  );
};

const CoachSalariesPage = () => {
  const { user, isAdmin } = useAuth();
  const branchFilter = localStorage.getItem('selectedBranch') || 'all';

  const [tab, setTab] = useState('salaries');
  const [month, setMonth] = useState(todayMonth());
  const [rows, setRows] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(false);
  const defaultFromMonth = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const [reportFrom, setReportFrom] = useState(defaultFromMonth());
  const [reportTo, setReportTo] = useState(todayMonth());
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [expandedCoach, setExpandedCoach] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [advanceForm, setAdvanceForm] = useState({ coach_id: '', advance_date: todayDate(), amount: '', payment_method: 'cash', notes: '' });
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchSalaries = async () => {
    setLoading(true);
    try {
      const res = await coachSalariesAPI.getAll({ month, branch_filter: branchFilter });
      setRows(res.data?.rows || []);
    } catch (e) {
      showToast(e.response?.data?.detail || 'تعذّر تحميل الرواتب', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchAdvances = async () => {
    try {
      const res = await coachAdvancesAPI.getAll({ branch_filter: branchFilter });
      setAdvances(res.data || []);
    } catch (e) {
      showToast(e.response?.data?.detail || 'تعذّر تحميل السُلف', 'error');
    }
  };

  const fetchCoaches = async () => {
    try {
      const res = await coachesAPI.getAll({ branch_filter: branchFilter });
      setCoaches(res.data || []);
    } catch (e) {}
  };

  const fetchReport = async () => {
    setReportLoading(true);
    try {
      const res = await coachSalariesAPI.report({
        from_month: reportFrom,
        to_month: reportTo,
        branch_filter: branchFilter,
      });
      setReportData(res.data);
    } catch (e) {
      showToast(e.response?.data?.detail || 'تعذّر تحميل التقرير', 'error');
    } finally {
      setReportLoading(false);
    }
  };

  const downloadReport = (format) => {
    const token = localStorage.getItem('token');
    const url = coachSalariesAPI.reportExportUrl({
      from_month: reportFrom,
      to_month: reportTo,
      branch_filter: branchFilter,
      format,
    });
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.detail || 'فشل التصدير');
        }
        return r.blob();
      })
      .then(blob => {
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = `coach_salaries_report_${reportFrom}_${reportTo}.${format}`;
        a.click();
        URL.revokeObjectURL(u);
      })
      .catch(e => showToast(e.message || 'فشل التصدير', 'error'));
  };

  useEffect(() => { fetchCoaches(); fetchAdvances(); }, []);
  useEffect(() => { fetchSalaries(); }, [month]);
  useEffect(() => {
    if (tab === 'reports') fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const openEditor = (row) => {
    setEditing({
      coach_id: row.coach_id,
      coach_name: row.coach_name,
      base_salary: row.base_salary,
      contract_type: row.contract_type || 'full_time',
      monthly_work_days: row.monthly_work_days || 30,
      present_days: row.present_days,
      absent_days: row.absent_days,
      late_minutes: row.late_minutes,
      deduction_absent: row.deduction_absent,
      deduction_late: row.deduction_late,
      bonus: row.bonus || 0,
      manual_deductions: row.manual_deductions || [],
      advances_repaid: row.advances_repaid || [],
      advances_repaid_total: row.advances_repaid_total || 0,
      available_advances: row.available_advances || [],
      net_amount: row.net_amount,
      notes: row.notes || '',
      status: row.status,
      id: row.id,
    });
  };

  const editorNet = useMemo(() => {
    if (!editing) return 0;
    const bonus = parseFloat(editing.bonus) || 0;
    const manualTotal = (editing.manual_deductions || []).reduce((s, m) => s + (parseFloat(m.amount) || 0), 0);
    const advTotal = (editing.available_advances || [])
      .filter(a => editing.advances_repaid.includes(a.id))
      .reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    return Math.round(((editing.base_salary || 0) - (editing.deduction_absent || 0) - (editing.deduction_late || 0) + bonus - manualTotal - advTotal) * 100) / 100;
  }, [editing]);

  const handleSaveDraft = async () => {
    if (!editing) return;
    setSavingId(editing.coach_id);
    try {
      const payload = {
        year_month: month,
        coach_id: editing.coach_id,
        bonus: parseFloat(editing.bonus) || 0,
        manual_deductions: (editing.manual_deductions || [])
          .filter(m => m.description && parseFloat(m.amount) > 0)
          .map(m => ({ description: m.description, amount: parseFloat(m.amount) })),
        advances_repaid: editing.advances_repaid || [],
        notes: editing.notes || '',
      };
      await coachSalariesAPI.save(payload);
      showToast('تم حفظ المسودة');
      setEditing(null);
      fetchSalaries();
    } catch (e) {
      showToast(e.response?.data?.detail || 'فشل الحفظ', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const handleDisburse = async (row) => {
    setSavingId(row.coach_id);
    try {
      let salaryId = row.id;
      if (!salaryId || row.status === 'new') {
        const saved = await coachSalariesAPI.save({
          year_month: month,
          coach_id: row.coach_id,
          bonus: row.bonus || 0,
          manual_deductions: row.manual_deductions || [],
          advances_repaid: row.advances_repaid || [],
          notes: row.notes || '',
        });
        salaryId = saved.data?.id;
      }
      await coachSalariesAPI.disburse(salaryId);
      showToast('تم صرف الراتب وإضافته للمصروفات الداخلية');
      setConfirmAction(null);
      fetchSalaries();
      fetchAdvances();
    } catch (e) {
      showToast(e.response?.data?.detail || 'فشل الصرف', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const handleCancelDisburse = async (id) => {
    try {
      await coachSalariesAPI.cancelDisburse(id);
      showToast('تم إلغاء الصرف');
      setConfirmAction(null);
      fetchSalaries();
      fetchAdvances();
    } catch (e) {
      showToast(e.response?.data?.detail || 'فشل إلغاء الصرف', 'error');
    }
  };

  const handleDeleteSalary = async (id) => {
    try {
      await coachSalariesAPI.delete(id);
      showToast('تم الحذف');
      setConfirmAction(null);
      fetchSalaries();
    } catch (e) {
      showToast(e.response?.data?.detail || 'فشل الحذف', 'error');
    }
  };

  const handleCreateAdvance = async () => {
    if (!advanceForm.coach_id || !(parseFloat(advanceForm.amount) > 0)) {
      showToast('يرجى اختيار المدرب وإدخال المبلغ', 'error');
      return;
    }
    try {
      await coachAdvancesAPI.create({
        coach_id: advanceForm.coach_id,
        advance_date: advanceForm.advance_date,
        amount: parseFloat(advanceForm.amount),
        payment_method: advanceForm.payment_method,
        notes: advanceForm.notes,
      });
      showToast('تم تسجيل السلفة');
      setShowAdvanceModal(false);
      setAdvanceForm({ coach_id: '', advance_date: todayDate(), amount: '', payment_method: 'cash', notes: '' });
      fetchAdvances();
      fetchSalaries();
    } catch (e) {
      showToast(e.response?.data?.detail || 'فشل تسجيل السلفة', 'error');
    }
  };

  const handleDeleteAdvance = async (id) => {
    try {
      await coachAdvancesAPI.delete(id);
      showToast('تم حذف السلفة');
      setConfirmAction(null);
      fetchAdvances();
      fetchSalaries();
    } catch (e) {
      showToast(e.response?.data?.detail || 'فشل الحذف', 'error');
    }
  };

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => {
      acc.base += r.base_salary || 0;
      acc.deductions += (r.deduction_absent || 0) + (r.deduction_late || 0);
      acc.advances += r.advances_repaid_total || 0;
      acc.net += r.net_amount || 0;
      acc.disbursed += r.status === 'disbursed' ? (r.net_amount || 0) : 0;
      return acc;
    }, { base: 0, deductions: 0, advances: 0, net: 0, disbursed: 0 });
  }, [rows]);

  const pendingAdvances = advances.filter(a => a.status === 'pending');
  const repaidAdvances = advances.filter(a => a.status === 'repaid');

  const downloadPayslip = (id) => {
    const token = localStorage.getItem('token');
    fetch(coachSalariesAPI.payslipUrl(id), { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `payslip_${month}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => showToast('فشل تنزيل القسيمة', 'error'));
  };

  return (
    <Layout title="رواتب وسُلف المدربين">
    <div className="p-4 md:p-6" dir="rtl">
      <Toast {...toast} onClose={() => setToast(null)} />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-orange-500 rounded-xl flex items-center justify-center text-white">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">رواتب وسُلف المدربين</h1>
            <p className="text-sm text-gray-500">حساب الرواتب الشهرية والسُلف وصرفها كمصروفات داخلية</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500" />
          <button onClick={() => setShowAdvanceModal(true)}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" /> سلفة جديدة
          </button>
        </div>
      </div>

      {tab === 'salaries' && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
          <span className="text-sm text-gray-700 font-medium">إجراءات جماعية:</span>
          <button onClick={async () => {
            const items = rows.filter(r => r.status !== 'disbursed' && r.base_salary > 0).map(r => ({
              coach_id: r.coach_id,
              bonus: r.bonus || 0,
              manual_deductions: r.manual_deductions || [],
              advances_repaid: r.advances_repaid || [],
              notes: r.notes || '',
            }));
            if (items.length === 0) { showToast('لا توجد رواتب قابلة للحفظ', 'error'); return; }
            try {
              const res = await coachSalariesAPI.bulkSave({ year_month: month, items });
              showToast(`تم حفظ ${res.data.saved_count} مسودة${res.data.error_count ? ` (فشل ${res.data.error_count})` : ''}`);
              fetchSalaries();
            } catch (e) { showToast(e.response?.data?.detail || 'فشل الحفظ الجماعي', 'error'); }
          }} className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-sm flex items-center gap-1">
            <Save className="w-3.5 h-3.5" /> حفظ الكل كمسودة
          </button>
          <button onClick={() => setConfirmAction({ type: 'bulk-disburse' })}
            className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded text-sm flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5" /> صرف الكل
          </button>
          <span className="text-xs text-gray-500 mr-auto">
            قابل للصرف: {rows.filter(r => r.status !== 'disbursed' && r.base_salary > 0).length} مدرّب
          </span>
        </div>
      )}

      <div className="flex gap-2 mb-4 border-b">
        <button onClick={() => setTab('salaries')}
          className={`px-4 py-2 text-sm font-medium ${tab === 'salaries' ? 'border-b-2 border-orange-500 text-orange-600' : 'text-gray-500'}`}>
          الرواتب الشهرية
        </button>
        <button onClick={() => setTab('advances')}
          className={`px-4 py-2 text-sm font-medium ${tab === 'advances' ? 'border-b-2 border-orange-500 text-orange-600' : 'text-gray-500'}`}>
          السُلف ({pendingAdvances.length})
        </button>
        <button onClick={() => setTab('reports')}
          className={`px-4 py-2 text-sm font-medium flex items-center gap-1 ${tab === 'reports' ? 'border-b-2 border-orange-500 text-orange-600' : 'text-gray-500'}`}>
          <BarChart3 className="w-4 h-4" /> تقارير
        </button>
      </div>

      {tab === 'salaries' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="bg-white border rounded-lg p-3">
              <p className="text-xs text-gray-500">إجمالي الرواتب الأساسية</p>
              <p className="text-lg font-bold text-gray-800">{fmt(totals.base)} ر.س</p>
            </div>
            <div className="bg-white border rounded-lg p-3">
              <p className="text-xs text-gray-500">إجمالي الخصومات</p>
              <p className="text-lg font-bold text-red-600">{fmt(totals.deductions)} ر.س</p>
            </div>
            <div className="bg-white border rounded-lg p-3">
              <p className="text-xs text-gray-500">سُلف مخصومة</p>
              <p className="text-lg font-bold text-amber-600">{fmt(totals.advances)} ر.س</p>
            </div>
            <div className="bg-white border rounded-lg p-3">
              <p className="text-xs text-gray-500">الصافي المحسوب</p>
              <p className="text-lg font-bold text-blue-600">{fmt(totals.net)} ر.س</p>
            </div>
            <div className="bg-white border rounded-lg p-3">
              <p className="text-xs text-gray-500">المصروف فعلياً</p>
              <p className="text-lg font-bold text-green-600">{fmt(totals.disbursed)} ر.س</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-right p-3 font-semibold text-gray-700">المدرب</th>
                    <th className="text-right p-3 font-semibold text-gray-700">التعاقد</th>
                    <th className="text-right p-3 font-semibold text-gray-700">الراتب</th>
                    <th className="text-right p-3 font-semibold text-gray-700">أيام العمل</th>
                    <th className="text-right p-3 font-semibold text-gray-700">حضور / غياب</th>
                    <th className="text-right p-3 font-semibold text-gray-700">دقائق التأخر</th>
                    <th className="text-right p-3 font-semibold text-gray-700">خصومات</th>
                    <th className="text-right p-3 font-semibold text-gray-700">سُلف</th>
                    <th className="text-right p-3 font-semibold text-gray-700">الصافي</th>
                    <th className="text-right p-3 font-semibold text-gray-700">الحالة</th>
                    <th className="text-center p-3 font-semibold text-gray-700">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="11" className="p-8 text-center text-gray-400"><Loader className="w-6 h-6 animate-spin inline" /></td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan="11" className="p-8 text-center text-gray-400">لا توجد بيانات</td></tr>
                  ) : rows.map(r => (
                    <tr key={r.coach_id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-medium text-gray-800">{r.coach_name}</td>
                      <td className="p-3">
                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${r.contract_type === 'part_time' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {r.contract_type === 'part_time' ? 'جزئي' : 'كامل'}
                        </span>
                      </td>
                      <td className="p-3">{fmt(r.base_salary)}</td>
                      <td className="p-3 text-gray-600">{r.monthly_work_days || 30}</td>
                      <td className="p-3"><span className="text-green-600 font-semibold">{r.present_days}</span> / <span className="text-red-600 font-semibold">{r.absent_days}</span></td>
                      <td className="p-3">{r.late_minutes}</td>
                      <td className="p-3 text-red-600">{fmt((r.deduction_absent || 0) + (r.deduction_late || 0) + (r.manual_deductions || []).reduce((s, m) => s + (m.amount || 0), 0))}</td>
                      <td className="p-3 text-amber-600">{fmt(r.advances_repaid_total)}</td>
                      <td className="p-3 font-bold text-blue-600">{fmt(r.net_amount)}</td>
                      <td className="p-3">
                        {r.status === 'disbursed' ? (
                          <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-semibold">مصروف</span>
                        ) : r.status === 'draft' ? (
                          <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-xs font-semibold">مسودة</span>
                        ) : (
                          <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-semibold">جديد</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-2">
                          {r.status !== 'disbursed' && (
                            <button onClick={() => openEditor(r)} className="text-blue-600 hover:text-blue-800 text-xs underline">تعديل</button>
                          )}
                          {r.status !== 'disbursed' && r.base_salary > 0 && (
                            <button onClick={() => setConfirmAction({ type: 'disburse', row: r })}
                              disabled={savingId === r.coach_id}
                              className="bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded text-xs flex items-center gap-1 disabled:opacity-50">
                              <CheckCircle className="w-3 h-3" /> صرف
                            </button>
                          )}
                          {r.status === 'disbursed' && r.id && (
                            <>
                              <button onClick={() => downloadPayslip(r.id)} className="text-blue-600 hover:text-blue-800" title="تنزيل القسيمة"><FileText className="w-4 h-4" /></button>
                              {isAdmin && (
                                <button onClick={() => setConfirmAction({ type: 'cancel', id: r.id, coach: r.coach_name })}
                                  className="text-red-600 hover:text-red-800" title="إلغاء الصرف"><RotateCcw className="w-4 h-4" /></button>
                              )}
                            </>
                          )}
                          {r.status === 'draft' && r.id && (
                            <button onClick={() => setConfirmAction({ type: 'delete-salary', id: r.id, coach: r.coach_name })}
                              className="text-red-600 hover:text-red-800" title="حذف المسودة"><Trash2 className="w-4 h-4" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'advances' && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-right p-3 font-semibold text-gray-700">التاريخ</th>
                  <th className="text-right p-3 font-semibold text-gray-700">المدرب</th>
                  <th className="text-right p-3 font-semibold text-gray-700">المبلغ</th>
                  <th className="text-right p-3 font-semibold text-gray-700">طريقة الدفع</th>
                  <th className="text-right p-3 font-semibold text-gray-700">الحالة</th>
                  <th className="text-right p-3 font-semibold text-gray-700">ملاحظات</th>
                  <th className="text-center p-3 font-semibold text-gray-700">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {advances.length === 0 ? (
                  <tr><td colSpan="7" className="p-8 text-center text-gray-400">لا توجد سُلف</td></tr>
                ) : advances.map(a => (
                  <tr key={a.id} className="border-b hover:bg-gray-50">
                    <td className="p-3">{a.advance_date}</td>
                    <td className="p-3 font-medium">{a.coach_name}</td>
                    <td className="p-3 font-bold text-amber-600">{fmt(a.amount)}</td>
                    <td className="p-3">{a.payment_method}</td>
                    <td className="p-3">
                      {a.status === 'repaid' ? (
                        <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs">مخصومة</span>
                      ) : (
                        <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-xs">معلّقة</span>
                      )}
                    </td>
                    <td className="p-3 text-gray-500">{a.notes || '-'}</td>
                    <td className="p-3 text-center">
                      {a.status === 'pending' && (
                        <button onClick={() => setConfirmAction({ type: 'delete-advance', id: a.id, coach: a.coach_name })}
                          className="text-red-600 hover:text-red-800"><Trash2 className="w-4 h-4 inline" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'reports' && (
        <>
          <div className="bg-white border rounded-xl p-4 mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">من شهر</label>
                <input type="month" value={reportFrom} onChange={e => setReportFrom(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">إلى شهر</label>
                <input type="month" value={reportTo} onChange={e => setReportTo(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500" />
              </div>
              <button onClick={fetchReport} disabled={reportLoading}
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
                {reportLoading ? <Loader className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                عرض التقرير
              </button>
              {isAdmin && (
              <div className="flex gap-2 mr-auto">
                <button onClick={() => downloadReport('xlsx')}
                  disabled={!reportData || reportLoading}
                  className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
                  <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
                </button>
                <button onClick={() => downloadReport('pdf')}
                  disabled={!reportData || reportLoading}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
                  <Download className="w-4 h-4" /> تصدير PDF
                </button>
              </div>
              )}
            </div>
            {reportData && (
              <p className="text-xs text-gray-500 mt-3">
                الفترة: {reportData.from} → {reportData.to} ({reportData.months?.length || 0} شهر) — {reportData.totals?.coaches_count || 0} مدرّب
              </p>
            )}
          </div>

          {reportLoading ? (
            <div className="text-center p-8 text-gray-400"><Loader className="w-6 h-6 animate-spin inline" /></div>
          ) : reportData ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <div className="bg-white border rounded-lg p-3">
                  <p className="text-xs text-gray-500">إجمالي الراتب الأساسي</p>
                  <p className="text-lg font-bold text-gray-800">{fmt(reportData.totals.total_base)} ر.س</p>
                </div>
                <div className="bg-white border rounded-lg p-3">
                  <p className="text-xs text-gray-500">إجمالي الخصومات</p>
                  <p className="text-lg font-bold text-red-600">{fmt(reportData.totals.total_deductions)} ر.س</p>
                </div>
                <div className="bg-white border rounded-lg p-3">
                  <p className="text-xs text-gray-500">سُلف مخصومة</p>
                  <p className="text-lg font-bold text-amber-600">{fmt(reportData.totals.total_advances_repaid)} ر.س</p>
                </div>
                <div className="bg-white border rounded-lg p-3">
                  <p className="text-xs text-gray-500">إجمالي المصروف فعلياً</p>
                  <p className="text-lg font-bold text-green-600">{fmt(reportData.totals.total_net_disbursed)} ر.س</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-700">سُلف معلّقة (إجمالي)</p>
                  <p className="text-lg font-bold text-amber-700">{fmt(reportData.totals.pending_advances_total)} ر.س</p>
                </div>
              </div>

              <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-right p-3 font-semibold text-gray-700">المدرب</th>
                        <th className="text-right p-3 font-semibold text-gray-700">أشهر مسجّلة</th>
                        <th className="text-right p-3 font-semibold text-gray-700">أشهر مصروفة</th>
                        <th className="text-right p-3 font-semibold text-gray-700">إجمالي الراتب</th>
                        <th className="text-right p-3 font-semibold text-gray-700">الخصومات</th>
                        <th className="text-right p-3 font-semibold text-gray-700">سُلف مخصومة</th>
                        <th className="text-right p-3 font-semibold text-gray-700">إجمالي المصروف</th>
                        <th className="text-right p-3 font-semibold text-gray-700">سُلف معلّقة</th>
                        <th className="text-right p-3 font-semibold text-gray-700">أيام غياب</th>
                        <th className="text-right p-3 font-semibold text-gray-700">متوسط دقائق التأخر</th>
                        <th className="text-center p-3 font-semibold text-gray-700">السجل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reportData.coaches || []).length === 0 ? (
                        <tr><td colSpan="11" className="p-8 text-center text-gray-400">لا توجد بيانات</td></tr>
                      ) : reportData.coaches.map(c => {
                        const open = expandedCoach === c.coach_id;
                        return (
                          <React.Fragment key={c.coach_id}>
                            <tr className="border-b hover:bg-gray-50">
                              <td className="p-3 font-medium text-gray-800">{c.coach_name}</td>
                              <td className="p-3">{c.months_recorded}</td>
                              <td className="p-3 text-green-700">{c.months_disbursed}</td>
                              <td className="p-3">{fmt(c.total_base)}</td>
                              <td className="p-3 text-red-600">{fmt(c.total_deductions)}</td>
                              <td className="p-3 text-amber-600">{fmt(c.total_advances_repaid)}</td>
                              <td className="p-3 font-bold text-green-700">{fmt(c.total_net_disbursed)}</td>
                              <td className="p-3">
                                {c.pending_advances_total > 0 ? (
                                  <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs font-semibold">
                                    {fmt(c.pending_advances_total)} ({c.pending_advances_count})
                                  </span>
                                ) : <span className="text-gray-400 text-xs">—</span>}
                              </td>
                              <td className="p-3 text-red-600">{c.absent_days_total}</td>
                              <td className="p-3">{c.late_minutes_avg}</td>
                              <td className="p-3 text-center">
                                <button
                                  onClick={() => setExpandedCoach(open ? null : c.coach_id)}
                                  className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 text-xs">
                                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                                  {open ? 'إخفاء' : 'عرض'}
                                </button>
                              </td>
                            </tr>
                            {open && (
                              <tr className="bg-orange-50/40">
                                <td colSpan="11" className="p-3">
                                  {(c.history || []).length === 0 ? (
                                    <p className="text-center text-gray-400 text-sm py-3">لا توجد سجلات في هذه الفترة</p>

                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-xs">
                                        <thead className="bg-white border-b">
                                          <tr>
                                            <th className="text-right p-2">الشهر</th>
                                            <th className="text-right p-2">التعاقد</th>
                                            <th className="text-right p-2">أيام العمل</th>
                                            <th className="text-right p-2">الراتب</th>
                                            <th className="text-right p-2">خصم غياب</th>
                                            <th className="text-right p-2">خصم تأخر</th>
                                            <th className="text-right p-2">علاوة</th>
                                            <th className="text-right p-2">سُلف مخصومة</th>
                                            <th className="text-right p-2">حضور / غياب</th>
                                            <th className="text-right p-2">دقائق التأخر</th>
                                            <th className="text-right p-2">الصافي</th>
                                            <th className="text-right p-2">الحالة</th>
                                            <th className="text-right p-2">تاريخ الصرف</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {c.history.map(h => (
                                            <tr key={h.year_month} className="border-b">
                                              <td className="p-2 font-semibold">{h.year_month}</td>
                                              <td className="p-2">
                                                <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${h.contract_type === 'part_time' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                  {h.contract_type === 'part_time' ? 'جزئي' : 'كامل'}
                                                </span>
                                              </td>
                                              <td className="p-2">{h.monthly_work_days || 30}</td>
                                              <td className="p-2">{fmt(h.base_salary)}</td>
                                              <td className="p-2 text-red-600">-{fmt(h.deduction_absent)}</td>
                                              <td className="p-2 text-red-600">-{fmt(h.deduction_late)}</td>
                                              <td className="p-2 text-green-600">+{fmt(h.bonus)}</td>
                                              <td className="p-2 text-amber-600">-{fmt(h.advances_repaid_total)}</td>
                                              <td className="p-2"><span className="text-green-600">{h.present_days}</span> / <span className="text-red-600">{h.absent_days}</span></td>
                                              <td className="p-2">{h.late_minutes}</td>
                                              <td className="p-2 font-bold text-blue-700">{fmt(h.net_amount)}</td>
                                              <td className="p-2">
                                                {h.status === 'disbursed' ? (
                                                  <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[11px] font-semibold">مصروف</span>
                                                ) : h.status === 'draft' ? (
                                                  <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded text-[11px] font-semibold">مسودة</span>
                                                ) : (
                                                  <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[11px]">{h.status || '—'}</span>
                                                )}
                                              </td>
                                              <td className="p-2 text-gray-500">{h.disbursed_at ? h.disbursed_at.slice(0, 10) : '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center p-8 text-gray-400">اختر نطاق التواريخ ثم اضغط "عرض التقرير"</div>
          )}
        </>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" dir="rtl">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
              <h3 className="text-lg font-bold">تعديل راتب — {editing.coach_name}</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 p-3 rounded"><span className="text-gray-500">الراتب الأساسي:</span> <strong>{fmt(editing.base_salary)}</strong></div>
                <div className="bg-gray-50 p-3 rounded">
                  <span className="text-gray-500">نوع التعاقد:</span>{' '}
                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${editing.contract_type === 'part_time' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {editing.contract_type === 'part_time' ? 'دوام جزئي' : 'دوام كامل'}
                  </span>
                </div>
                <div className="bg-gray-50 p-3 rounded"><span className="text-gray-500">أيام العمل المطلوبة:</span> <strong>{editing.monthly_work_days}</strong></div>
                <div className="bg-gray-50 p-3 rounded"><span className="text-gray-500">حضور/غياب:</span> <strong>{editing.present_days}/{editing.absent_days}</strong></div>
                <div className="bg-red-50 p-3 rounded"><span className="text-gray-500">خصم الغياب:</span> <strong className="text-red-600">-{fmt(editing.deduction_absent)}</strong></div>
                <div className="bg-red-50 p-3 rounded"><span className="text-gray-500">خصم التأخر ({editing.late_minutes} د):</span> <strong className="text-red-600">-{fmt(editing.deduction_late)}</strong></div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">علاوة (+)</label>
                <input type="number" min="0" step="0.01" value={editing.bonus}
                  onChange={e => setEditing({ ...editing, bonus: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">خصومات إضافية</label>
                  <button onClick={() => setEditing({ ...editing, manual_deductions: [...editing.manual_deductions, { description: '', amount: '' }] })}
                    className="text-blue-600 text-xs flex items-center gap-1"><Plus className="w-3 h-3" /> إضافة</button>
                </div>
                {(editing.manual_deductions || []).map((m, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input value={m.description} placeholder="السبب"
                      onChange={e => {
                        const arr = [...editing.manual_deductions];
                        arr[i] = { ...arr[i], description: e.target.value };
                        setEditing({ ...editing, manual_deductions: arr });
                      }}
                      className="flex-1 border rounded px-2 py-1 text-sm" />
                    <input type="number" min="0" step="0.01" value={m.amount} placeholder="المبلغ"
                      onChange={e => {
                        const arr = [...editing.manual_deductions];
                        arr[i] = { ...arr[i], amount: e.target.value };
                        setEditing({ ...editing, manual_deductions: arr });
                      }}
                      className="w-28 border rounded px-2 py-1 text-sm" />
                    <button onClick={() => {
                      const arr = editing.manual_deductions.filter((_, j) => j !== i);
                      setEditing({ ...editing, manual_deductions: arr });
                    }} className="text-red-500"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              {(editing.available_advances || []).length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-2">السُلف القابلة للخصم</label>
                  <div className="space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                    {editing.available_advances.map(a => (
                      <label key={a.id} className="flex items-center gap-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                        <input type="checkbox"
                          checked={editing.advances_repaid.includes(a.id)}
                          onChange={e => {
                            const set = new Set(editing.advances_repaid);
                            if (e.target.checked) set.add(a.id); else set.delete(a.id);
                            setEditing({ ...editing, advances_repaid: Array.from(set) });
                          }} />
                        <span className="text-sm flex-1">{a.advance_date} — <strong>{fmt(a.amount)}</strong> ر.س {a.notes ? `(${a.notes})` : ''}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات</label>
                <textarea value={editing.notes} rows="2"
                  onChange={e => setEditing({ ...editing, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-600">الصافي المستحق</p>
                <p className="text-2xl font-bold text-blue-700">{fmt(editorNet)} ر.س</p>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t bg-gray-50 sticky bottom-0">
              <button onClick={handleSaveDraft} disabled={savingId === editing.coach_id}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
                <Save className="w-4 h-4" /> حفظ مسودة
              </button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {showAdvanceModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" dir="rtl">
          <div className="bg-white rounded-xl max-w-md w-full">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="text-lg font-bold">سلفة جديدة</h3>
              <button onClick={() => setShowAdvanceModal(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">المدرب *</label>
                <select value={advanceForm.coach_id}
                  onChange={e => setAdvanceForm({ ...advanceForm, coach_id: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">— اختر —</option>
                  {coaches.map(c => <option key={c.id} value={c.id}>{c.name_ar || c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">التاريخ *</label>
                <input type="date" value={advanceForm.advance_date}
                  onChange={e => setAdvanceForm({ ...advanceForm, advance_date: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">المبلغ (ر.س) *</label>
                <input type="number" min="0" step="0.01" value={advanceForm.amount}
                  onChange={e => setAdvanceForm({ ...advanceForm, amount: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="0" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">طريقة الدفع</label>
                <select value={advanceForm.payment_method}
                  onChange={e => setAdvanceForm({ ...advanceForm, payment_method: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="cash">نقداً</option>
                  <option value="transfer">تحويل بنكي</option>
                  <option value="card">بطاقة</option>
                  <option value="check">شيك</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات</label>
                <textarea value={advanceForm.notes} rows="2"
                  onChange={e => setAdvanceForm({ ...advanceForm, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
                <AlertTriangle className="w-3 h-3 inline ml-1" />
                ستُسجَّل السلفة كمصروف داخلي تلقائياً وتُخصم لاحقاً من راتب المدرب.
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t bg-gray-50">
              <button onClick={handleCreateAdvance}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg">حفظ</button>
              <button onClick={() => setShowAdvanceModal(false)} className="px-4 py-2 border rounded-lg">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" dir="rtl">
          <div className="bg-white rounded-xl max-w-sm w-full p-5">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <h3 className="text-lg font-bold">تأكيد</h3>
            </div>
            <p className="text-sm text-gray-700 mb-4">
              {confirmAction.type === 'disburse' && `سيتم صرف راتب ${confirmAction.row.coach_name} بقيمة ${fmt(confirmAction.row.net_amount)} ر.س وإضافته للمصروفات الداخلية. متابعة؟`}
              {confirmAction.type === 'cancel' && `سيتم إلغاء صرف راتب ${confirmAction.coach} وحذف المصروف الداخلي المرتبط. متابعة؟`}
              {confirmAction.type === 'delete-salary' && `سيتم حذف مسودة راتب ${confirmAction.coach}. متابعة؟`}
              {confirmAction.type === 'delete-advance' && `سيتم حذف سلفة ${confirmAction.coach} وحذف المصروف الداخلي المرتبط. متابعة؟`}
              {confirmAction.type === 'bulk-disburse' && `سيتم صرف رواتب جميع المدربين القابلة للصرف (${rows.filter(r => r.status !== 'disbursed' && r.base_salary > 0).length} مدرّب). الصرف للسجلات المحفوظة كمسودات أولاً. متابعة؟`}
            </p>
            <div className="flex gap-2">
              <button onClick={async () => {
                if (confirmAction.type === 'disburse') handleDisburse(confirmAction.row);
                else if (confirmAction.type === 'cancel') handleCancelDisburse(confirmAction.id);
                else if (confirmAction.type === 'delete-salary') handleDeleteSalary(confirmAction.id);
                else if (confirmAction.type === 'delete-advance') handleDeleteAdvance(confirmAction.id);
                else if (confirmAction.type === 'bulk-disburse') {
                  try {
                    const eligible = rows.filter(r => r.status !== 'disbursed' && r.base_salary > 0);
                    const items = eligible.map(r => ({
                      coach_id: r.coach_id,
                      bonus: r.bonus || 0,
                      manual_deductions: r.manual_deductions || [],
                      advances_repaid: r.advances_repaid || [],
                      notes: r.notes || '',
                    }));
                    const saveRes = await coachSalariesAPI.bulkSave({ year_month: month, items });
                    const ids = (saveRes.data.saved || []).map(s => s.id).filter(Boolean);
                    const disbRes = await coachSalariesAPI.bulkDisburse({ salary_ids: ids });
                    showToast(`تم صرف ${disbRes.data.disbursed_count} راتب${disbRes.data.error_count ? ` (فشل ${disbRes.data.error_count})` : ''}`);
                    setConfirmAction(null);
                    fetchSalaries();
                    fetchAdvances();
                  } catch (e) {
                    showToast(e.response?.data?.detail || 'فشل الصرف الجماعي', 'error');
                  }
                }
              }} className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg">تأكيد</button>
              <button onClick={() => setConfirmAction(null)} className="px-4 py-2 border rounded-lg">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </Layout>
  );
};

export default CoachSalariesPage;
