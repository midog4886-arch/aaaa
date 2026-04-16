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
import { Textarea } from '../components/ui/textarea';
import { activitiesAPI, branchesAPI } from '../services/api';
import axios from 'axios';
import { toast } from 'sonner';
import { 
  Plus, 
  Edit, 
  Trash2,
  Loader2,
  Waves,
  Dumbbell,
  Building2,
  Search,
  ArrowUpDown,
  Users,
  SlidersHorizontal,
  TrendingUp,
  CircleDollarSign,
  Swords,
  Footprints,
  Trophy,
  Bike,
  Target,
  Flame,
  Filter,
  X,
  CheckCircle2,
  XCircle
} from 'lucide-react';

export const ActivitiesPage = () => {
  const { t, language } = useLanguage();
  const { user, selectedBranchId } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [activities, setActivities] = useState([]);
  const [branches, setBranches] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [memberCounts, setMemberCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriceRange, setFilterPriceRange] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [showFilters, setShowFilters] = useState(true);

  const [formData, setFormData] = useState({
    name: '',
    name_ar: '',
    description: '',
    description_ar: '',
    monthly_fee: '',
    color: '#F97316',
    branch_id: 'all',
    coach_id: ''
  });

  const colorOptions = [
    { value: '#0EA5E9', label: language === 'ar' ? 'أزرق' : 'Blue' },
    { value: '#22C55E', label: language === 'ar' ? 'أخضر' : 'Green' },
    { value: '#EF4444', label: language === 'ar' ? 'أحمر' : 'Red' },
    { value: '#8B5CF6', label: language === 'ar' ? 'بنفسجي' : 'Purple' },
    { value: '#F97316', label: language === 'ar' ? 'برتقالي' : 'Orange' },
    { value: '#EC4899', label: language === 'ar' ? 'وردي' : 'Pink' },
  ];

  const activityCategories = [
    { id: 'swimming', name_ar: 'السباحة', name_en: 'Swimming', icon: '🏊', keywords: ['سباح', 'swim'] },
    { id: 'football', name_ar: 'كرة القدم', name_en: 'Football', icon: '⚽', keywords: ['قدم', 'كرة', 'foot', 'soccer'] },
    { id: 'karate', name_ar: 'الكاراتيه', name_en: 'Karate', icon: '🥋', keywords: ['كارات', 'karat'] },
    { id: 'gymnastics', name_ar: 'الجمباز', name_en: 'Gymnastics', icon: '🤸', keywords: ['جمباز', 'gymnast'] },
    { id: 'cycling', name_ar: 'الدراجات', name_en: 'Cycling', icon: '🚴', keywords: ['دراج', 'cycl', 'bike'] },
    { id: 'other', name_ar: 'أخرى', name_en: 'Other', icon: '🏋️', keywords: [] },
  ];

  const getActivityCategory = (activity) => {
    const name = ((activity.name_ar || '') + ' ' + (activity.name || '')).toLowerCase();
    for (const cat of activityCategories) {
      if (cat.id === 'other') continue;
      if (cat.keywords.some(kw => name.includes(kw))) return cat.id;
    }
    return 'other';
  };

  const availableCategories = useMemo(() => {
    const categoriesInUse = new Set();
    activities.forEach(a => categoriesInUse.add(getActivityCategory(a)));
    return activityCategories.filter(c => categoriesInUse.has(c.id));
  }, [activities]);

  const priceRanges = [
    { id: 'all', label_ar: 'كل الأسعار', label_en: 'All Prices' },
    { id: '0-100', label_ar: '0 - 100 ريال', label_en: '0 - 100 SAR', min: 0, max: 100 },
    { id: '100-300', label_ar: '100 - 300 ريال', label_en: '100 - 300 SAR', min: 100, max: 300 },
    { id: '300-500', label_ar: '300 - 500 ريال', label_en: '300 - 500 SAR', min: 300, max: 500 },
    { id: '500+', label_ar: '500+ ريال', label_en: '500+ SAR', min: 500, max: Infinity },
  ];

  useEffect(() => {
    loadActivities();
  }, [selectedBranchId]);

  const loadActivities = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const token = localStorage.getItem('token');
      const [activitiesRes, branchesRes, countsRes, coachesRes] = await Promise.all([
        activitiesAPI.getAll(branchParams),
        isAdmin ? branchesAPI.getAll() : Promise.resolve({ data: [] }),
        activitiesAPI.getMemberCounts().catch(() => ({ data: {} })),
        axios.get('/api/coaches', { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: [] }))
      ]);
      setActivities(activitiesRes.data);
      setBranches(branchesRes.data || []);
      setMemberCounts(countsRes.data || {});
      setCoaches(coachesRes.data || []);
    } catch (error) {
      console.error('Failed to load activities:', error);
      toast.error(t('error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const data = {
        ...formData,
        monthly_fee: parseFloat(formData.monthly_fee) || 0,
        branch_id: isAdmin ? formData.branch_id : undefined,
        coach_id: formData.coach_id || null
      };
      
      if (selectedActivity) {
        await activitiesAPI.update(selectedActivity.id, data);
      } else {
        await activitiesAPI.create(data);
      }
      
      toast.success(t('success'));
      loadActivities();
      closeDialog();
    } catch (error) {
      console.error('Failed to save activity:', error);
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من الحذف؟' : 'Are you sure you want to delete?')) {
      return;
    }
    
    try {
      await activitiesAPI.delete(id);
      toast.success(t('success'));
      loadActivities();
    } catch (error) {
      console.error('Failed to delete activity:', error);
      toast.error(t('error'));
    }
  };

  const openEditDialog = (activity) => {
    setSelectedActivity(activity);
    setFormData({
      name: activity.name || '',
      name_ar: activity.name_ar || '',
      description: activity.description || '',
      description_ar: activity.description_ar || '',
      monthly_fee: activity.monthly_fee?.toString() || '',
      color: activity.color || '#F97316',
      branch_id: activity.branch_id || 'all',
      coach_id: activity.coach_id || ''
    });
    setIsDialogOpen(true);
  };
  
  const getBranchName = (branchId) => {
    if (!branchId) return language === 'ar' ? 'عام (جميع الفروع)' : 'Global (All)';
    const branch = branches.find(b => b.id === branchId);
    return branch?.name_ar || branch?.name || branchId;
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setSelectedActivity(null);
    setFormData({
      name: '',
      name_ar: '',
      description: '',
      description_ar: '',
      monthly_fee: '',
      color: '#F97316',
      branch_id: 'all',
      coach_id: ''
    });
  };

  const getActivityIcon = (name) => {
    const n = (name || '').toLowerCase();
    if (n.includes('سباح') || n.includes('swim')) return Waves;
    if (n.includes('كارات') || n.includes('karat')) return Swords;
    if (n.includes('قدم') || n.includes('foot') || n.includes('soccer')) return Footprints;
    if (n.includes('جمباز') || n.includes('gymnast')) return Flame;
    if (n.includes('دراج') || n.includes('cycl') || n.includes('bike')) return Bike;
    if (n.includes('هدف') || n.includes('target') || n.includes('رماي')) return Target;
    if (n.includes('بطول') || n.includes('champ')) return Trophy;
    return Dumbbell;
  };

  const activeFiltersCount = [filterBranch, filterCategory, filterStatus, filterPriceRange].filter(f => f !== 'all').length;

  const clearAllFilters = () => {
    setFilterBranch('all');
    setFilterCategory('all');
    setFilterStatus('all');
    setFilterPriceRange('all');
    setSearchTerm('');
  };

  const filteredActivities = useMemo(() => {
    let filtered = [...activities];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(a =>
        (a.name || '').toLowerCase().includes(term) ||
        (a.name_ar || '').toLowerCase().includes(term) ||
        (a.description || '').toLowerCase().includes(term) ||
        (a.description_ar || '').toLowerCase().includes(term)
      );
    }

    if (filterBranch !== 'all') {
      if (filterBranch === 'global') {
        filtered = filtered.filter(a => !a.branch_id);
      } else {
        filtered = filtered.filter(a => a.branch_id === filterBranch);
      }
    }

    if (filterCategory !== 'all') {
      filtered = filtered.filter(a => getActivityCategory(a) === filterCategory);
    }

    if (filterStatus !== 'all') {
      if (filterStatus === 'active') {
        filtered = filtered.filter(a => (memberCounts[a.id] || 0) > 0);
      } else {
        filtered = filtered.filter(a => (memberCounts[a.id] || 0) === 0);
      }
    }

    if (filterPriceRange !== 'all') {
      const range = priceRanges.find(r => r.id === filterPriceRange);
      if (range) {
        filtered = filtered.filter(a => {
          const fee = a.monthly_fee || 0;
          return fee >= range.min && fee < range.max;
        });
      }
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (language === 'ar' ? a.name_ar : a.name || '').localeCompare(language === 'ar' ? b.name_ar : b.name || '', language === 'ar' ? 'ar' : 'en');
        case 'price_asc':
          return (a.monthly_fee || 0) - (b.monthly_fee || 0);
        case 'price_desc':
          return (b.monthly_fee || 0) - (a.monthly_fee || 0);
        case 'members':
          return (memberCounts[b.id] || 0) - (memberCounts[a.id] || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [activities, searchTerm, filterBranch, filterCategory, filterStatus, filterPriceRange, sortBy, memberCounts, language]);

  const stats = useMemo(() => {
    const totalMembers = Object.values(memberCounts).reduce((s, c) => s + c, 0);
    const fees = activities.map(a => a.monthly_fee || 0);
    const avgFee = fees.length > 0 ? Math.round(fees.reduce((s, f) => s + f, 0) / fees.length) : 0;
    const maxFee = fees.length > 0 ? Math.max(...fees) : 0;
    return {
      total: activities.length,
      totalMembers,
      avgFee,
      maxFee
    };
  }, [activities, memberCounts]);

  if (loading) {
    return (
      <Layout title={t('activities')}>
        <div className="flex items-center justify-center h-64">
          <div className="spinner" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('activities')}>
      <div className="space-y-6" data-testid="activities-page">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-blue-100">
            <CardContent className="p-4 text-center">
              <Dumbbell className="w-6 h-6 mx-auto mb-1 text-blue-600" />
              <p className="text-2xl font-bold text-blue-700">{stats.total}</p>
              <p className="text-xs text-blue-600">{language === 'ar' ? 'إجمالي الأنشطة' : 'Total Activities'}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-gradient-to-br from-green-50 to-green-100">
            <CardContent className="p-4 text-center">
              <Users className="w-6 h-6 mx-auto mb-1 text-green-600" />
              <p className="text-2xl font-bold text-green-700">{stats.totalMembers}</p>
              <p className="text-xs text-green-600">{language === 'ar' ? 'إجمالي المشتركين' : 'Total Subscribers'}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-gradient-to-br from-orange-50 to-orange-100">
            <CardContent className="p-4 text-center">
              <CircleDollarSign className="w-6 h-6 mx-auto mb-1 text-orange-600" />
              <p className="text-2xl font-bold text-orange-700">{stats.avgFee}</p>
              <p className="text-xs text-orange-600">{language === 'ar' ? 'متوسط السعر' : 'Avg. Price'}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-purple-100">
            <CardContent className="p-4 text-center">
              <TrendingUp className="w-6 h-6 mx-auto mb-1 text-purple-600" />
              <p className="text-2xl font-bold text-purple-700">{stats.maxFee}</p>
              <p className="text-xs text-purple-600">{language === 'ar' ? 'أعلى سعر' : 'Highest Price'}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters Bar */}
        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-primary" />
                <span className="font-medium text-sm">
                  {language === 'ar' ? 'الفلاتر' : 'Filters'}
                </span>
                {activeFiltersCount > 0 && (
                  <Badge variant="default" className="text-xs px-2 py-0.5 bg-primary">
                    {activeFiltersCount}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeFiltersCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-xs h-7">
                    <X className="w-3 h-3 me-1" />
                    {language === 'ar' ? 'مسح الفلاتر' : 'Clear All'}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              {/* Search */}
              <div className="relative lg:col-span-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none rtl:right-3 ltr:left-3 ltr:right-auto" />
                <Input
                  placeholder={language === 'ar' ? 'بحث في الأنشطة...' : 'Search activities...'}
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="ps-10 h-9 text-sm"
                />
              </div>

              {/* Activity/Category Filter - like attendance page */}
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="h-9 text-sm">
                  <Dumbbell className="w-4 h-4 me-1 opacity-50" />
                  <SelectValue placeholder={language === 'ar' ? 'اختر النشاط' : 'Select Activity'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'اختر النشاط' : 'Select Activity'}</SelectItem>
                  {availableCategories.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.icon} {language === 'ar' ? cat.name_ar : cat.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Branch Filter */}
              {isAdmin && branches.length > 0 && (
                <Select value={filterBranch} onValueChange={setFilterBranch}>
                  <SelectTrigger className="h-9 text-sm">
                    <Building2 className="w-4 h-4 me-1 opacity-50" />
                    <SelectValue placeholder={language === 'ar' ? 'الفرع' : 'Branch'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'كل الفروع' : 'All Branches'}</SelectItem>
                    <SelectItem value="global">{language === 'ar' ? 'عام' : 'Global'}</SelectItem>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Status Filter */}
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-9 text-sm">
                  {filterStatus === 'active' ? (
                    <CheckCircle2 className="w-4 h-4 me-1 text-green-500" />
                  ) : filterStatus === 'inactive' ? (
                    <XCircle className="w-4 h-4 me-1 text-gray-400" />
                  ) : (
                    <SlidersHorizontal className="w-4 h-4 me-1 opacity-50" />
                  )}
                  <SelectValue placeholder={language === 'ar' ? 'الحالة' : 'Status'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'كل الحالات' : 'All Status'}</SelectItem>
                  <SelectItem value="active">{language === 'ar' ? 'نشط (فيه مشتركين)' : 'Active (has members)'}</SelectItem>
                  <SelectItem value="inactive">{language === 'ar' ? 'غير نشط' : 'Inactive'}</SelectItem>
                </SelectContent>
              </Select>

              {/* Price Range Filter */}
              <Select value={filterPriceRange} onValueChange={setFilterPriceRange}>
                <SelectTrigger className="h-9 text-sm">
                  <CircleDollarSign className="w-4 h-4 me-1 opacity-50" />
                  <SelectValue placeholder={language === 'ar' ? 'السعر' : 'Price'} />
                </SelectTrigger>
                <SelectContent>
                  {priceRanges.map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      {language === 'ar' ? r.label_ar : r.label_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Sort */}
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-9 text-sm">
                    <ArrowUpDown className="w-4 h-4 me-1 opacity-50" />
                    <SelectValue placeholder={language === 'ar' ? 'ترتيب' : 'Sort'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">{language === 'ar' ? 'الاسم' : 'Name'}</SelectItem>
                    <SelectItem value="price_asc">{language === 'ar' ? 'السعر تصاعدي' : 'Price Asc'}</SelectItem>
                    <SelectItem value="price_desc">{language === 'ar' ? 'السعر تنازلي' : 'Price Desc'}</SelectItem>
                    <SelectItem value="members">{language === 'ar' ? 'المشتركين' : 'Subscribers'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results Count + Add Button */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {language === 'ar'
              ? `عرض ${filteredActivities.length} من ${activities.length} نشاط`
              : `Showing ${filteredActivities.length} of ${activities.length} activities`}
          </p>
          <Button onClick={() => setIsDialogOpen(true)} data-testid="add-activity-btn">
            <Plus className="w-4 h-4 me-2" />
            {t('add_activity')}
          </Button>
        </div>

        {/* Activities Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredActivities.map(activity => {
            const Icon = getActivityIcon(activity.name_ar || activity.name);
            const count = memberCounts[activity.id] || 0;
            const isActive = count > 0;
            return (
              <Card 
                key={activity.id} 
                className="overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 group"
                data-testid={`activity-card-${activity.id}`}
              >
                <div 
                  className="h-2"
                  style={{ backgroundColor: activity.color }}
                />
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div 
                      className="w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                      style={{ backgroundColor: `${activity.color}15` }}
                    >
                      <Icon className="w-6 h-6" style={{ color: activity.color }} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isActive ? 'default' : 'secondary'} className={`text-[10px] px-2 py-0.5 ${isActive ? 'bg-green-100 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-100'}`}>
                        {isActive 
                          ? (language === 'ar' ? 'نشط' : 'Active')
                          : (language === 'ar' ? 'غير نشط' : 'Inactive')}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-start justify-between mb-1">
                    <h3 className="font-bold text-base leading-tight flex-1">
                      {language === 'ar' ? activity.name_ar : activity.name}
                    </h3>
                    <div className="action-buttons opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        className="action-button"
                        onClick={() => openEditDialog(activity)}
                        data-testid={`edit-activity-${activity.id}`}
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        className="action-button danger"
                        onClick={() => handleDelete(activity.id)}
                        data-testid={`delete-activity-${activity.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  
                  {(activity.description_ar || activity.description) && (
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                      {language === 'ar' ? activity.description_ar : activity.description}
                    </p>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex items-center gap-1 text-sm bg-gray-50 rounded-full px-2.5 py-1">
                      <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-semibold">{count}</span>
                      <span className="text-xs text-muted-foreground">{language === 'ar' ? 'مشترك' : 'members'}</span>
                    </div>
                  </div>
                  
                  {activity.coach_id && (() => {
                    const assignedCoach = coaches.find(c => c.id === activity.coach_id);
                    return assignedCoach ? (
                      <div className="flex items-center gap-1 text-xs text-blue-600 mb-2">
                        <Users className="w-3 h-3" />
                        <span>{assignedCoach.name_ar || assignedCoach.name}</span>
                      </div>
                    ) : null;
                  })()}

                  {isAdmin && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
                      <Building2 className="w-3 h-3" />
                      <span>{getBranchName(activity.branch_id)}</span>
                    </div>
                  )}
                  
                  <div className="pt-3 border-t flex items-baseline gap-1">
                    <span className="text-xl font-bold" style={{ color: activity.color }}>
                      {activity.monthly_fee}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('sar')} / {t('monthly')}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {filteredActivities.length === 0 && (
          <div className="empty-state">
            <Dumbbell className="empty-state-icon" />
            <p>{searchTerm || activeFiltersCount > 0
              ? (language === 'ar' ? 'لا توجد نتائج مطابقة للفلاتر' : 'No matching results')
              : t('no_data')}</p>
            {activeFiltersCount > 0 && (
              <Button variant="outline" size="sm" className="mt-2" onClick={clearAllFilters}>
                <X className="w-3 h-3 me-1" />
                {language === 'ar' ? 'مسح الفلاتر' : 'Clear Filters'}
              </Button>
            )}
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedActivity 
                  ? (language === 'ar' ? 'تعديل النشاط' : 'Edit Activity')
                  : t('add_activity')}
              </DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('activity_name')} (العربية)</Label>
                  <Input
                    value={formData.name_ar}
                    onChange={(e) => setFormData({...formData, name_ar: e.target.value})}
                    required
                    data-testid="activity-name-ar"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('activity_name')} (English)</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    data-testid="activity-name-en"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>{t('description')} (العربية)</Label>
                <Textarea
                  value={formData.description_ar}
                  onChange={(e) => setFormData({...formData, description_ar: e.target.value})}
                  data-testid="activity-desc-ar"
                />
              </div>
              
              <div className="space-y-2">
                <Label>{t('description')} (English)</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  data-testid="activity-desc-en"
                />
              </div>
              
              <div className="space-y-2">
                <Label>{t('monthly_fee')} ({t('sar')})</Label>
                <Input
                  type="number"
                  value={formData.monthly_fee}
                  onChange={(e) => setFormData({...formData, monthly_fee: e.target.value})}
                  required
                  data-testid="activity-fee"
                />
              </div>
              
              <div className="space-y-2">
                <Label>{t('color')}</Label>
                <div className="flex gap-2 flex-wrap">
                  {colorOptions.map(color => (
                    <button
                      key={color.value}
                      type="button"
                      className={`w-10 h-10 rounded-lg border-2 transition-transform ${
                        formData.color === color.value 
                          ? 'scale-110 border-foreground' 
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: color.value }}
                      onClick={() => setFormData({...formData, color: color.value})}
                      data-testid={`color-${color.value}`}
                    />
                  ))}
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  {language === 'ar' ? 'المدرب المسؤول' : 'Assigned Coach'}
                </Label>
                <Select
                  value={formData.coach_id || '__none__'}
                  onValueChange={(v) => setFormData({...formData, coach_id: v === '__none__' ? '' : v})}
                >
                  <SelectTrigger data-testid="activity-coach-select">
                    <SelectValue placeholder={language === 'ar' ? 'اختر المدرب' : 'Select Coach'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      {language === 'ar' ? 'بدون مدرب' : 'No Coach'}
                    </SelectItem>
                    {coaches.map(coach => (
                      <SelectItem key={coach.id} value={coach.id}>
                        {coach.name_ar || coach.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isAdmin && branches.length > 0 && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    {language === 'ar' ? 'الفرع' : 'Branch'}
                  </Label>
                  <Select value={formData.branch_id} onValueChange={(v) => setFormData({...formData, branch_id: v})}>
                    <SelectTrigger data-testid="activity-branch-select">
                      <SelectValue placeholder={language === 'ar' ? 'اختر الفرع' : 'Select Branch'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {language === 'ar' ? 'جميع الفروع (نشاط عام)' : 'All Branches (Global)'}
                      </SelectItem>
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
                <Button type="button" variant="outline" onClick={closeDialog}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={saving} data-testid="save-activity-btn">
                  {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default ActivitiesPage;
