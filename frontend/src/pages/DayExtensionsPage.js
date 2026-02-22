import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import api, { membersAPI, branchesAPI, activitiesAPI } from '../services/api';
import { toast } from 'sonner';
import {
  CalendarOff, Plus, Trash2, Play, Clock, User, Users,
  CalendarDays, CheckCircle, History, Loader2
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
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('closures');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);

  const defaultClosure = {
    title_ar: '', title_en: '', reason: 'holiday', start_date: '', end_date: '', notes: '',
    scope: 'all', activity_ids: [], activity_names: [], stop_type: 'full_day', stop_hours: 0, affected_times: []
  };
  const [newClosure, setNewClosure] = useState({ ...defaultClosure });
  const [manualExt, setManualExt] = useState({ member_id: '', days: 1, reason: '', activity_id: '' });
  const [applyBranch, setApplyBranch] = useState('all');
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const fixedTimes = [3, 4, 5, 6, 7, 8, 9, 10];

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [closuresRes, logsRes, membersRes, branchesRes, activitiesRes] = await Promise.all([
        api.dayExtensions.getClosures(),
        api.dayExtensions.getLogs(),
        membersAPI.getAll(),
        branchesAPI.getAll(),
        activitiesAPI.getAll()
      ]);
      setClosures(Array.isArray(closuresRes.data) ? closuresRes.data : []);
      setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
      setMembers(Array.isArray(membersRes.data) ? membersRes.data : []);
      setBranches(Array.isArray(branchesRes.data) ? branchesRes.data : []);
      setActivities(Array.isArray(activitiesRes.data) ? activitiesRes.data : []);
    } catch (error) {
      console.error('DayExtensions loadData error:', error);
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
    if (newClosure.scope === 'specific' && (!newClosure.activity_ids || newClosure.activity_ids.length === 0)) {
      toast.error(t('اختر نشاط واحد على الأقل', 'Select at least one activity'));
      return;
    }
    if (newClosure.stop_type === 'specific_times' && (!newClosure.affected_times || newClosure.affected_times.length === 0)) {
      toast.error(t('اختر موعد واحد على الأقل', 'Select at least one time'));
      return;
    }
    setSaving(true);
    try {
      await api.dayExtensions.createClosure(newClosure);
      toast.success(t('تم إضافة فترة الإغلاق', 'Closure period added'));
      setShowCreateDialog(false);
      setNewClosure({ ...defaultClosure });
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
    const actNames = (closure.activity_names || []).filter(Boolean);
    const scopeText = closure.scope === 'specific'
      ? ` (${actNames.length > 0 ? actNames.join('، ') : closure.activity_name || t('أنشطة محددة', 'specific activities')})`
      : '';
    if (!window.confirm(t(
      `هل تريد ترحيل ${days} يوم لجميع المشتركين النشطين${scopeText}؟`,
      `Extend all active members by ${days} days${scopeText}?`
    ))) return;
    setApplying(true);
    try {
      const res = await api.dayExtensions.applyExtension({
        closure_id: closure.id,
        days: days,
        branch_id: applyBranch
      });
      const result = res.data || res;
      setApplyResult({
        days: days,
        closureTitle: closure.title_ar || closure.title_en || '',
        extended_count: result.extended_count || 0,
        extended_members: result.extended_members || [],
        skipped_count: result.skipped_count || 0,
        skipped_members: result.skipped_members || []
      });
      setShowResultDialog(true);
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
      await api.dayExtensions.manualExtension({
        ...manualExt,
        activity_id: manualExt.activity_id || null
      });
      toast.success(t('تم ترحيل الأيام بنجاح', 'Days extended successfully'));
      setShowManualDialog(false);
      setManualExt({ member_id: '', days: 1, reason: '', activity_id: '' });
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

  const calcExtensionDays = () => {
    const totalDays = calcDays(newClosure.start_date, newClosure.end_date);
    if (totalDays <= 0) return 0;
    if (newClosure.stop_type === 'partial' && newClosure.stop_hours > 0) {
      return Math.round((newClosure.stop_hours / 24) * totalDays * 10) / 10;
    }
    return totalDays;
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

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
                <select
                  className="border rounded-md px-3 py-2 text-sm bg-white"
                  value={applyBranch}
                  onChange={(e) => setApplyBranch(e.target.value)}
                >
                  <option value="all">{t('جميع الفروع', 'All Branches')}</option>
                  {branches.map(b => (
                    <option key={b.id || b._id} value={b.id || b._id}>{b.name_ar || b.name || ''}</option>
                  ))}
                </select>
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
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <h3 className="font-bold text-lg">{closure.title_ar || ''}</h3>
                          <Badge className={REASON_COLORS[closure.reason] || REASON_COLORS.other}>
                            {(language === 'ar' ? REASON_LABELS.ar : REASON_LABELS.en)[closure.reason] || closure.reason || ''}
                          </Badge>
                          {closure.scope === 'specific' && (closure.activity_names?.length > 0 || closure.activity_name) && (
                            <>
                              {(closure.activity_names || [closure.activity_name]).filter(Boolean).map((name, idx) => (
                                <Badge key={idx} className="bg-purple-100 text-purple-800">
                                  {name}
                                </Badge>
                              ))}
                            </>
                          )}
                          {closure.stop_type === 'specific_times' && closure.affected_times?.length > 0 && (
                            closure.affected_times.sort((a,b)=>a-b).map((time, idx) => (
                              <Badge key={idx} className="bg-yellow-100 text-yellow-800">
                                <Clock className="w-3 h-3 me-1" />
                                {t(`الساعة ${time}`, `${time}:00`)}
                              </Badge>
                            ))
                          )}
                          {closure.stop_type === 'partial' && (
                            <Badge className="bg-yellow-100 text-yellow-800">
                              <Clock className="w-3 h-3 me-1" />
                              {closure.stop_hours} {t('ساعات', 'hrs')}
                            </Badge>
                          )}
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
                          <span className="flex items-center gap-1 font-medium text-primary">
                            <Clock className="w-4 h-4" />
                            {t('ترحيل:', 'Extension:')} {closure.days} {t('يوم', 'days')}
                          </span>
                          {closure.applied && (
                            <span className="flex items-center gap-1 text-green-700">
                              <Users className="w-4 h-4" />
                              {closure.applied_count || 0} {t('مشترك', 'members')}
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
                <Card key={log.id || Math.random()} className="p-4">
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
                            {t('ترحيل جماعي', 'Bulk Extension')} - {log.closure_title || ''}
                            <span className="text-green-600 font-bold ms-2">+{log.days} {t('يوم', 'days')}</span>
                            {log.activity_name && (
                              <Badge className="bg-purple-100 text-purple-800 ms-2 text-xs">
                                {log.activity_name}
                              </Badge>
                            )}
                            {log.stop_type === 'partial' && (
                              <Badge className="bg-yellow-100 text-yellow-800 ms-1 text-xs">
                                {log.stop_hours} {t('ساعات/يوم', 'hrs/day')}
                              </Badge>
                            )}
                          </p>
                        ) : (
                          <p className="font-medium">
                            {t('ترحيل يدوي', 'Manual')} - {log.member_name || ''}
                            <span className="text-green-600 font-bold ms-2">+{log.days} {t('يوم', 'days')}</span>
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {log.type === 'closure' && log.members_count ? `${log.members_count} ${t('مشترك', 'members')} | ` : ''}
                          {log.type === 'manual' && log.reason ? `${log.reason} | ` : ''}
                          {t('بواسطة', 'by')} {log.applied_by || ''} | {log.created_at ? new Date(log.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US') : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {showCreateDialog && (
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CalendarOff className="w-5 h-5" />
                  {t('إضافة فترة إغلاق / توقف', 'Add Closure / Stoppage')}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>{t('العنوان *', 'Title *')}</Label>
                  <Input value={newClosure.title_ar} onChange={(e) => setNewClosure({ ...newClosure, title_ar: e.target.value })} placeholder={t('مثال: إجازة عيد الفطر', 'e.g. Eid Holiday')} />
                </div>
                <div>
                  <Label>{t('السبب', 'Reason')}</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                    value={newClosure.reason}
                    onChange={(e) => setNewClosure({ ...newClosure, reason: e.target.value })}
                  >
                    <option value="holiday">{t('إجازة رسمية', 'Official Holiday')}</option>
                    <option value="maintenance">{t('صيانة', 'Maintenance')}</option>
                    <option value="emergency">{t('طارئ', 'Emergency')}</option>
                    <option value="other">{t('أخرى', 'Other')}</option>
                  </select>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg space-y-3 border">
                  <Label className="font-bold text-sm">{t('نطاق التوقف', 'Scope')}</Label>
                  <div className="flex gap-3">
                    <Button
                      type="button" size="sm"
                      variant={newClosure.scope === 'all' ? 'default' : 'outline'}
                      onClick={() => setNewClosure({ ...newClosure, scope: 'all', activity_ids: [], activity_names: [] })}
                    >
                      <Users className="w-4 h-4 me-1" />
                      {t('جميع الأنشطة', 'All Activities')}
                    </Button>
                    <Button
                      type="button" size="sm"
                      variant={newClosure.scope === 'specific' ? 'default' : 'outline'}
                      onClick={() => setNewClosure({ ...newClosure, scope: 'specific' })}
                    >
                      {t('أنشطة محددة', 'Specific Activities')}
                    </Button>
                  </div>
                  {newClosure.scope === 'specific' && (
                    <div>
                      <Label className="text-xs">{t('اختر الأنشطة * (يمكن اختيار أكثر من نشاط)', 'Select Activities * (multiple allowed)')}</Label>
                      <div className="mt-2 max-h-48 overflow-y-auto border rounded-md p-2 bg-white space-y-1">
                        {activities.map(a => {
                          const aId = a.id || a._id;
                          const aName = a.name_ar || a.name || '';
                          const isSelected = (newClosure.activity_ids || []).includes(aId);
                          return (
                            <label key={aId} className={`flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-slate-50 ${isSelected ? 'bg-blue-50 border border-blue-200' : ''}`}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  const ids = [...(newClosure.activity_ids || [])];
                                  const names = [...(newClosure.activity_names || [])];
                                  if (isSelected) {
                                    const idx = ids.indexOf(aId);
                                    ids.splice(idx, 1);
                                    names.splice(idx, 1);
                                  } else {
                                    ids.push(aId);
                                    names.push(aName);
                                  }
                                  setNewClosure({ ...newClosure, activity_ids: ids, activity_names: names });
                                }}
                                className="w-4 h-4 text-blue-600 rounded"
                              />
                              <span className="text-sm">{aName}</span>
                            </label>
                          );
                        })}
                      </div>
                      {(newClosure.activity_ids || []).length > 0 && (
                        <p className="text-xs text-blue-600 mt-1">
                          {t(`تم اختيار ${newClosure.activity_ids.length} نشاط`, `${newClosure.activity_ids.length} activities selected`)}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="p-3 bg-slate-50 rounded-lg space-y-3 border">
                  <Label className="font-bold text-sm">{t('نوع التوقف', 'Stop Type')}</Label>
                  <div className="flex gap-3 flex-wrap">
                    <Button
                      type="button" size="sm"
                      variant={newClosure.stop_type === 'full_day' ? 'default' : 'outline'}
                      onClick={() => setNewClosure({ ...newClosure, stop_type: 'full_day', stop_hours: 0, affected_times: [] })}
                    >
                      <CalendarDays className="w-4 h-4 me-1" />
                      {t('يوم كامل', 'Full Day')}
                    </Button>
                    <Button
                      type="button" size="sm"
                      variant={newClosure.stop_type === 'specific_times' ? 'default' : 'outline'}
                      onClick={() => setNewClosure({ ...newClosure, stop_type: 'specific_times', stop_hours: 0 })}
                    >
                      <Clock className="w-4 h-4 me-1" />
                      {t('مواعيد محددة', 'Specific Times')}
                    </Button>
                  </div>
                  {newClosure.stop_type === 'specific_times' && (
                    <div>
                      <Label className="text-xs">{t('اختر المواعيد المتأثرة بالتوقف *', 'Select affected session times *')}</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {fixedTimes.map(time => {
                          const isSelected = (newClosure.affected_times || []).includes(time);
                          return (
                            <button
                              key={time}
                              type="button"
                              onClick={() => {
                                const current = [...(newClosure.affected_times || [])];
                                if (isSelected) {
                                  const idx = current.indexOf(time);
                                  current.splice(idx, 1);
                                } else {
                                  current.push(time);
                                }
                                setNewClosure({ ...newClosure, affected_times: current });
                              }}
                              className={`px-3 py-2 text-sm rounded-lg border-2 transition-all ${isSelected ? 'bg-blue-500 text-white border-blue-500 shadow-md' : 'bg-white hover:bg-slate-50 border-gray-200'}`}
                            >
                              <div className="font-bold">{t(`الساعة ${time}`, `${time}:00`)}</div>
                            </button>
                          );
                        })}
                      </div>
                      {(newClosure.affected_times || []).length > 0 && (
                        <p className="text-xs text-blue-600 mt-2 font-medium">
                          {t(
                            `تم اختيار ${newClosure.affected_times.length} موعد: ${newClosure.affected_times.sort((a,b)=>a-b).map(t => `الساعة ${t}`).join('، ')}`,
                            `${newClosure.affected_times.length} times selected: ${newClosure.affected_times.sort((a,b)=>a-b).map(t => `${t}:00`).join(', ')}`
                          )}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('سيتم ترحيل فقط المشتركين الذين مواعيدهم في الأوقات المختارة', 'Only members with sessions at selected times will be extended')}
                      </p>
                    </div>
                  )}
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
                  <div className="p-3 bg-blue-50 rounded-lg text-center space-y-1">
                    <div className="text-sm text-muted-foreground">
                      {t('فترة التوقف:', 'Stop period:')} {calcDays(newClosure.start_date, newClosure.end_date)} {t('يوم', 'days')}
                      {newClosure.stop_type === 'partial' && newClosure.stop_hours > 0 && (
                        <span className="ms-1">× {newClosure.stop_hours} {t('ساعات/يوم', 'hrs/day')}</span>
                      )}
                    </div>
                    <div>
                      <span className="text-2xl font-bold text-blue-700">{calcExtensionDays()}</span>
                      <span className="text-sm text-blue-600 ms-2">{t('يوم ترحيل', 'extension days')}</span>
                    </div>
                  </div>
                )}
                <div>
                  <Label>{t('ملاحظات', 'Notes')}</Label>
                  <textarea
                    className="w-full min-h-[60px] border rounded-md px-3 py-2 text-sm bg-white"
                    value={newClosure.notes}
                    onChange={(e) => setNewClosure({ ...newClosure, notes: e.target.value })}
                  />
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
        )}

        {showManualDialog && (
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
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                    value={manualExt.member_id || ''}
                    onChange={(e) => setManualExt({ ...manualExt, member_id: e.target.value })}
                  >
                    <option value="">{t('-- اختر --', '-- Select --')}</option>
                    {members.filter(m => m.status === 'active').map(m => (
                      <option key={m.id || m._id} value={m.id || m._id}>{m.name_ar || m.name || ''} - {m.phone || ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>{t('النشاط (اختياري)', 'Activity (optional)')}</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                    value={manualExt.activity_id || 'all'}
                    onChange={(e) => setManualExt({ ...manualExt, activity_id: e.target.value === 'all' ? '' : e.target.value })}
                  >
                    <option value="all">{t('جميع الأنشطة', 'All Activities')}</option>
                    {activities.map(a => (
                      <option key={a.id || a._id} value={a.id || a._id}>{a.name_ar || a.name || ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>{t('عدد الأيام *', 'Number of Days *')}</Label>
                  <Input type="number" min="1" value={manualExt.days} onChange={(e) => setManualExt({ ...manualExt, days: parseInt(e.target.value) || 1 })} />
                </div>
                <div>
                  <Label>{t('السبب *', 'Reason *')}</Label>
                  <Input value={manualExt.reason} onChange={(e) => setManualExt({ ...manualExt, reason: e.target.value })} placeholder={t('مثال: إصابة / سفر', 'e.g. Injury / Travel')} />
                </div>
                {manualExt.member_id && manualExt.days > 0 && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-800">
                      {manualExt.activity_id ? t(
                        `سيتم تمديد اشتراك النشاط المحدد بـ ${manualExt.days} أيام`,
                        `Selected activity subscription extended by ${manualExt.days} days`
                      ) : t(
                        `سيتم تمديد جميع الاشتراكات النشطة بـ ${manualExt.days} أيام`,
                        `All active subscriptions extended by ${manualExt.days} days`
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
        )}

        {showResultDialog && applyResult && (
          <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-center">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                  <div className="text-xl">{t('تم الترحيل بنجاح', 'Extension Applied Successfully')}</div>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                  <p className="text-lg font-bold text-green-800">
                    {t(`${applyResult.closureTitle}`, applyResult.closureTitle)}
                  </p>
                  <p className="text-green-700 mt-1">
                    {t(
                      `تم ترحيل ${applyResult.days} يوم لـ ${applyResult.extended_count} مشترك`,
                      `Extended ${applyResult.extended_count} members by ${applyResult.days} days`
                    )}
                  </p>
                </div>

                {applyResult.extended_members.length > 0 && (
                  <div>
                    <h3 className="font-bold mb-2 text-base">
                      <Users className="w-5 h-5 inline me-1" />
                      {t('المشتركين المتأثرين', 'Affected Members')} ({applyResult.extended_count})
                    </h3>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="p-2 text-right">#</th>
                            <th className="p-2 text-right">{t('الاسم', 'Name')}</th>
                            <th className="p-2 text-right">{t('النشاط', 'Activity')}</th>
                            <th className="p-2 text-right">{t('أيام التدريب', 'Training Days')}</th>
                            <th className="p-2 text-right">{t('حصص فائتة', 'Missed')}</th>
                            <th className="p-2 text-right">{t('قبل', 'Before')}</th>
                            <th className="p-2 text-right">{t('بعد', 'After')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {applyResult.extended_members.map((m, idx) => (
                            m.details && m.details.length > 0 ? m.details.map((d, dIdx) => (
                              <tr key={`${idx}-${dIdx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                {dIdx === 0 && (
                                  <>
                                    <td className="p-2 border-t" rowSpan={m.details.length}>{idx + 1}</td>
                                    <td className="p-2 border-t font-medium" rowSpan={m.details.length}>
                                      {m.name}
                                      {m.phone && <div className="text-xs text-gray-500">{m.phone}</div>}
                                    </td>
                                  </>
                                )}
                                <td className="p-2 border-t text-xs">{d.activity || '-'}</td>
                                <td className="p-2 border-t text-xs text-blue-600">{d.training_days || '-'}</td>
                                <td className="p-2 border-t text-xs font-bold text-orange-600">{d.missed_sessions || 0}</td>
                                <td className="p-2 border-t text-red-600 text-xs">{d.old_end}</td>
                                <td className="p-2 border-t text-green-600 text-xs font-medium">{d.new_end}</td>
                              </tr>
                            )) : (
                              <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="p-2 border-t">{idx + 1}</td>
                                <td className="p-2 border-t font-medium">{m.name}</td>
                                <td className="p-2 border-t">-</td>
                                <td className="p-2 border-t">-</td>
                                <td className="p-2 border-t">-</td>
                                <td className="p-2 border-t">-</td>
                                <td className="p-2 border-t">-</td>
                              </tr>
                            )
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {applyResult.skipped_members && applyResult.skipped_members.length > 0 && (
                  <div>
                    <h3 className="font-bold mb-2 text-sm text-gray-600">
                      {t(`مشتركين لم يتأثروا (${applyResult.skipped_count}) - أيام تدريبهم لا تتقاطع مع الإغلاق`,
                         `Unaffected members (${applyResult.skipped_count}) - training days don't overlap with closure`)}
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {applyResult.skipped_members.map((s, i) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                          {s.name} {s.member_time ? `(${s.member_time})` : s.training_days ? `(${s.training_days})` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {applyResult.extended_count === 0 && (!applyResult.skipped_members || applyResult.skipped_members.length === 0) && (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
                    <p className="text-yellow-800">{t('لم يتأثر أي مشترك بهذا الترحيل', 'No members were affected by this extension')}</p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => setShowResultDialog(false)} className="bg-orange-500 hover:bg-orange-600">
                  {t('إغلاق', 'Close')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </Layout>
  );
}