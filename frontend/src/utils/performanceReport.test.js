import { chartPoints, comparisonReport, eventSummary } from './performanceReport';

const samples = (angle, count = 8) => Array.from({ length: count }, (_, index) => ({
  time: 1 + index * .25, quality: 'valid', seen: 28,
  metrics: { elbow_angle: angle, hip_angle: 160, body_tilt: 20 },
}));

test('compares the same event without labeling a changed angle as an improvement', () => {
  const report = comparisonReport(samples(145), samples(120),
    { current_event_time: 1.875, baseline_event_time: 1.875 }, 'swimming');
  expect(report.usable).toBe(true);
  expect(report.deltas.elbow_angle).toBe(25);
  expect(report.improved).toBeUndefined();
});

test('gaps and occluded frames lower coverage and are excluded from the chart', () => {
  const poor = [...samples(120, 3), { time: 1.75, quality: 'lost', seen: 0, metrics: {} }];
  expect(eventSummary(poor, 1.5, 'swimming').usable).toBe(false);
  expect(chartPoints(poor, 1.5, 'elbow_angle')).toHaveLength(3);
});
