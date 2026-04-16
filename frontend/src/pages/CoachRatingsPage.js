import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { 
  Star, User, Search, Trash2, MessageSquare, TrendingUp, 
  Award, Users, Filter, Calendar, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import Layout from '../components/Layout';
import axios from 'axios';

const API_URL = '';

const CoachRatingsPage = () => {
  const [ratings, setRatings] = useState([]);
  const [stats, setStats] = useState({ coaches: [], total_ratings: 0 });
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCoach, setFilterCoach] = useState('all');
  const [selectedRating, setSelectedRating] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      
      const [ratingsRes, statsRes, coachesRes] = await Promise.all([
        axios.get(`${API_URL}/api/coach-ratings`, { headers }),
        axios.get(`${API_URL}/api/coach-ratings/stats`, { headers }),
        axios.get(`${API_URL}/api/coaches`, { headers })
      ]);
      
      setRatings(ratingsRes.data.ratings || []);
      setStats(statsRes.data || { coaches: [], total_ratings: 0 });
      setCoaches(coachesRes.data.coaches || coachesRes.data || []);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toast.error('فشل في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRating = async () => {
    if (!selectedRating) return;
    
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/api/coach-ratings/${selectedRating.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('تم حذف التقييم بنجاح');
      setShowDeleteDialog(false);
      setSelectedRating(null);
      fetchData();
    } catch (error) {
      toast.error('فشل في حذف التقييم');
    }
  };

  const renderStars = (rating) => {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-4 h-4 ${star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
          />
        ))}
      </div>
    );
  };

  const coachMap = React.useMemo(() => {
    const map = {};
    coaches.forEach(c => { map[c.id] = c; });
    return map;
  }, [coaches]);

  const CoachAvatar = ({ coachId, coachName, size = 'md' }) => {
    const coach = coachMap[coachId];
    const photo = coach?.photo;
    const initials = (coachName || '?').split(' ').map(w => w[0]).slice(0, 2).join('');
    const sizeClass = size === 'lg' ? 'w-14 h-14 text-base' : 'w-10 h-10 text-sm';
    const [imgError, setImgError] = React.useState(false);

    if (photo && !imgError) {
      return (
        <img
          src={photo}
          alt={coachName}
          className={`${sizeClass} rounded-full object-cover border-2 border-white shadow`}
          onError={() => setImgError(true)}
        />
      );
    }
    return (
      <div className={`${sizeClass} rounded-full flex items-center justify-center font-bold bg-gradient-to-br from-blue-400 to-indigo-600 text-white border-2 border-white shadow`}>
        {initials}
      </div>
    );
  };

  const filteredRatings = ratings.filter(rating => {
    const matchesSearch = 
      (rating.member_name || '').includes(searchTerm) ||
      (rating.coach_name || '').includes(searchTerm) ||
      (rating.comment || '').includes(searchTerm);
    
    const matchesCoach = filterCoach === 'all' || rating.coach_id === filterCoach;
    
    return matchesSearch && matchesCoach;
  });

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ar-SA', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">تقييمات المدربين</h1>
            <p className="text-gray-500 mt-1">عرض وإدارة تقييمات الأعضاء للمدربين</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-orange-100 text-orange-700 px-4 py-2 rounded-lg font-bold">
              {stats.total_ratings} تقييم
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-yellow-500 to-amber-600 text-white border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-yellow-100 text-sm">إجمالي التقييمات</p>
                  <p className="text-3xl font-bold mt-1">{stats.total_ratings}</p>
                </div>
                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                  <Star className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-sm">المدربين المُقيّمين</p>
                  <p className="text-3xl font-bold mt-1">{stats.coaches?.length || 0}</p>
                </div>
                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                  <Users className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm">أعلى تقييم</p>
                  <p className="text-3xl font-bold mt-1">
                    {stats.coaches?.length > 0 ? stats.coaches[0]?.average_rating : '-'}
                  </p>
                </div>
                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                  <TrendingUp className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500 to-pink-600 text-white border-0">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-purple-100 text-sm">التعليقات</p>
                  <p className="text-3xl font-bold mt-1">
                    {ratings.filter(r => r.comment).length}
                  </p>
                </div>
                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                  <MessageSquare className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Coach Leaderboard */}
        {stats.coaches?.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="w-5 h-5 text-yellow-500" />
                ترتيب المدربين
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {stats.coaches.slice(0, 6).map((coach, idx) => (
                  <div
                    key={coach.coach_id}
                    className={`p-4 rounded-lg border ${
                      idx === 0 ? 'bg-yellow-50 border-yellow-300' :
                      idx === 1 ? 'bg-gray-50 border-gray-300' :
                      idx === 2 ? 'bg-orange-50 border-orange-300' :
                      'bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative flex-shrink-0">
                        <CoachAvatar coachId={coach.coach_id} coachName={coach.coach_name} size="md" />
                        <span className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border border-white ${
                          idx === 0 ? 'bg-yellow-500 text-white' :
                          idx === 1 ? 'bg-gray-400 text-white' :
                          idx === 2 ? 'bg-orange-400 text-white' :
                          'bg-blue-100 text-blue-600'
                        }`}>
                          {idx + 1}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-800 truncate">{coach.coach_name}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {renderStars(Math.round(coach.average_rating))}
                          <span className="text-sm text-gray-500">
                            {coach.average_rating} — {coach.total_ratings} تقييم
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="بحث بالاسم أو التعليق..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
              <Select value={filterCoach} onValueChange={setFilterCoach}>
                <SelectTrigger className="w-full md:w-[200px]">
                  <Filter className="w-4 h-4 ml-2" />
                  <SelectValue placeholder="فلترة حسب المدرب" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع المدربين</SelectItem>
                  {coaches.map((coach) => (
                    <SelectItem key={coach.id} value={coach.id}>
                      {coach.name_ar || coach.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Ratings List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>جميع التقييمات ({filteredRatings.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredRatings.length > 0 ? (
              <div className="space-y-4">
                {filteredRatings.map((rating) => (
                  <div
                    key={rating.id}
                    className="p-4 border rounded-lg hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-orange-600 rounded-full flex items-center justify-center">
                          <User className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-gray-800">{rating.member_name || 'عضو'}</p>
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                              {rating.member_phone || ''}
                            </span>
                          </div>
                          <p className="text-sm text-gray-500 mt-0.5">
                            قيّم المدرب: <span className="font-medium text-blue-600">{rating.coach_name || 'غير محدد'}</span>
                            {rating.activity_name && (
                              <span className="text-gray-400"> • {rating.activity_name}</span>
                            )}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            {renderStars(rating.rating)}
                            <span className="text-sm text-gray-500">({rating.rating}/5)</span>
                          </div>
                          {rating.comment && (
                            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-start gap-2">
                                <MessageSquare className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                                <p className="text-gray-700">{rating.comment}</p>
                              </div>
                            </div>
                          )}
                          <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                            <Calendar className="w-3 h-3" />
                            {formatDate(rating.created_at)}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => {
                          setSelectedRating(rating);
                          setShowDeleteDialog(true);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Star className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-xl font-medium text-gray-600">لا توجد تقييمات</p>
                <p className="text-gray-400 mt-2">
                  {searchTerm || filterCoach !== 'all' 
                    ? 'لا توجد نتائج مطابقة للبحث' 
                    : 'سيظهر هنا تقييمات الأعضاء للمدربين'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-red-600 flex items-center gap-2">
                <Trash2 className="w-5 h-5" />
                حذف التقييم
              </DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-gray-600">
                هل أنت متأكد من حذف تقييم <span className="font-bold">{selectedRating?.member_name}</span> للمدرب <span className="font-bold">{selectedRating?.coach_name}</span>؟
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
                إلغاء
              </Button>
              <Button variant="destructive" onClick={handleDeleteRating}>
                حذف
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default CoachRatingsPage;
