import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Star, User, Loader2, Send, CheckCircle, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import MemberLayout, { memberAPI, useDarkMode } from './MemberLayout';

const MemberRateCoach = () => {
  const [loading, setLoading] = useState(true);
  const [coaches, setCoaches] = useState([]);
  const [selectedCoach, setSelectedCoach] = useState(null);
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { darkMode } = useDarkMode();

  useEffect(() => {
    fetchCoaches();
  }, []);

  const fetchCoaches = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/coaches-to-rate');
      setCoaches(res.data.coaches || []);
    } catch (error) {
      console.error('Failed to fetch coaches');
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

  const handleSubmitRating = async () => {
    if (rating === 0) {
      toast.error('يرجى اختيار التقييم');
      return;
    }

    setSubmitting(true);
    try {
      await memberAPI.post('/api/member-portal/rate-coach', {
        coach_id: selectedCoach.id,
        activity_id: selectedCoach.activities[0]?.id || '',
        rating: rating,
        comment: comment
      });
      
      toast.success('تم إرسال التقييم بنجاح ⭐');
      setRatingDialogOpen(false);
      fetchCoaches(); // Refresh
    } catch (error) {
      toast.error('فشل إرسال التقييم');
    } finally {
      setSubmitting(false);
    }
  };

  const renderStars = (count, size = 'w-6 h-6', interactive = false, onSelect = null) => {
    return (
      <div className="flex gap-1" dir="ltr">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`${size} cursor-${interactive ? 'pointer' : 'default'} transition-all ${
              star <= (interactive ? (hoverRating || rating) : count)
                ? 'text-yellow-400 fill-yellow-400'
                : 'text-gray-300'
            } ${interactive ? 'hover:scale-110' : ''}`}
            onClick={() => interactive && onSelect && onSelect(star)}
            onMouseEnter={() => interactive && setHoverRating(star)}
            onMouseLeave={() => interactive && setHoverRating(0)}
          />
        ))}
      </div>
    );
  };

  const getRatingText = (r) => {
    const texts = {
      1: 'ضعيف',
      2: 'مقبول',
      3: 'جيد',
      4: 'جيد جداً',
      5: 'ممتاز'
    };
    return texts[r] || '';
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
        <div>
          <h1 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>تقييم المدربين</h1>
          <p className={`mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>شاركنا رأيك في المدربين لتحسين جودة الخدمة</p>
        </div>

        {coaches.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {coaches.map((coach) => (
              <Card key={coach.id} className={`hover:shadow-lg transition-shadow ${darkMode ? 'bg-gray-800 border-gray-700' : ''}`}>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="w-8 h-8 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                        {coach.name_ar || coach.name}
                      </h3>
                      {coach.specialization && (
                        <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{coach.specialization}</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {coach.activities?.map((act, idx) => (
                          <span key={idx} className={`text-xs px-2 py-1 rounded ${darkMode ? 'bg-blue-900 text-blue-200' : 'bg-blue-100 text-blue-700'}`}>
                            {act.name}
                          </span>
                        ))}
                      </div>
                      
                      {/* Existing Rating */}
                      {coach.my_rating ? (
                        <div className={`mt-4 p-3 rounded-lg border ${darkMode ? 'bg-green-900/30 border-green-700' : 'bg-green-50 border-green-200'}`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className={`text-sm font-medium flex items-center gap-1 ${darkMode ? 'text-green-400' : 'text-green-700'}`}>
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
                              className={darkMode ? 'border-gray-600 text-gray-200 hover:bg-gray-700' : ''}
                            >
                              تعديل
                            </Button>
                          </div>
                          {coach.my_rating.comment && (
                            <p className={`text-sm mt-2 flex items-start gap-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
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
        ) : (
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardContent className="py-12 text-center">
              <User className={`w-16 h-16 mx-auto mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
              <p className={`text-xl font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>لا يوجد مدربين للتقييم</p>
              <p className={`mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>سيظهر المدربون هنا عند الاشتراك في الأنشطة</p>
            </CardContent>
          </Card>
        )}

        {/* Info Card */}
        <Card className={`border ${darkMode ? 'bg-purple-900/30 border-purple-700' : 'bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200'}`}>
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                <Star className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className={`font-bold ${darkMode ? 'text-purple-300' : 'text-purple-800'}`}>لماذا التقييم مهم؟</h3>
                <p className={`mt-1 text-sm ${darkMode ? 'text-purple-200' : 'text-purple-600'}`}>
                  تقييمك يساعدنا في تحسين جودة التدريب وتطوير أداء المدربين. 
                  نقدر مشاركتك ونأخذ ملاحظاتك بعين الاعتبار.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rating Dialog */}
      <Dialog open={ratingDialogOpen} onOpenChange={setRatingDialogOpen}>
        <DialogContent className={`max-w-md ${darkMode ? 'bg-gray-800 border-gray-700' : ''}`} dir="rtl">
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
              <Star className="w-5 h-5 text-yellow-500" />
              تقييم المدرب
            </DialogTitle>
          </DialogHeader>
          
          {selectedCoach && (
            <div className="space-y-6">
              {/* Coach Info */}
              <div className={`flex items-center gap-4 p-4 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center">
                  <User className="w-7 h-7 text-white" />
                </div>
                <div>
                  <p className={`font-bold text-lg ${darkMode ? 'text-white' : ''}`}>{selectedCoach.name_ar || selectedCoach.name}</p>
                  <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {selectedCoach.activities?.map(a => a.name).join(', ')}
                  </p>
                </div>
              </div>

              {/* Rating Stars */}
              <div className="text-center">
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>اختر تقييمك</p>
                <div className="flex justify-center">
                  {renderStars(rating, 'w-10 h-10', true, setRating)}
                </div>
                {rating > 0 && (
                  <p className="mt-2 text-lg font-bold text-yellow-600">
                    {getRatingText(rating)}
                  </p>
                )}
              </div>

              {/* Comment */}
              <div>
                <label className={`text-sm font-medium mb-2 block ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  تعليق (اختياري)
                </label>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="شاركنا رأيك في المدرب..."
                  rows={3}
                  className={darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder:text-gray-400' : ''}
                />
              </div>

              {/* Submit Button */}
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
    </MemberLayout>
  );
};

export default MemberRateCoach;
