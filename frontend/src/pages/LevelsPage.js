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
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../components/ui/command';
import { levelsAPI, membersAPI, branchesAPI, activitiesAPI, attendanceAPI, coachesAPI } from '../services/api';
import { toast } from 'sonner';
import LevelsCleanupDialog from '../components/levels/LevelsCleanupDialog';
import { 
  Plus, Edit, Trash2, Loader2, Layers, Users, Dumbbell, UserPlus, UserMinus, UserX, Search,
  ChevronDown, ChevronUp, ChevronRight, Clock, AlertTriangle, ArrowRight, ArrowLeft, Home,
  GripVertical, Move, ArrowUpDown, SlidersHorizontal, TrendingUp, BarChart3, CheckCircle, Circle, UserCheck, Printer, RefreshCw, Wand2
} from 'lucide-react';

// Main activity types with Arabic names
const MAIN_ACTIVITIES = [
  { id: 'swimming', name_ar: 'السباحة', name_en: 'Swimming', icon: '🏊', color: 'bg-blue-500', maxCapacity: 6 },
  { id: 'football', name_ar: 'كرة القدم', name_en: 'Football', icon: '⚽', color: 'bg-green-500', maxCapacity: 15 },
  { id: 'karate', name_ar: 'الكاراتيه', name_en: 'Karate', icon: '🥋', color: 'bg-red-500', maxCapacity: 12 }
];

