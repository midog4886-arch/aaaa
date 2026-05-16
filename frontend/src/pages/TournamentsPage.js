import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '../components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '../components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select';
import {
  tournamentsAPI, levelsAPI, membersAPI, branchesAPI, activitiesAPI, coachesAPI
} from '../services/api';
import { toast } from 'sonner';
import {
  Trophy, Plus, Edit, Trash2, Loader2, ArrowRight, Search, UserPlus,
  Calendar, MapPin, Activity, FileSpreadsheet, FileText, Award, Share2,
  Medal, X, Users, Bell, Send, History, CheckCircle2, AlertTriangle,
  Layers, ChevronRight
} from 'lucide-react';

// Build a human-readable toast message from a notification delivery summary
// returned by the backend. Works for both broadcast (members_count > 0) and
// per-member DMs.
const formatNotificationSummary = (summary, language) => {
  if (!summary) return '';
  const isBroadcast = (summary.members_count ?? 0) > 0
    && (summary.in_app !== undefined);
  const ar = language === 'ar';
  if (isBroadcast) {
    const total = summary.members_count || 0;
    const inApp = summary.in_app || 0;
    const ok = summary.push_success || 0;
    const fail = summary.push_failed || 0;
    const noPush = summary.no_push || 0;
    if (total === 0) {
      return ar
        ? 'لم يتم العثور على أعضاء مؤهلين للإشعار.'
        : 'No eligible members to notify.';
    }
    return ar
      ? `تم إخطار ${inApp} عضو داخل التطبيق · إشعارات هاتف ناجحة: ${ok} · فشلت: ${fail} · بدون اشتراك: ${noPush}`
      : `Notified ${inApp} in-app · push delivered: ${ok} · failed: ${fail} · no device: ${noPush}`;
  }
  // Single-member DM
  const inApp = summary.in_app ? 1 : 0;
  const ok = summary.push_success || 0;
  const fail = summary.push_failed || 0;
  const total = summary.push_total || 0;
  if (total === 0 && inApp) {
    return ar
      ? 'تم حفظ الإشعار داخل التطبيق (لا يوجد جهاز مشترك للإشعار الفوري).'
      : 'Saved in-app (member has no device subscribed for push).';
  }
  return ar
    ? `داخل التطبيق: ${inApp ? 'نعم' : 'لا'} · إشعار هاتف ناجح: ${ok} · فشل: ${fail}`
    : `In-app: ${inApp ? 'yes' : 'no'} · push delivered: ${ok} · failed: ${fail}`;
};

const showNotificationToast = (summary, language) => {
  if (!summary) return;
  const msg = formatNotificationSummary(summary, language);
  const failed = (summary.push_failed || 0) > 0;
  if (failed) {
    toast.warning(msg);
  } else {
    toast.success(msg);
  }
};

const POSITIONS = [
  { value: '1', label: 'الأول 🥇', emoji: '🥇', color: 'bg-yellow-500' },
  { value: '2', label: 'الثاني 🥈', emoji: '🥈', color: 'bg-gray-400' },
  { value: '3', label: 'الثالث 🥉', emoji: '🥉', color: 'bg-amber-700' },
  { value: 'participation', label: 'مشاركة', emoji: '🎖️', color: 'bg-blue-500' },
];

const positionLabel = (pos) => {
  if (pos === null || pos === undefined || pos === '') return '-';
  const key = String(pos);
  const p = POSITIONS.find(x => x.value === key);
  return p ? p.label : '-';
};

