import { stabilizePose } from './poseStabilization';

const points = () => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1, presence: 1 }));

test('isolated joint jump is rejected rather than carried into an angle', () => {
  const before = points();
  const after = points(); after[14].x = 0.95;
  expect(stabilizePose(before, after, 0.08)[14].visibility).toBe(0);
});

test('short smooth motion is retained and occluded joints are not invented', () => {
  const before = points();
  const after = points(); after[14].x = 0.55; after[16].visibility = 0;
  const result = stabilizePose(before, after, 0.08);
  expect(result[14].x).toBeGreaterThan(0.5);
  expect(result[14].x).toBeLessThanOrEqual(0.55);
  expect(result[16].visibility).toBe(0);
  expect(stabilizePose(before, after, 1)).toBe(after);
});
