import { angleAt, poseMetrics } from './poseAnalysis';

const point = (x, y, visibility = 1) => ({ x, y, visibility });

test('knee angle is measured from the visible kicking leg', () => {
  const landmarks = Array.from({ length: 33 }, () => point(0, 0, 0));
  landmarks[12] = point(0.5, 0.1);
  landmarks[24] = point(0.5, 0.4);
  landmarks[26] = point(0.5, 0.6);
  landmarks[28] = point(0.7, 0.6);
  expect(poseMetrics(landmarks, 'football', 'right').knee_angle).toBe(90);
});

test('swimming reports an elbow angle only when the arm is visible', () => {
  const landmarks = Array.from({ length: 33 }, () => point(0, 0, 0));
  landmarks[11] = point(0.2, 0.2);
  landmarks[13] = point(0.4, 0.2);
  landmarks[15] = point(0.4, 0.4);
  expect(poseMetrics(landmarks, 'swimming', 'left').elbow_angle).toBe(90);
  landmarks[15].visibility = 0.1;
  expect(poseMetrics(landmarks, 'swimming', 'left').elbow_angle).toBeNull();
  expect(angleAt(point(0, 0), point(0, 0), point(0, 0))).toBeNull();
});
