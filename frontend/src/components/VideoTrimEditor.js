import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Loader2, Scissors, Play, Pause, AlertTriangle, Minimize2 } from 'lucide-react';
import { toast } from 'sonner';

const FFMPEG_VERSION = '0.12.10';
const FFMPEG_CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_VERSION}/dist/umd`;

let ffmpegInstancePromise = null;

async function getFFmpeg(onLog) {
  if (ffmpegInstancePromise) return ffmpegInstancePromise;
  ffmpegInstancePromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');
    const ff = new FFmpeg();
    if (onLog) ff.on('log', onLog);
    await ff.load({
      coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    return ff;
  })().catch((e) => {
    ffmpegInstancePromise = null;
    throw e;
  });
  return ffmpegInstancePromise;
}

function fmt(t) {
  if (!Number.isFinite(t) || t < 0) return '0:00.0';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

function inferExt(file) {
  const name = (file?.name || '').toLowerCase();
  if (name.endsWith('.mov')) return 'mov';
  if (name.endsWith('.webm')) return 'webm';
  if (name.endsWith('.mkv')) return 'mkv';
  return 'mp4';
}

function inferMime(ext) {
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mkv') return 'video/x-matroska';
  return 'video/mp4';
}

// Re-encoding presets for in-browser compression. Each preset trades quality
// for speed/size. Heights are caps — videos shorter than the cap keep their
// original height (scale uses min(ih, target)).
const COMPRESS_PRESETS = {
  fast:   { label: 'سريع (480p)',   height: 480,  crf: 30, x264Preset: 'ultrafast', audioBitrate: '96k'  },
  medium: { label: 'متوسط (720p)',  height: 720,  crf: 26, x264Preset: 'veryfast',  audioBitrate: '128k' },
  high:   { label: 'عالي (1080p)',  height: 1080, crf: 22, x264Preset: 'fast',      audioBitrate: '160k' },
};

const VideoTrimEditor = ({ open, file, previewUrl, duration, maxByPlatform, selectedPlatforms, onClose, onApply }) => {
  const videoRef = useRef(null);
  const [range, setRange] = useState([0, 0]);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [recompress, setRecompress] = useState(false);
  const [quality, setQuality] = useState('medium');
  const [outputSize, setOutputSize] = useState(null);
  const [thumbnails, setThumbnails] = useState([]);
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const totalRef = useRef(duration || 0);
  const thumbsGenRef = useRef(0);

  useEffect(() => {
    if (open && Number.isFinite(duration) && duration > 0) {
      setRange([0, duration]);
      totalRef.current = duration;
      setCurrent(0);
      setPlaying(false);
      setProgress(0);
      setPhase('');
      setOutputSize(null);
      setThumbnails([]);
    }
  }, [open, duration]);

  // Generate ~10 thumbnails along the video using a hidden <video> + canvas.
  useEffect(() => {
    if (!open || !previewUrl) return;
    const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
    if (total <= 0) return;
    const genId = ++thumbsGenRef.current;
    const COUNT = 10;
    const v = document.createElement('video');
    v.src = previewUrl;
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const urls = [];
    let cancelled = false;

    const cleanup = () => {
      cancelled = true;
      try { v.removeAttribute('src'); v.load(); } catch (_) { /* ignore */ }
    };

    const onLoaded = async () => {
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : total;
      const W = 120;
      const ratio = (v.videoWidth && v.videoHeight) ? (v.videoHeight / v.videoWidth) : (9 / 16);
      const H = Math.max(40, Math.round(W * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      setThumbsLoading(true);
      try {
        const results = [];
        for (let i = 0; i < COUNT; i++) {
          if (cancelled || genId !== thumbsGenRef.current) return;
          const t = (dur * (i + 0.5)) / COUNT;
          await new Promise((resolve) => {
            const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve(); };
            v.addEventListener('seeked', onSeeked);
            try { v.currentTime = Math.max(0, Math.min(dur - 0.05, t)); }
            catch (_) { v.removeEventListener('seeked', onSeeked); resolve(); }
          });
          if (cancelled || genId !== thumbsGenRef.current) return;
          try {
            ctx.drawImage(v, 0, 0, W, H);
            const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.6));
            if (!blob) continue;
            const url = URL.createObjectURL(blob);
            urls.push(url);
            results.push({ time: t, url });
            if (genId === thumbsGenRef.current && !cancelled) {
              setThumbnails([...results]);
            }
          } catch (_) { /* ignore frame errors */ }
        }
      } finally {
        if (genId === thumbsGenRef.current) setThumbsLoading(false);
      }
    };

    v.addEventListener('loadedmetadata', onLoaded, { once: true });
    v.addEventListener('error', () => { setThumbsLoading(false); }, { once: true });

    return () => {
      cleanup();
      // Revoke generated URLs after cleanup
      setTimeout(() => urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} }), 0);
    };
  }, [open, previewUrl, duration]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCurrent(v.currentTime);
      if (v.currentTime >= range[1]) {
        v.pause();
        setPlaying(false);
      }
    };
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [range]);

  const total = totalRef.current || duration || 0;
  const trimmedLen = Math.max(0, range[1] - range[0]);

  const exceedingAfter = (selectedPlatforms || []).filter(
    p => maxByPlatform?.[p] != null && trimmedLen > maxByPlatform[p],
  );

  const seekTo = (t) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(total, t));
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < range[0] || v.currentTime >= range[1]) v.currentTime = range[0];
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const handleRangeChange = (vals) => {
    let [a, b] = vals;
    if (b - a < 0.5) {
      // Enforce a minimum 0.5s window
      if (a !== range[0]) a = Math.max(0, b - 0.5);
      else b = Math.min(total, a + 0.5);
    }
    setRange([a, b]);
    const v = videoRef.current;
    if (v) {
      if (a !== range[0]) v.currentTime = a;
      else if (b !== range[1]) v.currentTime = b;
    }
  };

  const handleApply = async () => {
    if (!file || trimmedLen <= 0) return;
    setBusy(true);
    setProgress(0);
    setOutputSize(null);
    setPhase('جارٍ تحميل محرك المعالجة...');
    let ff = null;
    const onProgress = ({ progress: p }) => {
      if (Number.isFinite(p)) setProgress(Math.max(0, Math.min(100, Math.round(p * 100))));
    };
    try {
      ff = await getFFmpeg();
      ff.on('progress', onProgress);
      const ext = recompress ? 'mp4' : inferExt(file);
      const inputName = `in.${inferExt(file)}`;
      const outputName = `out.${ext}`;
      setPhase('جارٍ تحميل الفيديو...');
      const { fetchFile } = await import('@ffmpeg/util');
      await ff.writeFile(inputName, await fetchFile(file));

      let cmd;
      if (recompress) {
        const preset = COMPRESS_PRESETS[quality] || COMPRESS_PRESETS.medium;
        setPhase(`جارٍ إعادة الترميز (${preset.label})...`);
        // Re-encode with H.264 + AAC. Scale caps height while preserving
        // aspect ratio; videos shorter than the cap aren't upscaled.
        cmd = [
          '-ss', String(range[0].toFixed(3)),
          '-i', inputName,
          '-t', String(trimmedLen.toFixed(3)),
          '-vf', `scale='min(iw,trunc(oh*a/2)*2)':'min(${preset.height},ih)'`,
          '-c:v', 'libx264',
          '-preset', preset.x264Preset,
          '-crf', String(preset.crf),
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', preset.audioBitrate,
          '-movflags', '+faststart',
          outputName,
        ];
      } else {
        setPhase('جارٍ قص الفيديو...');
        // -ss before -i for fast seek; -c copy avoids re-encoding (keyframe-aligned cut).
        cmd = [
          '-ss', String(range[0].toFixed(3)),
          '-i', inputName,
          '-t', String(trimmedLen.toFixed(3)),
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          outputName,
        ];
      }
      await ff.exec(cmd);
      const data = await ff.readFile(outputName);
      try { await ff.deleteFile(inputName); } catch (_) { /* ignore */ }
      try { await ff.deleteFile(outputName); } catch (_) { /* ignore */ }
      const mime = inferMime(ext);
      const blob = new Blob([data], { type: mime });
      setOutputSize(blob.size);
      const baseName = (file.name || 'video').replace(/\.[^.]+$/, '');
      const suffix = recompress ? 'compressed' : 'trimmed';
      const newFile = new File([blob], `${baseName}-${suffix}.${ext}`, { type: mime });
      onApply({
        file: newFile,
        start: range[0],
        end: range[1],
        duration: trimmedLen,
        recompressed: recompress,
        originalSize: file.size,
        outputSize: blob.size,
      });
    } catch (e) {
      console.error('trim failed', e);
      toast.error(recompress ? 'تعذر إعادة ترميز الفيديو في المتصفح' : 'تعذر قص الفيديو في المتصفح');
    } finally {
      if (ff) { try { ff.off('progress', onProgress); } catch (_) { /* ignore */ } }
      setBusy(false);
      setPhase('');
    }
  };

  if (!file) return null;

  const originalSize = file.size || 0;
  const sizeDelta = (outputSize != null && originalSize > 0)
    ? Math.round(((originalSize - outputSize) / originalSize) * 100)
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="w-4 h-4" />
            قص الفيديو وضبط المدة
          </DialogTitle>
        </DialogHeader>

        <div className="relative w-full bg-black rounded overflow-hidden" style={{ height: 320 }}>
          <video
            ref={videoRef}
            src={previewUrl}
            className="w-full h-full object-contain"
            onLoadedMetadata={() => {
              const v = videoRef.current;
              if (v && Number.isFinite(v.duration)) {
                totalRef.current = v.duration;
                if (range[1] === 0) setRange([0, v.duration]);
              }
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            playsInline
          />
        </div>

        <div className="flex items-center gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={togglePlay} disabled={busy}>
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <div className="text-xs text-gray-500 font-mono">
            {fmt(current)} / {fmt(total)}
          </div>
          <div className="text-xs text-gray-500 mr-auto">
            مدة المقطع: <span className="font-bold text-gray-800">{fmt(trimmedLen)}</span>
          </div>
        </div>

        <div className="mt-3 px-1">
          {/* Playhead bar */}
          <div className="relative h-2 bg-gray-200 rounded">
            <div
              className="absolute inset-y-0 bg-blue-100 rounded"
              style={{
                left: `${total ? (range[0] / total) * 100 : 0}%`,
                width: `${total ? ((range[1] - range[0]) / total) * 100 : 0}%`,
              }}
            />
            <div
              className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-red-500"
              style={{ left: `${total ? (current / total) * 100 : 0}%` }}
            />
          </div>
          {/* Thumbnail strip for precise scrubbing */}
          <div className="mt-3 relative">
            {thumbnails.length === 0 && thumbsLoading && (
              <div className="h-12 flex items-center justify-center text-xs text-gray-400 bg-gray-50 rounded border border-dashed">
                <Loader2 className="w-3 h-3 animate-spin ml-1" />
                جارٍ توليد اللقطات...
              </div>
            )}
            {thumbnails.length > 0 && (
              <div className="relative">
                <div className="flex gap-px rounded overflow-hidden bg-gray-100 border">
                  {thumbnails.map((thumb, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => seekTo(thumb.time)}
                      disabled={busy}
                      title={fmt(thumb.time)}
                      className="flex-1 min-w-0 h-12 hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <img
                        src={thumb.url}
                        alt=""
                        className="w-full h-full object-cover pointer-events-none"
                        draggable={false}
                      />
                    </button>
                  ))}
                </div>
                {total > 0 && (
                  <>
                    <div
                      className="pointer-events-none absolute inset-y-0 border-2 border-blue-500 bg-blue-500/10 rounded"
                      style={{
                        left: `${(range[0] / total) * 100}%`,
                        width: `${((range[1] - range[0]) / total) * 100}%`,
                      }}
                    />
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-red-500"
                      style={{ left: `${(current / total) * 100}%` }}
                    />
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-3">
            <Slider
              min={0}
              max={Math.max(total, 0.1)}
              step={0.1}
              value={range}
              onValueChange={handleRangeChange}
              disabled={busy}
            />
          </div>
          <div className="flex items-center justify-between gap-2 mt-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">البداية</span>
              <Button size="sm" variant="ghost" onClick={() => seekTo(range[0])} disabled={busy}>
                <span className="text-xs font-mono">{fmt(range[0])}</span>
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">النهاية</span>
              <Button size="sm" variant="ghost" onClick={() => seekTo(range[1])} disabled={busy}>
                <span className="text-xs font-mono">{fmt(range[1])}</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Recompress / quality controls */}
        <div className="mt-4 border rounded p-3 bg-gray-50">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={recompress}
              onChange={(e) => setRecompress(e.target.checked)}
              disabled={busy}
              className="w-4 h-4"
            />
            <Minimize2 className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium">تقليل الحجم (إعادة ترميز H.264)</span>
          </label>
          {recompress && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-600">الجودة:</span>
              {Object.entries(COMPRESS_PRESETS).map(([key, p]) => (
                <Button
                  key={key}
                  size="sm"
                  type="button"
                  variant={quality === key ? 'default' : 'outline'}
                  onClick={() => setQuality(key)}
                  disabled={busy}
                  className={quality === key ? 'bg-blue-600 hover:bg-blue-700' : ''}
                >
                  {p.label}
                </Button>
              ))}
              <span className="text-xs text-gray-500 w-full mt-1">
                إعادة الترميز أبطأ بكثير من القص العادي، لكنها تقلل الحجم بشكل ملحوظ.
              </span>
            </div>
          )}
          <div className="mt-3 text-xs text-gray-700 flex flex-wrap gap-x-4 gap-y-1">
            <span>الحجم الأصلي: <span className="font-mono font-bold">{fmtBytes(originalSize)}</span></span>
            {outputSize != null && (
              <>
                <span>الحجم بعد المعالجة: <span className="font-mono font-bold text-green-700">{fmtBytes(outputSize)}</span></span>
                {sizeDelta != null && (
                  <span className={sizeDelta > 0 ? 'text-green-700' : 'text-amber-700'}>
                    {sizeDelta > 0 ? `↓ توفير ${sizeDelta}%` : `↑ زيادة ${Math.abs(sizeDelta)}%`}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {exceedingAfter.length > 0 && (
          <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>
              المقطع لا يزال أطول من الحد المسموح في:{' '}
              {exceedingAfter.map(p => `${p} (${maxByPlatform[p]}ث)`).join('، ')}
            </span>
          </div>
        )}

        {busy && (
          <div className="mt-3">
            <div className="text-xs text-gray-600 mb-1">{phase}</div>
            <div className="h-2 bg-gray-200 rounded">
              <div
                className="h-2 bg-blue-500 rounded transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-1">{progress}%</div>
          </div>
        )}

        <p className="text-xs text-gray-500 mt-2">
          {recompress
            ? 'إعادة الترميز تتم داخل المتصفح وقد تستغرق وقتاً أطول حسب طول الفيديو وقدرة الجهاز.'
            : 'القص يتم داخل المتصفح بدون رفع الملف، باستخدام نسخ الترميز (سريع وبدون فقدان جودة). قد يبدأ المقطع من أقرب إطار مفتاحي قبل وقت البداية المحدد.'}
        </p>

        <DialogFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button
            onClick={handleApply}
            disabled={busy || trimmedLen <= 0 || (!recompress && trimmedLen >= total - 0.05 && range[0] <= 0.05)}
            title={!recompress && trimmedLen >= total - 0.05 && range[0] <= 0.05 ? 'حدد مقطعاً أقصر من المدة الكاملة أو فعّل تقليل الحجم' : ''}
          >
            {busy
              ? <Loader2 className="w-4 h-4 animate-spin ml-1" />
              : recompress
                ? <Minimize2 className="w-4 h-4 ml-1" />
                : <Scissors className="w-4 h-4 ml-1" />}
            {recompress ? 'ضغط وحفظ' : 'قص وحفظ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VideoTrimEditor;
