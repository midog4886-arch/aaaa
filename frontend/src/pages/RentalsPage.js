import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { rentalsAPI, branchesAPI } from '../services/api';
import { toast } from 'sonner';
import {
  KeyRound, Plus, Trash2, CalendarDays, Users, Wallet, Printer, Ban, Loader2, Download, AlertTriangle, BarChart3, Pencil
} from 'lucide-react';

const WEEKDAYS = [
  { key: 'saturday', ar: 'السبت', en: 'Sat' },
  { key: 'sunday', ar: 'الأحد', en: 'Sun' },
  { key: 'monday', ar: 'الاثنين', en: 'Mon' },
  { key: 'tuesday', ar: 'الثلاثاء', en: 'Tue' },
  { key: 'wednesday', ar: 'الأربعاء', en: 'Wed' },
  { key: 'thursday', ar: 'الخميس', en: 'Thu' },
  { key: 'friday', ar: 'الجمعة', en: 'Fri' },
];
const WEEKDAY_AR = Object.fromEntries(WEEKDAYS.map(w => [w.key, w.ar]));

const PAYMENT_METHODS = [
  { value: 'cash', ar: 'نقداً', en: 'Cash' },
  { value: 'transfer', ar: 'تحويل بنكي', en: 'Transfer' },
  { value: 'card', ar: 'شبكة/بطاقة', en: 'Card' },
];

