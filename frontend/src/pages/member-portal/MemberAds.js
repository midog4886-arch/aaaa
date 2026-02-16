import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent } from '../../components/ui/dialog';
import { X, ChevronLeft, ChevronRight, Play, ExternalLink, Volume2, VolumeX, Plus } from 'lucide-react';
import { memberAPI, getDarkMode } from './MemberLayout';
import { motion, AnimatePresence } from 'framer-motion';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// Helper function to get proper image URL
const getImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('/api')) return `${BACKEND_URL}${url}`;
  return `${BACKEND_URL}/api${url}`;
};

// ==========================================
// 📱 STORIES ADS COMPONENT (Instagram Style)
// ==========================================
export const StoriesAds = ({ branchId }) => {
  const [stories, setStories] = useState([]);
  const [selectedStory, setSelectedStory] = useState(null);
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const progressRef = useRef(null);
  const darkMode = getDarkMode();
  const STORY_DURATION = 5000; // 5 seconds per story

  useEffect(() => {
    fetchStories();
  }, [branchId]);

  const fetchStories = async () => {
    try {
      const res = await memberAPI.get('/api/advertisements/public', {
        params: { position: 'story', branch_id: branchId }
      });
      setStories(res.data);
    } catch (error) {
      console.error('Failed to fetch stories');
    } finally {
      setLoading(false);
    }
  };

  // Auto-advance story
  useEffect(() => {
    if (!selectedStory || isPaused) return;

    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / STORY_DURATION) * 100, 100);
      setProgress(newProgress);

      if (newProgress >= 100) {
        handleNextStory();
      } else {
        progressRef.current = requestAnimationFrame(animate);
      }
    };

    progressRef.current = requestAnimationFrame(animate);

    return () => {
      if (progressRef.current) {
        cancelAnimationFrame(progressRef.current);
      }
    };
  }, [selectedStory, currentStoryIndex, isPaused]);

  const handleOpenStory = async (story, index) => {
    setSelectedStory(story);
    setCurrentStoryIndex(index);
    setProgress(0);
    // Record view
    await memberAPI.post(`/api/advertisements/${story.id}/view`).catch(() => {});
  };

  const handleNextStory = () => {
    if (currentStoryIndex < stories.length - 1) {
      const nextIndex = currentStoryIndex + 1;
      setCurrentStoryIndex(nextIndex);
      setSelectedStory(stories[nextIndex]);
      setProgress(0);
      memberAPI.post(`/api/advertisements/${stories[nextIndex].id}/view`).catch(() => {});
    } else {
      handleCloseStory();
    }
  };

  const handlePrevStory = () => {
    if (currentStoryIndex > 0) {
      const prevIndex = currentStoryIndex - 1;
      setCurrentStoryIndex(prevIndex);
      setSelectedStory(stories[prevIndex]);
      setProgress(0);
    }
  };

  const handleCloseStory = () => {
    setSelectedStory(null);
    setProgress(0);
    setIsPaused(false);
  };

  const handleStoryClick = async () => {
    if (selectedStory?.link_url) {
      await memberAPI.post(`/api/advertisements/${selectedStory.id}/click`).catch(() => {});
      window.open(selectedStory.link_url, '_blank');
    }
  };

  if (loading || stories.length === 0) return null;

  return (
    <>
      {/* Stories Circles */}
      <div className="mb-6">
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide px-1">
          {stories.map((story, index) => {
            const hasImage = story.banner_image_url || story.youtube_video_id;
            const thumbnailUrl = story.youtube_video_id 
              ? `https://img.youtube.com/vi/${story.youtube_video_id}/mqdefault.jpg`
              : story.banner_image_url ? getImageUrl(story.banner_image_url) : null;

            return (
              <motion.button
                key={story.id}
                onClick={() => handleOpenStory(story, index)}
                className="flex flex-col items-center gap-2 flex-shrink-0"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {/* Story Circle with Gradient Ring */}
                <div className="relative">
                  <div className="w-20 h-20 rounded-full p-[3px] bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
                    <div className={`w-full h-full rounded-full p-[2px] ${darkMode ? 'bg-gray-900' : 'bg-white'}`}>
                      {thumbnailUrl ? (
                        <img 
                          src={thumbnailUrl}
                          alt={story.title_ar}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                          <span className="text-white text-2xl font-bold">
                            {story.title_ar?.charAt(0) || '📢'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Play icon for videos */}
                  {story.youtube_video_id && (
                    <div className="absolute bottom-0 right-0 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center border-2 border-white">
                      <Play className="w-3 h-3 text-white" fill="white" />
                    </div>
                  )}
                </div>
                {/* Story Title */}
                <span className={`text-xs font-medium text-center w-20 line-clamp-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {story.title_ar || 'عرض'}
                </span>
              </motion.button>
            );
          })}
          
          {/* Add Story Placeholder */}
          <div className="flex flex-col items-center gap-2 flex-shrink-0 opacity-50">
            <div className={`w-20 h-20 rounded-full border-2 border-dashed ${darkMode ? 'border-gray-600' : 'border-gray-300'} flex items-center justify-center`}>
              <Plus className={`w-8 h-8 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
            </div>
            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>قريباً</span>
          </div>
        </div>
      </div>

      {/* Fullscreen Story Viewer */}
      <AnimatePresence>
        {selectedStory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black"
            onClick={handleStoryClick}
            onMouseDown={() => setIsPaused(true)}
            onMouseUp={() => setIsPaused(false)}
            onTouchStart={() => setIsPaused(true)}
            onTouchEnd={() => setIsPaused(false)}
          >
            {/* Progress Bars */}
            <div className="absolute top-0 left-0 right-0 z-10 flex gap-1 p-2">
              {stories.map((_, idx) => (
                <div key={idx} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-white rounded-full transition-all"
                    style={{ 
                      width: idx < currentStoryIndex ? '100%' : 
                             idx === currentStoryIndex ? `${progress}%` : '0%' 
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Header */}
            <div className="absolute top-6 left-0 right-0 z-10 flex items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center">
                  <span className="text-white font-bold">🏆</span>
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{selectedStory.title_ar}</p>
                  <p className="text-white/60 text-xs">أكاديمية أداء الأبطال</p>
                </div>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); handleCloseStory(); }}
                className="w-10 h-10 flex items-center justify-center"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>

            {/* Story Content */}
            <div className="absolute inset-0 flex items-center justify-center">
              {selectedStory.youtube_video_id ? (
                <iframe
                  src={`https://www.youtube.com/embed/${selectedStory.youtube_video_id}?autoplay=1&mute=1`}
                  className="w-full h-full"
                  allow="autoplay; encrypted-media"
                  allowFullScreen
                />
              ) : selectedStory.banner_image_url ? (
                <img 
                  src={getImageUrl(selectedStory.banner_image_url)}
                  alt={selectedStory.title_ar}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-center text-white p-8">
                  <h2 className="text-3xl font-bold mb-4">{selectedStory.title_ar}</h2>
                  {selectedStory.description_ar && (
                    <p className="text-xl opacity-90">{selectedStory.description_ar}</p>
                  )}
                </div>
              )}
            </div>

            {/* Navigation Areas */}
            <div className="absolute inset-0 flex z-5">
              <div className="w-1/3 h-full" onClick={(e) => { e.stopPropagation(); handlePrevStory(); }} />
              <div className="w-1/3 h-full" />
              <div className="w-1/3 h-full" onClick={(e) => { e.stopPropagation(); handleNextStory(); }} />
            </div>

            {/* Bottom Info */}
            {selectedStory.description_ar && (
              <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-white text-lg">{selectedStory.description_ar}</p>
                {selectedStory.link_url && (
                  <div className="mt-4 flex justify-center">
                    <button className="bg-white text-black px-6 py-2 rounded-full font-semibold flex items-center gap-2">
                      <span>عرض المزيد</span>
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Swipe Up Indicator */}
            {selectedStory.link_url && (
              <motion.div 
                className="absolute bottom-20 left-1/2 -translate-x-1/2"
                animate={{ y: [0, -10, 0] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                <ChevronLeft className="w-8 h-8 text-white rotate-90" />
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

// ==========================================
// 🎠 ENHANCED CAROUSEL COMPONENT
// ==========================================
export const HeroBannerAds = ({ branchId }) => {
  const [ads, setAds] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState(0);
  const intervalRef = useRef(null);
  const darkMode = getDarkMode();

  useEffect(() => {
    fetchAds();
  }, [branchId]);

  const fetchAds = async () => {
    try {
      const res = await memberAPI.get('/api/advertisements/public', {
        params: { position: 'hero', branch_id: branchId }
      });
      setAds(res.data);
      
      // Record views for all ads
      res.data.forEach(ad => {
        memberAPI.post(`/api/advertisements/${ad.id}/view`).catch(() => {});
      });
    } catch (error) {
      console.error('Failed to fetch hero ads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ads.length > 1) {
      intervalRef.current = setInterval(() => {
        setDirection(1);
        setCurrentIndex(prev => (prev + 1) % ads.length);
      }, 5000);
    }
    return () => clearInterval(intervalRef.current);
  }, [ads.length]);

  const handleClick = async (ad) => {
    await memberAPI.post(`/api/advertisements/${ad.id}/click`).catch(() => {});
    if (ad.link_url) {
      window.open(ad.link_url, '_blank');
    }
  };

  const nextSlide = () => {
    setDirection(1);
    setCurrentIndex(prev => (prev + 1) % ads.length);
  };
  
  const prevSlide = () => {
    setDirection(-1);
    setCurrentIndex(prev => (prev - 1 + ads.length) % ads.length);
  };

  if (loading || ads.length === 0) return null;

  const currentAd = ads[currentIndex];

  // Animation variants for slide effect
  const slideVariants = {
    enter: (direction) => ({
      x: direction > 0 ? '100%' : '-100%',
      opacity: 0
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1
    },
    exit: (direction) => ({
      zIndex: 0,
      x: direction < 0 ? '100%' : '-100%',
      opacity: 0
    })
  };

  return (
    <div className="relative w-full overflow-hidden rounded-2xl mb-6 shadow-xl">
      {/* Progress Bar */}
      {ads.length > 1 && (
        <div className="absolute top-0 left-0 right-0 z-20 h-1 bg-white/20">
          <motion.div 
            className="h-full bg-gradient-to-r from-orange-500 to-pink-500"
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: 5, ease: 'linear' }}
            key={currentIndex}
          />
        </div>
      )}

      <AnimatePresence initial={false} custom={direction}>
        <motion.div 
          key={currentIndex}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            x: { type: "spring", stiffness: 300, damping: 30 },
            opacity: { duration: 0.2 }
          }}
          className="relative w-full h-52 md:h-72 lg:h-96 cursor-pointer group"
          onClick={() => handleClick(currentAd)}
        >
          {currentAd.ad_type === 'video' && currentAd.youtube_video_id ? (
            <div className="relative w-full h-full">
              <img 
                src={`https://img.youtube.com/vi/${currentAd.youtube_video_id}/maxresdefault.jpg`}
                alt={currentAd.title_ar}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/40 transition-all">
                <motion.div 
                  className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-lg"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <Play className="w-10 h-10 text-white mr-[-4px]" fill="white" />
                </motion.div>
              </div>
            </div>
          ) : currentAd.banner_image_url ? (
            <img 
              src={getImageUrl(currentAd.banner_image_url)}
              alt={currentAd.title_ar}
              className="w-full h-full object-cover"
            />
          ) : currentAd.ad_type === 'link' && currentAd.link_url ? (
            <div className={`w-full h-full flex flex-col items-center justify-center ${darkMode ? 'bg-gray-700' : 'bg-gradient-to-br from-blue-600 via-purple-600 to-pink-500'}`}>
              <motion.div 
                className="text-center text-white p-6"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <motion.div 
                  className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm"
                  animate={{ y: [0, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                >
                  <ExternalLink className="w-12 h-12 text-white" />
                </motion.div>
                <h3 className="text-3xl font-bold">{currentAd.title_ar}</h3>
              {currentAd.description_ar && (
                <p className="mt-2 opacity-90">{currentAd.description_ar}</p>
              )}
              <div className="mt-4 inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 px-6 py-3 rounded-full transition-all">
                <span className="font-medium">اضغط للزيارة</span>
                <ExternalLink className="w-5 h-5" />
              </div>
            </div>
          </div>
        ) : (
          <div className={`w-full h-full flex items-center justify-center ${darkMode ? 'bg-gray-700' : 'bg-gradient-to-br from-blue-600 to-purple-700'}`}>
            <div className="text-center text-white p-6">
              <h3 className="text-2xl font-bold">{currentAd.title_ar}</h3>
              {currentAd.description_ar && (
                <p className="mt-2 opacity-90">{currentAd.description_ar}</p>
              )}
            </div>
          </div>
        )}

        {/* Overlay with title */}
        {(currentAd.banner_image_url || currentAd.youtube_video_id) && currentAd.title_ar && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
            <h3 className="text-white font-bold text-lg">{currentAd.title_ar}</h3>
            {currentAd.description_ar && (
              <p className="text-white/80 text-sm mt-1 line-clamp-1">{currentAd.description_ar}</p>
            )}
          </div>
        )}

        {/* Link indicator */}
        {currentAd.link_url && (
          <div className="absolute top-4 left-4 bg-white/90 rounded-full p-2">
            <ExternalLink className="w-4 h-4 text-gray-700" />
          </div>
        )}
      </div>

      {/* Navigation Arrows */}
      {ads.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prevSlide(); }}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 hover:bg-white rounded-full flex items-center justify-center shadow-lg transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); nextSlide(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 hover:bg-white rounded-full flex items-center justify-center shadow-lg transition-all"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Dots Indicator */}
      {ads.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {ads.map((_, idx) => (
            <button
              key={idx}
              onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx); }}
              className={`w-2 h-2 rounded-full transition-all ${
                idx === currentIndex ? 'bg-white w-6' : 'bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Inline Ads Component (between content sections)
export const InlineAds = ({ branchId, maxAds = 2 }) => {
  const [ads, setAds] = useState([]);
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const darkMode = getDarkMode();

  useEffect(() => {
    fetchAds();
  }, [branchId]);

  const fetchAds = async () => {
    try {
      const res = await memberAPI.get('/api/advertisements/public', {
        params: { position: 'inline', branch_id: branchId }
      });
      setAds(res.data.slice(0, maxAds));
      
      res.data.slice(0, maxAds).forEach(ad => {
        memberAPI.post(`/api/advertisements/${ad.id}/view`).catch(() => {});
      });
    } catch (error) {
      console.error('Failed to fetch inline ads');
    }
  };

  const handleClick = async (ad) => {
    await memberAPI.post(`/api/advertisements/${ad.id}/click`).catch(() => {});
    
    if (ad.ad_type === 'video' && ad.youtube_video_id) {
      setSelectedVideo(ad);
      setVideoDialogOpen(true);
    } else if (ad.link_url) {
      window.open(ad.link_url, '_blank');
    }
  };

  if (ads.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
        {ads.map((ad) => (
          <Card 
            key={ad.id}
            className={`overflow-hidden cursor-pointer transition-all hover:shadow-lg ${
              darkMode ? 'bg-gray-800 border-gray-700' : ''
            }`}
            onClick={() => handleClick(ad)}
          >
            <div className="relative h-40">
              {ad.ad_type === 'video' && ad.youtube_video_id ? (
                <>
                  <img 
                    src={`https://img.youtube.com/vi/${ad.youtube_video_id}/mqdefault.jpg`}
                    alt={ad.title_ar}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                    <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center">
                      <Play className="w-6 h-6 text-white mr-[-2px]" fill="white" />
                    </div>
                  </div>
                </>
              ) : ad.banner_image_url ? (
                <img 
                  src={getImageUrl(ad.banner_image_url)}
                  alt={ad.title_ar}
                  className="w-full h-full object-cover"
                />
              ) : ad.ad_type === 'link' && ad.link_url ? (
                <div className={`w-full h-full flex flex-col items-center justify-center ${
                  darkMode ? 'bg-gray-700' : 'bg-gradient-to-br from-blue-500 to-purple-600'
                }`}>
                  <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-2">
                    <ExternalLink className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-white font-bold text-lg">{ad.title_ar}</span>
                  <span className="text-white/70 text-sm mt-1">اضغط للزيارة</span>
                </div>
              ) : (
                <div className={`w-full h-full flex items-center justify-center ${
                  darkMode ? 'bg-gray-700' : 'bg-gradient-to-br from-blue-500 to-purple-600'
                }`}>
                  <span className="text-white font-bold text-lg">{ad.title_ar}</span>
                </div>
              )}
            </div>
            <CardContent className="p-3">
              <h4 className={`font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{ad.title_ar}</h4>
              {ad.description_ar && (
                <p className={`text-sm mt-1 line-clamp-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {ad.description_ar}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Video Dialog */}
      <VideoPlayerDialog 
        open={videoDialogOpen}
        onClose={() => setVideoDialogOpen(false)}
        video={selectedVideo}
      />
    </>
  );
};

// Sidebar Ads Component
export const SidebarAds = ({ branchId }) => {
  const [ads, setAds] = useState([]);
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const darkMode = getDarkMode();

  useEffect(() => {
    fetchAds();
  }, [branchId]);

  const fetchAds = async () => {
    try {
      const res = await memberAPI.get('/api/advertisements/public', {
        params: { position: 'sidebar', branch_id: branchId }
      });
      setAds(res.data);
      
      res.data.forEach(ad => {
        memberAPI.post(`/api/advertisements/${ad.id}/view`).catch(() => {});
      });
    } catch (error) {
      console.error('Failed to fetch sidebar ads');
    }
  };

  const handleClick = async (ad) => {
    await memberAPI.post(`/api/advertisements/${ad.id}/click`).catch(() => {});
    
    if (ad.ad_type === 'video' && ad.youtube_video_id) {
      setSelectedVideo(ad);
      setVideoDialogOpen(true);
    } else if (ad.link_url) {
      window.open(ad.link_url, '_blank');
    }
  };

  if (ads.length === 0) return null;

  return (
    <>
      <div className="space-y-4">
        {ads.map((ad) => (
          <Card 
            key={ad.id}
            className={`overflow-hidden cursor-pointer transition-all hover:shadow-lg ${
              darkMode ? 'bg-gray-800 border-gray-700' : ''
            }`}
            onClick={() => handleClick(ad)}
          >
            <div className="relative aspect-video">
              {ad.ad_type === 'video' && ad.youtube_video_id ? (
                <>
                  <img 
                    src={`https://img.youtube.com/vi/${ad.youtube_video_id}/mqdefault.jpg`}
                    alt={ad.title_ar}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                    <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center">
                      <Play className="w-5 h-5 text-white mr-[-2px]" fill="white" />
                    </div>
                  </div>
                </>
              ) : ad.banner_image_url ? (
                <img 
                  src={getImageUrl(ad.banner_image_url)}
                  alt={ad.title_ar}
                  className="w-full h-full object-cover"
                />
              ) : ad.ad_type === 'link' && ad.link_url ? (
                <div className={`w-full h-full flex flex-col items-center justify-center p-4 ${
                  darkMode ? 'bg-gray-700' : 'bg-gradient-to-br from-orange-500 to-red-600'
                }`}>
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center mb-2">
                    <ExternalLink className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-white font-bold text-center">{ad.title_ar}</span>
                  <span className="text-white/70 text-xs mt-1">اضغط للزيارة</span>
                </div>
              ) : (
                <div className={`w-full h-full flex items-center justify-center p-4 ${
                  darkMode ? 'bg-gray-700' : 'bg-gradient-to-br from-orange-500 to-red-600'
                }`}>
                  <span className="text-white font-bold text-center">{ad.title_ar}</span>
                </div>
              )}
            </div>
            <CardContent className="p-3">
              <p className={`font-medium text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {ad.title_ar}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <VideoPlayerDialog 
        open={videoDialogOpen}
        onClose={() => setVideoDialogOpen(false)}
        video={selectedVideo}
      />
    </>
  );
};

// Popup Ad Component
export const PopupAd = ({ branchId }) => {
  const [ad, setAd] = useState(null);
  const [show, setShow] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

  useEffect(() => {
    // Check if popup was shown in this session
    const popupShown = sessionStorage.getItem('popup_ad_shown');
    if (!popupShown) {
      fetchAd();
    }
  }, [branchId]);

  const fetchAd = async () => {
    try {
      const res = await memberAPI.get('/api/advertisements/public', {
        params: { position: 'popup', branch_id: branchId }
      });
      if (res.data.length > 0) {
        const popupAd = res.data[0];
        setAd(popupAd);
        
        // Show popup after a delay
        setTimeout(() => {
          setShow(true);
          memberAPI.post(`/api/advertisements/${popupAd.id}/view`).catch(() => {});
          sessionStorage.setItem('popup_ad_shown', 'true');
        }, 3000);
      }
    } catch (error) {
      console.error('Failed to fetch popup ad');
    }
  };

  const handleClick = async () => {
    if (ad) {
      await memberAPI.post(`/api/advertisements/${ad.id}/click`).catch(() => {});
      if (ad.ad_type === 'video' && ad.youtube_video_id) {
        setVideoPlaying(true);
      } else if (ad.link_url) {
        window.open(ad.link_url, '_blank');
      }
    }
  };

  const handleClose = () => {
    setShow(false);
    setVideoPlaying(false);
  };

  if (!show || !ad) return null;

  return (
    <Dialog open={show} onOpenChange={setShow}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden" dir="rtl">
        <button
          onClick={handleClose}
          className="absolute top-2 left-2 z-10 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white"
        >
          <X className="w-5 h-5" />
        </button>

        {videoPlaying && ad.youtube_video_id ? (
          <div className="aspect-video">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${ad.youtube_video_id}?autoplay=1&rel=0&modestbranding=1`}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title={ad.title_ar}
            />
          </div>
        ) : (
          <div className="cursor-pointer" onClick={handleClick}>
            {ad.ad_type === 'video' && ad.youtube_video_id ? (
              <div className="relative aspect-video">
                <img 
                  src={`https://img.youtube.com/vi/${ad.youtube_video_id}/maxresdefault.jpg`}
                  alt={ad.title_ar}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center hover:scale-110 transition-transform">
                    <Play className="w-8 h-8 text-white mr-[-2px]" fill="white" />
                  </div>
                </div>
              </div>
            ) : ad.banner_image_url ? (
              <img 
                src={getImageUrl(ad.banner_image_url)}
                alt={ad.title_ar}
                className="w-full"
              />
            ) : ad.ad_type === 'link' && ad.link_url ? (
              <div className="aspect-video bg-gradient-to-br from-blue-600 to-purple-700 flex items-center justify-center p-8">
                <div className="text-center text-white">
                  <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <ExternalLink className="w-10 h-10 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold">{ad.title_ar}</h3>
                  {ad.description_ar && (
                    <p className="mt-3 opacity-90">{ad.description_ar}</p>
                  )}
                  <div className="mt-4 inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 px-6 py-3 rounded-full transition-all">
                    <span className="font-medium">اضغط للزيارة</span>
                    <ExternalLink className="w-5 h-5" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="aspect-video bg-gradient-to-br from-blue-600 to-purple-700 flex items-center justify-center p-8">
                <div className="text-center text-white">
                  <h3 className="text-2xl font-bold">{ad.title_ar}</h3>
                  {ad.description_ar && (
                    <p className="mt-3 opacity-90">{ad.description_ar}</p>
                  )}
                </div>
              </div>
            )}

            {ad.title_ar && (ad.banner_image_url || ad.youtube_video_id) && (
              <div className="p-4 bg-white">
                <h3 className="font-bold text-lg text-gray-900">{ad.title_ar}</h3>
                {ad.description_ar && (
                  <p className="text-gray-600 mt-1">{ad.description_ar}</p>
                )}
                {ad.link_url && (
                  <Button className="mt-3 gap-2">
                    <ExternalLink className="w-4 h-4" />
                    المزيد
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// Video Player Dialog Component
const VideoPlayerDialog = ({ open, onClose, video }) => {
  if (!video || !video.youtube_video_id) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden" dir="rtl">
        <button
          onClick={onClose}
          className="absolute top-2 left-2 z-10 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white"
        >
          <X className="w-5 h-5" />
        </button>
        
        <div className="aspect-video bg-black">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video.youtube_video_id}?autoplay=1&rel=0&modestbranding=1`}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={video.title_ar}
          />
        </div>
        
        {video.title_ar && (
          <div className="p-4 bg-white">
            <h3 className="font-bold text-lg text-gray-900">{video.title_ar}</h3>
            {video.description_ar && (
              <p className="text-gray-600 mt-1">{video.description_ar}</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default {
  HeroBannerAds,
  InlineAds,
  SidebarAds,
  PopupAd
};
