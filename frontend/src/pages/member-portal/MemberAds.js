import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent } from '../../components/ui/dialog';
import { X, ChevronLeft, ChevronRight, Play, ExternalLink, Volume2, VolumeX } from 'lucide-react';
import { memberAPI, getDarkMode } from './MemberLayout';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// Helper function to get proper image URL
const getImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('/api')) return `${BACKEND_URL}${url}`;
  return `${BACKEND_URL}/api${url}`;
};

// Hero Banner Carousel Component
export const HeroBannerAds = ({ branchId }) => {
  const [ads, setAds] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
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

  const nextSlide = () => setCurrentIndex(prev => (prev + 1) % ads.length);
  const prevSlide = () => setCurrentIndex(prev => (prev - 1 + ads.length) % ads.length);

  if (loading || ads.length === 0) return null;

  const currentAd = ads[currentIndex];

  return (
    <div className="relative w-full overflow-hidden rounded-xl mb-6">
      <div 
        className="relative w-full h-48 md:h-64 lg:h-80 cursor-pointer group"
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
              <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center">
                <Play className="w-8 h-8 text-white mr-[-2px]" fill="white" />
              </div>
            </div>
          </div>
        ) : currentAd.banner_image_url ? (
          <img 
            src={getImageUrl(currentAd.banner_image_url)}
            alt={currentAd.title_ar}
            className="w-full h-full object-cover"
          />
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
                  src={`${BACKEND_URL}${ad.banner_image_url}`}
                  alt={ad.title_ar}
                  className="w-full h-full object-cover"
                />
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
                  src={`${BACKEND_URL}${ad.banner_image_url}`}
                  alt={ad.title_ar}
                  className="w-full h-full object-cover"
                />
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
                src={`${BACKEND_URL}${ad.banner_image_url}`}
                alt={ad.title_ar}
                className="w-full"
              />
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
