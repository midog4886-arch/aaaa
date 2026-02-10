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
  ChevronDown, ChevronUp, Clock, AlertTriangle, ArrowRight, ArrowLeft, Home
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
  
  // Expanded states for accordion
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

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto" data-testid="levels-page">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Layers className="w-6 h-6 text-primary" />
              {t('المستويات', 'Levels')}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {t('إدارة مستويات اللاعبين حسب النشاط والساعة', 'Manage player levels by activity and time')}
            </p>
          </div>
          <Button onClick={() => { resetForm(); setIsDialogOpen(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            {t('إضافة مستوى', 'Add Level')}
          </Button>
        </div>

        {/* Main Activities */}
        <div className="space-y-4">
          {MAIN_ACTIVITIES.map(activity => {
            const activityLevels = groupedLevels[activity.id] || {};
            const timeSlots = Object.keys(activityLevels);
            const totalLevels = timeSlots.reduce((sum, slot) => sum + activityLevels[slot].length, 0);
            const totalMembers = timeSlots.reduce((sum, slot) => 
              sum + activityLevels[slot].reduce((s, l) => s + (l.members || []).length, 0), 0);
            const isExpanded = expandedActivities[activity.id];
            
            return (
              <Card key={activity.id} className="overflow-hidden">
                {/* Activity Header */}
                <div 
                  className={`${activity.color} text-white p-4 cursor-pointer hover:opacity-90 transition-opacity`}
                  onClick={() => toggleActivity(activity.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{activity.icon}</span>
                      <div>
                        <h2 className="font-bold text-xl">
                          {language === 'ar' ? activity.name_ar : activity.name_en}
                        </h2>
                        <div className="flex gap-3 text-sm opacity-90 mt-1">
                          <span>{timeSlots.length} {t('أوقات', 'time slots')}</span>
                          <span>•</span>
                          <span>{totalLevels} {t('مستويات', 'levels')}</span>
                          <span>•</span>
                          <span>{totalMembers} {t('لاعب', 'players')}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {activity.id === 'swimming' && (
                        <Badge className="bg-white/20 text-white border-0">
                          {t('الحد الأقصى 6 لاعبين', 'Max 6 players')}
                        </Badge>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-white hover:bg-white/20"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddNewLevel(activity.id, '');
                        }}
                      >
                        <Plus className="w-5 h-5" />
                      </Button>
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </div>
                  </div>
                </div>

                {/* Time Slots */}
                {isExpanded && (
                  <CardContent className="p-4">
                    {timeSlots.length > 0 ? (
                      <div className="space-y-4">
                        {timeSlots.map(timeSlot => {
                          const slotLevels = activityLevels[timeSlot] || [];
                          const slotKey = `${activity.id}-${timeSlot}`;
                          const isSlotExpanded = expandedTimeSlots[slotKey] !== false; // Default expanded
                          const slotMembers = slotLevels.reduce((sum, l) => sum + (l.members || []).length, 0);
                          
                          return (
                            <div key={timeSlot} className="border rounded-lg overflow-hidden">
                              {/* Time Slot Header */}
                              <div 
                                className="bg-gray-100 p-3 cursor-pointer hover:bg-gray-200 transition-colors flex items-center justify-between"
                                onClick={() => toggleTimeSlot(activity.id, timeSlot)}
                              >
                                <div className="flex items-center gap-3">
                                  <Clock className="w-5 h-5 text-gray-600" />
                                  <span className="font-bold text-gray-800">{timeSlot}</span>
                                  <Badge variant="secondary">
                                    {slotLevels.length} {t('مستويات', 'levels')} • {slotMembers} {t('لاعب', 'players')}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAddNewLevel(activity.id, timeSlot);
                                    }}
                                  >
                                    <Plus className="w-4 h-4" />
                                    {t('مستوى', 'Level')}
                                  </Button>
                                  {isSlotExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </div>
                              </div>

                              {/* Levels Grid */}
                              {isSlotExpanded && (
                                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                  {slotLevels.map(level => {
                                    const memberCount = (level.members || []).length;
                                    const maxCapacity = activity.id === 'swimming' ? 6 : (level.capacity || 10);
                                    const isFull = memberCount >= maxCapacity;
                                    const levelMembers = getLevelMembers(level);
                                    
                                    return (
                                      <div 
                                        key={level.id}
                                        className={`border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow ${isFull ? 'border-red-300' : ''}`}
                                      >
                                        {/* Level Header */}
                                        <div className={`${getLevelColor(level.level_number)} text-white p-2 flex items-center justify-between`}>
                                          <div className="flex items-center gap-2">
                                            <span className="text-xl font-bold">{level.level_number}</span>
                                            <span className="text-xs opacity-90">{t('المستوى', 'Level')}</span>
                                          </div>
                                          <div className="flex gap-1">
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="h-7 w-7 text-white hover:bg-white/20"
                                              onClick={() => handleEdit(level)}
                                            >
                                              <Edit className="w-3 h-3" />
                                            </Button>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="h-7 w-7 text-white hover:bg-white/20"
                                              onClick={() => handleDelete(level)}
                                            >
                                              <Trash2 className="w-3 h-3" />
                                            </Button>
                                          </div>
                                        </div>
                                        
                                        {/* Level Content */}
                                        <div className="p-2">
                                          {/* Capacity Bar */}
                                          <div className="mb-2">
                                            <div className="flex items-center justify-between text-xs mb-1">
                                              <span className={`font-medium ${isFull ? 'text-red-600' : 'text-gray-600'}`}>
                                                {memberCount}/{maxCapacity} {t('لاعب', 'players')}
                                              </span>
                                              {isFull && (
                                                <span className="text-red-600 flex items-center gap-1">
                                                  <AlertTriangle className="w-3 h-3" />
                                                  {t('ممتلئ', 'Full')}
                                                </span>
                                              )}
                                            </div>
                                            <div className="w-full bg-gray-200 rounded-full h-2">
                                              <div 
                                                className={`h-2 rounded-full transition-all ${isFull ? 'bg-red-500' : 'bg-green-500'}`}
                                                style={{ width: `${Math.min((memberCount / maxCapacity) * 100, 100)}%` }}
                                              />
                                            </div>
                                          </div>
                                          
                                          {/* Members Preview */}
                                          <div className="space-y-1 max-h-24 overflow-y-auto mb-2">
                                            {levelMembers.slice(0, 4).map(member => (
                                              <div 
                                                key={member.id}
                                                className="flex items-center gap-1 p-1 bg-gray-50 rounded text-xs"
                                              >
                                                <div className={`w-5 h-5 rounded-full ${getLevelColor(level.level_number)} text-white flex items-center justify-center text-[10px] font-bold`}>
                                                  {(member.name_ar || member.name || '?').charAt(0)}
                                                </div>
                                                <span className="flex-1 truncate text-xs">{member.name_ar || member.name}</span>
                                                <span className="text-gray-400 text-[10px]">#{member.member_code}</span>
                                              </div>
                                            ))}
                                            {levelMembers.length > 4 && (
                                              <p className="text-center text-gray-400 text-[10px] py-0.5">
                                                +{levelMembers.length - 4} {t('آخرين', 'more')}
                                              </p>
                                            )}
                                          </div>
                                          
                                          {/* Manage Button */}
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => openMembersDialog(level)}
                                            className="w-full gap-1 h-7 text-xs"
                                          >
                                            <UserPlus className="w-3 h-3" />
                                            {t('إدارة الأعضاء', 'Manage')}
                                          </Button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>{t('لا توجد مستويات لهذا النشاط', 'No levels for this activity')}</p>
                        <Button 
                          variant="outline" 
                          className="mt-3"
                          onClick={() => handleAddNewLevel(activity.id, '')}
                        >
                          <Plus className="w-4 h-4 me-2" />
                          {t('إضافة مستوى', 'Add Level')}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}

          {/* Other Activities (if any) */}
          {groupedLevels['other'] && Object.keys(groupedLevels['other']).length > 0 && (
            <Card className="overflow-hidden">
              <div className="bg-gray-500 text-white p-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">📋</span>
                  <h2 className="font-bold text-xl">{t('أخرى', 'Other')}</h2>
                </div>
              </div>
              <CardContent className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Object.entries(groupedLevels['other']).map(([name, lvls]) => 
                    lvls.map(level => (
                      <div key={level.id} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold">{level.activity_name}</span>
                          <Badge>{t('المستوى', 'Level')} {level.level_number}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">
                            {(level.members || []).length} {t('لاعب', 'players')}
                          </span>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => handleEdit(level)}>
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => openMembersDialog(level)}>
                              <Users className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

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
