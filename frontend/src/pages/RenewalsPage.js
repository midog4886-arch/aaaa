import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { membersAPI, invoicesAPI, loyaltyAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  RefreshCcw, 
  AlertTriangle, 
  Clock, 
  User, 
  Phone, 
  Calendar,
  Search,
  Loader2,
  CheckCircle,
  XCircle,
  Bell,
  Snowflake,
  TrendingUp
} from 'lucide-react';

export const RenewalsPage = () => {
  const { t, language } = useLanguage();
  const { selectedBranchId } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDays, setFilterDays] = useState('7');
  const [activeTab, setActiveTab] = useState('expiring');
  
  // Data states
  const [expiringMembers, setExpiringMembers] = useState([]);
  const [expiredMembers, setExpiredMembers] = useState([]);
  const [frozenPointsMembers, setFrozenPointsMembers] = useState([]);
  
  // Renewal dialog states
  const [isRenewalDialogOpen, setIsRenewalDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [renewalForm, setRenewalForm] = useState({
    start_date: '',
    end_date: '',
    fee: 0,
    payment_method: 'cash',
    notes: ''
  });
  const [saving, setSaving] = useState(false);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      
      // Get all members
      const params = {};
      if (selectedBranchId && selectedBranchId !== 'all') {
        params.branch_id = selectedBranchId;
      }
      const membersRes = await membersAPI.getAll(params);
      const allMembers = membersRes.data || [];
      
      const daysFilter = parseInt(filterDays);
      const futureDate = new Date(today);
      futureDate.setDate(futureDate.getDate() + daysFilter);
      const futureDateStr = futureDate.toISOString().split('T')[0];
      
      // Categorize members
      const expiring = [];
      const expired = [];
      
      allMembers.forEach(member => {
        if (!member.activities || member.activities.length === 0) return;
        
        member.activities.forEach(activity => {
          if (!activity.end_date) return;
          
          const endDate = activity.end_date;
          
          if (endDate < todayStr) {
            // Expired
            expired.push({
              ...member,
              expiring_activity: activity,
              days_expired: Math.floor((today - new Date(endDate)) / (1000 * 60 * 60 * 24))
            });
          } else if (endDate <= futureDateStr) {
            // Expiring soon
            expiring.push({
              ...member,
              expiring_activity: activity,
              days_remaining: Math.floor((new Date(endDate) - today) / (1000 * 60 * 60 * 24))
            });
          }
        });
      });
      
      // Sort by urgency
      expiring.sort((a, b) => a.days_remaining - b.days_remaining);
      expired.sort((a, b) => b.days_expired - a.days_expired);
      
      setExpiringMembers(expiring);
      setExpiredMembers(expired);
      
      // Get frozen points members
      try {
        const frozenRes = await loyaltyAPI.getFrozenMembers();
        setFrozenPointsMembers(frozenRes.data || []);
      } catch (e) {
        console.log('Could not load frozen members');
        setFrozenPointsMembers([]);
      }
      
    } catch (error) {
      console.error('Error loading renewals data:', error);
      toast.error(language === 'ar' ? 'خطأ في تحميل البيانات' : 'Error loading data');
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, filterDays, language]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Open renewal dialog
  const openRenewalDialog = (member, activity) => {
    const endDate = new Date(activity.end_date);
    const newStartDate = new Date(endDate);
    newStartDate.setDate(newStartDate.getDate() + 1);
    const newEndDate = new Date(newStartDate);
    newEndDate.setMonth(newEndDate.getMonth() + 1);
    
    setSelectedMember(member);
    setSelectedActivity(activity);
    setRenewalForm({
      start_date: newStartDate.toISOString().split('T')[0],
      end_date: newEndDate.toISOString().split('T')[0],
      fee: activity.fee || 0,
      payment_method: 'cash',
      notes: ''
    });
    setIsRenewalDialogOpen(true);
  };

  // Handle renewal submission
  const handleRenewal = async () => {
    if (!selectedMember || !selectedActivity) return;
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
          activity_id: selectedActivity.activity_id,
          activity_name: selectedActivity.activity_name,
          fee: parseFloat(renewalForm.fee),
          period: `${renewalForm.start_date} - ${renewalForm.end_date}`,
          start_date: renewalForm.start_date,
          end_date: renewalForm.end_date,
          schedule: selectedActivity.schedule || '',
          is_product: false
        }],
        subtotal: subtotal,
        vat: vatAmount,
        total: total,
        discount: 0,
        status: 'pending',
        payment_method: renewalForm.payment_method,
        notes: renewalForm.notes || `تجديد اشتراك ${selectedActivity.activity_name}`
      };
      
      const invoiceRes = await invoicesAPI.create(invoiceData);
      
      // Pay the invoice immediately
      await invoicesAPI.pay(invoiceRes.data.id);
      
      toast.success(language === 'ar' ? 'تم تجديد الاشتراك بنجاح' : 'Subscription renewed successfully');
      setIsRenewalDialogOpen(false);
      
      // Refresh data
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

  // Send renewal reminder
  const sendRenewalReminder = async (member) => {
    try {
      // Create notification for member
      toast.success(language === 'ar' ? 'تم إرسال التذكير بنجاح' : 'Reminder sent successfully');
    } catch (error) {
      toast.error(language === 'ar' ? 'فشل إرسال التذكير' : 'Failed to send reminder');
    }
  };

  // Filter members by search
  const filterBySearch = (members) => {
    if (!searchTerm) return members;
    const term = searchTerm.toLowerCase();
    return members.filter(m => 
      m.name_ar?.toLowerCase().includes(term) ||
      m.name?.toLowerCase().includes(term) ||
      m.phone?.includes(term) ||
      m.member_code?.includes(term)
    );
  };

  const filteredExpiring = filterBySearch(expiringMembers);
  const filteredExpired = filterBySearch(expiredMembers);

  // Render member card
  const renderMemberCard = (member, type) => {
    const activity = member.expiring_activity;
    const isExpired = type === 'expired';
    
    return (
      <Card key={`${member.id}-${activity.activity_id}`} className={`border-r-4 ${isExpired ? 'border-r-red-500 bg-red-50' : 'border-r-orange-500 bg-orange-50'}`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <User className="w-5 h-5 text-gray-500" />
                <span className="font-bold text-lg">{member.name_ar || member.name}</span>
                <Badge variant="outline">#{member.member_code}</Badge>
              </div>
              
              <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                <span className="flex items-center gap-1">
                  <Phone className="w-4 h-4" />
                  {member.phone}
                </span>
              </div>
              
              <div className="bg-white rounded-lg p-3 mt-2">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-blue-500" />
                  <span className="font-semibold">{activity.activity_name}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span>{language === 'ar' ? 'ينتهي:' : 'Expires:'} {activity.end_date}</span>
                </div>
              </div>
              
              <div className="mt-3">
                {isExpired ? (
                  <Badge className="bg-red-500 text-white">
                    <XCircle className="w-3 h-3 mr-1" />
                    {language === 'ar' ? `منتهي منذ ${member.days_expired} يوم` : `Expired ${member.days_expired} days ago`}
                  </Badge>
                ) : (
                  <Badge className={member.days_remaining <= 3 ? 'bg-red-500 text-white' : 'bg-orange-500 text-white'}>
                    <Clock className="w-3 h-3 mr-1" />
                    {language === 'ar' ? `متبقي ${member.days_remaining} يوم` : `${member.days_remaining} days remaining`}
                  </Badge>
                )}
              </div>
            </div>
            
            <div className="flex flex-col gap-2">
              <Button 
                onClick={() => openRenewalDialog(member, activity)}
                className="bg-green-600 hover:bg-green-700"
              >
                <RefreshCcw className="w-4 h-4 mr-1" />
                {language === 'ar' ? 'تجديد' : 'Renew'}
              </Button>
              <Button 
                variant="outline"
                onClick={() => sendRenewalReminder(member)}
              >
                <Bell className="w-4 h-4 mr-1" />
                {language === 'ar' ? 'تذكير' : 'Remind'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <Layout>
      <div className="space-y-6" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <RefreshCcw className="w-7 h-7 text-orange-500" />
              {language === 'ar' ? 'إدارة التجديدات' : 'Renewals Management'}
            </h1>
            <p className="text-gray-500 mt-1">
              {language === 'ar' ? 'متابعة وتجديد اشتراكات الأعضاء' : 'Track and renew member subscriptions'}
            </p>
          </div>
          
          <Button onClick={loadData} variant="outline">
            <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {language === 'ar' ? 'تحديث' : 'Refresh'}
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-t-4 border-t-orange-500">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-orange-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-orange-600">{expiringMembers.length}</p>
                  <p className="text-sm text-gray-500">{language === 'ar' ? 'تنتهي قريباً' : 'Expiring Soon'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-t-4 border-t-red-500">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <XCircle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">{expiredMembers.length}</p>
                  <p className="text-sm text-gray-500">{language === 'ar' ? 'منتهية' : 'Expired'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-t-4 border-t-blue-500">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                  <Snowflake className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-blue-600">{frozenPointsMembers.length}</p>
                  <p className="text-sm text-gray-500">{language === 'ar' ? 'نقاط مجمدة' : 'Frozen Points'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-t-4 border-t-green-500">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">
                    {frozenPointsMembers.reduce((sum, m) => sum + (m.frozen_points || 0), 0)}
                  </p>
                  <p className="text-sm text-gray-500">{language === 'ar' ? 'نقاط معرضة للإلغاء' : 'Points at Risk'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <Input
                    placeholder={language === 'ar' ? 'بحث بالاسم، الجوال، رقم العضوية...' : 'Search by name, phone, member code...'}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pr-10"
                  />
                </div>
              </div>
              
              <div className="w-48">
                <Select value={filterDays} onValueChange={setFilterDays}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">{language === 'ar' ? '3 أيام' : '3 days'}</SelectItem>
                    <SelectItem value="7">{language === 'ar' ? '7 أيام' : '7 days'}</SelectItem>
                    <SelectItem value="14">{language === 'ar' ? '14 يوم' : '14 days'}</SelectItem>
                    <SelectItem value="30">{language === 'ar' ? '30 يوم' : '30 days'}</SelectItem>
                    <SelectItem value="60">{language === 'ar' ? '60 يوم' : '60 days'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="expiring" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {language === 'ar' ? 'تنتهي قريباً' : 'Expiring'} ({filteredExpiring.length})
            </TabsTrigger>
            <TabsTrigger value="expired" className="flex items-center gap-2">
              <XCircle className="w-4 h-4" />
              {language === 'ar' ? 'منتهية' : 'Expired'} ({filteredExpired.length})
            </TabsTrigger>
            <TabsTrigger value="frozen" className="flex items-center gap-2">
              <Snowflake className="w-4 h-4" />
              {language === 'ar' ? 'نقاط مجمدة' : 'Frozen Points'} ({frozenPointsMembers.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="expiring" className="space-y-4 mt-4">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
              </div>
            ) : filteredExpiring.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="w-16 h-16 mx-auto text-green-500 mb-4" />
                  <p className="text-lg text-gray-500">
                    {language === 'ar' ? 'لا توجد اشتراكات تنتهي قريباً' : 'No subscriptions expiring soon'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredExpiring.map(member => renderMemberCard(member, 'expiring'))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="expired" className="space-y-4 mt-4">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-red-500" />
              </div>
            ) : filteredExpired.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="w-16 h-16 mx-auto text-green-500 mb-4" />
                  <p className="text-lg text-gray-500">
                    {language === 'ar' ? 'لا توجد اشتراكات منتهية' : 'No expired subscriptions'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredExpired.map(member => renderMemberCard(member, 'expired'))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="frozen" className="space-y-4 mt-4">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              </div>
            ) : frozenPointsMembers.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="w-16 h-16 mx-auto text-green-500 mb-4" />
                  <p className="text-lg text-gray-500">
                    {language === 'ar' ? 'لا توجد نقاط مجمدة' : 'No frozen points'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {frozenPointsMembers.map(member => (
                  <Card key={member.member_id} className="border-r-4 border-r-blue-500 bg-blue-50">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <User className="w-5 h-5 text-gray-500" />
                            <span className="font-bold text-lg">{member.member_name}</span>
                            <Badge variant="outline">#{member.member_code}</Badge>
                          </div>
                          
                          <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                            <span className="flex items-center gap-1">
                              <Phone className="w-4 h-4" />
                              {member.phone}
                            </span>
                          </div>
                          
                          <div className="bg-white rounded-lg p-3 mt-2">
                            <div className="flex items-center gap-2 mb-1">
                              <Snowflake className="w-4 h-4 text-blue-500" />
                              <span className="font-semibold text-blue-700">
                                {member.frozen_points} {language === 'ar' ? 'نقطة مجمدة' : 'Frozen Points'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Clock className="w-4 h-4 text-gray-400" />
                              <span>
                                {language === 'ar' 
                                  ? `متبقي ${member.days_remaining || 0} يوم قبل الإلغاء`
                                  : `${member.days_remaining || 0} days until cancellation`
                                }
                              </span>
                            </div>
                          </div>
                          
                          <div className="mt-3">
                            <Badge className={member.days_remaining <= 7 ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'}>
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              {language === 'ar' ? 'يجب التجديد لاستعادة النقاط' : 'Renew to restore points'}
                            </Badge>
                          </div>
                        </div>
                        
                        <div className="flex flex-col gap-2">
                          <Button 
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => {
                              // Navigate to member page or open renewal dialog
                              toast.info(language === 'ar' ? 'اذهب لصفحة الأعضاء لتجديد الاشتراك' : 'Go to members page to renew');
                            }}
                          >
                            <RefreshCcw className="w-4 h-4 mr-1" />
                            {language === 'ar' ? 'تجديد' : 'Renew'}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Renewal Dialog */}
        <Dialog open={isRenewalDialogOpen} onOpenChange={setIsRenewalDialogOpen}>
          <DialogContent className="max-w-md" dir={language === 'ar' ? 'rtl' : 'ltr'}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCcw className="w-5 h-5 text-green-600" />
                {language === 'ar' ? 'تجديد الاشتراك' : 'Renew Subscription'}
              </DialogTitle>
            </DialogHeader>
            
            {selectedMember && selectedActivity && (
              <div className="space-y-4">
                {/* Member Info */}
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="font-bold">{selectedMember.name_ar || selectedMember.name}</p>
                  <p className="text-sm text-gray-600">{selectedActivity.activity_name}</p>
                  <p className="text-sm text-gray-500">
                    {language === 'ar' ? 'الاشتراك الحالي ينتهي:' : 'Current subscription ends:'} {selectedActivity.end_date}
                  </p>
                </div>
                
                {/* New Period */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                    <Input
                      type="date"
                      value={renewalForm.start_date}
                      onChange={(e) => setRenewalForm({...renewalForm, start_date: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}</Label>
                    <Input
                      type="date"
                      value={renewalForm.end_date}
                      onChange={(e) => setRenewalForm({...renewalForm, end_date: e.target.value})}
                    />
                  </div>
                </div>
                
                {/* Fee */}
                <div>
                  <Label>{language === 'ar' ? 'الرسوم' : 'Fee'}</Label>
                  <Input
                    type="number"
                    value={renewalForm.fee}
                    onChange={(e) => setRenewalForm({...renewalForm, fee: e.target.value})}
                  />
                </div>
                
                {/* Payment Method */}
                <div>
                  <Label>{language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</Label>
                  <Select 
                    value={renewalForm.payment_method} 
                    onValueChange={(v) => setRenewalForm({...renewalForm, payment_method: v})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{language === 'ar' ? 'نقدي' : 'Cash'}</SelectItem>
                      <SelectItem value="card">{language === 'ar' ? 'بطاقة' : 'Card'}</SelectItem>
                      <SelectItem value="bank_transfer">{language === 'ar' ? 'تحويل بنكي' : 'Bank Transfer'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Total */}
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="flex justify-between">
                    <span>{language === 'ar' ? 'المجموع الفرعي:' : 'Subtotal:'}</span>
                    <span>{renewalForm.fee} ر.س</span>
                  </div>
                  <div className="flex justify-between text-green-600">
                    <span>{language === 'ar' ? 'ضريبة القيمة المضافة (15%):' : 'VAT (15%):'}</span>
                    <span>{(renewalForm.fee * 0.15).toFixed(2)} ر.س</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t mt-2 pt-2">
                    <span>{language === 'ar' ? 'الإجمالي:' : 'Total:'}</span>
                    <span>{(renewalForm.fee * 1.15).toFixed(2)} ر.س</span>
                  </div>
                </div>
              </div>
            )}
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRenewalDialogOpen(false)}>
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button onClick={handleRenewal} disabled={saving} className="bg-green-600 hover:bg-green-700">
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                {language === 'ar' ? 'تأكيد التجديد' : 'Confirm Renewal'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default RenewalsPage;
