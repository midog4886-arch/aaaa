import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../../components/ui/card';
import { ArrowRight, Star, Loader2, Dumbbell, MessageSquare, Award } from 'lucide-react';
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

const CoachProfile = () => {
  const { coachId } = useParams();
  const navigate = useNavigate();
  const darkMode = getDarkMode();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await memberAPI.get(`/api/member-portal/coach-profile/${coachId}`);
        setProfile(res.data);
      } catch (err) {
        console.error('Failed to fetch coach profile', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [coachId]);

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
                {profile.total_ratings > 0 && (
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <StarDisplay value={profile.avg_rating} size="lg" />
                    <span className={`text-sm font-medium ${darkMode ? 'text-yellow-300' : 'text-yellow-600'}`}>
                      {profile.avg_rating}
                    </span>
                    <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      ({profile.total_ratings} تقييم)
                    </span>
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

        {/* Ratings & Reviews */}
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
          <CardContent className="p-5">
            <h2 className={`text-base font-bold mb-3 flex items-center gap-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
              <MessageSquare className="w-5 h-5 text-blue-500" />
              آراء الأعضاء
              {profile.total_ratings > 0 && (
                <span className={`text-sm font-normal ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  ({profile.total_ratings})
                </span>
              )}
            </h2>

            {profile.total_ratings === 0 ? (
              <p className={`text-sm text-center py-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                لا توجد تقييمات بعد
              </p>
            ) : profile.reviews.length === 0 ? (
              <div className={`text-sm text-center py-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <StarDisplay value={profile.avg_rating} size="lg" />
                <p className="mt-2">
                  {profile.total_ratings} تقييم · متوسط {profile.avg_rating} نجوم
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Rating summary bar */}
                <div className={`flex items-center gap-3 p-3 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <div className="text-center">
                    <p className={`text-3xl font-bold ${darkMode ? 'text-yellow-300' : 'text-yellow-600'}`}>{profile.avg_rating}</p>
                    <StarDisplay value={profile.avg_rating} />
                    <p className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{profile.total_ratings} تقييم</p>
                  </div>
                </div>

                {/* Individual reviews */}
                {profile.reviews.map((review, i) => (
                  <div
                    key={i}
                    className={`p-4 rounded-lg border ${
                      darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <StarDisplay value={review.rating} />
                      <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{review.date}</span>
                    </div>
                    {review.activity_name && (
                      <p className={`text-xs mb-1 ${darkMode ? 'text-green-400' : 'text-green-700'}`}>{review.activity_name}</p>
                    )}
                    <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{review.comment}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MemberLayout>
  );
};

export default CoachProfile;
