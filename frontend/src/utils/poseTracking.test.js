import { matchPose, pickPose, poseBox, videoPoint } from './poseTracking';

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

test('click mapping accounts for video letterboxing', () => {
  const canvas = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }) };
  const video = { videoWidth: 400, videoHeight: 200 };
  expect(videoPoint({ clientX: 300, clientY: 200 }, video, canvas)).toEqual({ x: 0.5, y: 0.5 });
  expect(videoPoint({ clientX: 300, clientY: 70 }, video, canvas)).toBeNull();
});
