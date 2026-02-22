import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import api, { membersAPI, branchesAPI } from '../services/api';
import { toast } from 'sonner';
import {
  CalendarOff, Plus, Trash2, Play, Clock, User, Users,
  CalendarDays, CheckCircle, AlertTriangle, History, Loader2
} from 'lucide-react';

const REASON_LABELS = {
  ar: { holiday: 'إجازة رسمية', maintenance: 'صيانة', emergency: 'طارئ', other: 'أخرى' },
  en: { holiday: 'Official Holiday', maintenance: 'Maintenance', emergency: 'Emergency', other: 'Other' }
};

const REASON_COLORS = {
  holiday: 'bg-blue-100 text-blue-800',
  maintenance: 'bg-orange-100 text-orange-800',
  emergency: 'bg-red-100 text-red-800',
  other: 'bg-gray-100 text-gray-800'
};

export default function DayExtensionsPage() {
  const { language } = useLanguage();
  const t = (ar, en) => language === 'ar' ? ar : en;

  const [closures, setClosures] = useState([]);
  const [logs, setLogs] = useState([]);
  const [members, setMembers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('closures');

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newClosure, setNewClosure] = useState({
    title_ar: '', title_en: '', reason: 'holiday', start_date: '', end_date: '', notes: ''
  });

  const [manualExt, setManualExt] = useState({ member_id: '', days: 1, reason: '' });
  const [applyBranch, setApplyBranch] = useState('all');

  const loadData = useCallback(async () => {
    try {
      const [closuresRes, logsRes, membersRes, branchesRes] = await Promise.all([
        api.dayExtensions.getClosures(),
        api.dayExtensions.getLogs(),
        membersAPI.getAll(),
        branchesAPI.getAll()
      ]);
      setClosures(closuresRes.data || []);
      setLogs(logsRes.data || []);
      setMembers(membersRes.data || []);
      setBranches(branchesRes.data || []);
    } catch (error) {
      toast.error(t('خطأ في تحميل البيانات', 'Error loading data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateClosure = async () => {
    if (!newClosure.title_ar || !newClosure.start_date || !newClosure.end_date) {
      toast.error(t('أكمل جميع الحقول المطلوبة', 'Fill all required fields'));
      return;
    }
    setSaving(true);
    try {
      await api.dayExtensions.createClosure(newClosure);
      toast.success(t('تم إضافة فترة الإغلاق', 'Closure period added'));
      setShowCreateDialog(false);
      setNewClosure({ title_ar: '', title_en: '', reason: 'holiday', start_date: '', end_date: '', notes: '' });
      loadData();
    } catch (error) {
      toast.error(t('خطأ في الإضافة', 'Error adding'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClosure = async (id) => {
    if (!window.confirm(t('هل تريد حذف فترة الإغلاق؟', 'Delete this closure?'))) return;
    try {
      await api.dayExtensions.deleteClosure(id);
      toast.success(t('تم الحذف', 'Deleted'));
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || t('خطأ في الحذف', 'Error deleting'));
    }
  };

  const handleApplyExtension = async (closure) => {
    const days = closure.days;
    if (!window.confirm(t(
      `هل تريد ترحيل ${days} أيام لجميع المشتركين النشطين؟ هذا الإجراء لا يمكن التراجع عنه.`,
      `Extend all active members by ${days} days? This action cannot be undone.`
    ))) return;
    setApplying(true);
    try {
      const res = await api.dayExtensions.applyExtension({
        closure_id: closure.id,
        days: days,
        branch_id: applyBranch
      });
      toast.success(t(
        `تم ترحيل ${days} أيام لـ ${res.data.extended_count} مشترك`,
        `Extended ${res.data.extended_count} members by ${days} days`
      ));
      loadData();
    } catch (error) {
      toast.error(t('خطأ في الترحيل', 'Error applying extension'));
    } finally {
      setApplying(false);
    }
  };

  const handleManualExtension = async () => {
    if (!manualExt.member_id || !manualExt.days || !manualExt.reason) {
      toast.error(t('أكمل جميع الحقول', 'Fill all fields'));
      return;
    }
    setSaving(true);
    try {
      await api.dayExtensions.manualExtension(manualExt);
      toast.success(t('تم ترحيل الأيام بنجاح', 'Days extended successfully'));
      setShowManualDialog(false);
      setManualExt({ member_id: '', days: 1, reason: '' });
      loadData();
    } catch (error) {
      toast.error(t('خطأ', 'Error'));
    } finally {
      setSaving(false);
    }
  };

  const calcDays = (start, end) => {
    if (!start || !end) return 0;
    return Math.floor((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1;
  };

  if (loading) return <Layout><div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div></Layout>;

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarOff className="w-7 h-7 text-primary" />
              {t('ترحيل الأيام', 'Day Extensions')}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {t('إدارة الإجازات والإغلاقات وترحيل الأيام للمشتركين', 'Manage closures and extend member subscriptions')}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setShowManualDialog(true)} variant="outline" className="border-blue-400 text-blue-700">
              <User className="w-4 h-4 me-2" />
              {t('ترحيل يدوي لعضو', 'Manual Extension')}
            </Button>
            <Button onClick={() => setShowCreateDialog(true)} className="bg-primary">
              <Plus className="w-4 h-4 me-2" />
              {t('إضافة فترة إغلاق', 'Add Closure')}
            </Button>
          </div>
        </div>

        <div className="flex gap-2 border-b pb-2">
          <Button variant={activeTab === 'closures' ? 'default' : 'ghost'} size="sm" onClick={() => setActiveTab('closures')}>
            <CalendarDays className="w-4 h-4 me-1" />
            {t('الإغلاقات', 'Closures')} ({closures.length})
          </Button>
          <Button variant={activeTab === 'logs' ? 'default' : 'ghost'} size="sm" onClick={() => setActiveTab('logs')}>
            <History className="w-4 h-4 me-1" />
            {t('سجل الترحيل', 'Extension Log')} ({logs.length})
          </Button>
        </div>

        {activeTab === 'closures' && (
          <div className="space-y-4">
            {branches.length > 1 && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">{t('الفرع:', 'Branch:')}</Label>
                <Select value={applyBranch} onValueChange={setApplyBranch}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('جميع الفروع', 'All Branches')}</SelectItem>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {closures.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                <CalendarOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t('لا توجد فترات إغلاق مسجلة', 'No closures recorded')}</p>
              </Card>
            ) : (
              <div className="grid gap-4">
                {closures.map(closure => (
                  <Card key={closure.id} className={`p-4 ${closure.applied ? 'border-green-300 bg-green-50/30' : 'border-orange-300'}`}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-bold text-lg">{closure.title_ar}</h3>
                          <Badge className={REASON_COLORS[closure.reason] || REASON_COLORS.other}>
                            {(language === 'ar' ? REASON_LABELS.ar : REASON_LABELS.en)[closure.reason] || closure.reason}
                          </Badge>
                          {closure.applied && (
                            <Badge className="bg-green-600 text-white">
                              <CheckCircle className="w-3 h-3 me-1" />
                              {t('تم الترحيل', 'Applied')}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <CalendarDays className="w-4 h-4" />
                            {closure.start_date} → {closure.end_date}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {closure.days} {t('أيام', 'days')}
                          </span>
                          {closure.applied && (
                            <span className="flex items-center gap-1 text-green-700">
                              <Users className="w-4 h-4" />
                              {closure.applied_count} {t('مشترك', 'members')}
                            </span>
                          )}
                        </div>
                        {closure.notes && <p className="text-sm text-muted-foreground mt-1">{closure.notes}</p>}
                      </div>
                      <div className="flex gap-2">
                        {!closure.applied && (
                          <>
                            <Button onClick={() => handleApplyExtension(closure)} disabled={applying} className="bg-green-600 hover:bg-green-700">
                              {applying ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Play className="w-4 h-4 me-1" />}
                              {t('ترحيل للجميع', 'Apply to All')}
                            </Button>
                            <Button variant="ghost" size="sm" className="text-red-500" onClick={() => handleDeleteClosure(closure.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-3">
            {logs.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t('لا يوجد سجل ترحيل', 'No extension logs')}</p>
              </Card>
            ) : (
              logs.map(log => (
                <Card key={log.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {log.type === 'closure' ? (
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                          <Users className="w-5 h-5 text-blue-700" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                          <User className="w-5 h-5 text-purple-700" />
                        </div>
                      )}
                      <div>
                        {log.type === 'closure' ? (
                          <p className="font-medium">
                            {t('ترحيل جماعي', 'Bulk Extension')} - {log.closure_title}
                            <span className="text-green-600 font-bold ms-2">+{log.days} {t('أيام', 'days')}</span>
                          </p>
                        ) : (
                          <p className="font-medium">
                            {t('ترحيل يدوي', 'Manual')} - {log.member_name}
                            <span className="text-green-600 font-bold ms-2">+{log.days} {t('أيام', 'days')}</span>
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {log.type === 'closure' && `${log.members_count} ${t('مشترك', 'members')} | `}
                          {log.type === 'manual' && `${log.reason} | `}
                          {t('بواسطة', 'by')} {log.applied_by} | {new Date(log.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {/* Create Closure Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarOff className="w-5 h-5" />
                {t('إضافة فترة إغلاق', 'Add Closure Period')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('العنوان *', 'Title *')}</Label>
                <Input value={newClosure.title_ar} onChange={(e) => setNewClosure({ ...newClosure, title_ar: e.target.value })} placeholder={t('مثال: إجازة عيد الفطر', 'e.g. Eid Holiday')} />
              </div>
              <div>
                <Label>{t('السبب', 'Reason')}</Label>
                <Select value={newClosure.reason} onValueChange={(val) => setNewClosure({ ...newClosure, reason: val })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="holiday">{t('إجازة رسمية', 'Official Holiday')}</SelectItem>
                    <SelectItem value="maintenance">{t('صيانة', 'Maintenance')}</SelectItem>
                    <SelectItem value="emergency">{t('طارئ', 'Emergency')}</SelectItem>
                    <SelectItem value="other">{t('أخرى', 'Other')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('من تاريخ *', 'From *')}</Label>
                  <Input type="date" value={newClosure.start_date} onChange={(e) => setNewClosure({ ...newClosure, start_date: e.target.value })} />
                </div>
                <div>
                  <Label>{t('إلى تاريخ *', 'To *')}</Label>
                  <Input type="date" value={newClosure.end_date} onChange={(e) => setNewClosure({ ...newClosure, end_date: e.target.value })} />
                </div>
              </div>
              {newClosure.start_date && newClosure.end_date && (
                <div className="p-3 bg-blue-50 rounded-lg text-center">
                  <span className="text-2xl font-bold text-blue-700">{calcDays(newClosure.start_date, newClosure.end_date)}</span>
                  <span className="text-sm text-blue-600 ms-2">{t('أيام ستُرحّل', 'days to extend')}</span>
                </div>
              )}
              <div>
                <Label>{t('ملاحظات', 'Notes')}</Label>
                <Textarea value={newClosure.notes} onChange={(e) => setNewClosure({ ...newClosure, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>{t('إلغاء', 'Cancel')}</Button>
              <Button onClick={handleCreateClosure} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {t('حفظ', 'Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Manual Extension Dialog */}
        <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                {t('ترحيل يدوي لعضو', 'Manual Extension for Member')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('اختر العضو *', 'Select Member *')}</Label>
                <Select value={manualExt.member_id || 'none'} onValueChange={(val) => val !== 'none' && setManualExt({ ...manualExt, member_id: val })}>
                  <SelectTrigger><SelectValue placeholder={t('اختر العضو...', 'Select member...')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('-- اختر --', '-- Select --')}</SelectItem>
                    {members.filter(m => m.status === 'active').map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name_ar || m.name} - {m.phone}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('عدد الأيام *', 'Number of Days *')}</Label>
                <Input type="number" min="1" value={manualExt.days} onChange={(e) => setManualExt({ ...manualExt, days: parseInt(e.target.value) || 1 })} />
              </div>
              <div>
                <Label>{t('السبب *', 'Reason *')}</Label>
                <Input value={manualExt.reason} onChange={(e) => setManualExt({ ...manualExt, reason: e.target.value })} placeholder={t('مثال: إصابة / سفر / ظرف خاص', 'e.g. Injury / Travel / Special circumstance')} />
              </div>
              {manualExt.member_id && manualExt.days > 0 && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800">
                    <AlertTriangle className="w-4 h-4 inline me-1" />
                    {t(
                      `سيتم تمديد جميع الاشتراكات النشطة لهذا العضو بـ ${manualExt.days} أيام`,
                      `All active subscriptions for this member will be extended by ${manualExt.days} days`
                    )}
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowManualDialog(false)}>{t('إلغاء', 'Cancel')}</Button>
              <Button onClick={handleManualExtension} disabled={saving} className="bg-green-600 hover:bg-green-700">
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {t('ترحيل', 'Extend')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
