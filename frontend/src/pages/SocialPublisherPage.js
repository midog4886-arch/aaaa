import React, { useEffect, useState, useRef } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import { socialAPI } from '../services/api';
import { toast } from 'sonner';
import {
  Loader2, UploadCloud, Send, Link2, Unlink, CheckCircle2, XCircle,
  Image as ImageIcon, Video as VideoIcon, History, RefreshCw, ExternalLink,
  Facebook, Instagram, Youtube, Music2, Settings, Save, Eye, EyeOff, Copy,
  Crop as CropIcon, AlertTriangle, BarChart3, Heart, MessageCircle, Wand2, Scissors,
  Trash2,
} from 'lucide-react';
import MediaCropEditor from '../components/MediaCropEditor';
import MediaImageEditor from '../components/MediaImageEditor';
import VideoTrimEditor from '../components/VideoTrimEditor';

// Per-platform max video duration in seconds. Reels/Shorts/TikTok limits.
// Keep in sync with PLATFORM_MAX_VIDEO_SECONDS in backend/routes/social_publisher.py
const VIDEO_MAX_SECONDS = {
  instagram: 60,
  tiktok: 600,
  youtube: 900,
  facebook: 14400,
};

const PLATFORMS = [
  { id: 'facebook',  name: 'Facebook',   icon: Facebook,  color: 'bg-blue-600',    border: 'border-blue-200',    accepts: 'image+video' },
  { id: 'instagram', name: 'Instagram',  icon: Instagram, color: 'bg-pink-600',    border: 'border-pink-200',    accepts: 'image+video' },
  { id: 'youtube',   name: 'YouTube',    icon: Youtube,   color: 'bg-red-600',     border: 'border-red-200',     accepts: 'video' },
  { id: 'tiktok',    name: 'TikTok',     icon: Music2,    color: 'bg-black',       border: 'border-gray-300',    accepts: 'video' },
];

