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
import api, { branchesAPI, whatsappAPI } from '../services/api';
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
  whatsapp_cloud_enabled: false,
  whatsapp_provider: 'meta_cloud',
  whatsapp_waha_session_name: '',
  whatsapp_waha_daily_limit: 30,
  whatsapp_whatsflow_instance: '',
  whatsapp_whatsflow_api_key: '',
  whatsapp_whatsflow_api_key_configured: false,
  whatsapp_phone_number_id: '',
  whatsapp_business_account_id: '',
  whatsapp_access_token: '',
  whatsapp_app_secret: '',
  whatsapp_inbox_enabled: false,
  whatsapp_graph_api_version: 'v23.0',
  whatsapp_meta_template_name: '',
  whatsapp_meta_template_language: 'ar',
  whatsapp_single_variable_template_confirmed: false,
  whatsapp_renewal_contact_button_confirmed: false,
  whatsapp_image_template_name: '',
  whatsapp_document_template_name: '',
  whatsapp_media_templates_confirmed: false,
  whatsapp_attendance_template_name: '',
  whatsapp_attendance_template_confirmed: false,
  whatsapp_payment_template_name: '',
  whatsapp_payment_template_confirmed: false,
  whatsapp_class_reminder_template_name: '',
  whatsapp_class_reminder_template_confirmed: false,
  whatsapp_schedule_update_template_name: '',
  whatsapp_schedule_update_template_confirmed: false,
  whatsapp_token_configured: false,
  whatsapp_app_secret_configured: false,
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

const getBranchVenues = (branch = {}) => {
  if (Array.isArray(branch.venues) && branch.venues.length > 0) return branch.venues;
  if (Array.isArray(branch.rented_venues)) return branch.rented_venues;
  return Array.isArray(branch.venues) ? branch.venues : [];
};

