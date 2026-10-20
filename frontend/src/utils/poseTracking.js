// MediaPipe returns pose arrays without persistent person IDs. Never silently
// substitute another detection when the selected person becomes ambiguous.
const BODY_POINTS = [11, 12, 23, 24];
const MIN_VISIBILITY = 0.5;
export const OCCLUSION_GRACE_SECONDS = 2;

const visible = point => point && (point.visibility ?? 1) >= MIN_VISIBILITY && (point.presence ?? 1) >= MIN_VISIBILITY;
const hide = point => point ? { ...point, visibility: 0, presence: 0 } : point;

// A multi-person pose can contain a limb from a neighbour even when its torso
// matches the selected swimmer. Check each chain independently before drawing
// it or allowing its joints into an angle calculation.
export const sanitizeSelectedPose = (points, selectedBox, otherBoxes = []) => {
  if (!Array.isArray(points) || !selectedBox) return { points: null, unreliable: true };
  const clean = points.map(point => visible(point) ? point : hide(point));
  const center = selectedBox.center;
  const torso = Math.max(0.08, Math.hypot((points[11]?.x ?? center.x) - (points[23]?.x ?? center.x),
    (points[11]?.y ?? center.y) - (points[23]?.y ?? center.y)),
  Math.hypot((points[12]?.x ?? center.x) - (points[24]?.x ?? center.x),
    (points[12]?.y ?? center.y) - (points[24]?.y ?? center.y)));
  let rejected = 0;
  const reject = index => { if (visible(clean[index])) { clean[index] = hide(clean[index]); rejected += 1; } };
  for (const index of BODY_POINTS) {
    const point = clean[index];
    if (!visible(point)) continue;
    const ownDistance = Math.hypot(point.x - center.x, point.y - center.y);
    if (otherBoxes.some(box => box &&
      Math.hypot(point.x - box.center.x, point.y - box.center.y) + torso * 0.15 < ownDistance &&
      Math.hypot(point.x - box.center.x, point.y - box.center.y) < Math.max(box.width, box.height, torso))) reject(index);
  }
  const chains = [[11, 13, 15], [12, 14, 16], [23, 25, 27, 31], [24, 26, 28, 32]];
  for (const chain of chains) {
    for (let position = 1; position < chain.length; position += 1) {
      const index = chain[position], parent = clean[chain[position - 1]], point = clean[index];
      if (!visible(point)) continue;
      if (!visible(parent) || Math.hypot(point.x - parent.x, point.y - parent.y) > torso * 1.65) {
        reject(index);
        continue;
      }
      const ownDistance = Math.hypot(point.x - center.x, point.y - center.y);
      if (otherBoxes.some(box => box &&
        Math.hypot(point.x - box.center.x, point.y - box.center.y) + torso * 0.15 < ownDistance &&
        Math.hypot(point.x - box.center.x, point.y - box.center.y) < Math.max(box.width, box.height, torso))) {
        reject(index);
      }
    }
  }
  const torsoUnreliable = ![11, 12].some(index => visible(clean[index])) || ![23, 24].some(index => visible(clean[index]));
  return { points: torsoUnreliable ? null : clean, unreliable: rejected > 0 || torsoUnreliable, rejected };
};

export const poseBox = points => {
  if (!Array.isArray(points)) return null;
  const body = BODY_POINTS.map(index => points[index]).filter(visible);
  // Swimming often hides one shoulder or hip below the waterline. One
  // shoulder and one hip still anchor the torso without using floating hands.
  const shoulders = [points[11], points[12]].filter(visible);
  const hips = [points[23], points[24]].filter(visible);
  if (body.length < 2 || !shoulders.length || !hips.length) return null;
  const all = points.filter(visible);
  const xs = all.map(point => point.x);
  const ys = all.map(point => point.y);
  let left = Math.max(0, Math.min(...xs));
  let right = Math.min(1, Math.max(...xs));
  const top = Math.max(0, Math.min(...ys));
  const bottom = Math.min(1, Math.max(...ys));
  const center = {
    x: body.reduce((sum, point) => sum + point.x, 0) / body.length,
    y: body.reduce((sum, point) => sum + point.y, 0) / body.length,
  };
  if (body.length === 2 && right - left < 0.06) {
    left = Math.max(0, center.x - 0.03);
    right = Math.min(1, center.x + 0.03);
  }
  if (right - left < 0.025 || bottom - top < 0.04) return null;
  return { left, right, top, bottom, center, width: right - left, height: bottom - top };
};

export const pickPose = (boxes, position) => {
  const hits = boxes.map((box, index) => ({ box, index })).filter(({ box }) => box &&
    position.x >= box.left && position.x <= box.right && position.y >= box.top && position.y <= box.bottom);
  if (hits.length !== 1) return null;
  return hits[0].index;
};

const overlapRatio = (a, b) => {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height / Math.min(a.width * a.height, b.width * b.height);
};

export const ambiguousPose = (previous, boxes, elapsedMs = 180) => {
  if (!previous) return false;
  const gate = Math.max(0.12, Math.min(0.32,
    Math.max(previous.width, previous.height) * 0.8 + Math.min(0.1, Math.max(0, elapsedMs) * 0.0004)));
  const nearby = boxes.filter(box => box &&
    Math.hypot(box.center.x - previous.center.x, box.center.y - previous.center.y) <= gate);
  // A single oversized detection may be two people merged into one pose.
  if (nearby.length === 1 && nearby[0].width * nearby[0].height > previous.width * previous.height * 2) return true;
  for (let i = 0; i < nearby.length; i += 1) {
    for (let j = i + 1; j < nearby.length; j += 1) {
      const a = nearby[i], b = nearby[j];
      const centerDistance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
      if (overlapRatio(a, b) > 0.12 || centerDistance < Math.max(a.width, a.height, b.width, b.height) * 0.75) return true;
    }
  }
  return false;
};

export const matchPose = (previous, boxes, elapsedMs = 180) => {
  if (!previous) return null;
  if (ambiguousPose(previous, boxes, elapsedMs)) return null;
  const ranked = boxes.map((box, index) => {
    if (!box) return null;
    const distance = Math.hypot(box.center.x - previous.center.x, box.center.y - previous.center.y);
    // Fast movement can move the torso substantially between sampled frames.
    // Expand the gate with elapsed time, but cap it to avoid jumping across the video.
    const allowed = Math.max(0.12, Math.min(0.32,
      Math.max(previous.width, previous.height) * 0.8 + Math.min(0.1, Math.max(0, elapsedMs) * 0.0004)));
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
