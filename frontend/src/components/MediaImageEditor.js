import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Loader2, Wand2, Type, ImageIcon, Trash2, Upload } from 'lucide-react';

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

function buildFilterString(f, extraBrightness, extraContrast, extraSaturate) {
  const b = Math.round((f.brightness * (extraBrightness / 100)));
  const c = Math.round((f.contrast * (extraContrast / 100)));
  const s = Math.round((f.saturate * (extraSaturate / 100)));
  return `brightness(${b}%) contrast(${c}%) saturate(${s}%) sepia(${f.sepia}%) grayscale(${f.grayscale}%) hue-rotate(${f.hueRotate}deg)`;
}

const MediaImageEditor = ({ open, file, previewUrl, onClose, onApply }) => {
  const [presetId, setPresetId] = useState('none');
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturate, setSaturate] = useState(100);

  const [text, setText] = useState('');
  const [textColor, setTextColor] = useState('#ffffff');
  const [textSize, setTextSize] = useState(48);
  const [textPos, setTextPos] = useState({ x: 50, y: 90 }); // % of width/height (bottom)

  const [logoUrl, setLogoUrl] = useState('');
  const [logoSize, setLogoSize] = useState(20); // % of canvas width
  const [logoPos, setLogoPos] = useState({ x: 95, y: 95 }); // % anchored to bottom-right
  const [logoOpacity, setLogoOpacity] = useState(80);

  const [imgEl, setImgEl] = useState(null);
  const [logoEl, setLogoEl] = useState(null);
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const dragRef = useRef(null);

  const preset = useMemo(() => PRESETS.find(p => p.id === presetId) || PRESETS[0], [presetId]);

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
    setLogoUrl('');
    setLogoEl(null);
    setLogoSize(20);
    setLogoPos({ x: 95, y: 95 });
    setLogoOpacity(80);
  }, [open, previewUrl]);

  // Load source image
  useEffect(() => {
    let alive = true;
    if (!previewUrl) { setImgEl(null); return; }
    loadImage(previewUrl).then(img => { if (alive) setImgEl(img); }).catch(() => {});
    return () => { alive = false; };
  }, [previewUrl]);

  // Load logo image whenever URL changes
  useEffect(() => {
    let alive = true;
    if (!logoUrl) { setLogoEl(null); return; }
    loadImage(logoUrl).then(img => { if (alive) setLogoEl(img); }).catch(() => setLogoEl(null));
    return () => { alive = false; };
  }, [logoUrl]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl) return;
    const w = imgEl.naturalWidth;
    const h = imgEl.naturalHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.filter = buildFilterString(preset.filter, brightness, contrast, saturate);
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
  }, [imgEl, preset, brightness, contrast, saturate, logoEl, logoSize, logoPos, logoOpacity, text, textColor, textSize, textPos]);

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
  };

  const useDefaultLogo = () => { revokeIfBlob(logoUrl); setLogoUrl(DEFAULT_LOGO); };
  const removeLogo = () => { revokeIfBlob(logoUrl); setLogoUrl(''); setLogoEl(null); };

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

  const handleApply = async () => {
    if (!canvasRef.current || !file) return;
    setBusy(true);
    try {
      const outMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const quality = outMime === 'image/jpeg' ? 0.92 : undefined;
      const blob = await new Promise((resolve, reject) => {
        canvasRef.current.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob null'))), outMime, quality);
      });
      const ext = outMime === 'image/png' ? 'png' : 'jpg';
      const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
      const newFile = new File([blob], `${baseName}-edited.${ext}`, { type: blob.type });
      onApply({ kind: 'image', file: newFile });
    } catch (e) {
      console.error('image edit failed', e);
    } finally {
      setBusy(false);
    }
  };

  if (!file || !file.type?.startsWith('image/')) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-4 h-4" />
            تعديل الصورة: فلاتر، نص، شعار
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Preview */}
          <div
            ref={containerRef}
            className="relative w-full bg-black rounded overflow-hidden select-none"
            style={{
              aspectRatio: imgEl ? `${imgEl.naturalWidth} / ${imgEl.naturalHeight}` : '1 / 1',
              maxHeight: '60vh',
              touchAction: 'none',
            }}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            onTouchMove={onTouchMove}
            onTouchEnd={endDrag}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-contain"
            />
            {/* Drag handles */}
            {text && text.trim() !== '' && (
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
              يمكنك سحب النص أو الشعار على المعاينة لتحريكهما. تتم المعالجة في المتصفح.
            </p>
          </div>
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button onClick={handleApply} disabled={busy || !imgEl}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Wand2 className="w-4 h-4 ml-1" />}
            تطبيق التعديلات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MediaImageEditor;
