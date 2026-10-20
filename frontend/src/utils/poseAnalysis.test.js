import { angleAt, poseMetrics, applyPoseCorrections, nearestEditableJoint } from './poseAnalysis';

const point = (x, y, visibility = 1) => ({ x, y, visibility });

test('knee angle is measured from the visible kicking leg', () => {
  const landmarks = Array.from({ length: 33 }, () => point(0, 0, 0));
  landmarks[12] = point(0.5, 0.1);
  landmarks[24] = point(0.5, 0.4);
  landmarks[26] = point(0.5, 0.6);
  landmarks[28] = point(0.7, 0.6);
  expect(poseMetrics(landmarks, 'football', 'right').knee_angle).toBe(90);
});

test('coach correction changes only the selected joint and updates the angle', () => {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  points[12] = { x: 0.4, y: 0.4, visibility: 1 };
  points[14] = { x: 0.5, y: 0.5, visibility: 0.1 };
  points[16] = { x: 0.6, y: 0.4, visibility: 1 };
  const joint = nearestEditableJoint(points, { x: 0.5, y: 0.5 }, 'right');
  expect(joint).toBe(14);
  const corrected = applyPoseCorrections(points, { '14': { x: 0.5, y: 0.55 } });
  expect(corrected[14].visibility).toBe(1);
  expect(points[14].visibility).toBe(0.1);
  expect(poseMetrics(corrected, 'swimming', 'right').elbow_angle).not.toBeNull();
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
