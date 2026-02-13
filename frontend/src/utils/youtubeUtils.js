/**
 * YouTube URL Utility Functions
 * استخراج VIDEO_ID من أي رابط يوتيوب وتوليد رابط Embed احترافي
 */

/**
 * استخراج VIDEO_ID من أي رابط يوتيوب
 * يدعم جميع أنواع الروابط:
 * - Standard: https://www.youtube.com/watch?v=VIDEO_ID
 * - Mobile: https://m.youtube.com/watch?v=VIDEO_ID
 * - Short: https://youtu.be/VIDEO_ID
 * - Embed: https://www.youtube.com/embed/VIDEO_ID
 * - With timestamp: https://www.youtube.com/watch?v=VIDEO_ID&t=120
 * - With playlist: https://www.youtube.com/watch?v=VIDEO_ID&list=PLAYLIST_ID
 * 
 * @param {string} url - رابط اليوتيوب
 * @returns {string|null} - VIDEO_ID أو null إذا لم يتم العثور عليه
 */
export const extractYouTubeVideoId = (url) => {
  if (!url || typeof url !== 'string') {
    return null;
  }

  // إذا كان المدخل هو VIDEO_ID فقط (11 حرف)
  const videoIdRegex = /^[a-zA-Z0-9_-]{11}$/;
  if (videoIdRegex.test(url.trim())) {
    return url.trim();
  }

  try {
    // أنماط الروابط المختلفة
    const patterns = [
      // Standard & Mobile: youtube.com/watch?v=VIDEO_ID
      /(?:youtube\.com\/watch\?v=|youtube\.com\/watch\?.+&v=)([a-zA-Z0-9_-]{11})/,
      // Short: youtu.be/VIDEO_ID
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      // Embed: youtube.com/embed/VIDEO_ID
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      // YouTube-nocookie: youtube-nocookie.com/embed/VIDEO_ID
      /youtube-nocookie\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      // Shorts: youtube.com/shorts/VIDEO_ID
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
      // Live: youtube.com/live/VIDEO_ID
      /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
      // V format: youtube.com/v/VIDEO_ID
      /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    // محاولة استخدام URL API كطريقة بديلة
    try {
      const urlObj = new URL(url);
      const videoId = urlObj.searchParams.get('v');
      if (videoId && videoIdRegex.test(videoId)) {
        return videoId;
      }
    } catch (e) {
      // URL غير صالح، تجاهل
    }

    return null;
  } catch (error) {
    console.error('Error extracting YouTube Video ID:', error);
    return null;
  }
};

/**
 * توليد رابط Embed احترافي من VIDEO_ID
 * مع Parameters لإخفاء عناصر YouTube غير المرغوبة
 * 
 * @param {string} videoId - VIDEO_ID
 * @param {object} options - خيارات إضافية
 * @returns {string} - رابط Embed
 */
export const generateYouTubeEmbedUrl = (videoId, options = {}) => {
  if (!videoId) {
    return '';
  }

  const defaultParams = {
    rel: 0,              // لا تعرض فيديوهات ذات صلة
    modestbranding: 1,   // إخفاء شعار YouTube
    showinfo: 0,         // إخفاء معلومات الفيديو
    playsinline: 1,      // تشغيل inline على الموبايل
    iv_load_policy: 3,   // إخفاء annotations
    fs: 1,               // السماح بملء الشاشة
    ...options
  };

  const params = new URLSearchParams(defaultParams).toString();
  return `https://www.youtube.com/embed/${videoId}?${params}`;
};

/**
 * توليد رابط Embed احترافي من أي رابط يوتيوب
 * يجمع بين extractYouTubeVideoId و generateYouTubeEmbedUrl
 * 
 * @param {string} url - أي رابط يوتيوب
 * @param {object} options - خيارات إضافية
 * @returns {string} - رابط Embed أو سلسلة فارغة
 */
export const convertToYouTubeEmbed = (url, options = {}) => {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return '';
  }
  return generateYouTubeEmbedUrl(videoId, options);
};

/**
 * الحصول على صورة مصغرة للفيديو
 * 
 * @param {string} videoIdOrUrl - VIDEO_ID أو رابط يوتيوب
 * @param {string} quality - جودة الصورة: default, mq, hq, sd, maxres
 * @returns {string} - رابط الصورة المصغرة
 */
export const getYouTubeThumbnail = (videoIdOrUrl, quality = 'hq') => {
  const videoId = extractYouTubeVideoId(videoIdOrUrl) || videoIdOrUrl;
  
  if (!videoId) {
    return '';
  }

  const qualityMap = {
    default: 'default',      // 120x90
    mq: 'mqdefault',         // 320x180
    hq: 'hqdefault',         // 480x360
    sd: 'sddefault',         // 640x480
    maxres: 'maxresdefault', // 1280x720
  };

  const thumbnailQuality = qualityMap[quality] || qualityMap.hq;
  return `https://img.youtube.com/vi/${videoId}/${thumbnailQuality}.jpg`;
};

/**
 * التحقق من صحة رابط يوتيوب
 * 
 * @param {string} url - الرابط للتحقق منه
 * @returns {boolean} - true إذا كان رابط يوتيوب صالح
 */
export const isValidYouTubeUrl = (url) => {
  return extractYouTubeVideoId(url) !== null;
};

/**
 * تنسيق رابط يوتيوب ليكون موحداً
 * 
 * @param {string} url - أي رابط يوتيوب
 * @returns {string} - رابط موحد بصيغة watch
 */
export const normalizeYouTubeUrl = (url) => {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return url;
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
};

// تصدير جميع الدوال
const youtubeUtils = {
  extractYouTubeVideoId,
  generateYouTubeEmbedUrl,
  convertToYouTubeEmbed,
  getYouTubeThumbnail,
  isValidYouTubeUrl,
  normalizeYouTubeUrl,
};

export default youtubeUtils;
