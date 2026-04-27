const DEFAULT_MAX_DIMENSION = 800;
const DEFAULT_QUALITY = 0.85;
const DEFAULT_MIME = 'image/jpeg';
const DEFAULT_COMPRESS_THRESHOLD_BYTES = 2 * 1024 * 1024;
const HARD_CAP_BYTES = 2 * 1024 * 1024;
const MIN_QUALITY = 0.4;

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });

export const estimateDataUrlBytes = (dataUrl) => {
  if (!dataUrl) return 0;
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
};

export const compressImageFile = async (file, options = {}) => {
  if (!file) throw new Error('No file provided');
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('Not an image file');
  }

  const {
    compressThresholdBytes = DEFAULT_COMPRESS_THRESHOLD_BYTES,
    maxDimension = DEFAULT_MAX_DIMENSION,
    quality = DEFAULT_QUALITY,
    mimeType = DEFAULT_MIME,
    hardCapBytes = HARD_CAP_BYTES,
  } = options;

  const originalDataUrl = await readFileAsDataUrl(file);

  if (file.size <= compressThresholdBytes) {
    return originalDataUrl;
  }

  if (typeof document === 'undefined' || !document.createElement) {
    return originalDataUrl;
  }

  let img;
  try {
    img = await loadImage(originalDataUrl);
  } catch (err) {
    return originalDataUrl;
  }

  const { width: srcW, height: srcH } = img;
  if (!srcW || !srcH) return originalDataUrl;

  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > maxDimension ? maxDimension / longEdge : 1;
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return originalDataUrl;
  // White background so transparent PNGs don't render black on JPEG.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  let q = quality;
  let result = canvas.toDataURL(mimeType, q);
  while (estimateDataUrlBytes(result) > hardCapBytes && q > MIN_QUALITY) {
    q = Math.max(MIN_QUALITY, q - 0.1);
    result = canvas.toDataURL(mimeType, q);
  }

  if (estimateDataUrlBytes(result) >= estimateDataUrlBytes(originalDataUrl)) {
    return originalDataUrl;
  }

  return result;
};

export const PROFILE_PHOTO_HARD_CAP_BYTES = HARD_CAP_BYTES;
