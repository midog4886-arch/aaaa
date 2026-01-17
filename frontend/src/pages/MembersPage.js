import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
// eslint-disable-next-line react-hooks/exhaustive-deps
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { membersAPI, activitiesAPI, coachesAPI, exportAPI, invoicesAPI } from '../services/api';
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
  Printer
} from 'lucide-react';

export const MembersPage = () => {
  const { t, language } = useLanguage();
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
  const [selectedMember, setSelectedMember] = useState(null);
  const [saving, setSaving] = useState(false);
  const [memberInvoices, setMemberInvoices] = useState([]);
  const [viewTab, setViewTab] = useState('info'); // info, activities, invoices

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
    coach_id: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [membersRes, activitiesRes, coachesRes] = await Promise.all([
        membersAPI.getAll(),
        activitiesAPI.getAll(),
        coachesAPI.getAll()
      ]);
      setMembers(membersRes.data);
      setActivities(activitiesRes.data);
      setCoaches(coachesRes.data);
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
    // Load member invoices
    try {
      const response = await invoicesAPI.getAll({ member_id: member.id });
      setMemberInvoices(response.data);
    } catch (error) {
      console.error('Failed to load member invoices:', error);
      setMemberInvoices([]);
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
                printWindow.document.write(`<html><head><title>بيانات الأعضاء</title><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');body{font-family:'Tajawal',Arial;direction:rtl;padding:20px}h1{color:#F97316;text-align:center;margin-bottom:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:right;font-size:12px}th{background:#F97316;color:white}.footer{text-align:center;margin-top:20px;font-size:11px;color:#666}</style></head><body><h1>أكاديمية أداء الأبطال العالمية - بيانات الأعضاء</h1><table><thead><tr><th>م</th><th>الاسم</th><th>العمر</th><th>ولي الأمر</th><th>الجوال</th><th>الأنشطة</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SA')}</div></body></html>`);
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
                    <th>{t('member_name')}</th>
                    <th>{t('guardian_name')}</th>
                    <th>{t('phone')}</th>
                    <th>{t('age')}</th>
                    <th>{t('activities')}</th>
                    <th>{t('subscription_status')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-muted-foreground">
                        {t('no_data')}
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map(member => (
                      <tr key={member.id} data-testid={`member-row-${member.id}`}>
                        <td className="font-medium">
                          {language === 'ar' ? member.name_ar : member.name}
                        </td>
                        <td>{language === 'ar' ? member.guardian_name_ar : member.guardian_name}</td>
                        <td dir="ltr" className="text-start">{member.phone}</td>
                        <td>{member.age}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {member.activities?.slice(0, 2).map((activity, idx) => (
                              <Badge 
                                key={idx} 
                                variant="outline"
                                className={getActivityColor(activity.activity_name)}
                              >
                                {activity.activity_name}
                              </Badge>
                            ))}
                            {member.activities?.length > 2 && (
                              <Badge variant="outline">+{member.activities.length - 2}</Badge>
                            )}
                          </div>
                        </td>
                        <td>
                          {member.activities?.length > 0 && (
                            getStatusBadge(member.activities[0].status)
                          )}
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
                    ))
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
                        {selectedMember.activities.map((activity, idx) => (
                          <Card key={idx} className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge className={getActivityColor(activity.activity_name)}>
                                    {activity.activity_name}
                                  </Badge>
                                  {getStatusBadge(activity.status)}
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
              </div>
            )}
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