// Activity groups for filtering (keyword-based matching)
const ACTIVITY_GROUPS = [
  { id: 'swimming', label: 'السباحة', icon: '🏊', keywords: ['سباحة', 'سباحه'] },
  { id: 'football', label: 'كرة القدم', icon: '⚽', keywords: ['قدم', 'كره', 'كرة'] },
  { id: 'karate',   label: 'الكاراتيه', icon: '🥋', keywords: ['كارات', 'كاراتيه', 'كارتيه'] },
];
const matchesGroup = (activityName, groupId) => {
  const g = ACTIVITY_GROUPS.find(g => g.id === groupId);
  if (!g) return false;
  return g.keywords.some(k => (activityName || '').includes(k));
};

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
  const [timePopoverOpen, setTimePopoverOpen] = useState(false);
  
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

  // Unassigned members dialog
  const [isUnassignedDialogOpen, setIsUnassignedDialogOpen] = useState(false);
  const [unassignedData, setUnassignedData] = useState([]);
  const [unassignedLoading, setUnassignedLoading] = useState(false);
  const [unassignedSearch, setUnassignedSearch] = useState('');
  const [unassignedActivityFilter, setUnassignedActivityFilter] = useState('');
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [assignPickerOpen, setAssignPickerOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null); // { member, activity }
  const [assigning, setAssigning] = useState(false);

  // Auto-assign dialog
  const [isAutoAssignOpen, setIsAutoAssignOpen] = useState(false);
  const [autoAssignLoading, setAutoAssignLoading] = useState(false);
  const [autoAssignConfirming, setAutoAssignConfirming] = useState(false);
  const [autoAssignPlan, setAutoAssignPlan] = useState(null);
  const [autoAssignExpanded, setAutoAssignExpanded] = useState({});
  const [autoAssignShowUnmatched, setAutoAssignShowUnmatched] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const openAutoAssignDialog = async () => {
    setIsAutoAssignOpen(true);
    setAutoAssignPlan(null);
    setAutoAssignExpanded({});
    setAutoAssignShowUnmatched(false);
    setAutoAssignLoading(true);
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const res = await levelsAPI.autoAssign(true, branchParams);
      setAutoAssignPlan(res.data || null);
    } catch (e) {
      toast.error(t('فشل تحضير خطة الإسناد', 'Failed to prepare assignment plan'));
      setIsAutoAssignOpen(false);
    } finally {
      setAutoAssignLoading(false);
    }
  };

  const confirmAutoAssign = async () => {
    if (!autoAssignPlan || !autoAssignPlan.totals?.would_assign) return;
    setAutoAssignConfirming(true);
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const res = await levelsAPI.autoAssign(false, branchParams);
      const applied = res.data?.applied || 0;
      toast.success(t(`تم إسناد ${applied} عضو إلى المستويات`, `Assigned ${applied} member(s) to levels`));
      setIsAutoAssignOpen(false);
      setAutoAssignPlan(null);
      await Promise.all([loadData(), loadUnassignedCount()]);
    } catch (e) {
      toast.error(t('فشل تنفيذ الإسناد', 'Failed to perform assignment'));
    } finally {
      setAutoAssignConfirming(false);
    }
  };

  const sourceLabel = (s) => {
    if (s === 'member_activities') return t('من سجل العضو', 'Member record');
    if (s === 'invoices') return t('من الفواتير', 'Invoices');
    if (s === 'registration_forms') return t('من نماذج التسجيل', 'Registration forms');
    return s || '';
  };
  
  // Search, filter, sort for main activities view
  const [levelSearchTerm, setLevelSearchTerm] = useState('');
  const [filterActivityType, setFilterActivityType] = useState('all');
  const [sortLevelsBy, setSortLevelsBy] = useState('name');

  // Expanded states for accordion (fallback)
  const [expandedActivities, setExpandedActivities] = useState({});
  const [expandedTimeSlots, setExpandedTimeSlots] = useState({});

  const levelNumbers = [1, 2, 3, 4, 5, 6];

  // Default for new levels: all 7 days selected. Existing levels created
  // before this feature have `days: null` in the DB, which the helper
  // levelMatchesDay() treats as "all days" for back-compat.
  const ALL_DAY_IDS = ['saturday','sunday','monday','tuesday','wednesday','thursday','friday'];
  const [formData, setFormData] = useState({
    level_number: 1,
    main_activity: '',
    time_slot: '',
    activity_name: '',
    custom_name: '',
    description: '',
    capacity: 10,
    members: [],
    branch_id: 'all',
    coach_id: '__none__',
    days: [...ALL_DAY_IDS]
  });
  const [coaches, setCoaches] = useState([]);

  const [timeSlotForm, setTimeSlotForm] = useState({
    name: ''
  });

  useEffect(() => {
    loadData();
    loadUnassignedCount();
  }, [selectedBranchId]);

  const loadUnassignedCount = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const res = await levelsAPI.getUnassignedCount(branchParams);
      setUnassignedCount(res.data?.count || 0);
    } catch (e) { /* silent */ }
  };

  const loadUnassigned = async () => {
    setUnassignedLoading(true);
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const res = await levelsAPI.getUnassignedMembers(branchParams);
      setUnassignedData(res.data?.members || []);
      setUnassignedCount(res.data?.count || 0);
    } catch (e) {
      toast.error(t('فشل تحميل البيانات', 'Failed to load data'));
    } finally {
      setUnassignedLoading(false);
    }
  };

  const openUnassignedDialog = () => {
    setIsUnassignedDialogOpen(true);
    setUnassignedSearch('');
    setUnassignedActivityFilter('');
    loadUnassigned();
  };

  const openAssignPicker = (member, activity) => {
    setAssignTarget({ member, activity });
    setAssignPickerOpen(true);
  };

  const handleAssignToLevel = async (level) => {
    if (!assignTarget) return;
    setAssigning(true);
    try {
      await levelsAPI.addMember(level.id, assignTarget.member.id);
      const assignedMemberId = assignTarget.member.id;
      const assignedActName = assignTarget.activity?.activity_name || '';
      const assignedActId = assignTarget.activity?.activity_id || '';
      // Optimistically remove the just-assigned activity from the local
      // unassigned list so the row disappears immediately. If the member
      // had other unassigned activities, only that one entry is dropped;
      // when no activities remain, the whole member row is removed.
      setUnassignedData(prev => prev
        .map(m => {
          if (m.id !== assignedMemberId) return m;
          const remaining = (m.unassigned_activities || []).filter(a => {
            if (assignedActId && a.activity_id === assignedActId) return false;
            if (assignedActName && a.activity_name === assignedActName) return false;
            return true;
          });
          return { ...m, unassigned_activities: remaining };
        })
        .filter(m => (m.unassigned_activities || []).length > 0)
      );
      toast.success(t('تم تعيين العضو للمستوى', 'Member assigned to level'));
      setAssignPickerOpen(false);
      setAssignTarget(null);
      await Promise.all([loadUnassigned(), loadData()]);
    } catch (e) {
      const msg = e.response?.data?.detail || '';
      toast.error(msg || t('فشل التعيين', 'Assignment failed'));
    } finally {
      setAssigning(false);
    }
  };

  // Filter unassigned data based on search and activity filter
  const filteredUnassigned = useMemo(() => {
    return unassignedData.filter(m => {
      // Activity filter
      if (unassignedActivityFilter) {
        const hasMatch = (m.unassigned_activities || []).some(a =>
          matchesGroup(a.activity_name, unassignedActivityFilter)
        );
        if (!hasMatch) return false;
      }
      // Search filter
      if (unassignedSearch) {
        const q = unassignedSearch.toLowerCase();
        const name = (m.name_ar || m.name || '').toLowerCase();
        const phone = (m.phone || '').toLowerCase();
        const code = (m.member_code || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || code.includes(q);
      }
      return true;
    });
  }, [unassignedData, unassignedSearch, unassignedActivityFilter]);

  // Available levels matching the assignTarget activity (branch-scoped).
  // Strategy: prefer EXACT activity_name match (which already encodes the
  // time slot in our naming convention, e.g. "كاراتيه - الساعة 6"). Only
  // fall back to broad keyword/group matching when no exact-name level
  // exists — this prevents the picker from listing the sibling's other
  // time-slot levels and causing accidental wrong-slot assignments.
  const matchingLevelsForAssign = useMemo(() => {
    if (!assignTarget) return [];
    const actName = assignTarget.activity?.activity_name || '';
    const actSchedule = assignTarget.activity?.schedule || '';
    const memberBranch = assignTarget.member?.branch_id || null;

    const branchOk = (l) =>
      !memberBranch || !l.branch_id || l.branch_id === memberBranch;

    // 1) Exact activity_name match (preferred, schedule-aware).
    const exact = levels.filter(l => branchOk(l) && (l.activity_name || '') === actName);
    if (exact.length > 0) {
      return exact.slice().sort((a, b) => (a.level_number || 0) - (b.level_number || 0));
    }

    // 2) Fallback: same activity group AND, when both have a schedule/time
    //    slot, those must match too — so a "Karate 5pm" activity won't show
    //    "Karate 6pm" levels by mistake.
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const targetSlot = norm(actSchedule);
    return levels
      .filter(l => {
        if (!branchOk(l)) return false;
        const ln = l.activity_name || '';
        let groupMatch = false;
        for (const g of ACTIVITY_GROUPS) {
          if (g.keywords.some(k => actName.includes(k)) && g.keywords.some(k => ln.includes(k))) {
            groupMatch = true; break;
          }
        }
        if (!groupMatch) return false;
        const lvlSlot = norm(l.time_slot || l.schedule || '');
        // If both sides expose a slot, require equality. If either is empty,
        // accept (legacy levels without time_slot stay reachable).
        if (targetSlot && lvlSlot && targetSlot !== lvlSlot) return false;
        return true;
      })
      .sort((a, b) => (a.level_number || 0) - (b.level_number || 0));
  }, [assignTarget, levels]);

  const loadData = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const today = new Date().toISOString().split('T')[0];
      const [levelsRes, membersRes, branchesRes, activitiesRes, attendanceRes, coachesRes] = await Promise.all([
        levelsAPI.getAll(branchParams),
        membersAPI.getAll(branchParams),
        isAdmin ? branchesAPI.getAll() : Promise.resolve({ data: [] }),
        activitiesAPI.getAll(),
        attendanceAPI.getAll({ date: today }).catch(() => ({ data: [] })),
        coachesAPI.getAll().catch(() => ({ data: [] }))
      ]);
      setLevels(levelsRes.data);
      setMembers(membersRes.data);
      setBranches(branchesRes.data || []);
      setActivities(activitiesRes.data || []);
      setCoaches(coachesRes.data || []);
      
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
    // If the schedule string doesn't reference ANY day name (e.g. time-only
    // strings like "6:00 م"), treat it as matching every day rather than
    // hiding the member from every day filter.
    const allDayNames = Object.values(DAY_ARABIC_MAP).flat();
    const mentionsAnyDay = allDayNames.some(name => schedule.includes(name));
    if (!mentionsAnyDay) return true;
    const dayNames = DAY_ARABIC_MAP[dayId] || [];
    return dayNames.some(name => schedule.includes(name));
  };

  const getFilteredLevelForDay = (level) => {
    if (!selectedDay) return level;
    const filteredDetails = (level.members_details || []).filter(m => memberMatchesDay(m, selectedDay));
    const filteredMembers = filteredDetails.map(m => m.member_id);
    return { ...level, members: filteredMembers, members_details: filteredDetails };
  };

  // True iff the given level is configured to run on `dayId`.
  // Levels created before the days feature have `level.days == null`,
  // which we treat as "all days" so they keep showing up everywhere
  // until an admin opens the editor and saves a specific selection.
  const levelMatchesDay = (level, dayId) => {
    if (!dayId) return true;
    if (!Array.isArray(level?.days) || level.days.length === 0) return true;
    return level.days.includes(dayId);
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

  // Get time slots for selected activity. When `selectedDay` is set,
  // hide slots whose levels are all configured for other days.
  const getTimeSlotsForActivity = (activityId) => {
    const activityLevels = groupedLevels[activityId] || {};
    const slots = Object.keys(activityLevels).filter(slot =>
      activityLevels[slot].some(l => levelMatchesDay(l, selectedDay))
    );
    // Sort by the hour number embedded in the slot name (e.g. "الساعة 4" → 4).
    // Slots without a number fall back to alphabetical order at the end.
    return slots.sort((a, b) => {
      const na = parseInt((a.match(/\d+/) || [Infinity])[0], 10);
      const nb = parseInt((b.match(/\d+/) || [Infinity])[0], 10);
      if (na !== nb) return na - nb;
      return a.localeCompare(b, 'ar');
    });
  };

  // Get levels for selected time slot. Filtered by `selectedDay` when set.
  const getLevelsForTimeSlot = (activityId, timeSlot) => {
    const activityLevels = groupedLevels[activityId] || {};
    const slotLevels = activityLevels[timeSlot] || [];
    return slotLevels.filter(l => levelMatchesDay(l, selectedDay));
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
    // Build a column per distinct level (id). Multiple levels can share the
    // same level_number (e.g. two captains/sub-levels), so grouping by number
    // alone would hide some columns. We key by level.id and order by
    // level_number then by name for stability.
    const allLevelsMap = new Map();
    timeSlots.forEach(slot => {
      (activityLevels[slot] || []).forEach(l => {
        if (l && l.id && !allLevelsMap.has(l.id)) {
          allLevelsMap.set(l.id, l);
        }
      });
    });
    const allLevels = [...allLevelsMap.values()].sort((a, b) => {
      const na = a.level_number || 0;
      const nb = b.level_number || 0;
      if (na !== nb) return na - nb;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });

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

    // Hide members whose subscriptions are all expired so the print exactly
    // matches what's shown on the level cards.
    const isMemberActive = (m) => {
      const full = members.find(mm => mm.id === (m.member_id || m.id));
      if (!full) return false;
      return (full.activities || []).some(isActivityNonExpired);
    };

    // Track member IDs already printed so the same person doesn't appear in
    // more than one time slot. The first slot they show up in (in display
    // order) keeps them; later slots will skip duplicates.
    const printedMemberIds = new Set();
    const memberKey = (m) => m.member_id || m.id || `${m.member_name || m.name_ar || m.name || ''}|${m.member_code || ''}`;

    // Old-style table: one row per time slot. Each row only contains the
    // levels that actually exist for that slot (no empty placeholder cells
    // for levels registered in other slots).
    const renderLevelHeader = (lvl) => {
      const n = lvl.level_number || 0;
      const color = levelColors[n] || '#555';
      const customName = lvl.custom_name || lvl.name || '';
      const titleText = customName ? customName : `المستوى ${n}`;
      const subLine = customName
        ? `<div style="font-size:12px;font-weight:normal;opacity:0.85;margin-top:2px;">المستوى ${n}</div>`
        : '';
      const coachObj = lvl.coach_id ? coaches.find(c => c.id === lvl.coach_id) : null;
      const coachName = coachObj ? (coachObj.name_ar || coachObj.name) : '';
      const coachLine = coachName
        ? `<div style="font-size:12px;font-weight:normal;opacity:0.95;margin-top:4px;background:rgba(255,255,255,0.18);padding:2px 6px;border-radius:4px;display:inline-block;">👤 ${escapeHtml(coachName)}</div>`
        : '';
      return `<th style="border:1px solid #ccc;padding:8px;background:${color};color:#fff;text-align:center;white-space:nowrap;font-size:14px;min-width:130px;">
        <div style="font-size:15px;font-weight:bold;">${escapeHtml(titleText)}</div>
        ${subLine}
        ${coachLine}
      </th>`;
    };

    const slotTables = timeSlots.map(slot => {
      const slotLevels = (activityLevels[slot] || []).slice().sort((a, b) => {
        const na = a.level_number || 0;
        const nb = b.level_number || 0;
        if (na !== nb) return na - nb;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
      });
      if (slotLevels.length === 0) return '';

      const headerCells = slotLevels.map(renderLevelHeader).join('');

      const cells = slotLevels.map(lvl => {
        const membersForDays = (lvl.members_details || [])
          .filter(isMemberActive)
          .filter(memberMatchesAnyDay)
          .filter(m => {
            const k = memberKey(m);
            if (printedMemberIds.has(k)) return false;
            printedMemberIds.add(k);
            return true;
          });
        const memberNames = membersForDays.map(m =>
          `<div style="padding:3px 0;border-bottom:1px dotted #ddd;font-size:16px;">${escapeHtml(m.member_name || m.name_ar || m.name)}</div>`
        ).join('');
        const count = membersForDays.length;
        const bgColor = count === 0 ? '#f9f9f9' : '#fff';
        return `<td style="border:1px solid #ccc;padding:10px;vertical-align:top;background:${bgColor};min-width:120px;">
          <div style="font-size:12px;color:#666;margin-bottom:5px;">(${count})</div>
          ${memberNames || '<span style="color:#bbb;font-size:13px;">-</span>'}
        </td>`;
      }).join('');

      return `<table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:18px;page-break-inside:avoid;">
  <thead>
    <tr>
      <th style="background:#374151;color:#fff;text-align:center;border:1px solid #ccc;padding:8px;font-size:15px;min-width:90px;">الوقت</th>
      ${headerCells}
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="border:1px solid #ccc;padding:10px;font-weight:bold;background:#f0f4f8;white-space:nowrap;text-align:center;font-size:16px;">${escapeHtml(slot)}</td>
      ${cells}
    </tr>
  </tbody>
</table>`;
    }).filter(Boolean).join('');

    const _countedIds = new Set();
    const totalCount = timeSlots.reduce((sum, slot) =>
      sum + (activityLevels[slot] || []).reduce((s, l) =>
        s + (l.members_details || []).filter(isMemberActive).filter(memberMatchesAnyDay).filter(m => {
          const k = memberKey(m);
          if (_countedIds.has(k)) return false;
          _countedIds.add(k);
          return true;
        }).length, 0), 0);

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
  table { width: 100%; border-collapse: collapse; }
  @media print {
    body { padding: 10px; }
    .no-print { display: none; }
    @page { size: A4 landscape; margin: 1cm; }
    table { page-break-inside: avoid; }
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
${slotTables}
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
    const maxCapacity = targetLevel.capacity || (mainActivity === 'swimming' ? 6 : 10);
    
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
        branch_id: isAdmin ? formData.branch_id : undefined,
        coach_id: formData.coach_id && formData.coach_id !== '__none__' ? formData.coach_id : null
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
      branch_id: level.branch_id || 'all',
      coach_id: level.coach_id || '__none__',
      // null/missing days on legacy levels => all 7 selected by default in the
      // editor, so the user can simply uncheck what they don't want.
      days: Array.isArray(level.days) && level.days.length > 0 ? [...level.days] : [...ALL_DAY_IDS]
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
      custom_name: '',
      description: '',
      capacity: 10,
      members: [],
      branch_id: 'all',
      coach_id: '__none__',
      days: [...ALL_DAY_IDS]
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
    // Mirror EXACTLY what the level card shows: count derives from
    // members_details only, mapped to the full member record, and only
    // members with at least one non-expired active subscription occupy a
    // seat. Stub records (no full member) and expired ones are skipped.
    const { mainActivity } = parseActivityName(selectedLevel?.activity_name);
    const detailsList = Array.isArray(selectedLevel?.members_details)
      ? selectedLevel.members_details
      : [];
    const seenIds = new Set();
    const currentCount = detailsList.reduce((acc, md) => {
      const mid = md.member_id || md.id;
      if (!mid || seenIds.has(mid)) return acc;
      seenIds.add(mid);
      const full = members.find(mm => mm.id === mid);
      if (!full) return acc;
      return (full.activities || []).some(isActivityNonExpired) ? acc + 1 : acc;
    }, 0);
    const maxCapacity = selectedLevel?.capacity || (mainActivity === 'swimming' ? 6 : 10);

    if (currentCount >= maxCapacity) {
      toast.error(t(`المستوى ممتلئ (الحد الأقصى ${maxCapacity} أعضاء)`, `Level is full (max ${maxCapacity} members)`));
      return;
    }
    
    try {
      // Ensure the member isn't kept in any other level for the same main
      // activity. We remove them from any conflicting level first, so the
      // same person never appears in two levels.
      const conflictingLevels = (levels || []).filter(l =>
        l.id !== selectedLevel.id &&
        parseActivityName(l.activity_name).mainActivity === mainActivity &&
        (l.members || []).includes(memberId)
      );
      for (const cl of conflictingLevels) {
        try { await levelsAPI.removeMember(cl.id, memberId); } catch (_) { /* ignore */ }
      }

      await levelsAPI.addMember(selectedLevel.id, memberId);
      toast.success(
        conflictingLevels.length > 0
          ? t('تمت إضافة العضو ونُقل من المستوى السابق', 'Member added and moved from previous level')
          : t('تمت إضافة العضو', 'Member added')
      );
      // Refetch fresh data, then re-sync the open dialog's selectedLevel from
      // the refreshed levels list so the right-side "Level Members" panel
      // and members_details immediately reflect the addition.
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      try {
        const [levelsRes, membersRes] = await Promise.all([
          levelsAPI.getAll(branchParams),
          membersAPI.getAll(branchParams),
        ]);
        setLevels(levelsRes.data);
        setMembers(membersRes.data);
        const fresh = (levelsRes.data || []).find(l => l.id === selectedLevel.id);
        if (fresh) setSelectedLevel(fresh);
      } catch (_) {
        // Fallback: optimistic update so the UI still reflects the add.
        setSelectedLevel(prev => ({
          ...prev,
          members: Array.from(new Set([...(prev.members || []), memberId]))
        }));
        loadData();
      }
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
  // Build activity filter options — only show groups that have at least one member
  const activityFilterOptions = useMemo(() => {
    return ACTIVITY_GROUPS.filter(g =>
      members.some(m =>
        (m.activities || []).some(a => a.status === 'active' && matchesGroup(a.activity_name, g.id))
      )
    );
  }, [members]);

  const timeFilterOptions = useMemo(() => {
    const times = new Set();
    members.forEach(m => {
      (m.activities || []).filter(a => a.status === 'active').forEach(a => {
        if (!a.schedule) return;
        if (filterActivity && !matchesGroup(a.activity_name, filterActivity)) return;
        times.add(a.schedule);
      });
    });
    return [...times].sort();
  }, [members, filterActivity]);

  // ── Derive guardian (ولي الأمر) info per member ──
  // Many member records have an empty guardian_name field even though a
  // sibling (parent registered as their own member) shares the same phone.
  // For each phone number, pick the most likely guardian: the adult — i.e.
  // the member without an `age` (or with age >= 18). If everyone on the
  // phone has a child age, fall back to the lowest member_code (oldest
  // registration) as the guardian. Each member then gets the OTHER linked
  // member's name as a derived guardian display.
  const derivedGuardianByMemberId = useMemo(() => {
    const byPhone = {};
    for (const m of members) {
      const phone = (m.phone || '').trim();
      if (!phone) continue;
      (byPhone[phone] = byPhone[phone] || []).push(m);
    }
    const result = {};
    for (const phone of Object.keys(byPhone)) {
      const group = byPhone[phone];
      if (group.length < 2) continue;
      // Pick guardian candidate: prefer the one without a child-like age.
      const adults = group.filter(m => !m.age || Number(m.age) >= 18);
      // Numeric-safe ordering: parse member_code as a number when possible
      // so "20" < "100"; fall back to string compare for non-numeric codes.
      const codeRank = (m) => {
        const n = parseInt(String(m.member_code || ''), 10);
        return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
      };
      const sortByCode = (a, b) => {
        const na = codeRank(a), nb = codeRank(b);
        if (na !== nb) return na - nb;
        return String(a.member_code || '').localeCompare(String(b.member_code || ''));
      };
      const pool = adults.length > 0 ? adults : group;
      const guardian = [...pool].sort(sortByCode)[0];
      const guardianName = guardian.name_ar || guardian.name || '';
      const guardianCode = guardian.member_code || '';
      for (const m of group) {
        if (m.id === guardian.id) continue;
        result[m.id] = { name: guardianName, member_code: guardianCode };
      }
    }
    return result;
  }, [members]);

  const getGuardianDisplay = (member) => {
    const explicit = member.guardian_name_ar || member.guardian_name;
    if (explicit) return { name: explicit, member_code: '' };
    return derivedGuardianByMemberId[member.id] || null;
  };

  // When a level is selected, derive its activity group and time slot so we
  // can hide members who don't actually have a matching, non-expired
  // subscription (avoids showing expired members in the level picker).
  const selectedLevelInfo = selectedLevel ? parseActivityName(selectedLevel.activity_name) : null;
  const isActivityNonExpired = (a) => {
    if (!a || a.status !== 'active') return false;
    if (!a.end_date) return true;
    return a.end_date >= todayStr;
  };

  const _seenAvail = new Set();
  const availableMembers = members.filter(m => {
    if (!m || !m.id) return false;
    if (_seenAvail.has(m.id)) return false;
    _seenAvail.add(m.id);
    if (!selectedLevel) return true;
    return !(selectedLevel.members || []).includes(m.id);
  }).filter(m => {
    // Show every member with at least one non-expired active subscription,
    // regardless of which activity or time slot it's for.
    return (m.activities || []).some(isActivityNonExpired);
  }).filter(m => {
    if (!searchQuery) return true;
    const name = (m.name_ar || m.name || '').toLowerCase();
    const phone = (m.phone || '').toLowerCase();
    const code = (m.member_code || '').toLowerCase();
    return name.includes(searchQuery.toLowerCase()) || 
           phone.includes(searchQuery.toLowerCase()) ||
           code.includes(searchQuery.toLowerCase());
  }).filter(m => {
    if (!filterActivity && !filterTime) return true;
    const activeActs = (m.activities || []).filter(isActivityNonExpired);
    return activeActs.some(a => {
      const actMatch = !filterActivity || matchesGroup(a.activity_name, filterActivity);
      const timeMatch = !filterTime || (a.schedule || '') === filterTime;
      return actMatch && timeMatch;
    });
  });

  // Get members in level. We filter out stale entries whose subscription
  // no longer matches the level's main activity (or whose subscription has
  // expired) — these are legacy/orphan ids in level.members that should
  // never show up in the manage-members dialog.
  const getLevelMembers = (level) => {
    const ids = Array.from(new Set(level.members || []));
    const seen = new Set();
    const levelMain = parseActivityName(level.activity_name).mainActivity;
    return members.filter(m => {
      if (!ids.includes(m.id) || seen.has(m.id)) return false;
      seen.add(m.id);
      const acts = (m.activities || []).filter(isActivityNonExpired);
      if (acts.length === 0) return false;
      // Keep only members whose active subscription matches the level's
      // main activity (swimming/football/karate). Levels parsed as
      // "other" keep their previous broad behavior.
      if (levelMain && levelMain !== 'other') {
        return acts.some(a => parseActivityName(a.activity_name).mainActivity === levelMain);
      }
      return true;
    });
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
    const maxCapacity = originalLevel.capacity || (activityId === 'swimming' ? 6 : 10);
    // Hide members whose subscriptions have expired so they don't appear in
    // the level cards or count toward the displayed enrollment.
    const rawLevelMembers = (level.members_details || []).map(md => {
      const fullMember = members.find(m => m.id === md.member_id);
      return fullMember || { id: md.member_id, name_ar: md.member_name, phone: md.phone, _stub: true };
    });
    const levelMembers = rawLevelMembers.filter(m => {
      if (m._stub) return false;
      return (m.activities || []).some(isActivityNonExpired);
    });
    const memberCount = levelMembers.length;
    const isFull = memberCount >= maxCapacity;
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
              {(() => {
                const lvCoach = level.coach_id ? coaches.find(c => c.id === level.coach_id) : null;
                return lvCoach ? (
                  <p className="text-xs opacity-90 mt-0.5 flex items-center gap-1">
                    <span className="opacity-75">👤</span>
                    {lvCoach.name_ar || lvCoach.name}
                  </p>
                ) : null;
              })()}
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
              {currentView === 'days' && (
                <Button
                  variant="outline"
                  className="gap-2 relative border-red-300 text-red-700 hover:bg-red-50"
                  onClick={openUnassignedDialog}
                  data-testid="open-unassigned-btn"
                >
                  <UserX className="w-4 h-4" />
                  {t('أعضاء بدون مستوى', 'Members without level')}
                  {unassignedCount > 0 && (
                    <span className="ms-1 inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold">
                      {unassignedCount > 99 ? '99+' : unassignedCount}
                    </span>
                  )}
                </Button>
              )}
              {currentView === 'days' && (
                <>
                  <Button
                    variant="outline"
                    className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    onClick={openAutoAssignDialog}
                    data-testid="open-auto-assign-btn"
                  >
                    <Wand2 className="w-4 h-4" />
                    {t('إسناد تلقائي للمستويات', 'Auto-assign members')}
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
                    onClick={() => setCleanupOpen(true)}
                    data-testid="open-levels-cleanup-btn"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    {t('تنظيف بيانات المستويات', 'Clean up level data')}
                  </Button>
                </>
              )}
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
                  if (!levelMatchesDay(l, day.id)) return sum;
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
              const rawActivityLevels = groupedLevels[baseActivity.id] || {};
              // When viewing a specific day, hide time slots whose levels
              // are not configured to run on that day.
              const activityLevels = {};
              Object.keys(rawActivityLevels).forEach(slot => {
                const slotLvls = rawActivityLevels[slot].filter(l => levelMatchesDay(l, selectedDay));
                if (slotLvls.length > 0) activityLevels[slot] = slotLvls;
              });
              const timeSlots = Object.keys(activityLevels);
              const totalLevels = timeSlots.reduce((sum, slot) => sum + activityLevels[slot].length, 0);
              const totalMembers = timeSlots.reduce((sum, slot) =>
                sum + activityLevels[slot].reduce((s, l) => s + getFilteredLevelForDay(l).members.length, 0), 0);
              const totalCapacity = timeSlots.reduce((sum, slot) =>
                sum + activityLevels[slot].reduce((s, l) => s + (l.capacity || (baseActivity.id === 'swimming' ? 6 : 10)), 0), 0);
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
                            {t('الافتراضي 6 لاعبين لكل مستوى', 'Default 6 players per level')}
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
                    const maxCapacity = slotLevels.reduce((sum, l) => sum + (l.capacity || (selectedActivityId === 'swimming' ? 6 : 10)), 0);
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

              {/* Coach assigned to this level */}
              <div>
                <Label>{t('المدرب المسؤول عن هذا المستوى', 'Coach for this Level')}</Label>
                <Select
                  value={formData.coach_id || '__none__'}
                  onValueChange={(value) => setFormData({ ...formData, coach_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('اختر مدرباً (اختياري)', 'Select a coach (optional)')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('بدون مدرب', 'No coach')}</SelectItem>
                    {coaches.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name_ar || c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                  {t('سيظهر هذا المدرب لأعضاء هذا المستوى في صفحات الاشتراكات والجدول وتقييم المدربين.',
                     'This coach will appear for this level\'s members on subscriptions, schedule, and rate-coach pages.')}
                </p>
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
                  <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {t('الافتراضي للسباحة 6 لاعبين — يمكنك تغييره حسب الحاجة', 'Swimming default is 6 — you can change it as needed')}
                  </p>
                )}
              </div>

              {/* Training days — controls which days this level appears on */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>{t('أيام التدريب', 'Training Days')}</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => setFormData({ ...formData, days: [...ALL_DAY_IDS] })}
                    >
                      {t('تحديد الكل', 'Select all')}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-gray-500 hover:underline"
                      onClick={() => setFormData({ ...formData, days: [] })}
                    >
                      {t('إلغاء الكل', 'Clear')}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2 border rounded">
                  {WEEKDAYS.map(d => {
                    const checked = (formData.days || []).includes(d.id);
                    return (
                      <label
                        key={d.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm border ${checked ? 'bg-primary/10 border-primary' : 'border-gray-200 hover:bg-gray-50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const cur = new Set(formData.days || []);
                            if (e.target.checked) cur.add(d.id); else cur.delete(d.id);
                            setFormData({ ...formData, days: Array.from(cur) });
                          }}
                          className="w-4 h-4"
                        />
                        <span>{language === 'ar' ? d.name_ar : d.name_en}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {t('اختر الأيام التي يعمل فيها هذا المستوى. لو ما اخترت أي يوم، لن يظهر المستوى تحت أي يوم.',
                     'Pick the days this level runs on. If none are selected, the level will not appear under any day.')}
                </p>
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
          <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
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
                <Select value={filterActivity || '__all__'} onValueChange={v => { setFilterActivity(v === '__all__' ? '' : v); setFilterTime(''); }}>
                  <SelectTrigger className="flex-1 h-8 text-xs">
                    <SelectValue placeholder={t('كل الأنشطة', 'All activities')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t('كل الأنشطة', 'All activities')}</SelectItem>
                    {activityFilterOptions.map(opt => (
                      <SelectItem key={opt.id} value={opt.id}>{opt.icon} {opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Popover open={timePopoverOpen} onOpenChange={setTimePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="flex-1 h-8 text-xs justify-between font-normal px-2">
                      <span className="truncate">{filterTime || t('كل المواعيد', 'All times')}</span>
                      <ChevronDown className="w-3 h-3 opacity-50 flex-shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="start">
                    <Command>
                      <CommandInput placeholder={t('بحث عن موعد...', 'Search schedule...')} className="h-8 text-xs" />
                      <CommandList className="max-h-48">
                        <CommandEmpty>{t('لا توجد نتائج', 'No results')}</CommandEmpty>
                        <CommandGroup>
                          <CommandItem value="__all__" onSelect={() => { setFilterTime(''); setTimePopoverOpen(false); }}>
                            {t('كل المواعيد', 'All times')}
                          </CommandItem>
                          {timeFilterOptions.map(s => (
                            <CommandItem key={s} value={s} onSelect={() => { setFilterTime(s); setTimePopoverOpen(false); }}>
                              {s}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Capacity Warning */}
              {selectedLevel && (
                <div className={`mb-3 p-2 rounded-lg ${
                  (selectedLevel.members || []).length >= (selectedLevel.capacity || (parseActivityName(selectedLevel.activity_name).mainActivity === 'swimming' ? 6 : 10))
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-green-50 border border-green-200'
                }`}>
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {t('الأعضاء الحاليون', 'Current Members')}: {(selectedLevel.members || []).length}
                    </span>
                    <span>
                      {t('السعة القصوى', 'Max Capacity')}: {
                        selectedLevel.capacity || (parseActivityName(selectedLevel.activity_name).mainActivity === 'swimming' ? 6 : 10)
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
                    {getLevelMembers(selectedLevel || {}).map(member => {
                      const guardian = getGuardianDisplay(member);
                      // Show every non-expired active subscription for the
                      // member so admins can see exactly what they're enrolled
                      // in (activity name, schedule/days, end date).
                      const activeActs = (member.activities || []).filter(isActivityNonExpired);
                      return (
                      <div 
                        key={member.id}
                        className="flex items-start gap-2 p-2 bg-gray-50 rounded hover:bg-gray-100"
                      >
                        <div className={`w-8 h-8 rounded-full ${getLevelColor(selectedLevel?.level_number)} text-white flex items-center justify-center text-sm font-bold flex-shrink-0`}>
                          {(member.name_ar || member.name || '?').charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {member.name_ar || member.name}
                            {member.age ? <span className="text-xs text-orange-500 font-normal mr-1"> ({member.age} سنة)</span> : null}
                          </p>
                          {guardian && (
                            <p className="text-xs text-purple-600 truncate">
                              👤 {t('ولي الأمر:', 'Guardian:')} {guardian.name}
                              {guardian.member_code && <span className="text-gray-400"> · #{guardian.member_code}</span>}
                            </p>
                          )}
                          <p className="text-xs text-gray-500">#{member.member_code}{member.phone ? ` • ${member.phone}` : ''}</p>
                          {activeActs.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {activeActs.map((a, idx) => {
                                const days = (a.training_days && a.training_days.length)
                                  ? a.training_days.join('، ')
                                  : '';
                                const sched = a.schedule || '';
                                const parts = [];
                                if (days) parts.push(days);
                                if (sched) parts.push(sched);
                                const detail = parts.join(' • ');
                                return (
                                  <p key={idx} className="text-xs text-blue-600 truncate">
                                    {a.activity_name}
                                    {detail ? ` — ${detail}` : ''}
                                    {a.end_date ? <span className="text-gray-400"> · {t('حتى', 'until')} {a.end_date}</span> : null}
                                  </p>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-500 hover:bg-red-50 flex-shrink-0"
                          onClick={() => handleRemoveMember(member.id)}
                        >
                          <UserMinus className="w-4 h-4" />
                        </Button>
                      </div>
                      );
                    })}
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
                      const memberActiveActs = (member.activities || []).filter(isActivityNonExpired);
                      const guardian = getGuardianDisplay(member);
                      return (
                        <div 
                          key={member.id}
                          className="flex items-center gap-2 p-2 bg-gray-50 rounded hover:bg-gray-100"
                        >
                          <div className="w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                            {(member.name_ar || member.name || '?').charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {member.name_ar || member.name}
                              {member.age ? <span className="text-xs text-orange-500 font-normal mr-1"> ({member.age} سنة)</span> : null}
                            </p>
                            {guardian && (
                              <p className="text-xs text-purple-600 truncate">
                                👤 {t('ولي الأمر:', 'Guardian:')} {guardian.name}
                                {guardian.member_code && <span className="text-gray-400"> · #{guardian.member_code}</span>}
                              </p>
                            )}
                            <p className="text-xs text-gray-500">#{member.member_code} • {member.phone}</p>
                            {memberActiveActs.length > 0 && (
                              <div className="mt-0.5 space-y-0.5">
                                {memberActiveActs.map((a, idx) => {
                                  const days = (a.training_days && a.training_days.length)
                                    ? a.training_days.join('، ')
                                    : '';
                                  const sched = a.schedule || '';
                                  const parts = [];
                                  if (days) parts.push(days);
                                  if (sched) parts.push(sched);
                                  const detail = parts.join(' • ');
                                  return (
                                    <p key={idx} className="text-xs text-blue-600 truncate">
                                      {a.activity_name}
                                      {detail ? ` — ${detail}` : ''}
                                      {a.end_date ? <span className="text-gray-400"> · {t('حتى', 'until')} {a.end_date}</span> : null}
                                    </p>
                                  );
                                })}
                              </div>
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

        {/* Unassigned Members Dialog */}
        <Dialog open={isUnassignedDialogOpen} onOpenChange={setIsUnassignedDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserX className="w-5 h-5 text-red-500" />
                {t('أعضاء بدون مستوى', 'Members without level')}
                <Badge variant="destructive" className="ms-2">{filteredUnassigned.length}</Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ms-auto h-8 w-8"
                  onClick={loadUnassigned}
                  disabled={unassignedLoading}
                  title={t('تحديث', 'Refresh')}
                >
                  <RefreshCw className={`w-4 h-4 ${unassignedLoading ? 'animate-spin' : ''}`} />
                </Button>
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder={t('بحث بالاسم أو رقم الجوال أو رقم العضوية...', 'Search by name, phone or member code...')}
                    value={unassignedSearch}
                    onChange={(e) => setUnassignedSearch(e.target.value)}
                    className="pe-10"
                    data-testid="unassigned-search"
                  />
                </div>
                <Select
                  value={unassignedActivityFilter || '__all__'}
                  onValueChange={v => setUnassignedActivityFilter(v === '__all__' ? '' : v)}
                >
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder={t('كل الأنشطة', 'All activities')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t('كل الأنشطة', 'All activities')}</SelectItem>
                    {ACTIVITY_GROUPS.map(g => (
                      <SelectItem key={g.id} value={g.id}>{g.icon} {g.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto border rounded-lg">
                {unassignedLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : filteredUnassigned.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-2" />
                    <p className="font-medium">
                      {unassignedData.length === 0
                        ? t('ممتاز! كل الأعضاء النشطين معيّنون لمستويات', 'Excellent! All active members are assigned to levels')
                        : t('لا توجد نتائج بهذه الفلاتر', 'No results match these filters')}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredUnassigned.map(member => (
                      <div key={member.id} className="p-3 hover:bg-gray-50">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                            {(member.name_ar || member.name || '?').charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <p className="font-semibold text-sm">{member.name_ar || member.name}</p>
                              <span className="text-xs text-gray-500">#{member.member_code}</span>
                              <span className="text-xs text-gray-500">• {member.phone}</span>
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {(member.unassigned_activities || [])
                                .filter(a => !unassignedActivityFilter || matchesGroup(a.activity_name, unassignedActivityFilter))
                                .map((act, idx) => (
                                <div key={idx} className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-amber-900 truncate">
                                      {act.activity_name || t('نشاط', 'Activity')}
                                    </p>
                                    <p className="text-xs text-amber-700 truncate">
                                      {act.schedule && <span>⏰ {act.schedule}</span>}
                                      {act.end_date && <span className="ms-2">🗓️ {t('حتى', 'until')} {act.end_date}</span>}
                                    </p>
                                  </div>
                                  <Button
                                    size="sm"
                                    className="gap-1 flex-shrink-0 bg-primary hover:bg-primary/90"
                                    onClick={() => openAssignPicker(member, act)}
                                    data-testid={`assign-${member.id}-${idx}`}
                                  >
                                    <UserPlus className="w-3.5 h-3.5" />
                                    {t('تعيين لمستوى', 'Assign to level')}
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setIsUnassignedDialogOpen(false)}>
                {t('إغلاق', 'Close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Assign-to-Level Picker Dialog */}
        <Dialog open={assignPickerOpen} onOpenChange={(o) => { setAssignPickerOpen(o); if (!o) setAssignTarget(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" />
                {t('اختر المستوى', 'Choose Level')}
              </DialogTitle>
            </DialogHeader>
            {assignTarget && (
              <div className="space-y-3">
                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                  <p className="font-medium">{assignTarget.member.name_ar || assignTarget.member.name}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {assignTarget.activity?.activity_name}
                    {assignTarget.activity?.schedule && <span> • ⏰ {assignTarget.activity.schedule}</span>}
                  </p>
                </div>
                <div className="max-h-72 overflow-y-auto space-y-2 -mx-1 px-1">
                  {matchingLevelsForAssign.length === 0 ? (
                    <p className="text-center text-sm text-gray-500 py-6">
                      {t('لا توجد مستويات متاحة لهذا النشاط', 'No levels available for this activity')}
                    </p>
                  ) : matchingLevelsForAssign.map(level => {
                    const memberCount = (level.members || []).length;
                    const maxCap = level.activity_name?.includes('سباحة') ? 6 : (level.capacity || 10);
                    const isFull = memberCount >= maxCap;
                    return (
                      <button
                        key={level.id}
                        onClick={() => !isFull && !assigning && handleAssignToLevel(level)}
                        disabled={isFull || assigning}
                        className={`w-full text-start p-3 rounded-lg border-2 transition-all ${
                          isFull
                            ? 'opacity-50 cursor-not-allowed bg-gray-50 border-gray-200'
                            : 'hover:border-primary hover:bg-primary/5 border-gray-200'
                        }`}
                        data-testid={`pick-level-${level.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge className={`${getLevelColor(level.level_number)} text-white`}>
                              {t('مستوى', 'Lv')} {level.level_number}
                            </Badge>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{level.custom_name || level.activity_name}</p>
                              <p className="text-xs text-gray-500 truncate">{level.activity_name}</p>
                              {(level.time_slot || level.schedule) && (
                                <p className="text-xs font-bold text-amber-700 mt-1 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {level.time_slot || level.schedule}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-gray-600 flex-shrink-0 text-end">
                            <div>{memberCount}/{maxCap}</div>
                            {isFull && (
                              <Badge variant="destructive" className="text-[10px] mt-1">
                                {t('ممتلئ', 'Full')}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setAssignPickerOpen(false); setAssignTarget(null); }} disabled={assigning}>
                {t('إلغاء', 'Cancel')}
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

        {/* Auto-Assign Members Dialog */}
        <Dialog open={isAutoAssignOpen} onOpenChange={(o) => { if (!autoAssignConfirming) setIsAutoAssignOpen(o); }}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-emerald-600" />
                {t('إسناد تلقائي للأعضاء على المستويات', 'Auto-assign members to levels')}
              </DialogTitle>
            </DialogHeader>

            {autoAssignLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                <span className="ms-3 text-gray-600">{t('جاري تحضير خطة الإسناد...', 'Preparing assignment plan...')}</span>
              </div>
            )}

            {!autoAssignLoading && autoAssignPlan && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  {t(
                    'النظام سيقرأ اشتراكات الأعضاء من سجلاتهم والفواتير ونماذج التسجيل، ويسند كل عضو لأقل مستوى رقماً متاحاً للنشاط الذي اشترك فيه.',
                    'The system reads each member\'s subscriptions from their record, invoices, and registration forms, and assigns each member to the lowest available level for their activity.'
                  )}
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-center">
                    <div className="text-2xl font-bold text-emerald-700">{autoAssignPlan.totals?.would_assign || 0}</div>
                    <div className="text-xs text-emerald-600 mt-1">{t('سيتم إسنادهم', 'Will be assigned')}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-center">
                    <div className="text-2xl font-bold text-amber-700">{autoAssignPlan.totals?.unmatched || 0}</div>
                    <div className="text-xs text-amber-600 mt-1">{t('بدون مستوى مطابق', 'No matching level')}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-center">
                    <div className="text-2xl font-bold text-blue-700">{autoAssignPlan.totals?.already_correct || 0}</div>
                    <div className="text-xs text-blue-600 mt-1">{t('مُسندون مسبقاً', 'Already assigned')}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-center">
                    <div className="text-2xl font-bold text-gray-700">{autoAssignPlan.totals?.candidate_levels || 0}</div>
                    <div className="text-xs text-gray-600 mt-1">{t('مستويات متاحة', 'Available levels')}</div>
                  </div>
                </div>

                {autoAssignPlan.by_source && (
                  <div className="text-xs text-gray-600 flex flex-wrap gap-3 px-1">
                    <span>{t('المصدر:', 'Source:')}</span>
                    <span>{sourceLabel('member_activities')}: <strong>{autoAssignPlan.by_source.member_activities || 0}</strong></span>
                    <span>·</span>
                    <span>{sourceLabel('invoices')}: <strong>{autoAssignPlan.by_source.invoices || 0}</strong></span>
                    <span>·</span>
                    <span>{sourceLabel('registration_forms')}: <strong>{autoAssignPlan.by_source.registration_forms || 0}</strong></span>
                  </div>
                )}

                {(autoAssignPlan.by_activity || []).length > 0 && (
                  <div>
                    <h3 className="font-semibold text-gray-800 mb-2">
                      {t('الإسنادات المقترحة حسب النشاط', 'Proposed assignments by activity')}
                    </h3>
                    <div className="space-y-2">
                      {autoAssignPlan.by_activity.map((bucket) => {
                        const isOpen = !!autoAssignExpanded[bucket.activity_name];
                        return (
                          <div key={bucket.activity_name} className="border border-gray-200 rounded-lg overflow-hidden">
                            <button
                              type="button"
                              className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 text-start"
                              onClick={() => setAutoAssignExpanded(prev => ({ ...prev, [bucket.activity_name]: !isOpen }))}
                            >
                              <span className="font-medium text-gray-800">{bucket.activity_name}</span>
                              <span className="flex items-center gap-2">
                                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">{bucket.count}</span>
                                {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </span>
                            </button>
                            {isOpen && (
                              <div className="divide-y divide-gray-100">
                                {bucket.assignments.map((a, idx) => (
                                  <div key={`${a.member_id}-${idx}`} className="px-4 py-2 flex items-center justify-between text-sm">
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-gray-800 truncate">{a.member_name}</div>
                                      <div className="text-xs text-gray-500 truncate">
                                        {a.phone || ''}{a.member_code ? ` · ${a.member_code}` : ''}
                                        {a.schedule ? ` · ${a.schedule}` : ''}
                                      </div>
                                    </div>
                                    <div className="text-end ms-3">
                                      <div className="font-semibold text-emerald-700">{a.level_name}</div>
                                      <div className="text-[10px] text-gray-400">{sourceLabel(a.source)}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(autoAssignPlan.unmatched || []).length > 0 && (
                  <div className="border border-amber-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-4 py-2 bg-amber-50 hover:bg-amber-100 text-start"
                      onClick={() => setAutoAssignShowUnmatched(v => !v)}
                    >
                      <span className="font-medium text-amber-800 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        {t('أعضاء لم يتم إسنادهم', 'Unmatched members')}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 font-bold">
                          {autoAssignPlan.unmatched.length}
                        </span>
                        {autoAssignShowUnmatched ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </span>
                    </button>
                    {autoAssignShowUnmatched && (
                      <div className="divide-y divide-amber-100 max-h-72 overflow-y-auto">
                        {autoAssignPlan.unmatched.map((u, idx) => (
                          <div key={`${u.member_id}-${idx}`} className="px-4 py-2 text-sm">
                            <div className="flex items-center justify-between">
                              <div className="font-medium text-gray-800">{u.member_name}</div>
                              <div className="text-xs text-amber-700">{language === 'ar' ? u.reason : (u.reason_en || u.reason)}</div>
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {u.activity_name}{u.schedule ? ` · ${u.schedule}` : ''}{u.phone ? ` · ${u.phone}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {(!autoAssignPlan.totals?.would_assign && !autoAssignPlan.totals?.unmatched) && (
                  <div className="text-center py-6 text-gray-500">
                    {t('لا توجد اشتراكات تحتاج إسناد حالياً', 'No subscriptions need assignment right now')}
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setIsAutoAssignOpen(false)} disabled={autoAssignConfirming}>
                {t('إلغاء', 'Cancel')}
              </Button>
              <Button
                onClick={confirmAutoAssign}
                disabled={autoAssignConfirming || autoAssignLoading || !autoAssignPlan?.totals?.would_assign}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                data-testid="confirm-auto-assign-btn"
              >
                {autoAssignConfirming && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('تأكيد الإسناد', 'Confirm assignment')}
                {autoAssignPlan?.totals?.would_assign ? ` (${autoAssignPlan.totals.would_assign})` : ''}
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
