import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../../components/ui/card';
import { ArrowRight, Star, Loader2, Dumbbell, MessageSquare, Award, Send, CheckCircle, Trash2, Edit2 } from 'lucide-react';
import { toast } from 'sonner';
import MemberLayout, { memberAPI, getDarkMode } from './MemberLayout';

const StarDisplay = ({ value, size = 'sm' }) => {
  const stars = [1, 2, 3, 4, 5];
  const iconSize = size === 'lg' ? 'w-6 h-6' : 'w-4 h-4';
  return (
    <div className="flex items-center gap-0.5">
      {stars.map(s => (
        <Star
          key={s}
          className={`${iconSize} ${s <= Math.round(value) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`}
        />
      ))}
    </div>
  );
};

const InteractiveStars = ({ rating, hoverRating, onRate, onHover, onLeave, size = 'w-9 h-9' }) => (
  <div className="flex gap-1" dir="ltr">
    {[1, 2, 3, 4, 5].map(star => (
      <Star
        key={star}
        className={`${size} cursor-pointer transition-all hover:scale-110 ${
          star <= (hoverRating || rating)
            ? 'text-yellow-400 fill-yellow-400'
            : 'text-gray-300 dark:text-gray-600'
        }`}
        onClick={() => onRate(star)}
        onMouseEnter={() => onHover(star)}
        onMouseLeave={onLeave}
      />
    ))}
  </div>
);

const getRatingText = (r) => {
  switch (r) {
    case 1: return 'ضعيف';
    case 2: return 'مقبول';
    case 3: return 'جيد';
    case 4: return 'جيد جداً';
    case 5: return 'ممتاز';
    default: return '';
  }
};

