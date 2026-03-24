import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
// eslint-disable-next-line react-hooks/exhaustive-deps
import { dashboardAPI, reportsAPI, membersAPI, activitiesAPI, invoicesAPI, discountsAPI, activityNotesAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  Users, 
  Activity, 
  Banknote, 
  AlertTriangle,
  TrendingUp,
  Calendar,
  Phone,
  MessageSquare,
  Bell,
  Send,
  X,
  Receipt,
  RefreshCcw,
  Tag,
  ClipboardList,
  StickyNote,
  ExternalLink,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Settings2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  EyeIcon
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const DEFAULT_WIDGETS = [
  { id: 'stats', visible: true },
  { id: 'details', visible: true },
  { id: 'expiring', visible: true },
  { id: 'notes', visible: true },
];

const WIDGET_LABELS = {
  stats: { ar: 'بطاقات الإحصائيات', en: 'Statistics Cards' },
  details: { ar: 'عرض التفاصيل', en: 'Detail View' },
  expiring: { ar: 'الاشتراكات المنتهية', en: 'Expiring Subscriptions' },
  notes: { ar: 'آخر الملاحظات', en: 'Recent Notes' },
};

export const DashboardPage = () => {
  const { t, language } = useLanguage();
  const { selectedBranchId } = useAuth();
  const [stats, setStats] = useState(null);
  const [expiring, setExpiring] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [recentNotes, setRecentNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [statsUnlocked, setStatsUnlocked] = useState(false);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const STATS_PASSWORD = '242456';

  const [widgets, setWidgets] = useState(DEFAULT_WIDGETS);
  const [showCustomize, setShowCustomize] = useState(false);

  // Detail view states
  const [activeDetail, setActiveDetail] = useState(null); // 'members', 'subscriptions', 'revenue', 'expiring', 'coupons'
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    loadDashboardSettings();
  }, []);

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  const loadDashboardSettings = async () => {
    try {
      const res = await dashboardAPI.getSettings();
      if (res.data?.widgets?.length > 0) {
        setWidgets(res.data.widgets);
      }
    } catch (err) {
      console.error('Failed to load dashboard settings:', err);
    }
  };

  const saveDashboardSettings = async (newWidgets) => {
    setWidgets(newWidgets);
    try {
      await dashboardAPI.saveSettings({ widgets: newWidgets });
    } catch (err) {
      console.error('Failed to save dashboard settings:', err);
    }
  };

  const toggleWidgetVisibility = (widgetId) => {
    const updated = widgets.map(w => w.id === widgetId ? { ...w, visible: !w.visible } : w);
    saveDashboardSettings(updated);
  };

  const moveWidget = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= widgets.length) return;
    const updated = [...widgets];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    saveDashboardSettings(updated);
  };

  const isWidgetVisible = (widgetId) => {
    const w = widgets.find(w => w.id === widgetId);
    return w ? w.visible : true;
  };

  const loadData = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const [statsRes, expiringRes, discountsRes, notesRes] = await Promise.all([
        dashboardAPI.getStats(branchParams),
        reportsAPI.getExpiringSubscriptions(7, selectedBranchId),
        discountsAPI.getAll(branchParams),
        activityNotesAPI.getRecent(5)
      ]);
      setStats(statsRes.data);
      setExpiring(expiringRes.data);
      setDiscounts(discountsRes.data);
      setRecentNotes(notesRes.data || []);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return `${amount?.toLocaleString() || 0} ${t('sar')}`;
  };
  
  const toggleDetail = async (type) => {
    if (!statsUnlocked) {
      setShowPasswordInput(true);
      return;
    }
    if (activeDetail === type) {
      setActiveDetail(null);
      setDetailData(null);
      return;
    }
    
    setActiveDetail(type);
    setDetailLoading(true);
    
    try {
      let data = null;
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      switch (type) {
        case 'members':
          const membersRes = await membersAPI.getAll();
          data = membersRes.data;
          break;
        case 'subscriptions':
          const activitiesRes = await activitiesAPI.getAll();
          data = activitiesRes.data;
          break;
        case 'revenue':
          const now = new Date();
          const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
          const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          const monthEndStr = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;
          const revenueRes = await reportsAPI.getFinancial({ start_date: monthStart, end_date: monthEndStr, ...branchParams });
          data = revenueRes.data;
          break;
        case 'expiring':
          data = expiring;
          break;
        case 'coupons':
          data = discounts;
          break;
        case 'pendingForms':
          const { registrationFormsAPI } = await import('../services/api');
          const formsRes = await registrationFormsAPI.getAll(branchParams);
          data = formsRes.data.filter(f => f.status === 'pending');
          break;
        default:
          break;
      }
      setDetailData(data);
    } catch (error) {
      console.error('Failed to load detail:', error);
      toast.error(language === 'ar' ? 'خطأ في تحميل البيانات' : 'Failed to load data');
    } finally {
      setDetailLoading(false);
    }
  };

  const sendWhatsAppReminder = (member) => {
    const phone = member.phone?.replace(/^0/, '966') || '';
    if (!phone) {
      toast.error(language === 'ar' ? 'لا يوجد رقم جوال' : 'No phone number');
      return;
    }
    const message = `مرحباً ${member.member_name}،\n\nنود تذكيركم بأن اشتراككم في نشاط "${member.activity_name}" سينتهي خلال ${member.days_remaining} أيام.\n\nنأمل منكم تجديد الاشتراك في أقرب وقت للاستمرار في الاستفادة من خدماتنا.\n\nشكراً لكم،\nشركة اداء الابطال العالمية للرياضة`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
    toast.success(language === 'ar' ? 'تم فتح واتساب' : 'WhatsApp opened');
  };

  const sendAllReminders = () => {
    if (expiring.length === 0) {
      toast.error(language === 'ar' ? 'لا توجد اشتراكات منتهية' : 'No expiring subscriptions');
      return;
    }
    expiring.forEach((member, index) => {
      setTimeout(() => {
        sendWhatsAppReminder(member);
      }, index * 1000);
    });
    toast.success(language === 'ar' ? `جاري إرسال ${expiring.length} تنبيهات` : `Sending ${expiring.length} reminders`);
  };

  const handlePasswordSubmit = () => {
    if (passwordInput === STATS_PASSWORD) {
      setStatsUnlocked(true);
      setShowPasswordInput(false);
      setPasswordInput('');
      toast.success(language === 'ar' ? 'تم فتح الإحصائيات' : 'Statistics unlocked');
    } else {
      toast.error(language === 'ar' ? 'كلمة السر غير صحيحة' : 'Incorrect password');
      setPasswordInput('');
    }
  };

  const handleLockStats = () => {
    setStatsUnlocked(false);
    setActiveDetail(null);
    setDetailData(null);
  };

  const hiddenValue = '••••';

  const activityColors = {
    'السباحة': '#0EA5E9',
    'Swimming': '#0EA5E9',
    'كرة القدم': '#22C55E',
    'Football': '#22C55E',
    'الكاراتيه': '#EF4444',
    'Karate': '#EF4444',
    'الجمباز': '#8B5CF6',
    'Gymnastics': '#8B5CF6',
  };

  if (loading) {
    return (
      <Layout title={t('dashboard')}>
        <div className="flex items-center justify-center h-64">
          <div className="spinner" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('dashboard')}>
      <div className="space-y-6 animate-fade-in" data-testid="dashboard-page">
        {/* Dashboard Controls */}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCustomize(!showCustomize)}
            className="gap-2"
          >
            <Settings2 className="w-4 h-4" />
            {language === 'ar' ? 'تخصيص' : 'Customize'}
          </Button>
          <div className="flex items-center gap-2">
          {!statsUnlocked ? (
            showPasswordInput ? (
              <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-2 shadow-sm">
                <Lock className="w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                  placeholder={language === 'ar' ? 'أدخل كلمة السر' : 'Enter password'}
                  className="border rounded px-2 py-1 text-sm w-36 outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                />
                <Button size="sm" onClick={handlePasswordSubmit}>
                  {language === 'ar' ? 'دخول' : 'Unlock'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowPasswordInput(false); setPasswordInput(''); }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowPasswordInput(true)} className="gap-2">
                <Eye className="w-4 h-4" />
                {language === 'ar' ? 'عرض الأرقام' : 'Show Numbers'}
              </Button>
            )
          ) : (
            <Button variant="outline" size="sm" onClick={handleLockStats} className="gap-2">
              <EyeOff className="w-4 h-4" />
              {language === 'ar' ? 'إخفاء الأرقام' : 'Hide Numbers'}
            </Button>
          )}
          </div>
        </div>

        {/* Customization Panel */}
        {showCustomize && (
          <Card className="border-dashed border-2 border-primary/30 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                {language === 'ar' ? 'تخصيص لوحة التحكم' : 'Customize Dashboard'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {widgets.map((widget, index) => (
                  <div key={widget.id} className="flex items-center gap-3 p-2 bg-white rounded-lg border">
                    <GripVertical className="w-4 h-4 text-muted-foreground" />
                    <span className="flex-1 text-sm font-medium">
                      {WIDGET_LABELS[widget.id]?.[language] || widget.id}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => moveWidget(index, -1)}
                        disabled={index === 0}
                        className="h-7 w-7 p-0"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => moveWidget(index, 1)}
                        disabled={index === widgets.length - 1}
                        className="h-7 w-7 p-0"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                      <Button
                        variant={widget.visible ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleWidgetVisibility(widget.id)}
                        className="h-7 px-2 text-xs"
                      >
                        {widget.visible ? (
                          <>{language === 'ar' ? 'ظاهر' : 'Visible'}</>
                        ) : (
                          <>{language === 'ar' ? 'مخفي' : 'Hidden'}</>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {language === 'ar' ? 'استخدم الأسهم لتغيير الترتيب، والزر لإظهار/إخفاء العناصر. التغييرات تُحفظ تلقائياً.' : 'Use arrows to reorder, button to show/hide. Changes save automatically.'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Stats Grid */}
        {/* Render widgets in saved order */}
        {widgets.filter(w => w.visible).map((widget) => {
          if (widget.id === 'stats') return (
            <div key="stats" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'members' ? 'ring-2 ring-primary' : ''}`} data-testid="stat-members" onClick={() => toggleDetail('members')}>
                <div className="stat-card-icon bg-primary/10"><Users className="w-6 h-6 text-primary" /></div>
                <div className="stat-card-value text-primary">{statsUnlocked ? (stats?.members_count || 0) : hiddenValue}</div>
                <div className="stat-card-label">{t('total_members')}</div>
                <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details'}</div>
              </Card>
              <Card className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'subscriptions' ? 'ring-2 ring-green-500' : ''}`} data-testid="stat-subscriptions" onClick={() => toggleDetail('subscriptions')}>
                <div className="stat-card-icon bg-green-500/10"><Activity className="w-6 h-6 text-green-500" /></div>
                <div className="stat-card-value text-green-500">{statsUnlocked ? (stats?.active_subscriptions || 0) : hiddenValue}</div>
                <div className="stat-card-label">{t('active_subscriptions')}</div>
                <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details'}</div>
              </Card>
              <Card className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'revenue' ? 'ring-2 ring-blue-500' : ''}`} data-testid="stat-revenue" onClick={() => toggleDetail('revenue')}>
                <div className="stat-card-icon bg-blue-500/10"><Banknote className="w-6 h-6 text-blue-500" /></div>
                <div className="stat-card-value text-blue-500">{statsUnlocked ? formatCurrency(stats?.month_revenue) : hiddenValue}</div>
                <div className="stat-card-label">{t('monthly_revenue')}</div>
                <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details'}</div>
              </Card>
              <Card className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'expiring' ? 'ring-2 ring-amber-500' : ''}`} data-testid="stat-expiring" onClick={() => toggleDetail('expiring')}>
                <div className="stat-card-icon bg-amber-500/10"><AlertTriangle className="w-6 h-6 text-amber-500" /></div>
                <div className="stat-card-value text-amber-500">{statsUnlocked ? (stats?.expiring_count || 0) : hiddenValue}</div>
                <div className="stat-card-label">{t('expiring_soon')}</div>
                <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details'}</div>
              </Card>
              <Card className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'coupons' ? 'ring-2 ring-purple-500' : ''}`} data-testid="stat-coupons" onClick={() => toggleDetail('coupons')}>
                <div className="stat-card-icon bg-purple-500/10"><Tag className="w-6 h-6 text-purple-500" /></div>
                <div className="stat-card-value text-purple-500">{statsUnlocked ? discounts.filter(d => d.is_active).length : hiddenValue}</div>
                <div className="stat-card-label">{language === 'ar' ? 'كوبونات الخصم' : 'Discount Coupons'}</div>
                <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details'}</div>
              </Card>
              <Card className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'pendingForms' ? 'ring-2 ring-teal-500' : ''}`} data-testid="stat-pending-forms" onClick={() => toggleDetail('pendingForms')}>
                <div className="stat-card-icon bg-teal-500/10"><ClipboardList className="w-6 h-6 text-teal-500" /></div>
                <div className="stat-card-value text-teal-500">{statsUnlocked ? formatCurrency(stats?.pending_forms_total) : hiddenValue}</div>
                <div className="stat-card-label">{language === 'ar' ? 'استمارات غير مفوترة' : 'Pending Forms'}</div>
                <div className="text-xs text-muted-foreground mt-1">{statsUnlocked ? `${stats?.pending_forms_count || 0} ${language === 'ar' ? 'استمارة' : 'forms'}` : ''}</div>
              </Card>
            </div>
          );

          if (widget.id === 'details' && activeDetail) return (
          <Card key="details" className={`animate-in slide-in-from-top-2 ${
            activeDetail === 'members' ? 'border-primary/30 bg-primary/5' :
            activeDetail === 'subscriptions' ? 'border-green-500/30 bg-green-50/30' :
            activeDetail === 'revenue' ? 'border-blue-500/30 bg-blue-50/30' :
            activeDetail === 'coupons' ? 'border-purple-500/30 bg-purple-50/30' :
            activeDetail === 'pendingForms' ? 'border-teal-500/30 bg-teal-50/30' :
            'border-amber-500/30 bg-amber-50/30'
          }`}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className={`flex items-center gap-2 ${
                activeDetail === 'members' ? 'text-primary' :
                activeDetail === 'subscriptions' ? 'text-green-600' :
                activeDetail === 'revenue' ? 'text-blue-600' :
                activeDetail === 'coupons' ? 'text-purple-600' :
                activeDetail === 'pendingForms' ? 'text-teal-600' :
                'text-amber-600'
              }`}>
                {activeDetail === 'members' && <><Users className="w-5 h-5" />{language === 'ar' ? 'تفاصيل الأعضاء' : 'Members Details'}</>}
                {activeDetail === 'subscriptions' && <><Activity className="w-5 h-5" />{language === 'ar' ? 'تفاصيل الاشتراكات' : 'Subscriptions Details'}</>}
                {activeDetail === 'revenue' && <><Banknote className="w-5 h-5" />{language === 'ar' ? `تفاصيل إيرادات ${new Date().toLocaleString('ar-SA', { month: 'long', year: 'numeric' })}` : `Revenue Details - ${new Date().toLocaleString('en', { month: 'long', year: 'numeric' })}`}</>}
                {activeDetail === 'expiring' && <><AlertTriangle className="w-5 h-5" />{language === 'ar' ? 'الاشتراكات المنتهية قريباً' : 'Expiring Subscriptions'}</>}
                {activeDetail === 'coupons' && <><Tag className="w-5 h-5" />{language === 'ar' ? 'كوبونات الخصم' : 'Discount Coupons'}</>}
                {activeDetail === 'pendingForms' && <><ClipboardList className="w-5 h-5" />{language === 'ar' ? 'استمارات التسجيل الغير مفوترة' : 'Pending Registration Forms'}</>}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => { setActiveDetail(null); setDetailData(null); }}>
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {detailLoading ? (
                <div className="flex items-center justify-center py-8"><div className="spinner" /></div>
              ) : (
                <>
                  {/* Pending Forms Detail */}
                  {activeDetail === 'pendingForms' && detailData && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div className="p-3 bg-white rounded-lg border">
                          <div className="text-xl font-bold text-teal-600">{detailData.length}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'عدد الاستمارات' : 'Forms Count'}</div>
                        </div>
                        <div className="p-3 bg-white rounded-lg border">
                          <div className="text-xl font-bold text-teal-600">{formatCurrency(detailData.reduce((sum, f) => sum + (f.total || 0), 0))}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'الإجمالي' : 'Total'}</div>
                        </div>
                      </div>
                      <div className="overflow-x-auto max-h-[300px]">
                        <table className="data-table w-full">
                          <thead className="sticky top-0 bg-white">
                            <tr>
                              <th>{language === 'ar' ? 'رقم الاستمارة' : 'Form #'}</th>
                              <th>{language === 'ar' ? 'العميل' : 'Customer'}</th>
                              <th>{t('phone')}</th>
                              <th>{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                              <th>{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailData.slice(0, 15).map((form, idx) => (
                              <tr key={idx}>
                                <td className="font-mono text-sm">{form.form_number}</td>
                                <td className="font-medium">{form.customer_name}</td>
                                <td dir="ltr">{form.customer_phone}</td>
                                <td className="font-bold text-teal-600">{form.total?.toFixed(2)} {t('sar')}</td>
                                <td className="text-sm">{new Date(form.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {detailData.length > 15 && <p className="text-center text-sm text-muted-foreground mt-2">{language === 'ar' ? `وغيرهم ${detailData.length - 15}...` : `and ${detailData.length - 15} more...`}</p>}
                      </div>
                      {detailData.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          {language === 'ar' ? 'لا توجد استمارات غير مفوترة' : 'No pending forms'}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Members Detail */}
                  {activeDetail === 'members' && detailData && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-3 bg-white rounded-lg border">
                          <div className="text-xl font-bold text-primary">{detailData.length}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'إجمالي الأعضاء' : 'Total Members'}</div>
                        </div>
                        <div className="p-3 bg-white rounded-lg border">
                          <div className="text-xl font-bold text-green-600">{detailData.filter(m => m.activities?.some(a => a.status === 'active')).length}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'أعضاء نشطين' : 'Active'}</div>
                        </div>
                      </div>
                      <div className="overflow-x-auto max-h-[300px]">
                        <table className="data-table w-full">
                          <thead className="sticky top-0 bg-white">
                            <tr><th>{language === 'ar' ? 'الاسم' : 'Name'}</th><th>{t('phone')}</th><th>{language === 'ar' ? 'ولي الأمر' : 'Guardian'}</th><th>{language === 'ar' ? 'الأنشطة' : 'Activities'}</th></tr>
                          </thead>
                          <tbody>
                            {detailData.slice(0, 15).map((member, idx) => (
                              <tr key={idx}>
                                <td className="font-medium">{member.name_ar || member.name}</td>
                                <td dir="ltr">{member.phone}</td>
                                <td>{member.guardian_name_ar || member.guardian_name}</td>
                                <td><Badge variant="outline">{member.activities?.length || 0}</Badge></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {detailData.length > 15 && <p className="text-center text-sm text-muted-foreground mt-2">{language === 'ar' ? `وغيرهم ${detailData.length - 15}...` : `and ${detailData.length - 15} more...`}</p>}
                      </div>
                    </div>
                  )}

                  {/* Subscriptions Detail */}
                  {activeDetail === 'subscriptions' && detailData && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {detailData.map((activity, idx) => (
                          <div key={idx} className="p-3 bg-white rounded-lg border">
                            <div className="text-lg font-bold" style={{color: activityColors[activity.name_ar] || '#64748b'}}>{activity.name_ar || activity.name}</div>
                            <div className="text-xs text-muted-foreground">{formatCurrency(activity.monthly_fee)} / {language === 'ar' ? 'شهرياً' : 'month'}</div>
                          </div>
                        ))}
                      </div>
                      <div className="p-4 bg-white rounded-lg border">
                        <div className="text-2xl font-bold text-green-600">{stats?.active_subscriptions || 0}</div>
                        <div className="text-sm text-muted-foreground">{language === 'ar' ? 'إجمالي الاشتراكات النشطة' : 'Total Active Subscriptions'}</div>
                      </div>
                    </div>
                  )}

                  {/* Revenue Detail */}
                  {activeDetail === 'revenue' && detailData && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 bg-white rounded-lg border border-blue-200">
                          <div className="text-2xl font-bold text-blue-600">{formatCurrency(detailData.total_revenue)}</div>
                          <div className="text-sm text-muted-foreground">{language === 'ar' ? 'إجمالي الإيرادات' : 'Total Revenue'}</div>
                        </div>
                        <div className="p-4 bg-white rounded-lg border border-purple-200">
                          <div className="text-2xl font-bold text-purple-600">{formatCurrency(detailData.total_refunds)}</div>
                          <div className="text-sm text-muted-foreground">{language === 'ar' ? 'إجمالي المسترجع' : 'Total Refunds'}</div>
                        </div>
                        <div className="p-4 bg-white rounded-lg border border-green-200">
                          <div className="text-2xl font-bold text-green-600">{formatCurrency(detailData.net_revenue)}</div>
                          <div className="text-sm text-muted-foreground">{language === 'ar' ? 'صافي الإيرادات' : 'Net Revenue'}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-white rounded-lg border">
                          <div className="text-xl font-bold text-blue-600">{detailData.invoice_count || 0}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'فواتير مدفوعة' : 'Paid Invoices'}</div>
                        </div>
                        <div className="p-3 bg-white rounded-lg border">
                          <div className="text-xl font-bold text-purple-600">{detailData.refund_count || 0}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'عمليات استرجاع' : 'Refunds'}</div>
                        </div>
                      </div>
                      {detailData.revenue_by_activity?.length > 0 && (
                        <div>
                          <h4 className="font-semibold mb-2">{language === 'ar' ? 'الإيرادات حسب النشاط:' : 'Revenue by Activity:'}</h4>
                          <div className="overflow-x-auto">
                            <table className="data-table w-full">
                              <thead><tr className="bg-blue-50"><th>{language === 'ar' ? 'النشاط' : 'Activity'}</th><th>{language === 'ar' ? 'العدد' : 'Count'}</th><th>{language === 'ar' ? 'الإيرادات' : 'Revenue'}</th></tr></thead>
                              <tbody>
                                {detailData.revenue_by_activity.map((act, idx) => (
                                  <tr key={idx}><td>{act.name}</td><td>{act.count}</td><td className="font-bold text-blue-600">{act.total} {t('sar')}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Expiring Detail */}
                  {activeDetail === 'expiring' && detailData && (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <div className="p-3 bg-white rounded-lg border border-amber-200">
                          <div className="text-2xl font-bold text-amber-600">{detailData.length}</div>
                          <div className="text-sm text-muted-foreground">{language === 'ar' ? 'اشتراكات تنتهي خلال 7 أيام' : 'Expiring in 7 days'}</div>
                        </div>
                        {detailData.length > 0 && (
                          <Button onClick={sendAllReminders} className="bg-amber-500 hover:bg-amber-600">
                            <Send className="w-4 h-4 me-2" />
                            {language === 'ar' ? 'إرسال تنبيهات للجميع' : 'Send All Reminders'}
                          </Button>
                        )}
                      </div>
                      {detailData.length > 0 ? (
                        <div className="overflow-x-auto max-h-[300px]">
                          <table className="data-table w-full">
                            <thead className="sticky top-0 bg-white">
                              <tr className="bg-amber-50">
                                <th>{language === 'ar' ? 'العضو' : 'Member'}</th>
                                <th>{language === 'ar' ? 'النشاط' : 'Activity'}</th>
                                <th>{t('phone')}</th>
                                <th>{language === 'ar' ? 'الأيام المتبقية' : 'Days Left'}</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {detailData.map((item, idx) => (
                                <tr key={idx}>
                                  <td className="font-medium">{item.member_name}</td>
                                  <td>{item.activity_name}</td>
                                  <td dir="ltr">{item.phone}</td>
                                  <td>
                                    <Badge variant="outline" className={item.days_remaining <= 3 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}>
                                      {item.days_remaining} {language === 'ar' ? 'يوم' : 'days'}
                                    </Badge>
                                  </td>
                                  <td>
                                    <Button size="sm" variant="ghost" onClick={() => sendWhatsAppReminder(item)} className="text-green-600">
                                      <MessageSquare className="w-4 h-4" />
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">{language === 'ar' ? 'لا توجد اشتراكات منتهية قريباً' : 'No expiring subscriptions'}</div>
                      )}
                    </div>
                  )}

                  {/* Coupons Detail */}
                  {activeDetail === 'coupons' && detailData && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div className="p-3 bg-white rounded-lg border">
                          <div className="text-xl font-bold text-purple-600">{detailData.length}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'إجمالي الكوبونات' : 'Total Coupons'}</div>
                        </div>
                        <div className="p-3 bg-white rounded-lg border">
                          <div className="text-xl font-bold text-green-600">{detailData.filter(d => d.is_active).length}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'نشطة' : 'Active'}</div>
                        </div>
                        <div className="p-3 bg-white rounded-lg border">
                          <div className="text-xl font-bold text-blue-600">{detailData.reduce((sum, d) => sum + (d.used_count || 0), 0)}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'مرات الاستخدام' : 'Total Uses'}</div>
                        </div>
                      </div>
                      {detailData.length > 0 ? (
                        <div className="overflow-x-auto max-h-[300px]">
                          <table className="data-table w-full">
                            <thead className="sticky top-0 bg-white">
                              <tr className="bg-purple-50">
                                <th>{language === 'ar' ? 'الكود' : 'Code'}</th>
                                <th>{language === 'ar' ? 'الاسم' : 'Name'}</th>
                                <th>{language === 'ar' ? 'قيمة الخصم' : 'Discount'}</th>
                                <th>{language === 'ar' ? 'الاستخدام' : 'Usage'}</th>
                                <th>{language === 'ar' ? 'الحالة' : 'Status'}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detailData.map((coupon, idx) => (
                                <tr key={idx}>
                                  <td className="font-mono font-bold text-purple-700">{coupon.code}</td>
                                  <td>{coupon.name_ar || coupon.name}</td>
                                  <td className="font-semibold">{coupon.value} {t('sar')}</td>
                                  <td>
                                    <span className="text-sm">
                                      {coupon.used_count || 0} / {coupon.max_uses === 0 ? '∞' : coupon.max_uses}
                                    </span>
                                  </td>
                                  <td>
                                    <Badge variant="outline" className={coupon.is_active ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}>
                                      {coupon.is_active ? (language === 'ar' ? 'نشط' : 'Active') : (language === 'ar' ? 'غير نشط' : 'Inactive')}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">{language === 'ar' ? 'لا توجد كوبونات' : 'No coupons'}</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          );

          if (widget.id === 'expiring') return (
          <div key="expiring" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card data-testid="expiring-subscriptions">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    {t('expiring_subscriptions')}
                  </span>
                  {expiring.length > 0 && (
                    <Button size="sm" variant="outline" onClick={sendAllReminders} className="text-amber-600 border-amber-500/30 hover:bg-amber-500/10" data-testid="send-all-reminders-btn">
                      <Send className="w-4 h-4 me-1" />
                      {language === 'ar' ? 'إرسال تنبيهات' : 'Send All'}
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {expiring.length > 0 ? (
                  <div className="space-y-3 max-h-[250px] overflow-y-auto">
                    {expiring.slice(0, 5).map((item, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg animate-slide-in" style={{ animationDelay: `${index * 0.05}s` }}>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{item.member_name}</p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{item.activity_name}</span>
                            <span>-</span>
                            <div className="flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              <span dir="ltr">{item.phone}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => sendWhatsAppReminder(item)} className="p-2 rounded-full hover:bg-green-500/10 text-green-600 transition-colors" title={language === 'ar' ? 'إرسال تنبيه واتساب' : 'Send WhatsApp reminder'} data-testid={`send-reminder-${index}`}>
                            <MessageSquare className="w-4 h-4" />
                          </button>
                          <Badge variant="outline" className={`${item.days_remaining <= 3 ? 'bg-red-500/10 text-red-500 border-red-500/30' : 'bg-amber-500/10 text-amber-500 border-amber-500/30'}`}>
                            <Calendar className="w-3 h-3 me-1" />
                            {item.days_remaining} {t('days')}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Bell className="empty-state-icon" />
                    <p>{language === 'ar' ? 'لا توجد اشتراكات تنتهي قريباً' : 'No expiring subscriptions'}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          );

          if (widget.id === 'notes') return (
          <Card key="notes" data-testid="recent-notes">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <StickyNote className="w-5 h-5 text-orange-500" />
                  {language === 'ar' ? 'آخر الملاحظات' : 'Recent Notes'}
                </span>
                <Button size="sm" variant="outline" onClick={() => window.location.href = '/schedule'} className="text-orange-600 border-orange-500/30 hover:bg-orange-500/10">
                  <ExternalLink className="w-4 h-4 me-1" />
                  {language === 'ar' ? 'عرض الجدول' : 'View Schedule'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentNotes.length > 0 ? (
                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                  {recentNotes.map((note, index) => (
                    <div key={note.id} className="p-3 bg-orange-50 border border-orange-200 rounded-lg animate-slide-in" style={{ animationDelay: `${index * 0.05}s` }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-800 whitespace-pre-wrap text-sm">{note.note_text}</p>
                          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                            <Badge variant="outline" className="bg-orange-100 border-orange-300">{note.activity_name}</Badge>
                            <span>-</span>
                            <Calendar className="w-3 h-3" />
                            <span>{note.date}</span>
                            {note.created_by_name && (<><span>-</span><span>{note.created_by_name}</span></>)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <StickyNote className="empty-state-icon" />
                  <p>{language === 'ar' ? 'لا توجد ملاحظات' : 'No notes yet'}</p>
                </div>
              )}
            </CardContent>
          </Card>
          );

          return null;
        })}

      </div>
    </Layout>
  );
};

export default DashboardPage;