const SocialPublisherPage = () => {
  const [accounts, setAccounts] = useState([]);
  const [configured, setConfigured] = useState({});
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploaded, setUploaded] = useState(null); // { filename, kind, public_url }
  const [previewUrl, setPreviewUrl] = useState('');
  const [videoDuration, setVideoDuration] = useState(null); // seconds, null until probed
  const [cropOpen, setCropOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);
  const [videoCrop, setVideoCrop] = useState(null); // { crop:{x,y,width,height}, aspect }
  const [videoEdits, setVideoEdits] = useState(null); // { filter, logo } applied via ffmpeg on publish
  const [videoLogoFile, setVideoLogoFile] = useState(null); // pending File for custom video logo

  const [caption, setCaption] = useState('');
  const [overrides, setOverrides] = useState({}); // { platform: text }
  const [showOverride, setShowOverride] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState(null);

  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [refreshingInsights, setRefreshingInsights] = useState({}); // { post_id: true }
  const [insightsSettings, setInsightsSettings] = useState(null); // { enabled, interval_minutes, lookback_days, last_run_at, last_run_status }
  const [savingInsightsSettings, setSavingInsightsSettings] = useState(false);
  const [uploadsCleanup, setUploadsCleanup] = useState(null); // { last_run_at, last_run_deleted, last_run_status, retention_days, retention_days_min, retention_days_max }
  const [runningUploadsCleanup, setRunningUploadsCleanup] = useState(false);
  const [retentionDraft, setRetentionDraft] = useState('');
  const [savingRetention, setSavingRetention] = useState(false);
  const fileInputRef = useRef(null);

  // OAuth app credentials editable from the page (admin only).
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState({}); // { provider: { schema, values } }
  const [configDraft, setConfigDraft] = useState({});
  const [savingProvider, setSavingProvider] = useState(null);
  const [revealed, setRevealed] = useState({}); // { 'provider:key': true }
  const [canEditConfig, setCanEditConfig] = useState(false);

  const callbackBase = (() => {
    const o = window.location.origin;
    return `${o}/api/social/callback`;
  })();

  const loadConfig = async () => {
    try {
      const r = await socialAPI.getConfig();
      setConfig(r.data || {});
      const draft = {};
      Object.entries(r.data || {}).forEach(([prov, info]) => { draft[prov] = { ...info.values }; });
      setConfigDraft(draft);
      setCanEditConfig(true);
    } catch (e) {
      // 403 means the user isn't admin — hide the settings panel entirely.
      setCanEditConfig(false);
    }
  };

  const updateDraft = (provider, key, value) => {
    setConfigDraft(d => ({ ...d, [provider]: { ...(d[provider] || {}), [key]: value } }));
  };

  const handleSaveConfig = async (provider) => {
    setSavingProvider(provider);
    try {
      await socialAPI.saveConfig(provider, configDraft[provider] || {});
      toast.success('تم حفظ الإعدادات');
      await loadConfig();
      await loadAccounts();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'فشل الحفظ');
    } finally {
      setSavingProvider(null);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success('تم النسخ'),
      () => toast.error('فشل النسخ'),
    );
  };

  const loadAccounts = async () => {
    try {
      const r = await socialAPI.listAccounts();
      setAccounts(r.data.accounts || []);
      setConfigured(r.data.configured || {});
    } catch (e) {
      toast.error('فشل تحميل الحسابات');
    } finally {
      setLoadingAccounts(false);
    }
  };

  const loadHistory = async () => {
    try {
      const r = await socialAPI.history(30);
      setHistory(r.data.posts || []);
    } catch (e) {
      // silent
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadInsightsSettings = async () => {
    try {
      const r = await socialAPI.getInsightsSettings();
      setInsightsSettings(r.data);
    } catch (e) {
      // silent
    }
  };

  const handleToggleAutoRefresh = async (enabled) => {
    setSavingInsightsSettings(true);
    try {
      const r = await socialAPI.saveInsightsSettings({ enabled });
      setInsightsSettings((prev) => ({ ...(prev || {}), ...r.data }));
      toast.success(enabled ? 'تم تفعيل التحديث التلقائي' : 'تم إيقاف التحديث التلقائي');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'تعذر حفظ الإعداد');
    } finally {
      setSavingInsightsSettings(false);
    }
  };

  const loadUploadsCleanup = async () => {
    try {
      const r = await socialAPI.getUploadsCleanupStatus();
      setUploadsCleanup(r.data);
      setRetentionDraft((prev) =>
        prev === '' && r.data?.retention_days != null
          ? String(r.data.retention_days)
          : prev,
      );
    } catch (e) {
      // 403 = not admin; just leave as null
    }
  };

  const handleSaveRetention = async () => {
    const rd = parseInt(retentionDraft, 10);
    const min = uploadsCleanup?.retention_days_min ?? 1;
    const max = uploadsCleanup?.retention_days_max ?? 365;
    if (!Number.isFinite(rd) || rd < min || rd > max) {
      toast.error(`عدد الأيام يجب أن يكون بين ${min} و${max}`);
      return;
    }
    setSavingRetention(true);
    try {
      const r = await socialAPI.updateUploadsCleanupSettings({ retention_days: rd });
      setUploadsCleanup(r.data);
      setRetentionDraft(String(r.data?.retention_days ?? rd));
      toast.success('تم حفظ مدة الاحتفاظ');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'تعذر حفظ مدة الاحتفاظ');
    } finally {
      setSavingRetention(false);
    }
  };

  const handleRunUploadsCleanup = async () => {
    setRunningUploadsCleanup(true);
    try {
      const r = await socialAPI.runUploadsCleanupNow();
      setUploadsCleanup(r.data);
      const n = r.data?.deleted ?? 0;
      toast.success(n > 0 ? `تم حذف ${n} ملف` : 'لا توجد ملفات للتنظيف');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'تعذر تشغيل التنظيف');
    } finally {
      setRunningUploadsCleanup(false);
    }
  };

  const handleChangeAutoRefreshInterval = async (interval_minutes) => {
    setSavingInsightsSettings(true);
    try {
      const r = await socialAPI.saveInsightsSettings({ interval_minutes });
      setInsightsSettings((prev) => ({ ...(prev || {}), ...r.data }));
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'تعذر حفظ الفاصل الزمني');
    } finally {
      setSavingInsightsSettings(false);
    }
  };

  useEffect(() => {
    loadAccounts();
    loadHistory();
    loadConfig();
    loadInsightsSettings();
    loadUploadsCleanup();
    // Periodically refresh history + last-run metadata so the UI reflects
    // changes made by the background scheduler without manual reloads.
    const histTimer = setInterval(() => {
      loadHistory();
      loadInsightsSettings();
      loadUploadsCleanup();
    }, 60 * 1000);
    const onMessage = (ev) => {
      if (ev?.data?.social_oauth) {
        if (ev.data.ok) toast.success(`تم ربط ${ev.data.platform}`);
        else toast.error(`فشل ربط ${ev.data.platform}`);
        loadAccounts();
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      clearInterval(histTimer);
    };
  }, []);

  const accountFor = (platform) => accounts.find(a => a.platform === platform);

  const handleConnect = async (platform) => {
    try {
      const r = await socialAPI.connect(platform);
      const url = r.data?.authorize_url;
      if (!url) throw new Error('no url');
      window.open(url, '_blank', 'width=620,height=720');
    } catch (e) {
      const msg = e?.response?.data?.detail || 'فشل بدء الربط';
      toast.error(msg);
    }
  };

  const handleDisconnect = async (platform) => {
    if (!window.confirm(`فصل حساب ${platform}؟`)) return;
    try {
      await socialAPI.disconnect(platform);
      toast.success('تم الفصل');
      loadAccounts();
    } catch (e) {
      toast.error('فشل الفصل');
    }
  };

  const probeVideoDuration = (url) => new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => resolve(null);
    v.src = url;
  });

  const adoptFile = async (f) => {
    setFile(f);
    setUploaded(null);
    setResults(null);
    setVideoDuration(null);
    setVideoCrop(null);
    setVideoEdits(null);
    setVideoLogoFile(null);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
    if (f.type.startsWith('video/')) {
      const d = await probeVideoDuration(url);
      setVideoDuration(d);
    }
  };

  const handleFilePick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    adoptFile(f);
  };

  const handleCropApplied = (result) => {
    setCropOpen(false);
    if (!result) return;
    if (result.kind === 'image' && result.file) {
      adoptFile(result.file);
    } else if (result.kind === 'video') {
      setVideoCrop({ crop: result.crop, aspect: result.aspect });
      toast.success(`تم حفظ تأطير الفيديو (${result.aspect})`);
    }
  };

  const handleTrimApplied = (result) => {
    setTrimOpen(false);
    if (!result || !result.file) return;
    adoptFile(result.file);
    if (result.recompressed && result.originalSize && result.outputSize) {
      const delta = Math.round(((result.originalSize - result.outputSize) / result.originalSize) * 100);
      const note = delta > 0
        ? `توفير ${delta}% من الحجم`
        : delta < 0
          ? `زيادة ${Math.abs(delta)}% في الحجم`
          : 'بدون تغيير في الحجم';
      toast.success(`تم ضغط الفيديو إلى ${Math.round(result.duration)}ث (${note})`);
    } else {
      toast.success(`تم قص الفيديو إلى ${Math.round(result.duration)}ث`);
    }
  };

  const handleEditorApplied = (result) => {
    setEditorOpen(false);
    if (!result) return;
    if (result.kind === 'image' && result.file) {
      adoptFile(result.file);
      toast.success('تم تطبيق التعديلات على الصورة');
    } else if (result.kind === 'video') {
      const edits = result.edits || {};
      const hasAny = !!edits.filter || !!edits.logo;
      setVideoEdits(hasAny ? edits : null);
      setVideoLogoFile(result.logoFile || null);
      toast.success(hasAny
        ? 'تم حفظ تعديلات الفيديو، ستُطبَّق على الخادم عند النشر'
        : 'تم مسح تعديلات الفيديو');
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const r = await socialAPI.uploadMedia(file, (e) => {
        if (e.total) setUploadProgress(Math.round((e.loaded * 100) / e.total));
      });
      setUploaded(r.data);
      toast.success('تم رفع الملف');
    } catch (e) {
      const msg = e?.response?.data?.detail || 'فشل الرفع';
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const togglePlatform = (platform) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform); else next.add(platform);
      return next;
    });
  };

  const canPublish = uploaded && selected.size > 0 && !publishing;

  const handlePublish = async () => {
    if (!canPublish) return;
    if (!uploaded.kind) return;
    // Validate that video-only platforms only get videos.
    if (uploaded.kind === 'image') {
      const videoOnly = ['youtube', 'tiktok'].filter(p => selected.has(p));
      if (videoOnly.length > 0) {
        toast.error(`المنصات التالية تقبل الفيديو فقط: ${videoOnly.join(', ')}`);
        return;
      }
    }
    if (uploaded.kind === 'video' && videoDuration != null) {
      const tooLong = Array.from(selected).filter(
        p => VIDEO_MAX_SECONDS[p] != null && videoDuration > VIDEO_MAX_SECONDS[p],
      );
      if (tooLong.length > 0) {
        const desc = tooLong
          .map(p => `${p} (الحد ${VIDEO_MAX_SECONDS[p]}ث)`)
          .join('، ');
        toast.error(`مدة الفيديو (${Math.round(videoDuration)}ث) أطول من الحد المسموح: ${desc}`);
        return;
      }
    }
    setPublishing(true);
    setResults(null);
    try {
      const targets = Array.from(selected).map(p => ({
        platform: p,
        caption_override: overrides[p] && overrides[p].trim() !== '' ? overrides[p] : null,
      }));
      // If the user picked a custom logo for the video, upload it first so
      // the backend can reference it by filename when running ffmpeg.
      let videoEditsPayload = null;
      if (uploaded.kind === 'video' && videoEdits) {
        videoEditsPayload = { ...videoEdits };
        if (videoEdits.logo && videoEdits.logo.source === 'custom' && videoLogoFile) {
          const lr = await socialAPI.uploadMedia(videoLogoFile);
          videoEditsPayload = {
            ...videoEditsPayload,
            logo: { ...videoEdits.logo, filename: lr.data.filename },
          };
        }
      }
      const r = await socialAPI.publish({
        media_filename: uploaded.filename,
        caption,
        targets,
        video_crop: uploaded.kind === 'video' && videoCrop ? videoCrop.crop : null,
        video_edits: videoEditsPayload,
      });
      setResults(r.data.results || []);
      const okCount = (r.data.results || []).filter(x => x.status === 'success').length;
      if (okCount === targets.length) toast.success('تم النشر على جميع المنصات');
      else if (okCount > 0) toast.warning(`نجح ${okCount} من ${targets.length}`);
      else toast.error('فشل النشر على جميع المنصات');
      loadHistory();
    } catch (e) {
      const msg = e?.response?.data?.detail || 'فشل النشر';
      toast.error(msg);
    } finally {
      setPublishing(false);
    }
  };

  const handleRefreshInsights = async (postId) => {
    setRefreshingInsights(s => ({ ...s, [postId]: true }));
    try {
      await socialAPI.refreshInsights(postId);
      await loadHistory();
      toast.success('تم تحديث الإحصائيات');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'فشل تحديث الإحصائيات');
    } finally {
      setRefreshingInsights(s => {
        const next = { ...s };
        delete next[postId];
        return next;
      });
    }
  };

  const formatMetric = (n) => {
    if (n == null) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const resetForm = () => {
    setFile(null);
    setUploaded(null);
    setPreviewUrl('');
    setVideoDuration(null);
    setVideoCrop(null);
    setVideoEdits(null);
    setVideoLogoFile(null);
    setCaption('');
    setOverrides({});
    setShowOverride({});
    setSelected(new Set());
    setResults(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Platforms whose video limit is exceeded by the current file (UI hint only).
  const exceedingPlatforms = (file && file.type.startsWith('video/') && videoDuration != null)
    ? PLATFORMS.filter(
        p => VIDEO_MAX_SECONDS[p.id] != null && videoDuration > VIDEO_MAX_SECONDS[p.id],
      ).map(p => p.id)
    : [];

  return (
    <Layout>
      <div className="space-y-6 p-4 sm:p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">النشر الاجتماعي</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              ارفع صورة أو فيديو مرة واحدة وانشره على كل المنصات.
            </p>
          </div>
          {canEditConfig && (
            <Button variant="outline" size="sm" onClick={() => setShowSettings(s => !s)}>
              <Settings className="w-4 h-4 ml-1" />
              إعدادات OAuth
            </Button>
          )}
        </div>

        {/* ── OAuth app credentials ─────────────────────────────────── */}
        {canEditConfig && showSettings && (
          <Card className="border-amber-200 bg-amber-50/30">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="w-4 h-4" /> إعدادات تطبيقات OAuth
              </CardTitle>
              <p className="text-xs text-gray-600 mt-1">
                أدخل بيانات التطبيق لكل منصة. يمكنك تعديلها في أي وقت — الإعدادات تُحفظ في قاعدة البيانات.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {[
                { provider: 'meta',    title: 'Meta (Facebook + Instagram)', docs: 'https://developers.facebook.com/apps', cb: `${callbackBase}/facebook` },
                { provider: 'youtube', title: 'YouTube',                     docs: 'https://console.cloud.google.com',     cb: `${callbackBase}/youtube` },
                { provider: 'tiktok',  title: 'TikTok',                      docs: 'https://developers.tiktok.com',        cb: `${callbackBase}/tiktok` },
              ].map(({ provider, title, docs, cb }) => {
                const info = config[provider];
                const draft = configDraft[provider] || {};
                if (!info) return null;
                return (
                  <div key={provider} className="border rounded-lg p-4 bg-white">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div>
                        <h3 className="font-bold text-sm">{title}</h3>
                        <a href={docs} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> فتح لوحة التطوير
                        </a>
                      </div>
                      <Button size="sm" onClick={() => handleSaveConfig(provider)} disabled={savingProvider === provider}>
                        {savingProvider === provider
                          ? <Loader2 className="w-3 h-3 animate-spin ml-1" />
                          : <Save className="w-3 h-3 ml-1" />}
                        حفظ
                      </Button>
                    </div>

                    <div className="mb-3 p-2 bg-gray-50 border rounded">
                      <Label className="text-xs">رابط الـ Callback لتسجيله في إعدادات التطبيق:</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="flex-1 text-xs bg-white border px-2 py-1 rounded truncate" dir="ltr">{cb}</code>
                        <Button size="sm" variant="outline" onClick={() => copyToClipboard(cb)}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {info.schema.map(field => {
                        const tag = `${provider}:${field.key}`;
                        const isSecret = field.secret;
                        const show = revealed[tag] || !isSecret;
                        return (
                          <div key={field.key} className={field.key === 'redirect_uri' ? 'sm:col-span-2' : ''}>
                            <Label className="text-xs">{field.label}</Label>
                            <div className="flex items-center gap-1 mt-1">
                              <Input
                                type={show ? 'text' : 'password'}
                                value={draft[field.key] || ''}
                                onChange={(e) => updateDraft(provider, field.key, e.target.value)}
                                placeholder={field.key === 'redirect_uri' ? cb : ''}
                                dir="ltr"
                                className="text-sm"
                              />
                              {isSecret && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setRevealed(r => ({ ...r, [tag]: !r[tag] }))}
                                >
                                  {show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Manual cleanup of stale upload files */}
              <div className="border rounded-lg p-4 bg-white">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div>
                    <h3 className="font-bold text-sm flex items-center gap-2">
                      <Trash2 className="w-4 h-4" /> تنظيف الملفات المؤقتة
                    </h3>
                    <p className="text-xs text-gray-600 mt-1">
                      يحذف ملفات الفيديو/الصور القديمة من مجلد الرفع
                      {uploadsCleanup?.retention_days != null && (
                        <> (الأقدم من {uploadsCleanup.retention_days} يوماً وغير المرتبطة بمنشورات حديثة)</>
                      )}.
                      تعمل تلقائياً مرة كل يوم — استخدم الزر للتشغيل الفوري.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-gray-700 inline-flex items-center gap-1">
                      مدة الاحتفاظ (أيام):
                      <input
                        type="number"
                        min={uploadsCleanup?.retention_days_min ?? 1}
                        max={uploadsCleanup?.retention_days_max ?? 365}
                        step={1}
                        value={retentionDraft}
                        onChange={(e) => setRetentionDraft(e.target.value)}
                        disabled={!uploadsCleanup || savingRetention}
                        className="w-16 border rounded px-2 py-1 text-xs"
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSaveRetention}
                      disabled={
                        !uploadsCleanup ||
                        savingRetention ||
                        retentionDraft === '' ||
                        parseInt(retentionDraft, 10) === uploadsCleanup?.retention_days
                      }
                    >
                      {savingRetention && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
                      حفظ
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleRunUploadsCleanup}
                      disabled={runningUploadsCleanup}
                    >
                      {runningUploadsCleanup
                        ? <Loader2 className="w-3 h-3 animate-spin ml-1" />
                        : <Trash2 className="w-3 h-3 ml-1" />}
                      تنظيف الآن
                    </Button>
                  </div>
                </div>
                {uploadsCleanup && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    الحد المسموح: من {uploadsCleanup.retention_days_min} إلى {uploadsCleanup.retention_days_max} يوماً
                    (الافتراضي {uploadsCleanup.retention_days_default}).
                  </p>
                )}
                <div className="text-xs text-gray-600 mt-2">
                  {uploadsCleanup?.last_run_at ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>
                        آخر تشغيل:{' '}
                        <span dir="ltr">
                          {new Date(uploadsCleanup.last_run_at).toLocaleString('ar-EG')}
                        </span>
                      </span>
                      <span>
                        عدد الملفات المحذوفة:{' '}
                        <span className="font-bold">{uploadsCleanup.last_run_deleted ?? 0}</span>
                      </span>
                      {uploadsCleanup.last_run_status === 'error' && (
                        <span className="text-red-600 inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          فشل: {uploadsCleanup.last_run_error || 'خطأ غير معروف'}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-400">لم يُسجَّل أي تشغيل بعد.</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Connected accounts ─────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="w-4 h-4" /> الحسابات المربوطة
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={loadAccounts}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {loadingAccounts ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {PLATFORMS.map(p => {
                  const acc = accountFor(p.id);
                  const isConfigured = configured[p.id];
                  const Icon = p.icon;
                  return (
                    <div key={p.id} className={`border rounded-lg p-3 ${p.border} bg-white dark:bg-gray-800`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`${p.color} text-white p-1.5 rounded`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="font-bold text-sm">{p.name}</div>
                      </div>
                      {acc ? (
                        <>
                          <div className="text-xs text-gray-500 truncate" title={acc.display_name}>
                            {acc.display_name}
                          </div>
                          <Button size="sm" variant="outline" className="mt-2 w-full text-red-600 border-red-200" onClick={() => handleDisconnect(p.id)}>
                            <Unlink className="w-3 h-3 ml-1" /> فصل
                          </Button>
                        </>
                      ) : (
                        <>
                          <div className="text-xs text-gray-400">غير مربوط</div>
                          <Button
                            size="sm"
                            className="mt-2 w-full"
                            onClick={() => handleConnect(p.id)}
                            disabled={!isConfigured}
                            title={!isConfigured ? 'إعدادات الربط لهذه المنصة لم تُكتمل بعد، أكملها من زر الإعدادات' : ''}
                          >
                            <Link2 className="w-3 h-3 ml-1" />
                            {isConfigured ? 'ربط الحساب' : 'غير مهيأ'}
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Create post ─────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">إنشاء منشور</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Upload */}
            <div>
              <Label>الوسائط (صورة jpg/png أو فيديو mp4/mov)</Label>
              <div className="mt-2 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-4">
                {!file && (
                  <label className="flex flex-col items-center justify-center cursor-pointer py-6 text-gray-500">
                    <UploadCloud className="w-10 h-10 mb-2" />
                    <span className="text-sm">اضغط لاختيار صورة أو فيديو</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,video/mp4,video/quicktime"
                      className="hidden"
                      onChange={handleFilePick}
                    />
                  </label>
                )}
                {file && (
                  <div className="flex flex-col sm:flex-row gap-3 items-start">
                    <div className="flex-shrink-0 w-32 h-32 bg-gray-100 rounded overflow-hidden flex items-center justify-center">
                      {file.type.startsWith('image/') ? (
                        <img src={previewUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <video src={previewUrl} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        {file.type.startsWith('image/')
                          ? <ImageIcon className="w-4 h-4" />
                          : <VideoIcon className="w-4 h-4" />}
                        <span className="truncate font-medium">{file.name}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {(file.size / (1024 * 1024)).toFixed(2)} MB
                        {file.type.startsWith('video/') && videoDuration != null && (
                          <> — مدة {Math.round(videoDuration)}ث</>
                        )}
                      </div>
                      {exceedingPlatforms.length > 0 && (
                        <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span>
                            مدة الفيديو أطول من الحد المسموح في:{' '}
                            {exceedingPlatforms.map(p => `${p} (${VIDEO_MAX_SECONDS[p]}ث)`).join('، ')}
                          </span>
                        </div>
                      )}
                      {uploading && (
                        <div className="mt-2">
                          <div className="h-2 bg-gray-200 rounded">
                            <div className="h-2 bg-blue-500 rounded transition-all" style={{ width: `${uploadProgress}%` }} />
                          </div>
                          <div className="text-xs text-gray-500 mt-1">{uploadProgress}%</div>
                        </div>
                      )}
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {!uploaded ? (
                          <Button size="sm" onClick={handleUpload} disabled={uploading}>
                            {uploading ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <UploadCloud className="w-4 h-4 ml-1" />}
                            رفع الملف
                          </Button>
                        ) : (
                          <Badge className="bg-green-100 text-green-700 border border-green-200">
                            <CheckCircle2 className="w-3 h-3 ml-1" /> تم الرفع
                          </Badge>
                        )}
                        {!uploaded && file.type.startsWith('image/') && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setCropOpen(true)}>
                              <CropIcon className="w-4 h-4 ml-1" /> قص وتغيير المقاس
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditorOpen(true)}>
                              <Wand2 className="w-4 h-4 ml-1" /> فلاتر ونص وشعار
                            </Button>
                          </>
                        )}
                        {file.type.startsWith('video/') && (
                          <Button size="sm" variant="outline" onClick={() => setCropOpen(true)}>
                            <CropIcon className="w-4 h-4 ml-1" />
                            {videoCrop ? `تأطير: ${videoCrop.aspect}` : 'تأطير وتغيير المقاس'}
                          </Button>
                        )}
                        {!uploaded && file.type.startsWith('video/') && (
                          <Button size="sm" variant="outline" onClick={() => setEditorOpen(true)}>
                            <Wand2 className="w-4 h-4 ml-1" />
                            {videoEdits ? 'فلاتر وشعار ✓' : 'فلاتر وشعار'}
                          </Button>
                        )}
                        {!uploaded && file.type.startsWith('video/') && videoDuration != null && (
                          <Button
                            size="sm"
                            variant={exceedingPlatforms.length > 0 ? 'default' : 'outline'}
                            onClick={() => setTrimOpen(true)}
                            className={exceedingPlatforms.length > 0 ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}
                          >
                            <Scissors className="w-4 h-4 ml-1" /> قص الفيديو وضبط المدة
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={resetForm}>إلغاء</Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Caption */}
            <div>
              <Label>النص الأساسي</Label>
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="اكتب وصف المنشور..."
                rows={4}
                className="mt-2"
              />
            </div>

            {/* Platforms */}
            <div>
              <Label>المنصات</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                {PLATFORMS.map(p => {
                  const acc = accountFor(p.id);
                  const Icon = p.icon;
                  const isSelected = selected.has(p.id);
                  const disabled = !acc;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => togglePlatform(p.id)}
                      className={[
                        'border rounded-lg p-3 text-right transition-all',
                        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:shadow-md',
                        isSelected ? 'ring-2 ring-blue-500 border-blue-300 bg-blue-50' : 'bg-white border-gray-200',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`${p.color} text-white p-1.5 rounded`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="font-bold text-sm">{p.name}</div>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-500 mr-auto" />}
                      </div>
                      {disabled && <div className="text-xs text-gray-400 mt-1">غير مربوط</div>}
                      {p.accepts === 'video' && <div className="text-xs text-gray-400 mt-1">فيديو فقط</div>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Per-platform overrides */}
            {selected.size > 0 && (
              <div className="space-y-2">
                <Label>تعديل النص لكل منصة (اختياري)</Label>
                {Array.from(selected).map(p => (
                  <div key={p} className="border rounded p-2">
                    <button
                      type="button"
                      className="text-sm font-medium text-blue-600 hover:underline"
                      onClick={() => setShowOverride(s => ({ ...s, [p]: !s[p] }))}
                    >
                      {showOverride[p] ? '▾' : '▸'} {p}
                    </button>
                    {showOverride[p] && (
                      <Textarea
                        value={overrides[p] || ''}
                        onChange={(e) => setOverrides(o => ({ ...o, [p]: e.target.value }))}
                        placeholder={`نص خاص بـ ${p} (اتركه فارغاً لاستخدام النص الأساسي)`}
                        rows={3}
                        className="mt-2"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Publish */}
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={handlePublish} disabled={!canPublish} className="bg-blue-600 hover:bg-blue-700">
                {publishing ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Send className="w-4 h-4 ml-1" />}
                نشر الآن
              </Button>
            </div>

            {/* Results */}
            {results && (
              <div className="border-t pt-4">
                <h3 className="font-bold mb-2">نتيجة النشر</h3>
                <div className="space-y-2">
                  {results.map((r, i) => (
                    <div key={i} className={`flex items-center gap-2 p-2 rounded ${r.status === 'success' ? 'bg-green-50' : 'bg-red-50'}`}>
                      {r.status === 'success'
                        ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                        : <XCircle className="w-4 h-4 text-red-600" />}
                      <span className="font-bold text-sm">{r.platform}</span>
                      {r.status === 'success' ? (
                        r.public_post_url ? (
                          <a href={r.public_post_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline mr-auto inline-flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" /> عرض المنشور
                          </a>
                        ) : (
                          <span className="text-xs text-gray-500 mr-auto">{r.platform_post_id}</span>
                        )
                      ) : (
                        <span className="text-xs text-red-700 mr-auto">{r.error_message}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── History ─────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4" /> سجل النشر
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={loadHistory}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </CardHeader>
          {insightsSettings && (
            <div className="px-6 -mt-2 pb-3 border-b">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!insightsSettings.enabled}
                    onCheckedChange={handleToggleAutoRefresh}
                    disabled={savingInsightsSettings}
                    id="auto-refresh-insights"
                  />
                  <Label htmlFor="auto-refresh-insights" className="cursor-pointer">
                    تحديث الإحصائيات تلقائياً للمنشورات الحديثة
                  </Label>
                </div>
                <div className="flex items-center gap-2 text-gray-500">
                  <span>كل</span>
                  <select
                    className="border rounded px-2 py-1 text-xs bg-white"
                    value={insightsSettings.interval_minutes || 60}
                    onChange={(e) => handleChangeAutoRefreshInterval(Number(e.target.value))}
                    disabled={savingInsightsSettings || !insightsSettings.enabled}
                  >
                    <option value={15}>15 دقيقة</option>
                    <option value={30}>30 دقيقة</option>
                    <option value={60}>ساعة</option>
                    <option value={180}>3 ساعات</option>
                    <option value={360}>6 ساعات</option>
                    <option value={720}>12 ساعة</option>
                    <option value={1440}>يومياً</option>
                  </select>
                  <span>· آخر {insightsSettings.lookback_days || 30} يوم</span>
                  {insightsSettings.last_run_at && (
                    <span title={`الحالة: ${insightsSettings.last_run_status || 'غير معروف'}`}>
                      · آخر تحديث تلقائي: {new Date(insightsSettings.last_run_at).toLocaleString('ar-SA')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
          <CardContent>
            {loadingHistory ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-6">لا توجد منشورات بعد</p>
            ) : (
              <div className="space-y-3">
                {history.map(post => {
                  const targets = post.target_results || [];
                  const hasSuccess = targets.some(t => t.status === 'success' && t.platform_post_id);
                  const isRefreshing = !!refreshingInsights[post.id];
                  const lastUpdate = targets
                    .map(t => t.insights_updated_at)
                    .filter(Boolean)
                    .sort()
                    .pop();
                  const maxByMetric = targets.reduce((acc, t) => {
                    const ins = t.insights || {};
                    ['views', 'likes', 'comments'].forEach(k => {
                      if (typeof ins[k] === 'number' && ins[k] > (acc[k] || 0)) acc[k] = ins[k];
                    });
                    return acc;
                  }, {});
                  return (
                    <div key={post.id} className="border rounded p-3 flex gap-3">
                      <div className="w-20 h-20 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                        {post.media_kind === 'image' ? (
                          <img src={post.public_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <video src={post.public_url} className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs text-gray-400">
                              {new Date(post.created_at).toLocaleString('ar-SA')}
                              {post.created_by_name && ` — ${post.created_by_name}`}
                            </div>
                            <p className="text-sm mt-1 line-clamp-2">{post.caption || <span className="text-gray-400">بدون نص</span>}</p>
                          </div>
                          {hasSuccess && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRefreshInsights(post.id)}
                              disabled={isRefreshing}
                              title={lastUpdate ? `آخر تحديث: ${new Date(lastUpdate).toLocaleString('ar-SA')}` : 'لم يُحدث بعد'}
                            >
                              {isRefreshing
                                ? <Loader2 className="w-3 h-3 animate-spin ml-1" />
                                : <BarChart3 className="w-3 h-3 ml-1" />}
                              تحديث الإحصائيات
                            </Button>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1 mt-2">
                          {targets.map((t, i) => (
                            <Badge
                              key={i}
                              className={t.status === 'success'
                                ? 'bg-green-100 text-green-700 border border-green-200'
                                : 'bg-red-100 text-red-700 border border-red-200'}
                            >
                              {t.status === 'success' ? <CheckCircle2 className="w-3 h-3 ml-1" /> : <XCircle className="w-3 h-3 ml-1" />}
                              {t.platform}
                              {t.public_post_url && (
                                <a href={t.public_post_url} target="_blank" rel="noreferrer" className="mr-1 text-blue-600 underline">↗</a>
                              )}
                            </Badge>
                          ))}
                        </div>

                        {targets.some(t => t.insights || t.insights_error) && (
                          <div className="mt-3 space-y-2">
                            {targets.filter(t => t.insights || t.insights_error).map((t, i) => {
                              const ins = t.insights || {};
                              const bar = (val, max) => {
                                if (typeof val !== 'number' || !max) return 0;
                                return Math.max(2, Math.round((val / max) * 100));
                              };
                              return (
                                <div key={i} className="border rounded p-2 bg-gray-50 dark:bg-gray-800/40">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-bold">{t.platform}</span>
                                    {t.insights_updated_at && (
                                      <span className="text-gray-400">
                                        {new Date(t.insights_updated_at).toLocaleString('ar-SA')}
                                      </span>
                                    )}
                                  </div>
                                  {t.insights_error ? (
                                    <div className="text-xs text-red-600 mt-1 flex items-start gap-1">
                                      <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                      <span className="break-words">{t.insights_error}</span>
                                    </div>
                                  ) : (
                                    <div className="mt-1 grid grid-cols-3 gap-2">
                                      {[
                                        { key: 'views',    label: 'مشاهدات', Icon: Eye,           color: 'bg-blue-500' },
                                        { key: 'likes',    label: 'إعجابات', Icon: Heart,         color: 'bg-pink-500' },
                                        { key: 'comments', label: 'تعليقات', Icon: MessageCircle, color: 'bg-emerald-500' },
                                      ].map(({ key, label, Icon, color }) => (
                                        <div key={key}>
                                          <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                                            <Icon className="w-3 h-3" />
                                            <span>{label}</span>
                                            <span className="font-bold mr-auto">{formatMetric(ins[key])}</span>
                                          </div>
                                          <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded mt-1">
                                            <div
                                              className={`h-1.5 rounded ${color}`}
                                              style={{ width: `${bar(ins[key], maxByMetric[key])}%` }}
                                            />
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <MediaCropEditor
          open={cropOpen}
          file={file}
          previewUrl={previewUrl}
          onClose={() => setCropOpen(false)}
          onApply={handleCropApplied}
        />

        <MediaImageEditor
          open={editorOpen}
          file={file}
          previewUrl={previewUrl}
          onClose={() => setEditorOpen(false)}
          onApply={handleEditorApplied}
          videoFilename={uploaded?.kind === 'video' ? uploaded.filename : null}
          videoCrop={uploaded?.kind === 'video' && videoCrop ? videoCrop.crop : null}
          onUploadLogo={async (logoFile) => {
            try {
              const r = await socialAPI.uploadMedia(logoFile);
              return r.data?.filename || null;
            } catch (e) {
              return null;
            }
          }}
        />

        <VideoTrimEditor
          open={trimOpen}
          file={file}
          previewUrl={previewUrl}
          duration={videoDuration}
          maxByPlatform={VIDEO_MAX_SECONDS}
          selectedPlatforms={Array.from(selected)}
          onClose={() => setTrimOpen(false)}
          onApply={handleTrimApplied}
        />
      </div>
    </Layout>
  );
};

export default SocialPublisherPage;
