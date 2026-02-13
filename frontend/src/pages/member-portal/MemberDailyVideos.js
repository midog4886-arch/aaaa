import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent } from '../../components/ui/dialog';
import MemberLayout, { memberAPI, getMemberData, getDarkMode } from './MemberLayout';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';
import { ar } from 'date-fns/locale';
import { 
  Video, Play, Calendar, Clock, Eye, ChevronLeft, ChevronRight, 
  X, Activity, Star, CheckCircle
} from 'lucide-react';

const MemberDailyVideos = () => {
  const [todayVideo, setTodayVideo] = useState(null);
  const [weekVideos, setWeekVideos] = useState([]);
  const [calendarVideos, setCalendarVideos] = useState({});
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedActivity, setSelectedActivity] = useState('all');
  const [viewMode, setViewMode] = useState('today'); // 'today', 'week', 'calendar'
  
  const member = getMemberData();
  const darkMode = getDarkMode();
  const today = new Date();

  const fetchData = useCallback(async () => {
    try {
      const params = {
        branch_id: member?.branch_id
      };
      
      if (selectedActivity !== 'all') {
        params.activity_id = selectedActivity;
      }

      const [todayRes, weekRes] = await Promise.all([
        memberAPI.get('/api/daily-videos/today', { params }),
        memberAPI.get('/api/daily-videos/week', { params })
      ]);

      setTodayVideo(todayRes.data);
      setWeekVideos(weekRes.data || []);
      
      // Extract unique activities from videos
      const allVideos = [...(weekRes.data || [])];
      const uniqueActivities = [];
      const seenIds = new Set();
      allVideos.forEach(v => {
        if (v.activity_id && !seenIds.has(v.activity_id)) {
          seenIds.add(v.activity_id);
          uniqueActivities.push({ id: v.activity_id, name_ar: v.activity_name });
        }
      });
      setActivities(uniqueActivities);
      
      // Fetch calendar data
      const calendarRes = await memberAPI.get(
        `/api/daily-videos/calendar/${currentMonth.getFullYear()}/${currentMonth.getMonth() + 1}`,
        { params }
      );
      setCalendarVideos(calendarRes.data || {});
      
    } catch (error) {
      console.error('Failed to fetch videos:', error);
    } finally {
      setLoading(false);
    }
  }, [member?.branch_id, currentMonth, selectedActivity]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePlayVideo = (video) => {
    setSelectedVideo(video);
    setVideoDialogOpen(true);
    
    // Record view
    memberAPI.post(`/api/daily-videos/${video.id}/view`).catch(() => {});
  };

  const handleDateClick = async (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const videoData = calendarVideos[dateStr];
    
    if (videoData) {
      try {
        const res = await memberAPI.get(`/api/daily-videos/by-date/${dateStr}`, {
          params: { branch_id: member?.branch_id }
        });
        if (res.data) {
          handlePlayVideo(res.data);
        }
      } catch (error) {
        console.error('Failed to fetch video:', error);
      }
    }
  };

  const calendarDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const getDayNames = () => ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  if (loading) {
    return (
      <MemberLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </MemberLayout>
    );
  }

  return (
    <MemberLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className={`text-2xl font-bold flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              <Video className="w-7 h-7 text-red-600" />
              الفيديوهات اليومية
            </h1>
            <p className={`mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              شاهد فيديوهات التدريب اليومية
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <Select value={selectedActivity} onValueChange={setSelectedActivity}>
              <SelectTrigger className={`w-[180px] ${darkMode ? 'bg-gray-800 border-gray-700 text-white' : ''}`}>
                <SelectValue placeholder="جميع الأنشطة" />
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
        </div>

        {/* View Mode Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[
            { id: 'today', label: 'فيديو اليوم', icon: Play },
            { id: 'week', label: 'هذا الأسبوع', icon: Calendar },
            { id: 'calendar', label: 'التقويم', icon: Calendar }
          ].map((tab) => (
            <Button
              key={tab.id}
              variant={viewMode === tab.id ? 'default' : 'outline'}
              onClick={() => setViewMode(tab.id)}
              className={`gap-2 whitespace-nowrap ${
                darkMode && viewMode !== tab.id ? 'bg-gray-800 border-gray-700 text-white hover:bg-gray-700' : ''
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Today's Video View */}
        {viewMode === 'today' && (
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                <Play className="w-5 h-5 text-red-600" />
                فيديو اليوم - {format(today, 'EEEE d MMMM yyyy', { locale: ar })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {todayVideo ? (
                <div 
                  className="relative aspect-video rounded-xl overflow-hidden cursor-pointer group"
                  onClick={() => handlePlayVideo(todayVideo)}
                >
                  <img 
                    src={`https://img.youtube.com/vi/${todayVideo.youtube_video_id}/maxresdefault.jpg`}
                    alt={todayVideo.title_ar}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/50 transition-all">
                    <div className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center transform group-hover:scale-110 transition-transform">
                      <Play className="w-10 h-10 text-white mr-[-4px]" fill="white" />
                    </div>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                    <h3 className="text-white text-xl font-bold">{todayVideo.title_ar}</h3>
                    {todayVideo.description_ar && (
                      <p className="text-white/80 mt-2 line-clamp-2">{todayVideo.description_ar}</p>
                    )}
                    <div className="flex items-center gap-4 mt-3">
                      {todayVideo.activity_name && (
                        <Badge className="bg-blue-600">
                          <Activity className="w-3 h-3 ml-1" />
                          {todayVideo.activity_name}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="bg-white/20 text-white">
                        <Eye className="w-3 h-3 ml-1" />
                        {todayVideo.views_count || 0} مشاهدة
                      </Badge>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`text-center py-16 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  <Video className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">لا يوجد فيديو لهذا اليوم</p>
                  <p className="text-sm mt-2">تحقق من الأيام السابقة أو القادمة</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Week Videos View */}
        {viewMode === 'week' && (
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                <Calendar className="w-5 h-5" />
                فيديوهات هذا الأسبوع
              </CardTitle>
            </CardHeader>
            <CardContent>
              {weekVideos.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {weekVideos.map((video) => {
                    const videoDate = parseISO(video.scheduled_date);
                    const isToday = isSameDay(videoDate, today);
                    
                    return (
                      <Card 
                        key={video.id} 
                        className={`overflow-hidden cursor-pointer transition-all hover:shadow-lg ${
                          darkMode ? 'bg-gray-700 border-gray-600' : ''
                        } ${isToday ? 'ring-2 ring-blue-500' : ''}`}
                        onClick={() => handlePlayVideo(video)}
                      >
                        <div className="relative aspect-video">
                          <img 
                            src={`https://img.youtube.com/vi/${video.youtube_video_id}/mqdefault.jpg`}
                            alt={video.title_ar}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                            <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center">
                              <Play className="w-6 h-6 text-white mr-[-2px]" fill="white" />
                            </div>
                          </div>
                          {isToday && (
                            <Badge className="absolute top-2 right-2 bg-blue-600">
                              اليوم
                            </Badge>
                          )}
                        </div>
                        <CardContent className="p-3">
                          <p className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                            {format(videoDate, 'EEEE d MMMM', { locale: ar })}
                          </p>
                          <h3 className={`font-bold mt-1 truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            {video.title_ar}
                          </h3>
                          {video.activity_name && (
                            <Badge variant="outline" className={`mt-2 ${darkMode ? 'border-gray-600 text-gray-300' : ''}`}>
                              {video.activity_name}
                            </Badge>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <div className={`text-center py-12 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>لا توجد فيديوهات هذا الأسبوع</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Calendar View */}
        {viewMode === 'calendar' && (
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className={`flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                  <Calendar className="w-5 h-5" />
                  تقويم الفيديوهات
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                    className={darkMode ? 'bg-gray-700 border-gray-600 text-white hover:bg-gray-600' : ''}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <span className={`font-bold min-w-[140px] text-center ${darkMode ? 'text-white' : ''}`}>
                    {format(currentMonth, 'MMMM yyyy', { locale: ar })}
                  </span>
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                    className={darkMode ? 'bg-gray-700 border-gray-600 text-white hover:bg-gray-600' : ''}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Calendar Header */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {getDayNames().map(day => (
                  <div key={day} className={`text-center font-medium text-sm py-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {day}
                  </div>
                ))}
              </div>
              
              {/* Calendar Days */}
              <div className="grid grid-cols-7 gap-1">
                {/* Empty cells */}
                {Array.from({ length: startOfMonth(currentMonth).getDay() }).map((_, i) => (
                  <div key={`empty-${i}`} className={`h-20 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}`}></div>
                ))}
                
                {calendarDays.map(day => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const videoData = calendarVideos[dateStr];
                  const isCurrentDay = isSameDay(day, today);
                  const isPast = day < today;
                  
                  return (
                    <div
                      key={dateStr}
                      onClick={() => videoData && handleDateClick(day)}
                      className={`h-20 rounded-lg border transition-all overflow-hidden ${
                        videoData ? 'cursor-pointer' : ''
                      } ${isCurrentDay ? 'border-blue-500 border-2' : darkMode ? 'border-gray-700' : 'border-gray-200'} ${
                        videoData 
                          ? (darkMode ? 'bg-red-900/30 hover:bg-red-900/50' : 'bg-red-50 hover:bg-red-100') 
                          : (darkMode ? 'bg-gray-700' : 'bg-white')
                      } ${isPast && !videoData ? 'opacity-50' : ''}`}
                    >
                      <div className="p-1">
                        <span className={`text-sm font-medium ${
                          isCurrentDay ? 'text-blue-500' : darkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                          {format(day, 'd')}
                        </span>
                      </div>
                      
                      {videoData && (
                        <div className="px-1">
                          <img 
                            src={videoData.thumbnail}
                            alt={videoData.title_ar}
                            className="w-full h-10 object-cover rounded"
                          />
                        </div>
                      )}
                      
                      {videoData && (
                        <div className="absolute bottom-0 left-0 right-0 p-1">
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {/* Legend */}
              <div className={`flex items-center gap-4 mt-4 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <div className="flex items-center gap-1">
                  <div className={`w-4 h-4 rounded ${darkMode ? 'bg-red-900/50' : 'bg-red-100'}`}></div>
                  <span>يوجد فيديو</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded border-2 border-blue-500"></div>
                  <span>اليوم</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Video Player Dialog */}
        <Dialog open={videoDialogOpen} onOpenChange={setVideoDialogOpen}>
          <DialogContent className="max-w-4xl p-0 overflow-hidden" dir="rtl">
            <button
              onClick={() => setVideoDialogOpen(false)}
              className="absolute top-2 left-2 z-10 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white"
            >
              <X className="w-5 h-5" />
            </button>
            
            {selectedVideo && (
              <>
                <div className="aspect-video bg-black">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${selectedVideo.youtube_video_id}?autoplay=1&rel=0&modestbranding=1`}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title={selectedVideo.title_ar}
                  />
                </div>
                
                <div className={`p-4 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className={`font-bold text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {selectedVideo.title_ar}
                      </h3>
                      <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {format(parseISO(selectedVideo.scheduled_date), 'EEEE d MMMM yyyy', { locale: ar })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="gap-1">
                        <Eye className="w-3 h-3" />
                        {selectedVideo.views_count || 0}
                      </Badge>
                      {selectedVideo.activity_name && (
                        <Badge className="gap-1 bg-blue-600">
                          <Activity className="w-3 h-3" />
                          {selectedVideo.activity_name}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {selectedVideo.description_ar && (
                    <p className={`mt-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      {selectedVideo.description_ar}
                    </p>
                  )}
                  {selectedVideo.coach_name && (
                    <p className={`mt-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      المدرب: {selectedVideo.coach_name}
                    </p>
                  )}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MemberLayout>
  );
};

export default MemberDailyVideos;
