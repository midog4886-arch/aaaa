import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Progress } from '../../components/ui/progress';
import { Textarea } from '../../components/ui/textarea';
import { Input } from '../../components/ui/input';
import MemberLayout, { memberAPI, getMemberData, getLanguage, getDarkMode } from './MemberLayout';
import { 
  Trophy, Gift, Star, Crown, Medal, Target, Percent, Package,
  Clock, CheckCircle, Copy, Users, TrendingUp, Coins, History, UserPlus
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
  const [dataLoaded, setDataLoaded] = useState(false);
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [applyingReferral, setApplyingReferral] = useState(false);
  const [referralMessage, setReferralMessage] = useState({ type: '', text: '' });
  
  const member = getMemberData();
  const language = getLanguage();
  const darkMode = getDarkMode();

  const t = (ar, en) => language === 'ar' ? ar : en;

  const fetchData = useCallback(async () => {
    if (!member?.id || dataLoaded) return;
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
      setDataLoaded(true);
    } catch (error) {
      console.error('Error fetching loyalty data:', error);
    } finally {
      setLoading(false);
    }
  }, [member?.id, dataLoaded]);

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
      setDataLoaded(false);
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

  const applyReferralCode = async () => {
    if (!referralCodeInput.trim()) {
      setReferralMessage({ type: 'error', text: t('الرجاء إدخال كود الإحالة', 'Please enter a referral code') });
      return;
    }
    
    try {
      setApplyingReferral(true);
      setReferralMessage({ type: '', text: '' });
      
      await memberAPI.post('/api/loyalty/referral/apply', {
        member_id: member.id,
        referral_code: referralCodeInput.trim()
      });
      
      setReferralMessage({ type: 'success', text: t('تم تطبيق كود الإحالة بنجاح! 🎉', 'Referral code applied successfully! 🎉') });
      setReferralCodeInput('');
      setDataLoaded(false);
    } catch (error) {
      const errorMsg = error.response?.data?.detail || t('كود الإحالة غير صحيح', 'Invalid referral code');
      setReferralMessage({ type: 'error', text: errorMsg });
    } finally {
      setApplyingReferral(false);
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
      pending: {
        bg: darkMode ? 'bg-yellow-900/40 text-yellow-300' : 'bg-yellow-100 text-yellow-800',
        text: t('قيد المراجعة', 'Pending')
      },
      approved: {
        bg: darkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-800',
        text: t('تمت الموافقة', 'Approved')
      },
      delivered: {
        bg: darkMode ? 'bg-green-900/40 text-green-300' : 'bg-green-100 text-green-800',
        text: t('تم التسليم', 'Delivered')
      },
      rejected: {
        bg: darkMode ? 'bg-red-900/40 text-red-300' : 'bg-red-100 text-red-800',
        text: t('مرفوض', 'Rejected')
      }
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

        {/* Available Rewards */}
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
              <Gift className="w-5 h-5 text-green-600" />
              {t('المكافآت المتاحة', 'Available Rewards')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rewards.length === 0 ? (
              <p className={`text-center py-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('لا توجد مكافآت متاحة حالياً', 'No rewards available yet')}
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {rewards.map((reward) => {
                  const canRedeem = (pointsData?.available_points || 0) >= reward.points_required;
                  return (
                    <div 
                      key={reward.id} 
                      className={`border rounded-lg p-4 ${
                        darkMode
                          ? `border-gray-600 ${canRedeem ? 'hover:shadow-md hover:border-gray-500 cursor-pointer bg-gray-700/50' : 'opacity-60 bg-gray-700/30'}`
                          : `${canRedeem ? 'hover:shadow-md cursor-pointer' : 'opacity-60'}`
                      }`}
                      onClick={() => canRedeem && (setSelectedReward(reward), setRedeemDialogOpen(true))}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                          canRedeem ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : darkMode ? 'bg-gray-600' : 'bg-gray-300'
                        }`}>
                          {getRewardIcon(reward.reward_type)}
                        </div>
                        <div className="flex-1">
                          <h3 className={`font-bold ${darkMode ? 'text-gray-100' : ''}`}>{language === 'ar' ? reward.name_ar : reward.name_en}</h3>
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{language === 'ar' ? reward.description_ar : reward.description_en}</p>
                          <div className="flex items-center justify-between mt-2">
                            <Badge className={
                              canRedeem
                                ? darkMode ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-800'
                                : darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-600'
                            }>
                              {reward.points_required} {t('نقطة', 'pts')}
                            </Badge>
                            {reward.discount_percentage > 0 && (
                              <Badge className={darkMode ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-800'}>
                                {reward.discount_percentage}% {t('خصم', 'off')}
                              </Badge>
                            )}
                          </div>
                          {canRedeem && (
                            <Button 
                              className="w-full mt-3 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedReward(reward);
                                setRedeemDialogOpen(true);
                              }}
                            >
                              <Gift className="w-4 h-4 me-2" />
                              {t('استبدال', 'Redeem')}
                            </Button>
                          )}
                        </div>
                      </div>
                      {!canRedeem && (
                        <p className={`text-xs mt-2 ${darkMode ? 'text-red-400' : 'text-red-500'}`}>
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
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
              <History className="w-5 h-5 text-blue-600" />
              {t('سجل النقاط', 'Points History')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className={`text-center py-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('لا يوجد سجل حتى الآن', 'No history yet')}
              </p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {history.map((item) => (
                  <div key={item.id} className={`flex items-center justify-between p-3 rounded-lg ${darkMode ? 'bg-gray-700/60' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        item.points > 0
                          ? darkMode ? 'bg-green-900/50' : 'bg-green-100'
                          : darkMode ? 'bg-red-900/50' : 'bg-red-100'
                      }`}>
                        <Star className={`w-5 h-5 ${item.points > 0 ? 'text-green-500' : 'text-red-500'}`} />
                      </div>
                      <div>
                        <p className={`font-medium ${darkMode ? 'text-gray-100' : ''}`}>{language === 'ar' ? item.description_ar : item.description_en}</p>
                        <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {new Date(item.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
                        </p>
                      </div>
                    </div>
                    <p className={`font-bold ${item.points > 0 ? 'text-green-500' : 'text-red-500'}`}>
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
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                <Clock className="w-5 h-5 text-purple-600" />
                {t('طلبات الاستبدال', 'Redemption Requests')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {redemptions.map((item) => (
                  <div key={item.id} className={`flex items-center justify-between p-3 border rounded-lg ${darkMode ? 'border-gray-600 bg-gray-700/40' : ''}`}>
                    <div>
                      <p className={`font-medium ${darkMode ? 'text-gray-100' : ''}`}>{language === 'ar' ? item.reward_name_ar : item.reward_name_en}</p>
                      <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{item.points_used} {t('نقطة', 'points')}</p>
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
          <DialogContent dir={language === 'ar' ? 'rtl' : 'ltr'} className={darkMode ? 'bg-gray-800 border-gray-700 text-gray-100' : ''}>
            <DialogHeader>
              <DialogTitle className={`flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                <Gift className="w-5 h-5 text-green-600" />
                {t('تأكيد الاستبدال', 'Confirm Redemption')}
              </DialogTitle>
            </DialogHeader>
            {selectedReward && (
              <div className="space-y-4">
                <div className={`rounded-lg p-4 ${darkMode ? 'bg-gray-700/60' : 'bg-gray-50'}`}>
                  <h3 className={`font-bold text-lg ${darkMode ? 'text-gray-100' : ''}`}>{language === 'ar' ? selectedReward.name_ar : selectedReward.name_en}</h3>
                  <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{language === 'ar' ? selectedReward.description_ar : selectedReward.description_en}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge className={darkMode ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-800'}>{selectedReward.points_required} {t('نقطة', 'points')}</Badge>
                    {selectedReward.discount_percentage > 0 && (
                      <Badge className={darkMode ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-800'}>{selectedReward.discount_percentage}% {t('خصم', 'off')}</Badge>
                    )}
                  </div>
                </div>
                <div>
                  <p className={`text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{t('ملاحظات (اختياري)', 'Notes (optional)')}</p>
                  <Textarea
                    value={redeemNotes}
                    onChange={(e) => setRedeemNotes(e.target.value)}
                    placeholder={t('أي ملاحظات تريد إضافتها...', 'Any notes you want to add...')}
                    className={darkMode ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder:text-gray-500' : ''}
                  />
                </div>
                <div className={`border rounded-lg p-3 ${darkMode ? 'bg-yellow-900/20 border-yellow-700' : 'bg-yellow-50 border-yellow-200'}`}>
                  <p className={`text-sm ${darkMode ? 'text-yellow-300' : 'text-yellow-800'}`}>
                    {t('سيتم خصم', 'Will deduct')} <strong>{selectedReward.points_required}</strong> {t('نقطة من رصيدك', 'points from your balance')}
                  </p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setRedeemDialogOpen(false)} className={darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : ''}>
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