const TournamentsPage = () => {
  const { t, language } = useLanguage();
  const { user, selectedBranchId } = useAuth();
  const isAdmin = user?.is_admin === true;

  // View state: 'list' | 'detail'
  const [searchParams, setSearchParams] = useSearchParams();
  const tidFromUrl = searchParams.get('tid');
  const [view, setView] = useState(tidFromUrl ? 'detail' : 'list');
  const [selectedTid, setSelectedTid] = useState(tidFromUrl || null);

  useEffect(() => {
    const tid = searchParams.get('tid');
    if (tid && tid !== selectedTid) {
      setSelectedTid(tid);
      setView('detail');
    }
  }, [searchParams]);

  // Data
  const [tournaments, setTournaments] = useState([]);
  const [activities, setActivities] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search/filter for list
  const [searchTerm, setSearchTerm] = useState('');
  const [filterActivity, setFilterActivity] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');

  // Dialogs (list view)
  const [tournamentDialogOpen, setTournamentDialogOpen] = useState(false);
  const [editingTournament, setEditingTournament] = useState(null);
  const [tournamentForm, setTournamentForm] = useState({
    name: '', date: '', place: '',
    activity_ids: [], activity_names: [],
    branch_id: 'all', description: '', status: 'upcoming',
    subcategories: [], subcategory_capacity: 6,
    notify: false
  });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Recipients preview for the "notify" checkbox in the create dialog
  const [recipientsPreview, setRecipientsPreview] = useState({ count: 0, members: [], loading: false, loaded: false });
  const [recipientsListOpen, setRecipientsListOpen] = useState(false);

  useEffect(() => {
    if (!tournamentDialogOpen || editingTournament) {
      return;
    }
    let cancelled = false;
    setRecipientsPreview(prev => ({ ...prev, loading: true }));
    const params = {};
    if (tournamentForm.branch_id) params.branch_id = tournamentForm.branch_id;
    if ((tournamentForm.activity_ids || []).length > 0) {
      params.activity_ids = tournamentForm.activity_ids.join(',');
    }
    tournamentsAPI.previewRecipients(params)
      .then((res) => {
        if (cancelled) return;
        setRecipientsPreview({
          count: res.data?.count || 0,
          members: res.data?.members || [],
          loading: false,
          loaded: true,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setRecipientsPreview({ count: 0, members: [], loading: false, loaded: true });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentDialogOpen, editingTournament, tournamentForm.branch_id, (tournamentForm.activity_ids || []).join(',')]);

  useEffect(() => {
    loadList();
  }, [selectedBranchId]);

  const loadList = async () => {
    setLoading(true);
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all'
        ? { branch_filter: selectedBranchId } : {};
      const [tRes, aRes, bRes] = await Promise.all([
        tournamentsAPI.getAll(branchParams),
        activitiesAPI.getAll().catch(() => ({ data: [] })),
        isAdmin ? branchesAPI.getAll().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      setTournaments(tRes.data || []);
      setActivities(aRes.data || []);
      setBranches(bRes.data || []);
    } catch (e) {
      console.error(e);
      toast.error(t('error', 'Error'));
    } finally {
      setLoading(false);
    }
  };

  const tnActivityIds = (tn) => {
    if (Array.isArray(tn.activity_ids) && tn.activity_ids.length) return tn.activity_ids;
    return tn.activity_id ? [tn.activity_id] : [];
  };
  const tnActivityNames = (tn) => {
    if (Array.isArray(tn.activity_names) && tn.activity_names.length) return tn.activity_names;
    return tn.activity_name ? [tn.activity_name] : [];
  };

  const filteredTournaments = useMemo(() => {
    return (tournaments || []).filter(tn => {
      if (filterActivity !== 'all' && !tnActivityIds(tn).includes(filterActivity)) return false;
      if (filterBranch !== 'all' && (tn.branch_id || '') !== filterBranch) return false;
      if (filterFromDate && (tn.date || '') < filterFromDate) return false;
      if (filterToDate && (tn.date || '') > filterToDate) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const fields = [tn.name, tn.place, tn.date, ...tnActivityNames(tn)].filter(Boolean).join(' ').toLowerCase();
        return fields.includes(q);
      }
      return true;
    });
  }, [tournaments, searchTerm, filterActivity, filterBranch, filterFromDate, filterToDate]);

  const openCreate = () => {
    setEditingTournament(null);
    setTournamentForm({
      name: '', date: new Date().toISOString().split('T')[0], place: '',
      activity_ids: [], activity_names: [],
      branch_id: selectedBranchId && selectedBranchId !== 'all' ? selectedBranchId : 'all',
      description: '', status: 'upcoming',
      subcategories: [], subcategory_capacity: 6,
      notify: false
    });
    setTournamentDialogOpen(true);
  };

  const openEdit = (tn) => {
    setEditingTournament(tn);
    setTournamentForm({
      name: tn.name || '',
      date: tn.date || '',
      place: tn.place || '',
      activity_ids: tnActivityIds(tn),
      activity_names: tnActivityNames(tn),
      branch_id: tn.branch_id || 'all',
      description: tn.description || '',
      status: tn.status || 'upcoming',
      subcategories: Array.isArray(tn.subcategories) ? tn.subcategories : [],
      subcategory_capacity: tn.subcategory_capacity || 6,
      notify: false,
    });
    setTournamentDialogOpen(true);
  };

  const toggleActivity = (activityId) => {
    setTournamentForm(prev => {
      const current = prev.activity_ids || [];
      const isOn = current.includes(activityId);
      const nextIds = isOn ? current.filter(x => x !== activityId) : [...current, activityId];
      const nextNames = nextIds
        .map(id => {
          const a = activities.find(x => x.id === id);
          return a ? (a.name_ar || a.name || '') : '';
        })
        .filter(Boolean);
      return { ...prev, activity_ids: nextIds, activity_names: nextNames };
    });
  };

  const saveTournament = async () => {
    if (!tournamentForm.name.trim()) {
      toast.error(language === 'ar' ? 'الاسم مطلوب' : 'Name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...tournamentForm };
      if (editingTournament) {
        const { notify: _ignored, ...editPayload } = payload;
        await tournamentsAPI.update(editingTournament.id, editPayload);
        toast.success(language === 'ar' ? 'تم التحديث' : 'Updated');
      } else {
        const res = await tournamentsAPI.create(payload);
        toast.success(language === 'ar' ? 'تم إنشاء البطولة' : 'Tournament created');
        const summary = res?.data?.notification_summary;
        if (summary) showNotificationToast(summary, language);
      }
      setTournamentDialogOpen(false);
      await loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || (language === 'ar' ? 'فشل الحفظ' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await tournamentsAPI.delete(deleteTarget.id);
      toast.success(language === 'ar' ? 'تم الحذف' : 'Deleted');
      setDeleteTarget(null);
      await loadList();
    } catch (e) {
      toast.error(language === 'ar' ? 'فشل الحذف' : 'Delete failed');
    }
  };

  const openDetail = (tid) => {
    setSelectedTid(tid);
    setView('detail');
  };

  const backToList = () => {
    setView('list');
    setSelectedTid(null);
    if (searchParams.get('tid')) {
      const next = new URLSearchParams(searchParams);
      next.delete('tid');
      setSearchParams(next, { replace: true });
    }
    loadList();
  };

  const statusBadge = (status) => {
    const styles = {
      upcoming: 'bg-blue-100 text-blue-700',
      ongoing: 'bg-green-100 text-green-700',
      completed: 'bg-gray-200 text-gray-700',
    };
    const labels = {
      upcoming: 'قادمة',
      ongoing: 'جارية',
      completed: 'منتهية',
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status] || styles.upcoming}`}>
        {labels[status] || status}
      </span>
    );
  };

  if (view === 'detail' && selectedTid) {
    return <TournamentDetail tid={selectedTid} onBack={backToList} />;
  }

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow">
              <Trophy className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{language === 'ar' ? 'البطولات' : 'Tournaments'}</h1>
              <p className="text-sm text-muted-foreground">
                {language === 'ar' ? 'إدارة بطولات الأكاديمية والمشاركين والنتائج' : 'Manage academy tournaments, participants and results'}
              </p>
            </div>
          </div>
          <Button onClick={openCreate} className="bg-orange-500 hover:bg-orange-600 text-white">
            <Plus className="w-4 h-4 ms-1" />
            {language === 'ar' ? 'بطولة جديدة' : 'New Tournament'}
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={language === 'ar' ? 'بحث بالاسم أو المكان أو التاريخ' : 'Search'}
                  className="pe-10"
                />
              </div>
              <Select value={filterActivity} onValueChange={setFilterActivity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'كل الأنشطة' : 'All activities'}</SelectItem>
                  {activities.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name_ar || a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isAdmin && branches.length > 0 ? (
                <Select value={filterBranch} onValueChange={setFilterBranch}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'كل الفروع' : 'All branches'}</SelectItem>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : <div className="hidden lg:block" />}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <Label className="text-xs text-muted-foreground">
                  {language === 'ar' ? 'من تاريخ' : 'From date'}
                </Label>
                <Input type="date" value={filterFromDate} onChange={(e) => setFilterFromDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  {language === 'ar' ? 'إلى تاريخ' : 'To date'}
                </Label>
                <Input type="date" value={filterToDate} onChange={(e) => setFilterToDate(e.target.value)} />
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground gap-2">
                <span className="flex items-center gap-2">
                  <Trophy className="w-4 h-4" />
                  {language === 'ar'
                    ? `إجمالي البطولات: ${filteredTournaments.length}`
                    : `Total: ${filteredTournaments.length}`}
                </span>
                {(searchTerm || filterActivity !== 'all' || filterBranch !== 'all' || filterFromDate || filterToDate) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSearchTerm('');
                      setFilterActivity('all');
                      setFilterBranch('all');
                      setFilterFromDate('');
                      setFilterToDate('');
                    }}
                  >
                    {language === 'ar' ? 'مسح الفلاتر' : 'Clear'}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
          </div>
        ) : filteredTournaments.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
            {language === 'ar' ? 'لا توجد بطولات بعد' : 'No tournaments yet'}
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTournaments.map(tn => (
              <Card
                key={tn.id}
                className="hover:shadow-lg transition cursor-pointer border-2 hover:border-orange-400"
                onClick={() => openDetail(tn.id)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-lg flex-1 truncate" title={tn.name}>{tn.name}</h3>
                    {statusBadge(tn.status)}
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    {tn.date && (<div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5" /> {tn.date}</div>)}
                    {tn.place && (<div className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5" /> {tn.place}</div>)}
                    {tnActivityNames(tn).length > 0 && (
                      <div className="flex items-start gap-2">
                        <Activity className="w-3.5 h-3.5 mt-0.5" />
                        <span className="flex-1">{tnActivityNames(tn).join(' + ')}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <Badge variant="secondary" className="gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {tn.participants_count || 0} {language === 'ar' ? 'مشارك' : 'participants'}
                    </Badge>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(tn)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDeleteTarget(tn)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Tournament Dialog */}
      <Dialog open={tournamentDialogOpen} onOpenChange={setTournamentDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTournament
                ? (language === 'ar' ? 'تعديل البطولة' : 'Edit Tournament')
                : (language === 'ar' ? 'بطولة جديدة' : 'New Tournament')}
            </DialogTitle>
            <DialogDescription>
              {language === 'ar' ? 'املأ بيانات البطولة' : 'Fill in tournament details'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{language === 'ar' ? 'اسم البطولة *' : 'Name *'}</Label>
              <Input
                value={tournamentForm.name}
                onChange={(e) => setTournamentForm({ ...tournamentForm, name: e.target.value })}
                placeholder={language === 'ar' ? 'مثال: بطولة الربيع 2026' : 'e.g. Spring Tournament 2026'}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{language === 'ar' ? 'التاريخ' : 'Date'}</Label>
                <Input
                  type="date"
                  value={tournamentForm.date}
                  onChange={(e) => setTournamentForm({ ...tournamentForm, date: e.target.value })}
                />
              </div>
              <div>
                <Label>{language === 'ar' ? 'الحالة' : 'Status'}</Label>
                <Select
                  value={tournamentForm.status}
                  onValueChange={(v) => setTournamentForm({ ...tournamentForm, status: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upcoming">{language === 'ar' ? 'قادمة' : 'Upcoming'}</SelectItem>
                    <SelectItem value="ongoing">{language === 'ar' ? 'جارية' : 'Ongoing'}</SelectItem>
                    <SelectItem value="completed">{language === 'ar' ? 'منتهية' : 'Completed'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>{language === 'ar' ? 'المكان' : 'Place'}</Label>
              <Input
                value={tournamentForm.place}
                onChange={(e) => setTournamentForm({ ...tournamentForm, place: e.target.value })}
              />
            </div>
            <div>
              <Label>{language === 'ar' ? 'الأنشطة (يمكن اختيار أكثر من نشاط)' : 'Activities (you can pick multiple)'}</Label>
              <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
                {activities.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-2">
                    {language === 'ar' ? 'لا توجد أنشطة' : 'No activities'}
                  </div>
                ) : activities.map(a => {
                  const checked = (tournamentForm.activity_ids || []).includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className={`flex items-center gap-2 text-sm p-1.5 rounded cursor-pointer hover:bg-muted ${checked ? 'bg-orange-50' : ''}`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleActivity(a.id)}
                      />
                      <span>{a.name_ar || a.name}</span>
                    </label>
                  );
                })}
              </div>
              {(tournamentForm.activity_ids || []).length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {language === 'ar'
                    ? `تم اختيار ${tournamentForm.activity_ids.length} نشاط: ${tournamentForm.activity_names.join(' + ')}`
                    : `${tournamentForm.activity_ids.length} selected: ${tournamentForm.activity_names.join(' + ')}`}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {language === 'ar'
                  ? 'اتركه فارغًا لجعل البطولة عامة (تقبل أي عضو من الفرع).'
                  : 'Leave empty for an open tournament (any branch member can join).'}
              </p>
            </div>

            {/* Subcategories (سباقات) — e.g. swimming strokes */}
            <div className="border rounded-md p-3 bg-orange-50/40 space-y-2">
              <Label className="text-sm font-semibold">
                {language === 'ar' ? 'التصنيفات الفرعية (السباقات)' : 'Sub-categories'}
              </Label>
              <p className="text-xs text-muted-foreground">
                {language === 'ar'
                  ? 'اختياري. أنشئ تصنيفات داخل البطولة (مثل سباقات السباحة: حر، ظهر، صدر، فراشة). يمكن للعضو نفسه المشاركة في أكثر من تصنيف.'
                  : 'Optional. Sub-divide the tournament (e.g. swimming strokes). The same member can compete in multiple sub-categories.'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(tournamentForm.subcategories || []).map((s, i) => (
                  <span key={`${s}-${i}`} className="inline-flex items-center gap-1 bg-white border border-orange-300 text-orange-800 rounded-full px-2 py-0.5 text-xs">
                    {s}
                    <button
                      type="button"
                      className="text-orange-500 hover:text-red-600 font-bold"
                      onClick={() => setTournamentForm({
                        ...tournamentForm,
                        subcategories: tournamentForm.subcategories.filter((_, idx) => idx !== i),
                      })}
                      aria-label="remove"
                    >×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder={language === 'ar' ? 'أضف تصنيف ثم اضغط Enter (مثال: حر)' : 'Add a sub-category then press Enter (e.g. Freestyle)'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const v = (e.currentTarget.value || '').trim();
                      if (!v) return;
                      const list = tournamentForm.subcategories || [];
                      if (list.includes(v)) return;
                      setTournamentForm({ ...tournamentForm, subcategories: [...list, v] });
                      e.currentTarget.value = '';
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTournamentForm({
                    ...tournamentForm,
                    subcategories: ['حر', 'ظهر', 'صدر', 'فراشة'],
                  })}
                  title={language === 'ar' ? 'سباقات السباحة الأربعة' : 'Four swimming strokes'}
                >
                  {language === 'ar' ? 'سباحة' : 'Swimming'}
                </Button>
              </div>
              {(tournamentForm.subcategories || []).length > 0 && (
                <div className="grid grid-cols-2 gap-2 items-end pt-1">
                  <div>
                    <Label className="text-xs">
                      {language === 'ar' ? 'سعة كل مستوى داخل التصنيف' : 'Capacity per (level × sub-category)'}
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      value={tournamentForm.subcategory_capacity || 6}
                      onChange={(e) => setTournamentForm({
                        ...tournamentForm,
                        subcategory_capacity: Math.max(1, parseInt(e.target.value || '6', 10)),
                      })}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {language === 'ar'
                      ? `الحد الأقصى ${tournamentForm.subcategory_capacity || 6} مشارك في كل مستوى داخل كل تصنيف.`
                      : `Max ${tournamentForm.subcategory_capacity || 6} members per level within each sub-category.`}
                  </p>
                </div>
              )}
            </div>

            {isAdmin && branches.length > 0 && (
              <div>
                <Label>{language === 'ar' ? 'الفرع' : 'Branch'}</Label>
                <Select
                  value={tournamentForm.branch_id || 'all'}
                  onValueChange={(v) => setTournamentForm({ ...tournamentForm, branch_id: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'كل الفروع' : 'All branches'}</SelectItem>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>{language === 'ar' ? 'وصف' : 'Description'}</Label>
              <Textarea
                rows={3}
                value={tournamentForm.description}
                onChange={(e) => setTournamentForm({ ...tournamentForm, description: e.target.value })}
              />
            </div>
            {!editingTournament && (
              <div className="flex items-start gap-2 pt-1 border-t mt-2 pt-3">
                <Checkbox
                  id="notify-create-tournament"
                  checked={!!tournamentForm.notify}
                  onCheckedChange={(v) => setTournamentForm({ ...tournamentForm, notify: !!v })}
                />
                <div className="flex-1">
                  <Label htmlFor="notify-create-tournament" className="cursor-pointer">
                    {language === 'ar'
                      ? 'إرسال إشعار للأعضاء بهذه البطولة الجديدة'
                      : 'Notify members about this new tournament'}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {language === 'ar'
                      ? 'سيتم إرسال إشعار للأعضاء المسجلين في النشاط (والفرع المختار).'
                      : 'Members enrolled in the chosen activity (and branch) will receive a notification.'}
                  </p>
                  <div className="text-xs mt-2 flex items-center gap-2 flex-wrap">
                    {recipientsPreview.loading ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {language === 'ar' ? 'جاري حساب المستلمين…' : 'Calculating recipients…'}
                      </span>
                    ) : (
                      <>
                        <Badge variant="secondary" className="font-medium">
                          <Users className="w-3 h-3 me-1" />
                          {language === 'ar'
                            ? `سيصل الإشعار إلى ${recipientsPreview.count} عضو`
                            : `This will notify ${recipientsPreview.count} member${recipientsPreview.count === 1 ? '' : 's'}`}
                        </Badge>
                        {recipientsPreview.count > 0 && (
                          <button
                            type="button"
                            className="text-orange-600 hover:underline"
                            onClick={() => setRecipientsListOpen(true)}
                          >
                            {language === 'ar' ? 'عرض المستلمين' : 'View recipients'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTournamentDialogOpen(false)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={saveTournament} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
              {saving && <Loader2 className="w-4 h-4 animate-spin ms-1" />}
              {language === 'ar' ? 'حفظ' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recipients preview list */}
      <Dialog open={recipientsListOpen} onOpenChange={setRecipientsListOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {language === 'ar'
                ? `المستلمون (${recipientsPreview.count})`
                : `Recipients (${recipientsPreview.count})`}
            </DialogTitle>
            <DialogDescription>
              {language === 'ar'
                ? 'الأعضاء الذين سيتلقون إشعار البطولة الجديدة.'
                : 'Members who will receive the tournament announcement.'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto border rounded">
            {recipientsPreview.members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center p-4">
                {language === 'ar' ? 'لا يوجد مستلمون.' : 'No recipients.'}
              </p>
            ) : (
              <ul className="divide-y">
                {recipientsPreview.members.map((m) => (
                  <li key={m.id} className="px-3 py-2 text-sm flex items-center justify-between">
                    <span>{m.name || '-'}</span>
                    {m.member_code && (
                      <span className="text-xs text-muted-foreground ms-2">{m.member_code}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecipientsListOpen(false)}>
              {language === 'ar' ? 'إغلاق' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{language === 'ar' ? 'حذف البطولة' : 'Delete Tournament'}</AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'ar'
                ? `سيتم حذف "${deleteTarget?.name}" نهائياً. هل أنت متأكد؟`
                : `"${deleteTarget?.name}" will be permanently deleted. Continue?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{language === 'ar' ? 'إلغاء' : 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              {language === 'ar' ? 'حذف' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
};

// ════════════════════════════════════════════════════════
//  TOURNAMENT DETAIL VIEW
// ════════════════════════════════════════════════════════
// Color palette for level cards (mirrors LevelsPage).
const getLevelColor = (n) => {
  const colors = {
    1: 'bg-purple-500',
    2: 'bg-green-500',
    3: 'bg-blue-500',
    4: 'bg-yellow-500',
    5: 'bg-orange-500',
    6: 'bg-red-500',
  };
  return colors[((n - 1) % 6) + 1] || 'bg-slate-500';
};

const TournamentDetail = ({ tid, onBack }) => {
  const { language } = useLanguage();
  const { user, selectedBranchId } = useAuth();
  const isAdmin = user?.is_admin === true;

  const [tournament, setTournament] = useState(null);
  const [levels, setLevels] = useState([]);
  const [members, setMembers] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);

  // Manage-Members dialog (per-level + subcategory) state
  const [manageCtx, setManageCtx] = useState(null); // { level, subcategory, levelLabel }
  const [manageSearch, setManageSearch] = useState('');
  const [manageBusyId, setManageBusyId] = useState(null);

  // New-Level dialog state
  const [newLevelOpen, setNewLevelOpen] = useState(false);
  const [newLevelSaving, setNewLevelSaving] = useState(false);
  const [newLevelForm, setNewLevelForm] = useState({ custom_name: '', capacity: '' });

  const [addOpen, setAddOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [partForm, setPartForm] = useState({
    member_id: '', activity_id: '', level_id: '', subcategory: '', age: '', weight: '', notes: '', notify: false
  });
  const [saving, setSaving] = useState(false);

  // Active subcategory tab. '' means "all" (or tournament has no subcategories).
  const [selectedSubcategory, setSelectedSubcategory] = useState('');

  const [editingPart, setEditingPart] = useState(null);
  const [editForm, setEditForm] = useState({ activity_id: '', level_id: '', subcategory: '', age: '', weight: '', notes: '', position: '', notify: false });

  const [removeTarget, setRemoveTarget] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);

  const [resendingAnnouncement, setResendingAnnouncement] = useState(false);
  const [resendingMemberId, setResendingMemberId] = useState(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const printRef = useRef(null);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tid]);

  const load = async () => {
    setLoading(true);
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all'
        ? { branch_filter: selectedBranchId } : {};
      const [tRes, lRes, mRes, cRes] = await Promise.all([
        tournamentsAPI.get(tid),
        levelsAPI.getAll(branchParams),
        membersAPI.getAll(branchParams),
        coachesAPI.getAll().catch(() => ({ data: [] })),
      ]);
      setTournament(tRes.data);
      setLevels(lRes.data || []);
      setMembers(mRes.data || []);
      setCoaches(cRes.data || []);
    } catch (e) {
      toast.error(language === 'ar' ? 'فشل التحميل' : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  // Tournament activity helpers (handle both new array and legacy single field)
  const tournamentActivityIds = useMemo(() => {
    if (!tournament) return [];
    if (Array.isArray(tournament.activity_ids) && tournament.activity_ids.length) return tournament.activity_ids;
    return tournament.activity_id ? [tournament.activity_id] : [];
  }, [tournament]);
  const tournamentActivityNames = useMemo(() => {
    if (!tournament) return [];
    if (Array.isArray(tournament.activity_names) && tournament.activity_names.length) return tournament.activity_names;
    return tournament.activity_name ? [tournament.activity_name] : [];
  }, [tournament]);

  // Sub-categories defined on this tournament (e.g. swimming strokes).
  const tournamentSubcategories = useMemo(() => {
    if (!tournament) return [];
    return Array.isArray(tournament.subcategories) ? tournament.subcategories.filter(Boolean) : [];
  }, [tournament]);
  const subCapacity = tournament?.subcategory_capacity || 6;
  const hasSubcategories = tournamentSubcategories.length > 0;

  const activityNameById = useMemo(() => {
    const map = {};
    tournamentActivityIds.forEach((id, i) => {
      map[id] = tournamentActivityNames[i] || '';
    });
    return map;
  }, [tournamentActivityIds, tournamentActivityNames]);

  // Levels for the participant-form: show ALL levels belonging to any of
  // the tournament's activities (same behavior as LevelsPage — not filtered
  // by the participant's specific activity).
  const tournamentLevels = useMemo(() => {
    if (!tournament) return [];
    return levels
      .filter(l => {
        if (tournamentActivityIds.length === 0) return true;
        return tournamentActivityIds.includes(l.activity_id);
      })
      .sort((a, b) => (a.level_number || 0) - (b.level_number || 0));
  }, [tournament, levels, tournamentActivityIds]);

  // Levels available when EDITING a participant: show ALL levels belonging
  // to any of the tournament's activities (same behavior as LevelsPage —
  // not filtered by the participant's specific activity).
  const editLevels = useMemo(() => {
    if (!tournament) return [];
    return levels
      .filter(l => {
        if (tournamentActivityIds.length === 0) return true;
        return tournamentActivityIds.includes(l.activity_id);
      })
      .sort((a, b) => (a.level_number || 0) - (b.level_number || 0));
  }, [tournament, levels, tournamentActivityIds]);

  // Eligible members for the tournament's activities (or ALL members if no
  // activity restriction). When the user picks a specific activity in the
  // form, only members enrolled in THAT activity are shown.
  // Identity for "already added" is (member_id, subcategory): when the
  // tournament has subcategories, the same member may be added once per
  // subcategory.
  const eligibleMembers = useMemo(() => {
    if (!tournament) return [];
    const targetIds = partForm.activity_id ? [partForm.activity_id] : tournamentActivityIds;
    const sub = (partForm.subcategory || '') || null;
    const takenIds = new Set(
      (tournament.participants || [])
        .filter(p => (p.subcategory || null) === sub)
        .map(p => p.member_id)
    );
    return members
      .filter(m => !takenIds.has(m.id))
      .filter(m => {
        if (targetIds.length === 0) return true;
        const acts = m.activities || [];
        return acts.some(a => targetIds.includes(a.activity_id));
      });
  }, [members, tournament, tournamentActivityIds, partForm.activity_id, partForm.subcategory]);

  const filteredEligible = useMemo(() => {
    if (!memberSearch) return eligibleMembers.slice(0, 50);
    const q = memberSearch.toLowerCase();
    return eligibleMembers.filter(m => {
      const name = (m.name_ar || m.name || '').toLowerCase();
      const phone = (m.phone || '').toLowerCase();
      const code = (m.member_code || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || code.includes(q);
    }).slice(0, 50);
  }, [eligibleMembers, memberSearch]);

  // Group participants by level for display. When the tournament defines
  // sub-categories, only show participants from the selected tab.
  const groupedParticipants = useMemo(() => {
    let parts = tournament?.participants || [];
    if (hasSubcategories) {
      const sub = selectedSubcategory || tournamentSubcategories[0] || '';
      parts = parts.filter(p => (p.subcategory || '') === sub);
    }
    const groups = {};
    for (const p of parts) {
      const key = p.level_id || '__none__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    Object.keys(groups).forEach(k => {
      const RANK_MAP = { '1': 1, '2': 2, '3': 3, 'participation': 50 };
      groups[k].sort((a, b) => {
        const ra = RANK_MAP[String(a.position || '')] ?? 99;
        const rb = RANK_MAP[String(b.position || '')] ?? 99;
        if (ra !== rb) return ra - rb;
        return (a.member_name || '').localeCompare(b.member_name || '');
      });
    });
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament, hasSubcategories, selectedSubcategory, tournamentSubcategories]);

  const getLevelLabel = (lid) => {
    if (!lid || lid === '__none__') return language === 'ar' ? 'بدون مستوى' : 'No level';
    const l = levels.find(x => x.id === lid);
    if (!l) return language === 'ar' ? 'مستوى غير موجود' : 'Unknown level';
    const cn = (l.custom_name || '').trim();
    return cn || `${language === 'ar' ? 'المستوى' : 'Level'} ${l.level_number || ''}`;
  };

  const openAdd = () => {
    setMemberSearch('');
    // Auto-pick the activity when the tournament has only one.
    const defaultAid = tournamentActivityIds.length === 1 ? tournamentActivityIds[0] : '';
    // Default subcategory = currently selected tab (or first available).
    const defaultSub = hasSubcategories
      ? (selectedSubcategory || tournamentSubcategories[0] || '')
      : '';
    setPartForm({ member_id: '', activity_id: defaultAid, level_id: '', subcategory: defaultSub, age: '', weight: '', notes: '', notify: false });
    setAddOpen(true);
  };

  // ── Create-Level (from inside the tournament page) ────────────────
  const openNewLevel = () => {
    setNewLevelForm({ custom_name: '', capacity: String(subCapacity || 6) });
    setNewLevelOpen(true);
  };

  const handleCreateLevel = async () => {
    if (tournamentActivityIds.length === 0) {
      toast.error(language === 'ar' ? 'لا يوجد نشاط للبطولة' : 'Tournament has no activity');
      return;
    }
    setNewLevelSaving(true);
    try {
      const aid = tournamentActivityIds[0];
      const aname = activityNameById[aid] || tournamentActivityNames[0] || '';
      // Next level number = max within this activity + 1.
      const existing = levels.filter(l => l.activity_id === aid);
      const nextNum = existing.length
        ? Math.max(...existing.map(l => l.level_number || 0)) + 1
        : 1;
      const cap = parseInt(newLevelForm.capacity, 10) || subCapacity || 6;
      if (!selectedBranchId || selectedBranchId === 'all') {
        toast.error(language === 'ar' ? 'يرجى اختيار فرع محدد قبل إنشاء المستوى' : 'Please select a specific branch first');
        setNewLevelSaving(false);
        return;
      }
      const branchId = selectedBranchId;
      await levelsAPI.create({
        level_number: nextNum,
        activity_name: aname,
        activity_id: aid,
        custom_name: newLevelForm.custom_name?.trim() || `${language === 'ar' ? 'المستوى' : 'Level'} ${nextNum}`,
        capacity: cap,
        branch_id: branchId,
        members: [],
      });
      toast.success(language === 'ar' ? `تم إنشاء المستوى ${nextNum}` : `Level ${nextNum} created`);
      setNewLevelOpen(false);
      await loadDetail();
    } catch (e) {
      toast.error(e.response?.data?.detail || (language === 'ar' ? 'فشل إنشاء المستوى' : 'Failed to create level'));
    } finally {
      setNewLevelSaving(false);
    }
  };

  const handleAddParticipant = async () => {
    if (!partForm.member_id) {
      toast.error(language === 'ar' ? 'اختر عضواً' : 'Select a member');
      return;
    }
    if (tournamentActivityIds.length > 1 && !partForm.activity_id) {
      toast.error(language === 'ar' ? 'اختر النشاط الذي يشارك به العضو' : 'Pick which activity the member competes in');
      return;
    }
    setSaving(true);
    try {
      const res = await tournamentsAPI.addParticipant(tid, {
        member_id: partForm.member_id,
        activity_id: partForm.activity_id || null,
        level_id: partForm.level_id || null,
        subcategory: partForm.subcategory || null,
        age: partForm.age || '',
        weight: partForm.weight || '',
        notes: partForm.notes || '',
        position: null,
        notify: !!partForm.notify,
      });
      toast.success(language === 'ar' ? 'تمت إضافة المشارك' : 'Participant added');
      const summary = res?.data?.notification_summary;
      if (summary) showNotificationToast(summary, language);
      setAddOpen(false);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || (language === 'ar' ? 'فشل' : 'Failed'));
    } finally { setSaving(false); }
  };

  const openEdit = (p) => {
    setEditingPart(p);
    setEditForm({
      activity_id: p.activity_id || (tournamentActivityIds.length === 1 ? tournamentActivityIds[0] : ''),
      level_id: p.level_id || '',
      subcategory: p.subcategory || '',
      age: p.age || '',
      weight: p.weight || '',
      notes: p.notes || '',
      position: p.position ? String(p.position) : '',
      notify: false,
    });
  };

  const saveEdit = async () => {
    if (!editingPart) return;
    setSaving(true);
    try {
      const subQ = editingPart.subcategory ? `?subcategory=${encodeURIComponent(editingPart.subcategory)}` : '';
      const res = await tournamentsAPI.updateParticipant(tid, `${editingPart.member_id}${subQ}`, {
        activity_id: editForm.activity_id || null,
        level_id: editForm.level_id || null,
        subcategory: editForm.subcategory || null,
        age: editForm.age,
        weight: editForm.weight,
        notes: editForm.notes,
        position: editForm.position || null,
        notify: !!editForm.notify,
      });
      toast.success(language === 'ar' ? 'تم التحديث' : 'Updated');
      const summary = res?.data?.notification_summary;
      if (summary) showNotificationToast(summary, language);
      setEditingPart(null);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || (language === 'ar' ? 'فشل' : 'Failed'));
    } finally { setSaving(false); }
  };

  const quickPositionChange = async (p, newPos) => {
    try {
      const subQ = p.subcategory ? `?subcategory=${encodeURIComponent(p.subcategory)}` : '';
      await tournamentsAPI.updateParticipant(tid, `${p.member_id}${subQ}`, {
        position: newPos || null,
      });
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || (language === 'ar' ? 'فشل' : 'Failed'));
    }
  };

  const removeParticipant = async () => {
    if (!removeTarget) return;
    try {
      const subQ = removeTarget.subcategory ? `?subcategory=${encodeURIComponent(removeTarget.subcategory)}` : '';
      await tournamentsAPI.removeParticipant(tid, `${removeTarget.member_id}${subQ}`);
      toast.success(language === 'ar' ? 'تم الحذف' : 'Removed');
      setRemoveTarget(null);
      await load();
    } catch (e) {
      toast.error(language === 'ar' ? 'فشل' : 'Failed');
    }
  };

  const downloadFile = async (url, filename) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (e) {
      toast.error(language === 'ar' ? 'فشل التحميل' : 'Download failed');
    }
  };

  const handleExportXlsx = () =>
    downloadFile(tournamentsAPI.exportUrl(tid, 'xlsx'), `tournament_${tournament?.name || tid}.xlsx`);
  const handleExportPdf = () =>
    downloadFile(tournamentsAPI.exportUrl(tid, 'pdf'), `tournament_${tournament?.name || tid}.pdf`);
  const handleCertificate = (p) =>
    downloadFile(tournamentsAPI.certificateUrl(tid, p.member_id), `certificate_${p.member_name || p.member_id}.pdf`);

  const handleWhatsAppShare = async () => {
    if (!printRef.current) return;
    try {
      toast.info(language === 'ar' ? 'جاري إنشاء الصورة...' : 'Generating image...');
      const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      canvas.toBlob((blob) => {
        const link = document.createElement('a');
        link.download = `tournament_${tournament?.name || tid}.png`;
        link.href = URL.createObjectURL(blob);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Open WhatsApp with text — user can attach the saved image
        const msg = encodeURIComponent(
          `${language === 'ar' ? 'كشف بطولة' : 'Tournament list'}: ${tournament?.name || ''}\n` +
          `${language === 'ar' ? 'التاريخ' : 'Date'}: ${tournament?.date || '-'}\n` +
          `${language === 'ar' ? 'المكان' : 'Place'}: ${tournament?.place || '-'}`
        );
        window.open(`https://wa.me/?text=${msg}`, '_blank');
      }, 'image/png');
    } catch (e) {
      toast.error(language === 'ar' ? 'فشلت المشاركة' : 'Share failed');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleResendAnnouncement = async () => {
    setResendingAnnouncement(true);
    try {
      const res = await tournamentsAPI.resendAnnouncement(tid);
      const summary = res?.data?.notification_summary;
      if (summary) {
        showNotificationToast(summary, language);
      } else {
        toast.success(language === 'ar' ? 'تم إعادة الإرسال' : 'Resent');
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || (language === 'ar' ? 'فشل إعادة الإرسال' : 'Resend failed'));
    } finally {
      setResendingAnnouncement(false);
    }
  };

  const handleResendParticipant = async (p) => {
    setResendingMemberId(p.member_id);
    try {
      const res = await tournamentsAPI.resendParticipant(tid, p.member_id, 'auto');
      const summary = res?.data?.notification_summary;
      if (summary) {
        showNotificationToast(summary, language);
      } else {
        toast.success(language === 'ar' ? 'تم إعادة الإرسال' : 'Resent');
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || (language === 'ar' ? 'فشل إعادة الإرسال' : 'Resend failed'));
    } finally {
      setResendingMemberId(null);
    }
  };

  const openLogs = async () => {
    setLogsOpen(true);
    setLogsLoading(true);
    try {
      const res = await tournamentsAPI.getNotificationLogs(tid);
      setLogs(res.data || []);
    } catch (e) {
      toast.error(language === 'ar' ? 'فشل تحميل السجل' : 'Failed to load log');
    } finally {
      setLogsLoading(false);
    }
  };

  if (loading || !tournament) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
        </div>
      </Layout>
    );
  }

  const totalParticipants = (tournament.participants || []).length;

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-4">
        {!manageCtx && (<>
        {/* ───── HEADER (LevelsPage hour-view style) ───── */}
        <div className="bg-white rounded-xl shadow-sm border p-4 md:p-6 mb-2 print:hidden">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm mb-4 flex-wrap">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 text-gray-600 hover:text-primary">
              <Trophy className="w-4 h-4" />
              {language === 'ar' ? 'البطولات' : 'Tournaments'}
            </Button>
            <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
            {hasSubcategories && selectedSubcategory ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedSubcategory('')}
                  className="gap-1 text-gray-600 hover:text-primary"
                >
                  {tournament.name}
                </Button>
                <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
                <span className="font-medium text-primary flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {selectedSubcategory}
                </span>
              </>
            ) : (
              <span className="font-medium text-primary flex items-center gap-1">
                {tournament.name}
              </span>
            )}
          </div>

          {/* Main Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={hasSubcategories && selectedSubcategory ? () => setSelectedSubcategory('') : onBack}
                className="shrink-0"
              >
                <ArrowRight className="w-4 h-4" />
              </Button>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
                  <Trophy className="w-6 h-6 text-orange-500" />
                  {hasSubcategories && selectedSubcategory ? selectedSubcategory : tournament.name}
                </h1>
                <p className="text-gray-500 text-sm mt-1">
                  {language === 'ar' ? 'إدارة اللاعبين في كل مستوى' : 'Manage players in each level'}
                </p>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                  {tournament.date && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {tournament.date}</span>}
                  {tournament.place && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {tournament.place}</span>}
                  {tournamentActivityNames.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Activity className="w-3.5 h-3.5" /> {tournamentActivityNames.join(' + ')}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={openAdd} className="bg-orange-500 hover:bg-orange-600 text-white gap-1">
                <UserPlus className="w-4 h-4" />
                {language === 'ar' ? 'إضافة مشارك' : 'Add participant'}
              </Button>
              <Button variant="outline" onClick={handlePrint} className="gap-1">
                <FileText className="w-4 h-4" />
                {language === 'ar' ? 'طباعة' : 'Print'}
              </Button>
              <Button variant="outline" onClick={handleExportPdf} className="gap-1">
                <FileText className="w-4 h-4" />
                PDF
              </Button>
              <Button variant="outline" onClick={handleExportXlsx} className="gap-1">
                <FileSpreadsheet className="w-4 h-4" />
                Excel
              </Button>
              <Button variant="outline" onClick={handleWhatsAppShare} className="gap-1 bg-green-50 hover:bg-green-100 text-green-700 border-green-300">
                <Share2 className="w-4 h-4" />
                {language === 'ar' ? 'واتساب' : 'WhatsApp'}
              </Button>
              <Button
                variant="outline"
                onClick={handleResendAnnouncement}
                disabled={resendingAnnouncement}
                className="gap-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-300"
              >
                {resendingAnnouncement
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Bell className="w-4 h-4" />}
                {language === 'ar' ? 'إعادة إرسال الإشعار' : 'Resend announcement'}
              </Button>
              <Button variant="outline" onClick={openLogs} className="gap-1">
                <History className="w-4 h-4" />
                {language === 'ar' ? 'سجل الإشعارات' : 'Notification log'}
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
              <CardContent className="p-4 text-center">
                <Layers className="w-8 h-8 text-orange-600 mx-auto mb-2" />
                <div className="text-2xl font-bold text-orange-700">{tournamentLevels.length}</div>
                <div className="text-xs text-orange-600">{language === 'ar' ? 'إجمالي المستويات' : 'Total Levels'}</div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
              <CardContent className="p-4 text-center">
                <Users className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <div className="text-2xl font-bold text-green-700">{totalParticipants}</div>
                <div className="text-xs text-green-600">{language === 'ar' ? 'إجمالي اللاعبين' : 'Total Players'}</div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
              <CardContent className="p-4 text-center">
                <Calendar className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                <div className="text-2xl font-bold text-blue-700">{tournamentSubcategories.length || 1}</div>
                <div className="text-xs text-blue-600">{language === 'ar' ? 'التوقيتات' : 'Time Slots'}</div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
              <CardContent className="p-4 text-center">
                <Trophy className="w-8 h-8 text-purple-600 mx-auto mb-2" />
                <div className="text-2xl font-bold text-purple-700">
                  {tournamentLevels.length > 0 && subCapacity > 0
                    ? Math.min(100, Math.round((totalParticipants / (tournamentLevels.length * subCapacity * (tournamentSubcategories.length || 1))) * 100))
                    : 0}%
                </div>
                <div className="text-xs text-purple-600">{language === 'ar' ? 'نسبة الامتلاء' : 'Occupancy'}</div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Printable area */}
        <div ref={printRef} className="bg-white p-4 rounded-lg space-y-4">
          {/* Tournament header (print-only — screen uses LevelsPage-style header above) */}
          <Card className="border-2 border-orange-300 hidden print:block">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow">
                    <Trophy className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold">{tournament.name}</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                      شركة اداء الابطال العالمية للرياضة
                    </p>
                    <div className="flex flex-wrap gap-3 mt-2 text-sm">
                      {tournament.date && <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> {tournament.date}</span>}
                      {tournament.place && <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {tournament.place}</span>}
                      {tournamentActivityNames.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Activity className="w-4 h-4" /> {tournamentActivityNames.join(' + ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Badge variant="secondary" className="text-base gap-1">
                  <Users className="w-4 h-4" />
                  {totalParticipants} {language === 'ar' ? 'مشارك' : 'participants'}
                </Badge>
              </div>
              {tournament.description && (
                <p className="mt-3 text-sm text-muted-foreground border-t pt-3">{tournament.description}</p>
              )}
            </CardContent>
          </Card>

          {/* ───── SUBCATEGORY GRID VIEW (drill-down landing) ───── */}
          {hasSubcategories && !selectedSubcategory && (
            <div className="space-y-4 print:hidden">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Activity className="w-5 h-5 text-orange-500" />
                    {language === 'ar' ? 'اختر التوقيت' : 'Select time slot'}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {language === 'ar'
                      ? `${tournamentSubcategories.length} توقيتات · سعة كل مستوى ${subCapacity}`
                      : `${tournamentSubcategories.length} time slots · capacity ${subCapacity}/level`}
                  </p>
                </div>
                <Button onClick={openNewLevel} variant="outline">
                  <Plus className="w-4 h-4 ms-1" />
                  {language === 'ar' ? 'إضافة مستوى' : 'New level'}
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {tournamentSubcategories.map((s, idx) => {
                  const subParts = (tournament.participants || []).filter(p => (p.subcategory || '') === s);
                  const subLevels = tournamentLevels;
                  const totalCap = subLevels.length * subCapacity;
                  const fillPct = totalCap > 0 ? Math.round((subParts.length / totalCap) * 100) : 0;
                  const colorClass = getLevelColor(idx + 1);
                  return (
                    <Card
                      key={s}
                      className="overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02]"
                      onClick={() => setSelectedSubcategory(s)}
                    >
                      <div className={`${colorClass} text-white p-4`}>
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-white/20">
                            <Calendar className="w-6 h-6" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-xl truncate">{s}</h3>
                            <p className="text-sm opacity-90">
                              {subLevels.length} {language === 'ar' ? 'مستويات' : 'levels'}
                            </p>
                          </div>
                        </div>
                      </div>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            {language === 'ar' ? 'لاعبون' : 'Players'}
                          </span>
                          <span className="font-semibold">
                            {subParts.length}{totalCap > 0 ? ` / ${totalCap}` : ''}
                          </span>
                        </div>
                        {totalCap > 0 && (
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all duration-500 ${
                                fillPct >= 100 ? 'bg-red-500' : 'bg-gradient-to-r from-green-400 to-green-600'
                              }`}
                              style={{ width: `${Math.min(fillPct, 100)}%` }}
                            />
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground text-center pt-1">
                          {language === 'ar' ? 'اضغط لعرض المستويات' : 'Tap to view levels'}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Back-to-subcategories breadcrumb */}
          {hasSubcategories && selectedSubcategory && (
            <div className="flex items-center gap-2 print:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedSubcategory('')}
                className="text-orange-600 hover:text-orange-700"
              >
                <ArrowRight className="w-4 h-4 ms-1" />
                {language === 'ar' ? 'كل التوقيتات' : 'All time slots'}
              </Button>
              <span className="text-muted-foreground">/</span>
              <span className="font-semibold">{selectedSubcategory}</span>
            </div>
          )}

          {/* Subcategory tabs */}
          {hasSubcategories && selectedSubcategory && (
            <div className="bg-white border rounded-lg p-3 print:hidden">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-semibold">
                  {language === 'ar' ? 'التصنيفات الفرعية' : 'Sub-categories'}
                </span>
                <span className="text-xs text-muted-foreground">
                  · {language === 'ar' ? `سعة كل مستوى: ${subCapacity}` : `Capacity per level: ${subCapacity}`}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {tournamentSubcategories.map(s => {
                  const active = (selectedSubcategory || tournamentSubcategories[0]) === s;
                  const count = (tournament.participants || []).filter(p => (p.subcategory || '') === s).length;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSelectedSubcategory(s)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition ${
                        active
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-white text-orange-700 border-orange-300 hover:bg-orange-50'
                      }`}
                    >
                      {s}
                      <span className={`ms-1.5 text-xs ${active ? 'text-orange-100' : 'text-muted-foreground'}`}>
                        ({count})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active subcategory summary banner (matches LevelsPage style) */}
          {hasSubcategories && (() => {
            const activeSub = selectedSubcategory || tournamentSubcategories[0] || '';
            const subParts = (tournament.participants || []).filter(p => (p.subcategory || '') === activeSub);
            const levelsCount = tournamentLevels.length;
            return (
              <div className="bg-gradient-to-l from-blue-600 to-indigo-600 text-white rounded-xl p-5 flex items-center justify-between flex-wrap gap-3 shadow print:hidden">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                    <Activity className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-lg font-bold">
                      {tournamentActivityNames.join(' + ') || tournament.name} – {activeSub}
                    </div>
                    <div className="text-xs opacity-90 mt-0.5">
                      {language === 'ar'
                        ? `${levelsCount} مستويات · ${subParts.length} لاعب`
                        : `${levelsCount} levels · ${subParts.length} players`}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={openNewLevel}
                    variant="secondary"
                    className="bg-white/15 hover:bg-white/25 text-white border-white/30"
                  >
                    <Plus className="w-4 h-4 ms-1" />
                    {language === 'ar' ? 'إضافة مستوى' : 'New level'}
                  </Button>
                  <Button
                    onClick={openAdd}
                    className="bg-slate-900 hover:bg-slate-800 text-white"
                  >
                    <Plus className="w-4 h-4 ms-1" />
                    {language === 'ar' ? 'إضافة مشارك' : 'New participant'}
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* Add-level button when subcategories aren't enabled */}
          {!hasSubcategories && tournamentActivityIds.length > 0 && (
            <div className="flex justify-end print:hidden">
              <Button
                onClick={openNewLevel}
                variant="outline"
                size="sm"
              >
                <Plus className="w-4 h-4 ms-1" />
                {language === 'ar' ? 'إضافة مستوى جديد' : 'Add new level'}
              </Button>
            </div>
          )}

          {/* Levels with participants — card grid (3 per row) */}
          {tournamentLevels.length === 0 && Object.keys(groupedParticipants).length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">
              {language === 'ar'
                ? 'لا توجد مستويات لهذا النشاط بعد. اضف مشاركين بدون مستوى أو أنشئ مستويات أولاً.'
                : 'No levels exist for this activity yet. Add participants without a level or create levels first.'}
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Existing levels for this activity */}
              {tournamentLevels.map(lvl => {
                const parts = groupedParticipants[lvl.id] || [];
                const coach = lvl.coach_id ? coaches.find(c => c.id === lvl.coach_id) : null;
                const cap = hasSubcategories ? subCapacity : (lvl.max_capacity || subCapacity);
                return (
                  <TournamentLevelCard
                    key={lvl.id}
                    level={lvl}
                    coach={coach}
                    capacity={cap}
                    activityName={activityNameById[lvl.activity_id] || tournamentActivityNames[0] || ''}
                    subcategory={hasSubcategories ? (selectedSubcategory || tournamentSubcategories[0] || '') : ''}
                    participants={parts}
                    onEdit={openEdit}
                    onRemove={(p) => setRemoveTarget(p)}
                    onPositionChange={quickPositionChange}
                    onCertificate={handleCertificate}
                    onResend={handleResendParticipant}
                    onManage={(level) => {
                      setManageSearch('');
                      setManageCtx({
                        level,
                        subcategory: hasSubcategories ? (selectedSubcategory || tournamentSubcategories[0] || '') : '',
                        levelLabel: level.custom_name?.trim() || `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number}`,
                      });
                    }}
                    resendingMemberId={resendingMemberId}
                    language={language}
                  />
                );
              })}
              {/* Participants whose level is missing or unassigned */}
              {Object.keys(groupedParticipants)
                .filter(lid => lid === '__none__' || !tournamentLevels.find(l => l.id === lid))
                .map(lid => {
                  const parts = groupedParticipants[lid] || [];
                  // Synthesize a pseudo-level so we can reuse the card.
                  const pseudoLevel = { id: lid, level_number: 0, custom_name: getLevelLabel(lid) };
                  return (
                    <TournamentLevelCard
                      key={lid}
                      level={pseudoLevel}
                      coach={null}
                      capacity={hasSubcategories ? subCapacity : (parts.length || 0)}
                      activityName={tournamentActivityNames[0] || ''}
                      subcategory={hasSubcategories ? (selectedSubcategory || tournamentSubcategories[0] || '') : ''}
                      participants={parts}
                      onEdit={openEdit}
                      onRemove={(p) => setRemoveTarget(p)}
                      onPositionChange={quickPositionChange}
                      onCertificate={handleCertificate}
                      onResend={handleResendParticipant}
                      onManage={null /* unassigned bucket has no level to manage */}
                      resendingMemberId={resendingMemberId}
                      language={language}
                    />
                  );
                })}
            </div>
          )}
        </div>
        </>)}

        {/* ───── FULL-PAGE MANAGE MEMBERS VIEW (replaces dialog) ───── */}
        {manageCtx && (() => {
          const lvl = manageCtx.level;
          const sub = manageCtx.subcategory || '';
          const allParts = tournament?.participants || [];
          const inLevel = allParts.filter(p =>
            p.level_id === lvl.id && (p.subcategory || '') === sub
          );
          const inLevelIds = new Set(inLevel.map(p => p.member_id));
          const cap = hasSubcategories ? subCapacity : (lvl.max_capacity || subCapacity);
          const isFull = cap > 0 && inLevel.length >= cap;
          const headerColor = getLevelColor(lvl.level_number || 0);

          const eligibleActivityIds = new Set(tournament?.activity_ids || []);
          const q = manageSearch.trim().toLowerCase();
          const candidates = members.filter(m => {
            if (m.subscription_status !== 'active') return false;
            if (eligibleActivityIds.size > 0 && !(m.activities || []).some(aid => eligibleActivityIds.has(aid))) return false;
            if (inLevelIds.has(m.id)) return false;
            if (!q) return true;
            return (m.name_ar || '').toLowerCase().includes(q)
              || (m.name || '').toLowerCase().includes(q)
              || (m.member_code || '').toLowerCase().includes(q)
              || (m.phone || '').toLowerCase().includes(q);
          }).slice(0, 80);

          const handleAdd = async (m) => {
            if (isFull) {
              toast.error(language === 'ar' ? 'المستوى ممتلئ' : 'Level is full');
              return;
            }
            try {
              setManageBusyId(m.id);
              await tournamentsAPI.addParticipant(tid, {
                member_id: m.id,
                level_id: lvl.id,
                subcategory: sub || undefined,
              });
              toast.success(language === 'ar' ? 'تمت الإضافة' : 'Added');
              await loadDetail();
            } catch (e) {
              toast.error(e.response?.data?.detail || (language === 'ar' ? 'فشل الإضافة' : 'Failed'));
            } finally {
              setManageBusyId(null);
            }
          };

          const handleRemove = async (p) => {
            try {
              setManageBusyId(p.member_id);
              const path = sub
                ? `${p.member_id}?subcategory=${encodeURIComponent(sub)}`
                : p.member_id;
              await tournamentsAPI.removeParticipant(tid, path);
              toast.success(language === 'ar' ? 'تم الحذف' : 'Removed');
              await loadDetail();
            } catch (e) {
              toast.error(e.response?.data?.detail || (language === 'ar' ? 'فشل الحذف' : 'Failed'));
            } finally {
              setManageBusyId(null);
            }
          };

          return (
            <div className="space-y-4">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-sm flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setManageCtx(null)}
                  className="gap-1 text-gray-600 hover:text-orange-600"
                >
                  <Trophy className="w-4 h-4" />
                  {language === 'ar' ? 'البطولات' : 'Tournaments'}
                </Button>
                <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setManageCtx(null)}
                  className="gap-1 text-gray-600 hover:text-orange-600"
                >
                  {tournament?.name}
                </Button>
                {sub && (
                  <>
                    <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
                    <span className="text-gray-600 flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      {sub}
                    </span>
                  </>
                )}
                <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
                <span className="font-medium text-orange-600 flex items-center gap-1">
                  <Layers className="w-4 h-4" />
                  {manageCtx.levelLabel}
                </span>
              </div>

              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setManageCtx(null)}
                    className="shrink-0"
                  >
                    {language === 'ar' ? <ArrowRight className="w-4 h-4" /> : <ArrowRight className="w-4 h-4 rotate-180" />}
                  </Button>
                  <div>
                    <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
                      <Layers className="w-6 h-6 text-orange-500" />
                      {manageCtx.levelLabel}
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">
                      {language === 'ar' ? 'إدارة اللاعبين في هذا المستوى' : 'Manage players in this level'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={isFull ? 'destructive' : 'outline'} className="text-sm gap-1">
                    <Users className="w-4 h-4" />
                    {inLevel.length}/{cap || '∞'}
                  </Badge>
                  {isFull && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="w-4 h-4" />
                      {language === 'ar' ? 'ممتلئ' : 'Full'}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Level summary banner */}
              <div className={`${headerColor} text-white rounded-xl p-4 flex items-center justify-between shadow`}>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                    <span className="text-2xl font-bold">{lvl.level_number || '–'}</span>
                  </div>
                  <div>
                    <div className="font-bold text-lg">{manageCtx.levelLabel}</div>
                    <div className="text-sm opacity-90">{tournament?.name}{sub ? ` · ${sub}` : ''}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold">{inLevel.length}</div>
                  <div className="text-xs opacity-90">{language === 'ar' ? 'لاعب' : 'players'}</div>
                </div>
              </div>

              {/* Two-column add/remove grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Current members */}
                <Card className="lg:col-span-1">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Users className="w-4 h-4 text-gray-600" />
                        {language === 'ar' ? 'الأعضاء الحاليون' : 'Current members'}
                      </h4>
                      <Badge variant={isFull ? 'destructive' : 'outline'}>
                        {inLevel.length}/{cap || '∞'}
                      </Badge>
                    </div>
                    <div className="border rounded-lg max-h-[65vh] overflow-y-auto">
                      {inLevel.length === 0 ? (
                        <p className="text-center text-sm text-muted-foreground py-8">
                          {language === 'ar' ? 'لا يوجد أعضاء' : 'No members'}
                        </p>
                      ) : inLevel.map(p => (
                        <div key={p.member_id} className="flex items-center gap-2 p-2 border-b last:border-b-0 hover:bg-muted/30">
                          <div className={`w-8 h-8 rounded-full ${headerColor} text-white flex items-center justify-center text-xs font-bold`}>
                            {(p.member_name || '?').charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{p.member_name}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{p.phone || '—'}</p>
                          </div>
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7 text-red-600"
                            disabled={manageBusyId === p.member_id}
                            onClick={() => handleRemove(p)}
                            title={language === 'ar' ? 'حذف' : 'Remove'}
                          >
                            {manageBusyId === p.member_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Available members */}
                <Card className="lg:col-span-2">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold flex items-center gap-2">
                        <UserPlus className="w-4 h-4 text-green-600" />
                        {language === 'ar' ? 'الأعضاء المتاحون' : 'Available members'}
                        <span className="text-muted-foreground font-normal">({candidates.length})</span>
                      </h4>
                    </div>
                    <div className="relative mb-3">
                      <Search className="w-4 h-4 absolute start-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={manageSearch}
                        onChange={(e) => setManageSearch(e.target.value)}
                        placeholder={language === 'ar' ? 'بحث بالاسم أو الكود أو الهاتف...' : 'Search by name, code, phone...'}
                        className="ps-8"
                      />
                    </div>
                    <div className="border rounded-lg max-h-[65vh] overflow-y-auto divide-y">
                      {candidates.length === 0 ? (
                        <p className="text-center text-sm text-muted-foreground py-8">
                          {language === 'ar' ? 'لا توجد نتائج' : 'No results'}
                        </p>
                      ) : candidates.map(m => {
                        const memberActs = (m.activities || [])
                          .map(aid => activityNameById[aid])
                          .filter(Boolean);
                        return (
                          <div key={m.id} className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors">
                            <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-sm font-bold shrink-0">
                              {(m.name_ar || m.name || '?').charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-sm truncate">
                                  {m.name_ar || m.name}
                                  {m.age ? (
                                    <span className="ms-1.5 text-xs text-muted-foreground font-normal">
                                      ({m.age} {language === 'ar' ? 'سنة' : 'y'})
                                    </span>
                                  ) : null}
                                </p>
                                <Badge variant="outline" className="text-[10px] px-1.5">
                                  #{m.member_code}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                                <span>📱 {m.phone || '—'}</span>
                                {m.weight ? <span>⚖️ {m.weight} {language === 'ar' ? 'كجم' : 'kg'}</span> : null}
                                {m.gender ? <span>{m.gender === 'male' || m.gender === 'ذكر' ? '♂' : '♀'} {m.gender}</span> : null}
                              </p>
                              {memberActs.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {memberActs.map((name, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">
                                      <Activity className="w-3 h-3" />
                                      {name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white shrink-0"
                              disabled={manageBusyId === m.id || isFull}
                              onClick={() => handleAdd(m)}
                              title={isFull ? (language === 'ar' ? 'ممتلئ' : 'Full') : (language === 'ar' ? 'إضافة' : 'Add')}
                            >
                              {manageBusyId === m.id
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <><UserPlus className="w-4 h-4 ms-1" />{language === 'ar' ? 'إضافة' : 'Add'}</>}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Add Participant Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{language === 'ar' ? 'إضافة مشارك' : 'Add Participant'}</DialogTitle>
            <DialogDescription>
              {language === 'ar'
                ? `الأعضاء النشطون في: ${tournamentActivityNames.join(' + ') || '-'}`
                : `Active members in: ${tournamentActivityNames.join(' + ') || '-'}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {hasSubcategories && (
              <div>
                <Label>
                  {language === 'ar' ? 'التصنيف الفرعي (السباق)' : 'Sub-category'}
                  <span className="text-red-500"> *</span>
                </Label>
                <Select
                  value={partForm.subcategory || ''}
                  onValueChange={(v) => setPartForm({ ...partForm, subcategory: v, member_id: '' })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'ar' ? 'اختر التصنيف' : 'Pick sub-category'} />
                  </SelectTrigger>
                  <SelectContent>
                    {tournamentSubcategories.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {tournamentActivityIds.length > 1 && (
              <div>
                <Label>
                  {language === 'ar' ? 'النشاط الذي يشارك به العضو' : "Member's competing activity"}
                  <span className="text-red-500"> *</span>
                </Label>
                <Select
                  value={partForm.activity_id || ''}
                  onValueChange={(v) => {
                    setPartForm({ ...partForm, activity_id: v, member_id: '', level_id: '' });
                    setMemberSearch('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'ar' ? 'اختر النشاط' : 'Pick the activity'} />
                  </SelectTrigger>
                  <SelectContent>
                    {tournamentActivityIds.map((aid, i) => (
                      <SelectItem key={aid} value={aid}>
                        {tournamentActivityNames[i] || aid}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {language === 'ar'
                    ? 'يجب اختيار النشاط أولاً لتصفية المستويات والأعضاء.'
                    : 'Pick the activity first to filter levels and members.'}
                </p>
              </div>
            )}
            <div>
              <Label>{language === 'ar' ? 'بحث عن عضو' : 'Search member'}</Label>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder={language === 'ar' ? 'ابحث بالاسم أو الهاتف أو الكود' : 'Search by name, phone or code'}
                  className="pe-10"
                />
              </div>
            </div>
            <div className="border rounded-md max-h-60 overflow-y-auto">
              {filteredEligible.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  {language === 'ar' ? 'لا يوجد أعضاء مطابقون' : 'No matching members'}
                </div>
              ) : filteredEligible.map(m => (
                <div
                  key={m.id}
                  onClick={() => setPartForm({ ...partForm, member_id: m.id })}
                  className={`p-2 cursor-pointer border-b hover:bg-muted ${partForm.member_id === m.id ? 'bg-orange-50 border-orange-300' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{m.name_ar || m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.phone} {m.member_code ? `• ${m.member_code}` : ''}</div>
                    </div>
                    {partForm.member_id === m.id && <Badge className="bg-orange-500">✓</Badge>}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                <Select value={partForm.level_id} onValueChange={(v) => setPartForm({ ...partForm, level_id: v })}>
                  <SelectTrigger><SelectValue placeholder={language === 'ar' ? 'اختياري' : 'Optional'} /></SelectTrigger>
                  <SelectContent>
                    {tournamentLevels.map(l => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.custom_name?.trim() || `${language === 'ar' ? 'المستوى' : 'Level'} ${l.level_number}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{language === 'ar' ? 'العمر' : 'Age'}</Label>
                <Input value={partForm.age} onChange={(e) => setPartForm({ ...partForm, age: e.target.value })} />
              </div>
              <div>
                <Label>{language === 'ar' ? 'الوزن' : 'Weight'}</Label>
                <Input value={partForm.weight} onChange={(e) => setPartForm({ ...partForm, weight: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>{language === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea
                rows={2}
                value={partForm.notes}
                onChange={(e) => setPartForm({ ...partForm, notes: e.target.value })}
              />
            </div>
            <div className="flex items-start gap-2 pt-3 border-t">
              <Checkbox
                id="notify-add-participant"
                checked={!!partForm.notify}
                onCheckedChange={(v) => setPartForm({ ...partForm, notify: !!v })}
              />
              <Label htmlFor="notify-add-participant" className="cursor-pointer">
                {language === 'ar'
                  ? 'إرسال إشعار للعضو بتسجيله في البطولة'
                  : 'Notify the member of their registration'}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={handleAddParticipant} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
              {saving && <Loader2 className="w-4 h-4 animate-spin ms-1" />}
              {language === 'ar' ? 'إضافة' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Participant Dialog */}
      <Dialog open={!!editingPart} onOpenChange={(o) => !o && setEditingPart(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {language === 'ar' ? 'تعديل بيانات المشارك' : 'Edit Participant'}
            </DialogTitle>
            <DialogDescription>{editingPart?.member_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {hasSubcategories && (
              <div>
                <Label>{language === 'ar' ? 'التصنيف الفرعي' : 'Sub-category'}</Label>
                <Select
                  value={editForm.subcategory || ''}
                  onValueChange={(v) => setEditForm({ ...editForm, subcategory: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'ar' ? 'اختر' : 'Pick'} />
                  </SelectTrigger>
                  <SelectContent>
                    {tournamentSubcategories.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {tournamentActivityIds.length > 1 && (
              <div>
                <Label>{language === 'ar' ? 'النشاط' : 'Activity'}</Label>
                <Select
                  value={editForm.activity_id || ''}
                  onValueChange={(v) => setEditForm({ ...editForm, activity_id: v, level_id: '' })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'ar' ? 'اختر النشاط' : 'Pick the activity'} />
                  </SelectTrigger>
                  <SelectContent>
                    {tournamentActivityIds.map((aid, i) => (
                      <SelectItem key={aid} value={aid}>
                        {tournamentActivityNames[i] || aid}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>{language === 'ar' ? 'المستوى' : 'Level'}</Label>
              <Select value={editForm.level_id || '__none__'} onValueChange={(v) => setEditForm({ ...editForm, level_id: v === '__none__' ? '' : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{language === 'ar' ? 'بدون مستوى' : 'No level'}</SelectItem>
                  {editLevels.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.custom_name?.trim() || `${language === 'ar' ? 'المستوى' : 'Level'} ${l.level_number}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>{language === 'ar' ? 'العمر' : 'Age'}</Label>
                <Input value={editForm.age} onChange={(e) => setEditForm({ ...editForm, age: e.target.value })} />
              </div>
              <div>
                <Label>{language === 'ar' ? 'الوزن' : 'Weight'}</Label>
                <Input value={editForm.weight} onChange={(e) => setEditForm({ ...editForm, weight: e.target.value })} />
              </div>
              <div>
                <Label>{language === 'ar' ? 'المركز' : 'Position'}</Label>
                <Select value={editForm.position || '__none__'} onValueChange={(v) => setEditForm({ ...editForm, position: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{language === 'ar' ? 'بدون' : 'None'}</SelectItem>
                    {POSITIONS.map(p => (
                      <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>{language === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
            {['1', '2', '3'].includes(String(editForm.position || '')) && (
              <div className="flex items-start gap-2 pt-3 border-t">
                <Checkbox
                  id="notify-edit-participant"
                  checked={!!editForm.notify}
                  onCheckedChange={(v) => setEditForm({ ...editForm, notify: !!v })}
                />
                <Label htmlFor="notify-edit-participant" className="cursor-pointer">
                  {language === 'ar'
                    ? 'إرسال إشعار تهنئة للعضو بفوزه'
                    : 'Send a congratulations notification to the member'}
                </Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPart(null)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={saveEdit} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
              {saving && <Loader2 className="w-4 h-4 animate-spin ms-1" />}
              {language === 'ar' ? 'حفظ' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notification log dialog */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-orange-500" />
              {language === 'ar' ? 'سجل إشعارات البطولة' : 'Tournament Notification Log'}
            </DialogTitle>
            <DialogDescription>
              {language === 'ar'
                ? 'كل إشعار تم إرساله لهذه البطولة وعدد التسليمات الناجحة والفاشلة.'
                : 'Every notification sent for this tournament with delivery counts.'}
            </DialogDescription>
          </DialogHeader>
          {logsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              {language === 'ar' ? 'لا توجد إشعارات مسجلة بعد.' : 'No notifications recorded yet.'}
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map(l => {
                const typeLabel = {
                  announcement: language === 'ar' ? 'إعلان البطولة' : 'Announcement',
                  registration: language === 'ar' ? 'تسجيل مشارك' : 'Registration',
                  result: language === 'ar' ? 'نتيجة مشارك' : 'Result',
                }[l.type] || l.type;
                const failed = (l.push_failed || 0) > 0;
                const when = (() => {
                  try { return new Date(l.created_at).toLocaleString(); } catch { return l.created_at; }
                })();
                return (
                  <div key={l.id} className="border rounded-md p-3 text-sm">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        {failed
                          ? <AlertTriangle className="w-4 h-4 text-amber-600" />
                          : <CheckCircle2 className="w-4 h-4 text-green-600" />}
                        <span className="font-medium">{typeLabel}</span>
                        {l.member_name && (
                          <span className="text-muted-foreground">— {l.member_name}</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">{when}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {l.type === 'announcement' ? (
                        <>
                          {language === 'ar'
                            ? `أعضاء مستهدفون: ${l.members_count} · داخل التطبيق: ${l.in_app} · إشعارات هاتف ناجحة: ${l.push_success} · فشلت: ${l.push_failed} · بدون اشتراك: ${l.no_push}`
                            : `Targeted: ${l.members_count} · in-app: ${l.in_app} · push delivered: ${l.push_success} · failed: ${l.push_failed} · no device: ${l.no_push}`}
                        </>
                      ) : (
                        <>
                          {language === 'ar'
                            ? `داخل التطبيق: ${l.in_app ? 'نعم' : 'لا'} · إشعار هاتف ناجح: ${l.push_success} · فشل: ${l.push_failed}`
                            : `In-app: ${l.in_app ? 'yes' : 'no'} · push delivered: ${l.push_success} · failed: ${l.push_failed}`}
                        </>
                      )}
                    </div>
                    {l.sent_by_user_name && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {language === 'ar' ? 'بواسطة' : 'By'}: {l.sent_by_user_name}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogsOpen(false)}>
              {language === 'ar' ? 'إغلاق' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove participant confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{language === 'ar' ? 'حذف المشارك' : 'Remove Participant'}</AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'ar'
                ? `سيتم إزالة "${removeTarget?.member_name}" من البطولة.`
                : `"${removeTarget?.member_name}" will be removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{language === 'ar' ? 'إلغاء' : 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction onClick={removeParticipant} className="bg-red-600 hover:bg-red-700">
              {language === 'ar' ? 'حذف' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Level dialog */}
      <Dialog open={newLevelOpen} onOpenChange={setNewLevelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{language === 'ar' ? 'إضافة مستوى جديد' : 'Add new level'}</DialogTitle>
            <DialogDescription>
              {language === 'ar'
                ? `سيتم إنشاء مستوى جديد ضمن نشاط "${tournamentActivityNames[0] || ''}".`
                : `Creates a new level under activity "${tournamentActivityNames[0] || ''}".`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{language === 'ar' ? 'اسم المستوى (اختياري)' : 'Level name (optional)'}</Label>
              <Input
                value={newLevelForm.custom_name}
                onChange={(e) => setNewLevelForm({ ...newLevelForm, custom_name: e.target.value })}
                placeholder={language === 'ar' ? 'مثال: المستوى المتقدم' : 'e.g. Advanced'}
              />
            </div>
            <div>
              <Label>{language === 'ar' ? 'السعة القصوى' : 'Max capacity'}</Label>
              <Input
                type="number" min="1"
                value={newLevelForm.capacity}
                onChange={(e) => setNewLevelForm({ ...newLevelForm, capacity: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewLevelOpen(false)} disabled={newLevelSaving}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={handleCreateLevel} disabled={newLevelSaving}>
              {newLevelSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : (language === 'ar' ? 'إنشاء' : 'Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </Layout>
  );
};

// Reusable level group component (collapsible)
const LevelGroup = ({ label, levelNumber, participants, onEdit, onRemove, onPositionChange, onCertificate, onResend, resendingMemberId, language }) => {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Card>
      <CardContent className="p-4">
        <div
          className="flex items-center justify-between mb-3 pb-2 border-b cursor-pointer select-none print:cursor-auto"
          onClick={() => setCollapsed(c => !c)}
          title={language === 'ar' ? (collapsed ? 'إظهار' : 'إخفاء') : (collapsed ? 'Expand' : 'Collapse')}
        >
          <div className="flex items-center gap-2">
            <Medal className="w-5 h-5 text-orange-500" />
            <h3 className="font-bold text-lg">{label}</h3>
            <span className="text-muted-foreground text-sm print:hidden">
              {collapsed ? '▸' : '▾'}
            </span>
          </div>
          <Badge variant="outline" className="gap-1">
            <Users className="w-3.5 h-3.5" />
            {participants.length}
          </Badge>
        </div>
        {collapsed ? (
          <div className="text-xs text-muted-foreground text-center py-2 print:hidden">
            {language === 'ar' ? 'اضغط للإظهار' : 'Click to expand'}
          </div>
        ) : participants.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-3">
            {language === 'ar' ? 'لا يوجد مشاركون في هذا المستوى' : 'No participants in this level'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b">
                  <th className="text-start py-2 px-2 w-8">#</th>
                  <th className="text-start py-2 px-2">{language === 'ar' ? 'الاسم' : 'Name'}</th>
                  <th className="text-start py-2 px-2 hidden md:table-cell">{language === 'ar' ? 'الهاتف' : 'Phone'}</th>
                  <th className="text-center py-2 px-2 w-16">{language === 'ar' ? 'العمر' : 'Age'}</th>
                  <th className="text-center py-2 px-2 w-16">{language === 'ar' ? 'الوزن' : 'Weight'}</th>
                  <th className="text-center py-2 px-2 w-32">{language === 'ar' ? 'المركز' : 'Position'}</th>
                  <th className="text-end py-2 px-2 print:hidden w-32"></th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p, i) => (
                  <tr key={p.member_id} className="border-b hover:bg-muted/30">
                    <td className="py-2 px-2 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 px-2 font-medium">
                      {p.member_name}
                      {p.activity_name && (
                        <span className="ms-2 inline-flex items-center gap-1 text-[11px] font-normal text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 align-middle">
                          <Activity className="w-3 h-3" />
                          {p.activity_name}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 hidden md:table-cell text-muted-foreground">{p.phone}</td>
                    <td className="py-2 px-2 text-center">{p.age || '-'}</td>
                    <td className="py-2 px-2 text-center">{p.weight || '-'}</td>
                    <td className="py-2 px-2 text-center">
                      <select
                        value={p.position || ''}
                        onChange={(e) => onPositionChange(p, e.target.value)}
                        className="border rounded px-2 py-0.5 text-sm bg-background print:hidden"
                      >
                        <option value="">—</option>
                        {POSITIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <span className="hidden print:inline">{positionLabel(p.position)}</span>
                    </td>
                    <td className="py-2 px-2 text-end print:hidden">
                      <div className="flex justify-end gap-1">
                        {onResend && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title={language === 'ar' ? 'إعادة إرسال إشعار' : 'Resend notification'}
                            onClick={() => onResend(p)}
                            disabled={resendingMemberId === p.member_id}
                          >
                            {resendingMemberId === p.member_id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Send className="w-4 h-4 text-blue-600" />}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" title={language === 'ar' ? 'شهادة' : 'Certificate'} onClick={() => onCertificate(p)}>
                          <Award className="w-4 h-4 text-amber-600" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onEdit(p)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => onRemove(p)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ─────────────────────────────────────────────────────────
// TournamentLevelCard — visual card matching LevelsPage design
// ─────────────────────────────────────────────────────────
const TournamentLevelCard = ({
  level, coach, capacity, activityName, subcategory,
  participants, onEdit, onRemove, onPositionChange, onCertificate,
  onResend, onManage, resendingMemberId, language,
}) => {
  const t = (ar, en) => (language === 'ar' ? ar : en);
  const memberCount = participants.length;
  const cap = Math.max(capacity || 0, 1);
  const isFull = capacity > 0 && memberCount >= capacity;
  const headerColor = getLevelColor(level.level_number || 0);

  return (
    <div
      className={`border rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 ${
        isFull ? 'border-red-300 bg-red-50/30' : 'bg-white'
      }`}
    >
      {/* Header */}
      <div className={`${headerColor} text-white p-3 flex items-center justify-between`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <span className="text-2xl font-bold">{level.level_number || '–'}</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm opacity-95 font-semibold truncate">
              {level.custom_name?.trim() || t('المستوى', 'Level')}
            </div>
            <p className="text-xs opacity-80 truncate">
              {activityName}{subcategory ? ` · ${subcategory}` : ''}
            </p>
            {coach && (
              <p className="text-xs opacity-90 mt-0.5 flex items-center gap-1 truncate">
                <span className="opacity-75">👤</span>
                {coach.name_ar || coach.name}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-3">
        {/* Capacity bar */}
        {capacity > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className={`font-medium ${isFull ? 'text-red-600' : 'text-gray-700'}`}>
                {memberCount}/{capacity} {t('لاعب', 'players')}
              </span>
              {isFull && (
                <Badge variant="destructive" className="text-xs gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {t('ممتلئ', 'Full')}
                </Badge>
              )}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all duration-500 ${
                  isFull ? 'bg-red-500' : 'bg-gradient-to-r from-green-400 to-green-600'
                }`}
                style={{ width: `${Math.min((memberCount / cap) * 100, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Participants list */}
        <div className="space-y-1.5 max-h-72 overflow-y-auto mb-3 scrollbar-thin">
          {memberCount === 0 ? (
            <p className="text-center text-gray-400 py-3 text-sm">
              {t('لا يوجد لاعبين', 'No players')}
            </p>
          ) : (
            participants.map((p, i) => (
              <div
                key={p.member_id}
                className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="text-xs text-gray-400 w-4 text-center shrink-0">{i + 1}</div>
                <div className={`w-7 h-7 rounded-full ${headerColor} text-white flex items-center justify-center text-xs font-bold shadow-sm shrink-0`}>
                  {(p.member_name || '?').charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{p.member_name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {p.phone || '—'}
                    {p.age ? ` · ${p.age}${language === 'ar' ? ' سنة' : 'y'}` : ''}
                    {p.weight ? ` · ${p.weight}kg` : ''}
                  </p>
                </div>
                {/* Position select (compact) */}
                <select
                  value={p.position || ''}
                  onChange={(e) => onPositionChange(p, e.target.value)}
                  className="border rounded px-1 py-0.5 text-[11px] bg-white print:hidden shrink-0"
                  title={t('المركز', 'Position')}
                >
                  <option value="">—</option>
                  {POSITIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div className="flex gap-0.5 shrink-0 print:hidden">
                  {onResend && (
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      title={t('إعادة إرسال', 'Resend')}
                      onClick={() => onResend(p)}
                      disabled={resendingMemberId === p.member_id}
                    >
                      {resendingMemberId === p.member_id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Send className="w-3.5 h-3.5 text-blue-600" />}
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7" title={t('شهادة', 'Certificate')} onClick={() => onCertificate(p)}>
                    <Award className="w-3.5 h-3.5 text-amber-600" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(p)}>
                    <Edit className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => onRemove(p)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Manage Members button */}
        {onManage && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => onManage(level)}
          >
            <Users className="w-4 h-4 ms-1" />
            {t('إدارة الأعضاء', 'Manage members')}
          </Button>
        )}
      </div>
    </div>
  );
};

export default TournamentsPage;
export { TournamentsPage };