const CoachProfile = () => {
  const { coachId } = useParams();
  const navigate = useNavigate();
  const darkMode = getDarkMode();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [imgError, setImgError] = useState(false);

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [hasExistingRating, setHasExistingRating] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState(null);

  const fetchProfile = async () => {
    try {
      const res = await memberAPI.get(`/api/member-portal/coach-profile/${coachId}`);
      const data = res.data;
      setProfile(data);

      if (data.my_rating) {
        setRating(data.my_rating.rating);
        setComment(data.my_rating.comment || '');
        setHasExistingRating(true);
        setSubmitted(false);
      } else {
        setRating(0);
        setComment('');
        setHasExistingRating(false);
        setSubmitted(false);
      }
    } catch (err) {
      console.error('Failed to fetch coach profile', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setHoverRating(0);
    setSubmitted(false);
    setSelectedActivity(null);
    setLoading(true);
    setProfile(null);
    setImgError(false);
    fetchProfile();
  }, [coachId]);

  useEffect(() => {
    if (profile && profile.activities_with_ids && profile.activities_with_ids.length === 1) {
      setSelectedActivity(profile.activities_with_ids[0]);
    }
  }, [profile]);

  const handleSubmitRating = async () => {
    if (rating === 0) {
      toast.error('يرجى اختيار تقييم');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { coach_id: coachId, rating, comment };
      if (selectedActivity) {
        if (selectedActivity.id) {
          payload.activity_id = selectedActivity.id;
        } else if (selectedActivity.name) {
          payload.activity_name = selectedActivity.name;
        }
      }
      await memberAPI.post('/api/member-portal/rate-coach', payload);
      toast.success(hasExistingRating ? 'تم تحديث تقييمك بنجاح ⭐' : 'تم إرسال التقييم بنجاح ⭐');
      setSubmitted(true);
      setHasExistingRating(true);
      await fetchProfile();
    } catch (err) {
      toast.error('فشل إرسال التقييم');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRating = async () => {
    setDeleting(true);
    try {
      await memberAPI.delete(`/api/member-portal/delete-rating/${coachId}`);
      toast.success('تم حذف تقييمك بنجاح');
      setSubmitted(false);
      setHasExistingRating(false);
      setRating(0);
      setComment('');
      await fetchProfile();
    } catch (err) {
      toast.error('فشل حذف التقييم');
    } finally {
      setDeleting(false);
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

  if (!profile) {
    return (
      <MemberLayout>
        <div className={`text-center py-16 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          <p className="text-lg">لم يتم العثور على المدرب</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg text-sm"
          >
            رجوع
          </button>
        </div>
      </MemberLayout>
    );
  }

  const initials = profile.name
    ? profile.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('')
    : '?';

  return (
    <MemberLayout>
      <div className="space-y-6 page-enter" dir="rtl">
        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className={`flex items-center gap-2 text-sm font-medium ${darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
        >
          <ArrowRight className="w-4 h-4" />
          رجوع
        </button>

        {/* Coach Hero Card */}
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
          <CardContent className="p-6">
            <div className="flex flex-col items-center text-center gap-4">
              {/* Photo */}
              {profile.photo && !imgError ? (
                <img
                  src={profile.photo}
                  alt={profile.name}
                  onError={() => setImgError(true)}
                  className="w-28 h-28 rounded-full object-cover border-4 border-green-400"
                />
              ) : (
                <div className={`w-28 h-28 rounded-full flex items-center justify-center text-3xl font-bold border-4 ${
                  darkMode ? 'bg-green-800 border-green-500 text-green-200' : 'bg-green-100 border-green-400 text-green-700'
                }`}>
                  {initials}
                </div>
              )}

              {/* Name */}
              <div>
                <h1 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{profile.name}</h1>
                {profile.specialization && (
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <Award className={`w-4 h-4 ${darkMode ? 'text-yellow-400' : 'text-yellow-500'}`} />
                    <p className={`text-sm font-medium ${darkMode ? 'text-yellow-300' : 'text-yellow-700'}`}>{profile.specialization}</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Activities */}
        {profile.activities && profile.activities.length > 0 && (
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardContent className="p-5">
              <h2 className={`text-base font-bold mb-3 flex items-center gap-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                <Dumbbell className="w-5 h-5 text-green-600" />
                الأنشطة التدريبية
              </h2>
              <div className="flex flex-wrap gap-2">
                {profile.activities.map((act, i) => (
                  <span
                    key={i}
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      darkMode ? 'bg-green-900/40 text-green-300 border border-green-700' : 'bg-green-100 text-green-800 border border-green-200'
                    }`}
                  >
                    {act}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Notes / Bio */}
        {profile.notes && (
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardContent className="p-5">
              <h2 className={`text-base font-bold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>نبذة</h2>
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{profile.notes}</p>
            </CardContent>
          </Card>
        )}

        {/* Rate this Coach */}
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
          <CardContent className="p-5">
            <h2 className={`text-base font-bold mb-4 flex items-center gap-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
              <Star className="w-5 h-5 text-yellow-500" />
              {hasExistingRating ? 'تقييمك لهذا المدرب' : 'قيّم هذا المدرب'}
            </h2>

            {submitted ? (
              <div className={`flex flex-col items-center gap-3 py-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                <CheckCircle className="w-10 h-10" />
                <p className="text-base font-semibold">شكراً! تم إرسال تقييمك بنجاح</p>
                <div className="flex items-center gap-3 mt-1">
                  <button
                    onClick={() => setSubmitted(false)}
                    className={`flex items-center gap-1 text-sm underline ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    تعديل التقييم
                  </button>
                  <span className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-300'}`}>|</span>
                  <button
                    onClick={handleDeleteRating}
                    disabled={deleting}
                    className={`flex items-center gap-1 text-sm underline ${darkMode ? 'text-red-400 hover:text-red-300' : 'text-red-500 hover:text-red-700'}`}
                  >
                    {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    حذف التقييم
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {hasExistingRating && (
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
                    darkMode ? 'bg-blue-900/30 text-blue-300 border border-blue-700' : 'bg-blue-50 text-blue-700 border border-blue-200'
                  }`}>
                    <Edit2 className="w-3.5 h-3.5 flex-shrink-0" />
                    لديك تقييم سابق — يمكنك تعديله أو حذفه
                  </div>
                )}

                {/* Activity selector — shown only when coach has multiple activities */}
                {profile.activities_with_ids && profile.activities_with_ids.length > 1 && (
                  <div>
                    <p className={`text-sm font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      اختر النشاط الذي تقيّمه <span className="text-gray-400 font-normal">(اختياري)</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {profile.activities_with_ids.map((act, i) => {
                        const isActive = selectedActivity && (
                          act.id ? selectedActivity.id === act.id : selectedActivity.name === act.name
                        );
                        return (
                          <button
                            key={i}
                            onClick={() => setSelectedActivity(isActive ? null : act)}
                            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                              isActive
                                ? darkMode
                                  ? 'bg-green-700 border-green-500 text-white'
                                  : 'bg-green-600 border-green-600 text-white'
                                : darkMode
                                  ? 'bg-gray-700 border-gray-600 text-gray-300 hover:border-green-500'
                                  : 'bg-white border-gray-300 text-gray-600 hover:border-green-500'
                            }`}
                          >
                            {act.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Stars */}
                <div className="flex flex-col items-center gap-2">
                  <InteractiveStars
                    rating={rating}
                    hoverRating={hoverRating}
                    onRate={setRating}
                    onHover={setHoverRating}
                    onLeave={() => setHoverRating(0)}
                  />
                  {(hoverRating || rating) > 0 && (
                    <p className={`text-sm font-bold ${darkMode ? 'text-yellow-300' : 'text-yellow-600'}`}>
                      {getRatingText(hoverRating || rating)}
                    </p>
                  )}
                </div>

                {/* Comment */}
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="شاركنا رأيك (اختياري)..."
                  rows={3}
                  className={`w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-yellow-400 ${
                    darkMode
                      ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                      : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400'
                  }`}
                />

                {/* Submit */}
                <button
                  onClick={handleSubmitRating}
                  disabled={submitting || rating === 0}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white transition-all ${
                    rating === 0 || submitting
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600'
                  }`}
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {hasExistingRating ? 'تحديث التقييم' : 'إرسال التقييم'}
                </button>

                {/* Delete option for existing ratings */}
                {hasExistingRating && (
                  <button
                    onClick={handleDeleteRating}
                    disabled={deleting}
                    className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border transition-all ${
                      darkMode
                        ? 'border-red-700 text-red-400 hover:bg-red-900/30'
                        : 'border-red-300 text-red-600 hover:bg-red-50'
                    }`}
                  >
                    {deleting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    حذف تقييمي
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </MemberLayout>
  );
};

export default CoachProfile;
