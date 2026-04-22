import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Loader2, Wand2, Type, ImageIcon, Trash2, Upload, Save, BookmarkPlus } from 'lucide-react';
import { socialAPI } from '../services/api';

const PRESETS = [
  { id: 'none',     label: 'بدون',   filter: { brightness: 100, contrast: 100, saturate: 100, sepia: 0, grayscale: 0, hueRotate: 0 } },
  { id: 'vivid',    label: 'زاهية',  filter: { brightness: 105, contrast: 115, saturate: 140, sepia: 0, grayscale: 0, hueRotate: 0 } },
  { id: 'warm',     label: 'دافئة',  filter: { brightness: 105, contrast: 105, saturate: 120, sepia: 25, grayscale: 0, hueRotate: -10 } },
  { id: 'cool',     label: 'باردة',  filter: { brightness: 100, contrast: 105, saturate: 110, sepia: 0, grayscale: 0, hueRotate: 15 } },
  { id: 'mono',     label: 'أبيض/أسود', filter: { brightness: 105, contrast: 110, saturate: 0, sepia: 0, grayscale: 100, hueRotate: 0 } },
  { id: 'vintage',  label: 'كلاسيكية', filter: { brightness: 95, contrast: 95, saturate: 80, sepia: 45, grayscale: 0, hueRotate: 0 } },
  { id: 'sharp',    label: 'حادة',   filter: { brightness: 100, contrast: 130, saturate: 115, sepia: 0, grayscale: 0, hueRotate: 0 } },
];

const DEFAULT_LOGO = '/logo-new.png';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function computeFinalFilter(presetFilter, extraBrightness, extraContrast, extraSaturate) {
  return {
    brightness: Math.round(presetFilter.brightness * (extraBrightness / 100)),
    contrast: Math.round(presetFilter.contrast * (extraContrast / 100)),
    saturate: Math.round(presetFilter.saturate * (extraSaturate / 100)),
    sepia: presetFilter.sepia,
    grayscale: presetFilter.grayscale,
    hueRotate: presetFilter.hueRotate,
  };
}

