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
import { Checkbox } from '../components/ui/checkbox';
import { levelsAPI, activitiesAPI, membersAPI, branchesAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, 
  Edit, 
  Trash2,
  Loader2,
  Layers,
  Users,
  Dumbbell,
  UserPlus,
  UserMinus,
  Search
} from 'lucide-react';

export const LevelsPage = () => {
  const { t, language } = useLanguage();
  const { user, selectedBranchId } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [levels, setLevels] = useState([]);
  const [activities, setActivities] = useState([]);
  const [members, setMembers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isMembersDialogOpen, setIsMembersDialogOpen] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const levelNumbers = [1, 2, 3, 4, 5, 6];

  const [formData, setFormData] = useState({
    level_number: 1,
    activity_name: '',
    description: '',
    members: [],
    branch_id: 'all'
  });

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  const loadData = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const [levelsRes, activitiesRes, membersRes, branchesRes] = await Promise.all([
        levelsAPI.getAll(branchParams),
        activitiesAPI.getAll(branchParams),
        membersAPI.getAll(branchParams),
        isAdmin ? branchesAPI.getAll() : Promise.resolve({ data: [] })
      ]);
      setLevels(levelsRes.data);
      setActivities(activitiesRes.data);
      setMembers(membersRes.data);
      setBranches(branchesRes.data || []);
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error(t('error', 'Error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.activity_id) {
      toast.error(t('اختر النشاط', 'Select activity'));
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
    setSelectedLevel(level);
    setFormData({
      level_number: level.level_number,
      activity_id: level.activity_id,
      description: level.description || '',
      members: level.members || [],
      branch_id: level.branch_id || 'all'
    });
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setSelectedLevel(null);
    setFormData({
      level_number: 2,
      activity_id: '',
      description: '',
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
    try {
      await levelsAPI.addMember(selectedLevel.id, memberId);
      toast.success(t('تمت إضافة العضو', 'Member added'));
      loadData();
      // Update selectedLevel locally
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
      // Update selectedLevel locally
      setSelectedLevel(prev => ({
        ...prev,
        members: (prev.members || []).filter(id => id !== memberId)
      }));
    } catch (error) {
      toast.error(t('error', 'Error'));
    }
  };

  const getActivityName = (activityId) => {
    const activity = activities.find(a => a.id === activityId);
    return activity ? (language === 'ar' ? activity.name_ar : activity.name) || activity.name_ar : '';
  };

  const getLevelColor = (levelNum) => {
    const colors = {
      2: 'bg-green-500',
      3: 'bg-blue-500',
      4: 'bg-yellow-500',
      5: 'bg-orange-500',
      6: 'bg-red-500'
    };
    return colors[levelNum] || 'bg-gray-500';
  };

  // Filter members not in current level
  const availableMembers = members.filter(m => {
    if (!selectedLevel) return true;
    return !(selectedLevel.members || []).includes(m.id);
  }).filter(m => {
    if (!searchQuery) return true;
    const name = (m.name_ar || m.name || '').toLowerCase();
    const phone = (m.phone || '').toLowerCase();
    return name.includes(searchQuery.toLowerCase()) || phone.includes(searchQuery.toLowerCase());
  });

  // Group levels by activity
  const levelsByActivity = activities.reduce((acc, activity) => {
    const activityLevels = levels.filter(l => l.activity_id === activity.id);
    if (activityLevels.length > 0) {
      acc[activity.id] = {
        activity,
        levels: activityLevels.sort((a, b) => a.level_number - b.level_number)
      };
    }
    return acc;
  }, {});

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
              {t('إدارة مستويات اللاعبين حسب النشاط', 'Manage player levels by activity')}
            </p>
          </div>
          <Button onClick={() => { resetForm(); setIsDialogOpen(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            {t('إضافة مستوى', 'Add Level')}
          </Button>
        </div>

        {/* Levels by Activity */}
        {Object.keys(levelsByActivity).length > 0 ? (
          <div className="space-y-6">
            {Object.values(levelsByActivity).map(({ activity, levels: activityLevels }) => (
              <Card key={activity.id} className="overflow-hidden">
                <div className="bg-primary text-white p-4 flex items-center gap-3">
                  <Dumbbell className="w-6 h-6" />
                  <h2 className="font-bold text-lg">
                    {language === 'ar' ? activity.name_ar : activity.name || activity.name_ar}
                  </h2>
                  <Badge variant="secondary" className="bg-white/20 text-white">
                    {activityLevels.length} {t('مستويات', 'levels')}
                  </Badge>
                </div>
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activityLevels.map(level => (
                      <div 
                        key={level.id}
                        className="border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                      >
                        {/* Level Header */}
                        <div className={`${getLevelColor(level.level_number)} text-white p-3 flex items-center justify-between`}>
                          <div className="flex items-center gap-2">
                            <span className="text-2xl font-bold">{level.level_number}</span>
                            <span className="text-sm opacity-90">{t('المستوى', 'Level')}</span>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-white hover:bg-white/20"
                              onClick={() => handleEdit(level)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-white hover:bg-white/20"
                              onClick={() => handleDelete(level)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        
                        {/* Level Content */}
                        <div className="p-3">
                          {level.description && (
                            <p className="text-gray-600 text-sm mb-3">{level.description}</p>
                          )}
                          
                          {/* Members Count */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2 text-gray-600">
                              <Users className="w-4 h-4" />
                              <span className="text-sm">
                                {(level.members_details || []).length} {t('لاعب', 'players')}
                              </span>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openMembersDialog(level)}
                              className="gap-1"
                            >
                              <UserPlus className="w-4 h-4" />
                              {t('إدارة', 'Manage')}
                            </Button>
                          </div>
                          
                          {/* Members List Preview */}
                          {(level.members_details || []).length > 0 && (
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {level.members_details.slice(0, 5).map(member => (
                                <div 
                                  key={member.member_id}
                                  className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm"
                                >
                                  <div className={`w-6 h-6 rounded-full ${getLevelColor(level.level_number)} text-white flex items-center justify-center text-xs font-bold`}>
                                    {(member.member_name || '?').charAt(0)}
                                  </div>
                                  <span className="flex-1 truncate">{member.member_name}</span>
                                </div>
                              ))}
                              {(level.members_details || []).length > 5 && (
                                <p className="text-center text-gray-400 text-xs py-1">
                                  +{level.members_details.length - 5} {t('آخرين', 'more')}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="text-center py-16">
            <Layers className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-medium text-gray-600 mb-2">
              {t('لا توجد مستويات', 'No Levels')}
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              {t('ابدأ بإضافة مستوى جديد', 'Start by adding a new level')}
            </p>
            <Button onClick={() => { resetForm(); setIsDialogOpen(true); }}>
              <Plus className="w-4 h-4 me-2" />
              {t('إضافة مستوى', 'Add Level')}
            </Button>
          </Card>
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

              {/* Activity */}
              <div>
                <Label>{t('النشاط', 'Activity')} *</Label>
                <Select
                  value={formData.activity_id}
                  onValueChange={(value) => setFormData({ ...formData, activity_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('اختر النشاط', 'Select activity')} />
                  </SelectTrigger>
                  <SelectContent>
                    {activities.map(activity => (
                      <SelectItem key={activity.id} value={activity.id}>
                        {language === 'ar' ? activity.name_ar : activity.name || activity.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Description */}
              <div>
                <Label>{t('الوصف', 'Description')}</Label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t('وصف اختياري للمستوى', 'Optional description')}
                />
              </div>

              {/* Branch (Admin only) */}
              {isAdmin && (
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
                      <SelectItem value="all">{t('كل الفروع', 'All Branches')}</SelectItem>
                      {branches.map(branch => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.name_ar || branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

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
                {t('إدارة لاعبي المستوى', 'Manage Level Players')} - {selectedLevel?.level_number}
              </DialogTitle>
            </DialogHeader>
            
            <div className="flex-1 overflow-hidden flex flex-col gap-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder={t('البحث عن عضو...', 'Search member...')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pe-10"
                />
              </div>

              <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Current Members */}
                <div>
                  <h3 className="font-medium mb-2 text-green-600 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    {t('اللاعبون الحاليون', 'Current Players')} ({(selectedLevel?.members || []).length})
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-2">
                    {(selectedLevel?.members_details || []).map(member => (
                      <div 
                        key={member.member_id}
                        className="flex items-center justify-between p-2 bg-green-50 rounded-lg"
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-full ${getLevelColor(selectedLevel?.level_number)} text-white flex items-center justify-center text-sm font-bold`}>
                            {(member.member_name || '?').charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{member.member_name}</p>
                            {member.phone && (
                              <p className="text-xs text-gray-500" dir="ltr">{member.phone}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-red-500 hover:bg-red-50"
                          onClick={() => handleRemoveMember(member.member_id)}
                        >
                          <UserMinus className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    {(selectedLevel?.members || []).length === 0 && (
                      <p className="text-center text-gray-400 py-4 text-sm">
                        {t('لا يوجد لاعبون', 'No players')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Available Members */}
                <div>
                  <h3 className="font-medium mb-2 text-blue-600 flex items-center gap-2">
                    <UserPlus className="w-4 h-4" />
                    {t('إضافة لاعب', 'Add Player')} ({availableMembers.length})
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-2">
                    {availableMembers.map(member => (
                      <div 
                        key={member.id}
                        className="flex items-center justify-between p-2 bg-gray-50 rounded-lg hover:bg-blue-50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gray-300 text-white flex items-center justify-center text-sm font-bold">
                            {(member.name_ar || member.name || '?').charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{member.name_ar || member.name}</p>
                            {member.phone && (
                              <p className="text-xs text-gray-500" dir="ltr">{member.phone}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-green-500 hover:bg-green-50"
                          onClick={() => handleAddMember(member.id)}
                        >
                          <UserPlus className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    {availableMembers.length === 0 && (
                      <p className="text-center text-gray-400 py-4 text-sm">
                        {t('لا يوجد أعضاء متاحون', 'No available members')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
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
