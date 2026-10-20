import { ambiguousPose, matchPose, pickPose, poseBox, sanitizeSelectedPose, videoPoint } from './poseTracking';

const pose = (x, y, scale = 1) => {
  const points = Array.from({ length: 33 }, () => ({ x, y, visibility: 0 }));
  points[11] = { x: x - 0.04 * scale, y: y - 0.12 * scale, visibility: 1 };
  points[12] = { x: x + 0.04 * scale, y: y - 0.12 * scale, visibility: 1 };
  points[23] = { x: x - 0.03 * scale, y: y + 0.12 * scale, visibility: 1 };
  points[24] = { x: x + 0.03 * scale, y: y + 0.12 * scale, visibility: 1 };
  return points;
};

test('selection chooses only one person under the click', () => {
  const boxes = [poseBox(pose(0.2, 0.5)), poseBox(pose(0.8, 0.5))];
  expect(pickPose(boxes, { x: 0.2, y: 0.5 })).toBe(0);
  expect(pickPose(boxes, { x: 0.5, y: 0.5 })).toBeNull();
  expect(pickPose([boxes[0], boxes[0]], { x: 0.2, y: 0.5 })).toBeNull();
});

test('tracking holds the selected person even when detection order changes', () => {
  const first = poseBox(pose(0.2, 0.5));
  const reordered = [poseBox(pose(0.8, 0.5)), poseBox(pose(0.22, 0.5))];
  expect(matchPose(first, reordered)).toBe(1);
  expect(matchPose(first, [poseBox(pose(0.8, 0.5))])).toBeNull();
});

test('fast movement stays with the same isolated person between video frames', () => {
  const previous = poseBox(pose(0.3, 0.5));
  expect(matchPose(previous, [poseBox(pose(0.51, 0.5)), poseBox(pose(0.9, 0.5))], 250)).toBe(0);
});

test('tracking stops when two people become indistinguishable', () => {
  const previous = poseBox(pose(0.5, 0.5));
  expect(matchPose(previous, [poseBox(pose(0.49, 0.5)), poseBox(pose(0.51, 0.5))])).toBeNull();
});

test('crossing people require a new selection before measurements resume', () => {
  const previous = poseBox(pose(0.45, 0.5));
  const crossing = [poseBox(pose(0.46, 0.5)), poseBox(pose(0.49, 0.5))];
  expect(ambiguousPose(previous, crossing)).toBe(true);
  expect(matchPose(previous, crossing)).toBeNull();
  expect(ambiguousPose(previous, [poseBox(pose(0.48, 0.5)), poseBox(pose(0.9, 0.5))])).toBe(false);
  expect(ambiguousPose(previous, [poseBox(pose(0.45, 0.5, 1.6))])).toBe(true);
});

test('click mapping accounts for video letterboxing', () => {
  const canvas = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }) };
  const video = { videoWidth: 400, videoHeight: 200 };
  expect(videoPoint({ clientX: 300, clientY: 200 }, video, canvas)).toEqual({ x: 0.5, y: 0.5 });
  expect(videoPoint({ clientX: 300, clientY: 70 }, video, canvas)).toBeNull();
});

test('a swimmer remains detectable with one shoulder and one hip visible', () => {
  const partlySubmerged = pose(0.5, 0.5);
  partlySubmerged[12].visibility = 0;
  partlySubmerged[24].visibility = 0;
  expect(poseBox(partlySubmerged)).not.toBeNull();
  partlySubmerged[23].visibility = 0;
  expect(poseBox(partlySubmerged)).toBeNull();
});

test('a limb assigned to a neighbouring swimmer is hidden without borrowing its joints', () => {
  const target = pose(0.3, 0.5);
  target[14] = { x: 0.34, y: 0.48, visibility: 1, presence: 1 };
  target[16] = { x: 0.76, y: 0.5, visibility: 1, presence: 1 };
  const selected = poseBox(target);
  const neighbour = poseBox(pose(0.76, 0.5));
  const result = sanitizeSelectedPose(target, selected, [neighbour]);
  expect(result.unreliable).toBe(true);
  expect(result.points[16].visibility).toBe(0);
  expect(result.points[14].visibility).toBe(1);
});

test('low-confidence joints remain hidden even when the torso is tracked', () => {
  const target = pose(0.3, 0.5);
  target[14] = { x: 0.34, y: 0.48, visibility: 0.2, presence: 1 };
  target[16] = { x: 0.37, y: 0.46, visibility: 1, presence: 1 };
  const result = sanitizeSelectedPose(target, poseBox(target));
  expect(result.points[14].visibility).toBe(0);
  expect(result.points[16].visibility).toBe(0);
});
