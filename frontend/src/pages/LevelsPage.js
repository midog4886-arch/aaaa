import React, { useState, useEffect, useMemo } from 'react';
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
import { levelsAPI, membersAPI, branchesAPI, activitiesAPI, attendanceAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, Edit, Trash2, Loader2, Layers, Users, Dumbbell, UserPlus, UserMinus, Search,
  ChevronDown, ChevronUp, ChevronRight, Clock, AlertTriangle, ArrowRight, ArrowLeft, Home,
  GripVertical, Move, ArrowUpDown, SlidersHorizontal, TrendingUp, BarChart3, CheckCircle, Circle, UserCheck, Printer
} from 'lucide-react';

// Main activity types with Arabic names
const MAIN_ACTIVITIES = [
  { id: 'swimming', name_ar: 'السباحة', name_en: 'Swimming', icon: '🏊', color: 'bg-blue-500', maxCapacity: 6 },
  { id: 'football', name_ar: 'كرة القدم', name_en: 'Football', icon: '⚽', color: 'bg-green-500', maxCapacity: 15 },
  { id: 'karate', name_ar: 'الكاراتيه', name_en: 'Karate', icon: '🥋', color: 'bg-red-500', maxCapacity: 12 }
];

// Time slots
const TIME_SLOTS = ['الساعة 3', 'الساعة 4', 'الساعة 5', 'الساعة 6', 'الساعة 7', 'الساعة 8'];

