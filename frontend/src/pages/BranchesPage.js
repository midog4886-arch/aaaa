import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import api from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Building2,
  Phone,
  MapPin,
  Loader2
} from 'lucide-react';

const WEEKDAYS = [
  { id: 'saturday', name_ar: 'السبت', name_en: 'Saturday' },
  { id: 'sunday', name_ar: 'الأحد', name_en: 'Sunday' },
  { id: 'monday', name_ar: 'الاثنين', name_en: 'Monday' },
  { id: 'tuesday', name_ar: 'الثلاثاء', name_en: 'Tuesday' },
  { id: 'wednesday', name_ar: 'الأربعاء', name_en: 'Wednesday' },
  { id: 'thursday', name_ar: 'الخميس', name_en: 'Thursday' },
  { id: 'friday', name_ar: 'الجمعة', name_en: 'Friday' },
];
const ALL_WEEKDAY_IDS = WEEKDAYS.map(d => d.id);

const emptyVenue = () => ({
  id: '',
  name: '',
  number: '',
  size: '',
  booking_slots: [],
  contract_start_date: '',
  contract_end_date: '',
  cost: '',
  cost_type: 'monthly',
  warning_days: '30'
});

const initialFormData = () => ({
  name_ar: '',
  public_name: '',
  phone: '',
  location_url: '',
  code_prefix: '',
  whatsapp_group_url: '',
  support_whatsapp: '',
  whatsapp_renewal_template: '',
  whatsapp_manual_template: '',
  whatsapp_manual_expired_template: '',
  whatsapp_welcome_template: '',
  working_days: [...ALL_WEEKDAY_IDS],
  branch_type: 'permanent',
  venues: []
});

const normalizeVenue = (venue = {}) => ({
  id: venue.id || '',
  name: venue.name || '',
  number: venue.number || '',
  size: venue.size ?? '',
  booking_slots: Array.isArray(venue.booking_slots)
    ? venue.booking_slots.map(slot => ({
        id: slot.id || '',
        weekday: slot.weekday || slot.day || slot.day_of_week || '',
        start_time: slot.start_time || slot.start || '',
        end_time: slot.end_time || slot.end || '',
        start_date: slot.start_date || venue.contract_start_date || '',
        end_date: slot.end_date || venue.contract_end_date || '',
        cost: slot.cost ?? venue.cost ?? '',
        cost_type: slot.cost_type || venue.cost_type || 'monthly'
      })).filter(slot => slot.weekday)
    : [],
  contract_start_date: venue.contract_start_date || venue.start_date || venue.booking_slots?.[0]?.start_date || '',
  contract_end_date: venue.contract_end_date || venue.end_date || venue.booking_slots?.[0]?.end_date || '',
  cost: venue.cost ?? venue.booking_slots?.[0]?.cost ?? '',
  cost_type: venue.cost_type || venue.booking_slots?.[0]?.cost_type || 'monthly',
  warning_days: venue.warning_days ?? 30
});

