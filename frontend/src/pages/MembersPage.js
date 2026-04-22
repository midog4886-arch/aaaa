import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
 
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../components/ui/command';
import { Textarea } from '../components/ui/textarea';
import { membersAPI, activitiesAPI, coachesAPI, exportAPI, invoicesAPI, attendanceAPI, levelsAPI, productInvoicesAPI, freezesAPI, tournamentsAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  User,
  Phone,
  Calendar,
  Activity,
  Eye,
  X,
  Loader2,
  Download,
  Receipt,
  Printer,
  RefreshCcw,
  AlertTriangle,
  History,
  Clock,
  CreditCard,
  QrCode,
  ChevronDown,
  Check,
  Filter,
  ShoppingBag,
  Package,
  Snowflake,
  PlayCircle,
  Trophy,
  CheckCircle,
  XCircle
} from 'lucide-react';

export const MembersPage = () => {
  const { t, language } = useLanguage();
  const { selectedBranchId } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [filterActivity, setFilterActivity] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSchedule, setFilterSchedule] = useState('');
  const [activityFilterOpen, setActivityFilterOpen] = useState(false);
  const [isPrintRangeOpen, setIsPrintRangeOpen] = useState(false);
  const [printFromDate, setPrintFromDate] = useState('');
  const [printToDate, setPrintToDate] = useState('');

  const handlePrintMembersRange = () => {
    let list = filteredMembers.slice();
    const from = printFromDate ? new Date(printFromDate + 'T00:00:00') : null;
    const to = printToDate ? new Date(printToDate + 'T23:59:59') : null;
    if (from || to) {
      list = list.filter(m => {
        if (!m.created_at) return false;
        const d = new Date(m.created_at);
        if (Number.isNaN(d.getTime())) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    const printWindow = window.open('', '', 'width=900,height=700');
    if (!printWindow) return;
    const rows = list.map((m, i) => {
      const reg = m.created_at ? new Date(m.created_at).toLocaleDateString('ar-SA') : '-';
      return `<tr><td>${i+1}</td><td>${m.name_ar || m.name || ''}</td><td>${m.age || '-'}</td><td>${m.guardian_name_ar || '-'}</td><td dir="ltr">${m.phone || '-'}</td><td>${m.activities?.map(a => a.activity_name).join(', ') || '-'}</td><td>${m.activities?.map(a => a.status === 'active' ? 'ساري' : 'منتهي').join(', ') || '-'}</td><td>${reg}</td></tr>`;
    }).join('');
    const rangeLabel = (printFromDate || printToDate)
      ? `<p style="text-align:center;color:#444;margin:6px 0 14px;">من ${printFromDate || '...'} إلى ${printToDate || '...'} — العدد: ${list.length}</p>`
      : `<p style="text-align:center;color:#444;margin:6px 0 14px;">العدد: ${list.length}</p>`;
    printWindow.document.write(`<html><head><title>بيانات الأعضاء</title><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');body{font-family:'Tajawal',Arial;direction:rtl;padding:20px}h1{color:#F97316;text-align:center;margin-bottom:6px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:right;font-size:12px}th{background:#F97316;color:white}.footer{text-align:center;margin-top:20px;font-size:11px;color:#666}</style></head><body><h1>شركة اداء الابطال العالمية للرياضة - بيانات الأعضاء</h1>${rangeLabel}<table><thead><tr><th>م</th><th>الاسم</th><th>العمر</th><th>ولي الأمر</th><th>الجوال</th><th>الأنشطة</th><th>الحالة</th><th>تاريخ التسجيل</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SA')}</div></body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 400);
    setIsPrintRangeOpen(false);
  };
  const [activityFilterSearch, setActivityFilterSearch] = useState('');
  const [schedulePopoverOpen, setSchedulePopoverOpen] = useState(false);
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isActivityDialogOpen, setIsActivityDialogOpen] = useState(false);
  const [isRenewalDialogOpen, setIsRenewalDialogOpen] = useState(false);
  const [isMemberCardDialogOpen, setIsMemberCardDialogOpen] = useState(false);
  const [memberCardData, setMemberCardData] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [saving, setSaving] = useState(false);
  const [memberInvoices, setMemberInvoices] = useState([]);
  const [memberProductPurchases, setMemberProductPurchases] = useState([]);
  const [memberAttendance, setMemberAttendance] = useState(null);
  const [memberSessionQuota, setMemberSessionQuota] = useState([]);
  const [expandedQuotaIdx, setExpandedQuotaIdx] = useState(new Set());
  const [registeringDate, setRegisteringDate] = useState(null);
  const [viewTab, setViewTab] = useState('info'); // info, activities, invoices, history, attendance
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [editActivityForm, setEditActivityForm] = useState({});
  const [editActivitySaving, setEditActivitySaving] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [isFreezeDialogOpen, setIsFreezeDialogOpen] = useState(false);
  const [freezeForm, setFreezeForm] = useState({ start_date: '', end_date: '', reason: 'personal' });
  const [memberTournaments, setMemberTournaments] = useState([]);
  const [memberFreezes, setMemberFreezes] = useState([]);
  const [memberFreezeStats, setMemberFreezeStats] = useState(null);
  const [freezeLoading, setFreezeLoading] = useState(false);
  const [renewalActivity, setRenewalActivity] = useState(null);
  const [renewalForm, setRenewalForm] = useState({
    start_date: '',
    end_date: '',
    fee: 0,
    notes: '',
    payment_method: 'cash'
  });

  const [formData, setFormData] = useState({
    name: '',
    name_ar: '',
    age: '',
    guardian_name: '',
    guardian_name_ar: '',
    phone: '',
    email: '',
    notes: '',
    activities: []
  });

  const [activityForm, setActivityForm] = useState({
    activity_id: '',
    start_date: '',
    end_date: '',
    fee: '',
    status: 'active',
    coach_id: '',
    training_days: [],
    training_time: '',
    level_id: '',
    schedule: ''
  });

  // Levels state (lazy-loaded when dialog opens)
  const [levels, setLevels] = useState([]);
  const [levelsLoaded, setLevelsLoaded] = useState(false);
  
  // State for cascading level selector
  const [memberLevelSelectorState, setMemberLevelSelectorState] = useState(null);
  const [editMemberLevelSelectorState, setEditMemberLevelSelectorState] = useState(null);

  // Main activities for level selector
  const MAIN_ACTIVITIES_FOR_LEVELS = [
    { id: 'swimming', name_ar: 'السباحة', name_en: 'Swimming', icon: '🏊', color: 'bg-blue-500' },
    { id: 'football', name_ar: 'كرة القدم', name_en: 'Football', icon: '⚽', color: 'bg-green-500' },
    { id: 'karate', name_ar: 'الكاراتيه', name_en: 'Karate', icon: '🥋', color: 'bg-red-500' },
  ];

  // Parse activity name to get main activity
  const parseActivityForLevel = (activityName) => {
    if (!activityName) return 'other';
    const name = activityName.toLowerCase();
    if (name.includes('سباح') || name.includes('swim')) return 'swimming';
    if (name.includes('كر') || name.includes('foot') || name.includes('قدم')) return 'football';
    if (name.includes('كارات') || name.includes('karate')) return 'karate';
    return 'other';
  };

  // Group levels by main activity and time slot
  const groupedLevelsForSelector = React.useMemo(() => {
    const grouped = {};
    levels.forEach(level => {
      const mainActivity = parseActivityForLevel(level.activity_name);
      if (!grouped[mainActivity]) grouped[mainActivity] = {};
      
      let timeSlot = level.activity_name;
      if (level.activity_name.includes(' - ')) {
        timeSlot = level.activity_name.split(' - ')[1] || level.activity_name;
      }
      
      if (!grouped[mainActivity][timeSlot]) grouped[mainActivity][timeSlot] = [];
      grouped[mainActivity][timeSlot].push(level);
    });
    return grouped;
  }, [levels]);

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  // When the global search (or any link) sends ?focus=<member_id>, open the
  // member's view dialog directly once members are loaded.
  useEffect(() => {
    const focusId = searchParams.get('focus');
    if (!focusId || !members || members.length === 0) return;
    const target = members.find(m => m.id === focusId);
    if (target) {
      openViewDialog(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, searchParams]);

  const loadData = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const [membersRes, activitiesRes, coachesRes, levelsRes] = await Promise.all([
        membersAPI.getAll(branchParams),
        activitiesAPI.getAll(),
        coachesAPI.getAll(),
        levelsAPI.getAll()
      ]);
      setMembers(membersRes.data);
      setActivities(activitiesRes.data);
      setCoaches(coachesRes.data);
      setLevels(levelsRes.data);
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error(t('error'));
    } finally {
      setLoading(false);
    }
  };

  const loadLevels = async () => {
    try {
      const levelsRes = await levelsAPI.getAll();
      setLevels(levelsRes.data);
      setLevelsLoaded(true);
    } catch (error) {
      console.error('Failed to load levels:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const data = {
        ...formData,
        age: parseInt(formData.age) || 0
      };
      
      // If creating new member and activity is selected, add it to activities array
      if (!selectedMember && activityForm.activity_id) {
        const activity = activities.find(a => a.id === activityForm.activity_id);
        
        data.activities = [{
          activity_id: activityForm.activity_id,
          activity_name: language === 'ar' ? (activity?.name_ar || activity?.name || '') : (activity?.name || ''),
          start_date: activityForm.start_date,
          end_date: activityForm.end_date,
          fee: 0, // No fee when adding from members page
          status: 'active',
          coach_id: activityForm.coach_id || '',
          level_id: activityForm.level_id || '',
          schedule: activityForm.schedule || '',
          training_days: activityForm.training_days || [],
          training_time: activityForm.training_time || ''
        }];
      }
      
      let memberId = selectedMember?.id;
      
      if (selectedMember) {
        await membersAPI.update(selectedMember.id, data);
        toast.success(t('success'));
      } else {
        const response = await membersAPI.create(data);
        memberId = response.data.id;
        toast.success(t('success'));
        
        // If level was selected, add member to level
        if (activityForm.level_id && memberId) {
          try {
            await levelsAPI.addMember(activityForm.level_id, memberId);
          } catch (levelError) {
            console.error('Error adding member to level:', levelError);
          }
        }
      }
      
      loadData();
      closeDialog();
      
      // Reset activity form
      setActivityForm({
        activity_id: '',
        start_date: '',
        end_date: '',
        fee: '',
        status: 'active',
        coach_id: '',
        training_days: [],
        training_time: '',
        level_id: '',
        schedule: ''
      });
      setMemberLevelSelectorState(null);
    } catch (error) {
      console.error('Failed to save member:', error);
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  const DELETE_MEMBER_PASSWORD = '242456';

  const handleDelete = async (id) => {
    const password = window.prompt(language === 'ar' ? 'أدخل كلمة المرور لحذف العضو:' : 'Enter password to delete member:');
    if (password !== DELETE_MEMBER_PASSWORD) {
      toast.error(language === 'ar' ? 'كلمة المرور غير صحيحة' : 'Incorrect password');
      return;
    }
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من الحذف نهائياً؟' : 'Are you sure you want to permanently delete?')) {
      return;
    }
    
    try {
      await membersAPI.delete(id);
      toast.success(t('success'));
      loadData();
    } catch (error) {
      console.error('Failed to delete member:', error);
      toast.error(t('error'));
    }
  };

  const handleAddActivity = async () => {
    if (!selectedMember || !activityForm.activity_id) return;
    
    setSaving(true);
    try {
      const activity = activities.find(a => a.id === activityForm.activity_id);
      const activityData = {
        ...activityForm,
        activity_name: language === 'ar' ? activity?.name_ar : activity?.name,
        fee: parseFloat(activityForm.fee) || activity?.monthly_fee || 0
      };
      
      await membersAPI.addActivity(selectedMember.id, activityData);
      toast.success(t('success'));
      loadData();
      setIsActivityDialogOpen(false);
      setActivityForm({
        activity_id: '',
        start_date: '',
        end_date: '',
        fee: '',
        status: 'active',
        coach_id: ''
      });
      
      // Refresh selected member
      const updated = await membersAPI.getById(selectedMember.id);
      setSelectedMember(updated.data);
    } catch (error) {
      console.error('Failed to add activity:', error);
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  // Save edited activity directly (without invoice)
  const handleSaveEditActivity = async () => {
    if (!selectedMember || !editingActivityId) return;
    setEditActivitySaving(true);
    try {
      const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const formatSchedule = (days, time) => {
        if (!days || days.length === 0) return time || '';
        const sorted = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
        let daysStr;
        if (sorted.length === 1) { daysStr = sorted[0]; }
        else { const last = sorted.pop(); daysStr = sorted.join('، ') + ' و ' + last; }
        return time ? `${daysStr} - ${time}` : daysStr;
      };

      // Find the original activity to detect level change
      const originalActivity = (selectedMember.activities || []).find(a => a.activity_id === editingActivityId);
      const oldLevelId = originalActivity?.level_id || '';
      const newLevelId = editActivityForm.level_id || '';

      const payload = {
        ...editActivityForm,
        fee: parseFloat(editActivityForm.fee) || 0,
        schedule: formatSchedule(editActivityForm.training_days || [], editActivityForm.training_time || '')
      };
      await membersAPI.updateActivity(selectedMember.id, editingActivityId, payload);

      // Handle level change: remove from old level, add to new level
      if (oldLevelId !== newLevelId) {
        try {
          if (oldLevelId) await levelsAPI.removeMember(oldLevelId, selectedMember.id);
          if (newLevelId) await levelsAPI.addMember(newLevelId, selectedMember.id);
        } catch (lvlErr) {
          console.warn('Level update warning:', lvlErr);
        }
      }

      toast.success(language === 'ar' ? 'تم تحديث النشاط' : 'Activity updated');
      const updated = await membersAPI.getById(selectedMember.id);
      setSelectedMember(updated.data);
      setEditingActivityId(null);
      setEditActivityForm({});
      setEditMemberLevelSelectorState(null);
    } catch (err) {
      console.error(err);
      toast.error(language === 'ar' ? 'فشل التحديث' : 'Update failed');
    } finally {
      setEditActivitySaving(false);
    }
  };

  // Save notes directly from member view dialog
  const handleSaveNotes = async () => {
    if (!selectedMember) return;
    setNotesSaving(true);
    try {
      await membersAPI.update(selectedMember.id, { notes: notesValue });
      const updated = await membersAPI.getById(selectedMember.id);
      setSelectedMember(updated.data);
      setEditingNotes(false);
      toast.success(language === 'ar' ? 'تم حفظ الملاحظات' : 'Notes saved');
    } catch {
      toast.error(language === 'ar' ? 'فشل الحفظ' : 'Save failed');
    } finally {
      setNotesSaving(false);
    }
  };

  // Open member card dialog
  const openMemberCardDialog = (member) => {
    setMemberCardData(member);
    setIsMemberCardDialogOpen(true);
  };

  // Print member card
  const printMemberCard = () => {
    if (!memberCardData) return;
    
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;
    
    const qrData = `${memberCardData.member_code || memberCardData.id}`;

    // Get first activity dates
    const firstActivity = (memberCardData.activities || [])[0];
    const startDate = firstActivity?.start_date || '';
    const endDate = firstActivity?.end_date || '';
    const schedule = firstActivity?.schedule || '';

    // Build activities HTML
    const activitiesHtml = (memberCardData.activities || []).map(act => {
      const isActive = !act.end_date || new Date(act.end_date) >= new Date();
      const actSchedule = act.schedule || '';
      return `
        <div class="activity-item ${isActive ? 'active' : 'expired'}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div class="activity-name">${isActive ? '✓' : '✗'} ${act.activity_name || ''}</div>
            <div class="activity-status">${isActive ? 'ساري' : 'منتهي'}</div>
          </div>
          ${actSchedule ? `<div class="activity-schedule">📅 ${actSchedule}</div>` : ''}
        </div>
      `;
    }).join('');

    const memberName = (memberCardData.name_ar || memberCardData.name || '').split('+').map(n => `<div>${n.trim()}</div>`).join('');
    const origin = window.location.origin;

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>بطاقة العضوية - ${memberCardData.member_code}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
            @page { size: A4; margin: 0mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Tajawal', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
            .screen-only { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
            @media print { .screen-only { display: none !important; } .print-area { display: flex !important; position: absolute; top: 10mm; right: 10mm; gap: 5mm; } }
            @media screen { .print-area { display: none; } }
            .sticker-preview { display: flex; gap: 15px; justify-content: center; margin-bottom: 20px; }
            .card { width: 90mm; height: 60mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
            .card-header { background: linear-gradient(135deg, #F97316, #F59E0B); padding: 1.5mm 2mm; display: flex; justify-content: space-between; align-items: center; color: white; }
            .header-text h2 { font-size: 7pt; font-weight: 700; margin: 0; line-height: 1.3; }
            .header-text p { font-size: 5.5pt; opacity: 0.9; margin: 0; }
            .header-logo { width: 10mm; height: 10mm; border-radius: 50%; background: white; padding: 0.5mm; display: flex; align-items: center; justify-content: center; }
            .header-logo img { width: 100%; height: 100%; object-fit: contain; border-radius: 50%; }
            .card-body { padding: 2mm; display: flex; gap: 2mm; flex: 1; }
            .info-section { flex: 1; text-align: right; overflow: hidden; }
            .qr-container { display: flex; flex-direction: column; align-items: center; }
            .qr-section { width: 26mm; height: 26mm; background: white; border: 1px solid #eee; border-radius: 2mm; padding: 0.5mm; }
            .qr-section img { width: 100%; height: 100%; }
            .qr-dates { text-align: center; font-size: 8pt; color: #1f2937; margin-top: 1mm; line-height: 1.4; font-weight: 700; }
            .qr-dates span { display: block; }
            .schedule-info { text-align: center; font-size: 6pt; color: #F97316; margin-top: 1mm; font-weight: 600; background: #FFF7ED; padding: 1mm; border-radius: 2mm; }
            .member-name { font-size: 10pt; font-weight: 700; color: #1f2937; margin-bottom: 1mm; line-height: 1.4; }
            .info-label { color: #6b7280; font-size: 6pt; }
            .info-row { display: flex; align-items: center; gap: 1mm; margin-bottom: 0.8mm; font-size: 7pt; }
            .member-code { color: #F97316; font-weight: 700; font-size: 10pt; }
            .activities { margin-top: 1mm; padding-top: 1mm; border-top: 1px dashed #e5e7eb; }
            .activities-label { font-size: 6pt; color: #6b7280; margin-bottom: 0.5mm; }
            .activity-item { padding: 1mm 1.5mm; margin-bottom: 0.5mm; border-radius: 1.5mm; font-size: 6pt; }
            .activity-item.active { background: #D1FAE5; border-right: 2px solid #10B981; }
            .activity-item.expired { background: #FEE2E2; border-right: 2px solid #EF4444; }
            .activity-name { font-weight: 600; color: #1f2937; font-size: 7pt; }
            .activity-status { font-size: 6pt; font-weight: 700; }
            .activity-item.active .activity-status { color: #059669; }
            .activity-item.expired .activity-status { color: #DC2626; }
            .activity-schedule { font-size: 5.5pt; color: #2563EB; margin-top: 0.3mm; font-weight: 500; }
            .card-footer { text-align: right; padding: 1.5mm 2mm; background: #f9fafb; font-size: 5pt; color: #374151; border-top: 1px dashed #e5e7eb; line-height: 1.4; }
            .card-footer .terms-title { font-weight: 700; color: #1f2937; font-size: 6pt; margin-bottom: 0.5mm; }
            .logo-card { width: 90mm; height: 60mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3mm; }
            .logo-card img { max-width: 100%; max-height: 55%; object-fit: contain; }
            .logo-card .lost-card-notice { font-size: 7pt; color: #DC2626; text-align: center; margin-top: 2mm; font-weight: 700; line-height: 1.5; background: #FEF2F2; padding: 2mm 3mm; border-radius: 2mm; border: 1.5px solid #EF4444; }
            .logo-card .contact-info { font-size: 7pt; color: #374151; text-align: center; margin-top: 2mm; font-weight: 600; line-height: 1.6; }
            .print-btn { margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #F97316, #EA580C); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal', Arial, sans-serif; font-size: 16px; font-weight: bold; }
            .position-labels { display: flex; gap: 15px; justify-content: center; margin-top: 10px; }
            .position-label { padding: 8px 16px; background: #FEF3C7; border-radius: 8px; color: #92400E; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="screen-only">
            <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة الطباعة - كرت العضوية + شعار الأكاديمية</p>
            <div class="sticker-preview">
              <div class="card">
                <div class="card-header">
                  <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
                  <div class="header-logo"><img src="${origin}/images/academy-logo.png" alt="logo" /></div>
                </div>
                <div class="card-body">
                  <div class="qr-container">
                    <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
                    <div class="qr-dates">
                      <span>من: ${startDate || '----'}</span>
                      <span>إلى: ${endDate || '----'}</span>
                    </div>
                    ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
                  </div>
                  <div class="info-section">
                    <div class="info-label">الاسم</div>
                    <div class="member-name">${memberName}</div>
                    <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${memberCardData.member_code || ''}</span></div>
                    <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${memberCardData.phone || '-'}</span></div>
                    ${(memberCardData.guardian_name_ar || memberCardData.guardian_name) ? `<div class="info-row"><span class="info-label">ولي الأمر:</span><span>${memberCardData.guardian_name_ar || memberCardData.guardian_name}</span></div>` : ''}
                    ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                  </div>
                </div>
                <div class="card-footer">
                  <div class="terms-title">شروط وأحكام:</div>
                  <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                  <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
                </div>
              </div>
              <div class="logo-card">
                <img src="${origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
                <div class="contact-info">📞 0566238384</div>
                <div class="lost-card-notice">⚠️ في حال فقدان كرت العضوية،<br/>يتم إصدار كرت جديد برسوم 10 ر.س</div>
              </div>
            </div>
            <div class="position-labels">
              <div class="position-label">📍 خانة 1: كرت العضوية</div>
              <div class="position-label">📍 خانة 2: شعار الأكاديمية</div>
            </div>
            <p style="margin-top: 10px; color: #6b7280; font-size: 14px;">📐 حجم كل كرت: 9سم × 6سم</p>
            <button class="print-btn" onclick="window.print()">🖨️ طباعة الملصقات</button>
          </div>
          <div class="print-area">
            <div class="card">
              <div class="card-header">
                <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
                <div class="header-logo"><img src="${origin}/images/academy-logo.png" alt="logo" /></div>
              </div>
              <div class="card-body">
                <div class="qr-container">
                  <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
                  <div class="qr-dates">
                    <span>من: ${startDate || '----'}</span>
                    <span>إلى: ${endDate || '----'}</span>
                  </div>
                </div>
                <div class="info-section">
                  <div class="info-label">الاسم</div>
                  <div class="member-name">${memberName}</div>
                  <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${memberCardData.member_code || ''}</span></div>
                  <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${memberCardData.phone || '-'}</span></div>
                  ${(memberCardData.guardian_name_ar || memberCardData.guardian_name) ? `<div class="info-row"><span class="info-label">ولي الأمر:</span><span>${memberCardData.guardian_name_ar || memberCardData.guardian_name}</span></div>` : ''}
                  ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                </div>
              </div>
              <div class="card-footer">
                <div class="terms-title">شروط وأحكام:</div>
                <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
              </div>
            </div>
            <div class="logo-card">
              <img src="${origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
              <div class="contact-info">📞 0566238384</div>
              <div class="lost-card-notice">⚠️ في حال فقدان كرت العضوية،<br/>يتم إصدار كرت جديد برسوم 10 ر.س</div>
            </div>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  const openEditDialog = (member) => {
    setSelectedMember(member);
    setFormData({
      name: member.name || '',
      name_ar: member.name_ar || '',
      age: member.age?.toString() || '',
      guardian_name: member.guardian_name || '',
      guardian_name_ar: member.guardian_name_ar || '',
      phone: member.phone || '',
      email: member.email || '',
      notes: member.notes || '',
      activities: member.activities || []
    });
    setIsAddDialogOpen(true);
    loadLevels();
  };

  const ARABIC_DAY_TO_JS = {
    'الأحد': 0, 'الاحد': 0,
    'الإثنين': 1, 'الاثنين': 1,
    'الثلاثاء': 2,
    'الأربعاء': 3, 'الاربعاء': 3,
    'الخميس': 4,
    'الجمعة': 5,
    'السبت': 6
  };

  const localDateStr = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const generateScheduleDates = (start_date, end_date, schedule_days_arabic) => {
    if (!start_date || !end_date || !schedule_days_arabic?.length) return [];
    const targetDays = schedule_days_arabic
      .map(d => ARABIC_DAY_TO_JS[d])
      .filter(n => n !== undefined);
    if (!targetDays.length) return [];
    const [sy, sm, sd] = start_date.split('-').map(Number);
    const [ey, em, ed] = end_date.split('-').map(Number);
    const end = new Date(ey, em - 1, ed);
    const cur = new Date(sy, sm - 1, sd);
    const dates = [];
    while (cur <= end) {
      if (targetDays.includes(cur.getDay())) {
        dates.push(localDateStr(cur));
      }
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  };

  const refreshMemberAttendance = async (memberId) => {
    try {
      const [attendanceRes, quotaRes] = await Promise.all([
        attendanceAPI.getMemberReport(memberId),
        attendanceAPI.getSessionQuota(memberId)
      ]);
      setMemberAttendance(attendanceRes.data);
      setMemberSessionQuota(Array.isArray(quotaRes.data) ? quotaRes.data : []);
    } catch (e) {
      console.error('Failed to refresh attendance:', e);
    }
  };

  const handleRegisterDateAttendance = async (memberId, activityId, date) => {
    const key = `${activityId}_${date}`;
    setRegisteringDate(key);
    try {
      await attendanceAPI.record({ member_id: memberId, activity_id: activityId, date, notes: 'تسجيل يدوي' });
      await refreshMemberAttendance(memberId);
    } catch (e) {
      const msg = e?.response?.data?.detail || (language === 'ar' ? 'فشل تسجيل الحضور' : 'Failed to record attendance');
      toast.error(msg);
    } finally {
      setRegisteringDate(null);
    }
  };

  const openViewDialog = async (member) => {
    setSelectedMember(member);
    setViewTab('info');
    setExpandedQuotaIdx(new Set());
    setIsViewDialogOpen(true);
    setMemberAttendance(null);
    setMemberProductPurchases([]);
    setMemberSessionQuota([]);
    setMemberTournaments([]);
    try {
      const [invoicesRes, attendanceRes, productInvRes, quotaRes, tournamentsRes] = await Promise.all([
        invoicesAPI.getAll({ member_id: member.id }),
        attendanceAPI.getMemberReport(member.id),
        productInvoicesAPI.getAll({ member_id: member.id }),
        attendanceAPI.getSessionQuota(member.id),
        tournamentsAPI.getByMember(member.id).catch(() => ({ data: [] }))
      ]);
      setMemberInvoices(invoicesRes.data);
      setMemberAttendance(attendanceRes.data);
      setMemberProductPurchases(Array.isArray(productInvRes.data) ? productInvRes.data : []);
      setMemberSessionQuota(Array.isArray(quotaRes.data) ? quotaRes.data : []);
      setMemberTournaments(Array.isArray(tournamentsRes.data) ? tournamentsRes.data : []);
    } catch (error) {
      console.error('Failed to load member data:', error);
      setMemberInvoices([]);
      setMemberAttendance(null);
      setMemberProductPurchases([]);
      setMemberSessionQuota([]);
    }
    try {
      const [freezesRes, statsRes] = await Promise.all([
        freezesAPI.getMemberFreezes(member.id),
        freezesAPI.getMemberStats(member.id)
      ]);
      setMemberFreezes(freezesRes.data);
      setMemberFreezeStats(statsRes.data);
    } catch (e) {}
  };

  const closeDialog = () => {
    setIsAddDialogOpen(false);
    setSelectedMember(null);
    setFormData({
      name: '',
      name_ar: '',
      age: '',
      guardian_name: '',
      guardian_name_ar: '',
      phone: '',
      email: '',
      notes: '',
      activities: []
    });
  };

  const openFreezeDialog = async (member) => {
    setSelectedMember(member);
    setFreezeForm({ start_date: new Date().toISOString().split('T')[0], end_date: '', reason: 'personal' });
    setIsFreezeDialogOpen(true);
    try {
      const [freezesRes, statsRes] = await Promise.all([
        freezesAPI.getMemberFreezes(member.id),
        freezesAPI.getMemberStats(member.id)
      ]);
      setMemberFreezes(freezesRes.data);
      setMemberFreezeStats(statsRes.data);
    } catch (err) {
      console.error('Failed to load freeze data:', err);
    }
  };

  const handleCreateFreeze = async () => {
    if (!selectedMember || !freezeForm.start_date || !freezeForm.end_date) {
      toast.error(language === 'ar' ? 'يرجى تعبئة جميع الحقول' : 'Please fill all fields');
      return;
    }
    setFreezeLoading(true);
    try {
      await freezesAPI.create({
        member_id: selectedMember.id,
        start_date: freezeForm.start_date,
        end_date: freezeForm.end_date,
        reason: freezeForm.reason
      });
      toast.success(language === 'ar' ? 'تم تجميد العضوية بنجاح' : 'Membership frozen successfully');
      const [freezesRes, statsRes] = await Promise.all([
        freezesAPI.getMemberFreezes(selectedMember.id),
        freezesAPI.getMemberStats(selectedMember.id)
      ]);
      setMemberFreezes(freezesRes.data);
      setMemberFreezeStats(statsRes.data);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || (language === 'ar' ? 'فشل في تجميد العضوية' : 'Failed to freeze membership'));
    } finally {
      setFreezeLoading(false);
    }
  };

  const handleCancelFreeze = async (freezeId) => {
    try {
      await freezesAPI.cancel(freezeId);
      toast.success(language === 'ar' ? 'تم إلغاء التجميد' : 'Freeze cancelled');
      if (selectedMember) {
        const [freezesRes, statsRes] = await Promise.all([
          freezesAPI.getMemberFreezes(selectedMember.id),
          freezesAPI.getMemberStats(selectedMember.id)
        ]);
        setMemberFreezes(freezesRes.data);
        setMemberFreezeStats(statsRes.data);
      }
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || (language === 'ar' ? 'فشل في إلغاء التجميد' : 'Failed to cancel freeze'));
    }
  };

  const getReasonLabel = (reason) => {
    const reasons = {
      travel: language === 'ar' ? 'سفر' : 'Travel',
      medical: language === 'ar' ? 'ظرف صحي' : 'Medical',
      personal: language === 'ar' ? 'ظرف شخصي' : 'Personal',
      other: language === 'ar' ? 'أخرى' : 'Other'
    };
    return reasons[reason] || reason;
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      active: { label: t('status_active'), class: 'status-active' },
      expired: { label: t('status_expired'), class: 'status-expired' },
      frozen: { label: t('status_frozen'), class: 'status-frozen' },
      pending: { label: t('status_pending'), class: 'status-pending' }
    };
    const { label, class: className } = statusMap[status] || statusMap.active;
    return <Badge className={className}>{label}</Badge>;
  };

  // Get overall member status based on activities and end dates
  const getMemberOverallStatus = (member) => {
    const activities = member.activities || [];
    if (activities.length === 0) {
      return { status: 'no_activity', label: language === 'ar' ? 'بدون نشاط' : 'No Activity', class: 'bg-gray-100 text-gray-600 border-gray-300' };
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Check each activity's end_date to determine status
    const hasActiveActivity = activities.some(a => {
      if (!a.end_date) return a.status === 'active';
      const endDate = new Date(a.end_date);
      endDate.setHours(0, 0, 0, 0);
      return endDate >= today;
    });
    
    const allExpired = activities.every(a => {
      if (!a.end_date) return a.status === 'expired';
      const endDate = new Date(a.end_date);
      endDate.setHours(0, 0, 0, 0);
      return endDate < today;
    });
    
    if (hasActiveActivity) {
      return { status: 'active', label: language === 'ar' ? 'نشط' : 'Active', class: 'bg-green-100 text-green-700 border-green-300' };
    } else if (allExpired) {
      return { status: 'expired', label: language === 'ar' ? 'منتهي' : 'Expired', class: 'bg-red-100 text-red-700 border-red-300' };
    } else {
      return { status: 'inactive', label: language === 'ar' ? 'غير نشط' : 'Inactive', class: 'bg-gray-100 text-gray-600 border-gray-300' };
    }
  };

  // Get activity status based on end date
  const getActivityStatusFromDate = (activity) => {
    if (!activity.end_date) return activity.status;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(activity.end_date);
    endDate.setHours(0, 0, 0, 0);
    return endDate >= today ? 'active' : 'expired';
  };

  // Calculate days remaining for activity
  const getDaysRemaining = (endDate) => {
    if (!endDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    const diffTime = end - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Check if activity needs renewal (7 days or less)
  const needsRenewal = (activity) => {
    const days = getDaysRemaining(activity.end_date);
    return days !== null && days <= 7;
  };

  // Open renewal dialog
  const openRenewalDialog = (activity) => {
    const endDate = new Date(activity.end_date);
    const newStartDate = new Date(endDate);
    newStartDate.setDate(newStartDate.getDate() + 1);
    const newEndDate = new Date(newStartDate);
    newEndDate.setMonth(newEndDate.getMonth() + 1);
    
    setRenewalActivity(activity);
    setRenewalForm({
      start_date: newStartDate.toISOString().split('T')[0],
      end_date: newEndDate.toISOString().split('T')[0],
      fee: activity.fee || 0,
      notes: '',
      payment_method: 'cash'
    });
    setIsRenewalDialogOpen(true);
  };

  // Handle renewal submission
  const handleRenewal = async () => {
    if (!selectedMember || !renewalActivity) return;
    setSaving(true);
    
    try {
      // Calculate invoice totals
      const subtotal = parseFloat(renewalForm.fee);
      const vatAmount = Math.round(subtotal * 0.15 * 100) / 100;
      const total = Math.round((subtotal + vatAmount) * 100) / 100;
      
      // Create invoice for renewal
      const invoiceData = {
        member_id: selectedMember.id,
        customer_name_ar: selectedMember.name_ar,
        customer_name: selectedMember.name,
        customer_phone: selectedMember.phone,
        items: [{
          activity_id: renewalActivity.activity_id,
          activity_name: renewalActivity.activity_name,
          fee: parseFloat(renewalForm.fee),
          period: `${renewalForm.start_date} - ${renewalForm.end_date}`,
          start_date: renewalForm.start_date,
          end_date: renewalForm.end_date,
          schedule: '',
          is_product: false
        }],
        subtotal: subtotal,
        vat: vatAmount,
        total: total,
        discount: 0,
        status: 'paid',
        payment_method: renewalForm.payment_method,
        notes: renewalForm.notes || `تجديد اشتراك ${renewalActivity.activity_name}`
      };
      
      const invoiceRes = await invoicesAPI.create(invoiceData);
      
      // Add new activity period to member (keeping the old one as history)
      const newActivityPeriod = {
        activity_id: renewalActivity.activity_id,
        activity_name: renewalActivity.activity_name,
        start_date: renewalForm.start_date,
        end_date: renewalForm.end_date,
        fee: parseFloat(renewalForm.fee),
        status: 'active',
        coach_id: renewalActivity.coach_id || '',
        invoice_id: invoiceRes.data.id,
        renewed_from: renewalActivity.end_date
      };
      
      await membersAPI.addActivity(selectedMember.id, newActivityPeriod);
      
      toast.success(language === 'ar' ? 'تم تجديد الاشتراك بنجاح' : 'Subscription renewed successfully');
      setIsRenewalDialogOpen(false);
      
      // Refresh member data
      const updatedMember = await membersAPI.getById(selectedMember.id);
      setSelectedMember(updatedMember.data);
      
      // Refresh invoices
      const invoicesRes = await invoicesAPI.getAll({ member_id: selectedMember.id });
      setMemberInvoices(invoicesRes.data);
      
      // Refresh members list
      loadData();
      
    } catch (error) {
      console.error('Renewal error:', error);
      const errorMsg = error.response?.data?.detail;
      const displayError = typeof errorMsg === 'string' ? errorMsg : (language === 'ar' ? 'حدث خطأ في التجديد' : 'Renewal failed');
      toast.error(displayError);
    } finally {
      setSaving(false);
    }
  };

  // Get subscription history for an activity
  const getActivityHistory = (activityId) => {
    if (!selectedMember?.activities) return [];
    return selectedMember.activities
      .filter(a => a.activity_id === activityId)
      .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
  };

  const ACTIVITY_ICON_MAP = {
    'سباح': '🏊', 'swim': '🏊',
    'كرة': '⚽', 'football': '⚽', 'كرة قدم': '⚽',
    'كارات': '🥋', 'karate': '🥋',
    'جمباز': '🤸', 'gymnast': '🤸',
    'تنس': '🎾', 'tennis': '🎾',
    'سلة': '🏀', 'basket': '🏀',
    'طائرة': '🏐', 'volley': '🏐',
    'ملاكمة': '🥊', 'box': '🥊',
    'تايكوندو': '🥋', 'taekwondo': '🥋',
    'جودو': '🥋', 'judo': '🥋',
  };

  const getActivityIcon = (name) => {
    if (!name) return '🏅';
    const lower = name.toLowerCase();
    for (const [key, icon] of Object.entries(ACTIVITY_ICON_MAP)) {
      if (lower.includes(key)) return icon;
    }
    return '🏅';
  };

  const getActivityGroupKey = (name) => {
    if (!name) return 'other';
    const lower = name.toLowerCase();
    if (lower.includes('سباح') || lower.includes('swim')) return 'swimming';
    if (lower.includes('كرة') || lower.includes('football') || lower.includes('كرة قدم')) return 'football';
    if (lower.includes('كارات') || lower.includes('karate')) return 'karate';
    if (lower.includes('جمباز') || lower.includes('gymnast')) return 'gymnastics';
    return 'other';
  };

  const GROUP_INFO = {
    swimming: { label_ar: '🏊 السباحة', label_en: '🏊 Swimming', order: 1 },
    football: { label_ar: '⚽ كرة القدم', label_en: '⚽ Football', order: 2 },
    karate: { label_ar: '🥋 الكاراتيه', label_en: '🥋 Karate', order: 3 },
    gymnastics: { label_ar: '🤸 الجمباز', label_en: '🤸 Gymnastics', order: 4 },
    other: { label_ar: '🏅 أخرى', label_en: '🏅 Other', order: 5 },
  };

  const groupedActivities = useMemo(() => {
    const groups = {};
    const memberSets = {};
    members.forEach(m => {
      const seen = new Set();
      (m.activities || []).forEach(a => {
        if (a.activity_id && !seen.has(a.activity_id)) {
          seen.add(a.activity_id);
          if (!memberSets[a.activity_id]) memberSets[a.activity_id] = 0;
          memberSets[a.activity_id]++;
        }
      });
    });

    activities.forEach(act => {
      const name = act.name_ar || act.name || '';
      const groupKey = getActivityGroupKey(name);
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push({
        ...act,
        icon: getActivityIcon(name),
        memberCount: memberSets[act.id] || 0
      });
    });

    return Object.entries(groups)
      .sort(([a], [b]) => (GROUP_INFO[a]?.order || 99) - (GROUP_INFO[b]?.order || 99))
      .map(([key, items]) => ({
        key,
        label: language === 'ar' ? GROUP_INFO[key]?.label_ar : GROUP_INFO[key]?.label_en,
        items: items.filter(item => {
          if (!activityFilterSearch) return true;
          const s = activityFilterSearch.toLowerCase();
          return (item.name_ar || '').toLowerCase().includes(s) || (item.name || '').toLowerCase().includes(s);
        })
      }))
      .filter(g => g.items.length > 0);
  }, [activities, members, language, activityFilterSearch]);

  const selectedActivityLabel = useMemo(() => {
    if (filterActivity === 'all') return language === 'ar' ? 'الأنشطة' : 'Activities';
    if (filterActivity.startsWith('group:')) {
      const groupKey = filterActivity.replace('group:', '');
      const info = GROUP_INFO[groupKey];
      return info ? (language === 'ar' ? info.label_ar : info.label_en) : filterActivity;
    }
    const act = activities.find(a => a.id === filterActivity);
    if (!act) return language === 'ar' ? 'الأنشطة' : 'Activities';
    const name = language === 'ar' ? (act.name_ar || act.name) : (act.name || act.name_ar);
    const icon = getActivityIcon(act.name_ar || act.name || '');
    return `${icon} ${name}`;
  }, [filterActivity, activities, language]);

  const getActivityColor = (activityName) => {
    const colorMap = {
      'السباحة': 'activity-swimming',
      'Swimming': 'activity-swimming',
      'كرة القدم': 'activity-football',
      'Football': 'activity-football',
      'الكاراتيه': 'activity-karate',
      'Karate': 'activity-karate',
      'الجمباز': 'activity-gymnastics',
      'Gymnastics': 'activity-gymnastics',
    };
    return colorMap[activityName] || '';
  };

  // Build unique schedule options filtered by current activity selection
  const scheduleOptions = useMemo(() => {
    const times = new Set();
    members.forEach(m => {
      (m.activities || []).forEach(a => {
        if (!a.schedule) return;
        if (filterActivity !== 'all') {
          if (filterActivity.startsWith('group:')) {
            const act = activities.find(ac => ac.id === a.activity_id);
            if (!act) return;
            if (getActivityGroupKey(act.name_ar || act.name || '') !== filterActivity.replace('group:', '')) return;
          } else {
            if (a.activity_id !== filterActivity) return;
          }
        }
        times.add(a.schedule);
      });
    });
    return [...times].sort();
  }, [members, filterActivity, activities]);

  const filteredMembers = members.filter(member => {
    const matchesSearch = 
      member.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.name_ar?.includes(searchTerm) ||
      member.member_code?.includes(searchTerm) ||
      member.phone?.includes(searchTerm);
    
    const matchesActivity = filterActivity === 'all' || 
      (filterActivity.startsWith('group:') ? 
        member.activities?.some(a => {
          const act = activities.find(ac => ac.id === a.activity_id);
          if (!act) return false;
          return getActivityGroupKey(act.name_ar || act.name || '') === filterActivity.replace('group:', '');
        }) :
        member.activities?.some(a => a.activity_id === filterActivity));
    
    const matchesStatus = filterStatus === 'all' ||
      member.activities?.some(a => {
        const actStatus = a.end_date ? (new Date(a.end_date) >= new Date(new Date().setHours(0,0,0,0)) ? 'active' : 'expired') : a.status;
        return actStatus === filterStatus;
      });

    const matchesSchedule = !filterSchedule ||
      member.activities?.some(a => (a.schedule || '') === filterSchedule);
    
    return matchesSearch && matchesActivity && matchesStatus && matchesSchedule;
  });

  if (loading) {
    return (
      <Layout title={t('members')}>
        <div className="flex items-center justify-center h-64">
          <div className="spinner" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('members')}>
      <div className="space-y-6" data-testid="members-page">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('search')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-10"
                data-testid="search-members-input"
              />
            </div>
            <Popover open={activityFilterOpen} onOpenChange={(open) => { setActivityFilterOpen(open); if (!open) setActivityFilterSearch(''); }}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full sm:w-[200px] justify-between text-sm font-normal"
                  data-testid="filter-activity-select"
                >
                  <span className="truncate">{selectedActivityLabel}</span>
                  <ChevronDown className={`w-4 h-4 ms-1 shrink-0 opacity-50 transition-transform ${activityFilterOpen ? 'rotate-180' : ''}`} />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-0" align="start">
                <div className="p-2 border-b">
                  <div className="relative">
                    <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none rtl:right-2.5 ltr:left-2.5 ltr:right-auto" />
                    <Input
                      placeholder={language === 'ar' ? 'بحث في الأنشطة...' : 'Search activities...'}
                      value={activityFilterSearch}
                      onChange={e => setActivityFilterSearch(e.target.value)}
                      className="h-8 ps-8 text-sm"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  <button
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${filterActivity === 'all' ? 'bg-primary/5 text-primary font-medium' : ''}`}
                    onClick={() => { setFilterActivity('all'); setFilterSchedule(''); setActivityFilterOpen(false); setActivityFilterSearch(''); }}
                  >
                    {filterActivity === 'all' && <Check className="w-4 h-4 text-primary shrink-0" />}
                    <Filter className={`w-4 h-4 shrink-0 ${filterActivity === 'all' ? '' : 'ms-6'} opacity-50`} />
                    <span>{language === 'ar' ? 'كل الأنشطة' : 'All Activities'}</span>
                    <Badge variant="secondary" className="ms-auto text-[10px] px-1.5">{activities.length}</Badge>
                  </button>
                  <div className="border-t" />
                  {groupedActivities.map(group => {
                    const groupTotal = group.items.reduce((sum, a) => sum + (a.memberCount || 0), 0);
                    const isGroupSelected = filterActivity === `group:${group.key}`;
                    return (
                    <div key={group.key}>
                      <button
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-bold hover:bg-blue-50 transition-colors sticky top-0 ${isGroupSelected ? 'bg-primary/10 text-primary' : 'bg-gray-50 text-gray-700'}`}
                        onClick={() => { setFilterActivity(`group:${group.key}`); setFilterSchedule(''); setActivityFilterOpen(false); setActivityFilterSearch(''); }}
                      >
                        {isGroupSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
                        <span className={isGroupSelected ? '' : 'ms-6'}>{group.label}</span>
                        <Badge variant="secondary" className="ms-auto text-[10px] px-1.5">{groupTotal}</Badge>
                      </button>
                      {group.items.map(act => (
                        <button
                          key={act.id}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${filterActivity === act.id ? 'bg-primary/5 text-primary font-medium' : ''}`}
                          onClick={() => { setFilterActivity(act.id); setFilterSchedule(''); setActivityFilterOpen(false); setActivityFilterSearch(''); }}
                        >
                          {filterActivity === act.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                          <span className={`text-base ${filterActivity === act.id ? '' : 'ms-6'}`}>{act.icon}</span>
                          <span className="flex-1 text-start truncate">{language === 'ar' ? (act.name_ar || act.name) : (act.name || act.name_ar)}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">
                            {act.memberCount}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  );})}
                  {groupedActivities.length === 0 && activityFilterSearch && (
                    <div className="p-4 text-center text-sm text-gray-400">
                      {language === 'ar' ? 'لا توجد نتائج' : 'No results'}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <div className="flex gap-1 items-center border rounded-lg p-1">
              <button
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filterStatus === 'all' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {language === 'ar' ? 'الكل' : 'All'}
              </button>
              <button
                onClick={() => setFilterStatus('active')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filterStatus === 'active' ? 'bg-green-600 text-white' : 'text-green-700 hover:bg-green-50'}`}
              >
                {language === 'ar' ? 'ساري' : 'Active'}
              </button>
              <button
                onClick={() => setFilterStatus('expired')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filterStatus === 'expired' ? 'bg-red-600 text-white' : 'text-red-700 hover:bg-red-50'}`}
              >
                {language === 'ar' ? 'منتهي' : 'Expired'}
              </button>
            </div>

            {/* Schedule Combobox */}
            <Popover open={schedulePopoverOpen} onOpenChange={setSchedulePopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1 max-w-[180px]">
                  <span className="truncate">{filterSchedule || (language === 'ar' ? 'كل المواعيد' : 'All schedules')}</span>
                  <ChevronDown className="w-3 h-3 opacity-50 flex-shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder={language === 'ar' ? 'بحث عن موعد...' : 'Search schedule...'} className="h-8 text-xs" />
                  <CommandList className="max-h-52">
                    <CommandEmpty>{language === 'ar' ? 'لا توجد نتائج' : 'No results'}</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="__all__" onSelect={() => { setFilterSchedule(''); setSchedulePopoverOpen(false); }}>
                        {language === 'ar' ? 'كل المواعيد' : 'All schedules'}
                      </CommandItem>
                      {scheduleOptions.map(s => (
                        <CommandItem key={s} value={s} onSelect={() => { setFilterSchedule(s); setSchedulePopoverOpen(false); }}>
                          {s}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <Button 
              variant="outline"
              size="sm"
              onClick={() => {
                const token = localStorage.getItem('token');
                const params = filterActivity !== 'all' ? { activity_id: filterActivity } : {};
                const url = exportAPI.members(params) + `&token=${token}`;
                window.open(url, '_blank');
              }}
              data-testid="export-members-btn"
            >
              <Download className="w-4 h-4 me-1" />
              Excel
            </Button>
            <Button 
              variant="outline"
              size="sm"
              onClick={() => {
                const token = localStorage.getItem('token');
                const params = filterActivity !== 'all' ? { activity_id: filterActivity } : {};
                const url = exportAPI.membersPdf(params) + `&token=${token}`;
                window.open(url, '_blank');
              }}
            >
              <Download className="w-4 h-4 me-1" />
              PDF
            </Button>
            <Button 
              variant="outline"
              size="sm"
              onClick={() => setIsPrintRangeOpen(true)}
              data-testid="print-members-btn"
            >
              <Printer className="w-4 h-4 me-1" />
              {language === 'ar' ? 'طباعة' : 'Print'}
            </Button>
            <Button size="sm" onClick={() => { setIsAddDialogOpen(true); loadLevels(); }} data-testid="add-member-btn">
              <Plus className="w-4 h-4 me-1" />
              {t('add_member')}
            </Button>
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-800">{filteredMembers.length}</div>
            <div className="text-xs text-gray-500">{language === 'ar' ? 'إجمالي الأعضاء' : 'Total Members'}</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-700">{filteredMembers.filter(m => m.activities?.some(a => getActivityStatusFromDate(a) === 'active')).length}</div>
            <div className="text-xs text-green-600">{language === 'ar' ? 'اشتراك ساري' : 'Active'}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-700">{filteredMembers.filter(m => m.activities?.length > 0 && m.activities.every(a => getActivityStatusFromDate(a) === 'expired')).length}</div>
            <div className="text-xs text-red-600">{language === 'ar' ? 'اشتراك منتهي' : 'Expired'}</div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-amber-700">{filteredMembers.filter(m => m.activities?.some(a => { const d = getDaysRemaining(a.end_date); return getActivityStatusFromDate(a) === 'active' && d !== null && d <= 7; })).length}</div>
            <div className="text-xs text-amber-600">{language === 'ar' ? 'ينتهي خلال أسبوع' : 'Expiring Soon'}</div>
          </div>
        </div>

        {/* Members List */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-8"></th>
                    <th className="hidden sm:table-cell">{language === 'ar' ? 'رقم العضوية' : 'Member ID'}</th>
                    <th>{language === 'ar' ? 'اسم العضو / ولي الأمر' : 'Member / Guardian'}</th>
                    <th>{t('phone')}</th>
                    <th className="hidden md:table-cell">{language === 'ar' ? 'الأنشطة وحالتها' : 'Activities & Status'}</th>
                    <th className="hidden lg:table-cell">{language === 'ar' ? 'تاريخ الانتهاء' : 'Expiry Date'}</th>
                    <th className="hidden lg:table-cell">{language === 'ar' ? 'ملاحظات' : 'Notes'}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-muted-foreground">
                        {t('no_data')}
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      const phoneCount = {};
                      members.forEach(m => { if (m.phone) phoneCount[m.phone.trim()] = (phoneCount[m.phone.trim()] || 0) + 1; });
                      return filteredMembers.map(member => {
                      const isSharedPhone = member.phone && (phoneCount[member.phone.trim()] || 0) > 1;
                      return (
                      <tr key={member.id} data-testid={`member-row-${member.id}`} className={member.activities?.some(a => { const d = getDaysRemaining(a.end_date); const s = getActivityStatusFromDate(a); return s === 'active' && d !== null && d <= 7 && d >= 0; }) ? 'bg-amber-50' : member.activities?.every(a => getActivityStatusFromDate(a) === 'expired') && member.activities?.length > 0 ? 'bg-red-50/50' : ''}>
                        <td className="text-center">
                          {(() => {
                            const acts = member.activities || [];
                            const hasActive = acts.some(a => getActivityStatusFromDate(a) === 'active');
                            const allExpired = acts.length > 0 && acts.every(a => getActivityStatusFromDate(a) === 'expired');
                            // Active = green check (visual only, like paid invoices).
                            if (hasActive) {
                              return (
                                <CheckCircle
                                  className="w-5 h-5 text-green-500 inline"
                                  title={language === 'ar' ? 'لديه اشتراك ساري' : 'Has active subscription'}
                                />
                              );
                            }
                            // Expired or no subscription = clickable empty
                            // circle that opens member view so the admin can
                            // renew/add an activity (mirrors the pending
                            // invoice behaviour).
                            const title = allExpired
                              ? (language === 'ar' ? 'الاشتراك منتهي - اضغط لعرض/تجديد' : 'Expired - click to view/renew')
                              : (language === 'ar' ? 'لا توجد اشتراكات - اضغط لإضافة' : 'No subscriptions - click to add');
                            const cls = allExpired ? 'text-red-400 hover:text-red-600' : 'text-gray-300 hover:text-gray-500';
                            return (
                              <Button
                                variant="ghost"
                                size="sm"
                                title={title}
                                className={`${cls} h-7 w-7 p-0`}
                                onClick={() => openViewDialog(member)}
                              >
                                <Circle className="w-5 h-5" />
                              </Button>
                            );
                          })()}
                        </td>
                        <td className="font-mono text-primary font-bold hidden sm:table-cell">
                          {member.member_code || '-'}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => openViewDialog(member)}
                            className="text-start w-full hover:text-primary transition-colors"
                            title={language === 'ar' ? 'عرض تفاصيل العضو' : 'View member details'}
                          >
                            <div className="font-medium">{language === 'ar' ? member.name_ar : member.name}</div>
                            {(member.guardian_name_ar || member.guardian_name) && (
                              <div className="text-xs text-gray-500">{language === 'ar' ? member.guardian_name_ar : member.guardian_name}</div>
                            )}
                            {member.member_code && (
                              <div className="sm:hidden text-xs font-mono text-primary font-semibold mt-0.5">#{member.member_code}</div>
                            )}
                            {member.phone && (
                              <div className={`sm:hidden text-xs mt-0.5 ${isSharedPhone ? 'text-amber-600 font-medium' : 'text-gray-500'}`} dir="ltr">
                                {member.phone}{isSharedPhone && <span className="ms-1 text-xs bg-amber-100 text-amber-700 rounded px-1" dir="rtl">مشترك</span>}
                              </div>
                            )}
                          </button>
                        </td>
                        <td dir="ltr" className="text-start">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openViewDialog(member)}
                              className={`hover:text-primary transition-colors ${isSharedPhone ? 'text-amber-600 font-medium' : ''}`}
                              title={isSharedPhone ? (language === 'ar' ? 'رقم مشترك - اضغط لعرض التفاصيل' : 'Shared phone - click to view details') : (language === 'ar' ? 'عرض تفاصيل العضو' : 'View member details')}
                            >
                              {member.phone}
                              {isSharedPhone && <span className="ms-1 text-xs bg-amber-100 text-amber-700 rounded px-1" dir="rtl">مشترك</span>}
                            </button>
                            {member.phone && (
                              <a
                                href={`https://wa.me/966${member.phone?.replace(/^0/, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-green-600 hover:text-green-700 p-1 rounded hover:bg-green-50 transition-colors"
                                title={language === 'ar' ? 'واتساب' : 'WhatsApp'}
                              >
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="hidden md:table-cell">
                          <div className="flex flex-col gap-1">
                            {member.activities?.map((activity, idx) => {
                              const actStatus = getActivityStatusFromDate(activity);
                              const statusLabel = actStatus === 'active' 
                                ? (language === 'ar' ? 'ساري' : 'Active')
                                : (language === 'ar' ? 'منتهي' : 'Expired');
                              const endDateText = activity.end_date 
                                ? new Date(activity.end_date).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')
                                : '-';
                              return (
                              <div key={idx} className="flex items-center gap-2 flex-wrap">
                                <Badge 
                                  variant="outline"
                                  className={getActivityColor(activity.activity_name)}
                                >
                                  {activity.activity_name}
                                </Badge>
                                <Badge 
                                  variant="outline"
                                  className={`text-xs ${
                                    actStatus === 'active' 
                                      ? 'bg-green-100 text-green-700 border-green-300' 
                                      : 'bg-red-100 text-red-700 border-red-300'
                                  }`}
                                >
                                  {statusLabel}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {language === 'ar' ? 'حتى' : 'until'} {endDateText}
                                </span>
                              </div>
                            )})}
                            {(!member.activities || member.activities.length === 0) && (
                              <span className="text-muted-foreground text-sm">{language === 'ar' ? 'لا يوجد أنشطة' : 'No activities'}</span>
                            )}
                          </div>
                        </td>
                        <td className="hidden lg:table-cell">
                          {member.activities?.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {member.activities.map((activity, idx) => {
                                const endDate = activity.end_date ? new Date(activity.end_date) : null;
                                const daysLeft = getDaysRemaining(activity.end_date);
                                const actStatus = getActivityStatusFromDate(activity);
                                return (
                                  <div key={idx} className={`text-xs font-medium ${actStatus === 'expired' ? 'text-red-600' : daysLeft !== null && daysLeft <= 7 ? 'text-amber-600' : 'text-gray-700'}`}>
                                    {endDate ? endDate.toLocaleDateString('ar-SA') : '-'}
                                    {daysLeft !== null && actStatus === 'active' && (
                                      <span className="text-[10px] text-gray-400 mr-1">({daysLeft} {language === 'ar' ? 'يوم' : 'd'})</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : '-'}
                        </td>
                        <td className="max-w-[150px] hidden lg:table-cell">
                          {member.notes ? (
                            <span className="text-sm text-gray-600 truncate block" title={member.notes}>
                              {member.notes.length > 30 ? member.notes.substring(0, 30) + '...' : member.notes}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </td>
                        <td>
                          <div className="action-buttons">
                            <button 
                              className="action-button"
                              onClick={() => openViewDialog(member)}
                              data-testid={`view-member-${member.id}`}
                              title={language === 'ar' ? 'عرض' : 'View'}
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button 
                              className="action-button"
                              onClick={() => openMemberCardDialog(member)}
                              data-testid={`card-member-${member.id}`}
                              title={language === 'ar' ? 'كرت العضوية' : 'Member Card'}
                            >
                              <CreditCard className="w-4 h-4" />
                            </button>
                            <button 
                              className="action-button"
                              onClick={() => openEditDialog(member)}
                              data-testid={`edit-member-${member.id}`}
                              title={language === 'ar' ? 'تعديل' : 'Edit'}
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button 
                              className="action-button"
                              onClick={() => openFreezeDialog(member)}
                              title={language === 'ar' ? 'تجميد' : 'Freeze'}
                            >
                              <Snowflake className="w-4 h-4 text-blue-500" />
                            </button>
                            <button 
                              className="action-button danger"
                              onClick={() => handleDelete(member.id)}
                              data-testid={`delete-member-${member.id}`}
                              title={language === 'ar' ? 'حذف' : 'Delete'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )});
                    })()
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Add/Edit Dialog */}
        <Dialog open={isPrintRangeOpen} onOpenChange={setIsPrintRangeOpen}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-orange-500" />
                طباعة الأعضاء حسب التاريخ
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-gray-600">
                اختر مدى التاريخ حسب تاريخ تسجيل العضو. اتركه فارغاً لطباعة الكل.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>من تاريخ</Label>
                  <Input type="date" value={printFromDate} onChange={(e) => setPrintFromDate(e.target.value)} />
                </div>
                <div>
                  <Label>إلى تاريخ</Label>
                  <Input type="date" value={printToDate} onChange={(e) => setPrintToDate(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button type="button" variant="outline" size="sm" onClick={() => {
                  const today = new Date().toISOString().split('T')[0];
                  setPrintFromDate(today); setPrintToDate(today);
                }}>اليوم</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => {
                  const now = new Date();
                  const start = new Date(now.getFullYear(), now.getMonth(), 1);
                  setPrintFromDate(start.toISOString().split('T')[0]);
                  setPrintToDate(now.toISOString().split('T')[0]);
                }}>هذا الشهر</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => {
                  setPrintFromDate(''); setPrintToDate('');
                }}>الكل</Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPrintRangeOpen(false)}>إلغاء</Button>
              <Button className="bg-orange-500 hover:bg-orange-600" onClick={handlePrintMembersRange}>
                <Printer className="w-4 h-4 me-1" /> طباعة
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedMember ? t('edit_member') : t('add_member')}
              </DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Name - Required */}
                <div className="space-y-2 sm:col-span-2">
                  <Label>{language === 'ar' ? 'الاسم' : 'Name'} <span className="text-red-500">*</span></Label>
                  <Input
                    value={formData.name_ar}
                    onChange={(e) => setFormData({...formData, name_ar: e.target.value, name: e.target.value})}
                    required
                    placeholder={language === 'ar' ? 'أدخل اسم العضو' : 'Enter member name'}
                    data-testid="member-name-ar-input"
                  />
                </div>
                
                {/* Phone - Required */}
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'رقم الجوال' : 'Phone'} <span className="text-red-500">*</span></Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    type="tel"
                    dir="ltr"
                    required
                    placeholder="05xxxxxxxx"
                    data-testid="member-phone-input"
                    className={(() => {
                      if (!selectedMember && formData.phone.length >= 7) {
                        const dups = members.filter(m => m.phone && m.phone.trim() === formData.phone.trim());
                        if (dups.length) return 'border-orange-500 focus-visible:ring-orange-400';
                      }
                      return '';
                    })()}
                  />
                  {/* Duplicate phone warning */}
                  {(() => {
                    if (!selectedMember && formData.phone.length >= 7) {
                      const dups = members.filter(m => m.phone && m.phone.trim() === formData.phone.trim());
                      if (dups.length) {
                        return (
                          <div className="bg-orange-50 border border-orange-300 rounded-md px-3 py-2 text-sm text-orange-800" dir="rtl">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg">⚠️</span>
                              <span className="font-semibold">
                                {language === 'ar' ? `الرقم مسجّل مسبقاً لـ ${dups.length} عضو:` : `Number already used by ${dups.length} member(s):`}
                              </span>
                            </div>
                            <ul className="space-y-0.5 ps-7">
                              {dups.map(d => (
                                <li key={d.id} className="flex items-center gap-1">
                                  <span className="font-mono text-primary font-bold text-xs">#{d.member_code || d.member_id || d.id}</span>
                                  <strong>{d.name_ar || d.name}</strong>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      }
                    }
                    return null;
                  })()}
                </div>
                
                {/* Age - Optional */}
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'العمر' : 'Age'} <span className="text-gray-400 text-xs">({language === 'ar' ? 'اختياري' : 'optional'})</span></Label>
                  <Input
                    value={formData.age}
                    onChange={(e) => setFormData({...formData, age: e.target.value})}
                    type="number"
                    min="1"
                    max="100"
                    placeholder={language === 'ar' ? 'العمر' : 'Age'}
                    data-testid="member-age-input"
                  />
                </div>
                
                {/* Notes - Optional */}
                <div className="space-y-2 sm:col-span-2">
                  <Label>{language === 'ar' ? 'الملاحظات' : 'Notes'}</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    placeholder={language === 'ar' ? 'أضف ملاحظات...' : 'Add notes...'}
                    data-testid="member-notes-input"
                  />
                </div>
                
                {/* Activity Section - Only for new members */}
                {!selectedMember && (
                  <div className="sm:col-span-2 border-t pt-4 mt-4">
                    <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                      <Activity className="w-5 h-5 text-primary" />
                      {language === 'ar' ? 'النشاط (اختياري)' : 'Activity (Optional)'}
                    </h3>
                    
                    {/* Activity Selection Dropdown */}
                    <div className="space-y-2 mb-4">
                      <Label>{language === 'ar' ? 'اختر النشاط' : 'Select Activity'}</Label>
                      <Select 
                        value={activityForm.activity_id || 'none'} 
                        onValueChange={(value) => {
                          const activity = activities.find(a => a.id === value);
                          setActivityForm({
                            ...activityForm, 
                            activity_id: value === 'none' ? '' : value
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={language === 'ar' ? '+ اختر نشاط لإضافته' : '+ Select activity to add'} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{language === 'ar' ? '-- بدون نشاط --' : '-- No Activity --'}</SelectItem>
                          {activities.map(activity => (
                            <SelectItem key={activity.id} value={activity.id}>
                              {language === 'ar' ? activity.name_ar : activity.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {/* Activity Details - Show only when activity is selected */}
                    {activityForm.activity_id && (
                      <div className="p-4 bg-muted/50 rounded-lg border space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="font-medium">
                            {(() => {
                              const activity = activities.find(a => a.id === activityForm.activity_id);
                              return language === 'ar' ? activity?.name_ar : activity?.name;
                            })()}
                          </p>
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => setActivityForm({...activityForm, activity_id: '', training_days: [], training_time: '', level_id: ''})} 
                            className="text-destructive h-8 w-8"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        
                        {/* Dates Row */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                            <Input
                              type="date"
                              value={activityForm.start_date}
                              onChange={(e) => setActivityForm({...activityForm, start_date: e.target.value})}
                              className="h-12 text-base"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}</Label>
                            <Input
                              type="date"
                              value={activityForm.end_date}
                              onChange={(e) => setActivityForm({...activityForm, end_date: e.target.value})}
                              className="h-12 text-base"
                            />
                          </div>
                        </div>
                        
                        {/* Training Days - Arabic names like Invoices */}
                        <div className="space-y-2">
                          <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
                          <div className="flex flex-wrap gap-1">
                            {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day) => (
                              <button
                                key={day}
                                type="button"
                                onClick={() => {
                                  const currentDays = activityForm.training_days || [];
                                  const newDays = currentDays.includes(day)
                                    ? currentDays.filter(d => d !== day)
                                    : [...currentDays, day];
                                  
                                  // Format schedule like invoices
                                  const formatSchedule = (days, time) => {
                                    if (days.length === 0) return time || '';
                                    const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                    const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                    let daysStr;
                                    if (sortedDays.length === 1) {
                                      daysStr = sortedDays[0];
                                    } else {
                                      const lastDay = sortedDays.pop();
                                      daysStr = sortedDays.join('، ') + ' و ' + lastDay;
                                    }
                                    return time ? `${daysStr} - ${time}` : daysStr;
                                  };
                                  
                                  setActivityForm({
                                    ...activityForm,
                                    training_days: newDays,
                                    schedule: formatSchedule(newDays, activityForm.training_time)
                                  });
                                }}
                                className={`px-2 py-1 text-xs rounded border transition-colors ${
                                  (activityForm.training_days || []).includes(day)
                                    ? 'bg-blue-500 text-white border-blue-500'
                                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                                }`}
                              >
                                {day}
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        {/* Training Time - Number input auto-converted to time format */}
                        <div className="space-y-2">
                          <Label className="text-xs">{language === 'ar' ? 'الساعة' : 'Time'}</Label>
                          <Input 
                            type="number"
                            min="1"
                            max="12"
                            value={activityForm.training_time_hour || ''} 
                            onChange={(e) => {
                              const hour = e.target.value;
                              // Auto convert to time format (e.g., 4 → 4:00 م)
                              const timeStr = hour ? `${hour}:00 م` : '';
                              // Format schedule like invoices
                              const formatSchedule = (days, time) => {
                                if (!days || days.length === 0) return time || '';
                                const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                let daysStr;
                                if (sortedDays.length === 1) {
                                  daysStr = sortedDays[0];
                                } else {
                                  const lastDay = sortedDays.pop();
                                  daysStr = sortedDays.join('، ') + ' و ' + lastDay;
                                }
                                return time ? `${daysStr} - ${time}` : daysStr;
                              };
                              
                              setActivityForm({
                                ...activityForm,
                                training_time_hour: hour,
                                training_time: timeStr,
                                schedule: formatSchedule(activityForm.training_days, timeStr)
                              });
                            }} 
                            className="h-8 text-sm" 
                            placeholder={language === 'ar' ? 'مثال: 4' : 'e.g. 4'}
                          />
                          {activityForm.training_time && (
                            <p className="text-xs text-muted-foreground">{activityForm.training_time}</p>
                          )}
                        </div>
                        
                        {/* Level Selection - Cascading like Invoices */}
                        <div className="space-y-2">
                          <Label className="text-xs">{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                          
                          {!memberLevelSelectorState ? (
                            <div>
                              {activityForm.level_id ? (
                                <div className="flex items-center justify-between p-2 border rounded-lg bg-gray-50">
                                  <span className="text-sm">
                                    {(() => {
                                      const level = levels.find(l => l.id === activityForm.level_id);
                                      if (!level) return '';
                                      const label = level.display_name || (level.custom_name ? level.custom_name : `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number}`);
                                      return level.activity_name ? `${label} - ${level.activity_name}` : label;
                                    })()}
                                  </span>
                                  <div className="flex gap-1">
                                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setMemberLevelSelectorState({ step: 'activity', selectedActivity: '', selectedTime: '' })}>
                                      {language === 'ar' ? 'تغيير' : 'Change'}
                                    </Button>
                                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-red-500" onClick={() => setActivityForm({...activityForm, level_id: ''})}>
                                      ✕
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <Button 
                                  type="button" 
                                  variant="outline" 
                                  className="w-full h-8 text-sm justify-start gap-2"
                                  onClick={() => setMemberLevelSelectorState({ step: 'activity', selectedActivity: '', selectedTime: '' })}
                                >
                                  <span>🎯</span>
                                  {language === 'ar' ? 'اختر المستوى' : 'Select Level'}
                                </Button>
                              )}
                            </div>
                          ) : (
                            <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
                              <div className="flex items-center justify-between p-2 bg-gray-100 border-b">
                                <div className="flex items-center gap-2">
                                  {memberLevelSelectorState.step !== 'activity' && (
                                    <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => {
                                      if (memberLevelSelectorState.step === 'level') {
                                        setMemberLevelSelectorState({ ...memberLevelSelectorState, step: 'time', selectedTime: '' });
                                      } else if (memberLevelSelectorState.step === 'time') {
                                        setMemberLevelSelectorState({ step: 'activity', selectedActivity: '', selectedTime: '' });
                                      }
                                    }}>
                                      {language === 'ar' ? '→' : '←'}
                                    </Button>
                                  )}
                                  <span className="text-xs font-medium text-gray-600">
                                    {memberLevelSelectorState.step === 'activity' && (language === 'ar' ? 'اختر النشاط' : 'Select Activity')}
                                    {memberLevelSelectorState.step === 'time' && (language === 'ar' ? 'اختر الساعة' : 'Select Time')}
                                    {memberLevelSelectorState.step === 'level' && (language === 'ar' ? 'اختر المستوى' : 'Select Level')}
                                  </span>
                                </div>
                                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setMemberLevelSelectorState(null)}>
                                  ✕
                                </Button>
                              </div>
                              
                              {memberLevelSelectorState.step === 'activity' && (
                                <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                  {MAIN_ACTIVITIES_FOR_LEVELS.map(activity => {
                                    const activityLevels = groupedLevelsForSelector[activity.id] || {};
                                    const timeCount = Object.keys(activityLevels).length;
                                    if (timeCount === 0) return null;
                                    return (
                                      <button
                                        key={activity.id}
                                        type="button"
                                        className={`w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors ${activity.color} bg-opacity-10`}
                                        onClick={() => setMemberLevelSelectorState({ ...memberLevelSelectorState, step: 'time', selectedActivity: activity.id })}
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="text-xl">{activity.icon}</span>
                                          <span className="font-medium">{language === 'ar' ? activity.name_ar : activity.name_en}</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-gray-500">
                                          <span className="text-xs">{timeCount} {language === 'ar' ? 'أوقات' : 'times'}</span>
                                          <span>{language === 'ar' ? '←' : '→'}</span>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              
                              {memberLevelSelectorState.step === 'time' && (
                                <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                  {Object.entries(groupedLevelsForSelector[memberLevelSelectorState.selectedActivity] || {}).map(([timeSlot, timeLevels]) => {
                                    const totalMembers = timeLevels.reduce((sum, l) => sum + (l.members || []).length, 0);
                                    const totalCapacity = timeLevels.reduce((sum, l) => sum + (l.capacity || 10), 0);
                                    return (
                                      <button
                                        key={timeSlot}
                                        type="button"
                                        className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-blue-50 transition-colors border"
                                        onClick={() => setMemberLevelSelectorState({ ...memberLevelSelectorState, step: 'level', selectedTime: timeSlot })}
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="text-lg">🕐</span>
                                          <span className="font-medium text-sm">{timeSlot}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs text-gray-500">
                                            {timeLevels.length} {language === 'ar' ? 'مستويات' : 'levels'} • {totalMembers}/{totalCapacity}
                                          </span>
                                          <span className="text-gray-400">{language === 'ar' ? '←' : '→'}</span>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              
                              {memberLevelSelectorState.step === 'level' && (
                                <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                  {(groupedLevelsForSelector[memberLevelSelectorState.selectedActivity]?.[memberLevelSelectorState.selectedTime] || [])
                                    .sort((a, b) => a.level_number - b.level_number)
                                    .map(level => {
                                      const memberCount = (level.members || []).length;
                                      const maxCapacity = level.capacity || 10;
                                      const isFull = memberCount >= maxCapacity;
                                      const fillPercent = Math.round((memberCount / maxCapacity) * 100);
                                      const levelCoach = level.coach_id ? (coaches || []).find(c => c.id === level.coach_id) : null;
                                      const coachName = levelCoach ? (levelCoach.name_ar || levelCoach.name) : null;
                                      return (
                                        <button
                                          key={level.id}
                                          type="button"
                                          className={`w-full p-2 rounded-lg transition-colors border ${isFull ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'hover:bg-green-50 border-gray-200'}`}
                                          onClick={() => {
                                            setActivityForm({...activityForm, level_id: level.id});
                                            setMemberLevelSelectorState(null);
                                          }}
                                        >
                                          <div className="flex items-center justify-between mb-1">
                                            <span className={`font-bold ${isFull ? 'text-red-600' : 'text-gray-800'}`}>
                                              {level.display_name || (level.custom_name ? level.custom_name : `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number}`)}
                                            </span>
                                            <span className={`text-sm ${isFull ? 'text-red-600' : 'text-gray-600'}`}>
                                              {memberCount}/{maxCapacity} {isFull && '⚠️'}
                                            </span>
                                          </div>
                                          {(level.time_slot || level.schedule || memberLevelSelectorState.selectedTime) && (
                                            <div className="text-xs font-bold text-amber-700 mb-1 text-right flex items-center justify-end gap-1">
                                              <span>🕐</span><span>{level.time_slot || level.schedule || memberLevelSelectorState.selectedTime}</span>
                                            </div>
                                          )}
                                          {coachName && (
                                            <div className="text-xs text-blue-600 mb-1 text-right">
                                              👤 {language === 'ar' ? 'المدرب: ' : 'Coach: '}{coachName}
                                            </div>
                                          )}
                                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                                            <div 
                                              className={`h-1.5 rounded-full ${isFull ? 'bg-red-500' : 'bg-green-500'}`}
                                              style={{ width: `${Math.min(fillPercent, 100)}%` }}
                                            />
                                          </div>
                                        </button>
                                      );
                                    })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={saving} data-testid="save-member-btn">
                  {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* View Member Dialog */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <span className="flex-1">{language === 'ar' ? selectedMember?.name_ar : selectedMember?.name}</span>
                {selectedMember && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 me-6"
                    onClick={() => { setIsViewDialogOpen(false); openEditDialog(selectedMember); }}
                    title={language === 'ar' ? 'تعديل بيانات العضو (الاسم، الجوال، العمر...)' : 'Edit member info'}
                  >
                    <Edit className="w-4 h-4" />
                    {language === 'ar' ? 'تعديل البيانات' : 'Edit Info'}
                  </Button>
                )}
              </DialogTitle>
            </DialogHeader>
            
            {selectedMember && (
              <div className="space-y-6">
                {/* Tabs */}
                <div className="flex gap-2 border-b">
                  <button
                    onClick={() => setViewTab('info')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      viewTab === 'info' 
                        ? 'border-primary text-primary' 
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <User className="w-4 h-4 inline me-1" />
                    {language === 'ar' ? 'البيانات' : 'Info'}
                  </button>
                  <button
                    onClick={() => setViewTab('activities')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      viewTab === 'activities' 
                        ? 'border-primary text-primary' 
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Activity className="w-4 h-4 inline me-1" />
                    {t('activities')} ({selectedMember.activities?.length || 0})
                  </button>
                  <button
                    onClick={() => setViewTab('invoices')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      viewTab === 'invoices' 
                        ? 'border-primary text-primary' 
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Receipt className="w-4 h-4 inline me-1" />
                    {t('invoices')} ({memberInvoices.length})
                  </button>
                  <button
                    onClick={() => setViewTab('history')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      viewTab === 'history' 
                        ? 'border-primary text-primary' 
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <History className="w-4 h-4 inline me-1" />
                    {language === 'ar' ? 'سجل التجديدات' : 'Renewal History'}
                  </button>
                  <button
                    onClick={() => setViewTab('attendance')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      viewTab === 'attendance' 
                        ? 'border-primary text-primary' 
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Calendar className="w-4 h-4 inline me-1" />
                    {language === 'ar' ? 'الحضور' : 'Attendance'}
                    {memberAttendance?.summary && (
                      <span className="ms-1 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                        {memberAttendance.summary.absent_count}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setViewTab('purchases')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      viewTab === 'purchases' 
                        ? 'border-primary text-primary' 
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <ShoppingBag className="w-4 h-4 inline me-1" />
                    {language === 'ar' ? 'المشتريات' : 'Purchases'}
                    {memberProductPurchases.length > 0 && (
                      <span className="ms-1 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                        {memberProductPurchases.length}
                      </span>
                    )}
                  </button>
                  {memberTournaments.length > 0 && (
                    <button
                      onClick={() => setViewTab('tournaments')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        viewTab === 'tournaments'
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Trophy className="w-4 h-4 inline me-1" />
                      {language === 'ar' ? 'البطولات' : 'Tournaments'}
                      <span className="ms-1 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                        {memberTournaments.length}
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setViewTab('freeze');
                      if (selectedMember) {
                        freezesAPI.getMemberFreezes(selectedMember.id).then(r => setMemberFreezes(r.data));
                        freezesAPI.getMemberStats(selectedMember.id).then(r => setMemberFreezeStats(r.data));
                      }
                    }}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      viewTab === 'freeze' 
                        ? 'border-primary text-primary' 
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Snowflake className="w-4 h-4 inline me-1" />
                    {language === 'ar' ? 'التجميد' : 'Freeze'}
                  </button>
                </div>

                {/* Tab Content: Info */}
                {viewTab === 'info' && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
                      <div>
                        <p className="text-sm text-muted-foreground">{t('guardian_name')}</p>
                        <p className="font-medium">
                          {language === 'ar' ? selectedMember.guardian_name_ar : selectedMember.guardian_name}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('phone')}</p>
                        <p className="font-medium" dir="ltr">{selectedMember.phone}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{t('age')}</p>
                        <p className="font-medium">{selectedMember.age}</p>
                      </div>
                      {selectedMember.email && (
                        <div className="col-span-2">
                          <p className="text-sm text-muted-foreground">{t('email')}</p>
                          <p className="font-medium" dir="ltr">{selectedMember.email}</p>
                        </div>
                      )}
                    </div>
                    {/* Notes section - always visible with edit capability */}
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-amber-800 flex items-center gap-1">
                          📝 {language === 'ar' ? 'ملاحظات العضو' : 'Member Notes'}
                        </p>
                        {!editingNotes && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-amber-700 hover:bg-amber-100"
                            onClick={() => { setNotesValue(selectedMember.notes || ''); setEditingNotes(true); }}
                          >
                            <Edit className="w-3.5 h-3.5 me-1" />
                            {language === 'ar' ? 'تعديل' : 'Edit'}
                          </Button>
                        )}
                      </div>
                      {editingNotes ? (
                        <div className="space-y-2">
                          <Textarea
                            value={notesValue}
                            onChange={e => setNotesValue(e.target.value)}
                            placeholder={language === 'ar' ? 'اكتب ملاحظات للعضو...' : 'Write member notes...'}
                            className="min-h-[80px] text-sm bg-white"
                            autoFocus
                          />
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" variant="outline" onClick={() => setEditingNotes(false)}>
                              {language === 'ar' ? 'إلغاء' : 'Cancel'}
                            </Button>
                            <Button size="sm" onClick={handleSaveNotes} disabled={notesSaving} className="bg-amber-600 hover:bg-amber-700 text-white">
                              {notesSaving ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ' : 'Save')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-amber-900">
                          {selectedMember.notes || <span className="text-amber-400 italic">{language === 'ar' ? 'لا توجد ملاحظات — اضغط تعديل لإضافة' : 'No notes — click Edit to add'}</span>}
                        </p>
                      )}
                    </div>
                  </>
                )}

                {/* Tab Content: Activities */}
                {viewTab === 'activities' && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold flex items-center gap-2">
                        <Activity className="w-5 h-5 text-primary" />
                        {t('member_activities')}
                      </h3>
                      <Button 
                        size="sm" 
                        onClick={() => setIsActivityDialogOpen(true)}
                        data-testid="add-activity-btn"
                      >
                        <Plus className="w-4 h-4 me-1" />
                        {t('add_activity')}
                      </Button>
                    </div>
                    
                    {selectedMember.activities?.length > 0 ? (
                      <div className="space-y-3">
                        {/* Group activities by activity_id and show only the latest */}
                        {(() => {
                          const latestActivities = {};
                          selectedMember.activities.forEach(act => {
                            const existing = latestActivities[act.activity_id];
                            if (!existing || new Date(act.end_date) > new Date(existing.end_date)) {
                              latestActivities[act.activity_id] = act;
                            }
                          });
                          return Object.values(latestActivities);
                        })().map((activity, idx) => {
                          const daysRemaining = getDaysRemaining(activity.end_date);
                          const showRenewalBtn = needsRenewal(activity) || daysRemaining <= 0;
                          const isExpired = daysRemaining !== null && daysRemaining <= 0;
                          const isNearExpiry = daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 7;
                          
                          const isEditing = editingActivityId === activity.activity_id;
                          return (
                            <Card key={idx} className={`p-4 ${isNearExpiry ? 'border-amber-400 bg-amber-50/50' : ''} ${isExpired ? 'border-red-400 bg-red-50/50' : ''} ${isEditing ? 'border-blue-400 bg-blue-50/30' : ''}`}>
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <Badge className={getActivityColor(activity.activity_name)}>
                                      {activity.activity_name}
                                    </Badge>
                                    {getStatusBadge(getActivityStatusFromDate(activity))}
                                    
                                    {/* Days remaining badge */}
                                    {daysRemaining !== null && (
                                      <Badge 
                                        variant="outline" 
                                        className={`${
                                          daysRemaining <= 0 
                                            ? 'bg-red-100 text-red-700 border-red-300' 
                                            : daysRemaining <= 3 
                                              ? 'bg-red-100 text-red-600 border-red-300'
                                              : daysRemaining <= 7 
                                                ? 'bg-amber-100 text-amber-700 border-amber-300' 
                                                : 'bg-green-100 text-green-700 border-green-300'
                                        }`}
                                      >
                                        <Clock className="w-3 h-3 me-1" />
                                        {daysRemaining <= 0 
                                          ? (language === 'ar' ? 'منتهي' : 'Expired')
                                          : (language === 'ar' 
                                              ? `${daysRemaining} يوم متبقي` 
                                              : `${daysRemaining} days left`)}
                                      </Badge>
                                    )}
                                  </div>
                                  
                                  {!isEditing && (
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                      <div>
                                        <span className="text-muted-foreground">{t('start_date')}: </span>
                                        <span>{activity.start_date}</span>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">{t('end_date')}: </span>
                                        <span>{activity.end_date}</span>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">{t('monthly_fee')}: </span>
                                        <span>{activity.fee} {t('sar')}</span>
                                      </div>
                                      {activity.schedule && (
                                        <div>
                                          <span className="text-muted-foreground">{language === 'ar' ? 'الموعد' : 'Schedule'}: </span>
                                          <span>{activity.schedule}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                                
                                <div className="flex flex-col gap-1 ms-3">
                                  {/* Edit button */}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-blue-400 text-blue-600 hover:bg-blue-50 h-8 px-2"
                                    onClick={() => {
                                      if (isEditing) {
                                        setEditingActivityId(null);
                                        setEditActivityForm({});
                                        setEditMemberLevelSelectorState(null);
                                      } else {
                                        if (!levelsLoaded) loadLevels();
                                        setEditingActivityId(activity.activity_id);
                                        setEditActivityForm({
                                          activity_id: activity.activity_id,
                                          activity_name: activity.activity_name,
                                          start_date: activity.start_date || '',
                                          end_date: activity.end_date || '',
                                          fee: activity.fee || 0,
                                          status: activity.status || 'active',
                                          coach_id: activity.coach_id || '',
                                          level_id: activity.level_id || '',
                                          schedule: activity.schedule || '',
                                          training_days: activity.training_days || [],
                                          training_time: activity.training_time || '',
                                          source: activity.source || '',
                                          source_id: activity.source_id || ''
                                        });
                                      }
                                    }}
                                  >
                                    {isEditing ? <X className="w-3.5 h-3.5" /> : <Edit className="w-3.5 h-3.5" />}
                                  </Button>
                                  {/* Renewal button */}
                                  {showRenewalBtn && !isEditing && (
                                    <Button
                                      size="sm"
                                      variant={isExpired ? "default" : "outline"}
                                      className={`${isExpired ? 'bg-red-500 hover:bg-red-600 text-white' : 'border-amber-500 text-amber-600 hover:bg-amber-50'} h-8 px-2`}
                                      onClick={() => openRenewalDialog(activity)}
                                      data-testid={`renew-activity-${activity.activity_id}`}
                                    >
                                      <RefreshCcw className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {/* Inline Edit Form */}
                              {isEditing && (
                                <div className="mt-3 pt-3 border-t border-blue-200 space-y-3">
                                  {/* Activity selector */}
                                  <div className="space-y-1">
                                    <Label className="text-xs">{language === 'ar' ? 'النشاط' : 'Activity'}</Label>
                                    <select
                                      value={editActivityForm.activity_id || ''}
                                      onChange={e => {
                                        const act = activities.find(a => a.id === e.target.value);
                                        setEditActivityForm({
                                          ...editActivityForm,
                                          activity_id: e.target.value,
                                          activity_name: act ? (language === 'ar' ? act.name_ar : act.name) : editActivityForm.activity_name,
                                          level_id: ''
                                        });
                                      }}
                                      className="w-full h-9 text-sm border rounded-md px-2 bg-white"
                                    >
                                      <option value="">{language === 'ar' ? '-- اختر النشاط --' : '-- Select Activity --'}</option>
                                      {activities.map(act => (
                                        <option key={act.id} value={act.id}>
                                          {language === 'ar' ? act.name_ar : act.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  {/* Level selector - cascading */}
                                  <div className="space-y-1">
                                    <Label className="text-xs">{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                                    {!editMemberLevelSelectorState ? (
                                      <div>
                                        {editActivityForm.level_id ? (
                                          <div className="flex items-center justify-between p-2 border rounded-lg bg-gray-50">
                                            <span className="text-sm">
                                              {(() => {
                                                const level = levels.find(l => l.id === editActivityForm.level_id);
                                                if (!level) return editActivityForm.level_id;
                                                const label = level.display_name || (level.custom_name ? level.custom_name : `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number}`);
                                                return level.activity_name ? `${label} - ${level.activity_name}` : label;
                                              })()}
                                            </span>
                                            <div className="flex gap-1">
                                              <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditMemberLevelSelectorState({ step: 'activity', selectedActivity: '', selectedTime: '' })}>
                                                {language === 'ar' ? 'تغيير' : 'Change'}
                                              </Button>
                                              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-red-500" onClick={() => setEditActivityForm({...editActivityForm, level_id: ''})}>✕</Button>
                                            </div>
                                          </div>
                                        ) : (
                                          <Button type="button" variant="outline" className="w-full h-8 text-sm justify-start gap-2" onClick={() => setEditMemberLevelSelectorState({ step: 'activity', selectedActivity: '', selectedTime: '' })}>
                                            <span>🎯</span>
                                            {language === 'ar' ? 'اختر المستوى' : 'Select Level'}
                                          </Button>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
                                        <div className="flex items-center justify-between p-2 bg-gray-100 border-b">
                                          <div className="flex items-center gap-2">
                                            {editMemberLevelSelectorState.step !== 'activity' && (
                                              <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => {
                                                if (editMemberLevelSelectorState.step === 'level') {
                                                  setEditMemberLevelSelectorState({ ...editMemberLevelSelectorState, step: 'time', selectedTime: '' });
                                                } else if (editMemberLevelSelectorState.step === 'time') {
                                                  setEditMemberLevelSelectorState({ step: 'activity', selectedActivity: '', selectedTime: '' });
                                                }
                                              }}>{language === 'ar' ? '→' : '←'}</Button>
                                            )}
                                            <span className="text-xs font-medium text-gray-600">
                                              {editMemberLevelSelectorState.step === 'activity' && (language === 'ar' ? 'اختر النشاط' : 'Select Activity')}
                                              {editMemberLevelSelectorState.step === 'time' && (language === 'ar' ? 'اختر الساعة' : 'Select Time')}
                                              {editMemberLevelSelectorState.step === 'level' && (language === 'ar' ? 'اختر المستوى' : 'Select Level')}
                                            </span>
                                          </div>
                                          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setEditMemberLevelSelectorState(null)}>✕</Button>
                                        </div>
                                        {editMemberLevelSelectorState.step === 'activity' && (
                                          <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                            {MAIN_ACTIVITIES_FOR_LEVELS.map(activity => {
                                              const activityLevels = groupedLevelsForSelector[activity.id] || {};
                                              const timeCount = Object.keys(activityLevels).length;
                                              if (timeCount === 0) return null;
                                              return (
                                                <button key={activity.id} type="button" className={`w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors ${activity.color} bg-opacity-10`}
                                                  onClick={() => setEditMemberLevelSelectorState({ ...editMemberLevelSelectorState, step: 'time', selectedActivity: activity.id })}>
                                                  <div className="flex items-center gap-2"><span className="text-xl">{activity.icon}</span><span className="font-medium">{language === 'ar' ? activity.name_ar : activity.name_en}</span></div>
                                                  <div className="flex items-center gap-1 text-gray-500"><span className="text-xs">{timeCount} {language === 'ar' ? 'أوقات' : 'times'}</span><span>{language === 'ar' ? '←' : '→'}</span></div>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        )}
                                        {editMemberLevelSelectorState.step === 'time' && (
                                          <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                            {Object.entries(groupedLevelsForSelector[editMemberLevelSelectorState.selectedActivity] || {}).map(([timeSlot, timeLevels]) => {
                                              const totalMembers = timeLevels.reduce((sum, l) => sum + (l.members || []).length, 0);
                                              const totalCapacity = timeLevels.reduce((sum, l) => sum + (l.capacity || 10), 0);
                                              return (
                                                <button key={timeSlot} type="button" className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-blue-50 transition-colors border"
                                                  onClick={() => setEditMemberLevelSelectorState({ ...editMemberLevelSelectorState, step: 'level', selectedTime: timeSlot })}>
                                                  <div className="flex items-center gap-2"><span className="text-lg">🕐</span><span className="font-medium text-sm">{timeSlot}</span></div>
                                                  <div className="flex items-center gap-2">
                                                    <span className="text-xs text-gray-500">{timeLevels.length} {language === 'ar' ? 'مستويات' : 'levels'} • {totalMembers}/{totalCapacity}</span>
                                                    <span className="text-gray-400">{language === 'ar' ? '←' : '→'}</span>
                                                  </div>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        )}
                                        {editMemberLevelSelectorState.step === 'level' && (
                                          <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                            {(groupedLevelsForSelector[editMemberLevelSelectorState.selectedActivity]?.[editMemberLevelSelectorState.selectedTime] || [])
                                              .sort((a, b) => a.level_number - b.level_number)
                                              .map(level => {
                                                const memberCount = (level.members || []).length;
                                                const maxCapacity = level.capacity || 10;
                                                const isFull = memberCount >= maxCapacity;
                                                const fillPercent = Math.round((memberCount / maxCapacity) * 100);
                                                const levelCoach = level.coach_id ? (coaches || []).find(c => c.id === level.coach_id) : null;
                                                const coachName = levelCoach ? (levelCoach.name_ar || levelCoach.name) : null;
                                                return (
                                                  <button key={level.id} type="button"
                                                    className={`w-full p-2 rounded-lg transition-colors border ${isFull ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'hover:bg-green-50 border-gray-200'}`}
                                                    onClick={() => { setEditActivityForm({...editActivityForm, level_id: level.id}); setEditMemberLevelSelectorState(null); }}>
                                                    <div className="flex items-center justify-between mb-1">
                                                      <span className={`font-bold ${isFull ? 'text-red-600' : 'text-gray-800'}`}>
                                                        {level.display_name || (level.custom_name ? level.custom_name : `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number}`)}
                                                      </span>
                                                      <span className={`text-sm ${isFull ? 'text-red-600' : 'text-gray-600'}`}>{memberCount}/{maxCapacity} {isFull && '⚠️'}</span>
                                                    </div>
                                                    {(level.time_slot || level.schedule || editMemberLevelSelectorState.selectedTime) && (
                                                      <div className="text-xs font-bold text-amber-700 mb-1 text-right flex items-center justify-end gap-1">
                                                        <span>🕐</span><span>{level.time_slot || level.schedule || editMemberLevelSelectorState.selectedTime}</span>
                                                      </div>
                                                    )}
                                                    {coachName && (
                                                      <div className="text-xs text-blue-600 mb-1 text-right">
                                                        👤 {language === 'ar' ? 'المدرب: ' : 'Coach: '}{coachName}
                                                      </div>
                                                    )}
                                                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                                                      <div className={`h-1.5 rounded-full ${isFull ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${Math.min(fillPercent, 100)}%` }} />
                                                    </div>
                                                  </button>
                                                );
                                              })}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <Label className="text-xs">{t('start_date')}</Label>
                                      <Input type="date" value={editActivityForm.start_date || ''} onChange={e => setEditActivityForm({...editActivityForm, start_date: e.target.value})} className="h-9 text-sm" />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">{t('end_date')}</Label>
                                      <Input type="date" value={editActivityForm.end_date || ''} onChange={e => setEditActivityForm({...editActivityForm, end_date: e.target.value})} className="h-9 text-sm" />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <Label className="text-xs">{t('monthly_fee')} ({t('sar')})</Label>
                                      <Input type="number" value={editActivityForm.fee || ''} onChange={e => setEditActivityForm({...editActivityForm, fee: e.target.value})} className="h-9 text-sm" />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">{language === 'ar' ? 'الحالة' : 'Status'}</Label>
                                      <select
                                        value={editActivityForm.status || 'active'}
                                        onChange={e => setEditActivityForm({...editActivityForm, status: e.target.value})}
                                        className="w-full h-9 text-sm border rounded-md px-2 bg-white"
                                      >
                                        <option value="active">{language === 'ar' ? 'نشط' : 'Active'}</option>
                                        <option value="inactive">{language === 'ar' ? 'غير نشط' : 'Inactive'}</option>
                                        <option value="expired">{language === 'ar' ? 'منتهي' : 'Expired'}</option>
                                      </select>
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
                                    <div className="flex flex-wrap gap-1">
                                      {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map(day => (
                                        <button
                                          key={day}
                                          type="button"
                                          onClick={() => {
                                            const cur = editActivityForm.training_days || [];
                                            const newDays = cur.includes(day) ? cur.filter(d => d !== day) : [...cur, day];
                                            setEditActivityForm({...editActivityForm, training_days: newDays});
                                          }}
                                          className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                                            (editActivityForm.training_days || []).includes(day)
                                              ? 'bg-blue-500 text-white border-blue-500'
                                              : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                                          }`}
                                        >
                                          {day}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">{language === 'ar' ? 'الساعة' : 'Time'}</Label>
                                    <Input
                                      type="number" min="1" max="12"
                                      value={editActivityForm.training_time ? editActivityForm.training_time.split(':')[0] : ''}
                                      onChange={e => {
                                        const h = e.target.value;
                                        setEditActivityForm({...editActivityForm, training_time: h ? `${h}:00 م` : ''});
                                      }}
                                      className="h-9 text-sm"
                                      placeholder={language === 'ar' ? 'مثال: 4' : 'e.g. 4'}
                                    />
                                    {editActivityForm.training_time && <p className="text-xs text-muted-foreground">{editActivityForm.training_time}</p>}
                                  </div>
                                  <div className="flex gap-2 justify-end pt-1">
                                    <Button size="sm" variant="outline" onClick={() => { setEditingActivityId(null); setEditActivityForm({}); }}>
                                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                                    </Button>
                                    <Button size="sm" onClick={handleSaveEditActivity} disabled={editActivitySaving} className="bg-blue-600 hover:bg-blue-700 text-white">
                                      {editActivitySaving ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ التعديل' : 'Save Changes')}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </Card>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        {t('no_data')}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab Content: Invoices */}
                {viewTab === 'invoices' && (
                  <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-4">
                      <Receipt className="w-5 h-5 text-primary" />
                      {t('invoices')}
                    </h3>
                    
                    {memberInvoices.length > 0 ? (
                      <div className="space-y-2">
                        {memberInvoices.map((invoice) => (
                          <Card key={invoice.id} className="p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-mono text-sm">#{invoice.id.slice(0, 8)}</p>
                                <p className="text-sm text-muted-foreground">
                                  {new Date(invoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
                                </p>
                              </div>
                              <div className="text-end">
                                <p className="font-bold text-primary">{invoice.total} {t('sar')}</p>
                                <Badge 
                                  variant="outline" 
                                  className={invoice.status === 'paid' ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-600'}
                                >
                                  {invoice.status === 'paid' ? t('paid') : t('unpaid')}
                                </Badge>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        {t('no_data')}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab Content: History */}
                {viewTab === 'history' && (
                  <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-4">
                      <History className="w-5 h-5 text-primary" />
                      {language === 'ar' ? 'سجل التجديدات' : 'Renewal History'}
                    </h3>
                    
                    {selectedMember.activities?.length > 0 ? (
                      <div className="space-y-4">
                        {/* Group by activity_id */}
                        {(() => {
                          const grouped = {};
                          selectedMember.activities.forEach(act => {
                            if (!grouped[act.activity_id]) {
                              grouped[act.activity_id] = [];
                            }
                            grouped[act.activity_id].push(act);
                          });
                          return Object.entries(grouped);
                        })().map(([activityId, periods]) => (
                          <Card key={activityId} className="p-4">
                            <h4 className="font-semibold mb-3 flex items-center gap-2">
                              <Badge className={getActivityColor(periods[0]?.activity_name)}>
                                {periods[0]?.activity_name}
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                ({periods.length} {language === 'ar' ? 'فترة' : 'period(s)'})
                              </span>
                            </h4>
                            <div className="space-y-2">
                              {periods
                                .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
                                .map((period, idx) => {
                                  const daysRemaining = getDaysRemaining(period.end_date);
                                  const isActive = daysRemaining !== null && daysRemaining > 0;
                                  
                                  return (
                                    <div 
                                      key={idx} 
                                      className={`p-3 rounded-lg border ${isActive ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <Calendar className="w-4 h-4 text-muted-foreground" />
                                          <span className="text-sm">
                                            {period.start_date} → {period.end_date}
                                          </span>
                                          {period.renewed_from && (
                                            <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">
                                              {language === 'ar' ? 'تجديد' : 'Renewal'}
                                            </Badge>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium text-primary">{period.fee} {t('sar')}</span>
                                          {isActive ? (
                                            <Badge className="bg-green-100 text-green-700 border-green-300">
                                              {language === 'ar' ? 'نشط' : 'Active'}
                                            </Badge>
                                          ) : (
                                            <Badge className="bg-gray-100 text-gray-600 border-gray-300">
                                              {language === 'ar' ? 'منتهي' : 'Expired'}
                                            </Badge>
                                          )}
                                        </div>
                                      </div>
                                      {period.invoice_id && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                          {language === 'ar' ? 'رقم الفاتورة: ' : 'Invoice: '}
                                          #{period.invoice_id.slice(0, 8)}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        {t('no_data')}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab Content: Attendance */}
                {viewTab === 'attendance' && (
                  <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-4">
                      <Calendar className="w-5 h-5 text-primary" />
                      {language === 'ar' ? 'سجل الحضور' : 'Attendance Record'}
                    </h3>
                    
                    {memberSessionQuota.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-medium text-sm text-gray-600 mb-2 flex items-center gap-1">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          {language === 'ar' ? 'حصص الاشتراك' : 'Session Quota'}
                        </h4>
                        <div className="space-y-2">
                          {memberSessionQuota.map((q, idx) => {
                            const isExpanded = expandedQuotaIdx.has(idx);
                            const scheduleDates = generateScheduleDates(q.start_date, q.end_date, q.schedule_days);
                            const attendedDates = new Set(
                              (memberAttendance?.records || [])
                                .filter(r => r.activity_id === q.activity_id && (r.status === 'present' || !r.status))
                                .map(r => r.date)
                            );
                            const todayStr = localDateStr(new Date());
                            return (
                              <div key={idx} className={`rounded-lg border ${q.exceeded ? 'bg-red-50 border-red-300' : q.remaining <= 2 ? 'bg-amber-50 border-amber-300' : 'bg-green-50 border-green-300'}`}>
                                <div className="p-3">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="font-medium text-sm">{q.activity_name}</span>
                                    <Badge className={q.exceeded ? 'bg-red-100 text-red-700' : q.remaining <= 2 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}>
                                      {q.exceeded ? (language === 'ar' ? 'استنفدت' : 'Exceeded') : `${q.remaining} ${language === 'ar' ? 'متبقي' : 'left'}`}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-3 text-xs text-gray-600">
                                    <span>{language === 'ar' ? `${q.days_per_week} أيام/أسبوع` : `${q.days_per_week} days/week`}</span>
                                    <span>{language === 'ar' ? `${q.used_sessions}/${q.total_allowed} حصة` : `${q.used_sessions}/${q.total_allowed} sessions`}</span>
                                    <span>{q.schedule_days?.join(' - ')}</span>
                                  </div>
                                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                                    <div className={`h-2 rounded-full ${q.exceeded ? 'bg-red-500' : q.remaining <= 2 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, (q.used_sessions / q.total_allowed) * 100)}%` }}></div>
                                  </div>
                                  {scheduleDates.length > 0 && (
                                    <button
                                      onClick={() => setExpandedQuotaIdx(prev => {
                                        const next = new Set(prev);
                                        if (next.has(idx)) next.delete(idx); else next.add(idx);
                                        return next;
                                      })}
                                      className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium"
                                    >
                                      <Calendar className="w-3 h-3" />
                                      {isExpanded
                                        ? (language === 'ar' ? 'إخفاء التواريخ' : 'Hide Dates')
                                        : (language === 'ar' ? `عرض التواريخ (${scheduleDates.length})` : `Show Dates (${scheduleDates.length})`)}
                                    </button>
                                  )}
                                </div>

                                {isExpanded && (
                                  <div className="border-t px-3 pb-3 pt-2">
                                    <p className="text-xs text-gray-500 mb-2">
                                      {language === 'ar'
                                        ? 'اضغط على تاريخ غير مسجّل لتسجيل الحضور'
                                        : 'Click an unregistered date to record attendance'}
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {scheduleDates.map(date => {
                                        const attended = attendedDates.has(date);
                                        const isFuture = date > todayStr;
                                        const isToday = date === todayStr;
                                        const key = `${q.activity_id}_${date}`;
                                        const isRegistering = registeringDate === key;
                                        return (
                                          <button
                                            key={date}
                                            disabled={attended || isRegistering || isFuture}
                                            onClick={() => {
                                              if (!attended && !isRegistering && !isFuture) {
                                                if (window.confirm(language === 'ar'
                                                  ? `تسجيل حضور بتاريخ ${date}؟`
                                                  : `Record attendance for ${date}?`)) {
                                                  handleRegisterDateAttendance(selectedMember.id, q.activity_id, date);
                                                }
                                              }
                                            }}
                                            title={attended
                                              ? (language === 'ar' ? 'تم التسجيل' : 'Attended')
                                              : isFuture
                                                ? (language === 'ar' ? 'موعد مستقبلي' : 'Future date')
                                                : (language === 'ar' ? 'اضغط للتسجيل' : 'Click to register')}
                                            className={`text-xs px-2 py-1 rounded-full border font-medium transition-all ${
                                              attended
                                                ? 'bg-green-100 border-green-400 text-green-700 cursor-default'
                                                : isRegistering
                                                  ? 'bg-blue-100 border-blue-300 text-blue-500 cursor-wait'
                                                  : isFuture
                                                    ? 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
                                                    : isToday
                                                      ? 'bg-blue-500 border-blue-600 text-white cursor-pointer hover:bg-blue-600 shadow-sm'
                                                      : 'bg-white border-blue-300 text-blue-700 cursor-pointer hover:bg-blue-50'
                                            }`}
                                          >
                                            {isRegistering ? '...' : attended ? `✓ ${date}` : date}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block"></span>{language === 'ar' ? 'حضر' : 'Attended'}</span>
                                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>{language === 'ar' ? 'اليوم' : 'Today'}</span>
                                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-white border border-blue-300 inline-block"></span>{language === 'ar' ? 'غائب (اضغط للتسجيل)' : 'Missed (click to register)'}</span>
                                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-200 inline-block"></span>{language === 'ar' ? 'مستقبلي' : 'Future'}</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {memberAttendance ? (
                      <div className="space-y-4">
                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="bg-blue-50 p-3 rounded-lg text-center">
                            <div className="text-2xl font-bold text-blue-600">
                              {memberAttendance.summary?.total_records || 0}
                            </div>
                            <div className="text-xs text-gray-600">
                              {language === 'ar' ? 'إجمالي السجلات' : 'Total Records'}
                            </div>
                          </div>
                          <div className="bg-green-50 p-3 rounded-lg text-center">
                            <div className="text-2xl font-bold text-green-600">
                              {memberAttendance.summary?.present_count || 0}
                            </div>
                            <div className="text-xs text-gray-600">
                              {language === 'ar' ? 'حضور' : 'Present'}
                            </div>
                          </div>
                          <div className="bg-red-50 p-3 rounded-lg text-center">
                            <div className="text-2xl font-bold text-red-600">
                              {memberAttendance.summary?.absent_count || 0}
                            </div>
                            <div className="text-xs text-gray-600">
                              {language === 'ar' ? 'غياب' : 'Absent'}
                            </div>
                          </div>
                          <div className="bg-purple-50 p-3 rounded-lg text-center">
                            <div className="text-2xl font-bold text-purple-600">
                              {memberAttendance.summary?.attendance_rate || 0}%
                            </div>
                            <div className="text-xs text-gray-600">
                              {language === 'ar' ? 'نسبة الحضور' : 'Rate'}
                            </div>
                          </div>
                        </div>

                        {/* Recent Attendance Records */}
                        {memberAttendance.records?.length > 0 ? (
                          <div className="border rounded-lg overflow-hidden">
                            <div className="bg-gray-100 px-4 py-2 font-semibold text-sm">
                              {language === 'ar' ? 'آخر السجلات' : 'Recent Records'}
                            </div>
                            <div className="max-h-[300px] overflow-y-auto">
                              {memberAttendance.records.slice(0, 20).map((record, idx) => (
                                <div 
                                  key={idx} 
                                  className={`px-4 py-2 border-b last:border-b-0 flex items-center justify-between ${
                                    (record.status === 'present' || !record.status) ? 'bg-green-50' : 'bg-red-50'
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <span className={`w-2 h-2 rounded-full ${
                                      (record.status === 'present' || !record.status) ? 'bg-green-500' : 'bg-red-500'
                                    }`}></span>
                                    <div>
                                      <div className="font-medium text-sm">{record.activity_name}</div>
                                      <div className="text-xs text-gray-500">{record.date}</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {record.check_in_time && (
                                      <span className="text-xs text-gray-500">{record.check_in_time}</span>
                                    )}
                                    <Badge className={
                                      (record.status === 'present' || !record.status)
                                        ? 'bg-green-100 text-green-700' 
                                        : 'bg-red-100 text-red-700'
                                    }>
                                      {(record.status === 'present' || !record.status)
                                        ? (language === 'ar' ? 'حاضر' : 'Present')
                                        : (language === 'ar' ? 'غائب' : 'Absent')
                                      }
                                    </Badge>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-6 text-muted-foreground bg-gray-50 rounded-lg">
                            {language === 'ar' ? 'لا توجد سجلات حضور' : 'No attendance records'}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        {language === 'ar' ? 'جاري تحميل بيانات الحضور...' : 'Loading attendance data...'}
                      </div>
                    )}
                  </div>
                )}

                {viewTab === 'purchases' && (
                  <div>
                    <h3 className="font-semibold flex items-center gap-2 mb-4">
                      <ShoppingBag className="w-5 h-5 text-green-600" />
                      {language === 'ar' ? 'مشتريات المنتجات' : 'Product Purchases'}
                    </h3>

                    {memberProductPurchases.length > 0 ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                          <div className="bg-green-50 p-3 rounded-lg text-center">
                            <div className="text-2xl font-bold text-green-600">
                              {memberProductPurchases.length}
                            </div>
                            <div className="text-xs text-gray-600">
                              {language === 'ar' ? 'عدد الفواتير' : 'Total Invoices'}
                            </div>
                          </div>
                          <div className="bg-blue-50 p-3 rounded-lg text-center">
                            <div className="text-2xl font-bold text-blue-600">
                              {memberProductPurchases.reduce((sum, inv) => sum + (inv.items || []).reduce((s, i) => s + (i.quantity || 0), 0), 0)}
                            </div>
                            <div className="text-xs text-gray-600">
                              {language === 'ar' ? 'عدد المنتجات' : 'Total Items'}
                            </div>
                          </div>
                          <div className="bg-purple-50 p-3 rounded-lg text-center">
                            <div className="text-2xl font-bold text-purple-600">
                              {memberProductPurchases.filter(i => i.status === 'paid').reduce((sum, inv) => sum + (inv.total || 0), 0).toFixed(2)}
                            </div>
                            <div className="text-xs text-gray-600">
                              {language === 'ar' ? 'إجمالي المدفوع (ر.س)' : 'Total Paid (SAR)'}
                            </div>
                          </div>
                        </div>

                        {memberProductPurchases.map((invoice) => (
                          <Card key={invoice.id} className="p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Receipt className="w-4 h-4 text-green-600" />
                                <span className="font-mono text-sm">{invoice.invoice_number || `#${(invoice.id || '').slice(0, 8)}`}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge className={invoice.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>
                                  {invoice.status === 'paid' ? (language === 'ar' ? 'مدفوعة' : 'Paid') : (language === 'ar' ? 'مسودة' : 'Draft')}
                                </Badge>
                              </div>
                            </div>
                            <div className="space-y-1">
                              {(invoice.items || []).map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm bg-gray-50 p-2 rounded">
                                  <div className="flex items-center gap-2">
                                    <Package className="w-3 h-3 text-gray-400" />
                                    <span>{item.name}</span>
                                    <span className="text-muted-foreground">x{item.quantity}</span>
                                  </div>
                                  <span className="font-medium">{item.total} {language === 'ar' ? 'ر.س' : 'SAR'}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center justify-between mt-2 pt-2 border-t">
                              <span className="text-xs text-muted-foreground">
                                {new Date(invoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
                              </span>
                              <span className="font-bold text-green-700">{invoice.total} {language === 'ar' ? 'ر.س' : 'SAR'}</span>
                            </div>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        {language === 'ar' ? 'لا توجد مشتريات منتجات لهذا العضو' : 'No product purchases for this member'}
                      </div>
                    )}
                  </div>
                )}

                {viewTab === 'tournaments' && (
                  <div className="space-y-3">
                    {memberTournaments.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        {language === 'ar' ? 'لم يشارك في أي بطولة بعد' : 'No tournament history yet'}
                      </div>
                    ) : (
                      memberTournaments.map((tn) => {
                        const posMeta = {
                          '1': { icon: '🥇', label: language === 'ar' ? 'المركز الأول' : '1st Place', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
                          '2': { icon: '🥈', label: language === 'ar' ? 'المركز الثاني' : '2nd Place', color: 'bg-gray-100 text-gray-800 border-gray-300' },
                          '3': { icon: '🥉', label: language === 'ar' ? 'المركز الثالث' : '3rd Place', color: 'bg-amber-100 text-amber-800 border-amber-400' },
                          'participation': { icon: '🎖️', label: language === 'ar' ? 'مشاركة' : 'Participation', color: 'bg-blue-100 text-blue-800 border-blue-300' },
                        };
                        const pm = tn.position ? posMeta[tn.position] : null;
                        return (
                          <Card
                            key={tn.id}
                            className="cursor-pointer hover:shadow-md transition border-2 hover:border-orange-400"
                            onClick={() => navigate(`/admin/tournaments?tid=${tn.id}`)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="flex-1 min-w-[200px]">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Trophy className="w-4 h-4 text-orange-500" />
                                    <h4 className="font-bold text-base">{tn.name}</h4>
                                  </div>
                                  <div className="text-sm text-muted-foreground space-y-1">
                                    {tn.date && (
                                      <div className="flex items-center gap-2">
                                        <Calendar className="w-3.5 h-3.5" />
                                        {tn.date}
                                      </div>
                                    )}
                                    {tn.place && (
                                      <div className="flex items-center gap-2">
                                        <span className="inline-block w-3.5">📍</span>
                                        {tn.place}
                                      </div>
                                    )}
                                    {tn.level_label && (
                                      <div className="flex items-center gap-2">
                                        <Activity className="w-3.5 h-3.5" />
                                        {tn.level_label}
                                      </div>
                                    )}
                                    {(tn.age || tn.weight) && (
                                      <div className="flex items-center gap-3 text-xs">
                                        {tn.age && <span>{language === 'ar' ? 'العمر:' : 'Age:'} {tn.age}</span>}
                                        {tn.weight && <span>{language === 'ar' ? 'الوزن:' : 'Weight:'} {tn.weight}</span>}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {pm && (
                                  <div className={`px-3 py-2 rounded-lg border-2 ${pm.color} text-center min-w-[110px]`}>
                                    <div className="text-2xl leading-none">{pm.icon}</div>
                                    <div className="text-xs font-semibold mt-1">{pm.label}</div>
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                  </div>
                )}

                {viewTab === 'freeze' && (
                  <div className="space-y-4">
                    {memberFreezeStats && (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-blue-600">{memberFreezeStats.total_days_frozen}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'أيام مستخدمة' : 'Days Used'}</div>
                        </div>
                        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-green-600">{memberFreezeStats.remaining_days}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'أيام متبقية' : 'Days Left'}</div>
                        </div>
                        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-amber-600">{memberFreezeStats.freezes_count}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'عدد التجميدات' : 'Freezes'}</div>
                        </div>
                      </div>
                    )}

                    {memberFreezeStats?.active_freeze && (
                      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-2">
                              <Snowflake className="w-4 h-4" />
                              {language === 'ar' ? 'تجميد نشط حالياً' : 'Currently Frozen'}
                            </div>
                            <div className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                              {memberFreezeStats.active_freeze.start_date} → {memberFreezeStats.active_freeze.end_date} ({memberFreezeStats.active_freeze.duration_days} {language === 'ar' ? 'يوم' : 'days'})
                            </div>
                          </div>
                          <Button variant="outline" size="sm" className="text-red-600 border-red-300" onClick={() => handleCancelFreeze(memberFreezeStats.active_freeze.id)}>
                            <PlayCircle className="w-4 h-4 me-1" />
                            {language === 'ar' ? 'إلغاء التجميد' : 'Unfreeze'}
                          </Button>
                        </div>
                      </div>
                    )}

                    {!memberFreezeStats?.active_freeze && memberFreezeStats?.remaining_days > 0 && (
                      <div className="border rounded-lg p-4 space-y-3">
                        <h4 className="font-semibold">{language === 'ar' ? 'تجميد جديد' : 'New Freeze'}</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                            <Input type="date" value={freezeForm.start_date} onChange={(e) => setFreezeForm({...freezeForm, start_date: e.target.value})} />
                          </div>
                          <div>
                            <Label>{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}</Label>
                            <Input type="date" value={freezeForm.end_date} onChange={(e) => setFreezeForm({...freezeForm, end_date: e.target.value})} />
                          </div>
                        </div>
                        <div>
                          <Label>{language === 'ar' ? 'السبب' : 'Reason'}</Label>
                          <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={freezeForm.reason} onChange={(e) => setFreezeForm({...freezeForm, reason: e.target.value})}>
                            <option value="travel">{language === 'ar' ? 'سفر' : 'Travel'}</option>
                            <option value="medical">{language === 'ar' ? 'ظرف صحي' : 'Medical'}</option>
                            <option value="personal">{language === 'ar' ? 'ظرف شخصي' : 'Personal'}</option>
                            <option value="other">{language === 'ar' ? 'أخرى' : 'Other'}</option>
                          </select>
                        </div>
                        <Button onClick={handleCreateFreeze} disabled={freezeLoading} className="w-full">
                          {freezeLoading ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Snowflake className="w-4 h-4 me-2" />}
                          {language === 'ar' ? 'تجميد العضوية' : 'Freeze Membership'}
                        </Button>
                      </div>
                    )}

                    <div>
                      <h4 className="font-semibold mb-2">{language === 'ar' ? 'سجل التجميد' : 'Freeze History'}</h4>
                      {memberFreezes.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">{language === 'ar' ? 'لا يوجد سجل تجميد' : 'No freeze history'}</p>
                      ) : (
                        <div className="space-y-2">
                          {memberFreezes.map((f) => (
                            <div key={f.id} className={`border rounded-lg p-3 ${f.status === 'active' ? 'border-blue-300 bg-blue-50/50 dark:bg-blue-900/10' : 'border-gray-200'}`}>
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="text-sm font-medium">{f.start_date} → {f.end_date}</span>
                                  <span className="text-xs text-muted-foreground ms-2">({f.duration_days} {language === 'ar' ? 'يوم' : 'days'})</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge className={f.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}>
                                    {f.status === 'active' ? (language === 'ar' ? 'نشط' : 'Active') : (language === 'ar' ? 'ملغي' : 'Cancelled')}
                                  </Badge>
                                  {f.status === 'active' && (
                                    <Button variant="ghost" size="sm" className="text-red-500 h-7 px-2" onClick={() => handleCancelFreeze(f.id)}>
                                      <X className="w-3 h-3" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {getReasonLabel(f.reason)} • {language === 'ar' ? 'بواسطة' : 'by'} {f.created_by}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Renewal Dialog */}
        <Dialog open={isRenewalDialogOpen} onOpenChange={setIsRenewalDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCcw className="w-5 h-5 text-primary" />
                {language === 'ar' ? 'تجديد الاشتراك' : 'Renew Subscription'}
              </DialogTitle>
            </DialogHeader>
            
            {renewalActivity && (
              <div className="space-y-4">
                {/* Activity info */}
                <div className="p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className={getActivityColor(renewalActivity.activity_name)}>
                      {renewalActivity.activity_name}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'العضو: ' : 'Member: '}
                    <span className="font-medium text-foreground">
                      {language === 'ar' ? selectedMember?.name_ar : selectedMember?.name}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'الاشتراك السابق انتهى في: ' : 'Previous subscription ended: '}
                    <span className="font-medium text-foreground">{renewalActivity.end_date}</span>
                  </p>
                </div>

                {/* Renewal form */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                    <Input
                      type="date"
                      value={renewalForm.start_date}
                      onChange={(e) => setRenewalForm({...renewalForm, start_date: e.target.value})}
                      className="h-12"
                      data-testid="renewal-start-date"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}</Label>
                    <Input
                      type="date"
                      value={renewalForm.end_date}
                      onChange={(e) => setRenewalForm({...renewalForm, end_date: e.target.value})}
                      className="h-12"
                      data-testid="renewal-end-date"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'الرسوم' : 'Fee'} ({t('sar')})</Label>
                  <Input
                    type="number"
                    value={renewalForm.fee}
                    onChange={(e) => setRenewalForm({...renewalForm, fee: parseFloat(e.target.value) || 0})}
                    data-testid="renewal-fee"
                  />
                </div>

                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</Label>
                  <Select 
                    value={renewalForm.payment_method} 
                    onValueChange={(value) => setRenewalForm({...renewalForm, payment_method: value})}
                  >
                    <SelectTrigger data-testid="renewal-payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{language === 'ar' ? 'نقداً' : 'Cash'}</SelectItem>
                      <SelectItem value="card">{language === 'ar' ? 'بطاقة' : 'Card'}</SelectItem>
                      <SelectItem value="transfer">{language === 'ar' ? 'تحويل بنكي' : 'Transfer'}</SelectItem>
                      <SelectItem value="tabby">Tabby</SelectItem>
                      <SelectItem value="tamara">Tamara</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
                  <Textarea
                    value={renewalForm.notes}
                    onChange={(e) => setRenewalForm({...renewalForm, notes: e.target.value})}
                    placeholder={language === 'ar' ? 'ملاحظات اختيارية...' : 'Optional notes...'}
                    data-testid="renewal-notes"
                  />
                </div>

                {/* Total calculation */}
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="flex justify-between text-sm mb-1">
                    <span>{language === 'ar' ? 'المبلغ' : 'Amount'}</span>
                    <span>{renewalForm.fee} {t('sar')}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{language === 'ar' ? 'الضريبة (15%)' : 'VAT (15%)'}</span>
                    <span>{(renewalForm.fee * 0.15).toFixed(2)} {t('sar')}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t pt-2 mt-2">
                    <span>{language === 'ar' ? 'الإجمالي' : 'Total'}</span>
                    <span className="text-primary">{(renewalForm.fee * 1.15).toFixed(2)} {t('sar')}</span>
                  </div>
                </div>
              </div>
            )}
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRenewalDialogOpen(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={handleRenewal} disabled={saving} data-testid="confirm-renewal-btn">
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {language === 'ar' ? 'تأكيد التجديد وإنشاء فاتورة' : 'Confirm Renewal & Create Invoice'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Activity Dialog */}
        <Dialog open={isActivityDialogOpen} onOpenChange={setIsActivityDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('add_activity')}</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('activity_name')}</Label>
                <Select 
                  value={activityForm.activity_id} 
                  onValueChange={(value) => {
                    const activity = activities.find(a => a.id === value);
                    setActivityForm({
                      ...activityForm, 
                      activity_id: value,
                      fee: activity?.monthly_fee?.toString() || ''
                    });
                  }}
                >
                  <SelectTrigger data-testid="select-activity">
                    <SelectValue placeholder={t('activity_name')} />
                  </SelectTrigger>
                  <SelectContent>
                    {activities.map(activity => (
                      <SelectItem key={activity.id} value={activity.id}>
                        {language === 'ar' ? activity.name_ar : activity.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('start_date')}</Label>
                  <Input
                    type="date"
                    value={activityForm.start_date}
                    onChange={(e) => setActivityForm({...activityForm, start_date: e.target.value})}
                    data-testid="activity-start-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('end_date')}</Label>
                  <Input
                    type="date"
                    value={activityForm.end_date}
                    onChange={(e) => setActivityForm({...activityForm, end_date: e.target.value})}
                    data-testid="activity-end-date"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>{t('monthly_fee')} ({t('sar')})</Label>
                <Input
                  type="number"
                  value={activityForm.fee}
                  onChange={(e) => setActivityForm({...activityForm, fee: e.target.value})}
                  data-testid="activity-fee"
                />
              </div>
              
              <div className="space-y-2">
                <Label>{t('coaches')}</Label>
                <Select 
                  value={activityForm.coach_id} 
                  onValueChange={(value) => setActivityForm({...activityForm, coach_id: value})}
                >
                  <SelectTrigger data-testid="select-coach">
                    <SelectValue placeholder={t('coaches')} />
                  </SelectTrigger>
                  <SelectContent>
                    {coaches.map(coach => (
                      <SelectItem key={coach.id} value={coach.id}>
                        {language === 'ar' ? coach.name_ar : coach.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsActivityDialogOpen(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={handleAddActivity} disabled={saving} data-testid="save-activity-btn">
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {t('save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Member Card Dialog */}
        <Dialog open={isMemberCardDialogOpen} onOpenChange={setIsMemberCardDialogOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                {language === 'ar' ? 'بطاقة العضوية' : 'Member Card'}
              </DialogTitle>
            </DialogHeader>
            
            {memberCardData && (
              <div className="space-y-4">
                {/* Card Preview - Same design as MemberCardPage */}
                <div className="flex flex-nowrap gap-3 justify-center items-stretch p-4 bg-gray-100 rounded-lg overflow-x-auto">
                  {/* Member Card - Orange/Amber theme like MemberCardPage */}
                  <div className="w-[300px] shrink-0 rounded-xl overflow-hidden shadow-lg bg-white">
                    {/* Header - Orange gradient */}
                    <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-3 text-white">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-base font-bold">شركة اداء الابطال العالمية للرياضة</h3>
                          <p className="text-orange-100 text-xs">Global Champions Sports Performance</p>
                        </div>
                        <div className="text-3xl">🏆</div>
                      </div>
                    </div>
                    
                    {/* Body */}
                    <div className="p-4 flex gap-4">
                      {/* QR Code with Dates */}
                      <div className="flex flex-col items-center shrink-0">
                        <div className="bg-white p-2 rounded-lg shadow-inner border-2 border-orange-100">
                          <img 
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(memberCardData.member_code || memberCardData.id)}`}
                            alt="QR"
                            className="w-24 h-24"
                          />
                        </div>
                        {/* Dates under QR */}
                        {memberCardData.activities?.[0] && (
                          <div className="text-center mt-2 text-xs">
                            <p className="text-gray-600">
                              <span className="font-bold">من:</span> {memberCardData.activities[0].start_date || '----'}
                            </p>
                            <p className="text-gray-600">
                              <span className="font-bold">إلى:</span> {memberCardData.activities[0].end_date || '----'}
                            </p>
                            {memberCardData.activities[0].schedule && (
                              <p className="text-orange-600 bg-orange-50 rounded px-2 py-1 mt-1 text-[10px]">
                                📅 {memberCardData.activities[0].schedule}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1">
                        <p className="text-xs text-gray-500 mb-1">{language === 'ar' ? 'الاسم' : 'Name'}</p>
                        <p className="font-bold text-gray-800 text-lg mb-2">{(memberCardData.name_ar || memberCardData.name || '').split('+').map((n, i) => <span key={i}>{i > 0 && <br/>}{n.trim()}</span>)}</p>
                        
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-gray-500">{language === 'ar' ? 'رقم العضوية:' : 'ID:'}</span>
                          <span className="font-bold text-orange-600 text-lg">#{memberCardData.member_code || '---'}</span>
                        </div>
                        
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs text-gray-500">{language === 'ar' ? 'الجوال:' : 'Phone:'}</span>
                          <span className="text-sm" dir="ltr">{memberCardData.phone || '-'}</span>
                        </div>

                        {(memberCardData.guardian_name_ar || memberCardData.guardian_name) && (
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-gray-500">ولي الأمر:</span>
                            <span className="text-sm font-medium text-gray-700">{memberCardData.guardian_name_ar || memberCardData.guardian_name}</span>
                          </div>
                        )}
                        
                        {/* Activities */}
                        {memberCardData.activities?.length > 0 && (
                          <div className="border-t border-dashed pt-2">
                            <p className="text-xs text-gray-500 mb-1">{language === 'ar' ? 'الأنشطة المسجلة' : 'Activities'}</p>
                            {memberCardData.activities.slice(0, 2).map((act, idx) => (
                              <div 
                                key={idx} 
                                className={`text-xs px-2 py-1 rounded mb-1 ${
                                  act.status === 'active' 
                                    ? 'bg-green-100 border-r-2 border-green-500' 
                                    : 'bg-red-100 border-r-2 border-red-500'
                                }`}
                              >
                                <span className="font-medium">{act.status === 'active' ? '✓' : '✗'} {act.activity_name}</span>
                                <span className={`float-left font-bold ${act.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>
                                  {act.status === 'active' ? 'ساري' : 'منتهي'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Footer - Terms */}
                    <div className="bg-gray-50 px-4 py-2 border-t border-dashed text-[10px] text-gray-600">
                      <p className="font-bold text-gray-700 mb-1">شروط وأحكام:</p>
                      <p>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</p>
                      <p>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</p>
                    </div>
                  </div>
                  
                  {/* Logo Card */}
                  <div className="w-[300px] shrink-0 h-auto rounded-xl overflow-hidden shadow-lg bg-white flex flex-col items-center justify-center p-4 gap-2">
                    <img src="/images/academy-logo.png" alt="شعار الأكاديمية" className="max-w-[80%] max-h-[55%] object-contain" />
                    <p className="text-sm font-semibold text-gray-700">📞 0566238384</p>
                    <div className="text-center text-xs text-red-600 font-bold bg-red-50 border border-red-300 rounded px-3 py-2">
                      ⚠️ في حال فقدان كرت العضوية،<br/>يتم إصدار كرت جديد برسوم 10 ر.س
                    </div>
                  </div>
                </div>
                
                {/* Member Info Summary */}
                <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg text-sm">
                  <div>
                    <span className="text-gray-500">{language === 'ar' ? 'الاسم:' : 'Name:'}</span>
                    <span className="font-medium ms-2">{memberCardData.name_ar || memberCardData.name}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">{language === 'ar' ? 'رقم العضوية:' : 'Member ID:'}</span>
                    <span className="font-bold text-primary ms-2">#{memberCardData.member_code}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">{language === 'ar' ? 'الجوال:' : 'Phone:'}</span>
                    <span className="font-medium ms-2" dir="ltr">{memberCardData.phone}</span>
                  </div>
                  {(memberCardData.guardian_name_ar || memberCardData.guardian_name) && (
                    <div>
                      <span className="text-gray-500">ولي الأمر:</span>
                      <span className="font-medium ms-2">{memberCardData.guardian_name_ar || memberCardData.guardian_name}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-gray-500">{language === 'ar' ? 'الأنشطة:' : 'Activities:'}</span>
                    <span className="font-medium ms-2">{memberCardData.activities?.length || 0}</span>
                  </div>
                </div>
              </div>
            )}
            
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setIsMemberCardDialogOpen(false)}>
                {language === 'ar' ? 'إغلاق' : 'Close'}
              </Button>
              <Button onClick={printMemberCard} className="gap-2 bg-orange-500 hover:bg-orange-600">
                <Printer className="w-4 h-4" />
                {language === 'ar' ? 'طباعة البطاقة' : 'Print Card'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default MembersPage;
