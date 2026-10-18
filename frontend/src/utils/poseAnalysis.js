// MediaPipe Pose Landmarker uses the same 33 landmark indices for both sports.
// These are geometric observations from a single camera view, not clinical or
// sport-specific performance scores.
const EDGES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 31], [28, 32],
];

const visible = point => point && (point.visibility ?? 1) >= 0.5 && (point.presence ?? 1) >= 0.5;

export const angleAt = (first, middle, last, aspect = 1) => {
  if (![first, middle, last].every(visible)) return null;
  const a = [(first.x - middle.x) * aspect, first.y - middle.y];
  const b = [(last.x - middle.x) * aspect, last.y - middle.y];
  const magnitude = Math.hypot(...a) * Math.hypot(...b);
  if (magnitude < 1e-6) return null;
  return Math.round(Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / magnitude))) * 180 / Math.PI);
};

export const poseMetrics = (points, sport, side = 'right', aspect = 1) => {
  if (!Array.isArray(points) || points.length < 29) return null;
  const [shoulder, elbow, wrist, hip, knee, ankle] = side === 'left'
    ? [11, 13, 15, 23, 25, 27]
    : [12, 14, 16, 24, 26, 28];
  const metrics = sport === 'swimming'
    ? { elbow_angle: angleAt(points[shoulder], points[elbow], points[wrist], aspect),
        hip_angle: angleAt(points[shoulder], points[hip], points[knee], aspect) }
    : { knee_angle: angleAt(points[hip], points[knee], points[ankle], aspect),
        hip_angle: angleAt(points[shoulder], points[hip], points[knee], aspect) };
  const upper = points[shoulder];
  const lower = points[hip];
  metrics.body_tilt = visible(upper) && visible(lower)
    ? Math.round(Math.atan2(Math.abs(upper.x - lower.x) * aspect, Math.abs(upper.y - lower.y)) * 180 / Math.PI)
    : null;
  return metrics;
};

export const drawPose = (canvas, video, points) => {
  if (!canvas || !video) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(scale, scale);
  context.clearRect(0, 0, width, height);
  if (!Array.isArray(points) || !video.videoWidth || !video.videoHeight) return;
  const fit = Math.min(width / video.videoWidth, height / video.videoHeight);
  const imageWidth = video.videoWidth * fit;
  const imageHeight = video.videoHeight * fit;
  const originX = (width - imageWidth) / 2;
  const originY = (height - imageHeight) / 2;
  const at = point => [originX + point.x * imageWidth, originY + point.y * imageHeight];
  context.lineWidth = 3;
  context.strokeStyle = '#2ef2b3';
  for (const [a, b] of EDGES) {
    if (!visible(points[a]) || !visible(points[b])) continue;
    context.beginPath();
    context.moveTo(...at(points[a]));
    context.lineTo(...at(points[b]));
    context.stroke();
  }
  context.fillStyle = '#ffb347';
  for (const point of points) {
    if (!visible(point)) continue;
    context.beginPath();
    context.arc(...at(point), 3.5, 0, Math.PI * 2);
    context.fill();
  }
};