const BranchesPage = () => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [branches, setBranches] = useState([]);
  const [branchLevels, setBranchLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState(initialFormData);

  useEffect(() => {
    loadBranches();
  }, []);

  const loadBranches = async () => {
    try {
      const [branchesResponse, levelsResponse] = await Promise.all([
        api.get('/branches'),
        api.get('/levels')
      ]);
      setBranches(branchesResponse.data);
      setBranchLevels(levelsResponse.data || []);
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في تحميل الفروع' : 'Error loading branches');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name_ar || !formData.phone) {
      toast.error(language === 'ar' ? 'يرجى ملء الحقول المطلوبة' : 'Please fill required fields');
      return;
    }
    if ((formData.working_days || []).length === 0) {
      toast.error(language === 'ar' ? 'اختر يوم عمل واحد على الأقل للفرع' : 'Select at least one working day');
      return;
    }
    if (formData.branch_type === 'rented') {
      if (!formData.venues.length || formData.venues.some(venue =>
        !venue.name || !venue.contract_start_date || !venue.contract_end_date ||
        venue.cost === '' || Number(venue.cost) < 0 || Number(venue.warning_days) < 0 ||
        venue.booking_slots.length === 0
      )) {
        toast.error(language === 'ar' ? 'يرجى إكمال بيانات الملاعب المستأجرة' : 'Please complete the rented venue details');
        return;
      }
      if (formData.venues.some(venue =>
        new Date(venue.contract_end_date) < new Date(venue.contract_start_date) ||
        venue.booking_slots.some(slot => !slot.start_time || !slot.end_time || slot.end_time <= slot.start_time)
      )) {
        toast.error(language === 'ar' ? 'تحقق من تواريخ العقود وأوقات الحجز' : 'Check contract dates and booking times');
        return;
      }
    }

    setSaving(true);
    try {
      const cleanedPrefix = (formData.code_prefix || '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
        .slice(0, 8);
      const dataToSend = {
        name: formData.name_ar,
        name_ar: formData.name_ar,
        public_name: (formData.public_name || '').trim(),
        phone: formData.phone,
        location_url: (formData.location_url || '').trim(),
        manager_name: '',
        manager_name_ar: '',
        address: '',
        address_ar: '',
        is_active: true,
        code_prefix: cleanedPrefix,
        whatsapp_group_url: (formData.whatsapp_group_url || '').trim(),
        support_whatsapp: (formData.support_whatsapp || '').trim(),
        whatsapp_renewal_template: (formData.whatsapp_renewal_template || '').trim(),
        whatsapp_manual_template: (formData.whatsapp_manual_template || '').trim(),
        whatsapp_manual_expired_template: (formData.whatsapp_manual_expired_template || '').trim(),
        whatsapp_welcome_template: (formData.whatsapp_welcome_template || '').trim(),
        working_days: WEEKDAYS
          .map(d => d.id)
          .filter(id => (formData.working_days || []).includes(id)),
        branch_type: formData.branch_type,
        contract_warning_days: Math.max(0, ...formData.venues.map(venue => Number(venue.warning_days) || 0)),
        venues: formData.branch_type === 'rented'
          ? formData.venues.map(venue => ({
              ...(venue.id ? { id: venue.id } : {}),
              name: venue.name.trim(),
              number: venue.number.trim(),
              size: String(venue.size || venue.number || venue.name).trim(),
              contract_start_date: venue.contract_start_date,
              contract_end_date: venue.contract_end_date,
              cost: Number(venue.cost),
              cost_type: venue.cost_type,
              warning_days: Number(venue.warning_days),
              booking_slots: WEEKDAYS.flatMap(day =>
                venue.booking_slots
                  .filter(slot => slot.weekday === day.id)
                  .map(slot => ({
                    ...(slot.id ? { id: slot.id } : {}),
                    day: day.id,
                    start_time: slot.start_time,
                    end_time: slot.end_time,
                    start_date: slot.start_date || venue.contract_start_date,
                    end_date: slot.end_date || venue.contract_end_date,
                    cost: Number(slot.cost ?? venue.cost),
                    cost_type: slot.cost_type || venue.cost_type
                  }))
              )
            }))
          : []
      };
      
      if (editingBranch) {
        await api.put(`/branches/${editingBranch.id}`, dataToSend);
        toast.success(language === 'ar' ? 'تم تحديث الفرع بنجاح' : 'Branch updated successfully');
      } else {
        await api.post('/branches', dataToSend);
        toast.success(language === 'ar' ? 'تم إضافة الفرع بنجاح' : 'Branch added successfully');
      }
      loadBranches();
      handleCloseDialog();
    } catch (error) {
      toast.error(error.response?.data?.detail || (language === 'ar' ? 'خطأ في حفظ الفرع' : 'Error saving branch'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (branchId) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف هذا الفرع؟' : 'Are you sure you want to delete this branch?')) {
      return;
    }
    try {
      await api.delete(`/branches/${branchId}`);
      toast.success(language === 'ar' ? 'تم حذف الفرع' : 'Branch deleted');
      loadBranches();
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حذف الفرع' : 'Error deleting branch');
    }
  };

  const handleEdit = (branch) => {
    setEditingBranch(branch);
    setFormData({
      name_ar: branch.name_ar || branch.name || '',
      public_name: branch.public_name || '',
      phone: branch.phone || '',
      location_url: branch.location_url || '',
      code_prefix: branch.code_prefix || '',
      whatsapp_group_url: branch.whatsapp_group_url || '',
      support_whatsapp: branch.support_whatsapp || '',
      whatsapp_renewal_template: branch.whatsapp_renewal_template || '',
      whatsapp_manual_template: branch.whatsapp_manual_template || '',
      whatsapp_manual_expired_template: branch.whatsapp_manual_expired_template || '',
      whatsapp_welcome_template: branch.whatsapp_welcome_template || '',
      // Missing/empty working_days means the branch was created before this
      // feature -> treat it as open all week.
      working_days: Array.isArray(branch.working_days) && branch.working_days.length > 0
        ? branch.working_days
        : [...ALL_WEEKDAY_IDS],
      branch_type: ['rented', 'rented_venue'].includes(branch.branch_type) ? 'rented' : 'permanent',
      venues: (Array.isArray(branch.venues) ? branch.venues : Array.isArray(branch.rented_venues) ? branch.rented_venues : []).map(normalizeVenue)
    });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingBranch(null);
    setFormData(initialFormData());
  };

  const updateVenue = (index, patch) => {
    const slotFieldMap = {
      contract_start_date: 'start_date',
      contract_end_date: 'end_date',
      cost: 'cost',
      cost_type: 'cost_type'
    };
    setFormData(current => ({
      ...current,
      venues: current.venues.map((venue, venueIndex) =>
        venueIndex === index ? {
          ...venue,
          ...patch,
          booking_slots: Object.keys(slotFieldMap).some(key => Object.prototype.hasOwnProperty.call(patch, key))
            ? venue.booking_slots.map(slot => {
                const slotPatch = {};
                Object.entries(slotFieldMap).forEach(([venueField, slotField]) => {
                  if (Object.prototype.hasOwnProperty.call(patch, venueField)) {
                    slotPatch[slotField] = patch[venueField];
                  }
                });
                return { ...slot, ...slotPatch };
              })
            : venue.booking_slots
        } : venue
      )
    }));
  };

  const addVenueSlot = (venueIndex, weekday) => {
    const venue = formData.venues[venueIndex];
    updateVenue(venueIndex, {
      booking_slots: [
        ...venue.booking_slots,
        {
          id: '',
          weekday,
          start_time: '18:00',
          end_time: '19:00',
          start_date: venue.contract_start_date,
          end_date: venue.contract_end_date,
          cost: venue.cost,
          cost_type: venue.cost_type
        }
      ]
    });
  };

  const updateVenueSlot = (venueIndex, slotIndex, patch) => {
    const venue = formData.venues[venueIndex];
    updateVenue(venueIndex, {
      booking_slots: venue.booking_slots.map((slot, index) =>
        index === slotIndex ? { ...slot, ...patch } : slot
      )
    });
  };

  const removeVenueSlot = (venueIndex, slotIndex) => {
    const venue = formData.venues[venueIndex];
    updateVenue(venueIndex, {
      booking_slots: venue.booking_slots.filter((_, index) => index !== slotIndex)
    });
  };

  const venueHasActiveLevel = (venueId) =>
    Boolean(venueId) && branchLevels.some(level => level.venue_id === venueId && level.is_active !== false);

  const slotHasActiveLevel = (slotId) =>
    Boolean(slotId) && branchLevels.some(level => level.booking_slot_id === slotId && level.is_active !== false);

  const editingBranchHasVenueLevels = Boolean(editingBranch?.id) &&
    branchLevels.some(level =>
      level.branch_id === editingBranch.id &&
      level.venue_id &&
      level.is_active !== false
    );

  const isAdmin = user?.is_admin;

  if (!isAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">{language === 'ar' ? 'ليس لديك صلاحية الوصول لهذه الصفحة' : 'You do not have access to this page'}</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">{language === 'ar' ? 'إدارة الفروع' : 'Branches Management'}</h1>
            <p className="text-muted-foreground">{language === 'ar' ? 'إضافة وتعديل فروع الأكاديمية' : 'Add and manage academy branches'}</p>
          </div>
          <Button onClick={() => setIsDialogOpen(true)} data-testid="add-branch-btn">
            <Plus className="w-4 h-4 me-2" />
            {language === 'ar' ? 'إضافة فرع' : 'Add Branch'}
          </Button>
        </div>

        {/* Branches Grid */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : branches.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{language === 'ar' ? 'لا توجد فروع بعد' : 'No branches yet'}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {branches.map((branch) => (
              <Card key={branch.id} className="hover:shadow-md transition-shadow" data-testid={`branch-card-${branch.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-primary" />
                      <CardTitle className="text-lg">{branch.name_ar || branch.name}</CardTitle>
                    </div>
                    <Badge variant={branch.is_active !== false ? "default" : "secondary"}>
                      {branch.is_active !== false ? (language === 'ar' ? 'نشط' : 'Active') : (language === 'ar' ? 'غير نشط' : 'Inactive')}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="w-4 h-4" />
                    <span dir="ltr">{branch.phone}</span>
                  </div>
                  {/^https?:\/\//i.test((branch.location_url || '').trim()) && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <a
                        href={branch.location_url.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                        data-testid={`branch-location-link-${branch.id}`}
                      >
                        {language === 'ar' ? 'اللوكيشن على الخريطة' : 'View location'}
                      </a>
                    </div>
                  )}
                  {branch.code_prefix && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">
                        {language === 'ar' ? 'بادئة كود العضوية:' : 'Member code prefix:'}
                      </span>
                      <Badge variant="outline" dir="ltr">{branch.code_prefix}-001</Badge>
                    </div>
                  )}
                  <div className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground whitespace-nowrap">
                      {language === 'ar' ? 'أيام العمل:' : 'Working days:'}
                    </span>
                    {(!Array.isArray(branch.working_days) || branch.working_days.length === 0 || branch.working_days.length === ALL_WEEKDAY_IDS.length) ? (
                      <span>{language === 'ar' ? 'كل أيام الأسبوع' : 'All week'}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {WEEKDAYS.filter(d => branch.working_days.includes(d.id)).map(d => (
                          <Badge key={d.id} variant="secondary" className="text-xs">
                            {language === 'ar' ? d.name_ar : d.name_en}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">
                      {language === 'ar' ? 'نوع الفرع:' : 'Branch type:'}
                    </span>
                    <Badge variant="outline" data-testid={`branch-type-${branch.id}`}>
                      {['rented', 'rented_venue'].includes(branch.branch_type)
                        ? (language === 'ar' ? 'ملاعب مستأجرة' : 'Rented venue')
                        : (language === 'ar' ? 'دائم' : 'Permanent')}
                    </Badge>
                  </div>
                  {['rented', 'rented_venue'].includes(branch.branch_type) &&
                    (Array.isArray(branch.venues) || Array.isArray(branch.rented_venues)) && (
                    <div className="space-y-2 border-t pt-3" data-testid={`branch-venues-summary-${branch.id}`}>
                      {(branch.venues || branch.rented_venues || []).map((venue, venueIndex) => {
                        const venueEndDate = venue.contract_end_date || venue.booking_slots?.[0]?.end_date;
                        const expired = Boolean(venueEndDate) &&
                          new Date(`${venueEndDate}T23:59:59`) < new Date();
                        const costLabels = {
                          hourly: language === 'ar' ? 'بالساعة' : 'hour',
                          period: language === 'ar' ? 'للفترة' : 'period',
                          monthly: language === 'ar' ? 'شهرياً' : 'month'
                        };
                        return (
                          <div key={venue.id || venueIndex} className="rounded-md bg-muted/40 p-2 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">
                                {venue.name}
                                {venue.number ? ` · #${venue.number}` : ''}
                              </span>
                              <Badge variant={expired ? 'destructive' : 'secondary'}>
                                {expired
                                  ? (language === 'ar' ? 'منتهي' : 'Expired')
                                  : (language === 'ar' ? 'متاح' : 'Available')}
                              </Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {venue.contract_start_date || venue.booking_slots?.[0]?.start_date || '—'} → {venue.contract_end_date || venue.booking_slots?.[0]?.end_date || '—'}
                              {(venue.cost !== undefined && venue.cost !== null) || venue.booking_slots?.[0]?.cost !== undefined ? (
                                <span> · {venue.cost ?? venue.booking_slots?.[0]?.cost} {language === 'ar' ? 'ر.س' : 'SAR'}/{costLabels[venue.cost_type || venue.booking_slots?.[0]?.cost_type] || venue.cost_type || venue.booking_slots?.[0]?.cost_type}</span>
                              ) : null}
                              {venue.size !== undefined && venue.size !== null && venue.size !== '' && (
                                <span> · {venue.size} m²</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(branch)} data-testid={`edit-branch-${branch.id}`}>
                      <Edit className="w-4 h-4 me-1" />
                      {language === 'ar' ? 'تعديل' : 'Edit'}
                    </Button>
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(branch.id)} data-testid={`delete-branch-${branch.id}`}>
                      <Trash2 className="w-4 h-4 me-1" />
                      {language === 'ar' ? 'حذف' : 'Delete'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Add/Edit Dialog - Simplified */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="w-[96vw] max-w-4xl max-h-[90vh] flex flex-col p-0">
            <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
              <DialogTitle>
                {editingBranch 
                  ? (language === 'ar' ? 'تعديل الفرع' : 'Edit Branch')
                  : (language === 'ar' ? 'إضافة فرع جديد' : 'Add New Branch')
                }
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="space-y-4 overflow-y-auto px-6 py-2 flex-1 min-h-0">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'اسم الفرع' : 'Branch Name'} *</Label>
                <Input
                  value={formData.name_ar}
                  onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                  placeholder={language === 'ar' ? 'مثال: الفرع الرئيسي' : 'e.g. Main Branch'}
                  data-testid="branch-name-input"
                />
              </div>

              <div className="space-y-2">
                <Label>{language === 'ar' ? 'اسم العرض العام (اختياري)' : 'Public display name (optional)'}</Label>
                <Input
                  value={formData.public_name}
                  onChange={(e) => setFormData({ ...formData, public_name: e.target.value })}
                  placeholder={language === 'ar' ? 'الاسم اللي هيظهر للأهالي في صفحة التسجيل' : 'Name shown to parents on the public registration page'}
                  data-testid="branch-public-name-input"
                />
                <p className="text-xs text-gray-500">
                  {language === 'ar'
                    ? 'لو سيبته فاضي هيظهر اسم الفرع العادي للأهالي.'
                    : 'Leave empty to show the normal branch name.'}
                </p>
              </div>
              
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'رقم الجوال' : 'Phone Number'} *</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="05XXXXXXXX"
                  dir="ltr"
                  data-testid="branch-phone-input"
                />
              </div>

              <div className="space-y-2">
                <Label>{language === 'ar' ? 'رابط اللوكيشن (خرائط جوجل)' : 'Location Link (Google Maps)'}</Label>
                <Input
                  value={formData.location_url}
                  onChange={(e) => setFormData({ ...formData, location_url: e.target.value })}
                  placeholder="https://maps.app.goo.gl/XXXXXXXX"
                  dir="ltr"
                  data-testid="branch-location-input"
                />
                <p className="text-xs text-muted-foreground">
                  {language === 'ar'
                    ? 'هيظهر رقم التواصل واللوكيشن تحت اسم الفرع في صفحة التسجيل العامة. اتركه فارغًا لإخفاء اللوكيشن.'
                    : 'The contact number and location will appear under the branch on the public registration page. Leave empty to hide the location.'}
                </p>
              </div>

              <div className="space-y-2">
                <Label>
                  {language === 'ar' ? 'بادئة كود العضوية' : 'Member Code Prefix'}
                </Label>
                <Input
                  value={formData.code_prefix}
                  onChange={(e) => setFormData({
                    ...formData,
                    code_prefix: e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8)
                  })}
                  placeholder={language === 'ar' ? 'مثال: RYD' : 'e.g. RYD'}
                  dir="ltr"
                  maxLength={8}
                  data-testid="branch-code-prefix-input"
                />
                <p className="text-xs text-muted-foreground">
                  {language === 'ar'
                    ? `سيتم توليد أكواد الأعضاء في هذا الفرع بصيغة ${formData.code_prefix || 'PREFIX'}-001, ${formData.code_prefix || 'PREFIX'}-002 ... (اتركه فارغًا للتوليد التلقائي)`
                    : `New member codes in this branch will be ${formData.code_prefix || 'PREFIX'}-001, ${formData.code_prefix || 'PREFIX'}-002 ... (leave empty for auto)`}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="branch-type">{language === 'ar' ? 'نوع الفرع' : 'Branch Type'}</Label>
                <select
                  id="branch-type"
                  value={formData.branch_type}
                  disabled={editingBranchHasVenueLevels}
                  onChange={(e) => setFormData(current => ({
                    ...current,
                    branch_type: e.target.value,
                    venues: e.target.value === 'rented'
                      ? (current.venues.length ? current.venues : [emptyVenue()])
                      : current.venues
                  }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  data-testid="branch-type-select"
                >
                  <option value="permanent">{language === 'ar' ? 'فرع دائم' : 'Permanent branch'}</option>
                  <option value="rented">{language === 'ar' ? 'ملاعب مستأجرة' : 'Rented venue'}</option>
                </select>
              </div>

              {formData.branch_type === 'rented' && (
                <div className="space-y-4" data-testid="rented-venues-editor">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="font-bold">{language === 'ar' ? 'الملاعب المستأجرة' : 'Rented Venues'}</Label>
                      <p className="text-xs text-muted-foreground">
                        {language === 'ar' ? 'أضف ملعباً واحداً أو أكثر وجدول أوقات الحجز الأسبوعي.' : 'Add one or more venues and their weekly booking times.'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setFormData(current => ({ ...current, venues: [...current.venues, emptyVenue()] }))}
                      data-testid="add-venue-btn"
                    >
                      <Plus className="w-4 h-4 me-1" />
                      {language === 'ar' ? 'إضافة ملعب' : 'Add venue'}
                    </Button>
                  </div>

                  {formData.venues.map((venue, venueIndex) => (
                    <section
                      key={venueIndex}
                      className="space-y-4 rounded-lg border p-3 sm:p-4"
                      aria-labelledby={`venue-heading-${venueIndex}`}
                      data-testid={`venue-editor-${venueIndex}`}
                    >
                      <div className="flex items-center justify-between">
                        <h3 id={`venue-heading-${venueIndex}`} className="font-semibold">
                          {language === 'ar' ? `الملعب ${venueIndex + 1}` : `Venue ${venueIndex + 1}`}
                        </h3>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-red-600"
                          disabled={
                            formData.venues.length === 1 ||
                            venueHasActiveLevel(venue.id)
                          }
                          onClick={() => setFormData(current => ({
                            ...current,
                            venues: current.venues.filter((_, index) => index !== venueIndex)
                          }))}
                          aria-label={language === 'ar' ? `حذف الملعب ${venueIndex + 1}` : `Remove venue ${venueIndex + 1}`}
                          data-testid={`remove-venue-${venueIndex}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor={`venue-name-${venueIndex}`}>{language === 'ar' ? 'اسم الملعب' : 'Venue Name'} *</Label>
                          <Input id={`venue-name-${venueIndex}`} value={venue.name} onChange={e => updateVenue(venueIndex, { name: e.target.value })} data-testid={`venue-name-${venueIndex}`} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`venue-number-${venueIndex}`}>{language === 'ar' ? 'رقم الملعب' : 'Venue Number'}</Label>
                          <Input id={`venue-number-${venueIndex}`} value={venue.number} onChange={e => updateVenue(venueIndex, { number: e.target.value })} data-testid={`venue-number-${venueIndex}`} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`venue-size-${venueIndex}`}>{language === 'ar' ? 'المساحة (م²)' : 'Size (m²)'}</Label>
                          <Input id={`venue-size-${venueIndex}`} type="number" min="0" step="0.01" value={venue.size} onChange={e => updateVenue(venueIndex, { size: e.target.value })} data-testid={`venue-size-${venueIndex}`} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`venue-start-${venueIndex}`}>{language === 'ar' ? 'بداية العقد' : 'Contract Start'} *</Label>
                          <Input id={`venue-start-${venueIndex}`} type="date" disabled={venueHasActiveLevel(venue.id)} value={venue.contract_start_date} onChange={e => updateVenue(venueIndex, { contract_start_date: e.target.value })} data-testid={`venue-contract-start-${venueIndex}`} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`venue-end-${venueIndex}`}>{language === 'ar' ? 'نهاية العقد' : 'Contract End'} *</Label>
                          <Input id={`venue-end-${venueIndex}`} type="date" disabled={venueHasActiveLevel(venue.id)} min={venue.contract_start_date || undefined} value={venue.contract_end_date} onChange={e => updateVenue(venueIndex, { contract_end_date: e.target.value })} data-testid={`venue-contract-end-${venueIndex}`} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`venue-warning-${venueIndex}`}>{language === 'ar' ? 'التنبيه قبل (يوم)' : 'Warning Days'}</Label>
                          <Input id={`venue-warning-${venueIndex}`} type="number" min="0" value={venue.warning_days} onChange={e => updateVenue(venueIndex, { warning_days: e.target.value })} data-testid={`venue-warning-days-${venueIndex}`} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`venue-cost-${venueIndex}`}>{language === 'ar' ? 'التكلفة' : 'Cost'} *</Label>
                          <Input id={`venue-cost-${venueIndex}`} type="number" min="0" step="0.01" value={venue.cost} onChange={e => updateVenue(venueIndex, { cost: e.target.value })} data-testid={`venue-cost-${venueIndex}`} />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label htmlFor={`venue-cost-type-${venueIndex}`}>{language === 'ar' ? 'نوع التكلفة' : 'Cost Type'}</Label>
                          <select
                            id={`venue-cost-type-${venueIndex}`}
                            value={venue.cost_type}
                            onChange={e => updateVenue(venueIndex, { cost_type: e.target.value })}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            data-testid={`venue-cost-type-${venueIndex}`}
                          >
                            <option value="hourly">{language === 'ar' ? 'بالساعة' : 'Hourly'}</option>
                            <option value="period">{language === 'ar' ? 'للفترة' : 'Period'}</option>
                            <option value="monthly">{language === 'ar' ? 'شهري' : 'Monthly'}</option>
                          </select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>{language === 'ar' ? 'جدول الحجز الأسبوعي' : 'Weekly Booking Schedule'}</Label>
                        <div className="overflow-x-auto rounded-md border">
                          <table className="w-full min-w-[560px] text-sm" data-testid={`venue-schedule-${venueIndex}`}>
                            <thead className="bg-muted/60">
                              <tr>
                                <th scope="col" className="p-2 text-start">{language === 'ar' ? 'اليوم' : 'Day'}</th>
                                <th scope="col" className="p-2 text-start">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                                <th scope="col" className="p-2 text-start">{language === 'ar' ? 'من' : 'Start'}</th>
                                <th scope="col" className="p-2 text-start">{language === 'ar' ? 'إلى' : 'End'}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {WEEKDAYS.flatMap(day => {
                                const daySlots = venue.booking_slots
                                  .map((slot, slotIndex) => ({ slot, slotIndex }))
                                  .filter(({ slot }) => slot.weekday === day.id);
                                if (daySlots.length === 0) {
                                  return [(
                                    <tr key={`${day.id}-empty`} className="border-t">
                                      <td className="p-2 font-medium">{language === 'ar' ? day.name_ar : day.name_en}</td>
                                      <td className="p-2"><Badge variant="outline">—</Badge></td>
                                      <td className="p-2 text-muted-foreground" colSpan={2}>
                                        <Button type="button" variant="outline" size="sm" onClick={() => addVenueSlot(venueIndex, day.id)}>
                                          <Plus className="me-1 h-3 w-3" />
                                          {language === 'ar' ? 'إضافة فترة' : 'Add slot'}
                                        </Button>
                                      </td>
                                    </tr>
                                  )];
                                }
                                return daySlots.map(({ slot, slotIndex }, rowIndex) => {
                                  const expired = venue.contract_end_date && new Date(`${venue.contract_end_date}T23:59:59`) < new Date();
                                  const reserved = slotHasActiveLevel(slot.id);
                                  return (
                                    <tr key={slot.id || `${day.id}-${slotIndex}`} className="border-t">
                                      <td className="p-2 font-medium">
                                        {language === 'ar' ? day.name_ar : day.name_en}
                                        {rowIndex === daySlots.length - 1 && (
                                          <button type="button" className="ms-2 text-xs text-primary hover:underline" onClick={() => addVenueSlot(venueIndex, day.id)}>
                                            + {language === 'ar' ? 'فترة' : 'slot'}
                                          </button>
                                        )}
                                      </td>
                                      <td className="p-2">
                                        <Badge variant={expired ? 'destructive' : reserved ? 'default' : 'secondary'}>
                                          {expired
                                            ? (language === 'ar' ? 'منتهي' : 'Expired')
                                            : reserved
                                              ? (language === 'ar' ? 'محجوز' : 'Reserved')
                                              : (language === 'ar' ? 'متاح' : 'Available')}
                                        </Badge>
                                      </td>
                                      <td className="p-2">
                                        <Input type="time" disabled={reserved} value={slot.start_time || ''} onChange={e => updateVenueSlot(venueIndex, slotIndex, { start_time: e.target.value })} aria-label={`${language === 'ar' ? day.name_ar : day.name_en} ${language === 'ar' ? 'وقت البداية' : 'start time'}`} data-testid={`venue-${venueIndex}-${day.id}-${slotIndex}-start`} />
                                      </td>
                                      <td className="p-2">
                                        <div className="flex items-center gap-1">
                                          <Input type="time" disabled={reserved} value={slot.end_time || ''} onChange={e => updateVenueSlot(venueIndex, slotIndex, { end_time: e.target.value })} aria-label={`${language === 'ar' ? day.name_ar : day.name_en} ${language === 'ar' ? 'وقت النهاية' : 'end time'}`} data-testid={`venue-${venueIndex}-${day.id}-${slotIndex}-end`} />
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="text-red-600"
                                            disabled={reserved}
                                            onClick={() => removeVenueSlot(venueIndex, slotIndex)}
                                            aria-label={language === 'ar' ? 'حذف الفترة' : 'Remove slot'}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                });
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {language === 'ar' ? 'يمكن إضافة أكثر من فترة في اليوم نفسه، وتظهر «محجوز» عند ربط الفترة بمستوى نشط.' : 'You can add multiple slots per day. Reserved appears when a slot is linked to an active level.'}
                        </p>
                      </div>
                    </section>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <Label>{language === 'ar' ? 'أيام عمل الفرع' : 'Branch Working Days'}</Label>
                <div className="grid grid-cols-2 gap-2 p-2 border rounded">
                  {WEEKDAYS.map(d => {
                    const checked = (formData.working_days || []).includes(d.id);
                    return (
                      <label
                        key={d.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm border ${checked ? 'bg-primary/10 border-primary' : 'border-gray-200 hover:bg-gray-50'}`}
                        data-testid={`branch-day-${d.id}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const cur = new Set(formData.working_days || []);
                            if (e.target.checked) cur.add(d.id); else cur.delete(d.id);
                            setFormData({
                              ...formData,
                              working_days: WEEKDAYS.map(w => w.id).filter(id => cur.has(id))
                            });
                          }}
                          className="w-4 h-4"
                        />
                        <span>{language === 'ar' ? d.name_ar : d.name_en}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {language === 'ar'
                    ? 'الأيام المختارة فقط هي اللي هتظهر في صفحة المستويات والجدول لهذا الفرع.'
                    : 'Only the selected days will appear on the levels/schedule page for this branch.'}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{language === 'ar' ? 'رابط جروب الواتساب الخاص بالفرع' : 'Branch WhatsApp Group Link'}</Label>
                <Input
                  value={formData.whatsapp_group_url}
                  onChange={(e) => setFormData({ ...formData, whatsapp_group_url: e.target.value })}
                  placeholder="https://chat.whatsapp.com/XXXXXXXXXXXX"
                  dir="ltr"
                  data-testid="branch-whatsapp-group-input"
                />
                <p className="text-xs text-muted-foreground">
                  {language === 'ar'
                    ? 'سيتم إدراج هذا الرابط في رسائل واتساب الفواتير واستمارات التسجيل لهذا الفرع. اتركه فارغًا لإخفاء الرابط من الرسائل.'
                    : 'This link will be inserted in WhatsApp messages for invoices and registration forms of this branch. Leave empty to omit the link.'}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{language === 'ar' ? 'رقم واتساب التجديد والدعم (بوابة العضو)' : 'Renewal & Support WhatsApp (member portal)'}</Label>
                <Input
                  value={formData.support_whatsapp}
                  onChange={(e) => setFormData({ ...formData, support_whatsapp: e.target.value })}
                  placeholder="05xxxxxxxx"
                  dir="ltr"
                  data-testid="branch-support-whatsapp-input"
                />
                <p className="text-xs text-muted-foreground">
                  {language === 'ar'
                    ? 'يستخدمه أعضاء هذا الفرع في أزرار «تجديد الاشتراك عبر واتساب» وصفحة الدعم. فارغ = رقم هاتف الفرع، ثم الرقم العام.'
                    : "Used by this branch's members in the renew-via-WhatsApp buttons and the support page. Empty = branch phone, then the global default."}
                </p>
              </div>

              <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
                <Label className="font-bold">{language === 'ar' ? 'قوالب رسائل الواتساب الخاصة بالفرع' : 'Branch WhatsApp Message Templates'}</Label>
                <p className="text-xs text-muted-foreground">
                  {language === 'ar'
                    ? 'متغيرات متاحة: {name} اسم العضو، {activity} النشاط، {days} الأيام المتبقية، {end_date} تاريخ الانتهاء، {fee} المبلغ. اتركه فارغًا لاستخدام النص العام الافتراضي.'
                    : 'Available variables: {name}, {activity}, {days}, {end_date}, {fee}. Leave empty to use the global default template.'}
                </p>

                <div className="space-y-1">
                  <Label className="text-sm">{language === 'ar' ? 'قالب التذكير بالتجديد (التلقائي)' : 'Renewal Reminder Template (automatic)'}</Label>
                  <textarea
                    className="w-full min-h-[90px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={formData.whatsapp_renewal_template}
                    onChange={(e) => setFormData({ ...formData, whatsapp_renewal_template: e.target.value })}
                    placeholder={language === 'ar' ? 'مثال: أهلاً {name}، اشتراكك في {activity} بيخلص بعد {days} يوم.' : 'e.g. Hi {name}, your {activity} subscription ends in {days} days.'}
                    dir="rtl"
                    data-testid="branch-whatsapp-renewal-template"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-sm">{language === 'ar' ? 'قالب التذكير اليدوي' : 'Manual Reminder Template'}</Label>
                  <textarea
                    className="w-full min-h-[90px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={formData.whatsapp_manual_template}
                    onChange={(e) => setFormData({ ...formData, whatsapp_manual_template: e.target.value })}
                    placeholder={language === 'ar' ? 'مثال: السلام عليكم {name}، اشتراك {activity} قارب على الانتهاء بتاريخ {end_date}.' : 'e.g. Hello {name}, your {activity} subscription ends on {end_date}.'}
                    dir="rtl"
                    data-testid="branch-whatsapp-manual-template"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-sm">{language === 'ar' ? 'قالب التذكير بعد انتهاء الاشتراك' : 'Expired Subscription Reminder Template'}</Label>
                  <textarea
                    className="w-full min-h-[90px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={formData.whatsapp_manual_expired_template}
                    onChange={(e) => setFormData({ ...formData, whatsapp_manual_expired_template: e.target.value })}
                    placeholder={language === 'ar' ? 'مثال: السلام عليكم {name}، اشتراك {activity} انتهى بتاريخ {end_date}. فارغ = القالب العام.' : 'e.g. Hello {name}, your {activity} subscription ended on {end_date}. Empty = global template.'}
                    dir="rtl"
                    data-testid="branch-whatsapp-manual-expired-template"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-sm">{language === 'ar' ? 'قالب رسالة الترحيب بالعضو الجديد' : 'New Member Welcome Template'}</Label>
                  <textarea
                    className="w-full min-h-[90px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={formData.whatsapp_welcome_template}
                    onChange={(e) => setFormData({ ...formData, whatsapp_welcome_template: e.target.value })}
                    placeholder={language === 'ar' ? 'مثال: أهلاً وسهلاً {name} 🎉 نورت {activity}!' : 'e.g. Welcome {name} 🎉 to {activity}!'}
                    dir="rtl"
                    data-testid="branch-whatsapp-welcome-template"
                  />
                </div>
              </div>

              </div>

              <DialogFooter className="px-6 py-4 border-t shrink-0">
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </Button>
                <Button type="submit" disabled={saving} data-testid="save-branch-btn">
                  {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {editingBranch 
                    ? (language === 'ar' ? 'تحديث' : 'Update')
                    : (language === 'ar' ? 'إضافة' : 'Add')
                  }
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default BranchesPage;
