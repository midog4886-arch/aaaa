import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import { useToast } from '../hooks/use-toast';
import { 
  Trophy, Gift, Users, Star, Settings, Plus, Pencil, Trash2,
  TrendingUp, Award, Crown, Medal, Target, Percent, Package,
  Clock, CheckCircle, XCircle, Search, RefreshCw, Coins, Cake
} from 'lucide-react';
import api from '../services/api';

const LoyaltyPage = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [processingBirthdays, setProcessingBirthdays] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [pointsSettings, setPointsSettings] = useState(null);
  const [levelSettings, setLevelSettings] = useState(null);
  const [members, setMembers] = useState([]);
  
  // Dialogs
  const [rewardDialogOpen, setRewardDialogOpen] = useState(false);
  const [editingReward, setEditingReward] = useState(null);
  const [adjustPointsDialogOpen, setAdjustPointsDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  
  // Form data
  const [rewardForm, setRewardForm] = useState({
    name_ar: '', name_en: '', description_ar: '', description_en: '',
    points_required: 100, reward_type: 'discount', discount_percentage: 5,
    quantity_available: -1, is_active: true, image_url: ''
  });
  const [adjustForm, setAdjustForm] = useState({ points: 0, reason: '', admin_notes: '' });
  const [memberSearch, setMemberSearch] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [statsRes, rewardsRes, redemptionsRes, leaderboardRes, pointsRes, levelsRes] = await Promise.all([
        api.get('/api/loyalty/stats'),
        api.get('/api/loyalty/rewards'),
        api.get('/api/loyalty/redemptions?limit=50'),
        api.get('/api/loyalty/leaderboard?limit=10'),
        api.get('/api/loyalty/settings/points'),
        api.get('/api/loyalty/settings/levels')
      ]);
      
      setStats(statsRes.data);
      setRewards(rewardsRes.data);
      setRedemptions(redemptionsRes.data);
      setLeaderboard(leaderboardRes.data);
      setPointsSettings(pointsRes.data);
      setLevelSettings(levelsRes.data);
    } catch (error) {
      console.error('Error fetching loyalty data:', error);
      toast({ title: 'خطأ في تحميل البيانات', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const searchMembers = async (query) => {
    if (!query || query.length < 2) {
      setMembers([]);
      return;
    }
    try {
      const response = await api.get(`/api/members/search?q=${encodeURIComponent(query)}&limit=10`);
      setMembers(response.data);
    } catch (error) {
      console.error('Error searching members:', error);
    }
  };

  const handleSaveReward = async () => {
    try {
      if (editingReward) {
        await api.put(`/api/loyalty/rewards/${editingReward.id}`, rewardForm);
        toast({ title: 'تم تحديث المكافأة بنجاح' });
      } else {
        await api.post('/api/loyalty/rewards', rewardForm);
        toast({ title: 'تم إنشاء المكافأة بنجاح' });
      }
      setRewardDialogOpen(false);
      setEditingReward(null);
      fetchData();
    } catch (error) {
      toast({ title: 'خطأ في حفظ المكافأة', variant: 'destructive' });
    }
  };

  const handleDeleteReward = async (rewardId) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه المكافأة؟')) return;
    try {
      await api.delete(`/api/loyalty/rewards/${rewardId}`);
      toast({ title: 'تم حذف المكافأة' });
      fetchData();
    } catch (error) {
      toast({ title: 'خطأ في حذف المكافأة', variant: 'destructive' });
    }
  };

  const handleAdjustPoints = async () => {
    if (!selectedMember) return;
    try {
      await api.post('/api/loyalty/members/adjust', {
        member_id: selectedMember.id,
        points: parseInt(adjustForm.points),
        reason: adjustForm.reason,
        admin_notes: adjustForm.admin_notes
      });
      toast({ title: 'تم تعديل النقاط بنجاح' });
      setAdjustPointsDialogOpen(false);
      setSelectedMember(null);
      setAdjustForm({ points: 0, reason: '', admin_notes: '' });
      fetchData();
    } catch (error) {
      toast({ title: 'خطأ في تعديل النقاط', variant: 'destructive' });
    }
  };

  const handleUpdateRedemptionStatus = async (redemptionId, status) => {
    try {
      await api.put(`/api/loyalty/redemptions/${redemptionId}/status`, { status });
      toast({ title: 'تم تحديث حالة الطلب' });
      fetchData();
    } catch (error) {
      toast({ title: 'خطأ في تحديث الحالة', variant: 'destructive' });
    }
  };

  const handleSaveSettings = async () => {
    try {
      await Promise.all([
        api.put('/api/loyalty/settings/points', pointsSettings),
        api.put('/api/loyalty/settings/levels', levelSettings)
      ]);
      toast({ title: 'تم حفظ الإعدادات بنجاح' });
      setSettingsDialogOpen(false);
    } catch (error) {
      toast({ title: 'خطأ في حفظ الإعدادات', variant: 'destructive' });
    }
  };

  const handleProcessBirthdays = async () => {
    try {
      setProcessingBirthdays(true);
      const response = await api.post('/api/loyalty/process-birthdays');
      toast({ 
        title: response.data.message,
        description: `تم معالجة ${response.data.birthdays_processed} عيد ميلاد`
      });
      fetchData();
    } catch (error) {
      toast({ title: 'خطأ في معالجة أعياد الميلاد', variant: 'destructive' });
    } finally {
      setProcessingBirthdays(false);
    }
  };

  const openRewardDialog = (reward = null) => {
    if (reward) {
      setEditingReward(reward);
      setRewardForm(reward);
    } else {
      setEditingReward(null);
      setRewardForm({
        name_ar: '', name_en: '', description_ar: '', description_en: '',
        points_required: 100, reward_type: 'discount', discount_percentage: 5,
        quantity_available: -1, is_active: true, image_url: ''
      });
    }
    setRewardDialogOpen(true);
  };

  const getLevelIcon = (level) => {
    const icons = { bronze: '🥉', silver: '🥈', gold: '🥇', diamond: '💎' };
    return icons[level] || '🏅';
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: { bg: 'bg-yellow-100 text-yellow-800', text: 'قيد المراجعة' },
      approved: { bg: 'bg-blue-100 text-blue-800', text: 'تمت الموافقة' },
      delivered: { bg: 'bg-green-100 text-green-800', text: 'تم التسليم' },
      rejected: { bg: 'bg-red-100 text-red-800', text: 'مرفوض' }
    };
    const style = styles[status] || styles.pending;
    return <Badge className={style.bg}>{style.text}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Trophy className="w-7 h-7 text-yellow-500" />
            نظام الولاء
          </h1>
          <p className="text-gray-600 mt-1">إدارة نقاط المكافآت ومستويات العضوية</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSettingsDialogOpen(true)}>
            <Settings className="w-4 h-4 me-1" />
            الإعدادات
          </Button>
          <Button onClick={() => setAdjustPointsDialogOpen(true)}>
            <Coins className="w-4 h-4 me-1" />
            تعديل نقاط
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">إجمالي النقاط الموزعة</p>
                <p className="text-2xl font-bold text-blue-600">{stats?.total_points_earned?.toLocaleString() || 0}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <Star className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">النقاط المستبدلة</p>
                <p className="text-2xl font-bold text-green-600">{stats?.total_points_redeemed?.toLocaleString() || 0}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <Gift className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">الأعضاء في البرنامج</p>
                <p className="text-2xl font-bold text-purple-600">{stats?.total_members_in_program || 0}</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                <Users className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">طلبات الاستبدال المعلقة</p>
                <p className="text-2xl font-bold text-orange-600">{stats?.pending_redemptions || 0}</p>
              </div>
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                <Clock className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Level Distribution */}
      {stats?.level_distribution && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-yellow-500" />
              توزيع المستويات
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              {Object.entries(stats.level_distribution).map(([level, count]) => (
                <div key={level} className="text-center p-4 bg-gray-50 rounded-lg">
                  <div className="text-3xl mb-2">{getLevelIcon(level)}</div>
                  <p className="font-bold text-lg">{count}</p>
                  <p className="text-sm text-gray-500 capitalize">{level}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">المتصدرين</TabsTrigger>
          <TabsTrigger value="rewards">المكافآت</TabsTrigger>
          <TabsTrigger value="redemptions">طلبات الاستبدال</TabsTrigger>
          <TabsTrigger value="settings">الإعدادات</TabsTrigger>
        </TabsList>

        {/* Leaderboard Tab */}
        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                أكثر الأعضاء نقاطاً
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {leaderboard.map((member, index) => (
                  <div key={member.member_id} className={`flex items-center justify-between p-3 rounded-lg ${
                    index === 0 ? 'bg-yellow-50 border border-yellow-200' :
                    index === 1 ? 'bg-gray-100' :
                    index === 2 ? 'bg-orange-50' : 'bg-white border'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                        index === 0 ? 'bg-yellow-500 text-white' :
                        index === 1 ? 'bg-gray-400 text-white' :
                        index === 2 ? 'bg-orange-400 text-white' : 'bg-gray-200'
                      }`}>
                        {member.rank}
                      </div>
                      <div>
                        <p className="font-medium">{member.member_name}</p>
                        <p className="text-sm text-gray-500">#{member.member_code}</p>
                      </div>
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-blue-600">{member.total_points.toLocaleString()} نقطة</p>
                      <p className="text-sm">{member.icon} {member.level_ar}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rewards Tab */}
        <TabsContent value="rewards">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-green-600" />
                المكافآت المتاحة
              </CardTitle>
              <Button onClick={() => openRewardDialog()}>
                <Plus className="w-4 h-4 me-1" />
                إضافة مكافأة
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {rewards.map((reward) => (
                  <Card key={reward.id} className={`relative ${!reward.is_active ? 'opacity-60' : ''}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
                          {reward.reward_type === 'discount' && <Percent className="w-6 h-6 text-white" />}
                          {reward.reward_type === 'product' && <Package className="w-6 h-6 text-white" />}
                          {reward.reward_type === 'session' && <Target className="w-6 h-6 text-white" />}
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openRewardDialog(reward)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteReward(reward.id)}>
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                      <h3 className="font-bold text-lg">{reward.name_ar}</h3>
                      <p className="text-sm text-gray-500 mb-3">{reward.description_ar}</p>
                      <div className="flex items-center justify-between">
                        <Badge className="bg-blue-100 text-blue-800">
                          {reward.points_required} نقطة
                        </Badge>
                        {reward.discount_percentage > 0 && (
                          <Badge className="bg-green-100 text-green-800">
                            {reward.discount_percentage}% خصم
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-2">
                        تم استبدالها {reward.redeemed_count || 0} مرة
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Redemptions Tab */}
        <TabsContent value="redemptions">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="w-5 h-5 text-purple-600" />
                طلبات الاستبدال
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-right py-3 px-4">العضو</th>
                      <th className="text-right py-3 px-4">المكافأة</th>
                      <th className="text-right py-3 px-4">النقاط</th>
                      <th className="text-right py-3 px-4">الحالة</th>
                      <th className="text-right py-3 px-4">التاريخ</th>
                      <th className="text-right py-3 px-4">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redemptions.map((redemption) => (
                      <tr key={redemption.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <p className="font-medium">{redemption.member_name}</p>
                          <p className="text-sm text-gray-500">#{redemption.member_code}</p>
                        </td>
                        <td className="py-3 px-4">{redemption.reward_name_ar}</td>
                        <td className="py-3 px-4">{redemption.points_used}</td>
                        <td className="py-3 px-4">{getStatusBadge(redemption.status)}</td>
                        <td className="py-3 px-4 text-sm text-gray-500">
                          {new Date(redemption.created_at).toLocaleDateString('ar-SA')}
                        </td>
                        <td className="py-3 px-4">
                          {redemption.status === 'pending' && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" className="text-green-600"
                                onClick={() => handleUpdateRedemptionStatus(redemption.id, 'approved')}>
                                <CheckCircle className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="outline" className="text-red-600"
                                onClick={() => handleUpdateRedemptionStatus(redemption.id, 'rejected')}>
                                <XCircle className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                          {redemption.status === 'approved' && (
                            <Button size="sm" variant="outline" className="text-blue-600"
                              onClick={() => handleUpdateRedemptionStatus(redemption.id, 'delivered')}>
                              تم التسليم
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Points Settings */}
            <Card>
              <CardHeader>
                <CardTitle>إعدادات النقاط</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {pointsSettings && Object.entries(pointsSettings).map(([key, value]) => {
                  if (key === 'id' || key === 'type') return null;
                  const labels = {
                    attendance_points: 'نقاط الحضور',
                    streak_5_days_bonus: 'مكافأة 5 أيام متتالية',
                    streak_10_days_bonus: 'مكافأة 10 أيام متتالية',
                    monthly_renewal_points: 'نقاط التجديد الشهري',
                    quarterly_renewal_points: 'نقاط التجديد الربع سنوي',
                    yearly_renewal_points: 'نقاط التجديد السنوي',
                    referral_points: 'نقاط الإحالة',
                    coach_rating_points: 'نقاط تقييم المدرب',
                    video_watch_points: 'نقاط مشاهدة فيديو',
                    birthday_points: 'نقاط عيد الميلاد'
                  };
                  return (
                    <div key={key} className="flex items-center justify-between">
                      <Label>{labels[key] || key}</Label>
                      <Input
                        type="number"
                        value={value}
                        onChange={(e) => setPointsSettings({...pointsSettings, [key]: parseInt(e.target.value)})}
                        className="w-24 text-center"
                      />
                    </div>
                  );
                })}
                <Button onClick={handleSaveSettings} className="w-full mt-4">
                  حفظ إعدادات النقاط
                </Button>
              </CardContent>
            </Card>

            {/* Level Settings */}
            <Card>
              <CardHeader>
                <CardTitle>إعدادات المستويات</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {levelSettings && (
                  <>
                    <div className="space-y-3">
                      <h4 className="font-medium text-gray-700">الحد الأدنى للنقاط</h4>
                      {['bronze', 'silver', 'gold', 'diamond'].map((level) => (
                        <div key={level} className="flex items-center justify-between">
                          <Label className="flex items-center gap-2">
                            {getLevelIcon(level)} {level}
                          </Label>
                          <Input
                            type="number"
                            value={levelSettings[`${level}_min`] || 0}
                            onChange={(e) => setLevelSettings({...levelSettings, [`${level}_min`]: parseInt(e.target.value)})}
                            className="w-24 text-center"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-3 pt-4 border-t">
                      <h4 className="font-medium text-gray-700">نسبة الخصم لكل مستوى</h4>
                      {['silver', 'gold', 'diamond'].map((level) => (
                        <div key={level} className="flex items-center justify-between">
                          <Label className="flex items-center gap-2">
                            {getLevelIcon(level)} {level}
                          </Label>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={levelSettings[`${level}_discount`] || 0}
                              onChange={(e) => setLevelSettings({...levelSettings, [`${level}_discount`]: parseFloat(e.target.value)})}
                              className="w-20 text-center"
                            />
                            <span>%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button onClick={handleSaveSettings} className="w-full mt-4">
                      حفظ إعدادات المستويات
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Reward Dialog */}
      <Dialog open={rewardDialogOpen} onOpenChange={setRewardDialogOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingReward ? 'تعديل مكافأة' : 'إضافة مكافأة جديدة'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>الاسم (عربي)</Label>
                <Input value={rewardForm.name_ar} onChange={(e) => setRewardForm({...rewardForm, name_ar: e.target.value})} />
              </div>
              <div>
                <Label>الاسم (إنجليزي)</Label>
                <Input value={rewardForm.name_en} onChange={(e) => setRewardForm({...rewardForm, name_en: e.target.value})} dir="ltr" />
              </div>
            </div>
            <div>
              <Label>الوصف (عربي)</Label>
              <Textarea value={rewardForm.description_ar} onChange={(e) => setRewardForm({...rewardForm, description_ar: e.target.value})} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>نوع المكافأة</Label>
                <Select value={rewardForm.reward_type} onValueChange={(v) => setRewardForm({...rewardForm, reward_type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="discount">خصم</SelectItem>
                    <SelectItem value="product">منتج</SelectItem>
                    <SelectItem value="session">جلسة تدريبية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>النقاط المطلوبة</Label>
                <Input type="number" value={rewardForm.points_required} onChange={(e) => setRewardForm({...rewardForm, points_required: parseInt(e.target.value)})} />
              </div>
            </div>
            {rewardForm.reward_type === 'discount' && (
              <div>
                <Label>نسبة الخصم (%)</Label>
                <Input type="number" value={rewardForm.discount_percentage} onChange={(e) => setRewardForm({...rewardForm, discount_percentage: parseFloat(e.target.value)})} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={rewardForm.is_active} onCheckedChange={(v) => setRewardForm({...rewardForm, is_active: v})} />
              <Label>مفعّلة</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRewardDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleSaveReward}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust Points Dialog */}
      <Dialog open={adjustPointsDialogOpen} onOpenChange={setAdjustPointsDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-yellow-500" />
              تعديل نقاط يدوياً
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>البحث عن عضو</Label>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  value={memberSearch}
                  onChange={(e) => {
                    setMemberSearch(e.target.value);
                    searchMembers(e.target.value);
                  }}
                  placeholder="ابحث بالاسم أو رقم العضوية..."
                  className="pr-10"
                />
              </div>
              {members.length > 0 && (
                <div className="mt-2 border rounded-lg max-h-40 overflow-y-auto">
                  {members.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => {
                        setSelectedMember(m);
                        setMemberSearch(m.name_ar);
                        setMembers([]);
                      }}
                      className="p-2 hover:bg-gray-100 cursor-pointer flex items-center justify-between"
                    >
                      <span>{m.name_ar}</span>
                      <span className="text-sm text-gray-500">#{m.member_code}</span>
                    </div>
                  ))}
                </div>
              )}
              {selectedMember && (
                <div className="mt-2 p-3 bg-blue-50 rounded-lg">
                  <p className="font-medium">{selectedMember.name_ar}</p>
                  <p className="text-sm text-gray-500">#{selectedMember.member_code}</p>
                </div>
              )}
            </div>
            <div>
              <Label>عدد النقاط (موجب للإضافة، سالب للخصم)</Label>
              <Input
                type="number"
                value={adjustForm.points}
                onChange={(e) => setAdjustForm({...adjustForm, points: e.target.value})}
                placeholder="مثال: 50 أو -50"
              />
            </div>
            <div>
              <Label>السبب *</Label>
              <Input
                value={adjustForm.reason}
                onChange={(e) => setAdjustForm({...adjustForm, reason: e.target.value})}
                placeholder="سبب التعديل..."
              />
            </div>
            <div>
              <Label>ملاحظات إضافية</Label>
              <Textarea
                value={adjustForm.admin_notes}
                onChange={(e) => setAdjustForm({...adjustForm, admin_notes: e.target.value})}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustPointsDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleAdjustPoints} disabled={!selectedMember || !adjustForm.reason}>
              تأكيد التعديل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LoyaltyPage;
