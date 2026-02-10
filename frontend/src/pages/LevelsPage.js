import React, { useState, useEffect } from 'react';
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
import { levelsAPI, membersAPI, branchesAPI, activitiesAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, Edit, Trash2, Loader2, Layers, Users, Dumbbell, UserPlus, UserMinus, Search,
  ChevronDown, ChevronUp, ChevronRight, Clock, AlertTriangle, ArrowRight, ArrowLeft, Home,
  GripVertical, Move
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
  
  // Navigation states for drill-down view
  const [currentView, setCurrentView] = useState('activities'); // 'activities' | 'times' | 'levels'
  const [selectedActivityId, setSelectedActivityId] = useState(null);
  const [selectedTimeSlotKey, setSelectedTimeSlotKey] = useState(null);
  
  // Drag and drop states
  const [draggedMember, setDraggedMember] = useState(null);
  const [draggedFromLevel, setDraggedFromLevel] = useState(null);
  const [dropTargetLevel, setDropTargetLevel] = useState(null);
  
  // Time slot edit/delete dialog
  const [isTimeSlotEditDialogOpen, setIsTimeSlotEditDialogOpen] = useState(false);
  const [editingTimeSlot, setEditingTimeSlot] = useState({ oldName: '', newName: '', activityId: '' });
  
  // Expanded states for accordion (fallback)
  const [expandedActivities, setExpandedActivities] = useState({});
  const [expandedTimeSlots, setExpandedTimeSlots] = useState({});

  const levelNumbers = [1, 2, 3, 4, 5, 6];

  const [formData, setFormData] = useState({
    level_number: 1,
    main_activity: '',
    time_slot: '',
    activity_name: '',
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
      const [levelsRes, membersRes, branchesRes, activitiesRes] = await Promise.all([
        levelsAPI.getAll(branchParams),
        membersAPI.getAll(branchParams),
        isAdmin ? branchesAPI.getAll() : Promise.resolve({ data: [] }),
        activitiesAPI.getAll()
      ]);
      setLevels(levelsRes.data);
      setMembers(membersRes.data);
      setBranches(branchesRes.data || []);
      setActivities(activitiesRes.data || []);
      
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
    
    // Extract time slot (e.g., "الساعة 4", "الساعه 5")
    const timeMatch = activityName.match(/الساع[ةه]\s*(\d+)/i);
    const timeSlot = timeMatch ? `الساعة ${timeMatch[1]}` : '';
    
    return { mainActivity, timeSlot, original: activityName };
  };

  const getMainActivityFromName = (activityName) => {
    return parseActivityName(activityName).mainActivity;
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
    return MAIN_ACTIVITIES.find(a => a.id === activityId) || {
      id: 'other',
      name_ar: 'أخرى',
      name_en: 'Other',
      icon: '📋',
      color: 'bg-gray-500',
      maxCapacity: 10
    };
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
    }
  };

  // Go to home (activities view)
  const goHome = () => {
    setCurrentView('activities');
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
      // Get all levels with this time slot and update their activity_name
      const levelsToUpdate = getLevelsForTimeSlot(editingTimeSlot.activityId, editingTimeSlot.oldName);
      
      for (const level of levelsToUpdate) {
        await levelsAPI.update(level.id, {
          ...level,
          activity_name: editingTimeSlot.newName
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
      capacity: level.capacity || 10,
      members: level.members || [],
      branch_id: level.branch_id || 'all'
    });
    setIsDialogOpen(true);
  };

  const handleAddNewLevel = (mainActivityId, timeSlot) => {
    const activityInfo = getMainActivityInfo(mainActivityId);
    const defaultCapacity = mainActivityId === 'swimming' ? 6 : activityInfo.maxCapacity;
    
    resetForm();
    setFormData(prev => ({
      ...prev,
      main_activity: mainActivityId,
      time_slot: timeSlot,
      activity_name: timeSlot || activityInfo.name_ar,
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

  // Filter members not in current level
  const availableMembers = members.filter(m => {
    if (!selectedLevel) return true;
    return !(selectedLevel.members || []).includes(m.id);
  }).filter(m => {
    if (!searchQuery) return true;
    const name = (m.name_ar || m.name || '').toLowerCase();
    const phone = (m.phone || '').toLowerCase();
    const code = (m.member_code || '').toLowerCase();
    return name.includes(searchQuery.toLowerCase()) || 
           phone.includes(searchQuery.toLowerCase()) ||
           code.includes(searchQuery.toLowerCase());
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

  // Render a level card component with drag & drop support
  const renderLevelCard = (level, activityId) => {
    const memberCount = (level.members || []).length;
    const maxCapacity = activityId === 'swimming' ? 6 : (level.capacity || 10);
    const isFull = memberCount >= maxCapacity;
    const levelMembers = getLevelMembers(level);
    const isDropTarget = dropTargetLevel === level.id;
    
    return (
      <div 
        key={level.id}
        className={`border rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 
          ${isFull ? 'border-red-300 bg-red-50/30' : 'bg-white'}
          ${isDropTarget ? 'ring-2 ring-primary ring-offset-2 scale-[1.02]' : ''}`}
        data-testid={`level-card-${level.id}`}
        onDragOver={(e) => handleDragOver(e, level)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, level)}
      >
        {/* Level Header */}
        <div className={`${getLevelColor(level.level_number)} text-white p-3 flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <span className="text-2xl font-bold">{level.level_number}</span>
            </div>
            <div>
              <span className="text-sm opacity-90">{t('المستوى', 'Level')}</span>
              <p className="text-xs opacity-75">{level.activity_name}</p>
            </div>
          </div>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white hover:bg-white/20"
              onClick={() => handleEdit(level)}
              data-testid={`edit-level-${level.id}`}
            >
              <Edit className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white hover:bg-white/20"
              onClick={() => handleDelete(level)}
              data-testid={`delete-level-${level.id}`}
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
          <div className="space-y-1.5 max-h-32 overflow-y-auto mb-3 scrollbar-thin">
            {levelMembers.length === 0 ? (
              <p className="text-center text-gray-400 py-3 text-sm">
                {t('لا يوجد لاعبين', 'No players')}
              </p>
            ) : (
              <>
                {levelMembers.slice(0, 5).map(member => (
                  <div 
                    key={member.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, member, level)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-grab active:cursor-grabbing
                      ${draggedMember?.id === member.id ? 'opacity-50 scale-95' : ''}`}
                  >
                    <GripVertical className="w-4 h-4 text-gray-400 shrink-0" />
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
                ))}
                {levelMembers.length > 5 && (
                  <p className="text-center text-gray-500 text-xs py-1 bg-gray-50 rounded-lg">
                    +{levelMembers.length - 5} {t('آخرين', 'more')}
                  </p>
                )}
              </>
            )}
          </div>
          
          {/* Manage Button */}
          <Button
            variant="outline"
            onClick={() => openMembersDialog(level)}
            className="w-full gap-2 h-9"
            data-testid={`manage-members-${level.id}`}
          >
            <UserPlus className="w-4 h-4" />
            {t('إدارة الأعضاء', 'Manage Members')}
          </Button>
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
          {currentView !== 'activities' && (
            <div className="flex items-center gap-2 mb-4 text-sm">
              <Button
                variant="ghost"
                size="sm"
                onClick={goHome}
                className="gap-1 text-gray-600 hover:text-primary"
                data-testid="breadcrumb-home"
              >
                <Home className="w-4 h-4" />
                {t('الأنشطة', 'Activities')}
              </Button>
              
              {currentView === 'times' && selectedActivityId && (
                <>
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
              {currentView !== 'activities' && (
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
                  {currentView === 'activities' && t('المستويات', 'Levels')}
                  {currentView === 'times' && (
                    <>
                      <span>{getCurrentActivity().icon}</span>
                      {language === 'ar' ? getCurrentActivity().name_ar : getCurrentActivity().name_en}
                    </>
                  )}
                  {currentView === 'levels' && selectedTimeSlotKey}
                </h1>
                <p className="text-gray-500 text-sm mt-1">
                  {currentView === 'activities' && t('اختر النشاط لعرض الأوقات والمستويات', 'Select an activity to view times and levels')}
                  {currentView === 'times' && t('اختر الوقت لعرض المستويات', 'Select a time to view levels')}
                  {currentView === 'levels' && t('إدارة اللاعبين في كل مستوى', 'Manage players in each level')}
                </p>
              </div>
            </div>
            <Button 
              onClick={() => { 
                if (currentView === 'levels' && selectedActivityId && selectedTimeSlotKey) {
                  handleAddNewLevel(selectedActivityId, selectedTimeSlotKey);
                } else if (currentView === 'times' && selectedActivityId) {
                  handleAddNewLevel(selectedActivityId, '');
                } else {
                  resetForm(); 
                  setIsDialogOpen(true);
                }
              }} 
              className="gap-2"
              data-testid="add-level-btn"
            >
              <Plus className="w-4 h-4" />
              {t('إضافة مستوى', 'Add Level')}
            </Button>
          </div>
        </div>

        {/* VIEW: Activities (Main View) */}
        {currentView === 'activities' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="activities-view">
            {MAIN_ACTIVITIES.map(activity => {
              const activityLevels = groupedLevels[activity.id] || {};
              const timeSlots = Object.keys(activityLevels);
              const totalLevels = timeSlots.reduce((sum, slot) => sum + activityLevels[slot].length, 0);
              const totalMembers = timeSlots.reduce((sum, slot) => 
                sum + activityLevels[slot].reduce((s, l) => s + (l.members || []).length, 0), 0);
              
              return (
                <Card 
                  key={activity.id} 
                  className={`overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02] border-2 border-transparent hover:border-${activity.color.replace('bg-', '')}`}
                  onClick={() => navigateToTimes(activity.id)}
                  data-testid={`activity-card-${activity.id}`}
                >
                  <div className={`${activity.color} text-white p-6`}>
                    <div className="flex items-center justify-between">
                      <span className="text-5xl">{activity.icon}</span>
                      <div className={`p-2 rounded-full bg-white/20`}>
                        {language === 'ar' ? <ArrowLeft className="w-6 h-6" /> : <ArrowRight className="w-6 h-6" />}
                      </div>
                    </div>
                    <h2 className="font-bold text-2xl mt-4">
                      {language === 'ar' ? activity.name_ar : activity.name_en}
                    </h2>
                    {activity.id === 'swimming' && (
                      <Badge className="bg-white/20 text-white border-0 mt-2">
                        {t('الحد الأقصى 6 لاعبين', 'Max 6 players')}
                      </Badge>
                    )}
                  </div>
                  <CardContent className="p-4 bg-white">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 bg-gray-50 rounded-lg">
                        <p className="text-2xl font-bold text-gray-800">{timeSlots.length}</p>
                        <p className="text-xs text-gray-500">{t('أوقات', 'Times')}</p>
                      </div>
                      <div className="p-2 bg-gray-50 rounded-lg">
                        <p className="text-2xl font-bold text-gray-800">{totalLevels}</p>
                        <p className="text-xs text-gray-500">{t('مستويات', 'Levels')}</p>
                      </div>
                      <div className="p-2 bg-gray-50 rounded-lg">
                        <p className="text-2xl font-bold text-gray-800">{totalMembers}</p>
                        <p className="text-xs text-gray-500">{t('لاعب', 'Players')}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Other Activities Card */}
            {groupedLevels['other'] && Object.keys(groupedLevels['other']).length > 0 && (
              <Card 
                className="overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300"
                onClick={() => navigateToTimes('other')}
                data-testid="activity-card-other"
              >
                <div className="bg-gray-500 text-white p-6">
                  <div className="flex items-center justify-between">
                    <span className="text-5xl">📋</span>
                    <div className="p-2 rounded-full bg-white/20">
                      {language === 'ar' ? <ArrowLeft className="w-6 h-6" /> : <ArrowRight className="w-6 h-6" />}
                    </div>
                  </div>
                  <h2 className="font-bold text-2xl mt-4">{t('أخرى', 'Other')}</h2>
                </div>
                <CardContent className="p-4 bg-white">
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="p-2 bg-gray-50 rounded-lg">
                      <p className="text-2xl font-bold text-gray-800">{Object.keys(groupedLevels['other']).length}</p>
                      <p className="text-xs text-gray-500">{t('مستويات', 'Levels')}</p>
                    </div>
                    <div className="p-2 bg-gray-50 rounded-lg">
                      <p className="text-2xl font-bold text-gray-800">
                        {Object.values(groupedLevels['other']).flat().reduce((s, l) => s + (l.members || []).length, 0)}
                      </p>
                      <p className="text-xs text-gray-500">{t('لاعب', 'Players')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

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
                    <p className="text-gray-500 mb-4">
                      {t('لم يتم إضافة أوقات لهذا النشاط بعد', 'No time slots have been added for this activity yet')}
                    </p>
                    <Button onClick={() => handleAddNewLevel(selectedActivityId, '')} className="gap-2">
                      <Plus className="w-4 h-4" />
                      {t('إضافة مستوى جديد', 'Add New Level')}
                    </Button>
                  </div>
                );
              }
              
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {timeSlots.map(timeSlot => {
                    const slotLevels = getLevelsForTimeSlot(selectedActivityId, timeSlot);
                    const slotMembers = slotLevels.reduce((sum, l) => sum + (l.members || []).length, 0);
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
                    onClick={() => handleAddNewLevel(selectedActivityId, '')}
                    data-testid="add-time-slot-card"
                  >
                    <div className="p-8 flex flex-col items-center justify-center h-full min-h-[180px]">
                      <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center mb-3">
                        <Plus className="w-7 h-7 text-gray-500" />
                      </div>
                      <p className="font-medium text-gray-600">{t('إضافة مستوى جديد', 'Add New Level')}</p>
                      <p className="text-sm text-gray-400 mt-1">{t('وقت جديد أو مستوى موجود', 'New time or existing level')}</p>
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
                    <Button onClick={() => handleAddNewLevel(selectedActivityId, selectedTimeSlotKey)} className="gap-2">
                      <Plus className="w-4 h-4" />
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
                            {slotLevels.length} {t('مستويات', 'levels')} • {slotLevels.reduce((s, l) => s + (l.members || []).length, 0)} {t('لاعب', 'players')}
                          </p>
                        </div>
                      </div>
                      <Button 
                        variant="secondary" 
                        onClick={() => handleAddNewLevel(selectedActivityId, selectedTimeSlotKey)}
                        className="gap-2"
                      >
                        <Plus className="w-4 h-4" />
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
              {/* Main Activity */}
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

              {/* Time Slot */}
              <div>
                <Label>{t('الوقت (الساعة)', 'Time Slot')}</Label>
                <Select
                  value={formData.time_slot}
                  onValueChange={(value) => {
                    const activityInfo = getMainActivityInfo(formData.main_activity);
                    setFormData({ 
                      ...formData, 
                      time_slot: value,
                      activity_name: value || activityInfo.name_ar
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

              {/* Level Number */}
              <div>
                <Label>{t('رقم المستوى', 'Level Number')} *</Label>
                <Select
                  value={String(formData.level_number)}
                  onValueChange={(value) => setFormData({ ...formData, level_number: parseInt(value) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {levelNumbers.map(num => (
                      <SelectItem key={num} value={String(num)}>
                        {t('المستوى', 'Level')} {num}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                    {availableMembers.slice(0, 50).map(member => (
                      <div 
                        key={member.id}
                        className="flex items-center gap-2 p-2 bg-gray-50 rounded hover:bg-gray-100"
                      >
                        <div className="w-8 h-8 rounded-full bg-gray-400 text-white flex items-center justify-center text-sm font-bold">
                          {(member.name_ar || member.name || '?').charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{member.name_ar || member.name}</p>
                          <p className="text-xs text-gray-500">#{member.member_code} • {member.phone}</p>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-green-500 hover:bg-green-50"
                          onClick={() => handleAddMember(member.id)}
                        >
                          <UserPlus className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
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
      </div>
    </Layout>
  );
};

export default LevelsPage;
