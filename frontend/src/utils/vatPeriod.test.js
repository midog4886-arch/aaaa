import { vatPresetRange } from './vatPeriod';

test('month and quarter presets span their whole calendar period', () => {
  const today = new Date(2026, 9, 18);
  expect(vatPresetRange('month', today)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  expect(vatPresetRange('quarter', today)).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  expect(vatPresetRange('previous-month', today)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
});

test('previous month handles year boundary', () => {
  expect(vatPresetRange('previous-month', new Date(2026, 0, 8))).toEqual({ start: '2025-12-01', end: '2025-12-31' });
});
