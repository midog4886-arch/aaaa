import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Loader2, Scissors, Play, Pause, AlertTriangle } from 'lucide-react';
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

const VideoTrimEditor = ({ open, file, previewUrl, duration, maxByPlatform, selectedPlatforms, onClose, onApply }) => {
  const videoRef = useRef(null);
  const [range, setRange] = useState([0, 0]);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const totalRef = useRef(duration || 0);

  useEffect(() => {
    if (open && Number.isFinite(duration) && duration > 0) {
      setRange([0, duration]);
      totalRef.current = duration;
      setCurrent(0);
      setPlaying(false);
      setProgress(0);
      setPhase('');
    }
  }, [open, duration]);

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
    setPhase('جارٍ تحميل محرك المعالجة...');
    try {
      const ff = await getFFmpeg();
      const onProgress = ({ progress: p }) => {
        if (Number.isFinite(p)) setProgress(Math.max(0, Math.min(100, Math.round(p * 100))));
      };
      ff.on('progress', onProgress);
      const ext = inferExt(file);
      const inputName = `in.${ext}`;
      const outputName = `out.${ext}`;
      setPhase('جارٍ تحميل الفيديو...');
      const { fetchFile } = await import('@ffmpeg/util');
      await ff.writeFile(inputName, await fetchFile(file));
      setPhase('جارٍ قص الفيديو...');
      // -ss before -i for fast seek; -c copy avoids re-encoding (keyframe-aligned cut).
      await ff.exec([
        '-ss', String(range[0].toFixed(3)),
        '-i', inputName,
        '-t', String(trimmedLen.toFixed(3)),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        outputName,
      ]);
      const data = await ff.readFile(outputName);
      try { ff.off('progress', onProgress); } catch (_) { /* ignore */ }
      try { await ff.deleteFile(inputName); } catch (_) { /* ignore */ }
      try { await ff.deleteFile(outputName); } catch (_) { /* ignore */ }
      const mime = inferMime(ext);
      const blob = new Blob([data], { type: mime });
      const baseName = (file.name || 'video').replace(/\.[^.]+$/, '');
      const newFile = new File([blob], `${baseName}-trimmed.${ext}`, { type: mime });
      onApply({
        file: newFile,
        start: range[0],
        end: range[1],
        duration: trimmedLen,
      });
    } catch (e) {
      console.error('trim failed', e);
      toast.error('تعذر قص الفيديو في المتصفح');
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  if (!file) return null;

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
          القص يتم داخل المتصفح بدون رفع الملف، باستخدام نسخ الترميز (سريع وبدون فقدان جودة).
          قد يبدأ المقطع من أقرب إطار مفتاحي قبل وقت البداية المحدد.
        </p>

        <DialogFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button
            onClick={handleApply}
            disabled={busy || trimmedLen <= 0 || (trimmedLen >= total - 0.05 && range[0] <= 0.05)}
            title={trimmedLen >= total - 0.05 && range[0] <= 0.05 ? 'حدد مقطعاً أقصر من المدة الكاملة' : ''}
          >
            {busy
              ? <Loader2 className="w-4 h-4 animate-spin ml-1" />
              : <Scissors className="w-4 h-4 ml-1" />}
            قص وحفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VideoTrimEditor;
