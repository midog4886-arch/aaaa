import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import {
  ClipboardList, Plus, Trash2, Pencil, FileSpreadsheet, FileText,
  Loader2, Star, CalendarDays, BarChart3, NotebookPen
} from 'lucide-react';
import { toast } from 'sonner';
import Layout from '../components/Layout';
import { coachNotesAPI, coachesAPI } from '../services/api';

const CATEGORIES = [
  { key: 'punctuality', label: 'الالتزام بالمواعيد' },
  { key: 'member_handling', label: 'التعامل مع الأعضاء' },
  { key: 'performance', label: 'الأداء' },
];

const todayStr = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const coachName = (c) => c?.name_ar || c?.name || '';
const fmtAvg = (v) => (v === null || v === undefined ? '—' : v);

const StarRating = ({ value, onChange, size = 22 }) => (
  <div className="flex items-center gap-1" dir="ltr">
    {[1, 2, 3, 4, 5].map((n) => (
      <button
        key={n}
        type="button"
        onClick={() => onChange(value === n ? null : n)}
        className="transition-transform hover:scale-110"
        aria-label={`${n}`}
      >
        <Star
          size={size}
          className={n <= (value || 0) ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}
        />
      </button>
    ))}
    <span className="text-xs text-gray-500 mr-1">{value ? `${value}/5` : 'بدون'}</span>
  </div>
);

const emptyRatings = { punctuality: null, member_handling: null, performance: null };

