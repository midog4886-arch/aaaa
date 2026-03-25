import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plyr } from 'plyr-react';
import 'plyr-react/plyr.css';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import MemberLayout, { memberAPI, getMemberData, getDarkMode } from './MemberLayout';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';
import { ar } from 'date-fns/locale';
import { 
  Video, Play, Calendar, Eye, ChevronLeft, ChevronRight, 
  X, Activity, Loader2
} from 'lucide-react';
import PullToRefresh from '../../components/PullToRefresh';
import InfiniteScroll from '../../components/InfiniteScroll';
import PushNotificationManager from '../../components/PushNotificationManager';

// Skeleton Component for Video Cards
const VideoCardSkeleton = ({ darkMode }) => (
  <div className={`rounded-xl overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-sm`}>
    <div className="aspect-video bg-gray-300 dark:bg-gray-700 animate-pulse" />
    <div className="p-4 space-y-3">
      <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded animate-pulse w-3/4" />
      <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded animate-pulse w-1/2" />
      <div className="flex gap-2">
        <div className="h-6 w-16 bg-gray-300 dark:bg-gray-700 rounded-full animate-pulse" />
        <div className="h-6 w-20 bg-gray-300 dark:bg-gray-700 rounded-full animate-pulse" />
      </div>
    </div>
  </div>
);

