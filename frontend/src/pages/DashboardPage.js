import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
// eslint-disable-next-line react-hooks/exhaustive-deps
import { dashboardAPI, reportsAPI, membersAPI, activitiesAPI, invoicesAPI, discountsAPI } from '../services/api';
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
  ClipboardList
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export const DashboardPage = () => {
  const { t, language } = useLanguage();
  const { selectedBranchId } = useAuth();
  const [stats, setStats] = useState(null);
  const [expiring, setExpiring] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Detail view states
  const [activeDetail, setActiveDetail] = useState(null); // 'members', 'subscriptions', 'revenue', 'expiring', 'coupons'
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  const loadData = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const [statsRes, expiringRes, discountsRes] = await Promise.all([
        dashboardAPI.getStats(branchParams),
        reportsAPI.getExpiringSubscriptions(7, selectedBranchId),
        discountsAPI.getAll(branchParams)
      ]);
      setStats(statsRes.data);
      setExpiring(expiringRes.data);
      setDiscounts(discountsRes.data);
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
    if (activeDetail === type) {
      setActiveDetail(null);
      setDetailData(null);
      return;
    }
    
    setActiveDetail(type);
    setDetailLoading(true);
    
    try {
      let data = null;
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
          const revenueRes = await reportsAPI.getFinancial();
          data = revenueRes.data;
          break;
        case 'expiring':
          data = expiring;
          break;
        case 'coupons':
          data = discounts;
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
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card 
            className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'members' ? 'ring-2 ring-primary' : ''}`} 
            data-testid="stat-members"
            onClick={() => toggleDetail('members')}
          >
            <div className="stat-card-icon bg-primary/10">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <div className="stat-card-value text-primary">
              {stats?.members_count || 0}
            </div>
            <div className="stat-card-label">{t('total_members')}</div>
            <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details'}</div>
          </Card>

          <Card 
            className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'subscriptions' ? 'ring-2 ring-green-500' : ''}`} 
            data-testid="stat-subscriptions"
            onClick={() => toggleDetail('subscriptions')}
          >
            <div className="stat-card-icon bg-green-500/10">
              <Activity className="w-6 h-6 text-green-500" />
            </div>
            <div className="stat-card-value text-green-500">
              {stats?.active_subscriptions || 0}
            </div>
            <div className="stat-card-label">{t('active_subscriptions')}</div>
            <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details'}</div>
          </Card>

          <Card 
            className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'revenue' ? 'ring-2 ring-blue-500' : ''}`} 
            data-testid="stat-revenue"
            onClick={() => toggleDetail('revenue')}
          >
            <div className="stat-card-icon bg-blue-500/10">
              <Banknote className="w-6 h-6 text-blue-500" />
            </div>
            <div className="stat-card-value text-blue-500">
              {formatCurrency(stats?.month_revenue)}
            </div>
            <div className="stat-card-label">{t('monthly_revenue')}</div>
            <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details'}</div>
          </Card>

          <Card 
            className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'expiring' ? 'ring-2 ring-amber-500' : ''}`} 
            data-testid="stat-expiring"
            onClick={() => toggleDetail('expiring')}
          >
            <div className="stat-card-icon bg-amber-500/10">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
            </div>
            <div className="stat-card-value text-amber-500">
              {stats?.expiring_count || 0}
            </div>
            <div className="stat-card-label">{t('expiring_soon')}</div>
            <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details'}</div>
          </Card>

          <Card 
            className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'coupons' ? 'ring-2 ring-purple-500' : ''}`} 
            data-testid="stat-coupons"
            onClick={() => toggleDetail('coupons')}
          >
            <div className="stat-card-icon bg-purple-500/10">
              <Tag className="w-6 h-6 text-purple-500" />
            </div>
            <div className="stat-card-value text-purple-500">
              {discounts.filter(d => d.is_active).length}
            </div>
            <div className="stat-card-label">{language === 'ar' ? 'كوبونات الخصم' : 'Discount Coupons'}</div>
            <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click for details'}</div>
          </Card>

          <Card 
            className={`stat-card hover-scale cursor-pointer transition-all ${activeDetail === 'pendingForms' ? 'ring-2 ring-teal-500' : ''}`} 
            data-testid="stat-pending-forms"
            onClick={() => toggleDetail('pendingForms')}
          >
            <div className="stat-card-icon bg-teal-500/10">
              <ClipboardList className="w-6 h-6 text-teal-500" />
            </div>
            <div className="stat-card-value text-teal-500">
              {formatCurrency(stats?.pending_forms_total)}
            </div>
            <div className="stat-card-label">{language === 'ar' ? 'استمارات غير مفوترة' : 'Pending Forms'}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats?.pending_forms_count || 0} {language === 'ar' ? 'استمارة' : 'forms'}
            </div>
          </Card>
        </div>

        {/* Detail Sections */}
        {activeDetail && (
          <Card className={`animate-in slide-in-from-top-2 ${
            activeDetail === 'members' ? 'border-primary/30 bg-primary/5' :
            activeDetail === 'subscriptions' ? 'border-green-500/30 bg-green-50/30' :
            activeDetail === 'revenue' ? 'border-blue-500/30 bg-blue-50/30' :
            activeDetail === 'coupons' ? 'border-purple-500/30 bg-purple-50/30' :
            'border-amber-500/30 bg-amber-50/30'
          }`}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className={`flex items-center gap-2 ${
                activeDetail === 'members' ? 'text-primary' :
                activeDetail === 'subscriptions' ? 'text-green-600' :
                activeDetail === 'revenue' ? 'text-blue-600' :
                activeDetail === 'coupons' ? 'text-purple-600' :
                'text-amber-600'
              }`}>
                {activeDetail === 'members' && <><Users className="w-5 h-5" />{language === 'ar' ? 'تفاصيل الأعضاء' : 'Members Details'}</>}
                {activeDetail === 'subscriptions' && <><Activity className="w-5 h-5" />{language === 'ar' ? 'تفاصيل الاشتراكات' : 'Subscriptions Details'}</>}
                {activeDetail === 'revenue' && <><Banknote className="w-5 h-5" />{language === 'ar' ? 'تفاصيل الإيرادات' : 'Revenue Details'}</>}
                {activeDetail === 'expiring' && <><AlertTriangle className="w-5 h-5" />{language === 'ar' ? 'الاشتراكات المنتهية قريباً' : 'Expiring Subscriptions'}</>}
                {activeDetail === 'coupons' && <><Tag className="w-5 h-5" />{language === 'ar' ? 'كوبونات الخصم' : 'Discount Coupons'}</>}
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
        )}

        {/* Charts and Lists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Members by Activity Chart */}
          <Card data-testid="chart-activities">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                {t('members_by_activity')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats?.members_by_activity?.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={stats.members_by_activity}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={5}
                      dataKey="count"
                      nameKey="name"
                      label={({ name, count }) => `${name}: ${count}`}
                    >
                      {stats.members_by_activity.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={activityColors[entry.name] || '#64748b'} 
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">
                  <Activity className="empty-state-icon" />
                  <p>{t('no_data')}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Expiring Subscriptions */}
          <Card data-testid="expiring-subscriptions">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  {t('expiring_subscriptions')}
                </span>
                {expiring.length > 0 && (
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={sendAllReminders}
                    className="text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
                    data-testid="send-all-reminders-btn"
                  >
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
                    <div 
                      key={index}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg animate-slide-in"
                      style={{ animationDelay: `${index * 0.05}s` }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.member_name}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{item.activity_name}</span>
                          <span>•</span>
                          <div className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            <span dir="ltr">{item.phone}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => sendWhatsAppReminder(item)}
                          className="p-2 rounded-full hover:bg-green-500/10 text-green-600 transition-colors"
                          title={language === 'ar' ? 'إرسال تنبيه واتساب' : 'Send WhatsApp reminder'}
                          data-testid={`send-reminder-${index}`}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                        <Badge 
                          variant="outline" 
                          className={`${item.days_remaining <= 3 ? 'bg-red-500/10 text-red-500 border-red-500/30' : 'bg-amber-500/10 text-amber-500 border-amber-500/30'}`}
                        >
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

        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4 text-center">
            <div className="text-2xl font-bold text-primary">{stats?.activities_count || 0}</div>
            <div className="text-sm text-muted-foreground">{t('activities')}</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-2xl font-bold text-green-500">{stats?.coaches_count || 0}</div>
            <div className="text-sm text-muted-foreground">{t('coaches')}</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-500">4</div>
            <div className="text-sm text-muted-foreground">{t('activities')}</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-2xl font-bold text-purple-500">
              {formatCurrency(stats?.month_revenue || 0)}
            </div>
            <div className="text-sm text-muted-foreground">{t('monthly_revenue')}</div>
          </Card>
        </div>
      </div>
    </Layout>
  );
};

export default DashboardPage;