const hourLabel = (h, ar = true) => {
  if (h === null || h === undefined) return '';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? (ar ? 'ص' : 'AM') : (ar ? 'م' : 'PM');
  return `${h12}:00 ${suffix}`;
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStr = () => new Date().toISOString().slice(0, 7);

export default function RentalsPage() {
  const { language } = useLanguage();
  const { isAdmin, selectedBranchId } = useAuth();
  const ar = language === 'ar';
  const t = (a, e) => (ar ? a : e);

  const [tab, setTab] = useState('bookings');
  const [coaches, setCoaches] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [report, setReport] = useState(null);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filters
  const [fromDate, setFromDate] = useState(() => monthStr() + '-01');
  const [toDate, setToDate] = useState('');
  const [filterCoach, setFilterCoach] = useState('all');
  const [filterPay, setFilterPay] = useState('all');
  const [reportMonth, setReportMonth] = useState(monthStr());

  // Booking dialog
  const [showBooking, setShowBooking] = useState(false);
  const emptyBooking = {
    coach_id: '', branch_id: '', recurring: false, date: todayStr(),
    start_date: todayStr(), end_date: '', days: [], start_hour: 17,
    duration_hours: 1, hourly_rate: '', persons_count: '', person_rate: '', notes: '',
    day_persons: {}, // per-weekday persons override for recurring bookings
  };
  const [bk, setBk] = useState({ ...emptyBooking });
  const [conflicts, setConflicts] = useState(null); // pending conflicts requiring confirmation

  // Per-booking edit (actual persons count / rates on an unpaid booking)
  const [editBooking, setEditBooking] = useState(null);
  const [editForm, setEditForm] = useState({ persons_count: '', person_rate: '' });

  // Coach dialog
  const [showCoach, setShowCoach] = useState(false);
  const emptyCoach = { name: '', phone: '', activity: '', hourly_rate: '', notes: '', branch_id: '' };
  const [coachForm, setCoachForm] = useState({ ...emptyCoach });
  const [editingCoachId, setEditingCoachId] = useState(null);

  // Payment dialog
  const [showPayment, setShowPayment] = useState(false);
  const [payCoach, setPayCoach] = useState('');
  const [unpaidBookings, setUnpaidBookings] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [payMethod, setPayMethod] = useState('cash');
  const [payDate, setPayDate] = useState(todayStr());
  const [payNotes, setPayNotes] = useState('');

  const branchName = useCallback((id) => {
    const b = branches.find(x => x.id === id);
    return b ? (ar ? (b.name_ar || b.name) : (b.name || b.name_ar)) : '';
  }, [branches, ar]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (fromDate) params.start_date = fromDate;
      if (toDate) params.end_date = toDate;
      if (filterCoach !== 'all') params.coach_id = filterCoach;
      if (filterPay !== 'all') params.payment_status = filterPay;
      const [cRes, bRes, pRes] = await Promise.all([
        rentalsAPI.getCoaches(),
        rentalsAPI.getBookings(params),
        rentalsAPI.getPayments({}),
      ]);
      setCoaches(cRes.data || []);
      setBookings(bRes.data || []);
      setPayments(pRes.data || []);
    } catch (e) {
      toast.error(t('فشل تحميل البيانات', 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, filterCoach, filterPay]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    branchesAPI.getAll().then(r => setBranches(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== 'report') return;
    rentalsAPI.getReport({ month: reportMonth })
      .then(r => setReport(r.data))
      .catch(() => toast.error(t('فشل تحميل التقرير', 'Failed to load report')));
  }, [tab, reportMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const errDetail = (e) => {
    const d = e?.response?.data?.detail;
    if (typeof d === 'string') return d;
    if (d?.message) return d.message;
    return t('حدث خطأ', 'Something went wrong');
  };

  // ===== Bookings =====
  const submitBooking = async (force = false) => {
    if (!bk.coach_id) return toast.error(t('اختر المدرب', 'Select a coach'));
    const rate = parseFloat(bk.hourly_rate) || 0;
    const persons = parseInt(bk.persons_count, 10) || 0;
    const personRate = parseFloat(bk.person_rate) || 0;
    if (bk.recurring && (!bk.start_date || !bk.end_date || bk.days.length === 0))
      return toast.error(t('حدد فترة التكرار وأيام الأسبوع', 'Set recurring range and weekdays'));
    if (rate <= 0) {
      // No hourly rate: person pricing must yield a positive total for every day
      // (mirrors the backend per-day check; per-day counts fall back to the shared count)
      const effectivePersons = (day) => {
        const raw = bk.day_persons?.[day];
        return (raw === '' || raw == null) ? persons : (parseInt(raw, 10) || 0);
      };
      const allDaysCovered = bk.recurring
        ? bk.days.every(d => effectivePersons(d) > 0)
        : persons > 0;
      if (personRate <= 0 || !allDaysCovered)
        return toast.error(t('أدخل سعر الساعة أو سعر الفرد مع عدد أفراد لكل يوم', 'Enter hourly rate, or per-person rate with a persons count for every day'));
    }
    setSaving(true);
    try {
      const payload = {
        coach_id: bk.coach_id,
        branch_id: isAdmin ? (bk.branch_id || selectedBranchId || undefined) : undefined,
        recurring: bk.recurring,
        date: bk.recurring ? undefined : bk.date,
        start_date: bk.recurring ? bk.start_date : undefined,
        end_date: bk.recurring ? bk.end_date : undefined,
        days: bk.recurring ? bk.days : undefined,
        day_persons: bk.recurring
          ? Object.fromEntries(
              Object.entries(bk.day_persons || {})
                .filter(([d, v]) => bk.days.includes(d) && v !== '' && v !== null && v !== undefined)
                .map(([d, v]) => [d, parseInt(v, 10) || 0])
            )
          : undefined,
        start_hour: Number(bk.start_hour),
        duration_hours: parseFloat(bk.duration_hours) || 1,
        hourly_rate: rate,
        persons_count: persons,
        person_rate: personRate,
        notes: bk.notes,
        force,
      };
      const res = await rentalsAPI.createBooking(payload);
      toast.success(t(`تم إنشاء ${res.data.created} حجز`, `Created ${res.data.created} booking(s)`));
      setShowBooking(false);
      setConflicts(null);
      setBk({ ...emptyBooking });
      loadAll();
    } catch (e) {
      const d = e?.response?.data?.detail;
      if (e?.response?.status === 409 && d?.conflicts) {
        setConflicts(d.conflicts);
      } else {
        toast.error(errDetail(e));
      }
    } finally {
      setSaving(false);
    }
  };

  // ===== Per-booking edit (actual persons count) =====
  const openEditBooking = (b) => {
    setEditBooking(b);
    setEditForm({
      persons_count: b.persons_count != null ? String(b.persons_count) : '',
      person_rate: b.person_rate != null ? String(b.person_rate) : '',
    });
  };

  const submitEditBooking = async () => {
    if (!editBooking) return;
    const persons = parseInt(editForm.persons_count, 10) || 0;
    const personRate = parseFloat(editForm.person_rate) || 0;
    const hourPart = (editBooking.hourly_rate || 0) * (editBooking.duration_hours || 1);
    if (hourPart <= 0 && (persons <= 0 || personRate <= 0))
      return toast.error(t('أدخل عدد الأفراد وسعر الفرد (لا يوجد سعر ساعة لهذا الحجز)', 'Enter persons count and rate (no hourly rate on this booking)'));
    setSaving(true);
    try {
      await rentalsAPI.updateBooking(editBooking.id, { persons_count: persons, person_rate: personRate });
      toast.success(t('تم تحديث الحجز', 'Booking updated'));
      setEditBooking(null);
      loadAll();
    } catch (e) { toast.error(errDetail(e)); }
    finally { setSaving(false); }
  };

  const cancelBooking = async (b) => {
    if (!window.confirm(t('إلغاء هذا الحجز؟', 'Cancel this booking?'))) return;
    try {
      await rentalsAPI.updateBooking(b.id, { status: 'cancelled' });
      toast.success(t('تم الإلغاء', 'Cancelled'));
      loadAll();
    } catch (e) { toast.error(errDetail(e)); }
  };

  const deleteBooking = async (b) => {
    if (!window.confirm(t('حذف الحجز نهائياً؟', 'Delete booking permanently?'))) return;
    try {
      await rentalsAPI.deleteBooking(b.id);
      toast.success(t('تم الحذف', 'Deleted'));
      loadAll();
    } catch (e) { toast.error(errDetail(e)); }
  };

  // ===== Coaches =====
  const openCoachDialog = (coach = null) => {
    if (coach) {
      setEditingCoachId(coach.id);
      setCoachForm({ name: coach.name || '', phone: coach.phone || '', activity: coach.activity || '', hourly_rate: coach.hourly_rate || '', notes: coach.notes || '', branch_id: coach.branch_id || '' });
    } else {
      setEditingCoachId(null);
      setCoachForm({ ...emptyCoach, branch_id: selectedBranchId || '' });
    }
    setShowCoach(true);
  };

  const submitCoach = async () => {
    if (!coachForm.name.trim()) return toast.error(t('اسم المدرب مطلوب', 'Coach name is required'));
    setSaving(true);
    try {
      const payload = { ...coachForm, hourly_rate: parseFloat(coachForm.hourly_rate) || 0 };
      if (!isAdmin) delete payload.branch_id;
      if (editingCoachId) {
        delete payload.branch_id;
        await rentalsAPI.updateCoach(editingCoachId, payload);
        toast.success(t('تم تحديث المدرب', 'Coach updated'));
      } else {
        const res = await rentalsAPI.createCoach(payload);
        toast.success(t('تمت إضافة المدرب', 'Coach added'));
        setBk(prev => ({ ...prev, coach_id: res.data.id, hourly_rate: res.data.hourly_rate || prev.hourly_rate }));
      }
      setShowCoach(false);
      loadAll();
    } catch (e) { toast.error(errDetail(e)); }
    finally { setSaving(false); }
  };

  const deleteCoach = async (c) => {
    if (!window.confirm(t(`حذف المدرب ${c.name}؟`, `Delete coach ${c.name}?`))) return;
    try {
      await rentalsAPI.deleteCoach(c.id);
      toast.success(t('تم الحذف', 'Deleted'));
      loadAll();
    } catch (e) { toast.error(errDetail(e)); }
  };

  // ===== Payments =====
  const openPaymentDialog = async (coachId = '') => {
    setPayCoach(coachId);
    setSelectedIds(new Set());
    setPayMethod('cash');
    setPayDate(todayStr());
    setPayNotes('');
    setUnpaidBookings([]);
    setShowPayment(true);
    if (coachId) loadUnpaid(coachId);
  };

  const loadUnpaid = async (coachId) => {
    try {
      const res = await rentalsAPI.getBookings({ coach_id: coachId, payment_status: 'unpaid' });
      setUnpaidBookings((res.data || []).filter(b => b.status !== 'cancelled'));
    } catch { setUnpaidBookings([]); }
  };

  const toggleId = (id) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectedTotal = useMemo(
    () => unpaidBookings.filter(b => selectedIds.has(b.id)).reduce((s, b) => s + (b.total_amount || 0), 0),
    [unpaidBookings, selectedIds]
  );

  const submitPayment = async () => {
    if (!payCoach) return toast.error(t('اختر المدرب', 'Select a coach'));
    if (selectedIds.size === 0) return toast.error(t('اختر حجزاً واحداً على الأقل', 'Select at least one booking'));
    setSaving(true);
    try {
      const res = await rentalsAPI.createPayment({
        coach_id: payCoach,
        booking_ids: Array.from(selectedIds),
        payment_method: payMethod,
        payment_date: payDate,
        notes: payNotes,
      });
      toast.success(t(`تم تسجيل الدفعة ${res.data.receipt_number}`, `Payment ${res.data.receipt_number} recorded`));
      setShowPayment(false);
      loadAll();
      printReceipt(res.data);
    } catch (e) { toast.error(errDetail(e)); }
    finally { setSaving(false); }
  };

  const deletePayment = async (p) => {
    if (!window.confirm(t(`حذف الإيصال ${p.receipt_number}؟ ستعود الحجوزات لغير مدفوعة`, `Delete receipt ${p.receipt_number}? Bookings revert to unpaid`))) return;
    try {
      await rentalsAPI.deletePayment(p.id);
      toast.success(t('تم الحذف', 'Deleted'));
      loadAll();
    } catch (e) { toast.error(errDetail(e)); }
  };

  const printReceipt = (p) => {
    const w = window.open('', '_blank', 'width=800,height=600');
    if (!w) return;
    const methodAr = PAYMENT_METHODS.find(m => m.value === p.payment_method);
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${p.receipt_number}</title>
      <style>
        body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;margin:24px;color:#111}
        .box{border:2px solid #333;border-radius:8px;padding:24px;max-width:640px;margin:auto}
        h1{font-size:20px;text-align:center;margin:0 0 4px}
        h2{font-size:16px;text-align:center;margin:0 0 16px;color:#555}
        table{width:100%;border-collapse:collapse;margin:12px 0}
        td,th{border:1px solid #999;padding:8px;font-size:14px;text-align:right}
        .total{font-size:18px;font-weight:bold}
        .sig{display:flex;justify-content:space-between;margin-top:40px}
        .sig div{width:40%;border-top:1px solid #333;text-align:center;padding-top:6px;font-size:13px}
        @media print{body{margin:0}}
      </style></head><body><div class="box">
      <h1>شركة اداء الابطال العالمية للرياضة</h1>
      <h2>إيصال استلام - تأجير ساعات</h2>
      <table>
        <tr><th>رقم الإيصال</th><td>${p.receipt_number}</td><th>التاريخ</th><td>${p.payment_date}</td></tr>
        <tr><th>اسم المدرب</th><td>${p.coach_name || ''}</td><th>الجوال</th><td>${p.coach_phone || ''}</td></tr>
        <tr><th>عدد الحجوزات</th><td>${p.bookings_count || (p.booking_ids || []).length}</td><th>إجمالي الساعات</th><td>${p.total_hours || ''}</td></tr>
        <tr><th>طريقة الدفع</th><td>${p.payment_method_ar || (methodAr ? methodAr.ar : p.payment_method)}</td><th class="total">المبلغ</th><td class="total">${(p.amount || 0).toLocaleString()} ريال</td></tr>
        ${p.notes ? `<tr><th>ملاحظات</th><td colspan="3">${p.notes}</td></tr>` : ''}
      </table>
      <div class="sig"><div>المستلم: ${p.created_by || ''}</div><div>توقيع المدرب</div></div>
      </div><script>window.onload=function(){window.print();}</script></body></html>`);
    w.document.close();
  };

  // ===== Report CSV =====
  const exportReportCSV = () => {
    if (!report) return;
    const rows = [
      ['المدرب', 'عدد الحجوزات', 'الساعات', 'الإجمالي', 'غير مدفوع'],
      ...report.by_coach.map(c => [c.coach_name, c.bookings, c.hours, c.amount, c.unpaid]),
    ];
    const csv = '\ufeff' + rows.map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rentals_report_${report.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeCoaches = coaches;
  const bookingTotal = useMemo(() => bookings.filter(b => b.status !== 'cancelled').reduce((s, b) => s + (b.total_amount || 0), 0), [bookings]);
  const bookingUnpaid = useMemo(() => bookings.filter(b => b.status !== 'cancelled' && b.payment_status === 'unpaid').reduce((s, b) => s + (b.total_amount || 0), 0), [bookings]);

  return (
    <Layout>
      <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">{t('تأجير الساعات', 'Hour Rentals')}</h1>
              <p className="text-sm text-muted-foreground">{t('مدربون خارجيون يستأجرون ساعات في المنشأة', 'External coaches renting facility hours')}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => openCoachDialog()} data-testid="button-add-rental-coach">
              <Users className="w-4 h-4 ml-1" />{t('مدرب جديد', 'New coach')}
            </Button>
            <Button onClick={() => { setBk({ ...emptyBooking, branch_id: selectedBranchId || '' }); setConflicts(null); setShowBooking(true); }} data-testid="button-add-booking">
              <Plus className="w-4 h-4 ml-1" />{t('حجز جديد', 'New booking')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4">
            <div className="flex items-center justify-between"><CalendarDays className="w-6 h-6 text-blue-600" /><div className="text-3xl font-bold text-blue-600">{bookings.filter(b => b.status !== 'cancelled').length}</div></div>
            <div className="text-sm text-muted-foreground mt-1">{t('الحجوزات (بالفلتر الحالي)', 'Bookings (filtered)')}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center justify-between"><Wallet className="w-6 h-6 text-green-600" /><div className="text-3xl font-bold text-green-600">{bookingTotal.toLocaleString()}</div></div>
            <div className="text-sm text-muted-foreground mt-1">{t('إجمالي المبالغ', 'Total amount')}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center justify-between"><AlertTriangle className="w-6 h-6 text-amber-600" /><div className="text-3xl font-bold text-amber-600">{bookingUnpaid.toLocaleString()}</div></div>
            <div className="text-sm text-muted-foreground mt-1">{t('غير مدفوع', 'Unpaid')}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center justify-between"><Users className="w-6 h-6 text-purple-600" /><div className="text-3xl font-bold text-purple-600">{coaches.length}</div></div>
            <div className="text-sm text-muted-foreground mt-1">{t('المدربون الخارجيون', 'External coaches')}</div>
          </CardContent></Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="bookings"><CalendarDays className="w-4 h-4 ml-1" />{t('الحجوزات', 'Bookings')}</TabsTrigger>
            <TabsTrigger value="coaches"><Users className="w-4 h-4 ml-1" />{t('المدربون', 'Coaches')}</TabsTrigger>
            <TabsTrigger value="payments"><Wallet className="w-4 h-4 ml-1" />{t('المدفوعات', 'Payments')}</TabsTrigger>
            <TabsTrigger value="report"><BarChart3 className="w-4 h-4 ml-1" />{t('التقرير الشهري', 'Monthly report')}</TabsTrigger>
          </TabsList>

          <TabsContent value="bookings">
            <Card className="mb-4"><CardContent className="p-4 flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs">{t('من', 'From')}</Label>
                <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-40" data-testid="input-rentals-from" />
              </div>
              <div>
                <Label className="text-xs">{t('إلى', 'To')}</Label>
                <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-40" data-testid="input-rentals-to" />
              </div>
              <div>
                <Label className="text-xs">{t('المدرب', 'Coach')}</Label>
                <Select value={filterCoach} onValueChange={setFilterCoach}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('الكل', 'All')}</SelectItem>
                    {activeCoaches.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t('الدفع', 'Payment')}</Label>
                <Select value={filterPay} onValueChange={setFilterPay}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('الكل', 'All')}</SelectItem>
                    <SelectItem value="unpaid">{t('غير مدفوع', 'Unpaid')}</SelectItem>
                    <SelectItem value="paid">{t('مدفوع', 'Paid')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent></Card>

            <Card><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr>
                  <th className="text-right p-3">{t('التاريخ', 'Date')}</th>
                  <th className="text-right p-3">{t('اليوم', 'Day')}</th>
                  <th className="text-right p-3">{t('المدرب', 'Coach')}</th>
                  <th className="text-right p-3">{t('الوقت', 'Time')}</th>
                  <th className="text-right p-3">{t('المدة', 'Hours')}</th>
                  <th className="text-right p-3">{t('المبلغ', 'Amount')}</th>
                  {isAdmin && <th className="text-right p-3">{t('الفرع', 'Branch')}</th>}
                  <th className="text-right p-3">{t('الحالة', 'Status')}</th>
                  <th className="text-right p-3">{t('إجراءات', 'Actions')}</th>
                </tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={9} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></td></tr>}
                  {!loading && bookings.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">{t('لا توجد حجوزات', 'No bookings')}</td></tr>}
                  {!loading && bookings.map(b => (
                    <tr key={b.id} className={`border-t hover:bg-muted/30 ${b.status === 'cancelled' ? 'opacity-50 line-through' : ''}`}>
                      <td className="p-3 font-mono text-xs">{b.date}</td>
                      <td className="p-3">{WEEKDAY_AR[b.weekday] || b.weekday}</td>
                      <td className="p-3 font-medium">{b.coach_name}</td>
                      <td className="p-3">{hourLabel(b.start_hour, ar)}</td>
                      <td className="p-3">{b.duration_hours}</td>
                      <td className="p-3 font-bold">
                        {(b.total_amount || 0).toLocaleString()}
                        {(b.persons_count || 0) > 0 && (
                          <span className="block text-[10px] font-normal text-muted-foreground">
                            {t(`${b.persons_count} فرد × ${b.person_rate}`, `${b.persons_count} × ${b.person_rate}/person`)}
                          </span>
                        )}
                      </td>
                      {isAdmin && <td className="p-3 text-xs">{branchName(b.branch_id)}</td>}
                      <td className="p-3">
                        {b.status === 'cancelled'
                          ? <Badge variant="outline" className="bg-gray-100 text-gray-500 text-xs">{t('ملغي', 'Cancelled')}</Badge>
                          : b.payment_status === 'paid'
                            ? <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">{t('مدفوع', 'Paid')}</Badge>
                            : <Badge variant="outline" className="bg-amber-50 text-amber-700 text-xs">{t('غير مدفوع', 'Unpaid')}</Badge>}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {b.status !== 'cancelled' && b.payment_status === 'unpaid' && (
                            <Button size="sm" variant="ghost" title={t('تعديل العدد', 'Edit persons')} onClick={() => openEditBooking(b)} data-testid={`button-edit-booking-${b.id}`}><Pencil className="w-4 h-4 text-blue-600" /></Button>
                          )}
                          {b.status !== 'cancelled' && b.payment_status === 'unpaid' && (
                            <Button size="sm" variant="ghost" title={t('إلغاء', 'Cancel')} onClick={() => cancelBooking(b)}><Ban className="w-4 h-4 text-amber-600" /></Button>
                          )}
                          {isAdmin && b.payment_status !== 'paid' && (
                            <Button size="sm" variant="ghost" title={t('حذف', 'Delete')} onClick={() => deleteBooking(b)}><Trash2 className="w-4 h-4 text-red-600" /></Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="coaches">
            <Card><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr>
                  <th className="text-right p-3">{t('الاسم', 'Name')}</th>
                  <th className="text-right p-3">{t('الجوال', 'Phone')}</th>
                  <th className="text-right p-3">{t('النشاط', 'Activity')}</th>
                  <th className="text-right p-3">{t('سعر الساعة', 'Rate/hr')}</th>
                  <th className="text-right p-3">{t('الساعات', 'Hours')}</th>
                  <th className="text-right p-3">{t('الإجمالي', 'Total')}</th>
                  <th className="text-right p-3">{t('غير مدفوع', 'Unpaid')}</th>
                  <th className="text-right p-3">{t('إجراءات', 'Actions')}</th>
                </tr></thead>
                <tbody>
                  {coaches.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{t('لا يوجد مدربون بعد', 'No coaches yet')}</td></tr>}
                  {coaches.map(c => (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="p-3 font-medium">{c.name}</td>
                      <td className="p-3 font-mono text-xs" dir="ltr">{c.phone}</td>
                      <td className="p-3">{c.activity}</td>
                      <td className="p-3">{(c.hourly_rate || 0).toLocaleString()}</td>
                      <td className="p-3">{c.total_hours || 0}</td>
                      <td className="p-3 font-bold">{(c.total_amount || 0).toLocaleString()}</td>
                      <td className="p-3">
                        {(c.unpaid_amount || 0) > 0
                          ? <Badge variant="outline" className="bg-amber-50 text-amber-700">{c.unpaid_amount.toLocaleString()}</Badge>
                          : <Badge variant="outline" className="bg-green-50 text-green-700">0</Badge>}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {(c.unpaid_amount || 0) > 0 && (
                            <Button size="sm" variant="outline" onClick={() => openPaymentDialog(c.id)} data-testid={`button-collect-${c.id}`}>
                              <Wallet className="w-4 h-4 ml-1" />{t('تحصيل', 'Collect')}
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => openCoachDialog(c)}>{t('تعديل', 'Edit')}</Button>
                          {isAdmin && (
                            <Button size="sm" variant="ghost" onClick={() => deleteCoach(c)}><Trash2 className="w-4 h-4 text-red-600" /></Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="payments">
            <div className="mb-3 flex justify-end">
              <Button onClick={() => openPaymentDialog('')} data-testid="button-add-payment">
                <Plus className="w-4 h-4 ml-1" />{t('تسجيل دفعة', 'Record payment')}
              </Button>
            </div>
            <Card><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr>
                  <th className="text-right p-3">{t('رقم الإيصال', 'Receipt')}</th>
                  <th className="text-right p-3">{t('التاريخ', 'Date')}</th>
                  <th className="text-right p-3">{t('المدرب', 'Coach')}</th>
                  <th className="text-right p-3">{t('الحجوزات', 'Bookings')}</th>
                  <th className="text-right p-3">{t('الساعات', 'Hours')}</th>
                  <th className="text-right p-3">{t('المبلغ', 'Amount')}</th>
                  <th className="text-right p-3">{t('الطريقة', 'Method')}</th>
                  <th className="text-right p-3">{t('إجراءات', 'Actions')}</th>
                </tr></thead>
                <tbody>
                  {payments.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{t('لا توجد مدفوعات', 'No payments')}</td></tr>}
                  {payments.map(p => (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs">{p.receipt_number}</td>
                      <td className="p-3 font-mono text-xs">{p.payment_date}</td>
                      <td className="p-3 font-medium">{p.coach_name}</td>
                      <td className="p-3">{p.bookings_count}</td>
                      <td className="p-3">{p.total_hours}</td>
                      <td className="p-3 font-bold text-green-700">{(p.amount || 0).toLocaleString()}</td>
                      <td className="p-3">{p.payment_method_ar || p.payment_method}</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" title={t('طباعة', 'Print')} onClick={() => printReceipt(p)}><Printer className="w-4 h-4" /></Button>
                          {isAdmin && (
                            <Button size="sm" variant="ghost" title={t('حذف', 'Delete')} onClick={() => deletePayment(p)}><Trash2 className="w-4 h-4 text-red-600" /></Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="report">
            <Card className="mb-4"><CardContent className="p-4 flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs">{t('الشهر', 'Month')}</Label>
                <Input type="month" value={reportMonth} onChange={e => setReportMonth(e.target.value)} className="w-44" data-testid="input-report-month" />
              </div>
              <Button variant="outline" onClick={exportReportCSV} disabled={!report}>
                <Download className="w-4 h-4 ml-1" />{t('تصدير CSV', 'Export CSV')}
              </Button>
            </CardContent></Card>

            {report && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <Card><CardContent className="p-4">
                    <div className="text-2xl font-bold text-blue-600">{(report.total_booked || 0).toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">{t('إجمالي الحجوزات (ريال)', 'Total booked')}</div>
                  </CardContent></Card>
                  <Card><CardContent className="p-4">
                    <div className="text-2xl font-bold text-green-600">{(report.total_collected || 0).toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">{t('المحصّل هذا الشهر', 'Collected this month')}</div>
                  </CardContent></Card>
                  <Card><CardContent className="p-4">
                    <div className="text-2xl font-bold text-amber-600">{(report.total_unpaid || 0).toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">{t('غير مدفوع', 'Unpaid')}</div>
                  </CardContent></Card>
                  <Card><CardContent className="p-4">
                    <div className="text-2xl font-bold text-purple-600">{report.total_hours || 0}</div>
                    <div className="text-sm text-muted-foreground">{t('إجمالي الساعات', 'Total hours')}</div>
                  </CardContent></Card>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  <Card className="md:col-span-2"><CardContent className="p-0 overflow-x-auto">
                    <div className="p-3 font-bold border-b">{t('حسب المدرب', 'By coach')}</div>
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50"><tr>
                        <th className="text-right p-3">{t('المدرب', 'Coach')}</th>
                        <th className="text-right p-3">{t('حجوزات', 'Bookings')}</th>
                        <th className="text-right p-3">{t('ساعات', 'Hours')}</th>
                        <th className="text-right p-3">{t('الإجمالي', 'Total')}</th>
                        <th className="text-right p-3">{t('غير مدفوع', 'Unpaid')}</th>
                      </tr></thead>
                      <tbody>
                        {report.by_coach.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">{t('لا توجد بيانات', 'No data')}</td></tr>}
                        {report.by_coach.map(c => (
                          <tr key={c.coach_id} className="border-t">
                            <td className="p-3 font-medium">{c.coach_name}</td>
                            <td className="p-3">{c.bookings}</td>
                            <td className="p-3">{c.hours}</td>
                            <td className="p-3 font-bold">{(c.amount || 0).toLocaleString()}</td>
                            <td className="p-3 text-amber-700">{(c.unpaid || 0).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent></Card>
                  <Card><CardContent className="p-4">
                    <div className="font-bold mb-3">{t('الساعات الأكثر طلباً', 'Popular hours')}</div>
                    {report.by_hour.length === 0 && <div className="text-sm text-muted-foreground">{t('لا توجد بيانات', 'No data')}</div>}
                    <div className="space-y-2">
                      {report.by_hour.map(h => (
                        <div key={h.hour} className="flex items-center justify-between text-sm">
                          <span>{hourLabel(h.hour, ar)}</span>
                          <Badge variant="outline" className="bg-blue-50 text-blue-700">{h.count} {t('حجز', 'bookings')}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent></Card>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* ===== Booking dialog ===== */}
        <Dialog open={showBooking} onOpenChange={setShowBooking}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir={ar ? 'rtl' : 'ltr'}>
            <DialogHeader><DialogTitle>{t('حجز تأجير جديد', 'New rental booking')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>{t('المدرب الخارجي', 'External coach')}</Label>
                <div className="flex gap-2">
                  <Select value={bk.coach_id} onValueChange={v => {
                    const c = coaches.find(x => x.id === v);
                    setBk(prev => ({ ...prev, coach_id: v, hourly_rate: prev.hourly_rate || (c?.hourly_rate || '') }));
                  }}>
                    <SelectTrigger className="flex-1" data-testid="select-booking-coach"><SelectValue placeholder={t('اختر المدرب', 'Select coach')} /></SelectTrigger>
                    <SelectContent>
                      {coaches.map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.activity ? ` (${c.activity})` : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={() => openCoachDialog()}><Plus className="w-4 h-4" /></Button>
                </div>
              </div>

              {isAdmin && branches.length > 0 && (
                <div>
                  <Label>{t('الفرع', 'Branch')}</Label>
                  <Select value={bk.branch_id || ''} onValueChange={v => setBk(prev => ({ ...prev, branch_id: v }))}>
                    <SelectTrigger data-testid="select-booking-branch"><SelectValue placeholder={t('اختر الفرع', 'Select branch')} /></SelectTrigger>
                    <SelectContent>
                      {branches.map(b => <SelectItem key={b.id} value={b.id}>{ar ? (b.name_ar || b.name) : (b.name || b.name_ar)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input id="recurring" type="checkbox" className="w-4 h-4" checked={bk.recurring} onChange={e => setBk(prev => ({ ...prev, recurring: e.target.checked }))} data-testid="checkbox-recurring" />
                <Label htmlFor="recurring">{t('حجز متكرر (أسبوعي)', 'Recurring (weekly)')}</Label>
              </div>

              {!bk.recurring ? (
                <div>
                  <Label>{t('التاريخ', 'Date')}</Label>
                  <Input type="date" value={bk.date} onChange={e => setBk(prev => ({ ...prev, date: e.target.value }))} data-testid="input-booking-date" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t('من تاريخ', 'From')}</Label>
                      <Input type="date" value={bk.start_date} onChange={e => setBk(prev => ({ ...prev, start_date: e.target.value }))} />
                    </div>
                    <div>
                      <Label>{t('إلى تاريخ', 'To')}</Label>
                      <Input type="date" value={bk.end_date} onChange={e => setBk(prev => ({ ...prev, end_date: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <Label>{t('أيام الأسبوع', 'Weekdays')}</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {WEEKDAYS.map(w => (
                        <button
                          key={w.key}
                          type="button"
                          onClick={() => setBk(prev => ({
                            ...prev,
                            days: prev.days.includes(w.key) ? prev.days.filter(d => d !== w.key) : [...prev.days, w.key],
                          }))}
                          className={`px-3 py-1 rounded-full text-sm border transition-colors ${bk.days.includes(w.key) ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/30 hover:bg-muted'}`}
                        >
                          {ar ? w.ar : w.en}
                        </button>
                      ))}
                    </div>
                  </div>
                  {bk.days.length > 0 && (
                    <div className="border rounded-md p-3 bg-muted/20">
                      <Label className="text-xs">{t('عدد الأفراد لكل يوم (اختياري)', 'Persons per weekday (optional)')}</Label>
                      <p className="text-[11px] text-muted-foreground mb-2">
                        {t('اتركه فارغاً لاستخدام العدد الموحد بالأسفل', 'Leave empty to use the shared count below')}
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {WEEKDAYS.filter(w => bk.days.includes(w.key)).map(w => (
                          <div key={w.key}>
                            <Label className="text-xs">{ar ? w.ar : w.en}</Label>
                            <Input
                              type="number" min="0" step="1"
                              placeholder={bk.persons_count || '0'}
                              value={bk.day_persons[w.key] ?? ''}
                              onChange={e => setBk(prev => ({ ...prev, day_persons: { ...prev.day_persons, [w.key]: e.target.value } }))}
                              data-testid={`input-day-persons-${w.key}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>{t('الساعة', 'Hour')}</Label>
                  <Select value={String(bk.start_hour)} onValueChange={v => setBk(prev => ({ ...prev, start_hour: Number(v) }))}>
                    <SelectTrigger data-testid="select-booking-hour"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 18 }, (_, i) => i + 6).map(h => (
                        <SelectItem key={h} value={String(h)}>{hourLabel(h, ar)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t('المدة (ساعات)', 'Duration (hrs)')}</Label>
                  <Input type="number" min="0.5" step="0.5" max="12" value={bk.duration_hours} onChange={e => setBk(prev => ({ ...prev, duration_hours: e.target.value }))} data-testid="input-booking-duration" />
                </div>
                <div>
                  <Label>{t('سعر الساعة', 'Rate/hr')}</Label>
                  <Input type="number" min="0" value={bk.hourly_rate} onChange={e => setBk(prev => ({ ...prev, hourly_rate: e.target.value }))} data-testid="input-booking-rate" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('عدد الأفراد (اختياري)', 'Persons (optional)')}</Label>
                  <Input type="number" min="0" step="1" value={bk.persons_count} onChange={e => setBk(prev => ({ ...prev, persons_count: e.target.value }))} data-testid="input-booking-persons" />
                </div>
                <div>
                  <Label>{t('سعر الفرد / ساعة', 'Rate per person/hr')}</Label>
                  <Input type="number" min="0" value={bk.person_rate} onChange={e => setBk(prev => ({ ...prev, person_rate: e.target.value }))} data-testid="input-booking-person-rate" />
                </div>
              </div>

              <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
                {(() => {
                  const dur = parseFloat(bk.duration_hours) || 0;
                  const hourPart = (parseFloat(bk.hourly_rate) || 0) * dur;
                  const personRate = parseFloat(bk.person_rate) || 0;
                  const sharedPersons = parseInt(bk.persons_count, 10) || 0;
                  // Per-weekday overrides in play?
                  const overrides = bk.recurring
                    ? WEEKDAYS.filter(w => bk.days.includes(w.key) && bk.day_persons[w.key] !== '' && bk.day_persons[w.key] != null)
                    : [];
                  if (overrides.length > 0) {
                    return (
                      <>
                        <div className="text-xs text-muted-foreground mb-1">{t('الإجمالي حسب اليوم:', 'Total per weekday:')}</div>
                        {WEEKDAYS.filter(w => bk.days.includes(w.key)).map(w => {
                          const raw = bk.day_persons[w.key];
                          const p = (raw === '' || raw == null) ? sharedPersons : (parseInt(raw, 10) || 0);
                          const total = hourPart + p * personRate * dur;
                          return (
                            <div key={w.key} className="flex justify-between text-xs">
                              <span>{ar ? w.ar : w.en} ({p} {t('فرد', 'persons')})</span>
                              <span className="font-bold">{total.toLocaleString()} {t('ريال', 'SAR')}</span>
                            </div>
                          );
                        })}
                      </>
                    );
                  }
                  const personPart = sharedPersons * personRate * dur;
                  return (
                    <>
                      {personPart > 0 && (
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{t('الساعات:', 'Hours:')} {hourPart.toLocaleString()}</span>
                          <span>{t('الأفراد:', 'Persons:')} {personPart.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>{t('إجمالي كل حجز:', 'Total per booking:')}</span>
                        <span className="font-bold">{(hourPart + personPart).toLocaleString()} {t('ريال', 'SAR')}</span>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div>
                <Label>{t('ملاحظات', 'Notes')}</Label>
                <Textarea rows={2} value={bk.notes} onChange={e => setBk(prev => ({ ...prev, notes: e.target.value }))} />
              </div>

              {conflicts && (
                <div className="border border-amber-300 bg-amber-50 rounded-md p-3 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-amber-800">
                    <AlertTriangle className="w-4 h-4" />{t('توجد تعارضات في المواعيد:', 'Schedule conflicts found:')}
                  </div>
                  <ul className="text-xs text-amber-800 space-y-1 pr-4 list-disc">
                    {conflicts.slice(0, 8).map((c, i) => <li key={i}>{c.date}: {c.description}</li>)}
                    {conflicts.length > 8 && <li>{t(`و ${conflicts.length - 8} تعارضات أخرى...`, `and ${conflicts.length - 8} more...`)}</li>}
                  </ul>
                  <div className="text-xs text-amber-700">{t('يمكنك المتابعة رغم التعارض أو تعديل الموعد.', 'You can proceed anyway or change the time.')}</div>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setShowBooking(false); setConflicts(null); }}>{t('إغلاق', 'Close')}</Button>
              {conflicts ? (
                <Button onClick={() => submitBooking(true)} disabled={saving} className="bg-amber-600 hover:bg-amber-700" data-testid="button-force-booking">
                  {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}{t('تأكيد رغم التعارض', 'Confirm anyway')}
                </Button>
              ) : (
                <Button onClick={() => submitBooking(false)} disabled={saving} data-testid="button-save-booking">
                  {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}{t('حفظ الحجز', 'Save booking')}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Edit booking persons dialog ===== */}
        <Dialog open={!!editBooking} onOpenChange={(o) => { if (!o) setEditBooking(null); }}>
          <DialogContent className="max-w-sm" dir={ar ? 'rtl' : 'ltr'}>
            <DialogHeader><DialogTitle>{t('تعديل عدد الأفراد', 'Edit persons count')}</DialogTitle></DialogHeader>
            {editBooking && (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
                  {editBooking.coach_name} — {editBooking.date} ({WEEKDAY_AR[editBooking.weekday] || editBooking.weekday}) — {hourLabel(editBooking.start_hour, ar)}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t('عدد الأفراد', 'Persons')}</Label>
                    <Input
                      type="number" min="0" step="1" autoFocus
                      value={editForm.persons_count}
                      onChange={e => setEditForm(p => ({ ...p, persons_count: e.target.value }))}
                      data-testid="input-edit-persons"
                    />
                  </div>
                  <div>
                    <Label>{t('سعر الفرد / ساعة', 'Rate per person/hr')}</Label>
                    <Input
                      type="number" min="0"
                      value={editForm.person_rate}
                      onChange={e => setEditForm(p => ({ ...p, person_rate: e.target.value }))}
                      data-testid="input-edit-person-rate"
                    />
                  </div>
                </div>
                {(() => {
                  const dur = editBooking.duration_hours || 1;
                  const hourPart = (editBooking.hourly_rate || 0) * dur;
                  const personPart = (parseInt(editForm.persons_count, 10) || 0) * (parseFloat(editForm.person_rate) || 0) * dur;
                  return (
                    <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{t('الساعات:', 'Hours:')} {hourPart.toLocaleString()}</span>
                        <span>{t('الأفراد:', 'Persons:')} {personPart.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('الإجمالي الجديد:', 'New total:')}</span>
                        <span className="font-bold">{(hourPart + personPart).toLocaleString()} {t('ريال', 'SAR')}</span>
                      </div>
                      {(hourPart + personPart) !== (editBooking.total_amount || 0) && (
                        <div className="text-[11px] text-muted-foreground">
                          {t(`الإجمالي الحالي: ${(editBooking.total_amount || 0).toLocaleString()}`, `Current total: ${(editBooking.total_amount || 0).toLocaleString()}`)}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setEditBooking(null)}>{t('إلغاء', 'Cancel')}</Button>
              <Button onClick={submitEditBooking} disabled={saving} data-testid="button-save-edit-booking">
                {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}{t('حفظ', 'Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Coach dialog ===== */}
        <Dialog open={showCoach} onOpenChange={setShowCoach}>
          <DialogContent className="max-w-md" dir={ar ? 'rtl' : 'ltr'}>
            <DialogHeader><DialogTitle>{editingCoachId ? t('تعديل مدرب', 'Edit coach') : t('مدرب خارجي جديد', 'New external coach')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>{t('الاسم', 'Name')} *</Label>
                <Input value={coachForm.name} onChange={e => setCoachForm(p => ({ ...p, name: e.target.value }))} data-testid="input-coach-name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('الجوال', 'Phone')}</Label>
                  <Input dir="ltr" value={coachForm.phone} onChange={e => setCoachForm(p => ({ ...p, phone: e.target.value }))} data-testid="input-coach-phone" />
                </div>
                <div>
                  <Label>{t('النشاط', 'Activity')}</Label>
                  <Input value={coachForm.activity} onChange={e => setCoachForm(p => ({ ...p, activity: e.target.value }))} placeholder={t('كرة قدم، سباحة...', 'Football, Swimming...')} />
                </div>
              </div>
              <div>
                <Label>{t('سعر الساعة الافتراضي', 'Default hourly rate')}</Label>
                <Input type="number" min="0" value={coachForm.hourly_rate} onChange={e => setCoachForm(p => ({ ...p, hourly_rate: e.target.value }))} data-testid="input-coach-rate" />
              </div>
              {isAdmin && !editingCoachId && branches.length > 0 && (
                <div>
                  <Label>{t('الفرع', 'Branch')}</Label>
                  <Select value={coachForm.branch_id || ''} onValueChange={v => setCoachForm(p => ({ ...p, branch_id: v }))}>
                    <SelectTrigger><SelectValue placeholder={t('اختر الفرع', 'Select branch')} /></SelectTrigger>
                    <SelectContent>
                      {branches.map(b => <SelectItem key={b.id} value={b.id}>{ar ? (b.name_ar || b.name) : (b.name || b.name_ar)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>{t('ملاحظات', 'Notes')}</Label>
                <Textarea rows={2} value={coachForm.notes} onChange={e => setCoachForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowCoach(false)}>{t('إلغاء', 'Cancel')}</Button>
              <Button onClick={submitCoach} disabled={saving} data-testid="button-save-coach">
                {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}{t('حفظ', 'Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Payment dialog ===== */}
        <Dialog open={showPayment} onOpenChange={setShowPayment}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir={ar ? 'rtl' : 'ltr'}>
            <DialogHeader><DialogTitle>{t('تسجيل دفعة تأجير', 'Record rental payment')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>{t('المدرب', 'Coach')}</Label>
                <Select value={payCoach} onValueChange={v => { setPayCoach(v); setSelectedIds(new Set()); loadUnpaid(v); }}>
                  <SelectTrigger data-testid="select-payment-coach"><SelectValue placeholder={t('اختر المدرب', 'Select coach')} /></SelectTrigger>
                  <SelectContent>
                    {coaches.map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.unpaid_amount ? ` — ${t('عليه', 'owes')} ${c.unpaid_amount.toLocaleString()}` : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {payCoach && (
                <div className="border rounded-md max-h-56 overflow-y-auto">
                  {unpaidBookings.length === 0 && <div className="p-4 text-center text-sm text-muted-foreground">{t('لا توجد حجوزات غير مدفوعة', 'No unpaid bookings')}</div>}
                  {unpaidBookings.map(b => (
                    <label key={b.id} className="flex items-center gap-2 p-2 border-b last:border-b-0 hover:bg-muted/30 cursor-pointer text-sm">
                      <input type="checkbox" className="w-4 h-4" checked={selectedIds.has(b.id)} onChange={() => toggleId(b.id)} />
                      <span className="font-mono text-xs">{b.date}</span>
                      <span>{WEEKDAY_AR[b.weekday] || b.weekday}</span>
                      <span>{hourLabel(b.start_hour, ar)}</span>
                      <span className="mr-auto font-bold">{(b.total_amount || 0).toLocaleString()}</span>
                    </label>
                  ))}
                </div>
              )}

              {unpaidBookings.length > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <button
                    type="button"
                    className="text-primary underline"
                    onClick={() => setSelectedIds(selectedIds.size === unpaidBookings.length ? new Set() : new Set(unpaidBookings.map(b => b.id)))}
                  >
                    {selectedIds.size === unpaidBookings.length ? t('إلغاء تحديد الكل', 'Unselect all') : t('تحديد الكل', 'Select all')}
                  </button>
                  <div className="font-bold text-lg">{selectedTotal.toLocaleString()} {t('ريال', 'SAR')}</div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('طريقة الدفع', 'Method')}</Label>
                  <Select value={payMethod} onValueChange={setPayMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{ar ? m.ar : m.en}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t('تاريخ الدفع', 'Payment date')}</Label>
                  <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>{t('ملاحظات', 'Notes')}</Label>
                <Textarea rows={2} value={payNotes} onChange={e => setPayNotes(e.target.value)} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowPayment(false)}>{t('إلغاء', 'Cancel')}</Button>
              <Button onClick={submitPayment} disabled={saving || selectedIds.size === 0} data-testid="button-save-payment">
                {saving && <Loader2 className="w-4 h-4 animate-spin ml-1" />}{t('تسجيل وطباعة الإيصال', 'Record & print receipt')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
