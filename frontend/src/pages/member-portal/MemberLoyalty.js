import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Progress } from '../../components/ui/progress';
import { Textarea } from '../../components/ui/textarea';
import MemberLayout, { memberAPI, getMemberData, getLanguage } from './MemberLayout';
import { 
  Trophy, Gift, Star, Crown, Medal, Target, Percent, Package,
  Clock, CheckCircle, Copy, Users, TrendingUp, Coins, History
} from 'lucide-react';

const MemberLoyalty = () => {
  const [loading, setLoading] = useState(true);
  const [pointsData, setPointsData] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [history, setHistory] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [selectedReward, setSelectedReward] = useState(null);
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [redeemNotes, setRedeemNotes] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  
  const member = getMemberData();
  const language = getLanguage();

  const t = (ar, en) => language === 'ar' ? ar : en;

  const fetchData = useCallback(async () => {
    if (!member) return;
    try {
      setLoading(true);
      const [pointsRes, rewardsRes, historyRes, redemptionsRes] = await Promise.all([
        memberAPI.get(`/api/loyalty/members/${member.id}/points`),
        memberAPI.get('/api/loyalty/rewards?active_only=true'),
        memberAPI.get(`/api/loyalty/members/${member.id}/history?limit=20`),
        memberAPI.get(`/api/loyalty/redemptions/member/${member.id}`)
      ]);
      
      setPointsData(pointsRes.data);
      setRewards(rewardsRes.data);
      setHistory(historyRes.data);
      setRedemptions(redemptionsRes.data);
    } catch (error) {
      console.error('Error fetching loyalty data:', error);
    } finally {
      setLoading(false);
    }
  }, [member]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRedeem = async () => {
    if (!selectedReward) return;
    try {
      await memberAPI.post(`/api/loyalty/redeem/${member.id}`, {
        reward_id: selectedReward.id,
        notes: redeemNotes
      });
      setRedeemDialogOpen(false);
      setSelectedReward(null);
      setRedeemNotes('');
      fetchData();
    } catch (error) {
      console.error('Error redeeming reward:', error);
      alert(error.response?.data?.detail || t('حدث خطأ', 'An error occurred'));
    }
  };

  const copyReferralCode = () => {
    if (pointsData?.referral_code) {
      navigator.clipboard.writeText(pointsData.referral_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const getLevelColor = (level) => {
    const colors = {
      bronze: 'from-orange-400 to-orange-600',
      silver: 'from-gray-400 to-gray-600',
      gold: 'from-yellow-400 to-yellow-600',
      diamond: 'from-blue-400 to-purple-600'
    };
    return colors[level] || colors.bronze;
  };

  const getRewardIcon = (type) => {
    switch (type) {
      case 'discount': return <Percent className="w-6 h-6 text-white" />;
      case 'product': return <Package className="w-6 h-6 text-white" />;
      case 'session': return <Target className="w-6 h-6 text-white" />;
      default: return <Gift className="w-6 h-6 text-white" />;
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: { bg: 'bg-yellow-100 text-yellow-800', text: t('قيد المراجعة', 'Pending') },
      approved: { bg: 'bg-blue-100 text-blue-800', text: t('تمت الموافقة', 'Approved') },
      delivered: { bg: 'bg-green-100 text-green-800', text: t('تم التسليم', 'Delivered') },
      rejected: { bg: 'bg-red-100 text-red-800', text: t('مرفوض', 'Rejected') }
    };
    const style = styles[status] || styles.pending;
    return <Badge className={style.bg}>{style.text}</Badge>;
  };

  if (loading) {
    return (
      <MemberLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </MemberLayout>
    );
  }

  const progressPercent = pointsData?.points_to_next > 0 
    ? ((pointsData?.total_points % (pointsData?.points_to_next + pointsData?.total_points)) / (pointsData?.points_to_next + pointsData?.total_points)) * 100
    : 100;

  return (
    <MemberLayout>
      <div className="space-y-6" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        {/* Points Overview Card */}
        <Card className={`overflow-hidden bg-gradient-to-br ${getLevelColor(pointsData?.level)}`}>
          <CardContent className="pt-6 text-white">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-white/80 text-sm">{t('رصيد النقاط', 'Points Balance')}</p>
                <p className="text-4xl font-bold">{pointsData?.available_points?.toLocaleString() || 0}</p>
              </div>
              <div className="text-center">
                <div className="text-5xl mb-1">{pointsData?.icon}</div>
                <p className="font-bold">{language === 'ar' ? pointsData?.level_ar : pointsData?.level_en}</p>
              </div>
            </div>
            
            {/* Progress to next level */}
            {pointsData?.next_level && (
              <div className="bg-white/20 rounded-lg p-4">
                <div className="flex justify-between text-sm mb-2">
                  <span>{t('المستوى التالي', 'Next Level')}: {pointsData?.next_level}</span>
                  <span>{pointsData?.points_to_next?.toLocaleString()} {t('نقطة متبقية', 'points remaining')}</span>
                </div>
                <Progress value={progressPercent} className="h-2 bg-white/30" />
              </div>
            )}

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div className="text-center bg-white/10 rounded-lg p-3">
                <Coins className="w-5 h-5 mx-auto mb-1" />
                <p className="text-lg font-bold">{pointsData?.total_points?.toLocaleString() || 0}</p>
                <p className="text-xs text-white/70">{t('إجمالي المكتسب', 'Total Earned')}</p>
              </div>
              <div className="text-center bg-white/10 rounded-lg p-3">
                <TrendingUp className="w-5 h-5 mx-auto mb-1" />
                <p className="text-lg font-bold">{pointsData?.attendance_streak || 0}</p>
                <p className="text-xs text-white/70">{t('أيام متتالية', 'Day Streak')}</p>
              </div>
              <div className="text-center bg-white/10 rounded-lg p-3">
                <Users className="w-5 h-5 mx-auto mb-1" />
                <p className="text-lg font-bold">{pointsData?.referral_count || 0}</p>
                <p className="text-xs text-white/70">{t('إحالات', 'Referrals')}</p>
              </div>
            </div>

            {/* Discount Badge */}
            {pointsData?.discount > 0 && (
              <div className="mt-4 bg-white text-gray-800 rounded-lg p-3 text-center">
                <p className="font-bold text-lg">{t('خصم دائم', 'Permanent Discount')}: {pointsData?.discount}%</p>
                <p className="text-sm text-gray-600">{t('على جميع التجديدات', 'on all renewals')}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Referral Code */}
        {pointsData?.referral_code && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-600 text-sm mb-1">{t('كود الإحالة الخاص بك', 'Your Referral Code')}</p>
                  <p className="text-2xl font-bold font-mono">{pointsData.referral_code}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {t('شاركه مع أصدقائك واحصل على نقاط!', 'Share with friends and earn points!')}
                  </p>
                </div>
                <Button onClick={copyReferralCode} variant="outline" className="gap-2">
                  {copiedCode ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  {copiedCode ? t('تم النسخ', 'Copied') : t('نسخ', 'Copy')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Available Rewards */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-green-600" />
              {t('المكافآت المتاحة', 'Available Rewards')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rewards.length === 0 ? (
              <p className="text-center text-gray-500 py-8">{t('لا توجد مكافآت متاحة حالياً', 'No rewards available yet')}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {rewards.map((reward) => {
                  const canRedeem = (pointsData?.available_points || 0) >= reward.points_required;
                  return (
                    <div 
                      key={reward.id} 
                      className={`border rounded-lg p-4 ${canRedeem ? 'hover:shadow-md cursor-pointer' : 'opacity-60'}`}
                      onClick={() => canRedeem && (setSelectedReward(reward), setRedeemDialogOpen(true))}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                          canRedeem ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 'bg-gray-300'
                        }`}>
                          {getRewardIcon(reward.reward_type)}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-bold">{language === 'ar' ? reward.name_ar : reward.name_en}</h3>
                          <p className="text-sm text-gray-500">{language === 'ar' ? reward.description_ar : reward.description_en}</p>
                          <div className="flex items-center justify-between mt-2">
                            <Badge className={canRedeem ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}>
                              {reward.points_required} {t('نقطة', 'pts')}
                            </Badge>
                            {reward.discount_percentage > 0 && (
                              <Badge className="bg-green-100 text-green-800">
                                {reward.discount_percentage}% {t('خصم', 'off')}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      {!canRedeem && (
                        <p className="text-xs text-red-500 mt-2">
                          {t('تحتاج', 'Need')} {reward.points_required - (pointsData?.available_points || 0)} {t('نقطة إضافية', 'more points')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Points History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              {t('سجل النقاط', 'Points History')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-center text-gray-500 py-8">{t('لا يوجد سجل حتى الآن', 'No history yet')}</p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {history.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        item.points > 0 ? 'bg-green-100' : 'bg-red-100'
                      }`}>
                        <Star className={`w-5 h-5 ${item.points > 0 ? 'text-green-600' : 'text-red-600'}`} />
                      </div>
                      <div>
                        <p className="font-medium">{language === 'ar' ? item.description_ar : item.description_en}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(item.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
                        </p>
                      </div>
                    </div>
                    <p className={`font-bold ${item.points > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {item.points > 0 ? '+' : ''}{item.points}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Redemption History */}
        {redemptions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-600" />
                {t('طلبات الاستبدال', 'Redemption Requests')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {redemptions.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{language === 'ar' ? item.reward_name_ar : item.reward_name_en}</p>
                      <p className="text-sm text-gray-500">{item.points_used} {t('نقطة', 'points')}</p>
                    </div>
                    {getStatusBadge(item.status)}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Redeem Dialog */}
        <Dialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen}>
          <DialogContent dir={language === 'ar' ? 'rtl' : 'ltr'}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-green-600" />
                {t('تأكيد الاستبدال', 'Confirm Redemption')}
              </DialogTitle>
            </DialogHeader>
            {selectedReward && (
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-bold text-lg">{language === 'ar' ? selectedReward.name_ar : selectedReward.name_en}</h3>
                  <p className="text-gray-600">{language === 'ar' ? selectedReward.description_ar : selectedReward.description_en}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge className="bg-blue-100 text-blue-800">{selectedReward.points_required} {t('نقطة', 'points')}</Badge>
                    {selectedReward.discount_percentage > 0 && (
                      <Badge className="bg-green-100 text-green-800">{selectedReward.discount_percentage}% {t('خصم', 'off')}</Badge>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-2">{t('ملاحظات (اختياري)', 'Notes (optional)')}</p>
                  <Textarea
                    value={redeemNotes}
                    onChange={(e) => setRedeemNotes(e.target.value)}
                    placeholder={t('أي ملاحظات تريد إضافتها...', 'Any notes you want to add...')}
                  />
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-yellow-800 text-sm">
                    {t('سيتم خصم', 'Will deduct')} <strong>{selectedReward.points_required}</strong> {t('نقطة من رصيدك', 'points from your balance')}
                  </p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setRedeemDialogOpen(false)}>
                {t('إلغاء', 'Cancel')}
              </Button>
              <Button onClick={handleRedeem} className="bg-green-600 hover:bg-green-700">
                {t('تأكيد الاستبدال', 'Confirm Redemption')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MemberLayout>
  );
};

export default MemberLoyalty;
