// MediaPipe returns pose arrays without persistent person IDs. Never silently
// substitute another detection when the selected person becomes ambiguous.
const BODY_POINTS = [11, 12, 23, 24];
const MIN_VISIBILITY = 0.5;

const visible = point => point && (point.visibility ?? 1) >= MIN_VISIBILITY && (point.presence ?? 1) >= MIN_VISIBILITY;

export const poseBox = points => {
  if (!Array.isArray(points)) return null;
  const body = BODY_POINTS.map(index => points[index]).filter(visible);
  if (body.length < 3) return null;
  const all = points.filter(visible);
  const xs = all.map(point => point.x);
  const ys = all.map(point => point.y);
  const left = Math.max(0, Math.min(...xs));
  const right = Math.min(1, Math.max(...xs));
  const top = Math.max(0, Math.min(...ys));
  const bottom = Math.min(1, Math.max(...ys));
  const center = {
    x: body.reduce((sum, point) => sum + point.x, 0) / body.length,
    y: body.reduce((sum, point) => sum + point.y, 0) / body.length,
  };
  if (right - left < 0.025 || bottom - top < 0.04) return null;
  return { left, right, top, bottom, center, width: right - left, height: bottom - top };
};

export const pickPose = (boxes, position) => {
  const hits = boxes.map((box, index) => ({ box, index })).filter(({ box }) => box &&
    position.x >= box.left && position.x <= box.right && position.y >= box.top && position.y <= box.bottom);
  if (hits.length !== 1) return null;
  return hits[0].index;
};

export const matchPose = (previous, boxes) => {
  if (!previous) return null;
  const ranked = boxes.map((box, index) => {
    if (!box) return null;
    const distance = Math.hypot(box.center.x - previous.center.x, box.center.y - previous.center.y);
    const allowed = Math.max(0.075, Math.min(0.18, Math.max(previous.width, previous.height) * 0.55));
    const sizeRatio = Math.max(box.width / previous.width, previous.width / box.width,
      box.height / previous.height, previous.height / box.height);
    return distance <= allowed && sizeRatio < 1.8 ? { index, score: distance / allowed + Math.max(0, sizeRatio - 1) * 0.3 } : null;
  }).filter(Boolean).sort((a, b) => a.score - b.score);
  if (!ranked.length || (ranked.length > 1 && ranked[1].score - ranked[0].score < 0.35)) return null;
  return ranked[0].index;
};

export const videoPoint = (event, video, canvas) => {
  if (!video?.videoWidth || !video?.videoHeight || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const fit = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const width = video.videoWidth * fit;
  const height = video.videoHeight * fit;
  const x = event.clientX - rect.left - (rect.width - width) / 2;
  const y = event.clientY - rect.top - (rect.height - height) / 2;
  if (x < 0 || y < 0 || x > width || y > height) return null;
  return { x: x / width, y: y / height };
};