const BranchesPage = () => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [branches, setBranches] = useState([]);
  const [branchLevels, setBranchLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testingWhatsApp, setTestingWhatsApp] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState(null);
  const [providerStatus, setProviderStatus] = useState(null);
  const [providerQuality, setProviderQuality] = useState(null);
  const [providerQr, setProviderQr] = useState(null);
  const [providerAction, setProviderAction] = useState('');
  
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
        // Kept only for compatibility with APIs that still infer venue handling
        // from this legacy field; the UI treats every branch as a normal branch.
        branch_type: editingBranch?.branch_type || 'permanent',
        // Venue management lives on /admin/rented-venues. Branch updates must
        // pass the embedded records through byte-for-byte so their IDs and
        // active level references are never accidentally removed.
        contract_warning_days: editingBranch?.contract_warning_days ?? 30,
        venues: editingBranch ? getBranchVenues(editingBranch) : []
      };
      
      let savedBranch;
      if (editingBranch) {
        const response = await api.put(`/branches/${editingBranch.id}`, dataToSend);
        savedBranch = response.data;
        toast.success(language === 'ar' ? 'تم تحديث الفرع بنجاح' : 'Branch updated successfully');
      } else {
        const response = await api.post('/branches', dataToSend);
        savedBranch = response.data;
        toast.success(language === 'ar' ? 'تم إضافة الفرع بنجاح' : 'Branch added successfully');
      }
      const savedBranchId = editingBranch?.id || savedBranch?.id;
      if (
        savedBranchId &&
        (
          ['waha', 'whatsflow', 'legacy', 'disabled'].includes(formData.whatsapp_provider)
          || formData.whatsapp_phone_number_id
          || formData.whatsapp_token_configured
          || formData.whatsapp_access_token
        )
      ) {
        await branchesAPI.updateWhatsAppCloud(savedBranchId, {
          enabled: !!formData.whatsapp_cloud_enabled,
          provider: formData.whatsapp_provider || 'meta_cloud',
          waha_session_name: formData.whatsapp_waha_session_name || null,
          waha_daily_limit: Number(formData.whatsapp_waha_daily_limit) || 30,
          whatsflow_instance: formData.whatsapp_whatsflow_instance || null,
          whatsflow_api_key: formData.whatsapp_whatsflow_api_key || null,
          phone_number_id: formData.whatsapp_phone_number_id,
          whatsapp_business_account_id: formData.whatsapp_business_account_id,
          access_token: formData.whatsapp_access_token || null,
          app_secret: formData.whatsapp_app_secret || null,
          inbox_enabled: !!formData.whatsapp_inbox_enabled,
          graph_api_version: formData.whatsapp_graph_api_version || 'v23.0'
          ,
          message_template_name: formData.whatsapp_meta_template_name || '',
          template_language: formData.whatsapp_meta_template_language || 'ar',
          single_variable_template_confirmed: !!formData.whatsapp_single_variable_template_confirmed
          ,
          renewal_contact_button_confirmed: !!formData.whatsapp_renewal_contact_button_confirmed,
          image_template_name: formData.whatsapp_image_template_name || '',
          document_template_name: formData.whatsapp_document_template_name || '',
          media_templates_confirmed: !!formData.whatsapp_media_templates_confirmed
          ,
          attendance_template_name: formData.whatsapp_attendance_template_name || '',
          attendance_template_confirmed: !!formData.whatsapp_attendance_template_confirmed,
          payment_template_name: formData.whatsapp_payment_template_name || '',
          payment_template_confirmed: !!formData.whatsapp_payment_template_confirmed,
          class_reminder_template_name: formData.whatsapp_class_reminder_template_name || '',
          class_reminder_template_confirmed: !!formData.whatsapp_class_reminder_template_confirmed,
          schedule_update_template_name: formData.whatsapp_schedule_update_template_name || '',
          schedule_update_template_confirmed: !!formData.whatsapp_schedule_update_template_confirmed
        });
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

  const handleEdit = async (branch) => {
    setEditingBranch(branch);
    let cloud = {};
    try {
      const [cloudResponse, webhookResponse] = await Promise.all([
        branchesAPI.getWhatsAppCloud(branch.id),
        whatsappAPI.getMetaWebhookInfo()
      ]);
      cloud = cloudResponse.data || {};
      setWebhookInfo(webhookResponse.data || null);
    } catch (_e) {}
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
      whatsapp_cloud_enabled: !!cloud.enabled,
      whatsapp_provider: cloud.provider || 'meta_cloud',
      whatsapp_waha_session_name: cloud.waha_session_name || '',
      whatsapp_waha_daily_limit: cloud.waha_daily_limit ?? 30,
      whatsapp_whatsflow_instance: cloud.whatsflow_instance || '',
      whatsapp_whatsflow_api_key: '',
      whatsapp_whatsflow_api_key_configured: !!cloud.whatsflow_api_key_configured,
      whatsapp_phone_number_id: cloud.phone_number_id || '',
      whatsapp_business_account_id: cloud.whatsapp_business_account_id || '',
      whatsapp_access_token: '',
      whatsapp_app_secret: '',
      whatsapp_inbox_enabled: !!cloud.inbox_enabled,
      whatsapp_graph_api_version: cloud.graph_api_version || 'v23.0',
      whatsapp_meta_template_name: cloud.message_template_name || '',
      whatsapp_meta_template_language: cloud.template_language || 'ar',
      whatsapp_single_variable_template_confirmed: !!cloud.single_variable_template_confirmed,
      whatsapp_renewal_contact_button_confirmed: !!cloud.renewal_contact_button_confirmed,
      whatsapp_image_template_name: cloud.image_template_name || '',
      whatsapp_document_template_name: cloud.document_template_name || '',
      whatsapp_media_templates_confirmed: !!cloud.media_templates_confirmed,
      whatsapp_attendance_template_name: cloud.attendance_template_name || '',
      whatsapp_attendance_template_confirmed: !!cloud.attendance_template_confirmed,
      whatsapp_payment_template_name: cloud.payment_template_name || '',
      whatsapp_payment_template_confirmed: !!cloud.payment_template_confirmed,
      whatsapp_class_reminder_template_name: cloud.class_reminder_template_name || '',
      whatsapp_class_reminder_template_confirmed: !!cloud.class_reminder_template_confirmed,
      whatsapp_schedule_update_template_name: cloud.schedule_update_template_name || '',
      whatsapp_schedule_update_template_confirmed: !!cloud.schedule_update_template_confirmed,
      whatsapp_token_configured: !!cloud.token_configured,
      whatsapp_app_secret_configured: !!cloud.app_secret_configured,
      // Missing/empty working_days means the branch was created before this
      // feature -> treat it as open all week.
      working_days: Array.isArray(branch.working_days) && branch.working_days.length > 0
        ? branch.working_days
        : [...ALL_WEEKDAY_IDS],
      branch_type: ['rented', 'rented_venue'].includes(branch.branch_type) ? 'rented' : 'permanent',
      venues: getBranchVenues(branch).map(normalizeVenue)
    });
    setIsDialogOpen(true);
    setProviderStatus(null);
    setProviderQuality(null);
    setProviderQr(null);
  };

  const handleCloseDialog = () => {
    if (providerQr) URL.revokeObjectURL(providerQr);
    setIsDialogOpen(false);
    setEditingBranch(null);
    setFormData(initialFormData());
    setWebhookInfo(null);
    setProviderQr(null);
    setProviderStatus(null);
    setProviderQuality(null);
  };

  const handleTestWhatsAppCloud = async () => {
    const phone = (formData.support_whatsapp || formData.phone || '').trim();
    if (!editingBranch?.id) {
      toast.error(language === 'ar' ? 'احفظ الفرع أولاً ثم اختبر الاتصال' : 'Save the branch before testing');
      return;
    }
    if (!phone) {
      toast.error(language === 'ar' ? 'أدخل رقم واتساب للفرع أولاً' : 'Enter a branch WhatsApp number first');
      return;
    }
    setTestingWhatsApp(true);
    try {
      await branchesAPI.testWhatsAppCloud(
        editingBranch.id,
        phone,
        language === 'ar' ? 'رسالة اختبار اتصال واتساب الخاص بالفرع' : 'Branch WhatsApp connection test'
      );
      toast.success(language === 'ar' ? 'تم إرسال رسالة الاختبار بنجاح' : 'Test message sent successfully');
    } catch (error) {
      toast.error(error.response?.data?.detail || (language === 'ar' ? 'فشل اختبار اتصال واتساب' : 'WhatsApp test failed'));
    } finally {
      setTestingWhatsApp(false);
    }
  };

  const loadWahaDetails = async () => {
    if (!editingBranch?.id) return;
    setProviderAction('refresh');
    try {
      const [status, quality] = await Promise.all([
        branchesAPI.getProviderStatus(editingBranch.id),
        branchesAPI.getProviderQuality(editingBranch.id)
      ]);
      setProviderStatus(status.data);
      setProviderQuality(quality.data);
      toast.success(language === 'ar' ? 'تم تحديث حالة الاتصال' : 'Provider status refreshed');
    } catch (error) {
      toast.error(error.response?.data?.detail || (language === 'ar' ? 'تعذر تحميل حالة الاتصال' : 'Could not load provider status'));
    } finally { setProviderAction(''); }
  };

  const runWahaAction = async (action) => {
    if (!editingBranch?.id) return;
    if (action === 'logout' && !window.confirm(language === 'ar' ? 'سيتم تسجيل خروج جلسة واتساب. هل تريد المتابعة؟' : 'This will log out the WhatsApp session. Continue?')) return;
    setProviderAction(action);
    try {
      await branchesAPI.providerSessionAction(editingBranch.id, action);
      toast.success(language === 'ar' ? 'تم تنفيذ الإجراء' : 'Action completed');
      await loadWahaDetails();
    } catch (error) {
      toast.error(error.response?.data?.detail || (language === 'ar' ? 'تعذر تنفيذ الإجراء' : 'Action failed'));
    } finally { setProviderAction(''); }
  };

  const fetchWahaQr = async () => {
    if (!editingBranch?.id) return;
    setProviderAction('qr');
    try {
      const status = await branchesAPI.getProviderStatus(editingBranch.id);
      setProviderStatus(status.data);
      if (status.data?.connected) {
        if (providerQr) URL.revokeObjectURL(providerQr);
        setProviderQr('');
        toast.info(language === 'ar'
          ? 'الجلسة متصلة بالفعل ولا تحتاج إلى رمز QR'
          : 'The session is already connected and does not need a QR code');
        return;
      }
      const response = await branchesAPI.getProviderQr(editingBranch.id);
      if (providerQr) URL.revokeObjectURL(providerQr);
      setProviderQr(URL.createObjectURL(response.data));
    } catch (error) {
      toast.error(error.response?.data?.detail || (language === 'ar' ? 'تعذر تحميل رمز QR' : 'Could not load QR code'));
    } finally { setProviderAction(''); }
  };

  const handleTestProvider = async () => {
    const phone = (formData.support_whatsapp || formData.phone || '').trim();
    if (!editingBranch?.id || !phone) {
      toast.error(language === 'ar' ? 'احفظ الفرع وأدخل رقم واتساب أولاً' : 'Save the branch and provide a WhatsApp number first');
      return;
    }
    setProviderAction('test');
    try {
      await branchesAPI.testProvider(editingBranch.id, phone, language === 'ar' ? 'رسالة اختبار اتصال واتساب للفرع' : 'Branch WhatsApp connection test');
      toast.success(language === 'ar' ? 'تم إرسال رسالة الاختبار' : 'Test message sent');
    } catch (error) {
      toast.error(error.response?.data?.detail || (language === 'ar' ? 'فشل اختبار الإرسال' : 'Test send failed'));
    } finally { setProviderAction(''); }
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
                  {getBranchVenues(branch).length > 0 && (
                    <div className="space-y-2 border-t pt-3" data-testid={`branch-venues-summary-${branch.id}`}>
                      <p className="text-sm font-medium">
                        {language === 'ar' ? 'الملاعب المستأجرة' : 'Rented venues'}
                      </p>
                      {getBranchVenues(branch).map((venue, venueIndex) => {
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

              {false && <div className="space-y-4" data-testid="rented-venues-editor">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="font-bold">{language === 'ar' ? 'الملاعب المستأجرة (اختياري)' : 'Rented Venues (optional)'}</Label>
                      <p className="text-xs text-muted-foreground">
                        {language === 'ar' ? 'يمكن ربط الفرع بملعب مستأجر واحد أو أكثر وجدول أوقات الحجز الأسبوعي.' : 'Optionally link one or more rented venues and their weekly booking times to this branch.'}
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
                      {language === 'ar' ? 'إضافة ملعب مستأجر' : 'Add rented venue'}
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
                </div>}

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

              <div className="space-y-3 rounded-lg border border-emerald-200 p-3 bg-emerald-50/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="font-bold">
                      {language === 'ar' ? 'ربط واتساب الخاص بهذا الفرع' : 'Branch WhatsApp connection'}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {language === 'ar'
                        ? 'اختر Meta Cloud أو WAHA أو Whatsflow لكل فرع بصورة مستقلة. لن يتغير المزود حتى تحفظ الفرع.'
                        : 'Choose Meta Cloud, WAHA, or Whatsflow independently for each branch. The provider changes only after you save.'}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={formData.whatsapp_cloud_enabled}
                      onChange={(e) => setFormData({ ...formData, whatsapp_cloud_enabled: e.target.checked })}
                      className="w-4 h-4 accent-emerald-600"
                    />
                    {language === 'ar' ? 'مفعّل' : 'Enabled'}
                  </label>
                </div>

                 <div className="space-y-2">
                   <Label>{language === 'ar' ? 'مزود واتساب' : 'WhatsApp provider'}</Label>
                   <select
                     value={formData.whatsapp_provider}
                     onChange={e => setFormData({ ...formData, whatsapp_provider: e.target.value })}
                     className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                     data-testid="whatsapp-provider-select"
                   >
                     <option value="meta_cloud">{language === 'ar' ? 'Meta Cloud API' : 'Meta Cloud API'}</option>
                     <option value="waha">{language === 'ar' ? 'WAHA — جلسة واتساب داخلية' : 'WAHA — managed WhatsApp session'}</option>
                      <option value="whatsflow">Whatsflow API</option>
                     <option value="legacy">{language === 'ar' ? 'الاتصال القديم' : 'Legacy connection'}</option>
                     <option value="disabled">{language === 'ar' ? 'معطّل' : 'Disabled'}</option>
                   </select>
                 </div>

                 {formData.whatsapp_provider === 'waha' && (
                   <div className="rounded-md border border-sky-200 bg-sky-50/60 p-3 space-y-3">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                       <div className="space-y-1">
                         <Label>{language === 'ar' ? 'اسم جلسة WAHA' : 'WAHA session name'}</Label>
                         <Input value={formData.whatsapp_waha_session_name} onChange={e => setFormData({ ...formData, whatsapp_waha_session_name: e.target.value })} placeholder="branch-main" dir="ltr" />
                       </div>
                       <div className="space-y-1">
                         <Label>{language === 'ar' ? 'الحد اليومي للرسائل' : 'Daily message limit'}</Label>
                         <Input type="number" min="1" max="1000" value={formData.whatsapp_waha_daily_limit} onChange={e => setFormData({ ...formData, whatsapp_waha_daily_limit: e.target.value })} dir="ltr" />
                       </div>
                     </div>
                     <p className="text-xs text-sky-900">{language === 'ar' ? 'يتطلب WAHA جلسة متصلة قبل الإرسال. مؤشر الجودة داخلي للتشغيل وليس تصنيفاً رسمياً من واتساب.' : 'WAHA requires a connected session before sending. Quality is an internal operating signal, not an official WhatsApp quality rating.'}</p>
                     {editingBranch && (
                       <div className="space-y-3">
                         <div className="flex flex-wrap gap-2">
                           <Button type="button" size="sm" variant="outline" onClick={loadWahaDetails} disabled={!!providerAction}>{language === 'ar' ? 'تحديث الحالة والجودة' : 'Refresh status & quality'}</Button>
                           {['start', 'stop', 'restart', 'logout'].map(action => (
                             <Button key={action} type="button" size="sm" variant="outline" onClick={() => runWahaAction(action)} disabled={!!providerAction}>
                               {language === 'ar' ? ({ start: 'بدء', stop: 'إيقاف', restart: 'إعادة تشغيل', logout: 'تسجيل خروج' }[action]) : action[0].toUpperCase() + action.slice(1)}
                             </Button>
                           ))}
                           <Button type="button" size="sm" variant="outline" onClick={fetchWahaQr} disabled={!!providerAction}>{language === 'ar' ? 'عرض QR' : 'Show QR'}</Button>
                           <Button type="button" size="sm" onClick={handleTestProvider} disabled={!!providerAction}>{language === 'ar' ? 'إرسال اختبار' : 'Send test'}</Button>
                         </div>
                         {providerStatus && <div className="text-sm"><Badge variant={providerStatus.connected ? 'default' : 'secondary'}>{providerStatus.connected ? (language === 'ar' ? 'متصل' : 'Connected') : (language === 'ar' ? 'غير متصل' : 'Not connected')}</Badge><span className="ms-2 text-muted-foreground">{providerStatus.status || providerStatus.session || ''}</span></div>}
                         {providerQuality && (
                           <div className="text-xs text-muted-foreground">
                             {language === 'ar'
                               ? `الجودة الداخلية: ${{ good: 'جيدة', watch: 'تحتاج مراقبة', risk: 'خطر', unknown: 'غير متاحة' }[providerQuality.rating] || 'غير متاحة'} — معدل الفشل ${providerQuality.failure_rate ?? '—'}% — المرسل اليوم ${providerQuality.today_sent ?? 0}`
                               : `Internal quality: ${{ good: 'Good', watch: 'Watch', risk: 'Risk', unknown: 'Unavailable' }[providerQuality.rating] || 'Unavailable'} — failure rate ${providerQuality.failure_rate ?? '—'}% — sent today ${providerQuality.today_sent ?? 0}`}
                             <span className="block mt-1">
                               {language === 'ar' ? 'هذا مؤشر تشغيلي داخل النظام وليس تصنيف واتساب الرسمي.' : 'This is an internal operating signal, not an official WhatsApp rating.'}
                             </span>
                           </div>
                         )}

                         {providerQr && <img src={providerQr} alt="WAHA QR" className="w-48 h-48 rounded-md border bg-white p-2" />}
                       </div>
                     )}
                   </div>
                 )}

                 {formData.whatsapp_provider === 'whatsflow' && (
                   <div className="rounded-md border border-violet-200 bg-violet-50/60 p-3 space-y-3">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                       <div className="space-y-1">
                         <Label>Whatsflow INSTANCE</Label>
                         <Input value={formData.whatsapp_whatsflow_instance} onChange={e => setFormData({ ...formData, whatsapp_whatsflow_instance: e.target.value })} placeholder="branch-main" dir="ltr" />
                       </div>
                       <div className="space-y-1">
                         <Label>{language === 'ar' ? 'مفتاح API' : 'API key'}</Label>
                         <Input type="password" value={formData.whatsapp_whatsflow_api_key} onChange={e => setFormData({ ...formData, whatsapp_whatsflow_api_key: e.target.value })} placeholder={formData.whatsapp_whatsflow_api_key_configured ? '•••••••• (configured)' : ''} dir="ltr" autoComplete="new-password" />
                       </div>
                       <div className="space-y-1">
                         <Label>{language === 'ar' ? 'الحد اليومي للرسائل' : 'Daily message limit'}</Label>
                         <Input type="number" min="1" max="1000" value={formData.whatsapp_waha_daily_limit} onChange={e => setFormData({ ...formData, whatsapp_waha_daily_limit: e.target.value })} dir="ltr" />
                       </div>
                     </div>
                     {editingBranch && (
                       <div className="space-y-3">
                         <div className="flex flex-wrap gap-2">
                           <Button type="button" size="sm" variant="outline" onClick={loadWahaDetails} disabled={!!providerAction}>{language === 'ar' ? 'تحديث الحالة' : 'Refresh status'}</Button>
                           <Button type="button" size="sm" variant="outline" onClick={fetchWahaQr} disabled={!!providerAction}>{language === 'ar' ? 'عرض QR' : 'Show QR'}</Button>
                           <Button type="button" size="sm" onClick={handleTestProvider} disabled={!!providerAction}>{language === 'ar' ? 'إرسال اختبار' : 'Send test'}</Button>
                           <Button type="button" size="sm" variant="outline" onClick={async () => {
                             try { await branchesAPI.configureProviderWebhook(editingBranch.id); toast.success(language === 'ar' ? 'تم إعداد Webhook' : 'Webhook configured'); }
                             catch (error) { toast.error(error.response?.data?.detail || 'Webhook setup failed'); }
                           }}>{language === 'ar' ? 'إعداد Webhook' : 'Configure webhook'}</Button>
                         </div>
                         {providerStatus && <div className="text-sm"><Badge variant={providerStatus.connected ? 'default' : 'secondary'}>{providerStatus.connected ? (language === 'ar' ? 'متصل' : 'Connected') : (language === 'ar' ? 'غير متصل' : 'Not connected')}</Badge><span className="ms-2 text-muted-foreground">{providerStatus.status || ''}</span></div>}
                         {providerQr && <img src={providerQr} alt="Whatsflow QR" className="w-48 h-48 rounded-md border bg-white p-2" />}
                       </div>
                     )}
                   </div>
                 )}

                 {formData.whatsapp_provider === 'meta_cloud' && (
                 <React.Fragment>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Phone Number ID</Label>
                    <Input
                      value={formData.whatsapp_phone_number_id}
                      onChange={(e) => setFormData({ ...formData, whatsapp_phone_number_id: e.target.value })}
                      placeholder="123456789012345"
                      dir="ltr"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>WhatsApp Business Account ID</Label>
                    <Input
                      value={formData.whatsapp_business_account_id}
                      onChange={(e) => setFormData({ ...formData, whatsapp_business_account_id: e.target.value })}
                      placeholder="123456789012345"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_130px] gap-3">
                  <div className="space-y-1">
                    <Label>
                      {language === 'ar' ? 'رمز الوصول الدائم' : 'Permanent Access Token'}
                      {formData.whatsapp_token_configured && (
                        <span className="text-emerald-700 text-xs ms-2">
                          {language === 'ar' ? '✓ محفوظ' : '✓ Saved'}
                        </span>
                      )}
                    </Label>
                    <Input
                      type="password"
                      value={formData.whatsapp_access_token}
                      onChange={(e) => setFormData({ ...formData, whatsapp_access_token: e.target.value })}
                      placeholder={formData.whatsapp_token_configured
                        ? (language === 'ar' ? 'اتركه فارغاً للإبقاء على الرمز المحفوظ' : 'Leave blank to keep saved token')
                        : 'EAAG...'}
                      dir="ltr"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Graph API</Label>
                    <Input
                      value={formData.whatsapp_graph_api_version}
                      onChange={(e) => setFormData({ ...formData, whatsapp_graph_api_version: e.target.value })}
                      placeholder="v23.0"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>
                    Meta App Secret
                    {formData.whatsapp_app_secret_configured && (
                      <span className="text-emerald-700 text-xs ms-2">
                        {language === 'ar' ? '✓ محفوظ' : '✓ Saved'}
                      </span>
                    )}
                  </Label>
                  <Input
                    type="password"
                    value={formData.whatsapp_app_secret}
                    onChange={(e) => setFormData({ ...formData, whatsapp_app_secret: e.target.value })}
                    placeholder={formData.whatsapp_app_secret_configured
                      ? (language === 'ar' ? 'اتركه فارغاً للإبقاء على السر المحفوظ' : 'Leave blank to keep saved secret')
                      : (language === 'ar' ? 'من إعدادات تطبيق Meta' : 'From Meta App settings')}
                    dir="ltr"
                    autoComplete="new-password"
                  />
                  <p className="text-xs text-muted-foreground">
                    {language === 'ar'
                      ? 'يُستخدم للتحقق من توقيع الرسائل الواردة، ويُحفظ مشفراً ولا يظهر بعد الحفظ.'
                      : 'Used to verify inbound webhook signatures. It is encrypted and never returned after saving.'}
                  </p>
                </div>

                <label className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={formData.whatsapp_inbox_enabled}
                    onChange={(e) => setFormData({
                      ...formData,
                      whatsapp_inbox_enabled: e.target.checked
                    })}
                    className="w-4 h-4 mt-0.5 accent-emerald-600"
                  />
                  <span>
                    <span className="font-semibold block">
                      {language === 'ar' ? 'تفعيل استقبال شات واتساب لهذا الفرع' : 'Enable WhatsApp inbox for this branch'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {language === 'ar'
                        ? 'يتطلب App Secret صحيحاً وربط Callback URL وVerify Token داخل Meta.'
                        : 'Requires a valid App Secret and the Callback URL/Verify Token configured in Meta.'}
                    </span>
                  </span>
                </label>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_130px] gap-3">
                  <div className="space-y-1">
                    <Label>{language === 'ar' ? 'اسم قالب Meta المعتمد' : 'Approved Meta template name'}</Label>
                    <Input
                      value={formData.whatsapp_meta_template_name}
                      onChange={(e) => setFormData({ ...formData, whatsapp_meta_template_name: e.target.value })}
                      placeholder="academy_notification"
                      dir="ltr"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{language === 'ar' ? 'لغة القالب' : 'Template language'}</Label>
                    <Input
                      value={formData.whatsapp_meta_template_language}
                      onChange={(e) => setFormData({ ...formData, whatsapp_meta_template_language: e.target.value })}
                      placeholder="ar"
                      dir="ltr"
                    />
                  </div>
                </div>
                <p className="text-xs text-amber-700">
                  {language === 'ar'
                    ? 'لرسائل التجديد التلقائية: أنشئ في Meta قالباً معتمداً يحتوي متغير نص واحد {{1}} وزر Quick Reply ثابت باسم «تواصل معنا»، ثم اكتب اسم القالب هنا.'
                    : 'For renewal reminders, create an approved Meta template with one body variable {{1}} and one static Quick Reply button named “Contact us”, then enter its name here.'}
                </p>
                <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  <input
                    type="checkbox"
                    checked={formData.whatsapp_single_variable_template_confirmed}
                    onChange={(e) => setFormData({
                      ...formData,
                      whatsapp_single_variable_template_confirmed: e.target.checked
                    })}
                    className="w-4 h-4 mt-0.5 accent-emerald-600"
                  />
                  <span>
                    {language === 'ar'
                      ? 'أؤكد أن القالب معتمد في Meta ويحتوي متغيراً واحداً فقط داخل نص الرسالة {{1}}، ولا يتطلب متغيرات في العنوان.'
                      : 'I confirm this Meta-approved template has exactly one body variable {{1}} and requires no header variables.'}
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-900">
                  <input
                    type="checkbox"
                    checked={formData.whatsapp_renewal_contact_button_confirmed}
                    onChange={(e) => setFormData({
                      ...formData,
                      whatsapp_renewal_contact_button_confirmed: e.target.checked
                    })}
                    className="w-4 h-4 mt-0.5 accent-green-600"
                  />
                  <span>
                    {language === 'ar'
                      ? 'تفعيل زر «تواصل معنا» في تذكيرات انتهاء الاشتراك. أؤكد أن أول زر في القالب Quick Reply ثابت بهذا الاسم.'
                      : 'Enable the “Contact us” button on expiry reminders. I confirm the template’s first button is a static Quick Reply button with this label.'}
                  </span>
                </label>

                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-3">
                  <p className="text-sm font-bold text-blue-900">
                    {language === 'ar' ? 'قوالب الصور وPDF للإرسال الجماعي' : 'Image and PDF bulk templates'}
                  </p>
                  <p className="text-xs text-blue-800">
                    {language === 'ar'
                      ? 'أنشئ قالبين معتمدين في Meta: الأول Header نوع IMAGE والثاني Header نوع DOCUMENT، وفي كل قالب متغير نص واحد {{1}} داخل Body.'
                      : 'Create two approved Meta templates: one with an IMAGE header and one with a DOCUMENT header. Each must have one body variable {{1}}.'}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>{language === 'ar' ? 'اسم قالب الصورة' : 'Image template name'}</Label>
                      <Input
                        value={formData.whatsapp_image_template_name}
                        onChange={(e) => setFormData({ ...formData, whatsapp_image_template_name: e.target.value })}
                        placeholder="academy_image"
                        dir="ltr"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{language === 'ar' ? 'اسم قالب PDF' : 'PDF template name'}</Label>
                      <Input
                        value={formData.whatsapp_document_template_name}
                        onChange={(e) => setFormData({ ...formData, whatsapp_document_template_name: e.target.value })}
                        placeholder="academy_document"
                        dir="ltr"
                      />
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-xs text-blue-900">
                    <input
                      type="checkbox"
                      checked={formData.whatsapp_media_templates_confirmed}
                      onChange={(e) => setFormData({
                        ...formData,
                        whatsapp_media_templates_confirmed: e.target.checked
                      })}
                      className="w-4 h-4 mt-0.5 accent-blue-600"
                    />
                    <span>
                      {language === 'ar'
                        ? 'أؤكد أن القالبين معتمدان، وأن نوع Header مطابق، وأن Body يحتوي المتغير {{1}} فقط.'
                        : 'I confirm both templates are approved, their header types match, and the body contains only {{1}}.'}
                    </span>
                  </label>
                </div>

                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-3">
                  <p className="text-sm font-bold text-emerald-900">
                    {language === 'ar' ? 'قالب تنبيه تسجيل الحضور' : 'Attendance check-in template'}
                  </p>
                  <p className="text-xs text-emerald-800">
                    {language === 'ar'
                      ? 'أنشئ في Meta قالباً معتمداً يحتوي متغير نص واحد {{1}} داخل Body، بدون Header أو متغيرات أزرار. سيضع النظام داخله اسم العضو والنشاط والتاريخ والوقت.'
                      : 'Create an approved Meta template with one body variable {{1}}, without header or button variables. The system inserts the member, activity, date, and time.'}
                  </p>
                  <div className="space-y-1">
                    <Label>{language === 'ar' ? 'اسم قالب الحضور' : 'Attendance template name'}</Label>
                    <Input
                      value={formData.whatsapp_attendance_template_name}
                      onChange={(e) => setFormData({
                        ...formData,
                        whatsapp_attendance_template_name: e.target.value
                      })}
                      placeholder="attendance_recorded"
                      dir="ltr"
                    />
                  </div>
                  <label className="flex items-start gap-2 text-xs text-emerald-900">
                    <input
                      type="checkbox"
                      checked={formData.whatsapp_attendance_template_confirmed}
                      onChange={(e) => setFormData({
                        ...formData,
                        whatsapp_attendance_template_confirmed: e.target.checked
                      })}
                      className="w-4 h-4 mt-0.5 accent-emerald-600"
                    />
                    <span>
                      {language === 'ar'
                        ? 'تفعيل إرسال تنبيه واتساب تلقائياً عند تسجيل الحضور لهذا الفرع.'
                        : 'Enable automatic WhatsApp notifications when attendance is recorded for this branch.'}
                    </span>
                  </label>
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-3">
                  <p className="text-sm font-bold text-amber-900">
                    {language === 'ar' ? 'قالب تأكيد دفع الفاتورة' : 'Invoice payment confirmation template'}
                  </p>
                  <p className="text-xs text-amber-800">
                    {language === 'ar'
                      ? 'أنشئ في Meta قالباً معتمداً يحتوي متغير نص واحد {{1}} داخل Body. سيضع النظام داخله اسم العميل ورقم الفاتورة والبنود والخصم والضريبة والإجمالي المدفوع.'
                      : 'Create an approved Meta template with one body variable {{1}}. The system inserts the customer, invoice number, items, discount, VAT, and paid total.'}
                  </p>
                  <div className="space-y-1">
                    <Label>{language === 'ar' ? 'اسم قالب الدفع' : 'Payment template name'}</Label>
                    <Input
                      value={formData.whatsapp_payment_template_name}
                      onChange={(e) => setFormData({
                        ...formData,
                        whatsapp_payment_template_name: e.target.value
                      })}
                      placeholder="invoice_payment_received"
                      dir="ltr"
                    />
                  </div>
                  <label className="flex items-start gap-2 text-xs text-amber-900">
                    <input
                      type="checkbox"
                      checked={formData.whatsapp_payment_template_confirmed}
                      onChange={(e) => setFormData({
                        ...formData,
                        whatsapp_payment_template_confirmed: e.target.checked
                      })}
                      className="w-4 h-4 mt-0.5 accent-amber-600"
                    />
                    <span>
                      {language === 'ar'
                        ? 'تفعيل إرسال تأكيد واتساب تلقائياً عند دفع فاتورة هذا الفرع.'
                        : 'Enable automatic WhatsApp confirmation when an invoice for this branch is paid.'}
                    </span>
                  </label>
                </div>

                <div className="rounded-md border border-violet-200 bg-violet-50 p-3 space-y-3">
                  <p className="text-sm font-bold text-violet-900">
                    {language === 'ar' ? 'قالب تذكير الحصة قبل ساعتين' : 'Two-hour class reminder template'}
                  </p>
                  <p className="text-xs text-violet-800">
                    {language === 'ar'
                      ? 'أنشئ في Meta قالباً معتمداً يحتوي متغير نص واحد {{1}} داخل Body. سيضع النظام داخله اسم اللاعب والنشاط والوقت والفرع، ويرسله قبل الحصة بساعتين.'
                      : 'Create an approved Meta template with one body variable {{1}}. The system inserts the member, activity, time, and branch, then sends it two hours before class.'}
                  </p>
                  <div className="space-y-1">
                    <Label>{language === 'ar' ? 'اسم قالب تذكير الحصة' : 'Class reminder template name'}</Label>
                    <Input
                      value={formData.whatsapp_class_reminder_template_name}
                      onChange={(e) => setFormData({
                        ...formData,
                        whatsapp_class_reminder_template_name: e.target.value
                      })}
                      placeholder="class_reminder_two_hours"
                      dir="ltr"
                    />
                  </div>
                  <label className="flex items-start gap-2 text-xs text-violet-900">
                    <input
                      type="checkbox"
                      checked={formData.whatsapp_class_reminder_template_confirmed}
                      onChange={(e) => setFormData({
                        ...formData,
                        whatsapp_class_reminder_template_confirmed: e.target.checked
                      })}
                      className="w-4 h-4 mt-0.5 accent-violet-600"
                    />
                    <span>
                      {language === 'ar'
                        ? 'تفعيل إرسال تذكير واتساب تلقائياً قبل الحصة بساعتين لهذا الفرع.'
                        : 'Enable automatic WhatsApp reminders two hours before class for this branch.'}
                    </span>
                  </label>
                </div>

                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 space-y-3">
                  <p className="text-sm font-bold text-rose-900">
                    {language === 'ar' ? 'قالب تغيير أو إلغاء الحصص' : 'Class change or cancellation template'}
                  </p>
                  <p className="text-xs text-rose-800">
                    {language === 'ar'
                      ? 'أنشئ في Meta قالباً معتمداً يحتوي متغير نص واحد {{1}} داخل Body. يُرسل عند تغيير موعد عضو أو تطبيق إغلاق على الحصص المتأثرة.'
                      : 'Create an approved Meta template with one body variable {{1}}. It is sent when a member schedule changes or a closure is applied to affected classes.'}
                  </p>
                  <div className="space-y-1">
                    <Label>{language === 'ar' ? 'اسم قالب تغيير/إلغاء الحصة' : 'Schedule update template name'}</Label>
                    <Input
                      value={formData.whatsapp_schedule_update_template_name}
                      onChange={(e) => setFormData({
                        ...formData,
                        whatsapp_schedule_update_template_name: e.target.value
                      })}
                      placeholder="class_schedule_update"
                      dir="ltr"
                    />
                  </div>
                  <label className="flex items-start gap-2 text-xs text-rose-900">
                    <input
                      type="checkbox"
                      checked={formData.whatsapp_schedule_update_template_confirmed}
                      onChange={(e) => setFormData({
                        ...formData,
                        whatsapp_schedule_update_template_confirmed: e.target.checked
                      })}
                      className="w-4 h-4 mt-0.5 accent-rose-600"
                    />
                    <span>
                      {language === 'ar'
                        ? 'تفعيل إشعارات واتساب عند تغيير موعد عضو أو إلغاء/توقف الحصص لهذا الفرع.'
                        : 'Enable WhatsApp notices for member schedule changes and class cancellations in this branch.'}
                    </span>
                  </label>
                </div>

                {webhookInfo && (
                  <div className="space-y-2 rounded-md border bg-white p-3">
                    <p className="text-sm font-bold">
                      {language === 'ar' ? 'إعداد Webhook في Meta' : 'Meta Webhook setup'}
                    </p>
                    <div className="space-y-1">
                      <Label className="text-xs">Callback URL</Label>
                      <div className="flex gap-2">
                        <Input value={webhookInfo.callback_url || ''} readOnly dir="ltr" />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => navigator.clipboard.writeText(webhookInfo.callback_url || '')}
                        >
                          {language === 'ar' ? 'نسخ' : 'Copy'}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Verify Token</Label>
                      <div className="flex gap-2">
                        <Input value={webhookInfo.verify_token || ''} readOnly dir="ltr" />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => navigator.clipboard.writeText(webhookInfo.verify_token || '')}
                        >
                          {language === 'ar' ? 'نسخ' : 'Copy'}
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {language === 'ar'
                        ? 'ضع القيمتين في إعداد Webhooks لتطبيق Meta، ثم اشترك في حدث messages.'
                        : 'Use these values in the Meta App Webhooks settings, then subscribe to messages.'}
                    </p>
                  </div>
                )}

                {editingBranch && formData.whatsapp_token_configured && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleTestWhatsAppCloud}
                    disabled={testingWhatsApp}
                    className="border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                  >
                    {testingWhatsApp && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                    {language === 'ar' ? 'اختبار الإرسال من هذا الفرع' : 'Test this branch sender'}
                  </Button>
                )}
                 </React.Fragment>)}
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