function buildCssFilterString(f) {
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) sepia(${f.sepia}%) grayscale(${f.grayscale}%) hue-rotate(${f.hueRotate}deg)`;
}

const MediaImageEditor = ({ open, file, previewUrl, onClose, onApply }) => {
  const isVideo = !!(file && file.type?.startsWith('video/'));
  const isImage = !!(file && file.type?.startsWith('image/'));

  const [presetId, setPresetId] = useState('none');
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturate, setSaturate] = useState(100);

  const [text, setText] = useState('');
  const [textColor, setTextColor] = useState('#ffffff');
  const [textSize, setTextSize] = useState(48);
  const [textPos, setTextPos] = useState({ x: 50, y: 90 });

  // logoSource: '' (none) | 'default' | 'custom'
  const [logoSource, setLogoSource] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoSize, setLogoSize] = useState(20);
  const [logoPos, setLogoPos] = useState({ x: 95, y: 95 });
  const [logoOpacity, setLogoOpacity] = useState(80);

  const [imgEl, setImgEl] = useState(null);
  const [logoEl, setLogoEl] = useState(null);
  const [videoMeta, setVideoMeta] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);

  // Saved design templates
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState('');

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const dragRef = useRef(null);

  const preset = useMemo(() => PRESETS.find(p => p.id === presetId) || PRESETS[0], [presetId]);
  const finalFilter = useMemo(
    () => computeFinalFilter(preset.filter, brightness, contrast, saturate),
    [preset, brightness, contrast, saturate],
  );
  const cssFilter = useMemo(() => buildCssFilterString(finalFilter), [finalFilter]);

  // Reset state when a new file opens
  useEffect(() => {
    if (!open) return;
    setPresetId('none');
    setBrightness(100);
    setContrast(100);
    setSaturate(100);
    setText('');
    setTextColor('#ffffff');
    setTextSize(48);
    setTextPos({ x: 50, y: 90 });
    setLogoSource('');
    setLogoUrl('');
    setLogoFile(null);
    setLogoEl(null);
    setLogoSize(20);
    setLogoPos({ x: 95, y: 95 });
    setLogoOpacity(80);
    setVideoMeta({ w: 0, h: 0 });
    setSelectedTemplateId('');
    setTemplateName('');
    setTemplateError('');
  }, [open, previewUrl]);

  // Load saved templates whenever dialog opens
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setTemplatesLoading(true);
    socialAPI.listDesignTemplates()
      .then(res => { if (alive) setTemplates(res.data?.templates || []); })
      .catch(() => { if (alive) setTemplates([]); })
      .finally(() => { if (alive) setTemplatesLoading(false); });
    return () => { alive = false; };
  }, [open]);

  const buildCurrentSettings = () => ({
    preset_id: presetId,
    brightness,
    contrast,
    saturate,
    text,
    text_color: textColor,
    text_size: textSize,
    text_pos: textPos,
    logo: logoSource ? {
      // Custom (uploaded) logos cannot be persisted in the template; the user
      // will need to re-upload one if they want to reuse the position/size.
      source: logoSource === 'custom' ? '' : logoSource,
      size: logoSize,
      pos: logoPos,
      opacity: logoOpacity,
    } : null,
  });

  const applyTemplateSettings = (s) => {
    if (!s || typeof s !== 'object') return;
    if (s.preset_id) setPresetId(s.preset_id);
    if (typeof s.brightness === 'number') setBrightness(s.brightness);
    if (typeof s.contrast === 'number') setContrast(s.contrast);
    if (typeof s.saturate === 'number') setSaturate(s.saturate);
    setText(typeof s.text === 'string' ? s.text : '');
    if (s.text_color) setTextColor(s.text_color);
    if (typeof s.text_size === 'number') setTextSize(s.text_size);
    if (s.text_pos && typeof s.text_pos.x === 'number' && typeof s.text_pos.y === 'number') {
      setTextPos({ x: s.text_pos.x, y: s.text_pos.y });
    }
    if (s.logo && s.logo.source === 'default') {
      revokeIfBlob(logoUrl);
      setLogoUrl(DEFAULT_LOGO);
      setLogoFile(null);
      setLogoSource('default');
      if (typeof s.logo.size === 'number') setLogoSize(s.logo.size);
      if (s.logo.pos) setLogoPos({ x: s.logo.pos.x, y: s.logo.pos.y });
      if (typeof s.logo.opacity === 'number') setLogoOpacity(s.logo.opacity);
    } else {
      // Either no logo in template, or it referenced a custom upload we
      // cannot restore — clear the current logo so the user knows.
      revokeIfBlob(logoUrl);
      setLogoUrl('');
      setLogoFile(null);
      setLogoEl(null);
      setLogoSource('');
    }
  };

  const handleSelectTemplate = (id) => {
    setSelectedTemplateId(id);
    setTemplateError('');
    if (!id) return;
    const tpl = templates.find(t => t.id === id);
    if (tpl) applyTemplateSettings(tpl.settings || {});
  };

  const handleSaveTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      setTemplateError('أدخل اسماً للقالب');
      return;
    }
    setSavingTemplate(true);
    setTemplateError('');
    try {
      const res = await socialAPI.createDesignTemplate(name, buildCurrentSettings());
      const created = res.data;
      setTemplates(prev => [created, ...prev.filter(t => t.id !== created.id)]);
      setSelectedTemplateId(created.id);
      setTemplateName('');
    } catch (e) {
      setTemplateError(e.response?.data?.detail || 'تعذر حفظ القالب');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId) return;
    const tpl = templates.find(t => t.id === selectedTemplateId);
    if (!tpl) return;
    if (!window.confirm(`حذف القالب "${tpl.name}"؟`)) return;
    try {
      await socialAPI.deleteDesignTemplate(selectedTemplateId);
      setTemplates(prev => prev.filter(t => t.id !== selectedTemplateId));
      setSelectedTemplateId('');
    } catch (e) {
      setTemplateError(e.response?.data?.detail || 'تعذر حذف القالب');
    }
  };

  // Load source image (image only)
  useEffect(() => {
    let alive = true;
    if (!previewUrl || !isImage) { setImgEl(null); return; }
    loadImage(previewUrl).then(img => { if (alive) setImgEl(img); }).catch(() => {});
    return () => { alive = false; };
  }, [previewUrl, isImage]);

  // Load logo image whenever URL changes
  useEffect(() => {
    let alive = true;
    if (!logoUrl) { setLogoEl(null); return; }
    loadImage(logoUrl).then(img => { if (alive) setLogoEl(img); }).catch(() => setLogoEl(null));
    return () => { alive = false; };
  }, [logoUrl]);

  // Render canvas for image
  useEffect(() => {
    if (!isImage) return;
    const canvas = canvasRef.current;
    if (!canvas || !imgEl) return;
    const w = imgEl.naturalWidth;
    const h = imgEl.naturalHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.filter = cssFilter;
    ctx.drawImage(imgEl, 0, 0, w, h);
    ctx.restore();

    if (logoEl) {
      const lw = (logoSize / 100) * w;
      const ratio = logoEl.naturalHeight / logoEl.naturalWidth;
      const lh = lw * ratio;
      const cx = (logoPos.x / 100) * w - lw / 2;
      const cy = (logoPos.y / 100) * h - lh / 2;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, logoOpacity / 100));
      ctx.drawImage(logoEl, cx, cy, lw, lh);
      ctx.restore();
    }

    if (text && text.trim() !== '') {
      ctx.save();
      const fontPx = (textSize / 100) * Math.min(w, h) * 0.8;
      ctx.font = `bold ${Math.round(fontPx)}px system-ui, -apple-system, "Segoe UI", Tahoma, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tx = (textPos.x / 100) * w;
      const ty = (textPos.y / 100) * h;
      ctx.lineWidth = Math.max(2, fontPx * 0.06);
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.fillStyle = textColor;
      ctx.strokeText(text, tx, ty);
      ctx.fillText(text, tx, ty);
      ctx.restore();
    }
  }, [isImage, imgEl, cssFilter, logoEl, logoSize, logoPos, logoOpacity, text, textColor, textSize, textPos]);

  const revokeIfBlob = (url) => {
    if (url && url.startsWith('blob:')) {
      try { URL.revokeObjectURL(url); } catch (_) { /* noop */ }
    }
  };

  const handlePickLogo = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    revokeIfBlob(logoUrl);
    setLogoUrl(URL.createObjectURL(f));
    setLogoFile(f);
    setLogoSource('custom');
  };

  const useDefaultLogo = () => {
    revokeIfBlob(logoUrl);
    setLogoUrl(DEFAULT_LOGO);
    setLogoFile(null);
    setLogoSource('default');
  };
  const removeLogo = () => {
    revokeIfBlob(logoUrl);
    setLogoUrl('');
    setLogoFile(null);
    setLogoEl(null);
    setLogoSource('');
  };

  // Revoke any logo blob URL on unmount or when the dialog closes
  useEffect(() => {
    if (open) return undefined;
    return () => revokeIfBlob(logoUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => revokeIfBlob(logoUrl), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag handling on the preview to move text/logo
  const startDrag = (target, e) => {
    e.preventDefault();
    dragRef.current = { target, rect: containerRef.current.getBoundingClientRect() };
  };
  const onMouseMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = d.rect;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    const x = Math.max(0, Math.min(100, px));
    const y = Math.max(0, Math.min(100, py));
    if (d.target === 'text') setTextPos({ x, y });
    else if (d.target === 'logo') setLogoPos({ x, y });
  };
  const endDrag = () => { dragRef.current = null; };
  const onTouchMove = (e) => {
    if (!dragRef.current || !e.touches[0]) return;
    onMouseMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
  };

  const handleVideoLoaded = () => {
    const v = videoRef.current;
    if (v) setVideoMeta({ w: v.videoWidth || 0, h: v.videoHeight || 0 });
  };

  const handleApply = async () => {
    if (!file) return;
    setBusy(true);
    try {
      if (isImage) {
        if (!canvasRef.current) return;
        const outMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const quality = outMime === 'image/jpeg' ? 0.92 : undefined;
        const blob = await new Promise((resolve, reject) => {
          canvasRef.current.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob null'))), outMime, quality);
        });
        const ext = outMime === 'image/png' ? 'png' : 'jpg';
        const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
        const newFile = new File([blob], `${baseName}-edited.${ext}`, { type: blob.type });
        onApply({ kind: 'image', file: newFile });
      } else if (isVideo) {
        // For videos we don't re-encode in the browser — that's expensive.
        // Instead we hand the settings up to the page so they can be sent
        // to the backend, which applies them with ffmpeg before publishing.
        const hasFilter =
          finalFilter.brightness !== 100 || finalFilter.contrast !== 100 ||
          finalFilter.saturate !== 100 || finalFilter.sepia !== 0 ||
          finalFilter.grayscale !== 0 || finalFilter.hueRotate !== 0;
        const edits = {
          filter: hasFilter ? finalFilter : null,
          logo: logoSource ? {
            source: logoSource, // 'default' | 'custom'
            size_percent: logoSize,
            x_percent: logoPos.x,
            y_percent: logoPos.y,
            opacity_percent: logoOpacity,
          } : null,
        };
        onApply({
          kind: 'video',
          edits,
          logoFile: logoSource === 'custom' ? logoFile : null,
        });
      }
    } catch (e) {
      console.error('media edit failed', e);
    } finally {
      setBusy(false);
    }
  };

  if (!file || (!isImage && !isVideo)) return null;

  // Aspect ratio for the preview container
  const previewAspect = isImage && imgEl
    ? `${imgEl.naturalWidth} / ${imgEl.naturalHeight}`
    : (isVideo && videoMeta.w && videoMeta.h ? `${videoMeta.w} / ${videoMeta.h}` : '1 / 1');

  // Logo preview overlay (shared between image canvas overlay and video overlay).
  // For image preview the logo is baked into the canvas, so no overlay needed.
  // For video preview we show an absolutely-positioned <img> on top of the video.
  const logoOverlayForVideo = isVideo && logoEl ? (
    <img
      src={logoUrl}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        left: `${logoPos.x}%`,
        top: `${logoPos.y}%`,
        width: `${logoSize}%`,
        opacity: Math.max(0, Math.min(1, logoOpacity / 100)),
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    />
  ) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-4 h-4" />
            {isVideo
              ? 'تعديل الفيديو: فلاتر وشعار'
              : 'تعديل الصورة: فلاتر، نص، شعار'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Preview */}
          <div
            ref={containerRef}
            className="relative w-full bg-black rounded overflow-hidden select-none"
            style={{
              aspectRatio: previewAspect,
              maxHeight: '60vh',
              touchAction: 'none',
            }}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            onTouchMove={onTouchMove}
            onTouchEnd={endDrag}
          >
            {isImage && (
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-contain"
              />
            )}
            {isVideo && (
              <video
                ref={videoRef}
                src={previewUrl}
                muted
                loop
                autoPlay
                playsInline
                onLoadedMetadata={handleVideoLoaded}
                className="absolute inset-0 w-full h-full object-contain"
                style={{ filter: cssFilter }}
              />
            )}
            {logoOverlayForVideo}
            {/* Drag handles */}
            {isImage && text && text.trim() !== '' && (
              <button
                type="button"
                onMouseDown={(e) => startDrag('text', e)}
                onTouchStart={(e) => startDrag('text', e)}
                className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 bg-white/80 rounded-full border border-blue-500 cursor-move flex items-center justify-center"
                style={{ left: `${textPos.x}%`, top: `${textPos.y}%` }}
                title="اسحب لتحريك النص"
              >
                <Type className="w-3 h-3 text-blue-600" />
              </button>
            )}
            {logoEl && (
              <button
                type="button"
                onMouseDown={(e) => startDrag('logo', e)}
                onTouchStart={(e) => startDrag('logo', e)}
                className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 bg-white/80 rounded-full border border-emerald-500 cursor-move flex items-center justify-center"
                style={{ left: `${logoPos.x}%`, top: `${logoPos.y}%` }}
                title="اسحب لتحريك الشعار"
              >
                <ImageIcon className="w-3 h-3 text-emerald-600" />
              </button>
            )}
          </div>

          {/* Controls */}
          <div className="space-y-4 text-sm">
            <div className="rounded border border-blue-100 bg-blue-50/40 p-2">
              <Label className="text-xs font-semibold flex items-center gap-1">
                <BookmarkPlus className="w-3.5 h-3.5" /> قوالب التصميم المحفوظة
              </Label>
              <div className="flex items-center gap-2 mt-1">
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleSelectTemplate(e.target.value)}
                  disabled={templatesLoading}
                  className="flex-1 h-8 text-xs rounded border border-gray-300 bg-white px-2"
                >
                  <option value="">
                    {templatesLoading
                      ? 'جارٍ التحميل...'
                      : (templates.length === 0 ? 'لا يوجد قوالب محفوظة' : 'اختر قالباً لتطبيقه')}
                  </option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {selectedTemplateId && (
                  <Button type="button" size="sm" variant="outline" onClick={handleDeleteTemplate} title="حذف القالب">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="اسم القالب الجديد"
                  className="h-8 text-xs flex-1"
                  maxLength={60}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveTemplate}
                  disabled={savingTemplate || !templateName.trim()}
                >
                  {savingTemplate
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" />
                    : <Save className="w-3.5 h-3.5 ml-1" />}
                  حفظ كقالب
                </Button>
              </div>
              {templateError && (
                <p className="text-[11px] text-red-600 mt-1">{templateError}</p>
              )}
              <p className="text-[10px] text-gray-500 mt-1">
                ملاحظة: الشعارات المرفوعة لا تُحفظ مع القالب — احفظ بعد اختيار شعار الأكاديمية أو أعد رفع الشعار يدوياً.
              </p>
            </div>

            <div>
              <Label className="text-xs font-semibold">فلاتر جاهزة</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {PRESETS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPresetId(p.id)}
                    className={[
                      'px-2.5 py-1 rounded border text-xs',
                      presetId === p.id
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
                    ].join(' ')}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {[
                { label: 'السطوع', value: brightness, set: setBrightness },
                { label: 'التباين', value: contrast, set: setContrast },
                { label: 'التشبع', value: saturate, set: setSaturate },
              ].map(row => (
                <div key={row.label} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 w-14">{row.label}</span>
                  <Slider
                    min={50}
                    max={150}
                    step={1}
                    value={[row.value]}
                    onValueChange={(v) => row.set(v[0])}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-500 w-10 text-left">{row.value}%</span>
                </div>
              ))}
            </div>

            {isImage && (
              <div className="border-t pt-3">
                <Label className="text-xs font-semibold flex items-center gap-1">
                  <Type className="w-3.5 h-3.5" /> نص فوق الصورة
                </Label>
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="اكتب النص هنا"
                  className="mt-1 h-8"
                />
                {text && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border"
                      title="لون النص"
                    />
                    <span className="text-xs text-gray-600 w-10">حجم</span>
                    <Slider
                      min={3}
                      max={15}
                      step={1}
                      value={[textSize / 5]}
                      onValueChange={(v) => setTextSize(v[0] * 5)}
                      className="flex-1"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="border-t pt-3">
              <Label className="text-xs font-semibold flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5" /> الشعار / علامة مائية
              </Label>
              <div className="flex flex-wrap gap-2 mt-1">
                <Button type="button" size="sm" variant="outline" onClick={useDefaultLogo}>
                  <ImageIcon className="w-3.5 h-3.5 ml-1" /> شعار الأكاديمية
                </Button>
                <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-gray-300 text-xs cursor-pointer hover:bg-gray-50">
                  <Upload className="w-3.5 h-3.5" /> رفع شعار
                  <input type="file" accept="image/*" className="hidden" onChange={handlePickLogo} />
                </label>
                {logoEl && (
                  <Button type="button" size="sm" variant="outline" onClick={removeLogo}>
                    <Trash2 className="w-3.5 h-3.5 ml-1" /> إزالة
                  </Button>
                )}
              </div>
              {logoEl && (
                <div className="space-y-2 mt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-14">الحجم</span>
                    <Slider min={5} max={50} step={1} value={[logoSize]} onValueChange={(v) => setLogoSize(v[0])} className="flex-1" />
                    <span className="text-xs text-gray-500 w-10 text-left">{logoSize}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-14">الشفافية</span>
                    <Slider min={20} max={100} step={5} value={[logoOpacity]} onValueChange={(v) => setLogoOpacity(v[0])} className="flex-1" />
                    <span className="text-xs text-gray-500 w-10 text-left">{logoOpacity}%</span>
                  </div>
                </div>
              )}
            </div>

            <p className="text-[11px] text-gray-500 border-t pt-2">
              {isVideo
                ? 'يمكنك سحب الشعار على المعاينة لتحريكه. تتم معالجة الفيديو على الخادم عند النشر.'
                : 'يمكنك سحب النص أو الشعار على المعاينة لتحريكهما. تتم المعالجة في المتصفح.'}
            </p>
          </div>
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button onClick={handleApply} disabled={busy || (isImage && !imgEl)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Wand2 className="w-4 h-4 ml-1" />}
            تطبيق التعديلات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MediaImageEditor;
