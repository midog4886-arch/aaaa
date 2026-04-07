import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { notificationsAPI, invoicesAPI, membersAPI, branchesAPI } from '../services/api';
import { toast } from 'sonner';
import {
  RefreshCcw,
  Search,
  Bell,
  AlertTriangle,
  Clock,
  Calendar,
  Phone,
  User,
  Loader2,
  MessageCircle,
  Filter
} from 'lucide-react';

const RenewalsPage = () => {
  const { t, language } = useLanguage();
  const { selectedBranchId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [expiringList, setExpiringList] = useState([]);
  const [expiredList, setExpiredList] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [days, setDays] = useState('7');
  const [activeTab, setActiveTab] = useState('expiring');
  const [filterActivity, setFilterActivity] = useState('all');
  const [branches, setBranches] = useState([]);

  const [isRenewalDialogOpen, setIsRenewalDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [renewalForm, setRenewalForm] = useState({
    start_date: '',
    end_date: '',
    fee: 0,
    notes: '',
    payment_method: 'cash'
  });

  useEffect(() => {
    loadData();
  }, [days, selectedBranchId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = { days: parseInt(days) };
      if (selectedBranchId && selectedBranchId !== 'all') {
        params.branch_filter = selectedBranchId;
      }
      const [res, branchRes] = await Promise.all([
        notificationsAPI.getExpiringSubscriptions(params),
        branchesAPI.getAll()
      ]);
      const allItems = res.data || [];
      setBranches(branchRes.data || []);

      const expiring = allItems.filter(item => item.days_remaining >= 0);
      const expired = allItems.filter(item => item.days_remaining < 0);

      setExpiringList(expiring);
      setExpiredList(expired);
    } catch (error) {
      console.error('Failed to load renewals data:', error);
      toast.error(language === 'ar' ? 'حدث خطأ في تحميل البيانات' : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const groupByBranch = (items) => {
    const groups = {};
    items.forEach(item => {
      const bid = item.branch_id || '__none__';
      if (!groups[bid]) groups[bid] = [];
      groups[bid].push(item);
    });
    return groups;
  };

  const getBranchName = (branchId) => {
    if (!branchId || branchId === '__none__') return language === 'ar' ? 'غير محدد' : 'Unknown Branch';
    const branch = branches.find(b => b.id === branchId);
    return branch ? branch.name : (language === 'ar' ? 'فرع غير معروف' : 'Unknown Branch');
  };

  const getBranchColor = (index) => {
    const colors = [
      'bg-blue-50 border-blue-200 text-blue-800',
      'bg-green-50 border-green-200 text-green-800',
      'bg-purple-50 border-purple-200 text-purple-800',
      'bg-orange-50 border-orange-200 text-orange-800',
      'bg-rose-50 border-rose-200 text-rose-800',
    ];
    return colors[index % colors.length];
  };

  const filterItems = (items) => {
    let filtered = [...items];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(item =>
        (item.member_name || '').toLowerCase().includes(term) ||
        (item.member_code || '').toLowerCase().includes(term) ||
        (item.phone || '').includes(term)
      );
    }
    if (filterActivity !== 'all') {
      filtered = filtered.filter(item => {
        const name = (item.activity_name || '').toLowerCase();
        const filter = filterActivity.toLowerCase();
        if (filter === 'سباحة') return name.includes('سباح') || name.includes('swimming');
        if (filter === 'كرة قدم') return name.includes('كرة') || name.includes('قدم') || name.includes('football');
        if (filter === 'كاراتيه') return name.includes('كارات') || name.includes('karate');
        return name === filter;
      });
    }
    filtered.sort((a, b) => a.days_remaining - b.days_remaining);
    return filtered;
  };

  const ACTIVITY_CATEGORIES = [
    { value: 'كرة قدم', label: '⚽ كرة القدم', icon: '⚽' },
    { value: 'سباحة', label: '🏊 السباحة', icon: '🏊' },
    { value: 'كاراتيه', label: '🥋 كاراتيه', icon: '🥋' },
  ];

  const allActivities = [...new Set([...expiringList, ...expiredList].map(i => i.activity_name).filter(Boolean))];

  const getActivityCategory = (name) => {
    if (!name) return null;
    const n = name.toLowerCase();
    if (n.includes('سباح') || n.includes('swimming')) return 'سباحة';
    if (n.includes('كرة') || n.includes('قدم') || n.includes('football')) return 'كرة قدم';
    if (n.includes('كارات') || n.includes('karate')) return 'كاراتيه';
    return null;
  };

  const uncategorizedActivities = allActivities.filter(a => !getActivityCategory(a));

  const getActivityBreakdown = (items) => {
    const counts = {};
    items.forEach(item => {
      const name = item.activity_name || '---';
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => `${name}: ${count}`).join('، ');
  };

  const getCardBorderColor = (daysRemaining) => {
    if (daysRemaining < 0) return 'border-s-red-500 bg-red-50/30';
    if (daysRemaining <= 1) return 'border-s-red-500 bg-red-50/20';
    if (daysRemaining <= 3) return 'border-s-orange-500 bg-orange-50/20';
    return 'border-s-yellow-500';
  };

  const handleBulkWhatsApp = () => {
    const items = filterItems(activeTab === 'expiring' ? expiringList : expiredList);
    if (items.length === 0) {
      toast.info(language === 'ar' ? 'لا توجد اشتراكات لإرسال تذكير' : 'No subscriptions to remind');
      return;
    }
    const phoneList = [...new Set(items.map(i => i.phone).filter(Boolean))];
    let sent = 0;
    phoneList.forEach((phone, idx) => {
      const memberItems = items.filter(i => i.phone === phone);
      const memberName = memberItems[0]?.member_name || '';
      const activitiesText = memberItems.map(i => i.activity_name).join('، ');
      const msg = `السلام عليكم ${memberName}،\nنود تذكيركم بأن اشتراك (${activitiesText}) في شركة اداء الابطال العالمية للرياضة قارب على الانتهاء.\nنرجو التواصل معنا للتجديد.\nشكراً لكم 🏆`;
      const url = `https://wa.me/966${phone.replace(/^0/, '')}?text=${encodeURIComponent(msg)}`;
      setTimeout(() => window.open(url, '_blank'), idx * 500);
      sent++;
    });
    toast.success(language === 'ar' ? `تم فتح ${sent} محادثة واتساب` : `Opened ${sent} WhatsApp chats`);
  };

  const openRenewalDialog = (item) => {
    const endDate = new Date(item.end_date);
    const newStartDate = new Date(endDate);
    newStartDate.setDate(newStartDate.getDate() + 1);
    const newEndDate = new Date(newStartDate);
    newEndDate.setMonth(newEndDate.getMonth() + 1);

    setSelectedItem(item);
    setRenewalForm({
      start_date: newStartDate.toISOString().split('T')[0],
      end_date: newEndDate.toISOString().split('T')[0],
      fee: item.fee || 0,
      notes: '',
      payment_method: 'cash'
    });
    setIsRenewalDialogOpen(true);
  };

  const handleRenewal = async () => {
    if (!selectedItem) return;
    setSaving(true);

    try {
      const subtotal = parseFloat(renewalForm.fee);
      const vatAmount = Math.round(subtotal * 0.15 * 100) / 100;
      const total = Math.round((subtotal + vatAmount) * 100) / 100;

      const invoiceData = {
        member_id: selectedItem.member_id,
        customer_name_ar: selectedItem.member_name,
        customer_name: selectedItem.member_name,
        customer_phone: selectedItem.phone,
        items: [{
          activity_id: selectedItem.activity_id || '',
          activity_name: selectedItem.activity_name,
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
        notes: renewalForm.notes || `تجديد اشتراك ${selectedItem.activity_name}`
      };

      const invoiceRes = await invoicesAPI.create(invoiceData);

      const newActivityPeriod = {
        activity_id: selectedItem.activity_id || '',
        activity_name: selectedItem.activity_name,
        start_date: renewalForm.start_date,
        end_date: renewalForm.end_date,
        fee: parseFloat(renewalForm.fee),
        status: 'active',
        coach_id: selectedItem.coach_id || '',
        invoice_id: invoiceRes.data?.id,
        renewed_from: selectedItem.end_date
      };

      await membersAPI.addActivity(selectedItem.member_id, newActivityPeriod);

      toast.success(language === 'ar' ? 'تم تجديد الاشتراك بنجاح' : 'Subscription renewed successfully');
      setIsRenewalDialogOpen(false);
      loadData();
    } catch (error) {
      console.error('Failed to renew subscription:', error);
      toast.error(language === 'ar' ? 'حدث خطأ في تجديد الاشتراك' : 'Failed to renew subscription');
    } finally {
      setSaving(false);
    }
  };

  const handleRemind = async () => {
    try {
      const res = await notificationsAPI.checkRenewals();
      if (res.data?.count > 0) {
        toast.success(language === 'ar' ? `تم إرسال ${res.data.count} تذكير` : `${res.data.count} reminders sent`);
      } else {
        toast.info(language === 'ar' ? 'لا توجد اشتراكات تحتاج تذكير' : 'No subscriptions need reminders');
      }
    } catch (error) {
      console.error('Failed to send reminders:', error);
      toast.error(language === 'ar' ? 'حدث خطأ' : 'An error occurred');
    }
  };

  const currentList = activeTab === 'expiring' ? filterItems(expiringList) : activeTab === 'expired' ? filterItems(expiredList) : [];

  const tabs = [
    { key: 'expiring', label: language === 'ar' ? 'تنتهي قريباً' : 'Expiring Soon', count: expiringList.length, breakdown: getActivityBreakdown(expiringList) },
    { key: 'expired', label: language === 'ar' ? 'منتهية' : 'Expired', count: expiredList.length, breakdown: getActivityBreakdown(expiredList) },
    { key: 'frozen', label: language === 'ar' ? 'نقاط مجمدة' : 'Frozen Points', count: 0, breakdown: '' },
  ];

  const stats = [
    { label: language === 'ar' ? 'تنتهي قريباً' : 'Expiring Soon', value: expiringList.length, icon: Clock, color: 'text-orange-500', bg: 'bg-orange-50' },
    { label: language === 'ar' ? 'منتهية' : 'Expired', value: expiredList.length, icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
    { label: language === 'ar' ? 'نقاط مجمدة' : 'Frozen Points', value: 0, icon: RefreshCcw, color: 'text-blue-500', bg: 'bg-blue-50' },
    { label: language === 'ar' ? 'معرضة للإلغاء' : 'Eligible for Cancellation', value: 0, icon: Bell, color: 'text-purple-500', bg: 'bg-purple-50' },
  ];

  return (
    <Layout title={language === 'ar' ? 'إدارة التجديدات' : 'Renewals Management'}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat, idx) => (
            <Card key={idx}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={language === 'ar' ? 'بحث بالاسم أو الجوال أو رمز العضو...' : 'Search by name, phone, or member code...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ps-10"
            />
          </div>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 {language === 'ar' ? 'أيام' : 'days'}</SelectItem>
              <SelectItem value="7">7 {language === 'ar' ? 'أيام' : 'days'}</SelectItem>
              <SelectItem value="14">14 {language === 'ar' ? 'يوم' : 'days'}</SelectItem>
              <SelectItem value="30">30 {language === 'ar' ? 'يوم' : 'days'}</SelectItem>
              <SelectItem value="60">60 {language === 'ar' ? 'يوم' : 'days'}</SelectItem>
              <SelectItem value="90">90 {language === 'ar' ? 'يوم' : 'days'}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterActivity} onValueChange={setFilterActivity}>
            <SelectTrigger className="w-[180px]">
              <Filter className="w-3.5 h-3.5 me-1" />
              <SelectValue placeholder={language === 'ar' ? 'كل الأنشطة' : 'All Activities'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{language === 'ar' ? 'كل الأنشطة' : 'All Activities'}</SelectItem>
              {ACTIVITY_CATEGORIES.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
              {uncategorizedActivities.map(act => (
                <SelectItem key={act} value={act}>{act}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={loadData} variant="outline" size="icon">
            <RefreshCcw className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleBulkWhatsApp}
            variant="outline"
            className="text-green-600 border-green-300 hover:bg-green-50"
          >
            <svg className="w-4 h-4 me-1" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            {language === 'ar' ? 'تذكير جماعي' : 'Bulk Remind'}
          </Button>
        </div>

        <div className="flex gap-2 border-b overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              title={tab.breakdown || ''}
            >
              {tab.label} ({tab.count})
              {tab.breakdown && activeTab === tab.key && (
                <span className="block text-[10px] text-muted-foreground font-normal mt-0.5">{tab.breakdown}</span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : currentList.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>{language === 'ar' ? 'لا توجد اشتراكات' : 'No subscriptions found'}</p>
          </div>
        ) : (!selectedBranchId || selectedBranchId === 'all') && branches.length > 0 ? (
          <div className="space-y-8">
            {Object.entries(groupByBranch(currentList)).map(([branchId, items], groupIdx) => (
              <div key={branchId}>
                <div className={`flex items-center gap-3 mb-4 px-4 py-2.5 rounded-xl border ${getBranchColor(groupIdx)}`}>
                  <div className="w-2 h-2 rounded-full bg-current opacity-60" />
                  <h3 className="font-bold text-base">{getBranchName(branchId)}</h3>
                  <span className="text-sm opacity-70 font-medium">({items.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map((item, idx) => {
                    const isExpired = item.days_remaining < 0;
                    return (
                      <Card key={idx} className={`overflow-hidden border-s-4 ${getCardBorderColor(item.days_remaining)}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                                <User className="w-4 h-4 text-primary" />
                              </div>
                              <div>
                                <p className="font-semibold text-sm">{item.member_name}</p>
                                <p className="text-xs text-muted-foreground">#{item.member_code}</p>
                              </div>
                            </div>
                            <Badge className={isExpired ? 'bg-red-100 text-red-700 border-red-300' : item.days_remaining <= 1 ? 'bg-red-100 text-red-700 border-red-300' : item.days_remaining <= 3 ? 'bg-orange-100 text-orange-700 border-orange-300' : 'bg-yellow-100 text-yellow-700 border-yellow-300'}>
                              {isExpired
                                ? (language === 'ar' ? 'منتهي' : 'Expired')
                                : item.days_remaining <= 1
                                  ? (language === 'ar' ? 'ينتهي اليوم' : 'Expires Today')
                                  : (language === 'ar' ? 'ينتهي قريباً' : 'Expiring')}
                            </Badge>
                          </div>
                          <div className="space-y-1.5 text-sm">
                            {item.phone && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Phone className="w-3.5 h-3.5" />
                                <span>{item.phone}</span>
                                <a href={`https://wa.me/966${item.phone.replace(/^0/, '')}?text=${encodeURIComponent(`السلام عليكم ${item.member_name}،\nنود تذكيركم بأن اشتراك (${item.activity_name}) في شركة اداء الابطال العالمية للرياضة ${isExpired ? 'قد انتهى' : 'قارب على الانتهاء'}.\nنرجو التواصل معنا للتجديد.\nشكراً لكم 🏆`)}`} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:text-green-700 p-0.5 rounded hover:bg-green-50 transition-colors" title={language === 'ar' ? 'واتساب' : 'WhatsApp'}>
                                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                </a>
                              </div>
                            )}
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <RefreshCcw className="w-3.5 h-3.5" />
                              <span>{item.activity_name}</span>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Calendar className="w-3.5 h-3.5" />
                              <span>{item.end_date}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5" />
                              <span className={`font-medium ${isExpired ? 'text-red-600' : item.days_remaining <= 3 ? 'text-orange-600' : 'text-yellow-600'}`}>
                                {isExpired
                                  ? (language === 'ar' ? `منتهي منذ ${Math.abs(item.days_remaining)} يوم` : `Expired ${Math.abs(item.days_remaining)} days ago`)
                                  : (language === 'ar' ? `${item.days_remaining} يوم متبقي` : `${item.days_remaining} days remaining`)}
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2 pt-2">
                            <Button size="sm" className="flex-1 bg-orange-500 hover:bg-orange-600 text-white" onClick={() => openRenewalDialog(item)}>
                              <RefreshCcw className="w-3.5 h-3.5 me-1" />
                              {language === 'ar' ? 'تجديد' : 'Renew'}
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1" onClick={handleRemind}>
                              <Bell className="w-3.5 h-3.5 me-1" />
                              {language === 'ar' ? 'تذكير' : 'Remind'}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {currentList.map((item, idx) => {
              const isExpired = item.days_remaining < 0;
              return (
                <Card key={idx} className={`overflow-hidden border-s-4 ${getCardBorderColor(item.days_remaining)}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{item.member_name}</p>
                          <p className="text-xs text-muted-foreground">#{item.member_code}</p>
                        </div>
                      </div>
                      <Badge className={isExpired ? 'bg-red-100 text-red-700 border-red-300' : item.days_remaining <= 1 ? 'bg-red-100 text-red-700 border-red-300' : item.days_remaining <= 3 ? 'bg-orange-100 text-orange-700 border-orange-300' : 'bg-yellow-100 text-yellow-700 border-yellow-300'}>
                        {isExpired
                          ? (language === 'ar' ? 'منتهي' : 'Expired')
                          : item.days_remaining <= 1
                            ? (language === 'ar' ? 'ينتهي اليوم' : 'Expires Today')
                            : (language === 'ar' ? 'ينتهي قريباً' : 'Expiring')}
                      </Badge>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      {item.phone && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="w-3.5 h-3.5" />
                          <span>{item.phone}</span>
                          <a href={`https://wa.me/966${item.phone.replace(/^0/, '')}?text=${encodeURIComponent(`السلام عليكم ${item.member_name}،\nنود تذكيركم بأن اشتراك (${item.activity_name}) في شركة اداء الابطال العالمية للرياضة ${isExpired ? 'قد انتهى' : 'قارب على الانتهاء'}.\nنرجو التواصل معنا للتجديد.\nشكراً لكم 🏆`)}`} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:text-green-700 p-0.5 rounded hover:bg-green-50 transition-colors" title={language === 'ar' ? 'واتساب' : 'WhatsApp'}>
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                          </a>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <RefreshCcw className="w-3.5 h-3.5" />
                        <span>{item.activity_name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{item.end_date}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5" />
                        <span className={`font-medium ${isExpired ? 'text-red-600' : item.days_remaining <= 3 ? 'text-orange-600' : 'text-yellow-600'}`}>
                          {isExpired
                            ? (language === 'ar' ? `منتهي منذ ${Math.abs(item.days_remaining)} يوم` : `Expired ${Math.abs(item.days_remaining)} days ago`)
                            : (language === 'ar' ? `${item.days_remaining} يوم متبقي` : `${item.days_remaining} days remaining`)}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" className="flex-1 bg-orange-500 hover:bg-orange-600 text-white" onClick={() => openRenewalDialog(item)}>
                        <RefreshCcw className="w-3.5 h-3.5 me-1" />
                        {language === 'ar' ? 'تجديد' : 'Renew'}
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={handleRemind}>
                        <Bell className="w-3.5 h-3.5 me-1" />
                        {language === 'ar' ? 'تذكير' : 'Remind'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={isRenewalDialogOpen} onOpenChange={setIsRenewalDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {language === 'ar' ? 'تجديد الاشتراك' : 'Renew Subscription'}
            </DialogTitle>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                <p><strong>{language === 'ar' ? 'العضو:' : 'Member:'}</strong> {selectedItem.member_name}</p>
                <p><strong>{language === 'ar' ? 'النشاط:' : 'Activity:'}</strong> {selectedItem.activity_name}</p>
                <p><strong>{language === 'ar' ? 'تاريخ الانتهاء:' : 'End Date:'}</strong> {selectedItem.end_date}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    {language === 'ar' ? 'تاريخ البداية' : 'Start Date'}
                  </label>
                  <Input
                    type="date"
                    value={renewalForm.start_date}
                    onChange={(e) => setRenewalForm({ ...renewalForm, start_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    {language === 'ar' ? 'تاريخ النهاية' : 'End Date'}
                  </label>
                  <Input
                    type="date"
                    value={renewalForm.end_date}
                    onChange={(e) => setRenewalForm({ ...renewalForm, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">
                  {language === 'ar' ? 'الرسوم' : 'Fee'} ({language === 'ar' ? 'ر.س' : 'SAR'})
                </label>
                <Input
                  type="number"
                  value={renewalForm.fee}
                  onChange={(e) => setRenewalForm({ ...renewalForm, fee: e.target.value })}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">
                  {language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}
                </label>
                <Select
                  value={renewalForm.payment_method}
                  onValueChange={(val) => setRenewalForm({ ...renewalForm, payment_method: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{language === 'ar' ? 'نقداً' : 'Cash'}</SelectItem>
                    <SelectItem value="card">{language === 'ar' ? 'بطاقة' : 'Card'}</SelectItem>
                    <SelectItem value="transfer">{language === 'ar' ? 'تحويل' : 'Transfer'}</SelectItem>
                    <SelectItem value="tabby">Tabby</SelectItem>
                    <SelectItem value="tamara">Tamara</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">
                  {language === 'ar' ? 'ملاحظات' : 'Notes'}
                </label>
                <Textarea
                  value={renewalForm.notes}
                  onChange={(e) => setRenewalForm({ ...renewalForm, notes: e.target.value })}
                  placeholder={language === 'ar' ? 'ملاحظات إضافية...' : 'Additional notes...'}
                  rows={2}
                />
              </div>

              {renewalForm.fee > 0 && (
                <div className="p-3 bg-green-50 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>{language === 'ar' ? 'المبلغ:' : 'Subtotal:'}</span>
                    <span>{parseFloat(renewalForm.fee).toFixed(2)} {language === 'ar' ? 'ر.س' : 'SAR'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{language === 'ar' ? 'الضريبة (15%):' : 'VAT (15%):'}</span>
                    <span>{(parseFloat(renewalForm.fee) * 0.15).toFixed(2)} {language === 'ar' ? 'ر.س' : 'SAR'}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-1">
                    <span>{language === 'ar' ? 'الإجمالي:' : 'Total:'}</span>
                    <span>{(parseFloat(renewalForm.fee) * 1.15).toFixed(2)} {language === 'ar' ? 'ر.س' : 'SAR'}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsRenewalDialogOpen(false)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button
              onClick={handleRenewal}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {language === 'ar' ? 'تأكيد التجديد' : 'Confirm Renewal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default RenewalsPage;