export const LevelsPage = () => {
  const { t, language } = useLanguage();
  const { user, selectedBranchId } = useAuth();
  const isAdmin = user?.is_admin === true;
  
  const [levels, setLevels] = useState([]);
  const [members, setMembers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Dialog states
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isMembersDialogOpen, setIsMembersDialogOpen] = useState(false);
  const [isTimeSlotDialogOpen, setIsTimeSlotDialogOpen] = useState(false);
  
  const [selectedLevel, setSelectedLevel] = useState(null);
  const [selectedMainActivity, setSelectedMainActivity] = useState(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterActivity, setFilterActivity] = useState('');
  const [filterTime, setFilterTime] = useState('');
  
  // Navigation states for drill-down view
  const [currentView, setCurrentView] = useState('days'); // 'days' | 'activities' | 'times' | 'levels'
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedActivityId, setSelectedActivityId] = useState(null);
  const [selectedTimeSlotKey, setSelectedTimeSlotKey] = useState(null);
  
  // Drag and drop states
  const [draggedMember, setDraggedMember] = useState(null);
  const [draggedFromLevel, setDraggedFromLevel] = useState(null);
  const [dropTargetLevel, setDropTargetLevel] = useState(null);
  
  // Time slot edit/delete dialog
  const [isTimeSlotEditDialogOpen, setIsTimeSlotEditDialogOpen] = useState(false);
  const [editingTimeSlot, setEditingTimeSlot] = useState({ oldName: '', newName: '', activityId: '' });
  
  // Activity edit dialog
  const [isActivityEditDialogOpen, setIsActivityEditDialogOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState({ id: '', name_ar: '', name_en: '', icon: '', color: '' });
  
  const [attendanceMap, setAttendanceMap] = useState({});
  const [attendanceLoading, setAttendanceLoading] = useState({});

  // Custom activities (user-defined names)
  const [customActivityNames, setCustomActivityNames] = useState(() => {
    const saved = localStorage.getItem('customActivityNames');
    return saved ? JSON.parse(saved) : {};
  });
  
  // Add new time slot dialog
  const [isAddTimeSlotDialogOpen, setIsAddTimeSlotDialogOpen] = useState(false);
  const [newTimeSlotName, setNewTimeSlotName] = useState('');
  const [dialogActivityId, setDialogActivityId] = useState('');

  // Print schedule dialog
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [printDays, setPrintDays] = useState(['saturday']);
  const [printActivity, setPrintActivity] = useState('swimming');
  
  // Search, filter, sort for main activities view
  const [levelSearchTerm, setLevelSearchTerm] = useState('');
  const [filterActivityType, setFilterActivityType] = useState('all');
  const [sortLevelsBy, setSortLevelsBy] = useState('name');

  // Expanded states for accordion (fallback)
  const [expandedActivities, setExpandedActivities] = useState({});
  const [expandedTimeSlots, setExpandedTimeSlots] = useState({});

  const levelNumbers = [1, 2, 3, 4, 5, 6];

  const [formData, setFormData] = useState({
    level_number: 1,
    main_activity: '',
    time_slot: '',
    activity_name: '',
    custom_name: '',
    description: '',
    capacity: 10,
    members: [],
    branch_id: 'all'
  });

  const [timeSlotForm, setTimeSlotForm] = useState({
    name: ''
  });

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  const loadData = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const today = new Date().toISOString().split('T')[0];
      const [levelsRes, membersRes, branchesRes, activitiesRes, attendanceRes] = await Promise.all([
        levelsAPI.getAll(branchParams),
        membersAPI.getAll(branchParams),
        isAdmin ? branchesAPI.getAll() : Promise.resolve({ data: [] }),
        activitiesAPI.getAll(),
        attendanceAPI.getAll({ date: today }).catch(() => ({ data: [] }))
      ]);
      setLevels(levelsRes.data);
      setMembers(membersRes.data);
      setBranches(branchesRes.data || []);
      setActivities(activitiesRes.data || []);
      
      const todayRecords = attendanceRes.data || [];
      const attMap = {};
      const allLevels = levelsRes.data || [];
      todayRecords.forEach(rec => {
        allLevels.forEach(lvl => {
          if ((lvl.members || []).some(m => m.member_id === rec.member_id)) {
            attMap[`${rec.member_id}_${lvl.id}`] = true;
          }
        });
      });
      setAttendanceMap(attMap);
      
      // Auto expand first activity
      if (levelsRes.data.length > 0) {
        const firstActivity = getMainActivityFromName(levelsRes.data[0]?.activity_name);
        if (firstActivity) {
          setExpandedActivities({ [firstActivity]: true });
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error(t('error', 'Error'));
    } finally {
      setLoading(false);
    }
  };

  // Parse activity_name to extract main activity, time slot, and level info
  const parseActivityName = (activityName) => {
    if (!activityName) return { mainActivity: 'other', timeSlot: '', levelInfo: '' };
    
    const name = activityName.toLowerCase();
    let mainActivity = 'other';
    
    if (name.includes('سباح') || name.includes('swim')) {
      mainActivity = 'swimming';
    } else if (name.includes('قدم') || name.includes('foot') || name.includes('كرة')) {
      mainActivity = 'football';
    } else if (name.includes('كارات') || name.includes('karate')) {
      mainActivity = 'karate';
    }
    
    // Extract time slot
    // First try format "النشاط - الوقت"
    let timeSlot = '';
    if (activityName.includes(' - ')) {
      const parts = activityName.split(' - ');
      timeSlot = parts[1] || parts[0];
    } else {
      // Try to extract time pattern (e.g., "الساعة 4", "الساعه 5")
      const timeMatch = activityName.match(/الساع[ةه]\s*(\d+)/i);
      timeSlot = timeMatch ? `الساعة ${timeMatch[1]}` : activityName;
    }
    
    return { mainActivity, timeSlot, original: activityName };
  };

  const getMainActivityFromName = (activityName) => {
    return parseActivityName(activityName).mainActivity;
  };

  const DAY_ARABIC_MAP = {
    'saturday': ['السبت', 'سبت'],
    'sunday': ['الأحد', 'الاحد', 'أحد', 'احد'],
    'monday': ['الاثنين', 'الإثنين', 'اثنين', 'إثنين'],
    'tuesday': ['الثلاثاء', 'ثلاثاء'],
    'wednesday': ['الأربعاء', 'الاربعاء', 'أربعاء', 'اربعاء'],
    'thursday': ['الخميس', 'خميس'],
    'friday': ['الجمعة', 'جمعة'],
  };

  const memberMatchesDay = (memberDetail, dayId) => {
    if (!dayId || !memberDetail?.schedule) return true;
    const schedule = memberDetail.schedule;
    const dayNames = DAY_ARABIC_MAP[dayId] || [];
    return dayNames.some(name => schedule.includes(name));
  };

  const getFilteredLevelForDay = (level) => {
    if (!selectedDay) return level;
    const filteredDetails = (level.members_details || []).filter(m => memberMatchesDay(m, selectedDay));
    const filteredMembers = filteredDetails.map(m => m.member_id);
    return { ...level, members: filteredMembers, members_details: filteredDetails };
  };

  // Group levels hierarchically: Main Activity -> Time Slot -> Levels
  const groupedLevels = levels.reduce((acc, level) => {
    const { mainActivity, timeSlot } = parseActivityName(level.activity_name);
    
    if (!acc[mainActivity]) {
      acc[mainActivity] = {};
    }
    
    const slotKey = timeSlot || level.activity_name || 'أخرى';
    if (!acc[mainActivity][slotKey]) {
      acc[mainActivity][slotKey] = [];
    }
    
    acc[mainActivity][slotKey].push(level);
    return acc;
  }, {});

  // Sort levels within each time slot
  Object.keys(groupedLevels).forEach(activity => {
    Object.keys(groupedLevels[activity]).forEach(timeSlot => {
      groupedLevels[activity][timeSlot].sort((a, b) => a.level_number - b.level_number);
    });
  });

  const getMainActivityInfo = (activityId) => {
    const baseActivity = MAIN_ACTIVITIES.find(a => a.id === activityId) || {
      id: 'other',
      name_ar: 'أخرى',
      name_en: 'Other',
      icon: '📋',
      color: 'bg-gray-500',
      maxCapacity: 10
    };
    
    // Apply custom names if available
    const customNames = customActivityNames[activityId];
    if (customNames) {
      return {
        ...baseActivity,
        name_ar: customNames.name_ar || baseActivity.name_ar,
        name_en: customNames.name_en || baseActivity.name_en,
        icon: customNames.icon || baseActivity.icon
      };
    }
    return baseActivity;
  };

  const getLevelColor = (levelNum) => {
    const colors = {
      1: 'bg-purple-500',
      2: 'bg-green-500',
      3: 'bg-blue-500',
      4: 'bg-yellow-500',
      5: 'bg-orange-500',
      6: 'bg-red-500'
    };
    return colors[levelNum] || 'bg-gray-500';
  };

  const toggleActivity = (activityId) => {
    setExpandedActivities(prev => ({
      ...prev,
      [activityId]: !prev[activityId]
    }));
  };

  const toggleTimeSlot = (activityId, timeSlot) => {
    const key = `${activityId}-${timeSlot}`;
    setExpandedTimeSlots(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const WEEKDAYS = [
    { id: 'saturday', name_ar: 'السبت', name_en: 'Saturday', icon: '📅', color: 'from-blue-500 to-blue-600' },
    { id: 'sunday', name_ar: 'الأحد', name_en: 'Sunday', icon: '📅', color: 'from-green-500 to-green-600' },
    { id: 'monday', name_ar: 'الاثنين', name_en: 'Monday', icon: '📅', color: 'from-purple-500 to-purple-600' },
    { id: 'tuesday', name_ar: 'الثلاثاء', name_en: 'Tuesday', icon: '📅', color: 'from-orange-500 to-orange-600' },
    { id: 'wednesday', name_ar: 'الأربعاء', name_en: 'Wednesday', icon: '📅', color: 'from-red-500 to-red-600' },
    { id: 'thursday', name_ar: 'الخميس', name_en: 'Thursday', icon: '📅', color: 'from-teal-500 to-teal-600' },
    { id: 'friday', name_ar: 'الجمعة', name_en: 'Friday', icon: '📅', color: 'from-amber-500 to-amber-600' },
  ];

  // Navigate to activities view (after selecting day)
  const navigateToActivities = (day) => {
    setSelectedDay(day);
    setCurrentView('activities');
  };

  // Navigate to time slots view
  const navigateToTimes = (activityId) => {
    setSelectedActivityId(activityId);
    setCurrentView('times');
  };

  // Navigate to levels view
  const navigateToLevels = (activityId, timeSlot) => {
    setSelectedActivityId(activityId);
    setSelectedTimeSlotKey(timeSlot);
    setCurrentView('levels');
  };

  // Go back navigation
  const goBack = () => {
    if (currentView === 'levels') {
      setCurrentView('times');
      setSelectedTimeSlotKey(null);
    } else if (currentView === 'times') {
      setCurrentView('activities');
      setSelectedActivityId(null);
    } else if (currentView === 'activities') {
      setCurrentView('days');
      setSelectedDay(null);
    }
  };

  // Go to home (days view)
  const goHome = () => {
    setCurrentView('days');
    setSelectedDay(null);
    setSelectedActivityId(null);
    setSelectedTimeSlotKey(null);
  };

  // Get current activity info
  const getCurrentActivity = () => {
    return getMainActivityInfo(selectedActivityId);
  };

  // Get time slots for selected activity
  const getTimeSlotsForActivity = (activityId) => {
    const activityLevels = groupedLevels[activityId] || {};
    return Object.keys(activityLevels);
  };

  // Get levels for selected time slot
  const getLevelsForTimeSlot = (activityId, timeSlot) => {
    const activityLevels = groupedLevels[activityId] || {};
    return activityLevels[timeSlot] || [];
  };

  // ========== Time Slot Edit/Delete Functions ==========
  
  // Open edit dialog for time slot
  const handleEditTimeSlot = (e, activityId, timeSlot) => {
    e.stopPropagation();
    setEditingTimeSlot({ oldName: timeSlot, newName: timeSlot, activityId });
    setIsTimeSlotEditDialogOpen(true);
  };

  // Save time slot name change
  const handleSaveTimeSlotEdit = async () => {
    if (!editingTimeSlot.newName.trim()) {
      toast.error(t('أدخل اسم الوقت', 'Enter time name'));
      return;
    }
    
    setSaving(true);
    try {
      const levelsToUpdate = getLevelsForTimeSlot(editingTimeSlot.activityId, editingTimeSlot.oldName);
      
      for (const level of levelsToUpdate) {
        let newActivityName = editingTimeSlot.newName.trim();
        if (level.activity_name && level.activity_name.includes(' - ')) {
          const prefix = level.activity_name.split(' - ')[0];
          newActivityName = `${prefix} - ${newActivityName}`;
        } else {
          const actId = editingTimeSlot.activityId;
          if (actId === 'swimming') {
            newActivityName = `سباحة - ${newActivityName}`;
          } else if (actId === 'football') {
            newActivityName = `كرة قدم - ${newActivityName}`;
          } else if (actId === 'karate') {
            newActivityName = `كاراتيه - ${newActivityName}`;
          }
        }
        await levelsAPI.update(level.id, {
          ...level,
          activity_name: newActivityName
        });
      }
      
      toast.success(t('تم تحديث اسم الوقت', 'Time slot name updated'));
      setIsTimeSlotEditDialogOpen(false);
      loadData();
    } catch (error) {
      toast.error(t('error', 'Error'));
    } finally {
      setSaving(false);
    }
  };

  // Delete entire time slot (all levels within it)
  const handleDeleteTimeSlot = async (e, activityId, timeSlot) => {
    e.stopPropagation();
    
    const levelsInSlot = getLevelsForTimeSlot(activityId, timeSlot);
    const totalMembers = levelsInSlot.reduce((sum, l) => sum + (l.members || []).length, 0);
    
    const confirmMsg = totalMembers > 0 
      ? t(`هل أنت متأكد من حذف "${timeSlot}" وجميع مستوياته (${levelsInSlot.length})؟ يوجد ${totalMembers} لاعب مسجل.`,
          `Are you sure you want to delete "${timeSlot}" and all its levels (${levelsInSlot.length})? ${totalMembers} players are enrolled.`)
      : t(`هل أنت متأكد من حذف "${timeSlot}" وجميع مستوياته (${levelsInSlot.length})؟`,
          `Are you sure you want to delete "${timeSlot}" and all its levels (${levelsInSlot.length})?`);
    
    if (!window.confirm(confirmMsg)) {
      return;
    }
    
    try {
      for (const level of levelsInSlot) {
        await levelsAPI.delete(level.id);
      }
      toast.success(t('تم حذف الوقت وجميع مستوياته', 'Time slot and all its levels deleted'));
      loadData();
    } catch (error) {
      toast.error(t('error', 'Error'));
    }
  };

  // ========== Activity Edit Functions ==========
  
  // Open edit dialog for activity
  const handleEditActivity = (e, activityId) => {
    e.stopPropagation();
    const activity = getMainActivityInfo(activityId);
    setEditingActivity({
      id: activityId,
      name_ar: activity.name_ar,
      name_en: activity.name_en,
      icon: activity.icon,
      color: activity.color
    });
    setIsActivityEditDialogOpen(true);
  };

  // Save activity name change
  const handleSaveActivityEdit = () => {
    if (!editingActivity.name_ar.trim()) {
      toast.error(t('أدخل اسم النشاط', 'Enter activity name'));
      return;
    }
    
    const newCustomNames = {
      ...customActivityNames,
      [editingActivity.id]: {
        name_ar: editingActivity.name_ar,
        name_en: editingActivity.name_en,
        icon: editingActivity.icon
      }
    };
    
    setCustomActivityNames(newCustomNames);
    localStorage.setItem('customActivityNames', JSON.stringify(newCustomNames));
    
    toast.success(t('تم تحديث اسم النشاط', 'Activity name updated'));
    setIsActivityEditDialogOpen(false);
  };

  // ========== Add New Time Slot ==========
  
  // Open dialog to add new time slot
  const openAddTimeSlotDialog = (preselectedActivityId) => {
    setNewTimeSlotName('');
    setDialogActivityId(preselectedActivityId || selectedActivityId || '');
    setIsAddTimeSlotDialogOpen(true);
  };

  // Create a new time slot with a default level
  const handleAddNewTimeSlot = async () => {
    if (!newTimeSlotName.trim()) {
      toast.error(t('أدخل اسم الساعة', 'Enter time slot name'));
      return;
    }
    
    const effectiveActivityId = dialogActivityId || selectedActivityId;
    if (!effectiveActivityId) {
      toast.error(t('اختر نشاط أولاً', 'Select an activity first'));
      return;
    }
    
    setSaving(true);
    try {
      // Get activity info to include the activity name prefix
      const activity = getMainActivityInfo(effectiveActivityId);
      
      // Create activity_name that includes both the activity and time slot
      let activityName = newTimeSlotName.trim();
      
      // Only add prefix if the time slot name doesn't already contain activity keywords
      const hasActivityKeyword = activityName.toLowerCase().includes('سباح') || 
                                  activityName.toLowerCase().includes('كر') ||
                                  activityName.toLowerCase().includes('كارات') ||
                                  activityName.toLowerCase().includes('swim') ||
                                  activityName.toLowerCase().includes('foot') ||
                                  activityName.toLowerCase().includes('karat');
      
      if (!hasActivityKeyword && effectiveActivityId !== 'other') {
        if (effectiveActivityId === 'swimming') {
          activityName = `سباحة - ${newTimeSlotName.trim()}`;
        } else if (effectiveActivityId === 'football') {
          activityName = `كرة قدم - ${newTimeSlotName.trim()}`;
        } else if (effectiveActivityId === 'karate') {
          activityName = `كاراتيه - ${newTimeSlotName.trim()}`;
        }
      }
      
      const newLevel = {
        level_number: 1,
        activity_name: activityName,
        branch_id: selectedBranchId || 'all',
        capacity: effectiveActivityId === 'swimming' ? 6 : 10,
        members: []
      };
      
      await levelsAPI.create(newLevel);
      
      toast.success(t(`تم إضافة "${newTimeSlotName}" بنجاح`, `"${newTimeSlotName}" added successfully`));
      setIsAddTimeSlotDialogOpen(false);
      setNewTimeSlotName('');
      loadData();
    } catch (error) {
      console.error('Error creating time slot:', error);
      toast.error(t('فشل في إضافة الساعة', 'Failed to add time slot'));
    } finally {
      setSaving(false);
    }
  };

  // ========== Print Schedule ==========

  const handlePrintSchedule = () => {
    if (printDays.length === 0) {
      toast.error(t('اختر يوماً واحداً على الأقل', 'Select at least one day'));
      return;
    }
    const selectedDayInfos = WEEKDAYS.filter(d => printDays.includes(d.id));
    const daysLabel = selectedDayInfos.map(d => d.name_ar).join(' / ');
    const activityInfo = getMainActivityInfo(printActivity);
    const activityLevels = groupedLevels[printActivity] || {};
    const timeSlots = Object.keys(activityLevels)
      .sort((a, b) => {
        const numA = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
        const numB = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
        return numA - numB;
      });
    const allLevelNumbers = [...new Set(
      timeSlots.flatMap(slot => activityLevels[slot].map(l => l.level_number))
    )].sort((a, b) => a - b);

    if (timeSlots.length === 0) {
      toast.error(t('لا توجد بيانات للطباعة', 'No data to print'));
      return;
    }

    const escapeHtml = str => String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const today = new Date();
    const dateStr = today.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });
    const branchName = branches.length > 0 && selectedBranchId && selectedBranchId !== 'all'
      ? (branches.find(b => b.id === selectedBranchId)?.name_ar || branches.find(b => b.id === selectedBranchId)?.name || '')
      : (branches.length > 0 ? branches[0]?.name_ar || branches[0]?.name || '' : (user?.branch_name || ''));

    const levelColors = {
      1: '#7c3aed',
      2: '#16a34a',
      3: '#2563eb',
      4: '#ca8a04',
      5: '#ea580c',
      6: '#dc2626'
    };

    const memberMatchesAnyDay = (m) => printDays.some(day => memberMatchesDay(m, day));

    const tableRows = timeSlots.map(slot => {
      const levelCells = allLevelNumbers.map(levelNum => {
        const levelObj = (activityLevels[slot] || []).find(l => l.level_number === levelNum);
        if (!levelObj) return `<td style="border:1px solid #ccc;padding:10px;vertical-align:top;background:#f9f9f9;"></td>`;

        const membersForDays = (levelObj.members_details || []).filter(memberMatchesAnyDay);
        const memberNames = membersForDays.map(m => `<div style="padding:3px 0;border-bottom:1px dotted #ddd;font-size:18px;">${escapeHtml(m.member_name || m.name_ar || m.name)}</div>`).join('');
        const count = membersForDays.length;
        const bgColor = count === 0 ? '#f9f9f9' : '#fff';
        return `<td style="border:1px solid #ccc;padding:10px;vertical-align:top;background:${bgColor};min-width:120px;">
          <div style="font-size:13px;color:#666;margin-bottom:5px;">(${count})</div>
          ${memberNames || '<span style="color:#bbb;font-size:13px;">-</span>'}
        </td>`;
      }).join('');

      return `<tr>
        <td style="border:1px solid #ccc;padding:10px;font-weight:bold;background:#f0f4f8;white-space:nowrap;text-align:center;font-size:17px;">${slot}</td>
        ${levelCells}
      </tr>`;
    }).join('');

    const headerCells = allLevelNumbers.map(n => {
      const color = levelColors[n] || '#555';
      return `<th style="border:1px solid #ccc;padding:10px;background:${color};color:#fff;text-align:center;white-space:nowrap;font-size:17px;">المستوى ${n}</th>`;
    }).join('');

    const totalCount = timeSlots.reduce((sum, slot) =>
      sum + (activityLevels[slot] || []).reduce((s, l) =>
        s + (l.members_details || []).filter(memberMatchesAnyDay).length, 0), 0);

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>جدول ${activityInfo.name_ar} - ${daysLabel}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; direction: rtl; margin: 0; padding: 20px; background: #fff; color: #222; font-size: 16px; }
  .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 12px; }
  .header h1 { font-size: 26px; margin: 0 0 8px 0; }
  .header .meta { font-size: 16px; color: #555; display: flex; justify-content: center; gap: 24px; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; font-size: 16px; }
  th, td { border: 1px solid #ccc; padding: 10px; }
  th:first-child, td:first-child { background: #f0f4f8; font-weight: bold; text-align: center; }
  @media print {
    body { padding: 10px; }
    .no-print { display: none; }
    @page { size: A4 landscape; margin: 1cm; }
  }
</style>
</head>
<body>
<div class="header">
  <h1>${activityInfo.icon} ${activityInfo.name_ar} — ${daysLabel}</h1>
  <div class="meta">
    <span>📅 ${dateStr}</span>
    ${branchName ? `<span>🏢 ${branchName}</span>` : ''}
    <span>👥 إجمالي المشتركين: ${totalCount}</span>
  </div>
</div>
<table>
  <thead>
    <tr>
      <th style="background:#374151;color:#fff;text-align:center;border:1px solid #ccc;padding:10px;font-size:17px;">الوقت</th>
      ${headerCells}
    </tr>
  </thead>
  <tbody>
    ${tableRows}
  </tbody>
</table>
<div class="no-print" style="margin-top:20px;text-align:center;">
  <button onclick="window.print()" style="padding:12px 28px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:17px;cursor:pointer;">🖨️ طباعة</button>
</div>
</body>
</html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 500);
    }
    setIsPrintDialogOpen(false);
  };

  // Add a new level directly to the current time slot
  const handleQuickAddLevel = async () => {
    if (!selectedActivityId || !selectedTimeSlotKey) {
      toast.error(t('اختر وقت أولاً', 'Select a time slot first'));
      return;
    }
    
    // Get existing levels for this time slot to determine next level number
    const existingLevels = getLevelsForTimeSlot(selectedActivityId, selectedTimeSlotKey);
    const existingNumbers = existingLevels.map(l => l.level_number);
    
    // Find the next available level number
    let nextLevelNumber = 1;
    for (let i = 1; i <= 1000; i++) {
      if (!existingNumbers.includes(i)) {
        nextLevelNumber = i;
        break;
      }
    }
    
    // Get the activity_name from an existing level in this time slot
    // This ensures the new level has the same activity_name format
    let activityName = selectedTimeSlotKey;
    if (existingLevels.length > 0) {
      activityName = existingLevels[0].activity_name;
    } else {
      // Construct activity name if no existing levels
      const activity = getMainActivityInfo(selectedActivityId);
      if (selectedActivityId === 'swimming') {
        activityName = `سباحة - ${selectedTimeSlotKey}`;
      } else if (selectedActivityId === 'football') {
        activityName = `كرة قدم - ${selectedTimeSlotKey}`;
      } else if (selectedActivityId === 'karate') {
        activityName = `كاراتيه - ${selectedTimeSlotKey}`;
      }
    }
    
    setSaving(true);
    try {
      const newLevel = {
        level_number: nextLevelNumber,
        activity_name: activityName,
        branch_id: selectedBranchId || 'all',
        capacity: selectedActivityId === 'swimming' ? 6 : 10,
        members: []
      };
      
      await levelsAPI.create(newLevel);
      
      toast.success(t(`تم إضافة المستوى ${nextLevelNumber} بنجاح`, `Level ${nextLevelNumber} added successfully`));
      loadData();
    } catch (error) {
      console.error('Error creating level:', error);
      if (error.response?.data?.detail) {
        toast.error(error.response.data.detail);
      } else {
        toast.error(t('فشل في إضافة المستوى', 'Failed to add level'));
      }
    } finally {
      setSaving(false);
    }
  };

  // ========== Drag and Drop Functions ==========
  
  // Start dragging a member
  const handleDragStart = (e, member, level) => {
    setDraggedMember(member);
    setDraggedFromLevel(level);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', member.id);
  };

  // Drag over a level card
  const handleDragOver = (e, level) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (level.id !== draggedFromLevel?.id) {
      setDropTargetLevel(level.id);
    }
  };

  // Leave drag area
  const handleDragLeave = (e) => {
    setDropTargetLevel(null);
  };

  // Drop member on a level
  const handleDrop = async (e, targetLevel) => {
    e.preventDefault();
    setDropTargetLevel(null);
    
    if (!draggedMember || !draggedFromLevel || targetLevel.id === draggedFromLevel.id) {
      return;
    }
    
    // Check capacity
    const { mainActivity } = parseActivityName(targetLevel.activity_name);
    const currentCount = (targetLevel.members || []).length;
    const maxCapacity = mainActivity === 'swimming' ? 6 : (targetLevel.capacity || 10);
    
    if (currentCount >= maxCapacity) {
      toast.error(t(`المستوى ممتلئ (الحد الأقصى ${maxCapacity})`, `Level is full (max ${maxCapacity})`));
      setDraggedMember(null);
      setDraggedFromLevel(null);
      return;
    }
    
    try {
      // Remove from old level
      await levelsAPI.removeMember(draggedFromLevel.id, draggedMember.id);
      // Add to new level
      await levelsAPI.addMember(targetLevel.id, draggedMember.id);
      
      toast.success(t(`تم نقل ${draggedMember.name_ar || draggedMember.name} إلى المستوى ${targetLevel.level_number}`,
                      `Moved ${draggedMember.name_ar || draggedMember.name} to Level ${targetLevel.level_number}`));
      loadData();
    } catch (error) {
      toast.error(t('فشل في نقل العضو', 'Failed to move member'));
    } finally {
      setDraggedMember(null);
      setDraggedFromLevel(null);
    }
  };

  // End drag
  const handleDragEnd = () => {
    setDraggedMember(null);
    setDraggedFromLevel(null);
    setDropTargetLevel(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.activity_name.trim()) {
      toast.error(t('أدخل اسم النشاط', 'Enter activity name'));
      return;
    }
    
    setSaving(true);
    
    try {
      const data = {
        ...formData,
        branch_id: isAdmin ? formData.branch_id : undefined
      };
      
      if (selectedLevel) {
        await levelsAPI.update(selectedLevel.id, data);
        toast.success(t('تم تحديث المستوى', 'Level updated'));
      } else {
        await levelsAPI.create(data);
        toast.success(t('تم إضافة المستوى', 'Level added'));
      }
      
      setIsDialogOpen(false);
      resetForm();
      loadData();
    } catch (error) {
      console.error('Failed to save:', error);
      toast.error(error.response?.data?.detail || t('error', 'Error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (level) => {
    if (!window.confirm(t('هل أنت متأكد من حذف هذا المستوى؟', 'Are you sure you want to delete this level?'))) {
      return;
    }
    
    try {
      await levelsAPI.delete(level.id);
      toast.success(t('تم حذف المستوى', 'Level deleted'));
      loadData();
    } catch (error) {
      toast.error(t('error', 'Error'));
    }
  };

  const handleEdit = (level) => {
    const { mainActivity, timeSlot } = parseActivityName(level.activity_name);
    setSelectedLevel(level);
    setFormData({
      level_number: level.level_number,
      main_activity: mainActivity,
      time_slot: timeSlot,
      activity_name: level.activity_name || '',
      description: level.description || '',
      custom_name: level.custom_name || '',
      capacity: level.capacity || 10,
      members: level.members || [],
      branch_id: level.branch_id || 'all'
    });
    setIsDialogOpen(true);
  };

  const handleAddNewLevel = (mainActivityId, timeSlot) => {
    const activityInfo = getMainActivityInfo(mainActivityId);
    const defaultCapacity = mainActivityId === 'swimming' ? 6 : activityInfo.maxCapacity;
    
    // Use existing level's activity_name as the template to ensure correct grouping
    const existingLevels = getLevelsForTimeSlot(mainActivityId, timeSlot);
    let activityName = timeSlot || activityInfo.name_ar;
    if (existingLevels.length > 0) {
      activityName = existingLevels[0].activity_name;
    }

    resetForm();
    setFormData(prev => ({
      ...prev,
      main_activity: mainActivityId,
      time_slot: timeSlot,
      activity_name: activityName,
      capacity: defaultCapacity
    }));
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setSelectedLevel(null);
    setFormData({
      level_number: 1,
      main_activity: '',
      time_slot: '',
      activity_name: '',
      description: '',
      capacity: 10,
      members: [],
      branch_id: 'all'
    });
  };

  const openMembersDialog = (level) => {
    setSelectedLevel(level);
    setSearchQuery('');
    setFilterActivity('');
    setFilterTime('');
    setIsMembersDialogOpen(true);
  };

  const handleAddMember = async (memberId) => {
    // Check capacity for swimming
    const { mainActivity } = parseActivityName(selectedLevel?.activity_name);
    const currentCount = (selectedLevel?.members || []).length;
    const maxCapacity = mainActivity === 'swimming' ? 6 : (selectedLevel?.capacity || 10);
    
    if (currentCount >= maxCapacity) {
      toast.error(t(`المستوى ممتلئ (الحد الأقصى ${maxCapacity} أعضاء)`, `Level is full (max ${maxCapacity} members)`));
      return;
    }
    
    try {
      await levelsAPI.addMember(selectedLevel.id, memberId);
      toast.success(t('تمت إضافة العضو', 'Member added'));
      loadData();
      setSelectedLevel(prev => ({
        ...prev,
        members: [...(prev.members || []), memberId]
      }));
    } catch (error) {
      toast.error(error.response?.data?.detail || t('error', 'Error'));
    }
  };

  const handleRemoveMember = async (memberId) => {
    try {
      await levelsAPI.removeMember(selectedLevel.id, memberId);
      toast.success(t('تمت إزالة العضو', 'Member removed'));
      loadData();
      setSelectedLevel(prev => ({
        ...prev,
        members: (prev.members || []).filter(id => id !== memberId)
      }));
    } catch (error) {
      toast.error(t('error', 'Error'));
    }
  };

  // Filter members not in current level – only those with active subscriptions
  const todayStr = new Date().toISOString().split('T')[0];
  const hasActiveSubscription = (m) => {
    if (!m.activities || m.activities.length === 0) return false;
    return m.activities.some(a => {
      if (a.status !== 'active') return false;
      if (!a.end_date) return true;
      return a.end_date >= todayStr;
    });
  };
  // Build unique filter options from all members' active activities
  const activityFilterOptions = useMemo(() => {
    const names = new Set();
    members.forEach(m => {
      (m.activities || []).filter(a => a.status === 'active').forEach(a => {
        if (a.activity_name) names.add(a.activity_name);
      });
    });
    return [...names].sort();
  }, [members]);

  const timeFilterOptions = useMemo(() => {
    const times = new Set();
    members.forEach(m => {
      (m.activities || []).filter(a => a.status === 'active').forEach(a => {
        if (a.schedule) times.add(a.schedule);
      });
    });
    return [...times].sort();
  }, [members]);

  const availableMembers = members.filter(m => {
    if (!selectedLevel) return true;
    return !(selectedLevel.members || []).includes(m.id);
  }).filter(m => hasActiveSubscription(m)).filter(m => {
    if (!searchQuery) return true;
    const name = (m.name_ar || m.name || '').toLowerCase();
    const phone = (m.phone || '').toLowerCase();
    const code = (m.member_code || '').toLowerCase();
    return name.includes(searchQuery.toLowerCase()) || 
           phone.includes(searchQuery.toLowerCase()) ||
           code.includes(searchQuery.toLowerCase());
  }).filter(m => {
    if (!filterActivity && !filterTime) return true;
    const activeActs = (m.activities || []).filter(a => a.status === 'active');
    return activeActs.some(a => {
      const actMatch = !filterActivity || (a.activity_name || '') === filterActivity;
      const timeMatch = !filterTime || (a.schedule || '') === filterTime;
      return actMatch && timeMatch;
    });
  });

  // Get members in level
  const getLevelMembers = (level) => {
    return members.filter(m => (level.members || []).includes(m.id));
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

  const resolveActivityId = (level) => {
    const actName = level.activity_name || '';
    for (const a of activities) {
      if (actName.includes(a.name_ar) || actName.includes(a.name)) return a.id;
    }
    const normalized = actName.replace(/^ال/, '');
    for (const a of activities) {
      const aNorm = (a.name_ar || '').replace(/^ال/, '');
      if (normalized.includes(aNorm) || aNorm.includes(normalized.split(' - ')[0]?.trim())) return a.id;
    }
    return '';
  };

  const handleMemberAttendance = async (member, level) => {
    const key = `${member.id}_${level.id}`;
    if (attendanceMap[key] || attendanceLoading[key]) return;
    
    setAttendanceLoading(prev => ({ ...prev, [key]: true }));
    try {
      await attendanceAPI.record({
        member_id: member.id,
        activity_id: resolveActivityId(level)
      });
      
      setAttendanceMap(prev => ({ ...prev, [key]: true }));
      toast.success(t(`تم تحضير ${member.name_ar || member.name}`, `${member.name_ar || member.name} marked present`));
    } catch (error) {
      const msg = error.response?.data?.detail || '';
      if (msg?.includes('already') || msg?.includes('سبق') || msg?.includes('مسجل')) {
        setAttendanceMap(prev => ({ ...prev, [key]: true }));
        toast.info(t('تم تسجيل الحضور مسبقاً', 'Already recorded'));
      } else {
        toast.error(msg || t('فشل تسجيل الحضور', 'Failed to record attendance'));
      }
    } finally {
      setAttendanceLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleBulkAttendance = async (levelMembers, level) => {
    if (levelMembers.length === 0) return;
    let success = 0;
    let alreadyDone = 0;
    let failed = 0;
    let lastError = '';
    const actId = resolveActivityId(level);
    
    for (const member of levelMembers) {
      const key = `${member.id}_${level.id}`;
      if (attendanceMap[key]) { alreadyDone++; continue; }
      
      setAttendanceLoading(prev => ({ ...prev, [key]: true }));
      try {
        await attendanceAPI.record({
          member_id: member.id,
          activity_id: actId
        });
        
        setAttendanceMap(prev => ({ ...prev, [key]: true }));
        success++;
      } catch (error) {
        const msg = error.response?.data?.detail || '';
        if (msg?.includes('already') || msg?.includes('سبق') || msg?.includes('مسجل')) {
          setAttendanceMap(prev => ({ ...prev, [key]: true }));
          alreadyDone++;
        } else {
          failed++;
          lastError = msg;
        }
      } finally {
        setAttendanceLoading(prev => ({ ...prev, [key]: false }));
      }
    }
    
    if (success > 0) toast.success(t(`تم تحضير ${success} لاعب`, `${success} players marked present`));
    if (alreadyDone > 0) toast.info(t(`${alreadyDone} تم تحضيرهم مسبقاً`, `${alreadyDone} already recorded`));
    if (failed > 0) toast.error(t(`فشل تحضير ${failed} لاعب: ${lastError}`, `${failed} failed: ${lastError}`));
  };

  // Render a level card component with drag & drop support
  const renderLevelCard = (originalLevel, activityId) => {
    const level = getFilteredLevelForDay(originalLevel);
    const memberCount = (level.members || []).length;
    const maxCapacity = activityId === 'swimming' ? 6 : (originalLevel.capacity || 10);
    const isFull = memberCount >= maxCapacity;
    const levelMembers = (level.members_details || []).map(md => {
      const fullMember = members.find(m => m.id === md.member_id);
      return fullMember || { id: md.member_id, name_ar: md.member_name, phone: md.phone };
    });
    const isDropTarget = dropTargetLevel === originalLevel.id;
    
    return (
      <div 
        key={originalLevel.id}
        className={`border rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 
          ${isFull ? 'border-red-300 bg-red-50/30' : 'bg-white'}
          ${isDropTarget ? 'ring-2 ring-primary ring-offset-2 scale-[1.02]' : ''}`}
        data-testid={`level-card-${originalLevel.id}`}
        onDragOver={(e) => handleDragOver(e, originalLevel)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, originalLevel)}
      >
        {/* Level Header */}
        <div className={`${getLevelColor(level.level_number)} text-white p-3 flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <span className="text-2xl font-bold">{level.level_number}</span>
            </div>
            <div>
              <span className="text-sm opacity-90">{level.custom_name ? level.custom_name : t('المستوى', 'Level')}</span>
              <p className="text-xs opacity-75">{level.activity_name}</p>
            </div>
          </div>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white hover:bg-white/20"
              onClick={() => handleEdit(originalLevel)}
              data-testid={`edit-level-${originalLevel.id}`}
            >
              <Edit className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white hover:bg-white/20"
              onClick={() => handleDelete(originalLevel)}
              data-testid={`delete-level-${originalLevel.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Level Content */}
        <div className="p-3">
          {/* Capacity Bar */}
          <div className="mb-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className={`font-medium ${isFull ? 'text-red-600' : 'text-gray-700'}`}>
                {memberCount}/{maxCapacity} {t('لاعب', 'players')}
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
                className={`h-2.5 rounded-full transition-all duration-500 ${isFull ? 'bg-red-500' : 'bg-gradient-to-r from-green-400 to-green-600'}`}
                style={{ width: `${Math.min((memberCount / maxCapacity) * 100, 100)}%` }}
              />
            </div>
          </div>
          
          {/* Drag & Drop Hint */}
          {isDropTarget && (
            <div className="mb-2 p-2 bg-primary/10 rounded-lg text-center text-sm text-primary animate-pulse">
              <Move className="w-4 h-4 inline me-1" />
              {t('أفلت هنا لنقل اللاعب', 'Drop here to move player')}
            </div>
          )}
          
          {/* Members Preview - Draggable */}
          <div className="space-y-1.5 max-h-72 overflow-y-auto mb-3 scrollbar-thin">
            {levelMembers.length === 0 ? (
              <p className="text-center text-gray-400 py-3 text-sm">
                {t('لا يوجد لاعبين', 'No players')}
              </p>
            ) : (
              <>
                {levelMembers.map(member => {
                  const attKey = `${member.id}_${level.id}`;
                  const isPresent = attendanceMap[attKey];
                  const isAttLoading = attendanceLoading[attKey];
                  return (
                  <div 
                    key={member.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, member, level)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 p-2 rounded-lg transition-colors cursor-grab active:cursor-grabbing
                      ${isPresent ? 'bg-green-50 border border-green-200' : 'bg-gray-50 hover:bg-gray-100'}
                      ${draggedMember?.id === member.id ? 'opacity-50 scale-95' : ''}`}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); handleMemberAttendance(member, level); }}
                      disabled={isPresent || isAttLoading}
                      className={`shrink-0 transition-colors ${isPresent ? 'text-green-600' : 'text-gray-400 hover:text-green-500'}`}
                      title={isPresent ? t('حاضر', 'Present') : t('تحضير', 'Mark present')}
                    >
                      {isAttLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : isPresent ? <CheckCircle className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                    </button>
                    <div className={`w-7 h-7 rounded-full ${getLevelColor(level.level_number)} text-white flex items-center justify-center text-xs font-bold shadow-sm`}>
                      {(member.name_ar || member.name || '?').charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{member.name_ar || member.name}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] px-1.5">
                      #{member.member_code}
                    </Badge>
                  </div>
                  );
                })}
                {levelMembers.length > 5 && (
                  <p className="text-center text-gray-500 text-xs py-1 bg-gray-50 rounded-lg">
                    +{levelMembers.length - 5} {t('آخرين', 'more')}
                  </p>
                )}
              </>
            )}
          </div>
          
          {/* Attendance & Manage Buttons */}
          <div className="flex gap-2">
            {levelMembers.length > 0 && (
              <Button
                variant="outline"
                onClick={() => handleBulkAttendance(levelMembers, level)}
                className="flex-1 gap-1 h-9 text-green-700 border-green-300 hover:bg-green-50"
              >
                <UserCheck className="w-4 h-4" />
                {t('تحضير الكل', 'All Present')}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => openMembersDialog(level)}
              className={`gap-2 h-9 ${levelMembers.length > 0 ? '' : 'w-full'}`}
              data-testid={`manage-members-${level.id}`}
            >
              <UserPlus className="w-4 h-4" />
              {t('إدارة الأعضاء', 'Manage Members')}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto" data-testid="levels-page">
        {/* Header with Breadcrumb */}
        <div className="mb-6">
          {/* Breadcrumb Navigation */}
          {currentView !== 'days' && (
            <div className="flex items-center gap-2 mb-4 text-sm flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={goHome}
                className="gap-1 text-gray-600 hover:text-primary"
                data-testid="breadcrumb-home"
              >
                <Home className="w-4 h-4" />
                {t('الأيام', 'Days')}
              </Button>
              
              {currentView === 'activities' && selectedDay && (
                <>
                  <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
                  <span className="font-medium text-primary">
                    {language === 'ar' ? WEEKDAYS.find(d => d.id === selectedDay)?.name_ar : WEEKDAYS.find(d => d.id === selectedDay)?.name_en}
                  </span>
                </>
              )}

              {currentView === 'times' && selectedActivityId && (
                <>
                  <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
                  <Button variant="ghost" size="sm" onClick={() => { setCurrentView('activities'); setSelectedActivityId(null); }} className="gap-1 text-gray-600 hover:text-primary">
                    {language === 'ar' ? WEEKDAYS.find(d => d.id === selectedDay)?.name_ar : WEEKDAYS.find(d => d.id === selectedDay)?.name_en}
                  </Button>
                  <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
                  <span className="font-medium text-primary flex items-center gap-1">
                    <span>{getCurrentActivity().icon}</span>
                    {language === 'ar' ? getCurrentActivity().name_ar : getCurrentActivity().name_en}
                  </span>
                </>
              )}
              
              {currentView === 'levels' && selectedActivityId && (
                <>
                  <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
                  <Button variant="ghost" size="sm" onClick={() => { setCurrentView('activities'); setSelectedActivityId(null); setSelectedTimeSlotKey(null); }} className="gap-1 text-gray-600 hover:text-primary">
                    {language === 'ar' ? WEEKDAYS.find(d => d.id === selectedDay)?.name_ar : WEEKDAYS.find(d => d.id === selectedDay)?.name_en}
                  </Button>
                  <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView('times')}
                    className="gap-1 text-gray-600 hover:text-primary"
                    data-testid="breadcrumb-times"
                  >
                    <span>{getCurrentActivity().icon}</span>
                    {language === 'ar' ? getCurrentActivity().name_ar : getCurrentActivity().name_en}
                  </Button>
                  <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />
                  <span className="font-medium text-primary flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {selectedTimeSlotKey}
                  </span>
                </>
              )}
            </div>
          )}
          
          {/* Main Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {currentView !== 'days' && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={goBack}
                  className="shrink-0"
                  data-testid="back-button"
                >
                  {language === 'ar' ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
                </Button>
              )}
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
                  <Layers className="w-6 h-6 text-primary" />
                  {currentView === 'days' && t('المستويات', 'Levels')}
                  {currentView === 'activities' && selectedDay && (language === 'ar' ? WEEKDAYS.find(d => d.id === selectedDay)?.name_ar : WEEKDAYS.find(d => d.id === selectedDay)?.name_en)}
                  {currentView === 'times' && (
                    <>
                      <span>{getCurrentActivity().icon}</span>
                      {language === 'ar' ? getCurrentActivity().name_ar : getCurrentActivity().name_en}
                    </>
                  )}
                  {currentView === 'levels' && selectedTimeSlotKey}
                </h1>
                <p className="text-gray-500 text-sm mt-1">
                  {currentView === 'days' && t('اختر اليوم لعرض الأنشطة والمستويات', 'Select a day to view activities and levels')}
                  {currentView === 'activities' && t('اختر النشاط لعرض الأوقات والمستويات', 'Select an activity to view times and levels')}
                  {currentView === 'times' && t('اختر الوقت لعرض المستويات', 'Select a time to view levels')}
                  {currentView === 'levels' && t('إدارة اللاعبين في كل مستوى', 'Manage players in each level')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setIsPrintDialogOpen(true)}
              >
                <Printer className="w-4 h-4" />
                {t('طباعة الجدول', 'Print Schedule')}
              </Button>
              {currentView === 'activities' && (
                <Button
                  onClick={() => openAddTimeSlotDialog()}
                  className="gap-2"
                  data-testid="add-activity-btn"
                >
                  <Plus className="w-4 h-4" />
                  {t('إضافة نشاط', 'Add Activity')}
                </Button>
              )}
              {currentView === 'times' && (
                <Button
                  onClick={() => openAddTimeSlotDialog(selectedActivityId)}
                  className="gap-2"
                  data-testid="add-timeslot-btn"
                >
                  <Plus className="w-4 h-4" />
                  {t('إضافة ساعة', 'Add Time Slot')}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* VIEW: Days Selection */}
        {currentView === 'days' && (
          <div>
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
                <CardContent className="p-4 text-center">
                  <Layers className="w-8 h-8 text-orange-600 mx-auto mb-2" />
                  <div className="text-2xl font-bold text-orange-700">{levels.length}</div>
                  <div className="text-xs text-orange-600">{t('إجمالي المستويات', 'Total Levels')}</div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
                <CardContent className="p-4 text-center">
                  <Users className="w-8 h-8 text-green-600 mx-auto mb-2" />
                  <div className="text-2xl font-bold text-green-700">{levels.reduce((sum, l) => sum + (l.members || []).length, 0)}</div>
                  <div className="text-xs text-green-600">{t('إجمالي اللاعبين', 'Total Players')}</div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
                <CardContent className="p-4 text-center">
                  <Clock className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                  <div className="text-2xl font-bold text-blue-700">{[...new Set(levels.map(l => l.time_slot))].length}</div>
                  <div className="text-xs text-blue-600">{t('إجمالي الأوقات', 'Total Time Slots')}</div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
                <CardContent className="p-4 text-center">
                  <BarChart3 className="w-8 h-8 text-purple-600 mx-auto mb-2" />
                  <div className="text-2xl font-bold text-purple-700">
                    {levels.length > 0 ? Math.round(levels.reduce((sum, l) => sum + ((l.members || []).length / (l.capacity || 1)) * 100, 0) / levels.length) : 0}%
                  </div>
                  <div className="text-xs text-purple-600">{t('نسبة الامتلاء', 'Occupancy Rate')}</div>
                </CardContent>
              </Card>
            </div>

            {/* Weekday Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {WEEKDAYS.map((day) => {
                const dayMembers = levels.reduce((sum, l) => {
                  const filtered = (l.members_details || []).filter(m => memberMatchesDay(m, day.id));
                  return sum + filtered.length;
                }, 0);
                return (
                  <Card
                    key={day.id}
                    className="cursor-pointer hover:shadow-lg transition-all duration-300 hover:scale-[1.02] overflow-hidden group"
                    onClick={() => navigateToActivities(day.id)}
                  >
                    <div className={`bg-gradient-to-br ${day.color} p-6 text-white text-center`}>
                      <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">{day.icon}</div>
                      <h3 className="text-xl font-bold">{language === 'ar' ? day.name_ar : day.name_en}</h3>
                    </div>
                    <CardContent className="p-3 text-center">
                      <p className="text-sm font-bold text-primary">{dayMembers} {t('لاعب', 'player')}</p>
                      <p className="text-xs text-gray-500">{t('اضغط لعرض الأنشطة', 'Click to view activities')}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW: Activities */}
        {currentView === 'activities' && (() => {
          const allActivityCards = [
            ...MAIN_ACTIVITIES.map(baseActivity => {
              const activity = getMainActivityInfo(baseActivity.id);
              const activityLevels = groupedLevels[baseActivity.id] || {};
              const timeSlots = Object.keys(activityLevels);
              const totalLevels = timeSlots.reduce((sum, slot) => sum + activityLevels[slot].length, 0);
              const totalMembers = timeSlots.reduce((sum, slot) =>
                sum + activityLevels[slot].reduce((s, l) => s + getFilteredLevelForDay(l).members.length, 0), 0);
              const totalCapacity = timeSlots.reduce((sum, slot) =>
                sum + activityLevels[slot].reduce((s, l) => s + (baseActivity.id === 'swimming' ? 6 : (l.capacity || 10)), 0), 0);
              const fillPct = totalCapacity > 0 ? Math.round((totalMembers / totalCapacity) * 100) : 0;
              return { ...baseActivity, activity, timeSlots, totalLevels, totalMembers, totalCapacity, fillPct, type: 'main' };
            }),
          ];

          const globalTotalLevels = allActivityCards.reduce((s, a) => s + a.totalLevels, 0);
          const globalTotalMembers = allActivityCards.reduce((s, a) => s + a.totalMembers, 0);
          const globalTotalCapacity = allActivityCards.reduce((s, a) => s + a.totalCapacity, 0);
          const globalTotalTimes = allActivityCards.reduce((s, a) => s + a.timeSlots.length, 0);
          const globalFillPct = globalTotalCapacity > 0 ? Math.round((globalTotalMembers / globalTotalCapacity) * 100) : 0;

          let filtered = [...allActivityCards];
          if (levelSearchTerm) {
            const term = levelSearchTerm.toLowerCase();
            filtered = filtered.filter(a =>
              (a.activity.name_ar || '').toLowerCase().includes(term) ||
              (a.activity.name_en || '').toLowerCase().includes(term)
            );
          }
          if (filterActivityType !== 'all') {
            filtered = filtered.filter(a => a.id === filterActivityType);
          }
          filtered.sort((a, b) => {
            switch (sortLevelsBy) {
              case 'members': return b.totalMembers - a.totalMembers;
              case 'times': return b.timeSlots.length - a.timeSlots.length;
              case 'fill': return b.fillPct - a.fillPct;
              case 'name':
              default:
                return (a.activity.name_ar || '').localeCompare(b.activity.name_ar || '', 'ar');
            }
          });

          return (
            <div className="space-y-5" data-testid="activities-view">
              {/* Stats Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-blue-100">
                  <CardContent className="p-4 text-center">
                    <Layers className="w-6 h-6 mx-auto mb-1 text-blue-600" />
                    <p className="text-2xl font-bold text-blue-700">{globalTotalLevels}</p>
                    <p className="text-xs text-blue-600">{language === 'ar' ? 'إجمالي المستويات' : 'Total Levels'}</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm bg-gradient-to-br from-green-50 to-green-100">
                  <CardContent className="p-4 text-center">
                    <Users className="w-6 h-6 mx-auto mb-1 text-green-600" />
                    <p className="text-2xl font-bold text-green-700">{globalTotalMembers}</p>
                    <p className="text-xs text-green-600">{language === 'ar' ? 'إجمالي اللاعبين' : 'Total Players'}</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm bg-gradient-to-br from-orange-50 to-orange-100">
                  <CardContent className="p-4 text-center">
                    <Clock className="w-6 h-6 mx-auto mb-1 text-orange-600" />
                    <p className="text-2xl font-bold text-orange-700">{globalTotalTimes}</p>
                    <p className="text-xs text-orange-600">{language === 'ar' ? 'إجمالي الأوقات' : 'Total Time Slots'}</p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-purple-100">
                  <CardContent className="p-4 text-center">
                    <BarChart3 className="w-6 h-6 mx-auto mb-1 text-purple-600" />
                    <p className="text-2xl font-bold text-purple-700">{globalFillPct}%</p>
                    <p className="text-xs text-purple-600">{language === 'ar' ? 'نسبة الامتلاء' : 'Fill Rate'}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Search + Filter + Sort */}
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none rtl:right-3 ltr:left-3 ltr:right-auto" />
                  <Input
                    placeholder={language === 'ar' ? 'بحث في الأنشطة...' : 'Search activities...'}
                    value={levelSearchTerm}
                    onChange={e => setLevelSearchTerm(e.target.value)}
                    className="ps-10"
                  />
                </div>
                <Select value={filterActivityType} onValueChange={setFilterActivityType}>
                  <SelectTrigger className="w-[150px]">
                    <SlidersHorizontal className="w-4 h-4 me-1 opacity-50" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'كل الأنشطة' : 'All Activities'}</SelectItem>
                    {MAIN_ACTIVITIES.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.icon} {language === 'ar' ? a.name_ar : a.name_en}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sortLevelsBy} onValueChange={setSortLevelsBy}>
                  <SelectTrigger className="w-[150px]">
                    <ArrowUpDown className="w-4 h-4 me-1 opacity-50" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">{language === 'ar' ? 'الاسم' : 'Name'}</SelectItem>
                    <SelectItem value="members">{language === 'ar' ? 'اللاعبين' : 'Players'}</SelectItem>
                    <SelectItem value="times">{language === 'ar' ? 'الأوقات' : 'Time Slots'}</SelectItem>
                    <SelectItem value="fill">{language === 'ar' ? 'نسبة الامتلاء' : 'Fill Rate'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Activity Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(card => {
                  const isOther = card.type === 'other';
                  return (
                    <Card
                      key={card.id}
                      className="overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02] hover:-translate-y-1 group"
                      onClick={() => navigateToTimes(card.id)}
                      data-testid={`activity-card-${card.id}`}
                    >
                      <div className={`${card.color} text-white p-6 relative`}>
                        <div className="flex items-center justify-between">
                          <span className="text-5xl transition-transform group-hover:scale-110">{card.activity.icon}</span>
                          {!isOther && (
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9 text-white hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => handleEditActivity(e, card.id)}
                                data-testid={`edit-activity-${card.id}`}
                              >
                                <Edit className="w-5 h-5" />
                              </Button>
                            </div>
                          )}
                        </div>
                        <h2 className="font-bold text-2xl mt-4">
                          {language === 'ar' ? card.activity.name_ar : card.activity.name_en}
                        </h2>
                        {card.id === 'swimming' && (
                          <Badge className="bg-white/20 text-white border-0 mt-2">
                            {t('الحد الأقصى 6 لاعبين', 'Max 6 players')}
                          </Badge>
                        )}
                        {/* Fill Percentage Badge */}
                        {card.totalCapacity > 0 && (
                          <div className="absolute top-3 left-3 rtl:left-auto rtl:right-3">
                            <Badge className={`text-xs font-bold border-0 ${
                              card.fillPct >= 90 ? 'bg-red-600 text-white' :
                              card.fillPct >= 70 ? 'bg-yellow-500 text-white' :
                              'bg-white/25 text-white'
                            }`}>
                              {card.fillPct}% {language === 'ar' ? 'ممتلئ' : 'full'}
                            </Badge>
                          </div>
                        )}
                      </div>
                      <CardContent className="p-4 bg-white">
                        {/* Fill Progress Bar */}
                        {card.totalCapacity > 0 && (
                          <div className="mb-3">
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full transition-all duration-500 ${
                                  card.fillPct >= 90 ? 'bg-red-500' :
                                  card.fillPct >= 70 ? 'bg-yellow-500' :
                                  'bg-green-500'
                                }`}
                                style={{ width: `${card.fillPct}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1 text-center">
                              {card.totalMembers} / {card.totalCapacity} {language === 'ar' ? 'لاعب' : 'players'}
                            </p>
                          </div>
                        )}
                        <div className={`grid ${isOther ? 'grid-cols-2' : 'grid-cols-3'} gap-2 text-center`}>
                          {!isOther && (
                            <div className="p-2 bg-gray-50 rounded-lg">
                              <p className="text-2xl font-bold text-gray-800">{card.timeSlots.length}</p>
                              <p className="text-xs text-gray-500">{t('أوقات', 'Times')}</p>
                            </div>
                          )}
                          <div className="p-2 bg-gray-50 rounded-lg">
                            <p className="text-2xl font-bold text-gray-800">{card.totalLevels}</p>
                            <p className="text-xs text-gray-500">{t('مستويات', 'Levels')}</p>
                          </div>
                          <div className="p-2 bg-gray-50 rounded-lg">
                            <p className="text-2xl font-bold text-gray-800">{card.totalMembers}</p>
                            <p className="text-xs text-gray-500">{t('لاعب', 'Players')}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {filtered.length === 0 && (
                <div className="text-center py-12">
                  <Search className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-gray-500">{language === 'ar' ? 'لا توجد نتائج' : 'No results found'}</p>
                </div>
              )}
            </div>
          );
        })()}

        {/* VIEW: Time Slots */}
        {currentView === 'times' && selectedActivityId && (
          <div data-testid="times-view">
            {(() => {
              const activity = getCurrentActivity();
              const timeSlots = getTimeSlotsForActivity(selectedActivityId);
              
              if (timeSlots.length === 0) {
                return (
                  <div className="text-center py-16">
                    <div className={`w-24 h-24 mx-auto mb-4 rounded-full ${activity.color} flex items-center justify-center`}>
                      <Clock className="w-12 h-12 text-white" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-700 mb-2">
                      {t('لا توجد أوقات', 'No Time Slots')}
                    </h3>
                    <p className="text-gray-500 mb-6">
                      {t('لم يتم إضافة أوقات لهذا النشاط بعد', 'No time slots have been added for this activity yet')}
                    </p>
                    <Button onClick={openAddTimeSlotDialog} className="gap-2" size="lg">
                      <Plus className="w-5 h-5" />
                      {t('إضافة ساعة', 'Add Time Slot')}
                    </Button>
                  </div>
                );
              }
              
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {timeSlots.map(timeSlot => {
                    const slotLevels = getLevelsForTimeSlot(selectedActivityId, timeSlot);
                    const slotMembers = slotLevels.reduce((sum, l) => sum + getFilteredLevelForDay(l).members.length, 0);
                    const maxCapacity = slotLevels.reduce((sum, l) => sum + (selectedActivityId === 'swimming' ? 6 : (l.capacity || 10)), 0);
                    const fillPercentage = maxCapacity > 0 ? Math.round((slotMembers / maxCapacity) * 100) : 0;
                    
                    return (
                      <Card 
                        key={timeSlot}
                        className="overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02]"
                        onClick={() => navigateToLevels(selectedActivityId, timeSlot)}
                        data-testid={`time-card-${timeSlot}`}
                      >
                        <div className={`${activity.color} text-white p-4`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-full bg-white/20">
                                <Clock className="w-6 h-6" />
                              </div>
                              <div>
                                <h3 className="font-bold text-xl">{timeSlot}</h3>
                                <p className="text-sm opacity-90">{slotLevels.length} {t('مستويات', 'levels')}</p>
                              </div>
                            </div>
                            {/* Edit & Delete Buttons */}
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-white hover:bg-white/20"
                                onClick={(e) => handleEditTimeSlot(e, selectedActivityId, timeSlot)}
                                data-testid={`edit-time-${timeSlot}`}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-white hover:bg-red-500/50"
                                onClick={(e) => handleDeleteTimeSlot(e, selectedActivityId, timeSlot)}
                                data-testid={`delete-time-${timeSlot}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-gray-600">
                              <Users className="w-4 h-4 inline me-1" />
                              {slotMembers} {t('لاعب', 'players')}
                            </span>
                            <Badge variant={fillPercentage >= 90 ? "destructive" : fillPercentage >= 70 ? "warning" : "secondary"}>
                              {fillPercentage}%
                            </Badge>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div 
                              className={`h-2 rounded-full transition-all ${
                                fillPercentage >= 90 ? 'bg-red-500' : 
                                fillPercentage >= 70 ? 'bg-yellow-500' : 'bg-green-500'
                              }`}
                              style={{ width: `${fillPercentage}%` }}
                            />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1">
                            {slotLevels.slice(0, 6).map(level => (
                              <Badge 
                                key={level.id} 
                                className={`${getLevelColor(level.level_number)} text-white text-xs`}
                              >
                                {t('م', 'L')}{level.level_number}
                              </Badge>
                            ))}
                            {slotLevels.length > 6 && (
                              <Badge variant="outline" className="text-xs">
                                +{slotLevels.length - 6}
                              </Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  
                  {/* Add New Time Slot Card */}
                  <Card 
                    className="overflow-hidden cursor-pointer border-2 border-dashed border-gray-300 hover:border-primary hover:shadow-lg transition-all duration-300 bg-gray-50/50"
                    onClick={openAddTimeSlotDialog}
                    data-testid="add-time-slot-card"
                  >
                    <div className="p-8 flex flex-col items-center justify-center h-full min-h-[180px]">
                      <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center mb-3">
                        <Clock className="w-7 h-7 text-gray-500" />
                      </div>
                      <p className="font-medium text-gray-600">{t('إضافة ساعة جديدة', 'Add New Time Slot')}</p>
                      <p className="text-sm text-gray-400 mt-1">{t('أدخل اسم الوقت يدوياً', 'Enter time name manually')}</p>
                    </div>
                  </Card>
                </div>
              );
            })()}
          </div>
        )}

        {/* VIEW: Levels */}
        {currentView === 'levels' && selectedActivityId && selectedTimeSlotKey && (
          <div data-testid="levels-view">
            {(() => {
              const activity = getCurrentActivity();
              const slotLevels = getLevelsForTimeSlot(selectedActivityId, selectedTimeSlotKey);
              
              if (slotLevels.length === 0) {
                return (
                  <div className="text-center py-16">
                    <div className={`w-24 h-24 mx-auto mb-4 rounded-full ${activity.color} flex items-center justify-center`}>
                      <Layers className="w-12 h-12 text-white" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-700 mb-2">
                      {t('لا توجد مستويات', 'No Levels')}
                    </h3>
                    <p className="text-gray-500 mb-4">
                      {t('لم يتم إضافة مستويات لهذا الوقت بعد', 'No levels have been added for this time slot yet')}
                    </p>
                    <Button onClick={handleQuickAddLevel} disabled={saving} className="gap-2">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      {t('إضافة مستوى', 'Add Level')}
                    </Button>
                  </div>
                );
              }
              
              return (
                <>
                  {/* Summary Header */}
                  <div className={`${activity.color} text-white p-4 rounded-xl mb-6`}>
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{activity.icon}</span>
                        <div>
                          <h3 className="font-bold text-lg">
                            {language === 'ar' ? activity.name_ar : activity.name_en} - {selectedTimeSlotKey}
                          </h3>
                          <p className="text-sm opacity-90">
                            {slotLevels.length} {t('مستويات', 'levels')} • {slotLevels.reduce((s, l) => s + getFilteredLevelForDay(l).members.length, 0)} {t('لاعب', 'players')}
                          </p>
                        </div>
                      </div>
                      <Button 
                        variant="secondary" 
                        onClick={handleQuickAddLevel}
                        disabled={saving}
                        className="gap-2"
                        data-testid="quick-add-level-btn"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {t('مستوى جديد', 'New Level')}
                      </Button>
                    </div>
                  </div>
                  
                  {/* Levels Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {slotLevels.sort((a, b) => a.level_number - b.level_number).map(level => 
                      renderLevelCard(level, selectedActivityId)
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Add/Edit Level Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {selectedLevel ? t('تعديل المستوى', 'Edit Level') : t('إضافة مستوى', 'Add Level')}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Main Activity and Time Slot — only shown when adding a new level (not editing) */}
              {!selectedLevel && (
                <>
                  <div>
                    <Label>{t('النشاط الرئيسي', 'Main Activity')} *</Label>
                    <Select
                      value={formData.main_activity}
                      onValueChange={(value) => {
                        const activityInfo = getMainActivityInfo(value);
                        const defaultCapacity = value === 'swimming' ? 6 : activityInfo.maxCapacity;
                        setFormData({ 
                          ...formData, 
                          main_activity: value,
                          capacity: defaultCapacity,
                          activity_name: formData.time_slot ? `${activityInfo.name_ar} - ${formData.time_slot}` : activityInfo.name_ar
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('اختر النشاط', 'Select activity')} />
                      </SelectTrigger>
                      <SelectContent>
                        {MAIN_ACTIVITIES.map(act => (
                          <SelectItem key={act.id} value={act.id}>
                            {act.icon} {language === 'ar' ? act.name_ar : act.name_en}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>{t('الوقت (الساعة)', 'Time Slot')}</Label>
                    <Select
                      value={formData.time_slot}
                      onValueChange={(value) => {
                        const activityInfo = getMainActivityInfo(formData.main_activity);
                        setFormData({ 
                          ...formData, 
                          time_slot: value,
                          activity_name: activityInfo && formData.main_activity !== 'other'
                            ? `${activityInfo.name_ar} - ${value}`
                            : value
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('اختر الوقت', 'Select time')} />
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_SLOTS.map(slot => (
                          <SelectItem key={slot} value={slot}>{slot}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {/* Level Number */}
              <div>
                <Label>{t('رقم المستوى', 'Level Number')} *</Label>
                <Input
                  type="number"
                  min="1"
                  value={formData.level_number}
                  onChange={(e) => setFormData({ ...formData, level_number: parseInt(e.target.value) || 1 })}
                  placeholder={t('أدخل رقم المستوى', 'Enter level number')}
                />
              </div>

              {/* Custom Level Name */}
              <div>
                <Label>{t('اسم مخصص للمستوى (اختياري)', 'Custom Level Name (optional)')}</Label>
                <Input
                  value={formData.custom_name}
                  onChange={(e) => setFormData({ ...formData, custom_name: e.target.value })}
                  placeholder={t('مثال: مجموعة أ، المبتدئين، البنات...', 'e.g. Group A, Beginners, Girls...')}
                />
                <p className="text-xs text-gray-500 mt-1">{t('سيظهر هذا الاسم في رأس البطاقة بدلاً من "المستوى"', 'This name will appear in the card header instead of "Level"')}</p>
              </div>

              {/* Activity Name (auto-filled but editable) */}
              <div>
                <Label>{t('اسم المستوى (للعرض)', 'Level Name')} *</Label>
                <Input
                  value={formData.activity_name}
                  onChange={(e) => setFormData({ ...formData, activity_name: e.target.value })}
                  placeholder={t('مثال: الساعة 4', 'e.g. 4 PM')}
                />
              </div>

              {/* Capacity */}
              <div>
                <Label>{t('السعة القصوى', 'Max Capacity')}</Label>
                <Input
                  type="number"
                  min="1"
                  max="50"
                  value={formData.capacity}
                  onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 10 })}
                />
                {formData.main_activity === 'swimming' && (
                  <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {t('السباحة: الحد الأقصى 6 لاعبين لكل مستوى', 'Swimming: Max 6 players per level')}
                  </p>
                )}
              </div>

              {/* Branch (Admin only) */}
              {isAdmin && branches.length > 0 && (
                <div>
                  <Label>{t('الفرع', 'Branch')}</Label>
                  <Select
                    value={formData.branch_id}
                    onValueChange={(value) => setFormData({ ...formData, branch_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('جميع الفروع', 'All Branches')}</SelectItem>
                      {branches.map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Description */}
              <div>
                <Label>{t('ملاحظات', 'Notes')}</Label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t('ملاحظات إضافية...', 'Additional notes...')}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  {t('إلغاء', 'Cancel')}
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {selectedLevel ? t('تحديث', 'Update') : t('إضافة', 'Add')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Manage Members Dialog */}
        <Dialog open={isMembersDialogOpen} onOpenChange={setIsMembersDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                {t('إدارة أعضاء المستوى', 'Manage Level Members')}
                {selectedLevel && (
                  <Badge className={getLevelColor(selectedLevel.level_number)}>
                    {selectedLevel.activity_name} - {t('المستوى', 'Level')} {selectedLevel.level_number}
                  </Badge>
                )}
              </DialogTitle>
            </DialogHeader>
            
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Search */}
              <div className="relative mb-4">
                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder={t('بحث بالاسم أو رقم الجوال أو رقم العضوية...', 'Search by name, phone or member code...')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pe-10"
                />
              </div>
              
              {/* Activity & Time Filters */}
              <div className="flex gap-2 mb-3">
                <Select value={filterActivity} onValueChange={setFilterActivity}>
                  <SelectTrigger className="flex-1 h-8 text-xs">
                    <SelectValue placeholder={t('كل الأنشطة', 'All activities')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t('كل الأنشطة', 'All activities')}</SelectItem>
                    {activityFilterOptions.map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterTime} onValueChange={setFilterTime}>
                  <SelectTrigger className="flex-1 h-8 text-xs">
                    <SelectValue placeholder={t('كل المواعيد', 'All times')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t('كل المواعيد', 'All times')}</SelectItem>
                    {timeFilterOptions.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Capacity Warning */}
              {selectedLevel && (
                <div className={`mb-3 p-2 rounded-lg ${
                  (selectedLevel.members || []).length >= (parseActivityName(selectedLevel.activity_name).mainActivity === 'swimming' ? 6 : selectedLevel.capacity || 10)
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-green-50 border border-green-200'
                }`}>
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {t('الأعضاء الحاليون', 'Current Members')}: {(selectedLevel.members || []).length}
                    </span>
                    <span>
                      {t('السعة القصوى', 'Max Capacity')}: {
                        parseActivityName(selectedLevel.activity_name).mainActivity === 'swimming' ? 6 : selectedLevel.capacity || 10
                      }
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 flex-1 overflow-hidden">
                {/* Current Members */}
                <div className="border rounded-lg overflow-hidden flex flex-col">
                  <div className="bg-primary text-white p-2 text-sm font-bold">
                    {t('أعضاء المستوى', 'Level Members')} ({(selectedLevel?.members || []).length})
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {getLevelMembers(selectedLevel || {}).map(member => (
                      <div 
                        key={member.id}
                        className="flex items-center gap-2 p-2 bg-gray-50 rounded hover:bg-gray-100"
                      >
                        <div className={`w-8 h-8 rounded-full ${getLevelColor(selectedLevel?.level_number)} text-white flex items-center justify-center text-sm font-bold`}>
                          {(member.name_ar || member.name || '?').charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{member.name_ar || member.name}</p>
                          <p className="text-xs text-gray-500">#{member.member_code}</p>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-500 hover:bg-red-50"
                          onClick={() => handleRemoveMember(member.id)}
                        >
                          <UserMinus className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    {(selectedLevel?.members || []).length === 0 && (
                      <p className="text-center text-gray-400 py-4 text-sm">
                        {t('لا يوجد أعضاء', 'No members')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Available Members */}
                <div className="border rounded-lg overflow-hidden flex flex-col">
                  <div className="bg-gray-600 text-white p-2 text-sm font-bold">
                    {t('الأعضاء المتاحون', 'Available Members')} ({availableMembers.length})
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {availableMembers.slice(0, 50).map(member => {
                      const activeActivity = (member.activities || []).find(a => a.status === 'active');
                      const activityLabel = activeActivity?.activity_name || '';
                      const daysLabel = activeActivity?.training_days?.length
                        ? activeActivity.training_days.join('، ')
                        : activeActivity?.schedule || '';
                      return (
                        <div 
                          key={member.id}
                          className="flex items-center gap-2 p-2 bg-gray-50 rounded hover:bg-gray-100"
                        >
                          <div className="w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                            {(member.name_ar || member.name || '?').charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{member.name_ar || member.name}</p>
                            <p className="text-xs text-gray-500">#{member.member_code} • {member.phone}</p>
                            {(activityLabel || daysLabel) && (
                              <p className="text-xs text-blue-600 truncate mt-0.5">
                                {activityLabel}{activityLabel && daysLabel ? ' — ' : ''}{daysLabel}
                              </p>
                            )}
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-green-500 hover:bg-green-50 flex-shrink-0"
                            onClick={() => handleAddMember(member.id)}
                          >
                            <UserPlus className="w-4 h-4" />
                          </Button>
                        </div>
                      );
                    })}
                    {availableMembers.length === 0 && (
                      <p className="text-center text-gray-400 py-4 text-sm">
                        {searchQuery ? t('لا توجد نتائج', 'No results') : t('لا يوجد أعضاء متاحون', 'No available members')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setIsMembersDialogOpen(false)}>
                {t('إغلاق', 'Close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Time Slot Name Dialog */}
        <Dialog open={isTimeSlotEditDialogOpen} onOpenChange={setIsTimeSlotEditDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                {t('تعديل اسم الوقت', 'Edit Time Slot Name')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('الاسم الحالي', 'Current Name')}</Label>
                <p className="text-sm text-gray-500 bg-gray-100 p-2 rounded mt-1">{editingTimeSlot.oldName}</p>
              </div>
              <div>
                <Label>{t('الاسم الجديد', 'New Name')} *</Label>
                <Input
                  value={editingTimeSlot.newName}
                  onChange={(e) => setEditingTimeSlot({ ...editingTimeSlot, newName: e.target.value })}
                  placeholder={t('أدخل الاسم الجديد', 'Enter new name')}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsTimeSlotEditDialogOpen(false)}>
                {t('إلغاء', 'Cancel')}
              </Button>
              <Button onClick={handleSaveTimeSlotEdit} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {t('حفظ', 'Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Activity Name Dialog */}
        <Dialog open={isActivityEditDialogOpen} onOpenChange={setIsActivityEditDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" />
                {t('تعديل اسم النشاط', 'Edit Activity Name')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('الأيقونة', 'Icon')}</Label>
                <Input
                  value={editingActivity.icon}
                  onChange={(e) => setEditingActivity({ ...editingActivity, icon: e.target.value })}
                  placeholder="🏊"
                  className="mt-1 text-2xl text-center"
                  maxLength={2}
                />
                <p className="text-xs text-gray-400 mt-1">{t('أدخل إيموجي واحد', 'Enter one emoji')}</p>
              </div>
              <div>
                <Label>{t('الاسم بالعربي', 'Arabic Name')} *</Label>
                <Input
                  value={editingActivity.name_ar}
                  onChange={(e) => setEditingActivity({ ...editingActivity, name_ar: e.target.value })}
                  placeholder={t('مثال: السباحة', 'e.g. Swimming')}
                  className="mt-1"
                  dir="rtl"
                />
              </div>
              <div>
                <Label>{t('الاسم بالإنجليزي', 'English Name')}</Label>
                <Input
                  value={editingActivity.name_en}
                  onChange={(e) => setEditingActivity({ ...editingActivity, name_en: e.target.value })}
                  placeholder="Swimming"
                  className="mt-1"
                  dir="ltr"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsActivityEditDialogOpen(false)}>
                {t('إلغاء', 'Cancel')}
              </Button>
              <Button onClick={handleSaveActivityEdit}>
                {t('حفظ', 'Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add New Time Slot Dialog */}
        <Dialog open={isAddTimeSlotDialogOpen} onOpenChange={setIsAddTimeSlotDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                {t('إضافة نشاط جديد', 'Add New Activity')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('النشاط', 'Activity')} *</Label>
                <Select
                  value={dialogActivityId}
                  onValueChange={setDialogActivityId}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={t('اختر النشاط', 'Select activity')} />
                  </SelectTrigger>
                  <SelectContent>
                    {MAIN_ACTIVITIES.map(act => (
                      <SelectItem key={act.id} value={act.id}>
                        {act.icon} {language === 'ar' ? act.name_ar : act.name_en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('اسم الوقت / المجموعة', 'Time / Group Name')} *</Label>
                <Input
                  value={newTimeSlotName}
                  onChange={(e) => setNewTimeSlotName(e.target.value)}
                  placeholder={t('مثال: الساعة 4، صباحي، مسائي', 'e.g. 4 PM, Morning, Evening')}
                  className="mt-1"
                  dir="rtl"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-2">
                  {t('سيتم إنشاء المستوى 1 تلقائياً مع هذا النشاط', 'Level 1 will be created automatically')}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddTimeSlotDialogOpen(false)}>
                {t('إلغاء', 'Cancel')}
              </Button>
              <Button onClick={handleAddNewTimeSlot} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {t('إضافة', 'Add')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Print Schedule Dialog */}
        <Dialog open={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-primary" />
                {t('طباعة جدول المستويات', 'Print Levels Schedule')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">{t('الأيام', 'Days')} *</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {WEEKDAYS.map(day => {
                    const checked = printDays.includes(day.id);
                    return (
                      <label key={day.id} className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors ${checked ? 'bg-primary/10 border-primary' : 'border-border hover:bg-muted'}`}>
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={checked}
                          onChange={() => {
                            setPrintDays(prev =>
                              prev.includes(day.id)
                                ? prev.filter(d => d !== day.id)
                                : [...prev, day.id]
                            );
                          }}
                        />
                        <span className="text-sm font-medium">{language === 'ar' ? day.name_ar : day.name_en}</span>
                      </label>
                    );
                  })}
                </div>
                {printDays.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">{t('اختر يوماً على الأقل', 'Select at least one day')}</p>
                )}
              </div>
              <div>
                <Label>{t('النشاط', 'Activity')} *</Label>
                <Select value={printActivity} onValueChange={setPrintActivity}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAIN_ACTIVITIES.map(a => {
                      const info = getMainActivityInfo(a.id);
                      return (
                        <SelectItem key={a.id} value={a.id}>
                          {info.icon} {language === 'ar' ? info.name_ar : info.name_en}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPrintDialogOpen(false)}>
                {t('إلغاء', 'Cancel')}
              </Button>
              <Button onClick={handlePrintSchedule} className="gap-2" disabled={printDays.length === 0}>
                <Printer className="w-4 h-4" />
                {t('طباعة', 'Print')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default LevelsPage;
