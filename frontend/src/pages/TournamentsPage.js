import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  tournamentsAPI, levelsAPI, membersAPI, branchesAPI, activitiesAPI
} from '../services/api';
import { toast } from 'sonner';
import {
  Trophy, Plus, Edit, Trash2, Loader2, ArrowRight, Search, UserPlus,
  Calendar, MapPin, Activity, FileSpreadsheet, FileText, Award, Share2,
  Medal, X, Users
} from 'lucide-react';

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
  const [view, setView] = useState('list');
  const [selectedTid, setSelectedTid] = useState(null);

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
    name: '', date: '', place: '', activity_id: '', activity_name: '',
    branch_id: 'all', description: '', status: 'upcoming'
  });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

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

  const filteredTournaments = useMemo(() => {
    return (tournaments || []).filter(tn => {
      if (filterActivity !== 'all' && tn.activity_id !== filterActivity) return false;
      if (filterBranch !== 'all' && (tn.branch_id || '') !== filterBranch) return false;
      if (filterFromDate && (tn.date || '') < filterFromDate) return false;
      if (filterToDate && (tn.date || '') > filterToDate) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const fields = [tn.name, tn.place, tn.date, tn.activity_name].filter(Boolean).join(' ').toLowerCase();
        return fields.includes(q);
      }
      return true;
    });
  }, [tournaments, searchTerm, filterActivity, filterBranch, filterFromDate, filterToDate]);

  const openCreate = () => {
    setEditingTournament(null);
    setTournamentForm({
      name: '', date: new Date().toISOString().split('T')[0], place: '',
      activity_id: '', activity_name: '',
      branch_id: selectedBranchId && selectedBranchId !== 'all' ? selectedBranchId : 'all',
      description: '', status: 'upcoming'
    });
    setTournamentDialogOpen(true);
  };

  const openEdit = (tn) => {
    setEditingTournament(tn);
    setTournamentForm({
      name: tn.name || '',
      date: tn.date || '',
      place: tn.place || '',
      activity_id: tn.activity_id || '',
      activity_name: tn.activity_name || '',
      branch_id: tn.branch_id || 'all',
      description: tn.description || '',
      status: tn.status || 'upcoming',
    });
    setTournamentDialogOpen(true);
  };

  const handleActivityChange = (activityId) => {
    const act = activities.find(a => a.id === activityId);
    setTournamentForm(prev => ({
      ...prev,
      activity_id: activityId,
      activity_name: act ? (act.name_ar || act.name || '') : prev.activity_name,
    }));
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
        await tournamentsAPI.update(editingTournament.id, payload);
        toast.success(language === 'ar' ? 'تم التحديث' : 'Updated');
      } else {
        await tournamentsAPI.create(payload);
        toast.success(language === 'ar' ? 'تم إنشاء البطولة' : 'Tournament created');
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
                    {tn.activity_name && (<div className="flex items-center gap-2"><Activity className="w-3.5 h-3.5" /> {tn.activity_name}</div>)}
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
        <DialogContent className="max-w-lg">
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
              <Label>{language === 'ar' ? 'النشاط' : 'Activity'}</Label>
              <Select value={tournamentForm.activity_id || ''} onValueChange={handleActivityChange}>
                <SelectTrigger><SelectValue placeholder={language === 'ar' ? 'اختر النشاط' : 'Select activity'} /></SelectTrigger>
                <SelectContent>
                  {activities.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name_ar || a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
const TournamentDetail = ({ tid, onBack }) => {
  const { language } = useLanguage();
  const { user, selectedBranchId } = useAuth();
  const isAdmin = user?.is_admin === true;

  const [tournament, setTournament] = useState(null);
  const [levels, setLevels] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [partForm, setPartForm] = useState({
    member_id: '', level_id: '', age: '', weight: '', notes: ''
  });
  const [saving, setSaving] = useState(false);

  const [editingPart, setEditingPart] = useState(null);
  const [editForm, setEditForm] = useState({ level_id: '', age: '', weight: '', notes: '', position: '' });

  const [removeTarget, setRemoveTarget] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);

  const printRef = useRef(null);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tid]);

  const load = async () => {
    setLoading(true);
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all'
        ? { branch_filter: selectedBranchId } : {};
      const [tRes, lRes, mRes] = await Promise.all([
        tournamentsAPI.get(tid),
        levelsAPI.getAll(branchParams),
        membersAPI.getAll(branchParams),
      ]);
      setTournament(tRes.data);
      setLevels(lRes.data || []);
      setMembers(mRes.data || []);
    } catch (e) {
      toast.error(language === 'ar' ? 'فشل التحميل' : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  // Levels filtered to this tournament's activity (by activity_id then by name fallback)
  const tournamentLevels = useMemo(() => {
    if (!tournament) return [];
    const aid = tournament.activity_id;
    const aname = (tournament.activity_name || '').toLowerCase();
    return levels
      .filter(l => {
        if (aid && l.activity_id === aid) return true;
        if (aname && (l.activity_name || '').toLowerCase().includes(aname.split(' ')[0])) return true;
        if (!aid && !aname) return true;
        return (l.activity_name || '').toLowerCase() === aname;
      })
      .sort((a, b) => (a.level_number || 0) - (b.level_number || 0));
  }, [tournament, levels]);

  // Eligible members for the activity
  const eligibleMembers = useMemo(() => {
    if (!tournament) return [];
    const aid = tournament.activity_id;
    const aname = (tournament.activity_name || '').toLowerCase();
    const partIds = new Set((tournament.participants || []).map(p => p.member_id));
    return members
      .filter(m => !partIds.has(m.id))
      .filter(m => {
        if (!aid && !aname) return true;
        const acts = m.activities || [];
        return acts.some(a => {
          if (aid && a.activity_id === aid) return true;
          const an = (a.activity_name || '').toLowerCase();
          return aname && (an === aname || an.includes(aname.split(' ')[0]));
        });
      });
  }, [members, tournament]);

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

  // Group participants by level for display
  const groupedParticipants = useMemo(() => {
    const parts = tournament?.participants || [];
    const groups = {};
    for (const p of parts) {
      const key = p.level_id || '__none__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    Object.keys(groups).forEach(k => {
      groups[k].sort((a, b) => (a.position || 99) - (b.position || 99));
    });
    return groups;
  }, [tournament]);

  const getLevelLabel = (lid) => {
    if (!lid || lid === '__none__') return language === 'ar' ? 'بدون مستوى' : 'No level';
    const l = levels.find(x => x.id === lid);
    if (!l) return language === 'ar' ? 'مستوى غير موجود' : 'Unknown level';
    const cn = (l.custom_name || '').trim();
    return cn || `${language === 'ar' ? 'المستوى' : 'Level'} ${l.level_number || ''}`;
  };

  const openAdd = () => {
    setMemberSearch('');
    setPartForm({ member_id: '', level_id: '', age: '', weight: '', notes: '' });
    setAddOpen(true);
  };

  const handleAddParticipant = async () => {
    if (!partForm.member_id) {
      toast.error(language === 'ar' ? 'اختر عضواً' : 'Select a member');
      return;
    }
    setSaving(true);
    try {
      await tournamentsAPI.addParticipant(tid, {
        member_id: partForm.member_id,
        level_id: partForm.level_id || null,
        age: partForm.age || '',
        weight: partForm.weight || '',
        notes: partForm.notes || '',
        position: null,
      });
      toast.success(language === 'ar' ? 'تمت إضافة المشارك' : 'Participant added');
      setAddOpen(false);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || (language === 'ar' ? 'فشل' : 'Failed'));
    } finally { setSaving(false); }
  };

  const openEdit = (p) => {
    setEditingPart(p);
    setEditForm({
      level_id: p.level_id || '',
      age: p.age || '',
      weight: p.weight || '',
      notes: p.notes || '',
      position: p.position ? String(p.position) : '',
    });
  };

  const saveEdit = async () => {
    if (!editingPart) return;
    setSaving(true);
    try {
      await tournamentsAPI.updateParticipant(tid, editingPart.member_id, {
        level_id: editForm.level_id || null,
        age: editForm.age,
        weight: editForm.weight,
        notes: editForm.notes,
        position: editForm.position || null,
      });
      toast.success(language === 'ar' ? 'تم التحديث' : 'Updated');
      setEditingPart(null);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || (language === 'ar' ? 'فشل' : 'Failed'));
    } finally { setSaving(false); }
  };

  const quickPositionChange = async (p, newPos) => {
    try {
      await tournamentsAPI.updateParticipant(tid, p.member_id, {
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
      await tournamentsAPI.removeParticipant(tid, removeTarget.member_id);
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
        {/* Top bar */}
        <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
          <Button variant="outline" onClick={onBack}>
            <ArrowRight className="w-4 h-4 ms-1" />
            {language === 'ar' ? 'رجوع للبطولات' : 'Back to tournaments'}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button onClick={openAdd} className="bg-orange-500 hover:bg-orange-600 text-white">
              <UserPlus className="w-4 h-4 ms-1" />
              {language === 'ar' ? 'إضافة مشارك' : 'Add participant'}
            </Button>
            <Button variant="outline" onClick={handlePrint}>
              <FileText className="w-4 h-4 ms-1" />
              {language === 'ar' ? 'طباعة' : 'Print'}
            </Button>
            <Button variant="outline" onClick={handleExportPdf}>
              <FileText className="w-4 h-4 ms-1" />
              PDF
            </Button>
            <Button variant="outline" onClick={handleExportXlsx}>
              <FileSpreadsheet className="w-4 h-4 ms-1" />
              Excel
            </Button>
            <Button variant="outline" onClick={handleWhatsAppShare} className="bg-green-50 hover:bg-green-100 text-green-700 border-green-300">
              <Share2 className="w-4 h-4 ms-1" />
              {language === 'ar' ? 'واتساب' : 'WhatsApp'}
            </Button>
          </div>
        </div>

        {/* Printable area */}
        <div ref={printRef} className="bg-white p-4 rounded-lg space-y-4">
          {/* Tournament header */}
          <Card className="border-2 border-orange-300">
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
                      {tournament.activity_name && <span className="flex items-center gap-1"><Activity className="w-4 h-4" /> {tournament.activity_name}</span>}
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

          {/* Levels with participants */}
          {tournamentLevels.length === 0 && Object.keys(groupedParticipants).length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">
              {language === 'ar'
                ? 'لا توجد مستويات لهذا النشاط بعد. اضف مشاركين بدون مستوى أو أنشئ مستويات أولاً.'
                : 'No levels exist for this activity yet. Add participants without a level or create levels first.'}
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              {/* Existing levels for this activity */}
              {tournamentLevels.map(lvl => {
                const parts = groupedParticipants[lvl.id] || [];
                return (
                  <LevelGroup
                    key={lvl.id}
                    label={lvl.custom_name?.trim() || `${language === 'ar' ? 'المستوى' : 'Level'} ${lvl.level_number}`}
                    levelNumber={lvl.level_number}
                    participants={parts}
                    onEdit={openEdit}
                    onRemove={(p) => setRemoveTarget(p)}
                    onPositionChange={quickPositionChange}
                    onCertificate={handleCertificate}
                    language={language}
                  />
                );
              })}
              {/* Participants whose level is missing or unassigned */}
              {Object.keys(groupedParticipants)
                .filter(lid => lid === '__none__' || !tournamentLevels.find(l => l.id === lid))
                .map(lid => (
                  <LevelGroup
                    key={lid}
                    label={getLevelLabel(lid)}
                    participants={groupedParticipants[lid]}
                    onEdit={openEdit}
                    onRemove={(p) => setRemoveTarget(p)}
                    onPositionChange={quickPositionChange}
                    onCertificate={handleCertificate}
                    language={language}
                  />
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Participant Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{language === 'ar' ? 'إضافة مشارك' : 'Add Participant'}</DialogTitle>
            <DialogDescription>
              {language === 'ar'
                ? `الأعضاء النشطون في نشاط "${tournament.activity_name || '-'}"`
                : `Active members in "${tournament.activity_name || '-'}"`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
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
            <div>
              <Label>{language === 'ar' ? 'المستوى' : 'Level'}</Label>
              <Select value={editForm.level_id || '__none__'} onValueChange={(v) => setEditForm({ ...editForm, level_id: v === '__none__' ? '' : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{language === 'ar' ? 'بدون مستوى' : 'No level'}</SelectItem>
                  {tournamentLevels.map(l => (
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
    </Layout>
  );
};

// Reusable level group component
const LevelGroup = ({ label, levelNumber, participants, onEdit, onRemove, onPositionChange, onCertificate, language }) => {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3 pb-2 border-b">
          <div className="flex items-center gap-2">
            <Medal className="w-5 h-5 text-orange-500" />
            <h3 className="font-bold text-lg">{label}</h3>
          </div>
          <Badge variant="outline" className="gap-1">
            <Users className="w-3.5 h-3.5" />
            {participants.length}
          </Badge>
        </div>
        {participants.length === 0 ? (
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
                    <td className="py-2 px-2 font-medium">{p.member_name}</td>
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

export default TournamentsPage;
export { TournamentsPage };