const MemberDailyVideos = () => {
  const [todayVideos, setTodayVideos] = useState([]);
  const [weekVideos, setWeekVideos] = useState([]);
  const [allVideos, setAllVideos] = useState([]);
  const [calendarVideos, setCalendarVideos] = useState({});
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedActivity, setSelectedActivity] = useState('all');
  const [viewMode, setViewMode] = useState('today');
  const [selectedDateVideos, setSelectedDateVideos] = useState([]);
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [playing, setPlaying] = useState(false);
  
  // Infinite scroll state
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const VIDEOS_PER_PAGE = 6;
  
  const member = getMemberData();
  const darkMode = getDarkMode();
  const today = new Date();

  const fetchData = useCallback(async (showToast = false) => {
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

      // API now returns array
      const todayData = Array.isArray(todayRes.data) ? todayRes.data : (todayRes.data ? [todayRes.data] : []);
      // Sort today videos by created_at (newest first)
      todayData.sort((a, b) => new Date(b.created_at || b.scheduled_date) - new Date(a.created_at || a.scheduled_date));
      setTodayVideos(todayData);
      
      const weekData = weekRes.data || [];
      // Sort week videos by scheduled_date (newest first)
      weekData.sort((a, b) => new Date(b.scheduled_date) - new Date(a.scheduled_date));
      setWeekVideos(weekData);
      
      // Set initial all videos for infinite scroll
      setAllVideos(weekData.slice(0, VIDEOS_PER_PAGE));
      setHasMore(weekData.length > VIDEOS_PER_PAGE);
      setPage(1);
      
      // Extract unique activities from videos
      const uniqueActivities = [];
      const seenIds = new Set();
      weekData.forEach(v => {
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
      
      if (showToast) {
        toast.success('تم تحديث الفيديوهات بنجاح');
      }
      
    } catch (error) {
      console.error('Failed to fetch videos:', error);
      if (showToast) {
        toast.error('فشل في تحديث الفيديوهات');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [member?.branch_id, currentMonth, selectedActivity]);

  // Load more videos for infinite scroll
  const loadMoreVideos = useCallback(() => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    
    // Simulate loading delay for better UX
    setTimeout(() => {
      const nextPage = page + 1;
      const startIndex = page * VIDEOS_PER_PAGE;
      const endIndex = startIndex + VIDEOS_PER_PAGE;
      const newVideos = weekVideos.slice(startIndex, endIndex);
      
      if (newVideos.length > 0) {
        setAllVideos(prev => [...prev, ...newVideos]);
        setPage(nextPage);
        setHasMore(endIndex < weekVideos.length);
      } else {
        setHasMore(false);
      }
      
      setLoadingMore(false);
    }, 500);
  }, [loadingMore, hasMore, page, weekVideos]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData(true);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePlayVideo = (video) => {
    setSelectedVideo(video);
    setVideoDialogOpen(true);
    setPlaying(true);
    
    // Record view and award loyalty points
    if (member && member.id) {
      memberAPI.post(`/api/daily-videos/${video.id}/view?member_id=${member.id}`).catch(() => {});
    } else {
      memberAPI.post(`/api/daily-videos/${video.id}/view`).catch(() => {});
    }
  };

  const handleDateClick = async (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayData = calendarVideos[dateStr];
    
    if (dayData && (dayData.count > 0 || dayData.has_video)) {
      setSelectedDate(date);
      try {
        const res = await memberAPI.get(`/api/daily-videos/by-date/${dateStr}`, {
          params: { branch_id: member?.branch_id }
        });
        if (res.data && res.data.length > 0) {
          if (res.data.length === 1) {
            handlePlayVideo(res.data[0]);
          } else {
            setSelectedDateVideos(res.data);
            setDateDialogOpen(true);
          }
        }
      } catch (error) {
        console.error('Failed to fetch videos:', error);
      }
    }
  };

  const calendarDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const getDayNames = () => ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  // Safe close handler - stops video before closing
  const handleCloseVideoDialog = useCallback(() => {
    setPlaying(false);
    setTimeout(() => {
      setVideoDialogOpen(false);
      setSelectedVideo(null);
    }, 100);
  }, []);

  // Helper: get video thumbnail based on platform
  const getVideoThumb = (video, quality = 'mqdefault') => {
    if (!video) return '/logo-new.png';
    if (video.video_platform === 'tiktok') return '/logo-new.png';
    return `https://img.youtube.com/vi/${video.youtube_video_id}/${quality}.jpg`;
  };

  // TikTok Video Player
  const TikTokPlayer = ({ video }) => {
    return (
      <div className="relative w-full flex justify-center bg-black rounded-lg overflow-hidden" style={{ minHeight: '500px' }}>
        <iframe
          src={`https://www.tiktok.com/embed/v2/${video.youtube_video_id}`}
          className="w-full max-w-sm"
          style={{ minHeight: '500px', border: 'none' }}
          allowFullScreen
          title={video.title_ar}
          allow="encrypted-media"
        />
      </div>
    );
  };

  // Professional Video Player Component using Plyr.io
  const VideoPlayer = ({ video }) => {
    const plyrRef = useRef(null);
    
    if (!video || !video.youtube_video_id) return null;

    // TikTok videos use iframe embed
    if (video.video_platform === 'tiktok') {
      return <TikTokPlayer video={video} />;
    }

    // Plyr options for clean, professional look
    const plyrOptions = {
      controls: [
        'play-large',    // زر التشغيل الكبير في الوسط
        'play',          // زر التشغيل
        'progress',      // شريط التقدم
        'current-time',  // الوقت الحالي
        'duration',      // المدة الكلية
        'mute',          // كتم الصوت
        'volume',        // مستوى الصوت
        'settings',      // الإعدادات
        'fullscreen'     // ملء الشاشة
      ],
      settings: ['quality', 'speed'],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      youtube: {
        noCookie: true,           // استخدام YouTube-nocookie للخصوصية
        rel: 0,                   // لا تعرض فيديوهات مقترحة
        showinfo: 0,              // إخفاء معلومات الفيديو
        iv_load_policy: 3,        // إخفاء التعليقات التوضيحية
        modestbranding: 1,        // إخفاء شعار يوتيوب
        playsinline: 1,           // تشغيل inline على الموبايل
        disablekb: 0,             // السماح باختصارات الكيبورد
        fs: 1,                    // السماح بملء الشاشة
        origin: window.location.origin
      },
      // تخصيص الألوان والمظهر
      tooltips: { controls: true, seek: true },
      keyboard: { focused: true, global: false },
      fullscreen: { enabled: true, fallback: true, iosNative: true }
    };

    const plyrSource = {
      type: 'video',
      sources: [
        {
          src: video.youtube_video_id,
          provider: 'youtube'
        }
      ]
    };
    
    return (
      <div className="plyr-container relative w-full aspect-video bg-black rounded-lg overflow-hidden">
        <Plyr
          ref={plyrRef}
          source={plyrSource}
          options={plyrOptions}
        />
        {/* Custom styling to make Plyr look cleaner */}
        <style>{`
          .plyr-container .plyr {
            --plyr-color-main: #3b82f6;
            --plyr-video-control-color: #ffffff;
            --plyr-video-control-background-hover: rgba(59, 130, 246, 0.8);
            --plyr-range-fill-background: #3b82f6;
            --plyr-badge-background: #3b82f6;
            --plyr-tooltip-background: #1e293b;
            --plyr-tooltip-color: #ffffff;
            --plyr-menu-background: #1e293b;
            --plyr-menu-color: #ffffff;
            border-radius: 0.5rem;
          }
          .plyr-container .plyr--youtube .plyr__poster {
            background-size: cover;
          }
          .plyr-container .plyr__control--overlaid {
            background: rgba(59, 130, 246, 0.9);
            border-radius: 50%;
            padding: 20px;
          }
          .plyr-container .plyr__control--overlaid:hover {
            background: rgba(59, 130, 246, 1);
          }
          .plyr-container .plyr__controls {
            background: linear-gradient(transparent, rgba(0,0,0,0.7));
          }
        `}</style>
      </div>
    );
  };

  if (loading) {
    return (
      <MemberLayout>
        <div className="space-y-6">
          {/* Skeleton Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className={`h-8 w-48 rounded animate-pulse ${darkMode ? 'bg-gray-700' : 'bg-gray-300'}`} />
              <div className={`h-4 w-64 rounded mt-2 animate-pulse ${darkMode ? 'bg-gray-700' : 'bg-gray-300'}`} />
            </div>
          </div>
          
          {/* Skeleton Video Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <VideoCardSkeleton key={i} darkMode={darkMode} />
            ))}
          </div>
        </div>
      </MemberLayout>
    );
  }

  return (
    <MemberLayout>
      <PullToRefresh onRefresh={handleRefresh} disabled={refreshing} className="min-h-[calc(100vh-200px)]">
      <div className="space-y-6">
        {/* Push Notifications Manager */}
        <PushNotificationManager memberId={member?.id} />

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
          
          {activities.length > 0 && (
            <Select value={selectedActivity} onValueChange={setSelectedActivity}>
              <SelectTrigger className={`w-[180px] ${darkMode ? 'bg-gray-800 border-gray-700 text-white' : ''}`}>
                <SelectValue placeholder="جميع الأنشطة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الأنشطة</SelectItem>
                {activities.filter(a => a.id).map((activity) => (
                  <SelectItem key={activity.id} value={activity.id}>
                    {activity.name_ar || activity.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* View Mode Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[
            { id: 'today', label: `فيديوهات اليوم${todayVideos.length > 0 ? ` (${todayVideos.length})` : ''}`, icon: Play },
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

        {/* Today's Videos View */}
        {viewMode === 'today' && (
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                <Play className="w-5 h-5 text-red-600" />
                فيديوهات اليوم - {format(today, 'EEEE d MMMM yyyy', { locale: ar })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {todayVideos.length > 0 ? (
                <div className="space-y-6">
                  {/* Featured Video (first one) */}
                  <div 
                    className="relative aspect-video rounded-xl overflow-hidden cursor-pointer group"
                    onClick={() => handlePlayVideo(todayVideos[0])}
                  >
                    <img 
                      src={getVideoThumb(todayVideos[0], 'maxresdefault')}
                      alt={todayVideos[0].title_ar}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/50 transition-all">
                      <div className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center transform group-hover:scale-110 transition-transform">
                        <Play className="w-10 h-10 text-white mr-[-4px]" fill="white" />
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                      <h3 className="text-white text-xl font-bold">{todayVideos[0].title_ar}</h3>
                      {todayVideos[0].description_ar && (
                        <p className="text-white/80 mt-2 line-clamp-2">{todayVideos[0].description_ar}</p>
                      )}
                      <div className="flex items-center gap-4 mt-3">
                        {todayVideos[0].activity_name && (
                          <Badge className="bg-blue-600">
                            <Activity className="w-3 h-3 ml-1" />
                            {todayVideos[0].activity_name}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="bg-white/20 text-white">
                          <Eye className="w-3 h-3 ml-1" />
                          {todayVideos[0].views_count || 0} مشاهدة
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Other Videos */}
                  {todayVideos.length > 1 && (
                    <div>
                      <h4 className={`font-bold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        فيديوهات أخرى اليوم ({todayVideos.length - 1})
                      </h4>
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {todayVideos.slice(1).map((video) => (
                          <Card 
                            key={video.id}
                            className={`overflow-hidden cursor-pointer transition-all hover:shadow-lg ${
                              darkMode ? 'bg-gray-700 border-gray-600' : ''
                            }`}
                            onClick={() => handlePlayVideo(video)}
                          >
                            <div className="relative aspect-video">
                              <img 
                                src={getVideoThumb(video)}
                                alt={video.title_ar}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center">
                                  <Play className="w-6 h-6 text-white mr-[-2px]" fill="white" />
                                </div>
                              </div>
                            </div>
                            <CardContent className="p-3">
                              <h3 className={`font-bold truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                {video.title_ar}
                              </h3>
                              {video.activity_name && (
                                <Badge variant="outline" className={`mt-2 ${darkMode ? 'border-gray-600 text-gray-300' : ''}`}>
                                  {video.activity_name}
                                </Badge>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className={`text-center py-16 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  <Video className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">لا توجد فيديوهات لهذا اليوم</p>
                  <p className="text-sm mt-2">تحقق من الأيام السابقة أو القادمة</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Week Videos View with Infinite Scroll */}
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
                <InfiniteScroll
                  loadMore={loadMoreVideos}
                  hasMore={hasMore}
                  isLoading={loadingMore}
                  loadingText="جاري تحميل المزيد من الفيديوهات..."
                  endText="لا يوجد المزيد من الفيديوهات"
                >
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {allVideos.map((video, index) => {
                      const videoDate = parseISO(video.scheduled_date);
                      const isToday = isSameDay(videoDate, today);
                      
                      return (
                        <motion.div
                          key={video.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: (index % VIDEOS_PER_PAGE) * 0.05 }}
                        >
                          <Card 
                            className={`overflow-hidden cursor-pointer transition-all hover:shadow-lg ${
                              darkMode ? 'bg-gray-700 border-gray-600' : ''
                            } ${isToday ? 'ring-2 ring-blue-500' : ''}`}
                            onClick={() => handlePlayVideo(video)}
                          >
                            <div className="relative aspect-video">
                              <img 
                                src={getVideoThumb(video)}
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
                        </motion.div>
                      );
                    })}
                  </div>
                </InfiniteScroll>
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
                  <div key={`empty-${i}`} className={`h-24 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}`}></div>
                ))}
                
                {calendarDays.map(day => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const dayData = calendarVideos[dateStr];
                  const isCurrentDay = isSameDay(day, today);
                  const isPast = day < today;
                  const videoCount = dayData?.count || 0;
                  
                  return (
                    <div
                      key={dateStr}
                      onClick={() => dayData && handleDateClick(day)}
                      className={`h-24 rounded-lg border transition-all overflow-hidden ${
                        dayData ? 'cursor-pointer' : ''
                      } ${isCurrentDay ? 'border-blue-500 border-2' : darkMode ? 'border-gray-700' : 'border-gray-200'} ${
                        dayData 
                          ? (darkMode ? 'bg-red-900/30 hover:bg-red-900/50' : 'bg-red-50 hover:bg-red-100') 
                          : (darkMode ? 'bg-gray-700' : 'bg-white')
                      } ${isPast && !dayData ? 'opacity-50' : ''}`}
                    >
                      <div className="p-1 flex justify-between items-start">
                        <span className={`text-sm font-medium ${
                          isCurrentDay ? 'text-blue-500' : darkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                          {format(day, 'd')}
                        </span>
                        {videoCount > 1 && (
                          <Badge className="text-xs bg-red-600">{videoCount}</Badge>
                        )}
                      </div>
                      
                      {dayData && dayData.videos && dayData.videos[0] && (
                        <div className="px-1">
                          <img 
                            src={dayData.videos[0].thumbnail}
                            alt=""
                            className="w-full h-10 object-cover rounded"
                          />
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
                <div className="flex items-center gap-1">
                  <Badge className="text-xs bg-red-600">2</Badge>
                  <span>عدة فيديوهات</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Video Player Dialog */}
        <Dialog open={videoDialogOpen} onOpenChange={(open) => {
          if (!open) {
            handleCloseVideoDialog();
          }
        }}>
          <DialogContent className="max-w-4xl p-0 overflow-hidden" dir="rtl">
            <VisuallyHidden>
              <DialogTitle>{selectedVideo?.title_ar || 'فيديو'}</DialogTitle>
            </VisuallyHidden>
            <button
              onClick={handleCloseVideoDialog}
              className="absolute top-2 left-2 z-20 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white"
            >
              <X className="w-5 h-5" />
            </button>
            
            {selectedVideo && (
              <>
                <VideoPlayer video={selectedVideo} />
                
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

        {/* Multiple Videos for Date Dialog */}
        <Dialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}>
          <DialogContent className="max-w-2xl" dir="rtl">
            <VisuallyHidden>
              <DialogTitle>فيديوهات اليوم</DialogTitle>
            </VisuallyHidden>
            <button
              onClick={() => setDateDialogOpen(false)}
              className="absolute top-2 left-2 z-10 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="pt-4">
              <h3 className={`font-bold text-lg mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {selectedDate && format(selectedDate, 'EEEE d MMMM yyyy', { locale: ar })}
                <span className="text-gray-500 font-normal mr-2">({selectedDateVideos.length} فيديوهات)</span>
              </h3>
              
              <div className="grid gap-4 max-h-[60vh] overflow-y-auto">
                {selectedDateVideos.map((video) => (
                  <Card 
                    key={video.id}
                    className={`overflow-hidden cursor-pointer transition-all hover:shadow-lg ${
                      darkMode ? 'bg-gray-700 border-gray-600' : ''
                    }`}
                    onClick={() => {
                      setDateDialogOpen(false);
                      handlePlayVideo(video);
                    }}
                  >
                    <div className="flex gap-4 p-3">
                      <div className="relative w-40 aspect-video flex-shrink-0 rounded overflow-hidden">
                        <img 
                          src={`https://img.youtube.com/vi/${video.youtube_video_id}/mqdefault.jpg`}
                          alt={video.title_ar}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                          <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center">
                            <Play className="w-5 h-5 text-white mr-[-2px]" fill="white" />
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className={`font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {video.title_ar}
                        </h4>
                        {video.description_ar && (
                          <p className={`text-sm mt-1 line-clamp-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {video.description_ar}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          {video.activity_name && (
                            <Badge variant="outline" className={darkMode ? 'border-gray-600 text-gray-300' : ''}>
                              {video.activity_name}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="gap-1">
                            <Eye className="w-3 h-3" />
                            {video.views_count || 0}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      </PullToRefresh>
    </MemberLayout>
  );
};

export default MemberDailyVideos;
