import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { useToast } from '../hooks/use-toast';
import { dailyVideosAPI, branchesAPI, activitiesAPI } from '../services/api';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from 'date-fns';
import { ar } from 'date-fns/locale';
import { 
  Plus, Pencil, Trash2, Eye, Video, Calendar as CalendarIcon, 
  Play, Search, Filter, Clock, Users, Activity, ChevronLeft, 
  ChevronRight, LayoutGrid, List, RefreshCw
} from 'lucide-react';

const DailyVideosPage = () => {
  const { toast } = useToast();
  const [videos, setVideos] = useState([]);
  const [branches, setBranches] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVideo, setEditingVideo] = useState(null);
  const [stats, setStats] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterActivity, setFilterActivity] = useState('all');
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' or 'list'
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarData, setCalendarData] = useState({});
  const [selectedDate, setSelectedDate] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    title_ar: '',
    youtube_video_id: '',
    description: '',
    description_ar: '',
    scheduled_date: format(new Date(), 'yyyy-MM-dd'),
    activity_id: '',
    activity_name: '',
    branch_id: '',
    is_active: true,
    tags: []
  });

  const fetchData = useCallback(async () => {
    try {
      const [videosRes, branchesRes, activitiesRes, statsRes] = await Promise.all([
        dailyVideosAPI.getAll({
          month: currentMonth.getMonth() + 1,
          year: currentMonth.getFullYear()
        }),
        branchesAPI.getAll(),
        activitiesAPI.getAll(),
        dailyVideosAPI.getStats()
      ]);
      setVideos(videosRes.data);
      setBranches(branchesRes.data);
      setActivities(activitiesRes.data);
      setStats(statsRes.data);
      
      // Build calendar data
      const calData = {};
      videosRes.data.forEach(video => {
        calData[video.scheduled_date] = {
          ...video,
          has_video: true,
          thumbnail: `https://img.youtube.com/vi/${video.youtube_video_id}/mqdefault.jpg`
        };
      });
      setCalendarData(calData);
    } catch (error) {
      toast({ title: 'خطأ', description: 'فشل في تحميل البيانات', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, currentMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resetForm = () => {
    setFormData({
      title: '',
      title_ar: '',
      youtube_video_id: '',
      description: '',
      description_ar: '',
      scheduled_date: selectedDate ? format(selectedDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
      activity_id: '',
      activity_name: '',
      branch_id: '',
      is_active: true,
      tags: []
    });
    setEditingVideo(null);
  };

  const handleOpenDialog = (video = null, date = null) => {
    if (video) {
      setEditingVideo(video);
      setFormData({
        title: video.title || '',
        title_ar: video.title_ar || '',
        youtube_video_id: video.youtube_video_id || '',
        description: video.description || '',
        description_ar: video.description_ar || '',
        scheduled_date: video.scheduled_date || format(new Date(), 'yyyy-MM-dd'),
        activity_id: video.activity_id || '',
        activity_name: video.activity_name || '',
        branch_id: video.branch_id || '',
        is_active: video.is_active !== false,
        tags: video.tags || []
      });
    } else {
      resetForm();
      if (date) {
        setFormData(prev => ({ ...prev, scheduled_date: format(date, 'yyyy-MM-dd') }));
      }
    }
    setDialogOpen(true);
  };

  const handleActivityChange = (activityId) => {
    const activity = activities.find(a => a.id === activityId);
    setFormData(prev => ({
      ...prev,
      activity_id: activityId,
      activity_name: activity?.name_ar || activity?.name || ''
    }));
  };

  const handleSubmit = async () => {
    if (!formData.title_ar || !formData.youtube_video_id || !formData.scheduled_date) {
      toast({ title: 'خطأ', description: 'يرجى ملء الحقول المطلوبة', variant: 'destructive' });
      return;
    }

    try {
      if (editingVideo) {
        await dailyVideosAPI.update(editingVideo.id, formData);
        toast({ title: 'تم تحديث الفيديو بنجاح' });
      } else {
        await dailyVideosAPI.create(formData);
        toast({ title: 'تم إضافة الفيديو بنجاح' });
      }
      setDialogOpen(false);
      fetchData();
    } catch (error) {
      toast({ 
        title: 'خطأ', 
        description: error.response?.data?.detail || 'فشل في حفظ الفيديو', 
        variant: 'destructive' 
      });
    }
  };

  const handleDelete = async (video) => {
    if (!window.confirm(`هل أنت متأكد من حذف الفيديو "${video.title_ar}"؟`)) return;
    
    try {
      await dailyVideosAPI.delete(video.id);
      toast({ title: 'تم حذف الفيديو بنجاح' });
      fetchData();
    } catch (error) {
      toast({ title: 'خطأ', description: 'فشل في حذف الفيديو', variant: 'destructive' });
    }
  };

  const handleDateClick = (date) => {
    setSelectedDate(date);
    const dateStr = format(date, 'yyyy-MM-dd');
    const existingVideo = calendarData[dateStr];
    
    if (existingVideo) {
      handleOpenDialog(existingVideo);
    } else {
      handleOpenDialog(null, date);
    }
  };

  const prevMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const filteredVideos = videos.filter(video => {
    const matchesSearch = video.title_ar?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         video.title?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesActivity = filterActivity === 'all' || video.activity_id === filterActivity;
    return matchesSearch && matchesActivity;
  });

  // Generate calendar days
  const calendarDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const today = new Date();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
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
            <Video className="w-7 h-7 text-red-600" />
            الفيديوهات اليومية
          </h1>
          <p className="text-gray-600 mt-1">إدارة فيديوهات التدريب اليومية المرتبطة بالأنشطة</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-lg overflow-hidden">
            <Button
              variant={viewMode === 'calendar' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('calendar')}
              className="rounded-none"
            >
              <CalendarIcon className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="rounded-none"
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
          <Button onClick={() => handleOpenDialog()} className="gap-2">
            <Plus className="w-4 h-4" />
            إضافة فيديو
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
            <CardContent className="p-4 text-center">
              <Video className="w-8 h-8 text-red-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-red-700">{stats.total_videos}</p>
              <p className="text-sm text-red-600">إجمالي الفيديوهات</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardContent className="p-4 text-center">
              <Play className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-700">{stats.active_videos}</p>
              <p className="text-sm text-green-600">فيديوهات نشطة</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <CardContent className="p-4 text-center">
              <Eye className="w-8 h-8 text-purple-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-purple-700">{stats.total_views?.toLocaleString()}</p>
              <p className="text-sm text-purple-600">المشاهدات</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="p-4 text-center">
              <Clock className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-blue-700">{stats.upcoming_count}</p>
              <p className="text-sm text-blue-600">فيديوهات قادمة</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-gray-50 to-gray-100 border-gray-200">
            <CardContent className="p-4 text-center">
              <CalendarIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-gray-700">{stats.past_count}</p>
              <p className="text-sm text-gray-600">فيديوهات سابقة</p>
            </CardContent>
          </Card>
        </div>
      )}

      {viewMode === 'calendar' ? (
        /* Calendar View */
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5" />
                تقويم الفيديوهات
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={prevMonth}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <span className="font-bold min-w-[150px] text-center">
                  {format(currentMonth, 'MMMM yyyy', { locale: ar })}
                </span>
                <Button variant="outline" size="icon" onClick={nextMonth}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Calendar Header */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map(day => (
                <div key={day} className="text-center font-medium text-gray-500 text-sm py-2">
                  {day}
                </div>
              ))}
            </div>
            
            {/* Calendar Days */}
            <div className="grid grid-cols-7 gap-1">
              {/* Empty cells for days before first day of month */}
              {Array.from({ length: startOfMonth(currentMonth).getDay() }).map((_, i) => (
                <div key={`empty-${i}`} className="h-24 bg-gray-50 rounded-lg"></div>
              ))}
              
              {calendarDays.map(day => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const dayData = calendarData[dateStr];
                const isToday = isSameDay(day, today);
                const videoCount = dayData?.count || 0;
                const firstVideo = dayData?.videos?.[0];
                
                return (
                  <div
                    key={dateStr}
                    onClick={() => handleDateClick(day)}
                    className={`h-24 rounded-lg border cursor-pointer transition-all overflow-hidden ${
                      isToday ? 'border-blue-500 border-2' : 'border-gray-200'
                    } ${dayData ? 'bg-red-50 hover:bg-red-100' : 'bg-white hover:bg-gray-50'}`}
                  >
                    <div className="p-1 flex justify-between items-start">
                      <span className={`text-sm font-medium ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                        {format(day, 'd')}
                      </span>
                      {videoCount > 1 && (
                        <Badge className="text-xs bg-red-600 text-white px-1.5 py-0">{videoCount}</Badge>
                      )}
                    </div>
                    
                    {firstVideo && (
                      <div className="px-1">
                        <img 
                          src={firstVideo.thumbnail}
                          alt={firstVideo.title_ar}
                          className="w-full h-12 object-cover rounded"
                        />
                        <p className="text-xs text-gray-700 truncate mt-1">{firstVideo.title_ar}</p>
                      </div>
                    )}
                    
                    {!dayData && (
                      <div className="flex items-center justify-center h-16 text-gray-300">
                        <Plus className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        /* List View */
        <>
          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="بحث في الفيديوهات..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pr-10"
                  />
                </div>
                <Select value={filterActivity} onValueChange={setFilterActivity}>
                  <SelectTrigger className="w-full md:w-[200px]">
                    <SelectValue placeholder="النشاط" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع الأنشطة</SelectItem>
                    {activities.map((activity) => (
                      <SelectItem key={activity.id} value={activity.id}>
                        {activity.name_ar || activity.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Videos List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <List className="w-5 h-5" />
                قائمة الفيديوهات ({filteredVideos.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filteredVideos.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Video className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>لا توجد فيديوهات</p>
                  <Button onClick={() => handleOpenDialog()} variant="outline" className="mt-4">
                    إضافة فيديو جديد
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredVideos.map((video) => (
                    <Card key={video.id} className={`overflow-hidden ${!video.is_active && 'opacity-60'}`}>
                      <div className="relative aspect-video group cursor-pointer" onClick={() => handleOpenDialog(video)}>
                        <img 
                          src={`https://img.youtube.com/vi/${video.youtube_video_id}/mqdefault.jpg`}
                          alt={video.title_ar}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play className="w-12 h-12 text-white" fill="white" />
                        </div>
                        <Badge className="absolute top-2 right-2 bg-black/70">
                          {video.scheduled_date}
                        </Badge>
                      </div>
                      <CardContent className="p-3">
                        <h3 className="font-bold text-gray-900 truncate">{video.title_ar}</h3>
                        <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                          {video.activity_name && (
                            <Badge variant="outline" className="gap-1">
                              <Activity className="w-3 h-3" />
                              {video.activity_name}
                            </Badge>
                          )}
                          <Badge variant="outline" className="gap-1">
                            <Eye className="w-3 h-3" />
                            {video.views_count || 0}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-end gap-1 mt-3">
                          <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(video)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(video)} className="text-red-600">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {editingVideo ? 'تعديل الفيديو' : 'إضافة فيديو جديد'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>العنوان (عربي) *</Label>
                <Input
                  value={formData.title_ar}
                  onChange={(e) => setFormData(prev => ({ ...prev, title_ar: e.target.value }))}
                  placeholder="عنوان الفيديو بالعربية"
                />
              </div>
              <div>
                <Label>العنوان (إنجليزي)</Label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Video Title"
                  dir="ltr"
                />
              </div>
            </div>

            {/* YouTube URL */}
            <div>
              <Label>رابط فيديو YouTube *</Label>
              <Input
                value={formData.youtube_video_id}
                onChange={(e) => setFormData(prev => ({ ...prev, youtube_video_id: e.target.value }))}
                placeholder="https://www.youtube.com/watch?v=VIDEO_ID"
                dir="ltr"
              />
              {formData.youtube_video_id && formData.youtube_video_id.length >= 11 && (
                <div className="mt-2 relative aspect-video max-w-sm rounded-lg overflow-hidden">
                  <img 
                    src={`https://img.youtube.com/vi/${formData.youtube_video_id.slice(-11)}/mqdefault.jpg`}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
            </div>

            {/* Date & Activity */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>تاريخ العرض *</Label>
                <Input
                  type="date"
                  value={formData.scheduled_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, scheduled_date: e.target.value }))}
                />
              </div>
              <div>
                <Label>النشاط</Label>
                <Select value={formData.activity_id || 'none'} onValueChange={handleActivityChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر النشاط" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون نشاط محدد</SelectItem>
                    {activities.map((activity) => (
                      <SelectItem key={activity.id} value={activity.id}>
                        {activity.name_ar || activity.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Branch */}
            <div>
              <Label>الفرع</Label>
              <Select 
                value={formData.branch_id || 'all'} 
                onValueChange={(v) => setFormData(prev => ({ ...prev, branch_id: v === 'all' ? '' : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="جميع الفروع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الفروع</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>الوصف (عربي)</Label>
                <Textarea
                  value={formData.description_ar}
                  onChange={(e) => setFormData(prev => ({ ...prev, description_ar: e.target.value }))}
                  placeholder="وصف الفيديو..."
                  rows={3}
                />
              </div>
              <div>
                <Label>الوصف (إنجليزي)</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Video description..."
                  rows={3}
                  dir="ltr"
                />
              </div>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <Label className="text-base">تفعيل الفيديو</Label>
                <p className="text-sm text-gray-500">عند التفعيل سيظهر الفيديو للأعضاء في التاريخ المحدد</p>
              </div>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(v) => setFormData(prev => ({ ...prev, is_active: v }))}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleSubmit}>
              {editingVideo ? 'حفظ التغييرات' : 'إضافة الفيديو'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DailyVideosPage;
