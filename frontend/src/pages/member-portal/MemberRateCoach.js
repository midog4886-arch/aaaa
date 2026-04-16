import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Star, User, Loader2, Send, CheckCircle, MessageSquare, Plus, Award } from 'lucide-react';
import { toast } from 'sonner';
import MemberLayout, { memberAPI } from './MemberLayout';

const CoachAvatar = ({ coach, size = 'w-16 h-16', textSize = 'text-lg' }) => {
  const [imgError, setImgError] = useState(false);
  const initials = (coach.name_ar || coach.name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0])
    .join('');
  if (coach.photo && !imgError) {
    return (
      <img
        src={coach.photo}
        alt={coach.name_ar || coach.name}
        className={`${size} rounded-full object-cover flex-shrink-0 border-2 border-white shadow`}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className={`${size} bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center flex-shrink-0`}>
      <span className={`${textSize} font-bold text-white`}>{initials || <User className="w-6 h-6" />}</span>
    </div>
  );
};

const MemberRateCoach = () => {
  const [loading, setLoading] = useState(true);
  const [coaches, setCoaches] = useState([]);
  const [selectedCoach, setSelectedCoach] = useState(null);
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // Manual rating form
  const [manualCoachName, setManualCoachName] = useState('');
  const [manualActivityName, setManualActivityName] = useState('');
  const [manualRating, setManualRating] = useState(0);
  const [manualHoverRating, setManualHoverRating] = useState(0);
  const [manualComment, setManualComment] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const coachesRes = await memberAPI.get('/api/member-portal/coaches-to-rate');
      setCoaches(coachesRes.data.coaches || []);
    } catch (error) {
      console.error('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const openRatingDialog = (coach) => {
    setSelectedCoach(coach);
    setRating(coach.my_rating?.rating || 0);
    setComment(coach.my_rating?.comment || '');
    setRatingDialogOpen(true);
  };

  const openManualDialog = () => {
    setManualCoachName('');
    setManualActivityName('');
    setManualRating(0);
    setManualComment('');
    setManualDialogOpen(true);
  };

  const handleSubmitRating = async () => {
    if (rating === 0) {
      toast.error('يرجى اختيار التقييم');
      return;
    }

    setSubmitting(true);
    try {
      await memberAPI.post('/api/member-portal/rate-coach', {
        coach_id: selectedCoach.id,
        activity_id: selectedCoach.activities?.[0]?.id || '',
        rating: rating,
        comment: comment
      });
      
      toast.success('تم إرسال التقييم بنجاح ⭐');
      setRatingDialogOpen(false);
      fetchData();
    } catch (error) {
      toast.error('فشل إرسال التقييم');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitManualRating = async () => {
    if (manualRating === 0) {
      toast.error('يرجى اختيار التقييم');
      return;
    }
    if (!manualCoachName.trim()) {
      toast.error('يرجى كتابة اسم المدرب');
      return;
    }

    setSubmitting(true);
    try {
      await memberAPI.post('/api/member-portal/rate-coach', {
        coach_name: manualCoachName.trim(),
        activity_name: manualActivityName.trim() || null,
        rating: manualRating,
        comment: manualComment
      });
      
      toast.success('تم إرسال التقييم بنجاح ⭐');
      setManualDialogOpen(false);
      fetchData();
    } catch (error) {
      toast.error('فشل إرسال التقييم');
    } finally {
      setSubmitting(false);
    }
  };

  const renderStars = (count, size = 'w-6 h-6', interactive = false, onSelect = null, hoverState = hoverRating, ratingState = rating) => {
    return (
      <div className="flex gap-1" dir="ltr">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`${size} cursor-${interactive ? 'pointer' : 'default'} transition-all ${
              star <= (interactive ? (hoverState || ratingState) : count)
                ? 'text-yellow-400 fill-yellow-400'
                : 'text-gray-300'
            } ${interactive ? 'hover:scale-110' : ''}`}
            onClick={() => interactive && onSelect && onSelect(star)}
            onMouseEnter={() => interactive && (hoverState === hoverRating ? setHoverRating(star) : setManualHoverRating(star))}
            onMouseLeave={() => interactive && (hoverState === hoverRating ? setHoverRating(0) : setManualHoverRating(0))}
          />
        ))}
      </div>
    );
  };

  const getRatingText = (r) => {
    switch(r) {
      case 1: return 'ضعيف';
      case 2: return 'مقبول';
      case 3: return 'جيد';
      case 4: return 'جيد جداً';
      case 5: return 'ممتاز';
      default: return '';
    }
  };

  if (loading) {
    return (
      <MemberLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </MemberLayout>
    );
  }

  return (
    <MemberLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">تقييم المدربين</h1>
            <p className="mt-1 text-gray-500 dark:text-gray-400">شاركنا رأيك في المدربين لتحسين جودة الخدمة</p>
          </div>
          <Button 
            onClick={openManualDialog}
            className="gap-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600"
          >
            <Plus className="w-4 h-4" />
            إضافة تقييم
          </Button>
        </div>

        {/* My Coaches Section */}
        {coaches.length > 0 && (
          <div>
            <h2 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
              <Award className="w-5 h-5 text-blue-500" />
              مدربيني
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {coaches.map((coach) => (
                <Card key={coach.id} className="hover:shadow-lg transition-shadow dark:bg-gray-800 dark:border-gray-700">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <CoachAvatar coach={coach} size="w-16 h-16" textSize="text-lg" />
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-800 dark:text-white">
                          {coach.name_ar || coach.name}
                        </h3>
                        {coach.specialization && (
                          <p className="text-sm text-gray-500 dark:text-gray-400">{coach.specialization}</p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {coach.activities?.map((act, idx) => (
                            <span key={idx} className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                              {act.name}
                            </span>
                          ))}
                        </div>
                        
                        {coach.my_rating ? (
                          <div className="mt-4 p-3 rounded-lg border bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-700">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium flex items-center gap-1 text-green-700 dark:text-green-400">
                                  <CheckCircle className="w-4 h-4" />
                                  تقييمك
                                </p>
                                <div className="mt-1">
                                  {renderStars(coach.my_rating.rating, 'w-5 h-5')}
                                </div>
                              </div>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => openRatingDialog(coach)}
                                className="dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                              >
                                تعديل
                              </Button>
                            </div>
                            {coach.my_rating.comment && (
                              <p className="text-sm mt-2 flex items-start gap-1 text-gray-600 dark:text-gray-300">
                                <MessageSquare className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                {coach.my_rating.comment}
                              </p>
                            )}
                          </div>
                        ) : (
                          <Button 
                            className="mt-4 w-full gap-2 bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600"
                            onClick={() => openRatingDialog(coach)}
                          >
                            <Star className="w-4 h-4" />
                            قيّم الآن
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {coaches.length === 0 && (
          <Card className="dark:bg-gray-800 dark:border-gray-700">
            <CardContent className="py-12 text-center">
              <User className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
              <p className="text-xl font-medium text-gray-600 dark:text-gray-300">لا يوجد مدربين مرتبطين بنشاطاتك</p>
              <p className="mt-2 text-gray-400 dark:text-gray-500">يمكنك إضافة تقييم يدوي باستخدام الزر أعلاه</p>
            </CardContent>
          </Card>
        )}

        {/* Info Card */}
        <Card className="border bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200 dark:bg-purple-900/30 dark:border-purple-700 dark:from-transparent dark:to-transparent">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                <Star className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-purple-800 dark:text-purple-300">لماذا التقييم مهم؟</h3>
                <p className="mt-1 text-sm text-purple-600 dark:text-purple-200">
                  تقييمك يساعدنا في تحسين جودة التدريب وتطوير أداء المدربين. 
                  نقدر مشاركتك ونأخذ ملاحظاتك بعين الاعتبار.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rating Dialog for existing coach */}
      <Dialog open={ratingDialogOpen} onOpenChange={setRatingDialogOpen}>
        <DialogContent className="max-w-md dark:bg-gray-800 dark:border-gray-700" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 dark:text-white">
              <Star className="w-5 h-5 text-yellow-500" />
              تقييم المدرب
            </DialogTitle>
          </DialogHeader>
          
          {selectedCoach && (
            <div className="space-y-6">
              <div className="flex items-center gap-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-700">
                <CoachAvatar coach={selectedCoach} size="w-14 h-14" textSize="text-base" />
                <div>
                  <p className="font-bold text-lg dark:text-white">{selectedCoach.name_ar || selectedCoach.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedCoach.activities?.map(a => a.name).join(', ')}
                  </p>
                </div>
              </div>

              <div className="text-center">
                <p className="text-sm mb-3 text-gray-500 dark:text-gray-400">اختر تقييمك</p>
                <div className="flex justify-center">
                  {renderStars(rating, 'w-10 h-10', true, setRating, hoverRating, rating)}
                </div>
                {rating > 0 && (
                  <p className="mt-2 text-lg font-bold text-yellow-600">
                    {getRatingText(rating)}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block text-gray-700 dark:text-gray-300">
                  تعليق (اختياري)
                </label>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="شاركنا رأيك في المدرب..."
                  rows={3}
                  className="dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder:text-gray-400"
                />
              </div>

              <Button 
                className="w-full gap-2 bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600"
                onClick={handleSubmitRating}
                disabled={submitting || rating === 0}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {selectedCoach.my_rating ? 'تحديث التقييم' : 'إرسال التقييم'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manual Rating Dialog */}
      <Dialog open={manualDialogOpen} onOpenChange={setManualDialogOpen}>
        <DialogContent className="max-w-md dark:bg-gray-800 dark:border-gray-700" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 dark:text-white">
              <Plus className="w-5 h-5 text-orange-500" />
              إضافة تقييم جديد
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Coach Name - Manual Input */}
            <div>
              <label className="text-sm font-medium mb-2 block text-gray-700 dark:text-gray-300">
                اسم المدرب <span className="text-red-500">*</span>
              </label>
              <Input
                value={manualCoachName}
                onChange={(e) => setManualCoachName(e.target.value)}
                placeholder="اكتب اسم المدرب..."
                className="dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder:text-gray-400"
              />
            </div>

            {/* Activity Name - Manual Input */}
            <div>
              <label className="text-sm font-medium mb-2 block text-gray-700 dark:text-gray-300">
                النشاط (اختياري)
              </label>
              <Input
                value={manualActivityName}
                onChange={(e) => setManualActivityName(e.target.value)}
                placeholder="اكتب اسم النشاط..."
                className="dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder:text-gray-400"
              />
            </div>

            {/* Rating Stars */}
            <div className="text-center">
              <p className="text-sm mb-3 text-gray-500 dark:text-gray-400">اختر تقييمك <span className="text-red-500">*</span></p>
              <div className="flex justify-center gap-1" dir="ltr">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`w-10 h-10 cursor-pointer transition-all hover:scale-110 ${
                      star <= (manualHoverRating || manualRating)
                        ? 'text-yellow-400 fill-yellow-400'
                        : 'text-gray-300'
                    }`}
                    onClick={() => setManualRating(star)}
                    onMouseEnter={() => setManualHoverRating(star)}
                    onMouseLeave={() => setManualHoverRating(0)}
                  />
                ))}
              </div>
              {manualRating > 0 && (
                <p className="mt-2 text-lg font-bold text-yellow-600">
                  {getRatingText(manualRating)}
                </p>
              )}
            </div>

            {/* Comment */}
            <div>
              <label className="text-sm font-medium mb-2 block text-gray-700 dark:text-gray-300">
                تعليق (اختياري)
              </label>
              <Textarea
                value={manualComment}
                onChange={(e) => setManualComment(e.target.value)}
                placeholder="شاركنا رأيك في المدرب..."
                rows={3}
                className="dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder:text-gray-400"
              />
            </div>

            {/* Submit Button */}
            <Button 
              className="w-full gap-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600"
              onClick={handleSubmitManualRating}
              disabled={submitting || manualRating === 0 || !manualCoachName.trim()}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              إرسال التقييم
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MemberLayout>
  );
};

export default MemberRateCoach;