const CoachNotesPage = () => {
  const [tab, setTab] = useState('entries'); // 'entries' | 'report'
  const [coaches, setCoaches] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [filterCoach, setFilterCoach] = useState('all');
  const [filterMonth, setFilterMonth] = useState(currentMonth());

  // add/edit form
  const [form, setForm] = useState({ coach_id: '', date: todayStr(), note_text: '', ratings: { ...emptyRatings } });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [showForm, setShowForm] = useState(false);

  // delete
  const [deleteTarget, setDeleteTarget] = useState(null);

  // report
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState('');

  const loadCoaches = useCallback(async () => {
    try {
      const res = await coachesAPI.getAll();
      setCoaches(res.data?.coaches || res.data || []);
    } catch (e) {
      toast.error('فشل في تحميل المدربين');
    }
  }, []);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const params = { month: filterMonth };
      if (filterCoach !== 'all') params.coach_id = filterCoach;
      const res = await coachNotesAPI.getAll(params);
      setNotes(res.data || []);
    } catch (e) {
      toast.error('فشل في تحميل الملاحظات');
    } finally {
      setLoading(false);
    }
  }, [filterCoach, filterMonth]);

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const params = { month: filterMonth };
      if (filterCoach !== 'all') params.coach_id = filterCoach;
      const res = await coachNotesAPI.monthlyReport(params);
      setReport(res.data);
    } catch (e) {
      toast.error('فشل في تحميل التقرير');
    } finally {
      setReportLoading(false);
    }
  }, [filterCoach, filterMonth]);

  useEffect(() => { loadCoaches(); }, [loadCoaches]);
  useEffect(() => {
    if (tab === 'entries') loadNotes();
    else loadReport();
  }, [tab, loadNotes, loadReport]);

  const openAdd = () => {
    setEditId(null);
    setForm({
      coach_id: filterCoach !== 'all' ? filterCoach : '',
      date: todayStr(),
      note_text: '',
      ratings: { ...emptyRatings },
    });
    setShowForm(true);
  };

  const openEdit = (note) => {
    setEditId(note.id);
    setForm({
      coach_id: note.coach_id,
      date: note.date,
      note_text: note.note_text || '',
      ratings: { ...emptyRatings, ...(note.ratings || {}) },
    });
    setShowForm(true);
  };

  const setRating = (key, val) => setForm((f) => ({ ...f, ratings: { ...f.ratings, [key]: val } }));

  const handleSave = async () => {
    if (!form.coach_id) { toast.error('اختر المدرب أولاً'); return; }
    const hasRating = CATEGORIES.some((c) => form.ratings[c.key] != null);
    if (!form.note_text.trim() && !hasRating) {
      toast.error('اكتب ملاحظة أو قيّم تصنيف واحد على الأقل');
      return;
    }
    setSaving(true);
    try {
      const payload = { coach_id: form.coach_id, date: form.date, note_text: form.note_text, ratings: form.ratings };
      if (editId) {
        await coachNotesAPI.update(editId, { date: form.date, note_text: form.note_text, ratings: form.ratings });
        toast.success('تم تعديل الملاحظة');
      } else {
        await coachNotesAPI.create(payload);
        toast.success('تم حفظ الملاحظة');
      }
      setShowForm(false);
      loadNotes();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'فشل في حفظ الملاحظة');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await coachNotesAPI.delete(deleteTarget.id);
      toast.success('تم حذف الملاحظة');
      setDeleteTarget(null);
      loadNotes();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'فشل في الحذف');
    }
  };

  const handleExport = async (format) => {
    setExporting(format);
    try {
      const params = { month: filterMonth, format };
      if (filterCoach !== 'all') params.coach_id = filterCoach;
      const res = await coachNotesAPI.exportReport(params);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `coach_notes_${filterMonth}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('فشل في التصدير');
    } finally {
      setExporting('');
    }
  };

  const renderMiniRatings = (ratings) => (
    <div className="flex flex-wrap gap-2 text-xs">
      {CATEGORIES.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0.5">
          {c.label}: <b className={ratings?.[c.key] ? 'text-amber-600' : 'text-gray-400'}>{ratings?.[c.key] ?? '—'}</b>
        </span>
      ))}
    </div>
  );

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-4" dir="rtl">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="bg-orange-100 text-orange-600 p-2 rounded-lg">
              <ClipboardList size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold">ملاحظات المدربين اليومية</h1>
              <p className="text-sm text-gray-500">تقييم المشرف للمدرب — يتجمّع في تقرير شهري (سري عن المدرب)</p>
            </div>
          </div>
          {tab === 'entries' && (
            <Button onClick={openAdd} className="gap-2">
              <Plus size={18} /> إضافة ملاحظة
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b">
          <button
            onClick={() => setTab('entries')}
            className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 ${tab === 'entries' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500'}`}
          >
            <NotebookPen size={16} /> الملاحظات
          </button>
          <button
            onClick={() => setTab('report')}
            className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 ${tab === 'report' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500'}`}
          >
            <BarChart3 size={16} /> التقرير الشهري
          </button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 flex flex-col md:flex-row gap-3 md:items-end">
            <div className="flex-1">
              <label className="block text-sm mb-1 text-gray-600">المدرب</label>
              <Select value={filterCoach} onValueChange={setFilterCoach}>
                <SelectTrigger><SelectValue placeholder="كل المدربين" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المدربين</SelectItem>
                  {coaches.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{coachName(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="block text-sm mb-1 text-gray-600">الشهر</label>
              <input
                type="month"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
            {tab === 'report' && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleExport('xlsx')} disabled={!!exporting} className="gap-1">
                  {exporting === 'xlsx' ? <Loader2 className="animate-spin" size={16} /> : <FileSpreadsheet size={16} />} Excel
                </Button>
                <Button variant="outline" onClick={() => handleExport('pdf')} disabled={!!exporting} className="gap-1">
                  {exporting === 'pdf' ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />} PDF
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Entries view */}
        {tab === 'entries' && (
          loading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-orange-500" size={32} /></div>
          ) : notes.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <ClipboardList size={40} className="mx-auto mb-2 opacity-40" />
              لا توجد ملاحظات لهذا الشهر
            </div>
          ) : (
            <div className="space-y-3">
              {notes.map((n) => (
                <Card key={n.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold">{n.coach_name}</span>
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <CalendarDays size={14} /> {n.date}
                          </span>
                        </div>
                        {n.note_text && <p className="mt-2 text-sm whitespace-pre-wrap text-gray-700">{n.note_text}</p>}
                        <div className="mt-2">{renderMiniRatings(n.ratings)}</div>
                        {n.created_by_name && (
                          <p className="mt-2 text-xs text-gray-400">بواسطة: {n.created_by_name}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(n)}><Pencil size={16} /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(n)}>
                          <Trash2 size={16} className="text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        )}

        {/* Report view */}
        {tab === 'report' && (
          reportLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-orange-500" size={32} /></div>
          ) : !report || report.coaches.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <BarChart3 size={40} className="mx-auto mb-2 opacity-40" />
              لا توجد بيانات للتقرير في هذا الشهر
            </div>
          ) : (
            <div className="space-y-4">
              {report.coaches.map((c) => (
                <Card key={c.coach_id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                      <span>{c.coach_name}</span>
                      <span className="text-xs font-normal text-gray-500">عدد الملاحظات: {c.count}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {CATEGORIES.map((cat) => (
                        <div key={cat.key} className="bg-orange-50 rounded-lg p-2 text-center">
                          <div className="text-xs text-gray-600">{cat.label}</div>
                          <div className="text-lg font-bold text-orange-600 flex items-center justify-center gap-1">
                            <Star size={14} className="fill-amber-400 text-amber-400" />
                            {fmtAvg(c.averages?.[cat.key])}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      {c.notes.map((n) => (
                        <div key={n.id} className="border rounded-md p-2 text-sm">
                          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                            <CalendarDays size={12} /> {n.date}
                          </div>
                          {n.note_text && <p className="whitespace-pre-wrap text-gray-700">{n.note_text}</p>}
                          <div className="mt-1">{renderMiniRatings(n.ratings)}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        )}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? 'تعديل ملاحظة' : 'إضافة ملاحظة جديدة'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm mb-1 text-gray-600">المدرب</label>
              <Select value={form.coach_id} onValueChange={(v) => setForm((f) => ({ ...f, coach_id: v }))} disabled={!!editId}>
                <SelectTrigger><SelectValue placeholder="اختر المدرب" /></SelectTrigger>
                <SelectContent>
                  {coaches.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{coachName(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600">التاريخ</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm text-gray-600">التقييم</label>
              {CATEGORIES.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{c.label}</span>
                  <StarRating value={form.ratings[c.key]} onChange={(v) => setRating(c.key, v)} />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600">الملاحظة (نص حر)</label>
              <Textarea
                value={form.note_text}
                onChange={(e) => setForm((f) => ({ ...f, note_text: e.target.value }))}
                placeholder="اكتب ملاحظتك عن المدرب..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1">
              {saving && <Loader2 className="animate-spin" size={16} />} حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف الملاحظة</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">هل أنت متأكد من حذف هذه الملاحظة؟ لا يمكن التراجع.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={handleDelete}>حذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default CoachNotesPage;
