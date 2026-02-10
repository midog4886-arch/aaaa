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
import { Textarea } from '../components/ui/textarea';
import { membersAPI, activitiesAPI, coachesAPI, exportAPI, invoicesAPI, attendanceAPI, levelsAPI } from '../services/api';
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
  Clock
} from 'lucide-react';

export const MembersPage = () => {
  const { t, language } = useLanguage();
  const { selectedBranchId } = useAuth();
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterActivity, setFilterActivity] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isActivityDialogOpen, setIsActivityDialogOpen] = useState(false);
  const [isRenewalDialogOpen, setIsRenewalDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [saving, setSaving] = useState(false);
  const [memberInvoices, setMemberInvoices] = useState([]);
  const [memberAttendance, setMemberAttendance] = useState(null);
  const [viewTab, setViewTab] = useState('info'); // info, activities, invoices, history, attendance
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

  // Levels state
  const [levels, setLevels] = useState([]);
  
  // State for cascading level selector
  const [memberLevelSelectorState, setMemberLevelSelectorState] = useState(null);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const data = {
        ...formData,
        age: parseInt(formData.age) || 0
      };
      
      if (selectedMember) {
        await membersAPI.update(selectedMember.id, data);
        toast.success(t('success'));
      } else {
        await membersAPI.create(data);
        toast.success(t('success'));
      }
      
      loadData();
      closeDialog();
    } catch (error) {
      console.error('Failed to save member:', error);
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
  };

  const openViewDialog = async (member) => {
    setSelectedMember(member);
    setViewTab('info');
    setIsViewDialogOpen(true);
    setMemberAttendance(null);
    // Load member invoices and attendance
    try {
      const [invoicesRes, attendanceRes] = await Promise.all([
        invoicesAPI.getAll({ member_id: member.id }),
        attendanceAPI.getMemberReport(member.id)
      ]);
      setMemberInvoices(invoicesRes.data);
      setMemberAttendance(attendanceRes.data);
    } catch (error) {
      console.error('Failed to load member data:', error);
      setMemberInvoices([]);
      setMemberAttendance(null);
    }
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

  const filteredMembers = members.filter(member => {
    const matchesSearch = 
      member.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.name_ar?.includes(searchTerm) ||
      member.member_code?.includes(searchTerm) ||
      member.phone?.includes(searchTerm);
    
    const matchesActivity = filterActivity === 'all' || 
      member.activities?.some(a => a.activity_id === filterActivity);
    
    const matchesStatus = filterStatus === 'all' ||
      member.activities?.some(a => a.status === filterStatus);
    
    return matchesSearch && matchesActivity && matchesStatus;
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
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
          <div className="flex flex-1 gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('search')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-10"
                data-testid="search-members-input"
              />
            </div>
            <Select value={filterActivity} onValueChange={setFilterActivity}>
              <SelectTrigger className="w-[150px]" data-testid="filter-activity-select">
                <SelectValue placeholder={t('activities')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('activities')}</SelectItem>
                {activities.map(activity => (
                  <SelectItem key={activity.id} value={activity.id}>
                    {language === 'ar' ? activity.name_ar : activity.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                const token = localStorage.getItem('token');
                const params = filterActivity !== 'all' ? { activity_id: filterActivity } : {};
                const url = exportAPI.members(params) + `&token=${token}`;
                window.open(url, '_blank');
              }}
              data-testid="export-members-btn"
            >
              <Download className="w-4 h-4 me-2" />
              {language === 'ar' ? 'تصدير' : 'Export'}
            </Button>
            <Button 
              variant="outline"
              onClick={() => {
                const printWindow = window.open('', '', 'width=900,height=700');
                const rows = filteredMembers.map((m, i) => `<tr><td>${i+1}</td><td>${m.name_ar || m.name}</td><td>${m.age || '-'}</td><td>${m.guardian_name_ar || '-'}</td><td dir="ltr">${m.phone || '-'}</td><td>${m.activities?.map(a => a.activity_name).join(', ') || '-'}</td><td>${m.activities?.map(a => a.status === 'active' ? 'ساري' : 'منتهي').join(', ') || '-'}</td></tr>`).join('');
                printWindow.document.write(`<html><head><title>بيانات الأعضاء</title><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');body{font-family:'Tajawal',Arial;direction:rtl;padding:20px}h1{color:#F97316;text-align:center;margin-bottom:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:right;font-size:12px}th{background:#F97316;color:white}.footer{text-align:center;margin-top:20px;font-size:11px;color:#666}</style></head><body><h1>شركة اداء الابطال العالمية للرياضة - بيانات الأعضاء</h1><table><thead><tr><th>م</th><th>الاسم</th><th>العمر</th><th>ولي الأمر</th><th>الجوال</th><th>الأنشطة</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SA')}</div></body></html>`);
                printWindow.document.close();
                printWindow.print();
              }}
              data-testid="print-members-btn"
            >
              <Printer className="w-4 h-4 me-2" />
              {language === 'ar' ? 'طباعة' : 'Print'}
            </Button>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="add-member-btn">
              <Plus className="w-4 h-4 me-2" />
              {t('add_member')}
            </Button>
          </div>
        </div>

        {/* Members List */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{language === 'ar' ? 'رقم العضوية' : 'Member ID'}</th>
                    <th>{t('member_name')}</th>
                    <th>{t('guardian_name')}</th>
                    <th>{t('phone')}</th>
                    <th>{language === 'ar' ? 'الأنشطة وحالتها' : 'Activities & Status'}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">
                        {t('no_data')}
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map(member => {
                      return (
                      <tr key={member.id} data-testid={`member-row-${member.id}`}>
                        <td className="font-mono text-primary font-bold">
                          {member.member_code || '-'}
                        </td>
                        <td className="font-medium">
                          {language === 'ar' ? member.name_ar : member.name}
                        </td>
                        <td>{language === 'ar' ? member.guardian_name_ar : member.guardian_name}</td>
                        <td dir="ltr" className="text-start">{member.phone}</td>
                        <td>
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
                        <td>
                          <div className="action-buttons">
                            <button 
                              className="action-button"
                              onClick={() => openViewDialog(member)}
                              data-testid={`view-member-${member.id}`}
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button 
                              className="action-button"
                              onClick={() => openEditDialog(member)}
                              data-testid={`edit-member-${member.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button 
                              className="action-button danger"
                              onClick={() => handleDelete(member.id)}
                              data-testid={`delete-member-${member.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )})
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Add/Edit Dialog */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedMember ? t('edit_member') : t('add_member')}
              </DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('member_name')} (العربية)</Label>
                  <Input
                    value={formData.name_ar}
                    onChange={(e) => setFormData({...formData, name_ar: e.target.value})}
                    required
                    data-testid="member-name-ar-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('member_name')} (English)</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    data-testid="member-name-en-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('guardian_name')} (العربية)</Label>
                  <Input
                    value={formData.guardian_name_ar}
                    onChange={(e) => setFormData({...formData, guardian_name_ar: e.target.value})}
                    required
                    data-testid="guardian-name-ar-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('guardian_name')} (English)</Label>
                  <Input
                    value={formData.guardian_name}
                    onChange={(e) => setFormData({...formData, guardian_name: e.target.value})}
                    data-testid="guardian-name-en-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('phone')}</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    type="tel"
                    dir="ltr"
                    required
                    data-testid="member-phone-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('age')}</Label>
                  <Input
                    value={formData.age}
                    onChange={(e) => setFormData({...formData, age: e.target.value})}
                    type="number"
                    min="1"
                    max="100"
                    required
                    data-testid="member-age-input"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>{t('email')}</Label>
                  <Input
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    type="email"
                    dir="ltr"
                    data-testid="member-email-input"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>{t('notes')}</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    data-testid="member-notes-input"
                  />
                </div>
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
                {language === 'ar' ? selectedMember?.name_ar : selectedMember?.name}
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
                    {selectedMember.notes && (
                      <div className="p-4 bg-muted/50 rounded-lg">
                        <p className="text-sm text-muted-foreground mb-1">{t('notes')}</p>
                        <p>{selectedMember.notes}</p>
                      </div>
                    )}
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
                          
                          return (
                            <Card key={idx} className={`p-4 ${isNearExpiry ? 'border-amber-400 bg-amber-50/50' : ''} ${isExpired ? 'border-red-400 bg-red-50/50' : ''}`}>
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
                                  </div>
                                </div>
                                
                                {/* Renewal button */}
                                {showRenewalBtn && (
                                  <Button
                                    size="sm"
                                    variant={isExpired ? "default" : "outline"}
                                    className={`ms-4 ${isExpired ? 'bg-red-500 hover:bg-red-600' : 'border-amber-500 text-amber-600 hover:bg-amber-50'}`}
                                    onClick={() => openRenewalDialog(activity)}
                                    data-testid={`renew-activity-${activity.activity_id}`}
                                  >
                                    <RefreshCcw className="w-4 h-4 me-1" />
                                    {language === 'ar' ? 'تجديد' : 'Renew'}
                                  </Button>
                                )}
                              </div>
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
                                    record.status === 'present' ? 'bg-green-50' : 'bg-red-50'
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <span className={`w-2 h-2 rounded-full ${
                                      record.status === 'present' ? 'bg-green-500' : 'bg-red-500'
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
                                      record.status === 'present' 
                                        ? 'bg-green-100 text-green-700' 
                                        : 'bg-red-100 text-red-700'
                                    }>
                                      {record.status === 'present' 
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
      </div>
    </Layout>
  );
};

export default MembersPage;
