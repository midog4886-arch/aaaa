import { matchesLegacyFreezePeriod } from '../legacyFreezePeriod';

const period = {
  start_date: '2026-09-17', original_end_date: '2026-10-13', end_date: '2026-11-03',
};

test('keeps every older freeze in the same extended subscription', () => {
  const freezes = [
    ['2026-09-27', '2026-10-13', '2026-10-18'],
    ['2026-10-01', '2026-10-18', '2026-10-20'],
    ['2026-10-04', '2026-10-20', '2026-10-29'],
  ];
  freezes.forEach(([start_date, old_end_date, new_end_date]) => {
    expect(matchesLegacyFreezePeriod(
      { old_end_date, new_end_date }, { start_date }, period,
    )).toBe(true);
  });
});

test('does not carry an older subscription freeze into a renewal', () => {
  expect(matchesLegacyFreezePeriod(
    { old_end_date: '2026-10-20', new_end_date: '2026-10-29' },
    { start_date: '2026-10-04' },
    { start_date: '2026-10-15', original_end_date: '2026-11-12', end_date: '2026-11-20' },
  )).toBe(false);
});
