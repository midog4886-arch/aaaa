import React, { useCallback, useState } from 'react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Loader2, Crop as CropIcon } from 'lucide-react';

const ASPECTS = [
  { id: 'free', label: 'حر', value: null },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:5', label: '4:5', value: 4 / 5 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function cropImageToBlob(src, area, mime) {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(area.width);
  canvas.height = Math.round(area.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    img,
    area.x, area.y, area.width, area.height,
    0, 0, canvas.width, canvas.height,
  );
  const outMime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const quality = outMime === 'image/jpeg' ? 0.92 : undefined;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('canvas toBlob returned null'))),
      outMime,
      quality,
    );
  });
}

const MediaCropEditor = ({ open, file, previewUrl, onClose, onApply }) => {
  const [aspectId, setAspectId] = useState('1:1');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState(null);
  const [busy, setBusy] = useState(false);

  const aspect = ASPECTS.find(a => a.id === aspectId)?.value || undefined;
  const isVideo = !!(file && file.type && file.type.startsWith('video/'));

  const onCropComplete = useCallback((_, pixels) => setAreaPixels(pixels), []);

  const handleApply = async () => {
    if (!areaPixels || !file) return;
    setBusy(true);
    try {
      if (isVideo) {
        // Videos can't be re-encoded efficiently in-browser. We emit the
        // crop metadata and let the backend run ffmpeg at publish time.
        onApply({
          kind: 'video',
          crop: {
            x: Math.round(areaPixels.x),
            y: Math.round(areaPixels.y),
            width: Math.round(areaPixels.width),
            height: Math.round(areaPixels.height),
          },
          aspect: aspectId,
        });
      } else {
        const blob = await cropImageToBlob(previewUrl, areaPixels, file.type);
        if (!blob) return;
        const ext = (file.type === 'image/png') ? 'png' : 'jpg';
        const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
        const newFile = new File([blob], `${baseName}-cropped.${ext}`, { type: blob.type });
        onApply({ kind: 'image', file: newFile });
      }
    } catch (e) {
      console.error('crop failed', e);
    } finally {
      setBusy(false);
    }
  };

  if (!file) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CropIcon className="w-4 h-4" />
            {isVideo ? 'تأطير الفيديو واختيار النسبة' : 'قص الصورة واختيار النسبة'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 mb-2">
          {ASPECTS.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAspectId(a.id)}
              className={[
                'px-3 py-1 rounded border text-sm',
                aspectId === a.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
              ].join(' ')}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="relative w-full bg-black rounded overflow-hidden" style={{ height: 380 }}>
          {isVideo ? (
            <Cropper
              video={previewUrl}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              restrictPosition={false}
            />
          ) : (
            <Cropper
              image={previewUrl}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              restrictPosition={false}
            />
          )}
        </div>

        <div className="flex items-center gap-3 mt-3">
          <span className="text-xs text-gray-500 w-16">التكبير</span>
          <Slider
            min={1}
            max={3}
            step={0.05}
            value={[zoom]}
            onValueChange={(v) => setZoom(v[0])}
            className="flex-1"
          />
          <span className="text-xs text-gray-500 w-10 text-left">{zoom.toFixed(2)}x</span>
        </div>

        {isVideo && (
          <p className="text-xs text-gray-500 mt-2">
            سيتم تطبيق القص على الفيديو في الخادم عند النشر.
          </p>
        )}

        <DialogFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button onClick={handleApply} disabled={busy || !areaPixels}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <CropIcon className="w-4 h-4 ml-1" />}
            تطبيق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MediaCropEditor;
